export type SkuCardTemplatePreparationPlanVersion = 'sku-card-template-preparation-plan/v0';
export type SkuCardTemplatePreparationPlanStatus =
    | 'ready_for_preparation'
    | 'blocked_missing_project_path'
    | 'blocked_missing_required_sizes';

export type SkuCardTemplateKind = 'combo' | 'note';
export type SkuCardTemplatePreparationToolName =
    | 'createDocument'
    | 'createRectangle'
    | 'createTextLayer'
    | 'createSkuPlaceholders'
    | 'saveDocument'
    | 'getAcceptanceSnapshot';

export interface SkuCardTemplateOutput {
    size: number;
    kind: SkuCardTemplateKind;
    name: string;
    relativePath: string;
    outputPath: string;
    placeholderCount: number;
}

export interface SkuCardTemplatePreparationToolRequest {
    toolName: SkuCardTemplatePreparationToolName;
    params: Record<string, any>;
    summary: string;
    size: number;
    templateKind: SkuCardTemplateKind;
    outputPath?: string;
    dependsOnPrevious?: boolean;
}

export interface SkuCardTemplatePreparationPlan {
    version: SkuCardTemplatePreparationPlanVersion;
    status: SkuCardTemplatePreparationPlanStatus;
    canRunPhotoshopWrites: boolean;
    templateOutputs: SkuCardTemplateOutput[];
    toolRequests: SkuCardTemplatePreparationToolRequest[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildSkuCardTemplatePreparationPlanInput {
    projectPath?: string | null;
    requiredSizes?: number[] | null;
    templateOutputRelativeDir?: string;
    notePlaceholderCount?: number;
    canvasSize?: number;
    sourceCardAspectRatio?: number | null;
}

const DEFAULT_TEMPLATE_DIR = '模板文件';
const DEFAULT_CANVAS_SIZE = 800;
const DEFAULT_NOTE_PLACEHOLDER_COUNT = 8;
const DEFAULT_SOURCE_CARD_ASPECT_RATIO = 1;
const MIN_SOURCE_CARD_ASPECT_RATIO = 0.35;
const MAX_SOURCE_CARD_ASPECT_RATIO = 1.8;
// 治理2026-07-02：产物命名必须明示这是「通用占位模板（非设计稿）」——该生成器只作为
// 用户显式要求快速/默认/占位模板时的兜底，默认路径由 Agent 自主设计模板。
// 保留「卡片模板v4」后缀段：修订号解析（/卡片模板v(\d+)/）与既有 v4 模板打分口径不变。
const CARD_TEMPLATE_SUFFIX = '通用占位卡片模板v4';

type PlaceholderLayout = 'horizontal' | 'vertical' | 'grid';

type TemplateArea = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type TemplateSlot = TemplateArea & {
    index: number;
};

type TemplateLayoutSpec = {
    layout: PlaceholderLayout;
    area: TemplateArea;
    margin: number;
    columns?: number;
    centerLastRow?: boolean;
    slotAspectRatio: number;
};

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizeSizes(values?: number[] | null): number[] {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
            .map((item) => Math.round(item))
    )).sort((a, b) => a - b);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.round(numeric);
}

function normalizeAspectRatio(value: unknown, fallback = DEFAULT_SOURCE_CARD_ASPECT_RATIO): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(MIN_SOURCE_CARD_ASPECT_RATIO, Math.min(MAX_SOURCE_CARD_ASPECT_RATIO, numeric));
}

function joinProjectPath(projectPath: string, relativePath: string): string {
    const project = normalizePath(projectPath);
    const relative = normalizePath(relativePath).replace(/^\/+/, '');
    return `${project}/${relative}`.replace(/\//g, '\\');
}

function buildRelativePath(dir: string, name: string): string {
    return `${normalizePath(dir).replace(/^\/+/, '')}/${name}.tif`;
}

function buildTemplateOutputs(input: {
    projectPath: string;
    requiredSizes: number[];
    templateOutputRelativeDir: string;
    notePlaceholderCount: number;
}): SkuCardTemplateOutput[] {
    const outputs: SkuCardTemplateOutput[] = [];
    for (const size of input.requiredSizes) {
        const comboName = `${size}双装-${CARD_TEMPLATE_SUFFIX}`;
        const comboRelativePath = buildRelativePath(input.templateOutputRelativeDir, comboName);
        outputs.push({
            size,
            kind: 'combo',
            name: comboName,
            relativePath: comboRelativePath,
            outputPath: joinProjectPath(input.projectPath, comboRelativePath),
            placeholderCount: size
        });

        const noteName = `${size}双自选备注-${CARD_TEMPLATE_SUFFIX}`;
        const noteRelativePath = buildRelativePath(input.templateOutputRelativeDir, noteName);
        outputs.push({
            size,
            kind: 'note',
            name: noteName,
            relativePath: noteRelativePath,
            outputPath: joinProjectPath(input.projectPath, noteRelativePath),
            placeholderCount: input.notePlaceholderCount
        });
    }
    return outputs;
}

function buildComboLayoutSpec(size: number, canvasSize: number, sourceCardAspectRatio: number): TemplateLayoutSpec {
    const safeSize = Math.max(1, Math.round(size));
    const margin = safeSize >= 4 ? 12 : 18;
    const x = safeSize >= 4 ? 32 : safeSize === 3 ? 44 : 58;
    const width = canvasSize - x * 2;
    const rawSlotWidth = Math.floor((width - margin * (safeSize - 1)) / safeSize);
    const maxSlotHeight = safeSize >= 4 ? 292 : safeSize === 3 ? 360 : 506;
    const slotHeight = Math.min(maxSlotHeight, Math.round(rawSlotWidth / sourceCardAspectRatio));
    const y = safeSize >= 4 ? 242 : safeSize === 3 ? 236 : 220;

    return {
        layout: 'horizontal',
        area: {
            x,
            y,
            width,
            height: slotHeight
        },
        margin,
        columns: safeSize,
        slotAspectRatio: sourceCardAspectRatio
    };
}

function buildNoteLayoutSpec(placeholderCount: number, canvasSize: number, sourceCardAspectRatio: number): TemplateLayoutSpec {
    const columns = Math.max(1, Math.min(4, placeholderCount));
    return {
        layout: 'grid',
        area: { x: 32, y: 306, width: canvasSize - 64, height: 430 },
        margin: 18,
        columns,
        slotAspectRatio: sourceCardAspectRatio
    };
}

function fitSlotToAspect(slot: TemplateSlot, aspectRatio: number): TemplateSlot {
    const normalizedAspectRatio = normalizeAspectRatio(aspectRatio);
    let width = slot.width;
    let height = Math.round(width / normalizedAspectRatio);
    if (height > slot.height) {
        height = slot.height;
        width = Math.round(height * normalizedAspectRatio);
    }
    return {
        index: slot.index,
        x: slot.x + Math.round((slot.width - width) / 2),
        y: slot.y + Math.round((slot.height - height) / 2),
        width,
        height
    };
}

function enumerateSlots(input: {
    count: number;
    spec: TemplateLayoutSpec;
}): TemplateSlot[] {
    const slots: TemplateSlot[] = [];
    const count = Math.max(1, Math.round(input.count));
    const { area, margin, layout } = input.spec;

    if (layout === 'horizontal') {
        const width = Math.floor((area.width - margin * (count - 1)) / count);
        for (let index = 0; index < count; index++) {
            slots.push(fitSlotToAspect({
                index,
                x: area.x + index * (width + margin),
                y: area.y,
                width,
                height: area.height
            }, input.spec.slotAspectRatio));
        }
        return slots;
    }

    if (layout === 'vertical') {
        const height = Math.floor((area.height - margin * (count - 1)) / count);
        for (let index = 0; index < count; index++) {
            slots.push(fitSlotToAspect({
                index,
                x: area.x,
                y: area.y + index * (height + margin),
                width: area.width,
                height
            }, input.spec.slotAspectRatio));
        }
        return slots;
    }

    const columns = Math.max(1, Math.min(count, Math.round(input.spec.columns || Math.ceil(Math.sqrt(count)))));
    const rows = Math.ceil(count / columns);
    const width = Math.floor((area.width - margin * (columns - 1)) / columns);
    const height = Math.floor((area.height - margin * (rows - 1)) / rows);
    const lastRowCount = count % columns || columns;
    const shouldCenterLastRow = input.spec.centerLastRow === true && lastRowCount < columns;
    const lastRowOffsetX = shouldCenterLastRow
        ? Math.round(((columns - lastRowCount) * (width + margin)) / 2)
        : 0;
    for (let index = 0; index < count; index++) {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const isLastRow = row === rows - 1;
        slots.push(fitSlotToAspect({
            index,
            x: area.x + col * (width + margin) + (isLastRow ? lastRowOffsetX : 0),
            y: area.y + row * (height + margin),
            width,
            height
        }, input.spec.slotAspectRatio));
    }
    return slots;
}

function buildFrameRequests(input: {
    output: SkuCardTemplateOutput;
    canvasSize: number;
    spec: TemplateLayoutSpec;
}): SkuCardTemplatePreparationToolRequest[] {
    const isNote = input.output.kind === 'note';
    const requests: SkuCardTemplatePreparationToolRequest[] = [
        {
            toolName: 'createRectangle',
            params: {
                name: 'SKU卡片浅暖底',
                x: 0,
                y: 0,
                width: input.canvasSize,
                height: input.canvasSize,
                fillColorHex: '#F4EFE8',
                cornerRadius: 0
            },
            summary: '创建 SKU 卡片浅暖背景',
            size: input.output.size,
            templateKind: input.output.kind,
            outputPath: input.output.outputPath,
            dependsOnPrevious: true
        }
    ];

    if (isNote) {
        requests.push(
            {
                toolName: 'createTextLayer',
                params: {
                    content: `买家留言自选${input.output.size}双`,
                    name: '自选备注标题',
                    x: 112,
                    y: 64,
                    fontSize: 58,
                    colorHex: '#111111'
                },
                summary: '创建自选备注主标题',
                size: input.output.size,
                templateKind: input.output.kind,
                outputPath: input.output.outputPath,
                dependsOnPrevious: true
            },
            {
                toolName: 'createRectangle',
                params: {
                    name: '自选备注提示条',
                    x: 80,
                    y: 166,
                    width: input.canvasSize - 160,
                    height: 64,
                    fillColorHex: '#C86F18',
                    cornerRadius: 30
                },
                summary: '创建自选备注提示条背景',
                size: input.output.size,
                templateKind: input.output.kind,
                outputPath: input.output.outputPath,
                dependsOnPrevious: true
            },
            {
                toolName: 'createTextLayer',
                params: {
                    content: '请留言备注，若无备注仓库将随机发货',
                    name: '自选备注提示文案',
                    x: 128,
                    y: 184,
                    fontSize: 25,
                    colorHex: '#FFFFFF'
                },
                summary: '创建自选备注提示文案',
                size: input.output.size,
                templateKind: input.output.kind,
                outputPath: input.output.outputPath,
                dependsOnPrevious: true
            }
        );
    } else {
        requests.push({
            toolName: 'createTextLayer',
            params: {
                content: `${input.output.size}双装`,
                name: 'SKU规格标题',
                x: 36,
                y: 38,
                fontSize: 34,
                colorHex: '#111111'
            },
            summary: '创建组合规格标题',
            size: input.output.size,
            templateKind: input.output.kind,
            outputPath: input.output.outputPath,
            dependsOnPrevious: true
        });
    }

    for (const slot of enumerateSlots({ count: input.output.placeholderCount, spec: input.spec })) {
        requests.push({
            toolName: 'createRectangle',
            params: {
                name: `${isNote ? '自选色卡底' : '组合卡片底'}${slot.index + 1}`,
                x: slot.x,
                y: slot.y,
                width: slot.width,
                height: slot.height,
                fillColorHex: '#FFFFFF',
                cornerRadius: 14
            },
            summary: `创建第 ${slot.index + 1} 个卡片底`,
            size: input.output.size,
            templateKind: input.output.kind,
            outputPath: input.output.outputPath,
            dependsOnPrevious: true
        });
    }

    return requests;
}

function buildToolRequests(input: {
    outputs: SkuCardTemplateOutput[];
    canvasSize: number;
    sourceCardAspectRatio: number;
}): SkuCardTemplatePreparationToolRequest[] {
    const requests: SkuCardTemplatePreparationToolRequest[] = [];
    for (const output of input.outputs) {
        const isNote = output.kind === 'note';
        const layoutSpec = isNote
            ? buildNoteLayoutSpec(output.placeholderCount, input.canvasSize, input.sourceCardAspectRatio)
            : buildComboLayoutSpec(output.size, input.canvasSize, input.sourceCardAspectRatio);
        const slots = enumerateSlots({ count: output.placeholderCount, spec: layoutSpec });
        requests.push(
            {
                toolName: 'createDocument',
                params: {
                    name: output.name,
                    width: input.canvasSize,
                    height: input.canvasSize,
                    resolution: 72,
                    backgroundColor: 'white'
                },
                summary: `新建 ${output.name} 模板画布`,
                size: output.size,
                templateKind: output.kind,
                outputPath: output.outputPath
            },
            ...buildFrameRequests({
                output,
                canvasSize: input.canvasSize,
                spec: layoutSpec
            }),
            {
                toolName: 'createSkuPlaceholders',
                params: {
                    count: output.placeholderCount,
                    layout: layoutSpec.layout,
                    margin: layoutSpec.margin,
                    padding: 0,
                    area: layoutSpec.area,
                    columns: layoutSpec.columns,
                    centerLastRow: layoutSpec.centerLastRow,
                    naming: '[SKU:占位{n}]',
                    strokeColor: '#1A73E8',
                    fillOpacity: 0,
                    visible: false,
                    sourceCardAspectRatio: input.sourceCardAspectRatio,
                    slots: slots.map((slot) => ({
                        name: `[SKU:占位${slot.index + 1}]`,
                        x: slot.x,
                        y: slot.y,
                        width: slot.width,
                        height: slot.height
                    }))
                },
                summary: `创建 ${output.placeholderCount} 个隐藏 SKU 定位占位符`,
                size: output.size,
                templateKind: output.kind,
                outputPath: output.outputPath,
                dependsOnPrevious: true
            },
            {
                toolName: 'saveDocument',
                params: {
                    format: 'tiff',
                    path: output.outputPath,
                    saveAs: true
                },
                summary: `保存 ${output.name} 模板`,
                size: output.size,
                templateKind: output.kind,
                outputPath: output.outputPath,
                dependsOnPrevious: true
            },
            {
                toolName: 'getAcceptanceSnapshot',
                params: {
                    includeHidden: true,
                    includeBounds: true,
                    maxLayers: 120
                },
                summary: `读回 ${output.name} 模板占位结构`,
                size: output.size,
                templateKind: output.kind,
                outputPath: output.outputPath,
                dependsOnPrevious: true
            }
        );
    }
    return requests;
}

export function buildSkuCardTemplatePreparationPlan(
    input: BuildSkuCardTemplatePreparationPlanInput
): SkuCardTemplatePreparationPlan {
    const projectPath = normalizePath(input.projectPath);
    const requiredSizes = normalizeSizes(input.requiredSizes);
    const templateOutputRelativeDir = cleanString(input.templateOutputRelativeDir) || DEFAULT_TEMPLATE_DIR;
    const notePlaceholderCount = normalizePositiveInteger(input.notePlaceholderCount, DEFAULT_NOTE_PLACEHOLDER_COUNT);
    const canvasSize = normalizePositiveInteger(input.canvasSize, DEFAULT_CANVAS_SIZE);
    const sourceCardAspectRatio = normalizeAspectRatio(input.sourceCardAspectRatio);

    if (!projectPath) {
        return {
            version: 'sku-card-template-preparation-plan/v0',
            status: 'blocked_missing_project_path',
            canRunPhotoshopWrites: false,
            templateOutputs: [],
            toolRequests: [],
            blockers: ['缺少当前项目路径，不能确定 SKU 模板保存位置。'],
            warnings: [],
            limitations: [
                '该计划只生成受控执行步骤，不直接读写项目文件。',
                '没有项目路径时禁止准备 Photoshop 写入请求。'
            ]
        };
    }

    if (requiredSizes.length === 0) {
        return {
            version: 'sku-card-template-preparation-plan/v0',
            status: 'blocked_missing_required_sizes',
            canRunPhotoshopWrites: false,
            templateOutputs: [],
            toolRequests: [],
            blockers: ['缺少需要准备的 SKU 规格，不能生成模板。'],
            warnings: [],
            limitations: [
                '模板准备必须显式知道 2双、3双、4双等目标规格。',
                '该计划不会根据参考项目文件名猜测考试规格。'
            ]
        };
    }

    const templateOutputs = buildTemplateOutputs({
        projectPath,
        requiredSizes,
        templateOutputRelativeDir,
        notePlaceholderCount
    });

    return {
        version: 'sku-card-template-preparation-plan/v0',
        status: 'ready_for_preparation',
        canRunPhotoshopWrites: true,
        templateOutputs,
        toolRequests: buildToolRequests({
            outputs: templateOutputs,
            canvasSize,
            sourceCardAspectRatio
        }),
        blockers: [],
        warnings: [
            '该计划生成的是 SKU 批处理可用的通用卡片视觉模板，不代表最终 SKU 视觉质量已通过。',
            '模板会使用隐藏定位占位符，最终导出仍需要 sku-batch 读回和视觉复核。'
        ],
        limitations: [
            '该计划不复制参考项目模板或配置。',
            '该计划不把参考项目文件作为当前项目答案。',
            '模板视觉风格提供通用卡片结构；复杂品牌化卡片仍需要后续设计增强。'
        ]
    };
}
