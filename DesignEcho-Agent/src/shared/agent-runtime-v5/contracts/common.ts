/**
 * v5 工作流契约 — 共用类型（按 GPT 定稿规范，2026-06-24）
 *
 * 核心原则（硬约束）：
 * 1. artifact 发布后不可原地修改；2. 修改必须生成新 artifactId；
 * 3. contentHash 基于规范化 payload 计算；4. Project State 只存 ArtifactRef + 少量 UI 摘要；
 * 5. Contract 中不允许出现具体模型供应商名称；6. R2–R5 Contract 中不允许出现 Photoshop tool_id；
 * 7. additionalProperties = false（schema 层强制）；8. JSON Schema Draft 2020-12。
 *
 * 这些是 TS 侧的单一事实来源；运行时校验以 schemas/v5/*.schema.json 为准。
 * 纯类型，无 Photoshop / 无 renderer 依赖。
 */

/** 能力状态（§13；禁止裸用 done/ready/complete） */
export type CapabilityStatus =
    | 'real'
    | 'mock'
    | 'fallback'
    | 'not_implemented'
    | 'blocked_external_dependency'
    | 'manual_verification_pending';

/** 工作流产物的唯一运行时生产者 */
export type ArtifactProducerUnit = 'R1' | 'R2' | 'R3' | 'R4' | 'E1' | 'R5' | 'E2' | 'ApprovalService';

/** 对某个已发布 artifact 的引用（Project State 只保存这个，不嵌完整产物） */
export interface ArtifactRef {
    artifactId: string;
    artifactType: string;
    contentHash: string;
}

/** 每个 Contract 产物都带的元信息 */
export interface ArtifactMeta {
    schemaVersion: '1.0.0';
    artifactId: string;
    artifactType: string;
    projectId: string;
    skillId: string;
    /**
     * 产出时所基于的来源上下文 revision。当前 Runtime 收尾桥使用 session generation；
     * 它不是 Artifact lineage.version，也不得据此推断 Project State 已同步到同一版本。
     */
    sourceRevision: number;
    /** 上游依赖的 artifact 引用 */
    sourceRefs: ArtifactRef[];
    createdAt: string;
    producer: {
        runtimeUnit: ArtifactProducerUnit;
        /** 模型 profile（如 reasoning.default）；不允许出现具体供应商名 */
        modelProfile?: string;
        capabilityStatus: CapabilityStatus;
    };
    /** 由 Repository 基于规范化 hashInput 计算的权威 SHA-256（sha256-jcs-v1:<64hex>） */
    contentHash: string;
}

/**
 * 发布前的草稿：meta 不含 contentHash。
 * 权威哈希由 Repository（主进程）计算，调用方/模型/渲染层不得自行声明（GPT 定稿重要修正）。
 */
export interface ArtifactDraft<TPayload = unknown> {
    meta: Omit<ArtifactMeta, 'contentHash'>;
    payload: TPayload;
}

/** 已发布产物：meta 含 Repository 计算的权威 contentHash。 */
export interface PublishedArtifact<TPayload = unknown> {
    meta: ArtifactMeta;
    payload: TPayload;
}

/** 上下文事实（产品事实、卖点、痛点等共用） */
export interface ContextFact {
    factId: string;
    statement: string;
    status: 'confirmed' | 'inferred' | 'unknown';
    /** 0..1 */
    confidence: number;
    sourceRefs: string[];
}

/** 素材上下文 */
export interface AssetContext {
    assetId: string;
    role: 'main_product' | 'detail' | 'scene' | 'material' | 'logo' | 'reference' | 'unknown';
    pathRef: string;
    qualityScore?: number;
    usable: boolean;
    recommendedUses: string[];
    warnings: string[];
}

/** 缺失输入 */
export interface MissingInput {
    inputId: string;
    field: string;
    question: string;
    severity: 'blocking' | 'degradable' | 'optional';
    defaultPolicy?: string;
}

/** 假设项 */
export interface Assumption {
    assumptionId: string;
    statement: string;
    confidence: number;
    requiresConfirmation: boolean;
}

/** 详情页模块类型（R3/R4 共用） */
export type DetailPageModuleType =
    | 'hero_kv'
    | 'pain_solution'
    | 'fabric'
    | 'details'
    | 'colors'
    | 'styling'
    | 'parameters'
    | 'brand_trust';

export type ModulePriority = 'required' | 'recommended' | 'optional';

/** 图片槽位计划（R4） */
export interface ImageSlotPlan {
    slotId: string;
    role: 'main_product' | 'detail' | 'background' | 'material' | 'scene' | 'feature_detail';
    assetId?: string;
    placement: {
        fit: 'contain' | 'cover';
        anchor: string;
        scale: number;
        rotation: number;
        focalPoint?: { x: number; y: number };
    };
    mask: 'none' | 'clipping' | 'shape';
}

/** 归一化矩形（全部 0..1；坐标只在 PreviewScene 才转像素） */
export interface NormalizedRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 版面区域角色（R4 归一化布局，GPT 定稿） */
export type LayoutRegionRole =
    | 'primary_visual'
    | 'secondary_visual'
    | 'headline'
    | 'supporting_copy'
    | 'tag_cluster'
    | 'feature_detail'
    | 'parameters'
    | 'brand'
    | 'decoration';

/** 归一化版面区域（0..1），坐标只在 PreviewScene 才转像素 */
export interface LayoutRegion {
    regionId: string;
    role: LayoutRegionRole;
    bounds: NormalizedRect;
    zIndex: number;
    alignment: {
        horizontal: 'start' | 'center' | 'end' | 'stretch';
        vertical: 'start' | 'center' | 'end' | 'stretch';
    };
    overflow: 'clip' | 'visible';
}

/**
 * 非图片辅助视觉元素计划（仅 ELEMENTS 组：图标/徽标/分割线/装饰等；不重复表示文字与图片）。
 * 通过 regionId 关联到所属 LayoutRegion；业务 Validator 校验该 regionId 必须存在。
 */
export interface ElementPlan {
    elementId: string;
    role: 'feature_icon' | 'badge' | 'divider' | 'callout' | 'background_shape' | 'decoration';
    elementType: 'shape' | 'icon' | 'line' | 'badge' | 'decoration';
    regionId: string;
    source?: {
        kind: 'icon' | 'asset' | 'token';
        refId: string;
    };
    styleTokenRefs: string[];
    transform?: {
        anchor: 'center' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
        /** -1..1，相对 region */
        offsetX: number;
        /** -1..1，相对 region */
        offsetY: number;
        /** >0 */
        scale: number;
        /** -180..180 */
        rotationDeg: number;
    };
    required: boolean;
}

/** Project State 只保存这些引用 id（不嵌完整产物） */
export interface WorkflowArtifactPointers {
    contextSnapshotId?: string;
    creativeStrategyId?: string;
    detailPagePlanId?: string;
    previewSceneId?: string;
    reviewReportId?: string;
    approvalRecordId?: string;
}

/** Project State 当前工作流产物引用 */
export interface CurrentWorkflowArtifacts {
    contextSnapshot?: ArtifactRef;
    creativeStrategy?: ArtifactRef;
    detailPagePlan?: ArtifactRef;
    previewScene?: ArtifactRef;
    reviewReport?: ArtifactRef;
    approvalRecord?: ArtifactRef;
}
