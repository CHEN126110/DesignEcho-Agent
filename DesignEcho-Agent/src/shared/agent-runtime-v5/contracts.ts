/**
 * Agent Runtime v5 — 契约类型（镜像 schemas/*.json）
 *
 * 对应 docs/41_AGENT_RUNTIME_ARCHITECTURE.md（v5.2）。
 * 这些类型是 TS 侧的单一事实来源；运行时校验仍以 schemas/*.json 为准。
 * 纯类型 + 纯逻辑，无 Photoshop / 无 renderer 依赖，可被 smoke 直接加载。
 */

/** 运行时组件 id（推理单元 R0–R5 + 执行服务 E1–E2 + 系统服务） */
export type RuntimeComponentId =
    | 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
    | 'E1' | 'E2'
    | 'MR' | 'SR' | 'TR' | 'PS' | 'KS' | 'RR' | 'PR';

/** Project State 写入者 id（owner-patch 制） */
export type ProjectStateOwnerId = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'E1' | 'E2' | 'CAPABILITY_SERVICE';

/** Workflow 运行状态（workflow-run.schema） */
export type WorkflowStatus =
    | 'created'
    | 'running'
    | 'waiting_user'
    | 'revision_required'
    | 'blocked_external_dependency'
    | 'manual_verification_pending'
    | 'cancelled'
    | 'failed'
    | 'completed';

/** Workflow 阶段（workflow-run.schema / §10 状态机） */
export type WorkflowStage =
    | 'briefing'
    | 'context_analysis'
    | 'creative_strategy'
    | 'layout_planning'
    | 'preview_generation'
    | 'quality_review'
    | 'awaiting_user_selection'
    | 'sandbox_queued'
    | 'sandbox_executing'
    | 'sandbox_ready'
    | 'awaiting_apply_confirmation'
    | 'applied'
    | 'delivered'
    | 'archived';

export type StageHistoryStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked';

/** 能力状态（§13，禁止裸用 done/ready/complete） */
export type CapabilityStatus =
    | 'real'
    | 'mock'
    | 'fallback'
    | 'not_implemented'
    | 'blocked_external_dependency'
    | 'manual_verification_pending';

export interface WorkflowStageHistoryEntry {
    stage: string;
    status: StageHistoryStatus;
    entered_at: string;
    exited_at?: string;
    component_id?: string;
    artifact_refs?: string[];
}

export interface WorkflowRun {
    workflow_run_id: string;
    project_id: string;
    skill_id: string;
    status: WorkflowStatus;
    current_stage: WorkflowStage;
    stage_history: WorkflowStageHistoryEntry[];
    capability_status: Record<string, CapabilityStatus>;
    rollback_target?: string | null;
    created_at: string;
    updated_at: string;
}

/** Skill Manifest 的 runtime_stages 枚举 */
export type RuntimeStage = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'E1' | 'R5' | 'E2';

/** 由模型在 R1 Brief 中声明的通用设计工作模式；Harness 不从任务文本反推。 */
export type RuntimeDesignWorkMode =
    | 'create_new'
    | 'redesign'
    | 'template_fill'
    | 'edit_existing'
    | 'analyze_only'
    | 'export_only';

export type RuntimeReferenceRequirement = 'required' | 'reuse_or_optional' | 'not_required';
export type RuntimeReferenceSourceKind = 'user_reference' | 'brand_template' | 'project_case' | 'eagle' | 'web';

/** Skill-owned 参考策略。它只声明专业要求，不执行检索、不授予权限。 */
export interface SkillRuntimeReferencePolicy {
    version: 'skill-reference-policy/v0';
    work_mode_requirements: Record<RuntimeDesignWorkMode, RuntimeReferenceRequirement>;
    allowed_sources: RuntimeReferenceSourceKind[];
    max_search_rounds: number;
    unavailable_behavior: 'continue_degraded' | 'block';
}

/**
 * Skill 拥有的运行成本画像。通用 Agent 只消费这份声明并施加全局安全上限，
 * 不再按“详情页 / 主图 / SKU”等业务名称维护预算、视觉模型或验收分支。
 */
export interface SkillRuntimePerformanceProfile {
    version: 'skill-runtime-performance-profile/v0';
    budget: {
        max_model_calls: number;
        max_tool_calls: number;
        max_iterations: number;
        max_vision_candidates: number;
        max_visual_analyses: number;
        max_full_resolution_image_reads: number;
        soft_time_budget_ms: number;
    };
    verification_tier: 'none' | 'metadata' | 'bounds' | 'screenshot' | 'manual';
    cost_profile: {
        model_call_class: 'none' | 'text-light' | 'text-heavy' | 'vision-light' | 'vision-heavy';
        photoshop_tool_class: 'none' | 'read-only' | 'write-light' | 'write-heavy';
        image_processing_class: 'none' | 'metadata-only' | 'bounded-vision' | 'pixel-probe' | 'heavy-local';
        expected_latency: 'instant' | 'short' | 'medium' | 'long' | 'unknown';
        resource_risk: 'low' | 'medium' | 'high';
    };
    vision_policy: 'disabled' | 'bounded';
}

/**
 * 同一 Skill 在不同工作模式下的完整业务契约。字段采用“整组替换”语义，
 * 避免 edit_existing 继续继承 create_new 的输入、交付物或人工确认条件。
 */
export interface SkillRuntimeWorkModeContract {
    required_inputs: string[];
    optional_inputs: string[];
    delivery_outputs: string[];
    exit_criteria: string[];
    /** 可选的模式级评价标准；只改变评价 Profile，不改变 Skill / task identity。 */
    review_rubric_ref?: string;
    /** 可选的模式级资源画像；Agent 全局 ceiling 仍拥有最终上限。 */
    performance_profile?: SkillRuntimePerformanceProfile;
}

/**
 * R1 可识别的实际输入来源。Manifest 只声明某个 inputKey 可以由哪些来源满足；
 * 来源是否真的存在由 Harness 在当前运行中解析，模型不能自行补造。
 */
export type SkillRuntimeInputSourceKind =
    | 'user_goal'
    | 'structured_input'
    | 'attached_image'
    | 'project_asset'
    | 'selected_project_asset'
    | 'project_product'
    | 'project_sku'
    | 'project_template'
    | 'project_context'
    | 'photoshop_document'
    | 'photoshop_target';

export type SkillRuntimeInputSourceMap = Record<string, SkillRuntimeInputSourceKind[]>;

/** Skill Runtime Manifest（skill-runtime-manifest.schema） */
export interface SkillRuntimeManifest {
    skill_id: string;
    version: string;
    task_type: string;
    display_name?: string;
    /** artifact-owner 决定交付物身份；method 只描述实现方法，不得覆盖用户目标产物。 */
    planning_role?: 'artifact-owner' | 'method';
    /** 迁移期旧 Skill id；alias 归 manifest 所有，Resolver 不维护第二张映射表。 */
    legacy_skill_ids?: string[];
    required_inputs: string[];
    optional_inputs?: string[];
    /** inputKey → 允许的实际来源类型；R1 不接受未在此声明的通用上下文引用。 */
    input_sources: SkillRuntimeInputSourceMap;
    /** 参考决策属于 Skill Policy；未声明时通用 Runtime 不额外设置参考门禁。 */
    reference_policy?: SkillRuntimeReferencePolicy;
    /** 专业工作流的成本、视觉和最低验收画像；所有权属于 Skill。 */
    performance_profile?: SkillRuntimePerformanceProfile;
    /** R1 声明 workMode 后替换顶层默认契约；未声明模式时只使用顶层中性契约。 */
    work_mode_contracts?: Partial<Record<RuntimeDesignWorkMode, SkillRuntimeWorkModeContract>>;
    runtime_stages: RuntimeStage[];
    required_model_profiles?: string[];
    optional_model_profiles?: string[];
    read_scopes: string[];
    write_scopes: string[];
    tool_namespaces?: string[];
    /** 首轮 Tool capability 种子，不是能力上限；Planner 可从 inventory 按需追加。 */
    available_tools: string[];
    /** 硬禁止 capability；优先级高于 manifest 种子和 Planner 按需请求。 */
    forbidden_tools: string[];
    /** 六类 Capability 的声明式引用；Resolver 只装配引用，不伪造内容已加载。 */
    knowledge_refs?: string[];
    /** 主方法论 Tool 引用；必须同时存在于 knowledge_refs。 */
    primary_method_tool_ref?: `tool:${string}`;
    memory_refs?: string[];
    evaluation_refs?: string[];
    policy_refs?: string[];
    template_families?: string[];
    review_rubric_ref?: string;
    delivery_outputs?: string[];
    exit_criteria: string[];
}

/** Project State Patch 操作（project-state-patch.schema，JSON-Patch 子集） */
export interface ProjectStatePatchOperation {
    op: 'add' | 'replace' | 'remove' | 'test';
    path: string;
    value?: unknown;
    expected_owner_scope?: string;
}

export interface ProjectStatePatch {
    patch_id: string;
    project_id: string;
    workflow_run_id: string;
    owner_id: ProjectStateOwnerId;
    base_revision: number;
    operations: ProjectStatePatchOperation[];
    reason: string;
    source_refs?: string[];
    created_at: string;
}

/**
 * Project State 顶层区域（§6.1 状态所有权）。
 * 这里只声明 phase-1 需要的区域形状；其余区域用 unknown 占位，按 owner 表逐步充实。
 */
export interface ProjectStateBrief {
    task_type?: string;
    product?: string;
    asset_source?: string;
    platform_size?: string;
    confirmed_facts?: string[];
    assumptions?: string[];
    missing_inputs?: string[];
    confidence?: number;
}

export interface ProjectStateWorkflow {
    workflow_run_id?: string;
    skill_id?: string;
    status?: WorkflowStatus;
    current_stage?: WorkflowStage;
    missing_inputs?: string[];
    assumptions?: string[];
}

export interface ProjectState {
    project_id: string;
    project_name?: string;
    state_revision: number;
    workflow?: ProjectStateWorkflow;
    brief?: ProjectStateBrief;
    product_analysis?: unknown;
    assets?: unknown;
    user_insights?: unknown;
    market_insights?: unknown;
    selling_points?: unknown;
    copywriting?: unknown;
    visual_direction?: unknown;
    references?: unknown;
    reference_transfer_plan?: unknown;
    layout_plan?: unknown;
    image_placement_plan?: unknown;
    template_selection?: unknown;
    detail_page_screen_plan?: unknown;
    preview_versions?: unknown;
    storyboard?: unknown;
    execution_tasks?: unknown;
    photoshop?: unknown;
    review?: unknown;
    quality_gate?: unknown;
    delivery?: unknown;
    learnings?: unknown;
    skill_candidates?: unknown;
    capabilities?: unknown;
}
