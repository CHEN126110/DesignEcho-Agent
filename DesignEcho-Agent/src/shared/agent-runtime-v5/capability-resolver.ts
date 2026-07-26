/**
 * Manifest-driven Capability Resolver。
 *
 * 数据来源只有现有 Skill manifest、legacy capability bridge 和调用方注入的
 * 真实 Tool / Skill inventory。Resolver 不读取 taskText，不拥有业务 registry，
 * 不决定执行顺序；manifest.available_tools 是首轮种子而不是能力上限。
 */

import { getPhotoshopToolSkillSemantics } from '../photoshop-tool-skill';
import { listBuiltinNonExecutableCapabilityProviders } from './capability-provider-identities';
import type { SkillRuntimeManifest } from './contracts';
import { listDesignEvaluationProfileCapabilityProviders } from './design-evaluation-profiles';
import type {
    AgentCapabilityActivationResult,
    AgentCapabilityResolution,
    AgentCapabilityResolutionIssue,
    CapabilityKind,
    CapabilityReferenceResolution,
    CapabilityReferenceSet,
    RuntimeCapabilityProviderIdentity,
    RuntimeCapabilityInventoryEntry
} from './contracts/capability-resolution';
import { LEGACY_TOOL_CAPABILITY_MAP } from './tool-capability-bridge';

/** 单轮只允许装载最小充分集合；限制批量，不限制后续轮次的能力可达性。 */
export const MAX_ON_DEMAND_CAPABILITY_REQUESTS = 3;

export const HARNESS_BASELINE_CAPABILITY_IDS: readonly string[] = Object.freeze([
    'agent.intent.declareDesignTask',
    'project.listResources',
    'project.searchResources',
    'memory.designProjectState',
    'photoshop.read.getDocumentSummary'
]);

/**
 * 通用 autonomous Agent 不是可恢复操作的 owner：它创建的通用卡提交后只能
 * record_only，却会先把整轮停在 awaiting_confirmation。该模型可调用能力因此
 * 不进入任何 autonomous Capability Session；叶子 Skill 原生卡和 Harness 内建
 * HITL 不通过这条 schema 暴露链，不受影响。
 */
const AUTONOMOUS_AGENT_UNOWNED_CAPABILITY_IDS: readonly string[] = Object.freeze([
    'agent.interaction.requestConfirmation'
]);

export interface BuildRuntimeCapabilityInventoryInput {
    executableToolNames: readonly string[];
    workflowBridgeNames?: readonly string[];
}

export interface ResolveAgentCapabilitiesInput {
    manifest?: SkillRuntimeManifest;
    requestedTaskType?: string;
    inventory: readonly RuntimeCapabilityInventoryEntry[];
    candidateToolNames: readonly string[];
    baselineCapabilityIds?: readonly string[];
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}

export interface ExpandAgentCapabilitiesInput {
    resolution: AgentCapabilityResolution;
    inventory: readonly RuntimeCapabilityInventoryEntry[];
    requestedCapabilityIds: readonly string[];
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}

function cleanName(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(cleanName).filter(Boolean)));
}

function capabilityEntryMap(
    inventory: readonly RuntimeCapabilityInventoryEntry[]
): Map<string, RuntimeCapabilityInventoryEntry> {
    return new Map(inventory.map((entry) => [entry.capabilityId, entry]));
}

function collectToolNames(
    capabilityIds: readonly string[],
    inventory: readonly RuntimeCapabilityInventoryEntry[],
    excludedToolNames: ReadonlySet<string> = new Set()
): string[] {
    const byId = capabilityEntryMap(inventory);
    return unique(capabilityIds.flatMap((capabilityId) => (
        byId.get(capabilityId)?.providerToolNames || []
    ))).filter((toolName) => !excludedToolNames.has(toolName));
}

function hasAvailableProvider(
    entry: RuntimeCapabilityInventoryEntry,
    deniedToolNames: ReadonlySet<string>
): boolean {
    return entry.providerToolNames.some((toolName) => !deniedToolNames.has(toolName));
}

function buildReferenceSet(
    manifest: SkillRuntimeManifest | undefined,
    selectedCapabilityIds: readonly string[],
    inventory: readonly RuntimeCapabilityInventoryEntry[]
): CapabilityReferenceSet {
    const byId = capabilityEntryMap(inventory);
    const workModeEvaluationRefs = Object.values(manifest?.work_mode_contracts || {})
        .flatMap((contract) => contract?.review_rubric_ref ? [contract.review_rubric_ref] : []);
    const selectedSkillCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'skill'
    ));
    const selectedToolCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'tool'
    ));
    return {
        knowledgeRefs: unique(manifest?.knowledge_refs || []),
        skillRefs: unique([
            ...(manifest ? [manifest.skill_id] : []),
            ...selectedSkillCapabilityIds
        ]),
        toolCapabilityIds: unique(selectedToolCapabilityIds),
        memoryRefs: unique(manifest?.memory_refs || []),
        evaluationRefs: unique([
            ...(manifest?.evaluation_refs || []),
            ...(manifest?.review_rubric_ref ? [manifest.review_rubric_ref] : []),
            ...workModeEvaluationRefs
        ]),
        policyRefs: unique(manifest?.policy_refs || [])
    };
}

const CAPABILITY_REFERENCE_FIELDS: ReadonlyArray<{
    kind: CapabilityKind;
    key: keyof CapabilityReferenceSet;
}> = Object.freeze([
    { kind: 'knowledge', key: 'knowledgeRefs' },
    { kind: 'skill', key: 'skillRefs' },
    { kind: 'tool', key: 'toolCapabilityIds' },
    { kind: 'memory', key: 'memoryRefs' },
    { kind: 'evaluation', key: 'evaluationRefs' },
    { kind: 'policy', key: 'policyRefs' }
]);

function emptyReferenceSet(): CapabilityReferenceSet {
    return {
        knowledgeRefs: [],
        skillRefs: [],
        toolCapabilityIds: [],
        memoryRefs: [],
        evaluationRefs: [],
        policyRefs: []
    };
}

function normalizeProviderIdentity(
    provider: RuntimeCapabilityProviderIdentity,
    forceExtensionSource = false
): RuntimeCapabilityProviderIdentity | undefined {
    const capabilityId = cleanName(provider.capabilityId);
    const providerId = cleanName(provider.providerId);
    const safeTokenPattern = /^[a-zA-Z0-9._:@/-]+$/;
    const containsSensitiveLabel = /api[_-]?key|access[_-]?token|secret/i;
    const unsafeToken = (value: string): boolean => (
        value.length > 160
        || !safeTokenPattern.test(value)
        || value.includes('..')
        || value.includes('://')
        || containsSensitiveLabel.test(value)
    );
    if (!capabilityId || !providerId || unsafeToken(capabilityId) || unsafeToken(providerId)) {
        return undefined;
    }
    const applicableSkillIds = unique(provider.applicableSkillIds || []).filter((value) => !unsafeToken(value));
    const applicableTaskTypes = unique(provider.applicableTaskTypes || []).filter((value) => !unsafeToken(value));
    return {
        capabilityId,
        kind: provider.kind,
        providerId,
        source: forceExtensionSource ? 'extension_provider' : provider.source,
        exposure: provider.exposure,
        // 扩展 provider 只能声明身份；是否进入 schema 必须由真实 action inventory 决定。
        exposedAsToolSchema: forceExtensionSource ? false : provider.exposedAsToolSchema === true,
        ...(applicableSkillIds.length > 0 ? { applicableSkillIds } : {}),
        ...(applicableTaskTypes.length > 0 ? { applicableTaskTypes } : {})
    };
}

function buildCapabilityProviderCatalog(input: {
    manifestRef?: AgentCapabilityResolution['manifestRef'];
    inventory: readonly RuntimeCapabilityInventoryEntry[];
    selectedCapabilityIds: readonly string[];
    selectedToolNames: readonly string[];
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}): RuntimeCapabilityProviderIdentity[] {
    const selectedCapabilityIds = new Set(input.selectedCapabilityIds);
    const selectedToolNames = new Set(input.selectedToolNames);
    const providers: RuntimeCapabilityProviderIdentity[] = [];

    input.inventory.forEach((entry) => {
        providers.push({
            capabilityId: entry.capabilityId,
            kind: entry.kind,
            providerId: `action:${entry.capabilityId}`,
            source: 'runtime_tool_inventory',
            exposure: 'model_tool_schema',
            exposedAsToolSchema: selectedCapabilityIds.has(entry.capabilityId)
        });
    });

    if (input.manifestRef) {
        providers.push({
            capabilityId: input.manifestRef.skillId,
            kind: 'skill',
            providerId: `manifest:${input.manifestRef.skillId}@${input.manifestRef.version}`,
            source: 'skill_manifest',
            exposure: 'manifest_context',
            exposedAsToolSchema: false
        });
    }

    unique(input.inventory.flatMap((entry) => entry.providerToolNames)).forEach((toolName) => {
        const semantics = getPhotoshopToolSkillSemantics(toolName);
        if (semantics?.capabilityKind !== 'knowledge_search') return;
        providers.push({
            capabilityId: `tool:${toolName}`,
            kind: 'knowledge',
            providerId: `knowledge-tool:${toolName}`,
            source: 'knowledge_tool_semantics',
            exposure: 'model_tool_schema',
            exposedAsToolSchema: selectedToolNames.has(toolName)
        });
    });

    providers.push(...listBuiltinNonExecutableCapabilityProviders());
    providers.push(...listDesignEvaluationProfileCapabilityProviders());
    (input.additionalCapabilityProviders || []).forEach((provider) => {
        const normalized = normalizeProviderIdentity(provider, true);
        if (normalized) providers.push(normalized);
    });

    const uniqueProviders = new Map<string, RuntimeCapabilityProviderIdentity>();
    providers.forEach((provider) => {
        const normalized = normalizeProviderIdentity(provider);
        if (!normalized) return;
        const key = `${normalized.kind}:${normalized.capabilityId}:${normalized.providerId}`;
        if (!uniqueProviders.has(key)) uniqueProviders.set(key, normalized);
    });
    return Array.from(uniqueProviders.values());
}

function resolveCapabilityReferences(input: {
    references: CapabilityReferenceSet;
    providers: readonly RuntimeCapabilityProviderIdentity[];
    manifestRef?: AgentCapabilityResolution['manifestRef'];
}): { resolution: CapabilityReferenceResolution; issues: AgentCapabilityResolutionIssue[] } {
    const requested = emptyReferenceSet();
    const resolved = emptyReferenceSet();
    const unavailable = emptyReferenceSet();
    const resolvedProviders = new Map<string, RuntimeCapabilityProviderIdentity>();
    const issues: AgentCapabilityResolutionIssue[] = [];
    const providersByCapabilityId = new Map<string, RuntimeCapabilityProviderIdentity[]>();

    input.providers.forEach((provider) => {
        const current = providersByCapabilityId.get(provider.capabilityId) || [];
        current.push(provider);
        providersByCapabilityId.set(provider.capabilityId, current);
    });

    CAPABILITY_REFERENCE_FIELDS.forEach(({ kind, key }) => {
        const refs = unique(input.references[key]);
        requested[key] = refs;
        refs.forEach((capabilityId) => {
            const candidates = providersByCapabilityId.get(capabilityId) || [];
            const exactProviders = candidates.filter((provider) => provider.kind === kind);
            const applicableProviders = exactProviders.filter((provider) => {
                const skillIds = provider.applicableSkillIds || [];
                const taskTypes = provider.applicableTaskTypes || [];
                if (!input.manifestRef) return skillIds.length === 0 && taskTypes.length === 0;
                const skillMatches = skillIds.length === 0 || skillIds.includes(input.manifestRef.skillId);
                const taskMatches = taskTypes.length === 0 || taskTypes.includes(input.manifestRef.taskType);
                return skillMatches && taskMatches;
            });
            if (applicableProviders.length > 0) {
                resolved[key].push(capabilityId);
                applicableProviders.forEach((provider) => {
                    resolvedProviders.set(
                        `${provider.kind}:${provider.capabilityId}:${provider.providerId}`,
                        provider
                    );
                });
                return;
            }

            unavailable[key].push(capabilityId);
            if (exactProviders.length > 0) {
                issues.push({
                    code: 'capability_reference_scope_mismatch',
                    capabilityId,
                    message: `能力引用 ${capabilityId} 存在 ${kind} provider，但不适用于当前 Skill / task type。`
                });
                return;
            }
            if (candidates.length > 0) {
                issues.push({
                    code: 'capability_reference_kind_mismatch',
                    capabilityId,
                    message: `能力引用 ${capabilityId} 声明为 ${kind}，但已注册 provider 属于 ${unique(candidates.map((provider) => provider.kind)).join(', ')}。`
                });
                return;
            }
            issues.push({
                code: 'capability_reference_unavailable',
                capabilityId,
                message: `能力引用 ${capabilityId} 当前没有可追溯 provider；保留现有执行，但不能声明该能力已装载。`
            });
        });
    });

    const byKind = Object.fromEntries(CAPABILITY_REFERENCE_FIELDS.map(({ kind, key }) => [
        kind,
        {
            requested: requested[key].length,
            resolved: resolved[key].length,
            unavailable: unavailable[key].length
        }
    ])) as CapabilityReferenceResolution['metrics']['byKind'];
    const requestedCount = Object.values(byKind).reduce((sum, metric) => sum + metric.requested, 0);
    const resolvedCount = Object.values(byKind).reduce((sum, metric) => sum + metric.resolved, 0);
    const unavailableCount = Object.values(byKind).reduce((sum, metric) => sum + metric.unavailable, 0);

    return {
        resolution: {
            version: 'runtime-capability-reference-resolution/v0',
            status: requestedCount === 0
                ? 'not_applicable'
                : (unavailableCount > 0 ? 'partial' : 'resolved'),
            requested,
            resolved,
            unavailable,
            providers: Array.from(resolvedProviders.values()),
            metrics: {
                requestedCount,
                resolvedCount,
                unavailableCount,
                byKind
            },
            boundaries: [
                '引用 resolved 只表示 provider 身份可追溯，不表示内容已读取、Skill 已执行、Policy 已触发或 Evaluation 已通过。',
                'Knowledge / Memory / Evaluation / Policy provider 不会因引用解析而新增 Tool schema。',
                '引用解析不授予权限、不执行 Tool、不调用模型、不生成 Workflow / DAG。'
            ]
        },
        issues
    };
}

function buildBoundaries(): string[] {
    return [
        'Capability Resolution 只控制模型可见 schema，不授予 Tool 执行权限。',
        '无可执行 continuation owner 的交互能力不进入 autonomous 模型 schema；叶子 Skill 与 Harness 内建 HITL 仍拥有各自卡片。',
        'manifest 初始能力是可扩展种子；能力所有权、显式 forbidden capability 与执行点 Policy 是硬边界。',
        '未分类 legacy Tool 以迁移标识保留可发现性，不伪装成已完成命名空间治理。',
        'Resolution 不生成 Workflow / DAG，不证明 Photoshop 写入或设计质量完成。'
    ];
}

export function buildRuntimeCapabilityInventory(
    input: BuildRuntimeCapabilityInventoryInput
): RuntimeCapabilityInventoryEntry[] {
    const executableToolNames = unique(input.executableToolNames);
    const executableSet = new Set(executableToolNames);
    const workflowBridgeSet = new Set(unique(input.workflowBridgeNames || []));
    const coveredToolNames = new Set<string>();
    const inventory: RuntimeCapabilityInventoryEntry[] = [];

    Object.entries(LEGACY_TOOL_CAPABILITY_MAP).forEach(([capabilityId, candidates]) => {
        const providerToolNames = unique(candidates.filter((name) => executableSet.has(name)));
        if (providerToolNames.length === 0) return;
        providerToolNames.forEach((name) => coveredToolNames.add(name));
        inventory.push({
            capabilityId,
            kind: 'tool',
            providerToolNames,
            source: 'legacy_tool_capability_bridge'
        });
    });

    workflowBridgeSet.forEach((toolName) => {
        if (!executableSet.has(toolName)) return;
        coveredToolNames.add(toolName);
        inventory.push({
            capabilityId: `skill.${toolName}`,
            kind: 'skill',
            providerToolNames: [toolName],
            source: 'legacy_workflow_bridge'
        });
    });

    executableToolNames.forEach((toolName) => {
        if (coveredToolNames.has(toolName)) return;
        const semantics = getPhotoshopToolSkillSemantics(toolName);
        if (semantics) {
            inventory.push({
                capabilityId: semantics.capabilityId,
                kind: 'tool',
                providerToolNames: [toolName],
                source: 'tool_semantics',
                semanticMetadata: {
                    capabilityKind: semantics.capabilityKind,
                    sideEffect: semantics.sideEffect,
                    requiresPhotoshopConnection: semantics.requiresPhotoshopConnection,
                    requiresOpenDocument: semantics.requiresOpenDocument,
                    requiresPriorDocumentRead: semantics.requiresPriorDocumentRead,
                    userIntentBoundary: semantics.userIntentBoundary,
                    verifyWith: [...semantics.verifyWith]
                }
            });
            return;
        }
        inventory.push({
            capabilityId: `legacy.tool.${toolName}`,
            kind: 'tool',
            providerToolNames: [toolName],
            source: 'legacy_unclassified_tool'
        });
    });

    return inventory;
}

export function resolveAgentCapabilities(
    input: ResolveAgentCapabilitiesInput
): AgentCapabilityResolution {
    const inventory = [...input.inventory];
    const byId = capabilityEntryMap(inventory);
    const manifestSkillBridgeIds = unique(
        (input.manifest?.legacy_skill_ids || []).map((skillId) => `skill.${skillId}`)
    ).filter((capabilityId) => byId.has(capabilityId));
    const deniedCapabilityIds = unique([
        ...(input.manifest?.forbidden_tools || []),
        ...AUTONOMOUS_AGENT_UNOWNED_CAPABILITY_IDS
    ]);
    const deniedSet = new Set(deniedCapabilityIds);
    // legacy bridge 允许多个 capability 指向同一个 executable Tool。若只过滤 capability id，
    // 被禁止能力会从另一条映射重新暴露；因此 provider Tool 闭包必须全局 deny-wins。
    const deniedToolNames = collectToolNames(deniedCapabilityIds, inventory);
    const deniedToolSet = new Set(deniedToolNames);
    const baselineCapabilityIds = unique(
        input.baselineCapabilityIds || HARNESS_BASELINE_CAPABILITY_IDS
    ).filter((capabilityId) => (
        // Manifest 已经提供结构化 task_type，R0 不需要再让模型调用影子声明工具。
        // 该工具只服务 broad discovery；继续暴露会产生无意义的重复分类，甚至与
        // Manifest task_type 漂移。移除 schema 不影响权限或执行能力。
        !input.manifest || capabilityId !== 'agent.intent.declareDesignTask'
    ));
    const manifestSeedIds = unique(input.manifest?.available_tools || []);
    // Broad discovery（无 manifest）下，user-facing Skill 桥接工具必须直接对模型可见：
    // 桥接 schema 的描述自带适用场景，是模型得知"有哪些技能、什么时候用"的唯一通道；
    // 藏到 on-demand 裸 id 后面等于技能不存在。manifest 路径不受影响，仍按 available_tools
    // 种子裁剪。执行权限仍由执行点 preflight / Policy 强制，可见性不等于授权。
    const broadDiscoverySkillBridgeIds = input.manifest
        ? []
        : inventory
            .filter((entry) => entry.kind === 'skill')
            .map((entry) => entry.capabilityId);
    const initialCapabilityIds = unique([
        ...baselineCapabilityIds,
        ...manifestSeedIds,
        ...manifestSkillBridgeIds,
        ...broadDiscoverySkillBridgeIds
    ]).filter((capabilityId) => !deniedSet.has(capabilityId));
    const issues: AgentCapabilityResolutionIssue[] = [];
    const selectedCapabilityIds: string[] = [];

    const requestedTaskType = cleanName(input.requestedTaskType);
    if (!input.manifest && requestedTaskType) {
        issues.push({
            code: 'structured_manifest_unresolved',
            capabilityId: requestedTaskType,
            message: `结构化任务类型 ${requestedTaskType} 当前没有注册 Skill manifest；保持 broad discovery，不猜测相似品类。`
        });
    }

    initialCapabilityIds.forEach((capabilityId) => {
        const entry = byId.get(capabilityId);
        if (!entry) {
            issues.push({
                code: 'initial_capability_unavailable',
                capabilityId,
                message: `初始能力 ${capabilityId} 当前没有可用 provider。`
            });
            return;
        }
        if (!hasAvailableProvider(entry, deniedToolSet)) {
            issues.push({
                code: 'initial_capability_unavailable',
                capabilityId,
                message: `初始能力 ${capabilityId} 的 legacy provider 已被 forbidden capability 硬禁止。`
            });
            return;
        }
        selectedCapabilityIds.push(capabilityId);
    });

    const selectedSet = new Set(selectedCapabilityIds);
    const onDemandCapabilityIds = inventory
        .filter((entry) => hasAvailableProvider(entry, deniedToolSet))
        .map((entry) => entry.capabilityId)
        .filter((capabilityId) => !selectedSet.has(capabilityId) && !deniedSet.has(capabilityId));
    const selectedToolNames = collectToolNames(selectedCapabilityIds, inventory, deniedToolSet);
    const candidateToolNames = unique(input.candidateToolNames);
    const manifestRef = input.manifest
        ? {
            skillId: input.manifest.skill_id,
            version: input.manifest.version,
            taskType: input.manifest.task_type
        }
        : undefined;
    const references = buildReferenceSet(input.manifest, selectedCapabilityIds, inventory);
    const capabilityReferenceResult = resolveCapabilityReferences({
        references,
        manifestRef,
        providers: buildCapabilityProviderCatalog({
            manifestRef,
            inventory,
            selectedCapabilityIds,
            selectedToolNames,
            additionalCapabilityProviders: input.additionalCapabilityProviders
        })
    });
    issues.push(...capabilityReferenceResult.issues);

    return {
        version: 'agent-capability-resolution/v0',
        status: input.manifest
            ? (issues.length > 0 ? 'partial' : 'resolved')
            : 'broad_discovery',
        selectionMode: input.manifest ? 'manifest_seeded' : 'broad_discovery',
        ...(manifestRef ? { manifestRef } : {}),
        selectedCapabilityIds,
        selectedToolNames,
        onDemandCapabilityIds,
        deniedCapabilityIds,
        deniedToolNames,
        unavailableCapabilityIds: unique(issues.map((issue) => issue.capabilityId)),
        issues,
        references,
        referenceResolution: capabilityReferenceResult.resolution,
        metrics: {
            inventoryCapabilityCount: inventory.length,
            candidateToolCount: candidateToolNames.length,
            selectedToolCount: selectedToolNames.length,
            schemaReductionApplied: selectedToolNames.length < candidateToolNames.length
        },
        boundaries: buildBoundaries()
    };
}

export function expandAgentCapabilities(
    input: ExpandAgentCapabilitiesInput
): AgentCapabilityActivationResult {
    const requestedCapabilityIds = unique(input.requestedCapabilityIds);
    if (requestedCapabilityIds.length > MAX_ON_DEMAND_CAPABILITY_REQUESTS) {
        const issue: AgentCapabilityResolutionIssue = {
            code: 'requested_capability_limit_exceeded',
            capabilityId: '*',
            message: `单轮最多按需装载 ${MAX_ON_DEMAND_CAPABILITY_REQUESTS} 项能力；请只请求当前下一步的最小充分集合。`
        };
        return {
            version: 'agent-capability-activation/v0',
            status: 'rejected',
            requestedCapabilityIds,
            activatedCapabilityIds: [],
            activatedToolNames: [],
            issues: [issue],
            resolution: input.resolution
        };
    }
    const inventory = [...input.inventory];
    const byId = capabilityEntryMap(inventory);
    const deniedSet = new Set(input.resolution.deniedCapabilityIds);
    const deniedToolSet = new Set(input.resolution.deniedToolNames);
    const selectedSet = new Set(input.resolution.selectedCapabilityIds);
    const issues: AgentCapabilityResolutionIssue[] = [];
    const activatedCapabilityIds: string[] = [];

    requestedCapabilityIds.forEach((capabilityId) => {
        if (deniedSet.has(capabilityId)) {
            issues.push({
                code: 'requested_capability_forbidden',
                capabilityId,
                message: `能力 ${capabilityId} 被当前 Runtime 的能力所有权或 Skill manifest 边界禁止。`
            });
            return;
        }
        const entry = byId.get(capabilityId);
        if (!entry) {
            issues.push({
                code: 'requested_capability_unknown',
                capabilityId,
                message: `能力 ${capabilityId} 不在当前运行时 inventory 中。`
            });
            return;
        }
        if (!hasAvailableProvider(entry, deniedToolSet)) {
            issues.push({
                code: 'requested_capability_forbidden',
                capabilityId,
                message: `能力 ${capabilityId} 的 legacy provider 已被 forbidden capability 硬禁止。`
            });
            return;
        }
        if (selectedSet.has(capabilityId)) {
            issues.push({
                code: 'requested_capability_already_active',
                capabilityId,
                message: `能力 ${capabilityId} 已经处于激活状态，请直接调用它提供的具体动作。`
            });
            return;
        }
        selectedSet.add(capabilityId);
        activatedCapabilityIds.push(capabilityId);
    });

    const selectedCapabilityIds = inventory
        .map((entry) => entry.capabilityId)
        .filter((capabilityId) => selectedSet.has(capabilityId));
    const selectedToolNames = collectToolNames(selectedCapabilityIds, inventory, deniedToolSet);
    const onDemandCapabilityIds = inventory
        .filter((entry) => hasAvailableProvider(entry, deniedToolSet))
        .map((entry) => entry.capabilityId)
        .filter((capabilityId) => !selectedSet.has(capabilityId) && !deniedSet.has(capabilityId));
    const activatedToolNames = collectToolNames(activatedCapabilityIds, inventory, deniedToolSet)
        .filter((toolName) => !input.resolution.selectedToolNames.includes(toolName));
    const selectedSkillCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'skill'
    ));
    const selectedToolCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'tool'
    ));
    const references: CapabilityReferenceSet = {
        ...input.resolution.references,
        skillRefs: unique([
            ...(input.resolution.manifestRef ? [input.resolution.manifestRef.skillId] : []),
            ...selectedSkillCapabilityIds
        ]),
        toolCapabilityIds: selectedToolCapabilityIds
    };
    const capabilityReferenceResult = resolveCapabilityReferences({
        references,
        manifestRef: input.resolution.manifestRef,
        providers: buildCapabilityProviderCatalog({
            manifestRef: input.resolution.manifestRef,
            inventory,
            selectedCapabilityIds,
            selectedToolNames,
            additionalCapabilityProviders: input.additionalCapabilityProviders
        })
    });
    const retainedIssues = input.resolution.issues.filter((issue) => ![
        'capability_reference_unavailable',
        'capability_reference_kind_mismatch',
        'capability_reference_scope_mismatch'
    ].includes(issue.code));
    const persistentRequestIssues = issues.filter((issue) => (
        issue.code !== 'requested_capability_already_active'
    ));
    const allIssues = [
        ...retainedIssues,
        ...persistentRequestIssues,
        ...capabilityReferenceResult.issues
    ];
    const resolution: AgentCapabilityResolution = {
        ...input.resolution,
        status: input.resolution.selectionMode === 'broad_discovery'
            ? 'broad_discovery'
            : (allIssues.length > 0 ? 'partial' : 'resolved'),
        selectedCapabilityIds,
        selectedToolNames,
        onDemandCapabilityIds,
        unavailableCapabilityIds: unique(allIssues.map((issue) => issue.capabilityId)),
        issues: allIssues,
        references,
        referenceResolution: capabilityReferenceResult.resolution,
        metrics: {
            ...input.resolution.metrics,
            selectedToolCount: selectedToolNames.length,
            schemaReductionApplied: selectedToolNames.length < input.resolution.metrics.candidateToolCount
        }
    };

    const status = activatedCapabilityIds.length > 0
        ? (issues.length > 0 ? 'partial' : 'activated')
        : 'rejected';

    return {
        version: 'agent-capability-activation/v0',
        status,
        requestedCapabilityIds,
        activatedCapabilityIds,
        activatedToolNames,
        issues,
        resolution
    };
}
