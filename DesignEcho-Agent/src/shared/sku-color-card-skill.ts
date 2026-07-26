/**
 * SKU 色卡 Skill 共享契约。
 *
 * 本模块只负责输入归一化、布局计算和可验收结构，不调用 Photoshop，
 * 也不授予写入权限。执行器必须逐步调用原子 Tool 并读回真实结果。
 */

import type { ProjectAssetIndex } from './project-asset-index';

export const SKU_COLOR_CARD_SKILL_VERSION = 'sku-color-card-skill/v1' as const;
export const SKU_COLOR_CARD_EXECUTION_REPORT_VERSION = 'sku-color-card-execution-report/v1' as const;

export type SkuColorCardPlanStatus =
    | 'ready'
    | 'blocked_missing_sources'
    | 'blocked_invalid_sources'
    | 'blocked_missing_output_path'
    | 'blocked_layout_overflow';

export interface SkuColorCardSourceInput {
    filePath: string;
    colorName?: string;
    relativePath?: string;
    assetId?: string;
}

export interface SkuColorCardSource {
    sourceId: string;
    filePath: string;
    relativePath?: string;
    colorName: string;
}

export type SkuColorCardSourceResolutionMethod =
    | 'user_explicit_path'
    | 'provided_exact_name'
    | 'project_exact_name'
    | 'provided_candidate'
    | 'unresolved';

export interface SkuColorCardSourceResolutionItem {
    colorName: string;
    requestedPath: string;
    resolvedPath: string;
    method: SkuColorCardSourceResolutionMethod;
    exactMatchCount: number;
}

export interface SkuColorCardSourceResolution {
    status: 'resolved' | 'blocked';
    sources: SkuColorCardSourceInput[];
    items: SkuColorCardSourceResolutionItem[];
    blockers: string[];
    warnings: string[];
}

export interface ResolveSkuColorCardSourcesInput {
    sources?: SkuColorCardSourceInput[];
    assetIndex?: ProjectAssetIndex;
    userInput?: string;
}

export interface SkuColorCardLayoutInput {
    canvasWidth?: number;
    canvasHeight?: number;
    cardWidth?: number;
    cardHeight?: number;
    cardCornerRadius?: number;
    columnGap?: number;
    rowGap?: number;
    columns?: number;
    showIndexNumbers?: boolean;
}

export interface SkuColorCardSlot {
    index: number;
    source: SkuColorCardSource;
    groupName: string;
    smartObjectName: string;
    indexLayerName: string;
    cardBounds: { x: number; y: number; width: number; height: number };
    indexText: { content: string; x: number; y: number; fontSize: number } | null;
}

export interface SkuColorCardInternalLabelRecipe {
    /** 数值均相对于智能对象内部画布宽高，执行时根据真实内部文档尺寸计算。 */
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
    cornerRadiusToWidthRatio: number;
    fontSizeToHeightRatio: number;
}

export interface SkuColorCardPlan {
    version: typeof SKU_COLOR_CARD_SKILL_VERSION;
    status: SkuColorCardPlanStatus;
    canExecute: boolean;
    documentName: 'SKU';
    outputPath: string;
    canvas: { width: number; height: number; backgroundColor: 'white' };
    cardStyle: {
        fillColorHex: '#000000';
        cornerRadius: number;
        labelFillColorHex: '#FFFFFF';
        labelTextColorHex: '#111111';
        internalLabel: SkuColorCardInternalLabelRecipe;
    };
    indexReference: {
        enabled: boolean;
        groupName: '参考组';
        purpose: 'display_only';
        excludeFromColorGroups: true;
    };
    slots: SkuColorCardSlot[];
    blockers: string[];
    warnings: string[];
    qualityCriteria: string[];
    requiredTools: string[];
}

export interface BuildSkuColorCardPlanInput {
    sources?: SkuColorCardSourceInput[];
    projectPath?: string;
    outputPath?: string;
    outputRelativePath?: string;
    layout?: SkuColorCardLayoutInput;
    sourceResolution?: Pick<SkuColorCardSourceResolution, 'blockers' | 'warnings'>;
}

export interface SkuColorCardPreparedCard {
    sourceId: string;
    colorName: string;
    sourcePath: string;
    groupId: number;
    smartObjectLayerId: number;
    internalDocumentId: number;
    internalCanvas: { width: number; height: number };
    imageLayerId: number;
    labelBackgroundLayerId: number;
    labelTextLayerId: number;
    clippingVerified: boolean;
    smartObjectVerified: boolean;
    labelTextFitVerified: boolean;
}

export interface SkuColorCardExecutionReport {
    version: typeof SKU_COLOR_CARD_EXECUTION_REPORT_VERSION;
    status: 'structure_ready' | 'completed' | 'failed';
    outputPath: string;
    documentId?: number;
    sourceCount: number;
    preparedCards: SkuColorCardPreparedCard[];
    checks: {
        sourceCoverage: 'passed' | 'failed';
        smartObjectEditability: 'passed' | 'failed';
        clippingStructure: 'passed' | 'failed';
        labelTextFit: 'passed' | 'failed';
        indexReferenceIsolation: 'passed' | 'failed' | 'not_requested';
        finalStructureReadback: 'passed' | 'failed';
        visualComposition: 'passed' | 'needs_review' | 'failed';
    };
    failureStage?: string;
    error?: string;
}

const DEFAULT_OUTPUT_RELATIVE_PATH = 'PSD/SKU.psb';
const DEFAULT_CANVAS_WIDTH = 1500;
const DEFAULT_CANVAS_HEIGHT = 1500;
const DEFAULT_CARD_WIDTH = 250;
const DEFAULT_CARD_HEIGHT = 380;
const DEFAULT_CARD_CORNER_RADIUS = 10;
const DEFAULT_COLUMN_GAP = 40;
const DEFAULT_ROW_GAP = 170;
const DEFAULT_MAX_COLUMNS = 5;
const MAX_CARD_COUNT = 10;

const INTERNAL_LABEL_RECIPE: SkuColorCardInternalLabelRecipe = Object.freeze({
    xRatio: 448 / 800,
    yRatio: 32 / 1216,
    widthRatio: 320 / 800,
    heightRatio: 115.2 / 1216,
    cornerRadiusToWidthRatio: 32 / 800,
    fontSizeToHeightRatio: 0.56
});

function clean(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return clean(value).replace(/\//g, '\\').replace(/[\\]+$/, '');
}

function joinProjectPath(projectPath: string, relativePath: string): string {
    const project = normalizePath(projectPath);
    const relative = normalizePath(relativePath).replace(/^[\\]+/, '');
    return `${project}\\${relative}`;
}

function baseNameWithoutExtension(filePath: string): string {
    const name = normalizePath(filePath).split('\\').pop() || '';
    return name.replace(/\.[^.]+$/, '').trim();
}

function comparableName(value: unknown): string {
    return clean(value)
        .normalize('NFKC')
        .toLocaleLowerCase('zh-Hans-CN');
}

function pathWasExplicitlyWrittenByUser(userInput: unknown, filePath: string): boolean {
    const text = comparableName(userInput).replace(/\\/g, '/');
    if (!text || !filePath) return false;
    const normalizedPath = comparableName(normalizePath(filePath)).replace(/\\/g, '/');
    const fileName = normalizedPath.split('/').pop() || '';
    return Boolean(
        (normalizedPath && text.includes(normalizedPath))
        || (fileName && /\.[a-z0-9]{2,5}$/i.test(fileName) && text.includes(fileName))
    );
}

/**
 * 解析 SKU 色卡来源的业务优先级：
 * 1. 用户在原始请求中明确写出的文件路径；
 * 2. 已提供且文件名与颜色名完全一致的路径；
 * 3. 项目索引中唯一的同名图片；
 * 4. 同名图片不存在时，保留上游已经选定的候选图。
 *
 * 同名候选存在多个时必须阻断，不能由 Harness 猜目录优先级。
 */
export function resolveSkuColorCardSources(
    input: ResolveSkuColorCardSourcesInput
): SkuColorCardSourceResolution {
    const assets = Array.isArray(input.assetIndex?.assets)
        ? input.assetIndex.assets.filter((asset) => asset.isImage === true && clean(asset.path))
        : [];
    const blockers: string[] = [];
    const warnings: string[] = [];
    const items: SkuColorCardSourceResolutionItem[] = [];
    const sources = (Array.isArray(input.sources) ? input.sources : []).map((source, index) => {
        const requestedPath = normalizePath(source?.filePath);
        const colorName = clean(source?.colorName) || baseNameWithoutExtension(requestedPath);
        const colorKey = comparableName(colorName);
        const requestedNameKey = comparableName(baseNameWithoutExtension(requestedPath));
        const exactMatches = colorKey
            ? assets.filter((asset) => comparableName(baseNameWithoutExtension(asset.name || asset.path)) === colorKey)
            : [];
        let resolvedPath = requestedPath;
        let method: SkuColorCardSourceResolutionMethod = 'unresolved';

        if (!colorName) {
            blockers.push(`第 ${index + 1} 个色卡来源缺少颜色名，无法匹配项目图片。`);
        } else if (requestedPath && pathWasExplicitlyWrittenByUser(input.userInput, requestedPath)) {
            method = 'user_explicit_path';
        } else if (requestedPath && requestedNameKey === colorKey) {
            method = 'provided_exact_name';
        } else if (exactMatches.length === 1) {
            resolvedPath = normalizePath(exactMatches[0].path);
            method = 'project_exact_name';
            if (requestedPath && comparableName(requestedPath) !== comparableName(resolvedPath)) {
                warnings.push(`“${colorName}”已改用项目中唯一的同名图片，不采用名称不一致的候选图。`);
            }
        } else if (exactMatches.length > 1) {
            resolvedPath = '';
            method = 'unresolved';
            blockers.push(`项目中存在 ${exactMatches.length} 张名为“${colorName}”的图片，无法确定应使用哪一张。`);
        } else if (requestedPath) {
            method = 'provided_candidate';
            warnings.push(`项目中没有唯一同名图片“${colorName}”，保留上游选定的候选图，执行前需要确认内容。`);
        } else {
            method = 'unresolved';
            blockers.push(`项目中没有找到与“${colorName}”同名的图片。`);
        }

        items.push({
            colorName,
            requestedPath,
            resolvedPath,
            method,
            exactMatchCount: exactMatches.length
        });
        return {
            ...source,
            filePath: resolvedPath,
            colorName
        };
    });

    return {
        status: blockers.length > 0 ? 'blocked' : 'resolved',
        sources,
        items,
        blockers,
        warnings
    };
}

function positiveInteger(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.round(numeric);
}

function normalizeSources(inputs: SkuColorCardSourceInput[] | undefined): {
    sources: SkuColorCardSource[];
    blockers: string[];
} {
    const blockers: string[] = [];
    const seenPaths = new Set<string>();
    const seenNames = new Set<string>();
    const sources: SkuColorCardSource[] = [];

    (Array.isArray(inputs) ? inputs : []).forEach((input, index) => {
        const filePath = normalizePath(input?.filePath);
        const colorName = clean(input?.colorName) || baseNameWithoutExtension(filePath);
        if (!filePath) {
            blockers.push(`第 ${index + 1} 个色卡来源缺少文件路径。`);
            return;
        }
        if (!colorName) {
            blockers.push(`第 ${index + 1} 个色卡来源无法从文件名取得颜色名称。`);
            return;
        }
        const pathKey = filePath.toLocaleLowerCase('zh-Hans-CN');
        const nameKey = colorName.toLocaleLowerCase('zh-Hans-CN');
        if (seenPaths.has(pathKey)) {
            blockers.push(`色卡来源重复：${filePath}`);
            return;
        }
        if (seenNames.has(nameKey)) {
            blockers.push(`颜色名称重复：${colorName}`);
            return;
        }
        seenPaths.add(pathKey);
        seenNames.add(nameKey);
        sources.push({
            sourceId: clean(input.assetId) || `source-${index + 1}`,
            filePath,
            ...(clean(input.relativePath) ? { relativePath: clean(input.relativePath) } : {}),
            colorName
        });
    });

    return { sources, blockers };
}

function buildSlots(input: {
    sources: SkuColorCardSource[];
    canvasWidth: number;
    canvasHeight: number;
    cardWidth: number;
    cardHeight: number;
    columnGap: number;
    rowGap: number;
    columns: number;
    showIndexNumbers: boolean;
}): SkuColorCardSlot[] {
    const rows = Math.ceil(input.sources.length / input.columns);
    const totalWidth = input.columns * input.cardWidth + (input.columns - 1) * input.columnGap;
    const totalHeight = rows * input.cardHeight + (rows - 1) * input.rowGap;
    const startX = Math.round((input.canvasWidth - totalWidth) / 2);
    const startY = Math.round((input.canvasHeight - totalHeight) / 2);

    return input.sources.map((source, index) => {
        const row = Math.floor(index / input.columns);
        const column = index % input.columns;
        const x = startX + column * (input.cardWidth + input.columnGap);
        const y = startY + row * (input.cardHeight + input.rowGap);
        return {
            index: index + 1,
            source,
            groupName: source.colorName,
            smartObjectName: `${source.colorName}-色卡智能对象`,
            indexLayerName: `${source.colorName}-序号`,
            cardBounds: { x, y, width: input.cardWidth, height: input.cardHeight },
            indexText: input.showIndexNumbers
                ? {
                    content: String(index + 1),
                    x: x + Math.round(input.cardWidth / 2),
                    y: Math.max(24, y - 126),
                    fontSize: Math.max(72, Math.round(input.cardWidth * 0.38))
                }
                : null
        };
    });
}

export function buildSkuColorCardPlan(input: BuildSkuColorCardPlanInput): SkuColorCardPlan {
    const normalized = normalizeSources(input.sources);
    const sources = normalized.sources.slice(0, MAX_CARD_COUNT);
    const canvasWidth = positiveInteger(input.layout?.canvasWidth, DEFAULT_CANVAS_WIDTH);
    const canvasHeight = positiveInteger(input.layout?.canvasHeight, DEFAULT_CANVAS_HEIGHT);
    const cardWidth = positiveInteger(input.layout?.cardWidth, DEFAULT_CARD_WIDTH);
    const cardHeight = positiveInteger(input.layout?.cardHeight, DEFAULT_CARD_HEIGHT);
    const columnGap = positiveInteger(input.layout?.columnGap, DEFAULT_COLUMN_GAP);
    const rowGap = positiveInteger(input.layout?.rowGap, DEFAULT_ROW_GAP);
    const requestedColumns = positiveInteger(
        input.layout?.columns,
        Math.min(DEFAULT_MAX_COLUMNS, Math.max(1, sources.length))
    );
    const columns = Math.min(requestedColumns, Math.max(1, sources.length));
    const outputPath = normalizePath(input.outputPath)
        || (normalizePath(input.projectPath)
            ? joinProjectPath(input.projectPath as string, clean(input.outputRelativePath) || DEFAULT_OUTPUT_RELATIVE_PATH)
            : '');
    const rows = sources.length > 0 ? Math.ceil(sources.length / columns) : 0;
    const layoutWidth = columns * cardWidth + Math.max(0, columns - 1) * columnGap;
    const layoutHeight = rows * cardHeight + Math.max(0, rows - 1) * rowGap;
    const blockers = [
        ...normalized.blockers,
        ...(input.sourceResolution?.blockers || [])
    ];

    if (sources.length === 0 && blockers.length === 0) {
        blockers.push('没有可用于 SKU 色卡的图片来源。');
    }
    if (!outputPath) {
        blockers.push('缺少项目路径或显式输出路径，无法确定 SKU 文档保存位置。');
    }
    if (input.sources && input.sources.length > MAX_CARD_COUNT) {
        blockers.push(`单个 1500×1500 色卡文档最多支持 ${MAX_CARD_COUNT} 张图片；当前为 ${input.sources.length} 张。`);
    }
    if (layoutWidth > canvasWidth || layoutHeight > canvasHeight) {
        blockers.push(`当前卡片布局 ${layoutWidth}×${layoutHeight} 超出画布 ${canvasWidth}×${canvasHeight}。`);
    }

    let status: SkuColorCardPlanStatus = 'ready';
    if (sources.length === 0) status = 'blocked_missing_sources';
    else if (normalized.blockers.length > 0 || (input.sourceResolution?.blockers.length || 0) > 0) {
        status = 'blocked_invalid_sources';
    }
    else if (!outputPath) status = 'blocked_missing_output_path';
    else if (blockers.length > 0) status = 'blocked_layout_overflow';

    return {
        version: SKU_COLOR_CARD_SKILL_VERSION,
        status,
        canExecute: status === 'ready',
        documentName: 'SKU',
        outputPath,
        canvas: {
            width: canvasWidth,
            height: canvasHeight,
            backgroundColor: 'white'
        },
        cardStyle: {
            fillColorHex: '#000000',
            cornerRadius: positiveInteger(input.layout?.cardCornerRadius, DEFAULT_CARD_CORNER_RADIUS),
            labelFillColorHex: '#FFFFFF',
            labelTextColorHex: '#111111',
            internalLabel: { ...INTERNAL_LABEL_RECIPE }
        },
        indexReference: {
            enabled: input.layout?.showIndexNumbers !== false,
            groupName: '参考组',
            purpose: 'display_only',
            excludeFromColorGroups: true
        },
        slots: buildSlots({
            sources,
            canvasWidth,
            canvasHeight,
            cardWidth,
            cardHeight,
            columnGap,
            rowGap,
            columns,
            showIndexNumbers: input.layout?.showIndexNumbers !== false
        }),
        blockers,
        warnings: [
            ...(input.sourceResolution?.warnings || []),
            '色名默认取图片文件名（不含扩展名）；显式 colorName 优先。',
            '标签比例来自用户提供的 800×1216 智能对象样例，执行时按真实内部文档尺寸等比换算。',
            '序号只用于查看输入顺序，统一放入文档根层级“参考组”，不得进入任何颜色组。',
            '商品图只做安全的 contain 草稿置入；主体缩放、重心和裁切必须由 Agent 看过写后快照后再决定。',
            '色卡结构生成成功不等于设计完成，最终视觉质量仍需写后快照评价与调整。'
        ],
        qualityCriteria: [
            '每个输入图片对应且只对应一个同名颜色组。',
            '每个颜色组只包含一个可编辑色卡智能对象，商品图在内部以剪切蒙版受圆角底约束。',
            '启用序号时，所有序号只存在于根层级“参考组”，不属于颜色组或可复用卡片资产。',
            '智能对象内部包含白色色名底和与文件名一致的文字。',
            '色名文字必须依据 Photoshop 真实 bounds 缩放并在白底内水平、垂直居中。',
            '商品主体大小、重心和裁切经过视觉模型观察、调整和再次观察，不能沿用固定脚本缩放。',
            '最终文档尺寸、颜色组数量、智能对象状态和保存路径均通过写后检查。'
        ],
        requiredTools: [
            'createDocument',
            'createGroup',
            'createRectangle',
            'convertToSmartObject',
            'editSmartObjectContents',
            'getDocumentInfo',
            'placeImage',
            'createClippingMask',
            'getClippingMaskInfo',
            'createTextLayer',
            'getLayerBounds',
            'setTextStyle',
            'moveLayer',
            'closeDocument',
            'switchDocument',
            'moveLayerToGroup',
            'getSmartObjectInfo',
            'saveDocument',
            'getAcceptanceSnapshot',
            'getCanvasSnapshot',
            'fitLayerSubjectToRegion',
            'transformLayer'
        ]
    };
}

export function buildInternalSkuColorCardGeometry(input: {
    width: number;
    height: number;
    recipe?: SkuColorCardInternalLabelRecipe;
    labelText?: string;
}): {
    image: { x: number; y: number; width: number; height: number };
    label: { x: number; y: number; width: number; height: number; cornerRadius: number };
    text: { x: number; y: number; fontSize: number };
} {
    const width = positiveInteger(input.width, DEFAULT_CARD_WIDTH);
    const height = positiveInteger(input.height, DEFAULT_CARD_HEIGHT);
    const recipe = input.recipe || INTERNAL_LABEL_RECIPE;
    const label = {
        x: Math.round(width * recipe.xRatio),
        y: Math.round(height * recipe.yRatio),
        width: Math.max(1, Math.round(width * recipe.widthRatio)),
        height: Math.max(1, Math.round(height * recipe.heightRatio)),
        cornerRadius: Math.max(1, Math.round(width * recipe.cornerRadiusToWidthRatio))
    };
    const defaultFontSize = Math.max(12, Math.round(label.height * recipe.fontSizeToHeightRatio));
    const horizontalTextPadding = Math.max(4, Math.round(label.width * 0.08));
    const availableTextWidth = Math.max(1, label.width - horizontalTextPadding * 2);
    const textUnits = Array.from(clean(input.labelText)).reduce((total, character) => (
        total + (/^[\x00-\x7F]$/u.test(character) ? 0.56 : 1)
    ), 0);
    const widthFittedFontSize = textUnits > 0
        ? Math.max(12, Math.floor(availableTextWidth / textUnits))
        : defaultFontSize;
    return {
        image: { x: 0, y: 0, width, height },
        label,
        text: {
            x: label.x + horizontalTextPadding,
            y: label.y + Math.round(label.height * 0.17),
            fontSize: Math.min(defaultFontSize, widthFittedFontSize)
        }
    };
}

/**
 * 归一化 Photoshop getClippingMaskInfo 的只读结果。
 *
 * 该原子 Tool 成功时直接返回剪切关系对象，和多数写工具不同，不保证携带
 * `success: true`。因此只有显式失败或缺少 isClipped=true 才判定为未通过。
 */
export function isSkuColorCardClippingReadbackVerified(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    const payload = result as Record<string, any>;
    if (payload.success === false || clean(payload.error)) return false;
    const info = payload.clippingMaskInfo
        || payload.data?.clippingMaskInfo
        || payload.data
        || payload;
    return info?.isClipped === true;
}
