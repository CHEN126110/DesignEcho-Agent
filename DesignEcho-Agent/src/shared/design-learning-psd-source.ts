import type { PsdDesignSourceProfile } from './psd-design-source';
import type { DesignMemoryItem, DesignMemoryScope } from './design-memory-knowledge';

/**
 * PSD/PSB 设计源学习通道（设计学习管线的结构化补充源）。
 *
 * 与「看参考图提炼经验」的视觉链不同：设计源解析（analyzePsdDesignSource）离线读出
 * 字号档位、色板、版心边距、分屏节奏与分组习惯——这些本身就是结构化设计经验，
 * **不依赖视觉模型**。本模块把项目里的 PSD/PSB 收集为学习候选，并把解析出的
 * design-source-profile 转换为待复核的设计记忆候选（needs_review），
 * 与视觉学习共用同一个复核队列与批准门。
 *
 * 边界：学模式不学内容（profile 本身已按 patterns_not_content 提炼）；
 * 候选一律 needs_review，绝不绕过人工复核直接成为 active 记忆；不凑数——
 * 某一维度没有可靠数据时就不产出那条候选。
 */

export const DESIGN_LEARNING_PSD_SOURCE_VERSION = 'design-learning-psd-source/v0' as const;
export const DESIGN_LEARNING_PSD_SOURCE_LIMIT = 6;

interface FolderInfoLike {
    name?: string;
    path?: string;
    type?: string;
    images?: Array<{ name?: string; path?: string; ext?: string; type?: string; folderType?: string }>;
    children?: FolderInfoLike[];
}

export interface DesignLearningPsdSourceRecord {
    path: string;
    name: string;
    folderType: string;
}

/**
 * 从项目电商结构收集 PSD/PSB 设计源文件（视觉学习链刻意排除的那部分，在这里接住）。
 */
export function collectDesignLearningPsdSourcePaths(
    ecommerceStructure: { folders?: FolderInfoLike[] } | null | undefined,
    options: { limit?: number } = {}
): DesignLearningPsdSourceRecord[] {
    const limit = clampNumber(options.limit, 1, 20, DESIGN_LEARNING_PSD_SOURCE_LIMIT);
    const records: DesignLearningPsdSourceRecord[] = [];
    const seen = new Set<string>();

    const visit = (folder: FolderInfoLike | undefined): void => {
        if (!folder || records.length >= limit) return;
        for (const image of Array.isArray(folder.images) ? folder.images : []) {
            if (records.length >= limit) return;
            const filePath = String(image?.path || '').trim();
            if (!filePath || seen.has(filePath)) continue;
            const ext = extensionOf(image?.ext || filePath);
            if (ext !== '.psd' && ext !== '.psb') continue;
            seen.add(filePath);
            records.push({
                path: filePath,
                name: cleanText(image?.name) || baseNameOf(filePath),
                folderType: cleanText(image?.folderType || folder.type) || 'unknown'
            });
        }
        for (const child of Array.isArray(folder.children) ? folder.children : []) {
            visit(child);
        }
    };

    for (const folder of Array.isArray(ecommerceStructure?.folders) ? ecommerceStructure!.folders! : []) {
        visit(folder);
    }
    return records;
}

export interface PsdProfileToMemoryOptions {
    scope?: DesignMemoryScope;
    now?: string;
    /** 文件的业务角色提示（如 detail/sku/main），进标签帮助检索。 */
    folderType?: string;
}

/**
 * 把一份 design-source-profile 转换为待复核的设计记忆候选。
 * 每个可靠维度一条（版式字号 / 色板 / 结构分屏），没有数据的维度不凑数。
 */
export function psdDesignProfileToDesignMemoryItems(
    profile: PsdDesignSourceProfile,
    options: PsdProfileToMemoryOptions = {}
): DesignMemoryItem[] {
    if (!profile || profile.version !== 'psd-design-source-profile/v0') return [];
    const now = cleanText(options.now) || new Date().toISOString();
    const scope = options.scope || { type: 'user' as const };
    const sourceName = cleanText(profile.source?.fileName) || '设计源文件';
    const folderTag = cleanText(options.folderType);
    const canvas = profile.canvas;
    const items: DesignMemoryItem[] = [];

    const baseTags = uniqueStrings([
        'design-learning',
        'psd-design-source',
        folderTag,
        profile.source?.format || ''
    ]);

    // 候选 1：版式与字号规范（字号档位≥2 且有字体信息才产出）
    const fontLevels = Array.isArray(profile.typography?.fontSizeLevels)
        ? profile.typography.fontSizeLevels.filter((level) => Number.isFinite(level) && level > 0)
        : [];
    const fontFamilies = Array.isArray(profile.typography?.fontFamilies)
        ? profile.typography.fontFamilies.filter(Boolean)
        : [];
    if (fontLevels.length >= 2) {
        const metricParts = [
            `字号档位（大→小）：${fontLevels.map((level) => `${Math.round(level)}px`).join(' / ')}`,
            fontFamilies.length > 0 ? `常用字体：${fontFamilies.slice(0, 4).join('、')}` : '',
            Number.isFinite(profile.metrics?.leftEdgeClusterPx)
                ? `版心左边距约 ${Math.round(profile.metrics!.leftEdgeClusterPx!)}px`
                : '',
            Number.isFinite(profile.metrics?.safeMarginRatio)
                ? `安全边距比约 ${(profile.metrics!.safeMarginRatio! * 100).toFixed(0)}%`
                : ''
        ].filter(Boolean);
        items.push(buildItem({
            idSeed: `${sourceName}:typography`,
            title: `${sourceName} 的版式字号规范`,
            summary: `来自设计源 ${sourceName}（${canvas.width}×${canvas.height}）的真实排版度量。${metricParts.join('；')}。做同类设计时字号与边距有参照，不拍脑袋。`,
            scope,
            now,
            tags: [...baseTags, 'typography', ...fontFamilies.slice(0, 3)]
        }));
    }

    // 候选 2：文字色板（≥2 色才产出）
    const textColors = Array.isArray(profile.palette?.textColors)
        ? profile.palette.textColors.filter(Boolean)
        : [];
    if (textColors.length >= 2) {
        items.push(buildItem({
            idSeed: `${sourceName}:palette`,
            title: `${sourceName} 的文字色板`,
            summary: `设计源 ${sourceName} 实际使用的文字颜色：${textColors.slice(0, 8).join('、')}。同类设计可优先从这套色板取色，保持品牌一致性。`,
            scope,
            now,
            tags: [...baseTags, 'palette']
        }));
    }

    // 候选 3：结构与分屏习惯（有分屏推断或分组结构≥3 组才产出）
    const screenPattern = profile.structure?.screenPattern;
    const groupCount = Number(profile.structure?.groupCount) || 0;
    if (screenPattern?.screenCount || groupCount >= 3) {
        const structureParts = [
            screenPattern?.screenCount
                ? `分屏节奏：约 ${screenPattern.screenCount} 屏，平均每屏 ${Math.round(screenPattern.avgScreenHeightPx)}px${screenPattern.inference ? `（${screenPattern.inference}）` : ''}`
                : '',
            groupCount >= 3 ? `分组结构：${groupCount} 个分组、${profile.structure.textCount} 个文字层` : '',
            Number.isFinite(profile.structure?.namingHealth?.businessNamedRatio)
                ? `业务命名占比 ${(profile.structure.namingHealth.businessNamedRatio * 100).toFixed(0)}%`
                : ''
        ].filter(Boolean);
        items.push(buildItem({
            idSeed: `${sourceName}:structure`,
            title: `${sourceName} 的结构与分屏习惯`,
            summary: `设计源 ${sourceName} 的组织方式。${structureParts.join('；')}。搭建同类文档时按这个结构组织图层与分屏。`,
            scope,
            now,
            tags: [...baseTags, 'structure']
        }));
    }

    return items;
}

function buildItem(input: {
    idSeed: string;
    title: string;
    summary: string;
    scope: DesignMemoryScope;
    now: string;
    tags: string[];
}): DesignMemoryItem {
    return {
        id: `psd-source-${stableHash(input.idSeed)}`,
        kind: 'approved_recipe',
        scope: input.scope,
        status: 'needs_review',
        source: 'imported_case',
        title: cleanText(input.title).slice(0, 120),
        summary: cleanText(input.summary).slice(0, 600),
        tags: uniqueStrings(input.tags).slice(0, 12),
        appliesTo: ['recipe', 'rule'],
        allowedUses: ['prompt_context', 'user_reference', 'recipe_hint']
    } as DesignMemoryItem;
}

function extensionOf(value: unknown): string {
    const text = String(value || '').trim().toLowerCase();
    if (text.startsWith('.')) return text;
    const match = text.match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
}

function baseNameOf(filePath: string): string {
    const segments = filePath.replace(/\\/g, '/').split('/');
    return (segments[segments.length - 1] || filePath).replace(/\.[a-z0-9]+$/i, '');
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean)));
}

function cleanText(value: unknown): string {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
