import {
    buildSkuTemplateLayoutPlan,
    type SkuTemplateLayoutPlan
} from './sku-template-layout-plan';

export type SkuAutoLayoutExecutorAction = 'execute' | 'arrangeDynamic';

export type SkuAutoLayoutExecutorDecisionSource =
    | 'explicit_placeholder_mode'
    | 'explicit_no_placeholder_param'
    | 'project_or_parent_policy'
    | 'user_requested_no_placeholder'
    | 'template_has_reliable_placeholders'
    | 'template_has_no_reliable_placeholders'
    | 'default_placeholder_until_preflight';

export type SkuAutoLayoutExecutorDecision = {
    schema: 'sku-auto-layout-executor-policy/v0';
    action: SkuAutoLayoutExecutorAction;
    enabled: boolean;
    source: SkuAutoLayoutExecutorDecisionSource;
    reason: string;
    templateName?: string;
    boundaries: {
        writesPhotoshop: false;
        claimsDesignQuality: false;
        scorelessPolicy: true;
    };
};

type SkuAutoLayoutExecutorPolicyInput = {
    userInput?: unknown;
    params?: Record<string, unknown> | null;
    action: SkuAutoLayoutExecutorAction;
    templateDoc?: Record<string, unknown> | null;
};

export type SkuTemplatePlaceholderReliability = 'reliable' | 'legacy_reliable' | 'none' | 'unreliable' | 'unknown';

export type SkuTemplateLayoutPreflight = {
    schema: 'sku-template-layout-preflight/v0';
    templateName?: string;
    expectedItemCount?: number;
    inspectedLayerCount: number;
    visibleLayerCount: number;
    placeholderCount: number;
    obstacleCount: number;
    skuPlaceholderReliability: SkuTemplatePlaceholderReliability;
    hasReliableSkuPlaceholders?: boolean;
    skuPlaceholderInspectionStatus: 'inspected' | 'unknown';
    warnings: string[];
    layoutPlan?: SkuTemplateLayoutPlan;
    boundaries: {
        writesPhotoshop: false;
        claimsDesignQuality: false;
        scorelessPolicy: true;
    };
};

type SkuTemplateLayoutPreflightInput = {
    templateDoc?: Record<string, unknown> | null;
    layerHierarchy?: unknown;
    expectedItemCount?: number;
};

export type SkuTemplateLayoutRuntimeInspection = {
    schema?: unknown;
    templateName?: unknown;
    mode?: unknown;
    slotCount?: unknown;
    expectedItemCount?: unknown;
    blockers?: unknown;
    warnings?: unknown;
    inspectedLayerCount?: unknown;
    visibleLayerCount?: unknown;
};

type NormalizedLayer = {
    id?: unknown;
    name: string;
    kind: string;
    visible: boolean;
    isGroup: boolean;
    childCount: number;
    hasTextChild: boolean;
    hasImageLikeChild: boolean;
    depth: number;
    parentName?: string;
    parentIsPlaceholderContainer: boolean;
    isBackgroundLayer: boolean;
    bounds?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
};

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeMode(value: unknown): string {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[_\s]+/g, '-');
}

function hasExplicitNoPlaceholderUserIntent(text: string): boolean {
    if (!text) return false;
    return /不用占位符|不要占位符|无占位符|没有占位符|不需要(?:模板)?占位符?|不依赖(?:模板)?占位符?|只(?:需要|要)?(?:制作|做好)?SKU?色卡|色卡(?:就行|即可)|自动(?:排列|排版).{0,12}(?:不要|避免|不).{0,6}遮挡/i.test(text);
}

function getNestedPreflight(templateDoc?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!templateDoc || typeof templateDoc !== 'object') return null;
    const nested = templateDoc.skuTemplateLayoutPreflight ?? templateDoc.skuTemplatePlaceholderPreflight;
    return nested && typeof nested === 'object' ? nested as Record<string, unknown> : null;
}

function hasNoReliablePlaceholderInspection(templateDoc?: Record<string, unknown> | null): boolean {
    if (!templateDoc || typeof templateDoc !== 'object') return false;
    const nested = getNestedPreflight(templateDoc);
    const reliability = normalizeMode(
        templateDoc.skuPlaceholderReliability
            ?? nested?.skuPlaceholderReliability
            ?? templateDoc.placeholderReliability
            ?? templateDoc.skuPlaceholderStatus
    );
    if (['none', 'missing', 'no-placeholder', 'no-placeholders', 'unreliable'].includes(reliability)) {
        return true;
    }
    const inspectionStatus = normalizeMode(
        templateDoc.skuPlaceholderInspectionStatus
            ?? nested?.skuPlaceholderInspectionStatus
    );
    if (
        inspectionStatus === 'inspected'
        && (templateDoc.hasReliableSkuPlaceholders === false || nested?.hasReliableSkuPlaceholders === false)
    ) {
        return true;
    }
    return false;
}

function hasReliablePlaceholderInspection(templateDoc?: Record<string, unknown> | null): boolean {
    if (!templateDoc || typeof templateDoc !== 'object') return false;
    const nested = getNestedPreflight(templateDoc);
    const reliability = normalizeMode(
        templateDoc.skuPlaceholderReliability
            ?? nested?.skuPlaceholderReliability
            ?? templateDoc.placeholderReliability
            ?? templateDoc.skuPlaceholderStatus
    );
    if (['reliable', 'legacy-reliable', 'ready', 'present', 'with-placeholders', 'placeholder'].includes(reliability)) {
        return true;
    }
    return templateDoc.hasReliableSkuPlaceholders === true || nested?.hasReliableSkuPlaceholders === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(item => normalizeText(item)).filter(Boolean)
        : [];
}

export function buildSkuTemplateLayoutPreflightFromRuntimeInspection(input: {
    templateDoc?: Record<string, unknown> | null;
    inspection?: SkuTemplateLayoutRuntimeInspection | Record<string, unknown> | null;
    expectedItemCount?: number;
}): SkuTemplateLayoutPreflight {
    const inspection = input.inspection && typeof input.inspection === 'object'
        ? input.inspection as SkuTemplateLayoutRuntimeInspection
        : null;
    const expectedItemCount = readNumber(input.expectedItemCount ?? inspection?.expectedItemCount);
    const slotCount = Math.max(0, readNumber(inspection?.slotCount) ?? 0);
    const mode = normalizeMode(inspection?.mode);
    const blockers = readStringArray(inspection?.blockers);
    const warnings = readStringArray(inspection?.warnings);
    const layoutPlan = buildSkuTemplateLayoutPlan({
        inspection: inspection as Record<string, unknown> | null,
        expectedItemCount: Math.max(0, Math.round(expectedItemCount ?? 0))
    });
    const runtimeReliable = slotCount > 0 && blockers.length === 0;
    const legacyReliable = runtimeReliable && mode.includes('legacy');
    const reliability: SkuTemplatePlaceholderReliability = runtimeReliable
        ? (legacyReliable ? 'legacy_reliable' : 'reliable')
        : 'none';
    const templateName = normalizeText(inspection?.templateName ?? input.templateDoc?.name);

    return {
        schema: 'sku-template-layout-preflight/v0',
        ...(templateName ? { templateName } : {}),
        ...(expectedItemCount && expectedItemCount > 0 ? { expectedItemCount } : {}),
        inspectedLayerCount: readNumber(inspection?.inspectedLayerCount) ?? 0,
        visibleLayerCount: readNumber(inspection?.visibleLayerCount) ?? 0,
        placeholderCount: slotCount,
        obstacleCount: 0,
        skuPlaceholderReliability: reliability,
        hasReliableSkuPlaceholders: runtimeReliable,
        skuPlaceholderInspectionStatus: 'inspected',
        warnings: [
            ...warnings,
            ...blockers,
            ...layoutPlan.warnings
        ],
        layoutPlan,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false,
            scorelessPolicy: true
        }
    };
}

function normalizeBounds(value: unknown): NormalizedLayer['bounds'] {
    if (Array.isArray(value) && value.length >= 4) {
        const left = readNumber(value[0]);
        const top = readNumber(value[1]);
        const right = readNumber(value[2]);
        const bottom = readNumber(value[3]);
        if (left === null || top === null || right === null || bottom === null) return undefined;
        const width = Math.abs(right - left);
        const height = Math.abs(bottom - top);
        if (width <= 0 || height <= 0) return undefined;
        return { left, top, right, bottom, width, height };
    }

    if (!isRecord(value)) return undefined;
    const left = readNumber(value.left ?? value.x);
    const top = readNumber(value.top ?? value.y);
    const rightFromValue = readNumber(value.right);
    const bottomFromValue = readNumber(value.bottom);
    const widthFromValue = readNumber(value.width);
    const heightFromValue = readNumber(value.height);
    const right = rightFromValue ?? (left !== null && widthFromValue !== null ? left + widthFromValue : null);
    const bottom = bottomFromValue ?? (top !== null && heightFromValue !== null ? top + heightFromValue : null);
    if (left === null || top === null || right === null || bottom === null) return undefined;
    const width = Math.abs(right - left);
    const height = Math.abs(bottom - top);
    if (width <= 0 || height <= 0) return undefined;
    return { left, top, right, bottom, width, height };
}

function collectLayerArray(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        return value.filter(isRecord);
    }
    if (!isRecord(value)) return [];
    const direct = value.layers ?? value.children ?? value.items ?? value.hierarchy ?? value.flatList ?? value.layerHierarchy;
    if (Array.isArray(direct)) {
        return direct.filter(isRecord);
    }
    const nestedData = value.data;
    if (isRecord(nestedData)) {
        return collectLayerArray(nestedData.layers ?? nestedData.hierarchy ?? nestedData.layerHierarchy ?? nestedData);
    }
    return [];
}

function extractRootLayers(input: SkuTemplateLayoutPreflightInput): Record<string, unknown>[] {
    const hierarchyLayers = collectLayerArray(input.layerHierarchy);
    if (hierarchyLayers.length > 0) return hierarchyLayers;
    if (!input.templateDoc || typeof input.templateDoc !== 'object') return [];
    return collectLayerArray(
        input.templateDoc.layers
            ?? input.templateDoc.layerHierarchy
            ?? input.templateDoc.children
            ?? input.templateDoc
    );
}

function isSkuPlaceholderContainerName(name: string): boolean {
    const n = normalizeText(name).toLowerCase();
    return ['占位', '占位符', '占位组', 'placeholders', 'placeholder', 'holders', 'holder'].includes(n);
}

const REPLACEMENT_PLACEHOLDER_KEYWORDS = ['占位', 'placeholder', 'holder', '#'];

function isSkuReplacementPlaceholderName(name: string): boolean {
    const raw = normalizeText(name);
    const n = raw.toLowerCase();
    if (/^\d+$/.test(raw)) return true;
    return REPLACEMENT_PLACEHOLDER_KEYWORDS.some((keyword) => n.includes(keyword));
}

function isLegacyReferenceRegionName(name: string): boolean {
    const normalized = normalizeText(name);
    return /^(?:形状|矩形)?参考$|^参考(?:形状|矩形|区域)?$|(?:占位|sku).{0,8}参考|reference|ref(?:erence)?[\s_-]*(?:shape|region|box)?/i.test(normalized);
}

function flattenLayers(
    layers: Record<string, unknown>[],
    parentVisible = true,
    depth = 0,
    parentName = '',
    parentIsPlaceholderContainer = false
): NormalizedLayer[] {
    const flattened: NormalizedLayer[] = [];
    for (const layer of layers) {
        const name = normalizeText(layer.name ?? layer.title);
        const kind = normalizeMode(layer.kind ?? layer.type ?? layer.layerKind);
        const children = collectLayerArray(layer.layers ?? layer.children ?? layer.items);
        const visible = parentVisible && layer.visible !== false && layer.isVisible !== false;
        const isGroup = children.length > 0 || ['group', 'layer-section', 'layerset', 'folder'].includes(kind);
        const childKinds = children.map((child) => normalizeMode(child.kind ?? child.type ?? child.layerKind));
        const normalized: NormalizedLayer = {
            id: layer.id,
            name,
            kind,
            visible,
            isGroup,
            childCount: children.length,
            hasTextChild: childKinds.some((childKind) => childKind.includes('text')),
            hasImageLikeChild: childKinds.some((childKind) =>
                childKind.includes('smartobject')
                || childKind.includes('pixel')
                || childKind.includes('normal')
                || childKind.includes('image')
                || childKind.includes('shape')
                || childKind.includes('solidcolor')
            ),
            depth,
            parentName,
            parentIsPlaceholderContainer,
            isBackgroundLayer: layer.isBackgroundLayer === true || layer.background === true,
            bounds: normalizeBounds(layer.bounds ?? layer.rect ?? layer.boundingBox)
        };
        flattened.push(normalized);
        if (children.length > 0) {
            flattened.push(...flattenLayers(
                children,
                visible,
                depth + 1,
                name,
                isSkuPlaceholderContainerName(name)
            ));
        }
    }
    return flattened;
}

function isFullCanvasLayer(layer: NormalizedLayer, templateDoc?: Record<string, unknown> | null): boolean {
    if (!layer.bounds || !templateDoc) return false;
    const width = readNumber(templateDoc.width ?? templateDoc.canvasWidth);
    const height = readNumber(templateDoc.height ?? templateDoc.canvasHeight);
    if (!width || !height) return false;
    return layer.bounds.width >= width * 0.92 && layer.bounds.height >= height * 0.92;
}

function isContainerChildRectanglePlaceholderLayer(
    layer: NormalizedLayer,
    templateDoc?: Record<string, unknown> | null
): boolean {
    if (layer.isGroup || !layer.bounds) return false;
    if (layer.isBackgroundLayer) return false;
    if (layer.kind.includes('text')) return false;
    if (isFullCanvasLayer(layer, templateDoc)) return false;
    if (!isLegacySkuRegionGeometry(layer, templateDoc)) return false;
    const legacyShapeName = /^(矩形|矩形\s*\d+|rectangle|rect|shape)\b|\b(rectangle|rect|placeholder\s*box)\b/i.test(layer.name);
    const shapeKind = /shape|solidcolorlayer|contentlayer/i.test(layer.kind);
    return legacyShapeName || shapeKind;
}

function isPlaceholderLayer(layer: NormalizedLayer, templateDoc?: Record<string, unknown> | null): boolean {
    if (!layer.bounds) return false;
    if (!layer.isGroup && layer.kind.includes('text')) return false;
    if (layer.isGroup && isSkuPlaceholderContainerName(layer.name)) return false;
    if (layer.parentIsPlaceholderContainer) {
        return layer.isGroup
            || isSkuReplacementPlaceholderName(layer.name)
            || isContainerChildRectanglePlaceholderLayer(layer, templateDoc);
    }
    return isSkuReplacementPlaceholderName(layer.name)
        || /sku[\s_-]*(?:slot|place|placeholder)|产品位|图片位|颜色位|图位/i.test(layer.name);
}

function isLegacySkuRegionGeometry(layer: NormalizedLayer, templateDoc?: Record<string, unknown> | null): boolean {
    if (!layer.bounds) return false;
    if (isFullCanvasLayer(layer, templateDoc)) return false;

    const canvasWidth = readNumber(templateDoc?.width ?? templateDoc?.canvasWidth);
    const canvasHeight = readNumber(templateDoc?.height ?? templateDoc?.canvasHeight);
    if (!canvasWidth || !canvasHeight) {
        return layer.bounds.width >= 120 && layer.bounds.height >= 160;
    }

    const widthRatio = layer.bounds.width / canvasWidth;
    const heightRatio = layer.bounds.height / canvasHeight;
    const areaRatio = (layer.bounds.width * layer.bounds.height) / Math.max(1, canvasWidth * canvasHeight);
    const aspect = layer.bounds.width / Math.max(1, layer.bounds.height);

    if (areaRatio < 0.045 || areaRatio > 0.82) return false;
    if (widthRatio < 0.08 || heightRatio < 0.18) return false;
    if (aspect < 0.18 || aspect > 5) return false;
    return true;
}

function isLegacyTopLevelPlaceholderLayer(layer: NormalizedLayer, templateDoc?: Record<string, unknown> | null): boolean {
    const hiddenReferenceRegion = !layer.visible && isLegacyReferenceRegionName(layer.name);
    if (!layer.visible && !hiddenReferenceRegion) return false;
    if (layer.isGroup || !layer.bounds) return false;
    if (layer.depth !== 0) return false;
    if (layer.isBackgroundLayer) return false;
    if (layer.kind.includes('text')) return false;
    if (!hiddenReferenceRegion && /标题|文案|文字|说明|价格|角标|logo|标识|装饰|参考|背景|底图|白底|底板|分割|线条|边框/i.test(layer.name)) return false;
    if (!isLegacySkuRegionGeometry(layer, templateDoc)) return false;
    const legacyShapeName = /^(矩形|矩形\s*\d+|形状|rectangle|rect|shape)\b|\b(rectangle|rect|placeholder\s*box)\b/i.test(layer.name);
    const shapeKind = /shape|solidcolorlayer|contentlayer/i.test(layer.kind);
    return hiddenReferenceRegion || legacyShapeName || shapeKind;
}

function isLegacyReferenceItemGroupLayer(layer: NormalizedLayer, templateDoc?: Record<string, unknown> | null): boolean {
    if (!layer.visible || !layer.isGroup || !layer.bounds) return false;
    if (layer.depth !== 0) return false;
    if (isFullCanvasLayer(layer, templateDoc)) return false;
    if (!isLegacySkuRegionGeometry(layer, templateDoc)) return false;
    if (/背景|background|\bbg\b|底图|底色|白底|装饰|角标|logo|标识|分割|线条|边框|参考|reference|\bref\b|占位|placeholder/i.test(layer.name)) {
        return false;
    }
    return layer.childCount > 0 && layer.hasTextChild && layer.hasImageLikeChild;
}

function isAuxiliaryLayer(layer: NormalizedLayer, templateDoc?: Record<string, unknown> | null): boolean {
    if (!layer.bounds) return true;
    if (layer.isBackgroundLayer) return true;
    if (isFullCanvasLayer(layer, templateDoc)) return true;
    return /背景|background|\bbg\b|参考|reference|\bref\b|底图|底色|白底|占位符?|placeholder/i.test(layer.name);
}

export function buildSkuTemplateLayoutPreflight(
    input: SkuTemplateLayoutPreflightInput
): SkuTemplateLayoutPreflight {
    const rootLayers = extractRootLayers(input);
    const flattened = flattenLayers(rootLayers);
    const leaves = flattened.filter(layer => !layer.isGroup);
    const visibleLeaves = leaves.filter(layer => layer.visible);
    const placeholderLayers = flattened.filter(layer => isPlaceholderLayer(layer, input.templateDoc));
    const legacyPlaceholderLayers = leaves.filter(layer => !isPlaceholderLayer(layer, input.templateDoc) && isLegacyTopLevelPlaceholderLayer(layer, input.templateDoc));
    const legacyReferenceItemGroupLayers = flattened.filter(layer =>
        !isPlaceholderLayer(layer, input.templateDoc)
        && isLegacyReferenceItemGroupLayer(layer, input.templateDoc)
    );
    const effectivePlaceholderLayers = placeholderLayers.length > 0
        ? placeholderLayers
        : legacyPlaceholderLayers.length > 0
            ? legacyPlaceholderLayers
            : legacyReferenceItemGroupLayers;
    const obstacleLayers = visibleLeaves.filter(layer => {
        if (isPlaceholderLayer(layer, input.templateDoc) || isLegacyTopLevelPlaceholderLayer(layer, input.templateDoc)) return false;
        return !isAuxiliaryLayer(layer, input.templateDoc);
    });
    const expectedItemCount = readNumber(input.expectedItemCount);
    const inspectedLayerCount = leaves.length;
    const warnings: string[] = [];

    if (rootLayers.length === 0 || inspectedLayerCount === 0) {
        warnings.push('未读取到模板图层结构，保持模板占位符路径。');
        return {
            schema: 'sku-template-layout-preflight/v0',
            ...(normalizeText(input.templateDoc?.name) ? { templateName: normalizeText(input.templateDoc?.name) } : {}),
            ...(expectedItemCount && expectedItemCount > 0 ? { expectedItemCount } : {}),
            inspectedLayerCount,
            visibleLayerCount: visibleLeaves.length,
            placeholderCount: 0,
            obstacleCount: 0,
            skuPlaceholderReliability: 'unknown',
            skuPlaceholderInspectionStatus: 'unknown',
            warnings,
            boundaries: {
                writesPhotoshop: false,
                claimsDesignQuality: false,
                scorelessPolicy: true
            }
        };
    }

    const requiredPlaceholderCount = expectedItemCount && expectedItemCount > 0 ? expectedItemCount : 1;
    const namedReliable = placeholderLayers.length > 0;
    const legacyReliable = !namedReliable && (legacyPlaceholderLayers.length > 0 || legacyReferenceItemGroupLayers.length > 0);
    const reliable = namedReliable || legacyReliable;
    const reliability: SkuTemplatePlaceholderReliability = namedReliable
        ? 'reliable'
        : legacyReliable
            ? 'legacy_reliable'
            : (effectivePlaceholderLayers.length > 0 ? 'unreliable' : 'none');

    if (legacyReliable) {
        warnings.push(legacyReferenceItemGroupLayers.length > 0
            ? '模板未使用明确占位符命名，但识别到旧版顶层商品参考组，继续沿用占位符排版。'
            : '模板未使用明确占位符命名，但识别到旧版顶层矩形占位区域，继续沿用占位符排版。');
    }
    if (reliable && effectivePlaceholderLayers.length < requiredPlaceholderCount) {
        warnings.push(`模板识别到 ${effectivePlaceholderLayers.length} 个占位区域，少于本次 ${requiredPlaceholderCount} 个 SKU；将沿用模板占位符路径，在占位区域内排列多个颜色，导出后需要复核间距。`);
    }
    if (!reliable && effectivePlaceholderLayers.length > 0) {
        warnings.push(`模板只识别到 ${effectivePlaceholderLayers.length} 个占位区域，但这些区域不可用于当前 SKU 占位路径。`);
    }
    if (!reliable && effectivePlaceholderLayers.length === 0) {
        warnings.push('模板图层已检查，未发现可靠 SKU 占位符。');
    }

    return {
        schema: 'sku-template-layout-preflight/v0',
        ...(normalizeText(input.templateDoc?.name) ? { templateName: normalizeText(input.templateDoc?.name) } : {}),
        ...(expectedItemCount && expectedItemCount > 0 ? { expectedItemCount } : {}),
        inspectedLayerCount,
        visibleLayerCount: visibleLeaves.length,
        placeholderCount: effectivePlaceholderLayers.length,
        obstacleCount: obstacleLayers.length,
        skuPlaceholderReliability: reliability,
        hasReliableSkuPlaceholders: reliable,
        skuPlaceholderInspectionStatus: 'inspected',
        warnings,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false,
            scorelessPolicy: true
        }
    };
}

function makeDecision(input: {
    action: SkuAutoLayoutExecutorAction;
    enabled: boolean;
    source: SkuAutoLayoutExecutorDecisionSource;
    reason: string;
    templateName?: string;
}): SkuAutoLayoutExecutorDecision {
    return {
        schema: 'sku-auto-layout-executor-policy/v0',
        action: input.action,
        enabled: input.enabled,
        source: input.source,
        reason: input.reason,
        ...(input.templateName ? { templateName: input.templateName } : {}),
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false,
            scorelessPolicy: true
        }
    };
}

export function buildSkuAutoLayoutExecutorPolicy(
    input: SkuAutoLayoutExecutorPolicyInput
): SkuAutoLayoutExecutorDecision {
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const action = input.action === 'arrangeDynamic' ? 'arrangeDynamic' : 'execute';
    const templateName = normalizeText(input.templateDoc?.name);
    const userInput = normalizeText(input.userInput);
    const mode = normalizeMode(
        params.skuAutoLayoutMode
            ?? params.skuLayoutMode
            ?? params.layoutMode
    );

    if (mode === 'placeholder' || mode === 'with-placeholders' || params.autoLayoutWithoutPlaceholders === false) {
        return makeDecision({
            action,
            enabled: false,
            source: 'explicit_placeholder_mode',
            reason: '已明确要求沿用模板占位符，不启用无占位符自动排版。',
            templateName
        });
    }

    if (params.autoLayoutWithoutPlaceholders === true) {
        return makeDecision({
            action,
            enabled: true,
            source: 'explicit_no_placeholder_param',
            reason: '上游已明确允许本次 SKU 排版不依赖模板占位符。',
            templateName
        });
    }

    if (['without-placeholders', 'no-placeholder', 'no-placeholders', 'auto-no-placeholder'].includes(mode)) {
        return makeDecision({
            action,
            enabled: false,
            source: 'project_or_parent_policy',
            reason: 'SKU 6.3 已改为顺序占位替换；项目或父级无占位符策略不再启用自动避让排版。',
            templateName
        });
    }

    if (hasExplicitNoPlaceholderUserIntent(userInput)) {
        return makeDecision({
            action,
            enabled: false,
            source: 'user_requested_no_placeholder',
            reason: 'SKU 6.3 已改为按模板占位组顺序替换；用户的无占位符表述不再触发自动避让排版。',
            templateName
        });
    }

    if (hasNoReliablePlaceholderInspection(input.templateDoc)) {
        return makeDecision({
            action,
            enabled: false,
            source: 'template_has_no_reliable_placeholders',
            reason: '模板检查没有可靠占位符时仍保持顺序占位替换路径，由执行层按 6.3 占位组规则校验数量并失败提示。',
            templateName
        });
    }

    if (hasReliablePlaceholderInspection(input.templateDoc)) {
        return makeDecision({
            action,
            enabled: false,
            source: 'template_has_reliable_placeholders',
            reason: '模板检查显示已有可靠 SKU 占位符，优先沿用模板原有排版。',
            templateName
        });
    }

    return makeDecision({
        action,
        enabled: false,
        source: 'default_placeholder_until_preflight',
        reason: '尚未完成模板图层 preflight 检查，保守沿用模板占位符路径，避免误把旧模板切换为无占位符自动排版。',
        templateName
    });
}
