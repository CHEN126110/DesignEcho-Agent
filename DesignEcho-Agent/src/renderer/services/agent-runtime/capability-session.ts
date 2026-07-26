/**
 * 单次 Agent 运行的 Capability Session。
 *
 * Session 只改变下一轮模型可见的 ToolSchema；它不执行 Photoshop、不授予权限，
 * 也不改变 Skill 内部或系统自用工具。activeTools 数组原地更新，旧 Agent runtime
 * 下一次 consumeToolsForIteration() 会自然读取新增 schema，无需第三套循环。
 */

import {
    buildRuntimeCapabilityInventory,
    expandAgentCapabilities,
    MAX_ON_DEMAND_CAPABILITY_REQUESTS,
    resolveAgentCapabilities
} from '../../../shared/agent-runtime-v5/capability-resolver';
import type { SkillRuntimeManifest } from '../../../shared/agent-runtime-v5/contracts';
import type {
    AgentCapabilityActivationResult,
    AgentCapabilityResolution,
    RuntimeCapabilityProviderIdentity,
    RuntimeCapabilityInventoryEntry
} from '../../../shared/agent-runtime-v5/contracts/capability-resolution';
import type { ToolSchema } from './types';

export const REQUEST_AGENT_CAPABILITIES_TOOL_NAME = 'requestAgentCapabilities';

export function isAgentCapabilityControlTool(value: unknown): boolean {
    return cleanName(value) === REQUEST_AGENT_CAPABILITIES_TOOL_NAME;
}

export interface CreateAgentCapabilitySessionInput {
    candidateTools: readonly ToolSchema[];
    workflowBridgeNames?: readonly string[];
    requestedTaskType?: string;
    manifest?: SkillRuntimeManifest;
    /** 扩展包可登记非执行 provider 身份；不会因此新增 Tool schema。 */
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}

export interface AgentCapabilitySession {
    /** 传给 AgentConfig.tools 的同一个可变数组。 */
    activeTools: ToolSchema[];
    inventory: RuntimeCapabilityInventoryEntry[];
    getResolution(): AgentCapabilityResolution;
    /** 只读映射：把真实 provider Tool 解析为当前已激活 Capability，不授予执行权限。 */
    getActiveCapabilityIdsForTool(toolName: string): string[];
    /** 本轮由模型明确按需请求并成功激活的 Capability；供 Stage 投影追加最小 provider 面。 */
    getOnDemandActivatedCapabilityIds(): string[];
    requestCapabilities(capabilityIds: readonly string[]): AgentCapabilityActivationResult;
    buildPromptSection(): string;
}

function cleanName(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(cleanName).filter(Boolean)));
}

function buildRequestToolSchema(resolution: AgentCapabilityResolution): ToolSchema {
    const capabilityIds = [...resolution.onDemandCapabilityIds];
    const capabilityItemSchema: Record<string, any> = {
        type: 'string',
        description: '要在下一轮装载的能力 id。只选择完成当前下一步真正需要的能力。'
    };
    if (capabilityIds.length > 0) capabilityItemSchema.enum = capabilityIds;

    return {
        name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
        description: [
            '按需装载更多 Agent Tool / Skill schema，供下一轮 ReAct 使用。',
            '此动作只扩展模型可见能力，不执行 Photoshop、不授予权限，也不代表任务完成。',
            '可选能力见 capabilityIds 的 enum；各能力的用途说明见 Capability Session 提示中的能力目录；优先请求最小充分集合，装载后再调用具体 Tool。'
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                capabilityIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_ON_DEMAND_CAPABILITY_REQUESTS,
                    uniqueItems: true,
                    items: capabilityItemSchema
                },
                reason: {
                    type: 'string',
                    description: '为什么当前下一步需要这些能力；只写任务理由，不写内部推理。'
                }
            },
            required: ['capabilityIds']
        }
    };
}

function formatList(values: readonly string[], limit: number): string {
    const normalized = unique(values);
    if (normalized.length === 0) return 'none';
    const shown = normalized.slice(0, limit);
    const suffix = normalized.length > shown.length ? ` (+${normalized.length - shown.length})` : '';
    return `${shown.join(', ')}${suffix}`;
}

/** 取 Tool schema 描述的第一句作为能力目录的一句话说明；过长时截断。 */
function firstSentence(value: unknown): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const match = text.match(/^(.{10,80}?[。！？.!?])(?:\s|$)/);
    if (match) return match[1];
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

const MAX_ON_DEMAND_CATALOG_TOOL_LINES = 40;
const MAX_ON_DEMAND_CATALOG_OTHER_LINES = 10;

export function createAgentCapabilitySession(
    input: CreateAgentCapabilitySessionInput
): AgentCapabilitySession {
    const candidateTools = [...input.candidateTools];
    const candidateToolNames = candidateTools.map((tool) => tool.name);
    const inventory = buildRuntimeCapabilityInventory({
        executableToolNames: candidateToolNames,
        workflowBridgeNames: input.workflowBridgeNames
    });
    let resolution = resolveAgentCapabilities({
        manifest: input.manifest,
        requestedTaskType: input.requestedTaskType,
        inventory,
        candidateToolNames,
        additionalCapabilityProviders: input.additionalCapabilityProviders
    });
    const activeTools: ToolSchema[] = [];
    const onDemandActivatedCapabilityIds = new Set<string>();

    function refreshActiveTools(): void {
        const selectedSet = new Set(resolution.selectedToolNames);
        const nextTools = candidateTools.filter((tool) => selectedSet.has(tool.name));
        if (resolution.onDemandCapabilityIds.length > 0) {
            nextTools.push(buildRequestToolSchema(resolution));
        }
        activeTools.splice(0, activeTools.length, ...nextTools);
    }

    refreshActiveTools();

    const toolDescriptionByName = new Map<string, string>(
        candidateTools.map((tool) => [tool.name, firstSentence(tool.description)])
    );

    /**
     * On-demand 能力的可读目录：裸 id 列表对模型没有信息量——它无法从
     * photoshop.sandbox.writeText 这种 id 推断用途。目录把每个 id 映射到首个
     * provider Tool 的一句话描述，requestAgentCapabilities 才真正可用。
     */
    function buildOnDemandCatalogLines(): string[] {
        if (resolution.onDemandCapabilityIds.length === 0) return [];
        const byId = new Map(inventory.map((entry) => [entry.capabilityId, entry]));
        const skillLines: string[] = [];
        const toolLines: string[] = [];
        const otherLines: string[] = [];
        resolution.onDemandCapabilityIds.forEach((capabilityId) => {
            const entry = byId.get(capabilityId);
            const providerName = entry?.providerToolNames[0] || '';
            const description = toolDescriptionByName.get(providerName) || '';
            const line = description ? `- ${capabilityId} — ${description}` : `- ${capabilityId}`;
            if (entry?.kind === 'skill') {
                skillLines.push(line);
            } else if (entry?.kind === 'tool') {
                toolLines.push(line);
            } else {
                otherLines.push(line);
            }
        });
        const lines: string[] = ['On-demand capability catalog (id — what it does):'];
        skillLines.forEach((line) => lines.push(line));
        toolLines.slice(0, MAX_ON_DEMAND_CATALOG_TOOL_LINES).forEach((line) => lines.push(line));
        if (toolLines.length > MAX_ON_DEMAND_CATALOG_TOOL_LINES) {
            lines.push(`- …(+${toolLines.length - MAX_ON_DEMAND_CATALOG_TOOL_LINES} more tool capabilities)`);
        }
        otherLines.slice(0, MAX_ON_DEMAND_CATALOG_OTHER_LINES).forEach((line) => lines.push(line));
        if (otherLines.length > MAX_ON_DEMAND_CATALOG_OTHER_LINES) {
            lines.push(`- …(+${otherLines.length - MAX_ON_DEMAND_CATALOG_OTHER_LINES} more capabilities)`);
        }
        return lines;
    }

    return {
        activeTools,
        inventory,
        getResolution(): AgentCapabilityResolution {
            return resolution;
        },
        getActiveCapabilityIdsForTool(toolName: string): string[] {
            const normalizedToolName = cleanName(toolName);
            if (!normalizedToolName || resolution.deniedToolNames.includes(normalizedToolName)) return [];
            const selectedCapabilityIds = new Set(resolution.selectedCapabilityIds);
            return unique(inventory
                .filter((entry) => (
                    selectedCapabilityIds.has(entry.capabilityId)
                    && entry.providerToolNames.includes(normalizedToolName)
                ))
                .map((entry) => entry.capabilityId));
        },
        getOnDemandActivatedCapabilityIds(): string[] {
            return Array.from(onDemandActivatedCapabilityIds);
        },
        requestCapabilities(capabilityIds: readonly string[]): AgentCapabilityActivationResult {
            const activation = expandAgentCapabilities({
                resolution,
                inventory,
                requestedCapabilityIds: capabilityIds,
                additionalCapabilityProviders: input.additionalCapabilityProviders
            });
            activation.activatedCapabilityIds.forEach((capabilityId) => {
                onDemandActivatedCapabilityIds.add(capabilityId);
            });
            resolution = activation.resolution;
            refreshActiveTools();
            return activation;
        },
        buildPromptSection(): string {
            const manifestLabel = resolution.manifestRef
                ? `${resolution.manifestRef.skillId} (${resolution.manifestRef.taskType})`
                : 'none — broad discovery';
            const referenceMetrics = resolution.referenceResolution.metrics.byKind;
            const unavailableRefs = Object.values(resolution.referenceResolution.unavailable).flat();
            return [
                `Capability resolution: ${resolution.version}`,
                `Mode: ${resolution.selectionMode}; status: ${resolution.status}`,
                `Manifest: ${manifestLabel}`,
                `Resolved session actions: ${resolution.metrics.selectedToolCount}/${resolution.metrics.candidateToolCount}`,
                `On-demand capabilities remaining: ${resolution.onDemandCapabilityIds.length}`,
                `Knowledge refs: ${formatList(resolution.references.knowledgeRefs, 5)}`,
                `Memory refs: ${formatList(resolution.references.memoryRefs, 4)}`,
                `Evaluation refs: ${formatList(resolution.references.evaluationRefs, 4)}`,
                `Policy refs: ${formatList(resolution.references.policyRefs, 5)}`,
                `Provider-backed refs: knowledge ${referenceMetrics.knowledge.resolved}/${referenceMetrics.knowledge.requested}; skill ${referenceMetrics.skill.resolved}/${referenceMetrics.skill.requested}; tool ${referenceMetrics.tool.resolved}/${referenceMetrics.tool.requested}; memory ${referenceMetrics.memory.resolved}/${referenceMetrics.memory.requested}; evaluation ${referenceMetrics.evaluation.resolved}/${referenceMetrics.evaluation.requested}; policy ${referenceMetrics.policy.resolved}/${referenceMetrics.policy.requested}.`,
                `Unavailable refs: ${formatList(unavailableRefs, 8)}`,
                ...buildOnDemandCatalogLines(),
                resolution.onDemandCapabilityIds.length > 0
                    ? `When the next required action schema is absent from the current model call, request only an id listed by ${REQUEST_AGENT_CAPABILITIES_TOOL_NAME}; do not request an already active capability.`
                    : 'All discoverable capabilities are already active; call the concrete action directly instead of requesting capability expansion.',
                'The current Runtime stage may expose a smaller action subset than the resolved session inventory. Finish the required stage declaration instead of re-requesting an already active action.',
                'Provider-backed means the capability identity is traceable; it does not mean its content was read, its Policy ran, its Evaluation passed, or its Skill executed.',
                'Capability loading changes model context only. All action permissions, confirmations, read-after-write checks and quality claims remain governed at execution and evaluation points.'
            ].join('\n');
        }
    };
}
