/**
 * 画面快照归一化器（3a，纯逻辑，可 smoke）。
 *
 * 衔接：把现有工具的结构化结果（getDocumentInfo / getLayerHierarchy / getAllTextLayers）映射成
 * [design-quality-measurement.ts] 要的 DesignSurfaceSnapshot，再由 extractDesignQualityMeasurements →
 * evaluateDeterministicAssertions → scoreDesignAssertions → [design-quality-verdict-bundle] 得出裁决。
 *
 * 字段映射对照真实工具返回（DesignEcho-UXP/src/tools/）：
 * - getDocumentInfo  → { document: { width, height } }（width/height 可能是数字或 {_value} 单位对象）
 * - getLayerHierarchy→ { hierarchy|flatList: LayerNode[] }，LayerNode.kind 为字符串
 *     (pixel/text/shape/group/background/smartObject/adjustment/solidColor/gradient/pattern…)，
 *     bounds 形如 {left,top,right,bottom,width,height}（仅 includeBounds=true 时存在）。
 * - getAllTextLayers → { layers: TextLayerInfo[] }，含 id / bounds / style.fontSize，
 *     以及 style.textAlign（'left'|'center'|'right'；UXP 端从 paragraphStyleRange 读取，
 *     读不到/多段不一致时缺省，绝不默认 center。【需真机验证】）。
 *
 * fillColor 可得性结论（2026-07 调查，供 backgroundIsPlainDefault 消费方参考）：
 * - getLayerHierarchy / getLayerProperties 均只回传 DOM 属性，都没有填充色输出；
 * - 栅格背景板（kind='background'，即 BACKGROUNDSHEET）的"颜色"是像素内容，
 *   结构层/描述符读不到，需像素采样（属画面观察轨，不属本结构归一化层）；
 * - solidColor/形状填充层虽可经 batchPlay 描述符按层读取填充色，但其归一化 kind 为 shape，
 *   而 backgroundIsPlainDefault 按既有语义只消费 kind='background' 层的 fillColor，补了也不进测量。
 * 因此 fillColor 当前不可得：有背景层时保持 undefined → 上游 backgroundIsPlainDefault 判 uneval，
 * 绝不造假数据（待像素观察轨接入后再补真实测量）。
 *
 * 纪律（与项目一致）：
 * - 纯逻辑：不调模型、不读像素、不触发 IPC。
 * - 诚实：无画布尺寸 → 返回 null（无法测量，绝不补默认）；缺 bounds/字号/对齐就少算（上游判 uneval）。
 * - 不猜主体：isSubject 只在 subjectLayerIds 显式给出时填，本模块不按"最大图层"等启发式臆断
 *   （理解优于硬编码：主体身份应由素材角色判断，而非几何猜测）。
 */

import type {
    DesignSurfaceSnapshot,
    SurfaceLayer,
    SurfaceLayerKind,
    SurfaceRect
} from './design-quality-measurement';
import { classifyAgentToolExecution } from './agent-tool-execution-preflight';
import { buildAgentOperationDocumentTimeline } from './agent-operation-document-timeline';
import {
    resolveRuntimeExecutionTarget,
    sameRuntimeExecutionDocument
} from './agent-runtime-v5/runtime-execution-target';
import {
    readPhotoshopHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

interface DesignSurfaceSnapshotExtractionOptions {
    subjectLayerIds?: Array<number | string> | null;
}

interface FreshDesignSurfaceSnapshotExtractionOptions extends DesignSurfaceSnapshotExtractionOptions {
    /**
     * 绑定 Photoshop Host 的同一文档历史版本。提供后，三个结构观察工具都只消费
     * 与该引用完全相等的结果；缺失引用也不会被当作兼容成功。
     */
    requiredHistoryStateRef?: PhotoshopHistoryStateRef;
}

interface DesignSurfaceToolResultEntry {
    name?: string;
    arguments?: unknown;
    result?: any;
}

function hasExplicitRootLayerScope(value: unknown): boolean {
    return value !== undefined
        && value !== null
        && String(value).trim() !== '';
}

interface DocumentInfoResultView {
    success?: boolean;
    document?: { width?: unknown; height?: unknown } | null;
}

interface LayerBoundsView {
    left?: unknown;
    top?: unknown;
    right?: unknown;
    bottom?: unknown;
    width?: unknown;
    height?: unknown;
}

interface LayerNodeView {
    id?: number | string;
    name?: string;
    kind?: string;
    visible?: boolean;
    bounds?: LayerBoundsView | null;
    children?: LayerNodeView[] | null;
}

interface LayerHierarchyResultView {
    success?: boolean;
    hierarchy?: LayerNodeView[] | null;
    flatList?: LayerNodeView[] | null;
}

interface TextLayerView {
    id?: number | string;
    bounds?: LayerBoundsView | null;
    style?: { fontSize?: unknown; textAlign?: unknown } | null;
}

interface TextLayersResultView {
    success?: boolean;
    layers?: TextLayerView[] | null;
}

export interface BuildDesignSurfaceSnapshotInput {
    documentInfo?: DocumentInfoResultView | null;
    layerHierarchy?: LayerHierarchyResultView | null;
    textLayers?: TextLayersResultView | null;
    /** 显式主体图层 id（由素材角色/设计上下文提供）；不提供则不标主体，subjectAreaRatio 等保持 uneval。 */
    subjectLayerIds?: Array<number | string> | null;
}

/** 读数字：兼容裸数字与 UXP 单位对象 {_value} / {value}。 */
function readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value && typeof value === 'object') {
        const raw = (value as { _value?: unknown; value?: unknown });
        const candidate = Number(raw._value ?? raw.value);
        if (Number.isFinite(candidate)) return candidate;
    }
    return undefined;
}

/** 校验文本对齐枚举：不在 SurfaceLayer.textAlign 合法域内（含大小写不符/非字符串）→ undefined，绝不猜测补默认。 */
function normalizeTextAlign(value: unknown): SurfaceLayer['textAlign'] {
    return value === 'left' || value === 'center' || value === 'right' || value === 'justify'
        ? value
        : undefined;
}

function mapKind(kind: string | undefined): SurfaceLayerKind {
    const k = String(kind || '').toLowerCase();
    if (k === 'text') return 'text';
    if (k === 'group') return 'group';
    if (k === 'background') return 'background';
    if (k === 'pixel' || k === 'smartobject' || k === 'video' || k === '3d') return 'image';
    if (k === 'shape' || k === 'vector' || k === 'solidcolor' || k === 'gradient'
        || k === 'gradientfill' || k === 'pattern' || k === 'patternfill') return 'shape';
    return 'other';
}

function mapBounds(bounds: LayerBoundsView | null | undefined): SurfaceRect | undefined {
    if (!bounds) return undefined;
    const left = readNumber(bounds.left);
    const top = readNumber(bounds.top);
    const right = readNumber(bounds.right);
    const bottom = readNumber(bounds.bottom);
    let width = readNumber(bounds.width);
    let height = readNumber(bounds.height);

    if (width == null && left != null && right != null) width = right - left;
    if (height == null && top != null && bottom != null) height = bottom - top;
    if (left == null || top == null || width == null || height == null) return undefined;
    if (!(width > 0) || !(height > 0)) return undefined;
    return { x: left, y: top, width, height };
}

function flattenNodes(result: LayerHierarchyResultView | null | undefined): LayerNodeView[] {
    if (!result) return [];
    if (Array.isArray(result.flatList) && result.flatList.length > 0) return result.flatList;
    const out: LayerNodeView[] = [];
    const walk = (nodes: LayerNodeView[] | null | undefined) => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            out.push(node);
            if (Array.isArray(node.children) && node.children.length > 0) walk(node.children);
        }
    };
    walk(result.hierarchy);
    return out;
}

/**
 * 把工具结构化结果映射成 DesignSurfaceSnapshot。无有效画布尺寸时返回 null（诚实，不可测量）。
 */
export function buildDesignSurfaceSnapshot(input: BuildDesignSurfaceSnapshotInput): DesignSurfaceSnapshot | null {
    const width = readNumber(input.documentInfo?.document?.width);
    const height = readNumber(input.documentInfo?.document?.height);
    if (width == null || height == null || !(width > 0) || !(height > 0)) {
        return null;
    }

    const subjectSet = new Set((input.subjectLayerIds || []).map((id) => String(id)));

    // 文本图层补充信息（字号 / bounds / 对齐）按 id 建表，用于回填到层级里的文本层。
    const textInfoById = new Map<string, { fontSize?: number; bounds?: SurfaceRect; textAlign?: SurfaceLayer['textAlign'] }>();
    for (const t of input.textLayers?.layers || []) {
        if (t.id == null) continue;
        textInfoById.set(String(t.id), {
            fontSize: readNumber(t.style?.fontSize),
            bounds: mapBounds(t.bounds),
            textAlign: normalizeTextAlign(t.style?.textAlign)
        });
    }

    const nodes = flattenNodes(input.layerHierarchy);
    const layers: SurfaceLayer[] = [];
    const seenTextIds = new Set<string>();

    for (const node of nodes) {
        const id = node.id != null ? String(node.id) : undefined;
        const kind = mapKind(node.kind);
        const layer: SurfaceLayer = { kind };
        if (id) layer.id = id;
        if (typeof node.visible === 'boolean') layer.visible = node.visible;

        let bounds = mapBounds(node.bounds);
        const textInfo = id ? textInfoById.get(id) : undefined;
        if (kind === 'text' && textInfo) {
            if (textInfo.fontSize != null) layer.fontSize = textInfo.fontSize;
            if (textInfo.textAlign) layer.textAlign = textInfo.textAlign;
            if (!bounds && textInfo.bounds) bounds = textInfo.bounds; // 层级未取 bounds 时用文本工具的 bounds 兜底
            if (id) seenTextIds.add(id);
        }
        if (bounds) layer.bounds = bounds;
        if (id && subjectSet.has(id)) layer.isSubject = true;

        layers.push(layer);
    }

    // 层级里没有的文本图层（例如只调了 getAllTextLayers）也并入，避免漏掉文字元素。
    for (const [id, info] of textInfoById) {
        if (seenTextIds.has(id)) continue;
        const layer: SurfaceLayer = { kind: 'text', id };
        if (info.fontSize != null) layer.fontSize = info.fontSize;
        if (info.textAlign) layer.textAlign = info.textAlign;
        if (info.bounds) layer.bounds = info.bounds;
        if (subjectSet.has(id)) layer.isSubject = true;
        layers.push(layer);
    }

    return { canvas: { width, height }, layers };
}

/**
 * 从工具调用结果序列里取最近一次成功的 getDocumentInfo / getLayerHierarchy / getAllTextLayers，
 * 归一化成 DesignSurfaceSnapshot。入参用最小结构（{name,result}[]）以免反向依赖 renderer 类型。
 * 无文档信息且无图层层级时返回 null（没有可测量的上下文）。
 */
export function extractDesignSurfaceSnapshotFromToolResults(
    toolResults: DesignSurfaceToolResultEntry[],
    options?: DesignSurfaceSnapshotExtractionOptions
): DesignSurfaceSnapshot | null {
    const latestSuccess = (name: string): any => {
        for (let i = toolResults.length - 1; i >= 0; i--) {
            const entry = toolResults[i];
            if (entry && entry.name === name && entry.result && entry.result.success !== false) {
                return entry.result;
            }
        }
        return undefined;
    };

    const documentInfo = latestSuccess('getDocumentInfo');
    const layerHierarchy = latestSuccess('getLayerHierarchy');
    const textLayers = latestSuccess('getAllTextLayers');

    if (!documentInfo && !layerHierarchy) return null;

    // 主体身份优先用调用方显式给出的；否则读 renderLayout 自身声明的 main-image 角色图层 id
    // （是布局规格里的显式角色，不是几何臆断），让主体占比/对比等断言可评估而非永远 uneval。
    // 合并本次运行内**所有**成功 renderLayout 的 subjectLayerIds（去重）——多阶段详情页每阶段一次
    // renderLayout，只取最近一次会漏标早期阶段主体；getLayerHierarchy 是整文档快照含全部阶段图层。
    let subjectLayerIds = options?.subjectLayerIds ?? null;
    if (!subjectLayerIds || subjectLayerIds.length === 0) {
        const merged: Array<number | string> = [];
        const seen = new Set<string>();
        for (const entry of toolResults) {
            if (!entry || entry.name !== 'renderLayout' || !entry.result || entry.result.success === false) continue;
            const declared = entry.result.subjectLayerIds;
            if (!Array.isArray(declared)) continue;
            for (const id of declared) {
                const key = String(id);
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(id);
            }
        }
        if (merged.length > 0) subjectLayerIds = merged;
    }

    return buildDesignSurfaceSnapshot({
        documentInfo,
        layerHierarchy,
        textLayers,
        subjectLayerIds
    });
}

/** 参与测量快照的结构读工具（getDocumentInfo / getLayerHierarchy / getAllTextLayers）。 */
const STRUCTURAL_READ_TOOL_NAMES = new Set(['getDocumentInfo', 'getLayerHierarchy', 'getAllTextLayers']);

/**
 * 测量新鲜度门禁：结构读结果必须出现在最后一次成功写操作之后才可用于测量。
 * toolResults 按时序累计（sink 顺序 = 时间序）；画布修改判定复用仓内单一分类
 * classifyAgentToolExecution，只让 photoshop_write 使结构观察过期。save_export 不改变
 * 文档像素或结构，不能把导出前已经取得的最终读回误判成旧版本。
 * - 早于最后一次成功写操作的结构读一律剔除：那是执行前旧画面，用它测量等于拿旧画面否决新画面；
 * - renderLayout 等写工具结果本身保留：其 subjectLayerIds 是布局规格的身份声明（不是画面测量），
 *   不受新鲜度限制；
 * - 无任何成功写操作时全部保留（画面未变，已有读取天然新鲜）；
 * - 写工具结果缺失（result 为空）按"写已发生"保守处理，同样作废之前的结构读。
 */
export function gateDesignSurfaceToolResultsByWriteFreshness(
    toolResults: DesignSurfaceToolResultEntry[]
): DesignSurfaceToolResultEntry[] {
    const entries = Array.isArray(toolResults) ? toolResults : [];
    let lastWriteIndex = -1;
    for (let i = 0; i < entries.length; i++) {
        const name = String(entries[i]?.name || '').trim();
        if (!name || classifyAgentToolExecution(name) !== 'photoshop_write') continue;
        if (entries[i]?.result && entries[i].result.success === false) continue; // 失败的写未改画面，不作废读取
        lastWriteIndex = i;
    }
    if (lastWriteIndex < 0) return entries.slice();
    return entries.filter((entry, index) => {
        const name = String(entry?.name || '').trim();
        if (!STRUCTURAL_READ_TOOL_NAMES.has(name)) return true;
        return index > lastWriteIndex;
    });
}

/**
 * 带新鲜度门禁的快照提取：先按"最后一次成功写操作"剔除过期结构读，再要求存在新鲜的
 * getLayerHierarchy 成功结果——图层清单是一切结构测量的载体，只剩新鲜 getDocumentInfo /
 * getAllTextLayers 时会得到"空图层画布"的假快照（backgroundIsPlainDefault 等会被误测成真值）。
 * 写后没有任何新鲜结构读 → 返回 null → 上游测量记 null、断言全 uneval、
 * incomplete_verification 不强制：诚实不评，绝不用执行前旧画面测量并行使否决权。
 */
export function extractFreshDesignSurfaceSnapshotFromToolResults(
    toolResults: DesignSurfaceToolResultEntry[],
    options?: FreshDesignSurfaceSnapshotExtractionOptions
): DesignSurfaceSnapshot | null {
    const freshnessGated = gateDesignSurfaceToolResultsByWriteFreshness(toolResults);
    const requiredHistoryStateRef = options?.requiredHistoryStateRef;
    const expectedDocumentTarget = requiredHistoryStateRef
        ? resolveRuntimeExecutionTarget({
            result: { documentId: requiredHistoryStateRef.documentId }
        })
        : undefined;
    const timeline = buildAgentOperationDocumentTimeline(freshnessGated);
    const documentScoped = freshnessGated.filter((entry, index) => {
        const name = String(entry?.name || '').trim();
        if (name !== 'renderLayout' || !requiredHistoryStateRef) return true;
        const operationTarget = timeline.entries[index]?.target;
        return Boolean(expectedDocumentTarget
            && operationTarget
            && sameRuntimeExecutionDocument(operationTarget, expectedDocumentTarget));
    });
    const fullDocumentScoped = documentScoped.filter((entry) => {
        const name = String(entry?.name || '').trim();
        if (name !== 'getLayerHierarchy') return true;
        const argumentRootLayerId = entry?.arguments
            && typeof entry.arguments === 'object'
            && !Array.isArray(entry.arguments)
            ? (entry.arguments as Record<string, unknown>).rootLayerId
            : undefined;
        const resultRootLayerId = entry?.result?.rootLayerId;
        return !hasExplicitRootLayerScope(argumentRootLayerId)
            && !hasExplicitRootLayerScope(resultRootLayerId);
    });
    const gated = requiredHistoryStateRef
        ? fullDocumentScoped.filter((entry) => {
            const name = String(entry?.name || '').trim();
            if (!STRUCTURAL_READ_TOOL_NAMES.has(name)) return true;
            return samePhotoshopHistoryStateRef(
                readPhotoshopHistoryStateRef(entry?.result),
                requiredHistoryStateRef
            );
        })
        : fullDocumentScoped;
    const hasFreshLayerStructure = gated.some((entry) =>
        String(entry?.name || '').trim() === 'getLayerHierarchy'
        && entry?.result
        && entry.result.success !== false);
    if (!hasFreshLayerStructure) return null;
    return extractDesignSurfaceSnapshotFromToolResults(gated, options);
}
