export type DesignGridTaskKind =
    | 'reference-replication'
    | 'text-certificate'
    | 'sku'
    | 'detail-page'
    | 'main-image';

export type DesignGridSource = 'preset' | 'inferred' | 'user';

export interface DesignGridCanvas {
    width: number;
    height: number;
}

export interface DesignGridRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface DesignGridColumns {
    count: number;
    gutter: number;
    marginLeft: number;
    marginRight: number;
    columnWidth: number;
}

export interface DesignGridRows {
    baseline: number;
    rowHeight?: number;
    marginTop: number;
    marginBottom: number;
}

export interface DesignGridSpec {
    version: 'design-grid-dsl.v1';
    taskKind: DesignGridTaskKind;
    canvas: DesignGridCanvas;
    liveArea: DesignGridRect;
    columns: DesignGridColumns;
    rows: DesignGridRows;
    spacingScale: number[];
    confidence: number;
    source: DesignGridSource;
    notes: string[];
    allowBreakoutRoles: string[];
}

export interface GridPlacementConstraint {
    elementId: string;
    role?: string;
    targetBox: DesignGridRect;
    columnStart?: number;
    columnSpan?: number;
    baselineIndex?: number;
    snapTolerancePx?: number;
    allowBreakout?: boolean;
}

export interface GridPlacementEvaluation {
    elementId: string;
    gridFitScore: number;
    status: 'pass' | 'needs_review' | 'fail';
    expectedBox?: DesignGridRect;
    deltas: {
        left?: number;
        right?: number;
        top?: number;
        bottom?: number;
        baseline?: number;
    };
    offGridReasons: string[];
}

interface GridPresetRatios {
    columns: number;
    gutterRatio: number;
    marginXRatio: number;
    marginTopRatio: number;
    marginBottomRatio: number;
    baselineRatio: number;
    spacingScaleRatio: number[];
    confidence: number;
    allowBreakoutRoles: string[];
    notes: string[];
}

const TASK_GRID_PRESETS: Record<DesignGridTaskKind, GridPresetRatios> = {
    'text-certificate': {
        columns: 2,
        gutterRatio: 0.16,
        marginXRatio: 0.072,
        marginTopRatio: 0.08,
        marginBottomRatio: 0.08,
        baselineRatio: 0.02,
        spacingScaleRatio: [0.01, 0.02, 0.03, 0.04, 0.06, 0.08],
        confidence: 0.78,
        allowBreakoutRoles: ['title', 'legal-note'],
        notes: ['适合合格证、吊牌、纯文本信息图；优先保证列组、基线和字段对齐。']
    },
    sku: {
        columns: 4,
        gutterRatio: 0.025,
        marginXRatio: 0.05,
        marginTopRatio: 0.05,
        marginBottomRatio: 0.05,
        baselineRatio: 0.0125,
        spacingScaleRatio: [0.008, 0.0125, 0.02, 0.03, 0.04, 0.06],
        confidence: 0.72,
        allowBreakoutRoles: ['badge', 'promo'],
        notes: ['适合 SKU 重复单元；优先保证单元格、色块、文字标签和组合块一致。']
    },
    'detail-page': {
        columns: 4,
        gutterRatio: 0.03,
        marginXRatio: 0.06,
        marginTopRatio: 0.04,
        marginBottomRatio: 0.04,
        baselineRatio: 0.01,
        spacingScaleRatio: [0.008, 0.012, 0.02, 0.03, 0.05, 0.08],
        confidence: 0.68,
        allowBreakoutRoles: ['hero-image', 'full-bleed-background'],
        notes: ['适合详情页模块；优先保证模块节奏、图文安全区和垂直间距。']
    },
    'main-image': {
        columns: 8,
        gutterRatio: 0.02,
        marginXRatio: 0.06,
        marginTopRatio: 0.06,
        marginBottomRatio: 0.06,
        baselineRatio: 0.01,
        spacingScaleRatio: [0.008, 0.012, 0.02, 0.032, 0.05, 0.08],
        confidence: 0.62,
        allowBreakoutRoles: ['product-hero', 'background', 'decorative-shape'],
        notes: ['适合主图构图；允许主视觉受控破格，但文案和利益点仍需安全区约束。']
    },
    'reference-replication': {
        columns: 12,
        gutterRatio: 0.02,
        marginXRatio: 0.05,
        marginTopRatio: 0.05,
        marginBottomRatio: 0.05,
        baselineRatio: 0.01,
        spacingScaleRatio: [0.008, 0.012, 0.02, 0.03, 0.05, 0.08],
        confidence: 0.45,
        allowBreakoutRoles: ['background', 'hero-image', 'decorative-shape'],
        notes: ['只作为参考图复刻的初始候选网格；真实网格应由视觉解析和元素聚类推断。']
    }
};

function assertPositiveNumber(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number.`);
    }
}

function roundPx(value: number): number {
    return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function getDesignGridTaskKinds(): DesignGridTaskKind[] {
    return ['text-certificate', 'sku', 'detail-page', 'main-image', 'reference-replication'];
}

export function createTaskGridPreset(
    taskKind: DesignGridTaskKind,
    canvas: DesignGridCanvas,
    source: DesignGridSource = 'preset'
): DesignGridSpec {
    assertPositiveNumber(canvas.width, 'canvas.width');
    assertPositiveNumber(canvas.height, 'canvas.height');
    const preset = TASK_GRID_PRESETS[taskKind];
    if (!preset) throw new Error(`Unsupported grid task kind: ${taskKind}`);

    const marginLeft = roundPx(canvas.width * preset.marginXRatio);
    const marginRight = roundPx(canvas.width * preset.marginXRatio);
    const marginTop = roundPx(canvas.height * preset.marginTopRatio);
    const marginBottom = roundPx(canvas.height * preset.marginBottomRatio);
    const gutter = roundPx(canvas.width * preset.gutterRatio);
    const liveWidth = roundPx(canvas.width - marginLeft - marginRight);
    const liveHeight = roundPx(canvas.height - marginTop - marginBottom);
    const columnWidth = roundPx((liveWidth - gutter * (preset.columns - 1)) / preset.columns);
    const baseline = Math.max(1, roundPx(canvas.height * preset.baselineRatio));
    const spacingScale = preset.spacingScaleRatio.map((ratio) => Math.max(1, roundPx(canvas.width * ratio)));

    return {
        version: 'design-grid-dsl.v1',
        taskKind,
        canvas: { width: canvas.width, height: canvas.height },
        liveArea: {
            x: marginLeft,
            y: marginTop,
            width: liveWidth,
            height: liveHeight
        },
        columns: {
            count: preset.columns,
            gutter,
            marginLeft,
            marginRight,
            columnWidth
        },
        rows: {
            baseline,
            marginTop,
            marginBottom
        },
        spacingScale,
        confidence: preset.confidence,
        source,
        notes: [...preset.notes],
        allowBreakoutRoles: [...preset.allowBreakoutRoles]
    };
}

export function getGridColumnBox(spec: DesignGridSpec, columnStart: number, columnSpan = 1): DesignGridRect {
    if (!Number.isInteger(columnStart) || columnStart < 1 || columnStart > spec.columns.count) {
        throw new Error('columnStart must be a 1-based column index inside the grid.');
    }
    if (!Number.isInteger(columnSpan) || columnSpan < 1 || columnStart + columnSpan - 1 > spec.columns.count) {
        throw new Error('columnSpan must fit inside the grid.');
    }
    const x = spec.liveArea.x + (columnStart - 1) * (spec.columns.columnWidth + spec.columns.gutter);
    const width = columnSpan * spec.columns.columnWidth + (columnSpan - 1) * spec.columns.gutter;
    return {
        x: roundPx(x),
        y: spec.liveArea.y,
        width: roundPx(width),
        height: spec.liveArea.height
    };
}

export function inferNearestGridColumnSpan(
    spec: DesignGridSpec,
    box: DesignGridRect
): { columnStart: number; columnSpan: number; score: number } {
    let best = { columnStart: 1, columnSpan: 1, score: -1 };
    for (let start = 1; start <= spec.columns.count; start += 1) {
        for (let span = 1; span <= spec.columns.count - start + 1; span += 1) {
            const candidate = getGridColumnBox(spec, start, span);
            const leftDelta = Math.abs(candidate.x - box.x);
            const rightDelta = Math.abs(candidate.x + candidate.width - (box.x + box.width));
            const maxDelta = Math.max(leftDelta, rightDelta);
            const tolerance = Math.max(spec.columns.gutter, spec.rows.baseline * 2, 1);
            const score = clamp01(1 - maxDelta / tolerance);
            if (score > best.score) best = { columnStart: start, columnSpan: span, score: roundPx(score) };
        }
    }
    return best;
}

export function evaluateGridPlacement(
    spec: DesignGridSpec,
    constraint: GridPlacementConstraint
): GridPlacementEvaluation {
    const tolerance = constraint.snapTolerancePx ?? Math.max(spec.rows.baseline * 2, spec.columns.gutter, 1);
    const offGridReasons: string[] = [];
    let expectedBox: DesignGridRect | undefined;
    const deltas: GridPlacementEvaluation['deltas'] = {};

    const breakoutAllowed = Boolean(constraint.allowBreakout) ||
        Boolean(constraint.role && spec.allowBreakoutRoles.includes(constraint.role));

    if (constraint.columnStart !== undefined || constraint.columnSpan !== undefined) {
        if (constraint.columnStart === undefined || constraint.columnSpan === undefined) {
            offGridReasons.push('columnStart and columnSpan must be provided together.');
        } else {
            expectedBox = getGridColumnBox(spec, constraint.columnStart, constraint.columnSpan);
            deltas.left = roundPx(constraint.targetBox.x - expectedBox.x);
            deltas.right = roundPx(
                constraint.targetBox.x + constraint.targetBox.width - (expectedBox.x + expectedBox.width)
            );
            if (Math.abs(deltas.left) > tolerance) offGridReasons.push('left edge is outside snap tolerance.');
            if (Math.abs(deltas.right) > tolerance) offGridReasons.push('right edge is outside snap tolerance.');
        }
    } else if (!breakoutAllowed) {
        const nearest = inferNearestGridColumnSpan(spec, constraint.targetBox);
        if (nearest.score < 0.5) offGridReasons.push('target box does not align to any likely column span.');
    }

    if (constraint.baselineIndex !== undefined) {
        const expectedBaselineY = spec.liveArea.y + constraint.baselineIndex * spec.rows.baseline;
        deltas.baseline = roundPx(constraint.targetBox.y - expectedBaselineY);
        if (Math.abs(deltas.baseline) > tolerance) offGridReasons.push('top edge is outside baseline tolerance.');
    }

    const outsideLiveArea =
        constraint.targetBox.x < spec.liveArea.x - tolerance ||
        constraint.targetBox.y < spec.liveArea.y - tolerance ||
        constraint.targetBox.x + constraint.targetBox.width > spec.liveArea.x + spec.liveArea.width + tolerance ||
        constraint.targetBox.y + constraint.targetBox.height > spec.liveArea.y + spec.liveArea.height + tolerance;
    if (outsideLiveArea && !breakoutAllowed) offGridReasons.push('target box exceeds live area and breakout is not allowed.');

    const maxDelta = Math.max(
        ...Object.values(deltas).filter((value): value is number => Number.isFinite(value)).map((value) => Math.abs(value)),
        outsideLiveArea && !breakoutAllowed ? tolerance : 0
    );
    const gridFitScore = offGridReasons.length === 0 ? 1 : clamp01(1 - maxDelta / Math.max(tolerance, 1));
    const status = offGridReasons.length === 0
        ? 'pass'
        : gridFitScore >= 0.5
            ? 'needs_review'
            : 'fail';

    return {
        elementId: constraint.elementId,
        gridFitScore: roundPx(gridFitScore),
        status,
        expectedBox,
        deltas,
        offGridReasons
    };
}
