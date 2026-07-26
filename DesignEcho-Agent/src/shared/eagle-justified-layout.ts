export interface EagleJustifiedLayoutItem {
    id: string;
    width?: number;
    height?: number;
}

export interface EagleJustifiedLayoutOptions {
    containerWidth: number;
    itemsPerRow: number;
    gap?: number;
    minimumRowHeight?: number;
    maximumRowHeight?: number;
}

export interface EagleJustifiedLayoutEntry<T extends EagleJustifiedLayoutItem> {
    item: T;
    width: number;
}

export interface EagleJustifiedLayoutRow<T extends EagleJustifiedLayoutItem> {
    height: number;
    complete: boolean;
    entries: Array<EagleJustifiedLayoutEntry<T>>;
}

const DEFAULT_ASPECT_RATIO = 4 / 3;

export function resolveEagleGalleryContentWidth(
    clientWidth: number,
    paddingLeft = 0,
    paddingRight = 0
): number {
    const boundedWidth = clampNumber(clientWidth, 0, 100_000, 280);
    const boundedLeftPadding = clampNumber(paddingLeft, 0, 1_000, 0);
    const boundedRightPadding = clampNumber(paddingRight, 0, 1_000, 0);
    return Math.max(280, Math.floor(boundedWidth - boundedLeftPadding - boundedRightPadding));
}

export function buildEagleJustifiedRows<T extends EagleJustifiedLayoutItem>(
    items: readonly T[],
    options: EagleJustifiedLayoutOptions
): Array<EagleJustifiedLayoutRow<T>> {
    const containerWidth = clampNumber(options.containerWidth, 1, 100_000, 1);
    const itemsPerRow = Math.round(clampNumber(options.itemsPerRow, 2, 8, 4));
    const gap = clampNumber(options.gap, 0, 64, 10);
    const minimumRowHeight = clampNumber(options.minimumRowHeight, 60, 600, 110);
    const maximumRowHeight = clampNumber(options.maximumRowHeight, minimumRowHeight, 1200, 520);
    const rows: Array<EagleJustifiedLayoutRow<T>> = [];
    let previousCompleteHeight: number | undefined;

    for (let index = 0; index < items.length; index += itemsPerRow) {
        const rowItems = items.slice(index, index + itemsPerRow);
        const complete = rowItems.length === itemsPerRow;
        const ratios = rowItems.map(resolveAspectRatio);
        const availableWidth = Math.max(0, containerWidth - gap * Math.max(0, rowItems.length - 1));
        const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio, 0);
        const fittedHeight = availableWidth / ratioTotal;
        let rowHeight = fittedHeight;

        if (!complete) {
            const fallbackHeight = previousCompleteHeight
                ?? containerWidth / Math.max(2, itemsPerRow * 0.82);
            rowHeight = Math.min(fittedHeight, fallbackHeight);
        }
        rowHeight = clampNumber(rowHeight, minimumRowHeight, maximumRowHeight, minimumRowHeight);

        let widths: number[];
        if (complete) {
            // Row-height limits keep extreme panoramas and portraits usable. Once a
            // limit is active, ratio * height no longer fills the row, so allocate
            // the available width proportionally and assign the remainder to the
            // final entry. Normal rows retain their exact source aspect ratios.
            widths = allocateProportionalWidths(ratios, availableWidth, ratioTotal);
        } else {
            // A minimum height must never make the ragged final row overflow. It is
            // preferable for this one row to become shorter than the configured
            // minimum while retaining asset ratios and left alignment.
            rowHeight = Math.min(rowHeight, fittedHeight);
            widths = ratios.map((ratio) => ratio * rowHeight);
        }
        if (complete) previousCompleteHeight = rowHeight;

        rows.push({
            height: rowHeight,
            complete,
            entries: rowItems.map((item, itemIndex) => ({ item, width: widths[itemIndex] }))
        });
    }
    return rows;
}

function allocateProportionalWidths(
    ratios: readonly number[],
    availableWidth: number,
    ratioTotal: number
): number[] {
    if (ratios.length === 0) return [];

    const widths: number[] = [];
    let remainingWidth = availableWidth;
    let remainingRatio = ratioTotal;
    for (let index = 0; index < ratios.length; index += 1) {
        const isLast = index === ratios.length - 1;
        const width = isLast
            ? remainingWidth
            : remainingWidth * (ratios[index] / remainingRatio);
        widths.push(width);
        remainingWidth -= width;
        remainingRatio -= ratios[index];
    }
    return widths;
}

function resolveAspectRatio(item: EagleJustifiedLayoutItem): number {
    const width = Number(item.width);
    const height = Number(item.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return DEFAULT_ASPECT_RATIO;
    }
    return clampNumber(width / height, 0.18, 4.5, DEFAULT_ASPECT_RATIO);
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, parsed));
}
