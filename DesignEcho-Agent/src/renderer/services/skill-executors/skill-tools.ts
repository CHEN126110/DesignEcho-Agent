/**
 * Skill → legacy workflow bridge 适配层
 *
 * Skill 不是 Tool。本文件只是在旧 renderer Agent 工具循环尚未整体迁移到
 * v5 SkillRuntimeManifest 前，把 SKILL_REGISTRY 中的技能声明暴露成 legacy
 * workflow bridge，让模型能在 ReAct 中选择一个封装工作流。
 *
 * 约束在执行点强制（技能开关、抠图暂停、执行器存在性），结果必须返回
 * ReAct observation，不能把工作流输出当作跳过 Agent 的终局硬编码答案。
 */

import type { ToolSchema } from '../agent-runtime/types';
import type {
    RuntimeDesignBriefDeclaration,
    RuntimeDesignBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import type {
    RuntimeReferenceBriefDeclaration,
    RuntimeReferenceBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import type {
    RuntimeDesignStrategyDeclaration,
    RuntimeDesignStrategyDigest
} from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanDigest
} from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';
import type { AgentTaskPlanningContract } from '../../../shared/agent-task-planning-contract';
import type { SkillDeclaration, SkillParameter } from '../../../shared/types/skill.types';
import { SKILL_REGISTRY, getSkillById } from '../../../shared/skills/skill-declarations';
import { useAppStore } from '../../stores/app.store';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';
import {
    isAgentMattingPaused,
    getAgentMattingPausedMessage
} from '../agent-orchestration/routing';
import { executeSkillWithExecutor, getSkillExecutor } from './registry';
import { buildAgentReActObservationFromSkillResult } from '../../../shared/agent-react-observation-contract';

/** 与 routing.isSkillEnabled 同语义的本地实现（避免引入 routing 的重依赖链） */
function isSkillEnabledInSettings(skillId: string): boolean {
    try {
        const integrationSettings = (useAppStore.getState() as any).integrationSettings;
        return integrationSettings?.skills?.[skillId]?.enabled !== false;
    } catch {
        return true;
    }
}

function isSkillExposableToLoop(skill: SkillDeclaration): boolean {
    if (skill.id === 'autonomous-agent') return false;
    const visibility = (skill as any).visibility;
    if (visibility && visibility !== 'user-facing') return false;
    if (skill.id === 'matte-product' && isAgentMattingPaused()) return false;
    if (!isSkillEnabledInSettings(skill.id)) return false;
    return true;
}

/** SkillParameter → JSON Schema 属性 */
function skillParamToSchema(param: SkillParameter): Record<string, any> {
    const schema: Record<string, any> = { description: param.description };
    switch (param.type) {
        case 'number':
            schema.type = 'number';
            break;
        case 'boolean':
            schema.type = 'boolean';
            break;
        case 'array':
            schema.type = 'array';
            schema.items = {};
            break;
        case 'object':
            schema.type = 'object';
            break;
        case 'image':
            schema.type = 'string';
            schema.description = `${param.description}（图片 base64 或本地文件路径）`;
            break;
        case 'string':
        default:
            schema.type = 'string';
    }
    if (param.enum && param.enum.length > 0) schema.enum = param.enum;
    if (param.default !== undefined) schema.default = param.default;
    return schema;
}

/**
 * 构建当前可暴露给自主循环的技能工具 schema 列表。
 * 每次调用时重新评估（技能开关可能在设置中变化）。
 */
export function buildSkillToolSchemas(): ToolSchema[] {
    return SKILL_REGISTRY
        .filter(isSkillExposableToLoop)
        .map(skill => {
            const properties: Record<string, any> = {};
            const required: string[] = [];
            for (const param of skill.parameters) {
                properties[param.name] = skillParamToSchema(param);
                if (param.required) required.push(param.name);
            }

            const descriptionLines = [
                `【工作流桥接】${skill.description}`,
                '这是注册 Skill 的 legacy workflow bridge，不是原子 Photoshop 工具；调用后必须观察结果并继续 ReAct / Quality Gate。',
                skill.whenToUse.length > 0 ? `适用: ${skill.whenToUse.join('；')}` : '',
                skill.whenNotToUse && skill.whenNotToUse.length > 0 ? `不适用: ${skill.whenNotToUse.join('；')}` : '',
                `输出: ${skill.output.description}`
            ].filter(Boolean);

            return {
                name: skill.id,
                description: descriptionLines.join('\n'),
                inputSchema: {
                    type: 'object' as const,
                    properties,
                    ...(required.length > 0 ? { required } : {})
                }
            };
        });
}

/** 判断某个 legacy workflow bridge 名称是否对应一个已注册 Skill。 */
export function isSkillWorkflowBridgeToolName(toolName: string): boolean {
    return Boolean(getSkillById(toolName));
}

/** @deprecated Use isSkillWorkflowBridgeToolName. Kept for legacy callers. */
export const isSkillToolName = isSkillWorkflowBridgeToolName;

export interface SkillToolExecuteOptions {
    callbacks?: any;
    signal?: AbortSignal;
    context?: any;
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
    runtimeDesignBriefRequiredInputKeys?: string[];
    runtimeReferenceBriefDeclaration?: RuntimeReferenceBriefDeclaration;
    runtimeReferenceBriefDigest?: RuntimeReferenceBriefDigest;
    runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
    runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
    runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
    runtimeActionPlanDigest?: RuntimeActionPlanDigest;
    agentTaskPlan?: AgentTaskPlanningContract;
}

export function buildSkillWorkflowBridgeObservation(toolName: string, result: any): any {
    return buildAgentReActObservationFromSkillResult({
        skillId: toolName,
        result
    });
}

function resolveSkillToolUserInput(params: Record<string, any>, options: SkillToolExecuteOptions): string {
    return String(
        options.context?.userInput
        || params?.userIntent
        || params?.userTask
        || params?.task
        || params?.userInput
        || ''
    ).trim();
}

function resolveSkillToolMode(params: Record<string, any>): 'execute' | 'inspect' | undefined {
    const mode = String(params?.mode || '').trim();
    return mode === 'execute' || mode === 'inspect' ? mode : undefined;
}

/** 在自主循环内执行技能。 */
export async function executeSkillTool(
    toolName: string,
    params: Record<string, any>,
    options: SkillToolExecuteOptions
): Promise<any> {
    // 门禁出口治理（2026-07-02）：执行点拒绝必须给出替代路径（改用什么工具 / 谁能解锁），
    // 不能只说"不行"。抠图暂停消息（getAgentMattingPausedMessage）本身已说明替代边界
    // （UXP 面板用户工具），保持单一来源不在此复写。
    const skill = getSkillById(toolName);
    if (!skill) {
        return { success: false, error: `未注册的技能: ${toolName}。请改用本轮可用工具列表中的原子工具完成同一目标。` };
    }
    if (toolName === 'matte-product' && isAgentMattingPaused()) {
        return { success: false, error: getAgentMattingPausedMessage() };
    }
    if (!isSkillEnabledInSettings(toolName)) {
        return { success: false, error: `技能 ${skill.name} 当前已在设置中关闭。请改用基础原子工具完成同一目标，或提示用户在设置中启用该技能。` };
    }

    if (!getSkillExecutor(toolName)) {
        return { success: false, error: `技能 ${toolName} 还没有接好，请改用基础处理动作完成该任务。` };
    }

    const normalizedParams = applySharedSkillParamDefaults({
        skillId: toolName,
        userInput: resolveSkillToolUserInput(params || {}, options),
        mode: resolveSkillToolMode(params || {}),
        params: params || {}
    });

    const result = await executeSkillWithExecutor(toolName, {
        params: normalizedParams,
        callbacks: options.callbacks,
        signal: options.signal,
        context: options.context,
        runtimeDesignBriefDeclaration: options.runtimeDesignBriefDeclaration,
        runtimeDesignBriefDigest: options.runtimeDesignBriefDigest,
        runtimeDesignBriefRequiredInputKeys: options.runtimeDesignBriefRequiredInputKeys,
        runtimeReferenceBriefDeclaration: options.runtimeReferenceBriefDeclaration,
        runtimeReferenceBriefDigest: options.runtimeReferenceBriefDigest,
        runtimeDesignStrategyDeclaration: options.runtimeDesignStrategyDeclaration,
        runtimeDesignStrategyDigest: options.runtimeDesignStrategyDigest,
        runtimeActionPlanDeclaration: options.runtimeActionPlanDeclaration,
        runtimeActionPlanDigest: options.runtimeActionPlanDigest,
        agentTaskPlan: options.agentTaskPlan
    });
    const currentData = result?.data && typeof result.data === 'object'
        ? result.data
        : {};
    return {
        ...result,
        data: {
            ...currentData,
            agentReActObservation: buildSkillWorkflowBridgeObservation(toolName, result)
        }
    };
}
