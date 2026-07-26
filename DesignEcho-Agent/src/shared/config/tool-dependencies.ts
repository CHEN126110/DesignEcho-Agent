/**
 * 工具依赖关系和使用链配置
 * 
 * 定义：
 * 1. 工具之间的依赖关系
 * 2. 常见任务的工具组合
 * 3. 错误处理策略
 */

/**
 * 工具依赖定义
 */
export interface ToolDependency {
    /** 必须先执行的工具 */
    requires: string[];
    /** 建议先执行的工具（可选） */
    optional: string[];
    /** 依赖说明 */
    description: string;
    /** 常见错误及解决方案 */
    commonErrors?: Array<{
        error: string;
        solution: string;
    }>;
}

function hasFiniteLayerId(value: unknown): boolean {
    const id = Number(value);
    return Number.isFinite(id) && id > 0;
}

function hasLayerIds(value: unknown, minCount = 1): boolean {
    return Array.isArray(value)
        && value.map(Number).filter((id) => Number.isFinite(id) && id > 0).length >= minCount;
}

function hasTextLayerUpdates(value: unknown): boolean {
    return Array.isArray(value)
        && value.length > 0
        && value.every((item) => {
            const record = item as Record<string, unknown> | null;
            return !!record && hasFiniteLayerId(record.layerId);
        });
}

function canTargetLayerWithoutSelection(toolName: string, params?: unknown): boolean {
    const record = (params && typeof params === 'object') ? params as Record<string, unknown> : {};
    if (record.useCurrentSelection === true) return true;

    switch (toolName) {
        case 'setTextContent':
            return hasFiniteLayerId(record.layerId) || hasLayerIds(record.layerIds) || hasTextLayerUpdates(record.updates);
        case 'getTextContent':
            return hasFiniteLayerId(record.layerId) || hasLayerIds(record.layerIds);
        case 'getTextStyle':
            return hasFiniteLayerId(record.layerId);
        case 'setTextStyle':
        case 'moveLayer':
        case 'moveLayerToGroup':
        case 'reorderLayer':
        case 'alignToReference':
        case 'renameLayer':
        case 'deleteLayer':
        case 'duplicateLayer':
        case 'removeBackground':
        case 'createClippingMask':
        case 'releaseClippingMask':
            return hasFiniteLayerId(record.layerId);
        case 'groupLayers':
            return hasLayerIds(record.layerIds);
        default:
            return false;
    }
}

function removeDependenciesSatisfiedByParams(
    toolName: string,
    params: unknown,
    missingRequired: string[]
): string[] {
    if (!missingRequired.includes('selectLayer')) return missingRequired;
    if (!canTargetLayerWithoutSelection(toolName, params)) return missingRequired;
    return missingRequired.filter((dependency) => dependency !== 'selectLayer');
}

/**
 * 工具依赖关系图
 */
export const TOOL_DEPENDENCIES: Record<string, ToolDependency> = {
    // ===== 修改类工具（需要先选中图层）=====
    setTextContent: {
        requires: ['selectLayer'],
        optional: ['getTextContent'],
        description: '修改文本前，需要先选中目标文本图层',
        commonErrors: [
            { error: '没有选中图层', solution: '先调用 selectLayer 选中目标图层' },
            { error: '不是文本图层', solution: '用 getAllTextLayers 找到正确的文本图层' }
        ]
    },
    
    setTextStyle: {
        requires: ['selectLayer'],
        optional: ['getTextStyle', 'resolveFontName'],
        description: '修改样式前，需要先选中目标文本图层；写入字体前应先解析可用 PostScript 名',
        commonErrors: [
            { error: '没有选中图层', solution: '先调用 selectLayer' },
            { error: '不是文本图层', solution: '确保选中的是文本图层' },
            { error: '未找到可用字体', solution: '先调用 resolveFontName 获取可用字体或候选建议' }
        ]
    },
    
    moveLayer: {
        requires: ['selectLayer'],
        optional: ['getLayerBounds', 'getDocumentInfo'],
        description: '移动图层画布位置前，需要先选中目标图层；不用于调整图层堆叠顺序',
        commonErrors: [
            { error: '没有选中图层', solution: '先调用 selectLayer' },
            { error: '坐标超出范围', solution: '用 getDocumentInfo 获取画布尺寸' },
            { error: '想调整图层顺序', solution: '使用 reorderLayer，而不是 moveLayer' }
        ]
    },

    moveLayerToGroup: {
        requires: ['selectLayer'],
        optional: ['getLayerHierarchy'],
        description: '把图层或图层组移动到目标图层组内；用于改变 Photoshop 图层父子层级，不用于画布 x/y 位置移动',
        commonErrors: [
            { error: 'Target layer is not a group', solution: '先调用 getLayerHierarchy 找到正确的目标图层组 ID' },
            { error: 'Cannot move a layer or group into itself or its descendant', solution: '重新选择非自身、非后代的目标父级组' },
            { error: '想移动画布位置', solution: '使用 moveLayer，而不是 moveLayerToGroup' }
        ]
    },
    
    alignLayers: {
        requires: ['selectLayer'],
        optional: ['getElementMapping'],
        description: '对齐前，需要先选中要对齐的图层',
        commonErrors: [
            { error: '没有选中图层', solution: '先调用 selectLayer 选中图层' },
            { error: '只选中了一个图层', solution: '对齐需要多个图层或相对画布对齐' }
        ]
    },
    
    distributeLayers: {
        requires: ['selectLayer'],
        optional: ['getElementMapping'],
        description: '均匀分布前，需要选中多个图层',
        commonErrors: [
            { error: '图层数量不足', solution: '至少需要3个图层才能均匀分布' }
        ]
    },

    alignToReference: {
        requires: ['selectLayer'],
        optional: ['getLayerHierarchy', 'getLayerBounds', 'getDocumentInfo'],
        description: '对齐到参考点前，需要明确目标 layerId、缩放比例、目标中心点和主体偏移；传入 layerId 时无需先 selectLayer',
        commonErrors: [
            { error: '未找到图层', solution: '先调用 getLayerHierarchy 或 getLayerBounds 确认目标 layerId' },
            { error: '已锁定', solution: '先让用户解锁图层，或改用未锁定图层' },
            { error: 'does not support DOM translate', solution: '目标图层不支持安全移动；停止执行并报告，不要改用可能弹窗的原生命令替代' }
        ]
    },
    
    renameLayer: {
        requires: ['selectLayer'],
        optional: [],
        description: '重命名前，需要先选中目标图层'
    },

    deleteLayer: {
        requires: ['selectLayer'],
        optional: ['getLayerHierarchy'],
        description: '删除图层前，需要先从图层层级中定位并选中目标图层'
    },

    duplicateLayer: {
        requires: ['selectLayer'],
        optional: ['getLayerHierarchy'],
        description: '复制图层前，需要先确认并选中目标图层'
    },
    
    reorderLayer: {
        requires: ['selectLayer'],
        optional: ['getLayerHierarchy'],
        description: '调整 Photoshop 图层堆叠顺序前，需要先选中目标图层；置顶、置底、上移、下移、移动到指定图层上方/下方均使用此工具'
    },
    
    createClippingMask: {
        requires: ['selectLayer'],
        optional: ['getLayerHierarchy'],
        description: '创建剪切蒙版前，需要先选中图层'
    },
    
    releaseClippingMask: {
        requires: ['selectLayer'],
        optional: [],
        description: '释放剪切蒙版前，需要先选中图层'
    },
    
    removeBackground: {
        requires: ['selectLayer'],
        optional: ['getLayerBounds'],
        description: '抠图前，需要先选中要处理的图层'
    },
    
    // ===== 查询类工具（无依赖）=====
    getDocumentInfo: {
        requires: [],
        optional: [],
        description: '获取文档信息，无需前置条件'
    },
    
    getElementMapping: {
        requires: [],
        optional: [],
        description: '获取所有元素映射，无需前置条件'
    },
    
    getAllTextLayers: {
        requires: [],
        optional: [],
        description: '获取所有文本图层，无需前置条件'
    },
    
    getLayerHierarchy: {
        requires: [],
        optional: [],
        description: '获取图层层级，无需前置条件'
    },
    
    analyzeLayout: {
        requires: [],
        optional: ['getElementMapping'],
        description: '分析布局，建议先获取元素映射'
    },
    
    getTextContent: {
        requires: ['selectLayer'],
        optional: [],
        description: '获取文本内容，需要先选中文本图层'
    },
    
    getTextStyle: {
        requires: ['selectLayer'],
        optional: [],
        description: '获取文本样式，可传入 layerId；未传 layerId 时需要先选中文本图层'
    },
    
    getLayerBounds: {
        requires: [],
        optional: ['selectLayer'],
        description: '获取图层边界，可选先选中图层'
    },
    
    listDocuments: {
        requires: [],
        optional: [],
        description: '列出所有文档，无需前置条件'
    },
    
    diagnoseState: {
        requires: [],
        optional: [],
        description: '诊断状态，无需前置条件'
    },
    
    getCanvasSnapshot: {
        requires: [],
        optional: [],
        description: '获取画布截图，无需前置条件'
    },
    
    // ===== 其他工具 =====
    selectLayer: {
        requires: [],
        optional: ['getLayerHierarchy', 'getAllTextLayers'],
        description: '选中图层，建议先获取图层列表确认名称'
    },
    
    switchDocument: {
        requires: [],
        optional: ['listDocuments'],
        description: '切换文档，建议先列出所有文档'
    },
    
    undo: {
        requires: [],
        optional: [],
        description: '撤销操作，无需前置条件'
    },
    
    redo: {
        requires: [],
        optional: [],
        description: '重做操作，无需前置条件'
    },
    
    quickExport: {
        requires: [],
        optional: ['getDocumentInfo'],
        description: '快速导出，无需前置条件'
    },

    exportGroup: {
        requires: [],
        optional: ['getLayerHierarchy', 'getDocumentInfo'],
        description: '导出指定图层组或图层到完整 PNG 路径；必须提供 groupPath 或 layerId 以及 outputPath',
        commonErrors: [
            { error: '没有目标组', solution: '先调用 getLayerHierarchy 确认 groupPath 或 layerId' },
            { error: '没有输出路径', solution: '提供完整 outputPath，而不是只提供目录' }
        ]
    },
    
    saveDocument: {
        requires: [],
        optional: [],
        description: '保存文档，无需前置条件'
    },
    
    // ===== 创建类工具 =====
    createRectangle: {
        requires: [],
        optional: ['getDocumentInfo'],
        description: '创建矩形，建议先了解画布尺寸'
    },
    
    createEllipse: {
        requires: [],
        optional: ['getDocumentInfo'],
        description: '创建椭圆，建议先了解画布尺寸'
    },
    
    createTextLayer: {
        requires: [],
        optional: ['getDocumentInfo', 'resolveFontName'],
        description: '创建文字图层，建议先了解画布尺寸；指定字体前应先解析可用 PostScript 名'
    },
    
    createGroup: {
        requires: [],
        optional: ['selectLayer'],
        description: '创建图层组，如果从选中图层创建则需先选中'
    },
    
    groupLayers: {
        requires: ['selectLayer'],
        optional: [],
        description: '将选中图层编组，需要先选中多个图层'
    },
    
    ungroupLayers: {
        requires: [],
        optional: [],
        description: '解散图层组，需要指定组ID'
    },
    
    // ===== 资源管理工具 =====
    listProjectResources: {
        requires: [],
        optional: [],
        description: '列出项目资源，无需前置条件'
    },
    
    searchProjectResources: {
        requires: [],
        optional: ['listProjectResources'],
        description: '搜索项目资源，建议先浏览可用资源'
    },

    createProjectContactSheetOverview: {
        requires: [],
        optional: ['listProjectResources', 'searchProjectResources'],
        description: '生成项目图片缩略图总览，用于先整体观察项目素材'
    },

    analyzeProjectContactSheetOverview: {
        requires: [],
        optional: ['listProjectResources', 'createProjectContactSheetOverview', 'analyzeAssetContent'],
        description: '生成并理解项目图片缩略图总览，用于判断整体风格、素材角色和后续单图复核编号'
    },
    
    getProjectStructure: {
        requires: [],
        optional: [],
        description: '获取项目目录结构，无需前置条件'
    },
    
    getResourcesByCategory: {
        requires: [],
        optional: [],
        description: '按类别获取资源，无需前置条件'
    },
    
    placeImage: {
        requires: [],
        optional: ['listProjectResources', 'searchProjectResources', 'getResourcesByCategory'],
        description: '置入图片，建议先浏览或搜索项目资源获取图片路径',
        commonErrors: [
            { error: '文件不存在', solution: '使用 listProjectResources 或 searchProjectResources 获取正确的文件路径' },
            { error: '不支持的格式', solution: '仅支持 jpg、png、gif、webp、bmp、tiff 格式' }
        ]
    }
};

/**
 * 常见任务的工具使用链
 */
export interface TaskToolChain {
    /** 任务描述 */
    description: string;
    /** 触发关键词 */
    triggers: string[];
    /** 工具调用步骤 */
    steps: Array<{
        tool: string;
        purpose: string;
        params?: Record<string, any>;
    }>;
    /** 可选步骤 */
    optional?: Array<{
        tool: string;
        purpose: string;
        condition: string;
    }>;
}

/**
 * 常见任务的工具组合
 */
export const TASK_TOOL_CHAINS: Record<string, TaskToolChain> = {
    '分析设计': {
        description: '全面分析当前设计',
        triggers: ['分析', '看看', '评估', '检查', '诊断'],
        steps: [
            { tool: 'getDocumentInfo', purpose: '获取文档基本信息' },
            { tool: 'getElementMapping', purpose: '获取所有元素的位置和类型' },
            { tool: 'analyzeLayout', purpose: '分析布局结构' },
            { tool: 'getAllTextLayers', purpose: '获取所有文案内容' }
        ]
    },
    
    '修改文案': {
        description: '修改指定文本图层的内容',
        triggers: ['改文案', '改文字', '修改标题', '换文案'],
        steps: [
            { tool: 'getAllTextLayers', purpose: '列出所有文本图层，找到目标' },
            { tool: 'selectLayer', purpose: '选中目标文本图层' },
            { tool: 'setTextContent', purpose: '设置新的文本内容' }
        ],
        optional: [
            { tool: 'setTextStyle', purpose: '同时调整样式', condition: '如果需要改样式' }
        ]
    },
    
    '撰写文案': {
        description: '按目标人群、商品事实和版式约束撰写可替换文案',
        triggers: ['撰写文案', '写文案', '生成文案', '优化文案', '文案优化', '改进文案'],
        steps: [
            { tool: 'getAllTextLayers', purpose: '获取所有文案' },
            { tool: 'selectLayer', purpose: '选中目标文本图层' },
            { tool: 'getTextContent', purpose: '获取当前文本的字数、行数和排版骨架' },
            { tool: 'getTextStyle', purpose: '读取当前样式但不修改样式' }
            // AI 撰写候选后仅替换文本内容
        ]
    },
    
    '调整布局': {
        description: '调整元素的位置和对齐',
        triggers: ['调整布局', '排版', '移动', '对齐'],
        steps: [
            { tool: 'getElementMapping', purpose: '了解当前元素位置' },
            { tool: 'selectLayer', purpose: '选中要调整的图层' },
            { tool: 'moveLayer', purpose: '移动到目标位置' }
        ],
        optional: [
            { tool: 'alignLayers', purpose: '执行对齐', condition: '如果需要对齐' }
        ]
    },
    
    '居中对齐': {
        description: '将元素居中对齐',
        triggers: ['居中', '中间', '水平居中', '垂直居中'],
        steps: [
            { tool: 'selectLayer', purpose: '选中要居中的图层' },
            { tool: 'alignLayers', purpose: '执行居中对齐', params: { alignment: 'center' } }
        ]
    },
    
    '智能抠图': {
        description: '去除图片背景',
        triggers: ['抠图', '去背景', '去除背景', '抠出'],
        steps: [
            { tool: 'selectLayer', purpose: '选中要抠图的图层' },
            { tool: 'removeBackground', purpose: '执行智能抠图' }
        ]
    },
    
    '查看文档状态': {
        description: '查看当前文档信息',
        triggers: ['当前文档', '文档信息', '画布信息'],
        steps: [
            { tool: 'getDocumentInfo', purpose: '获取文档信息' },
            { tool: 'getLayerHierarchy', purpose: '获取图层结构' }
        ]
    },
    
    '浏览项目素材': {
        description: '查看项目目录中的可用素材',
        triggers: ['项目素材', '有什么图', '素材', '图片列表', '产品图', '背景图'],
        steps: [
            { tool: 'getResourcesByCategory', purpose: '按类别查看资源' },
            { tool: 'getProjectStructure', purpose: '查看目录结构' }
        ]
    },
    
    '置入图片': {
        description: '从项目中选择图片置入到文档',
        triggers: ['置入', '放入', '添加图片', '插入图片', '放这张图'],
        steps: [
            { tool: 'listProjectResources', purpose: '列出可用图片' },
            { tool: 'placeImage', purpose: '置入选定的图片' }
        ],
        optional: [
            { tool: 'searchProjectResources', purpose: '搜索特定图片', condition: '如果需要搜索' },
            { tool: 'selectLayer', purpose: '选中置入后的图层', condition: '如果需要后续调整' }
        ]
    },
    
    '使用产品图': {
        description: '查找并使用项目中的产品图',
        triggers: ['产品图', '实拍图', '白底图', '主体图'],
        steps: [
            { tool: 'getResourcesByCategory', purpose: '获取产品图分类' },
            { tool: 'placeImage', purpose: '置入选定的产品图' }
        ]
    }
};

/**
 * 检查工具调用是否满足前置条件
 */
export const checkToolDependencies = (
    toolName: string,
    executedTools: string[],
    params?: unknown
): { valid: boolean; missingDependencies: string[]; suggestion?: string } => {
    const dependency = TOOL_DEPENDENCIES[toolName];
    
    if (!dependency) {
        return { valid: true, missingDependencies: [] };
    }
    
    const missingRequired = removeDependenciesSatisfiedByParams(
        toolName,
        params,
        dependency.requires.filter(req => !executedTools.includes(req))
    );
    
    if (missingRequired.length > 0) {
        return {
            valid: false,
            missingDependencies: missingRequired,
            suggestion: `请先执行 ${missingRequired.join(', ')}，${dependency.description}`
        };
    }
    
    return { valid: true, missingDependencies: [] };
};

/**
 * 获取任务对应的工具链
 */
export const getToolChainForTask = (userInput: string): TaskToolChain | null => {
    const lowerInput = userInput.toLowerCase();
    
    for (const [taskName, chain] of Object.entries(TASK_TOOL_CHAINS)) {
        if (chain.triggers.some(trigger => lowerInput.includes(trigger))) {
            return chain;
        }
    }
    
    return null;
};

/**
 * 获取工具的错误恢复建议
 */
export const getErrorRecovery = (
    toolName: string,
    errorMessage: string
): string | null => {
    const dependency = TOOL_DEPENDENCIES[toolName];
    
    if (!dependency?.commonErrors) {
        return null;
    }
    
    const matchedError = dependency.commonErrors.find(
        err => errorMessage.toLowerCase().includes(err.error.toLowerCase())
    );
    
    return matchedError?.solution || null;
};

export default TOOL_DEPENDENCIES;
