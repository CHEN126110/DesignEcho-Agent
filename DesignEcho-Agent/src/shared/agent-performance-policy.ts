import type {
    DesignAgentOsAction,
    DesignAgentOsScenario,
    DesignIntentContext
} from './design-agent-os-contracts';
import {
    normalizeRuntimeDesignWorkMode,
    resolveSkillRuntimeManifestSelection,
    type SkillRuntimeManifestSelection
} from './agent-runtime-v5/skill-runtime';
import type {
    SkillRuntimePerformanceProfile
} from './agent-runtime-v5/contracts';
import type { DesignTeammateRole } from './types/design-team.types';

export type AgentTaskClass =
    | 'chat'
    | 'simple-operation'
    | 'document-management'
    | 'layer-management'
    | 'text-editing'
    | 'copywriting'
    | 'project-inventory'
    | 'project-analysis'
    | 'skill-workflow'
    | 'unknown';

export type AgentVerificationTier =
    | 'none'
    | 'metadata'
    | 'bounds'
    | 'screenshot'
    | 'manual';

export type AgentLatencyClass = 'instant' | 'short' | 'medium' | 'long' | 'unknown';
export type AgentResourceRisk = 'low' | 'medium' | 'high';
export interface AgentPerformanceBudget {
    maxModelCalls: number;
    maxToolCalls: number;
    maxIterations: number;
    maxVisionCandidates: number;
    maxVisualAnalyses: number;
    maxFullResolutionImageReads: number;
    softTimeBudgetMs: number;
}

/** Agent 核心只拥有跨 Skill 的资源安全上限，不拥有任何业务品类预算。 */
export const AGENT_GLOBAL_SKILL_BUDGET_LIMITS: Readonly<AgentPerformanceBudget> = Object.freeze({
    // 模型调用是 ReAct 循环里每一轮的驱动（每轮≈1 次模型调用）。此前上限 12 远低于
    // max_iterations(100) 与各技能 soft_time_budget(≥240s)，导致 model_calls 永远先触顶，
    // 完整 v5 纪律流程（R0→E2 八阶段 + 声明 + 执行 + 复核）还没到执行就被这个人为低顶饿死。
    // 抬到 30，让「时间预算」或「真实完成」成为约束，而不是一个过低的模型调用数。
    maxModelCalls: 30,
    maxToolCalls: 200,
    maxIterations: 100,
    maxVisionCandidates: 12,
    maxVisualAnalyses: 4,
    maxFullResolutionImageReads: 0,
    softTimeBudgetMs: 600_000
});

export interface AgentCostProfile {
    modelCallClass: 'none' | 'text-light' | 'text-heavy' | 'vision-light' | 'vision-heavy';
    photoshopToolClass: 'none' | 'read-only' | 'write-light' | 'write-heavy';
    imageProcessingClass: 'none' | 'metadata-only' | 'bounded-vision' | 'pixel-probe' | 'heavy-local';
    expectedLatency: AgentLatencyClass;
    resourceRisk: AgentResourceRisk;
}

export interface AgentRuntimeBudget {
    budgetVersion: 'agent-runtime-budget/v0';
    maxIterations: number;
    source: 'explicit-user-parameter' | 'legacy-autonomous-agent-default' | 'stage-autonomous-agent-default';
    limitations: string[];
}

export interface AgentDesignTeamRuntimeBudget {
    budgetVersion: 'agent-design-team-runtime-budget/v0';
    role: DesignTeammateRole;
    maxIterations: number;
    source: 'explicit-user-parameter' | 'teammate-role-default';
    limitations: string[];
}

export interface AgentProviderTokenBudget {
    budgetVersion: 'agent-provider-token-budget/v0';
    maxTokens: number;
    source: 'explicit-user-parameter' | 'legacy-provider-default';
    limitations: string[];
}

export interface AgentContextWindowBudget {
    budgetVersion: 'agent-context-window-budget/v0';
    maxTokens: number;
    keepRecentRounds: number;
    source: 'explicit-user-parameter' | 'legacy-context-manager-default';
    limitations: string[];
}

export interface AgentResourceCacheBudget {
    budgetVersion: 'agent-resource-cache-budget/v0';
    resourceScanCacheTtlMs: number;
    psdPreviewCacheTtlMs: number;
    source: 'agent-performance-policy';
    limitations: string[];
}

export interface AgentAcceptanceCaptureBudget {
    budgetVersion: 'agent-acceptance-capture-budget/v0';
    mode: 'light' | 'standard' | 'bulk' | 'deep';
    maxLayers: number;
    timeoutMs: number;
    maxChangedLayers: number;
    source: 'agent-performance-policy';
    limitations: string[];
}

export interface AgentPerformancePolicy {
    policyVersion: 'agent-performance-policy/v0';
    taskClass: AgentTaskClass;
    scenario: DesignAgentOsScenario;
    action: DesignAgentOsAction;
    budget: AgentPerformanceBudget;
    verificationTier: AgentVerificationTier;
    costProfile: AgentCostProfile;
    profileSource: {
        owner: 'agent-core' | 'skill-manifest';
        ref: string;
    };
    controls: {
        allowProviderStreaming: boolean;
        allowVisionModel: boolean;
        allowBulkProjectScan: boolean;
        allowFullResolutionImageRead: boolean;
        preferMetadataOnly: boolean;
        preferToolBatching: boolean;
        requireContextSnapshotBeforeExecution: boolean;
    };
    warnings: string[];
    limitations: string[];
}

export interface BuildAutonomousAgentRuntimeBudgetInput {
    requestedMaxIterations?: unknown;
    defaultMaxIterations?: unknown;
    defaultSource?: 'legacy-autonomous-agent-default' | 'stage-autonomous-agent-default';
}

export interface BuildDesignTeamRuntimeBudgetInput {
    role: DesignTeammateRole;
    requestedMaxIterations?: unknown;
}

export interface BuildAgentProviderTokenBudgetInput {
    requestedMaxTokens?: unknown;
    legacyDefaultMaxTokens?: unknown;
}

export interface BuildAgentContextWindowBudgetInput {
    requestedMaxTokens?: unknown;
    requestedKeepRecentRounds?: unknown;
}

export interface BuildAgentResourceCacheBudgetInput {
    requestedResourceScanCacheTtlMs?: unknown;
    requestedPsdPreviewCacheTtlMs?: unknown;
}

export interface BuildAgentAcceptanceCaptureBudgetInput {
    deep?: boolean;
    bulk?: boolean;
    /** 轻量结构写（排序/改名/编组/剪切关系）：层级+bounds 足以验证，砍层数与超时（deep/bulk 优先于它） */
    light?: boolean;
    maxChangedLayers?: unknown;
}

export interface BuildAgentPerformancePolicyInput {
    userText?: string;
    scenario?: DesignAgentOsScenario;
    action?: DesignAgentOsAction;
    skillId?: string;
    taskType?: string;
    workMode?: string;
    mode?: string;
    skillParams?: Record<string, unknown>;
    hasAttachedImage?: boolean;
    requiresPhotoshop?: boolean;
    projectImageCount?: number;
    visualSamplingCandidateCount?: number;
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeSkillParam(input: BuildAgentPerformancePolicyInput, key: string): string {
    return normalizeText(input.skillParams?.[key]);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function resolveRuntimeIterationLimit(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function defaultDesignTeamIterationLimit(role: DesignTeammateRole): number {
    switch (role) {
        case 'executor':
            return 12;
        case 'scene-analyst':
        case 'design-strategist':
        case 'critic':
            return 8;
        default:
            return 8;
    }
}

function resolveProviderMaxTokens(value: unknown, fallback: unknown = 4096): number {
    const fallbackNumeric = Number(fallback);
    const defaultValue = Number.isFinite(fallbackNumeric) && fallbackNumeric > 0
        ? fallbackNumeric
        : 4096;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric === 0) return defaultValue;
    return numeric;
}

function resolvePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function resolveAcceptanceChangedLayerLimit(value: unknown): number {
    return Math.max(1, Number(value ?? 50));
}

interface ResolvedSkillPerformanceProfile {
    manifests: SkillRuntimeManifestSelection['manifests'];
    profile: SkillRuntimePerformanceProfile;
    sourceRef: string;
}

function highestRankedValue<T extends string>(
    values: readonly T[],
    ranking: readonly T[]
): T {
    return values.reduce((highest, current) => (
        ranking.indexOf(current) > ranking.indexOf(highest) ? current : highest
    ));
}

function combineSkillPerformanceProfiles(
    profiles: readonly SkillRuntimePerformanceProfile[]
): SkillRuntimePerformanceProfile {
    const maxBudget = (key: keyof SkillRuntimePerformanceProfile['budget']): number => (
        Math.max(...profiles.map((profile) => profile.budget[key]))
    );
    return {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: maxBudget('max_model_calls'),
            max_tool_calls: maxBudget('max_tool_calls'),
            max_iterations: maxBudget('max_iterations'),
            max_vision_candidates: maxBudget('max_vision_candidates'),
            max_visual_analyses: maxBudget('max_visual_analyses'),
            max_full_resolution_image_reads: maxBudget('max_full_resolution_image_reads'),
            soft_time_budget_ms: maxBudget('soft_time_budget_ms')
        },
        verification_tier: highestRankedValue(
            profiles.map((profile) => profile.verification_tier),
            ['none', 'metadata', 'bounds', 'screenshot', 'manual']
        ),
        cost_profile: {
            model_call_class: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.model_call_class),
                ['none', 'text-light', 'text-heavy', 'vision-light', 'vision-heavy']
            ),
            photoshop_tool_class: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.photoshop_tool_class),
                ['none', 'read-only', 'write-light', 'write-heavy']
            ),
            image_processing_class: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.image_processing_class),
                ['none', 'metadata-only', 'bounded-vision', 'pixel-probe', 'heavy-local']
            ),
            expected_latency: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.expected_latency),
                ['instant', 'short', 'medium', 'long', 'unknown']
            ),
            resource_risk: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.resource_risk),
                ['low', 'medium', 'high']
            )
        },
        vision_policy: profiles.some((profile) => profile.vision_policy === 'bounded')
            ? 'bounded'
            : 'disabled'
    };
}

function resolveSkillPerformanceProfile(
    input: BuildAgentPerformancePolicyInput
): {
    selection: SkillRuntimeManifestSelection;
    resolved?: ResolvedSkillPerformanceProfile;
} {
    const selection = resolveSkillRuntimeManifestSelection({
        skillId: normalizeText(input.skillId),
        taskType: normalizeText(input.taskType)
    });
    if (selection.status !== 'resolved') return { selection };
    const workMode = normalizeRuntimeDesignWorkMode(
        input.workMode || input.skillParams?.workMode || input.skillParams?.declaredWorkMode
    );
    const profiles = selection.manifests
        .map((manifest) => {
            const modeProfile = manifest === selection.artifactManifest && workMode
                ? manifest.work_mode_contracts?.[workMode]?.performance_profile
                : undefined;
            return modeProfile || manifest.performance_profile;
        })
        .filter((profile): profile is SkillRuntimePerformanceProfile => Boolean(profile));
    if (profiles.length === 0) return { selection };
    return {
        selection,
        resolved: {
            manifests: selection.manifests,
            profile: combineSkillPerformanceProfiles(profiles),
            sourceRef: selection.manifests
                .map((manifest) => {
                    const modeRef = manifest === selection.artifactManifest && workMode
                        ? `#${workMode}`
                        : '';
                    return `${manifest.skill_id}@${manifest.version}${modeRef}`;
                })
                .join('+')
        }
    };
}

function inferTaskClass(
    input: BuildAgentPerformancePolicyInput,
    resolvedProfile?: ResolvedSkillPerformanceProfile
): AgentTaskClass {
    const text = normalizeText(input.userText);
    const skillId = normalizeText(input.skillId);
    const scenario = input.scenario || 'unknown';
    const action = input.action || 'unknown';
    const mode = normalizeText(input.mode);
    const analysisMode = normalizeSkillParam(input, 'analysisMode') || mode;
    const focus = normalizeSkillParam(input, 'focus');
    const sampleSize = Number(input.skillParams?.sampleSize);

    if (skillId === 'project-image-analysis') {
        if (analysisMode === 'inventory' || focus === 'inventory' || sampleSize === 0) {
            return 'project-inventory';
        }
        return 'project-analysis';
    }
    // 一旦 R0 已选中带性能画像的业务 Manifest，预算与验收就必须由该 Skill 所有。
    // 用户文本中的“改文案 / 保存”等局部动作不能把整个业务工作流降级成 Agent 核心轻量档。
    if (resolvedProfile) {
        return 'skill-workflow';
    }
    if (action === 'chat' || (!input.requiresPhotoshop && scenario === 'unknown')) {
        return 'chat';
    }
    if (action === 'save' || action === 'export' || skillId === 'document-management') {
        return 'document-management';
    }
    if (skillId === 'layer-management' || /图层.*(顺序|置顶|置底|上移|下移|颜色|隐藏|数量)|从浅到深|从深到浅/.test(text)) {
        return 'layer-management';
    }
    if (skillId === 'text-font-replace' || /字体|字号|文字图层|改文案|替换文案/.test(text)) {
        return 'text-editing';
    }
    if (scenario === 'copywriting' || skillId === 'copywriting') {
        return 'copywriting';
    }
    if (normalizeText(input.taskType) || input.requiresPhotoshop) {
        return 'skill-workflow';
    }
    return 'unknown';
}

function budgetFromSkillProfile(profile: SkillRuntimePerformanceProfile): AgentPerformanceBudget {
    return {
        maxModelCalls: clampInt(
            profile.budget.max_model_calls,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls
        ),
        maxToolCalls: clampInt(
            profile.budget.max_tool_calls,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxToolCalls
        ),
        maxIterations: clampInt(
            profile.budget.max_iterations,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxIterations
        ),
        maxVisionCandidates: clampInt(
            profile.budget.max_vision_candidates,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisionCandidates
        ),
        maxVisualAnalyses: clampInt(
            profile.budget.max_visual_analyses,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisualAnalyses
        ),
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: clampInt(
            profile.budget.soft_time_budget_ms,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.softTimeBudgetMs
        )
    };
}

function defaultSkillWorkflowBudget(): AgentPerformanceBudget {
    return {
        // broad discovery 的设计工作流（未命中 manifest profile）：读上下文 + 技能入口 +
        // 可能的预检重试。16 次模型调用在慢/弱模型下会在技能入口前烧光（实测"帮我做SKU"：
        // 预检拦截重试，16 次耗尽仍 0 写入）。24 给足恢复余量。
        maxModelCalls: 24,
        maxToolCalls: 120,
        maxIterations: 60,
        maxVisionCandidates: 6,
        maxVisualAnalyses: 2,
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: 360_000
    };
}

function budgetForTaskClass(
    taskClass: AgentTaskClass,
    skillProfile?: SkillRuntimePerformanceProfile
): AgentPerformanceBudget {
    if (taskClass === 'skill-workflow') {
        return skillProfile ? budgetFromSkillProfile(skillProfile) : defaultSkillWorkflowBudget();
    }
    switch (taskClass) {
        case 'chat':
            return {
                maxModelCalls: 1,
                maxToolCalls: 0,
                maxIterations: 2,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 30_000
            };
        case 'document-management':
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return {
                // 读文档→写入→读回确认至少 3 轮模型调用；maxModelCalls:1 / 45s 会让
                // ReAct 循环在第一次写入前就被掐停（"修改文案"类任务实测因此必败）。
                maxModelCalls: 6,
                maxToolCalls: 10,
                maxIterations: 8,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 240_000
            };
        case 'copywriting':
            return {
                maxModelCalls: 2,
                maxToolCalls: 8,
                maxIterations: 8,
                maxVisionCandidates: 1,
                maxVisualAnalyses: 1,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 60_000
            };
        case 'project-inventory':
            return {
                maxModelCalls: 0,
                maxToolCalls: 2,
                maxIterations: 4,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 15_000
            };
        case 'project-analysis':
            return {
                maxModelCalls: 1,
                maxToolCalls: 8,
                maxIterations: 8,
                maxVisionCandidates: 4,
                maxVisualAnalyses: 4,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 90_000
            };
        default:
            return {
                // 同上：未知类任务也可能是写操作，保底 6 轮模型调用与 240s，
                // 避免还没完成「读→写→读回」就被预算掐停。
                maxModelCalls: 6,
                maxToolCalls: 12,
                maxIterations: 10,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 240_000
            };
    }
}

function verificationTierForTaskClass(
    taskClass: AgentTaskClass,
    skillProfile?: SkillRuntimePerformanceProfile
): AgentVerificationTier {
    if (taskClass === 'skill-workflow') {
        return skillProfile?.verification_tier || 'manual';
    }
    switch (taskClass) {
        case 'chat':
            return 'none';
        case 'document-management':
            return 'metadata';
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return 'bounds';
        case 'project-inventory':
            return 'metadata';
        case 'project-analysis':
            return 'manual';
        case 'copywriting':
            return 'manual';
        default:
            return 'metadata';
    }
}

function costProfileFromSkillProfile(profile: SkillRuntimePerformanceProfile): AgentCostProfile {
    return {
        modelCallClass: profile.cost_profile.model_call_class,
        photoshopToolClass: profile.cost_profile.photoshop_tool_class,
        imageProcessingClass: profile.cost_profile.image_processing_class,
        expectedLatency: profile.cost_profile.expected_latency,
        resourceRisk: profile.cost_profile.resource_risk
    };
}

function defaultSkillWorkflowCostProfile(): AgentCostProfile {
    return {
        modelCallClass: 'vision-light',
        photoshopToolClass: 'write-heavy',
        imageProcessingClass: 'bounded-vision',
        expectedLatency: 'long',
        resourceRisk: 'high'
    };
}

function costProfileForTaskClass(
    taskClass: AgentTaskClass,
    skillProfile?: SkillRuntimePerformanceProfile
): AgentCostProfile {
    if (taskClass === 'skill-workflow') {
        return skillProfile
            ? costProfileFromSkillProfile(skillProfile)
            : defaultSkillWorkflowCostProfile();
    }
    switch (taskClass) {
        case 'chat':
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'none',
                imageProcessingClass: 'none',
                expectedLatency: 'short',
                resourceRisk: 'low'
            };
        case 'document-management':
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'write-light',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'short',
                resourceRisk: 'low'
            };
        case 'project-inventory':
            return {
                modelCallClass: 'none',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'instant',
                resourceRisk: 'low'
            };
        case 'project-analysis':
            return {
                modelCallClass: 'vision-light',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'medium',
                resourceRisk: 'medium'
            };
        case 'copywriting':
            return {
                modelCallClass: 'text-heavy',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'medium',
                resourceRisk: 'medium'
            };
        default:
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'unknown',
                resourceRisk: 'medium'
            };
    }
}

function requiresContextSnapshotForTask(taskClass: AgentTaskClass): boolean {
    return taskClass === 'skill-workflow';
}

function shouldAllowVisionModel(
    taskClass: AgentTaskClass,
    hasAttachedImage: boolean,
    skillProfile?: SkillRuntimePerformanceProfile
): boolean {
    if (taskClass === 'project-inventory') return false;
    if (taskClass === 'project-analysis') return true;
    if (taskClass === 'copywriting') return hasAttachedImage;
    if (taskClass !== 'skill-workflow') return false;
    return skillProfile ? skillProfile.vision_policy === 'bounded' : true;
}

function applyProjectScaleWarnings(input: {
    budget: AgentPerformanceBudget;
    projectImageCount: number;
    visualSamplingCandidateCount: number;
}): string[] {
    const warnings: string[] = [];
    if (input.projectImageCount > 80) {
        warnings.push(`项目图片数量 ${input.projectImageCount} 较多，必须使用 ProjectAssetIndex 和 VisualSamplingPlan，不能全量视觉分析。`);
    }
    if (input.budget.maxVisionCandidates > 0 && input.visualSamplingCandidateCount > input.budget.maxVisionCandidates) {
        warnings.push(`视觉候选 ${input.visualSamplingCandidateCount} 超过预算 ${input.budget.maxVisionCandidates}，执行前必须截断候选。`);
    }
    return warnings;
}

export function buildAgentPerformancePolicy(input: BuildAgentPerformancePolicyInput): AgentPerformancePolicy {
    const scenario = input.scenario || 'unknown';
    const action = input.action || 'unknown';
    const performanceResolution = resolveSkillPerformanceProfile(input);
    const resolvedProfile = performanceResolution.resolved;
    const skillProfile = resolvedProfile?.profile;
    const taskClass = inferTaskClass(input, resolvedProfile);
    const rawBudget = budgetForTaskClass(taskClass, skillProfile);
    const visualSamplingCandidateCount = clampInt(input.visualSamplingCandidateCount, 0, 0, 999);
    const projectImageCount = clampInt(input.projectImageCount, 0, 0, 999_999);
    const requestedSampleSize = Number(input.skillParams?.sampleSize);
    const requestedVisionCandidates = Number.isFinite(requestedSampleSize) && requestedSampleSize >= 0
        ? requestedSampleSize
        : visualSamplingCandidateCount;
    const maxVisionCandidates = rawBudget.maxVisionCandidates > 0 && requestedVisionCandidates > 0
        ? Math.min(rawBudget.maxVisionCandidates, requestedVisionCandidates)
        : rawBudget.maxVisionCandidates;
    const budget: AgentPerformanceBudget = {
        ...rawBudget,
        maxVisionCandidates
    };
    const hasAttachedImage = input.hasAttachedImage === true;
    const allowVisionModel = shouldAllowVisionModel(
        taskClass,
        hasAttachedImage || maxVisionCandidates > 0,
        skillProfile
    );
    const warnings = applyProjectScaleWarnings({
        budget,
        projectImageCount,
        visualSamplingCandidateCount
    });
    if (performanceResolution.selection.status === 'conflict') {
        warnings.unshift('Skill Manifest 身份冲突，性能策略已回退到 Agent 核心安全档；执行规划必须先阻断并修复身份。');
    } else if (performanceResolution.selection.status === 'unresolved_task_type') {
        warnings.unshift(`结构化 taskType「${performanceResolution.selection.unresolvedTaskType}」未注册，不能按 skillId 猜测业务性能画像。`);
    }
    if (skillProfile && (
        skillProfile.budget.max_model_calls > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls
        || skillProfile.budget.max_tool_calls > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxToolCalls
        || skillProfile.budget.max_iterations > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxIterations
        || skillProfile.budget.max_vision_candidates > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisionCandidates
        || skillProfile.budget.max_visual_analyses > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisualAnalyses
        || skillProfile.budget.max_full_resolution_image_reads > 0
        || skillProfile.budget.soft_time_budget_ms > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.softTimeBudgetMs
    )) {
        warnings.push('Skill Manifest 的资源请求超过 Agent 全局安全上限，实际预算已被截断。');
    }

    return {
        policyVersion: 'agent-performance-policy/v0',
        taskClass,
        scenario,
        action,
        budget,
        verificationTier: verificationTierForTaskClass(taskClass, skillProfile),
        costProfile: costProfileForTaskClass(taskClass, skillProfile),
        profileSource: resolvedProfile
            ? {
                owner: 'skill-manifest',
                ref: resolvedProfile.sourceRef
            }
            : {
                owner: 'agent-core',
                ref: performanceResolution.selection.status === 'conflict'
                    || performanceResolution.selection.status === 'unresolved_task_type'
                    ? `manifest-identity:${performanceResolution.selection.status}`
                    : `agent-task-class:${taskClass}`
            },
        controls: {
            allowProviderStreaming: taskClass === 'chat' || taskClass === 'copywriting',
            allowVisionModel,
            allowBulkProjectScan: false,
            allowFullResolutionImageRead: false,
            preferMetadataOnly: !allowVisionModel,
            preferToolBatching: taskClass !== 'chat',
            requireContextSnapshotBeforeExecution: requiresContextSnapshotForTask(taskClass)
        },
        warnings,
        limitations: [
            '性能策略是执行前预算和资源边界，不代表任务已经执行。',
            '默认禁止全项目视觉分析和全分辨率图片读取。',
            '需要视觉模型时必须通过 ProjectAssetIndex 的有界候选和缓存策略进入。',
            '验收等级只定义最低检查要求，不等于设计质量通过。'
        ]
    };
}

export function buildAutonomousAgentRuntimeBudget(input: BuildAutonomousAgentRuntimeBudgetInput = {}): AgentRuntimeBudget {
    const hasExplicitBudget = input.requestedMaxIterations !== undefined
        && input.requestedMaxIterations !== null
        && input.requestedMaxIterations !== '';
    const fallbackMaxIterations = resolveRuntimeIterationLimit(input.defaultMaxIterations, 25);
    const maxIterations = hasExplicitBudget
        ? resolveRuntimeIterationLimit(input.requestedMaxIterations, fallbackMaxIterations)
        : fallbackMaxIterations;
    const source = hasExplicitBudget
        ? 'explicit-user-parameter'
        : (input.defaultSource || 'legacy-autonomous-agent-default');

    return {
        budgetVersion: 'agent-runtime-budget/v0',
        maxIterations,
        source,
        limitations: [
            source === 'stage-autonomous-agent-default'
                ? '该预算用于阶段式自主设计，要求先完成一个可观察阶段，再由 Agent 根据真实画面决定下一步。'
                : '该预算迁移保留 autonomous-agent 既有默认 25 轮行为，不代表硬预算策略已经完成。',
            '后续需要按 taskClass 将运行时预算收敛到 AgentPerformancePolicy，而不是所有任务共用 legacy 默认。'
        ]
    };
}

export function buildDesignTeamRuntimeBudget(input: BuildDesignTeamRuntimeBudgetInput): AgentDesignTeamRuntimeBudget {
    const fallbackMaxIterations = defaultDesignTeamIterationLimit(input.role);
    const hasExplicitBudget = input.requestedMaxIterations !== undefined
        && input.requestedMaxIterations !== null
        && input.requestedMaxIterations !== '';
    const maxIterations = hasExplicitBudget
        ? resolveRuntimeIterationLimit(input.requestedMaxIterations, fallbackMaxIterations)
        : fallbackMaxIterations;
    const source = hasExplicitBudget
        ? 'explicit-user-parameter'
        : 'teammate-role-default';

    return {
        budgetVersion: 'agent-design-team-runtime-budget/v0',
        role: input.role,
        maxIterations,
        source,
        limitations: [
            '该预算迁移保留 design-team teammate 既有默认迭代数，不代表多 Agent 工作流已完整成熟。',
            '显式请求的 maxIterations 仍可覆盖默认值；无效或小于等于 0 的值会回退到角色默认值。'
        ]
    };
}

export function buildAgentProviderTokenBudget(input: BuildAgentProviderTokenBudgetInput = {}): AgentProviderTokenBudget {
    const hasExplicitBudget = input.requestedMaxTokens !== undefined
        && input.requestedMaxTokens !== null
        && input.requestedMaxTokens !== '';
    const maxTokens = resolveProviderMaxTokens(input.requestedMaxTokens, input.legacyDefaultMaxTokens);
    const legacyDefaultMaxTokens = resolveProviderMaxTokens(undefined, input.legacyDefaultMaxTokens);
    const source = hasExplicitBudget && maxTokens !== legacyDefaultMaxTokens
        ? 'explicit-user-parameter'
        : 'legacy-provider-default';

    return {
        budgetVersion: 'agent-provider-token-budget/v0',
        maxTokens,
        source,
        limitations: [
            `该预算迁移保留 provider/model 既有默认 maxTokens=${legacyDefaultMaxTokens}，不代表所有模型调用已完成动态预算。`,
            '本 helper 只集中默认输出 token 上限，不改变温度、工具调用、流式协议或 provider timeout。'
        ]
    };
}

export function buildAgentContextWindowBudget(
    input: BuildAgentContextWindowBudgetInput = {}
): AgentContextWindowBudget {
    const defaultMaxTokens = 100_000;
    const defaultKeepRecentRounds = 6;
    const hasExplicitBudget = input.requestedMaxTokens !== undefined
        || input.requestedKeepRecentRounds !== undefined;
    const maxTokens = resolvePositiveInt(input.requestedMaxTokens, defaultMaxTokens, 1_000, 1_000_000);
    const keepRecentRounds = resolvePositiveInt(input.requestedKeepRecentRounds, defaultKeepRecentRounds, 1, 50);

    return {
        budgetVersion: 'agent-context-window-budget/v0',
        maxTokens,
        keepRecentRounds,
        source: hasExplicitBudget ? 'explicit-user-parameter' : 'legacy-context-manager-default',
        limitations: [
            '该预算迁移保留 ContextManager 既有 maxTokens=100000 与 keepRecentRounds=6 默认值，不代表上下文压缩策略已经成熟。',
            '当前 token 估算仍是字符级粗略估算，不能等同 provider 真实 token 计费。'
        ]
    };
}

export function buildAgentResourceCacheBudget(
    input: BuildAgentResourceCacheBudgetInput = {}
): AgentResourceCacheBudget {
    const resourceScanCacheTtlMs = resolvePositiveInt(
        input.requestedResourceScanCacheTtlMs,
        30_000,
        1_000,
        10 * 60 * 1_000
    );
    const psdPreviewCacheTtlMs = resolvePositiveInt(
        input.requestedPsdPreviewCacheTtlMs,
        300_000,
        1_000,
        60 * 60 * 1_000
    );

    return {
        budgetVersion: 'agent-resource-cache-budget/v0',
        resourceScanCacheTtlMs,
        psdPreviewCacheTtlMs,
        source: 'agent-performance-policy',
        limitations: [
            '该预算迁移保留 ResourceManager 既有目录扫描 30 秒缓存和 PSD 预览 5 分钟缓存，不改变资源读取行为。',
            '缓存预算只是性能边界，不代表图片内容理解、最佳素材选择或视觉分析已经完成。'
        ]
    };
}

export function buildAgentAcceptanceCaptureBudget(
    input: BuildAgentAcceptanceCaptureBudgetInput = {}
): AgentAcceptanceCaptureBudget {
    let mode: AgentAcceptanceCaptureBudget['mode'] = 'standard';
    let maxLayers = 350;
    let timeoutMs = 12_000;

    if (input.deep === true) {
        mode = 'deep';
        maxLayers = 1_000;
        timeoutMs = 30_000;
    } else if (input.bulk === true) {
        mode = 'bulk';
        maxLayers = 700;
        timeoutMs = 22_000;
    } else if (input.light === true) {
        // 轻量结构写：验证只需层级关系+bounds（顺序/父子/剪切），不需要全文档深采——
        // 真机 110 步病例里单步 reorderLayer 也扛 16s 全套验收，时间大头在此。
        mode = 'light';
        maxLayers = 120;
        timeoutMs = 5_000;
    }

    return {
        budgetVersion: 'agent-acceptance-capture-budget/v0',
        mode,
        maxLayers,
        timeoutMs,
        maxChangedLayers: resolveAcceptanceChangedLayerLimit(input.maxChangedLayers),
        source: 'agent-performance-policy',
        limitations: [
            '该预算迁移保留 tool acceptance 既有 maxLayers、timeoutMs 和 changed layer 默认值，不代表截图级 QA 已完成。',
            '后续需要按 taskClass 和文档规模把验收预算推进到硬限制和 UI 资源提示。'
        ]
    };
}

export function buildAgentPerformancePolicyFromIntent(input: {
    intent: DesignIntentContext;
    skillId?: string;
    taskType?: string;
    hasAttachedImage?: boolean;
    projectImageCount?: number;
    visualSamplingCandidateCount?: number;
}): AgentPerformancePolicy {
    return buildAgentPerformancePolicy({
        userText: input.intent.normalizedText || input.intent.rawText,
        scenario: input.intent.targetScenario,
        action: input.intent.action,
        skillId: input.skillId,
        taskType: input.taskType,
        hasAttachedImage: input.hasAttachedImage,
        requiresPhotoshop: input.intent.requiresPhotoshop,
        projectImageCount: input.projectImageCount,
        visualSamplingCandidateCount: input.visualSamplingCandidateCount
    });
}
