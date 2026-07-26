import {
    buildAgentPerformancePolicy,
    type AgentPerformancePolicy
} from './agent-performance-policy';
import type { RuntimeDesignWorkMode } from './agent-runtime-v5/contracts';
import { getSkillById } from './skills/skill-declarations';

export type AgentRequestLifecycleVersion = 'agent-request-lifecycle/v0';

export type AgentRequestRouteSource =
    | 'system'
    | 'intent_control_plane'
    | 'lightweight_intent'
    | 'deterministic_route'
    | 'local_route'
    | 'model_router';

export type AgentRequestRoute =
    | 'cancelled'
    | 'direct_response'
    | 'clarification_needed'
    | 'skill_execution'
    | 'autonomous_agent';

export type AgentRequestExecutionKind =
    | 'none'
    | 'deterministic_skill'
    | 'autonomous_agent';

export interface AgentRequestContextInput {
    isPluginConnected?: boolean;
    hasAttachedImage?: boolean;
    attachedImageData?: string;
    attachedImages?: unknown[];
    photoshopContext?: {
        hasDocument?: boolean;
        documentName?: string;
        activeLayerName?: string;
        layerCount?: number;
    };
    projectContext?: {
        projectPath?: string;
        projectImageCount?: number;
        visualSamplingCandidateCount?: number;
        selectedProjectImagePath?: string;
        contextSnapshot?: unknown;
        contextSnapshotSource?: string;
        contextSnapshotWarnings?: string[];
        contextSnapshotLimitations?: string[];
    };
}

export interface AgentRequestContextReadiness {
    photoshopConnected: boolean;
    hasDocument: boolean;
    documentName?: string;
    activeLayerName?: string;
    layerCount?: number;
    hasProject: boolean;
    projectPath?: string;
    projectImageCount?: number;
    selectedProjectImagePath?: string;
    hasContextSnapshot: boolean;
    contextSnapshotSource?: string;
    hasImageInput: boolean;
}

export interface AgentRequestDecision {
    source: AgentRequestRouteSource;
    route: AgentRequestRoute;
    skillId?: string;
    /** autonomous-agent 是执行器身份；该字段保留 R0 已选的业务 Skill 身份。 */
    selectedSkillId?: string;
    /** 只接受上游结构化声明，不从用户文本推断。 */
    taskType?: string;
    /** 只接受上游结构化声明，不从用户文本推断。 */
    workMode?: RuntimeDesignWorkMode;
    /** 仅在存在结构化 taskType / workMode 时保留对应业务参数。 */
    skillParams?: Record<string, unknown>;
    mode?: string;
    intentSummary?: string;
    reason: string;
}

export interface AgentRequestExecutionState {
    kind: AgentRequestExecutionKind;
    expectedExecutor?: string;
    requiresPhotoshop: boolean;
    canStart: boolean;
}

export type AgentRequestResourceDecisionPath =
    | 'no-tools'
    | 'metadata-only'
    | 'bounded-vision'
    | 'tool-execution'
    | 'blocked';

export interface AgentRequestResourceDecision {
    decisionVersion: 'agent-request-resource-decision/v0';
    path: AgentRequestResourceDecisionPath;
    reason: string;
    maxModelCalls: number;
    maxToolCalls: number;
    maxVisionCandidates: number;
    maxVisualAnalyses: number;
    softTimeBudgetMs: number;
    requiresContextSnapshot: boolean;
    hasContextSnapshot: boolean;
    observations: AgentRequestLifecycleObservationRef[];
}

export interface AgentRequestLifecycleObservationRef {
    source: string;
    summary: string;
}

export interface AgentRequestLifecycleRecord {
    version: AgentRequestLifecycleVersion;
    request: {
        rawText: string;
        normalizedText: string;
    };
    context: AgentRequestContextReadiness;
    decision: AgentRequestDecision;
    execution: AgentRequestExecutionState;
    performancePolicy: AgentPerformancePolicy;
    resourceDecision: AgentRequestResourceDecision;
    blockers: string[];
    warnings: string[];
    observations: AgentRequestLifecycleObservationRef[];
}

export interface BuildAgentRequestLifecycleInput {
    userInput: unknown;
    context?: AgentRequestContextInput;
    routeSource: AgentRequestRouteSource;
    route: AgentRequestRoute;
    skillId?: string;
    selectedSkillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
    mode?: string;
    skillParams?: Record<string, unknown>;
    intentSummary?: string;
    reason?: string;
    executionKind?: AgentRequestExecutionKind;
    blockers?: string[];
    warnings?: string[];
    observations?: AgentRequestLifecycleObservationRef[];
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function normalizeRuntimeDesignWorkMode(value: unknown): RuntimeDesignWorkMode | undefined {
    const candidate = normalizeText(value) as RuntimeDesignWorkMode;
    return [
        'create_new',
        'redesign',
        'template_fill',
        'edit_existing',
        'analyze_only',
        'export_only'
    ].includes(candidate) ? candidate : undefined;
}

interface AgentRequestStructuredDecisionIdentity {
    selectedSkillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
    skillParams?: Record<string, unknown>;
}

function resolveStructuredDecisionIdentity(
    input: BuildAgentRequestLifecycleInput
): AgentRequestStructuredDecisionIdentity {
    const wrapperParams = asRecord(input.skillParams);
    const nestedSkillParams = asRecord(wrapperParams?.skillParams);
    const businessSkillParams = nestedSkillParams || wrapperParams;
    const runtimeSelectedSkillHandoff = asRecord(wrapperParams?.runtimeSelectedSkillHandoff);
    const selectedSkillId = normalizeText(input.selectedSkillId)
        || normalizeText(wrapperParams?.declaredSkillId)
        || normalizeText(runtimeSelectedSkillHandoff?.skillId)
        || undefined;
    const taskType = normalizeText(input.taskType)
        || normalizeText(wrapperParams?.declaredTaskType)
        || normalizeText(businessSkillParams?.taskType)
        || undefined;
    const workMode = normalizeRuntimeDesignWorkMode(
        input.workMode
        || wrapperParams?.declaredWorkMode
        || businessSkillParams?.workMode
    );
    const hasStructuredPlanningParams = Boolean(taskType || workMode);

    return {
        ...(selectedSkillId ? { selectedSkillId } : {}),
        ...(taskType ? { taskType } : {}),
        ...(workMode ? { workMode } : {}),
        ...(hasStructuredPlanningParams && businessSkillParams
            ? { skillParams: { ...businessSkillParams } }
            : {})
    };
}

function hasImageInput(context?: AgentRequestContextInput): boolean {
    if (!context) return false;
    if (context.hasAttachedImage) return true;
    if (context.attachedImageData) return true;
    return Array.isArray(context.attachedImages) && context.attachedImages.length > 0;
}

function buildContextReadiness(context?: AgentRequestContextInput): AgentRequestContextReadiness {
    const photoshop = context?.photoshopContext;
    const project = context?.projectContext;

    return {
        photoshopConnected: context?.isPluginConnected === true,
        hasDocument: photoshop?.hasDocument === true,
        documentName: normalizeText(photoshop?.documentName) || undefined,
        activeLayerName: normalizeText(photoshop?.activeLayerName) || undefined,
        layerCount: Number.isFinite(Number(photoshop?.layerCount)) ? Number(photoshop?.layerCount) : undefined,
        hasProject: Boolean(project?.projectPath),
        projectPath: normalizeText(project?.projectPath) || undefined,
        projectImageCount: Number.isFinite(Number(project?.projectImageCount)) ? Number(project?.projectImageCount) : undefined,
        selectedProjectImagePath: normalizeText(project?.selectedProjectImagePath) || undefined,
        hasContextSnapshot: Boolean(project?.contextSnapshot),
        contextSnapshotSource: normalizeText(project?.contextSnapshotSource) || undefined,
        hasImageInput: hasImageInput(context)
    };
}

function pickObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function pickArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function countVisualSamplingCandidates(context?: AgentRequestContextInput): number {
    const project = pickObject(context?.projectContext);
    const explicitCount = Number(project.visualSamplingCandidateCount);
    if (Number.isFinite(explicitCount) && explicitCount >= 0) return explicitCount;

    const visualSamplingPlan = pickObject(project.visualSamplingPlan);
    const selectedCandidates = pickArray(visualSamplingPlan.selectedCandidates);
    if (selectedCandidates.length > 0) return selectedCandidates.length;

    const contextSnapshot = pickObject(project.contextSnapshot);
    const snapshotVisualSamplingPlan = pickObject(contextSnapshot.visualSamplingPlan);
    const snapshotSelectedCandidates = pickArray(snapshotVisualSamplingPlan.selectedCandidates);
    if (snapshotSelectedCandidates.length > 0) return snapshotSelectedCandidates.length;

    const assetIndex = pickObject(project.assetIndex || contextSnapshot.assetIndex);
    const visionCandidates = pickArray(assetIndex.visionCandidates);
    return visionCandidates.length;
}

function defaultExecutionKind(route: AgentRequestRoute): AgentRequestExecutionKind {
    if (route === 'skill_execution') return 'deterministic_skill';
    if (route === 'autonomous_agent') return 'autonomous_agent';
    return 'none';
}

function normalizeSourceType(value: unknown): string {
    return normalizeText(value).toLowerCase().replace(/-/g, '_');
}

function requiresPhotoshop(
    route: AgentRequestRoute,
    skillId?: string,
    skillParams?: Record<string, unknown>
): boolean {
    if (route === 'autonomous_agent') return true;
    if (route !== 'skill_execution') return false;

    const requirements = skillId ? getSkillById(skillId)?.runtimeRequirements : undefined;
    if (requirements?.photoshop === 'not_required') return false;
    if (requirements?.photoshop === 'source_dependent') {
        const sourceType = normalizeSourceType(skillParams?.sourceType);
        const photoshopFreeSourceTypes = new Set(
            (requirements.photoshopFreeSourceTypes || []).map(normalizeSourceType)
        );
        return !sourceType || !photoshopFreeSourceTypes.has(sourceType);
    }
    return true;
}

function canStartExecution(
    route: AgentRequestRoute,
    context: AgentRequestContextReadiness,
    skillId?: string,
    skillParams?: Record<string, unknown>
): boolean {
    if (!requiresPhotoshop(route, skillId, skillParams)) return true;
    if (!context.photoshopConnected) return false;
    if (skillId === 'document-management') return true;
    return context.hasDocument;
}

function collectWarnings(
    input: BuildAgentRequestLifecycleInput,
    context: AgentRequestContextReadiness
): string[] {
    const warnings = Array.isArray(input.warnings) ? input.warnings.filter(Boolean) : [];
    const projectWarnings = input.context?.projectContext?.contextSnapshotWarnings || [];
    const projectLimitations = input.context?.projectContext?.contextSnapshotLimitations || [];

    const requiresPs = requiresPhotoshop(input.route, input.skillId, input.skillParams);

    if (requiresPs && !context.photoshopConnected) {
        warnings.push('Photoshop 未连接，执行型请求可能无法开始。');
    }
    if (requiresPs && !context.hasDocument && input.skillId !== 'document-management') {
        warnings.push('当前没有打开文档，非文档创建/管理类任务需要先确认上下文。');
    }

    return [
        ...warnings,
        ...projectWarnings.filter(Boolean),
        ...projectLimitations.filter(Boolean)
    ];
}

function buildLifecyclePerformancePolicy(
    input: BuildAgentRequestLifecycleInput,
    context: AgentRequestContextReadiness,
    structuredDecision: AgentRequestStructuredDecisionIdentity
): AgentPerformancePolicy {
    return buildAgentPerformancePolicy({
        userText: normalizeText(input.userInput),
        skillId: structuredDecision.selectedSkillId || input.skillId,
        taskType: structuredDecision.taskType,
        workMode: structuredDecision.workMode,
        mode: input.mode,
        skillParams: structuredDecision.skillParams || input.skillParams,
        hasAttachedImage: context.hasImageInput,
        requiresPhotoshop: requiresPhotoshop(input.route, input.skillId, input.skillParams),
        projectImageCount: context.projectImageCount,
        visualSamplingCandidateCount: countVisualSamplingCandidates(input.context)
    });
}

function buildResourceDecision(input: {
    route: AgentRequestRoute;
    context: AgentRequestContextReadiness;
    execution: AgentRequestExecutionState;
    performancePolicy: AgentPerformancePolicy;
    blockers: string[];
}): AgentRequestResourceDecision {
    const policy = input.performancePolicy;
    const budget = policy.budget;
    let path: AgentRequestResourceDecisionPath = 'tool-execution';
    let reason = '根据请求路由和性能策略允许进入受控工具执行。';

    if (input.blockers.length > 0 || !input.execution.canStart) {
        path = 'blocked';
        reason = '执行前上下文或控制面阻断，不能进入工具执行。';
    } else if (policy.costProfile.imageProcessingClass === 'metadata-only'
        && budget.maxVisionCandidates === 0
        && budget.maxVisualAnalyses === 0) {
        path = 'metadata-only';
        reason = '性能策略判定只需要项目元数据或 Photoshop 轻量只读上下文，不允许视觉分析。';
    } else if (!input.execution.requiresPhotoshop || input.execution.kind === 'none') {
        path = 'no-tools';
        reason = '该请求不需要 Photoshop 工具执行。';
    } else if (policy.controls.allowVisionModel && budget.maxVisionCandidates > 0) {
        path = 'bounded-vision';
        reason = '性能策略允许有界视觉候选，禁止全量项目视觉分析和全分辨率读图。';
    }

    return {
        decisionVersion: 'agent-request-resource-decision/v0',
        path,
        reason,
        maxModelCalls: budget.maxModelCalls,
        maxToolCalls: budget.maxToolCalls,
        maxVisionCandidates: budget.maxVisionCandidates,
        maxVisualAnalyses: budget.maxVisualAnalyses,
        softTimeBudgetMs: budget.softTimeBudgetMs,
        requiresContextSnapshot: policy.controls.requireContextSnapshotBeforeExecution,
        hasContextSnapshot: input.context.hasContextSnapshot,
        observations: [{
            source: 'agent-performance-policy',
            summary: `taskClass=${policy.taskClass}; imageProcessing=${policy.costProfile.imageProcessingClass}; path=${path}`
        }]
    };
}

export function buildAgentRequestLifecycle(
    input: BuildAgentRequestLifecycleInput
): AgentRequestLifecycleRecord {
    const rawText = normalizeText(input.userInput);
    const context = buildContextReadiness(input.context);
    const structuredDecision = resolveStructuredDecisionIdentity(input);
    const executionKind = input.executionKind || defaultExecutionKind(input.route);
    const requiresPs = requiresPhotoshop(input.route, input.skillId, input.skillParams);
    const canStart = canStartExecution(input.route, context, input.skillId, input.skillParams);
    const blockers = Array.isArray(input.blockers) ? input.blockers.filter(Boolean) : [];

    if (requiresPs && !canStart) {
        blockers.push('执行前上下文不足，需要补齐 Photoshop 连接或当前文档状态。');
    }
    const execution: AgentRequestExecutionState = {
        kind: executionKind,
        expectedExecutor: normalizeText(input.skillId) || undefined,
        requiresPhotoshop: requiresPs,
        canStart
    };
    const performancePolicy = buildLifecyclePerformancePolicy(input, context, structuredDecision);
    const resourceDecision = buildResourceDecision({
        route: input.route,
        context,
        execution,
        performancePolicy,
        blockers
    });

    return {
        version: 'agent-request-lifecycle/v0',
        request: {
            rawText,
            normalizedText: rawText.toLowerCase()
        },
        context,
        decision: {
            source: input.routeSource,
            route: input.route,
            skillId: normalizeText(input.skillId) || undefined,
            ...structuredDecision,
            mode: normalizeText(input.mode) || undefined,
            intentSummary: normalizeText(input.intentSummary) || undefined,
            reason: normalizeText(input.reason) || '记录请求生命周期路由决策。'
        },
        execution,
        performancePolicy,
        resourceDecision,
        blockers,
        warnings: collectWarnings(input, context),
        observations: [
            ...(Array.isArray(input.observations) ? input.observations : []),
            {
                source: 'design-agent-engine',
                summary: 'DesignAgentEngine 记录请求生命周期状态，不改变业务执行行为。'
            }
        ]
    };
}

export function withAgentRequestLifecycle<T extends { data?: unknown }>(
    result: T,
    lifecycle: AgentRequestLifecycleRecord
): T {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        data: {
            ...currentData,
            agentRequestLifecycle: lifecycle
        }
    };
}
