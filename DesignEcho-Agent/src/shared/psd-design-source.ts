/**
 * 设计源档案提炼（PSD 知识库 P0 · Harness Knowledge 层）
 *
 * 把设计师 PSD/PSB 的解析树提炼成 design-source-profile：分组结构、文字样式表、
 * 字号档位、色板、版心边距、屏节奏——作为"照这个文件的规范做"的设计参照。
 * 实测依据（docs/psd-design-knowledge-feasibility.md）：88MB PSB 离线解析 42ms。
 *
 * 分层：本模块纯逻辑（不依赖 ag-psd/fs，smoke 可测）；ag-psd 读文件与树转换在
 * main 侧 psd-design-source-service。
 *
 * P0 边界（钉进代码，不是口头承诺）：
 * - B1 学模式不学内容：文字只留 ≤30 字样本（样本≤50 条），不读像素，不复制图片；
 * - B2 格式：只收 .psd/.psb；.tif 拒绝并指路（PS 打开后用 getLayerHierarchy）；
 * - B3 大小：≤500MB；
 * - B4 P0 不落盘：profile 只作为工具结果返回，学习写入是 P2（必须走 review gate）；
 * - B7 诚实降级：读不到的字段进 warnings，不臆造。
 */

export const PSD_DESIGN_SOURCE_MAX_BYTES = 500 * 1024 * 1024;
const TEXT_SAMPLE_MAX_CHARS = 30;
const TEXT_SAMPLE_MAX_COUNT = 50;
const GROUP_TREE_MAX_DEPTH = 4;
const GROUP_TREE_MAX_NODES = 80;
const FONT_SIZE_LEVEL_MAX = 8;
const PALETTE_MAX = 12;

/** main 侧从 ag-psd 树转换来的最简节点（shared 不依赖 ag-psd） */
export interface RawDesignSourceNode {
    name?: string;
    kind: 'group' | 'text' | 'shape' | 'pixel' | 'smartObject' | 'unknown';
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    text?: {
        content?: string;
        fontName?: string;
        fontSize?: number;
        colorHex?: string;
    };
    hasEffects?: boolean;
    children?: RawDesignSourceNode[];
}

export interface ProfileGroupNode {
    name: string;
    depth: number;
    childGroupCount: number;
    leafCounts: { text: number; image: number; shape: number };
    children?: ProfileGroupNode[];
}

export interface PsdDesignSourceProfile {
    version: 'psd-design-source-profile/v0';
    source: {
        fileName: string;
        format: 'psd' | 'psb';
        fileSizeBytes: number;
        parseMs: number;
    };
    canvas: { width: number; height: number };
    structure: {
        totalLayers: number;
        groupCount: number;
        textCount: number;
        shapeCount: number;
        pixelCount: number;
        smartObjectCount: number;
        groupTree: ProfileGroupNode[];
        groupTreeTruncated: boolean;
        namingHealth: {
            /** 业务命名占比 0..1（排除「图层 4」「形状 1 拷贝 2」类默认名） */
            businessNamedRatio: number;
            genericNameSamples: string[];
        };
        screenPattern?: {
            screenCount: number;
            avgScreenHeightPx: number;
            inference: string;
        };
    };
    typography: {
        samples: Array<{
            text: string;
            fontName?: string;
            fontSize?: number;
            colorHex?: string;
            widthPx: number;
            heightPx: number;
        }>;
        sampleTruncated: boolean;
        fontFamilies: string[];
        /** 聚类后的字号档位（大→小），每档为该档中位数 */
        fontSizeLevels: number[];
    };
    palette: {
        textColors: string[];
    };
    metrics: {
        /** 文字层左缘众数（版心左边距，样本≥3 才输出） */
        leftEdgeClusterPx?: number;
        safeMarginRatio?: number;
    };
    boundaries: {
        noPixelDataRead: true;
        contentPolicy: 'patterns_not_content';
        notPersisted: true;
    };
    warnings: string[];
}

export function validatePsdDesignSourceFile(input: {
    filePath: string;
    fileSizeBytes?: number;
}): { ok: true; format: 'psd' | 'psb' } | { ok: false; reason: string } {
    const filePath = String(input.filePath || '').trim();
    if (!filePath) {
        return { ok: false, reason: '缺少设计源文件路径：请提供 .psd 或 .psb 文件的完整路径。' };
    }
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tif') || lower.endsWith('.tiff')) {
        return {
            ok: false,
            reason: '分层 TIFF（.tif）不支持离线解析。请在 Photoshop 中打开该文件后用 getLayerHierarchy（includeBounds: true）读取结构，或将其另存为 PSD 后重试。'
        };
    }
    if (!lower.endsWith('.psd') && !lower.endsWith('.psb')) {
        return { ok: false, reason: `不支持的文件格式：${filePath.split(/[\\/]/).pop()}。只支持 .psd / .psb 设计源文件。` };
    }
    const size = Number(input.fileSizeBytes);
    if (Number.isFinite(size) && size > PSD_DESIGN_SOURCE_MAX_BYTES) {
        return {
            ok: false,
            reason: `文件超出解析上限（${Math.round(size / 1024 / 1024)}MB > 500MB）。请提供较小的设计源文件，或在 Photoshop 中打开后用 getLayerHierarchy 读取结构。`
        };
    }
    return { ok: true, format: lower.endsWith('.psb') ? 'psb' : 'psd' };
}

const GENERIC_NAME_PATTERN = /^(图层|形状|组|矩形|椭圆|色板|group|grouped|layer|shape|rectangle|ellipse|copy)[\s_-]*\d*(\s*(拷贝|copy)\s*\d*)?$/i;

function isGenericLayerName(name: string): boolean {
    const text = String(name || '').trim();
    if (!text) return true;
    if (GENERIC_NAME_PATTERN.test(text)) return true;
    return /(拷贝|copy)\s*\d*$/i.test(text) && text.length <= 14;
}

/** 纯数字/字母+数字 的短名（如「15」「14」「A1」）——常见屏号命名，属于业务结构名 */
function isScreenIndexLikeName(name: string): boolean {
    return /^[A-Za-z]?\d{1,3}$/.test(String(name || '').trim());
}

function normalizeHex(value: unknown): string | undefined {
    const text = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(text) ? text : undefined;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

interface WalkStats {
    total: number;
    group: number;
    text: number;
    shape: number;
    pixel: number;
    smartObject: number;
    genericNamed: number;
    named: number;
    genericSamples: string[];
    textSamples: PsdDesignSourceProfile['typography']['samples'];
    textSampleOverflow: boolean;
    fontSizes: number[];
    fontFamilies: Set<string>;
    textColors: Set<string>;
    textMissingColor: number;
    textLeftEdges: number[];
    zeroBoundsShapes: number;
}

function walkTree(nodes: RawDesignSourceNode[] | undefined, stats: WalkStats): void {
    for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!node) continue;
        stats.total += 1;
        const name = String(node.name || '').trim();
        if (node.kind !== 'group') {
            stats.named += 1;
            if (isGenericLayerName(name)) {
                stats.genericNamed += 1;
                if (stats.genericSamples.length < 6 && name) stats.genericSamples.push(name);
            }
        }
        switch (node.kind) {
            case 'group':
                stats.group += 1;
                break;
            case 'text': {
                stats.text += 1;
                const width = Math.max(0, (Number(node.right) || 0) - (Number(node.left) || 0));
                const height = Math.max(0, (Number(node.bottom) || 0) - (Number(node.top) || 0));
                const fontSize = Number(node.text?.fontSize);
                const colorHex = normalizeHex(node.text?.colorHex);
                if (Number.isFinite(fontSize) && fontSize > 0) stats.fontSizes.push(round1(fontSize));
                if (node.text?.fontName) stats.fontFamilies.add(String(node.text.fontName));
                if (colorHex) stats.textColors.add(colorHex);
                else stats.textMissingColor += 1;
                if (Number.isFinite(Number(node.left))) stats.textLeftEdges.push(Math.round(Number(node.left)));
                if (stats.textSamples.length < TEXT_SAMPLE_MAX_COUNT) {
                    stats.textSamples.push({
                        text: String(node.text?.content || '').replace(/[\r\n]+/g, ' ').trim().slice(0, TEXT_SAMPLE_MAX_CHARS),
                        fontName: node.text?.fontName ? String(node.text.fontName) : undefined,
                        fontSize: Number.isFinite(fontSize) && fontSize > 0 ? round1(fontSize) : undefined,
                        colorHex,
                        widthPx: Math.round(width),
                        heightPx: Math.round(height)
                    });
                } else {
                    stats.textSampleOverflow = true;
                }
                break;
            }
            case 'shape': {
                stats.shape += 1;
                const w = (Number(node.right) || 0) - (Number(node.left) || 0);
                const h = (Number(node.bottom) || 0) - (Number(node.top) || 0);
                if (w <= 0 || h <= 0) stats.zeroBoundsShapes += 1;
                break;
            }
            case 'smartObject':
                stats.smartObject += 1;
                break;
            default:
                stats.pixel += 1;
        }
        if (node.kind === 'group') {
            walkTree(node.children, stats);
        }
    }
}

function buildGroupTree(
    nodes: RawDesignSourceNode[] | undefined,
    depth: number,
    budget: { remaining: number; truncated: boolean }
): ProfileGroupNode[] {
    const out: ProfileGroupNode[] = [];
    for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!node || node.kind !== 'group') continue;
        if (budget.remaining <= 0) {
            budget.truncated = true;
            break;
        }
        budget.remaining -= 1;
        const children = Array.isArray(node.children) ? node.children : [];
        const leafCounts = { text: 0, image: 0, shape: 0 };
        let childGroupCount = 0;
        for (const child of children) {
            if (!child) continue;
            if (child.kind === 'group') childGroupCount += 1;
            else if (child.kind === 'text') leafCounts.text += 1;
            else if (child.kind === 'shape') leafCounts.shape += 1;
            else leafCounts.image += 1;
        }
        const profileNode: ProfileGroupNode = {
            name: String(node.name || '').trim() || '(未命名组)',
            depth,
            childGroupCount,
            leafCounts
        };
        if (depth < GROUP_TREE_MAX_DEPTH) {
            const subGroups = buildGroupTree(children, depth + 1, budget);
            if (subGroups.length > 0) profileNode.children = subGroups;
        } else if (childGroupCount > 0) {
            budget.truncated = true;
        }
        out.push(profileNode);
    }
    return out;
}

/** 字号聚类：排序后相邻差 > max(2, 较小值的 18%) 分档，每档取中位数，大→小 */
export function clusterFontSizeLevels(fontSizes: number[]): number[] {
    const sorted = fontSizes.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return [];
    const clusters: number[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (curr - prev > Math.max(2, prev * 0.18)) clusters.push([curr]);
        else clusters[clusters.length - 1].push(curr);
    }
    const levels = clusters.map((cluster) => cluster[Math.floor(cluster.length / 2)]);
    return levels.reverse().slice(0, FONT_SIZE_LEVEL_MAX).map(round1);
}

/** 左缘众数聚类（±4px 桶），样本 ≥3 且众数桶占比 ≥40% 才输出 */
export function clusterLeftEdge(leftEdges: number[]): number | undefined {
    const values = leftEdges.filter((v) => Number.isFinite(v));
    if (values.length < 3) return undefined;
    const buckets = new Map<number, number[]>();
    for (const value of values) {
        const key = Math.round(value / 8) * 8;
        const bucket = buckets.get(key) || [];
        bucket.push(value);
        buckets.set(key, bucket);
    }
    let best: number[] = [];
    for (const bucket of buckets.values()) {
        if (bucket.length > best.length) best = bucket;
    }
    if (best.length < Math.max(3, values.length * 0.4)) return undefined;
    return Math.round(best.reduce((sum, v) => sum + v, 0) / best.length);
}

function inferScreenPattern(
    tree: RawDesignSourceNode[] | undefined,
    canvasHeight: number
): PsdDesignSourceProfile['structure']['screenPattern'] | undefined {
    // 找任一组下「屏号式命名」（纯数字/字母+数字）的同级子组集合，≥3 个即视为分屏结构
    const queue: RawDesignSourceNode[][] = [Array.isArray(tree) ? tree : []];
    while (queue.length > 0) {
        const level = queue.shift() as RawDesignSourceNode[];
        const groups = level.filter((n) => n && n.kind === 'group');
        const screenLike = groups.filter((n) => isScreenIndexLikeName(String(n.name || '')));
        if (screenLike.length >= 3) {
            return {
                screenCount: screenLike.length,
                avgScreenHeightPx: Math.round(canvasHeight / screenLike.length),
                inference: `按屏号式命名的同级组推断（${screenLike.map((n) => String(n.name).trim()).slice(0, 6).join('/')}…）；屏高为画布高度均分粗估。`
            };
        }
        for (const group of groups) {
            if (Array.isArray(group.children)) queue.push(group.children);
        }
    }
    return undefined;
}

export function buildPsdDesignSourceProfile(input: {
    fileName: string;
    format: 'psd' | 'psb';
    fileSizeBytes: number;
    parseMs: number;
    canvas: { width: number; height: number };
    tree: RawDesignSourceNode[];
}): PsdDesignSourceProfile {
    const warnings: string[] = [];
    const stats: WalkStats = {
        total: 0, group: 0, text: 0, shape: 0, pixel: 0, smartObject: 0,
        genericNamed: 0, named: 0, genericSamples: [],
        textSamples: [], textSampleOverflow: false,
        fontSizes: [], fontFamilies: new Set(), textColors: new Set(),
        textMissingColor: 0, textLeftEdges: [], zeroBoundsShapes: 0
    };
    walkTree(input.tree, stats);

    const budget = { remaining: GROUP_TREE_MAX_NODES, truncated: false };
    const groupTree = buildGroupTree(input.tree, 0, budget);

    if (stats.text > 0 && stats.textMissingColor / stats.text > 0.5) {
        warnings.push(`约 ${Math.round((stats.textMissingColor / stats.text) * 100)}% 的文字层颜色未读取到（样式可能位于分段 styleRuns 中），色板不完整。`);
    }
    if (stats.zeroBoundsShapes > 0) {
        warnings.push(`${stats.zeroBoundsShapes} 个形状层边界为空（矢量实体边界需在 Photoshop 中读取），已跳过其几何统计。`);
    }
    if (stats.textSampleOverflow) {
        warnings.push(`文字层超过 ${TEXT_SAMPLE_MAX_COUNT} 条采样上限，仅保留前 ${TEXT_SAMPLE_MAX_COUNT} 条样本（字号/色板统计仍覆盖全部文字层）。`);
    }
    if (budget.truncated) {
        warnings.push(`分组树超过展示预算（${GROUP_TREE_MAX_NODES} 组 / ${GROUP_TREE_MAX_DEPTH} 层），已截断展示；计数统计不受影响。`);
    }

    const leftEdgeClusterPx = clusterLeftEdge(stats.textLeftEdges);
    const namedTotal = Math.max(1, stats.named);

    return {
        version: 'psd-design-source-profile/v0',
        source: {
            fileName: input.fileName,
            format: input.format,
            fileSizeBytes: input.fileSizeBytes,
            parseMs: input.parseMs
        },
        canvas: { ...input.canvas },
        structure: {
            totalLayers: stats.total,
            groupCount: stats.group,
            textCount: stats.text,
            shapeCount: stats.shape,
            pixelCount: stats.pixel,
            smartObjectCount: stats.smartObject,
            groupTree,
            groupTreeTruncated: budget.truncated,
            namingHealth: {
                businessNamedRatio: Math.round(((namedTotal - stats.genericNamed) / namedTotal) * 100) / 100,
                genericNameSamples: stats.genericSamples
            },
            screenPattern: inferScreenPattern(input.tree, input.canvas.height)
        },
        typography: {
            samples: stats.textSamples,
            sampleTruncated: stats.textSampleOverflow,
            fontFamilies: Array.from(stats.fontFamilies).slice(0, 10),
            fontSizeLevels: clusterFontSizeLevels(stats.fontSizes)
        },
        palette: {
            textColors: Array.from(stats.textColors).slice(0, PALETTE_MAX)
        },
        metrics: {
            leftEdgeClusterPx,
            safeMarginRatio: leftEdgeClusterPx !== undefined && input.canvas.width > 0
                ? Math.round((leftEdgeClusterPx / input.canvas.width) * 1000) / 1000
                : undefined
        },
        boundaries: {
            noPixelDataRead: true,
            contentPolicy: 'patterns_not_content',
            notPersisted: true
        },
        warnings
    };
}
