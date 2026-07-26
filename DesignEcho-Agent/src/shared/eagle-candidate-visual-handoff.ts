import type {
    EagleAssetCandidateCard,
    EagleAssetCandidatesPanelStatus,
    EagleAssetCandidatesPanelViewModel
} from './eagle-asset-candidates-panel';

export type EagleCandidateVisualHandoffVersion = 'eagle-candidate-visual-handoff/v0';
export type EagleCandidateVisualHandoffStatus =
    | 'needs_selection'
    | 'blocked_panel_not_ready'
    | 'blocked_candidate_not_found'
    | 'ready_for_visual_analysis_request';

export type EagleCandidateVisualObservationRequest =
    | 'ocr'
    | 'subject_regions'
    | 'dominant_colors'
    | 'composition'
    | 'module_layout'
    | 'actual_bounds';

export type EagleCandidateVisualCheck =
    | 'screenshot_review'
    | 'human_review';

export interface BuildEagleCandidateVisualHandoffInput {
    panel?: Partial<EagleAssetCandidatesPanelViewModel> | null;
    selectedCandidateId?: unknown;
    requestedBy?: unknown;
    generatedAt?: unknown;
}

export interface EagleCandidateVisualHandoffCandidateSnapshot {
    candidateId: string;
    title: string;
    sourceLabel: string;
    sourceUrl?: string;
    dimensionsLabel: string;
    readiness: EagleAssetCandidateCard['readiness'];
    readinessLabel: string;
    annotationPreview: string;
    tagPreview: string[];
    folderPreview: string[];
    allowedUseLabels: string[];
    sourceNotePreview: string[];
    warningCount: number;
    limitationCount: number;
    updatedAt?: string;
}

export interface EagleCandidateVisualAnalysisRequest {
    shouldRequestVisualAnalysis: boolean;
    reason: string;
    requestedObservations: EagleCandidateVisualObservationRequest[];
    requiredChecks: EagleCandidateVisualCheck[];
    metadataHints: string[];
}

export interface EagleCandidateDesignDecisionHandoff {
    canProvideMetadataHints: boolean;
    canClaimDesignDecisionReady: false;
    allowedUseLabels: string[];
    requiredReview: string[];
    boundary: string;
}

export interface EagleCandidateVisualHandoff {
    version: EagleCandidateVisualHandoffVersion;
    status: EagleCandidateVisualHandoffStatus;
    statusLabel: string;
    generatedAt: string;
    requestedBy: string;
    selectedCandidateId: string;
    selectedCandidate: EagleCandidateVisualHandoffCandidateSnapshot | null;
    visualAnalysisRequest: EagleCandidateVisualAnalysisRequest;
    designDecisionHandoff: EagleCandidateDesignDecisionHandoff;
    requiredReview: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundary: string;
    canRunEagle: false;
    canRunAgentRuntime: false;
    canRunPhotoshop: false;
    canClaimVisualAnalysisComplete: false;
    canClaimDesignQuality: false;
}

const STATUS_LABELS: Record<EagleCandidateVisualHandoffStatus, string> = {
    needs_selection: '等待选择候选',
    blocked_panel_not_ready: '候选面板未就绪',
    blocked_candidate_not_found: '候选不存在',
    ready_for_visual_analysis_request: '可交给视觉分析'
};

const BLOCKED_PANEL_STATUSES = new Set<EagleAssetCandidatesPanelStatus>([
    'waiting_for_sources',
    'disabled',
    'unavailable',
    'empty'
]);

const DEFAULT_REQUESTED_OBSERVATIONS: EagleCandidateVisualObservationRequest[] = [
    'ocr',
    'subject_regions',
    'dominant_colors',
    'composition',
    'module_layout',
    'actual_bounds'
];

const DEFAULT_REQUIRED_CHECKS: EagleCandidateVisualCheck[] = [
    'screenshot_review',
    'human_review'
];

const DEFAULT_REQUIRED_REVIEW = [
    'visual_analysis_required',
    'actual_bounds_readback_required',
    'screenshot_qa_required',
    'human_review_required'
];

export function buildEagleCandidateVisualHandoff(
    input: BuildEagleCandidateVisualHandoffInput = {}
): EagleCandidateVisualHandoff {
    const selectedCandidateId = sanitizeText(input.selectedCandidateId);
    const generatedAt = sanitizeIsoTime(input.generatedAt);
    const requestedBy = sanitizeText(input.requestedBy) || 'unknown';
    const candidates = Array.isArray(input.panel?.candidates)
        ? input.panel!.candidates as EagleAssetCandidateCard[]
        : [];
    const panelStatus = normalizePanelStatus(input.panel?.status);

    if (!selectedCandidateId) {
        return buildBlockedHandoff({
            status: 'needs_selection',
            generatedAt,
            requestedBy,
            selectedCandidateId: '',
            blockers: ['selected_candidate_required'],
            warnings: normalizeTextList(input.panel?.warnings),
            limitations: normalizeTextList(input.panel?.limitations)
        });
    }

    if (BLOCKED_PANEL_STATUSES.has(panelStatus) || candidates.length === 0) {
        return buildBlockedHandoff({
            status: 'blocked_panel_not_ready',
            generatedAt,
            requestedBy,
            selectedCandidateId,
            blockers: [`panel_status_${panelStatus}`],
            warnings: normalizeTextList(input.panel?.warnings),
            limitations: normalizeTextList(input.panel?.limitations)
        });
    }

    const selectedCandidate = candidates.find((candidate) =>
        sanitizeText(candidate?.candidateId) === selectedCandidateId
    );
    if (!selectedCandidate) {
        return buildBlockedHandoff({
            status: 'blocked_candidate_not_found',
            generatedAt,
            requestedBy,
            selectedCandidateId,
            blockers: ['selected_candidate_not_found'],
            warnings: normalizeTextList(input.panel?.warnings),
            limitations: normalizeTextList(input.panel?.limitations)
        });
    }

    const candidateSnapshot = buildCandidateSnapshot(selectedCandidate);
    const requiredReview = uniqueStrings([
        ...DEFAULT_REQUIRED_REVIEW,
        ...(candidateSnapshot.warningCount > 0 ? ['candidate_warning_review_required'] : [])
    ]);

    return {
        ...buildBaseHandoff({
            status: 'ready_for_visual_analysis_request',
            generatedAt,
            requestedBy,
            selectedCandidateId
        }),
        selectedCandidate: candidateSnapshot,
        visualAnalysisRequest: {
            shouldRequestVisualAnalysis: true,
            reason: '已显式选择 Eagle 候选，但仍缺少视觉分析、实际边界读回、截图 QA 和人工复核。',
            requestedObservations: [...DEFAULT_REQUESTED_OBSERVATIONS],
            requiredChecks: [...DEFAULT_REQUIRED_CHECKS],
            metadataHints: buildMetadataHints(candidateSnapshot)
        },
        designDecisionHandoff: {
            canProvideMetadataHints: true,
            canClaimDesignDecisionReady: false,
            allowedUseLabels: candidateSnapshot.allowedUseLabels,
            requiredReview,
            boundary: '该交接只允许下游把 Eagle 标签、文件夹、备注和尺寸作为元数据提示；不能把它们当作已观察到的视觉事实或设计质量结论。'
        },
        requiredReview,
        blockers: [],
        warnings: uniqueStrings([
            ...normalizeTextList(input.panel?.warnings),
            ...(candidateSnapshot.warningCount > 0 ? ['selected_candidate_has_warnings'] : [])
        ]).slice(0, 8),
        limitations: uniqueStrings([
            ...normalizeTextList(input.panel?.limitations),
            'Eagle 候选选择只生成视觉分析交接上下文，不生成 Photoshop 动作。',
            '视觉分析、actualBounds 读回、截图 QA 和人工复核完成前，不能声明设计决策或交付质量已就绪。'
        ]).slice(0, 8)
    };
}

function buildBlockedHandoff(input: {
    status: Exclude<EagleCandidateVisualHandoffStatus, 'ready_for_visual_analysis_request'>;
    generatedAt: string;
    requestedBy: string;
    selectedCandidateId: string;
    blockers: string[];
    warnings?: string[];
    limitations?: string[];
}): EagleCandidateVisualHandoff {
    return {
        ...buildBaseHandoff(input),
        selectedCandidate: null,
        visualAnalysisRequest: {
            shouldRequestVisualAnalysis: false,
            reason: input.status === 'needs_selection'
                ? '需要用户先显式选择一个 Eagle 候选。'
                : '当前候选信息不足，不能发起视觉分析交接。',
            requestedObservations: [],
            requiredChecks: [],
            metadataHints: []
        },
        designDecisionHandoff: {
            canProvideMetadataHints: false,
            canClaimDesignDecisionReady: false,
            allowedUseLabels: [],
            requiredReview: [],
            boundary: '没有有效候选时，下游不能把 Eagle 候选当作已观察的设计事实。'
        },
        requiredReview: [],
        blockers: uniqueStrings(input.blockers).slice(0, 8),
        warnings: uniqueStrings(input.warnings || []).slice(0, 8),
        limitations: uniqueStrings(input.limitations || []).slice(0, 8)
    };
}

function buildBaseHandoff(input: {
    status: EagleCandidateVisualHandoffStatus;
    generatedAt: string;
    requestedBy: string;
    selectedCandidateId: string;
}): Omit<EagleCandidateVisualHandoff, 'selectedCandidate' | 'visualAnalysisRequest' | 'designDecisionHandoff' | 'requiredReview' | 'blockers' | 'warnings' | 'limitations'> {
    return {
        version: 'eagle-candidate-visual-handoff/v0',
        status: input.status,
        statusLabel: STATUS_LABELS[input.status],
        generatedAt: input.generatedAt,
        requestedBy: input.requestedBy,
        selectedCandidateId: input.selectedCandidateId,
        boundary: 'Eagle 候选交接只消费 UI 安全候选卡片；不会搜索 Eagle、写 Eagle、运行 Agent runtime、运行 Photoshop 或声明设计质量。',
        canRunEagle: false,
        canRunAgentRuntime: false,
        canRunPhotoshop: false,
        canClaimVisualAnalysisComplete: false,
        canClaimDesignQuality: false
    };
}

function buildCandidateSnapshot(candidate: EagleAssetCandidateCard): EagleCandidateVisualHandoffCandidateSnapshot {
    const sourceUrl = sanitizeSourceUrl(candidate.sourceUrl);
    return {
        candidateId: sanitizeText(candidate.candidateId),
        title: sanitizeText(candidate.title) || 'Eagle candidate',
        sourceLabel: sanitizeText(candidate.sourceLabel) || 'Eagle item',
        ...(sourceUrl ? { sourceUrl } : {}),
        dimensionsLabel: sanitizeText(candidate.dimensionsLabel) || '未知尺寸',
        readiness: normalizeReadiness(candidate.readiness),
        readinessLabel: sanitizeText(candidate.readinessLabel) || '待视觉分析',
        annotationPreview: sanitizeText(candidate.annotationPreview),
        tagPreview: normalizeTextList(candidate.tagPreview).slice(0, 6),
        folderPreview: normalizeTextList(candidate.folderPreview).slice(0, 4),
        allowedUseLabels: normalizeTextList(candidate.allowedUseLabels).slice(0, 6),
        sourceNotePreview: normalizeTextList(candidate.sourceNotePreview).slice(0, 4),
        warningCount: clampCount(candidate.warningCount),
        limitationCount: clampCount(candidate.limitationCount),
        ...(sanitizeText(candidate.updatedAt) ? { updatedAt: sanitizeText(candidate.updatedAt) } : {})
    };
}

function buildMetadataHints(candidate: EagleCandidateVisualHandoffCandidateSnapshot): string[] {
    return uniqueStrings([
        `title: ${candidate.title}`,
        `dimensions: ${candidate.dimensionsLabel}`,
        ...candidate.tagPreview.map((tag) => `tag: ${tag}`),
        ...candidate.folderPreview.map((folder) => `folder: ${folder}`),
        ...(candidate.annotationPreview ? [`annotation: ${candidate.annotationPreview}`] : []),
        ...candidate.sourceNotePreview.map((item) => `source: ${item}`)
    ]).slice(0, 12);
}

function normalizeReadiness(value: unknown): EagleAssetCandidateCard['readiness'] {
    return value === 'needs_visual_analysis' || value === 'metadata_only'
        ? value
        : 'unknown';
}

function normalizePanelStatus(value: unknown): EagleAssetCandidatesPanelStatus {
    const text = sanitizeText(value);
    if (
        text === 'waiting_for_sources' ||
        text === 'disabled' ||
        text === 'unavailable' ||
        text === 'empty' ||
        text === 'ready'
    ) {
        return text;
    }
    return 'waiting_for_sources';
}

function sanitizeSourceUrl(value: unknown): string | undefined {
    const text = sanitizeText(value);
    if (!text || text.includes('[已移除本地路径]')) return undefined;
    return text;
}

function clampCount(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(999, Math.round(parsed));
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
