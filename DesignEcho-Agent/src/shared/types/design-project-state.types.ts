import type { DesignCriticIssueOwner } from './design-team.types';
import { DESIGN_PROJECT_STATE_CAPABILITY_ID } from '../agent-runtime-v5/capability-provider-identities';
import type { ArtifactRef } from '../agent-runtime-v5/contracts/common';

/**
 * Design Project State v0 契约
 *
 * 蓝图依据：docs/design-agent-blueprint-a0-a9.md 第 1 节（共享数据中心）。
 * 全体 Agent / 队友 / 技能共同读写的项目状态；所有字段可选，允许部分填充。
 *
 * 边界（与 OS 文档 5.1.1 一致）：
 * - State 是共享项目事实、规则与记忆，不是权限系统；写 Photoshop 授权仍由执行点约束负责
 * - 旧状态不能覆盖用户当前指令
 * - 不存 base64 等大体积内容（素材只存路径与分类摘要）
 */

export const DESIGN_PROJECT_STATE_SCHEMA_VERSION = DESIGN_PROJECT_STATE_CAPABILITY_ID;

export interface DesignProjectMaterialAsset {
    path: string;
    category?: 'products' | 'backgrounds' | 'elements' | 'references' | 'others';
    note?: string;
}

export type DesignProjectFactClaimType = 'product_fact' | 'selling_point';

export type DesignProjectFactSourceKind =
    | 'user_statement'
    | 'project_asset_observation'
    | 'product_document'
    | 'brand_guideline'
    | 'market_research'
    | 'agent_inference'
    | 'legacy_unattributed';

export type DesignProjectFactConfirmation =
    | 'unverified'
    | 'user_confirmed'
    | 'source_supported'
    | 'rejected';

export type DesignProjectFactStatus = 'active' | 'superseded';

export interface DesignProjectFactSource {
    kind: DesignProjectFactSourceKind;
    sourceRef?: string;
    supportRefs?: string[];
    observedAt?: string;
}

export interface DesignProjectFactRecord {
    version: 'design-project-fact/v0';
    factId: string;
    claimType: DesignProjectFactClaimType;
    statement: string;
    confirmation: DesignProjectFactConfirmation;
    status: DesignProjectFactStatus;
    sources: DesignProjectFactSource[];
    createdAt: string;
    updatedAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNote?: string;
    supersededByFactId?: string;
    /** 本地意外修改检测；不是密码学签名或远端身份认证。 */
    integrityFingerprint?: string;
}

export interface DesignProjectFactUpsertInput {
    factId?: string;
    claimType: DesignProjectFactClaimType;
    statement: string;
    source?: Partial<DesignProjectFactSource>;
    requestedConfirmation?: DesignProjectFactConfirmation;
}

export interface DesignProjectFactReviewInput {
    factId: string;
    decision: 'confirm' | 'reject' | 'needs_review' | 'supersede';
    note?: string;
    supersededByFactId?: string;
}

export type DesignProjectFactWriteAuthority = 'agent_proposal' | 'user_review' | 'trusted_system';

export type DesignProjectRuleKind =
    | 'visual_style'
    | 'color'
    | 'typography'
    | 'copy_tone'
    | 'asset_integrity'
    | 'forbidden_expression'
    | 'delivery'
    | 'workflow';

export type DesignProjectRuleEnforcement = 'guidance' | 'quality_gate' | 'approval_required';
export type DesignProjectRuleConfirmation = 'unverified' | 'user_confirmed' | 'source_supported' | 'rejected';
export type DesignProjectRuleStatus = 'active' | 'superseded' | 'revoked';
export type DesignProjectRuleSourceKind =
    | 'user_statement'
    | 'brand_guideline'
    | 'project_brief'
    | 'design_memory'
    | 'agent_inference'
    | 'legacy_brand_style';

export interface DesignProjectRuleApplicability {
    taskTypes?: string[];
    deliverables?: string[];
    channels?: string[];
}

export interface DesignProjectRuleSource {
    kind: DesignProjectRuleSourceKind;
    sourceRef?: string;
    supportRefs?: string[];
}

export interface DesignProjectRuleRecord {
    version: 'design-project-rule/v0';
    ruleId: string;
    ruleKind: DesignProjectRuleKind;
    statement: string;
    /** 同一适用范围内互斥规则的稳定槽位，如 primary_color；未提供时不自动推断冲突。 */
    constraintKey?: string;
    enforcement: DesignProjectRuleEnforcement;
    applicability: DesignProjectRuleApplicability;
    confirmation: DesignProjectRuleConfirmation;
    status: DesignProjectRuleStatus;
    sources: DesignProjectRuleSource[];
    createdAt: string;
    updatedAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNote?: string;
    supersededByRuleId?: string;
    /** 本地意外修改检测；不是密码学签名或远端身份认证。 */
    integrityFingerprint?: string;
}

export interface DesignProjectRuleUpsertInput {
    ruleId?: string;
    ruleKind: DesignProjectRuleKind;
    statement: string;
    constraintKey?: string;
    enforcement?: DesignProjectRuleEnforcement;
    applicability?: DesignProjectRuleApplicability;
    source?: Partial<DesignProjectRuleSource>;
    requestedConfirmation?: DesignProjectRuleConfirmation;
}

export interface DesignProjectRuleReviewInput {
    ruleId: string;
    decision: 'confirm' | 'reject' | 'needs_review' | 'supersede' | 'revoke';
    note?: string;
    supersededByRuleId?: string;
}

export type DesignProjectRuleWriteAuthority = 'agent_proposal' | 'user_review' | 'trusted_system';

export interface DesignProjectCopywritingItem {
    /** 文案槽位（如 点击图主文案 / 转化图1-痛点标题） */
    slot: string;
    text: string;
    /** 依据（来自哪个卖点/痛点，保证文案有据可依） */
    basis?: string;
}

export interface DesignProjectProductionTask {
    title: string;
    status?: 'pending' | 'in_progress' | 'done' | 'blocked';
    note?: string;
}

export interface DesignProjectReviewResult {
    verdict?: 'pass' | 'needs_fix' | 'unparseable';
    summary?: string;
    issues?: Array<{ owner?: DesignCriticIssueOwner; target: string; problem: string; suggestion?: string }>;
    reviewedAt?: string;
}

export interface DesignProjectVersionRecord {
    version: string;
    reason: string;
    timestamp: string;
    author?: string;
}

export interface DesignProjectLearning {
    note: string;
    timestamp: string;
    source?: string;
}

export interface DesignProjectState {
    schemaVersion: typeof DESIGN_PROJECT_STATE_SCHEMA_VERSION;

    // 标识
    projectId?: string;
    projectName?: string;
    taskType?: string;
    platform?: string;
    canvasSize?: { width?: number; height?: number; preset?: string };

    // 输入侧
    brandStyle?: string;
    targetUser?: string;
    productFacts?: string[];
    /** 带来源和确认等级的事实记录；旧 productFacts / sellingPoints 仅用于兼容。 */
    factRecords?: DesignProjectFactRecord[];
    /** 带来源、适用范围和强制等级的项目/品牌规则；旧 brandStyle 仅作为未确认参考。 */
    ruleRecords?: DesignProjectRuleRecord[];
    materialAssets?: DesignProjectMaterialAsset[];

    // 策略侧
    painPoints?: string[];
    competitorNotes?: string[];
    sellingPoints?: string[];
    copywriting?: DesignProjectCopywritingItem[];
    visualDirection?: string;

    // 执行侧
    layoutPlan?: string;
    productionTasks?: DesignProjectProductionTask[];
    reviewResult?: DesignProjectReviewResult;
    deliveryFiles?: string[];
    /** 仅由主进程 Artifact Repository 同步；不得由模型 patch.set 自报。 */
    artifactRefs?: ArtifactRef[];

    // 沉淀侧
    learnings?: DesignProjectLearning[];
    versionHistory?: DesignProjectVersionRecord[];

    // 元数据
    updatedAt?: string;
    updatedBy?: string;
}

/** updateDesignProjectState 工具的增量更新载荷 */
export interface DesignProjectStatePatch {
    /** 按字段整体替换的部分状态（数组字段为整体替换，追加用专用字段） */
    set?: Partial<Omit<DesignProjectState, 'schemaVersion' | 'updatedAt' | 'updatedBy' | 'learnings' | 'versionHistory' | 'factRecords' | 'ruleRecords' | 'artifactRefs'>>;
    /** 新增或补充事实候选；普通 Agent 写入一律保持 unverified。 */
    upsertFacts?: DesignProjectFactUpsertInput[];
    /** 人工或可信系统对事实候选作确认、驳回或显式取代。 */
    reviewFacts?: DesignProjectFactReviewInput[];
    /** 执行点签发的事实写入权限；不得暴露为模型可自由选择的字段。 */
    factWriteAuthority?: DesignProjectFactWriteAuthority;
    /** 新增或补充项目/品牌规则候选；普通 Agent 写入一律保持 unverified。 */
    upsertRules?: DesignProjectRuleUpsertInput[];
    /** 人工或可信系统对规则候选作确认、驳回、撤销或显式取代。 */
    reviewRules?: DesignProjectRuleReviewInput[];
    /** 执行点签发的规则写入权限；不得暴露为模型可自由选择的字段。 */
    ruleWriteAuthority?: DesignProjectRuleWriteAuthority;
    /** 追加一条复盘记录 */
    appendLearning?: string;
    /** 追加一条版本记录 */
    appendVersion?: { version?: string; reason: string };
    /** 本次更新者（角色/工具名），用于 updatedBy 与追加记录的 author/source */
    updatedBy?: string;
}
