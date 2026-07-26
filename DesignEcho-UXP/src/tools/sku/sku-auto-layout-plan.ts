export type SkuAutoLayoutStrategy = 'auto' | 'single-row' | 'grid';
export type SkuAutoLayoutPreset = 'sku-combo' | 'sku-note' | 'generic';
export type SkuAutoLayoutStatus = 'ready' | 'needs_review' | 'blocked';
type SkuAutoLayoutVerticalAnchor = 'center' | 'row-top';

export interface SkuAutoLayoutRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface SkuAutoLayoutItem {
    id: string;
    layerId?: number;
    name: string;
    bounds: SkuAutoLayoutRect;
    subjectBounds?: SkuAutoLayoutRect;
}

export interface SkuAutoLayoutObstacle {
    id: string;
    role?: string;
    locked?: boolean;
    bounds: SkuAutoLayoutRect;
}

export interface SkuAutoLayoutPlanInput {
    canvas: { width: number; height: number };
    items: SkuAutoLayoutItem[];
    obstacles?: SkuAutoLayoutObstacle[];
    preset?: SkuAutoLayoutPreset;
    strategy?: SkuAutoLayoutStrategy;
    safeMarginPx?: number;
    clearancePx?: number;
    minSpacingPx?: number;
    minScalePercent?: number;
}

export interface SkuAutoLayoutPlacement {
    itemId: string;
    layerId?: number;
    name: string;
    destinationBox: SkuAutoLayoutRect;
    cellBox: SkuAutoLayoutRect;
    scalePercent: number;
    row: number;
    column: number;
}

export interface SkuAutoLayoutCandidate {
    strategy: Exclude<SkuAutoLayoutStrategy, 'auto'>;
    rows: number;
    cols: number;
    region: SkuAutoLayoutRect;
    score: number;
    minScalePercent: number;
    centerDistance: number;
}

export interface SkuAutoLayoutDiagnosticsSummary {
    itemCount: number;
    obstacleCount: number;
    expandedObstacleCount: number;
    safeBox: SkuAutoLayoutRect;
    safeBoxAreaPx: number;
    freeRegionCount: number;
    largestFreeRegion: SkuAutoLayoutRect;
    largestFreeRegionAreaPx: number;
    totalFreeRegionAreaPx: number;
    largestItemBounds: SkuAutoLayoutRect;
    largestItemAreaPx: number;
    totalItemAreaPx: number;
    constraints: {
        minSpacingPx: number;
        clearancePx: number;
        minScalePercent: number;
    };
    likelyBlockers: string[];
}

export interface SkuAutoLayoutPlan {
    schema: 'sku-auto-layout-plan/v0';
    status: SkuAutoLayoutStatus;
    strategy: Exclude<SkuAutoLayoutStrategy, 'auto'>;
    safeBox: SkuAutoLayoutRect;
    selectedRegion: SkuAutoLayoutRect;
    placements: SkuAutoLayoutPlacement[];
    diagnostics: {
        candidates: SkuAutoLayoutCandidate[];
        warnings: string[];
        blockers: string[];
        summary?: SkuAutoLayoutDiagnosticsSummary;
    };
    constraints: {
        minSpacingPx: number;
        clearancePx: number;
        minScalePercent: number;
    };
    boundaries: {
        writesPhotoshop: false;
        claimsDesignQuality: false;
    };
}

export interface SkuAutoLayoutActualPlacement {
    itemId: string;
    layerId?: number;
    name: string;
    destinationBox: SkuAutoLayoutRect;
    actualBounds?: SkuAutoLayoutRect | null;
    actualSubjectBounds?: SkuAutoLayoutRect | null;
}

export interface SkuAutoLayoutQaPlacement {
    itemId: string;
    layerId?: number;
    name: string;
    destinationBox: SkuAutoLayoutRect;
    actualBounds: SkuAutoLayoutRect | null;
    actualSubjectBounds: SkuAutoLayoutRect | null;
    centerDeltaPx: number | null;
    maxOverflowPx: number | null;
}

export interface SkuAutoLayoutQaResult {
    schema: 'sku-auto-layout-qa/v0';
    status: SkuAutoLayoutStatus;
    actualPlacements: SkuAutoLayoutQaPlacement[];
    warnings: string[];
    blockers: string[];
    boundaries: {
        usesActualBounds: true;
        writesPhotoshop: false;
        claimsDesignQuality: false;
    };
}

export interface SkuAutoLayoutQaInput {
    plan: SkuAutoLayoutPlan;
    actualPlacements: SkuAutoLayoutActualPlacement[];
    obstacles?: SkuAutoLayoutObstacle[];
    tolerancePx?: number;
    clearancePx?: number;
    minSpacingPx?: number;
}

interface CandidateBuildResult {
    candidate: SkuAutoLayoutCandidate;
    placements: SkuAutoLayoutPlacement[];
}

const ZERO_RECT: SkuAutoLayoutRect = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRect(rect: Partial<SkuAutoLayoutRect> | undefined): SkuAutoLayoutRect {
    if (!rect) return { ...ZERO_RECT };
    const left = finite(rect.left);
    const top = finite(rect.top);
    const right = finite(rect.right, left + finite(rect.width));
    const bottom = finite(rect.bottom, top + finite(rect.height));
    const normalizedLeft = Math.min(left, right);
    const normalizedRight = Math.max(left, right);
    const normalizedTop = Math.min(top, bottom);
    const normalizedBottom = Math.max(top, bottom);
    return {
        left: normalizedLeft,
        top: normalizedTop,
        right: normalizedRight,
        bottom: normalizedBottom,
        width: Math.max(0, normalizedRight - normalizedLeft),
        height: Math.max(0, normalizedBottom - normalizedTop)
    };
}

function makeRect(left: number, top: number, right: number, bottom: number): SkuAutoLayoutRect {
    return normalizeRect({ left, top, right, bottom });
}

function rectArea(rect: SkuAutoLayoutRect): number {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function rectCenter(rect: SkuAutoLayoutRect): { x: number; y: number } {
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
}

function intersects(a: SkuAutoLayoutRect, b: SkuAutoLayoutRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function containsRect(outer: SkuAutoLayoutRect, inner: SkuAutoLayoutRect): boolean {
    return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

function expandRect(rect: SkuAutoLayoutRect, amount: number): SkuAutoLayoutRect {
    return makeRect(rect.left - amount, rect.top - amount, rect.right + amount, rect.bottom + amount);
}

function rectOverflowPx(outer: SkuAutoLayoutRect, inner: SkuAutoLayoutRect): number {
    return Math.max(
        0,
        outer.left - inner.left,
        outer.top - inner.top,
        inner.right - outer.right,
        inner.bottom - outer.bottom
    );
}

function getRectCenterDistance(a: SkuAutoLayoutRect, b: SkuAutoLayoutRect): number {
    const centerA = rectCenter(a);
    const centerB = rectCenter(b);
    return Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
}

function unionRects(rects: SkuAutoLayoutRect[]): SkuAutoLayoutRect {
    const valid = rects.filter((rect) => rect.width > 0 && rect.height > 0);
    if (valid.length === 0) return { ...ZERO_RECT };
    return makeRect(
        Math.min(...valid.map((rect) => rect.left)),
        Math.min(...valid.map((rect) => rect.top)),
        Math.max(...valid.map((rect) => rect.right)),
        Math.max(...valid.map((rect) => rect.bottom))
    );
}

function sortRegionsForLayout(regions: SkuAutoLayoutRect[]): SkuAutoLayoutRect[] {
    const minHeight = Math.max(1, Math.min(...regions.map((region) => Math.max(1, region.height))));
    const rowTolerance = Math.max(24, minHeight * 0.18);
    return regions.slice().sort((a, b) => {
        const rowDelta = a.top - b.top;
        if (Math.abs(rowDelta) > rowTolerance) return rowDelta;
        return a.left - b.left;
    });
}

function pushUnique(messages: string[], message: string): void {
    if (!messages.includes(message)) messages.push(message);
}

function formatDimension(value: number): string {
    return String(Math.round(value));
}

function clipRect(rect: SkuAutoLayoutRect, bounds: SkuAutoLayoutRect): SkuAutoLayoutRect | null {
    const clipped = makeRect(
        Math.max(rect.left, bounds.left),
        Math.max(rect.top, bounds.top),
        Math.min(rect.right, bounds.right),
        Math.min(rect.bottom, bounds.bottom)
    );
    return clipped.width > 0 && clipped.height > 0 ? clipped : null;
}

function uniqueSorted(values: number[]): number[] {
    return Array.from(new Set(values.map((value) => Number(value.toFixed(3))))).sort((a, b) => a - b);
}

function getPresetFillRatio(preset: SkuAutoLayoutPreset): number {
    if (preset === 'sku-note') return 0.74;
    if (preset === 'generic') return 0.72;
    return 0.78;
}

function getCompactFallbackFillRatios(baseFillRatio: number, preset: SkuAutoLayoutPreset): number[] {
    const upper = preset === 'generic' ? 0.94 : preset === 'sku-note' ? 0.96 : 1;
    return uniqueSorted([
        Math.min(upper, Math.max(baseFillRatio + 0.1, 0.9)),
        upper
    ]).filter((ratio) => ratio > baseFillRatio + 0.02);
}

function getDefaultMinSpacingPx(canvasMinSide: number, preset: SkuAutoLayoutPreset): number {
    const ratio = preset === 'sku-note' ? 0.018 : 0.022;
    return clamp(canvasMinSide * ratio, 14, 44);
}

function getSafeBox(input: SkuAutoLayoutPlanInput): SkuAutoLayoutRect {
    const width = Math.max(1, finite(input.canvas?.width));
    const height = Math.max(1, finite(input.canvas?.height));
    const margin = input.safeMarginPx ?? clamp(Math.min(width, height) * 0.06, 24, 96);
    return makeRect(margin, margin, width - margin, height - margin);
}

function buildFreeRegions(
    safeBox: SkuAutoLayoutRect,
    obstacles: SkuAutoLayoutObstacle[],
    clearancePx: number
): SkuAutoLayoutRect[] {
    const expandedObstacles = buildExpandedObstacles(safeBox, obstacles, clearancePx);

    if (expandedObstacles.length === 0) return [safeBox];

    const xLines = uniqueSorted([
        safeBox.left,
        safeBox.right,
        ...expandedObstacles.flatMap((rect) => [rect.left, rect.right])
    ]);
    const yLines = uniqueSorted([
        safeBox.top,
        safeBox.bottom,
        ...expandedObstacles.flatMap((rect) => [rect.top, rect.bottom])
    ]);

    const regions: SkuAutoLayoutRect[] = [];
    for (let xIndex = 0; xIndex < xLines.length - 1; xIndex++) {
        for (let yIndex = 0; yIndex < yLines.length - 1; yIndex++) {
            const cell = makeRect(xLines[xIndex], yLines[yIndex], xLines[xIndex + 1], yLines[yIndex + 1]);
            if (cell.width < 32 || cell.height < 32) continue;
            if (expandedObstacles.some((obstacle) => intersects(cell, obstacle))) continue;
            regions.push(cell);
        }
    }

    return mergeAlignedRegions(regions).sort((a, b) => rectArea(b) - rectArea(a));
}

function buildExpandedObstacles(
    safeBox: SkuAutoLayoutRect,
    obstacles: SkuAutoLayoutObstacle[],
    clearancePx: number
): SkuAutoLayoutRect[] {
    return obstacles
        .map((obstacle) => clipRect(expandRect(normalizeRect(obstacle.bounds), clearancePx), safeBox))
        .filter((rect): rect is SkuAutoLayoutRect => Boolean(rect));
}

function mergeAlignedRegions(regions: SkuAutoLayoutRect[]): SkuAutoLayoutRect[] {
    let merged = regions.slice();
    let changed = true;

    while (changed) {
        changed = false;
        outer:
        for (let i = 0; i < merged.length; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                const a = merged[i];
                const b = merged[j];
                const sameVertical = Math.abs(a.top - b.top) < 0.01 && Math.abs(a.bottom - b.bottom) < 0.01;
                const touchingX = Math.abs(a.right - b.left) < 0.01 || Math.abs(b.right - a.left) < 0.01;
                const sameHorizontal = Math.abs(a.left - b.left) < 0.01 && Math.abs(a.right - b.right) < 0.01;
                const touchingY = Math.abs(a.bottom - b.top) < 0.01 || Math.abs(b.bottom - a.top) < 0.01;

                if ((sameVertical && touchingX) || (sameHorizontal && touchingY)) {
                    merged.splice(j, 1);
                    merged.splice(i, 1, makeRect(
                        Math.min(a.left, b.left),
                        Math.min(a.top, b.top),
                        Math.max(a.right, b.right),
                        Math.max(a.bottom, b.bottom)
                    ));
                    changed = true;
                    break outer;
                }
            }
        }
    }

    return merged;
}

function getItemSourceBounds(item: SkuAutoLayoutItem): SkuAutoLayoutRect {
    const subject = normalizeRect(item.subjectBounds || item.bounds);
    if (subject.width > 0 && subject.height > 0) return subject;
    return normalizeRect(item.bounds);
}

function getPresetVerticalAnchor(preset: SkuAutoLayoutPreset): SkuAutoLayoutVerticalAnchor {
    return preset === 'sku-combo' ? 'row-top' : 'center';
}

function getRowMaxHeights<T extends { row: number }>(
    entries: T[],
    getHeight: (entry: T) => number
): Map<number, number> {
    const rowMaxHeights = new Map<number, number>();
    for (const entry of entries) {
        const height = getHeight(entry);
        const current = rowMaxHeights.get(entry.row) || 0;
        rowMaxHeights.set(entry.row, Math.max(current, height));
    }
    return rowMaxHeights;
}

function buildAnchoredDestinationBox(input: {
    source: SkuAutoLayoutRect;
    cellBox: SkuAutoLayoutRect;
    scale: number;
    rowMaxHeight: number;
    verticalAnchor: SkuAutoLayoutVerticalAnchor;
}): SkuAutoLayoutRect {
    const finalWidth = input.source.width * input.scale;
    const finalHeight = input.source.height * input.scale;
    const center = rectCenter(input.cellBox);
    const left = center.x - finalWidth / 2;
    const top = input.verticalAnchor === 'row-top'
        ? input.cellBox.top + (input.cellBox.height - input.rowMaxHeight) / 2
        : center.y - finalHeight / 2;
    return makeRect(left, top, left + finalWidth, top + finalHeight);
}

function enumerateGridShapes(itemCount: number, requested: SkuAutoLayoutStrategy): Array<{ rows: number; cols: number; strategy: Exclude<SkuAutoLayoutStrategy, 'auto'> }> {
    if (itemCount <= 0) return [];

    if (requested === 'single-row') {
        return [{ rows: 1, cols: itemCount, strategy: 'single-row' }];
    }

    const shapes: Array<{ rows: number; cols: number; strategy: Exclude<SkuAutoLayoutStrategy, 'auto'> }> = [];
    if (requested !== 'grid') {
        shapes.push({ rows: 1, cols: itemCount, strategy: 'single-row' });
    }

    const maxRows = Math.min(itemCount, Math.ceil(Math.sqrt(itemCount)) + 2);
    for (let rows = 1; rows <= maxRows; rows++) {
        const cols = Math.ceil(itemCount / rows);
        const strategy = rows === 1 ? 'single-row' : 'grid';
        if (requested === 'grid' && rows === 1 && itemCount > 2) continue;
        if (!shapes.some((shape) => shape.rows === rows && shape.cols === cols)) {
            shapes.push({ rows, cols, strategy });
        }
    }

    return shapes;
}

function buildCandidate(
    region: SkuAutoLayoutRect,
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    rows: number,
    cols: number,
    strategy: Exclude<SkuAutoLayoutStrategy, 'auto'>,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number
): CandidateBuildResult | null {
    const gapX = Math.max(minSpacingPx, clamp(region.width * 0.025, 12, 48));
    const gapY = Math.max(minSpacingPx, clamp(region.height * 0.035, 12, 56));
    const cellWidth = (region.width - gapX * (cols - 1)) / cols;
    const cellHeight = (region.height - gapY * (rows - 1)) / rows;

    if (cellWidth <= 12 || cellHeight <= 12) return null;

    const plannedItems: Array<{
        item: SkuAutoLayoutItem;
        source: SkuAutoLayoutRect;
        cellBox: SkuAutoLayoutRect;
        row: number;
        column: number;
        fitScale: number;
    }> = [];

    for (let index = 0; index < items.length; index++) {
        const row = Math.floor(index / cols);
        const column = index % cols;
        const rowItemCount = Math.min(cols, items.length - row * cols);
        const rowCenterOffsetX = Math.max(0, cols - rowItemCount) * (cellWidth + gapX) / 2;
        const item = items[index];
        const source = getItemSourceBounds(item);
        if (source.width <= 0 || source.height <= 0) return null;

        const cellLeft = region.left + rowCenterOffsetX + column * (cellWidth + gapX);
        const cellTop = region.top + row * (cellHeight + gapY);
        const cellBox = makeRect(cellLeft, cellTop, cellLeft + cellWidth, cellTop + cellHeight);
        const fitScale = Math.min((cellWidth * fillRatio) / source.width, (cellHeight * fillRatio) / source.height);
        if (!Number.isFinite(fitScale) || fitScale <= 0) return null;
        plannedItems.push({
            item,
            source,
            cellBox,
            row,
            column,
            fitScale
        });
    }

    const sharedScale = Math.min(...plannedItems.map((entry) => entry.fitScale));
    const scalePercent = sharedScale * 100;
    if (!Number.isFinite(scalePercent) || scalePercent < minScalePercent) return null;

    const rowMaxHeights = getRowMaxHeights(plannedItems, (entry) => entry.source.height * sharedScale);
    const placements: SkuAutoLayoutPlacement[] = [];
    for (const entry of plannedItems) {
        const rowMaxHeight = rowMaxHeights.get(entry.row) || entry.source.height * sharedScale;
        const destinationBox = buildAnchoredDestinationBox({
            source: entry.source,
            cellBox: entry.cellBox,
            scale: sharedScale,
            rowMaxHeight,
            verticalAnchor
        });

        if (!containsRect(safeBox, destinationBox) || !containsRect(region, destinationBox)) return null;

        placements.push({
            itemId: entry.item.id,
            layerId: entry.item.layerId,
            name: entry.item.name,
            destinationBox,
            cellBox: entry.cellBox,
            scalePercent,
            row: entry.row,
            column: entry.column
        });
    }

    if (placements.length === 0) return null;

    let scaleVariance = 0;
    for (const entry of plannedItems) {
        scaleVariance += Math.max(0, entry.fitScale * 100 - scalePercent);
    }

    const regionCenter = rectCenter(region);
    const safeCenter = rectCenter(safeBox);
    const centerDistance = Math.hypot(regionCenter.x - safeCenter.x, regionCenter.y - safeCenter.y);
    const unusedSlots = rows * cols - items.length;
    const regionAreaRatio = rectArea(region) / Math.max(1, rectArea(safeBox));
    const rowPenalty = strategy === 'single-row' && items.length > 5 ? 120 : 0;
    const unusedPenalty = unusedSlots * 20;
    const centerPenalty = centerDistance / Math.max(1, Math.min(safeBox.width, safeBox.height));
    const score = scalePercent * 5 + regionAreaRatio * 120 - scaleVariance * 0.18 - unusedPenalty - rowPenalty - centerPenalty * 30;

    return {
        candidate: {
            strategy,
            rows,
            cols,
            region,
            score,
            minScalePercent: scalePercent,
            centerDistance
        },
        placements
    };
}

function rebuildPlacementsAtSharedScale(
    localPlacements: SkuAutoLayoutPlacement[],
    itemsById: Map<string, SkuAutoLayoutItem>,
    sharedScalePercent: number,
    safeBox: SkuAutoLayoutRect,
    verticalAnchor: SkuAutoLayoutVerticalAnchor
): SkuAutoLayoutPlacement[] | null {
    const sharedScale = sharedScalePercent / 100;
    const placements: SkuAutoLayoutPlacement[] = [];
    const rowMaxHeights = getRowMaxHeights(localPlacements, (placement) => {
        const item = itemsById.get(placement.itemId);
        if (!item) return 0;
        return getItemSourceBounds(item).height * sharedScale;
    });

    for (const placement of localPlacements) {
        const item = itemsById.get(placement.itemId);
        if (!item) return null;
        const source = getItemSourceBounds(item);
        const finalWidth = source.width * sharedScale;
        const finalHeight = source.height * sharedScale;
        if (!Number.isFinite(finalWidth) || !Number.isFinite(finalHeight) || finalWidth <= 0 || finalHeight <= 0) return null;

        const rowMaxHeight = rowMaxHeights.get(placement.row) || finalHeight;
        const destinationBox = buildAnchoredDestinationBox({
            source,
            cellBox: placement.cellBox,
            scale: sharedScale,
            rowMaxHeight,
            verticalAnchor
        });
        if (!containsRect(safeBox, destinationBox) || !containsRect(placement.cellBox, destinationBox)) return null;

        placements.push({
            ...placement,
            destinationBox,
            scalePercent: sharedScalePercent
        });
    }

    return placements;
}

function placementsRespectSpacing(placements: SkuAutoLayoutPlacement[], minSpacingPx: number): boolean {
    for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
            const a = expandRect(placements[i].destinationBox, minSpacingPx / 2);
            const b = expandRect(placements[j].destinationBox, minSpacingPx / 2);
            if (intersects(a, b)) return false;
        }
    }
    return true;
}

function enumeratePartitions(total: number, parts: number): number[][] {
    if (parts <= 0 || total < parts) return [];
    if (parts === 1) return [[total]];

    const results: number[][] = [];
    const maxFirst = total - (parts - 1);
    for (let first = 1; first <= maxFirst; first++) {
        for (const rest of enumeratePartitions(total - first, parts - 1)) {
            results.push([first, ...rest]);
        }
    }
    return results;
}

function enumerateRegionCombinations(regions: SkuAutoLayoutRect[], count: number, limit = 48): SkuAutoLayoutRect[][] {
    const source = regions.slice(0, Math.min(regions.length, 8));
    const results: SkuAutoLayoutRect[][] = [];

    function walk(start: number, picked: SkuAutoLayoutRect[]) {
        if (results.length >= limit) return;
        if (picked.length === count) {
            results.push(sortRegionsForLayout(picked));
            return;
        }
        for (let index = start; index < source.length; index++) {
            walk(index + 1, [...picked, source[index]]);
        }
    }

    walk(0, []);
    return results;
}

function getTopLocalRegionCandidates(
    region: SkuAutoLayoutRect,
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    strategyRequest: SkuAutoLayoutStrategy,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number
): CandidateBuildResult[] {
    const candidates: CandidateBuildResult[] = [];
    for (const shape of enumerateGridShapes(items.length, strategyRequest)) {
        const candidate = buildCandidate(
            region,
            safeBox,
            items,
            shape.rows,
            shape.cols,
            shape.strategy,
            verticalAnchor,
            fillRatio,
            minScalePercent,
            minSpacingPx
        );
        if (candidate) candidates.push(candidate);
    }

    return candidates
        .sort((a, b) => b.candidate.minScalePercent - a.candidate.minScalePercent || b.candidate.score - a.candidate.score)
        .slice(0, 3);
}

function combineLocalCandidateGroups(
    groups: CandidateBuildResult[][],
    limit = 96
): CandidateBuildResult[][] {
    const results: CandidateBuildResult[][] = [];

    function walk(index: number, picked: CandidateBuildResult[]) {
        if (results.length >= limit) return;
        if (index >= groups.length) {
            results.push(picked);
            return;
        }
        for (const candidate of groups[index]) {
            walk(index + 1, [...picked, candidate]);
        }
    }

    walk(0, []);
    return results;
}

function buildMultiRegionCandidates(
    regions: SkuAutoLayoutRect[],
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    strategyRequest: SkuAutoLayoutStrategy,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number
): CandidateBuildResult[] {
    if (regions.length < 2 || items.length < 2) return [];

    const candidates: CandidateBuildResult[] = [];
    const regionsByArea = regions
        .slice()
        .sort((a, b) => rectArea(b) - rectArea(a))
        .slice(0, Math.min(regions.length, 8));
    const maxRegionCount = Math.min(4, regionsByArea.length, items.length);
    const itemsById = new Map(items.map((item) => [item.id, item]));

    for (let regionCount = 2; regionCount <= maxRegionCount; regionCount++) {
        const regionGroups = enumerateRegionCombinations(regionsByArea, regionCount);
        const partitions = enumeratePartitions(items.length, regionCount);

        for (const regionGroup of regionGroups) {
            for (const partition of partitions) {
                let cursor = 0;
                const localGroups: CandidateBuildResult[][] = [];
                let valid = true;

                for (let groupIndex = 0; groupIndex < regionGroup.length; groupIndex++) {
                    const count = partition[groupIndex];
                    const itemSlice = items.slice(cursor, cursor + count);
                    cursor += count;
                    const localCandidates = getTopLocalRegionCandidates(
                        regionGroup[groupIndex],
                        safeBox,
                        itemSlice,
                        strategyRequest,
                        verticalAnchor,
                        fillRatio,
                        minScalePercent,
                        minSpacingPx
                    );
                    if (localCandidates.length === 0) {
                        valid = false;
                        break;
                    }
                    localGroups.push(localCandidates);
                }

                if (!valid) continue;

                for (const localCombination of combineLocalCandidateGroups(localGroups)) {
                    const sharedScalePercent = Math.min(...localCombination.map((entry) => entry.candidate.minScalePercent));
                    if (!Number.isFinite(sharedScalePercent) || sharedScalePercent < minScalePercent) continue;

                    const localPlacements = localCombination.flatMap((entry) => entry.placements);
                    const placements = rebuildPlacementsAtSharedScale(localPlacements, itemsById, sharedScalePercent, safeBox, verticalAnchor);
                    if (!placements || placements.length !== items.length) continue;
                    if (!placementsRespectSpacing(placements, minSpacingPx)) continue;

                    const usedRegions = localCombination.map((entry) => entry.candidate.region);
                    const selectedRegion = unionRects(usedRegions);
                    const totalRegionAreaRatio = usedRegions.reduce((sum, region) => sum + rectArea(region), 0) / Math.max(1, rectArea(safeBox));
                    const centerDistance = getRectCenterDistance(selectedRegion, safeBox);
                    const strategy = localCombination.every((entry) => entry.candidate.rows === 1) ? 'single-row' : 'grid';
                    const localScore = localCombination.reduce((sum, entry) => sum + entry.candidate.score, 0) / localCombination.length;
                    const balancePenalty = (Math.max(...partition) - Math.min(...partition)) * 8;
                    const centerPenalty = centerDistance / Math.max(1, Math.min(safeBox.width, safeBox.height));
                    const score = sharedScalePercent * 5
                        + totalRegionAreaRatio * 110
                        + localScore * 0.18
                        - balancePenalty
                        - centerPenalty * 26
                        - (regionCount - 1) * 10;

                    candidates.push({
                        candidate: {
                            strategy,
                            rows: Math.max(...localCombination.map((entry) => entry.candidate.rows)),
                            cols: Math.max(...localCombination.map((entry) => entry.candidate.cols)),
                            region: selectedRegion,
                            score,
                            minScalePercent: sharedScalePercent,
                            centerDistance
                        },
                        placements
                    });
                }
            }
        }
    }

    return candidates;
}

function buildCandidateResultsForFillRatio(
    freeRegions: SkuAutoLayoutRect[],
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    strategyRequest: SkuAutoLayoutStrategy,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number
): CandidateBuildResult[] {
    const results: CandidateBuildResult[] = [];

    for (const region of freeRegions.slice(0, 24)) {
        for (const shape of enumerateGridShapes(items.length, strategyRequest)) {
            const candidate = buildCandidate(
                region,
                safeBox,
                items,
                shape.rows,
                shape.cols,
                shape.strategy,
                verticalAnchor,
                fillRatio,
                minScalePercent,
                minSpacingPx
            );
            if (candidate) results.push(candidate);
        }
    }

    results.push(...buildMultiRegionCandidates(
        freeRegions,
        safeBox,
        items,
        strategyRequest,
        verticalAnchor,
        fillRatio,
        minScalePercent,
        minSpacingPx
    ));

    return results;
}

function buildLayoutSearchFailureWarnings(input: {
    freeRegions: SkuAutoLayoutRect[];
    obstacles: SkuAutoLayoutObstacle[];
    itemCount: number;
    constraints: SkuAutoLayoutPlan['constraints'];
}): string[] {
    if (input.freeRegions.length === 0) return [];

    const largestRegion = input.freeRegions
        .slice()
        .sort((a, b) => rectArea(b) - rectArea(a))[0] || ZERO_RECT;
    return [
        [
            `已检查 ${input.freeRegions.length} 个空闲区域，但尺寸或缩放比例不足。`,
            `最大空闲区域约 ${formatDimension(largestRegion.width)}x${formatDimension(largestRegion.height)}px。`,
            `SKU 数量 ${input.itemCount}，模板障碍 ${input.obstacles.length} 个，最小缩放 ${formatDimension(input.constraints.minScalePercent)}%，最小间距 ${formatDimension(input.constraints.minSpacingPx)}px，避让 ${formatDimension(input.constraints.clearancePx)}px。`
        ].join(' ')
    ];
}

function buildAutoLayoutDiagnosticsSummary(input: {
    safeBox: SkuAutoLayoutRect;
    freeRegions: SkuAutoLayoutRect[];
    obstacles: SkuAutoLayoutObstacle[];
    items: SkuAutoLayoutItem[];
    constraints: SkuAutoLayoutPlan['constraints'];
}): SkuAutoLayoutDiagnosticsSummary {
    const largestFreeRegion = input.freeRegions
        .slice()
        .sort((a, b) => rectArea(b) - rectArea(a))[0] || ZERO_RECT;
    const totalFreeRegionAreaPx = input.freeRegions.reduce((sum, region) => sum + rectArea(region), 0);
    const safeBoxAreaPx = rectArea(input.safeBox);
    const largestItemBounds = input.items
        .map((item) => getItemSourceBounds(item))
        .sort((a, b) => rectArea(b) - rectArea(a))[0] || ZERO_RECT;
    const largestItemAreaPx = rectArea(largestItemBounds);
    const totalItemAreaPx = input.items.reduce((sum, item) => sum + rectArea(getItemSourceBounds(item)), 0);
    const expandedObstacleCount = buildExpandedObstacles(
        input.safeBox,
        input.obstacles,
        input.constraints.clearancePx
    ).length;
    const likelyBlockers: string[] = [];
    const freeAreaRatio = safeBoxAreaPx > 0 ? totalFreeRegionAreaPx / safeBoxAreaPx : 0;
    const largestRegionRatio = safeBoxAreaPx > 0 ? rectArea(largestFreeRegion) / safeBoxAreaPx : 0;

    if (input.freeRegions.length === 0) {
        likelyBlockers.push('no_free_region');
    } else if (freeAreaRatio < 0.25) {
        likelyBlockers.push('template_obstacles_consume_safe_area');
    }
    if (input.freeRegions.length >= 8 && largestRegionRatio < 0.35) {
        likelyBlockers.push('free_regions_are_fragmented');
    }
    if (input.items.length >= 15 && largestRegionRatio < 0.45) {
        likelyBlockers.push('high_item_count_needs_larger_contiguous_area');
    }
    if (input.items.length >= 24 || (safeBoxAreaPx > 0 && totalItemAreaPx / safeBoxAreaPx > 8)) {
        likelyBlockers.push('high_item_count_needs_more_canvas_area');
    }
    if (input.constraints.minScalePercent >= 30) {
        likelyBlockers.push('min_scale_constraint_is_strict');
    }
    if (input.constraints.minSpacingPx >= 80) {
        likelyBlockers.push('min_spacing_constraint_is_strict');
    }

    return {
        itemCount: input.items.length,
        obstacleCount: input.obstacles.length,
        expandedObstacleCount,
        safeBox: input.safeBox,
        safeBoxAreaPx,
        freeRegionCount: input.freeRegions.length,
        largestFreeRegion,
        largestFreeRegionAreaPx: rectArea(largestFreeRegion),
        totalFreeRegionAreaPx,
        largestItemBounds,
        largestItemAreaPx,
        totalItemAreaPx,
        constraints: input.constraints,
        likelyBlockers
    };
}

function emptyPlan(
    status: SkuAutoLayoutStatus,
    safeBox: SkuAutoLayoutRect,
    blockers: string[],
    warnings: string[] = [],
    constraints: SkuAutoLayoutPlan['constraints'] = { minSpacingPx: 0, clearancePx: 0, minScalePercent: 0 },
    summary?: SkuAutoLayoutDiagnosticsSummary
): SkuAutoLayoutPlan {
    return {
        schema: 'sku-auto-layout-plan/v0',
        status,
        strategy: 'single-row',
        safeBox,
        selectedRegion: { ...ZERO_RECT },
        placements: [],
        diagnostics: {
            candidates: [],
            warnings,
            blockers,
            ...(summary ? { summary } : {})
        },
        constraints,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

export function buildSkuAutoLayoutPlan(input: SkuAutoLayoutPlanInput): SkuAutoLayoutPlan {
    const safeBox = getSafeBox(input);
    const warnings: string[] = [];
    const blockers: string[] = [];
    const preset = input.preset || 'sku-combo';
    const strategyRequest = input.strategy || 'auto';
    const items = Array.isArray(input.items) ? input.items : [];
    const canvasMinSide = Math.min(finite(input.canvas?.width, 1), finite(input.canvas?.height, 1));
    const minSpacingPx = Math.max(0, finite(input.minSpacingPx, getDefaultMinSpacingPx(canvasMinSide, preset)));
    const clearancePx = Math.max(0, finite(input.clearancePx, clamp(canvasMinSide * 0.02, 12, 40)));
    const minScalePercent = input.minScalePercent ?? (preset === 'sku-note' ? 16 : 18);
    const constraints = { minSpacingPx, clearancePx, minScalePercent };

    if (items.length === 0) {
        return emptyPlan('blocked', safeBox, ['没有可排版的 SKU 图层。'], [], constraints);
    }

    for (const item of items) {
        const bounds = getItemSourceBounds(item);
        if (!item?.id || bounds.width <= 0 || bounds.height <= 0) {
            blockers.push(`SKU 图层 "${item?.name || item?.id || 'unknown'}" 缺少有效边界。`);
        }
    }
    if (blockers.length > 0) return emptyPlan('blocked', safeBox, blockers, [], constraints);

    const obstacles = (input.obstacles || [])
        .map((obstacle) => ({
            ...obstacle,
            bounds: normalizeRect(obstacle.bounds)
        }))
        .filter((obstacle) => obstacle.bounds.width > 0 && obstacle.bounds.height > 0);
    const freeRegions = buildFreeRegions(safeBox, obstacles, clearancePx);
    const diagnosticsSummary = buildAutoLayoutDiagnosticsSummary({
        safeBox,
        freeRegions,
        obstacles,
        items,
        constraints
    });

    if (freeRegions.length === 0) {
        return emptyPlan(
            'blocked',
            safeBox,
            ['没有可用排版区域：安全区已被模板元素占用或画布过小。'],
            [],
            constraints,
            diagnosticsSummary
        );
    }

    const fillRatio = getPresetFillRatio(preset);
    const verticalAnchor = getPresetVerticalAnchor(preset);
    let results = buildCandidateResultsForFillRatio(
        freeRegions,
        safeBox,
        items,
        strategyRequest,
        verticalAnchor,
        fillRatio,
        minScalePercent,
        minSpacingPx
    );
    let usedCompactFallback = false;

    if (results.length === 0) {
        for (const compactFillRatio of getCompactFallbackFillRatios(fillRatio, preset)) {
            const compactResults = buildCandidateResultsForFillRatio(
                freeRegions,
                safeBox,
                items,
                strategyRequest,
                verticalAnchor,
                compactFillRatio,
                minScalePercent,
                minSpacingPx
            );
            if (compactResults.length > 0) {
                results = compactResults;
                usedCompactFallback = true;
                break;
            }
        }
    }

    const ranked = results.sort((a, b) => b.candidate.score - a.candidate.score);
    if (ranked.length === 0) {
        return emptyPlan(
            'blocked',
            safeBox,
            ['没有可用排版区域：当前安全区无法在不遮挡模板元素的情况下容纳全部 SKU。'],
            buildLayoutSearchFailureWarnings({
                freeRegions,
                obstacles,
                itemCount: items.length,
                constraints
            }),
            constraints,
            diagnosticsSummary
        );
    }

    const selected = ranked[0];
    if (obstacles.length > 0) {
        warnings.push('已根据模板中可见元素避让生成排版区域，仍需要导出图或人工复核确认视觉效果。');
    }
    if (usedCompactFallback) {
        warnings.push('普通留白排版无法容纳全部 SKU，已启用紧凑排版策略；仍保持最小间距和模板元素避让。');
    }
    if (selected.candidate.minScalePercent < minScalePercent + 4) {
        warnings.push('SKU 缩放接近最小可用阈值，建议复核导出图中袜子是否过小。');
    }

    return {
        schema: 'sku-auto-layout-plan/v0',
        status: 'ready',
        strategy: selected.candidate.strategy,
        safeBox,
        selectedRegion: selected.candidate.region,
        placements: selected.placements,
        diagnostics: {
            candidates: ranked.slice(0, 8).map((result) => result.candidate),
            warnings,
            blockers: [],
            summary: diagnosticsSummary
        },
        constraints,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

export function verifySkuAutoLayoutResult(input: SkuAutoLayoutQaInput): SkuAutoLayoutQaResult {
    const plan = input.plan;
    const blockers: string[] = [];
    const warnings: string[] = [];
    const tolerancePx = Math.max(0, finite(input.tolerancePx, 10));
    const minSpacingPx = Math.max(0, finite(input.minSpacingPx, plan?.constraints?.minSpacingPx || 0));
    const clearancePx = Math.max(0, finite(input.clearancePx, plan?.constraints?.clearancePx || minSpacingPx));
    const safeBox = normalizeRect(plan.safeBox);

    if (!plan || plan.schema !== 'sku-auto-layout-plan/v0') {
        pushUnique(blockers, '执行后校验失败：缺少有效的 SKU 自动排版计划。');
    } else if (plan.status !== 'ready') {
        pushUnique(blockers, `执行后校验失败：SKU 自动排版计划状态不是 ready（当前为 ${plan.status}）。`);
    }

    const actualByLayerId = new Map<number, SkuAutoLayoutActualPlacement>();
    const actualByItemId = new Map<string, SkuAutoLayoutActualPlacement>();
    for (const actual of Array.isArray(input.actualPlacements) ? input.actualPlacements : []) {
        if (actual?.layerId !== undefined) actualByLayerId.set(Number(actual.layerId), actual);
        if (actual?.itemId) actualByItemId.set(String(actual.itemId), actual);
    }

    const qaPlacements: SkuAutoLayoutQaPlacement[] = [];
    for (const placement of Array.isArray(plan?.placements) ? plan.placements : []) {
        const actual = placement.layerId !== undefined
            ? actualByLayerId.get(Number(placement.layerId)) || actualByItemId.get(placement.itemId)
            : actualByItemId.get(placement.itemId);
        const destinationBox = normalizeRect(placement.destinationBox);
        const actualBounds = actual?.actualBounds ? normalizeRect(actual.actualBounds) : null;

        if (!actualBounds || actualBounds.width <= 0 || actualBounds.height <= 0) {
            pushUnique(blockers, `SKU 图层 "${placement.name || placement.itemId}" 执行后缺少有效实际边界，不能导出。`);
            qaPlacements.push({
                itemId: placement.itemId,
                layerId: placement.layerId,
                name: placement.name,
                destinationBox,
                actualBounds: null,
                actualSubjectBounds: null,
                centerDeltaPx: null,
                maxOverflowPx: null
            });
            continue;
        }

        const actualSubjectBounds = actual?.actualSubjectBounds ? normalizeRect(actual.actualSubjectBounds) : actualBounds;
        const targetBounds = actualSubjectBounds.width > 0 && actualSubjectBounds.height > 0 ? actualSubjectBounds : actualBounds;
        const centerDeltaPx = getRectCenterDistance(destinationBox, targetBounds);
        const targetOverflowPx = rectOverflowPx(expandRect(destinationBox, tolerancePx), targetBounds);
        const safeOverflowPx = rectOverflowPx(expandRect(safeBox, tolerancePx), actualBounds);

        if (targetOverflowPx > 0 || centerDeltaPx > tolerancePx) {
            pushUnique(
                blockers,
                `SKU 图层 "${placement.name || placement.itemId}" 执行后实际边界偏离目标框，不能把计划框当作 Photoshop 执行结果。`
            );
        }

        if (safeOverflowPx > 0) {
            pushUnique(blockers, `SKU 图层 "${placement.name || placement.itemId}" 执行后超出安全区，不能导出。`);
        }

        qaPlacements.push({
            itemId: placement.itemId,
            layerId: placement.layerId,
            name: placement.name,
            destinationBox,
            actualBounds,
            actualSubjectBounds: targetBounds,
            centerDeltaPx,
            maxOverflowPx: Math.max(targetOverflowPx, safeOverflowPx)
        });
    }

    for (let i = 0; i < qaPlacements.length; i++) {
        const current = qaPlacements[i];
        if (!current.actualBounds) continue;

        for (let j = i + 1; j < qaPlacements.length; j++) {
            const next = qaPlacements[j];
            if (!next.actualBounds) continue;
            if (intersects(expandRect(current.actualBounds, minSpacingPx / 2), expandRect(next.actualBounds, minSpacingPx / 2))) {
                pushUnique(blockers, `SKU 图层 "${current.name}" 与 "${next.name}" 执行后互相重叠或间距不足。`);
            }
        }
    }

    const obstacles = (input.obstacles || [])
        .map((obstacle) => ({
            ...obstacle,
            bounds: normalizeRect(obstacle.bounds)
        }))
        .filter((obstacle) => obstacle.bounds.width > 0 && obstacle.bounds.height > 0);

    for (const placement of qaPlacements) {
        if (!placement.actualBounds) continue;
        for (const obstacle of obstacles) {
            if (intersects(placement.actualBounds, expandRect(obstacle.bounds, clearancePx))) {
                pushUnique(
                    blockers,
                    `SKU 图层 "${placement.name}" 执行后遮挡模板元素 "${obstacle.id || obstacle.role || 'unknown'}"。`
                );
            }
        }
    }

    if (qaPlacements.length !== (plan?.placements || []).length) {
        pushUnique(blockers, '执行后校验失败：实际回读数量与计划 placement 数量不一致。');
    }

    return {
        schema: 'sku-auto-layout-qa/v0',
        status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'needs_review' : 'ready',
        actualPlacements: qaPlacements,
        warnings,
        blockers,
        boundaries: {
            usesActualBounds: true,
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}
