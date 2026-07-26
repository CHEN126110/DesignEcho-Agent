import type {
    SkuCardAssetCandidate,
    SkuCardAssetCandidateReport
} from './sku-card-asset-candidates';

export type SkuCardSourcePreparationPlanVersion = 'sku-card-source-preparation-plan/v0';
export type SkuCardSourcePreparationPlanStatus =
    | 'ready_for_preparation'
    | 'blocked_missing_project_path'
    | 'blocked_candidates_not_ready';

export type SkuCardSourcePreparationToolName =
    | 'createDocument'
    | 'switchDocument'
    | 'getDocumentInfo'
    | 'createGroup'
    | 'createRectangle'
    | 'placeImage'
    | 'createClippingMask'
    | 'moveLayerToGroup'
    | 'createTextLayer'
    | 'saveDocument'
    | 'getAcceptanceSnapshot';

export interface SkuCardSourcePreparationSource {
    assetId: string;
    path: string;
    relativePath: string;
    colorName: string;
    displayName: string;
    score: number;
    recommendedUse: SkuCardAssetCandidate['recommendedUse'];
}

export interface SkuCardSourcePreparationToolRequest {
    toolName: SkuCardSourcePreparationToolName;
    params: Record<string, any>;
    summary: string;
    sourceAssetId?: string;
    dependsOnPrevious?: boolean;
}

export interface SkuCardSourcePreparationPlan {
    version: SkuCardSourcePreparationPlanVersion;
    status: SkuCardSourcePreparationPlanStatus;
    canRunPhotoshopWrites: boolean;
    outputDocumentPath: string;
    minimumSourceCount: number;
    selectedSources: SkuCardSourcePreparationSource[];
    toolRequests: SkuCardSourcePreparationToolRequest[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildSkuCardSourcePreparationPlanInput {
    projectPath?: string | null;
    skuCardAssetCandidateReport?: SkuCardAssetCandidateReport | null;
    maxSources?: number;
    minimumSourceCount?: number;
    outputRelativePath?: string;
    canvasSize?: number;
}

const DEFAULT_OUTPUT_RELATIVE_PATH = 'PSD/SKU-card-source.psb';
const DEFAULT_CANVAS_SIZE = 1600;
const CARD_OUTER_MARGIN = 64;
const CARD_GAP = 40;

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function joinProjectPath(projectPath: string, relativePath: string): string {
    const project = normalizePath(projectPath);
    const relative = normalizePath(relativePath).replace(/^\/+/, '');
    return `${project}/${relative}`.replace(/\//g, '\\');
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.round(numeric);
}

function defaultDisplayColorName(index: number): string {
    return `颜色${index + 1}`;
}

function candidateDisplayName(candidate: SkuCardAssetCandidate, index = 0): string {
    return cleanString(candidate.skuColorName) || defaultDisplayColorName(index);
}

function skuColorOrderWeight(value: unknown): number {
    const colorName = cleanString(value);
    const orderRules: Array<[RegExp, number]> = [
        [/奶白|米白|乳白|白色|白/, 10],
        [/粉色|浅粉|藕粉|粉/, 20],
        [/浅咖|咖色|卡其|米色|米黄|咖/, 30],
        [/灰色|浅灰|深灰|灰/, 40],
        [/黑色|黑/, 50],
        [/蓝色|蓝/, 60],
        [/绿色|绿/, 70],
        [/紫色|紫/, 80],
        [/红色|红/, 90],
        [/黄色|黄/, 100]
    ];
    return orderRules.find(([pattern]) => pattern.test(colorName))?.[1] ?? 1000;
}

export function buildSkuCardSourceCardSlots(count: number, canvasSize: number): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
}> {
    const normalizedCount = Math.max(1, Math.min(12, Math.round(count)));
    const columns = normalizedCount <= 4
        ? Math.min(2, normalizedCount)
        : Math.min(4, normalizedCount);
    const rows = Math.ceil(normalizedCount / columns);
    const availableWidth = Math.max(1, canvasSize - CARD_OUTER_MARGIN * 2 - CARD_GAP * (columns - 1));
    const availableHeight = Math.max(1, canvasSize - CARD_OUTER_MARGIN * 2 - CARD_GAP * (rows - 1));
    const width = Math.floor(availableWidth / columns);
    const height = Math.floor(availableHeight / rows);
    const totalHeight = rows * height + (rows - 1) * CARD_GAP;
    const startY = Math.max(CARD_OUTER_MARGIN, Math.floor((canvasSize - totalHeight) / 2));

    return Array.from({ length: normalizedCount }, (_, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        return {
            x: CARD_OUTER_MARGIN + col * (width + CARD_GAP),
            y: startY + row * (height + CARD_GAP),
            width,
            height
        };
    });
}

export function buildSkuCardSourceCardGeometry(slot: { x: number; y: number; width: number; height: number }) {
    const labelWidth = Math.max(72, Math.round(slot.width * 0.14));
    const labelHeight = Math.min(Math.round(slot.height * 0.42), 260);
    const numberSize = Math.max(58, Math.round(slot.width * 0.15));
    return {
        card: slot,
        image: {
            x: slot.x,
            y: slot.y,
            width: slot.width,
            height: slot.height
        },
        labelPill: {
            x: slot.x + slot.width - labelWidth - 22,
            y: slot.y + Math.round((slot.height - labelHeight) / 2),
            width: labelWidth,
            height: labelHeight
        },
        labelText: {
            x: slot.x + slot.width - labelWidth - 8,
            y: slot.y + Math.round((slot.height - 44) / 2)
        },
        numberText: {
            x: slot.x + 22,
            y: slot.y + 18,
            fontSize: numberSize
        }
    };
}

function selectConfirmedSkuCardSources(
    report?: SkuCardAssetCandidateReport | null,
    maxSources = 8
): SkuCardSourcePreparationSource[] {
    const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
    const limit = Math.max(1, Math.min(12, normalizePositiveInteger(maxSources, 8)));

    return candidates
        .filter((candidate) => (
            (candidate.recommendedUse === 'primary_sku_card' || candidate.recommendedUse === 'secondary_sku_card')
            && candidate.needsVisualConfirmation === false
            && Boolean(cleanString(candidate.path))
        ))
        .sort((left, right) => {
            const useWeight = (value: SkuCardAssetCandidate['recommendedUse']) => value === 'primary_sku_card' ? 1 : 0;
            const useDelta = useWeight(right.recommendedUse) - useWeight(left.recommendedUse);
            if (useDelta !== 0) return useDelta;
            if (right.score !== left.score) return right.score - left.score;
            const colorDelta = skuColorOrderWeight(candidateDisplayName(left)) - skuColorOrderWeight(candidateDisplayName(right));
            if (colorDelta !== 0) return colorDelta;
            return normalizePath(left.relativePath).localeCompare(normalizePath(right.relativePath), 'zh-Hans-CN');
        })
        .slice(0, limit)
        .map((candidate, index) => ({
            assetId: candidate.assetId,
            path: candidate.path,
            relativePath: candidate.relativePath,
            colorName: String(index + 1),
            displayName: candidateDisplayName(candidate, index),
            score: candidate.score,
            recommendedUse: candidate.recommendedUse
        }));
}

function buildToolRequests(input: {
    selectedSources: SkuCardSourcePreparationSource[];
    outputDocumentPath: string;
    canvasSize: number;
}): SkuCardSourcePreparationToolRequest[] {
    const slots = buildSkuCardSourceCardSlots(input.selectedSources.length, input.canvasSize);
    const requests: SkuCardSourcePreparationToolRequest[] = [
        {
            toolName: 'createDocument',
            params: {
                name: 'SKU',
                width: input.canvasSize,
                height: input.canvasSize,
                backgroundColor: 'transparent'
            },
            summary: '新建 SKU 源文档画布'
        }
    ];

    input.selectedSources.forEach((source, index) => {
        const slot = slots[index] || slots[0];
        const geometry = buildSkuCardSourceCardGeometry(slot);
        requests.push(
            {
                toolName: 'createGroup',
                params: { groupName: source.colorName },
                summary: `创建颜色组 ${source.colorName}（${source.displayName}）`,
                sourceAssetId: source.assetId
            },
            {
                toolName: 'createRectangle',
                params: {
                    name: `${source.colorName}-色卡底`,
                    x: geometry.card.x,
                    y: geometry.card.y,
                    width: geometry.card.width,
                    height: geometry.card.height,
                    fillColorHex: '#FFFFFF',
                    cornerRadius: 32
                },
                summary: `创建 ${source.displayName} 色卡底`,
                sourceAssetId: source.assetId
            },
            {
                toolName: 'moveLayerToGroup',
                params: {
                    layerIdSource: 'previous_createRectangle_result',
                    targetGroupIdSource: 'previous_createGroup_result',
                    position: 'inside'
                },
                summary: `把 ${source.displayName} 色卡底放入颜色组`,
                sourceAssetId: source.assetId,
                dependsOnPrevious: true
            },
            {
                toolName: 'placeImage',
                params: {
                    filePath: source.path,
                    name: `${source.colorName}-商品图`,
                    targetBounds: geometry.image,
                    targetFit: 'cover',
                    layerOrder: 'front'
                },
                summary: `置入 ${source.displayName} 商品图`,
                sourceAssetId: source.assetId
            },
            {
                toolName: 'moveLayerToGroup',
                params: {
                    layerIdSource: 'previous_placeImage_result',
                    targetGroupIdSource: 'previous_createGroup_result',
                    position: 'inside'
                },
                summary: `把 ${source.displayName} 商品图放入颜色组`,
                sourceAssetId: source.assetId,
                dependsOnPrevious: true
            },
            {
                toolName: 'createClippingMask',
                params: {
                    layerIdSource: 'previous_placeImage_result'
                },
                summary: `把 ${source.displayName} 商品图剪切到色卡底`,
                sourceAssetId: source.assetId,
                dependsOnPrevious: true
            },
            {
                toolName: 'createRectangle',
                params: {
                    name: `${source.colorName}-色名白底`,
                    x: geometry.labelPill.x,
                    y: geometry.labelPill.y,
                    width: geometry.labelPill.width,
                    height: geometry.labelPill.height,
                    fillColorHex: '#FFFFFF',
                    cornerRadius: 30
                },
                summary: `创建 ${source.displayName} 色名底`,
                sourceAssetId: source.assetId
            },
            {
                toolName: 'moveLayerToGroup',
                params: {
                    layerIdSource: 'previous_createRectangle_result',
                    targetGroupIdSource: 'previous_createGroup_result',
                    position: 'inside'
                },
                summary: `把 ${source.displayName} 色名底放入颜色组`,
                sourceAssetId: source.assetId,
                dependsOnPrevious: true
            },
            {
                toolName: 'createTextLayer',
                params: {
                    content: source.displayName,
                    name: `${source.colorName}-色名`,
                    x: geometry.labelText.x,
                    y: geometry.labelText.y,
                    fontSize: 34,
                    colorHex: '#111111',
                    alignment: 'center'
                },
                summary: `创建 ${source.displayName} 色名`,
                sourceAssetId: source.assetId
            },
            {
                toolName: 'moveLayerToGroup',
                params: {
                    layerIdSource: 'previous_createTextLayer_result',
                    targetGroupIdSource: 'previous_createGroup_result',
                    position: 'inside'
                },
                summary: `把 ${source.displayName} 色名放入颜色组`,
                sourceAssetId: source.assetId,
                dependsOnPrevious: true
            },
            {
                toolName: 'createTextLayer',
                params: {
                    content: source.colorName,
                    name: `${source.colorName}-编号`,
                    x: geometry.numberText.x,
                    y: geometry.numberText.y,
                    fontSize: geometry.numberText.fontSize,
                    colorHex: '#111111'
                },
                summary: `创建 ${source.displayName} 编号`,
                sourceAssetId: source.assetId
            },
            {
                toolName: 'moveLayerToGroup',
                params: {
                    layerIdSource: 'previous_createTextLayer_result',
                    targetGroupIdSource: 'previous_createGroup_result',
                    position: 'inside'
                },
                summary: `把 ${source.displayName} 编号放入颜色组`,
                sourceAssetId: source.assetId,
                dependsOnPrevious: true
            }
        );
    });

    requests.push(
        {
            toolName: 'switchDocument',
            params: {
                documentIdSource: 'createDocument_result'
            },
            summary: '保存前重新激活新建的 SKU 源文档',
            dependsOnPrevious: true
        },
        {
            toolName: 'getDocumentInfo',
            params: {},
            summary: '读回当前文档，确认保存目标仍是 SKU 源文档',
            dependsOnPrevious: true
        },
        {
            toolName: 'saveDocument',
            params: {
                format: 'psb',
                path: input.outputDocumentPath,
                saveAs: true
            },
            summary: '保存 SKU 源文档到项目 PSD 目录'
        },
        {
            toolName: 'getAcceptanceSnapshot',
            params: {
                includeHidden: true,
                includeBounds: true,
                maxLayers: 200
            },
            summary: '读回源文档图层结构，确认颜色组存在'
        }
    );

    return requests;
}

export function buildSkuCardSourcePreparationPlan(
    input: BuildSkuCardSourcePreparationPlanInput
): SkuCardSourcePreparationPlan {
    const projectPath = normalizePath(input.projectPath);
    const outputRelativePath = cleanString(input.outputRelativePath) || DEFAULT_OUTPUT_RELATIVE_PATH;
    const outputDocumentPath = projectPath ? joinProjectPath(projectPath, outputRelativePath) : '';
    const canvasSize = normalizePositiveInteger(input.canvasSize, DEFAULT_CANVAS_SIZE);
    const minimumSourceCount = normalizePositiveInteger(input.minimumSourceCount, 1);
    const selectedSources = selectConfirmedSkuCardSources(
        input.skuCardAssetCandidateReport,
        input.maxSources
    );

    if (!projectPath) {
        return {
            version: 'sku-card-source-preparation-plan/v0',
            status: 'blocked_missing_project_path',
            canRunPhotoshopWrites: false,
            outputDocumentPath,
            minimumSourceCount,
            selectedSources: [],
            toolRequests: [],
            blockers: ['缺少当前项目路径，不能确定 SKU 源文档保存位置。'],
            warnings: [],
            limitations: [
                '该计划只生成受控执行步骤，不直接读写项目文件。',
                '没有项目路径时禁止准备 Photoshop 写入请求。'
            ]
        };
    }

    if (selectedSources.length === 0) {
        return {
            version: 'sku-card-source-preparation-plan/v0',
            status: 'blocked_candidates_not_ready',
            canRunPhotoshopWrites: false,
            outputDocumentPath,
            minimumSourceCount,
            selectedSources: [],
            toolRequests: [],
            blockers: ['SKU 卡片候选还没有完成视觉确认，不能把路径候选直接整理成 SKU 源文档。'],
            warnings: input.skuCardAssetCandidateReport?.warnings || [],
            limitations: [
                '只有视觉确认过的完整单只/平铺素材可以进入 SKU 源文档准备。',
                '局部特写、模特穿着图、多只合照只可作为参考，不能直接作为颜色组源图。'
            ]
        };
    }

    if (selectedSources.length < minimumSourceCount) {
        return {
            version: 'sku-card-source-preparation-plan/v0',
            status: 'blocked_candidates_not_ready',
            canRunPhotoshopWrites: false,
            outputDocumentPath,
            minimumSourceCount,
            selectedSources,
            toolRequests: [],
            blockers: [`SKU 配置需要至少 ${minimumSourceCount} 个颜色槽，当前只有 ${selectedSources.length} 个已确认 SKU 色卡素材。`],
            warnings: [
                ...(input.skuCardAssetCandidateReport?.warnings || []),
                '需要继续确认更多可直接作为 SKU 色卡的单款素材，不能先生成注定与配置不匹配的源文档。'
            ],
            limitations: [
                '只有视觉确认过的完整单只/平铺素材可以进入 SKU 源文档准备。',
                '多色合集图可作为色卡参考，但不能自动冒充单个颜色槽。'
            ]
        };
    }

    return {
        version: 'sku-card-source-preparation-plan/v0',
        status: 'ready_for_preparation',
        canRunPhotoshopWrites: true,
        outputDocumentPath,
        minimumSourceCount,
        selectedSources,
        toolRequests: buildToolRequests({
            selectedSources,
            outputDocumentPath,
            canvasSize
        }),
        blockers: [],
        warnings: [
            '颜色组默认使用数字槽位命名，便于 1+2+3+4 这类 SKU 配置稳定匹配。',
            '源文档准备只确认素材分组和保存位置，不代表最终 SKU 卡片视觉质量已通过。'
        ],
        limitations: [
            '该计划不复制参考项目模板或配置，不读取考试答案。',
            '该计划不执行纯色精修；纯色背景色卡需要独立精修能力。',
            '最终仍需要 sku-batch 用模板导出后进行读回和视觉复核。'
        ]
    };
}
