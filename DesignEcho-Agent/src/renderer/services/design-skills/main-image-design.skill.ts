import type { AgentContext } from '../unified-agent.service';
import type { DesignProjectState } from '../../../shared/types/design-project-state.types';
import { buildDesignIntent, buildDesignPlan } from '../skill-executors/design-plan';
import {
    collectDesignContext,
    createPipeline,
    getDeltaArrow,
    type CritiqueResult,
    type DesignContext
} from '../skill-executors/design-pipeline';
import { createTracer, extractPlanSteps, getStepParams } from '../skill-executors/plan-helpers';
import { getMainImageSpec, getPlatformRules, type MainImageSpec, type PlatformRules } from '../skill-executors/main-image-config';
import {
    MAIN_IMAGE_DELIVERY_DOCUMENTS,
    MAIN_IMAGE_WHITE_BACKGROUND_SPEC,
    type MainImageDeliveryDocumentSpec,
    type MainImageDeliverableImageType
} from '../../../shared/main-image-design-core';
import {
    buildMainImageStateContext,
    mergeMainImageStateCopyCandidates,
    type MainImageStateContext
} from '../../../shared/main-image-state-consumption';

export const MAIN_IMAGE_DEFAULT_SIZE_KEYS = MAIN_IMAGE_DELIVERY_DOCUMENTS.map((doc) => doc.folderKey);

export const MAIN_IMAGE_SIZE_KEY_ALIASES: Record<string, string> = {
    '1:1': '800',
    '1x1': '800',
    'tmall-1x1-main-image': '800',
    'tmall-800-main-image': '800',
    '800x800': '800',
    '1440x1440': '800',
    '方图': '800',
    '方形': '800',
    '3:4': '750',
    '3x4': '750',
    'tmall-3x4-main-image': '750',
    'tmall-750-main-image': '750',
    '750x1000': '750',
    '1440x1920': '750',
    '竖图': '750',
    '竖版': '750',
    '9:16': '1200',
    '9x16': '1200',
    'tmall-9x16-main-image': '1200',
    'tmall-9:16-main-image': '1200',
    'tmall-1200-main-image': '1200',
    '1200x1920': '1200',
    '1440x2560': '1200',
    '长图': '1200',
    '长竖图': '1200',
};

function buildMainImageSizeSpecs(): Record<string, { width: number; height: number }> {
    const specs: Record<string, { width: number; height: number }> = {};
    for (const doc of MAIN_IMAGE_DELIVERY_DOCUMENTS) {
        const spec = { width: doc.canvasSize.width, height: doc.canvasSize.height };
        specs[doc.folderKey] = spec;
        specs[doc.ratio] = spec;
    }
    return specs;
}

export const MAIN_IMAGE_SIZE_SPECS: Record<string, { width: number; height: number }> = buildMainImageSizeSpecs();

function normalizeMainImageSizeKey(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const compact = raw.replace(/\s+/g, '').replace(/：/g, ':').toLowerCase();
    return MAIN_IMAGE_SIZE_KEY_ALIASES[compact] || MAIN_IMAGE_SIZE_KEY_ALIASES[raw] || raw;
}

export function resolveMainImageSizeKeys(params?: {
    size?: unknown;
    sizes?: unknown;
} | null): string[] {
    const sizes = Array.isArray(params?.sizes)
        ? params?.sizes
        : [];
    const explicit = sizes.length > 0
        ? sizes
        : (params?.size ? [params.size] : []);
    const source = explicit.length > 0 ? explicit : MAIN_IMAGE_DEFAULT_SIZE_KEYS;
    const resolved = source
        .map(normalizeMainImageSizeKey)
        .filter((key) => Boolean(MAIN_IMAGE_SIZE_SPECS[key]));
    return Array.from(new Set(resolved));
}

export function getMainImageDeliveryDocument(sizeKey: unknown): MainImageDeliveryDocumentSpec | null {
    const key = normalizeMainImageSizeKey(sizeKey);
    return MAIN_IMAGE_DELIVERY_DOCUMENTS.find((doc) => doc.folderKey === key || doc.ratio === key) || null;
}

function getMainImageExportSubfolder(sizeKey: unknown): string {
    const documentSpec = getMainImageDeliveryDocument(sizeKey);
    return documentSpec?.exportFolder.replace(/\//g, '\\') || '主图';
}

function isMainImageTypeIncludedForSize(sizeKey: unknown, imageType: string): boolean {
    const documentSpec = getMainImageDeliveryDocument(sizeKey);
    if (!documentSpec) return true;
    return documentSpec.includedImageTypes.includes(imageType as MainImageDeliverableImageType);
}

export interface PlanExecutionFlags {
    useSubjectDetection: boolean;
    useSmartLayout: boolean;
    useQuickExport: boolean;
}

export interface MainImageCopyResult {
    candidates: string[];
    degraded: boolean;
    raw: unknown;
    stateCandidateCount?: number;
}

export interface MainImagePreparedContext {
    tracer: ReturnType<typeof createTracer>;
    planFlags: PlanExecutionFlags;
    mainImageSpec: MainImageSpec | null;
    platformRules: PlatformRules | null;
    copyResult: MainImageCopyResult | null;
    mainImageStateContext: MainImageStateContext;
    mainImageSpecRatio: { min: number; max: number } | null;
    subjectBoundsStepParams: Record<string, unknown>;
    smartLayoutStepParams: Record<string, unknown>;
    quickExportStepParams: Record<string, unknown>;
}

export interface MainImageDesignPipelineContext {
    designContext: DesignContext;
    pipeline: ReturnType<typeof createPipeline>;
}

export interface MainImageSizeResult {
    key: string;
    scale: number;
    aestheticUsed: boolean;
    reason?: string;
}

export interface MainImageSizeExecutionPlan {
    scale: number;
    targetX: number;
    targetY: number;
    decisionReason: string;
    layoutCandidateScore?: number;
    layoutCandidateReason?: string;
    smartLayoutPayload: Record<string, unknown> | null;
    quickExportPayload: Record<string, unknown> | null;
}

export function buildMainImageFallbackLayout(
    canvas: { width: number; height: number },
    subject: { width: number; height: number },
    productScale: number,
    verticalOffset: number
): { scale: number; targetX: number; targetY: number } {
    const targetW = canvas.width * productScale;
    const targetH = canvas.height * productScale;
    const scale = Math.min(targetW / subject.width, targetH / subject.height);
    const scaledW = subject.width * scale;
    const scaledH = subject.height * scale;
    return {
        scale,
        targetX: (canvas.width - scaledW) / 2,
        targetY: (canvas.height - scaledH) / 2 + canvas.height * verticalOffset,
    };
}

function scoreLayoutCandidate(
    candidate: { scale: number; targetX: number; targetY: number },
    canvas: { width: number; height: number },
    subject: { width: number; height: number },
    preferredFill: number
): number {
    const scaledW = subject.width * candidate.scale;
    const scaledH = subject.height * candidate.scale;

    const fill = Math.max(scaledW / canvas.width, scaledH / canvas.height);
    const fillScore = 100 - Math.min(80, Math.abs(fill - preferredFill) * 220);

    const idealX = (canvas.width - scaledW) / 2;
    const centerPenalty = Math.min(30, Math.abs(candidate.targetX - idealX) / Math.max(1, canvas.width) * 100);

    const top = candidate.targetY;
    const bottom = candidate.targetY + scaledH;
    const safeTop = canvas.height * 0.04;
    const safeBottom = canvas.height * 0.97;
    let safePenalty = 0;
    if (top < safeTop) safePenalty += (safeTop - top) / Math.max(1, canvas.height) * 160;
    if (bottom > safeBottom) safePenalty += (bottom - safeBottom) / Math.max(1, canvas.height) * 160;

    return Math.max(0, Math.min(100, fillScore - centerPenalty - safePenalty));
}

export function chooseMainImageLayoutCandidate(
    base: { scale: number; targetX: number; targetY: number },
    canvas: { width: number; height: number },
    subject: { width: number; height: number },
    preferredFill: number,
    verticalOffset: number
): { scale: number; targetX: number; targetY: number; score: number; reason: string } {
    const scaleMultipliers = [0.9, 0.95, 1, 1.05, 1.1];
    const offsetAdjustments = [-0.03, -0.015, 0, 0.015, 0.03];

    let best = {
        ...base,
        score: scoreLayoutCandidate(base, canvas, subject, preferredFill),
        reason: 'fallback-base',
    };

    for (const sm of scaleMultipliers) {
        const scale = Math.max(0.1, base.scale * sm);
        const scaledW = subject.width * scale;
        const scaledH = subject.height * scale;
        const targetX = (canvas.width - scaledW) / 2;

        for (const dy of offsetAdjustments) {
            const targetY = (canvas.height - scaledH) / 2 + canvas.height * (verticalOffset + dy);
            const score = scoreLayoutCandidate({ scale, targetX, targetY }, canvas, subject, preferredFill);
            if (score > best.score) {
                best = { scale, targetX, targetY, score, reason: `sm=${sm.toFixed(2)}, dy=${dy.toFixed(3)}` };
            }
        }
    }

    return best;
}

function getMainImageTypeLabel(imageType: string): string {
    if (imageType === 'click') return '点击型主图';
    if (imageType === 'conversion') return '转化型主图';
    return '主图';
}

export async function prepareMainImageDesignPipeline(params: {
    userIntent?: string;
    callbacks?: any;
}): Promise<MainImageDesignPipelineContext> {
    const designContext = await collectDesignContext({
        platform: 'ecommerce',
        userIntent: params.userIntent
    });
    const pipeline = createPipeline(designContext, { onMessage: params.callbacks?.onMessage });
    return { designContext, pipeline };
}

export function buildMainImageExecutionSummary(params: {
    sizeResults: MainImageSizeResult[];
    imageType: string;
    outputDir?: string;
    copyResult?: MainImageCopyResult | null;
    critiqueResult?: CritiqueResult | null;
}): string[] {
    const summary = ['**主图设计结果已汇总**', ''];

    for (const sr of params.sizeResults) {
        const resolvedKey = normalizeMainImageSizeKey(sr.key);
        const spec = MAIN_IMAGE_SIZE_SPECS[resolvedKey];
        if (!spec) continue;
        summary.push(
            `**${resolvedKey}** (${spec.width}x${spec.height})：缩放 ${Math.round(sr.scale * 100)}%${sr.reason ? ` - ${sr.reason}` : ''}`
        );
    }

    summary.push('', `**图片类型** ${getMainImageTypeLabel(params.imageType)}`);
    if (params.outputDir) {
        summary.push(`**导出目录** ${params.outputDir}\\主图`);
    }
    summary.push(
        `**交付结构** ${MAIN_IMAGE_DEFAULT_SIZE_KEYS.join('/')}；1200 只导出点击图，不导出转化图。`,
        `**白底图** ${MAIN_IMAGE_WHITE_BACKGROUND_SPEC.sourceDocumentPath} -> ${MAIN_IMAGE_WHITE_BACKGROUND_SPEC.outputPath}`
    );

    if (params.copyResult?.candidates?.length) {
        summary.push('', '**文案建议**');
        params.copyResult.candidates.forEach((copy, index) => {
            summary.push(`${index + 1}. ${copy}`);
        });
    }

    if (params.critiqueResult) {
        const arrow = getDeltaArrow(params.critiqueResult.delta);
        summary.push(
            '',
            `**验收评分** ${params.critiqueResult.beforeScore} -> ${params.critiqueResult.afterScore} (${arrow}${Math.abs(params.critiqueResult.delta)})`
        );
    }

    return summary;
}

export function buildMainImageSizeExecutionPlan(params: {
    sizeKey: string;
    targetSize: { width: number; height: number };
    subjectSize: { width: number; height: number };
    userProductScale?: number;
    verticalOffset?: number;
    imageType: string;
    outputDir?: string;
    layoutSearch?: boolean;
    mainImageSpecRatio?: { min: number; max: number } | null;
    planFlags: PlanExecutionFlags;
    smartLayoutStepParams?: Record<string, unknown>;
    quickExportStepParams?: Record<string, unknown>;
}): MainImageSizeExecutionPlan {
    const verticalOffset = params.verticalOffset ?? -0.03;
    let scale: number;
    let targetX: number;
    let targetY: number;
    let decisionReason = '';
    let layoutCandidateScore: number | undefined;
    let layoutCandidateReason: string | undefined;

    if (params.userProductScale !== undefined) {
        const fallback = buildMainImageFallbackLayout(
            params.targetSize,
            params.subjectSize,
            params.userProductScale,
            verticalOffset
        );
        scale = fallback.scale;
        targetX = fallback.targetX;
        targetY = fallback.targetY;
        decisionReason = `用户指定缩放 ${Math.round(params.userProductScale * 100)}%`;
    } else {
        const activeRatio = params.mainImageSpecRatio || null;
        const defaultScale = activeRatio ? (activeRatio.min + activeRatio.max) / 2 : 0.65;
        const fallback = buildMainImageFallbackLayout(
            params.targetSize,
            params.subjectSize,
            defaultScale,
            verticalOffset
        );
        scale = fallback.scale;
        targetX = fallback.targetX;
        targetY = fallback.targetY;
        decisionReason = activeRatio
            ? `主图规则建议缩放 ${Math.round(defaultScale * 100)}%`
            : '默认居中，主体占比 65%';
    }

    if (params.layoutSearch !== false) {
        const preferredFill = params.userProductScale
            ?? (params.mainImageSpecRatio ? (params.mainImageSpecRatio.min + params.mainImageSpecRatio.max) / 2 : 0.65);
        const best = chooseMainImageLayoutCandidate(
            { scale, targetX, targetY },
            params.targetSize,
            params.subjectSize,
            preferredFill,
            verticalOffset
        );
        scale = best.scale;
        targetX = best.targetX;
        targetY = best.targetY;
        layoutCandidateScore = best.score;
        layoutCandidateReason = best.reason;
    }

    const smartLayoutStepParams = (params.smartLayoutStepParams || {}) as Record<string, unknown>;
    const smartLayoutPayload = params.planFlags.useSmartLayout
        ? {
            ...smartLayoutStepParams,
            action: typeof smartLayoutStepParams.action === 'string' ? smartLayoutStepParams.action : 'applyLayout',
            targetBounds: { left: 0, top: 0, width: params.targetSize.width, height: params.targetSize.height },
            config: {
                fillRatio: Math.max(0.5, Math.min(0.95,
                    (scale * Math.max(params.subjectSize.width, params.subjectSize.height))
                    / Math.max(params.targetSize.width, params.targetSize.height)
                )),
                alignment: 'center',
                maintainAspectRatio: true,
                ...((typeof smartLayoutStepParams.config === 'object' && smartLayoutStepParams.config) ? smartLayoutStepParams.config as Record<string, unknown> : {})
            }
        }
        : null;

    const quickExportStepParams = (params.quickExportStepParams || {}) as Record<string, unknown>;
    const { subfolder: exportSub, fileNamePattern: exportPattern, ...quickExportToolParams } = quickExportStepParams;
    const format = typeof quickExportToolParams.format === 'string' ? quickExportToolParams.format : 'jpg';
    const quality = typeof quickExportToolParams.quality === 'number' ? quickExportToolParams.quality : 12;
    const subfolder = typeof exportSub === 'string' && exportSub.trim() ? exportSub : getMainImageExportSubfolder(params.sizeKey);
    const pattern = typeof exportPattern === 'string' && exportPattern.trim() ? exportPattern : 'main-image_{size}_{imageType}.{format}';
    const resolvedSizeKey = normalizeMainImageSizeKey(params.sizeKey) || params.sizeKey;
    const fileName = pattern.replace('{size}', resolvedSizeKey).replace('{imageType}', params.imageType).replace('{format}', format);
    const quickExportAllowed = isMainImageTypeIncludedForSize(params.sizeKey, params.imageType);
    if (!quickExportAllowed) {
        decisionReason = `${decisionReason}；${resolvedSizeKey} 不导出 ${params.imageType}。`;
    }
    const quickExportPayload = params.outputDir && params.planFlags.useQuickExport && quickExportAllowed
        ? {
            ...quickExportToolParams,
            format,
            quality,
            outputPath: `${params.outputDir}\\${subfolder}\\${fileName}`
        }
        : null;

    return {
        scale,
        targetX,
        targetY,
        decisionReason,
        layoutCandidateScore,
        layoutCandidateReason,
        smartLayoutPayload,
        quickExportPayload
    };
}

function normalizeCopyTexts(source: unknown): string[] {
    if (!source) return [];

    if (typeof source === 'string') {
        const trimmed = source.trim();
        if (!trimmed) return [];
        const lines = trimmed
            .split(/\n+/)
            .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
            .filter(Boolean);
        return lines.length > 0 ? lines : [trimmed];
    }

    if (Array.isArray(source)) {
        return source.flatMap(item => normalizeCopyTexts(item));
    }

    if (typeof source === 'object') {
        const record = source as Record<string, unknown>;
        for (const key of ['suggestions', 'candidates', 'versions', 'choices', 'texts', 'data', 'result', 'text', 'content']) {
            if (key in record) {
                const values = normalizeCopyTexts(record[key]);
                if (values.length > 0) return values;
            }
        }
    }

    return [];
}

async function generateMainImageCopySuggestions(
    params: Record<string, any>,
    helpers: {
        mainImageSpec?: MainImageSpec | null;
        platform?: string;
        mainImageStateContext?: MainImageStateContext | null;
    },
    callbacks?: any
): Promise<MainImageCopyResult | null> {
    try {
        const count = Math.max(1, Math.min(5, Number(params.copyCount) || 3));
        const creativeStyle = String(params.creativeStyle || 'natural');
        const productName = String(params.productName || params.subjectName || params.productCategory || '').trim();
        const imageType = String(params.imageType || helpers.mainImageSpec?.imageType || 'main-image').trim();
        const userIntent = String(params.userIntent || '').trim();
        const lockedKeywords = String(params.lockedKeywords || '').trim();
        const stateContext = helpers.mainImageStateContext || null;
        const stateCandidates = stateContext?.copyCandidates || [];
        const sections = Array.isArray(helpers.mainImageSpec?.requiredSections)
            ? helpers.mainImageSpec.requiredSections.slice(0, 3)
            : [];

        const prompt = [
            'Generate short e-commerce main image copy options that can be placed directly on the canvas.',
            productName ? `Product: ${productName}` : '',
            `Image type: ${imageType}`,
            helpers.platform ? `Platform: ${helpers.platform}` : '',
            userIntent ? `Design goal: ${userIntent}` : '',
            stateContext?.targetUser ? `Target user from project state: ${stateContext.targetUser}` : '',
            stateContext?.visualDirection ? `Visual direction from project state: ${stateContext.visualDirection}` : '',
            stateCandidates.length > 0 ? `Project-state copy candidates: ${stateCandidates.slice(0, 5).join(' / ')}` : '',
            sections.length > 0 ? `Suggested structure: ${sections.join(', ')}` : '',
            lockedKeywords ? `Keep keywords when possible: ${lockedKeywords}` : '',
            `Style: ${creativeStyle}`,
            `Version count: ${count}`,
            'Requirements: 8-18 characters preferred, short phrases first, low ad tone, and every line must be visually supportable by the image.'
        ].filter(Boolean).join('\n\n');

        const raw = await window.designEcho?.invoke?.('task:execute', 'text-optimize', {
            text: prompt,
            context: {
                source: 'main-image-design',
                imageType,
                productName,
                creativeStyle,
                lockedKeywords
            }
        });

        const generatedCandidates = Array.from(new Set(
            normalizeCopyTexts(raw)
                .map(item => item.trim())
                .filter(Boolean)
        )).slice(0, count);
        const candidates = mergeMainImageStateCopyCandidates(generatedCandidates, stateContext, count);
        if (candidates.length > 0) {
            callbacks?.onMessage?.('已生成一组主图文案方向。');
            return { candidates, degraded: false, raw, stateCandidateCount: stateCandidates.length };
        }
    } catch (error) {
        console.warn('[MainImageDesignSkill] Failed to generate copy suggestions', error);
    }

    const stateOnlyCandidates = mergeMainImageStateCopyCandidates([], helpers.mainImageStateContext || null, Math.max(1, Math.min(5, Number(params.copyCount) || 3)));
    if (stateOnlyCandidates.length > 0) {
        return {
            candidates: stateOnlyCandidates,
            degraded: false,
            raw: null,
            stateCandidateCount: helpers.mainImageStateContext?.copyCandidates.length || 0
        };
    }

    return null;
}

export async function prepareMainImageDesignSkillContext(params: {
    skillId: string;
    input: Record<string, any>;
    context?: AgentContext;
    callbacks?: any;
    designProjectState?: DesignProjectState | null;
}): Promise<MainImagePreparedContext> {
    const { skillId, input, context, callbacks } = params;
    const designIntent = buildDesignIntent(skillId, input, context);
    const designPlan = buildDesignPlan(designIntent);
    const { steps, stepMap, has } = extractPlanSteps(designPlan);
    const tracer = createTracer(steps);

    const planFlags: PlanExecutionFlags = {
        useSubjectDetection: has('getSubjectBounds'),
        useSmartLayout: has('smartLayout'),
        useQuickExport: has('quickExport'),
    };

    const subjectBoundsStepParams = getStepParams(stepMap, 'getSubjectBounds');
    const smartLayoutStepParams = getStepParams(stepMap, 'smartLayout');
    const quickExportStepParams = getStepParams(stepMap, 'quickExport');

    const platform = (input.platform || 'taobao') as string;
    const imageType = input.imageType || 'click';
    const mainImageStateContext = buildMainImageStateContext({
        state: params.designProjectState || null,
        imageType: String(imageType),
        requestedVersionCount: input.compositionVersionCount || input.versionCount
    });
    const mainImageSpec = await getMainImageSpec(String(imageType), platform);
    const mainImageSpecRatio = !input.productScale && mainImageSpec?.productRatio
        ? mainImageSpec.productRatio
        : null;
    if (mainImageSpec) {
        callbacks?.onMessage?.('主图规范类型：' + mainImageSpec.imageType);
        if (mainImageSpec.requiredSections?.length) {
            callbacks?.onMessage?.('必需区域：' + mainImageSpec.requiredSections.join(', '));
        }
        if (mainImageSpec.recommendedSections?.length) {
            callbacks?.onMessage?.('推荐区域：' + mainImageSpec.recommendedSections.join(', '));
        }
    }

    const platformRules = await getPlatformRules(platform);
    const copyResult = input.generateCopy !== false
        ? await generateMainImageCopySuggestions(input, { mainImageSpec, platform, mainImageStateContext }, callbacks)
        : null;

    if (platformRules?.rules?.length) {
        callbacks?.onMessage?.('平台规则：' + platformRules.rules.slice(0, 2).join(', '));
    }

    return {
        tracer,
        planFlags,
        mainImageSpec,
        platformRules,
        copyResult,
        mainImageStateContext,
        mainImageSpecRatio,
        subjectBoundsStepParams,
        smartLayoutStepParams,
        quickExportStepParams
    };
}
