/**
 * Capability Resolution 契约。
 *
 * Resolver 只描述“本轮向模型装载了什么、还能按需装载什么、缺什么”，
 * 不执行 Tool、不授予权限、不生成 Workflow / DAG，也不声明设计质量通过。
 */

export type CapabilityKind =
    | 'knowledge'
    | 'skill'
    | 'tool'
    | 'memory'
    | 'evaluation'
    | 'policy';

export type ExecutableCapabilityKind = Extract<CapabilityKind, 'skill' | 'tool'>;

export type RuntimeCapabilityProviderSource =
    | 'legacy_tool_capability_bridge'
    | 'legacy_workflow_bridge'
    | 'tool_semantics'
    | 'legacy_unclassified_tool';

export interface RuntimeCapabilitySemanticMetadata {
    capabilityKind: string;
    sideEffect: string;
    requiresPhotoshopConnection: boolean;
    requiresOpenDocument: boolean;
    requiresPriorDocumentRead: boolean;
    userIntentBoundary: string;
    verifyWith: string[];
}

export interface RuntimeCapabilityInventoryEntry {
    capabilityId: string;
    /** Action inventory 只承载可暴露 schema 的 Tool / legacy Skill bridge。 */
    kind: ExecutableCapabilityKind;
    providerToolNames: string[];
    source: RuntimeCapabilityProviderSource;
    semanticMetadata?: RuntimeCapabilitySemanticMetadata;
}

export interface CapabilityReferenceSet {
    knowledgeRefs: string[];
    skillRefs: string[];
    toolCapabilityIds: string[];
    memoryRefs: string[];
    evaluationRefs: string[];
    policyRefs: string[];
}

export type RuntimeCapabilityReferenceProviderSource =
    | 'runtime_tool_inventory'
    | 'skill_manifest'
    | 'knowledge_tool_semantics'
    | 'runtime_contract'
    | 'extension_provider';

export type RuntimeCapabilityProviderExposure =
    | 'model_tool_schema'
    | 'manifest_context'
    | 'runtime_context'
    | 'evaluation_gate'
    | 'execution_policy';

/**
 * Capability provider 的最小身份，不携带 provider 内容或执行入口。
 * exposedAsToolSchema 用于证明非执行能力没有被伪装成 Tool。
 */
export interface RuntimeCapabilityProviderIdentity {
    capabilityId: string;
    kind: CapabilityKind;
    providerId: string;
    source: RuntimeCapabilityReferenceProviderSource;
    exposure: RuntimeCapabilityProviderExposure;
    exposedAsToolSchema: boolean;
    /** 可选适用范围；为空表示跨 Skill 通用。 */
    applicableSkillIds?: string[];
    applicableTaskTypes?: string[];
}

export interface CapabilityKindReferenceMetrics {
    requested: number;
    resolved: number;
    unavailable: number;
}

export interface CapabilityReferenceResolution {
    version: 'runtime-capability-reference-resolution/v0';
    status: 'resolved' | 'partial' | 'not_applicable';
    requested: CapabilityReferenceSet;
    resolved: CapabilityReferenceSet;
    unavailable: CapabilityReferenceSet;
    providers: RuntimeCapabilityProviderIdentity[];
    metrics: {
        requestedCount: number;
        resolvedCount: number;
        unavailableCount: number;
        byKind: Record<CapabilityKind, CapabilityKindReferenceMetrics>;
    };
    boundaries: string[];
}

export type AgentCapabilityResolutionStatus =
    | 'resolved'
    | 'partial'
    | 'broad_discovery';

export type AgentCapabilityResolutionIssueCode =
    | 'structured_manifest_unresolved'
    | 'initial_capability_unavailable'
    | 'requested_capability_unknown'
    | 'requested_capability_forbidden'
    | 'requested_capability_already_active'
    | 'requested_capability_limit_exceeded'
    | 'capability_reference_unavailable'
    | 'capability_reference_kind_mismatch'
    | 'capability_reference_scope_mismatch';

export interface AgentCapabilityResolutionIssue {
    code: AgentCapabilityResolutionIssueCode;
    capabilityId: string;
    message: string;
}

export interface AgentCapabilityResolution {
    version: 'agent-capability-resolution/v0';
    status: AgentCapabilityResolutionStatus;
    selectionMode: 'manifest_seeded' | 'broad_discovery';
    manifestRef?: {
        skillId: string;
        version: string;
        taskType: string;
    };
    selectedCapabilityIds: string[];
    selectedToolNames: string[];
    onDemandCapabilityIds: string[];
    /** 被 manifest 或单一能力 owner 边界禁止在本会话暴露的 Capability。 */
    deniedCapabilityIds: string[];
    /** 被禁止 Capability 覆盖的 legacy provider Tool；共享映射也必须 deny-wins。 */
    deniedToolNames: string[];
    unavailableCapabilityIds: string[];
    issues: AgentCapabilityResolutionIssue[];
    references: CapabilityReferenceSet;
    referenceResolution: CapabilityReferenceResolution;
    metrics: {
        inventoryCapabilityCount: number;
        candidateToolCount: number;
        selectedToolCount: number;
        schemaReductionApplied: boolean;
    };
    boundaries: string[];
}

export interface AgentCapabilityActivationResult {
    version: 'agent-capability-activation/v0';
    status: 'activated' | 'partial' | 'rejected';
    requestedCapabilityIds: string[];
    activatedCapabilityIds: string[];
    activatedToolNames: string[];
    issues: AgentCapabilityResolutionIssue[];
    resolution: AgentCapabilityResolution;
}
