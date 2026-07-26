export type ReferenceVisualQaStatus = 'ok' | 'watch' | 'mismatch' | 'unverified';

export interface ReferenceVisualQaBoxInput {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}

export interface ReferenceVisualQaBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface ReferenceVisualQaItem {
    id: string;
    label?: string;
    kind?: string;
    plannedBox?: ReferenceVisualQaBoxInput | null;
    actualBox?: ReferenceVisualQaBoxInput | null;
}

export interface ReferenceVisualQaThresholds {
    okMinIou: number;
    okMaxCenterOffsetPx: number;
    okMaxEdgeDeltaPx: number;
    okMinAreaRatio: number;
    okMaxAreaRatio: number;
    watchMinIou: number;
    watchMaxCenterOffsetPx: number;
    watchMaxEdgeDeltaPx: number;
    watchMinAreaRatio: number;
    watchMaxAreaRatio: number;
}

export interface ReferenceVisualQaComparison {
    id: string;
    label?: string;
    kind?: string;
    status: ReferenceVisualQaStatus;
    plannedBox?: ReferenceVisualQaBox;
    actualBox?: ReferenceVisualQaBox;
    iou: number | null;
    centerOffsetPx: number | null;
    maxEdgeDeltaPx: number | null;
    areaRatio: number | null;
    notes: string[];
}

export interface ReferenceVisualQaSnapshotObservation {
    source: 'getScreenSnapshotsWithOverlay' | 'getCanvasSnapshot' | 'getDocumentSnapshot' | 'bounds-only' | 'manual';
    snapshotCount?: number;
    overlayCount?: number;
    notes?: string[];
    pixelProbe?: ReferenceVisualQaPixelProbeCheck;
}

export interface ReferenceVisualQaPixelProbeCheck {
    mode: 'pixel-probe';
    status: ReferenceVisualQaStatus;
    width?: number;
    height?: number;
    mae?: number;
    rmse?: number;
    highDeltaRatio?: number;
    darkJaccard?: number;
    softDarkJaccard?: number;
    softMaskBlurSigma?: number;
    softMaskDarkThreshold?: number;
    reason?: string;
    boundary?: string;
    snapshotPath?: string;
    rawImagesRedacted: true;
}

export interface ReferenceReplicationVisualQaReport {
    status: ReferenceVisualQaStatus;
    summary: string;
    score: number | null;
    counts: {
        total: number;
        ok: number;
        watch: number;
        mismatch: number;
        unverified: number;
    };
    comparisons: ReferenceVisualQaComparison[];
    observations: string[];
    limitations: string[];
    snapshotObservation?: ReferenceVisualQaSnapshotObservation;
    verificationReport?: ReferenceReplicationVisualQaVerificationReport;
}

export interface ReferenceReplicationVisualQaVerificationReport {
    kind: 'reference-replication-visual-qa';
    status: ReferenceVisualQaStatus;
    summary: string;
    score: number | null;
    counts: ReferenceReplicationVisualQaReport['counts'];
    snapshot: {
        source: ReferenceVisualQaSnapshotObservation['source'] | 'none';
        snapshotCount: number;
        overlayCount: number;
        hasImageObservation: boolean;
        rawImagesRedacted: true;
        pixelProbe?: {
            status: ReferenceVisualQaStatus;
            hasMetrics: boolean;
            mae?: number;
            rmse?: number;
            highDeltaRatio?: number;
            darkJaccard?: number;
            softDarkJaccard?: number;
            reason?: string;
            boundary?: string;
            rawImagesRedacted: true;
        };
    };
    blockers: string[];
    warnings: string[];
    nextActions: string[];
}

const DEFAULT_THRESHOLDS: ReferenceVisualQaThresholds = {
    okMinIou: 0.88,
    okMaxCenterOffsetPx: 8,
    okMaxEdgeDeltaPx: 8,
    okMinAreaRatio: 0.9,
    okMaxAreaRatio: 1.1,
    watchMinIou: 0.68,
    watchMaxCenterOffsetPx: 28,
    watchMaxEdgeDeltaPx: 28,
    watchMinAreaRatio: 0.72,
    watchMaxAreaRatio: 1.38
};

function toFiniteNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function roundMetric(value: number | null, digits = 3): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function normalizeReferenceVisualQaBox(input?: ReferenceVisualQaBoxInput | null): ReferenceVisualQaBox | null {
    if (!input || typeof input !== 'object') return null;

    const left = toFiniteNumber(input.left ?? input.x);
    const top = toFiniteNumber(input.top ?? input.y);
    const width = toFiniteNumber(input.width);
    const height = toFiniteNumber(input.height);
    const right = toFiniteNumber(input.right);
    const bottom = toFiniteNumber(input.bottom);

    if (left === null || top === null) return null;

    const resolvedRight = right !== null
        ? right
        : width !== null
            ? left + width
            : null;
    const resolvedBottom = bottom !== null
        ? bottom
        : height !== null
            ? top + height
            : null;

    if (resolvedRight === null || resolvedBottom === null) return null;

    const normalizedLeft = Math.min(left, resolvedRight);
    const normalizedTop = Math.min(top, resolvedBottom);
    const normalizedRight = Math.max(left, resolvedRight);
    const normalizedBottom = Math.max(top, resolvedBottom);
    const normalizedWidth = normalizedRight - normalizedLeft;
    const normalizedHeight = normalizedBottom - normalizedTop;

    if (normalizedWidth <= 0 || normalizedHeight <= 0) return null;

    return {
        left: Math.round(normalizedLeft),
        top: Math.round(normalizedTop),
        right: Math.round(normalizedRight),
        bottom: Math.round(normalizedBottom),
        width: Math.round(normalizedWidth),
        height: Math.round(normalizedHeight)
    };
}

function area(box: ReferenceVisualQaBox): number {
    return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionArea(a: ReferenceVisualQaBox, b: ReferenceVisualQaBox): number {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function calculateIou(a: ReferenceVisualQaBox, b: ReferenceVisualQaBox): number {
    const intersection = intersectionArea(a, b);
    const union = area(a) + area(b) - intersection;
    if (union <= 0) return 0;
    return intersection / union;
}

function calculateCenterOffset(a: ReferenceVisualQaBox, b: ReferenceVisualQaBox): number {
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    return Math.sqrt(Math.pow(ax - bx, 2) + Math.pow(ay - by, 2));
}

function calculateMaxEdgeDelta(a: ReferenceVisualQaBox, b: ReferenceVisualQaBox): number {
    return Math.max(
        Math.abs(a.left - b.left),
        Math.abs(a.top - b.top),
        Math.abs(a.right - b.right),
        Math.abs(a.bottom - b.bottom)
    );
}

function classifyComparison(metrics: {
    iou: number;
    centerOffsetPx: number;
    maxEdgeDeltaPx: number;
    areaRatio: number;
}, thresholds: ReferenceVisualQaThresholds): ReferenceVisualQaStatus {
    const ok = metrics.iou >= thresholds.okMinIou
        && metrics.centerOffsetPx <= thresholds.okMaxCenterOffsetPx
        && metrics.maxEdgeDeltaPx <= thresholds.okMaxEdgeDeltaPx
        && metrics.areaRatio >= thresholds.okMinAreaRatio
        && metrics.areaRatio <= thresholds.okMaxAreaRatio;
    if (ok) return 'ok';

    const watch = metrics.iou >= thresholds.watchMinIou
        && metrics.centerOffsetPx <= thresholds.watchMaxCenterOffsetPx
        && metrics.maxEdgeDeltaPx <= thresholds.watchMaxEdgeDeltaPx
        && metrics.areaRatio >= thresholds.watchMinAreaRatio
        && metrics.areaRatio <= thresholds.watchMaxAreaRatio;
    return watch ? 'watch' : 'mismatch';
}

function isTextKind(kind?: string): boolean {
    return String(kind || '').toLowerCase() === 'text';
}

function isContainedTextEnvelope(input: {
    plannedBox: ReferenceVisualQaBox;
    actualBox: ReferenceVisualQaBox;
    metrics: {
        centerOffsetPx: number;
        areaRatio: number;
    };
}): boolean {
    const { plannedBox, actualBox, metrics } = input;
    const leftTolerance = Math.max(4, plannedBox.width * 0.025);
    const topTolerance = Math.max(4, plannedBox.height * 0.18);
    const rightTolerance = Math.max(6, plannedBox.width * 0.04);
    const bottomTolerance = Math.max(6, plannedBox.height * 0.3);
    const maxCenterOffset = Math.max(12, plannedBox.width * 0.12);
    const minAreaRatio = 0.55;

    return actualBox.left >= plannedBox.left - leftTolerance
        && actualBox.top >= plannedBox.top - topTolerance
        && actualBox.right <= plannedBox.right + rightTolerance
        && actualBox.bottom <= plannedBox.bottom + bottomTolerance
        && metrics.centerOffsetPx <= maxCenterOffset
        && metrics.areaRatio >= minAreaRatio;
}

export function compareReferenceVisualQaItem(
    item: ReferenceVisualQaItem,
    thresholds: ReferenceVisualQaThresholds = DEFAULT_THRESHOLDS
): ReferenceVisualQaComparison {
    const plannedBox = normalizeReferenceVisualQaBox(item.plannedBox);
    const actualBox = normalizeReferenceVisualQaBox(item.actualBox);
    const notes: string[] = [];

    if (!plannedBox) {
        notes.push('missing or invalid plannedBox');
    }
    if (!actualBox) {
        notes.push('missing or invalid actualBox');
    }
    if (!plannedBox || !actualBox) {
        return {
            id: item.id,
            label: item.label,
            kind: item.kind,
            status: 'unverified',
            plannedBox: plannedBox || undefined,
            actualBox: actualBox || undefined,
            iou: null,
            centerOffsetPx: null,
            maxEdgeDeltaPx: null,
            areaRatio: null,
            notes
        };
    }

    const iou = calculateIou(plannedBox, actualBox);
    const centerOffsetPx = calculateCenterOffset(plannedBox, actualBox);
    const maxEdgeDeltaPx = calculateMaxEdgeDelta(plannedBox, actualBox);
    const areaRatio = area(actualBox) / Math.max(1, area(plannedBox));
    let status = classifyComparison({ iou, centerOffsetPx, maxEdgeDeltaPx, areaRatio }, thresholds);

    if (status !== 'ok') {
        notes.push(
            `iou=${roundMetric(iou)}, centerOffset=${roundMetric(centerOffsetPx, 1)}px, edgeDelta=${roundMetric(maxEdgeDeltaPx, 1)}px, areaRatio=${roundMetric(areaRatio, 2)}`
        );
    }
    if (
        status === 'mismatch'
        && isTextKind(item.kind)
        && isContainedTextEnvelope({
            plannedBox,
            actualBox,
            metrics: { centerOffsetPx, areaRatio }
        })
    ) {
        status = 'watch';
        notes.push('text actual bounds fit inside planned text envelope; review font metrics/tracking before treating as placement failure');
    }

    return {
        id: item.id,
        label: item.label,
        kind: item.kind,
        status,
        plannedBox,
        actualBox,
        iou: roundMetric(iou),
        centerOffsetPx: roundMetric(centerOffsetPx, 1),
        maxEdgeDeltaPx: roundMetric(maxEdgeDeltaPx, 1),
        areaRatio: roundMetric(areaRatio, 3),
        notes
    };
}

function resolveOverallStatus(counts: ReferenceReplicationVisualQaReport['counts']): ReferenceVisualQaStatus {
    if (counts.total === 0) return 'unverified';
    if (counts.mismatch > 0) return 'mismatch';
    if (counts.watch > 0) return 'watch';
    if (counts.unverified === counts.total) return 'unverified';
    if (counts.unverified > 0) return 'watch';
    return 'ok';
}

function calculateScore(comparisons: ReferenceVisualQaComparison[]): number | null {
    if (comparisons.length === 0) return null;
    const score = comparisons.reduce((sum, item) => {
        if (item.status === 'ok') return sum + 1;
        if (item.status === 'watch') return sum + 0.65;
        if (item.status === 'mismatch') return sum + 0.15;
        return sum + 0.35;
    }, 0) / comparisons.length;
    return Math.round(clamp01(score) * 100) / 100;
}

function formatPixelProbeCheck(pixelProbe?: ReferenceVisualQaPixelProbeCheck): string {
    if (!pixelProbe) return '';
    const metrics = [
        typeof pixelProbe.mae === 'number' ? `MAE ${pixelProbe.mae}` : '',
        typeof pixelProbe.rmse === 'number' ? `RMSE ${pixelProbe.rmse}` : '',
        typeof pixelProbe.highDeltaRatio === 'number' ? `高差异 ${pixelProbe.highDeltaRatio}` : '',
        typeof pixelProbe.darkJaccard === 'number' ? `暗部 Jaccard ${pixelProbe.darkJaccard}` : '',
        typeof pixelProbe.softDarkJaccard === 'number' ? `软暗部 Jaccard ${pixelProbe.softDarkJaccard}` : ''
    ].filter(Boolean).join('，');
    const reason = pixelProbe.reason ? `，原因: ${pixelProbe.reason}` : '';
    return `截图像素探针: ${pixelProbe.status}${metrics ? `（${metrics}）` : ''}${reason}`;
}

function formatBoxSize(box?: ReferenceVisualQaBox): string {
    if (!box) return 'n/a';
    return `${box.width}x${box.height}@${box.left},${box.top}`;
}

function formatComparisonDiagnostic(item: ReferenceVisualQaComparison): string {
    const label = item.label || item.id;
    const metrics = [
        typeof item.iou === 'number' ? `iou=${item.iou}` : '',
        typeof item.centerOffsetPx === 'number' ? `offset=${item.centerOffsetPx}px` : '',
        typeof item.maxEdgeDeltaPx === 'number' ? `edge=${item.maxEdgeDeltaPx}px` : '',
        typeof item.areaRatio === 'number' ? `area=${item.areaRatio}` : ''
    ].filter(Boolean).join(', ');
    return `${label}（target ${formatBoxSize(item.plannedBox)} / actual ${formatBoxSize(item.actualBox)}${metrics ? `, ${metrics}` : ''}）`;
}

function summarizeComparisonsByStatus(
    comparisons: ReferenceVisualQaComparison[],
    status: ReferenceVisualQaStatus,
    limit = 3
): string {
    const matched = comparisons.filter((item) => item.status === status);
    if (matched.length === 0) return '';
    const details = matched.slice(0, limit).map(formatComparisonDiagnostic).join('；');
    return details + (matched.length > limit ? `；另有 ${matched.length - limit} 项` : '');
}

export function buildReferenceReplicationVisualQaReport(input: {
    items?: ReferenceVisualQaItem[];
    comparisons?: ReferenceVisualQaComparison[];
    snapshotObservation?: ReferenceVisualQaSnapshotObservation;
    thresholds?: Partial<ReferenceVisualQaThresholds>;
}): ReferenceReplicationVisualQaReport {
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds || {}) };
    const comparisons = Array.isArray(input.comparisons)
        ? input.comparisons
        : (input.items || []).map((item) => compareReferenceVisualQaItem(item, thresholds));

    const counts = {
        total: comparisons.length,
        ok: comparisons.filter((item) => item.status === 'ok').length,
        watch: comparisons.filter((item) => item.status === 'watch').length,
        mismatch: comparisons.filter((item) => item.status === 'mismatch').length,
        unverified: comparisons.filter((item) => item.status === 'unverified').length
    };
    const status = resolveOverallStatus(counts);
    const score = calculateScore(comparisons);
    const observations: string[] = [];
    const limitations: string[] = [
        '当前视觉 QA 只验证图层几何 bounds，不验证像素相似度、裁切质量、图案完整性或审美质量。'
    ];

    if (counts.total > 0) {
        observations.push(`bounds 对比 ${counts.total} 项：通过 ${counts.ok}，观察 ${counts.watch}，不匹配 ${counts.mismatch}，未验证 ${counts.unverified}`);
        const mismatchDetails = summarizeComparisonsByStatus(comparisons, 'mismatch');
        const watchDetails = summarizeComparisonsByStatus(comparisons, 'watch');
        if (mismatchDetails) {
            observations.push(`bounds 不匹配明细: ${mismatchDetails}`);
        }
        if (watchDetails) {
            observations.push(`bounds 观察项明细: ${watchDetails}`);
        }
    }

    if (input.snapshotObservation) {
        const snapshotCount = Number(input.snapshotObservation.snapshotCount || 0);
        const overlayCount = Number(input.snapshotObservation.overlayCount || 0);
        observations.push(`截图观察: ${input.snapshotObservation.source}，截图 ${snapshotCount} 张，overlay ${overlayCount} 项`);
        if (input.snapshotObservation.source === 'bounds-only' || snapshotCount <= 0) {
            limitations.push('当前只有 Photoshop 图层 bounds 检查，没有截图或 overlay 图像观察。');
        }
        if (Array.isArray(input.snapshotObservation.notes)) {
            observations.push(...input.snapshotObservation.notes.slice(0, 4));
        }
        const pixelProbeLine = formatPixelProbeCheck(input.snapshotObservation.pixelProbe);
        if (pixelProbeLine) {
            observations.push(pixelProbeLine);
            if (input.snapshotObservation.pixelProbe?.status !== 'ok') {
                limitations.push('截图像素探针未达到 ok，仅能作为诊断信号；不能据此宣称高保真复刻完成。');
            }
            if (input.snapshotObservation.pixelProbe?.boundary) {
                limitations.push(input.snapshotObservation.pixelProbe.boundary);
            }
        }
    } else {
        limitations.push('当前没有接入截图或 overlay 图像观察，不能形成截图级视觉相似度结论。');
    }

    if (counts.unverified > 0) {
        limitations.push('部分元素缺少 plannedBox 或 actualBox，只能标记为未验证。');
    }
    if (counts.mismatch > 0) {
        limitations.push('存在 bounds 不匹配项，需要回到 Photoshop 文档检查图层位置、缩放或分组。');
    }

    const summary = counts.total === 0
        ? '视觉 QA 未执行：没有可比较的图层 bounds。'
        : `视觉 QA ${status}，score=${score === null ? 'n/a' : score.toFixed(2)}，通过 ${counts.ok}/${counts.total} 项。`;

    const report: ReferenceReplicationVisualQaReport = {
        status,
        summary,
        score,
        counts,
        comparisons,
        observations,
        limitations,
        snapshotObservation: input.snapshotObservation
    };
    return {
        ...report,
        verificationReport: buildReferenceReplicationVisualQaVerificationReport(report)
    };
}

export function buildReferenceReplicationVisualQaVerificationReport(
    report: Omit<ReferenceReplicationVisualQaReport, 'verificationReport'>
): ReferenceReplicationVisualQaVerificationReport {
    const snapshotCount = Number(report.snapshotObservation?.snapshotCount || 0);
    const overlayCount = Number(report.snapshotObservation?.overlayCount || 0);
    const source = report.snapshotObservation?.source || 'none';
    const pixelProbe = report.snapshotObservation?.pixelProbe;
    const hasImageObservation = source !== 'none' && source !== 'bounds-only' && snapshotCount > 0;
    const blockers: string[] = [];
    const warnings: string[] = [];
    const nextActions: string[] = [];

    if (report.counts.mismatch > 0) {
        const mismatchDetails = summarizeComparisonsByStatus(report.comparisons, 'mismatch', 2);
        blockers.push(`存在 ${report.counts.mismatch} 项 bounds 不匹配，不能判定为高保真复刻。${mismatchDetails ? `首批差异: ${mismatchDetails}` : ''}`);
        nextActions.push('回到 Photoshop 检查不匹配图层的尺寸、位置、缩放和分组。');
    }

    if (source === 'getScreenSnapshotsWithOverlay' && snapshotCount <= 0) {
        blockers.push('已请求 overlay 截图，但没有获得任何截图结果。');
        nextActions.push('确认当前 UXP 插件已重新载入最新版本，并复测 overlay 截图工具。');
    } else if (!hasImageObservation) {
        warnings.push('当前没有截图级图像观察，只能进行 bounds 级几何检查。');
        nextActions.push('需要截图级验收时，显式启用 visualValidation=overlay/deep。');
    }

    if (report.counts.watch > 0) {
        const watchDetails = summarizeComparisonsByStatus(report.comparisons, 'watch', 2);
        warnings.push(`存在 ${report.counts.watch} 项观察项，建议人工复核。${watchDetails ? `首批观察: ${watchDetails}` : ''}`);
    }

    if (report.counts.unverified > 0) {
        warnings.push(`存在 ${report.counts.unverified} 项缺少 planned/actual bounds，无法完成几何验收。`);
        nextActions.push('补齐目标框和实际图层 bounds 后重新执行 QA。');
    }

    if (hasImageObservation && overlayCount <= 0) {
        warnings.push('已获得截图，但没有 overlay 标注项；当前画面观察不能说明目标框偏差。');
    }

    if (pixelProbe && pixelProbe.status !== 'ok') {
        warnings.push(`截图像素探针状态为 ${pixelProbe.status}，不能作为高保真复刻结论。`);
        nextActions.push('结合截图探针指标、字体渲染、缩放和图层 bounds 继续校准参考图复刻。');
    }

    if (report.status === 'ok' && hasImageObservation) {
        nextActions.push('将该结果纳入真实 benchmark case，用人工验收标记校准阈值。');
    }

    return {
        kind: 'reference-replication-visual-qa',
        status: report.status,
        summary: report.summary,
        score: report.score,
        counts: report.counts,
        snapshot: {
            source,
            snapshotCount,
            overlayCount,
            hasImageObservation,
            rawImagesRedacted: true,
            pixelProbe: pixelProbe ? {
                status: pixelProbe.status,
                hasMetrics: typeof pixelProbe.mae === 'number'
                    || typeof pixelProbe.rmse === 'number'
                    || typeof pixelProbe.highDeltaRatio === 'number'
                    || typeof pixelProbe.darkJaccard === 'number'
                    || typeof pixelProbe.softDarkJaccard === 'number',
                mae: pixelProbe.mae,
                rmse: pixelProbe.rmse,
                highDeltaRatio: pixelProbe.highDeltaRatio,
                darkJaccard: pixelProbe.darkJaccard,
                softDarkJaccard: pixelProbe.softDarkJaccard,
                reason: pixelProbe.reason,
                boundary: pixelProbe.boundary,
                rawImagesRedacted: true
            } : undefined
        },
        blockers,
        warnings,
        nextActions: Array.from(new Set(nextActions))
    };
}
