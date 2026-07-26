/**
 * 只读字体解析工具
 */

import { Tool, ToolSchema } from '../types';
import { listInstalledFonts, resolveFont, toFontSuggestion } from './font-resolver';

export class ResolveFontNameTool implements Tool {
    name = 'resolveFontName';

    schema: ToolSchema = {
        name: 'resolveFontName',
        description: '只读解析 Photoshop 字体名称。只有 PostScript/name/family 精确匹配才返回可写入 resolvedFont；模糊命中只返回 fontSuggestions，不修改文档。',
        parameters: {
            type: 'object',
            properties: {
                fontName: {
                    type: 'string',
                    description: '用户输入的字体名称、字体族、显示名或 PostScript 名。'
                },
                limit: {
                    type: 'number',
                    description: '未提供 fontName 时返回的字体列表数量上限，默认 20。'
                }
            }
        }
    };

    async execute(params: { fontName?: string; limit?: number }): Promise<{
        success: boolean;
        query?: string;
        fontCount: number;
        resolvedFont?: ReturnType<typeof resolveFont>['resolved'];
        fontSuggestions?: ReturnType<typeof resolveFont>['suggestions'];
        fonts?: ReturnType<typeof toFontSuggestion>[];
        error?: string;
    }> {
        const query = String(params.fontName || '').trim();
        const limit = Number.isFinite(params.limit) ? Math.max(1, Math.min(200, Number(params.limit))) : 20;

        if (!query) {
            const result = listInstalledFonts(limit);
            return {
                success: true,
                fontCount: result.fontCount,
                fonts: result.fonts.map((font) => toFontSuggestion(font))
            };
        }

        const result = resolveFont(query);
        if (!result.resolved) {
            return {
                success: false,
                query,
                fontCount: result.fontCount,
                fontSuggestions: result.suggestions,
                error: `未找到可用字体：${query}`
            };
        }

        return {
            success: true,
            query,
            fontCount: result.fontCount,
            resolvedFont: result.resolved,
            fontSuggestions: result.suggestions
        };
    }
}
