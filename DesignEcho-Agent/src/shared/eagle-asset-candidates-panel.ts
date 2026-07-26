import type { DesignKnowledgeAllowedUse, DesignKnowledgeResult } from './design-knowledge-search';
import type { EagleReadonlyKnowledgeResponse } from './eagle-readonly-knowledge';
import type {
    EagleVisualCaseIndex,
    EagleVisualCaseIndexItem,
    EagleVisualReadiness
} from './eagle-visual-case-index';

export type EagleAssetCandidatesPanelVersion = 'eagle-asset-candidates-panel/v0';
export type EagleAssetCandidatesPanelStatus =
    | 'waiting_for_sources'
    | 'disabled'
    | 'unavailable'
    | 'empty'
    | 'ready';

export interface BuildEagleAssetCandidatesPanelInput {
    query?: unknown;
    readonlyKnowledge?: Partial<EagleReadonlyKnowledgeResponse> | null;
    visualCaseIndex?: Partial<EagleVisualCaseIndex> | null;
    generatedAt?: unknown;
}

export interface EagleAssetCandidateCard {
    candidateId: string;
    title: string;
    sourceLabel: string;
    sourceUrl?: string;
    dimensionsLabel: string;
    readiness: EagleVisualReadiness | 'unknown';
    readinessLabel: string;
    annotationPreview: string;
    tagPreview: string[];
    folderPreview: string[];
    allowedUseLabels: string[];
    sourceNotePreview: string[];
    warningCount: number;
    limitationCount: number;
    updatedAt?: string;
    sourceRank?: number;
}

export interface EagleAssetCandidatesPanelTotals {
    candidateCount: number;
    tagCount: number;
    folderCount: number;
    needsVisualAnalysisCount: number;
    metadataOnlyCount: number;
    warningCount: number;
}

export interface EagleAssetCandidatesPanelViewModel {
    version: EagleAssetCandidatesPanelVersion;
    query: string;
    generatedAt: string;
    status: EagleAssetCandidatesPanelStatus;
    statusLabel: string;
    summary: string;
    totals: EagleAssetCandidatesPanelTotals;
    candidates: EagleAssetCandidateCard[];
    warnings: string[];
    limitations: string[];
    boundary: string;
    canSearchEagleAutomatically: false;
    canRunEagle: false;
    canRunAgentRuntime: false;
    canRunPhotoshop: false;
    canClaimDesignQuality: false;
}

const STATUS_LABELS: Record<EagleAssetCandidatesPanelStatus, string> = {
    waiting_for_sources: '等待来源',
    disabled: '未启用',
    unavailable: '不可用',
    empty: '无候选',
    ready: '候选就绪'
};

const READINESS_LABELS: Record<EagleAssetCandidateCard['readiness'], string> = {
    needs_visual_analysis: '待视觉分析',
    metadata_only: '仅元数据',
    unknown: '未知'
};

const ALLOWED_USE_LABELS: Record<DesignKnowledgeAllowedUse, string> = {
    prompt_context: '提示上下文',
    user_reference: '用户参考',
    recipe_hint: '设计 recipe',
    benchmark_seed: 'Benchmark 种子'
};

export function buildEagleAssetCandidatesPanel(
    input: BuildEagleAssetCandidatesPanelInput = {}
): EagleAssetCandidatesPanelViewModel {
    const query = sanitizeText(input.query) || 'Eagle readonly asset candidates';
    const generatedAt = sanitizeIsoTime(input.generatedAt);
    const candidates = buildCandidateCards(input);
    const status = derivePanelStatus(input, candidates);
    const warnings = uniqueStrings([
        ...normalizeTextList(input.readonlyKnowledge?.warnings),
        ...normalizeTextList(input.visualCaseIndex?.warnings)
    ]).slice(0, 8);
    const limitations = uniqueStrings([
        ...normalizeTextList(input.visualCaseIndex?.limitations),
        'Eagle 素材候选入口只展示已经进入 DesignEcho 的只读候选来源。',
        '缺少视觉分析、actualBounds、截图 QA 或人工复核时，不能把候选排序当成设计质量结论。',
        '该入口不会自动搜索 Eagle、不会写 Eagle、不会运行 Agent runtime 或 Photoshop。'
    ]).slice(0, 8);

    return {
        version: 'eagle-asset-candidates-panel/v0',
        query,
        generatedAt,
        status,
        statusLabel: STATUS_LABELS[status],
        summary: buildSummary(status, candidates.length),
        totals: buildTotals(candidates),
        candidates,
        warnings,
        limitations,
        boundary: 'Eagle 素材候选入口只汇总已归一化的 Eagle 只读知识和视觉案例索引；它不主动搜索、不写 Eagle、不触发 Photoshop，也不声明设计质量。',
        canSearchEagleAutomatically: false,
        canRunEagle: false,
        canRunAgentRuntime: false,
        canRunPhotoshop: false,
        canClaimDesignQuality: false
    };
}

function buildCandidateCards(input: BuildEagleAssetCandidatesPanelInput): EagleAssetCandidateCard[] {
    const cases = Array.isArray(input.visualCaseIndex?.cases) ? input.visualCaseIndex!.cases : [];
    if (cases.length > 0) {
        return cases.map((item) => candidateFromVisualCase(item)).filter(Boolean) as EagleAssetCandidateCard[];
    }

    const results = Array.isArray(input.readonlyKnowledge?.results) ? input.readonlyKnowledge!.results : [];
    return results
        .filter((item) => item?.sourceType === 'eagle_library')
        .map((item) => candidateFromKnowledgeResult(item))
        .filter(Boolean) as EagleAssetCandidateCard[];
}

function candidateFromVisualCase(item: EagleVisualCaseIndexItem): EagleAssetCandidateCard {
    const title = sanitizeText(item.asset?.name) || sanitizeText(item.caseId) || 'Eagle candidate';
    const dimensionsLabel = formatDimensions(item.asset?.width, item.asset?.height);
    const allowedUseLabels = mapAllowedUseLabels(item.allowedUses);
    const sourceUrl = sanitizeSourceUrl(item.source?.sourceUrl);
    return {
        candidateId: sanitizeText(item.caseId) || `eagle-case:${title}`,
        title,
        sourceLabel: sanitizeText(item.source?.itemId) || 'Eagle item',
        ...(sourceUrl ? { sourceUrl } : {}),
        dimensionsLabel,
        readiness: normalizeReadiness(item.visualReadiness),
        readinessLabel: READINESS_LABELS[normalizeReadiness(item.visualReadiness)],
        annotationPreview: sanitizeText(item.asset?.annotation),
        tagPreview: normalizeTextList(item.asset?.tags).slice(0, 6),
        folderPreview: normalizeTextList(item.asset?.folders).slice(0, 4),
        allowedUseLabels,
        sourceNotePreview: normalizeTextList(item.sourceNotes).slice(0, 4),
        warningCount: normalizeTextList(item.warnings).length,
        limitationCount: normalizeTextList(item.limitations).length,
        ...(sanitizeText(item.asset?.updatedAt) ? { updatedAt: sanitizeText(item.asset.updatedAt) } : {})
    };
}

function candidateFromKnowledgeResult(item: DesignKnowledgeResult): EagleAssetCandidateCard {
    const title = sanitizeText(item.title) || sanitizeText(item.id) || 'Eagle candidate';
    const dimensions = parseDimensionsFromSourceNotes(item.sourceNotes);
    const sourceUrl = sanitizeSourceUrl(item.sourceUrl);
    return {
        candidateId: sanitizeText(item.id) || `eagle:${title}`,
        title,
        sourceLabel: extractSourceNoteValue(item.sourceNotes, 'Eagle item id') || 'Eagle item',
        ...(sourceUrl ? { sourceUrl } : {}),
        dimensionsLabel: formatDimensions(dimensions?.width, dimensions?.height),
        readiness: 'needs_visual_analysis',
        readinessLabel: READINESS_LABELS.needs_visual_analysis,
        annotationPreview: sanitizeText(item.summary),
        tagPreview: normalizeTextList(item.tags).filter((tag) => tag !== 'eagle_library').slice(0, 6),
        folderPreview: splitSourceNoteList(extractSourceNoteValue(item.sourceNotes, 'Folders')).slice(0, 4),
        allowedUseLabels: mapAllowedUseLabels(item.allowedUses),
        sourceNotePreview: normalizeTextList(item.sourceNotes).slice(0, 4),
        warningCount: 0,
        limitationCount: 1,
        ...(sanitizeText(item.updatedAt) ? { updatedAt: sanitizeText(item.updatedAt) } : {}),
        sourceRank: clampSourceRank(item.sourceRank)
    };
}

function derivePanelStatus(
    input: BuildEagleAssetCandidatesPanelInput,
    candidates: EagleAssetCandidateCard[]
): EagleAssetCandidatesPanelStatus {
    const readonlyStatus = sanitizeText(input.readonlyKnowledge?.status);
    if (readonlyStatus === 'disabled') return 'disabled';
    if (readonlyStatus === 'unavailable') return 'unavailable';
    if (!input.readonlyKnowledge && !input.visualCaseIndex) return 'waiting_for_sources';
    if (candidates.length === 0) return 'empty';
    return 'ready';
}

function buildTotals(candidates: EagleAssetCandidateCard[]): EagleAssetCandidatesPanelTotals {
    return {
        candidateCount: candidates.length,
        tagCount: uniqueStrings(candidates.flatMap((item) => item.tagPreview)).length,
        folderCount: uniqueStrings(candidates.flatMap((item) => item.folderPreview)).length,
        needsVisualAnalysisCount: candidates.filter((item) => item.readiness === 'needs_visual_analysis').length,
        metadataOnlyCount: candidates.filter((item) => item.readiness === 'metadata_only').length,
        warningCount: candidates.reduce((sum, item) => sum + item.warningCount, 0)
    };
}

function buildSummary(status: EagleAssetCandidatesPanelStatus, candidateCount: number): string {
    if (status === 'disabled') return 'Eagle 只读知识连接器未启用；当前不会自动连接或搜索 Eagle。';
    if (status === 'unavailable') return 'Eagle 只读知识连接器不可用；当前不伪造素材候选。';
    if (status === 'empty') return 'Eagle 只读知识已返回，但没有可展示的素材候选。';
    if (status === 'ready') return `已有 ${candidateCount} 个 Eagle 只读素材候选，仍需要视觉分析、置入读回和人工复核。`;
    return '等待 Eagle 只读知识或视觉案例索引；当前面板不会主动搜索 Eagle。';
}

function mapAllowedUseLabels(values: DesignKnowledgeAllowedUse[] | undefined): string[] {
    const uses = Array.isArray(values) ? values : [];
    const labels = uses
        .map((value) => ALLOWED_USE_LABELS[value])
        .filter(Boolean);
    return uniqueStrings(labels).length ? uniqueStrings(labels) : ['用户参考'];
}

function normalizeReadiness(value: unknown): EagleAssetCandidateCard['readiness'] {
    return value === 'metadata_only' || value === 'needs_visual_analysis'
        ? value
        : 'unknown';
}

function formatDimensions(width: unknown, height: unknown): string {
    const parsedWidth = Number(width);
    const parsedHeight = Number(height);
    if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight) || parsedWidth <= 0 || parsedHeight <= 0) {
        return '未知尺寸';
    }
    return `${Math.round(parsedWidth)}x${Math.round(parsedHeight)}`;
}

function parseDimensionsFromSourceNotes(sourceNotes: string[] | undefined): { width: number; height: number } | undefined {
    const value = extractSourceNoteValue(sourceNotes, 'Image dimensions');
    const match = value.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
    return { width, height };
}

function extractSourceNoteValue(sourceNotes: string[] | undefined, label: string): string {
    const prefix = `${label}:`;
    const line = normalizeTextList(sourceNotes).find((item) => item.startsWith(prefix));
    if (!line) return '';
    return sanitizeText(line.slice(prefix.length));
}

function splitSourceNoteList(value: string): string[] {
    return uniqueStrings(value.split(',').map((item) => item.trim()).filter(Boolean));
}

function sanitizeSourceUrl(value: unknown): string | undefined {
    const text = sanitizeText(value);
    if (!text || text.includes('[已移除本地路径]')) return undefined;
    return text;
}

function clampSourceRank(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeTextList(value: unknown): string[] {
    const rawValues = Array.isArray(value) ? value : [value];
    return rawValues.map(sanitizeText).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(sanitizeText).filter(Boolean)));
}

function sanitizeIsoTime(value: unknown): string {
    const text = sanitizeText(value);
    if (!text) return new Date().toISOString();
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sanitizeText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;[^\s"'<>]+/gi, '[已移除图片内容]')
        .replace(/\bbase64\b/gi, '[已移除编码内容]')
        .replace(/\brawImage\b/gi, '[已移除图片字段]')
        .replace(/[A-Za-z]:\\[^\s，。；;'"<>]+/g, '[已移除本地路径]')
        .replace(/\s+/g, ' ')
        .trim();
}
