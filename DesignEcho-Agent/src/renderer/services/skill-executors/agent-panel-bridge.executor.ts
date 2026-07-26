import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { useAppStore } from '../../stores/app.store';
import {
    callPhotoshopMcpTool,
    getPhotoshopConnectionStatus,
    listPhotoshopMcpTools
} from '../mcp-host.client';

type BridgeParams = {
    goal?: string;
    symptom?: string;
    expectedResult?: string;
    reproSteps?: string[];
    constraints?: string[];
    needMcpTools?: boolean;
    mcpToolName?: string;
    mcpArguments?: Record<string, any>;
    feedbackModelId?: string;
};

export type McpToolItem = {
    name: string;
    description?: string;
    inputSchema?: Record<string, any>;
};

type ModelBridgeFeedback = {
    action_request: string[];
    expected_feedback: string[];
    next_steps: string[];
    summary?: string;
};

function toList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function parseJsonObject(text: string): any | null {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
        const candidate = fenced ? fenced[1].trim() : raw;
        try {
            return JSON.parse(candidate);
        } catch {
            const start = candidate.indexOf('{');
            const end = candidate.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    return JSON.parse(candidate.slice(start, end + 1));
                } catch {
                    return null;
                }
            }
            return null;
        }
    }
}

async function resolveFeedbackModelId(explicitModelId?: string): Promise<string> {
    const fromParam = String(explicitModelId || '').trim();
    if (fromParam) return fromParam;
    try {
        const state = useAppStore.getState() as any;
        const prefs = state?.modelPreferences;
        // 角色化模型：非视觉文本任务统一交给主模型，不再维护 textOptimize 专用槽位。
        const primaryModel = String(prefs?.primaryModel || '').trim();
        if (primaryModel) return primaryModel;
        const mode = String(prefs?.mode || '').toLowerCase();
        if (mode === 'local') {
            const localModel = String(prefs?.preferredLocalModels?.textOptimize || '').trim();
            if (localModel) return localModel;
        }
        const cloudModel = String(prefs?.preferredCloudModels?.textOptimize || '').trim();
        if (cloudModel) return cloudModel;
    } catch {}
    return 'google-gemini-3-flash';
}

function normalizeStringList(value: unknown, max = 6): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, max);
}

async function buildModelBridgeFeedback(input: {
    modelId: string;
    goal: string;
    symptom: string;
    expectedResult: string;
    reproSteps: string[];
    constraints: string[];
    suggestedTools: McpToolItem[];
}): Promise<ModelBridgeFeedback | null> {
    if (!(window as any)?.designEcho?.chat) return null;
    const prompt = [
        '请生成联调反馈规划，只输出 JSON。',
        '字段要求：',
        '{',
        '  "action_request": string[]',
        '  "expected_feedback": string[]',
        '  "next_steps": string[]',
        '  "summary": string',
        '}',
        '',
        `目标: ${input.goal}`,
        `现象: ${input.symptom}`,
        `期望: ${input.expectedResult}`,
        `复现: ${input.reproSteps.join(' | ') || '未提供'}`,
        `约束: ${input.constraints.join(' | ') || '无'}`,
        `推荐工具: ${input.suggestedTools.map((tool) => tool.name).join(', ') || '无'}`
    ].join('\n');

    try {
        const response = await window.designEcho.chat(input.modelId, [
            { role: 'system', content: '你是桌面端Agent联调规划助手，返回可执行、可验证的JSON。' },
            { role: 'user', content: prompt }
        ], { temperature: 0.2, maxTokens: 1200 });

        const parsed = parseJsonObject(String(response?.text || ''));
        if (!parsed || typeof parsed !== 'object') return null;

        const action_request = normalizeStringList((parsed as any).action_request);
        const expected_feedback = normalizeStringList((parsed as any).expected_feedback);
        const next_steps = normalizeStringList((parsed as any).next_steps);
        const summary = String((parsed as any).summary || '').trim();

        if (!action_request.length || !expected_feedback.length || !next_steps.length) return null;
        return { action_request, expected_feedback, next_steps, summary };
    } catch {
        return null;
    }
}

export function extractMcpTools(raw: any): McpToolItem[] {
    const candidates = [
        raw?.tools,
        raw?.result?.tools,
        raw?.result?.result?.tools,
        raw?.data?.tools
    ];

    const source = candidates.find((entry) => Array.isArray(entry)) as any[] | undefined;
    if (!source) return [];

    return source
        .map((tool) => ({
            name: String(tool?.name || '').trim(),
            description: typeof tool?.description === 'string' ? tool.description : '',
            inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : undefined
        }))
        .filter((tool) => !!tool.name);
}

export function recommendMcpTools(goal: string, tools: McpToolItem[]): McpToolItem[] {
    const text = String(goal || '').toLowerCase();
    if (!tools.length) return [];

    const groups = [
        {
            test: /详情|detail|文案|切片|模板/.test(text),
            keywords: ['detail', 'template', 'slice', 'text', 'copy', 'parse']
        },
        {
            test: /主图|main|白底|click|转化/.test(text),
            keywords: ['main', 'subject', 'layout', 'export', 'quick']
        },
        {
            test: /连接|mcp|工具|联调|桥接/.test(text),
            keywords: ['list', 'diagnose', 'document', 'state', 'tools']
        }
    ];

    const activeGroup = groups.find((group) => group.test) || groups[2];
    const scored = tools
        .map((tool) => {
            const bag = `${tool.name} ${tool.description || ''}`.toLowerCase();
            const score = activeGroup.keywords.reduce((acc, keyword) => acc + (bag.includes(keyword) ? 1 : 0), 0);
            return { tool, score };
        })
        .sort((a, b) => b.score - a.score);

    return scored.filter((entry) => entry.score > 0).slice(0, 6).map((entry) => entry.tool);
}

export const agentPanelBridgeExecutor: SkillExecutor = {
    skillId: 'agent-panel-bridge',

    async execute({ params, callbacks, signal }: SkillExecuteParams): Promise<AgentResult> {
        const p = (params || {}) as BridgeParams;
        const goal = String(p.goal || '').trim();
        if (!goal) {
            return {
                success: false,
                message: '❌ 请提供 goal，用于明确要调试或实现的目标',
                error: 'goal is required'
            };
        }

        callbacks?.onMessage?.('🧭 正在构建 Agent 面板桥接调试消息...');

        const reproSteps = toList(p.reproSteps);
        const constraints = toList(p.constraints);
        const symptom = String(p.symptom || '未知').trim();
        const expectedResult = String(p.expectedResult || '未提供').trim();
        const feedbackModelId = await resolveFeedbackModelId(p.feedbackModelId);

        const connectionStatus = await getPhotoshopConnectionStatus().catch(() => ({ connected: false, source: 'ipc' as const }));
        const pluginConnected = !!connectionStatus?.connected;
        const wsStatus = { connected: pluginConnected, source: connectionStatus.source };
        const mustUseMcp = p.needMcpTools !== false || !!String(p.mcpToolName || '').trim();

        if (!pluginConnected && mustUseMcp) {
            return {
                success: false,
                message: '当前未连接到 Photoshop 插件，无法继续面板调试链路。请先确认 UXP 插件已启动并连接，再重试。',
                error: 'plugin not connected for MCP bridge',
                data: {
                    wsStatus
                }
            };
        }

        let mcpTools: any = null;
        let parsedTools: McpToolItem[] = [];
        let suggestedTools: McpToolItem[] = [];
        if (p.needMcpTools !== false && pluginConnected) {
            callbacks?.onMessage?.('🔎 正在获取 MCP 工具列表...');
            mcpTools = await listPhotoshopMcpTools().catch((error: any) => ({
                error: error?.message || String(error || 'unknown error')
            }));
            if (!mcpTools?.error) {
                parsedTools = extractMcpTools(mcpTools);
                suggestedTools = recommendMcpTools(goal, parsedTools);
            }
        }

        let mcpCall: any = null;
        const mcpToolName = String(p.mcpToolName || '').trim();
        if (mcpToolName && pluginConnected) {
            callbacks?.onMessage?.(`🛠️ 正在调用 MCP 工具: ${mcpToolName}`);
            mcpCall = await callPhotoshopMcpTool(mcpToolName, p.mcpArguments || {}, { signal }).catch((error: any) => ({
                error: error?.message || String(error || 'unknown error')
            }));
        }

        const fallbackActionRequest = [
            '确认当前可用 MCP 工具与能力边界',
            '按复现步骤执行并回传关键日志/状态',
            '给出最小修复动作并返回验证结果'
        ];
        const fallbackExpectedFeedback = [
            '工具调用结果、关键字段与错误信息',
            '修复前后对比与是否达成目标',
            '下一步建议（继续自动修复或人工确认）'
        ];
        const fallbackNextSteps = [
            '将上方 JSON 发送到 Agent 面板',
            '回传关键状态、关键返回字段、失败堆栈',
            '根据回传结果继续收敛到最小修复方案'
        ];

        const modelFeedback = await buildModelBridgeFeedback({
            modelId: feedbackModelId,
            goal,
            symptom,
            expectedResult,
            reproSteps,
            constraints,
            suggestedTools
        });
        const actionRequest = modelFeedback?.action_request?.length ? modelFeedback.action_request : fallbackActionRequest;
        const expectedFeedback = modelFeedback?.expected_feedback?.length ? modelFeedback.expected_feedback : fallbackExpectedFeedback;
        const nextSteps = modelFeedback?.next_steps?.length ? modelFeedback.next_steps : fallbackNextSteps;

        const panelMessage = {
            intent: 'debug_or_implement',
            task: goal,
            current_state: {
                symptom,
                scope: 'agent_desktop',
                constraints
            },
            action_request: actionRequest,
            expected_feedback: expectedFeedback
        };

        const verification = [
            `目标达成: ${expectedResult}`,
            `复现步骤完整: ${reproSteps.length > 0 ? '是' : '否（需补充）'}`,
            `桌面端连接状态: ${pluginConnected ? '已连接' : '未连接'}`
        ];

        const mcpCallFailed = !!(mcpCall && typeof mcpCall === 'object' && 'error' in mcpCall && mcpCall.error);

        return {
            success: !mcpCallFailed,
            message: `面板调试任务已准备；推荐工具 ${suggestedTools.length} 个。`,
            error: mcpCallFailed ? String((mcpCall as any).error || 'MCP call failed') : undefined,
            data: {
                panelMessage,
                reproSteps,
                constraints,
                wsStatus,
                mcpTools,
                parsedTools,
                suggestedTools,
                feedbackModelId,
                modelFeedback,
                verification,
                nextSteps,
                mcpCall
            }
        };
    }
};
