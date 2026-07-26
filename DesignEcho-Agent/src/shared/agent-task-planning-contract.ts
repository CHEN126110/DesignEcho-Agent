import type {
    AgentIntentControlPlaneDecision,
    AgentIntentRequestKind,
    AgentIntentToolScope
} from './agent-intent-control-plane';
import type {
    AgentRequestLifecycleRecord as AgentRequestLifecycleContext,
    AgentRequestRoute
} from './agent-request-lifecycle';
import {
    buildAgentUserVisibleState,
    type AgentUserVisibleState
} from './agent-user-visible-state';
import type {
    RuntimeDesignWorkMode,
    SkillRuntimeManifest
} from './agent-runtime-v5/contracts';
import {
    resolveSkillRuntimeEffectiveContract,
    resolveSkillRuntimeManifestSelection,
    type SkillRuntimeManifestSelection
} from './agent-runtime-v5/skill-runtime';
import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import { inferReferenceReplicationArtifactKind } from './reference-replication-output-intent';
import { getSkillById } from './skills/skill-declarations';

export type AgentTaskPlanningContractVersion = 'agent-task-planning-contract/v0';

export type AgentTaskPlanningContractStatus =
    | 'ready_direct_response'
    | 'blocked_needs_clarification'
    | 'ready_read_only_plan'
    | 'ready_for_tool_execution'
    | 'ready_for_controlled_execution_plan'
    | 'ready_for_model_planning';

export type AgentTaskPlanningStepPhase =
    | 'answer'
    | 'clarify'
    | 'inspect'
    | 'plan'
    | 'execute'
    | 'verify';

export interface AgentTaskPlanningContextInput {
    isPluginConnected?: boolean;
    photoshopContext?: {
        hasDocument?: boolean;
        documentName?: string;
        activeLayerName?: string;
        layerCount?: number;
    };
    projectContext?: {
        projectPath?: string;
        projectImageCount?: number;
    };
}

export interface AgentTaskPlanningBrief {
    scenario: DesignAgentOsScenario;
    workMode?: RuntimeDesignWorkMode;
    skillManifestRef?: string;
    methodManifestRefs?: string[];
    goal: string;
    deliverables: string[];
    constraints: string[];
    needsProjectAssets: boolean;
    needsVisualObservation: boolean;
    userVisibleSummary: string;
}

export interface AgentTaskPlanningStep {
    id: string;
    phase: AgentTaskPlanningStepPhase;
    action: string;
    allowedToolScope: AgentIntentToolScope;
    skillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
    requiresInputs: string[];
    producesOutputs: string[];
    reason: string;
}

export interface AgentTaskPlanningExecutionPlan {
    mode: 'none' | 'read_only' | 'tool_execution' | 'controlled_skill' | 'model_planning_required';
    canExecuteTools: boolean;
    requiresUserApproval: boolean;
    steps: AgentTaskPlanningStep[];
    verificationTargets: string[];
}

export interface BuildAgentTaskPlanningContractInput {
    userInput: unknown;
    intentControlPlane: AgentIntentControlPlaneDecision;
    lifecycle?: AgentRequestLifecycleContext;
    context?: AgentTaskPlanningContextInput;
    route?: AgentRequestRoute;
    skillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
    mode?: string;
    skillParams?: Record<string, unknown>;
    /**
     * 用户已选「生成并执行公开方案」模式（approveGeneratedPublicPlan）时由引擎置 true：
     * 强制把规划维持在 ready_for_model_planning 以生成 public-plan 并受控执行，
     * 而不是被创意设计的 ready_for_tool_execution 捷径带去直接进循环。
     */
    forcePublicPlanGeneration?: boolean;
}

export interface AgentTaskPlanningContract {
    version: AgentTaskPlanningContractVersion;
    status: AgentTaskPlanningContractStatus;
    requestKind: AgentIntentRequestKind;
    allowedToolScope: AgentIntentToolScope;
    route: AgentRequestRoute;
    skillId?: string;
    mode?: string;
    designBrief: AgentTaskPlanningBrief;
    userVisibleState: AgentUserVisibleState;
    executionPlan: AgentTaskPlanningExecutionPlan;
    requiredInputs: string[];
    blockers: string[];
    warnings: string[];
    boundaries: string[];
    planningContext: Array<{
        source: string;
        summary: string;
    }>;
    qualityClaim: {
        canClaimDesignComplete: false;
        canClaimOutputQuality: false;
    };
}

/**
 * 当前请求是否已经被既有 AgentTaskPlan 明确约束为“必须产生真实任务进展”。
 *
 * 这是完成判定的请求级真相源：不读取用户文本、不猜品类，也不创建第二套状态机。
 * 对话与仍需先规划的请求可以零 Tool 收尾；已经获准读取、执行工具或运行受控 Skill 的
 * 请求，至少要产生一个非 Harness 控制调用，才能进入完成判定。
 */
export function requiresAgentTaskProgress(
    plan?: AgentTaskPlanningContract
): boolean {
    if (!plan?.executionPlan.canExecuteTools) return false;
    return plan.executionPlan.mode === 'read_only'
        || plan.executionPlan.mode === 'tool_execution'
        || plan.executionPlan.mode === 'controlled_skill';
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(items: string[]): string[] {
    return Array.from(new Set(items.map(item => normalizeText(item)).filter(Boolean)));
}

function uniqueManifests(
    manifests: Array<SkillRuntimeManifest | undefined>
): SkillRuntimeManifest[] {
    const byId = new Map<string, SkillRuntimeManifest>();
    manifests.forEach((manifest) => {
        if (manifest) byId.set(manifest.skill_id, manifest);
    });
    return Array.from(byId.values());
}

function resolveRoute(input: BuildAgentTaskPlanningContractInput): AgentRequestRoute {
    return input.route || input.lifecycle?.decision?.route || (
        input.intentControlPlane.requestKind === 'clarify'
            ? 'clarification_needed'
            : input.intentControlPlane.shouldUseConversationalPath
                ? 'direct_response'
                : 'skill_execution'
    );
}

function resolveSkillId(input: BuildAgentTaskPlanningContractInput): string | undefined {
    return normalizeText(input.skillId) || normalizeText(input.lifecycle?.decision?.skillId) || undefined;
}

function resolvePlanningManifestSelection(
    input: BuildAgentTaskPlanningContractInput,
    skillId?: string
): SkillRuntimeManifestSelection {
    return resolveSkillRuntimeManifestSelection({
        taskType: normalizeText(input.taskType),
        skillId
    });
}

function resolvePlanningWorkMode(
    input: BuildAgentTaskPlanningContractInput
): RuntimeDesignWorkMode | undefined {
    const candidate = normalizeText(input.workMode || input.skillParams?.workMode) as RuntimeDesignWorkMode;
    return [
        'create_new',
        'redesign',
        'template_fill',
        'edit_existing',
        'analyze_only',
        'export_only'
    ].includes(candidate) ? candidate : undefined;
}

function projectManifestForPlanning(
    manifest: SkillRuntimeManifest | undefined,
    workMode?: RuntimeDesignWorkMode
): SkillRuntimeManifest | undefined {
    if (!manifest) return undefined;
    const contract = resolveSkillRuntimeEffectiveContract(manifest, workMode);
    return {
        ...manifest,
        required_inputs: [...contract.required_inputs],
        optional_inputs: [...contract.optional_inputs],
        delivery_outputs: [...contract.delivery_outputs],
        exit_criteria: [...contract.exit_criteria]
    };
}

function hasSkuSignal(text: string): boolean {
    return /sku|SKU|自选备注|组合图|双装|单双装/.test(text);
}

function hasDetailPageSignal(text: string): boolean {
    return /详情页|详情长图|长详情|长图/.test(text);
}

function hasExplicitDetailPageDocumentTarget(text: string): boolean {
    return /(详情页|详情长图|长详情|长图)\s*(文档|画布|草稿|设计稿|页面|模板)/.test(text)
        || /(创建|新建|制作|生成|设计|完成|做)\s*(一个|一张|一版|个|张)?[^。！？!?，,]{0,24}(详情页|详情长图|长详情|长图)/.test(text);
}

function hasMainImageSignal(text: string): boolean {
    return /主图|白底图|白底|点击图|转化图/.test(text);
}

function hasWhiteBackgroundSignal(text: string): boolean {
    return /白底图|白底/.test(text);
}

function isGeneralDesignArtifactRequest(text: string): boolean {
    const artifact = '(?:海报|宣传图|活动图|banner|横幅|店铺头图|活动横幅|封面|场景图|落地页|KV|视觉稿)';
    const directCreation = new RegExp(
        `(?:做成|改成|设计|制作|生成|创作|产出|交付|做|画)\\s*(?:一张|一个|一版|一幅|个|张|版)?\\s*${artifact}`,
        'i'
    );
    const strictReplication = new RegExp(
        `(?:复刻|临摹|还原|复现|仿照|照着)\\s*[^。！？!?，,]{0,16}${artifact}|${artifact}\\s*[^。！？!?，,]{0,12}(?:复刻|临摹|还原|复现)`,
        'i'
    );
    return directCreation.test(text) || strictReplication.test(text);
}

function usesReferenceMethod(input: { text: string; skillId?: string }): boolean {
    return input.skillId === 'layout-replication'
        || /参考|复刻|仿照|照着|还原|复现|同款|临摹/.test(input.text);
}

function isMainImageTask(input: { text: string; skillId?: string }): boolean {
    return input.skillId === 'main-image-design' || hasMainImageSignal(input.text);
}

function isDetailPageTask(input: { text: string; skillId?: string }): boolean {
    return input.skillId === 'detail-page-design'
        || hasExplicitDetailPageDocumentTarget(input.text)
        || (!hasSkuSignal(input.text) && hasDetailPageSignal(input.text));
}

function isSkuBatchTask(input: { text: string; skillId?: string }): boolean {
    return input.skillId === 'sku-batch'
        || (hasSkuSignal(input.text) && !isMainImageTask(input) && !isDetailPageTask(input));
}

function usesSkuAsMainImageSource(input: { text: string; skillId?: string }): boolean {
    return isMainImageTask(input) && /sku|SKU/.test(input.text);
}

function isWhiteBackgroundFromSkuMaterialTask(input: { text: string; skillId?: string }): boolean {
    return usesSkuAsMainImageSource(input) && hasWhiteBackgroundSignal(input.text);
}

function inferScenario(input: {
    text: string;
    skillId?: string;
    manifest?: SkillRuntimeManifest;
    methodManifests?: SkillRuntimeManifest[];
    requestKind: AgentIntentRequestKind;
}): DesignAgentOsScenario {
    const declaredScenario = input.manifest
        ? (input.manifest.legacy_skill_ids || [])
            .map((legacySkillId) => getSkillById(legacySkillId)?.visualSamplingScenario)
            .find(Boolean)
        : undefined;
    if (declaredScenario) return declaredScenario;
    // 对话路径交付的是内容而不是 Photoshop 产物。此时“详情页 / 主图”等词只说明
    // 文案的使用场景，不能抢走 copywriting 交付身份；明确画面写入仍走下方品类判断。
    if (input.requestKind === 'chat_only' && /文案|标题|卖点/.test(input.text)) {
        return 'copywriting';
    }
    const artifactKind = inferReferenceReplicationArtifactKind(input.text);
    if (artifactKind === 'main-image') return 'main-image';
    if (artifactKind === 'detail-page') return 'detail-page';
    if (isGeneralDesignArtifactRequest(input.text)) return 'general-design';
    if (hasMainImageSignal(input.text)) return 'main-image';
    if (isDetailPageTask(input)) return 'detail-page';
    if (hasSkuSignal(input.text)) return 'sku';
    if (hasDetailPageSignal(input.text)) return 'detail-page';
    if (input.skillId === 'layout-replication' || /参考图|复刻|照着|同款版式/.test(input.text)) return 'reference-replication';
    if (input.skillId === 'save-current-template' || /模板/.test(input.text)) return 'template';
    if (/文案|标题|卖点/.test(input.text)) return 'copywriting';
    if (input.skillId === 'project-image-analysis' || /项目|图片|素材/.test(input.text)) return 'general-design';
    return 'unknown';
}

function buildDeliverables(input: {
    text: string;
    skillId?: string;
    manifest?: SkillRuntimeManifest;
    methodManifests?: SkillRuntimeManifest[];
    route: AgentRequestRoute;
    requestKind: AgentIntentRequestKind;
    scenario: DesignAgentOsScenario;
}): string[] {
    if (input.requestKind === 'chat_only') {
        return input.scenario === 'copywriting' ? ['copy_candidates'] : ['user_answer'];
    }
    if (input.requestKind === 'plan_only') return ['user_answer'];
    if (input.requestKind === 'clarify') return ['clarification_question'];
    const withMethodOutputs = (outputs: string[]): string[] => unique([
        ...outputs,
        ...(input.methodManifests || []).flatMap((manifest) => manifest.delivery_outputs || [])
    ]);
    if (input.skillId === 'project-image-analysis') {
        if (/都有什么|都有些什么|有些什么|都有啥|有哪些|资源|素材|文件夹/.test(input.text)) {
            return ['project_inventory'];
        }
        return ['project_overview'];
    }
    if (input.manifest) {
        return withMethodOutputs(input.manifest.delivery_outputs || ['controlled_skill_result']);
    }
    if (input.scenario === 'main-image') {
        return withMethodOutputs([
            'main_image_design_plan',
            'main_image_exports',
            'main_image_psd',
            hasWhiteBackgroundSignal(input.text) ? 'white_background_main_image_export' : '',
            usesSkuAsMainImageSource(input) ? 'source_asset_from_sku_material' : ''
        ]);
    }
    if (input.scenario === 'sku') {
        return withMethodOutputs(['sku_color_combinations', 'sku_self_select_notes']);
    }
    if (input.scenario === 'detail-page') {
        return withMethodOutputs(['detail_page_design_plan', 'detail_page_exports']);
    }
    if (input.scenario === 'general-design' && isGeneralDesignArtifactRequest(input.text)) {
        return withMethodOutputs(['editable_design_document', 'preview', 'delivery_record']);
    }
    if (input.scenario === 'reference-replication') {
        return withMethodOutputs(['editable_design_document', 'preview', 'delivery_record']);
    }
    if (input.scenario === 'copywriting' && input.requestKind === 'autonomous_execution') {
        return withMethodOutputs(['updated_text_layer', 'change_verification_report']);
    }
    if (input.route === 'autonomous_agent') return withMethodOutputs(['model_generated_design_plan']);
    return withMethodOutputs(['controlled_skill_result']);
}

function buildConstraints(input: {
    text: string;
    skillId?: string;
    manifest?: SkillRuntimeManifest;
    methodManifests?: SkillRuntimeManifest[];
    requestKind: AgentIntentRequestKind;
}): string[] {
    const constraints = [
        '先规划任务目标、必要上下文和验收目标，再允许工具执行。',
        '工具执行成功不等于设计质量通过。',
        '不能输出或消费无依据的分数字段。'
    ];
    if (input.manifest) {
        constraints.push(
            `业务方法与交付边界由 Skill Manifest ${input.manifest.skill_id}@${input.manifest.version} 提供。`,
            ...(input.manifest.exit_criteria || []).map((item) => `退出条件：${item}`)
        );
    }
    (input.methodManifests || []).forEach((manifest) => {
        constraints.push(
            `实现方法由 Method Manifest ${manifest.skill_id}@${manifest.version} 叠加，不得覆盖交付物身份。`,
            ...(manifest.exit_criteria || []).map((item) => `方法验收：${item}`)
        );
    });
    if (!input.manifest && isSkuBatchTask(input)) {
        constraints.push(
            'SKU 素材优先来自当前项目中的 PSD/PSB 或项目素材索引，不默认使用用户已经打开但不属于项目的文档。',
            '默认 SKU 任务应同时考虑颜色组合和自选备注；用户明确排除时才取消备注。'
        );
    }
    if (!input.manifest && usesSkuAsMainImageSource(input)) {
        constraints.push(
            '这里的 SKU 表示主图白底图素材来源，不得自动转成 SKU 组合或自选备注任务。',
            '白底图优先从当前项目中的 SKU PSD/PSB 或项目素材索引读取源图，再按主图目录规范导出。'
        );
    }
    if (input.requestKind === 'read_only_inspect') {
        constraints.push('只读检查不得写入 Photoshop 文档。');
    }
    if (usesReferenceMethod(input)) {
        constraints.push('交付物类型由用户目标决定；参考或复刻只表示实现方法，不得把海报、横幅或主图改写成详情页模板。');
    }
    return constraints;
}

function buildManifestRequiredInputs(manifests: SkillRuntimeManifest[]): string[] {
    const needsVisualObservation = manifests.some((manifest) => (
        manifest.performance_profile?.vision_policy === 'bounded'
        || (manifest.required_model_profiles || []).some((profile) => profile.startsWith('vision.'))
    ));
    return unique([
        'skill_manifest',
        'context_snapshot',
        ...manifests.flatMap((manifest) => (
            (manifest.required_inputs || []).map((name) => `skill_input:${name}`)
        )),
        ...manifests.flatMap((manifest) => (
            (manifest.knowledge_refs || []).map((ref) => `knowledge_ref:${ref}`)
        )),
        ...manifests.flatMap((manifest) => (
            (manifest.memory_refs || []).map((ref) => `memory_ref:${ref}`)
        )),
        ...manifests.flatMap((manifest) => (
            (manifest.evaluation_refs || []).map((ref) => `evaluation_ref:${ref}`)
        )),
        needsVisualObservation ? 'visual_observation' : '',
        'verification_targets',
        'allowed_tool_scope'
    ]);
}

function buildRequiredInputs(input: {
    text: string;
    requestKind: AgentIntentRequestKind;
    route: AgentRequestRoute;
    skillId?: string;
    manifest?: SkillRuntimeManifest;
    methodManifests?: SkillRuntimeManifest[];
    scenario: DesignAgentOsScenario;
}): string[] {
    if (input.requestKind === 'chat_only' || input.requestKind === 'plan_only') {
        return ['conversation_context'];
    }
    if (input.requestKind === 'clarify') {
        return ['clear_target', 'clear_action', 'clear_deliverable'];
    }
    if (input.skillId === 'project-image-analysis') {
        return ['project_context', 'project_asset_index'];
    }
    const methodManifests = input.methodManifests || [];
    const withMethodInputs = (inputs: string[]): string[] => unique([
        ...inputs,
        ...(methodManifests.length > 0 ? buildManifestRequiredInputs(methodManifests) : [])
    ]);
    if (input.manifest) {
        return buildManifestRequiredInputs(uniqueManifests([
            input.manifest,
            ...methodManifests
        ]));
    }
    if (input.scenario === 'sku') {
        return withMethodInputs(['project_context', 'project_asset_index', 'project_sku_document', 'color_layer_observation', 'verification_targets']);
    }
    if (input.scenario === 'main-image') {
        const whiteBackgroundFromSkuMaterial = isWhiteBackgroundFromSkuMaterialTask(input);
        return withMethodInputs([
            'project_context',
            'project_asset_index',
            usesSkuAsMainImageSource(input) ? 'project_sku_document' : '',
            'design_brief',
            usesReferenceMethod(input) ? 'reference_visual_observation' : '',
            whiteBackgroundFromSkuMaterial ? '' : 'visual_observation',
            hasWhiteBackgroundSignal(input.text) ? 'white_background_export_target' : '',
            'verification_targets'
        ]);
    }
    if (input.scenario === 'detail-page') {
        return withMethodInputs([
            'project_context',
            'detail_template_context',
            'design_brief',
            usesReferenceMethod(input) ? 'reference_visual_observation' : '',
            'visual_observation',
            'verification_targets'
        ]);
    }
    if (input.scenario === 'general-design' && isGeneralDesignArtifactRequest(input.text)) {
        return withMethodInputs([
            'design_brief',
            'context_snapshot',
            usesReferenceMethod(input) ? 'reference_visual_observation' : '',
            'visual_observation',
            'editable_output_target',
            'verification_targets',
            'allowed_tool_scope'
        ]);
    }
    if (input.scenario === 'reference-replication') {
        return withMethodInputs([
            'design_brief',
            'reference_visual_observation',
            'editable_output_target',
            'verification_targets',
            'allowed_tool_scope'
        ]);
    }
    if (input.scenario === 'copywriting' && input.requestKind === 'autonomous_execution') {
        return withMethodInputs([
            'target_text_layer',
            'requested_copy_change',
            'verification_targets'
        ]);
    }
    if (input.route === 'autonomous_agent') {
        return withMethodInputs([
            'design_brief',
            'context_snapshot',
            isGeneralDesignArtifactRequest(input.text) ? 'visual_observation' : '',
            isGeneralDesignArtifactRequest(input.text) ? 'editable_output_target' : '',
            'verification_targets',
            'allowed_tool_scope'
        ]);
    }
    return withMethodInputs(['context_snapshot', 'verification_targets']);
}

function step(
    id: string,
    phase: AgentTaskPlanningStepPhase,
    action: string,
    allowedToolScope: AgentIntentToolScope,
    details: {
        skillId?: string;
        taskType?: string;
        workMode?: RuntimeDesignWorkMode;
        requiresInputs?: string[];
        producesOutputs?: string[];
        reason: string;
    }
): AgentTaskPlanningStep {
    return {
        id,
        phase,
        action,
        allowedToolScope,
        skillId: details.skillId,
        taskType: details.taskType,
        workMode: details.workMode,
        requiresInputs: unique(details.requiresInputs || []),
        producesOutputs: unique(details.producesOutputs || []),
        reason: details.reason
    };
}

function isDeterministicOperationSkill(skillId?: string): boolean {
    const normalizedSkillId = normalizeText(skillId);
    if (!normalizedSkillId || normalizedSkillId === 'autonomous-agent') return false;
    const skill = getSkillById(normalizedSkillId);
    return skill?.kind === 'operation' && skill.hasDecisionPoints === false;
}

function buildSteps(input: {
    status: AgentTaskPlanningContractStatus;
    requiresUserApproval: boolean;
    skillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
    requiredInputs: string[];
}): AgentTaskPlanningStep[] {
    if (input.status === 'ready_direct_response') {
        return [
            step('answer-user', 'answer', 'answerWithoutTools', 'none', {
                requiresInputs: ['conversation_context'],
                producesOutputs: ['assistant_response'],
                reason: '用户请求不需要 Photoshop 或项目工具，直接回答。'
            })
        ];
    }
    if (input.status === 'blocked_needs_clarification') {
        return [
            step('clarify-target', 'clarify', 'askClarifyingQuestion', 'none', {
                requiresInputs: ['clear_target', 'clear_action', 'clear_deliverable'],
                producesOutputs: ['clarification_question'],
                reason: '缺少目标、动作或交付物时不能默认调用工具。'
            })
        ];
    }
    if (input.status === 'ready_read_only_plan') {
        return [
            step('inspect-context', 'inspect', 'readContext', 'read_only', {
                skillId: input.skillId,
                taskType: input.taskType,
                workMode: input.workMode,
                requiresInputs: ['project_context'],
                producesOutputs: ['readonly_inspection_result'],
                reason: '只读取项目、文档或图层上下文，不写入 Photoshop。'
            }),
            step('summarize-readonly-result', 'verify', 'summarizeReadonlyResult', 'none', {
                requiresInputs: ['readonly_inspection_result'],
                producesOutputs: ['user_visible_summary'],
                reason: '把只读结果转成用户可读结论。'
            })
        ];
    }
    if (input.status === 'ready_for_model_planning') {
        return [
            step('collect-context', 'inspect', 'collectContextBeforePlanning', 'read_only', {
                requiresInputs: ['context_snapshot'],
                producesOutputs: ['planning_context'],
                reason: '开放式设计必须先读取当前上下文，不能直接碰工具。'
            }),
            step('build-model-plan', 'plan', 'requestModelDesignPlan', 'none', {
                requiresInputs: input.requiredInputs,
                producesOutputs: input.requiresUserApproval
                    ? ['design_task_plan', 'public_plan', 'verification_targets']
                    : ['design_task_plan', 'verification_targets'],
                reason: input.requiresUserApproval
                    ? '形成可审查方案、工具白名单和验收目标，批准前不执行写入。'
                    : 'Agent 在当前循环内形成执行路径和验收目标，不创建第二份公开计划。'
            })
        ];
    }
    if (input.status === 'ready_for_tool_execution') {
        const directOperationSkill = isDeterministicOperationSkill(input.skillId);
        return [
            step('inspect-tool-context', 'inspect', 'collectToolContext', 'read_only', {
                requiresInputs: input.requiredInputs,
                producesOutputs: ['tool_context'],
                reason: '明确工具任务先读取必要上下文，避免盲写。'
            }),
            step('execute-tool-sequence', 'execute', directOperationSkill ? 'executeDirectOperationSkill' : 'executeAutonomousToolCalls', 'write_photoshop', {
                skillId: input.skillId,
                taskType: input.taskType,
                workMode: input.workMode,
                requiresInputs: ['tool_context'],
                producesOutputs: ['execution_trace'],
                reason: directOperationSkill
                    ? '由确定性 operation skill 编排底层工具，不生成固定名称的对外设计方案。'
                    : '由 Agent 工具循环决定具体工具调用，不强制生成固定名称的对外设计方案。'
            }),
            step('verify-tool-result', 'verify', 'readBackToolResult', 'read_only', {
                requiresInputs: ['execution_trace'],
                producesOutputs: ['verification_report'],
                reason: '执行后必须读回文档、图层或导出结果。'
            })
        ];
    }
    return [
        step('inspect-required-context', 'inspect', 'collectRequiredContext', 'read_only', {
            requiresInputs: input.requiredInputs,
            producesOutputs: ['planning_context'],
            reason: '业务设计执行前先读取项目、素材、文档和设计约束上下文。'
        }),
        step('build-controlled-plan', 'plan', 'buildDesignBriefAndExecutionPlan', 'none', {
            requiresInputs: ['planning_context'],
            producesOutputs: ['design_brief', 'execution_plan', 'verification_targets'],
            reason: '把用户目标转成可审查的设计简报和执行计划。'
        }),
        step('execute-controlled-skill', 'execute', 'executeControlledSkill', 'write_photoshop', {
            skillId: input.skillId,
            taskType: input.taskType,
            workMode: input.workMode,
            requiresInputs: ['design_brief', 'execution_plan', 'verification_targets'],
            producesOutputs: ['execution_trace'],
            reason: '只有经过计划和门禁后，才允许调用受控业务 skill。'
        }),
        step('verify-result', 'verify', 'readBackAndVerifyResult', 'read_only', {
            requiresInputs: ['execution_trace'],
            producesOutputs: ['verification_report'],
            reason: '执行后必须读回文档、导出或任务结果。'
        })
    ];
}

function statusFor(input: {
    requestKind: AgentIntentRequestKind;
    route: AgentRequestRoute;
    skillId?: string;
    intentControlPlane: AgentIntentControlPlaneDecision;
    forcePublicPlanGeneration?: boolean;
}): AgentTaskPlanningContractStatus {
    if (input.requestKind === 'clarify' || input.route === 'clarification_needed') {
        return 'blocked_needs_clarification';
    }
    if (input.requestKind === 'chat_only' || input.requestKind === 'plan_only' || input.route === 'direct_response') {
        return 'ready_direct_response';
    }
    if (input.requestKind === 'read_only_inspect') {
        return 'ready_read_only_plan';
    }
    if (input.route === 'autonomous_agent' || input.skillId === 'autonomous-agent') {
        // 用户显式选「生成并执行公开方案」模式时，必须维持 ready_for_model_planning 以生成 public-plan
        // 并受控执行（不被创意设计的 ready_for_tool_execution 捷径带去直接进循环）。
        if (input.forcePublicPlanGeneration) {
            return 'ready_for_model_planning';
        }
        // 路由只看用户是否已经授权自主执行，不再依赖品类词或自决信号白名单决定 Agent 能否规划。
        // 已授权任务直接进入自主循环，由 Agent 根据上下文选择 Knowledge / Skill / Tool 和执行路径；
        // candidate_only 保持在模型规划门，避免把「帮我处理一下」之类弱意图静默升级为写入授权。
        if (input.intentControlPlane.executionAuthorization === 'confirmed_tool_required') {
            return 'ready_for_tool_execution';
        }
        return 'ready_for_model_planning';
    }
    if (input.route === 'skill_execution' && isDeterministicOperationSkill(input.skillId)) {
        return 'ready_for_tool_execution';
    }
    return 'ready_for_controlled_execution_plan';
}

function buildBlockers(
    status: AgentTaskPlanningContractStatus,
    manifestSelection: SkillRuntimeManifestSelection
): string[] {
    if (manifestSelection.status === 'conflict') return ['skill_manifest_identity_conflict'];
    if (manifestSelection.status === 'unresolved_task_type') return ['skill_manifest_task_type_unresolved'];
    if (status !== 'blocked_needs_clarification') return [];
    return ['missing_target', 'missing_action', 'missing_deliverable'];
}

function buildWarnings(input: {
    status: AgentTaskPlanningContractStatus;
    requestKind: AgentIntentRequestKind;
    requiresUserApproval: boolean;
    skillId?: string;
    manifest?: SkillRuntimeManifest;
    methodManifests?: SkillRuntimeManifest[];
    manifestSelection: SkillRuntimeManifestSelection;
}): string[] {
    const warnings: string[] = [];
    if (input.manifestSelection.status === 'conflict') {
        warnings.push('skillId 与 taskType 指向不同的产物型 Skill Manifest；已阻断工具执行，不能拼接场景、交付物和预算。');
    }
    if (input.manifestSelection.status === 'unresolved_task_type') {
        warnings.push(`结构化 taskType「${input.manifestSelection.unresolvedTaskType}」未注册；已阻断工具执行，不能回退到关键词或 skillId 猜测。`);
    }
    if (input.status === 'ready_for_model_planning') {
        warnings.push(input.requiresUserApproval
            ? '当前请求显式进入可审查方案流程；用户批准前不能执行写入。'
            : '当前请求需要模型先补齐目标与执行边界；这不等于等待用户批准，也不会自动授权写入。');
    }
    if (input.manifest) {
        warnings.push(`计划消费 ${input.manifest.skill_id} Manifest；它不替代真实输入、执行结果和验收读回。`);
    }
    (input.methodManifests || []).forEach((manifest) => {
        warnings.push(`计划叠加 ${manifest.skill_id} Method Manifest；它只补充方法上下文与验收，不改变交付物身份。`);
    });
    if (input.requestKind === 'read_only_inspect') {
        warnings.push('只读计划不能升级为 Photoshop 写入。');
    }
    return warnings;
}

export function buildAgentTaskPlanningContract(
    input: BuildAgentTaskPlanningContractInput
): AgentTaskPlanningContract {
    const text = normalizeText(input.userInput);
    const route = resolveRoute(input);
    const skillId = resolveSkillId(input);
    const manifestSelection = resolvePlanningManifestSelection(input, skillId);
    const workMode = resolvePlanningWorkMode(input);
    const identityBlocked = manifestSelection.status === 'conflict'
        || manifestSelection.status === 'unresolved_task_type';
    const manifest = manifestSelection.status === 'resolved'
        ? projectManifestForPlanning(manifestSelection.artifactManifest, workMode)
        : undefined;
    const methodManifests = manifestSelection.status === 'resolved'
        ? manifestSelection.methodManifests
            .map((methodManifest) => projectManifestForPlanning(methodManifest, workMode))
            .filter((methodManifest): methodManifest is SkillRuntimeManifest => Boolean(methodManifest))
        : [];
    const selectedManifests = uniqueManifests([manifest, ...methodManifests]);
    const requestKind = input.intentControlPlane.requestKind;
    const allowedToolScope = input.intentControlPlane.toolScope;
    const status = identityBlocked
        ? 'blocked_needs_clarification'
        : statusFor({
            requestKind,
            route,
            skillId,
            intentControlPlane: input.intentControlPlane,
            forcePublicPlanGeneration: input.forcePublicPlanGeneration
        });
    const requiresUserApproval = status === 'ready_for_model_planning'
        && input.forcePublicPlanGeneration === true;
    const scenario = inferScenario({
        text,
        skillId: identityBlocked ? undefined : skillId,
        manifest,
        requestKind
    });
    let needsVisualObservation: boolean;
    if (selectedManifests.length > 0) {
        needsVisualObservation = selectedManifests.some((selectedManifest) => (
            selectedManifest.performance_profile?.vision_policy === 'bounded'
            || (selectedManifest.required_model_profiles || []).some((profile) => profile.startsWith('vision.'))
        ));
    } else {
        needsVisualObservation = ['sku', 'detail-page', 'reference-replication'].includes(scenario)
            || (scenario === 'general-design' && isGeneralDesignArtifactRequest(text))
            || (scenario === 'main-image' && !isWhiteBackgroundFromSkuMaterialTask({ text, skillId }));
    }
    const deliverables = identityBlocked
        ? ['manifest_identity_resolution']
        : buildDeliverables({
            text,
            skillId,
            manifest,
            methodManifests,
            route,
            requestKind,
            scenario
        });
    const requiredInputs = identityBlocked
        ? ['consistent_skill_manifest_identity']
        : buildRequiredInputs({
            text,
            requestKind,
            route,
            skillId,
            manifest,
            methodManifests,
            scenario
        });
    const steps = buildSteps({
        status,
        requiresUserApproval,
        skillId,
        taskType: manifest?.task_type,
        workMode,
        requiredInputs
    });
    const manifestNeedsProjectAssets = selectedManifests.some((selectedManifest) => (
        selectedManifest.read_scopes.includes('assets')
        || selectedManifest.required_inputs.some((name) => /asset|source|product|sku|color_card/.test(name))
    ));
    const needsProjectAssets = manifest
        ? manifestNeedsProjectAssets
        : manifestNeedsProjectAssets
            || ['sku', 'main-image', 'detail-page'].includes(scenario)
            || skillId === 'project-image-analysis';

    return {
        version: 'agent-task-planning-contract/v0',
        status,
        requestKind,
        allowedToolScope,
        route,
        skillId,
        mode: normalizeText(input.mode || input.lifecycle?.decision?.mode) || undefined,
        designBrief: {
            scenario,
            workMode,
            skillManifestRef: manifest ? `${manifest.skill_id}@${manifest.version}` : undefined,
            methodManifestRefs: methodManifests.length > 0
                ? methodManifests.map((methodManifest) => `${methodManifest.skill_id}@${methodManifest.version}`)
                : undefined,
            goal: text || '未提供明确任务目标。',
            deliverables,
            constraints: buildConstraints({ text, skillId, manifest, methodManifests, requestKind }),
            needsProjectAssets,
            needsVisualObservation,
            userVisibleSummary: input.intentControlPlane.userVisibleSummary
        },
        userVisibleState: buildAgentUserVisibleState({
            route,
            planningStatus: status,
            requestKind
        }),
        executionPlan: {
            mode: status === 'ready_direct_response' || status === 'blocked_needs_clarification'
                ? 'none'
                : status === 'ready_read_only_plan'
                    ? 'read_only'
                    : status === 'ready_for_model_planning'
                        ? 'model_planning_required'
                        : status === 'ready_for_tool_execution'
                            ? 'tool_execution'
                            : 'controlled_skill',
            canExecuteTools: status === 'ready_read_only_plan'
                || status === 'ready_for_tool_execution'
                || status === 'ready_for_controlled_execution_plan',
            requiresUserApproval,
            steps,
            verificationTargets: unique([
                status === 'ready_direct_response' && scenario === 'copywriting'
                    ? 'copy_candidates_match_requested_emphasis'
                    : '',
                status === 'ready_direct_response' && scenario !== 'copywriting'
                    ? 'assistant_response_matches_user_question'
                    : '',
                status === 'ready_read_only_plan' ? 'readonly_summary_matches_project_or_document_observation' : '',
                status === 'ready_for_tool_execution' ? 'execution_trace_exists' : '',
                status === 'ready_for_tool_execution' ? 'readback_or_export_result_exists' : '',
                status === 'ready_for_tool_execution' && scenario === 'copywriting'
                    ? 'requested_change_applied'
                    : '',
                status === 'ready_for_tool_execution' && scenario === 'copywriting'
                    ? 'target_text_readback_exists'
                    : '',
                status === 'ready_for_controlled_execution_plan' ? 'execution_trace_exists' : '',
                status === 'ready_for_controlled_execution_plan' ? 'readback_or_export_result_exists' : '',
                status === 'ready_for_model_planning' && requiresUserApproval
                    ? 'public_plan_has_steps_and_verification_targets'
                    : '',
                status === 'ready_for_model_planning' && !requiresUserApproval
                    ? 'model_plan_has_steps_and_verification_targets'
                    : ''
            ])
        },
        requiredInputs,
        blockers: buildBlockers(status, manifestSelection),
        warnings: buildWarnings({
            status,
            requestKind,
            requiresUserApproval,
            skillId,
            manifest,
            methodManifests,
            manifestSelection
        }),
        boundaries: [
            'AgentTaskPlan 是请求级计划，不直接执行 Photoshop。',
            '没有 DesignBrief、ExecutionPlan 和 VerificationTarget 时，不能把模型输出直接当工具动作。',
            '该契约不声明设计质量通过，也不使用无依据评分。'
        ],
        planningContext: [
            {
                source: 'agent-intent-control-plane',
                summary: `requestKind=${requestKind}; toolScope=${allowedToolScope}`
            },
            {
                source: 'agent-request-lifecycle',
                summary: `route=${route}; skill=${skillId || 'none'}`
            },
            ...(manifest ? [{
                source: 'skill-runtime-manifest',
                summary: `skill=${manifest.skill_id}; version=${manifest.version}; deliverables=${deliverables.join(',')}`
            }] : []),
            ...methodManifests.map((methodManifest) => ({
                source: 'skill-runtime-method-manifest',
                summary: `skill=${methodManifest.skill_id}; version=${methodManifest.version}; role=method`
            }))
        ],
        qualityClaim: {
            canClaimDesignComplete: false,
            canClaimOutputQuality: false
        }
    };
}
