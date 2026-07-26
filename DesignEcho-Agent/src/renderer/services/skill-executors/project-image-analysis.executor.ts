import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { useAppStore } from '../../stores/app.store';
import { getPrimaryModelForPreferenceBucket } from '../../../shared/model-selection';
import { emitSkillStep } from './skill-step-events';
import { isProjectImageAnalysisInventoryOverviewIntent } from '../../../shared/project-image-analysis-intent';
import { buildProjectDesignUnderstandingSummary } from '../../../shared/project-design-understanding-summary';
import { buildProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';

type ImageCandidate = {
    path: string;
    relativePath: string;
    name: string;
    folderType?: string;
    imageType?: string;
};

type AssetAnalysis = {
    description?: string;
    category?: string;
    mainSubject?: string;
    colors?: string[];
    style?: string;
    suggestedPlacement?: string;
    suggestedEffects?: string[];
    scene?: string;
    material?: string;
};

type ContactSheetOverviewAnalysis = {
    success?: boolean;
    contactSheet?: {
        items?: Array<{
            id: string;
            path: string;
            relativePath?: string;
            labelHint?: string;
            status?: string;
        }>;
    };
    observation?: {
        projectStyle?: string;
        productUnderstanding?: string;
        sellingPoints?: string[];
        imageRoles?: Array<{ id: string; role: string; reason?: string }>;
        nextSingleImageChecks?: string[];
    };
    error?: string;
};

type ProjectInventoryFolder = {
    name?: string;
    type?: string;
    imageCount: number;
    sampleImages: string[];
};

type ProjectInventoryOverview = {
    version: 'project-inventory-overview/v0';
    projectPath?: string;
    totalProjectImages: number;
    folderCount: number;
    typeCount: number;
    compactText: string;
    detailText: string;
    followUpHint: string;
    folderSummaries: ProjectInventoryFolder[];
    typeCounts: Record<string, number>;
    sampleImages: string[];
};

function getSummaryModelId(): string {
    const prefs = useAppStore.getState().modelPreferences as any;
    return getPrimaryModelForPreferenceBucket(prefs, 'textOptimize', {
        mode: prefs?.mode,
        includeFallback: prefs?.autoFallback,
        includeCrossTaskBackups: false
    }) || 'google-gemini-3-flash';
}

function normalizeTextList(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function flattenProjectImages(structure: any): ImageCandidate[] {
    const folders = Array.isArray(structure?.folders) ? structure.folders : [];
    const all: ImageCandidate[] = [];
    const walk = (folder: any) => {
        const images = Array.isArray(folder?.images) ? folder.images : [];
        for (const image of images) {
            const path = String(image?.path || '').trim();
            if (!path) continue;
            all.push({
                path,
                relativePath: String(image?.relativePath || '').trim() || path,
                name: String(image?.name || '').trim() || path.split(/[\\/]/).pop() || path,
                folderType: String(image?.folderType || folder?.type || '').trim() || undefined,
                imageType: String(image?.type || '').trim() || undefined
            });
        }
        const children = Array.isArray(folder?.children) ? folder.children : [];
        for (const child of children) walk(child);
    };
    for (const folder of folders) walk(folder);
    return all;
}

function normalizePathText(value: unknown): string {
    return String(value || '').trim().replace(/\\/g, '/');
}

function inferRelativePath(filePath: string, projectPath?: string, fallback?: string): string {
    const explicit = cleanText(fallback);
    if (explicit) return explicit;
    const normalizedFilePath = normalizePathText(filePath);
    const normalizedProjectPath = normalizePathText(projectPath).replace(/\/+$/, '');
    if (
        normalizedFilePath
        && normalizedProjectPath
        && normalizedFilePath.toLowerCase().startsWith(`${normalizedProjectPath.toLowerCase()}/`)
    ) {
        return normalizedFilePath.slice(normalizedProjectPath.length + 1);
    }
    return normalizedFilePath || filePath;
}

function candidateFromProjectAsset(asset: any, projectPath?: string): ImageCandidate | null {
    const path = cleanText(asset?.path);
    if (!path) return null;
    const relativePath = inferRelativePath(path, projectPath, asset?.relativePath);
    return {
        path,
        relativePath,
        name: cleanText(asset?.name) || relativePath.split(/[\\/]/).pop() || path,
        folderType: cleanText(asset?.folderRole) || undefined,
        imageType: cleanText(asset?.role || asset?.type) || undefined
    };
}

function buildProjectAssetLookup(projectContext: any): Map<string, any> {
    const lookup = new Map<string, any>();
    const assets = Array.isArray(projectContext?.assetIndex?.assets) ? projectContext.assetIndex.assets : [];
    for (const asset of assets) {
        const id = cleanText(asset?.id);
        const path = cleanText(asset?.path);
        if (id) lookup.set(`id:${id}`, asset);
        if (path) lookup.set(`path:${normalizePathText(path).toLowerCase()}`, asset);
    }
    return lookup;
}

function findProjectAssetForPath(projectContext: any, lookup: Map<string, any>, path: string): any | undefined {
    const normalizedPath = normalizePathText(path).toLowerCase();
    const exact = lookup.get(`path:${normalizedPath}`);
    if (exact) return exact;
    const projectPath = normalizePathText(projectContext?.projectPath).replace(/\/+$/, '').toLowerCase();
    if (projectPath && !/^[a-z]:\//i.test(normalizedPath) && !normalizedPath.startsWith('/')) {
        return lookup.get(`path:${projectPath}/${normalizedPath}`);
    }
    return undefined;
}

function candidateFromPathLike(input: {
    path: unknown;
    projectContext: any;
    lookup: Map<string, any>;
    relativePath?: unknown;
    name?: unknown;
    folderType?: unknown;
    imageType?: unknown;
}): ImageCandidate | null {
    const path = cleanText(input.path);
    if (!path) return null;
    const asset = findProjectAssetForPath(input.projectContext, input.lookup, path);
    const fromAsset = asset ? candidateFromProjectAsset(asset, input.projectContext?.projectPath) : null;
    if (fromAsset) return fromAsset;

    const relativePath = inferRelativePath(path, input.projectContext?.projectPath, cleanText(input.relativePath));
    return {
        path,
        relativePath,
        name: cleanText(input.name) || relativePath.split(/[\\/]/).pop() || path,
        folderType: cleanText(input.folderType) || undefined,
        imageType: cleanText(input.imageType) || undefined
    };
}

function flattenProjectContextImages(projectContext: any): ImageCandidate[] {
    const lookup = buildProjectAssetLookup(projectContext);
    const all: ImageCandidate[] = [];
    const take = (candidate: ImageCandidate | null) => {
        if (candidate) all.push(candidate);
    };

    take(candidateFromPathLike({
        path: projectContext?.selectedProjectImagePath,
        projectContext,
        lookup,
        name: projectContext?.selectedProjectImageName
    }));

    for (const samplePath of normalizeTextList(projectContext?.sampleImagePaths)) {
        take(candidateFromPathLike({ path: samplePath, projectContext, lookup }));
    }

    const selectedCandidates = Array.isArray(projectContext?.visualSamplingPlan?.selectedCandidates)
        ? projectContext.visualSamplingPlan.selectedCandidates
        : [];
    for (const candidate of selectedCandidates) {
        const asset = cleanText(candidate?.assetId) ? lookup.get(`id:${cleanText(candidate.assetId)}`) : undefined;
        take(asset
            ? candidateFromProjectAsset(asset, projectContext?.projectPath)
            : candidateFromPathLike({
                path: candidate?.path,
                projectContext,
                lookup,
                imageType: candidate?.role
            }));
    }

    const visionCandidates = Array.isArray(projectContext?.assetIndex?.visionCandidates)
        ? projectContext.assetIndex.visionCandidates
        : [];
    for (const candidate of visionCandidates) {
        const asset = cleanText(candidate?.assetId) ? lookup.get(`id:${cleanText(candidate.assetId)}`) : undefined;
        take(asset
            ? candidateFromProjectAsset(asset, projectContext?.projectPath)
            : candidateFromPathLike({
                path: candidate?.path,
                projectContext,
                lookup,
                imageType: candidate?.role
            }));
    }

    const assets = Array.isArray(projectContext?.assetIndex?.assets) ? projectContext.assetIndex.assets : [];
    for (const asset of assets) {
        if (asset?.isImage === false) continue;
        take(candidateFromProjectAsset(asset, projectContext?.projectPath));
    }

    return dedupeImages(all);
}

function dedupeImages(images: ImageCandidate[]): ImageCandidate[] {
    const seen = new Set<string>();
    const result: ImageCandidate[] = [];
    for (const image of images) {
        const key = image.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(image);
    }
    return result;
}

function buildPreferredImages(input: {
    allImages: ImageCandidate[];
    projectContext: any;
    sampleSize: number;
    directories?: string[];
}): ImageCandidate[] {
    const { allImages, projectContext, sampleSize, directories } = input;
    const selected = String(projectContext?.selectedProjectImagePath || '').trim();
    const samplePaths = normalizeTextList(projectContext?.sampleImagePaths);
    const directoryFilters = normalizeTextList(directories).map((value) => value.toLowerCase());

    const preferred = new Map<string, ImageCandidate>();
    const take = (image?: ImageCandidate) => {
        if (!image) return;
        const key = image.path.toLowerCase();
        if (!preferred.has(key)) preferred.set(key, image);
    };

    if (selected) {
        take(allImages.find((image) => image.path.toLowerCase() === selected.toLowerCase()));
    }

    for (const samplePath of samplePaths) {
        take(allImages.find((image) => image.path.toLowerCase() === samplePath.toLowerCase()));
    }

    const scored = allImages
        .map((image) => {
            let score = 0;
            const folderType = String(image.folderType || '').toLowerCase();
            const imageType = String(image.imageType || '').toLowerCase();
            const relativePath = image.relativePath.toLowerCase();

            if (folderType === 'source') score += 20;
            if (imageType === 'product' || imageType === 'model' || imageType === 'detail' || imageType === 'material') score += 12;
            if (directoryFilters.length && directoryFilters.some((dir) => relativePath.includes(dir))) score += 18;
            if (/原图|拍摄图|素材|source|raw/.test(relativePath)) score += 10;

            return { image, score };
        })
        .sort((a, b) => b.score - a.score || a.image.relativePath.localeCompare(b.image.relativePath));

    // 同分档内按「文件名前缀系列」轮转采样：摄影素材常按系列命名（SZW_ 平铺组、
    // YYC_ 模特组等），字典序会让单一系列霸占全部样本（实测：39 张取 10 张全是
    // 平铺图、模特图零覆盖，产品理解直接失真）。轮转保证每个拍摄系列均衡进样本。
    const seriesOf = (image: ImageCandidate): string => {
        const fileName = image.relativePath.split(/[\\/]/).pop() || '';
        const prefixMatch = fileName.match(/^([A-Za-z]+)/);
        return prefixMatch ? prefixMatch[1].toUpperCase() : '#数字';
    };
    const scoreTiers = new Map<number, Map<string, ImageCandidate[]>>();
    for (const item of scored) {
        if (!scoreTiers.has(item.score)) scoreTiers.set(item.score, new Map());
        const tier = scoreTiers.get(item.score)!;
        const series = seriesOf(item.image);
        if (!tier.has(series)) tier.set(series, []);
        tier.get(series)!.push(item.image);
    }
    const tierScores = [...scoreTiers.keys()].sort((a, b) => b - a);
    for (const tierScore of tierScores) {
        if (preferred.size >= sampleSize) break;
        const seriesQueues = [...scoreTiers.get(tierScore)!.values()];
        let drained = false;
        while (!drained && preferred.size < sampleSize) {
            drained = true;
            for (const queue of seriesQueues) {
                const next = queue.shift();
                if (next) {
                    drained = false;
                    take(next);
                    if (preferred.size >= sampleSize) break;
                }
            }
        }
    }

    return Array.from(preferred.values()).slice(0, sampleSize);
}

function parseContactSheetId(id: string): number | undefined {
    const match = /^A(\d+)$/i.exec(String(id || '').trim());
    if (!match) return undefined;
    const index = Number(match[1]) - 1;
    return Number.isFinite(index) && index >= 0 ? index : undefined;
}

function selectImagesFromContactSheetObservation(input: {
    overviewImages: ImageCandidate[];
    overview?: ContactSheetOverviewAnalysis;
}): ImageCandidate[] {
    const ids = new Set<string>();
    for (const id of normalizeTextList(input.overview?.observation?.nextSingleImageChecks)) {
        ids.add(id.toUpperCase());
    }
    for (const role of input.overview?.observation?.imageRoles || []) {
        const roleText = `${role.role || ''} ${role.reason || ''}`.toLowerCase();
        if (/sku|主图|详情|细节|场景|product|detail|hero|candidate/.test(roleText)) {
            ids.add(String(role.id || '').toUpperCase());
        }
    }

    const selected: ImageCandidate[] = [];
    for (const id of ids) {
        const index = parseContactSheetId(id);
        if (index === undefined) continue;
        const image = input.overviewImages[index];
        if (image) selected.push(image);
    }
    return dedupeImages(selected);
}

function buildDeterministicSummary(analyses: Array<{ image: ImageCandidate; analysis: AssetAnalysis }>): string {
    const subjects = new Map<string, number>();
    const styles = new Map<string, number>();
    const placements = new Map<string, number>();
    const colors = new Map<string, number>();

    for (const item of analyses) {
        const subject = String(item.analysis.mainSubject || '').trim();
        const style = String(item.analysis.style || '').trim();
        const placement = String(item.analysis.suggestedPlacement || '').trim();
        if (subject) subjects.set(subject, (subjects.get(subject) || 0) + 1);
        if (style) styles.set(style, (styles.get(style) || 0) + 1);
        if (placement) placements.set(placement, (placements.get(placement) || 0) + 1);
        for (const color of normalizeTextList(item.analysis.colors)) {
            colors.set(color, (colors.get(color) || 0) + 1);
        }
    }

    const top = (map: Map<string, number>, count = 3) =>
        Array.from(map.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, count)
            .map(([value]) => value);

    const subjectText = top(subjects).join('、') || '需要人工确认';
    const styleText = top(styles).join('、') || '需要人工确认';
    const placementText = top(placements).join('、') || '需要人工确认';
    const colorText = top(colors).join('、') || '待补充';

    return [
        `已分析 ${analyses.length} 张项目图片。`,
        `主体判断：${subjectText}。`,
        `视觉风格：${styleText}。`,
        `常见配色：${colorText}。`,
        `设计中可优先强调：${placementText}。`
    ].join('\n');
}

function buildAnalysisInsightSummary(image: ImageCandidate, analysis: AssetAnalysis): string {
    return cleanText(analysis.description)
        || [
            cleanText(analysis.mainSubject),
            cleanText(analysis.category),
            cleanText(analysis.suggestedPlacement || analysis.scene),
            normalizeTextList(analysis.colors).join('、')
        ].filter(Boolean).join('，')
        || `已分析项目图片 ${image.relativePath || image.name}`;
}

function buildVisualInsightEntriesFromAnalyses(
    analyses: Array<{ image: ImageCandidate; analysis: AssetAnalysis }>,
    capturedAt: string
) {
    return analyses.map((item) => {
        const styleTags = unique([
            cleanText(item.analysis.style),
            cleanText(item.analysis.suggestedPlacement || item.analysis.scene),
            ...normalizeTextList(item.analysis.suggestedEffects),
            ...normalizeTextList(item.analysis.colors)
        ]);
        return {
            cacheKey: `project-image-analysis:${stableHash(item.image.path)}`,
            assetId: item.image.path,
            path: item.image.path.replace(/\\/g, '/'),
            updatedAt: capturedAt,
            insight: {
                assetId: item.image.path,
                path: item.image.path.replace(/\\/g, '/'),
                summary: buildAnalysisInsightSummary(item.image, item.analysis),
                productType: cleanText(item.analysis.category || item.analysis.mainSubject) || undefined,
                scene: cleanText(item.analysis.scene || item.analysis.suggestedPlacement) || undefined,
                material: cleanText(item.analysis.material) || undefined,
                styleTags,
                capturedAt,
                modelId: 'analyzeAssetContent',
                sourceNotes: [{
                    source: item.image.path.replace(/\\/g, '/'),
                    summary: `视觉分析样本：${item.image.relativePath || item.image.name}`
                }]
            },
            sourceRecords: [{
                source: item.image.path.replace(/\\/g, '/'),
                summary: `缓存项目图片理解：${item.image.relativePath || item.image.name}`
            }]
        };
    });
}

function joinVisibleItems(items: string[] | undefined, maxItems = 5): string {
    return normalizeTextList(items).slice(0, maxItems).join('、');
}

function userFacingBriefValue(value: unknown): string {
    const text = cleanText(value);
    if (!text || text === 'unknown') return '';
    const lower = text.toLowerCase();
    const translations: Record<string, string> = {
        socks: '袜子',
        sock: '袜子'
    };
    if (translations[lower]) return translations[lower];
    if (/^[a-z]+(?:_[a-z]+)+$/.test(lower)) return '';
    return text;
}

function buildUserVisibleProductUnderstandingLines(productUnderstanding: ReturnType<typeof buildProjectDesignUnderstandingSummary>): string[] {
    const understanding = productUnderstanding.understanding;
    const productType = userFacingBriefValue(understanding.observations.productTypes[0]);
    const productParts = [
        productType
            ? `款式：${productType}`
            : '',
        joinVisibleItems(understanding.observations.materials)
            ? `材质线索：${joinVisibleItems(understanding.observations.materials)}`
            : ''
    ].filter(Boolean);
    const summaryText = joinVisibleItems(understanding.observations.visualSummaries);
    const toneText = joinVisibleItems(understanding.observations.styleTags);
    const sellingText = joinVisibleItems(understanding.observations.sellingPointObservations);
    const sceneText = joinVisibleItems(understanding.observations.scenes);
    const warningText = joinVisibleItems(understanding.warnings, 3);

    return [
        productParts.length ? `观察到的产品信息：${productParts.join('，')}。` : '',
        summaryText ? `画面观察：${summaryText}。` : '',
        sceneText ? `场景观察：${sceneText}。` : '',
        toneText ? `风格标签：${toneText}。` : '',
        sellingText ? `可见卖点观察：${sellingText}。` : '',
        warningText ? `注意：${warningText}。` : ''
    ].filter(Boolean);
}

async function writeVisualInsightCacheIfAvailable(input: {
    projectPath?: string;
    entries: ReturnType<typeof buildVisualInsightEntriesFromAnalyses>;
    capturedAt: string;
}): Promise<{ attempted: boolean; success: boolean; error?: string }> {
    const writer = (window as any)?.designEcho?.writeProjectVisualInsightCache;
    if (!input.projectPath || !input.entries.length || typeof writer !== 'function') {
        return { attempted: false, success: false };
    }
    try {
        await writer({
            projectPath: input.projectPath,
            entries: input.entries,
            replace: false,
            nowIso: input.capturedAt
        });
        return { attempted: true, success: true };
    } catch (error: any) {
        return {
            attempted: true,
            success: false,
            error: cleanText(error?.message || error) || '视觉理解缓存写入失败。'
        };
    }
}

function buildProjectInventoryOverview(input: {
    projectPath?: string;
    totalProjectImages: number;
    structure: any;
    allImages: ImageCandidate[];
}): {
    compactText: string;
    detailText: string;
    followUpHint: string;
    overview: ProjectInventoryOverview;
    folderSummaries: ProjectInventoryFolder[];
    typeCounts: Record<string, number>;
    sampleImages: string[];
} {
    const folders = Array.isArray(input.structure?.folders) ? input.structure.folders : [];
    const folderSummaries: ProjectInventoryFolder[] = [];
    const typeCounts = new Map<string, number>();

    const walk = (folder: any, prefix = '') => {
        const folderName = String(folder?.name || folder?.label || folder?.type || '未命名文件夹').trim();
        const displayName = prefix ? `${prefix}/${folderName}` : folderName;
        const images = Array.isArray(folder?.images) ? folder.images : [];
        const sampleImages = images
            .map((image: any) => String(image?.relativePath || image?.name || image?.path || '').trim())
            .filter(Boolean)
            .slice(0, 4);

        if (images.length || folder?.type || folder?.name || folder?.label) {
            folderSummaries.push({
                name: displayName,
                type: String(folder?.type || '').trim() || undefined,
                imageCount: images.length,
                sampleImages
            });
        }

        for (const image of images) {
            const type = String(image?.type || folder?.type || 'unknown').trim() || 'unknown';
            typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }

        for (const child of Array.isArray(folder?.children) ? folder.children : []) {
            walk(child, displayName);
        }
    };

    for (const folder of folders) walk(folder);

    const typeCountRecord = Object.fromEntries(
        Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    );
    const folderLines = folderSummaries.length
        ? folderSummaries.slice(0, 8).map((folder) => {
            const typeText = folder.type ? `，类型 ${folder.type}` : '';
            const sampleText = folder.sampleImages.length ? `，样例：${folder.sampleImages.join('、')}` : '';
            return `- ${folder.name || '未命名文件夹'}：${folder.imageCount} 个资源${typeText}${sampleText}`;
        })
        : ['- 当前项目结构里还没有可展示的文件夹索引。'];
    const typeLines = Object.keys(typeCountRecord).length
        ? Object.entries(typeCountRecord).map(([type, count]) => `- ${type}: ${count}`)
        : ['- 暂无可统计的资源类型。'];
    const sampleImages = input.allImages
        .slice(0, 8)
        .map((image) => image.relativePath || image.name)
        .filter(Boolean);

    const folderCount = folderSummaries.length;
    const typeCount = Object.keys(typeCountRecord).length;
    const compactText = `已读取当前项目资源索引：${input.totalProjectImages} 个图片/素材，${folderCount} 个文件夹，${typeCount} 类资源。`;
    const followUpHint = '如果要判断款式、卖点或详情页方向，需要再进入项目图片内容分析。';
    const detailText = [
        '项目资源概览：',
        `- 项目路径：${input.projectPath || '未解析'}`,
        `- 已索引图片/素材数：${input.totalProjectImages}`,
        '',
        '主要文件夹：',
        ...folderLines,
        '',
        '资源类型统计：',
        ...typeLines,
        '',
        followUpHint
    ].join('\n');
    const overview: ProjectInventoryOverview = {
        version: 'project-inventory-overview/v0',
        projectPath: input.projectPath,
        totalProjectImages: input.totalProjectImages,
        folderCount,
        typeCount,
        compactText,
        detailText,
        followUpHint,
        folderSummaries,
        typeCounts: typeCountRecord,
        sampleImages
    };

    return {
        compactText,
        detailText,
        followUpHint,
        overview,
        folderSummaries,
        typeCounts: typeCountRecord,
        sampleImages
    };
}

async function summarizeAnalyses(params: {
    analyses: Array<{ image: ImageCandidate; analysis: AssetAnalysis }>;
    focus: string;
    userIntent: string;
}): Promise<string | null> {
    if (!(window as any)?.designEcho?.chat) return null;
    const modelId = getSummaryModelId();
    const prompt = [
        'You are summarizing project images for a general Photoshop design agent working on the current design task.',
        'Use only the analyzed image metadata provided below.',
        'Do not pretend to have seen more images than were analyzed.',
        'Answer in concise Chinese.',
        'Output plain text only.',
        '',
        `User intent: ${params.userIntent || 'Analyze project images for design use'}`,
        `Focus: ${params.focus}`,
        '',
        'Return with these sections:',
        '1. 款式判断',
        '2. 主要特征',
        '3. 设计使用建议',
        '4. 还缺什么信息',
        '',
        `Analyzed samples (${params.analyses.length}):`,
        JSON.stringify(
            params.analyses.map((item) => ({
                image: item.image.relativePath,
                folderType: item.image.folderType,
                imageType: item.image.imageType,
                analysis: item.analysis
            })),
            null,
            2
        )
    ].join('\n');

    try {
        const response = await (window as any).designEcho.chat(
            modelId,
            [
                {
                    role: 'system',
                    content: 'You are a careful image analyst for Photoshop design workflows. Use only the provided image observations and project context. Reply in Chinese.'
                },
                { role: 'user', content: prompt }
            ],
            { temperature: 0.2, maxTokens: 900 }
        );
        const text = String(response?.text || '').trim();
        return text || null;
    } catch {
        return null;
    }
}

export const projectImageAnalysisExecutor: SkillExecutor = {
    skillId: 'project-image-analysis',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const isCancelled = () => Boolean(signal?.aborted);
        const buildCancelledResult = (analyzedSampleCount = 0): AgentResult => ({
            success: false,
            cancelled: true,
            message: analyzedSampleCount > 0
                ? `已停止项目图片分析，停止前完成了 ${analyzedSampleCount} 张样本。`
                : '已停止项目图片分析。',
            error: 'cancelled',
            data: {
                analyzedSampleCount,
                stopReason: 'cancelled'
            }
        });
        if (isCancelled()) return buildCancelledResult();

        const projectContext = context?.projectContext;
        const structure = (useAppStore.getState() as any).ecommerceStructure;
        const allImages = dedupeImages([
            ...flattenProjectImages(structure),
            ...flattenProjectContextImages(projectContext)
        ]);
        const totalProjectImages = Number(
            projectContext?.projectImageCount
            || projectContext?.assetIndex?.summary?.totalImages
            || allImages.length
            || 0
        );
        const focus = String(params?.focus || 'style-and-detail-page').trim();
        const userIntent = String(params?.userIntent || context?.userInput || '').trim();
        const requestedSampleSize = Number(params?.sampleSize);
        const analysisMode = String(params?.analysisMode || 'content').trim() === 'inventory'
            || isProjectImageAnalysisInventoryOverviewIntent(userIntent)
            || (requestedSampleSize === 0 && focus === 'inventory')
            ? 'inventory'
            : 'content';
        const sampleSize = analysisMode === 'inventory' ? 0 : Math.max(1, Math.min(12, Number(params?.sampleSize || 6)));
        const directories = Array.isArray(params?.directories) ? params.directories : [];

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '读取项目图片上下文',
            detail: `项目路径: ${projectContext?.projectPath || '未解析'}；项目图片数: ${totalProjectImages}；请求样本数: ${sampleSize}`,
            status: 'running',
            percent: 8
        });

        if (!projectContext?.projectPath) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目图片分析未开始',
                detail: '当前没有项目上下文，无法直接分析项目图片。',
                status: 'error',
                issue: 'Missing project context'
            });
            return {
                success: false,
                message: '当前没有项目上下文，无法直接分析项目图片。',
                error: 'Missing project context'
            };
        }

        if (analysisMode === 'inventory') {
            if (isCancelled()) return buildCancelledResult();
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '读取项目资源索引',
                detail: `项目路径: ${projectContext?.projectPath || '未解析'}；资源数: ${totalProjectImages}`,
                status: 'running',
                percent: 30
            });
            const overview = buildProjectInventoryOverview({
                projectPath: projectContext?.projectPath,
                totalProjectImages,
                structure,
                allImages
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目资源概览完成',
                detail: `文件夹: ${overview.folderSummaries.length}；资源类型: ${Object.keys(overview.typeCounts).length}；未调用视觉分析。`,
                status: 'success',
                percent: 100
            });

            return {
                success: true,
                message: overview.compactText,
                data: {
                    analysisMode,
                    focus,
                    userIntent,
                    totalProjectImages,
                    analyzedSampleCount: 0,
                    folderSummaries: overview.folderSummaries,
                    typeCounts: overview.typeCounts,
                    sampleImages: overview.sampleImages,
                    projectInventoryOverview: overview.overview,
                    summarySource: 'project-index'
                }
            };
        }

        if (!allImages.length) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目图片分析未开始',
                detail: '当前项目里没有可分析的图片资源。',
                status: 'error',
                issue: 'No project images available'
            });
            return {
                success: false,
                message: '当前项目里没有可分析的图片资源。',
                error: 'No project images available'
            };
        }

        const overviewMaxImages = Math.max(sampleSize, Math.min(40, Number(params?.overviewMaxImages || 24)));
        const overviewImages = buildPreferredImages({
            allImages,
            projectContext,
            sampleSize: overviewMaxImages,
            directories
        });
        let contactSheetOverview: ContactSheetOverviewAnalysis | undefined;
        if (typeof (window as any).designEcho?.analyzeProjectContactSheetOverview === 'function' && overviewImages.length) {
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '建立项目图片总览',
                detail: `准备把 ${overviewImages.length} 张项目图片合成带编号总览，先判断整体款式、拍摄风格和重点复核编号。`,
                status: 'running',
                toolName: 'analyzeProjectContactSheetOverview',
                percent: 12
            });
            try {
                contactSheetOverview = await (window as any).designEcho.analyzeProjectContactSheetOverview({
                    projectPath: projectContext?.projectPath,
                    images: overviewImages.map((image) => ({
                        path: image.path,
                        relativePath: image.relativePath,
                        labelHint: image.name,
                        role: image.imageType || image.folderType
                    })),
                    maxImages: overviewImages.length,
                    columns: 4,
                    focus,
                    userIntent
                }) as ContactSheetOverviewAnalysis;
                emitSkillStep(callbacks, {
                    kind: 'observation',
                    title: contactSheetOverview?.success ? '项目图片总览已观察' : '项目图片总览观察失败',
                    detail: contactSheetOverview?.success
                        ? [
                            contactSheetOverview.observation?.productUnderstanding,
                            contactSheetOverview.observation?.projectStyle,
                            contactSheetOverview.observation?.nextSingleImageChecks?.length
                                ? `建议放大复核: ${contactSheetOverview.observation.nextSingleImageChecks.join('、')}`
                                : ''
                        ].filter(Boolean).join('；')
                        : (contactSheetOverview?.error || '总览观察未返回有效结果。'),
                    status: contactSheetOverview?.success ? 'success' : 'error',
                    toolName: 'analyzeProjectContactSheetOverview',
                    percent: 16,
                    issue: contactSheetOverview?.success ? undefined : contactSheetOverview?.error
                });
            } catch (error: any) {
                contactSheetOverview = {
                    success: false,
                    error: String(error?.message || error || '项目图片总览观察异常')
                };
                emitSkillStep(callbacks, {
                    kind: 'observation',
                    title: '项目图片总览观察异常',
                    detail: contactSheetOverview.error || '项目图片总览观察异常',
                    status: 'error',
                    toolName: 'analyzeProjectContactSheetOverview',
                    percent: 16,
                    issue: contactSheetOverview.error
                });
            }
        }
        if (isCancelled()) return buildCancelledResult();

        const overviewSelectedImages = selectImagesFromContactSheetObservation({
            overviewImages,
            overview: contactSheetOverview
        });
        const selectedImages = dedupeImages([
            ...overviewSelectedImages,
            ...buildPreferredImages({
                allImages,
                projectContext,
                sampleSize,
                directories
            })
        ]).slice(0, sampleSize);

        const overviewSelectionDetail = overviewSelectedImages.length
            ? `；总览建议优先复核 ${overviewSelectedImages.map((image) => image.relativePath).join('、')}`
            : '';

        const selectedImagesForLog = selectedImages.map((image) => image.relativePath).join('、');

        if (isCancelled()) return buildCancelledResult();

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '选择分析样本',
            detail: `已从 ${totalProjectImages} 张图片中选择 ${selectedImages.length} 张样本；目录过滤: ${directories.length ? directories.join('、') : '未指定'}；分析焦点: ${focus}${overviewSelectionDetail}；样本: ${selectedImagesForLog || '无'}`,
            status: selectedImages.length ? 'success' : 'error',
            percent: 18,
            issue: selectedImages.length ? undefined : 'No image sample selected'
        });

        if (!selectedImages.length) {
            return {
                success: false,
                message: '项目图片已扫描，但没有选出可分析的样本。',
                error: 'No image sample selected'
            };
        }

        callbacks?.onMessage?.(`开始分析项目图片：从 ${totalProjectImages} 张里抽取 ${selectedImages.length} 张样本。`);

        const analyses: Array<{ image: ImageCandidate; analysis: AssetAnalysis }> = [];
        const failures: Array<{ image: ImageCandidate; error: string }> = [];

        for (let index = 0; index < selectedImages.length; index += 1) {
            if (isCancelled()) break;
            const image = selectedImages[index];
            callbacks?.onProgress?.(`分析项目图片 ${index + 1}/${selectedImages.length}`, Math.round(((index + 1) / selectedImages.length) * 70));
            callbacks?.onMessage?.(`读取样本 ${index + 1}/${selectedImages.length}: ${image.relativePath}`);
            emitSkillStep(callbacks, {
                kind: 'tool_started',
                title: `分析图片样本 ${index + 1}/${selectedImages.length}`,
                detail: image.relativePath,
                status: 'running',
                toolName: 'analyzeAssetContent',
                percent: Math.min(74, 22 + Math.round((index / selectedImages.length) * 52))
            });

            try {
                const result = await (window as any).designEcho.analyzeAssetContent(image.path);
                if (isCancelled()) break;
                if (result?.success && result.analysis) {
                    analyses.push({ image, analysis: result.analysis as AssetAnalysis });
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: `图片样本已分析 ${index + 1}/${selectedImages.length}`,
                        detail: image.relativePath,
                        status: 'success',
                        toolName: 'analyzeAssetContent',
                        percent: Math.min(78, 26 + Math.round(((index + 1) / selectedImages.length) * 52))
                    });
                } else {
                    const error = String(result?.error || 'Unknown analysis failure');
                    failures.push({
                        image,
                        error
                    });
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: `图片样本分析失败 ${index + 1}/${selectedImages.length}`,
                        detail: `${image.relativePath}: ${error}`,
                        status: 'error',
                        toolName: 'analyzeAssetContent',
                        issue: error
                    });
                }
            } catch (error: any) {
                if (isCancelled()) break;
                const errorMessage = String(error?.message || error || 'Unknown analysis failure');
                failures.push({
                    image,
                    error: errorMessage
                });
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: `图片样本分析异常 ${index + 1}/${selectedImages.length}`,
                    detail: `${image.relativePath}: ${errorMessage}`,
                    status: 'error',
                    toolName: 'analyzeAssetContent',
                    issue: errorMessage
                });
            }
        }
        if (isCancelled()) return buildCancelledResult(analyses.length);

        if (!analyses.length) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '项目图片分析未完成',
                detail: '已选中的图片样本没有成功返回视觉分析结果。',
                status: 'error',
                issue: failures.map((item) => `${item.image.relativePath}: ${item.error}`).join('; ')
            });
            return {
                success: false,
                message: '项目图片样本读取到了，但视觉分析没有成功返回结果。',
                error: failures.map((item) => `${item.image.relativePath}: ${item.error}`).join('; ')
            };
        }

        callbacks?.onProgress?.('汇总图片分析结果', 82);
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '汇总图片分析结果',
            detail: `成功样本: ${analyses.length}；失败样本: ${failures.length}；汇总模型: ${getSummaryModelId()}`,
            status: 'running',
            percent: 82
        });
        const modelSummary = await summarizeAnalyses({ analyses, focus, userIntent });
        if (isCancelled()) return buildCancelledResult(analyses.length);
        const summarySource = modelSummary ? 'model' : 'sample-derived';
        const summary = modelSummary || buildDeterministicSummary(analyses);
        const capturedAt = new Date().toISOString();
        const visualInsightEntries = buildVisualInsightEntriesFromAnalyses(analyses, capturedAt);
        const projectVisualInsightCache = buildProjectVisualInsightCacheReadResult({
            source: 'provided-options',
            exists: visualInsightEntries.length > 0,
            entries: visualInsightEntries
        });
        const productUnderstanding = buildProjectDesignUnderstandingSummary({
            projectContext: {
                assetIndex: projectContext?.assetIndex,
                visualInsightCache: projectVisualInsightCache
            }
        });
        const cacheWrite = await writeVisualInsightCacheIfAvailable({
            projectPath: projectContext?.projectPath,
            entries: visualInsightEntries,
            capturedAt
        });
        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '项目图片分析完成',
            detail: `成功样本: ${analyses.length}；失败样本: ${failures.length}；汇总来源: ${summarySource === 'model' ? '模型汇总' : '样本统计'}；视觉缓存: ${cacheWrite.success ? '已写入' : cacheWrite.attempted ? '写入失败' : '未启用'}`,
            status: 'success',
            percent: 100
        });

        const analyzedPaths = analyses.map((item) => `- ${item.image.relativePath}`);
        const failureLines = failures.length
            ? ['','未成功分析的样本：', ...failures.map((item) => `- ${item.image.relativePath}: ${item.error}`)]
            : [];
        const contactSheetObservationLines = contactSheetOverview?.success
            ? [
                '',
                '项目总览观察：',
                contactSheetOverview.observation?.productUnderstanding ? `- 产品/款式：${contactSheetOverview.observation.productUnderstanding}` : '',
                contactSheetOverview.observation?.projectStyle ? `- 视觉风格：${contactSheetOverview.observation.projectStyle}` : '',
                contactSheetOverview.observation?.sellingPoints?.length ? `- 可见卖点方向：${contactSheetOverview.observation.sellingPoints.join('、')}` : '',
                contactSheetOverview.observation?.nextSingleImageChecks?.length ? `- 建议放大复核：${contactSheetOverview.observation.nextSingleImageChecks.join('、')}` : ''
            ].filter(Boolean)
            : [];
        const userVisibleUnderstandingLines = buildUserVisibleProductUnderstandingLines(productUnderstanding);

        return {
            success: true,
            message: [
                `已基于项目中的 ${analyses.length} 张图片样本完成分析（项目共 ${totalProjectImages} 张）。`,
                ...contactSheetObservationLines,
                '',
                summarySource === 'model'
                    ? '以下结论来自模型对已分析样本的汇总：'
                    : '模型汇总暂时不可用，以下结论直接由已分析样本统计得到：',
                '',
                summary,
                '',
                '图片理解提炼：',
                ...userVisibleUnderstandingLines.map((item) => `- ${item}`),
                '',
                '已分析样本：',
                ...analyzedPaths,
                ...failureLines
            ].join('\n'),
            data: {
                focus,
                userIntent,
                totalProjectImages,
                analyzedSampleCount: analyses.length,
                analyzedSamples: analyses.map((item) => ({
                    path: item.image.path,
                    relativePath: item.image.relativePath,
                    name: item.image.name,
                    folderType: item.image.folderType,
                    imageType: item.image.imageType,
                    analysis: item.analysis
                })),
                failedSamples: failures,
                summary,
                summarySource,
                contactSheetOverview: contactSheetOverview ? {
                    success: Boolean(contactSheetOverview.success),
                    observation: contactSheetOverview.observation,
                    items: contactSheetOverview.contactSheet?.items?.map((item) => ({
                        id: item.id,
                        path: item.path,
                        relativePath: item.relativePath,
                        labelHint: item.labelHint,
                        status: item.status
                    })) || [],
                    error: contactSheetOverview.error
                } : undefined,
                productDesignUnderstanding: productUnderstanding,
                visualInsightCacheWrite: cacheWrite
            }
        };
    }
};
