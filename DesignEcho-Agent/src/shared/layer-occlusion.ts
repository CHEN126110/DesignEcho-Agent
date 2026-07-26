/**
 * 图层结构性遮挡检测（纯逻辑，可 smoke）
 *
 * 背景（2026-07-06 用户实测）：模型先 placeImage 置入主图（落在文档底层），随后
 * renderLayout 的屏组连同背景矩形压在其上——主图被完全盖住，模型"后面才发现"。
 * 这类遮挡是纯几何 + 图层顺序问题，不需要视觉模型：写操作一结束就能确定性判出，
 * 立即回给模型（观察层机制化——减少"凭想象改图"）。
 *
 * v1 保守边界（只报确定的，不阻塞）：
 * - 遮挡者：可见、近全不透明（≥95）、非剪贴层，且是「填充/形状类」或名字明示背景——
 *   不把普通"图叠图"当遮挡（拼贴是正当用法），只抓"背景/色块盖内容"这类结构错误。
 * - 被遮者：可见的图像内容层（smartObject/pixel），非剪贴层、非背景语义。
 * - 判定：遮挡者在 z 序上更靠顶，且 bounds 完全包含被遮者（1px 容差）。
 * - 每个被遮者只报离它最近的一个遮挡者；检测失败/数据缺失静默跳过（自检是增益不是门闸）。
 */

export interface OcclusionLayerNode {
    id?: number;
    name?: string;
    kind?: string;
    visible?: boolean;
    opacity?: number;
    isClipped?: boolean;
    bounds?: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
        width?: number;
        height?: number;
    };
    children?: OcclusionLayerNode[];
    layers?: OcclusionLayerNode[];
}

export interface OcclusionFinding {
    occludedLayerId: number;
    occludedLayerName: string;
    occluderLayerId: number;
    occluderLayerName: string;
    message: string;
}

interface FlatOcclusionLayer {
    id: number;
    name: string;
    kind: string;
    opacity: number;
    isClipped: boolean;
    left: number;
    top: number;
    right: number;
    bottom: number;
    /** 先序扁平索引：越小越靠顶（Photoshop layers 集合自上而下） */
    zTopIndex: number;
}

const IMAGE_CONTENT_KINDS = new Set(['smartobject', 'pixel']);
const FILL_LIKE_KINDS = new Set(['shape', 'solidcolor', 'gradient', 'pattern']);
const BACKGROUND_NAME_PATTERN = /背景|底图|底色|\bbg\b|background/i;
const CONTAINMENT_TOLERANCE_PX = 1;

function isBackgroundLikeName(name: string): boolean {
    return BACKGROUND_NAME_PATTERN.test(name);
}

function flattenVisibleLeafLayers(
    nodes: OcclusionLayerNode[] | undefined,
    out: FlatOcclusionLayer[],
    counter: { next: number }
): void {
    for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!node || node.visible === false) continue;
        const children = Array.isArray(node.children) ? node.children : (Array.isArray(node.layers) ? node.layers : []);
        if (children.length > 0 || String(node.kind || '').toLowerCase() === 'group') {
            // 组本身不参与判定（bounds 是聚合），只展开其子层——先序保持从顶到底
            flattenVisibleLeafLayers(children, out, counter);
            continue;
        }
        const zTopIndex = counter.next++;
        const bounds = node.bounds;
        const left = Number(bounds?.left);
        const top = Number(bounds?.top);
        const right = Number(bounds?.right);
        const bottom = Number(bounds?.bottom);
        if (![left, top, right, bottom].every(Number.isFinite) || right - left <= 0 || bottom - top <= 0) {
            continue;
        }
        out.push({
            id: Number(node.id) || 0,
            name: String(node.name || '').trim() || `图层-${zTopIndex}`,
            kind: String(node.kind || '').toLowerCase(),
            opacity: Number.isFinite(Number(node.opacity)) ? Number(node.opacity) : 100,
            isClipped: node.isClipped === true,
            left, top, right, bottom,
            zTopIndex
        });
    }
}

function fullyContains(outer: FlatOcclusionLayer, inner: FlatOcclusionLayer): boolean {
    return outer.left <= inner.left + CONTAINMENT_TOLERANCE_PX
        && outer.top <= inner.top + CONTAINMENT_TOLERANCE_PX
        && outer.right >= inner.right - CONTAINMENT_TOLERANCE_PX
        && outer.bottom >= inner.bottom - CONTAINMENT_TOLERANCE_PX;
}

function isOccluderCandidate(layer: FlatOcclusionLayer): boolean {
    if (layer.isClipped) return false;
    if (layer.opacity < 95) return false;
    return FILL_LIKE_KINDS.has(layer.kind) || isBackgroundLikeName(layer.name);
}

function isOccludedCandidate(layer: FlatOcclusionLayer): boolean {
    if (layer.isClipped) return false;
    if (!IMAGE_CONTENT_KINDS.has(layer.kind)) return false;
    if (isBackgroundLikeName(layer.name)) return false;
    return true;
}

/**
 * 检测「内容图层被上层填充/背景类图层完全盖住」的结构性遮挡。
 * 输入为 getLayerHierarchy（includeBounds: true）返回的树；输出确定性告警（不阻塞）。
 */
export function detectFullLayerOcclusions(hierarchy: OcclusionLayerNode[] | undefined): OcclusionFinding[] {
    const flat: FlatOcclusionLayer[] = [];
    flattenVisibleLeafLayers(hierarchy, flat, { next: 0 });
    if (flat.length < 2) return [];

    const occluders = flat.filter(isOccluderCandidate);
    if (occluders.length === 0) return [];

    const findings: OcclusionFinding[] = [];
    for (const victim of flat) {
        if (!isOccludedCandidate(victim)) continue;
        // 只找 z 更靠顶的遮挡者；取离受害者最近的一个（z 距离最小），避免同一层被多报
        let nearest: FlatOcclusionLayer | null = null;
        for (const occluder of occluders) {
            if (occluder.id === victim.id) continue;
            if (occluder.zTopIndex >= victim.zTopIndex) continue;
            if (!fullyContains(occluder, victim)) continue;
            if (!nearest || occluder.zTopIndex > nearest.zTopIndex) {
                nearest = occluder;
            }
        }
        if (nearest) {
            findings.push({
                occludedLayerId: victim.id,
                occludedLayerName: victim.name,
                occluderLayerId: nearest.id,
                occluderLayerName: nearest.name,
                message: `图层「${victim.name}」被上层「${nearest.name}」完全覆盖，当前画面上看不见它。`
                    + `若它是本屏主体：用 moveLayerToGroup 把它移进屏组、再用 reorderLayer 放到背景之上；`
                    + `或改用 renderLayout 的 main-image 块直接给素材路径，由引擎统一置层。`
            });
        }
    }
    return findings;
}
