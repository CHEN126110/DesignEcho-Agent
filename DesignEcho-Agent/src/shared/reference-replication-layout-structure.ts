import type { MinimalDesignElement, MinimalDesignRepresentation } from './reference-replication';

export interface ReferenceTextLayoutNode {
    id: string;
    role: string;
    text?: string;
    box: {
        x: number;
        y: number;
        width: number;
        height: number;
        left: number;
        top: number;
        right: number;
        bottom: number;
        centerX: number;
        centerY: number;
    };
}

export interface ReferenceTextRowGroup {
    id: string;
    elementIds: string[];
    top: number;
    bottom: number;
    centerY: number;
    left: number;
    right: number;
}

export interface ReferenceTextColumnGroup {
    id: string;
    elementIds: string[];
    left: number;
    right: number;
    centerX: number;
    zone: 'left' | 'center' | 'right';
    textAlign: 'left' | 'center' | 'right';
}

export interface ReferenceTextRhythm {
    medianRowStep: number | null;
    rowStepVariation: number | null;
    rowSteps: number[];
}

export interface ReferenceLayoutStructure {
    canvas: { width: number; height: number };
    textNodes: ReferenceTextLayoutNode[];
    rowGroups: ReferenceTextRowGroup[];
    columnGroups: ReferenceTextColumnGroup[];
    rhythm: ReferenceTextRhythm;
    warnings: string[];
}

function finiteNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function round(value: number, digits = 2): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
}

function toTextNode(element: MinimalDesignElement, canvas: { width: number; height: number }): ReferenceTextLayoutNode | null {
    if (element.nodeKind !== 'text') return null;
    const x = finiteNumber(element.box?.x);
    const y = finiteNumber(element.box?.y);
    const width = finiteNumber(element.box?.width);
    const height = finiteNumber(element.box?.height);
    if (x === null || y === null || width === null || height === null) return null;
    const left = x * canvas.width;
    const top = y * canvas.height;
    const pixelWidth = width * canvas.width;
    const pixelHeight = height * canvas.height;
    const right = left + pixelWidth;
    const bottom = top + pixelHeight;
    return {
        id: element.id,
        role: element.role,
        text: element.content,
        box: {
            x: round(x, 4),
            y: round(y, 4),
            width: round(width, 4),
            height: round(height, 4),
            left: round(left),
            top: round(top),
            right: round(right),
            bottom: round(bottom),
            centerX: round((left + right) / 2),
            centerY: round((top + bottom) / 2)
        }
    };
}

function buildRows(nodes: ReferenceTextLayoutNode[]): ReferenceTextRowGroup[] {
    const sorted = [...nodes].sort((a, b) => a.box.centerY - b.box.centerY || a.box.left - b.box.left);
    const medianHeight = median(sorted.map((node) => node.box.bottom - node.box.top).filter((value) => value > 0)) || 12;
    const threshold = Math.max(4, medianHeight * 0.65);
    const rows: ReferenceTextLayoutNode[][] = [];

    for (const node of sorted) {
        const row = rows.find((items) => {
            const rowCenter = items.reduce((sum, item) => sum + item.box.centerY, 0) / items.length;
            return Math.abs(rowCenter - node.box.centerY) <= threshold;
        });
        if (row) {
            row.push(node);
            row.sort((a, b) => a.box.left - b.box.left);
        } else {
            rows.push([node]);
        }
    }

    return rows.map((items, index) => {
        const top = Math.min(...items.map((item) => item.box.top));
        const bottom = Math.max(...items.map((item) => item.box.bottom));
        const left = Math.min(...items.map((item) => item.box.left));
        const right = Math.max(...items.map((item) => item.box.right));
        return {
            id: `row_${index + 1}`,
            elementIds: items.map((item) => item.id),
            top: round(top),
            bottom: round(bottom),
            centerY: round((top + bottom) / 2),
            left: round(left),
            right: round(right)
        };
    });
}

function resolveColumnTextAlign(items: ReferenceTextLayoutNode[], canvasWidth: number): 'left' | 'center' | 'right' {
    if (items.length === 1) {
        const only = items[0];
        if (
            only.role === 'headline' &&
            Math.abs(only.box.centerX - canvasWidth / 2) <= Math.max(12, canvasWidth * 0.04)
        ) {
            return 'center';
        }
    }
    return 'left';
}

function buildColumns(nodes: ReferenceTextLayoutNode[], canvasWidth: number): ReferenceTextColumnGroup[] {
    const sorted = [...nodes].sort((a, b) => a.box.left - b.box.left || a.box.top - b.box.top);
    const medianWidth = median(sorted.map((node) => node.box.right - node.box.left).filter((value) => value > 0)) || 40;
    const threshold = Math.max(10, Math.min(48, medianWidth * 0.25));
    const columns: ReferenceTextLayoutNode[][] = [];

    for (const node of sorted) {
        const column = columns.find((items) => {
            const left = items.reduce((sum, item) => sum + item.box.left, 0) / items.length;
            return Math.abs(left - node.box.left) <= threshold;
        });
        if (column) {
            column.push(node);
            column.sort((a, b) => a.box.top - b.box.top);
        } else {
            columns.push([node]);
        }
    }

    return columns
        .map((items, index) => {
            const left = Math.min(...items.map((item) => item.box.left));
            const right = Math.max(...items.map((item) => item.box.right));
            let zone: ReferenceTextColumnGroup['zone'] = 'left';
            if (left >= canvasWidth * 0.55) {
                zone = 'right';
            } else if (left >= canvasWidth * 0.25) {
                zone = 'center';
            }
            const centerX = (left + right) / 2;
            return {
                id: `col_${index + 1}`,
                elementIds: items.map((item) => item.id),
                left: round(left),
                right: round(right),
                centerX: round(centerX),
                zone,
                textAlign: resolveColumnTextAlign(items, canvasWidth)
            };
        })
        .filter((column) => column.elementIds.length >= 1);
}

function buildRhythm(rows: ReferenceTextRowGroup[]): ReferenceTextRhythm {
    const rowSteps: number[] = [];
    for (let index = 1; index < rows.length; index++) {
        rowSteps.push(round(rows[index].centerY - rows[index - 1].centerY));
    }
    const medianRowStep = median(rowSteps);
    let rowStepVariation: number | null = null;
    if (medianRowStep !== null && rowSteps.length > 0) {
        const averageDelta = rowSteps.reduce((sum, value) => sum + Math.abs(value - medianRowStep), 0) / rowSteps.length;
        rowStepVariation = round(averageDelta);
    }
    return {
        medianRowStep: medianRowStep === null ? null : round(medianRowStep),
        rowStepVariation,
        rowSteps
    };
}

export function buildReferenceLayoutStructure(representation: MinimalDesignRepresentation): ReferenceLayoutStructure {
    const canvas = {
        width: Math.max(1, Number(representation.canvas?.width) || 1),
        height: Math.max(1, Number(representation.canvas?.height) || 1)
    };
    const textNodes = (representation.elements || [])
        .map((element) => toTextNode(element, canvas))
        .filter((node): node is ReferenceTextLayoutNode => !!node);
    const rowGroups = buildRows(textNodes);
    const columnGroups = buildColumns(textNodes, canvas.width);
    const rhythm = buildRhythm(rowGroups);
    const warnings: string[] = [];

    if (textNodes.length > 0 && rowGroups.length === 0) {
        warnings.push('text_nodes_without_rows');
    }
    if (textNodes.length >= 4 && columnGroups.length < 2) {
        warnings.push('text_columns_not_detected');
    }
    if (rhythm.rowStepVariation !== null && rhythm.medianRowStep !== null && rhythm.rowStepVariation > Math.max(6, rhythm.medianRowStep * 0.35)) {
        warnings.push('irregular_row_rhythm');
    }

    return {
        canvas,
        textNodes,
        rowGroups,
        columnGroups,
        rhythm,
        warnings
    };
}

export function buildCompactReferenceLayoutStructure(representation: MinimalDesignRepresentation): Record<string, any> {
    const structure = buildReferenceLayoutStructure(representation);
    return {
        textCount: structure.textNodes.length,
        rows: structure.rowGroups.map((row) => ({
            id: row.id,
            items: row.elementIds,
            y: row.centerY,
            left: row.left,
            right: row.right
        })),
        cols: structure.columnGroups.map((column) => ({
            id: column.id,
            items: column.elementIds,
            left: column.left,
            zone: column.zone,
            align: column.textAlign
        })),
        rhythm: {
            medianStep: structure.rhythm.medianRowStep,
            variation: structure.rhythm.rowStepVariation
        },
        warnings: structure.warnings
    };
}
