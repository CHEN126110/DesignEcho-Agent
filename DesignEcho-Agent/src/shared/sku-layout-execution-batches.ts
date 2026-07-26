/**
 * SKU layout execution batching.
 *
 * Photoshop/UXP can keep working after the MCP request timeout when a single
 * skuLayout call carries too many rows. Keep each write call small and
 * auditable so the host has a chance to return progress before the desktop
 * bridge declares the request stuck.
 */

export type SkuLayoutBatchAction = 'execute' | 'arrangeDynamic';

export type SkuLayoutExecutionRow = {
    colorNames?: unknown;
    templateFileName?: string;
    rowIndex?: number;
    [key: string]: unknown;
};

export type SkuLayoutExecutionBatch = {
    schema: 'sku-layout-execution-batch/v0';
    action: SkuLayoutBatchAction;
    size: number;
    batchIndex: number;
    batchCount: number;
    rowStartIndex: number;
    rowEndIndex: number;
    rows: SkuLayoutExecutionRow[];
    combos: string[][];
};

function normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(1, Math.floor(parsed));
}

function normalizeCombo(value: unknown, rowIndex: number): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid SKU combo row ${rowIndex + 1}: colorNames must be an array of color names.`);
    }
    const combo = value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    if (combo.length === 0) {
        throw new Error(`Invalid SKU combo row ${rowIndex + 1}: colorNames is empty.`);
    }
    return combo;
}

export function buildSkuLayoutExecutionBatches(input: {
    action: SkuLayoutBatchAction;
    size: number;
    rows: SkuLayoutExecutionRow[];
    maxRowsPerToolCall?: number;
}): SkuLayoutExecutionBatch[] {
    const action = input.action;
    if (action !== 'execute' && action !== 'arrangeDynamic') {
        throw new Error(`Unsupported SKU layout batch action: ${String(action || '')}`);
    }
    const size = normalizePositiveInteger(input.size, 0);
    if (!size) throw new Error('SKU layout batch size must be a positive integer.');
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) return [];
    const maxRowsPerToolCall = normalizePositiveInteger(input.maxRowsPerToolCall, 1);
    const batchCount = Math.ceil(rows.length / maxRowsPerToolCall);
    const batches: SkuLayoutExecutionBatch[] = [];

    for (let start = 0; start < rows.length; start += maxRowsPerToolCall) {
        const end = Math.min(start + maxRowsPerToolCall, rows.length);
        const chunkRows = rows.slice(start, end);
        const combos = chunkRows.map((row, offset) => normalizeCombo(row?.colorNames, start + offset));
        batches.push({
            schema: 'sku-layout-execution-batch/v0',
            action,
            size,
            batchIndex: batches.length + 1,
            batchCount,
            rowStartIndex: start,
            rowEndIndex: end - 1,
            rows: chunkRows,
            combos
        });
    }

    return batches;
}

export function buildSkuLayoutComboBatches(input: {
    size: number;
    combos: string[][];
    maxRowsPerToolCall?: number;
}): SkuLayoutExecutionBatch[] {
    const rows = (Array.isArray(input.combos) ? input.combos : []).map((combo, index) => ({
        rowIndex: index,
        colorNames: combo
    }));
    return buildSkuLayoutExecutionBatches({
        action: 'execute',
        size: input.size,
        rows,
        maxRowsPerToolCall: input.maxRowsPerToolCall
    });
}
