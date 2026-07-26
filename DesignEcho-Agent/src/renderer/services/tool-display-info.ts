import { getSkillById } from '../../shared/skills/skill-declarations';

export type ToolDisplayInfo = {
    name: string;
    icon: string;
    description: string;
};

export const TOOL_NAME_MAP: Record<string, ToolDisplayInfo> = {
    createInteractiveCard: { name: '确认卡片', icon: '[S]', description: '在聊天中创建需要用户确认或编辑的交互卡片。' },
    createDocument: { name: '创建文档', icon: '[D]', description: '创建新的 Photoshop 文档。' },
    getDocumentInfo: { name: '读取文档信息', icon: '[D]', description: '读取当前文档的尺寸和基础信息。' },
    listDocuments: { name: '检查设计文档', icon: '[D]', description: '检查当前打开的设计文档。' },
    switchDocument: { name: '切换文档', icon: '[D]', description: '切换到指定文档。' },
    diagnoseState: { name: '检查 Photoshop 状态', icon: '[S]', description: '检查当前 Photoshop 运行状态。' },

    selectLayer: { name: '选择图层', icon: '[L]', description: '选中指定图层。' },
    getLayerHierarchy: { name: '读取图层结构', icon: '[L]', description: '读取当前文档的图层层级。' },
    findLayers: { name: '查找图层', icon: '[L]', description: '按名称、类型或组内条件查找图层。' },
    getAllTextLayers: { name: '读取文本图层', icon: '[T]', description: '读取当前文档中的文本图层。' },
    getLayerBounds: { name: '读取图层边界', icon: '[L]', description: '读取图层的位置和尺寸。' },
    getLayerProperties: { name: '读取图层属性', icon: '[L]', description: '读取指定图层的属性信息。' },
    getClippingMaskInfo: { name: '检查图片约束', icon: '[R]', description: '检查图片是否被约束在目标区域。' },
    getAllClippingMasks: { name: '检查图片约束关系', icon: '[R]', description: '检查当前文档里的图片约束关系。' },
    moveLayer: { name: '移动图层', icon: '[L]', description: '调整图层位置。' },
    alignLayers: { name: '对齐图层', icon: '[L]', description: '对齐多个图层。' },
    alignToReference: { name: '对齐到参考点', icon: '[L]', description: '缩放移动图层使主体中心落到目标点。' },
    distributeLayers: { name: '分布图层', icon: '[L]', description: '均匀分布多个图层。' },
    smartLayout: { name: '智能布局', icon: '[L]', description: '根据当前内容自动调整布局。' },

    getTextContent: { name: '读取文本', icon: '[T]', description: '读取文本图层内容。' },
    setTextContent: { name: '修改文本', icon: '[T]', description: '修改文本图层内容。' },
    getTextStyle: { name: '读取文本样式', icon: '[T]', description: '读取字体、字重、字色等样式。' },
    resolveFontName: { name: '解析字体名称', icon: '[T]', description: '只读解析 Photoshop 可用字体。' },
    setTextStyle: { name: '设置文本样式', icon: '[T]', description: '修改文本图层样式。' },
    createTextLayer: { name: '创建文本图层', icon: '[T]', description: '创建新的文本图层。' },
    renderLayout: { name: '生成阶段草稿', icon: '[L]', description: '生成当前阶段的版面草稿。' },

    renameLayer: { name: '重命名图层', icon: '[L]', description: '修改图层名称。' },
    batchRenameLayers: { name: '批量重命名图层', icon: '[L]', description: '按 layerId 批量重命名多个图层。' },
    groupLayers: { name: '编组图层', icon: '[G]', description: '将多个图层编组。' },
    ungroupLayers: { name: '取消编组', icon: '[G]', description: '解散图层组。' },
    reorderLayer: { name: '调整图层顺序', icon: '[L]', description: '调整图层前后顺序。' },
    moveLayerToGroup: { name: '移动到图层组', icon: '[G]', description: '把图层或图层组移动到目标组内。' },
    createClippingMask: { name: '创建剪切蒙版', icon: '[M]', description: '创建剪切蒙版。' },
    releaseClippingMask: { name: '释放剪切蒙版', icon: '[M]', description: '释放剪切蒙版。' },
    createGroup: { name: '创建图层组', icon: '[G]', description: '创建新的图层组。' },

    getCanvasSnapshot: { name: '读取画布快照', icon: '[C]', description: '获取当前画布快照。' },
    getAcceptanceSnapshot: { name: '读取验收快照', icon: '[C]', description: '获取用于验收的画布快照。' },
    getDocumentSnapshot: { name: '读取文档快照', icon: '[C]', description: '获取当前文档快照。' },
    getElementMapping: { name: '分析页面元素', icon: '[A]', description: '识别当前画面中的元素。' },
    analyzeLayout: { name: '分析布局', icon: '[A]', description: '分析当前页面布局结构。' },
    getAnnotatedSnapshot: { name: '读取标注快照', icon: '[C]', description: '获取带标注的画布快照。' },

    removeBackground: { name: '智能抠图', icon: '[I]', description: '移除图片背景。' },
    placeImage: { name: '置入图片', icon: '[I]', description: '把图片放入当前文档。' },

    createRectangle: { name: '创建矩形', icon: '[S]', description: '绘制矩形形状。' },
    createEllipse: { name: '创建椭圆', icon: '[S]', description: '绘制椭圆形状。' },

    undo: { name: '撤销', icon: '[H]', description: '撤销上一步操作。' },
    redo: { name: '重做', icon: '[H]', description: '重做上一步操作。' },
    getHistoryInfo: { name: '读取历史记录', icon: '[H]', description: '查看历史记录。' },

    saveDocument: { name: '保存文档', icon: '[D]', description: '保存当前文档。' },
    quickExport: { name: '快速导出', icon: '[E]', description: '快速导出当前结果。' },
    exportGroup: { name: '导出图层组', icon: '[E]', description: '将指定图层组导出为 PNG 文件。' },
    exportMainImageDocuments: { name: '批量导出主图详情页', icon: '[E]', description: '按用户导出规范批量导出主图文档各子组 JPEG 与详情页切片。' },
    measureReferenceComposition: { name: '测量参考构图', icon: '[A]', description: '测量参考图主体占比、重心与留白，作为缩放大小的参照依据。' },
    batchExport: { name: '批量导出', icon: '[E]', description: '批量导出多个结果。' },

    listProjectResources: { name: '查看项目资源', icon: '[R]', description: '查看项目中的资源文件。' },
    searchProjectResources: { name: '搜索项目资源', icon: '[R]', description: '搜索项目资源。' },
    getProjectStructure: { name: '读取项目结构', icon: '[R]', description: '查看项目目录结构。' },
    getResourcesByCategory: { name: '分类资源', icon: '[R]', description: '按类别查看项目资源。' },
    providerNativeWebSearch: { name: '联网搜索', icon: '[W]', description: '通过模型提供商的原生网页搜索获取外部参考。' },

    // 浏览器扩展工具（操作用户真实浏览器，见 docs/browser-extension-bridge.md）
    listBrowserTabs: { name: '列出浏览器标签页', icon: '[B]', description: '列出用户真实浏览器打开的标签页和扩展连接状态。' },
    readBrowserPage: { name: '读取浏览器页面', icon: '[B]', description: '读取用户浏览器页面的正文、链接与可交互元素。' },
    captureBrowserTab: { name: '浏览器截图', icon: '[B]', description: '截取用户浏览器标签页画面供视觉理解。' },
    navigateBrowserTab: { name: '浏览器导航', icon: '[B]', description: '让用户浏览器跳转网址或新开标签页。' },
    interactWithBrowserPage: { name: '操作浏览器页面', icon: '[B]', description: '在用户浏览器页面点击、填写或滚动。' },

    skuLayout: { name: 'SKU 排版', icon: '[K]', description: '生成 SKU 排版。' },
    sockLayoutConfig: { name: '袜子排版配置', icon: '[S]', description: '解析袜子排版配置并生成执行计划。' },
    openProjectFile: { name: '打开项目文件', icon: '[F]', description: '从项目中打开文件。' },

    // 图层操作
    transformLayer: { name: '变换图层', icon: '[L]', description: '缩放/旋转/移动图层。' },
    quickScale: { name: '缩放图层', icon: '[L]', description: '把图层快速缩放到目标尺寸。' },
    focusLayer: { name: '聚焦图层', icon: '[L]', description: '选中并定位到指定图层。' },
    deleteLayer: { name: '删除图层', icon: '[L]', description: '删除指定图层。' },
    duplicateLayer: { name: '复制图层', icon: '[L]', description: '复制指定图层。' },
    duplicateSmartObject: { name: '复制智能对象', icon: '[L]', description: '复制智能对象图层为新的智能对象。' },
    replaceLayerContent: { name: '替换图层内容', icon: '[L]', description: '替换图层的图片内容。' },
    setLayerOpacity: { name: '设置不透明度', icon: '[L]', description: '调整图层不透明度。' },
    setBlendMode: { name: '设置混合模式', icon: '[L]', description: '调整图层混合模式。' },
    addDodgeBurnLayer: { name: '中性灰减淡加深', icon: '[L]', description: '新建 50% 灰 Soft Light 图层，非破坏性重塑光影。' },
    warpLayer: { name: '图层变形', icon: '[L]', description: '预设膨胀/挤压/扭曲/弧形等变形（液化感）。' },
    setLayerVisibility: { name: '设置图层可见性', icon: '[L]', description: '显示或隐藏图层。' },
    setLayerFill: { name: '设置图层填充', icon: '[L]', description: '设置图层填充色。' },
    lockLayer: { name: '锁定图层', icon: '[L]', description: '锁定或解锁图层。' },
    cropDocument: { name: '裁切画布', icon: '[C]', description: '把画布裁切到指定矩形（矩形外内容被移除）。' },
    resizeCanvas: { name: '调整画布大小', icon: '[C]', description: '按锚点修改画布大小（留白或裁边，不缩放像素）。' },
    resizeImage: { name: '缩放图像', icon: '[C]', description: '整图重采样缩放（图像大小）。' },
    gaussianBlurLayer: { name: '高斯模糊', icon: '[F]', description: '对图层应用高斯模糊，常用于虚化背景。' },
    createLayerMask: { name: '添加图层蒙版', icon: '[L]', description: '为图层添加显示全部/隐藏全部/选区蒙版。' },
    deleteLayerMask: { name: '删除图层蒙版', icon: '[L]', description: '删除图层蒙版，可选择是否应用到像素。' },

    // 图层效果
    addDropShadow: { name: '添加投影', icon: '[F]', description: '为图层添加投影效果。' },
    addStroke: { name: '添加描边', icon: '[F]', description: '为图层添加描边。' },
    addGlow: { name: '添加发光', icon: '[F]', description: '为图层添加发光效果。' },
    addGradientOverlay: { name: '添加渐变叠加', icon: '[F]', description: '为图层添加渐变叠加。' },
    clearLayerEffects: { name: '清除图层效果', icon: '[F]', description: '清除图层的所有效果。' },

    // 调色 / 调整图层（非破坏性）
    addBrightnessContrastAdjustment: { name: '亮度对比度', icon: '[F]', description: '创建亮度/对比度调整图层。' },
    addHueSaturationAdjustment: { name: '色相饱和度', icon: '[F]', description: '创建色相/饱和度调整图层。' },
    addLevelsAdjustment: { name: '色阶', icon: '[F]', description: '创建色阶调整图层。' },
    addColorBalanceAdjustment: { name: '色彩平衡', icon: '[F]', description: '创建色彩平衡调整图层。' },
    addVibranceAdjustment: { name: '自然饱和度', icon: '[F]', description: '创建自然饱和度调整图层。' },
    addPhotoFilterAdjustment: { name: '照片滤镜', icon: '[F]', description: '创建照片滤镜调整图层。' },

    // 素材理解 / 设计知识
    describeImage: { name: '理解图片', icon: '[A]', description: '理解单张图片的内容。' },
    analyzeAssetContent: { name: '分析素材内容', icon: '[A]', description: '理解素材的主体、文字与本质（原片/成品）。' },
    createProjectContactSheetOverview: { name: '生成项目总览', icon: '[A]', description: '把项目图片合成带编号的缩略图总览。' },
    analyzeProjectContactSheetOverview: { name: '观察项目总览', icon: '[A]', description: '用视觉模型理解项目缩略图总览。' },
    // project-image-analysis / design-reference-search 等技能 id 不在此登记——
    // 技能显示名单一来源是 SkillDeclaration.displayName（见 getSkillToolDisplayInfo）。
    analyzeProjectForDetailPage: { name: '分析详情页素材', icon: '[A]', description: '为详情页分析项目素材。' },
    recommendAssets: { name: '推荐素材', icon: '[R]', description: '根据需求推荐合适素材。' },
    getAssetPreview: { name: '读取素材预览', icon: '[R]', description: '读取素材缩略图。' },
    getResourceSummary: { name: '读取资源摘要', icon: '[R]', description: '读取项目资源摘要。' },
    getDesignProjectState: { name: '读取设计方向', icon: '[A]', description: '读取已确认的设计方向。' },
    updateDesignProjectState: { name: '更新设计方向', icon: '[A]', description: '更新设计方向状态。' },
    getMainImageDesignFramework: { name: '读取主图方法论', icon: '[A]', description: '读取主图设计方法论。' },
    getDetailPageDesignFramework: { name: '读取详情页方法论', icon: '[A]', description: '读取详情页设计方法论。' },
    getDesignPrinciples: { name: '读取设计原理', icon: '[A]', description: '读取通用视觉设计原理与质量自检维度。' },
    declareDesignIntent: { name: '声明设计意图', icon: '[A]', description: '模型自主声明本轮设计任务类型（用自己的理解，非关键词猜测）。' },
    declareDesignStrategy: { name: '记录设计策略', icon: '[A]', description: '记录模型基于当前上下文形成的设计目标、信息与视觉方向。' },
    declareRuntimeActionPlan: { name: '记录动态行动计划', icon: '[A]', description: '记录模型基于策略、运行状态与当前能力形成的步骤依赖和语义版面。' },
    searchDesignKnowledge: { name: '检索设计参考', icon: '[W]', description: '检索设计参考、规则、趋势与文案框架。' },
    searchEagleReferences: { name: '检索参考素材', icon: '[W]', description: '从 Eagle 素材库检索参考。' },
    analyzeEagleReference: { name: '理解 Eagle 参考', icon: '[A]', description: '用视觉模型分析一条 Eagle 参考的设计方法。' },
    analyzePsdDesignSource: { name: '解析设计源文件', icon: '[A]', description: '离线解析设计师 PSD/PSB 的结构、字号、色板与边距作为设计参照。' },
    observeEagleAsset: { name: '观察 Eagle 素材', icon: '[E]', description: '真实观察选中 Eagle 素材的图像内容，作为设计参考的视觉依据。' },
    importEagleAssetToProject: { name: '导入 Eagle 素材', icon: '[E]', description: '把 Eagle 素材复制进当前项目并记录来源，供后续置入使用。' },
    fitLayerSubjectToRegion: { name: '主体缩放对齐', icon: '[L]', description: '把图层主体按视觉大小缩放并居中到目标区域。' },
    generateImage: { name: '生成图片', icon: '[I]', description: '用 AI 生成图片素材。' },

    // SKU 配置 / 模板准备
    exportColorConfig: { name: '整理 SKU 配置', icon: '[K]', description: '整理 SKU 规格和组合配置。' },
    createSkuPlaceholders: { name: '设置 SKU 占位区', icon: '[K]', description: '设置 SKU 卡片里的图片占位区。' },
    getSkuPlaceholders: { name: '检查 SKU 占位区', icon: '[K]', description: '检查 SKU 卡片里的图片占位区。' },
    exportToSkuDir: { name: '导出 SKU 图片', icon: '[E]', description: '导出 SKU 成品图。' },

    // 文档生命周期 / 详情页 / 图层诊断 / 网页 / 编排（补全：原本缺中文名，UI 会显示英文工具名）
    closeDocument: { name: '关闭文档', icon: '[D]', description: '关闭指定 Photoshop 文档。' },
    smartSave: { name: '智能保存', icon: '[E]', description: '智能保存当前文档。' },
    fetchWebPageDesignContent: { name: '读取网页内容', icon: '[W]', description: '访问网页并提取设计相关内容。' },
    getScreenSnapshots: { name: '读取屏幕快照', icon: '[C]', description: '获取屏幕快照用于视觉复核。' },
    getScreenSnapshotsWithOverlay: { name: '读取标注屏幕快照', icon: '[C]', description: '获取带标注的屏幕快照。' },
    detectLayerIssues: { name: '检测图层问题', icon: '[A]', description: '检测图层的潜在问题。' },
    fixLayerIssues: { name: '修复图层问题', icon: '[L]', description: '修复检测到的图层问题。' },
    parseDetailPageTemplate: { name: '解析详情页模板', icon: '[A]', description: '解析详情页模板结构。' },
    matchDetailPageContent: { name: '匹配详情页内容', icon: '[A]', description: '为详情页匹配素材内容。' },
    fillDetailPage: { name: '填充详情页', icon: '[I]', description: '把内容填入详情页模板。' },
    exportDetailPageSlices: { name: '导出详情页切片', icon: '[E]', description: '导出详情页切片图。' },
    auditDetailPagePlacement: { name: '复核详情页排版', icon: '[A]', description: '复核详情页元素排版是否合理。' },
    delegateToAgent: { name: '委派子任务', icon: '[G]', description: '把子任务委派给子代理执行。' },
    runDesignTeamPipeline: { name: '运行设计团队流水线', icon: '[G]', description: '运行多角色设计团队协作流水线。' },

    // 复刻 / 业务能力 / 视觉理解
    getSubjectBounds: { name: '检查主体位置', icon: '[A]', description: '检查画面主体的位置和范围。' },
    applyMattingResult: { name: '应用抠图结果', icon: '[I]', description: '把抠图结果应用到当前设计。' },
    getSmartObjectInfo: { name: '检查智能对象', icon: '[D]', description: '检查当前图层是否为智能对象。' },
    getSmartObjectLayers: { name: '读取智能对象图层', icon: '[D]', description: '检查智能对象内部图层可用性。' },
    convertToSmartObject: { name: '转换为智能对象', icon: '[D]', description: '把图层转换为智能对象。' },
    editSmartObjectContents: { name: '编辑智能对象内容', icon: '[D]', description: '打开智能对象内容进行编辑。' },
    exportWhiteBgFromSkuMaterial: { name: '导出白底商品图', icon: '[E]', description: '从 SKU 素材中导出白底商品图。' },
    'layout-template-blueprint': { name: '分析参考版式', icon: '[A]', description: '分析参考图的版式结构。' },
    'layout-template-apply': { name: '复刻参考版式', icon: '[L]', description: '按参考版式调整当前设计。' },
    'layout-template-autofill': { name: '填充参考版式', icon: '[I]', description: '把内容填入参考版式。' },
    'layout-match-plan': { name: '匹配参考版式', icon: '[A]', description: '匹配当前内容和参考版式。' },
    // layout-replication / ecommerce-socks-design / matte-product 是技能 id，
    // 显示名走 SkillDeclaration.displayName 单一来源，不在此重复登记。
    'visual:analyzeLocalImage': { name: '理解本地图片', icon: '[A]', description: '理解本地图片内容。' },
    'visual:analyzeBase64Image': { name: '理解画面截图', icon: '[A]', description: '理解当前画面截图。' },
    'template-knowledge:addFromPhotoshop': { name: '保存模板经验', icon: '[A]', description: '把当前模板经验保存到知识库。' },

    // 形态变形 / 智能对象写操作 / 模板渲染（治理审计2026-07-01补齐，此前未进入模型可见目录）
    extractShapePath: { name: '提取形状路径', icon: '[S]', description: '从形状图层提取轮廓路径。' },
    getLayerContour: { name: '检测图层轮廓', icon: '[S]', description: '检测图像图层的产品轮廓。' },
    morphToShape: { name: '形态变形', icon: '[S]', description: '把图层变形到目标形状轮廓。' },
    batchMorphToShape: { name: '批量形态变形', icon: '[S]', description: '批量把多个图层变形到目标形状轮廓。' },
    applyMorphedImage: { name: '写回变形结果', icon: '[S]', description: '把变形后的图像写回图层。' },
    replaceSmartObjectContents: { name: '替换智能对象内容', icon: '[D]', description: '用本地文件替换智能对象源内容。' },
    updateSmartObject: { name: '更新智能对象', icon: '[D]', description: '刷新或重新链接智能对象。' },
    openTemplate: { name: '打开模板文件', icon: '[F]', description: '打开 PSD/PSB 模板文件。' },
    getTemplateStructure: { name: '读取模板结构', icon: '[A]', description: '读取模板图层结构和占位符。' },
    replaceImagePlaceholder: { name: '替换图片占位符', icon: '[I]', description: '把图片置入模板占位符。' },
    replaceTextPlaceholder: { name: '替换文字占位符', icon: '[T]', description: '把文字填入模板占位符。' },
    batchRenderTemplate: { name: '批量渲染模板', icon: '[G]', description: '批量执行模板显隐/文字指令。' },

    // 治理审计(2026-07-01)反向diff新发现：此前既未进模型目录、也没有中文显示名的工具
    applyMultiMattingResult: { name: '应用多目标抠图结果', icon: '[I]', description: '把多目标语义分割结果应用到画面。' },
    applyRasterImageResult: { name: '写回生成图像', icon: '[I]', description: '把生成的图像结果写回新图层。' },
    auditTextReplacement: { name: '复核文本替换', icon: '[T]', description: '替换文字前检查当前文本格式。' },
    exportLayerAsBase64: { name: '导出图层数据', icon: '[E]', description: '导出图层为 Base64 或原始像素。' },
    getMattingImage: { name: '导出抠图素材', icon: '[I]', description: '导出图层图像用于抠图流程。' },
    getOptimizedImage: { name: '导出压缩图像', icon: '[I]', description: '导出文档或图层区域为压缩图像。' },
    getSelectionBounds: { name: '读取选区范围', icon: '[A]', description: '读取当前选区的边界。' },
    getSelectionMask: { name: '读取选区蒙版', icon: '[A]', description: '把当前选区读取为蒙版图像。' },
    inspectDetailPageLivePlacements: { name: '检查详情页实际落位', icon: '[A]', description: '检查详情页图片的实际落位情况。' }
};

const DYNAMIC_TOOL_BASES = [
    'skuLayout',
    'smartLayout',
    'quickExport',
    'transformLayer',
    'moveLayer',
    'setTextStyle',
    'getAllTextLayers',
    'getLayerHierarchy',
    'getDesignProjectState',
    'updateDesignProjectState',
    'analyzeAssetContent',
    'fillDetailPage'
];

function hasToolDisplayInfo(toolName: string): boolean {
    return Object.prototype.hasOwnProperty.call(TOOL_NAME_MAP, toolName);
}

function normalizeToolDisplayLookupName(toolName: string): string {
    const normalized = String(toolName || '').trim();
    if (!normalized) return '';
    if (hasToolDisplayInfo(normalized)) return normalized;

    const bracketBase = normalized.replace(/\[.*$/, '');
    if (bracketBase !== normalized && hasToolDisplayInfo(bracketBase)) return bracketBase;

    const colonBase = normalized.split(':')[0];
    if (colonBase !== normalized && hasToolDisplayInfo(colonBase)) return colonBase;

    const dynamicBase = DYNAMIC_TOOL_BASES.find((base) => (
        normalized.startsWith(`${base}-`)
        || normalized.startsWith(`${base}[`)
        || normalized.startsWith(`${base}:`)
    ));
    return dynamicBase && hasToolDisplayInfo(dynamicBase) ? dynamicBase : normalized;
}

/**
 * 技能工具显示名：从 SkillDeclaration 单一来源派生（displayName 中文优先，缺省回退 name），
 * 显示为「技能·XXX」让用户明确看到 Agent 调用了哪个打包技能。
 * 不在本文件另建技能名映射表——那会复刻"工具身份散在多处"的旧债。
 */
function getSkillToolDisplayInfo(toolName: string): ToolDisplayInfo | undefined {
    const skill = getSkillById(String(toolName || '').trim());
    if (!skill) return undefined;
    return {
        name: `技能·${skill.displayName || skill.name}`,
        icon: '[K]',
        description: `调用打包技能「${skill.displayName || skill.name}」执行多步工作流。`
    };
}

export const getToolDisplayInfo = (toolName: string): ToolDisplayInfo => {
    const lookupName = normalizeToolDisplayLookupName(toolName);
    const mapped = lookupName ? TOOL_NAME_MAP[lookupName] : undefined;
    return mapped || getSkillToolDisplayInfo(toolName) || {
        name: '执行操作',
        icon: '[*]',
        description: '执行当前操作。'
    };
};
