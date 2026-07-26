const app = require('photoshop').app;

export type ResolvedFontInfo = {
    query: string;
    postScriptName: string;
    family?: string;
    name?: string;
    style?: string;
    matchType: 'postscript-exact' | 'name-exact' | 'family-exact';
};

export type FontSuggestion = {
    postScriptName: string;
    family?: string;
    name?: string;
    style?: string;
};

let installedFontCache: FontSuggestion[] | null = null;

export function normalizeFontToken(value: unknown): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_/]+/g, '')
        .replace(/[()（）]/g, '');
}

function getFontCollection(): any {
    try {
        return (app as any).fonts;
    } catch (error) {
        console.warn('[FontResolver] 读取系统字体列表失败:', error);
        return null;
    }
}

export function getInstalledFontCount(): number {
    const fonts = getFontCollection();
    return fonts && Number.isFinite(fonts.length) ? Number(fonts.length) : 0;
}

export function toFontSuggestion(font: any): FontSuggestion {
    try {
        return {
            postScriptName: String(font?.postScriptName || '').trim(),
            family: String(font?.family || '').trim() || undefined,
            name: String(font?.name || '').trim() || undefined,
            style: String(font?.style || '').trim() || undefined
        };
    } catch {
        return { postScriptName: '' };
    }
}

function readFontSuggestionAt(fonts: any, index: number): FontSuggestion | null {
    try {
        const font = fonts?.[index];
        if (!font) return null;
        const suggestion = toFontSuggestion(font);
        return suggestion.postScriptName ? suggestion : null;
    } catch {
        return null;
    }
}

export function listInstalledFonts(limit = 20): { fontCount: number; fonts: FontSuggestion[] } {
    const fonts = getFontCollection();
    const fontCount = fonts && Number.isFinite(fonts.length) ? Number(fonts.length) : 0;
    const max = Math.max(1, Math.min(200, Number(limit) || 20));
    const result: FontSuggestion[] = [];

    for (let index = 0; index < fontCount && result.length < max; index += 1) {
        const suggestion = readFontSuggestionAt(fonts, index);
        if (suggestion) result.push(suggestion);
    }

    return { fontCount, fonts: result };
}

export function getInstalledFonts(): FontSuggestion[] {
    if (installedFontCache) return installedFontCache;

    const fonts = getFontCollection();
    const fontCount = fonts && Number.isFinite(fonts.length) ? Number(fonts.length) : 0;
    const result: FontSuggestion[] = [];
    for (let index = 0; index < fontCount; index += 1) {
        const suggestion = readFontSuggestionAt(fonts, index);
        if (suggestion) result.push(suggestion);
    }
    installedFontCache = result;
    return result;
}

function rankFontStyle(style: string): number {
    const normalized = normalizeFontToken(style);
    if (!normalized) return 0;
    if (normalized.includes('regular') || normalized.includes('normal')) return 4;
    if (normalized.includes('medium')) return 3;
    if (normalized.includes('book')) return 2;
    if (normalized.includes('bold')) return 1;
    return 0;
}

function rankFontSuggestion(query: string, font: FontSuggestion): number {
    const normalizedQuery = normalizeFontToken(query);
    if (!normalizedQuery) return 0;

    const postScriptName = normalizeFontToken(font?.postScriptName);
    const family = normalizeFontToken(font?.family);
    const name = normalizeFontToken(font?.name);
    let score = 0;
    let matched = false;

    if (postScriptName.includes(normalizedQuery)) {
        score += 3;
        matched = true;
    }
    if (family.includes(normalizedQuery)) {
        score += 3;
        matched = true;
    }
    if (name.includes(normalizedQuery)) {
        score += 2;
        matched = true;
    }

    if (matched) score += rankFontStyle(String(font?.style || ''));
    return score;
}

export function buildFontSuggestions(query: string, fonts: FontSuggestion[]): FontSuggestion[] {
    const ranked = fonts
        .map((font) => ({ font, score: rankFontSuggestion(query, font) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

    return ranked.slice(0, 5).map((entry) => toFontSuggestion(entry.font));
}

export function resolveFont(query: string): { resolved: ResolvedFontInfo | null; suggestions: FontSuggestion[]; fontCount: number } {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
        return { resolved: null, suggestions: [], fontCount: 0 };
    }

    const fonts = getFontCollection();
    const fontCount = fonts && Number.isFinite(fonts.length) ? Number(fonts.length) : 0;
    if (!fontCount) {
        return { resolved: null, suggestions: [], fontCount: 0 };
    }

    const normalizedQuery = normalizeFontToken(trimmed);

    let exactName: FontSuggestion | null = null;
    let exactFamily: FontSuggestion | null = null;
    const rankedSuggestions: Array<{ font: FontSuggestion; score: number }> = [];

    for (let index = 0; index < fontCount; index += 1) {
        const font = readFontSuggestionAt(fonts, index);
        if (!font) continue;

        if (normalizeFontToken(font.postScriptName) === normalizedQuery) {
            return {
                resolved: {
                    query: trimmed,
                    postScriptName: font.postScriptName,
                    family: font.family,
                    name: font.name,
                    style: font.style,
                    matchType: 'postscript-exact'
                },
                suggestions: [],
                fontCount
            };
        }

        if (!exactName && normalizeFontToken(font.name) === normalizedQuery) {
            exactName = font;
        }

        if (normalizeFontToken(font.family) === normalizedQuery) {
            if (!exactFamily || rankFontStyle(String(font.style || '')) > rankFontStyle(String(exactFamily.style || ''))) {
                exactFamily = font;
            }
        }

        const suggestionScore = rankFontSuggestion(trimmed, font);
        if (suggestionScore > 0) {
            rankedSuggestions.push({ font, score: suggestionScore });
        }
    }

    if (exactName) {
        return {
            resolved: {
                query: trimmed,
                postScriptName: exactName.postScriptName,
                family: exactName.family,
                name: exactName.name,
                style: exactName.style,
                matchType: 'name-exact'
            },
            suggestions: [],
            fontCount
        };
    }

    if (exactFamily) {
        return {
            resolved: {
                query: trimmed,
                postScriptName: exactFamily.postScriptName,
                family: exactFamily.family,
                name: exactFamily.name,
                style: exactFamily.style,
                matchType: 'family-exact'
            },
            suggestions: [],
            fontCount
        };
    }

    const suggestions = rankedSuggestions
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((entry) => toFontSuggestion(entry.font));

    return { resolved: null, suggestions, fontCount };
}

export function fontMatchesResolvedFont(actualValue: string, resolvedFont: ResolvedFontInfo): boolean {
    const actual = normalizeFontToken(actualValue);
    if (!actual) return false;
    const candidates = [
        resolvedFont.postScriptName,
        resolvedFont.family,
        resolvedFont.name
    ]
        .filter(Boolean)
        .map((value) => normalizeFontToken(value));
    return candidates.some((candidate) => candidate === actual);
}
