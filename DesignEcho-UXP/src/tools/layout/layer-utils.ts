/**
 * Shared layer utility functions for detail-page tools.
 *
 * Extracts common helpers (toNumber, getBounds, layer type checks)
 * to avoid duplication across parser, filler, detector, etc.
 */

export interface BoundingBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * Safely extract a number from UXP descriptor values.
 * Handles plain numbers, {value: n}, {_value: n}, and string coercion.
 */
export function toNumber(v: any): number {
    if (typeof v === 'number') return v;
    if (typeof v?.value === 'number') return v.value;
    if (typeof v?._value === 'number') return v._value;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Extract a normalised BoundingBox from a layer (handles all UXP descriptor shapes).
 */
export function getBounds(layer: any): BoundingBox {
    const b = layer?.bounds || {};
    const left = toNumber(b.left);
    const top = toNumber(b.top);
    const right = toNumber(b.right);
    const bottom = toNumber(b.bottom);
    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
}

export function normalizeKind(kind: any): string {
    return String(kind || '').toLowerCase();
}

export function isGroup(layer: any): boolean {
    const kind = normalizeKind(layer?.kind);
    return kind.includes('group') || Array.isArray(layer?.layers);
}

export function isTextLayer(layer: any): boolean {
    return normalizeKind(layer?.kind).includes('text');
}

export function isVectorLike(layer: any): boolean {
    const kind = normalizeKind(layer?.kind);
    return kind.includes('vector') || kind.includes('shape');
}

export function isImageLike(layer: any): boolean {
    const kind = normalizeKind(layer?.kind);
    return kind.includes('pixel') || kind.includes('smart') || kind.includes('normal') || kind.includes('layer');
}
