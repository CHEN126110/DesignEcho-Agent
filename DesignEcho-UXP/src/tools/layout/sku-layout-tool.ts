/**
 * SKU 排版工具
 *
 * 基于 6.3 顺序占位替换流程，实现 SKU 图片批量生成
 *
 * 功能：
 * 1. 分析项目结构 - 自动识别素材/模板/配置文件
 * 2. 解析配置文件 - 读取 CSV 配置
 * 3. 执行单个 SKU 排版 - 替换素材、缩放对齐
 * 4. 批量导出 - 按配置批量生成
 */

import { Tool, ToolExecutionContext, ToolResult, ToolSchema } from '../types';
import { getDirectExportTarget, saveAsJPEGViaJSX } from './export-folder-service';
import { normalizePhotoshopToolError } from '../../core/tool-error-normalizer';
import {
    buildSkuAutoLayoutPlan,
    verifySkuAutoLayoutResult,
    SkuAutoLayoutActualPlacement,
    SkuAutoLayoutObstacle,
    SkuAutoLayoutItem,
    SkuAutoLayoutPlan,
    SkuAutoLayoutQaResult,
    SkuAutoLayoutRect
} from '../sku/sku-auto-layout-plan';

const { app, core, action } = require('photoshop');
const storage = require('uxp').storage;
const fs = storage.localFileSystem;
const REQUEST_CANCELLED_ERROR = 'REQUEST_CANCELLED';

function formatSkuLayoutCaughtError(error: unknown): string {
    const normalized = normalizePhotoshopToolError({
        toolName: 'skuLayout',
        error
    });
    return normalized.message || normalized.userMessage || 'Unknown skuLayout error';
}

function findLayerById(container: any, id: number): any {
    const layers = Array.isArray(container) ? container : container?.layers;
    if (!Array.isArray(layers)) return null;
    for (const layer of layers) {
        if (layer?.id === id) return layer;
        if (layer?.layers) {
            const found = findLayerById(layer.layers, id);
            if (found) return found;
        }
    }
    return null;
}

async function translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (typeof layer?.translate !== 'function') {
        throw new Error(`SKULayout failed: layer ${layer?.id ?? 'unknown'} does not support DOM translate; native offset move is blocked to avoid Photoshop popups.`);
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

function readLayerBoundsRect(b: any): SkuAutoLayoutRect | null {
    if (!b) return null;

    let left: number;
    let top: number;
    let right: number;
    let bottom: number;

    if (Array.isArray(b) && b.length >= 4) {
        left = Number(b[0]?.value ?? b[0]);
        top = Number(b[1]?.value ?? b[1]);
        right = Number(b[2]?.value ?? b[2]);
        bottom = Number(b[3]?.value ?? b[3]);
    } else {
        left = Number(b._left ?? b.left);
        top = Number(b._top ?? b.top);
        right = Number(b._right ?? b.right);
        bottom = Number(b._bottom ?? b.bottom);
    }

    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return {
        left: Math.min(left, right),
        top: Math.min(top, bottom),
        right: Math.max(left, right),
        bottom: Math.max(top, bottom),
        width: Math.abs(right - left),
        height: Math.abs(bottom - top)
    };
}

function getLayerBoundsRect(layer: any): SkuAutoLayoutRect | null {
    return readLayerBoundsRect(layer?.bounds);
}

function getLayerBoundsNoEffectsRect(layer: any): SkuAutoLayoutRect | null {
    return readLayerBoundsRect(layer?.boundsNoEffects);
}

function getSkuAutoLayoutSubjectBounds(layer: any): SkuAutoLayoutRect | null {
    const bounds = getLayerBoundsRect(layer);
    const subject = getLayerBoundsNoEffectsRect(layer);
    if (!subject) return bounds;
    if (!bounds) return subject;

    const tolerancePx = 4;
    const contained =
        subject.left >= bounds.left - tolerancePx &&
        subject.top >= bounds.top - tolerancePx &&
        subject.right <= bounds.right + tolerancePx &&
        subject.bottom <= bounds.bottom + tolerancePx;
    const boundsArea = Math.max(1, bounds.width * bounds.height);
    const subjectArea = Math.max(1, subject.width * subject.height);
    const areaRatio = subjectArea / boundsArea;

    if (!contained) return bounds;
    if (areaRatio < 0.18 || areaRatio > 1.05) return bounds;
    return subject;
}

function isSkuAutoLayoutItem(value: SkuAutoLayoutItem | null): value is SkuAutoLayoutItem {
    return value !== null;
}

function getLayerChildren(layer: any): any[] {
    return Array.isArray(layer?.layers) ? layer.layers : [];
}

type SkuLayerGroupEntry = {
    layer: any;
    name: string;
    path: string;
    depth: number;
    layerCount: number;
    visible: boolean;
    topLevelName: string;
};

function isLayerGroupCandidate(layer: any): boolean {
    return Array.isArray(layer?.layers) && layer.layers.length > 0;
}

function normalizeSkuLayerName(value: string): string {
    return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function collectSkuLayerGroups(
    layers: any[],
    parentNames: string[] = [],
    parentVisible = true
): SkuLayerGroupEntry[] {
    const entries: SkuLayerGroupEntry[] = [];
    for (const layer of Array.isArray(layers) ? layers : []) {
        if (!isLayerGroupCandidate(layer)) continue;

        const name = String(layer?.name || '').trim();
        const pathNames = [...parentNames, name].filter(Boolean);
        const visible = parentVisible && layer?.visible !== false;
        entries.push({
            layer,
            name,
            path: pathNames.join('/'),
            depth: parentNames.length,
            layerCount: layer.layers.length,
            visible,
            topLevelName: pathNames[0] || name
        });
        entries.push(...collectSkuLayerGroups(layer.layers, pathNames, visible));
    }
    return entries;
}

function findSkuLayerGroupByName(layers: any[], colorName: string): SkuLayerGroupEntry | null {
    const target = normalizeSkuLayerName(colorName);
    if (!target) return null;
    const groups = collectSkuLayerGroups(layers);
    return groups.find((entry) => normalizeSkuLayerName(entry.name) === target) || null;
}

type SkuReplacementPlaceholder = {
    layer: any;
    name: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
};

type SkuTemplateLayoutInspectionMode = 'ordered_slots' | 'legacy_single_region' | 'legacy_multi_regions' | 'none';

type SkuTemplateLayoutInspectionSlot = {
    layerId?: number;
    name: string;
    kind: string;
    sourceType: 'group_slot' | 'rectangle_region' | 'reference_group' | 'unknown';
    panelIndex: number;
    declaredCapacity?: number;
    visible: boolean;
    bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number };
};

const REPLACEMENT_PLACEHOLDER_KEYWORDS = ['占位', 'placeholder', 'holder', '#'];

function isSkuPlaceholderContainerName(name: string): boolean {
    const n = String(name || '').trim().toLowerCase();
    return ['占位', '占位符', '占位组', 'placeholders', 'placeholder', 'holders', 'holder'].includes(n)
        || /sku.*占位符|占位符.*\d+个/.test(n);
}

function isSkuReplacementPlaceholderName(name: string): boolean {
    const raw = String(name || '').trim();
    const n = raw.toLowerCase();
    if (/^\d+$/.test(raw)) return true;
    return REPLACEMENT_PLACEHOLDER_KEYWORDS.some((keyword) => n.includes(keyword));
}

function isLegacySkuReferenceRegionName(name: string): boolean {
    const normalized = String(name || '').trim();
    return /^(?:形状|矩形)?参考$|^参考(?:形状|矩形|区域)?$|(?:占位|sku).{0,8}参考|reference|ref(?:erence)?[\s_-]*(?:shape|region|box)?/i.test(normalized);
}

function normalizeSkuReplacementPlaceholder(layer: any): SkuReplacementPlaceholder | null {
    const bounds = getLayerBoundsRect(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
        layer,
        name: String(layer?.name || '').trim(),
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height
    };
}

function findSkuPlaceholderContainer(layers: any[]): any | null {
    for (const layer of Array.isArray(layers) ? layers : []) {
        const name = String(layer?.name || '').trim();
        const children = getLayerChildren(layer);
        if (children.length > 0 && isSkuPlaceholderContainerName(name)) return layer;
        const nested = findSkuPlaceholderContainer(children);
        if (nested) return nested;
    }
    return null;
}

function isSkuRectangleReplacementPlaceholderLayer(layer: any, doc: any): boolean {
    const bounds = getLayerBoundsRect(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    if (isTemplateGroupLayer(layer)) return false;
    const kind = getLayerKindText(layer);
    const name = String(layer?.name || '').trim();
    if (layer?.isBackgroundLayer === true || kind === 'background') return false;
    if (kind.includes('text')) return false;
    if (isFullCanvasTemplateLayer(bounds, doc)) return false;
    if (!isLegacySkuRegionGeometry(bounds, doc)) return false;
    const referenceRegionName = isLegacySkuReferenceRegionName(name);
    const legacyShapeName = /^(矩形|矩形\s*\d+|形状|rectangle|rect|shape)\b|\b(rectangle|rect|placeholder\s*box)\b/i.test(name);
    const shapeKind = /shape|solidcolor|solidcolorlayer|contentlayer/i.test(kind);
    return referenceRegionName || legacyShapeName || shapeKind;
}

function hasReferenceSlotTextChild(layer: any): boolean {
    return getLayerChildren(layer).some((child) => getLayerKindText(child).includes('text'));
}

function hasReferenceSlotVisualChild(layer: any): boolean {
    return getLayerChildren(layer).some((child) => {
        const kind = getLayerKindText(child);
        return kind.includes('smartobject')
            || kind.includes('pixel')
            || kind.includes('normal')
            || kind.includes('image')
            || kind.includes('shape')
            || kind.includes('solidcolor');
    });
}

function isLegacyReferenceItemGroupLayer(layer: any, doc: any): boolean {
    if (!isTemplateGroupLayer(layer)) return false;
    const bounds = getLayerBoundsRect(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    if (isFullCanvasTemplateLayer(bounds, doc)) return false;
    if (!isLegacySkuRegionGeometry(bounds, doc)) return false;
    const name = String(layer?.name || '').trim();
    if (/背景|background|\bbg\b|底图|底色|白底|装饰|角标|logo|标识|分割|线条|边框|参考|reference|\bref\b|占位|placeholder/i.test(name)) {
        return false;
    }
    return hasReferenceSlotTextChild(layer) && hasReferenceSlotVisualChild(layer);
}

function isSkuOrderedPlaceholderLayer(layer: any, doc: any): boolean {
    return isTemplateGroupLayer(layer)
        || isSkuReplacementPlaceholderName(layer?.name)
        || isSkuRectangleReplacementPlaceholderLayer(layer, doc);
}

function collectNamedSkuReplacementPlaceholders(layers: any[], doc: any, result: any[] = [], depth = 0): any[] {
    for (const layer of Array.isArray(layers) ? layers : []) {
        const children = getLayerChildren(layer);
        const name = String(layer?.name || '').trim();
        if (!isSkuPlaceholderContainerName(name)
            && (
                isSkuReplacementPlaceholderName(name)
                || (depth === 0 && isSkuRectangleReplacementPlaceholderLayer(layer, doc))
                || (depth === 0 && isLegacyReferenceItemGroupLayer(layer, doc))
            )) {
            result.push(layer);
            continue;
        }
        if (children.length > 0) {
            collectNamedSkuReplacementPlaceholders(children, doc, result, depth + 1);
        }
    }
    return result;
}

function collectOrderedSkuReplacementPlaceholders(doc: any): SkuReplacementPlaceholder[] {
    const rootLayers = Array.from(doc?.layers || []);
    const container = findSkuPlaceholderContainer(rootLayers);
    const placeholderLayers = container
        ? getLayerChildren(container).filter((layer) => isSkuOrderedPlaceholderLayer(layer, doc))
        : collectNamedSkuReplacementPlaceholders(rootLayers, doc);

    return placeholderLayers
        .map(normalizeSkuReplacementPlaceholder)
        .filter((item): item is SkuReplacementPlaceholder => Boolean(item));
}

function countTemplateLayers(layers: any[], counters = { total: 0, visible: 0 }): { total: number; visible: number } {
    for (const layer of Array.isArray(layers) ? layers : []) {
        counters.total += 1;
        if (layer?.visible !== false) counters.visible += 1;
        const children = getLayerChildren(layer);
        if (children.length > 0) countTemplateLayers(children, counters);
    }
    return counters;
}

function findOpenDocumentByName(documentName?: string): any | null {
    const target = String(documentName || '').trim();
    if (!target) return null;
    for (let i = 0; i < app.documents.length; i++) {
        const doc = app.documents[i];
        if (doc?.name === target) return doc;
    }
    return null;
}

function readSkuRegionDeclaredCapacity(name: string): number | undefined {
    const match = String(name || '').match(/(?:容量|capacity|cap)[\s:：=_-]*(\d{1,2})/i);
    if (!match) return undefined;
    const value = Number(match[1]);
    return Number.isInteger(value) && value > 0 ? value : undefined;
}

function resolveSkuTemplateSlotSourceType(layer: any, doc: any, insidePlaceholderContainer: boolean): SkuTemplateLayoutInspectionSlot['sourceType'] {
    if (insidePlaceholderContainer || (isTemplateGroupLayer(layer) && !isLegacyReferenceItemGroupLayer(layer, doc))) {
        return 'group_slot';
    }
    if (isSkuRectangleReplacementPlaceholderLayer(layer, doc)) return 'rectangle_region';
    if (isLegacyReferenceItemGroupLayer(layer, doc)) return 'reference_group';
    return 'unknown';
}

function resolveSkuTemplateLayoutInspectionMode(
    doc: any,
    placeholders: SkuReplacementPlaceholder[]
): SkuTemplateLayoutInspectionMode {
    if (placeholders.length === 0) return 'none';
    const container = findSkuPlaceholderContainer(Array.from(doc?.layers || []));
    if (container) return 'ordered_slots';
    const everySlotIsNamedGroup = placeholders.every((placeholder) =>
        isTemplateGroupLayer(placeholder.layer)
        && !isLegacyReferenceItemGroupLayer(placeholder.layer, doc)
    );
    if (everySlotIsNamedGroup) return 'ordered_slots';
    return placeholders.length === 1 ? 'legacy_single_region' : 'legacy_multi_regions';
}

function resolveSkuTemplatePlacementMethod(
    mode: SkuTemplateLayoutInspectionMode
): 'one_to_one_slots' | 'region_composition' | 'unresolved' {
    if (mode === 'ordered_slots') return 'one_to_one_slots';
    if (mode === 'legacy_single_region' || mode === 'legacy_multi_regions') return 'region_composition';
    return 'unresolved';
}

function buildTemplateLayoutInspection(doc: any, expectedItemCount?: number): {
    schema: 'sku-template-layout-inspection/v2';
    templateName: string;
    mode: SkuTemplateLayoutInspectionMode;
    slotCount: number;
    expectedItemCount?: number;
    placementMethod: 'one_to_one_slots' | 'region_composition' | 'unresolved';
    supportsMultiColorInSingleRegion: boolean;
    supportsMultiColorPerRegion: boolean;
    slots: SkuTemplateLayoutInspectionSlot[];
    blockers: string[];
    warnings: string[];
    inspectedLayerCount: number;
    visibleLayerCount: number;
    boundaries: { writesPhotoshop: false; claimsDesignQuality: false };
} {
    const rootLayers = Array.from(doc?.layers || []);
    const counters = countTemplateLayers(rootLayers);
    const placeholders = collectOrderedSkuReplacementPlaceholders(doc);
    const placeholderContainer = findSkuPlaceholderContainer(rootLayers);
    const slots = placeholders.map((placeholder, index) => {
        const declaredCapacity = readSkuRegionDeclaredCapacity(placeholder.name);
        return {
            ...(Number.isFinite(Number(placeholder.layer?.id)) ? { layerId: Number(placeholder.layer.id) } : {}),
            name: placeholder.name,
            kind: getLayerKindText(placeholder.layer),
            sourceType: resolveSkuTemplateSlotSourceType(placeholder.layer, doc, Boolean(placeholderContainer)),
            panelIndex: index,
            ...(declaredCapacity ? { declaredCapacity } : {}),
            visible: placeholder.layer?.visible !== false,
            bounds: {
                left: placeholder.left,
                top: placeholder.top,
                right: placeholder.right,
                bottom: placeholder.bottom,
                width: placeholder.width,
                height: placeholder.height
            }
        };
    });
    const expected = Number(expectedItemCount || 0);
    const mode: SkuTemplateLayoutInspectionMode = resolveSkuTemplateLayoutInspectionMode(doc, placeholders);
    const placementMethod = resolveSkuTemplatePlacementMethod(mode);
    const supportsMultiColorInSingleRegion = mode === 'legacy_single_region';
    const supportsMultiColorPerRegion = placementMethod === 'region_composition';
    const blockers = slots.length > 0
        ? []
        : ['模板没有识别到可用 SKU 占位槽。'];
    const warnings: string[] = [];
    if (mode === 'legacy_single_region' && expected > 1) {
        warnings.push('模板使用单个参考区域承载整组 SKU，导出后需要复核组合内部间距。');
    }
    if (mode === 'legacy_multi_regions') {
        warnings.push('模板使用多个矩形组合区域；执行前必须形成显式区域容量计划并保留当前区域结构。');
    }

    return {
        schema: 'sku-template-layout-inspection/v2',
        templateName: String(doc?.name || ''),
        mode,
        placementMethod,
        slotCount: slots.length,
        ...(expected > 0 ? { expectedItemCount: expected } : {}),
        supportsMultiColorInSingleRegion,
        supportsMultiColorPerRegion,
        slots,
        blockers,
        warnings,
        inspectedLayerCount: counters.total,
        visibleLayerCount: counters.visible,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

function resolveSkuRegionCapacities(input: {
    mode: SkuTemplateLayoutInspectionMode;
    slotCount: number;
    comboSize: number;
    requested?: number[];
}): number[] {
    if (input.mode === 'ordered_slots') {
        if (input.slotCount !== input.comboSize) {
            throw new Error(`顺序占位模板需要 ${input.comboSize} 个一色一槽，占位数实际为 ${input.slotCount}。`);
        }
        return Array.from({ length: input.slotCount }, () => 1);
    }
    if (input.mode === 'legacy_single_region') {
        if (input.slotCount !== 1) throw new Error('单区域组合模板没有识别到唯一矩形区域。');
        return [input.comboSize];
    }
    if (input.mode === 'legacy_multi_regions') {
        const requested = Array.isArray(input.requested)
            ? input.requested.map((value) => Number(value))
            : [];
        const valid = requested.length === input.slotCount
            && requested.every((value) => Number.isInteger(value) && value > 0)
            && requested.reduce((sum, value) => sum + value, 0) === input.comboSize;
        if (!valid) {
            throw new Error(
                `旧版矩形区域模板必须提供 regionCapacities；需要 ${input.slotCount} 个正整数且总和为 ${input.comboSize}，`
                + `当前为 [${requested.join(', ')}]。请先 inspectTemplateLayout，再由 SKU TemplateLayoutPlan 根据区域 bounds 或视觉观察确认容量。`
            );
        }
        return requested;
    }
    throw new Error('模板没有识别到可执行的 SKU 占位结构。');
}

type SkuPlaceholderMismatchData = {
    schema: 'sku-placeholder-mismatch/v1';
    reason: 'placeholder_slot_count_mismatch';
    mode: SkuTemplateLayoutInspectionMode;
    slotCount: number;
    requiredCount: number;
    combo: string[];
    templateDocName: string;
    resolutions: string[];
};

type SkuPlaceholderMismatchCarrier = Error & { skuPlaceholderMismatch?: SkuPlaceholderMismatchData };

function buildSkuPlaceholderMismatchResolutions(requiredCount: number, mode?: SkuTemplateLayoutInspectionMode): string[] {
    // 真机病例（2026-07-07）：用户的 4双装.tif 是 6.0 区域式设计（少量参考区域承载整组多色
    // 水平分布），Agent 按出路①补槽，用 2×2 网格盖掉了用户的设计构图。模板已有参考区域
    //（legacy 模式）时，"这是区域分布设计"的可能性排第一，改用户模板结构的补槽必须垫底并先确认。
    if (mode === 'legacy_single_region' || mode === 'legacy_multi_regions') {
        return [
            `出路① 区域容量计划：用 inspectTemplateLayout 读取区域 bounds 与面板顺序，由 TemplateLayoutPlan 形成总和为 ${requiredCount} 的 regionCapacities；高置信计划可执行，中低置信先看截图确认。`,
            '出路② 调整现有区域：使用 inspectTemplateLayout 返回的 layerId 调用 transformLayer，保留 6.0 区域式模板结构，调整后再次检查。',
            `出路③ 换模板或转换方法：用 openTemplate 打开正确规格模板；只有用户明确要一色一槽时，才用 createSkuPlaceholders 创建 ${requiredCount} 个 ordered_slots。`
        ];
    }
    return [
        `出路① 创建顺序槽：确认模板本意是一色一槽后，调用 createSkuPlaceholders（placementMethod=ordered_slots）创建 ${requiredCount} 个槽并复验。`,
        '出路② 区域组合模式：若模板本意是一个或多个矩形区域承载多色，先用 inspectTemplateLayout 确认 legacy 模式，再形成显式 regionCapacities。',
        `出路③ 换模板：用 openTemplate 打开与颜色数量匹配的规格模板（如「${requiredCount}双装」），读取返回的 documentName 作为 templateDocName 后重试。`
    ];
}

/**
 * 占位槽数量与配色数量不匹配的结构化错误。
 *
 * 错误文本自带三条可达出路，同时把 mode/slotCount/requiredCount/combo/templateDocName
 * 挂在 error.skuPlaceholderMismatch 上，由 catch 出口回传到 ToolResult.data，
 * 让模型拿到机器可读的失败上下文而不是只有一句文案。
 */
/**
 * 把 N 个颜色按顺序尽量均匀地分配到 K 个占位区域（K ≤ N）。
 * 自选备注要展示全部颜色供买家挑选；当模板参考区域少于颜色数时，
 * 每个区域承载多个颜色（下游按区域内水平分布渲染），而不是报错逼模型手工补槽。
 * 例：8 色 / 2 区 → [[c1,c2,c3,c4],[c5,c6,c7,c8]]；8 色 / 1 区 → [[c1..c8]]（等价旧单区域）。
 *
 * 【设计依据·原始脚本 ground truth】小橙同学「袜子排版6.0」自选模式 start()：
 *   模板 artLayers 即"区域"，CSV 第二列用 | 分区、+ 分色（如 白+奶白+黄+绿|粉+肤+浅灰+黑），
 *   每区把 N 色 suofang(type3 等比 contain) 后 duqi(左/右/中) 水平分布。
 *   6.3「顺序占位替换版」改为一色一占位图层组严格匹配（组合图走这套），但自选备注沿用区域分布。
 *   用户现有 2双/3双自选备注模板是 6.0 时代的"2个形状参考矩形=2行"设计——
 *   本函数按顺序均匀分配即等价其 |分区 的默认排法（8色/2区 = 4+4），无需重做模板。
 *   两种占位符类型都由 collectOrderedSkuReplacementPlaceholders 识别：
 *   图层组占位(isTemplateGroupLayer) + 矩形/形状参考占位(isSkuRectangleReplacementPlaceholderLayer)。
 */
function distributeNoteColorsIntoRegions(colors: string[], regionCount: number): string[][] {
    const k = Math.max(1, Math.min(regionCount, colors.length));
    const regions: string[][] = Array.from({ length: k }, () => []);
    const base = Math.floor(colors.length / k);
    const remainder = colors.length % k;
    let cursor = 0;
    for (let i = 0; i < k; i++) {
        // 前 remainder 个区域多分一个，保证顺序连续、总数守恒
        const take = base + (i < remainder ? 1 : 0);
        regions[i] = colors.slice(cursor, cursor + take);
        cursor += take;
    }
    return regions;
}

function createSkuPlaceholderMismatchError(input: {
    headline: string;
    templateDoc: any;
    slotCount: number;
    requiredCount: number;
    combo: string[];
}): SkuPlaceholderMismatchCarrier {
    const resolvedMode = resolveSkuTemplateLayoutInspectionMode(
        input.templateDoc,
        collectOrderedSkuReplacementPlaceholders(input.templateDoc)
    );
    const resolutions = buildSkuPlaceholderMismatchResolutions(input.requiredCount, resolvedMode);
    const data: SkuPlaceholderMismatchData = {
        schema: 'sku-placeholder-mismatch/v1',
        reason: 'placeholder_slot_count_mismatch',
        mode: resolvedMode,
        slotCount: input.slotCount,
        requiredCount: input.requiredCount,
        combo: [...input.combo],
        templateDocName: String(input.templateDoc?.name || ''),
        resolutions
    };
    const error = new Error(`${input.headline} ${resolutions.join(' ')}`) as SkuPlaceholderMismatchCarrier;
    error.skuPlaceholderMismatch = data;
    return error;
}

function extractSkuPlaceholderMismatchData(error: unknown): SkuPlaceholderMismatchData | null {
    const carrier = error as SkuPlaceholderMismatchCarrier | null;
    const data = carrier?.skuPlaceholderMismatch;
    if (!data || data.schema !== 'sku-placeholder-mismatch/v1') return null;
    return data;
}

function hideSkuReplacementPlaceholder(layer: any): void {
    try {
        if (layer) layer.visible = false;
    } catch (error: any) {
        console.warn(`[SKULayout] 隐藏占位符失败: ${layer?.name || 'unknown'} - ${error?.message || error}`);
    }
}

function parseOrderedSkuColorNameSequence(value: string): string[] {
    const normalized = String(value || '')
        .trim()
        .replace(/｜/g, '|')
        .replace(/＋/g, '+')
        .replace(/[，、；;,]/g, '+')
        .replace(/\s+/g, '+');

    if (!normalized) return [];

    const parts = /[+|]/.test(normalized)
        ? normalized.split(/[+|]+/)
        : /^\d+$/.test(normalized)
            ? normalized.split('')
            : [normalized];

    return parts
        .map((part) => String(part || '').trim())
        .filter(Boolean);
}

function normalizeSkuExportFileName(value: string, fallback: string): string {
    const cleaned = String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, '')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
        .trim();
    return cleaned || fallback;
}

function buildSkuComboExportFileName(combo: string[], comboIndex: number, usedNames: Set<string>): string {
    const baseName = normalizeSkuExportFileName(combo.join('+'), `组合${comboIndex + 1}`);
    let outputName = baseName;
    let duplicateIndex = 2;
    while (usedNames.has(outputName.toLowerCase())) {
        outputName = `${baseName}-${duplicateIndex}`;
        duplicateIndex += 1;
    }
    usedNames.add(outputName.toLowerCase());
    return outputName;
}

function getLayerKindText(layer: any): string {
    const kind = layer?.kind;
    if (typeof kind === 'string') return kind.toLowerCase();
    if (typeof kind === 'number') return String(kind);
    if (kind && typeof kind === 'object') {
        return String(kind.value ?? kind._value ?? kind).toLowerCase();
    }
    return '';
}

function isTemplateGroupLayer(layer: any): boolean {
    const kind = getLayerKindText(layer);
    return kind === 'group' || kind.includes('group') || getLayerChildren(layer).length > 0;
}

function getDocumentNumber(value: any): number {
    const num = Number(value?.value ?? value);
    return Number.isFinite(num) ? num : 0;
}

function isFullCanvasTemplateLayer(bounds: SkuAutoLayoutRect, doc: any): boolean {
    const canvasWidth = getDocumentNumber(doc?.width);
    const canvasHeight = getDocumentNumber(doc?.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) return false;
    return bounds.width >= canvasWidth * 0.92 && bounds.height >= canvasHeight * 0.92;
}

function isExplicitSkuPlaceholderTemplateLayerName(name: string): boolean {
    return /占位符?|placeholder|place[\s_-]*holder|sku[\s_-]*(?:slot|place|placeholder)|产品位|图片位|颜色位|图位/i.test(name);
}

function isLegacySkuRegionGeometry(bounds: SkuAutoLayoutRect, doc: any): boolean {
    if (isFullCanvasTemplateLayer(bounds, doc)) return false;

    const canvasWidth = getDocumentNumber(doc?.width);
    const canvasHeight = getDocumentNumber(doc?.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) {
        return bounds.width >= 120 && bounds.height >= 160;
    }

    const widthRatio = bounds.width / canvasWidth;
    const heightRatio = bounds.height / canvasHeight;
    const areaRatio = (bounds.width * bounds.height) / Math.max(1, canvasWidth * canvasHeight);
    const aspect = bounds.width / Math.max(1, bounds.height);

    if (areaRatio < 0.045 || areaRatio > 0.82) return false;
    if (widthRatio < 0.08 || heightRatio < 0.18) return false;
    if (aspect < 0.18 || aspect > 5) return false;
    return true;
}

function isLegacyTopLevelSkuPlaceholderTemplateLayer(layer: any, bounds: SkuAutoLayoutRect, doc: any, depth: number): boolean {
    if (depth !== 0) return false;
    const name = String(layer?.name || '').trim();
    const kind = getLayerKindText(layer);
    if (layer?.isBackgroundLayer === true || kind === 'background') return false;
    if (kind.includes('text')) return false;
    if (/标题|文案|文字|说明|价格|角标|logo|标识|装饰|参考|背景|底图|白底|底板|分割|线条|边框/i.test(name)) return false;
    if (!isLegacySkuRegionGeometry(bounds, doc)) return false;
    const legacyShapeName = /^(矩形|矩形\s*\d+|rectangle|rect|shape)\b|\b(rectangle|rect|placeholder\s*box)\b/i.test(name);
    const shapeKind = /shape|solidcolorlayer|contentlayer/i.test(kind);
    return legacyShapeName || shapeKind;
}

function isAuxiliaryTemplateLayer(layer: any, bounds: SkuAutoLayoutRect, doc: any, depth: number): boolean {
    const name = String(layer?.name || '').trim();
    const kind = getLayerKindText(layer);
    if (layer?.isBackgroundLayer === true || kind === 'background') return true;
    if (isFullCanvasTemplateLayer(bounds, doc)) return true;
    if (isExplicitSkuPlaceholderTemplateLayerName(name)) return true;
    if (isLegacyTopLevelSkuPlaceholderTemplateLayer(layer, bounds, doc, depth)) return true;
    return /背景|background|\bbg\b|参考|reference|\bref\b|底图|底色|白底/i.test(name);
}

function collectVisibleSkuTemplateObstacles(
    layers: any[],
    doc: any,
    parentVisible = true,
    depth = 0
): SkuAutoLayoutObstacle[] {
    const obstacles: SkuAutoLayoutObstacle[] = [];

    for (const layer of Array.isArray(layers) ? layers : []) {
        const visible = parentVisible && layer?.visible !== false && layer?.isVisible !== false;
        if (!visible) continue;

        if (isTemplateGroupLayer(layer)) {
            obstacles.push(...collectVisibleSkuTemplateObstacles(getLayerChildren(layer), doc, visible, depth + 1));
            continue;
        }

        const bounds = getLayerBoundsRect(layer);
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
        if (isAuxiliaryTemplateLayer(layer, bounds, doc, depth)) continue;

        obstacles.push({
            id: String(layer?.id || layer?.name || `template-obstacle-${obstacles.length + 1}`),
            role: String(layer?.kind || 'template-element'),
            locked: layer?.locked === true,
            bounds
        });
    }

    return obstacles;
}

function normalizeSkuLayoutDiagnosticList(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function formatSkuAutoLayoutSummaryDiagnostic(plan: any): string {
    const summary = plan?.summary || plan?.diagnostics?.summary;
    if (!summary || typeof summary !== 'object') return '';

    const itemCount = Number(summary.itemCount || 0);
    const obstacleCount = Number(summary.obstacleCount || 0);
    const freeRegionCount = Number(summary.freeRegionCount || 0);
    const largest = summary.largestFreeRegion || {};
    const largestWidth = Math.round(Number(largest.width || 0));
    const largestHeight = Math.round(Number(largest.height || 0));
    const likelyBlockers = Array.isArray(summary.likelyBlockers)
        ? summary.likelyBlockers.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];

    if (likelyBlockers.includes('no_free_region')) {
        return `自动排版诊断：模板安全区没有可用空闲区域，已识别 ${obstacleCount} 个需避让元素。`;
    }
    if (likelyBlockers.includes('high_item_count_needs_more_canvas_area')) {
        return `自动排版诊断：SKU 数量 ${itemCount} 较多，当前画布可用面积不足以保持最小缩放和间距。`;
    }
    if (likelyBlockers.includes('free_regions_are_fragmented')) {
        return `自动排版诊断：模板可用区域被切成 ${freeRegionCount} 个小区域，最大区域约 ${largestWidth}x${largestHeight}px。`;
    }
    if (likelyBlockers.includes('template_obstacles_consume_safe_area')) {
        return `自动排版诊断：模板元素占用了大部分安全区，最大空闲区域约 ${largestWidth}x${largestHeight}px。`;
    }
    if (freeRegionCount > 0) {
        return `自动排版诊断：已识别 ${freeRegionCount} 个空闲区域，最大区域约 ${largestWidth}x${largestHeight}px，需避让元素 ${obstacleCount} 个。`;
    }
    return '';
}

function buildSkuLayoutPrimaryFailureReason(input: {
    errors?: string[];
    autoLayoutPlans?: any[];
    noteAutoLayoutPlans?: any[];
    fallback?: string;
}): string {
    const diagnostics: string[] = [];
    diagnostics.push(...normalizeSkuLayoutDiagnosticList(input.errors));

    const planGroups = [
        ...(Array.isArray(input.autoLayoutPlans) ? input.autoLayoutPlans : []),
        ...(Array.isArray(input.noteAutoLayoutPlans) ? input.noteAutoLayoutPlans : [])
    ];
    for (const plan of planGroups) {
        const blockers = normalizeSkuLayoutDiagnosticList(plan?.blockers);
        for (const blocker of blockers) {
            diagnostics.push(`自动排版计划未通过：${blocker}`);
        }
        const summaryDiagnostic = formatSkuAutoLayoutSummaryDiagnostic(plan);
        if (summaryDiagnostic) diagnostics.push(summaryDiagnostic);
    }

    const uniqueDiagnostics = Array.from(new Set(diagnostics));
    if (uniqueDiagnostics.length > 0) return uniqueDiagnostics.slice(0, 3).join('；');
    return input.fallback || '未导出任何文件';
}

async function applySkuAutoLayoutPlan(
    doc: any,
    plan: SkuAutoLayoutPlan,
    options: { obstacles?: SkuAutoLayoutObstacle[] } = {}
): Promise<{ applied: number; warnings: string[]; autoLayoutQa: SkuAutoLayoutQaResult }> {
    const warnings: string[] = [];
    const actualPlacements: SkuAutoLayoutActualPlacement[] = [];
    let applied = 0;

    for (const placement of plan.placements) {
        if (!placement.layerId) {
            warnings.push(`缺少图层 ID，跳过 ${placement.itemId}`);
            actualPlacements.push({
                itemId: placement.itemId,
                layerId: placement.layerId,
                name: placement.name,
                destinationBox: placement.destinationBox,
                actualBounds: null,
                actualSubjectBounds: null
            });
            continue;
        }

        const layer = findLayerById(doc?.layers, placement.layerId);
        if (!layer) {
            warnings.push(`未找到计划中的图层 ${placement.layerId}`);
            actualPlacements.push({
                itemId: placement.itemId,
                layerId: placement.layerId,
                name: placement.name,
                destinationBox: placement.destinationBox,
                actualBounds: null,
                actualSubjectBounds: null
            });
            continue;
        }

        const beforeBounds = getLayerBoundsRect(layer);
        if (!beforeBounds || beforeBounds.width <= 0 || beforeBounds.height <= 0) {
            warnings.push(`图层 ${placement.layerId} 缺少有效边界`);
            actualPlacements.push({
                itemId: placement.itemId,
                layerId: placement.layerId,
                name: placement.name,
                destinationBox: placement.destinationBox,
                actualBounds: null,
                actualSubjectBounds: null
            });
            continue;
        }

        const beforeSubjectBounds = getSkuAutoLayoutSubjectBounds(layer) || beforeBounds;
        const scale = Math.min(
            placement.destinationBox.width / beforeSubjectBounds.width,
            placement.destinationBox.height / beforeSubjectBounds.height
        );

        if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.01) {
            await batchPlayResize(placement.layerId, scale * 100);
        }

        const refreshedLayer = findLayerById(doc?.layers, placement.layerId) || layer;
        const afterScaleBounds = getLayerBoundsRect(refreshedLayer);
        if (!afterScaleBounds || afterScaleBounds.width <= 0 || afterScaleBounds.height <= 0) {
            warnings.push(`图层 ${placement.layerId} 缩放后缺少有效边界`);
            actualPlacements.push({
                itemId: placement.itemId,
                layerId: placement.layerId,
                name: placement.name,
                destinationBox: placement.destinationBox,
                actualBounds: null,
                actualSubjectBounds: null
            });
            continue;
        }

        const afterScaleSubjectBounds = getSkuAutoLayoutSubjectBounds(refreshedLayer) || afterScaleBounds;
        const currentCenterX = afterScaleSubjectBounds.left + afterScaleSubjectBounds.width / 2;
        const currentCenterY = afterScaleSubjectBounds.top + afterScaleSubjectBounds.height / 2;
        const targetCenterX = placement.destinationBox.left + placement.destinationBox.width / 2;
        const targetCenterY = placement.destinationBox.top + placement.destinationBox.height / 2;
        const offsetX = targetCenterX - currentCenterX;
        const offsetY = targetCenterY - currentCenterY;

        if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
            await batchPlayTranslate(placement.layerId, offsetX, offsetY);
        }

        const finalLayer = findLayerById(doc?.layers, placement.layerId) || refreshedLayer;
        actualPlacements.push({
            itemId: placement.itemId,
            layerId: placement.layerId,
            name: placement.name,
            destinationBox: placement.destinationBox,
            actualBounds: getLayerBoundsRect(finalLayer),
            actualSubjectBounds: getSkuAutoLayoutSubjectBounds(finalLayer)
        });
        applied += 1;
    }

    const autoLayoutQa = verifySkuAutoLayoutResult({
        plan,
        actualPlacements,
        obstacles: options.obstacles || []
    });

    return { applied, warnings, autoLayoutQa };
}

/**
 * 使用 batchPlay 缩放图层（兼容图层组）
 * @param layerId 图层 ID
 * @param scalePercent 缩放百分比（如 80 表示 80%）
 */
async function batchPlayResize(layerId: number, scalePercent: number): Promise<void> {
    // 先选中目标图层
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });

    // 使用 transform 命令进行缩放（从中心）
    await action.batchPlay([{
        _obj: 'transform',
        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
        width: { _unit: 'percentUnit', _value: scalePercent },
        height: { _unit: 'percentUnit', _value: scalePercent },
        interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubicAutomatic' },
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
}

/**
 * 使用 batchPlay 移动图层（兼容图层组）
 * @param layerId 图层 ID
 * @param offsetX 水平偏移（像素）
 * @param offsetY 垂直偏移（像素）
 */
async function batchPlayTranslate(layerId: number, offsetX: number, offsetY: number): Promise<void> {
    // 先选中目标图层
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });

    const doc = app.activeDocument;
    const targetLayer = findLayerById(doc?.layers, layerId) || doc?.activeLayers?.[0];
    await translateLayer(targetLayer, offsetX, offsetY);
}

async function deleteCopiedSkuLayers(layerIds: number[], label: string): Promise<string[]> {
    const warnings: string[] = [];
    const uniqueLayerIds = Array.from(new Set(layerIds.filter(id => Number.isFinite(Number(id)))))
        .map(id => Number(id))
        .reverse();

    for (const layerId of uniqueLayerIds) {
        try {
            await action.batchPlay([{
                _obj: 'delete',
                _target: [{ _ref: 'layer', _id: layerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });
        } catch (error: any) {
            warnings.push(`${label}: 清理复制图层 ${layerId} 失败: ${error?.message || error}`);
        }
    }

    layerIds.length = 0;
    return warnings;
}

async function cleanupCopiedSkuLayersAfterModal(layerIds: number[], label: string): Promise<void> {
    if (layerIds.length === 0) return;
    try {
        await core.executeAsModal(async () => {
            const warnings = await deleteCopiedSkuLayers(layerIds, label);
            warnings.forEach((warning) => console.warn(`[SKULayout] ${warning}`));
        }, { commandName: label });
    } catch (error: any) {
        console.warn(`[SKULayout] ${label}: 复制图层清理失败: ${error?.message || error}`);
    }
}

/**
 * 使用 batchPlay 导出 JPEG（通过 Photoshop 导出动作完成受控保存）
 * @param outputPath 完整输出路径
 * @param quality JPEG 质量 (1-12)
 */
async function batchPlayExportJPEG(outputPath: string, quality: number = 10): Promise<boolean> {
    try {
        // 使用 Quick Export as JPEG
        await action.batchPlay([{
            _obj: 'exportDocumentAsFileTypePressed',
            _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'first' }],
            fileType: 'jpg',
            quality: quality,
            _options: { dialogOptions: 'dontDisplay' }
        } as any], { synchronousExecution: true });
        return true;
    } catch (e: any) {
        console.warn(`[batchPlayExportJPEG] 快速导出失败: ${e.message}`);
        return false;
    }
}

/**
 * SKU 配置项
 */
interface SKUConfig {
    templateName: string;      // 模板文件名
    colorCombination: string;  // 颜色组合，如 "红色+黑色|蓝色+白色"
}

/**
 * 颜色配置项
 */
interface ColorConfig {
    name: string;
    hexColor: string;
}

/**
 * 项目结构分析结果
 */
interface ProjectStructure {
    psdFolder?: string;        // PSD 素材文件夹
    templateFolder?: string;   // 模板文件夹
    configFolder?: string;     // 配置文件夹
    outputFolder?: string;     // 输出文件夹
    skuFile?: string;          // SKU 素材文件
    configFile?: string;       // 配置 CSV 文件
    colorFile?: string;        // 颜色配置文件
    note?: string;             // 备注信息
}

function describeComboValue(value: any): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

function buildCombosShapeError(position: string, value: any): string {
    return `skuLayout execute 参数错误：combos 必须是颜色名数组的数组 (array of color name arrays: string[][])。出错位置 ${position} 是 ${describeComboValue(value)}。示例：{"combos":[["红色","黑色"],["蓝色","白色"]]}`;
}

function validateCombosShape(combos: any): string | null {
    if (combos === undefined || combos === null) return null;
    if (!Array.isArray(combos)) {
        return buildCombosShapeError('combos', combos);
    }

    for (let comboIndex = 0; comboIndex < combos.length; comboIndex++) {
        const combo = combos[comboIndex];
        if (!Array.isArray(combo)) {
            return buildCombosShapeError(`combos[${comboIndex}]`, combo);
        }

        for (let colorIndex = 0; colorIndex < combo.length; colorIndex++) {
            const colorName = combo[colorIndex];
            if (typeof colorName !== 'string') {
                return buildCombosShapeError(`combos[${comboIndex}][${colorIndex}]`, colorName);
            }
        }
    }

    return null;
}

function normalizeSkuNoteColorRegions(combos: string[][] | undefined): string[][] {
    if (!Array.isArray(combos)) return [];

    const regions: string[][] = [];
    for (const combo of combos) {
        if (!Array.isArray(combo)) continue;
        const region = combo
            .map(colorName => String(colorName || '').trim())
            .filter(Boolean);
        if (region.length > 0) {
            regions.push(region);
        }
    }
    return regions;
}

/**
 * SKU 排版工具
 */
export class SKULayoutTool implements Tool {
    name = 'skuLayout';

    schema: ToolSchema = {
        name: 'skuLayout',
        description: 'SKU 图片批量排版工具，支持自动识别项目结构、解析配置、执行排版',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: '操作类型: analyzeProject, parseConfig, executeOne, executeBatch, getProgress, getCapabilities, inspectTemplateLayout, listLayerSets, execute'
                },
                projectPath: {
                    type: 'string',
                    description: '项目根目录路径'
                },
                config: {
                    type: 'object',
                    description: 'SKU 配置对象'
                },
                templateIndex: {
                    type: 'number',
                    description: '模板索引（用于 executeOne）'
                },
                outputFormat: {
                    type: 'string',
                    description: '输出格式: jpg, png'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 (1-12)'
                },
                combos: {
                    type: 'array',
                    description: '颜色组合列表，每个元素是一个颜色名称数组'
                },
                skuDocName: {
                    type: 'string',
                    description: '明确指定 SKU 素材文档名称，避免误用当前打开的其他项目 SKU'
                },
                templateDocName: {
                    type: 'string',
                    description: '明确指定模板文档名称，避免依赖当前活动文档'
                },
                outputDir: {
                    type: 'string',
                    description: '输出目录路径'
                },
                autoLayoutWithoutPlaceholders: {
                    type: 'boolean',
                    description: '低层兼容参数；SKU 6.3 默认不使用，正常业务按模板顺序占位组替换'
                },
                expectedItemCount: {
                    type: 'number',
                    description: '只读模板检查时用于判断本次 SKU 组合期望的颜色数量'
                },
                regionCapacities: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '6.0 矩形多区域模板的区域容量，按 Photoshop 图层面板从上到下，例如 4双上3下1传 [3,1]'
                }
            },
            required: ['action']
        }
    };

    // 缓存
    private projectStructure: ProjectStructure | null = null;
    private skuConfigs: SKUConfig[] = [];
    private colorConfigs: Map<number, ColorConfig> = new Map();
    private progress = { current: 0, total: 0, message: '' };
    private activeExecutionContext: ToolExecutionContext | undefined;

    private isCancelled(): boolean {
        return Boolean(this.activeExecutionContext?.isCancelled?.());
    }

    private throwIfCancelled(): void {
        if (!this.isCancelled()) return;
        const error = new Error('请求已取消');
        (error as Error & { code?: string }).code = REQUEST_CANCELLED_ERROR;
        throw error;
    }

    private buildCancelledResult(): ToolResult<any> {
        return {
            success: false,
            error: '请求已取消',
            data: {
                cancelled: true
            }
        };
    }

    private isCancellationError(error: any): boolean {
        return error?.code === REQUEST_CANCELLED_ERROR || this.isCancelled();
    }

    async execute(params: {
        action: string;
        projectPath?: string;
        config?: any;
        templateIndex?: number;
        outputFormat?: string;
        quality?: number;
        combos?: string[][];
        skuDocName?: string;
        templateDocName?: string;
        outputDir?: string;
        autoLayoutWithoutPlaceholders?: boolean;
        expectedItemCount?: number;
        regionCapacities?: number[];
        noteFilePrefix?: string;   // 自选备注文件名前缀
        isNoteTemplate?: boolean;  // 是否为自选备注模式
    }, context?: ToolExecutionContext): Promise<ToolResult<any>> {
        const previousContext = this.activeExecutionContext;
        this.activeExecutionContext = context;
        try {
            this.throwIfCancelled();
            switch (params.action) {
                case 'analyzeProject':
                    return await this.analyzeProject(params.projectPath);

                case 'parseConfig':
                    return await this.parseConfigFiles();

                case 'executeOne':
                    return await this.executeOneSKU(params.templateIndex || 0, params.config);

                case 'executeBatch':
                    return await this.executeBatch(params.config);

                case 'getProgress':
                    return { success: true, data: this.progress };

                case 'getCapabilities':
                    return this.getCapabilities();

                case 'inspectTemplateLayout':
                    return this.inspectTemplateLayout({
                        templateDocName: params.templateDocName,
                        expectedItemCount: params.expectedItemCount
                    });

                case 'listLayerSets':
                    return await this.listLayerSets();

                case 'copyLayerSetToTemplate':
                    return await this.copyLayerSetToTemplate(params.config);

                case 'execute':
                    const combosShapeError = validateCombosShape(params.combos);
                    if (combosShapeError) {
                        return { success: false, error: combosShapeError, data: null };
                    }
                    return await this.executeComboLayout({
                        combos: params.combos || [],
                        skuDocName: params.skuDocName,
                        templateDocName: params.templateDocName,
                        outputDir: params.outputDir,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        autoLayoutWithoutPlaceholders: params.autoLayoutWithoutPlaceholders,
                        regionCapacities: params.regionCapacities,
                        noteFilePrefix: params.noteFilePrefix,  // 自选备注文件名前缀
                        isNoteTemplate: params.isNoteTemplate   // 是否为自选备注模式
                    });

                case 'exportNote':
                    // ★ 自选备注专用：直接导出当前文档，不复制图层
                    return await this.exportNoteTemplate({
                        outputDir: params.outputDir,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        noteFileName: params.noteFilePrefix || '自选备注'
                    });

                case 'arrangeDynamic':
                    const dynamicCombosShapeError = validateCombosShape(params.combos);
                    if (dynamicCombosShapeError) {
                        return { success: false, error: dynamicCombosShapeError, data: null };
                    }
                    // ★ 动态排列模式（类似 6.1颜色排列-动态调整.jsx）
                    // 用于自选备注：从 SKU 素材复制颜色，动态排列，导出
                    return await this.executeNoteWithDynamicArrange({
                        colorsByRegion: normalizeSkuNoteColorRegions(params.combos || []),
                        skuDocName: params.skuDocName,
                        templateDocName: params.templateDocName,
                        outputDir: params.outputDir,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        autoLayoutWithoutPlaceholders: params.autoLayoutWithoutPlaceholders,
                        noteFileName: params.noteFilePrefix || '自选备注'
                    });

                default:
                    return { success: false, error: `未知操作: ${params.action}`, data: null };
            }
        } catch (error: any) {
            if (error?.code === REQUEST_CANCELLED_ERROR || this.isCancelled()) {
                return this.buildCancelledResult();
            }
            console.error('[SKULayout] 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        } finally {
            this.activeExecutionContext = previousContext;
        }
    }

    private getCapabilities(): ToolResult<any> {
        return {
            success: true,
            data: {
                schema: 'sku-layout-capabilities/v0',
                runtime: 'DesignEcho-UXP skuLayout',
                actions: [
                    'analyzeProject',
                    'parseConfig',
                    'executeOne',
                    'executeBatch',
                    'getProgress',
                    'getCapabilities',
                    'inspectTemplateLayout',
                    'listLayerSets',
                    'copyLayerSetToTemplate',
                    'execute',
                    'exportNote',
                    'arrangeDynamic'
                ],
                supportsRecursiveSkuLayerSets: true,
                skuSourceColorGroups: {
                    revision: 'sku-recursive-color-layer-groups/v1',
                    actions: ['listLayerSets', 'copyLayerSetToTemplate', 'executeOne', 'execute', 'arrangeDynamic'],
                    recursiveLayerSets: true,
                    canResolveNestedColorGroups: true,
                    returnsLayerSetPaths: true,
                    returnsLayerSetBounds: true
                },
                supportsNoPlaceholderAutoLayout: true,
                noPlaceholderAutoLayout: {
                    revision: 'sku-no-placeholder-auto-layout/v2',
                    actions: ['execute', 'arrangeDynamic'],
                    plannerSchema: 'sku-auto-layout-plan/v0',
                    returnsPlanDiagnostics: true,
                    returnsPostExecutionGeometryQa: true,
                    returnsActualSubjectBoundsQa: true,
                    writesPhotoshopOnlyAfterPlanReady: true
                },
                errorNormalization: {
                    revision: 'sku-layout-error-normalization/v1',
                    normalizesNonErrorExceptions: true
                },
                comboExportNaming: {
                    revision: 'sku-combo-export-naming/v1',
                    usesColorComboAsFileName: true,
                    keepsExecutionOrderOutOfFileName: true
                },
                orderedPlaceholders: {
                    revision: 'sku-ordered-placeholder-recognition/v4',
                    acceptsCreateSkuPlaceholdersShapeLayers: true,
                    acceptsHiddenReferenceShapeRegions: true,
                    supportsSingleLegacyReferenceRegion: true,
                    acceptsLegacyReferenceItemGroups: true
                },
                templateLayoutInspection: {
                    revision: 'sku-template-layout-inspection/v2',
                    actions: ['inspectTemplateLayout'],
                    ownsPhotoshopTemplateRecognition: true,
                    returnsSlotBounds: true,
                    returnsBlockers: true
                },
                templateRegionComposition: {
                    revision: 'sku-region-composition/v1',
                    actions: ['inspectTemplateLayout', 'execute'],
                    acceptsExplicitRegionCapacities: true,
                    preservesPhotoshopPanelOrder: true,
                    supportsMultipleRectangleRegions: true
                },
                selfSelectNotePlaceholders: {
                    revision: 'sku-note-placeholder-overflow/v2',
                    allowsExtraPlaceholders: true,
                    hidesUnusedPlaceholders: true,
                    supportsSingleLegacyReferenceRegion: true
                },
                boundaries: {
                    writesPhotoshop: false,
                    claimsDesignQuality: false
                }
            }
        };
    }

    private inspectTemplateLayout(config: {
        templateDocName?: string;
        expectedItemCount?: number;
    } = {}): ToolResult<any> {
        const templateDoc = config.templateDocName
            ? findOpenDocumentByName(config.templateDocName)
            : app.activeDocument;
        if (!templateDoc) {
            return {
                success: false,
                error: config.templateDocName
                    ? `未找到指定模板文档: ${config.templateDocName}`
                    : '没有打开的模板文档',
                data: null
            };
        }

        return {
            success: true,
            data: buildTemplateLayoutInspection(templateDoc, config.expectedItemCount)
        };
    }

    /**
     * 分析项目结构
     */
    private async analyzeProject(projectPath?: string): Promise<ToolResult<ProjectStructure>> {
        try {
            if (!projectPath) {
                // 尝试从当前文档路径推断
                const doc = app.activeDocument;
                if (!doc) {
                    return { success: false, error: '请指定项目路径或打开一个文档', data: null };
                }
                // UXP 无法直接获取文档路径，返回提示
                return {
                    success: false,
                    error: '请提供项目根目录路径',
                    data: null
                };
            }

            const structure: ProjectStructure = {};

            // 预期的文件夹结构：
            // 项目根目录/
            //   PSD/          - 素材 PSD 文件
            //   模板文件/     - 模板 PSD 文件
            //   配置文件/     - CSV 配置文件
            //   SKU/          - 输出目录

            // 检查各个文件夹
            const expectedFolders = [
                { key: 'psdFolder', name: 'PSD' },
                { key: 'templateFolder', name: '模板文件' },
                { key: 'configFolder', name: '配置文件' },
                { key: 'outputFolder', name: 'SKU' }
            ];

            console.log(`[SKULayout] 分析项目结构: ${projectPath}`);

            // 这里需要使用 UXP 文件系统 API
            // 由于 UXP 限制，实际文件系统访问需要用户授权
            // 返回预期结构供参考

            this.projectStructure = {
                psdFolder: `${projectPath}/PSD`,
                templateFolder: `${projectPath}/模板文件`,
                configFolder: `${projectPath}/配置文件`,
                outputFolder: `${projectPath}/SKU`
            };

            return {
                success: true,
                data: {
                    ...this.projectStructure,
                    note: '请确认以上路径存在。SKU 文件应位于 PSD 文件夹中，配置文件应位于配置文件文件夹中。'
                }
            };

        } catch (error: any) {
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 解析配置文件
     * 由于 UXP 文件系统限制，这里返回配置文件格式说明
     */
    private async parseConfigFiles(): Promise<ToolResult<any>> {
        return {
            success: true,
            data: {
                configFormat: {
                    description: 'CSV 配置文件格式说明',
                    columns: ['模板名称', '颜色组合'],
                    example: [
                        '模板1.psd,1|2+3',
                        '模板2.psd,4+5|6'
                    ],
                    colorFormat: {
                        description: '颜色配置文件格式',
                        columns: ['颜色名称', 'HEX颜色值'],
                        example: [
                            '红色,FF0000',
                            '黑色,000000'
                        ]
                    }
                },
                note: '请在 Agent 端读取 CSV 文件并通过 executeOne 或 executeBatch 传入配置'
            }
        };
    }

    /**
     * 列出当前文档中的所有图层组（LayerSets）
     *
     * 注意：SKU 素材文件的结构是图层组，每个颜色是一个图层组
     * 图层组结构示例：
     *   白色（图层组）
     *     ├─ 白色（文字图层）
     *     ├─ 主体（图片图层）
     *     └─ 阴影（图层）
     *
     * UXP API 注意：Document 没有 layerSets 属性，需要从 layers 过滤
     */
    private async listLayerSets(): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            const layers = Array.from(doc.layers || []);
            const layerSets = collectSkuLayerGroups(layers).map((entry, index) => ({
                name: entry.name,
                index,
                layerCount: entry.layerCount,
                visible: entry.visible,
                path: entry.path,
                depth: entry.depth,
                topLevelName: entry.topLevelName,
                bounds: getLayerBoundsRect(entry.layer)
            }));
            console.log(`[listLayerSets] 文档: ${doc.name}, 顶层图层数: ${layers.length}, 递归图层组数: ${layerSets.length}`);
            for (const layerSet of layerSets) {
                console.log(`[listLayerSets]   [${layerSet.index}] "${layerSet.path}" (${layerSet.layerCount} 子图层)`);
            }

            return {
                success: true,
                data: {
                    documentName: doc.name,
                    layerSetCount: layerSets.length,
                    recursive: true,
                    layerSets
                }
            };

        } catch (error: any) {
            console.error('[listLayerSets] 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 复制图层组到模板
     */
    private async copyLayerSetToTemplate(config: {
        sourceDocName: string;
        layerSetName: string;
        targetDocName: string;
        targetBounds?: { left: number; top: number; width: number; height: number };
        alignment?: 'center' | 'left' | 'right' | 'top' | 'bottom';
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        if (!config) {
            return { success: false, error: '缺少配置参数', data: null };
        }

        try {
            // 找到源文档
            let sourceDoc: any = null;
            let targetDoc: any = null;

            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                if (doc.name === config.sourceDocName) {
                    sourceDoc = doc;
                }
                if (doc.name === config.targetDocName) {
                    targetDoc = doc;
                }
            }

            if (!sourceDoc) {
                return { success: false, error: `未找到源文档: ${config.sourceDocName}`, data: null };
            }
            if (!targetDoc) {
                return { success: false, error: `未找到目标文档: ${config.targetDocName}`, data: null };
            }

            // 在源文档中找到图层组
            app.activeDocument = sourceDoc;
            const targetSet = findSkuLayerGroupByName(Array.from(sourceDoc.layers || []), config.layerSetName)?.layer || null;

            if (!targetSet) {
                return { success: false, error: `未找到图层组: ${config.layerSetName}`, data: null };
            }

            // 复制图层组到目标文档
            await core.executeAsModal(async () => {
                // 选中图层组
                sourceDoc.activeLayer = targetSet;

                // 复制到目标文档
                await action.batchPlay([{
                    _obj: 'duplicate',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    to: { _ref: 'document', _name: config.targetDocName },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 切换到目标文档进行调整
                app.activeDocument = targetDoc;
                const copiedLayer = targetDoc.activeLayer;

                // 如果提供了目标边界，进行缩放和对齐
                if (config.targetBounds && copiedLayer) {
                    const bounds = copiedLayer.bounds;
                    const layerWidth = bounds[2] - bounds[0];
                    const layerHeight = bounds[3] - bounds[1];

                    // 计算缩放比例（等比缩放，取较小值以适应目标区域）
                    const scaleX = config.targetBounds.width / layerWidth;
                    const scaleY = config.targetBounds.height / layerHeight;
                    const scale = Math.min(scaleX, scaleY);

                    if (Math.abs(scale - 1) > 0.01) {
                        copiedLayer.resize(scale * 100, scale * 100);
                    }

                    // 移动到目标位置（居中对齐）
                    const newBounds = copiedLayer.bounds;
                    const newWidth = newBounds[2] - newBounds[0];
                    const newHeight = newBounds[3] - newBounds[1];

                    const targetCenterX = config.targetBounds.left + config.targetBounds.width / 2;
                    const targetCenterY = config.targetBounds.top + config.targetBounds.height / 2;
                    const layerCenterX = newBounds[0] + newWidth / 2;
                    const layerCenterY = newBounds[1] + newHeight / 2;

                    copiedLayer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
                }

            }, { commandName: 'Copy Layer Set to Template' });

            return {
                success: true,
                data: {
                    message: `已复制图层组 "${config.layerSetName}" 到 "${config.targetDocName}"`,
                    layerSetName: config.layerSetName
                }
            };

        } catch (error: any) {
            if (this.isCancellationError(error)) {
                return this.buildCancelledResult();
            }
            console.error('[SKULayout] copyLayerSetToTemplate 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 执行单个 SKU 排版
     */
    private async executeOneSKU(index: number, config?: {
        skuDocName: string;           // SKU 素材文档名
        templateDocName: string;      // 模板文档名
        colorMappings: Array<{
            layerIndex: number;        // 模板中的图层索引
            colorNames: string[];      // 要填充的颜色名称（从素材文档的图层组）
        }>;
        outputPath?: string;
        outputName?: string;
        quality?: number;
    }): Promise<ToolResult<any>> {
        if (!config) {
            return { success: false, error: '缺少配置参数', data: null };
        }

        try {
            this.progress = { current: index, total: 1, message: '开始处理...' };

            // 找到文档
            let skuDoc: any = null;
            let templateDoc: any = null;

            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                if (doc.name === config.skuDocName) {
                    skuDoc = doc;
                }
                if (doc.name === config.templateDocName) {
                    templateDoc = doc;
                }
            }

            if (!skuDoc) {
                return { success: false, error: `未找到 SKU 文档: ${config.skuDocName}`, data: null };
            }
            if (!templateDoc) {
                return { success: false, error: `未找到模板文档: ${config.templateDocName}`, data: null };
            }

            const processedLayers: string[] = [];

            await core.executeAsModal(async () => {
                // 处理每个颜色映射
                for (const mapping of config.colorMappings) {
                    const templateLayers = templateDoc.layers;

                    if (mapping.layerIndex >= templateLayers.length) {
                        console.warn(`[SKULayout] 图层索引 ${mapping.layerIndex} 超出范围`);
                        continue;
                    }

                    const templateLayer = templateLayers[mapping.layerIndex];
                    const templateBounds = templateLayer.bounds;
                    const targetBounds = {
                        left: templateBounds[0].value || templateBounds[0],
                        top: templateBounds[1].value || templateBounds[1],
                        width: (templateBounds[2].value || templateBounds[2]) - (templateBounds[0].value || templateBounds[0]),
                        height: (templateBounds[3].value || templateBounds[3]) - (templateBounds[1].value || templateBounds[1])
                    };

                    // 复制每个颜色的图层组
                    for (const colorName of mapping.colorNames) {
                        // 在 SKU 文档中找到对应的图层组
                        app.activeDocument = skuDoc;
                        const colorSet = findSkuLayerGroupByName(Array.from(skuDoc.layers || []), colorName)?.layer || null;

                        if (!colorSet) {
                            console.warn(`[SKULayout] 未找到素材图层组: ${colorName}`);
                            continue;
                        }

                        // 复制到模板
                        skuDoc.activeLayer = colorSet;
                        await action.batchPlay([{
                            _obj: 'duplicate',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: { _ref: 'document', _name: config.templateDocName },
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });

                        // 切换到模板文档调整
                        app.activeDocument = templateDoc;
                        const copiedLayer = templateDoc.activeLayer;

                        if (copiedLayer) {
                            // 缩放以适应目标区域
                            const bounds = copiedLayer.bounds;
                            const layerWidth = (bounds[2].value || bounds[2]) - (bounds[0].value || bounds[0]);
                            const layerHeight = (bounds[3].value || bounds[3]) - (bounds[1].value || bounds[1]);

                            const scaleX = targetBounds.width / layerWidth;
                            const scaleY = targetBounds.height / layerHeight;
                            const scale = Math.min(scaleX, scaleY);

                            if (Math.abs(scale - 1) > 0.01) {
                                copiedLayer.resize(scale * 100, scale * 100);
                            }

                            // 居中对齐
                            const newBounds = copiedLayer.bounds;
                            const newWidth = (newBounds[2].value || newBounds[2]) - (newBounds[0].value || newBounds[0]);
                            const newHeight = (newBounds[3].value || newBounds[3]) - (newBounds[1].value || newBounds[1]);

                            const targetCenterX = targetBounds.left + targetBounds.width / 2;
                            const targetCenterY = targetBounds.top + targetBounds.height / 2;
                            const layerCenterX = (newBounds[0].value || newBounds[0]) + newWidth / 2;
                            const layerCenterY = (newBounds[1].value || newBounds[1]) + newHeight / 2;

                            copiedLayer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
                        }

                        processedLayers.push(colorName);
                    }
                }

            }, { commandName: 'Execute SKU Layout' });

            this.progress = { current: 1, total: 1, message: '完成' };

            return {
                success: true,
                data: {
                    message: 'SKU 排版完成',
                    processedLayers,
                    templateDoc: config.templateDocName
                }
            };

        } catch (error: any) {
            console.error('[SKULayout] executeOneSKU 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 执行颜色组合排版
     * 这是智能排版的核心方法，接收颜色组合并自动处理
     */
    /**
     * ★ 自选备注专用导出
     *
     * 自选备注是一张**提示图**，告诉买家可以自选颜色
     * 不需要复制颜色图层，只需要直接导出当前模板即可
     *
     * @param config 导出配置
     * @returns 导出结果
     */
    /**
     * 自选备注动态排列导出
     *
     * 6.3 核心逻辑：
     * 1. 从 SKU 素材复制指定颜色图层组到自选备注模板
     * 2. 按模板“占位”容器下的一级图层组顺序逐个替换
     * 3. 每个颜色图层组缩放并居中到对应占位组
     * 4. 隐藏已被替换的占位组
     * 5. 导出到临时目录（由 Agent 复制到正确位置）
     */
    private async executeNoteWithDynamicArrange(config: {
        colors?: string[];          // 简单模式：所有颜色放第一个占位区域
        colorsByRegion?: string[][]; // 兼容旧入参；6.3 会展平成顺序颜色槽
        colorString?: string;        // 字符串模式："1+2|2+3"、"123" 都按顺序槽位解析
        skuDocName?: string;
        templateDocName?: string;
        outputDir?: string;
        format: string;
        quality: number;
        autoLayoutWithoutPlaceholders?: boolean;
        noteFileName: string;
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        const { noteFileName } = config;

        // 6.3 顺序占位替换：所有分隔符都只表示顺序槽位，"|" 不再表示区域。
        let orderedNoteColors: string[];
        let colorRegions: string[][];

        if (config.colorsByRegion && config.colorsByRegion.length > 0) {
            orderedNoteColors = config.colorsByRegion.flat().map((color) => String(color || '').trim()).filter(Boolean);
            console.log(`[SKULayout] 使用顺序颜色槽 (${orderedNoteColors.length} 个)`);
        } else if (config.colorString) {
            orderedNoteColors = parseOrderedSkuColorNameSequence(config.colorString);
            console.log(`[SKULayout] 解析顺序颜色字符串: "${config.colorString}" → ${orderedNoteColors.length} 个槽位`);
        } else if (config.colors && config.colors.length > 0) {
            orderedNoteColors = config.colors.map((color) => String(color || '').trim()).filter(Boolean);
            console.log(`[SKULayout] 使用颜色列表: ${orderedNoteColors.length} 个槽位`);
        } else {
            return { success: false, error: '没有提供颜色列表', data: null };
        }

        colorRegions = [orderedNoteColors];

        const totalColors = orderedNoteColors.length;
        if (totalColors === 0) {
            return { success: false, error: '颜色列表为空', data: null };
        }
        const noteAutoLayoutPlans: any[] = [];
        const noteLayerIdsForCleanup: number[] = [];

        try {
            console.log(`[SKULayout] ★★★ 自选备注顺序占位替换模式 ★★★`);
            console.log(`[SKULayout]   顺序槽位: ${orderedNoteColors.join(' + ')}`);
            console.log(`[SKULayout]   总颜色数: ${totalColors}`);
            console.log(`[SKULayout]   输出文件名: ${noteFileName}`);

            // 1. 识别 SKU 素材文档和自选备注模板
            let skuDoc: any = null;
            let templateDoc: any = null;

            if (config.skuDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.skuDocName) {
                        skuDoc = app.documents[i];
                        break;
                    }
                }
            }

            if (config.templateDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.templateDocName) {
                        templateDoc = app.documents[i];
                        break;
                    }
                }
            }

            if (!skuDoc) {
                for (let i = 0; i < app.documents.length; i++) {
                    const doc = app.documents[i];
                    const name = (doc.name || '').toLowerCase();
                    if (name.includes('sku') || name.includes('素材')) {
                        skuDoc = doc;
                        break;
                    }
                }
            }

            if (!templateDoc) {
                templateDoc = app.activeDocument;  // 当前活动文档应该是自选备注模板
                const activeDocName = (templateDoc?.name || '').toLowerCase();
                if (activeDocName.includes('sku') || activeDocName.includes('素材')) {
                    templateDoc = null;
                }
            }

            if (!templateDoc) {
                for (let i = 0; i < app.documents.length; i++) {
                    const doc = app.documents[i];
                    const name = (doc.name || '').toLowerCase();
                    if (name.includes('自选备注')) {
                        templateDoc = doc;
                        break;
                    }
                }
            }

            if (config.skuDocName && !skuDoc) {
                return { success: false, error: `未找到指定 SKU 素材文档: ${config.skuDocName}`, data: null };
            }

            if (config.templateDocName && !templateDoc) {
                return { success: false, error: `未找到指定自选备注模板文档: ${config.templateDocName}`, data: null };
            }

            if (!skuDoc) {
                return { success: false, error: '未找到 SKU 素材文档（名称应包含 "SKU"）', data: null };
            }

            if (!templateDoc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            console.log(`[SKULayout]   SKU 素材: ${skuDoc.name}`);
            console.log(`[SKULayout]   模板: ${templateDoc.name}`);

            // 2. 获取画布尺寸
            const canvasWidth = templateDoc.width;
            const canvasHeight = templateDoc.height;
            console.log(`[SKULayout]   画布: ${canvasWidth}x${canvasHeight}`);

            await core.executeAsModal(async () => {
                // 4. 切换到模板，获取 6.3 顺序占位图层组
                app.activeDocument = templateDoc;

                const templateLayers = templateDoc.layers || [];
                console.log(`[SKULayout] 查找顺序占位组，顶层图层数: ${templateLayers.length}`);

                const autoLayoutObstacles: SkuAutoLayoutObstacle[] = config.autoLayoutWithoutPlaceholders
                    ? collectVisibleSkuTemplateObstacles(Array.from(templateLayers), templateDoc)
                    : [];
                let sortedPlaceholders: SkuReplacementPlaceholder[] = [];
                if (config.autoLayoutWithoutPlaceholders) {
                    sortedPlaceholders = [{
                        layer: null,
                        name: '画布',
                        left: Number(canvasWidth) * 0.05,
                        top: Number(canvasHeight) * 0.35,
                        right: Number(canvasWidth) * 0.95,
                        bottom: Number(canvasHeight) * 0.95,
                        width: Number(canvasWidth) * 0.9,
                        height: Number(canvasHeight) * 0.6
                    }];
                    console.log(`[SKULayout] 自选备注无占位符自动排版：${autoLayoutObstacles.length} 个递归可见前景图层将作为避让元素`);
                } else {
                    sortedPlaceholders = collectOrderedSkuReplacementPlaceholders(templateDoc);
                    if (sortedPlaceholders.length >= orderedNoteColors.length) {
                        // 槽位足够：一槽一色
                        colorRegions = orderedNoteColors.map((color) => [color]);
                    } else if (sortedPlaceholders.length >= 1) {
                        // 槽位少于颜色数（含旧版单区域/双区域模板）：把颜色均匀分配到现有区域，
                        // 每区承载多色由下游水平分布渲染——不再报错逼模型手工补占位槽（真机实测
                        // 8色月子袜遇2槽备注模板时，模型要花十几步手动 createSkuPlaceholders 才能绕过）。
                        colorRegions = distributeNoteColorsIntoRegions(orderedNoteColors, sortedPlaceholders.length);
                        console.log(`[SKULayout] 自选备注 ${orderedNoteColors.length} 色分配到 ${sortedPlaceholders.length} 个参考区域：${JSON.stringify(colorRegions)}`);
                    } else {
                        // 真正 0 槽（既非无占位符自动排版、又找不到任何参考区域）才报错指路
                        throw createSkuPlaceholderMismatchError({
                            headline: `占位槽数量-${sortedPlaceholders.length} 少于自选备注配色数量-${orderedNoteColors.length}：${orderedNoteColors.join('+')}。`,
                            templateDoc,
                            slotCount: sortedPlaceholders.length,
                            requiredCount: orderedNoteColors.length,
                            combo: orderedNoteColors
                        });
                    }
                }

                console.log(`[SKULayout] 顺序占位映射:`);
                sortedPlaceholders.forEach((p, i) => {
                    console.log(`[SKULayout]   ${i + 1}. ${p.name || p.layer?.name || '画布'} (${p.width.toFixed(0)}x${p.height.toFixed(0)}) @ (${p.left.toFixed(0)}, ${p.top.toFixed(0)})`);
                });

                const numRegions = colorRegions.length;

                const effectivePlaceholders = sortedPlaceholders.length;
                const allNoteLayerIds = noteLayerIdsForCleanup;

                // 遍历每个顺序占位槽位
                for (let regionIdx = 0; regionIdx < Math.max(numRegions, effectivePlaceholders); regionIdx++) {
                    this.throwIfCancelled();
                    const placeholderIdx = Math.min(regionIdx, effectivePlaceholders - 1);
                    const placeholder = sortedPlaceholders[placeholderIdx];

                    if (regionIdx >= numRegions) {
                        hideSkuReplacementPlaceholder(placeholder.layer);
                        console.log(`[SKULayout] 跳过空槽位 ${regionIdx + 1}（无对应颜色）`);
                        continue;
                    }

                    const regionColors = colorRegions[regionIdx];
                    const regionColorCount = regionColors.length;

                    if (regionColorCount === 0) {
                        console.log(`[SKULayout] 跳过空槽位 ${regionIdx + 1}`);
                        continue;
                    }

                    console.log(`[SKULayout] ===== 处理槽位 ${regionIdx + 1}/${numRegions} =====`);
                    console.log(`[SKULayout]   占位组: ${placeholder.layer?.name || '画布回退'}`);
                    console.log(`[SKULayout]   颜色: ${regionColors.join(' + ')}`);

                    const placeholderRect = {
                        left: placeholder.left,
                        top: placeholder.top,
                        right: placeholder.right,
                        bottom: placeholder.bottom,
                        width: placeholder.width,
                        height: placeholder.height
                    };

                    const placeholderCenterX = (placeholderRect.left + placeholderRect.right) / 2;
                    const placeholderCenterY = (placeholderRect.top + placeholderRect.bottom) / 2;

                    const targetWidth = placeholderRect.width;
                    const targetHeight = placeholderRect.height;

                    console.log(`[SKULayout]   占位尺寸: ${targetWidth.toFixed(0)}x${targetHeight.toFixed(0)}`);
                    console.log(`[SKULayout]   颜色数: ${regionColorCount}`);

                    // 存储当前槽位复制的图层 ID（低层兼容分支可能需要统一定位）
                    const regionLayerIds: number[] = [];

                    // 遍历该区域的每个颜色
                    for (let colorIdx = 0; colorIdx < regionColorCount; colorIdx++) {
                        this.throwIfCancelled();
                        const colorName = regionColors[colorIdx];
                        if (!colorName) continue;

                        console.log(`[SKULayout]   颜色 ${colorIdx + 1}/${regionColorCount}: ${colorName}`);

                        // 切换到 SKU 素材查找颜色图层
                        app.activeDocument = skuDoc;
                        const skuLayers = skuDoc.layers || [];
                        let foundLayer: any = findSkuLayerGroupByName(Array.from(skuLayers), colorName)?.layer || null;
                        if (!foundLayer) {
                            for (let i = 0; i < skuLayers.length; i++) {
                                const layer = skuLayers[i];
                                const layerName = (layer.name || '').replace(/\s+/g, '').trim();
                                const searchName = colorName.replace(/\s+/g, '').trim();

                                if (layerName === searchName || layer.name.trim() === colorName.trim()) {
                                    foundLayer = layer;
                                    break;
                                }
                            }
                        }

                        if (!foundLayer) {
                            console.warn(`[SKULayout]   ⚠️ 未找到颜色图层: ${colorName}`);
                            continue;
                        }

                        // 复制颜色图层到模板
                        try {
                            // 复制前先激活模板占位组，避免 duplicate 把新图层放入错误父级。
                            // 步骤 1：切换到模板文档，选中占位组
                            app.activeDocument = templateDoc;
                            const placeholder = sortedPlaceholders[Math.min(regionIdx, sortedPlaceholders.length - 1)];
                            if (placeholder?.layer?.id) {
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: placeholder.layer.id }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                console.log(`[SKULayout]   准备: 选中模板占位矩形 "${placeholder.layer.name}"`);
                            }

                            // 步骤 2：切回素材文档，选中颜色图层
                            app.activeDocument = skuDoc;
                            await action.batchPlay([{
                                _obj: 'select',
                                _target: [{ _ref: 'layer', _id: foundLayer.id }],
                                makeVisible: false,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                            // 步骤 3：复制到模板文档
                            await action.batchPlay([{
                                _obj: 'duplicate',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'document', _name: templateDoc.name },
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                            // 复制后切回模板文档，并从 activeLayers 获取刚复制的图层。
                            app.activeDocument = templateDoc;
                            const copiedLayer = templateDoc.activeLayers?.[0];
                            const newLayerId = copiedLayer?.id;

                            if (!newLayerId) {
                                console.warn(`[SKULayout]   ⚠️ 复制失败: ${colorName}`);
                                continue;
                            }

                            // ★★★ 诊断：验证图层位置是否在顶层 ★★★
                            const layerParent = copiedLayer?.parent;
                            if (layerParent && layerParent !== templateDoc) {
                                console.error(`[SKULayout]   ⚠️ 警告: 图层 "${colorName}" 不在顶层，父级是 "${layerParent.name || 'unknown'}"`);
                            } else {
                                console.log(`[SKULayout]   ✓ 确认: 图层 "${colorName}" 在文档顶层`);
                            }

                            regionLayerIds.push(newLayerId);
                            allNoteLayerIds.push(newLayerId);
                            console.log(`[SKULayout]   ✓ 复制: ${colorName} -> ID: ${newLayerId}`);

                            if (config.autoLayoutWithoutPlaceholders) {
                                console.log(`[SKULayout]     无占位符模式：保留 ${colorName} 的复制后原始边界，交给自动排版计划统一缩放和定位`);
                                continue;
                            }

                            // 获取图层 bounds 并执行缩放
                            const layer = templateDoc.activeLayers?.[0];
                            if (!layer?.bounds) continue;

                            const b = layer.bounds;
                            const layerLeft = b._left ?? b[0]?.value ?? b[0] ?? 0;
                            const layerTop = b._top ?? b[1]?.value ?? b[1] ?? 0;
                            const layerRight = b._right ?? b[2]?.value ?? b[2] ?? 0;
                            const layerBottom = b._bottom ?? b[3]?.value ?? b[3] ?? 0;
                            const layerWidth = layerRight - layerLeft;
                            const layerHeight = layerBottom - layerTop;

                            // 等比缩放到整个占位组范围内，确保素材完全落在占位组内。
                            let scaleFactor: number;
                            const scaleX = targetWidth / layerWidth;
                            const scaleY = targetHeight / layerHeight;

                            // type 3: 等比缩放，完全在矩形内
                            if (layerWidth > layerHeight) {
                                // 宽图：检查高度是否超出
                                if (scaleX * layerHeight > targetHeight) {
                                    scaleFactor = scaleY;  // 以高度为准
                                } else {
                                    scaleFactor = scaleX;  // 以宽度为准
                                }
                            } else {
                                // 高图：检查宽度是否超出
                                if (scaleY * layerWidth > targetWidth) {
                                    scaleFactor = scaleX;  // 以宽度为准
                                } else {
                                    scaleFactor = scaleY;  // 以高度为准
                                }
                            }

                            const scalePercent = scaleFactor * 100;

                            if (scalePercent < 99 || scalePercent > 101) {
                                await action.batchPlay([{
                                    _obj: 'transform',
                                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                                    width: { _unit: 'percentUnit', _value: scalePercent },
                                    height: { _unit: 'percentUnit', _value: scalePercent },
                                    interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                console.log(`[SKULayout]     缩放: ${scalePercent.toFixed(1)}%`);
                            }

                            // 将复制图层对齐到当前占位组。
                            const newBounds = templateDoc.activeLayers?.[0]?.bounds;
                            if (newBounds) {
                                const nb = newBounds;
                                const newLeft = nb._left ?? nb[0]?.value ?? nb[0] ?? 0;
                                const newTop = nb._top ?? nb[1]?.value ?? nb[1] ?? 0;
                                const newRight = nb._right ?? nb[2]?.value ?? nb[2] ?? 0;
                                const newBottom = nb._bottom ?? nb[3]?.value ?? nb[3] ?? 0;
                                const newWidth = newRight - newLeft;
                                const newHeight = newBottom - newTop;

                                let targetX: number;
                                const targetY = placeholderCenterY - newHeight / 2;  // 垂直居中

                                if (regionColorCount === 1) {
                                    // 单颜色：水平居中 (type2=5)
                                    targetX = placeholderCenterX - newWidth / 2;
                                } else if (colorIdx === 0) {
                                    // 第一个：左对齐 (type2=4)
                                    targetX = placeholderRect.left;
                                } else if (colorIdx === regionColorCount - 1) {
                                    // 最后一个：右对齐 (type2=6)
                                    targetX = placeholderRect.right - newWidth;
                                } else {
                                    // ★ 中间颜色：先居中到占位区域
                                    // 多颜色兼容路径后续会统一执行水平分布。
                                    targetX = placeholderCenterX - newWidth / 2;
                                }

                                const deltaX = targetX - newLeft;
                                const deltaY = targetY - newTop;

                                const activeLayer = templateDoc.activeLayers?.[0];
                                await translateLayer(activeLayer, deltaX, deltaY);

                                console.log(`[SKULayout]     移动: (${(newLeft + deltaX).toFixed(0)}, ${(newTop + deltaY).toFixed(0)})`);
                                hideSkuReplacementPlaceholder(placeholder.layer);
                                console.log(`[SKULayout]   ✅ 颜色 ${colorName} 处理完成`);
                            }
                        } catch (err: any) {
                            console.warn(`[SKULayout]   处理 ${colorName} 失败: ${formatSkuLayoutCaughtError(err)}`);
                        }
                    }

                    if (config.autoLayoutWithoutPlaceholders) {
                        console.log(`[SKULayout]   无占位符模式：跳过自选备注旧水平分布，稍后由自动排版计划统一处理`);
                    } else if (regionLayerIds.length >= 3) {
                        console.log(`[SKULayout]   执行水平分布 (${regionLayerIds.length} 个图层)...`);

                        try {
                            // 选中第一个
                            await action.batchPlay([{
                                _obj: 'select',
                                _target: [{ _ref: 'layer', _id: regionLayerIds[0] }],
                                makeVisible: false,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                            // 添加其他到选区
                            for (let i = 1; i < regionLayerIds.length; i++) {
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: regionLayerIds[i] }],
                                    selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' },
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                            }

                            // 执行水平居中分布 (ADSCentersH)
                            await action.batchPlay([{
                                _obj: 'distort',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                using: { _enum: 'ADSt', _value: 'ADSCentersH' },
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                            console.log(`[SKULayout]   ✓ 水平分布完成`);
                        } catch (err: any) {
                            // 分布命令失败时静默忽略（与 JSX 行为一致）
                            console.warn(`[SKULayout]   水平分布跳过: ${formatSkuLayoutCaughtError(err)}`);
                        }
                    } else if (regionLayerIds.length === 2) {
                        // ★ 2 个图层：不执行分布，使用左右对齐（上面已通过 duqi 逻辑处理）
                        console.log(`[SKULayout]   2 个图层：使用左右对齐替代分布（第一个左对齐，最后一个右对齐）`);
                    } else if (regionLayerIds.length === 1) {
                        console.log(`[SKULayout]   1 个图层：居中对齐（已处理）`);
                    }

                    console.log(`[SKULayout] ===== 槽位 ${regionIdx + 1} 处理完成 =====`);
                }

                if (config.autoLayoutWithoutPlaceholders && allNoteLayerIds.length >= 1) {
                    console.log(`[SKULayout] 🎯 自选备注使用无占位符自动排版模式...`);

                    const plannerItems = allNoteLayerIds
                        .map((layerId): SkuAutoLayoutItem | null => {
                            const layer = findLayerById(templateDoc.layers, layerId);
                            const bounds = getLayerBoundsRect(layer);
                            if (!layer || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
                            const subjectBounds = getSkuAutoLayoutSubjectBounds(layer) ?? undefined;
                            return {
                                id: String(layerId),
                                layerId,
                                name: layer.name || String(layerId),
                                bounds,
                                subjectBounds
                            };
                        })
                        .filter(isSkuAutoLayoutItem);

                    const plannerObstacles = autoLayoutObstacles;

                    const actualNoteAutoLayoutPlan = buildSkuAutoLayoutPlan({
                        canvas: { width: Number(canvasWidth), height: Number(canvasHeight) },
                        items: plannerItems,
                        obstacles: plannerObstacles,
                        preset: 'sku-note',
                        strategy: 'auto'
                    });

                    noteAutoLayoutPlans.push({
                        status: actualNoteAutoLayoutPlan.status,
                        strategy: actualNoteAutoLayoutPlan.strategy,
                        placements: actualNoteAutoLayoutPlan.placements.length,
                        blockers: actualNoteAutoLayoutPlan.diagnostics.blockers,
                        warnings: actualNoteAutoLayoutPlan.diagnostics.warnings,
                        summary: actualNoteAutoLayoutPlan.diagnostics.summary
                    });

                    if (actualNoteAutoLayoutPlan.status === 'blocked') {
                        const summaryDiagnostic = formatSkuAutoLayoutSummaryDiagnostic(actualNoteAutoLayoutPlan);
                        throw new Error([
                            `自选备注无占位符自动排版失败：${actualNoteAutoLayoutPlan.diagnostics.blockers.join('；')}`,
                            summaryDiagnostic
                        ].filter(Boolean).join('；'));
                    }

                    const appliedNotePlan = await applySkuAutoLayoutPlan(templateDoc, actualNoteAutoLayoutPlan, {
                        obstacles: plannerObstacles
                    });
                    const autoLayoutQa = appliedNotePlan.autoLayoutQa;
                    noteAutoLayoutPlans[noteAutoLayoutPlans.length - 1].autoLayoutQa = autoLayoutQa;
                    if (appliedNotePlan.warnings.length > 0) {
                        console.warn(`[SKULayout] 自选备注无占位符自动排版警告: ${appliedNotePlan.warnings.join('；')}`);
                    }
                    if (autoLayoutQa.status === 'blocked') {
                        throw new Error(`自选备注无占位符自动排版执行后校验失败：${autoLayoutQa.blockers.join('；')}`);
                    }
                    console.log(`[SKULayout] ✅ 自选备注无占位符自动排版完成: ${appliedNotePlan.applied}/${actualNoteAutoLayoutPlan.placements.length}`);
                }

                // ★ 使用占位符逻辑已完成缩放和对齐，无需再编组缩放
                console.log(`[SKULayout] ✅ 排列完成 (顺序占位替换模式)`);

            }, { commandName: '自选备注动态排列' });

            // 5. 导出到临时目录
            const exportResult = await this.exportNoteTemplate({
                outputDir: config.outputDir,
                format: config.format,
                quality: config.quality,
                noteFileName: config.noteFileName
            });

            if (!exportResult.success || exportResult.data?.closeWarning) {
                await cleanupCopiedSkuLayersAfterModal(noteLayerIdsForCleanup, '清理自选备注复制图层');
            }

            if (exportResult.success && noteAutoLayoutPlans.length > 0) {
                return {
                    ...exportResult,
                    data: {
                        ...(exportResult.data || {}),
                        noteAutoLayoutPlans
                    }
                };
            }

            return exportResult;

        } catch (error: any) {
            if (this.isCancellationError(error)) {
                return this.buildCancelledResult();
            }
            console.error(`[SKULayout] 自选备注动态排列失败:`, error);
            await cleanupCopiedSkuLayersAfterModal(noteLayerIdsForCleanup, '清理失败的自选备注复制图层');
            const placeholderMismatch = extractSkuPlaceholderMismatchData(error);
            return {
                success: false,
                error: formatSkuLayoutCaughtError(error),
                data: placeholderMismatch ? { placeholderMismatch } : null
            };
        }
    }

    /**
     * 导出自选备注模板
     *
     * ★★★ 最优方案：强制使用临时目录 + Electron 复制 ★★★
     * 使用临时目录 + Electron 复制，降低 UXP 文件入口处理复杂度
     * Agent 端（Node.js）负责把已导出的临时文件复制到目标目录
     */
    private async exportNoteTemplate(config: {
        outputDir?: string;
        format: string;
        quality: number;
        noteFileName: string;
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        // 前置校验
        const templateDoc = app.activeDocument;
        if (!templateDoc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        if (!config.outputDir) {
            return { success: false, error: '必须指定输出目录 (outputDir)', data: null };
        }

        console.log(`[SKULayout] ★ 自选备注导出`);
        console.log(`[SKULayout]   文档: ${templateDoc.name}`);
        console.log(`[SKULayout]   输出文件名: ${config.noteFileName}`);
        console.log(`[SKULayout]   目标目录: ${config.outputDir}`);

        const templateName = templateDoc.name.replace(/\.[^.]+$/, '');
        const outputFileName = config.noteFileName;
        const targetDir = `${config.outputDir}\\${templateName}`;
        const fullPath = `${targetDir}\\${outputFileName}.jpg`;

        // 使用 JSX 脚本保存（通过 token/临时 JSX 完成受控保存）
        const saveSuccess = await saveAsJPEGViaJSX(fullPath, config.quality);

        if (!saveSuccess) {
            return {
                success: false,
                error: `JSX 保存失败: ${fullPath}`,
                data: null
            };
        }

        console.log(`[SKULayout] ✅ 导出成功: ${fullPath}`);

        // 关闭自选备注模板文档（不保存修改，与组合模板一致）。
        // Photoshop 在 JSX 保存后偶发进入 modal state；导出已经成功时，关闭失败不应覆盖任务结果。
        const templateNameForClose = templateDoc.name;
        let closeWarning: string | undefined;
        try {
            await core.executeAsModal(async () => {
                await (templateDoc as any).closeWithoutSaving();
            }, { commandName: '关闭自选备注模板文档' });
            console.log(`[SKULayout] ✅ 已关闭自选备注模板文档: ${templateNameForClose}`);
        } catch (closeError: any) {
            closeWarning = `导出成功，但关闭自选备注模板失败: ${closeError?.message || closeError}`;
            console.warn(`[SKULayout] ${closeWarning}`);
        }

        return {
            success: true,
            data: {
                exportedCount: 1,
                exportedFiles: [JSON.stringify({
                    path: fullPath,
                    targetName: `${outputFileName}.jpg`,
                    status: 'exported_jsx'
                })],
                outputDir: config.outputDir,
                closeWarning
            }
        };
    }

    /**
     * 执行 SKU 组合排版
     *
     * 6.3 核心流程：
     * 1. 识别 SKU 素材文档（包含颜色图层组）和模板文档（包含占位图层）
     * 2. 遍历每个颜色组合
     * 3. 对于每个组合：
     *    a. 获取模板中的占位图层（作为目标区域）
     *    b. 从 SKU 素材复制对应颜色图层组到模板
     *    c. 缩放图层以适应目标区域
     *    d. 对齐图层（左对齐/居中/右对齐）
     *    e. 水平分布所有图层
     * 4. 导出为 JPEG
     * 5. 恢复模板（删除复制的图层）
     */
    /**
     * 执行 SKU 组合排版
     *
     * 正确的工作流程：
     * 1. 打开 SKU 素材文件 → 获取颜色列表
     * 2. 规划颜色组合 → AI/用户决定
     * 3. 打开对应的模板 → 根据组合数量选择模板（2双、3双、4双...）
     * 4. 执行排版 → 复制颜色图层到模板占位区域
     * 5. 导出图片 → 保存 JPEG
     */
    private async executeComboLayout(config: {
        combos: string[][];      // 颜色组合列表
        outputDir?: string;      // 输出目录
        format: string;          // 输出格式
        quality: number;         // JPEG 质量
        skuDocName?: string;     // 明确指定 SKU 素材文档名称
        templateDocName?: string; // 明确指定模板文档名称
        autoLayoutWithoutPlaceholders?: boolean; // 无占位符自动排版
        regionCapacities?: number[]; // 6.0 多矩形区域按面板顺序的容量计划
        noteFilePrefix?: string;   // 自选备注文件名前缀（如"2双自选备注"）
        isNoteTemplate?: boolean;  // ★ 是否为自选备注模式（影响文件命名和目录结构）
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        if (!config.combos || config.combos.length === 0) {
            return { success: false, error: '没有提供颜色组合', data: null };
        }

        try {
            // 列出所有打开的文档
            const allDocs: Array<{ name: string; width: number; height: number }> = [];
            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                allDocs.push({
                    name: doc.name,
                    width: doc.width,
                    height: doc.height
                });
            }
            console.log(`[SKULayout] ==================== 开始执行 ====================`);
            console.log(`[SKULayout] 打开的文档 (${allDocs.length} 个):`);
            allDocs.forEach((d, i) => console.log(`[SKULayout]   ${i + 1}. ${d.name} (${d.width}x${d.height})`));
            console.log(`[SKULayout] 待处理组合: ${config.combos.length} 个`);
            config.combos.forEach((c, i) => console.log(`[SKULayout]   ${i + 1}. ${c.join(' + ')}`));

            // 1. 识别 SKU 素材文档
            let skuDoc: any = null;

            // 如果明确指定了名称，直接查找
            if (config.skuDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.skuDocName) {
                        skuDoc = app.documents[i];
                        break;
                    }
                }
            }

            // 否则按关键词查找
            if (!skuDoc) {
            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                const name = (doc.name || '').toLowerCase();
                if (name.includes('sku') || name.includes('素材')) {
                    skuDoc = doc;
                        break;
                    }
                }
            }

            if (!skuDoc) {
                return {
                    success: false,
                    error: `未找到 SKU 素材文档。\n\n当前打开的文档: ${allDocs.map(d => d.name).join(', ')}\n\n请先打开 SKU 素材文件（名称通常包含 "SKU"）。`,
                    data: null
                };
            }

            console.log(`[SKULayout] ✓ SKU 素材: ${skuDoc.name}`);

            // 2. 识别模板文档
            // ★ 修复：优先使用 app.activeDocument（Agent 已切换到正确的模板）
            // 只有当 activeDocument 是 SKU 素材时，才自动查找其他模板
            let templateDoc: any = null;
            const firstComboSize = config.combos[0]?.length || 2;

            // ★ 优先使用当前活动文档作为模板
            // Agent 端已经通过 switchDocument 切换到了正确的模板
            const activeDoc = app.activeDocument;
            const activeDocName = (activeDoc?.name || '').toLowerCase();

            // 如果当前活动文档不是 SKU 素材，就用它作为模板
            if (activeDoc && !activeDocName.includes('sku') && !activeDocName.includes('素材')) {
                templateDoc = activeDoc;
                console.log(`[SKULayout] ★ 使用当前活动文档作为模板: ${templateDoc.name}`);
            }

            // 如果明确指定了名称，覆盖查找
            if (config.templateDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.templateDocName) {
                        templateDoc = app.documents[i];
                        console.log(`[SKULayout] ✓ 使用指定模板: ${templateDoc.name}`);
                        break;
                    }
                }
            }

            // 只有在没有找到模板时，才按组合数量自动查找
            if (!templateDoc) {
                console.log(`[SKULayout] 根据组合数量 ${firstComboSize} 查找对应模板...`);

                const sizeStr = String(firstComboSize);

                for (let i = 0; i < app.documents.length; i++) {
                    const doc = app.documents[i];
                    const name = (doc.name || '').toLowerCase();

                    // 跳过 SKU 素材
                    if (name.includes('sku') || name.includes('素材')) {
                        continue;
                    }

                    // 查找包含对应数量的模板（精确匹配）
                    if (name.includes(sizeStr + '双装') ||
                        name.includes(sizeStr + '双模板') ||
                        name.includes(sizeStr + '双') ||
                        name.includes(sizeStr + '个')) {
                        templateDoc = doc;
                        console.log(`[SKULayout] ✓ 找到模板: ${doc.name}`);
                        break;
                    }
                }
            }

            // 如果还没找到，提示用户需要打开模板
            if (!templateDoc) {
                const templateSuggestion = `${firstComboSize}双模板` ;
                return {
                    success: false,
                    error: `未找到 ${firstComboSize} 双的模板文档。\n\n当前打开的文档: ${allDocs.map(d => d.name).join(', ')}\n\n请打开对应的模板文件（如 "${templateSuggestion}.psd" 或 "${firstComboSize}双自选备注.tif"）。`,
                    data: null
                };
            }

            console.log(`[SKULayout] ✓ 模板: ${templateDoc.name} (${templateDoc.width}x${templateDoc.height})`);
            console.log(`[SKULayout] ====================================================`);
            console.log(`[SKULayout] 待处理组合: ${config.combos.length} 个`);

            const exportedFiles: string[] = [];
            const errors: string[] = [];
            const placeholderMismatches: SkuPlaceholderMismatchData[] = [];
            const autoLayoutPlans: any[] = [];
            const templateLayoutPlans: Array<{
                comboIndex: number;
                mode: SkuTemplateLayoutInspectionMode | 'auto_without_placeholders';
                regionCapacities: number[];
                assignments: string[][];
            }> = [];
            const usedComboOutputFileNames = new Set<string>();

            this.progress = {
                current: 0,
                total: config.combos.length,
                message: '开始处理...'
            };

            // 获取图层边界。
            const getBounds = (layer: any): { left: number; top: number; width: number; height: number } => {
                const b = layer.bounds;

                // Photoshop bounds 格式：[left, top, right, bottom] 或 { left, top, right, bottom }
                let left: number, top: number, right: number, bottom: number;

                if (Array.isArray(b) && b.length >= 4) {
                    left = b[0]?.value ?? b[0];
                    top = b[1]?.value ?? b[1];
                    right = b[2]?.value ?? b[2];
                    bottom = b[3]?.value ?? b[3];
                } else {
                    left = b._left ?? b.left;
                    top = b._top ?? b.top;
                    right = b._right ?? b.right;
                    bottom = b._bottom ?? b.bottom;
                }

                return { left, top, width: right - left, height: bottom - top };
            };

            // 2. 遍历每个组合
            for (let comboIndex = 0; comboIndex < config.combos.length; comboIndex++) {
                this.throwIfCancelled();
                const combo = config.combos[comboIndex];
                const comboSize = combo.length;

                this.progress = {
                    current: comboIndex + 1,
                    total: config.combos.length,
                    message: `处理第 ${comboIndex + 1}/${config.combos.length} 个: ${combo.join('+')}`
                };

                const comboLayerIdsForCleanup: number[] = [];

                try {
                    console.log(`[SKULayout] === 开始处理组合 ${comboIndex + 1} ===`);
                    console.log(`[SKULayout]   组合内容: ${combo.join(' + ')}`);
                    console.log(`[SKULayout]   模板文档: ${templateDoc?.name || 'undefined'}`);
                    console.log(`[SKULayout]   SKU文档: ${skuDoc?.name || 'undefined'}`);

                    await core.executeAsModal(async () => {
                        app.activeDocument = templateDoc;

                        const allLayers = templateDoc.layers || [];
                        const autoLayoutObstacles: SkuAutoLayoutObstacle[] = config.autoLayoutWithoutPlaceholders
                            ? collectVisibleSkuTemplateObstacles(Array.from(allLayers), templateDoc)
                            : [];

                        console.log(`[SKULayout] 模板顶层图层数: ${allLayers.length}`);

                        let orderedPlaceholderInfo: SkuReplacementPlaceholder[] = [];
                        if (config.autoLayoutWithoutPlaceholders) {
                            console.log(`[SKULayout] 无占位符自动排版：${autoLayoutObstacles.length} 个递归可见前景图层将作为避让元素，不作为占位符`);
                        } else {
                            orderedPlaceholderInfo = collectOrderedSkuReplacementPlaceholders(templateDoc);
                            console.log(`[SKULayout] 顺序占位组（按图层面板顺序）:`);
                            orderedPlaceholderInfo.forEach((placeholder, idx) => {
                                console.log(`[SKULayout]   ${idx + 1}. ${placeholder.name} (${Math.round(placeholder.width)}x${Math.round(placeholder.height)})`);
                            });
                            if (orderedPlaceholderInfo.length === 0) {
                                throw createSkuPlaceholderMismatchError({
                                    headline: `占位槽数量-${orderedPlaceholderInfo.length} 与配色顺序数量-${comboSize} 不匹配：${combo.join('+')}。`,
                                    templateDoc,
                                    slotCount: orderedPlaceholderInfo.length,
                                    requiredCount: comboSize,
                                    combo
                                });
                            }
                        }

                        const sortedPlaceholderInfo: SkuReplacementPlaceholder[] = config.autoLayoutWithoutPlaceholders
                            ? [{
                                layer: null as any,
                                name: '画布',
                                left: 0,
                                top: Number(templateDoc.height) * 0.05,
                                right: Number(templateDoc.width),
                                bottom: Number(templateDoc.height) * 0.95,
                                width: Number(templateDoc.width),
                                height: Number(templateDoc.height) * 0.9
                            }]
                            : orderedPlaceholderInfo;
                        const inspectionMode = config.autoLayoutWithoutPlaceholders
                            ? 'auto_without_placeholders' as const
                            : resolveSkuTemplateLayoutInspectionMode(templateDoc, orderedPlaceholderInfo);
                        if (
                            inspectionMode === 'ordered_slots'
                            && orderedPlaceholderInfo.length !== comboSize
                        ) {
                            throw createSkuPlaceholderMismatchError({
                                headline: `顺序占位槽数量-${orderedPlaceholderInfo.length} 与配色顺序数量-${comboSize} 不匹配：${combo.join('+')}。`,
                                templateDoc,
                                slotCount: orderedPlaceholderInfo.length,
                                requiredCount: comboSize,
                                combo
                            });
                        }
                        const regionCapacities = config.autoLayoutWithoutPlaceholders
                            ? [comboSize]
                            : resolveSkuRegionCapacities({
                                mode: inspectionMode,
                                slotCount: orderedPlaceholderInfo.length,
                                comboSize,
                                requested: config.regionCapacities
                            });
                        let assignmentCursor = 0;
                        const regionColorAssignments = regionCapacities.map((capacity) => {
                            const colors = combo.slice(assignmentCursor, assignmentCursor + capacity);
                            assignmentCursor += capacity;
                            return colors;
                        });
                        templateLayoutPlans.push({
                            comboIndex,
                            mode: inspectionMode,
                            regionCapacities: [...regionCapacities],
                            assignments: regionColorAssignments.map((colors) => [...colors])
                        });

                        console.log(`[SKULayout] 占位顺序映射:`);
                        sortedPlaceholderInfo.forEach((p, i) => {
                            const regionColors = regionColorAssignments[i] || [];
                            console.log(`[SKULayout]   ${i + 1}: ${p.name || '画布'} → ${regionColors.join(' + ')}`);
                        });

                        // 收集所有复制的图层 ID（用于最后清理）
                        const allCopiedLayerIds = comboLayerIdsForCleanup;
                        const allCopiedLayers: any[] = [];

                        // ★★★ 双层循环：遍历每个占位矩形 ★★★
                        for (let placeholderIdx = 0; placeholderIdx < sortedPlaceholderInfo.length; placeholderIdx++) {
                            this.throwIfCancelled();
                            const placeholderInfo = sortedPlaceholderInfo[placeholderIdx];

                            // 6.3 一槽一色与 6.0 区域多色都消费同一份显式区域分配计划。
                            const regionColors = regionColorAssignments[placeholderIdx] || [];

                            if (regionColors.length === 0) {
                                console.log(`[SKULayout] 跳过空区域 ${placeholderIdx + 1}`);
                                continue;
                            }

                            console.log(`[SKULayout] ===== 处理区域 ${placeholderIdx + 1}/${sortedPlaceholderInfo.length} =====`);
                            console.log(`[SKULayout]   占位矩形: ${placeholderInfo.layer?.name || '画布'}`);
                            console.log(`[SKULayout]   颜色: ${regionColors.join(' + ')}`);

                            const placeholderRect = {
                                left: placeholderInfo.left,
                                top: placeholderInfo.top,
                                width: placeholderInfo.width,
                                height: placeholderInfo.height
                            };

                            // 当前区域的复制图层 ID（用于水平分布）
                            const regionLayerIds: number[] = [];

                            // 遍历该区域的每个颜色
                            for (let colorIdx = 0; colorIdx < regionColors.length; colorIdx++) {
                                this.throwIfCancelled();
                                const colorName = regionColors[colorIdx];
                                if (!colorName) continue;

                                const targetRect = {
                                    left: placeholderRect.left,
                                    top: placeholderRect.top,
                                    width: placeholderRect.width,
                                    height: placeholderRect.height
                                };

                                console.log(`[SKULayout]   颜色 ${colorIdx + 1}/${regionColors.length}: ${colorName}`);
                                const targetPlaceholder = placeholderInfo.layer;

                            // 在 SKU 文档中找到对应的颜色【图层组】（不是普通图层！）
                            // SKU 素材的结构是：每个颜色是一个图层组，包含主体、阴影、文字等子图层
                            app.activeDocument = skuDoc;

                            // UXP API: 从 layers 中过滤出图层组（有 layers 子属性的就是图层组）
                            // 安全检查：确保 skuDoc.layers 存在
                            const skuLayers = skuDoc.layers || [];
                            if (!skuLayers || skuLayers.length === 0) {
                                console.error(`[SKULayout] SKU 文档没有图层！`);
                                continue;
                            }
                            const availableGroups: string[] = [];

                            console.log(`[SKULayout] 在 SKU 文档中查找颜色图层组: "${colorName}"`);

                            const allGroups = collectSkuLayerGroups(Array.from(skuLayers));
                            availableGroups.push(...allGroups.map((entry) => entry.path || entry.name));
                            const matchedGroup = findSkuLayerGroupByName(Array.from(skuLayers), colorName);
                            const colorSet: any = matchedGroup?.layer || null;
                            if (colorSet) {
                                console.log(`[SKULayout] ✓ 找到颜色图层组: "${matchedGroup?.path || colorName}" (子图层: ${colorSet.layers.length})`);
                            }

                            if (!colorSet) {
                                console.warn(`[SKULayout] ✗ 未找到颜色图层组: "${colorName}"`);
                                console.warn(`[SKULayout]   可用的图层组: ${availableGroups.join(', ')}`);
                                continue;
                            }

                            // 复制颜色图层组到模板（使用参考脚本的方式）
                            try {
                                console.log(`[SKULayout] 准备复制图层组 "${colorName}" (ID: ${colorSet.id}) 到模板 "${templateDoc.name}"`);

                                // 复制前先激活模板占位组，避免 duplicate 把新图层放入错误父级。
                                // 步骤 1：切换到模板文档，选中当前占位组
                                app.activeDocument = templateDoc;
                                if (placeholderInfo.layer?.id) {
                                    await action.batchPlay([{
                                        _obj: 'select',
                                        _target: [{ _ref: 'layer', _id: placeholderInfo.layer.id }],
                                        makeVisible: false,
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }], { synchronousExecution: true });
                                    console.log(`[SKULayout] 准备: 选中模板占位矩形 "${placeholderInfo.layer.name}"`);
                                }

                                // 步骤 2：切换到 SKU 文档并选中图层组
                                app.activeDocument = skuDoc;

                                // 记录复制前模板的图层数
                                const layerCountBefore = templateDoc.layers.length;

                                // 使用 batchPlay select 选中图层组
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: colorSet.id }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });

                                // 步骤 3：使用参考脚本的 copylay 方法复制
                            await action.batchPlay([{
                                _obj: 'duplicate',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'document', _name: templateDoc.name },
                                    version: 5,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                                // 复制后切回模板文档，并从 activeLayers 获取刚复制的图层。
                            app.activeDocument = templateDoc;

                                // 检查图层数是否增加
                                const layerCountAfter = templateDoc.layers.length;
                                console.log(`[SKULayout] 复制后图层数: ${layerCountBefore} → ${layerCountAfter}`);

                                // ★★★ 修复：使用 activeLayers[0] 获取刚复制的图层 ★★★
                                // 与 JSX 的 doc.activeLayer 行为一致
                                let copiedLayer: any = templateDoc.activeLayers?.[0];

                                // 验证是否真的是刚复制的图层
                                if (copiedLayer) {
                                    console.log(`[SKULayout] 通过 activeLayers 获取: ${copiedLayer.name} (ID: ${copiedLayer.id})`);

                                    // 安全检查：确认是新增的图层，而非原有图层
                                    // 如果名称匹配则确认
                                    const nameMatch = copiedLayer.name === colorName || copiedLayer.name === colorSet.name;
                                    if (!nameMatch && layerCountAfter <= layerCountBefore) {
                                        console.warn(`[SKULayout] 警告: activeLayers 返回的图层名不匹配，尝试按名称查找`);
                                        copiedLayer = null;
                                    }
                                }

                                // 回退：如果 activeLayers 不可靠，按名称查找
                                if (!copiedLayer) {
                                    for (let li = 0; li < templateDoc.layers.length; li++) {
                                        const layer = templateDoc.layers[li];
                                        if (layer.name === colorName || layer.name === colorSet.name) {
                                            copiedLayer = layer;
                                            console.log(`[SKULayout] 通过名称查找: ${copiedLayer.name}`);
                                            break;
                                        }
                                    }
                                }

                                // 最后回退：取最顶部的新图层
                                if (!copiedLayer && layerCountAfter > layerCountBefore) {
                                    copiedLayer = templateDoc.layers[0];
                                    console.log(`[SKULayout] 使用顶部图层: ${copiedLayer.name}`);
                                }

                                if (!copiedLayer) {
                                    console.warn(`[SKULayout] 复制图层组失败: ${colorName} - 无法在模板中找到`);
                                    continue;
                                }

                                // ★★★ 诊断：验证图层位置是否在顶层 ★★★
                                // 检查 parent 属性，如果是 null 或 document，说明在顶层
                                const layerParent = copiedLayer.parent;
                                if (layerParent && layerParent !== templateDoc) {
                                    console.error(`[SKULayout] ⚠️ 警告: 图层 "${copiedLayer.name}" 不在顶层，父级是 "${layerParent.name || 'unknown'}"`);
                                } else {
                                    console.log(`[SKULayout] ✓ 确认: 图层 "${copiedLayer.name}" 在文档顶层`);
                                }

                                // 验证是否是图层组
                                const isGroup = copiedLayer.layers && copiedLayer.layers.length > 0;
                                console.log(`[SKULayout] ✓ 复制成功: ${colorName} (ID: ${copiedLayer.id}, 是图层组: ${isGroup}, 子图层: ${isGroup ? copiedLayer.layers.length : 0})`);

                                // ★ 添加到区域图层列表和全局列表
                                regionLayerIds.push(copiedLayer.id);
                                allCopiedLayerIds.push(copiedLayer.id);
                                allCopiedLayers.push(copiedLayer);

                                // 获取复制图层的边界
                                const layerBounds = getBounds(copiedLayer);
                                if (!layerBounds || layerBounds.width <= 0 || layerBounds.height <= 0) {
                                    console.warn(`[SKULayout] 无法获取图层边界: ${colorName}`);
                                    continue;
                                }

                                if (config.autoLayoutWithoutPlaceholders) {
                                    console.log(`[SKULayout] 无占位符模式：保留 ${colorName} 的复制后原始边界，交给自动排版计划统一缩放和定位`);
                                } else {
                                    // 缩放图层以适应目标区域，确保图层完全包含在占位组内。
                                    const scaleX = targetRect.width / layerBounds.width;
                                    const scaleY = targetRect.height / layerBounds.height;

                                    // contain 模式：如果图层宽>高，优先按宽度；如果图层高>宽，优先按高度，并避免另一边超出。
                                    let scale: number;
                                    if (layerBounds.width > layerBounds.height) {
                                        // 宽图层：优先按宽度缩放，但不能超出高度
                                        if (scaleX * layerBounds.height > targetRect.height) {
                                            scale = scaleY;  // 按高度缩放
                                        } else {
                                            scale = scaleX;  // 按宽度缩放
                                        }
                                    } else {
                                        // 高图层：优先按高度缩放，但不能超出宽度
                                        if (scaleY * layerBounds.width > targetRect.width) {
                                            scale = scaleX;  // 按宽度缩放
                                        } else {
                                            scale = scaleY;  // 按高度缩放
                                        }
                                    }

                                    // 6.3 顺序替换不额外留边距，直接适应占位组。
                                    console.log(`[SKULayout] 缩放计算: 图层 ${layerBounds.width.toFixed(0)}x${layerBounds.height.toFixed(0)} → 目标 ${targetRect.width.toFixed(0)}x${targetRect.height.toFixed(0)}, 比例 ${(scale * 100).toFixed(1)}%`);

                                    if (Math.abs(scale - 1) > 0.01) {
                                        // 使用 batchPlay 缩放（兼容图层组）
                                        await batchPlayResize(copiedLayer.id, scale * 100);
                                        console.log(`[SKULayout] ✓ 缩放 ${colorName}: ${(scale * 100).toFixed(1)}%`);
                                    }

                                    // 刷新图层引用以获取最新边界
                                    const refreshedLayer = templateDoc.layers.find((l: any) => l.id === copiedLayer.id);
                                    const afterBounds = refreshedLayer ? getBounds(refreshedLayer) : getBounds(copiedLayer);

                                    if (afterBounds) {
                                        // 6.3 默认一个槽位一个颜色；多颜色路径只作为低层兼容。

                                        // 占位矩形的关键点
                                        const placeholderLeft = targetRect.left;
                                        const placeholderRight = targetRect.left + targetRect.width;
                                        const placeholderCenterX = targetRect.left + targetRect.width / 2;
                                        const placeholderCenterY = targetRect.top + targetRect.height / 2;

                                        // 颜色图层的尺寸
                                        const layerCenterX = afterBounds.left + afterBounds.width / 2;
                                        const layerCenterY = afterBounds.top + afterBounds.height / 2;

                                        let offsetX: number;
                                        let offsetY: number;
                                        let alignType: string;

                                        // ★ 使用当前区域的颜色数量，而非整个 combo 的数量
                                        const regionColorCount = regionColors.length;

                                        if (regionColorCount === 1) {
                                            // 只有 1 个颜色：完全居中 (type2=5)
                                            offsetX = placeholderCenterX - layerCenterX;
                                            offsetY = placeholderCenterY - layerCenterY;
                                            alignType = '居中';
                                        } else if (colorIdx === 0) {
                                            // 第一个颜色：左对齐，垂直居中 (type2=4)
                                            offsetX = placeholderLeft - afterBounds.left;
                                            offsetY = placeholderCenterY - layerCenterY;
                                            alignType = '左对齐';
                                        } else if (colorIdx === regionColorCount - 1) {
                                            // 最后一个颜色：右对齐，垂直居中 (type2=6)
                                            offsetX = placeholderRight - (afterBounds.left + afterBounds.width);
                                            offsetY = placeholderCenterY - layerCenterY;
                                            alignType = '右对齐';
                                        } else {
                                            // 中间颜色：水平居中，垂直居中 (type2=5)
                                            offsetX = placeholderCenterX - layerCenterX;
                                            offsetY = placeholderCenterY - layerCenterY;
                                            alignType = '居中';
                                        }

                                        console.log(`[SKULayout] 对齐 [${alignType}]: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);

                                        if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
                                            await batchPlayTranslate(copiedLayer.id, offsetX, offsetY);
                                            console.log(`[SKULayout] ✓ 移动 ${colorName}: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
                                        }

                                        hideSkuReplacementPlaceholder(targetPlaceholder);
                                        console.log(`[SKULayout] ✅ 颜色 ${colorName} 处理完成`);
                                    }
                                }
                            } catch (copyErr: any) {
                                console.error(`[SKULayout] 复制图层异常: ${colorName} - ${copyErr.message}`);
                                continue;
                            }
                        }

                        console.log(`[SKULayout] ===== 槽位 ${placeholderIdx + 1} 定位收尾 =====`);

                        const validLayerIds = regionLayerIds.filter(id => id !== undefined && id !== null && !isNaN(id));

                        // ===== 无占位符自动排版模式 =====
                        if (config.autoLayoutWithoutPlaceholders && validLayerIds.length >= 1) {
                            console.log(`[SKULayout] 🎯 使用无占位符自动排版模式...`);

                            const canvasWidth = Number(templateDoc.width);
                            const canvasHeight = Number(templateDoc.height);
                            const plannerItems = validLayerIds
                                .map((layerId): SkuAutoLayoutItem | null => {
                                    const layer = findLayerById(templateDoc.layers, layerId);
                                    const bounds = getLayerBoundsRect(layer);
                                    if (!layer || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
                                    const subjectBounds = getSkuAutoLayoutSubjectBounds(layer) ?? undefined;
                                    return {
                                        id: String(layerId),
                                        layerId,
                                        name: layer.name || String(layerId),
                                        bounds,
                                        subjectBounds
                                    };
                                })
                                .filter(isSkuAutoLayoutItem);

                            const plannerObstacles = autoLayoutObstacles;

                            const actualAutoLayoutPlan = buildSkuAutoLayoutPlan({
                                canvas: { width: canvasWidth, height: canvasHeight },
                                items: plannerItems,
                                obstacles: plannerObstacles,
                                preset: config.isNoteTemplate ? 'sku-note' : 'sku-combo',
                                strategy: 'auto'
                            });

                            autoLayoutPlans.push({
                                comboIndex,
                                regionIndex: placeholderIdx,
                                status: actualAutoLayoutPlan.status,
                                strategy: actualAutoLayoutPlan.strategy,
                                placements: actualAutoLayoutPlan.placements.length,
                                blockers: actualAutoLayoutPlan.diagnostics.blockers,
                                warnings: actualAutoLayoutPlan.diagnostics.warnings,
                                summary: actualAutoLayoutPlan.diagnostics.summary
                            });

                            if (actualAutoLayoutPlan.status === 'blocked') {
                                const summaryDiagnostic = formatSkuAutoLayoutSummaryDiagnostic(actualAutoLayoutPlan);
                                throw new Error([
                                    `无占位符自动排版失败：${actualAutoLayoutPlan.diagnostics.blockers.join('；')}`,
                                    summaryDiagnostic
                                ].filter(Boolean).join('；'));
                            }

                            const appliedPlan = await applySkuAutoLayoutPlan(templateDoc, actualAutoLayoutPlan, {
                                obstacles: plannerObstacles
                            });
                            const autoLayoutQa = appliedPlan.autoLayoutQa;
                            autoLayoutPlans[autoLayoutPlans.length - 1].autoLayoutQa = autoLayoutQa;
                            if (appliedPlan.warnings.length > 0) {
                                console.warn(`[SKULayout] 无占位符自动排版警告: ${appliedPlan.warnings.join('；')}`);
                            }
                            if (autoLayoutQa.status === 'blocked') {
                                throw new Error(`无占位符自动排版执行后校验失败：${autoLayoutQa.blockers.join('；')}`);
                            }
                            console.log(`[SKULayout] ✅ 无占位符自动排版完成: ${appliedPlan.applied}/${actualAutoLayoutPlan.placements.length}`);
                        }
                        // ===== 传统分布模式 =====
                        // 只有 3 个或更多图层才执行"分布"命令
                        else if (validLayerIds.length >= 3) {
                            try {
                                console.log(`[SKULayout] 开始水平分布，有效图层数: ${validLayerIds.length}, IDs: ${validLayerIds.join(',')}`);

                                // 先选中第一个
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: validLayerIds[0] }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });

                                // 依次添加其他图层到选区
                                for (let i = 1; i < validLayerIds.length; i++) {
                                    await action.batchPlay([{
                                        _obj: 'select',
                                        _target: [{ _ref: 'layer', _id: validLayerIds[i] }],
                                        selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' },
                                        makeVisible: false,
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }], { synchronousExecution: true });
                                }

                                console.log(`[SKULayout] 图层已选中，准备执行分布...`);

                                // 执行 Photoshop 水平居中分布。
                                try {
                                    await action.batchPlay([{
                                        _obj: 'distort',  // JSX 脚本中用 'distort' 而非 'distribute'
                                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                        using: { _enum: 'ADSt', _value: 'ADSCentersH' },
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }], {
                                        synchronousExecution: true
                                    });
                                    console.log(`[SKULayout] ✅ 水平分布完成`);
                                } catch (distErr: any) {
                                    // 静默处理，与 JSX 脚本的 catch(e){} 行为一致
                                }
                            } catch (alignErr: any) {
                                console.warn(`[SKULayout] 水平分布处理失败:`, alignErr.message);
                            }
                        } else if (validLayerIds.length === 2) {
                            // 2 个图层：位置已在前面单独计算并设置，无需分布
                            console.log(`[SKULayout] ✅ 2 个图层已定位，跳过分布命令`);
                        } else {
                            console.log(`[SKULayout] 跳过分布（有效图层数不足: ${validLayerIds.length}）`);
                        }

                        console.log(`[SKULayout] ===== 槽位 ${placeholderIdx + 1} 处理完成 =====`);

                        } // ★★★ 结束占位矩形循环 ★★★

                        console.log(`[SKULayout] ★ 所有 ${sortedPlaceholderInfo.length} 个槽位处理完成，准备导出`);

                        // 获取模板名称（去掉扩展名）
                        const templateName = templateDoc.name.replace(/\.[^.]+$/, '');

                        // 构建输出文件名
                        // 如果是自选备注模式（isNoteTemplate），使用简化格式
                        let outputSubPath: string;
                        let outputFileName: string;

                        if (config.isNoteTemplate && config.noteFilePrefix) {
                            // ★ 自选备注模式：只导出 1 张图，不带序号
                            // 例如："4双自选备注" (直接使用前缀，颜色已经排列在模板上)
                            outputFileName = config.noteFilePrefix;
                            outputSubPath = `${templateName}/${outputFileName}`;
                            console.log(`[SKULayout] 自选备注文件名: ${outputFileName} (展示颜色: ${combo.join('+')})`);
                        } else if (config.noteFilePrefix) {
                            // 非自选备注但有前缀：使用前缀 + 序号
                            outputFileName = `${config.noteFilePrefix}-${comboIndex + 1}`;
                            outputSubPath = `${templateName}/${outputFileName}`;
                        } else {
                            // 普通组合模式：交付文件名只表达颜色组合，执行顺序留在日志和进度里。
                            outputFileName = buildSkuComboExportFileName(combo, comboIndex, usedComboOutputFileNames);
                            outputSubPath = `${templateName}/${outputFileName}`;
                        }

                        // 导出到当前任务目标目录
                        const quality = config.quality || 10;
                        app.activeDocument = templateDoc;

                        if (!config.outputDir) {
                            errors.push(`组合 ${comboIndex + 1}: 必须指定输出目录`);
                        } else {
                            const targetDir = `${config.outputDir}\\${templateName}`;
                            const fullPath = `${targetDir}\\${outputFileName}.jpg`;

                            // 使用 JSX 脚本保存（通过 token/临时 JSX 完成受控保存）
                            const saveSuccess = await saveAsJPEGViaJSX(fullPath, quality);

                            if (!saveSuccess) {
                                errors.push(`组合 ${comboIndex + 1}: JSX 保存失败 ${fullPath}`);
                            } else {
                                exportedFiles.push(JSON.stringify({
                                    path: fullPath,
                                    targetName: `${outputFileName}.jpg`,
                                    status: 'exported_jsx'
                                }));
                                console.log(`[SKULayout] ✅ 导出成功: ${fullPath}`);
                            }
                        }

                        // 清理复制的图层（恢复模板原状）。失败路径由外层 catch 再做清理，避免残留影响下一组。
                        const cleanupWarnings = await deleteCopiedSkuLayers(allCopiedLayerIds, `组合 ${comboIndex + 1} 清理复制图层`);
                        cleanupWarnings.forEach((warning) => console.warn(`[SKULayout] ${warning}`));

                    }, { commandName: `执行组合排版 ${comboIndex + 1}` });

                } catch (err: any) {
                    console.error(`[SKULayout] 处理组合 ${comboIndex + 1} 失败:`, err);
                    await cleanupCopiedSkuLayersAfterModal(comboLayerIdsForCleanup, `清理失败组合 ${comboIndex + 1} 的复制图层`);
                    const comboMismatch = extractSkuPlaceholderMismatchData(err);
                    if (comboMismatch) placeholderMismatches.push(comboMismatch);
                    errors.push(`组合 ${comboIndex + 1}: ${formatSkuLayoutCaughtError(err)}`);
                }
            }

            this.progress = {
                current: config.combos.length,
                total: config.combos.length,
                message: '完成'
            };

            // 关闭模板文档（不保存修改）
            const templateNameForClose = templateDoc.name;
            await core.executeAsModal(async () => {
                await templateDoc.closeWithoutSaving();
            }, { commandName: '关闭模板文档' });
            console.log(`[SKULayout] ✅ 已关闭模板文档: ${templateNameForClose}`);

            return {
                success: exportedFiles.length > 0,
                error: exportedFiles.length === 0
                    ? buildSkuLayoutPrimaryFailureReason({
                        errors,
                        autoLayoutPlans,
                        fallback: '未导出任何文件'
                    })
                    : undefined,
                data: {
                    exportedCount: exportedFiles.length,
                    exportedFiles,
                    errors: errors.length > 0 ? errors : undefined,
                    placeholderMismatches: placeholderMismatches.length > 0 ? placeholderMismatches : undefined,
                    templateLayoutPlans: templateLayoutPlans.length > 0 ? templateLayoutPlans : undefined,
                    autoLayoutPlans: autoLayoutPlans.length > 0 ? autoLayoutPlans : undefined,
                    outputDir: config.outputDir,
                    format: config.format,
                    quality: config.quality
                }
            };

        } catch (error: any) {
            if (this.isCancellationError(error)) {
                return this.buildCancelledResult();
            }
            console.error('[SKULayout] executeComboLayout 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 批量执行 SKU 排版
     */
    private async executeBatch(config?: {
        items: Array<{
            skuDocName: string;
            templateDocName: string;
            colorMappings: Array<{
                layerIndex: number;
                colorNames: string[];
            }>;
            outputName?: string;
        }>;
        outputPath?: string;
        quality?: number;
    }): Promise<ToolResult<any>> {
        if (!config || !config.items || config.items.length === 0) {
            return { success: false, error: '缺少批量配置', data: null };
        }

        const results: Array<{ index: number; success: boolean; message: string }> = [];
        this.progress = { current: 0, total: config.items.length, message: '开始批量处理...' };

        for (let i = 0; i < config.items.length; i++) {
            this.throwIfCancelled();
            this.progress = {
                current: i + 1,
                total: config.items.length,
                message: `处理第 ${i + 1}/${config.items.length} 个...`
            };

            const result = await this.executeOneSKU(i, {
                ...config.items[i],
                quality: config.quality
            });

            results.push({
                index: i,
                success: result.success,
                message: result.success ? '成功' : (result.error || '未知错误')
            });
        }

        const successCount = results.filter(r => r.success).length;
        this.progress = {
            current: config.items.length,
            total: config.items.length,
            message: `完成: ${successCount}/${config.items.length} 成功`
        };

        return {
            success: true,
            data: {
                total: config.items.length,
                successCount,
                failCount: config.items.length - successCount,
                results
            }
        };
    }
}

export default SKULayoutTool;
