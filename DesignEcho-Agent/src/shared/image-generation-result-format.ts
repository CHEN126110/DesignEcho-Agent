export type ImageGenerationResultFormat = 'png' | 'jpeg' | 'gif' | 'webp';

export function normalizeImageGenerationResultFormat(
    value: string | null | undefined
): ImageGenerationResultFormat | null {
    const normalized = String(value || '').replace(/^image\//, '').replace(/^\./, '').trim().toLowerCase();
    if (normalized === 'jpg' || normalized === 'jpeg') {
        return 'jpeg';
    }
    if (normalized === 'png' || normalized === 'gif' || normalized === 'webp') {
        return normalized;
    }
    return null;
}
