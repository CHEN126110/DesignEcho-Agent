import type { DesignKnowledgeAllowedUse, DesignKnowledgeResult } from './design-knowledge-search';
import type { EagleReadonlyKnowledgeResponse } from './eagle-readonly-knowledge';

export type EagleVisualCaseIndexVersion = 'eagle-visual-case-index/v0';
export type EagleVisualCasePurpose = 'design_reference' | 'visual_benchmark' | 'style_memory';
export type EagleVisualReadiness = 'needs_visual_analysis' | 'metadata_only';
export type EagleVisualUnknownStatus = 'unknown';

export const EAGLE_VISUAL_CASE_INDEX_VERSION: EagleVisualCaseIndexVersion = 'eagle-visual-case-index/v0';

export interface EagleVisualCaseIndexOptions {
    purpose?: EagleVisualCasePurpose;
    requestedBy?: string;
    generatedAt?: string;
}

export interface EagleVisualCaseIndexBoundary {
    readonly: true;
    doesNotWriteEagle: true;
    doesNotRunPhotoshop: true;
    doesNotReturnRawImages: true;
    doesNotInferUnobservedVisualFacts: true;
}

export interface EagleVisualCaseSource {
    provider: 'eagle';
    itemId: string;
    sourceUrl?: string;
    filePath?: string;
    thumbnailPath?: string;
    knowledgeResultId: string;
}

export interface EagleVisualCaseAssetMetadata {
    name: string;
    extension?: string;
    width?: number;
    height?: number;
    tags: string[];
    folders: string[];
    annotation: string;
    updatedAt?: string;
}

export interface EagleVisualCaseAnalysisPlaceholder {
    ocrStatus: EagleVisualUnknownStatus;
    compositionStatus: EagleVisualUnknownStatus;
    subjectRegions: never[];
    dominantColors: never[];
    modules: never[];
    measuredBy?: never;
}

export interface EagleVisualCaseIndexItem {
    caseId: string;
    purpose: EagleVisualCasePurpose;
    visualReadiness: EagleVisualReadiness;
    source: EagleVisualCaseSource;
    asset: EagleVisualCaseAssetMetadata;
    analysis: EagleVisualCaseAnalysisPlaceholder;
    allowedUses: DesignKnowledgeAllowedUse[];
    sourceNotes: string[];
    warnings: string[];
    limitations: string[];
}

export interface EagleVisualCaseIndex {
    version: EagleVisualCaseIndexVersion;
    source: {
        provider: 'eagle';
        knowledgeVersion?: string;
        requestedBy?: string;
        generatedAt?: string;
    };
    summary: {
        caseCount: number;
        needsVisualAnalysisCount: number;
        metadataOnlyCount: number;
        folderCount: number;
        tagCount: number;
    };
    cases: EagleVisualCaseIndexItem[];
    warnings: string[];
    limitations: string[];
    boundaries: EagleVisualCaseIndexBoundary;
}

const RAW_IMAGE_KEYS = [
    'data:image',
    ';base64,',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"'
];

const DIRECT_PHOTOSHOP_ACTION = 'direct_photoshop_action';

export function buildEagleVisualCaseIndexFromReadonlyKnowledge(
    readonlyKnowledge: Pick<EagleReadonlyKnowledgeResponse, 'version' | 'results' | 'warnings'>,
    options: EagleVisualCaseIndexOptions = {}
): EagleVisualCaseIndex {
    const cases = (Array.isArray(readonlyKnowledge.results) ? readonlyKnowledge.results : [])
        .filter((result) => result.sourceType === 'eagle_library')
        .map((result) => buildVisualCase(result, options));
    const tags = uniqueStrings(cases.flatMap((item) => item.asset.tags));
    const folders = uniqueStrings(cases.flatMap((item) => item.asset.folders));
    const index: EagleVisualCaseIndex = {
        version: EAGLE_VISUAL_CASE_INDEX_VERSION,
        source: {
            provider: 'eagle',
            knowledgeVersion: readonlyKnowledge.version,
            requestedBy: normalizeText(options.requestedBy),
            generatedAt: normalizeText(options.generatedAt)
        },
        summary: {
            caseCount: cases.length,
            needsVisualAnalysisCount: cases.filter((item) => item.visualReadiness === 'needs_visual_analysis').length,
            metadataOnlyCount: cases.filter((item) => item.visualReadiness === 'metadata_only').length,
            folderCount: folders.length,
            tagCount: tags.length
        },
        cases,
        warnings: [
            ...(Array.isArray(readonlyKnowledge.warnings) ? readonlyKnowledge.warnings.map(normalizeText).filter(Boolean) : [])
        ],
        limitations: [
            'EagleVisualCaseIndex 只索引 Eagle 只读素材元数据，不读取原始图片字节。',
            '该索引不会运行 Photoshop，也不会生成 Photoshop 执行动作。',
            '没有视觉分析器输出时，不能声明 OCR、主体框、主色、构图或审美质量已经完成。',
            'Eagle 标签和备注只能作为检索线索，不能替代真实视觉测量。'
        ],
        boundaries: buildEagleVisualCaseIndexBoundary()
    };

    if (!isEagleVisualCaseIndexPayloadSafe(index)) {
        return stripUnsafePayload(index);
    }

    return index;
}

export function buildEagleVisualCaseIndexBoundary(): EagleVisualCaseIndexBoundary {
    return {
        readonly: true,
        doesNotWriteEagle: true,
        doesNotRunPhotoshop: true,
        doesNotReturnRawImages: true,
        doesNotInferUnobservedVisualFacts: true
    };
}

export function isEagleVisualCaseIndexPayloadSafe(value: unknown): boolean {
    const text = JSON.stringify(value || '');
    return !RAW_IMAGE_KEYS.some((key) => text.includes(key));
}

function buildVisualCase(
    result: DesignKnowledgeResult,
    options: EagleVisualCaseIndexOptions
): EagleVisualCaseIndexItem {
    const itemId = extractSourceNoteValue(result.sourceNotes, 'Eagle item id') || stripEaglePrefix(result.id);
    const dimensions = parseDimensions(extractSourceNoteValue(result.sourceNotes, 'Image dimensions'));
    const extension = extractSourceNoteValue(result.sourceNotes, 'Extension') || extensionFromName(result.title);
    const folders = splitSourceNoteList(extractSourceNoteValue(result.sourceNotes, 'Folders'));
    const filePath = extractSourceNoteValue(result.sourceNotes, 'Local file reference');
    const thumbnailPath = extractSourceNoteValue(result.sourceNotes, 'Thumbnail reference');
    const tags = uniqueStrings(result.tags.filter((tag) => !['eagle', 'readonly', 'local-case', extension].includes(tag)));
    return {
        caseId: `eagle-case:${itemId || result.id}`,
        purpose: options.purpose || 'design_reference',
        visualReadiness: 'needs_visual_analysis',
        source: {
            provider: 'eagle',
            itemId: itemId || result.id,
            sourceUrl: result.sourceUrl,
            filePath,
            thumbnailPath,
            knowledgeResultId: result.id
        },
        asset: {
            name: result.title,
            extension: extension || undefined,
            width: dimensions?.width,
            height: dimensions?.height,
            tags,
            folders,
            annotation: extractAnnotation(result.summary),
            updatedAt: result.updatedAt
        },
        analysis: buildUnknownAnalysis(),
        allowedUses: normalizeAllowedUses(result.allowedUses),
        sourceNotes: result.sourceNotes.map(normalizeText).filter(Boolean),
        warnings: buildCaseWarnings(result, dimensions),
        limitations: [
            '当前案例来自 Eagle 元数据和备注，尚未经过视觉分析。',
            '视觉分析完成前，不能把标签当成主体框、主色、构图或排版评分。',
            '该案例只能作为设计参考或 prompt context，不能直接触发 Photoshop 写操作。'
        ]
    };
}

function buildUnknownAnalysis(): EagleVisualCaseAnalysisPlaceholder {
    return {
        ocrStatus: 'unknown',
        compositionStatus: 'unknown',
        subjectRegions: [],
        dominantColors: [],
        modules: []
    };
}

function buildCaseWarnings(result: DesignKnowledgeResult, dimensions?: { width: number; height: number }): string[] {
    const warnings: string[] = [];
    if (!dimensions) warnings.push('缺少图片宽高元数据，后续置入和参考比例需要视觉或文件探针补证。');
    if (!extractSourceNoteValue(result.sourceNotes, 'Local file reference')) {
        warnings.push('缺少 Eagle 本地文件引用，后续无法直接定位素材文件。');
    }
    if (result.allowedUses.some((value) => String(value) === DIRECT_PHOTOSHOP_ACTION)) {
        warnings.push('已移除 direct_photoshop_action：Eagle visual case 不能直接成为执行动作。');
    }
    return warnings;
}

function normalizeAllowedUses(values: DesignKnowledgeAllowedUse[]): DesignKnowledgeAllowedUse[] {
    const allowed = uniqueStrings(values.filter((value) => String(value) !== DIRECT_PHOTOSHOP_ACTION)) as DesignKnowledgeAllowedUse[];
    return allowed.length ? allowed : ['prompt_context', 'user_reference'];
}

function extractSourceNoteValue(sourceNotes: string[], label: string): string {
    const prefix = `${label}:`;
    const line = sourceNotes.find((item) => normalizeText(item).startsWith(prefix));
    if (!line) return '';
    return normalizeText(line.slice(prefix.length));
}

function splitSourceNoteList(value: string): string[] {
    return uniqueStrings(value.split(',').map((item) => item.trim()).filter(Boolean));
}

function parseDimensions(value: string): { width: number; height: number } | undefined {
    const match = normalizeText(value).match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
    return { width, height };
}

function stripEaglePrefix(value: string): string {
    return normalizeText(value).replace(/^eagle:/, '');
}

function extensionFromName(name: string): string {
    const match = normalizeText(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
}

function extractAnnotation(summary: string): string {
    const [firstPart] = normalizeText(summary).split('|').map((item) => item.trim());
    if (/^tags:/i.test(firstPart) || /^size:/i.test(firstPart) || /^format:/i.test(firstPart)) return '';
    return firstPart || '';
}

function stripUnsafePayload(index: EagleVisualCaseIndex): EagleVisualCaseIndex {
    return {
        ...index,
        cases: index.cases.map((item) => ({
            ...item,
            asset: {
                ...item.asset,
                annotation: sanitizeText(item.asset.annotation)
            },
            sourceNotes: item.sourceNotes.map(sanitizeText),
            warnings: [
                ...item.warnings,
                '已移除 Eagle visual case 中的 raw/base64 图像字段。'
            ]
        })),
        warnings: [
            ...index.warnings,
            'Eagle visual case index 已拦截 raw/base64 图像字段。'
        ]
    };
}

function sanitizeText(value: string): string {
    let text = normalizeText(value);
    for (const key of RAW_IMAGE_KEYS) {
        text = text.split(key).join('[redacted-image-payload]');
    }
    return text;
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}
