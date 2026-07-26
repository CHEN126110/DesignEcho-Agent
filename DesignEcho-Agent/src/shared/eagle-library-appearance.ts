const DEFAULT_EAGLE_FOLDER_ICON_COLOR = '#cccdcf';

const EAGLE_FOLDER_ICON_COLORS: Record<string, string> = {
    purple: '#c499ff',
    blue: '#00aaff',
    pink: '#ff99cc',
    green: '#30d159',
    yellow: '#ffd60a',
    cyan: '#64d2ff',
    aqua: '#64d2ff',
    red: '#ff6961',
    orange: '#ff9f0a',
    brown: '#ac8e68',
    gray: DEFAULT_EAGLE_FOLDER_ICON_COLOR,
    grey: DEFAULT_EAGLE_FOLDER_ICON_COLOR,
    white: '#f4f5f6'
};

export function resolveEagleFolderIconColor(value?: string): string {
    const source = value?.trim();
    if (!source) return DEFAULT_EAGLE_FOLDER_ICON_COLOR;

    const semanticColor = EAGLE_FOLDER_ICON_COLORS[source.toLocaleLowerCase('en-US')];
    if (semanticColor) return semanticColor;

    if (/^#[0-9a-f]{3,8}$/i.test(source)) return source;
    if (/^(?:rgb|rgba|hsl|hsla)\(/i.test(source)) return source;
    return DEFAULT_EAGLE_FOLDER_ICON_COLOR;
}
