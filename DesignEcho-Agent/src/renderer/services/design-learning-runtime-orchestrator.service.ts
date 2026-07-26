import MemoryService, { getMemoryService } from './memory.service';
import {
    createEagleAssetCandidatesRuntimeApi,
    type EagleAssetCandidatesRuntimeApi
} from './eagle-asset-candidates.service';
import type { EagleReadonlySettings } from '../../shared/eagle-readonly-knowledge';
import { eagleReadonlyKnowledgeToDesignLearningRuntimeReferences } from '../../shared/eagle-design-learning-runtime-provider';
import type {
    DesignLearningDailyResearchPlan,
    DesignLearningReferenceObservation
} from '../../shared/design-learning-experience';
import type { DesignLearningRuntimeReferenceCandidate } from '../../shared/design-learning-runtime-runner';
import type { DesignMemoryItem, DesignMemoryScope } from '../../shared/design-memory-knowledge';
import {
    runDesignLearningRuntimeTriggerService,
    type DesignLearningRuntimeTriggerServiceResult,
    type DesignLearningRuntimeReviewQueue,
    type DesignLearningRuntimeTriggerServiceStorage,
    type RunDesignLearningRuntimeTriggerServiceInput
} from './design-learning-runtime-trigger.service';
import {
    computeSubjectRectFromMask,
    sanitizeDesignLearningVisualCase,
    type DesignLearningVisualCase,
    type DesignLearningVisualCaseSourceKind,
    type NormalizedRect
} from '../../shared/design-learning-visual-case';

export type DesignLearningRuntimeOrchestratorVersion = 'design-learning-runtime-orchestrator-service/v0';

export interface AnalyzeDesignReferenceInput {
    reference: DesignLearningRuntimeReferenceCandidate;
    imagePath: string;
    plan: DesignLearningDailyResearchPlan;
}

export interface DesignLearningRuntimeOrchestratorApi extends EagleAssetCandidatesRuntimeApi {
    invoke?: (channel: string, ...args: any[]) => Promise<any>;
    analyzeDesignReference?: (input: AnalyzeDesignReferenceInput) => Promise<DesignLearningReferenceObservation | undefined>;
    analyzeAssetContent?: (imagePath: string) => Promise<any>;
    /** Eagle 条目按 ID 在主进程解析与看图；Renderer 永远不接收私有路径。 */
    analyzeEagleReferenceById?: (input: {
        itemId: string;
        topics?: string[];
        settings?: Partial<EagleReadonlySettings>;
    }) => Promise<any>;
    /** 取图片预览（路径→base64 data URL），用于视觉案例展示。可选——缺省则不带真实图。 */
    getImagePreview?: (imagePath: string, maxSize?: number) => Promise<{ success?: boolean; imageData?: string; dataUrl?: string; base64?: string; dimensions?: { width: number; height: number } } | undefined>;
    /** 抠图出主体蒙版（用于真实分割标注主体框）。可选——缺省则视觉案例只带原图+三分线，不带主体框。 */
    removeBackgroundMask?: (imageBase64: string) => Promise<{ success?: boolean; maskBuffer?: ArrayLike<number>; maskWidth?: number; maskHeight?: number } | undefined>;
}

export interface RunDesignLearningRuntimeOrchestratorInput
    extends Omit<RunDesignLearningRuntimeTriggerServiceInput, 'sourceProviders' | 'analyzeReference' | 'reviewQueue' | 'storage'> {
    api?: Partial<DesignLearningRuntimeOrchestratorApi> | null;
    memoryService?: MemoryService;
    eagleSettings?: Partial<EagleReadonlySettings>;
    projectImagePaths?: unknown;
    storage?: DesignLearningRuntimeTriggerServiceStorage;
    storageKey?: string;
    reviewQueue?: DesignLearningRuntimeReviewQueue;
    analyzeReference?: RunDesignLearningRuntimeTriggerServiceInput['analyzeReference'];
    sourceProviders?: RunDesignLearningRuntimeTriggerServiceInput['sourceProviders'];
}

export interface DesignLearningRuntimeOrchestratorResult extends DesignLearningRuntimeTriggerServiceResult {
    orchestratorVersion: DesignLearningRuntimeOrchestratorVersion;
    reviewPersistence: {
        enabled: boolean;
        queuedCount: number;
        persistedNeedsReviewCount: number;
    };
    adapters: {
        eagleReadonlyProvider: boolean;
        projectImageProvider: boolean;
        visualAnalysisAdapter: boolean;
        memoryReviewQueue: boolean;
    };
    boundaries: DesignLearningRuntimeTriggerServiceResult['boundaries'] & {
        orchestratesRuntimeOnly: true;
        persistsNeedsReviewMemoryOnly: true;
        doesNotPromoteMemoryWithoutReview: true;
        doesNotAutoSearchEagleOnAppStart: true;
    };
}

const VERSION: DesignLearningRuntimeOrchestratorVersion = 'design-learning-runtime-orchestrator-service/v0';
const DEFAULT_LAST_RUN_STORAGE_KEY = 'designecho:design-learning:last-run-at';

export function createDesignLearningRuntimeOrchestratorApi(
    source?: Partial<DesignLearningRuntimeOrchestratorApi> | null
): DesignLearningRuntimeOrchestratorApi {
    const eagleApi = createEagleAssetCandidatesRuntimeApi(source || undefined);
    const runtimeApi: Partial<DesignLearningRuntimeOrchestratorApi> = typeof window === 'undefined'
        ? {}
        : (window.designEcho || {}) as Partial<DesignLearningRuntimeOrchestratorApi>;
    const runtimeAnalyzeDesignReference = typeof runtimeApi.analyzeDesignReference === 'function'
        ? async (input: AnalyzeDesignReferenceInput) => runtimeApi.analyzeDesignReference!({
            ...input,
            imagePath: input.imagePath,
            referenceTitle: input.reference.title,
            referenceTags: input.reference.tags,
            referenceSource: input.reference.source,
            topics: input.plan.topics,
            cadence: input.plan.cadence
        } as any)
        : undefined;
    const runtimeInvoke = runtimeApi.invoke;
    const runtimeAnalyzeEagleReferenceById = typeof runtimeInvoke === 'function'
        ? (request: { itemId: string; topics?: string[]; settings?: Partial<EagleReadonlySettings> }) => (
            runtimeInvoke('designKnowledge:analyzeEagleReference', request)
        )
        : undefined;
    return {
        ...eagleApi,
        analyzeDesignReference: source?.analyzeDesignReference || runtimeAnalyzeDesignReference,
        analyzeAssetContent: source?.analyzeAssetContent || runtimeApi.analyzeAssetContent,
        analyzeEagleReferenceById: source?.analyzeEagleReferenceById || runtimeAnalyzeEagleReferenceById,
        getImagePreview: source?.getImagePreview || resolveRuntimeGetImagePreview(runtimeApi),
        removeBackgroundMask: source?.removeBackgroundMask || resolveRuntimeRemoveBackgroundMask(runtimeApi)
    };
}

/** 真实预览图桥：window.designEcho.getResourcePreview（路径→base64 预览）。缺省则不带真实图。 */
function resolveRuntimeGetImagePreview(
    runtimeApi: Record<string, any>
): DesignLearningRuntimeOrchestratorApi['getImagePreview'] {
    if (typeof runtimeApi.getImagePreview === 'function') return runtimeApi.getImagePreview;
    if (typeof runtimeApi.getResourcePreview === 'function') {
        return (imagePath: string, maxSize?: number) => runtimeApi.getResourcePreview(imagePath, maxSize);
    }
    return undefined;
}

/**
 * 真实抠图蒙版桥：window.designEcho.mattingRemoveBackground（BiRefNet ONNX，真机）。
 * matting 返回 RAW_MASK:"RAW_MASK:width:height:base64" 字符串，这里解码成 {maskBuffer,maskWidth,maskHeight}
 * 供纯逻辑 computeSubjectRectFromMask 扫 bbox。缺省/失败则不带主体框（不臆造）。
 */
function resolveRuntimeRemoveBackgroundMask(
    runtimeApi: Record<string, any>
): DesignLearningRuntimeOrchestratorApi['removeBackgroundMask'] {
    const bridge = typeof runtimeApi.mattingRemoveBackground === 'function'
        ? runtimeApi.mattingRemoveBackground
        : (typeof runtimeApi.removeBackground === 'function' ? runtimeApi.removeBackground : undefined);
    if (!bridge) return undefined;
    return async (imageBase64: string) => {
        const result = await bridge(imageBase64);
        if (!result || result.success === false) return undefined;
        const decoded = decodeRawMask(result.maskImage || result.mask);
        if (decoded) return { success: true, ...decoded };
        // 有些返回直接给 maskBuffer/maskWidth/maskHeight（同进程），透传
        if (result.maskBuffer && result.maskWidth && result.maskHeight) {
            return { success: true, maskBuffer: result.maskBuffer, maskWidth: result.maskWidth, maskHeight: result.maskHeight };
        }
        return undefined;
    };
}

/** 解码 matting 的 RAW_MASK 字符串："RAW_MASK:width:height:base64" → 逐像素 Uint8Array。 */
function decodeRawMask(raw: unknown): { maskBuffer: Uint8Array; maskWidth: number; maskHeight: number } | undefined {
    if (typeof raw !== 'string' || !raw.startsWith('RAW_MASK:')) return undefined;
    const parts = raw.split(':');
    if (parts.length < 4) return undefined;
    const maskWidth = Number(parts[1]);
    const maskHeight = Number(parts[2]);
    const base64 = parts.slice(3).join(':');
    if (!Number.isFinite(maskWidth) || !Number.isFinite(maskHeight) || maskWidth <= 0 || maskHeight <= 0) return undefined;
    try {
        const binary = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
        const maskBuffer = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) maskBuffer[i] = binary.charCodeAt(i);
        return { maskBuffer, maskWidth, maskHeight };
    } catch {
        return undefined;
    }
}

export async function runDesignLearningRuntimeOrchestrator(
    input: RunDesignLearningRuntimeOrchestratorInput = {}
): Promise<DesignLearningRuntimeOrchestratorResult> {
    const api = createDesignLearningRuntimeOrchestratorApi(input.api);
    const memoryService = input.memoryService || getMemoryService();
    const projectImagePathByReferenceId = new Map<string, string>();
    const sourceProviders = {
        ...buildDefaultSourceProviders({
            api,
            eagleSettings: input.eagleSettings,
            projectImagePaths: input.projectImagePaths,
            projectImagePathByReferenceId
        }),
        ...(input.sourceProviders || {})
    };
    const analyzeReference = input.analyzeReference || buildDefaultAnalyzeReference({
        api,
        projectImagePathByReferenceId
    });
    const reviewQueue = input.reviewQueue || buildMemoryReviewQueue(memoryService);
    const storage = input.storage || buildLocalStorageBackedTriggerStorage(input.storageKey || DEFAULT_LAST_RUN_STORAGE_KEY);

    const result = await runDesignLearningRuntimeTriggerService({
        ...input,
        sourceProviders,
        analyzeReference,
        reviewQueue,
        storage
    });
    const persistedNeedsReviewCount = memoryService.listPersistedDesignMemoryItems({
        status: 'needs_review',
        scope: input.scope
    }).length;
    const queuedCount = Math.max(0, Number(result.reviewQueueResult?.queuedCount || 0));

    return {
        ...result,
        orchestratorVersion: VERSION,
        reviewPersistence: {
            enabled: true,
            queuedCount,
            persistedNeedsReviewCount
        },
        adapters: {
            eagleReadonlyProvider: Boolean(sourceProviders.eagleReadonly),
            projectImageProvider: Boolean(sourceProviders.projectCases),
            visualAnalysisAdapter: Boolean(analyzeReference),
            memoryReviewQueue: true
        },
        boundaries: {
            ...result.boundaries,
            orchestratesRuntimeOnly: true,
            persistsNeedsReviewMemoryOnly: true,
            doesNotPromoteMemoryWithoutReview: true,
            doesNotAutoSearchEagleOnAppStart: true
        }
    };
}

function buildDefaultSourceProviders(input: {
    api: DesignLearningRuntimeOrchestratorApi;
    eagleSettings?: Partial<EagleReadonlySettings>;
    projectImagePaths?: unknown;
    projectImagePathByReferenceId: Map<string, string>;
}): NonNullable<RunDesignLearningRuntimeTriggerServiceInput['sourceProviders']> {
    const projectImagePaths = normalizeProjectImagePaths(input.projectImagePaths);
    const providers: NonNullable<RunDesignLearningRuntimeTriggerServiceInput['sourceProviders']> = {};

    if (input.api.searchEagleReadonlyKnowledge) {
        providers.eagleReadonly = async ({ topics, maxItems, plan }) => {
            const response = await input.api.searchEagleReadonlyKnowledge!(
                {
                    query: topics.join(' '),
                    limit: maxItems,
                    preferAiSearch: true
                },
                input.eagleSettings
            );
            return eagleReadonlyKnowledgeToDesignLearningRuntimeReferences(response, {
                maxItems,
                requestedBy: 'design-learning-runtime-orchestrator',
                generatedAt: plan.date
            }).references;
        };
    }

    if (projectImagePaths.length > 0) {
        providers.projectCases = async ({ maxItems }) => projectImagePaths.slice(0, maxItems).map((imagePath, index) => {
            const referenceId = `project-image:${stableHash(imagePath) || index + 1}`;
            input.projectImagePathByReferenceId.set(referenceId, imagePath);
            return {
                referenceId,
                title: fileNameFromPath(imagePath) || `项目图片 ${index + 1}`,
                sourceType: 'manual_reference' as const,
                tags: ['project-image', 'visual-learning'],
                sourceUrl: imagePath
            };
        });
    }

    return providers;
}

function buildDefaultAnalyzeReference(input: {
    api: DesignLearningRuntimeOrchestratorApi;
    projectImagePathByReferenceId: Map<string, string>;
}): RunDesignLearningRuntimeTriggerServiceInput['analyzeReference'] | undefined {
    if (!input.api.analyzeDesignReference && !input.api.analyzeAssetContent && !input.api.analyzeEagleReferenceById) {
        return undefined;
    }
    return async (reference, context) => {
        const eagleItemId = resolveEagleItemId(reference);
        if (eagleItemId) {
            if (!input.api.analyzeEagleReferenceById) return undefined;
            const response = await input.api.analyzeEagleReferenceById({
                itemId: eagleItemId,
                topics: context.plan.topics
            });
            const observation = normalizeDesignReferenceObservation(
                reference,
                response?.success === true ? response.observation : undefined,
                'designKnowledge:analyzeEagleReference'
            );
            return observation;
        }

        const imagePath = input.projectImagePathByReferenceId.get(reference.referenceId);
        if (!imagePath) return undefined;

        let observation: DesignLearningReferenceObservation | undefined;
        if (input.api.analyzeDesignReference) {
            const raw = await input.api.analyzeDesignReference({ reference, imagePath, plan: context.plan });
            observation = normalizeDesignReferenceObservation(reference, raw, 'analyzeDesignReference');
        } else if (input.api.analyzeAssetContent) {
            const result = await input.api.analyzeAssetContent!(imagePath);
            observation = assetAnalysisToLearningObservation(reference, result);
        }
        if (!observation) return undefined;

        // 采集视觉案例：真实预览图 + 分割主体框（用真实抠图蒙版扫 bbox，不靠弱视觉模型猜）。
        // 失败不影响主流程——观察照常返回，只是不带视觉案例（诚实降级）。
        const visualCase = await captureDesignLearningVisualCase({
            api: input.api,
            imagePath,
            sourceKind: 'project_image',
            caption: buildVisualCaseCaption('项目图', reference.title)
        });
        return visualCase ? { ...observation, visualCase } : observation;
    };
}

function resolveEagleItemId(reference: DesignLearningRuntimeReferenceCandidate): string | undefined {
    if (reference.sourceType !== 'eagle_visual_case') return undefined;
    const referenceId = cleanString(reference.referenceId);
    const fromCaseId = referenceId.replace(/^eagle-case:/i, '').replace(/^eagle:/i, '');
    if (fromCaseId && fromCaseId !== referenceId) return fromCaseId.slice(0, 240);
    const sourceUrlMatch = cleanString(reference.sourceUrl).match(/^eagle:\/\/item\/(.+)$/i);
    return sourceUrlMatch?.[1] ? decodeEagleItemId(sourceUrlMatch[1]) : undefined;
}

function decodeEagleItemId(value: string): string | undefined {
    try {
        return decodeURIComponent(value).slice(0, 240);
    } catch {
        return value.slice(0, 240) || undefined;
    }
}

function buildVisualCaseCaption(prefix: string, title: string | undefined): string {
    const clean = cleanString(title);
    return clean ? `${prefix} · ${clean}` : prefix;
}

/**
 * 采集学习视觉案例：路径→预览图；预览图→抠图蒙版→真实主体框。
 * 两步都可选：无 getImagePreview 则无视觉案例；有预览但无 removeBackgroundMask 或抠图失败，
 * 则视觉案例只带原图+三分线（无主体框，诚实缺省不臆造）。
 */
async function captureDesignLearningVisualCase(input: {
    api: DesignLearningRuntimeOrchestratorApi;
    imagePath: string;
    sourceKind: DesignLearningVisualCaseSourceKind;
    caption: string;
}): Promise<DesignLearningVisualCase | undefined> {
    if (typeof input.api.getImagePreview !== 'function') return undefined;
    try {
        const preview = await input.api.getImagePreview(input.imagePath, 768);
        const dataUrl = normalizePreviewDataUrl(preview);
        if (!dataUrl) return undefined;

        let subjectRect: NormalizedRect | undefined;
        if (typeof input.api.removeBackgroundMask === 'function') {
            try {
                const base64Only = dataUrl.replace(/^data:[^,]*,/, '');
                const matte = await input.api.removeBackgroundMask(base64Only);
                if (matte && matte.success !== false && matte.maskBuffer && matte.maskWidth && matte.maskHeight) {
                    subjectRect = computeSubjectRectFromMask(matte.maskBuffer, matte.maskWidth, matte.maskHeight);
                }
            } catch {
                // 抠图失败：不给假框，只保留原图+三分线
            }
        }
        return sanitizeDesignLearningVisualCase({
            previewDataUrl: dataUrl,
            sourceKind: input.sourceKind,
            subjectRect,
            showCompositionGrid: true,
            caption: input.caption
        });
    } catch {
        return undefined;
    }
}

function normalizePreviewDataUrl(preview: { imageData?: string; dataUrl?: string; base64?: string } | undefined): string | undefined {
    if (!preview) return undefined;
    for (const candidate of [preview.imageData, preview.dataUrl]) {
        if (typeof candidate === 'string' && candidate.startsWith('data:')) return candidate;
    }
    for (const candidate of [preview.imageData, preview.base64]) {
        if (typeof candidate === 'string' && candidate && !candidate.startsWith('data:')) {
            return `data:image/png;base64,${candidate}`;
        }
    }
    return undefined;
}

function buildMemoryReviewQueue(memoryService: MemoryService): DesignLearningRuntimeReviewQueue {
    return {
        enqueue: async (candidates, metadata) => {
            let queuedCount = 0;
            for (const candidate of candidates) {
                const review = persistNeedsReviewMemoryCandidate(memoryService, candidate, metadata.generatedAt);
                if (review) queuedCount += 1;
            }
            return {
                queuedCount,
                queueId: 'memory-service:design-learning-needs-review'
            };
        }
    };
}

function persistNeedsReviewMemoryCandidate(
    memoryService: MemoryService,
    candidate: DesignMemoryItem,
    reviewedAt: string
): boolean {
    try {
        memoryService.recordDesignLearningMemoryReview({
            candidate,
            decision: 'needs_review',
            reviewer: 'design-learning-runtime-orchestrator',
            reviewedAt
        });
        return true;
    } catch {
        return false;
    }
}

function buildLocalStorageBackedTriggerStorage(key: string): DesignLearningRuntimeTriggerServiceStorage {
    return {
        getLastRunAt: () => getLocalStorageValue(key),
        setLastRunAt: (value) => setLocalStorageValue(key, value)
    };
}

function assetAnalysisToLearningObservation(
    reference: DesignLearningRuntimeReferenceCandidate,
    result: any
): DesignLearningReferenceObservation | undefined {
    if (!result || result.success === false) return undefined;
    const analysis = result.analysis && typeof result.analysis === 'object'
        ? result.analysis
        : result;
    const description = cleanString(analysis.description || analysis.summary || analysis.mainSubject);
    const category = cleanString(analysis.category);
    const mainSubject = cleanString(analysis.mainSubject || reference.title);
    const style = cleanString(analysis.style);
    const suggestedPlacement = cleanString(analysis.suggestedPlacement);
    const colors = normalizeTextList(analysis.colors);
    const effects = normalizeTextList(analysis.suggestedEffects);
    const summary = [
        description || `${reference.title} 的视觉分析结果`,
        mainSubject ? `主体：${mainSubject}` : '',
        style ? `风格：${style}` : ''
    ].filter(Boolean).join('；');

    if (!summary) return undefined;

    return {
        referenceId: reference.referenceId,
        analysisSource: 'analyzeAssetContent',
        observedAt: new Date().toISOString(),
        productCategory: category || undefined,
        designType: inferDesignType(reference, category, suggestedPlacement),
        summary,
        strengths: [
            {
                aspect: 'composition',
                observation: suggestedPlacement
                    ? `画面适合用于${suggestedPlacement}。`
                    : `主体 ${mainSubject || reference.title} 可作为商品视觉参考。`,
                reason: '用途判断来自视觉分析结果，需要在复核后沉淀为长期经验。',
                suitableFor: uniqueStrings([suggestedPlacement, '商品展示', ...reference.tags])
            },
            {
                aspect: 'style-and-color',
                observation: [
                    style ? `风格偏 ${style}` : '',
                    colors.length ? `主色包含 ${colors.slice(0, 3).join('、')}` : ''
                ].filter(Boolean).join('，') || '画面包含可复用的风格或色彩线索。',
                reason: '风格、色彩和主体关系可以帮助后续主图、详情页或 SKU 版式选择。',
                suitableFor: uniqueStrings(['主图', '详情页', 'SKU', ...effects])
            }
        ],
        suitableScenarios: uniqueStrings([
            suggestedPlacement,
            '主图参考',
            '详情页参考',
            reference.tags.some((tag) => /sku/i.test(tag)) ? 'SKU 色卡参考' : ''
        ]),
        avoidWhen: ['与当前品牌调性、平台规范或商品事实冲突时不要直接套用。'],
        reusableHeuristics: uniqueStrings([
            suggestedPlacement ? `按 ${suggestedPlacement} 判断图片用途` : '',
            style ? `保持 ${style} 风格的一致性` : '',
            colors.length ? `围绕 ${colors.slice(0, 2).join('、')} 建立色彩关系` : '',
            effects.length ? `可复核效果：${effects.slice(0, 3).join('、')}` : ''
        ]),
        reviewStatus: 'needs_human_review',
        sourceNotes: ['analysis_adapter=analyzeAssetContent'],
        limitations: ['该观察来自项目图片分析，需要人工复核后才能进入长期知识。']
    };
}

function normalizeDesignReferenceObservation(
    reference: DesignLearningRuntimeReferenceCandidate,
    value: DesignLearningReferenceObservation | undefined,
    fallbackAnalysisSource: string
): DesignLearningReferenceObservation | undefined {
    if (!value) return undefined;
    const strengths = Array.isArray(value.strengths)
        ? value.strengths
            .map((item) => ({
                aspect: cleanString(item.aspect),
                observation: cleanString(item.observation),
                reason: cleanString(item.reason),
                suitableFor: uniqueStrings(item.suitableFor || [])
            }))
            .filter((item) => item.observation && item.reason)
        : [];
    const suitableScenarios = uniqueStrings(value.suitableScenarios || []);
    const reusableHeuristics = uniqueStrings(value.reusableHeuristics || []);
    const summary = cleanString(value.summary);
    if (!summary || strengths.length < 2 || suitableScenarios.length < 1 || reusableHeuristics.length < 1) {
        return undefined;
    }
    return {
        referenceId: cleanString(value.referenceId) || reference.referenceId,
        analysisSource: cleanString(value.analysisSource) || fallbackAnalysisSource,
        observedAt: cleanString(value.observedAt) || new Date().toISOString(),
        productCategory: cleanString(value.productCategory) || undefined,
        designType: cleanString(value.designType) || inferDesignType(reference, cleanString(value.productCategory), cleanString(value.designType)),
        summary,
        strengths,
        suitableScenarios,
        avoidWhen: uniqueStrings(value.avoidWhen || ['与当前商品事实、品牌调性或平台规范冲突时不要直接套用。']),
        reusableHeuristics,
        reviewStatus: 'needs_human_review',
        sourceNotes: uniqueStrings([
            ...(value.sourceNotes || []),
            `analysis_adapter=${fallbackAnalysisSource}`
        ]),
        limitations: uniqueStrings([
            ...(value.limitations || []),
            '该设计参考观察需要人工或后续模型复核后才能进入长期知识。'
        ])
    };
}

function inferDesignType(
    reference: DesignLearningRuntimeReferenceCandidate,
    category: string,
    suggestedPlacement: string
): string | undefined {
    const text = `${reference.title} ${reference.tags.join(' ')} ${category} ${suggestedPlacement}`.toLowerCase();
    if (/sku|色卡/.test(text)) return 'sku-color-card';
    if (/主图|main|hero|product_main/.test(text)) return 'main-image-reference';
    if (/详情|detail/.test(text)) return 'detail-page-reference';
    return category || undefined;
}

function normalizeProjectImagePaths(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 24);
}

function normalizeTextList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => cleanString(item)).filter(Boolean)));
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map((item) => cleanString(item)).filter(Boolean)));
}

function fileNameFromPath(value: string): string {
    const parts = value.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || '';
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function getLocalStorageValue(key: string): string | undefined {
    try {
        return typeof localStorage === 'undefined'
            ? undefined
            : localStorage.getItem(key) || undefined;
    } catch {
        return undefined;
    }
}

function setLocalStorageValue(key: string, value: string): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, value);
        }
    } catch {
        // Learning cadence persistence must never break the user request path.
    }
}

function cleanString(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s"'，,；;]+/g, '[redacted-local-path]')
        .replace(/\s+/g, ' ')
        .trim();
}
