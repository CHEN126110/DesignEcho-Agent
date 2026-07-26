import type { DetailScreenVisualSummary } from './detail-page-visual-segmentation';

export const DETAIL_SCREEN_ROLES = [
    'hero',
    'selling-point',
    'material_detail',
    'process_detail',
    'feature_detail',
    'scene',
    'parameter',
    'closing',
    'unknown'
] as const;

export type DetailScreenRole = typeof DETAIL_SCREEN_ROLES[number];

export const DETAIL_SCREEN_COPY_STRATEGIES = [
    'headline',
    'benefit',
    'supporting_copy',
    'parameter',
    'emotional'
] as const;

export type DetailScreenCopyStrategy = typeof DETAIL_SCREEN_COPY_STRATEGIES[number];

export type DetailScreenImageStrategy = 'hero' | 'context' | 'detail' | 'material' | 'comparison';

export type DetailScreenVisualPriority = 'copy-first' | 'image-first' | 'balanced';

export type DetailScreenDecisionSource = 'agent' | 'heuristic';

export interface DetailScreenAgentDecision {
    screenId?: number;
    screenName?: string;
    screenRole?: DetailScreenRole;
    mainMessage?: string;
    supportingPoints?: string[];
    copyStrategy?: DetailScreenCopyStrategy;
    imageStrategy?: DetailScreenImageStrategy;
    visualPriority?: DetailScreenVisualPriority;
    rationale?: string[];
    /** 只允许来自详情页事实目录的稳定引用，不携带事实原文。 */
    supportRefs?: string[];
}

export interface DetailScreenStructuralSignals {
    keywordRole: DetailScreenRole | null;
    structuralRole: DetailScreenRole;
    visualRoleHint: DetailScreenRole | null;
    reasons: string[];
}

export interface DetailScreenPlan {
    screenId: number;
    screenName: string;
    screenType: string;
    screenRole: DetailScreenRole;
    mainMessage: string;
    supportingPoints: string[];
    supportRefs: string[];
    copyStrategy: DetailScreenCopyStrategy;
    imageStrategy: DetailScreenImageStrategy;
    visualPriority: DetailScreenVisualPriority;
    decisionSource: DetailScreenDecisionSource;
    requiresModelDecision: boolean;
    agentDecision?: DetailScreenAgentDecision;
    structuralSignals: DetailScreenStructuralSignals;
    confidence: number;
    risks: string[];
    visualSummary?: DetailScreenVisualSummary;
}

export interface DetailScreenPlanInput {
    id: number;
    name: string;
    type: string;
    order: number;
    copyPlaceholders?: Array<unknown>;
    imagePlaceholders?: Array<unknown>;
}

export interface DetailScreenPlanAssessment {
    screenId: number;
    mode?: 'healthy' | 'watch' | 'risky' | string;
    metrics?: {
        imageAreaRatio?: number;
        copyAreaRatio?: number;
    };
}

export interface DetailLayoutAssessmentLike {
    screenAssessments?: DetailScreenPlanAssessment[];
}

export interface DetailScreenPlanOptions {
    visualSummaries?: DetailScreenVisualSummary[];
    agentDecisions?: DetailScreenAgentDecision[];
}

function clamp01(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function includesAny(source: string, keywords: string[]): boolean {
    return keywords.some((keyword) => source.includes(keyword));
}

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function uniqueCleanStrings(values: unknown, limit = 6): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanText).filter(Boolean))).slice(0, limit);
}

function isDetailScreenRole(value: unknown): value is DetailScreenRole {
    return DETAIL_SCREEN_ROLES.includes(String(value || '') as DetailScreenRole);
}

function isCopyStrategy(value: unknown): value is DetailScreenCopyStrategy {
    return DETAIL_SCREEN_COPY_STRATEGIES.includes(String(value || '') as DetailScreenCopyStrategy);
}

function isImageStrategy(value: unknown): value is DetailScreenImageStrategy {
    return ['hero', 'context', 'detail', 'material', 'comparison'].includes(String(value || ''));
}

function isVisualPriority(value: unknown): value is DetailScreenVisualPriority {
    return ['copy-first', 'image-first', 'balanced'].includes(String(value || ''));
}

function screenDecisionKey(value: unknown): string {
    return cleanText(value).toLowerCase();
}

function normalizeAgentDecision(value: DetailScreenAgentDecision | undefined): DetailScreenAgentDecision | null {
    if (!value || typeof value !== 'object') return null;
    const normalized: DetailScreenAgentDecision = {};
    const screenId = Number(value.screenId || 0);
    if (Number.isFinite(screenId) && screenId > 0) normalized.screenId = screenId;
    const screenName = cleanText(value.screenName);
    if (screenName) normalized.screenName = screenName;
    if (isDetailScreenRole(value.screenRole)) normalized.screenRole = value.screenRole;
    const mainMessage = cleanText(value.mainMessage);
    if (mainMessage) normalized.mainMessage = mainMessage;
    const supportingPoints = uniqueCleanStrings(value.supportingPoints, 6);
    if (supportingPoints.length) normalized.supportingPoints = supportingPoints;
    if (isCopyStrategy(value.copyStrategy)) normalized.copyStrategy = value.copyStrategy;
    if (isImageStrategy(value.imageStrategy)) normalized.imageStrategy = value.imageStrategy;
    if (isVisualPriority(value.visualPriority)) normalized.visualPriority = value.visualPriority;
    const rationale = uniqueCleanStrings(value.rationale, 6);
    if (rationale.length) normalized.rationale = rationale;
    const supportRefs = uniqueCleanStrings(value.supportRefs, 8)
        .filter((ref) => /^detail-fact:(?:[a-z0-9-]+:[0-9]+(?::[0-9]+)?|state-record:[a-f0-9]{16})$/.test(ref));
    if (supportRefs.length) normalized.supportRefs = supportRefs;
    return Object.keys(normalized).length > 0 ? normalized : null;
}

function inferRoleFromKeywords(screen: DetailScreenPlanInput): DetailScreenRole | null {
    const haystack = `${screen.name} ${screen.type}`.toLowerCase();

    if (includesAny(haystack, ['hero', 'kv', 'banner', '首屏', '主视觉', '首页'])) return 'hero';
    if (includesAny(haystack, ['参数', '规格', '尺码', '数据', '对比'])) return 'parameter';
    if (includesAny(haystack, ['材质', '面料', '纤维', '桑蚕丝', '棉'])) return 'material_detail';
    if (includesAny(haystack, ['工艺', '做工', '车线', '缝合'])) return 'process_detail';
    if (includesAny(haystack, ['细节', '特写', '纹理', '功能'])) return 'feature_detail';
    if (includesAny(haystack, ['场景', '搭配', '上脚', '穿搭', '氛围', '生活'])) return 'scene';
    if (includesAny(haystack, ['收尾', '结尾', '总结', '购买', '安心', '放心'])) return 'closing';
    if (includesAny(haystack, ['卖点', '优势', '亮点', '特点'])) return 'selling-point';
    return null;
}

function inferRoleFromStructure(
    screen: DetailScreenPlanInput,
    screenAssessment?: DetailScreenPlanAssessment
): DetailScreenRole {
    const copyCount = screen.copyPlaceholders?.length || 0;
    const imageCount = screen.imagePlaceholders?.length || 0;
    const imageAreaRatio = Number(screenAssessment?.metrics?.imageAreaRatio || 0);
    const copyAreaRatio = Number(screenAssessment?.metrics?.copyAreaRatio || 0);

    if (screen.order === 0 && imageAreaRatio >= 0.28) return 'hero';
    if (copyCount >= 4 && copyAreaRatio >= 0.18) return 'parameter';
    if (imageCount === 1 && copyCount <= 2 && imageAreaRatio >= 0.35) return 'hero';
    if (imageCount >= 2 && copyCount <= 2) return 'selling-point';
    if (imageCount >= 1 && copyCount >= 1 && imageAreaRatio < 0.18) return 'feature_detail';
    if (imageCount >= 1 && copyCount >= 2) return 'selling-point';
    if (imageCount >= 1 && copyCount === 0) return 'scene';
    return 'unknown';
}

function getPlanCopyStrategy(role: DetailScreenRole): DetailScreenCopyStrategy {
    switch (role) {
        case 'hero':
            return 'headline';
        case 'parameter':
            return 'parameter';
        case 'material_detail':
        case 'process_detail':
        case 'feature_detail':
            return 'supporting_copy';
        case 'scene':
        case 'closing':
            return 'emotional';
        case 'selling-point':
        default:
            return 'benefit';
    }
}

function getPlanImageStrategy(role: DetailScreenRole): DetailScreenImageStrategy {
    switch (role) {
        case 'hero':
            return 'hero';
        case 'material_detail':
            return 'material';
        case 'process_detail':
        case 'feature_detail':
            return 'detail';
        case 'parameter':
            return 'comparison';
        case 'scene':
        case 'closing':
            return 'context';
        case 'selling-point':
        default:
            return 'context';
    }
}

function getPlanVisualPriority(
    role: DetailScreenRole,
    screenAssessment?: DetailScreenPlanAssessment,
    visualSummary?: DetailScreenVisualSummary
): DetailScreenPlan['visualPriority'] {
    const imageAreaRatio = Number(screenAssessment?.metrics?.imageAreaRatio || 0);
    const copyAreaRatio = Number(screenAssessment?.metrics?.copyAreaRatio || 0);

    if (visualSummary?.dominantModuleType === 'image' && visualSummary.boundaryRisk !== 'risky') return 'image-first';
    if (visualSummary?.dominantModuleType === 'text' && visualSummary.boundaryRisk !== 'risky') return 'copy-first';
    if (role === 'hero' || imageAreaRatio >= 0.35) return 'image-first';
    if (role === 'parameter' || copyAreaRatio >= 0.28) return 'copy-first';
    return 'balanced';
}

function getPendingMainMessage(): string {
    return '待模型 Agent 结合产品事实、素材观察、用户意图和模板结构决定这一屏的主信息。';
}

function getPendingSupportingPoints(): string[] {
    return [
        '结构识别只提供候选职责，不直接决定卖点或文案角度',
        '正式执行前需要模型 Agent 明确该屏讲什么、用什么图片呈现'
    ];
}

export function describeDetailScreenRole(role: DetailScreenRole): string {
    switch (role) {
        case 'hero':
            return '首屏主视觉';
        case 'selling-point':
            return '卖点表达';
        case 'material_detail':
            return '材质细节';
        case 'process_detail':
            return '工艺细节';
        case 'feature_detail':
            return '功能细节';
        case 'scene':
            return '场景表达';
        case 'parameter':
            return '参数说明';
        case 'closing':
            return '收尾信任';
        default:
            return '待确认';
    }
}

export function inferDetailScreenPlans(
    screens: DetailScreenPlanInput[],
    layoutAssessment?: DetailLayoutAssessmentLike,
    options?: DetailScreenPlanOptions
): DetailScreenPlan[] {
    const assessmentMap = new Map<number, DetailScreenPlanAssessment>(
        (layoutAssessment?.screenAssessments || []).map((assessment) => [assessment.screenId, assessment])
    );
    const visualSummaryMap = new Map<number, DetailScreenVisualSummary>(
        (options?.visualSummaries || []).map((summary) => [summary.screenId, summary])
    );
    const decisionByScreenId = new Map<number, DetailScreenAgentDecision>();
    const decisionByScreenName = new Map<string, DetailScreenAgentDecision>();
    for (const rawDecision of options?.agentDecisions || []) {
        const decision = normalizeAgentDecision(rawDecision);
        if (!decision) continue;
        if (decision.screenId) decisionByScreenId.set(decision.screenId, decision);
        if (decision.screenName) decisionByScreenName.set(screenDecisionKey(decision.screenName), decision);
    }

    return (screens || []).map((screen) => {
        const screenAssessment = assessmentMap.get(screen.id);
        const visualSummary = visualSummaryMap.get(screen.id);
        const agentDecision = decisionByScreenId.get(screen.id) || decisionByScreenName.get(screenDecisionKey(screen.name)) || null;
        const keywordRole = inferRoleFromKeywords(screen);
        const structuralRole = inferRoleFromStructure(screen, screenAssessment);
        const visualRoleHint = visualSummary?.roleHint || null;
        const heuristicRole = keywordRole || (structuralRole !== 'unknown' ? structuralRole : (visualRoleHint || structuralRole));
        const screenRole = agentDecision?.screenRole || heuristicRole;
        const decisionSource: DetailScreenDecisionSource = agentDecision ? 'agent' : 'heuristic';
        const requiresModelDecision = !agentDecision;
        const risks: string[] = [];
        const structuralReasons: string[] = [];

        if (!keywordRole && structuralRole === 'unknown') {
            risks.push(visualRoleHint ? '主要依赖视觉分块推断屏职责候选' : '屏职责结构信息不足');
        }
        if (keywordRole) {
            structuralReasons.push(`屏名/类型关键词候选为 ${keywordRole}`);
        }
        if (structuralRole !== 'unknown') {
            structuralReasons.push(`占位结构候选为 ${structuralRole}`);
        }
        if (visualRoleHint) {
            structuralReasons.push(`视觉分块候选为 ${visualRoleHint}`);
        }
        if (screenAssessment?.mode === 'risky') {
            risks.push('当前屏版式风险较高');
        } else if (screenAssessment?.mode === 'watch') {
            risks.push('当前屏版式仍需关注');
        }
        if ((screen.copyPlaceholders?.length || 0) === 0) {
            risks.push('缺少文案位');
        }
        if ((screen.imagePlaceholders?.length || 0) === 0) {
            risks.push('缺少图片区');
        }
        if (visualSummary?.boundaryRisk === 'risky') {
            risks.push('视觉分块与结构边界不一致');
        } else if (visualSummary?.boundaryRisk === 'watch') {
            risks.push('视觉分块边界需要复核');
        }
        if (!keywordRole && structuralRole !== 'unknown' && visualRoleHint && visualRoleHint !== structuralRole) {
            risks.push('结构判断与视觉提示不一致');
        }
        if (requiresModelDecision) {
            risks.push('缺少模型 Agent 对屏幕职责、主信息和素材策略的明确决策');
        }

        const confidenceBase = keywordRole ? 0.82 : structuralRole !== 'unknown' ? 0.68 : 0.4;
        const confidencePenalty = risks.length * 0.08;
        const visualBoost =
            ((visualSummary?.segmentationAgreement || 0) >= 0.65 ? 0.06 : 0)
            + (visualRoleHint && visualRoleHint === screenRole ? 0.04 : 0);
        const visualPenalty =
            visualSummary?.boundaryRisk === 'risky'
                ? 0.12
                : visualSummary?.boundaryRisk === 'watch'
                    ? 0.05
                    : 0;
        const confidence = clamp01(confidenceBase + visualBoost - confidencePenalty - visualPenalty, 0.4);

        return {
            screenId: screen.id,
            screenName: screen.name,
            screenType: screen.type,
            screenRole,
            mainMessage: agentDecision?.mainMessage || getPendingMainMessage(),
            supportingPoints: agentDecision?.supportingPoints || getPendingSupportingPoints(),
            supportRefs: agentDecision?.supportRefs || [],
            copyStrategy: agentDecision?.copyStrategy || getPlanCopyStrategy(screenRole),
            imageStrategy: agentDecision?.imageStrategy || getPlanImageStrategy(screenRole),
            visualPriority: agentDecision?.visualPriority || getPlanVisualPriority(screenRole, screenAssessment, visualSummary),
            decisionSource,
            requiresModelDecision,
            agentDecision: agentDecision || undefined,
            structuralSignals: {
                keywordRole,
                structuralRole,
                visualRoleHint,
                reasons: structuralReasons
            },
            confidence,
            risks,
            visualSummary
        };
    });
}
