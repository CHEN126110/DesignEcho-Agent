export interface RgbColor {
    r: number;
    g: number;
    b: number;
}

export interface RenderLayoutStyle {
    pageBackgroundColorHex: string;
    isDarkBackground: boolean;
    pageTextColorHex: string;
    sellingPointBoxFillColorHex: string;
    sellingPointTextColorHex: string;
}

const DARK_PAGE_TEXT = '#FFFFFF';
const LIGHT_PAGE_TEXT = '#1A1A1A';
const LIGHT_SELLING_POINT_BOX = '#DBEAFE';
const DARK_SELLING_POINT_BOX = '#2563EB';
const DARK_SELLING_POINT_TEXT = '#FFFFFF';
const LIGHT_SELLING_POINT_TEXT_CANDIDATES = ['#0F172A', '#1E3A8A', '#111827'];

function clampChannel(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
}

export function normalizeHexColor(value: unknown, fallback = '#FFFFFF'): string {
    const text = String(value || '').trim();
    const match = text.match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return fallback;
    return `#${match[1].toUpperCase()}`;
}

export function parseHexColor(value: unknown): RgbColor | null {
    const hex = normalizeHexColor(value, '');
    if (!hex) return null;
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
}

function channelToLinear(value: number): number {
    const normalized = clampChannel(value) / 255;
    return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: unknown): number {
    const rgb = typeof color === 'string' ? parseHexColor(color) : color as RgbColor | null;
    if (!rgb) return 1;
    return channelToLinear(rgb.r) * 0.2126
        + channelToLinear(rgb.g) * 0.7152
        + channelToLinear(rgb.b) * 0.0722;
}

export function contrastRatio(backgroundHex: unknown, textHex: unknown): number {
    const a = relativeLuminance(backgroundHex);
    const b = relativeLuminance(textHex);
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
}

function pickReadableTextColor(backgroundHex: string, candidates: string[]): string {
    let best = candidates[0] || LIGHT_PAGE_TEXT;
    let bestContrast = -1;
    for (const candidate of candidates) {
        const ratio = contrastRatio(backgroundHex, candidate);
        if (ratio > bestContrast) {
            best = candidate;
            bestContrast = ratio;
        }
    }
    return best;
}

export function resolveRenderLayoutStyle(backgroundHex?: unknown): RenderLayoutStyle {
    const pageBackgroundColorHex = normalizeHexColor(backgroundHex, '#FFFFFF');
    const isDarkBackground = relativeLuminance(pageBackgroundColorHex) < 0.36;
    const sellingPointBoxFillColorHex = isDarkBackground ? DARK_SELLING_POINT_BOX : LIGHT_SELLING_POINT_BOX;
    return {
        pageBackgroundColorHex,
        isDarkBackground,
        pageTextColorHex: isDarkBackground ? DARK_PAGE_TEXT : LIGHT_PAGE_TEXT,
        sellingPointBoxFillColorHex,
        sellingPointTextColorHex: isDarkBackground
            ? DARK_SELLING_POINT_TEXT
            : pickReadableTextColor(sellingPointBoxFillColorHex, LIGHT_SELLING_POINT_TEXT_CANDIDATES)
    };
}
