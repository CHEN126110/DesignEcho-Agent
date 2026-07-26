import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import type { DesignKnowledgeResult } from './design-knowledge-search';
import { selectDesignKnowledgeResultsForUse } from './design-knowledge-governance';
import { hasConcreteProjectVisualInsight } from './project-visual-sampling';

export type DesignIntelligencePlanStatus =
    | 'ready_for_tool_planning'
    | 'needs_model_design_decision'
    | 'needs_visual_observation'
    | 'needs_planner_context';

export type DesignIntelligenceDecisionSource = 'model-agent' | 'manual' | 'missing';

export type DesignIntelligenceWorkflowPhase =
    | 'inspect'
    | 'analyze'
    | 'plan'
    | 'retouch'
    | 'compose'
    | 'export'
    | 'verify';

export interface DesignIntelligenceHierarchyDecision {
    primarySubject?: string;
    focalPoint?: string;
    informationPriority?: string[];
    whitespaceIntent?: string;
    layoutNotes?: string[];
}

export interface DesignIntelligenceColorDecision {
    paletteIntent?: string;
    primaryColors?: string[];
    accentColors?: string[];
    backgroundDirection?: string;
    contrastPlan?: string;
    avoid?: string[];
}

export interface DesignIntelligenceTypographyDecision {
    tone?: string;
    hierarchy?: string[];
    fontDirection?: string;
    spacingDirection?: string;
    avoid?: string[];
}

export interface DesignIntelligenceRetouchDecision {
    objectives?: string[];
    colorCorrection?: string;
    lighting?: string;
    cleanup?: string[];
    fabricOrMaterialHandling?: string;
    prohibitedEdits?: string[];
}

export interface DesignIntelligenceAssetDecision {
    selectionPrinciples?: string[];
    requiredInputs?: string[];
    rejectRules?: string[];
}

export interface DesignIntelligenceWorkflowStep {
    phase: DesignIntelligenceWorkflowPhase;
    goal: string;
    allowedToolKinds?: string[];
    requiredInputs?: string[];
}

export interface DesignIntelligenceAgentDecision {
    source?: Exclude<DesignIntelligenceDecisionSource, 'missing'>;
    designGoal?: string;
    productUnderstanding?: string[];
    audience?: string;
    hierarchy?: DesignIntelligenceHierarchyDecision;
    color?: DesignIntelligenceColorDecision;
    typography?: DesignIntelligenceTypographyDecision;
    retouch?: DesignIntelligenceRetouchDecision;
    assetSelection?: DesignIntelligenceAssetDecision;
    toolWorkflow?: DesignIntelligenceWorkflowStep[];
    acceptanceCriteria?: string[];
    risks?: string[];
    rationale?: string[];
}

export interface DesignIntelligenceAssetAvailabilitySummary {
    indexedImageCount: number;
    declaredProjectImageCount: number;
    projectImagePathCount: number;
    attachmentImageCount: number;
    availableImageCount: number;
}

export interface DesignIntelligenceVisualUnderstandingSummary {
    concreteInsightCount: number;
    reportedInsightCount: number;
    pendingAnalysisCount: number;
    status: 'available' | 'missing';
}

export interface DesignIntelligenceProjectContextSummary {
    assetAvailability: DesignIntelligenceAssetAvailabilitySummary;
    visualUnderstanding: DesignIntelligenceVisualUnderstandingSummary;
}

export interface DesignIntelligenceContextSummary extends DesignIntelligenceProjectContextSummary {
    knowledgeResultCount: number;
    usableKnowledgeResultCount: number;
    knowledgeNeedsReviewCount: number;
    blockedKnowledgeResultCount: number;
    knowledgeSnapshotFingerprint?: string;
    knowledgeAllowedUses: string[];
    localCaseCount: number;
    memoryContextStatus?: string;
}

export interface DesignIntelligencePlan {
    planVersion: 'design-intelligence-plan/v0';
    scenario: DesignAgentOsScenario;
    status: DesignIntelligencePlanStatus;
    decisionSource: DesignIntelligenceDecisionSource;
    designGoal: string;
    contextSummary: DesignIntelligenceContextSummary;
    decisions: {
        productUnderstanding: string[];
        hierarchy: DesignIntelligenceHierarchyDecision;
        color: DesignIntelligenceColorDecision;
        typography: DesignIntelligenceTypographyDecision;
        retouch: DesignIntelligenceRetouchDecision;
        assetSelection: DesignIntelligenceAssetDecision;
    };
    toolUsePlan: {
        canPlanToolUse: boolean;
        workflow: DesignIntelligenceWorkflowStep[];
        requiredInputs: string[];
        boundaries: string[];
    };
    acceptanceCriteria: string[];
    warnings: string[];
    limitations: string[];
}

export interface DesignIntelligenceProjectContext {
    projectImageCount?: number;
    sampleImagePaths?: string[];
    selectedProjectImagePath?: string;
    attachmentImageCount?: number;
    assetIndex?: {
        summary?: {
            totalImages?: number;
        };
    };
    visualInsightCache?: {
        entries?: Array<{
            insight?: unknown;
        }>;
        summary?: {
            entriesWithInsight?: number;
        };
    };
    visualSamplingPlan?: {
        selectedCandidates?: Array<{
            cachedInsight?: unknown;
        }>;
        cacheSummary?: {
            shouldAnalyze?: number;
        };
    };
}

export interface DesignIntelligencePlanInput {
    userText?: string;
    scenario?: DesignAgentOsScenario;
    plannerReadiness?: string;
    knowledgeResults?: DesignKnowledgeResult[];
    projectContext?: DesignIntelligenceProjectContext | null;
    memoryContext?: {
        status?: string;
    } | null;
    agentDecision?: DesignIntelligenceAgentDecision | null;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function cleanStrings(values: unknown, limit = 8): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, limit);
}

function cleanColorStrings(values: unknown): string[] {
    return cleanStrings(values, 8).filter((value) => value.length <= 40);
}

function isWorkflowPhase(value: unknown): value is DesignIntelligenceWorkflowPhase {
    return ['inspect', 'analyze', 'plan', 'retouch', 'compose', 'export', 'verify'].includes(String(value || ''));
}

function isDecisionSource(value: unknown): value is Exclude<DesignIntelligenceDecisionSource, 'missing'> {
    return value === 'model-agent' || value === 'manual';
}

function normalizeWorkflow(value: unknown): DesignIntelligenceWorkflowStep[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): DesignIntelligenceWorkflowStep | null => {
            const record = item as Record<string, unknown>;
            const phase = record?.phase;
            const goal = cleanString(record?.goal);
            if (!isWorkflowPhase(phase) || !goal) return null;
            return {
                phase,
                goal,
                allowedToolKinds: cleanStrings(record.allowedToolKinds, 8),
                requiredInputs: cleanStrings(record.requiredInputs, 8)
            };
        })
        .filter((item): item is DesignIntelligenceWorkflowStep => Boolean(item))
        .slice(0, 12);
}

function normalizeAgentDecision(value: DesignIntelligenceAgentDecision | null | undefined): DesignIntelligenceAgentDecision | null {
    if (!value || typeof value !== 'object') return null;
    const normalized: DesignIntelligenceAgentDecision = {};
    if (isDecisionSource(value.source)) normalized.source = value.source;
    const designGoal = cleanString(value.designGoal);
    if (designGoal) normalized.designGoal = designGoal;
    const productUnderstanding = cleanStrings(value.productUnderstanding, 8);
    if (productUnderstanding.length) normalized.productUnderstanding = productUnderstanding;
    const audience = cleanString(value.audience);
    if (audience) normalized.audience = audience;

    const hierarchy = value.hierarchy || {};
    normalized.hierarchy = {
        primarySubject: cleanString(hierarchy.primarySubject) || undefined,
        focalPoint: cleanString(hierarchy.focalPoint) || undefined,
        informationPriority: cleanStrings(hierarchy.informationPriority, 8),
        whitespaceIntent: cleanString(hierarchy.whitespaceIntent) || undefined,
        layoutNotes: cleanStrings(hierarchy.layoutNotes, 8)
    };

    const color = value.color || {};
    normalized.color = {
        paletteIntent: cleanString(color.paletteIntent) || undefined,
        primaryColors: cleanColorStrings(color.primaryColors),
        accentColors: cleanColorStrings(color.accentColors),
        backgroundDirection: cleanString(color.backgroundDirection) || undefined,
        contrastPlan: cleanString(color.contrastPlan) || undefined,
        avoid: cleanStrings(color.avoid, 8)
    };

    const typography = value.typography || {};
    normalized.typography = {
        tone: cleanString(typography.tone) || undefined,
        hierarchy: cleanStrings(typography.hierarchy, 8),
        fontDirection: cleanString(typography.fontDirection) || undefined,
        spacingDirection: cleanString(typography.spacingDirection) || undefined,
        avoid: cleanStrings(typography.avoid, 8)
    };

    const retouch = value.retouch || {};
    normalized.retouch = {
        objectives: cleanStrings(retouch.objectives, 8),
        colorCorrection: cleanString(retouch.colorCorrection) || undefined,
        lighting: cleanString(retouch.lighting) || undefined,
        cleanup: cleanStrings(retouch.cleanup, 8),
        fabricOrMaterialHandling: cleanString(retouch.fabricOrMaterialHandling) || undefined,
        prohibitedEdits: cleanStrings(retouch.prohibitedEdits, 8)
    };

    const assetSelection = value.assetSelection || {};
    normalized.assetSelection = {
        selectionPrinciples: cleanStrings(assetSelection.selectionPrinciples, 8),
        requiredInputs: cleanStrings(assetSelection.requiredInputs, 8),
        rejectRules: cleanStrings(assetSelection.rejectRules, 8)
    };

    const workflow = normalizeWorkflow(value.toolWorkflow);
    if (workflow.length) normalized.toolWorkflow = workflow;
    const acceptanceCriteria = cleanStrings(value.acceptanceCriteria, 10);
    if (acceptanceCriteria.length) normalized.acceptanceCriteria = acceptanceCriteria;
    const risks = cleanStrings(value.risks, 8);
    if (risks.length) normalized.risks = risks;
    const rationale = cleanStrings(value.rationale, 8);
    if (rationale.length) normalized.rationale = rationale;

    const hasDecisionContent = Boolean(
        normalized.designGoal
        || normalized.productUnderstanding?.length
        || normalized.hierarchy?.primarySubject
        || normalized.hierarchy?.informationPriority?.length
        || normalized.color?.paletteIntent
        || normalized.color?.primaryColors?.length
        || normalized.typography?.tone
        || normalized.retouch?.objectives?.length
        || normalized.toolWorkflow?.length
        || normalized.acceptanceCriteria?.length
    );
    return hasDecisionContent ? normalized : null;
}

function numberOrZero(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function countConcreteVisualInsights(projectContext?: DesignIntelligenceProjectContext | null): number {
    const insightKeys = new Set<string>();
    let anonymousInsightIndex = 0;

    function addInsight(value: unknown): void {
        if (!hasConcreteProjectVisualInsight(value)) return;
        const assetId = cleanString(value.assetId);
        const path = cleanString(value.path).replace(/\\/g, '/').toLowerCase();
        const stableKey = assetId || path;
        if (stableKey) {
            insightKeys.add(stableKey);
            return;
        }
        insightKeys.add(`anonymous-${anonymousInsightIndex}`);
        anonymousInsightIndex += 1;
    }

    for (const entry of projectContext?.visualInsightCache?.entries || []) {
        addInsight(entry?.insight);
    }
    for (const candidate of projectContext?.visualSamplingPlan?.selectedCandidates || []) {
        addInsight(candidate?.cachedInsight);
    }
    return insightKeys.size;
}

export function buildDesignIntelligenceProjectContextSummary(
    projectContext?: DesignIntelligenceProjectContext | null
): DesignIntelligenceProjectContextSummary {
    const indexedImageCount = numberOrZero(projectContext?.assetIndex?.summary?.totalImages);
    const declaredProjectImageCount = numberOrZero(projectContext?.projectImageCount);
    const projectImagePaths = new Set([
        ...(projectContext?.sampleImagePaths || []),
        projectContext?.selectedProjectImagePath
    ].map((value) => cleanString(value)).filter(Boolean));
    const projectImagePathCount = projectImagePaths.size;
    const attachmentImageCount = numberOrZero(projectContext?.attachmentImageCount);
    const availableImageCount = Math.max(
        indexedImageCount,
        declaredProjectImageCount,
        projectImagePathCount,
        attachmentImageCount
    );
    const concreteInsightCount = countConcreteVisualInsights(projectContext);
    const reportedInsightCount = numberOrZero(projectContext?.visualInsightCache?.summary?.entriesWithInsight);
    const pendingAnalysisCount = numberOrZero(projectContext?.visualSamplingPlan?.cacheSummary?.shouldAnalyze);

    return {
        assetAvailability: {
            indexedImageCount,
            declaredProjectImageCount,
            projectImagePathCount,
            attachmentImageCount,
            availableImageCount
        },
        visualUnderstanding: {
            concreteInsightCount,
            reportedInsightCount,
            pendingAnalysisCount,
            status: concreteInsightCount > 0 ? 'available' : 'missing'
        }
    };
}

function buildContextSummary(input: DesignIntelligencePlanInput): DesignIntelligenceContextSummary {
    const knowledgeResults = Array.isArray(input.knowledgeResults) ? input.knowledgeResults : [];
    const knowledgeSelection = selectDesignKnowledgeResultsForUse(knowledgeResults, {
        query: input.userText,
        purpose: 'planning'
    });
    const projectContextSummary = buildDesignIntelligenceProjectContextSummary(input.projectContext);
    return {
        knowledgeResultCount: knowledgeResults.length,
        usableKnowledgeResultCount: knowledgeSelection.usableResults.length,
        knowledgeNeedsReviewCount: knowledgeSelection.reviewResults.length,
        blockedKnowledgeResultCount: knowledgeSelection.blockedResults.length,
        knowledgeSnapshotFingerprint: knowledgeSelection.snapshot.snapshotFingerprint,
        knowledgeAllowedUses: Array.from(new Set(knowledgeResults.flatMap((item) => item.allowedUses || []))).sort(),
        localCaseCount: knowledgeSelection.usableResults.filter((item) => item.sourceType === 'local_case').length,
        ...projectContextSummary,
        memoryContextStatus: cleanString(input.memoryContext?.status) || undefined
    };
}

function pendingHierarchy(): DesignIntelligenceHierarchyDecision {
    return {
        informationPriority: [],
        layoutNotes: ['待模型 Agent 基于产品上下文、视觉素材和用户目标决定视觉层级。']
    };
}

function pendingColor(): DesignIntelligenceColorDecision {
    return {
        primaryColors: [],
        accentColors: [],
        avoid: ['不要由代码按关键词猜测配色。']
    };
}

function pendingTypography(): DesignIntelligenceTypographyDecision {
    return {
        hierarchy: [],
        avoid: ['不要由代码按场景固定标题、字体或字号。']
    };
}

function pendingRetouch(): DesignIntelligenceRetouchDecision {
    return {
        objectives: [],
        cleanup: [],
        prohibitedEdits: ['没有模型 Agent 决策和当前视觉观察时，不要自动调色、磨皮、液化或改变产品材质。']
    };
}

function pendingAssetSelection(): DesignIntelligenceAssetDecision {
    return {
        requiredInputs: ['项目素材索引', '视觉理解结果', '用户或模型 Agent 的选图理由'],
        rejectRules: ['不能只靠文件名或目录名最终选图。']
    };
}

function countDecisionAreas(decision: DesignIntelligenceAgentDecision | null): number {
    if (!decision) return 0;
    return [
        Boolean(decision.designGoal),
        Boolean(decision.productUnderstanding?.length),
        Boolean(decision.hierarchy?.primarySubject || decision.hierarchy?.informationPriority?.length),
        Boolean(decision.color?.paletteIntent || decision.color?.primaryColors?.length),
        Boolean(decision.typography?.tone || decision.typography?.hierarchy?.length),
        Boolean(decision.retouch?.objectives?.length || decision.retouch?.colorCorrection || decision.retouch?.lighting),
        Boolean(decision.assetSelection?.selectionPrinciples?.length || decision.assetSelection?.requiredInputs?.length),
        Boolean(decision.toolWorkflow?.length),
        Boolean(decision.acceptanceCriteria?.length)
    ].filter(Boolean).length;
}

function scenarioRequiresVisualObservation(scenario: DesignAgentOsScenario): boolean {
    return ['main-image', 'detail-page', 'sku', 'reference-replication', 'general-design'].includes(scenario);
}

export function buildDesignIntelligencePlan(input: DesignIntelligencePlanInput): DesignIntelligencePlan {
    const scenario = input.scenario || 'general-design';
    const agentDecision = normalizeAgentDecision(input.agentDecision);
    const decisionSource: DesignIntelligenceDecisionSource = agentDecision?.source || (agentDecision ? 'model-agent' : 'missing');
    const decisionAreas = countDecisionAreas(agentDecision);
    const contextSummary = buildContextSummary(input);
    const warnings: string[] = [];
    const requiredInputs: string[] = [];
    const requiresVisualUnderstanding = scenarioRequiresVisualObservation(scenario);
    const hasVisualUnderstanding = contextSummary.visualUnderstanding.status === 'available';

    if (!agentDecision) {
        requiredInputs.push('model-agent-design-decision');
        warnings.push('缺少模型 Agent 的设计判断：不能把工具可用性当作设计计划。');
    }
    if (requiresVisualUnderstanding && !hasVisualUnderstanding) {
        requiredInputs.push('project-visual-observation');
        warnings.push('当前只有素材可用性信息，没有具体视觉理解；图片数量、文件路径和附件不会被当作已经看过图片。');
    }
    if (input.plannerReadiness === 'blocked') {
        requiredInputs.push('design-planner-context');
        warnings.push('上游 Design Planner 尚未形成可用上下文，需要由当前 Skill 补充读取或重新规划。');
    }
    if (contextSummary.knowledgeAllowedUses.includes('direct_photoshop_action')) {
        warnings.push('已忽略试图直接生成 Photoshop 动作的知识条目；知识只作为设计上下文。');
    }

    const hasWorkflow = Boolean(agentDecision?.toolWorkflow?.length);
    const hasAcceptance = Boolean(agentDecision?.acceptanceCriteria?.length);
    const hasEnoughDecision = decisionAreas >= 4 && hasWorkflow && hasAcceptance;
    let status: DesignIntelligencePlanStatus;
    if (input.plannerReadiness === 'blocked') {
        status = 'needs_planner_context';
    } else if (!agentDecision || !hasEnoughDecision) {
        status = 'needs_model_design_decision';
    } else if (requiresVisualUnderstanding && !hasVisualUnderstanding) {
        status = 'needs_visual_observation';
    } else {
        status = 'ready_for_tool_planning';
    }

    const canPlanToolUse = status === 'ready_for_tool_planning' || status === 'needs_visual_observation';

    return {
        planVersion: 'design-intelligence-plan/v0',
        scenario,
        status,
        decisionSource,
        designGoal: agentDecision?.designGoal || cleanString(input.userText) || '待模型 Agent 明确设计目标。',
        contextSummary,
        decisions: {
            productUnderstanding: agentDecision?.productUnderstanding || [],
            hierarchy: agentDecision?.hierarchy || pendingHierarchy(),
            color: agentDecision?.color || pendingColor(),
            typography: agentDecision?.typography || pendingTypography(),
            retouch: agentDecision?.retouch || pendingRetouch(),
            assetSelection: agentDecision?.assetSelection || pendingAssetSelection()
        },
        toolUsePlan: {
            canPlanToolUse,
            workflow: agentDecision?.toolWorkflow || [],
            requiredInputs,
            boundaries: [
                'Design Intelligence Plan 只整理设计目标、上下文缺口和建议工具顺序，不授予或拒绝 Photoshop 写入。',
                '素材路径、附件和图片数量只表示素材可用，不表示 Agent 已经理解图片内容。',
                '真实写入边界由工具执行点的 preflight 与 Policy 检查，执行后仍需读回、截图或人工验收。'
            ]
        },
        acceptanceCriteria: agentDecision?.acceptanceCriteria || [
            '待模型 Agent 明确可验收的视觉、文案、素材和导出标准。'
        ],
        warnings: [
            ...warnings,
            ...(agentDecision?.risks || [])
        ],
        limitations: [
            '该计划不包含私有推理链，也不会根据素材清单推断图片内容。',
            '知识库和用户偏好只能作为设计上下文，不能直接变成 Photoshop 写入动作。',
            '工具链成功不等于审美、转化或商业质量通过。'
        ]
    };
}
