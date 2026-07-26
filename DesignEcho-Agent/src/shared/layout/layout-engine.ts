/**
 * 多模块版面布局引擎（纯函数，无 API、无 Photoshop 依赖）
 *
 * 解决"手"的核心缺口：把声明式版式规格（每个模块的角色/占比/对齐）求解成精确坐标，
 * 替代"模型逐个手填坐标"——后者靠空间想象，必然重叠/溢出/不对齐。
 *
 * 设计原则：
 * - 声明式：调用方（模型）只描述"放什么、各占多少、怎么对齐"，不算坐标。
 * - 确定性：同样的规格永远得到同样的、对齐网格、不溢出画布的布局。
 * - 垂直分区为主：电商主图/详情页屏的主体结构是自上而下的区块堆叠（标题→主图→卖点）。
 *
 * 这是 A 路线"手"的地基；smart-layout-service 负责单个主体图的精确缩放定位，二者互补。
 */

export type BlockRole =
    | 'background'
    | 'main-image'
    | 'title'
    | 'subtitle'
    | 'selling-point'
    | 'tag'
    | 'decoration';

export type HAlign = 'left' | 'center' | 'right';

export interface LayoutBlock {
    id: string;
    role: BlockRole;
    /** 文案内容或素材标识（引擎不关心其含义，原样透传给渲染层） */
    content?: string;
    /** 占可用高度的比例(0-1)。背景固定满画布；不填时按 role 给默认值 */
    heightRatio?: number;
    /** 占可用宽度的比例(0-1)，默认 1（占满安全区宽度） */
    widthRatio?: number;
    /** 水平对齐，默认 center */
    hAlign?: HAlign;
    // 刻意不暴露图层层级(z)。图层前后顺序是确定性的设计规则(背景在底、文字压在图上、
    // 装饰最顶)，由 role 直接决定，不交给模型——从根上杜绝"图层顺序写错"，
    // 而不是"让模型写、引擎再纠正"。模型只描述放什么、占多少，不碰顺序。
}

export interface LayoutSpec {
    canvas: { width: number; height: number };
    /** 画布安全边距(px)，默认按画布短边的 5% */
    margin?: number;
    /** 相邻模块的垂直间距(px)，默认按画布短边的 3% */
    gap?: number;
    /** 按视觉从上到下的顺序排列（background 可放任意位置，会被单独满铺） */
    blocks: LayoutBlock[];
}

export interface ResolvedBlock {
    id: string;
    role: BlockRole;
    content?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
}

export interface LayoutResult {
    blocks: ResolvedBlock[];
    warnings: string[];
}

const DEFAULT_HEIGHT_RATIO: Record<BlockRole, number> = {
    background: 1,
    'main-image': 0.55,
    title: 0.12,
    subtitle: 0.08,
    'selling-point': 0.1,
    tag: 0.06,
    decoration: 0.06
};

// 图层前后顺序 = 确定性的设计规则，由 role 直接决定，模型不参与：
// 背景垫底 → 主图 → 文字(压在图上) → 标签/装饰(最顶)。
const ROLE_Z: Record<BlockRole, number> = {
    background: 0,
    'main-image': 10,
    subtitle: 18,
    title: 20,
    'selling-point': 22,
    tag: 28,
    decoration: 30
};

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}

/**
 * 求解版面布局：背景满画布；其余模块在安全区内自上而下按高度比例垂直堆叠、按对齐方式水平摆放。
 * 保证：所有模块不超出画布；垂直方向按 gap 间隔不重叠；比例之和超界时整体压缩并给出 warning。
 */
export function solveLayout(spec: LayoutSpec): LayoutResult {
    const warnings: string[] = [];
    const { width: cw, height: ch } = spec.canvas;
    if (!(cw > 0 && ch > 0)) {
        return { blocks: [], warnings: ['画布尺寸无效'] };
    }

    const shortSide = Math.min(cw, ch);
    const margin = spec.margin ?? Math.round(shortSide * 0.05);
    const gap = spec.gap ?? Math.round(shortSide * 0.03);

    const innerX = margin;
    const innerW = Math.max(0, cw - margin * 2);
    const innerY = margin;
    const innerH = Math.max(0, ch - margin * 2);

    const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
    const backgrounds = blocks.filter((b) => b.role === 'background');
    const flow = blocks.filter((b) => b.role !== 'background');

    const resolved: ResolvedBlock[] = [];

    // 背景：满画布，z 垫底
    for (const bg of backgrounds) {
        resolved.push({
            id: bg.id, role: bg.role, content: bg.content,
            x: 0, y: 0, width: cw, height: ch,
            z: ROLE_Z.background
        });
    }

    // 流式模块：垂直堆叠
    const n = flow.length;
    if (n > 0) {
        const totalGap = gap * (n - 1);
        const availH = Math.max(0, innerH - totalGap);

        // 取各模块高度比例（缺省按 role），归一化到可用高度
        const ratios = flow.map((b) => clamp01(b.heightRatio ?? DEFAULT_HEIGHT_RATIO[b.role] ?? 0.1));
        const ratioSum = ratios.reduce((s, r) => s + r, 0) || 1;
        let scale = 1;
        if (ratioSum > 1) {
            scale = 1 / ratioSum;
            warnings.push(`模块高度比例之和 ${ratioSum.toFixed(2)} 超过 1，已整体压缩以适配画布。`);
        }

        let cursorY = innerY;
        flow.forEach((b, i) => {
            const h = Math.round(availH * ratios[i] * scale);
            const wRatio = clamp01(b.widthRatio ?? 1);
            const w = Math.round(innerW * wRatio);
            const hAlign: HAlign = b.hAlign ?? 'center';
            let x = innerX;
            if (hAlign === 'center') x = innerX + Math.round((innerW - w) / 2);
            else if (hAlign === 'right') x = innerX + (innerW - w);

            resolved.push({
                id: b.id, role: b.role, content: b.content,
                x, y: cursorY, width: w, height: h,
                z: ROLE_Z[b.role]
            });
            cursorY += h + gap;
        });

        const usedBottom = cursorY - gap;
        if (usedBottom > innerY + innerH + 1) {
            warnings.push('模块总高超出安全区，存在溢出风险（请减少模块或调小比例）。');
        }
    }

    // 最终边界检查：任何模块越出画布都记 warning（理论上不应发生，作为安全网）
    for (const r of resolved) {
        if (r.x < 0 || r.y < 0 || r.x + r.width > cw + 1 || r.y + r.height > ch + 1) {
            warnings.push(`模块 ${r.id}(${r.role}) 越出画布边界。`);
        }
    }

    resolved.sort((a, b) => a.z - b.z);
    return { blocks: resolved, warnings };
}

// ── 二维区域模式（渲染桥）──
// solveLayout 只会垂直堆叠，做不了左右分栏/图文叠压/杂志式构图；v5 契约（LayoutRegion）
// 用归一化 0..1 区域描述版面。本模式接受同一套渲染角色 + 归一化 bounds，换算像素并保持
// 两条不变量：坐标由引擎换算（调用方不给像素）、图层顺序由 role 决定（调用方不排 z）。

export interface NormalizedRegionBlock {
    id: string;
    role: BlockRole;
    /** 同 LayoutBlock.content：文案或素材路径，引擎原样透传 */
    content?: string;
    /** 归一化边界 0..1（相对画布），x/y 为左上角 */
    bounds: { x: number; y: number; width: number; height: number };
}

export interface RegionLayoutSpec {
    canvas: { width: number; height: number };
    regions: NormalizedRegionBlock[];
}

const TEXT_ROLES: ReadonlySet<BlockRole> = new Set(['title', 'subtitle', 'selling-point', 'tag']);
const MIN_REGION_PX = 24;

function rectsOverlap(a: ResolvedBlock, b: ResolvedBlock): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 求解二维区域布局：背景满画布；其余区域按归一化 bounds 换算像素并夹回画布内。
 * 图文叠压是二维模式的正当用法，不告警；文字区域彼此重叠几乎必是错误，逐对告警。
 */
export function solveRegionLayout(spec: RegionLayoutSpec): LayoutResult {
    const warnings: string[] = [];
    const { width: cw, height: ch } = spec.canvas;
    if (!(cw > 0 && ch > 0)) {
        return { blocks: [], warnings: ['画布尺寸无效'] };
    }

    const regions = Array.isArray(spec.regions) ? spec.regions : [];
    const resolved: ResolvedBlock[] = [];

    for (const region of regions) {
        if (region.role === 'background') {
            resolved.push({
                id: region.id, role: region.role, content: region.content,
                x: 0, y: 0, width: cw, height: ch,
                z: ROLE_Z.background
            });
            continue;
        }
        const raw = region.bounds || { x: 0, y: 0, width: 0, height: 0 };
        const nx = clamp01(raw.x);
        const ny = clamp01(raw.y);
        const nw = clamp01(raw.width);
        const nh = clamp01(raw.height);
        let clamped = nx !== raw.x || ny !== raw.y || nw !== raw.width || nh !== raw.height;
        let fitW = nw;
        let fitH = nh;
        if (nx + nw > 1) { fitW = 1 - nx; clamped = true; }
        if (ny + nh > 1) { fitH = 1 - ny; clamped = true; }
        if (clamped) {
            warnings.push(`区域 ${region.id}(${region.role}) 的归一化 bounds 超出 0..1 范围，已夹回画布内。`);
        }
        const width = Math.round(cw * fitW);
        const height = Math.round(ch * fitH);
        if (width < MIN_REGION_PX || height < MIN_REGION_PX) {
            warnings.push(`区域 ${region.id}(${region.role}) 换算后过小（${width}x${height}px），内容可能不可读。`);
        }
        resolved.push({
            id: region.id, role: region.role, content: region.content,
            x: Math.round(cw * nx), y: Math.round(ch * ny), width, height,
            z: ROLE_Z[region.role]
        });
    }

    // 文字区域两两重叠告警（图 x 文重叠是二维模式的正当用法，不告警）
    const textBlocks = resolved.filter((r) => TEXT_ROLES.has(r.role));
    for (let i = 0; i < textBlocks.length; i++) {
        for (let j = i + 1; j < textBlocks.length; j++) {
            if (rectsOverlap(textBlocks[i], textBlocks[j])) {
                warnings.push(`文字区域 ${textBlocks[i].id} 与 ${textBlocks[j].id} 重叠，文案会互相压盖。`);
            }
        }
    }

    resolved.sort((a, b) => a.z - b.z);
    return { blocks: resolved, warnings };
}
