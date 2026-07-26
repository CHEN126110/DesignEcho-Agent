export function buildSkuComboMultisetIdentity<T>(
    combo: readonly T[],
    normalizeValue: (value: T) => string
): string {
    return combo
        .map(normalizeValue)
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .sort()
        .join('|');
}
