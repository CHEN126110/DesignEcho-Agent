import MemoryService, { getMemoryService } from './memory.service';
import {
    runDesignLearningRuntimeOrchestrator,
    type DesignLearningRuntimeOrchestratorApi,
    type DesignLearningRuntimeOrchestratorResult,
    type RunDesignLearningRuntimeOrchestratorInput
} from './design-learning-runtime-orchestrator.service';
import {
    collectDesignLearningPsdSourcePaths,
    psdDesignProfileToDesignMemoryItems,
    type DesignLearningPsdSourceRecord
} from '../../shared/design-learning-psd-source';
import type { PsdDesignSourceProfile } from '../../shared/psd-design-source';
import type {
    DesignLearningCadence
} from '../../shared/design-learning-experience';
import type { DesignMemoryScope } from '../../shared/design-memory-knowledge';

export type DesignLearningRuntimeEntryVersion = 'design-learning-runtime-entry/v0';
export type DesignLearningRuntimeEntryStatus =
    | 'prepared_waiting_manual_start'
    | 'manual_review_queued'
    | 'blocked'
    | 'runtime_waiting'
    | 'skipped_duplicate_app_start';

export interface DesignLearningRuntimeEntryProjectInfo {
    id?: string;
    name?: string;
    path?: string;
    folders?: {
        assets?: string;
        psd?: string;
        output?: string;
    };
}

export interface DesignLearningRuntimeEntryImageFile {
    name?: string;
    path?: string;
    ext?: string;
    type?: string;
    folderType?: string;
}

export interface DesignLearningRuntimeEntryFolderInfo {
    name?: string;
    path?: string;
    type?: string;
    images?: DesignLearningRuntimeEntryImageFile[];
    children?: DesignLearningRuntimeEntryFolderInfo[];
}

export interface DesignLearningRuntimeEntryEcommerceStructure {
    projectPath?: string;
    projectName?: string;
    folders?: DesignLearningRuntimeEntryFolderInfo[];
}

export interface DesignLearningRuntimeEntryInput {
    currentProject?: DesignLearningRuntimeEntryProjectInfo | null;
    ecommerceStructure?: DesignLearningRuntimeEntryEcommerceStructure | null;
    now?: unknown;
    cadence?: DesignLearningCadence;
    preferredTopics?: unknown;
    knowledgeGaps?: unknown;
    maxReferences?: unknown;
    api?: Partial<DesignLearningRuntimeOrchestratorApi> | null;
    memoryService?: MemoryService;
    eagleSettings?: RunDesignLearningRuntimeOrchestratorInput['eagleSettings'];
    /** PSD 设计源解析桥（可注入供测试）；缺省用 window.designEcho.analyzePsdDesignSource。 */
    analyzePsdDesignSourceBridge?: (filePath: string) => Promise<{ success: boolean; profile?: PsdDesignSourceProfile; error?: string }>;
}

export interface CollectDesignLearningProjectImagePathsOptions {
    limit?: number;
}

export interface DesignLearningRuntimeEntryResult {
    version: DesignLearningRuntimeEntryVersion;
    status: DesignLearningRuntimeEntryStatus;
    action: 'app_start_prepare' | 'manual_run';
    generatedAt: string;
    project: {
        id?: string;
        name?: string;
        hasProject: boolean;
    };
    projectImages: {
        candidateCount: number;
        selectedCount: number;
        imageTypes: string[];
        folderTypes: string[];
    };
    /** PSD/PSB 结构化学习（不依赖视觉模型）：设计源解析 → 版式/色板/结构候选进复核队列。 */
    psdSources: {
        candidateCount: number;
        parsedCount: number;
        queuedCount: number;
    };
    topics: string[];
    orchestratorStatus?: string;
    reviewQueue: {
        queuedCount: number;
        persistedNeedsReviewCount: number;
    };
    blockers: string[];
    warnings: string[];
    boundaries: {
        appStartNeverExecutesRuntime: true;
        manualRunRequiresExplicitCall: true;
        usesMemoryServiceSingleton: true;
        queuesReviewCandidatesOnly: true;
        mustReviewBeforeActiveMemory: true;
        noPhotoshopWrites: true;
        doesNotWriteEagle: true;
        userVisibleResultRedactsLocalPaths: true;
        doesNotExposeRawImages: true;
        doesNotExposeScoreMarkers: true;
    };
}

export interface DesignLearningRuntimeEntryControllerDependencies {
    memoryService?: MemoryService;
    getMemoryService?: () => MemoryService;
    runOrchestrator?: (input: RunDesignLearningRuntimeOrchestratorInput) => Promise<DesignLearningRuntimeOrchestratorResult>;
}

export interface DesignLearningRuntimeEntryController {
    prepareOnAppStart: (input: DesignLearningRuntimeEntryInput) => Promise<DesignLearningRuntimeEntryResult>;
    runManual: (input: DesignLearningRuntimeEntryInput) => Promise<DesignLearningRuntimeEntryResult>;
    clearAppStartHistory: () => void;
}

const VERSION: DesignLearningRuntimeEntryVersion = 'design-learning-runtime-entry/v0';
const LOCAL_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/g;
const UNSAFE_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi,
    /"base64"/gi,
    /"imageBase64"/gi,
    /"rawImage"/gi,
    /"rawImages"/gi,
    /"buffer"/gi,
    /"bytes"/gi,
    /"pixels"/gi,
    /"confidence"/gi,
    /\bconfidence\b/gi,
    /置信度?/g
];

const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const IMAGE_TYPE_PRIORITY = new Map<string, number>([
    ['product', 0],
    ['detail', 1],
    ['scene', 2],
    ['material', 3],
    ['package', 4],
    ['model', 5],
    ['unknown', 9]
]);

export function collectDesignLearningProjectImagePaths(
    ecommerceStructure: DesignLearningRuntimeEntryEcommerceStructure | null | undefined,
    options: CollectDesignLearningProjectImagePathsOptions = {}
): string[] {
    return collectProjectImageRecords(ecommerceStructure)
        .slice(0, clampNumber(options.limit, 1, 100, 24))
        .map((record) => record.path);
}

export function createDesignLearningRuntimeEntryController(
    dependencies: DesignLearningRuntimeEntryControllerDependencies = {}
): DesignLearningRuntimeEntryController {
    const seenAppStartKeys = new Set<string>();
    const runOrchestrator = dependencies.runOrchestrator || runDesignLearningRuntimeOrchestrator;

    return {
        prepareOnAppStart: async (input) => {
            const context = buildEntryContext(input);
            if (seenAppStartKeys.has(context.appStartKey)) {
                return buildSkippedAppStartResult(context);
            }

            const result = await runEntry({
                action: 'app_start_prepare',
                input,
                context,
                memoryService: resolveMemoryService(input, dependencies),
                runOrchestrator
            });
            seenAppStartKeys.add(context.appStartKey);
            return result;
        },
        runManual: async (input) => runEntry({
            action: 'manual_run',
            input,
            context: buildEntryContext(input),
            memoryService: resolveMemoryService(input, dependencies),
            runOrchestrator
        }),
        clearAppStartHistory: () => {
            seenAppStartKeys.clear();
        }
    };
}

async function runEntry(input: {
    action: 'app_start_prepare' | 'manual_run';
    input: DesignLearningRuntimeEntryInput;
    context: DesignLearningRuntimeEntryContext;
    memoryService: MemoryService;
    runOrchestrator: (value: RunDesignLearningRuntimeOrchestratorInput) => Promise<DesignLearningRuntimeOrchestratorResult>;
}): Promise<DesignLearningRuntimeEntryResult> {
    const executeRuntime = input.action === 'manual_run';
    const orchestratorResult = await input.runOrchestrator({
        triggerSource: executeRuntime ? 'manual' : 'app_start',
        executeRuntime,
        autoRunOnAppStart: false,
        now: input.context.generatedAt,
        cadence: input.input.cadence || 'daily',
        preferredTopics: input.context.topics,
        knowledgeGaps: input.input.knowledgeGaps,
        maxReferences: input.context.maxReferences,
        api: input.input.api,
        memoryService: input.memoryService,
        eagleSettings: input.input.eagleSettings,
        projectImagePaths: input.context.projectImagePaths,
        scope: input.context.scope
    });

    // PSD/PSB 结构化学习：与视觉链并行的补充源，手动学习时执行；失败只降级不阻断视觉链结果。
    const psdOutcome = executeRuntime
        ? await runPsdSourceLearning({
            records: input.context.psdSourceRecords,
            bridge: resolvePsdBridge(input.input),
            memoryService: input.memoryService,
            scope: input.context.scope,
            now: input.context.generatedAt
        })
        : { parsedCount: 0, queuedCount: 0, warnings: [] };

    return buildEntryResult({
        action: input.action,
        context: input.context,
        orchestratorResult,
        psdOutcome
    });
}

type PsdBridge = (filePath: string) => Promise<{ success: boolean; profile?: PsdDesignSourceProfile; error?: string }>;

function resolvePsdBridge(input: DesignLearningRuntimeEntryInput): PsdBridge | undefined {
    if (typeof input.analyzePsdDesignSourceBridge === 'function') return input.analyzePsdDesignSourceBridge;
    const bridge = (globalThis as { window?: { designEcho?: { analyzePsdDesignSource?: PsdBridge } } }).window?.designEcho?.analyzePsdDesignSource;
    return typeof bridge === 'function' ? bridge : undefined;
}

async function runPsdSourceLearning(input: {
    records: DesignLearningPsdSourceRecord[];
    bridge?: PsdBridge;
    memoryService: MemoryService;
    scope: DesignMemoryScope;
    now: string;
}): Promise<{ parsedCount: number; queuedCount: number; warnings: string[] }> {
    const warnings: string[] = [];
    if (input.records.length === 0) return { parsedCount: 0, queuedCount: 0, warnings };
    if (!input.bridge) {
        warnings.push('psd_design_source_bridge_unavailable');
        return { parsedCount: 0, queuedCount: 0, warnings };
    }
    let parsedCount = 0;
    let queuedCount = 0;
    for (const record of input.records) {
        try {
            const result = await input.bridge(record.path);
            if (!result?.success || !result.profile) {
                warnings.push(`psd_parse_failed:${cleanString(record.name) || 'unknown'}`);
                continue;
            }
            parsedCount += 1;
            const candidates = psdDesignProfileToDesignMemoryItems(result.profile, {
                scope: input.scope,
                now: input.now,
                folderType: record.folderType
            });
            for (const candidate of candidates) {
                try {
                    input.memoryService.recordDesignLearningMemoryReview({
                        candidate,
                        decision: 'needs_review',
                        reviewer: 'design-learning-psd-source',
                        reviewedAt: input.now
                    });
                    queuedCount += 1;
                } catch {
                    warnings.push('psd_candidate_enqueue_failed');
                }
            }
        } catch (error) {
            warnings.push(`psd_parse_failed:${cleanString(record.name) || 'unknown'}`);
            void error;
        }
    }
    return { parsedCount, queuedCount, warnings };
}

interface DesignLearningRuntimeEntryContext {
    generatedAt: string;
    appStartKey: string;
    project: {
        id?: string;
        name?: string;
        hasProject: boolean;
    };
    scope: DesignMemoryScope;
    projectImagePaths: string[];
    projectImageSummary: {
        candidateCount: number;
        selectedCount: number;
        imageTypes: string[];
        folderTypes: string[];
    };
    psdSourceRecords: DesignLearningPsdSourceRecord[];
    topics: string[];
    maxReferences: number;
}

function buildEntryContext(input: DesignLearningRuntimeEntryInput): DesignLearningRuntimeEntryContext {
    const generatedAt = normalizeDateTime(input.now) || new Date().toISOString();
    const imageRecords = collectProjectImageRecords(input.ecommerceStructure);
    const maxReferences = clampNumber(input.maxReferences, 1, 30, Math.min(8, Math.max(1, imageRecords.length || 6)));
    const selectedRecords = imageRecords.slice(0, Math.max(maxReferences, 1));
    const projectId = cleanString(input.currentProject?.id || input.ecommerceStructure?.projectName);
    const projectName = cleanString(input.currentProject?.name || input.ecommerceStructure?.projectName);
    const scope: DesignMemoryScope = projectId ? { type: 'project', id: projectId } : { type: 'user' };
    const topics = buildPreferredTopics({
        preferredTopics: input.preferredTopics,
        projectName,
        imageTypes: selectedRecords.map((record) => record.type),
        folderTypes: selectedRecords.map((record) => record.folderType)
    });
    const projectImagePaths = selectedRecords.map((record) => record.path);
    const psdSourceRecords = collectDesignLearningPsdSourcePaths(input.ecommerceStructure);

    return {
        generatedAt,
        appStartKey: stableHash([
            projectId,
            cleanString(input.currentProject?.path || input.ecommerceStructure?.projectPath),
            projectImagePaths.join('|'),
            topics.join('|')
        ].join('::')),
        project: {
            ...(projectId ? { id: projectId } : {}),
            ...(projectName ? { name: projectName } : {}),
            hasProject: Boolean(projectId || projectName || input.currentProject || input.ecommerceStructure)
        },
        scope,
        projectImagePaths,
        projectImageSummary: {
            candidateCount: imageRecords.length,
            selectedCount: projectImagePaths.length,
            imageTypes: uniqueStrings(selectedRecords.map((record) => record.type)),
            folderTypes: uniqueStrings(selectedRecords.map((record) => record.folderType))
        },
        psdSourceRecords,
        topics,
        maxReferences
    };
}

function buildPreferredTopics(input: {
    preferredTopics?: unknown;
    projectName?: string;
    imageTypes: string[];
    folderTypes: string[];
}): string[] {
    const explicit = Array.isArray(input.preferredTopics)
        ? input.preferredTopics.map(cleanString)
        : [];
    if (explicit.length > 0) return uniqueStrings(explicit).slice(0, 12);

    const topics = [
        cleanString(input.projectName),
        '电商设计参考',
        input.imageTypes.includes('product') ? '商品展示' : '',
        input.imageTypes.includes('detail') ? '详情页设计' : '',
        input.folderTypes.includes('sku') ? 'SKU 视觉' : ''
    ];
    return uniqueStrings(topics).slice(0, 12);
}

interface ProjectImageRecord {
    path: string;
    type: string;
    folderType: string;
    order: number;
}

function collectProjectImageRecords(
    ecommerceStructure: DesignLearningRuntimeEntryEcommerceStructure | null | undefined
): ProjectImageRecord[] {
    const records: ProjectImageRecord[] = [];
    const seen = new Set<string>();
    let order = 0;

    const visit = (folder: DesignLearningRuntimeEntryFolderInfo | undefined): void => {
        if (!folder) return;
        for (const image of Array.isArray(folder.images) ? folder.images : []) {
            const path = String(image.path || '').trim();
            if (!path || seen.has(path)) continue;
            if (!isSupportedRasterImage(image)) continue;
            seen.add(path);
            records.push({
                path,
                type: cleanString(image.type) || 'unknown',
                folderType: cleanString(image.folderType || folder.type) || 'unknown',
                order
            });
            order += 1;
        }
        for (const child of Array.isArray(folder.children) ? folder.children : []) {
            visit(child);
        }
    };

    for (const folder of Array.isArray(ecommerceStructure?.folders) ? ecommerceStructure!.folders! : []) {
        visit(folder);
    }

    return records.sort((a, b) => {
        const typeDiff = imageTypePriority(a.type) - imageTypePriority(b.type);
        if (typeDiff !== 0) return typeDiff;
        return a.order - b.order;
    });
}

function isSupportedRasterImage(image: DesignLearningRuntimeEntryImageFile): boolean {
    const imageType = cleanString(image.type).toLowerCase();
    if (imageType === 'psd' || imageType === 'video' || imageType === 'design') return false;
    const ext = cleanString(image.ext || extensionFromPath(image.path)).toLowerCase();
    return RASTER_EXTENSIONS.has(ext);
}

function imageTypePriority(type: string): number {
    return IMAGE_TYPE_PRIORITY.get(cleanString(type).toLowerCase()) ?? 8;
}

function extensionFromPath(value: unknown): string {
    const text = String(value || '').trim();
    const match = text.match(/\.[a-z0-9]+$/i);
    return match ? match[0] : '';
}

function buildEntryResult(input: {
    action: 'app_start_prepare' | 'manual_run';
    context: DesignLearningRuntimeEntryContext;
    orchestratorResult: DesignLearningRuntimeOrchestratorResult;
    psdOutcome: { parsedCount: number; queuedCount: number; warnings: string[] };
}): DesignLearningRuntimeEntryResult {
    const visualQueuedCount = Math.max(0, Number(input.orchestratorResult.reviewPersistence?.queuedCount || input.orchestratorResult.reviewQueueResult?.queuedCount || 0));
    const totalQueuedCount = visualQueuedCount + Math.max(0, input.psdOutcome.queuedCount);
    let status = mapEntryStatus(input.action, input.orchestratorResult);
    // PSD 结构化通道有产出时，即使视觉链被阻断（如视觉模型不可用），这次学习也是真实成功的。
    if (input.action === 'manual_run' && input.psdOutcome.queuedCount > 0 && status !== 'manual_review_queued') {
        status = 'manual_review_queued';
    }
    return {
        version: VERSION,
        status,
        action: input.action,
        generatedAt: input.context.generatedAt,
        project: input.context.project,
        projectImages: input.context.projectImageSummary,
        psdSources: {
            candidateCount: input.context.psdSourceRecords.length,
            parsedCount: input.psdOutcome.parsedCount,
            queuedCount: input.psdOutcome.queuedCount
        },
        topics: input.context.topics,
        orchestratorStatus: cleanString(input.orchestratorResult.status),
        reviewQueue: {
            queuedCount: totalQueuedCount,
            persistedNeedsReviewCount: Math.max(0, Number(input.orchestratorResult.reviewPersistence?.persistedNeedsReviewCount || 0)) + Math.max(0, input.psdOutcome.queuedCount)
        },
        blockers: uniqueStrings(input.orchestratorResult.blockers || []),
        warnings: uniqueStrings([...(input.orchestratorResult.warnings || []), ...input.psdOutcome.warnings]),
        boundaries: buildEntryBoundaries()
    };
}

function buildSkippedAppStartResult(context: DesignLearningRuntimeEntryContext): DesignLearningRuntimeEntryResult {
    return {
        version: VERSION,
        status: 'skipped_duplicate_app_start',
        action: 'app_start_prepare',
        generatedAt: context.generatedAt,
        project: context.project,
        projectImages: context.projectImageSummary,
        psdSources: {
            candidateCount: context.psdSourceRecords.length,
            parsedCount: 0,
            queuedCount: 0
        },
        topics: context.topics,
        reviewQueue: {
            queuedCount: 0,
            persistedNeedsReviewCount: 0
        },
        blockers: [],
        warnings: ['same_project_learning_app_start_already_prepared'],
        boundaries: buildEntryBoundaries()
    };
}

function mapEntryStatus(
    action: 'app_start_prepare' | 'manual_run',
    result: DesignLearningRuntimeOrchestratorResult
): DesignLearningRuntimeEntryStatus {
    if (action === 'app_start_prepare' && result.status === 'ready_waiting_manual_start') {
        return 'prepared_waiting_manual_start';
    }
    if (action === 'manual_run' && result.status === 'runtime_completed_review_queued') {
        return 'manual_review_queued';
    }
    if (result.status === 'blocked_before_runtime' || result.status === 'runtime_blocked') {
        return 'blocked';
    }
    return 'runtime_waiting';
}

function buildEntryBoundaries(): DesignLearningRuntimeEntryResult['boundaries'] {
    return {
        appStartNeverExecutesRuntime: true,
        manualRunRequiresExplicitCall: true,
        usesMemoryServiceSingleton: true,
        queuesReviewCandidatesOnly: true,
        mustReviewBeforeActiveMemory: true,
        noPhotoshopWrites: true,
        doesNotWriteEagle: true,
        userVisibleResultRedactsLocalPaths: true,
        doesNotExposeRawImages: true,
        doesNotExposeScoreMarkers: true
    };
}

function resolveMemoryService(
    input: DesignLearningRuntimeEntryInput,
    dependencies: DesignLearningRuntimeEntryControllerDependencies
): MemoryService {
    return input.memoryService || dependencies.memoryService || dependencies.getMemoryService?.() || getMemoryService();
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of UNSAFE_PATTERNS) {
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(LOCAL_PATH_PATTERN, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
