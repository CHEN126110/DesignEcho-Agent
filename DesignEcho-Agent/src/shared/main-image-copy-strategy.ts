import {
    buildCopywritingContextChecklist,
    COPYWRITING_SAFETY_RULES,
    COPYWRITING_TEMPLATES,
    type CopywritingTemplateId
} from './design-copywriting-framework';
import type {
    MainImageProjectStyleStrategy,
    MainImageVariantDirection
} from './main-image-project-style-strategy';

export type MainImageCopyStrategyStatus =
    | 'blocked_missing_project_style_strategy'
    | 'blocked_missing_visual_context'
    | 'needs_copy_candidates'
    | 'ready_copy_strategy';

export type MainImageCopyCandidateRole =
    | 'click-headline'
    | 'conversion-benefit'
    | 'supporting-note';

export interface MainImageCopyCandidate {
    id: string;
    role: MainImageCopyCandidateRole;
    text: string;
    targetImageType: 'click' | 'conversion';
    supportNotes: string[];
    safetyNotes: string[];
}

export interface MainImageTextSlotPlan {
    id: string;
    role: MainImageCopyCandidateRole;
    targetImageType: 'click' | 'conversion';
    maxLines: number;
    maxChars: number;
    priority: 'primary' | 'secondary';
    fitPolicy: string;
}

export interface MainImageProductCopyContext {
    productType: string;
    subjectSummary: string;
    visualAnchors: string[];
    productFacts: string[];
    userScenes: string[];
    userProblems: string[];
    referenceNotes: string[];
}

export interface MainImageCopyStrategy {
    version: 'main-image-copy-strategy/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageCopyStrategyStatus;
    productCopyContext: MainImageProductCopyContext;
    contextChecklist: ReturnType<typeof buildCopywritingContextChecklist>;
    recommendedTemplates: Array<{
        id: CopywritingTemplateId;
        name: string;
        reason: string;
    }>;
    candidates: MainImageCopyCandidate[];
    textSlotPlan: MainImageTextSlotPlan[];
    strategyInputPatch: {
        copyRolePolicy?: Record<string, unknown>;
    };
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildMainImageCopyStrategyInput {
    userText?: string;
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
    copyCandidates?: string[];
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function isVisualContextReady(styleStrategy: MainImageProjectStyleStrategy | null | undefined): boolean {
    return styleStrategy?.status === 'ready_visual_context'
        && styleStrategy.projectStyleUnderstanding.semanticStatus === 'visual_context_ready';
}

function buildVisualAnchors(styleStrategy: MainImageProjectStyleStrategy | null | undefined): string[] {
    if (!isVisualContextReady(styleStrategy)) return [];
    return uniqueClean([
        styleStrategy?.projectStyleUnderstanding.subjectSummary,
        ...styleStrategy?.designDirection.styleKeywords || []
    ]);
}

function buildProductFacts(styleStrategy: MainImageProjectStyleStrategy | null | undefined): string[] {
    if (!isVisualContextReady(styleStrategy)) return [];
    const productType = cleanString(styleStrategy?.projectStyleUnderstanding.productType);
    const subjectSummary = cleanString(styleStrategy?.projectStyleUnderstanding.subjectSummary);
    const selectedAssetName = cleanString(styleStrategy?.projectStyleUnderstanding.selectedAssetName);
    return uniqueClean([
        productType && `品类：${productType}`,
        subjectSummary && `画面事实：${subjectSummary}`,
        selectedAssetName && `素材：${selectedAssetName}`
    ]);
}

function buildUserScenes(input: {
    userText: string;
    styleStrategy?: MainImageProjectStyleStrategy | null;
}): string[] {
    const combined = [
        input.userText,
        input.styleStrategy?.projectStyleUnderstanding.subjectSummary,
        ...input.styleStrategy?.designDirection.styleKeywords || []
    ].map(cleanString).join(' ');
    const scenes: string[] = [];
    if (/春夏|夏天|清爽|透气|轻薄/.test(combined)) scenes.push('春夏日常穿搭');
    if (/通勤|日常|出行|好搭|搭配/.test(combined)) scenes.push('通勤和日常出行');
    if (/上脚|模特|穿搭/.test(combined)) scenes.push('上脚搭配场景');
    return uniqueClean(scenes.length ? scenes : ['日常穿搭场景']);
}

function buildUserProblems(input: {
    userText: string;
    styleStrategy?: MainImageProjectStyleStrategy | null;
}): string[] {
    const combined = [
        input.userText,
        input.styleStrategy?.projectStyleUnderstanding.subjectSummary,
        ...input.styleStrategy?.designDirection.styleKeywords || []
    ].map(cleanString).join(' ');
    const problems: string[] = [];
    if (/透气|清爽|轻薄|春夏/.test(combined)) problems.push('担心春夏穿袜闷热');
    if (/柔软|袜口|不勒|罗口|木耳|花边|卷边/.test(combined)) problems.push('担心袜口勒脚或细节不舒服');
    if (/好搭|搭配|通勤|日常|堆堆|松弛/.test(combined)) problems.push('希望日常搭配轻松好看');
    return uniqueClean(problems);
}

function buildReferenceNotes(styleStrategy: MainImageProjectStyleStrategy | null | undefined): string[] {
    return uniqueClean((styleStrategy?.referenceResearchPlan.references || []).map((reference) => (
        [
            reference.title,
            reference.source,
            reference.note
        ].map(cleanString).filter(Boolean).join(' / ')
    )));
}

function inferRecommendedTemplateIds(context: MainImageProductCopyContext): CopywritingTemplateId[] {
    const combined = [
        context.subjectSummary,
        ...context.visualAnchors,
        ...context.userScenes,
        ...context.userProblems
    ].join(' ');
    const ids: CopywritingTemplateId[] = ['visual-carry'];
    if (/日常|通勤|出行|春夏|上脚/.test(combined)) ids.push('scene-empathy');
    if (context.userProblems.length > 0) ids.push('pain-relief');
    if (/透气|轻薄|柔软|不勒/.test(combined)) ids.push('function-benefit');
    return Array.from(new Set(ids)).slice(0, 4);
}

function buildRecommendedTemplates(context: MainImageProductCopyContext): MainImageCopyStrategy['recommendedTemplates'] {
    const ids = inferRecommendedTemplateIds(context);
    return ids
        .map((id) => COPYWRITING_TEMPLATES.find((template) => template.id === id))
        .filter((template): template is NonNullable<typeof template> => Boolean(template))
        .map((template) => ({
            id: template.id,
            name: template.name,
            reason: template.suitableFor
        }));
}

function getVariantFallback(
    styleStrategy: MainImageProjectStyleStrategy | null | undefined,
    imageType: 'click' | 'conversion'
): MainImageVariantDirection | undefined {
    const variants = imageType === 'click'
        ? styleStrategy?.variantPlan.clickImages
        : styleStrategy?.variantPlan.conversionImages;
    return variants?.[0];
}

function getCandidateRole(index: number): MainImageCopyCandidateRole {
    if (index === 0) return 'click-headline';
    if (index === 1) return 'conversion-benefit';
    return 'supporting-note';
}

function getTargetImageType(role: MainImageCopyCandidateRole): 'click' | 'conversion' {
    return role === 'click-headline' ? 'click' : 'conversion';
}

function buildCandidateSupport(input: {
    role: MainImageCopyCandidateRole;
    context: MainImageProductCopyContext;
    variant?: MainImageVariantDirection;
}): string[] {
    return uniqueClean([
        ...input.context.productFacts,
        ...input.context.visualAnchors.map((anchor) => `视觉锚点：${anchor}`),
        ...input.context.userScenes.map((scene) => `使用场景：${scene}`),
        ...input.context.userProblems.map((problem) => `用户顾虑：${problem}`),
        input.variant?.objective && `变体目标：${input.variant.objective}`,
        input.variant?.copyRole && `文案角色：${input.variant.copyRole}`
    ]).slice(0, 8);
}

function buildCandidates(input: {
    styleStrategy?: MainImageProjectStyleStrategy | null;
    context: MainImageProductCopyContext;
    copyCandidates: string[];
    status: MainImageCopyStrategyStatus;
}): MainImageCopyCandidate[] {
    if (input.status !== 'ready_copy_strategy') return [];
    return input.copyCandidates.slice(0, 8).map((candidate, index) => {
        const role = getCandidateRole(index);
        const targetImageType = getTargetImageType(role);
        const variant = getVariantFallback(input.styleStrategy, targetImageType);
        return {
            id: `${role}-${index + 1}`,
            role,
            text: cleanString(candidate),
            targetImageType,
            supportNotes: buildCandidateSupport({ role, context: input.context, variant }),
            safetyNotes: COPYWRITING_SAFETY_RULES.map((rule) => rule.saferDirection).slice(0, 3)
        };
    });
}

function buildTextSlotPlan(): MainImageTextSlotPlan[] {
    return [
        {
            id: 'click-headline-slot',
            role: 'click-headline',
            targetImageType: 'click',
            maxLines: 2,
            maxChars: 18,
            priority: 'primary',
            fitPolicy: '短标题优先，超过字数进入改写或缩小字号复核，不允许遮挡主体。'
        },
        {
            id: 'conversion-benefit-slot',
            role: 'conversion-benefit',
            targetImageType: 'conversion',
            maxLines: 3,
            maxChars: 28,
            priority: 'primary',
            fitPolicy: '一图一个购买理由，必须能被商品事实或画面观察支撑。'
        },
        {
            id: 'supporting-note-slot',
            role: 'supporting-note',
            targetImageType: 'conversion',
            maxLines: 2,
            maxChars: 22,
            priority: 'secondary',
            fitPolicy: '只放辅助说明或细节，不写无依据承诺。'
        }
    ];
}

function buildContext(input: {
    userText: string;
    styleStrategy?: MainImageProjectStyleStrategy | null;
}): MainImageProductCopyContext {
    const productType = isVisualContextReady(input.styleStrategy)
        ? cleanString(input.styleStrategy?.projectStyleUnderstanding.productType) || 'unknown'
        : 'unknown';
    const subjectSummary = isVisualContextReady(input.styleStrategy)
        ? cleanString(input.styleStrategy?.projectStyleUnderstanding.subjectSummary) || 'unknown'
        : 'unknown';
    return {
        productType,
        subjectSummary,
        visualAnchors: buildVisualAnchors(input.styleStrategy),
        productFacts: buildProductFacts(input.styleStrategy),
        userScenes: isVisualContextReady(input.styleStrategy)
            ? buildUserScenes({ userText: input.userText, styleStrategy: input.styleStrategy })
            : [],
        userProblems: isVisualContextReady(input.styleStrategy)
            ? buildUserProblems({ userText: input.userText, styleStrategy: input.styleStrategy })
            : [],
        referenceNotes: buildReferenceNotes(input.styleStrategy)
    };
}

function resolveStatus(input: {
    styleStrategy?: MainImageProjectStyleStrategy | null;
    copyCandidates: string[];
}): MainImageCopyStrategyStatus {
    if (!input.styleStrategy) return 'blocked_missing_project_style_strategy';
    if (!isVisualContextReady(input.styleStrategy)) return 'blocked_missing_visual_context';
    if (input.copyCandidates.length === 0) return 'needs_copy_candidates';
    return 'ready_copy_strategy';
}

function buildBlockers(status: MainImageCopyStrategyStatus): string[] {
    if (status === 'blocked_missing_project_style_strategy') return ['main_image_project_style_strategy_required'];
    if (status === 'blocked_missing_visual_context') return ['main_image_visual_context_required_for_copy'];
    return [];
}

function buildWarnings(input: {
    status: MainImageCopyStrategyStatus;
    context: MainImageProductCopyContext;
    copyCandidateCount: number;
}): string[] {
    const warnings: string[] = [];
    if (input.status === 'needs_copy_candidates') {
        warnings.push('已有视觉和商品事实，但缺少可写入的候选文案；只能保留文字槽位或进入文案生成步骤。');
    }
    if (input.context.referenceNotes.length === 0) {
        warnings.push('没有参考来源记录；可生成本地文案策略，但不能声称已经参考竞品案例。');
    }
    if (input.context.userProblems.length === 0) {
        warnings.push('没有明确痛点依据；转化图文案只能写视觉事实或请求补充卖点。');
    }
    if (input.copyCandidateCount === 0) {
        warnings.push('缺少候选文案；不得临场编造强卖点。');
    }
    return warnings;
}

function buildStrategyInputPatch(input: {
    status: MainImageCopyStrategyStatus;
    context: MainImageProductCopyContext;
    recommendedTemplates: MainImageCopyStrategy['recommendedTemplates'];
    candidates: MainImageCopyCandidate[];
    textSlotPlan: MainImageTextSlotPlan[];
}): MainImageCopyStrategy['strategyInputPatch'] {
    return {
        copyRolePolicy: {
            copyStrategyStatus: input.status,
            copyCandidateCount: input.candidates.length,
            claimCount: input.context.productFacts.length + input.context.userProblems.length,
            referenceCount: input.context.referenceNotes.length,
            recommendedTemplateIds: input.recommendedTemplates.map((template) => template.id),
            textSlotRoles: input.textSlotPlan.map((slot) => slot.role),
            productCopyContext: input.context,
            candidateSupport: input.candidates.map((candidate) => ({
                id: candidate.id,
                role: candidate.role,
                targetImageType: candidate.targetImageType,
                supportNoteCount: candidate.supportNotes.length
            })),
            boundary: 'copy strategy can guide editable text slots, but does not write text layers or prove final copy quality'
        }
    };
}

export function buildMainImageCopyStrategy(
    input: BuildMainImageCopyStrategyInput
): MainImageCopyStrategy {
    const userText = cleanString(input.userText);
    const copyCandidates = uniqueClean(input.copyCandidates || []);
    const status = resolveStatus({
        styleStrategy: input.projectStyleStrategy,
        copyCandidates
    });
    const context = buildContext({
        userText,
        styleStrategy: input.projectStyleStrategy
    });
    const contextChecklist = buildCopywritingContextChecklist({
        hasImage: isVisualContextReady(input.projectStyleStrategy),
        hasTargetAudience: context.productType !== 'unknown',
        hasAudienceInterest: context.visualAnchors.length > 0 || context.userScenes.length > 0,
        hasVisualAnchors: context.visualAnchors.length > 0,
        hasProductFacts: context.productFacts.length > 0,
        hasUserScene: context.userScenes.length > 0,
        hasProductProblem: context.userProblems.length > 0
    });
    const recommendedTemplates = buildRecommendedTemplates(context);
    const textSlotPlan = buildTextSlotPlan();
    const candidates = buildCandidates({
        styleStrategy: input.projectStyleStrategy,
        context,
        copyCandidates,
        status
    });
    const blockers = buildBlockers(status);
    const warnings = buildWarnings({
        status,
        context,
        copyCandidateCount: copyCandidates.length
    });

    return {
        version: 'main-image-copy-strategy/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        productCopyContext: context,
        contextChecklist,
        recommendedTemplates,
        candidates,
        textSlotPlan,
        strategyInputPatch: buildStrategyInputPatch({
            status,
            context,
            recommendedTemplates,
            candidates,
            textSlotPlan
        }),
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers,
        warnings,
        limitations: [
            '主图文案策略只整理视觉事实、商品事实、用户场景、痛点和文案槽位，不调用模型。',
            '候选文案必须继续经过文本溢出、遮挡和最终人工/截图复核，不能仅凭策略声明可投放。',
            '参考来源只作为写作方向，不能替代项目摄影图和商品事实。'
        ]
    };
}
