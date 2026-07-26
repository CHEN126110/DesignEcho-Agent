import { SkillDeclaration } from '../types/skill.types';

const boolParam = (name: string, description: string, defaultValue?: boolean) => ({
    name,
    type: 'boolean' as const,
    description,
    required: false,
    ...(defaultValue === undefined ? {} : { default: defaultValue })
});

const strParam = (
    name: string,
    description: string,
    required = false,
    extra: Partial<{ enum: string[]; default: string; examples: any[] }> = {}
) => ({
    name,
    type: 'string' as const,
    description,
    required,
    ...extra
});

const numParam = (
    name: string,
    description: string,
    required = false,
    extra: Partial<{ default: number; examples: any[] }> = {}
) => ({
    name,
    type: 'number' as const,
    description,
    required,
    ...extra
});

const arrParam = (
    name: string,
    description: string,
    required = false,
    extra: Partial<{ examples: any[]; default: any[] }> = {}
) => ({
    name,
    type: 'array' as const,
    description,
    required,
    ...extra
});

const objParam = (name: string, description: string, required = false) => ({
    name,
    type: 'object' as const,
    description,
    required
});

export const MatteProductSkill: SkillDeclaration = {
    id: 'matte-product',
    name: 'Smart Matting',
    displayName: '智能抠图白底',
    category: 'image',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Remove image background and extract the product subject.',
    whenToUse: [
        'User asks to remove background',
        'User asks to isolate product from a photo'
    ],
    whenNotToUse: [
        'Image already has transparent background',
        'User only asks for crop or resize'
    ],
    routing: {
        intentSignals: ['抠图', '去背景', '去背', 'remove background', 'matte'],
        negativeSignals: ['裁剪', '缩放', '详情页', '主图模板'],
        preconditions: ['需要当前图层、文件路径或项目资源作为输入'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 sourceType、outputMode、filePath'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果输入来源不明确，先问用户是当前图层还是指定文件'],
        routeStatusMessages: {
            deterministic: '检查当前图层和边缘情况，准备开始抠图。',
            autonomous: '检查当前图层和边缘情况后处理抠图。'
        }
    },
    parameters: [
        strParam('targetPrompt', 'Optional target description for subject extraction'),
        strParam('sourceType', 'Image source', true, {
            enum: ['current_layer', 'file_path', 'project_resource'],
            default: 'current_layer'
        }),
        strParam('filePath', 'Local file path when sourceType requires it'),
        strParam('outputMode', 'Output mode', false, {
            enum: ['new_layer', 'replace', 'mask'],
            default: 'new_layer'
        }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'layer',
        description: 'Matted transparent layer.'
    },
    requiredTools: ['removeBackground', 'getCanvasSnapshot', 'placeImage'],
    examples: [
        {
            userSays: '帮我抠图',
            parameters: { sourceType: 'current_layer', outputMode: 'new_layer' }
        }
    ],
    estimatedTime: 5,
    hasDecisionPoints: true
};

export const SmartLayoutSkill: SkillDeclaration = {
    id: 'smart-layout',
    name: 'Smart Layout',
    displayName: '智能布局',
    category: 'layout',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Reposition and resize a layer according to layout constraints.',
    whenToUse: [
        'User asks to center, align, fit, or resize a specific product/layer automatically',
        'User has a current selection or layer id and asks for a direct layout adjustment'
    ],
    whenNotToUse: [
        'User asks for open-ended page, main-image, detail-page, or SKU design',
        'User asks to change layer order, names, visibility, grouping, or selection state',
        'No target layer/current selection/layer id is available'
    ],
    routing: {
        intentSignalGroups: [
            ['产品', '商品', '主体', '当前图层', '选中图层', '目标图层', '图层', 'layer', 'subject'],
            ['居中', '对齐', '缩放', '放大', '缩小', '自适应', '铺满', '填充画布', 'center', 'resize', 'fit', 'align']
        ],
        negativeSignals: ['详情页', '主图', 'SKU', '复刻', '参考图', '图层顺序', '置顶', '置底', '重命名', '删除', '只讨论', '只说明'],
        preconditions: ['需要当前文档和可定位的目标图层，或用户明确提供 layerId'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 layerId、fillRatio、alignment、productType；没有目标图层时先澄清'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果没有当前选中图层或明确 layerId，先确认要调整哪个图层'],
        decisionGuidance: [
            'Smart Layout 是单图层几何调整能力，不处理整页设计、主图策略、详情页模板或 SKU 生产。',
            '图层顺序、重命名、删除、编组等请求应交给 layer-management。',
            '用户只是讨论布局方法或询问建议时，不要执行写入。'
        ],
        routeStatusMessages: {
            deterministic: '确认目标图层和画布尺寸后调整位置与比例。'
        }
    },
    parameters: [
        numParam('layerId', 'Target layer id'),
        numParam('fillRatio', 'Canvas fill ratio', false, { default: 0.85, examples: [0.75, 0.85, 0.9] }),
        strParam('alignment', 'Alignment mode', false, {
            enum: ['center', 'bottom-center', 'top-center'],
            default: 'center'
        }),
        strParam('productType', 'Optional product type')
    ],
    output: {
        type: 'layer',
        description: 'Updated layer layout.'
    },
    requiredTools: ['smartLayout', 'getLayerBounds', 'getDocumentInfo'],
    examples: [
        {
            userSays: '把产品居中并缩放到合适比例',
            parameters: { fillRatio: 0.85, alignment: 'center' }
        }
    ],
    estimatedTime: 2
};

export const SKUConfigSkill: SkillDeclaration = {
    id: 'sku-config',
    name: 'SKU Config Prep',
    displayName: 'SKU 配置整理',
    category: 'batch',
    kind: 'operation',
    visibility: 'user-facing',
    // 模型路由不得直执：SKU 配置整理需要 Agent 循环理解项目上下文与错误处理，声明为必须经自主循环。
    modelDirectExecution: 'forbidden',
    description: 'Prepare SKU workflow by exporting colors and creating placeholders.',
    whenToUse: [
        'User asks to export SKU color/config metadata',
        'User asks to create or inspect SKU placeholders before batch production'
    ],
    whenNotToUse: [
        'User asks to generate SKU combination images, note images, or batch exports',
        'User asks SKU capability questions, terminology explanations, or design planning only',
        'User asks for main-image, detail-page, white-background, or document operations'
    ],
    routing: {
        intentSignalGroups: [
            ['颜色配置', '配色配置', '颜色表', '占位符', '占位组', 'placeholder', 'color config'],
            ['导出', '创建', '生成', '准备', '获取', '查看', '检查', 'export', 'create', 'get']
        ],
        negativeSignals: ['组合图', '自选备注', '备注图', '批量出图', '批量生成', '主图', '详情页', '白底图', '文档', '怎么', '如何', '只说明', '只讨论'],
        preconditions: ['需要当前 SKU 文档、SKU 源文件或明确的模板占位上下文'],
        supportedModes: ['inspect', 'execute'],
        modeSignals: {
            inspect: ['查看', '检查', '获取', '列表', '有哪些', 'get'],
            execute: ['导出', '创建', '生成', '准备', 'export', 'create']
        },
        parameterExtractionHints: ['抽取 action、placeholderCount、layout；颜色配置默认 action=exportColors，占位符默认 action=createPlaceholders'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果用户没有说清楚是导出颜色配置还是创建占位符，先确认动作'],
        decisionGuidance: [
            'SKU Config 只处理 SKU 生产前的配置和占位符准备，不产出 SKU 组合图。',
            '批量生成 SKU 图片、自选备注或备注图必须交给 sku-batch。',
            '看到 SKU 不代表进入本 skill，必须同时出现颜色配置或占位符相关动作。'
        ],
        routeStatusMessages: {
            deterministic: '确认 SKU 配置或占位符目标后处理。'
        }
    },
    parameters: [
        strParam('action', 'SKU config action', true, {
            enum: ['exportColors', 'createPlaceholders', 'getPlaceholders']
        }),
        numParam('placeholderCount', 'Placeholder count for createPlaceholders'),
        strParam('layout', 'Placeholder layout', false, {
            enum: ['horizontal', 'vertical', 'grid'],
            default: 'horizontal'
        })
    ],
    output: {
        type: 'data',
        description: 'Color config or placeholder metadata.'
    },
    requiredTools: ['exportColorConfig', 'createSkuPlaceholders', 'getSkuPlaceholders'],
    examples: [
        {
            userSays: '导出颜色配置',
            parameters: { action: 'exportColors' }
        }
    ],
    estimatedTime: 2
};

export const SKUColorCardSkill: SkillDeclaration = {
    id: 'sku-color-card',
    name: 'SKU Color Card',
    displayName: 'SKU 色卡设计',
    category: 'batch',
    kind: 'workflow',
    visibility: 'user-facing',
    visualSamplingScenario: 'sku',
    controlledRouteEntry: 'autonomous-react-loop',
    routeClass: 'business-workflow',
    modelDirectExecution: 'forbidden',
    description: 'Create an editable SKU color-card Photoshop document from explicitly selected project images. File names become color labels; each card remains an editable Smart Object for detail-page color display or later SKU arrangement.',
    whenToUse: [
        'User explicitly asks to create, make, or arrange SKU color cards from project images.',
        'User asks for a standalone editable color-card source document for detail-page color display.',
        'A parent SKU workflow needs a governed color-card source document before combination production.'
    ],
    whenNotToUse: [
        'User only asks what SKU color cards are or wants planning advice without execution.',
        'User asks to generate multi-color SKU combination exports from an already prepared source document.',
        'Neither ordered color names nor source-image mapping is available.'
    ],
    routing: {
        intentSignals: [
            'regex:(创建|制作|生成|整理|编排|做).{0,10}(SKU|sku).{0,6}(色卡|颜色卡)',
            'regex:(色卡|颜色卡).{0,10}(SKU|sku|详情页|颜色展示)',
            'SKU 色卡',
            '色卡源文档'
        ],
        negativeSignals: ['模板', '模版', '只说明', '只讨论', '怎么做', '如何做', '组合图', '批量导出', '自选备注', '不执行工具'],
        preconditions: ['需要有序颜色名或明确图片路径；项目中唯一的同名图片可以直接完成颜色映射'],
        supportedModes: ['execute'],
        parameterExtractionHints: [
            '用户给出有序颜色名时传 colorNames；如果项目中存在唯一的同名图片，Skill 会直接采用，不要先分析其他候选图。',
            '用户明确写出路径时优先抽取 sources=[{filePath,colorName}]；只有路径时传 sourcePaths，色名默认取文件名。',
            '默认创建 SKU 1500×1500 白底文档，并保存为项目 PSD/SKU.psb。',
            '只有用户明确修改规格时才覆盖 cardWidth、cardHeight、columns、间距或编号显示。',
            '编号仅是查看顺序的辅助信息；启用时统一放入根层级“参考组”，不能进入颜色组。',
            'Skill 只做 contain 结构草稿；返回视觉调整 handoff 后，继续由 Agent 看图决定商品主体大小、重心和裁切。'
        ],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果候选图或颜色对应关系不明确，先返回候选映射让用户确认，不要自行猜色名。'],
        decisionGuidance: [
            'SKU 色卡的专业方法属于本 Skill，不要把卡片尺寸、标签比例或流程写入通用 Agent Prompt。',
            '每张图对应一个同名颜色组和一个可编辑智能对象；图片必须在智能对象内部以剪切蒙版受圆角底约束。',
            '色名默认使用文件名，不按颜色关键词重新排序；输入顺序就是用户的 SKU 编排顺序。',
            '项目中唯一的同名图片表明名称映射已确定，优先级高于视觉猜测或时间戳候选；仅在同名图片缺失或重名冲突时分析候选内容。',
            '颜色组是后续 SKU 编排直接复用的正式资产，只能包含色卡智能对象；序号统一放入根层级“参考组”。',
            '图片置入不是终局：固定 cover/contain 都不能冒充设计判断。Skill 返回草稿快照和稳定图层 ID 后，必须打开每张智能对象观察；主体检测可靠时用 fitLayerSubjectToRegion，检测不可用时由视觉模型判断放大/缩小与移动方向，使用 transformLayer/moveLayer 小步调整，并再次观察。',
            '文字适配是确定性几何问题：创建色名后读取真实文字和白底 bounds，按真实宽高缩放并水平、垂直居中；不要让模型手算像素。',
            '完成后必须读回主文档尺寸、颜色组数量、智能对象状态、剪切关系和最终图层结构。',
            'sku-batch 需要先准备色卡源文档时，通过统一 Skill runner 调用本 Skill，不维护第二套色卡写入流程。'
        ],
        routeStatusMessages: {
            deterministic: '核对颜色图片与名称后创建可编辑 SKU 色卡。',
            autonomous: '先确认颜色图片映射，再创建并复核可编辑 SKU 色卡。'
        }
    },
    parameters: [
        arrParam('sources', 'Explicit source objects: [{filePath,colorName?,relativePath?,assetId?}]'),
        arrParam('sourcePaths', 'Ordered local image paths when sources is not provided'),
        arrParam('colorNames', 'Ordered color names; unique same-basename project images are resolved directly'),
        strParam('projectPath', 'Active project root; defaults to current project context'),
        strParam('outputPath', 'Explicit absolute PSB output path'),
        strParam('outputRelativePath', 'Project-relative output path', false, { default: 'PSD/SKU.psb' }),
        numParam('canvasWidth', 'SKU document width in pixels', false, { default: 1500 }),
        numParam('canvasHeight', 'SKU document height in pixels', false, { default: 1500 }),
        numParam('cardWidth', 'Color-card width in pixels', false, { default: 250 }),
        numParam('cardHeight', 'Color-card height in pixels', false, { default: 380 }),
        numParam('cardCornerRadius', 'Outer color-card corner radius in pixels', false, { default: 10 }),
        numParam('columns', 'Optional fixed column count'),
        numParam('columnGap', 'Horizontal gap between cards in pixels', false, { default: 40 }),
        numParam('rowGap', 'Vertical gap between card rows in pixels', false, { default: 170 }),
        boolParam('showIndexNumbers', 'Show display-only ordered numbers above cards in a separate root-level reference group', true),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'document',
        description: 'Editable SKU PSB structure draft, visual-adjustment handoff, write/readback results, and final review requirements.'
    },
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
    ],
    examples: [
        {
            userSays: '把这四张项目图片做成 SKU 色卡，颜色名就用文件名',
            parameters: {
                sourcePaths: [
                    'E:/project/蓝条纹.jpg',
                    'E:/project/咖条纹.jpg',
                    'E:/project/奶白黑条纹.jpg',
                    'E:/project/黑色白条纹.jpg'
                ]
            }
        }
    ],
    estimatedTime: 45,
    hasDecisionPoints: true
};

export const SKUBatchSkill: SkillDeclaration = {
    id: 'sku-batch',
    name: 'SKU Batch',
    displayName: 'SKU 批量出图',
    category: 'batch',
    kind: 'workflow',
    visibility: 'user-facing',
    visualSamplingScenario: 'sku',
    // 治理审计(2026-07-01)阶段3a：与 detail-page-design 统一路由方式——受控路由命中且有明确
    // 执行授权（isSkuExecutionRequestText）时交给 Agent 自主循环，sku-batch 作为循环内可选技能
    // 工具（模板匹配/占位符对应等能力仍在），不再由引擎在弱授权之外也直接短路到固定流水线。
    controlledRouteEntry: 'autonomous-react-loop',
    routeClass: 'business-workflow',
    // 模型路由不得直执（用户拍板红线，smoke-skill-route-guard-declaration 钉桩）：
    // sku-batch 必须经 Agent 自主 ReAct 循环，防止退回脚本直调。
    modelDirectExecution: 'forbidden',
    description: 'Controlled SKU production workflow for confirmed SKU combination images, self-select note exports, and card-style SKU source-document preparation. This is an execution skill, not a general SKU Q&A or capability-introduction entry.',
    whenToUse: [
        'User explicitly asks to make, generate, batch export, or output SKU combination images.',
        'User explicitly asks to generate corresponding SKU self-select notes or note images.',
        'User asks to continue an existing SKU production task by adding missing SKU note outputs.',
        'User asks for card-style SKU color cards from current project product images, after visual observation confirms usable single-product sources.',
        'User asks to prepare only the card-style SKU source document or color-card material without exporting SKU combinations.'
    ],
    whenNotToUse: [
        'User asks whether the Agent can do SKU work or what SKU abilities are supported.',
        'User asks how SKU should be made, what SKU means, or wants a design/planning explanation only.',
        'User asks to inspect, list, or check SKU materials/configuration without generating images.',
        'User explicitly says to only explain, only discuss, or not execute tools.'
    ],
    routing: {
        intentSignals: ['regex:(帮我|开始|继续|补|追加|生成|制作|做|创建|整理|准备|导出|批量).{0,12}sku', 'regex:sku.{0,12}(组合图|自选备注|备注图|批量出图|批量生成|色卡素材|色卡源文档|卡片源文档)', '批量配色', '批量出图', '批量生成', '组合图', '自选备注', '备注图', '双装', '单双装', '色卡素材', '色卡源文档'],
        negativeSignals: ['regex:(你|agent|模型).{0,6}(会|能|可以).{0,6}(做|处理).{0,4}sku', 'regex:(怎么|如何).{0,8}(做|制作|生成).{0,4}sku', 'regex:sku.{0,6}(能力|支持哪些|是什么|什么意思)', '说明理解', '不执行工具', '不要执行', '只讨论', '只说明', '查看 SKU', '检查 SKU', '看看 SKU', '详情页', '主图', '主图模板', '白底图', '白底', '点击图', '转化图', '文档关闭'],
        preconditions: ['需要 SKU 源文件或组合模板；卡片式 SKU 可先从已视觉确认的项目单品图准备 SKU 源文档'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 comboSizes、countPerSize、specifiedColors、onlyNotes、requireSkuComboConfirmation、requireSkuCardTemplateDesignConfirmation'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果组合规格或颜色不明确，先问用户需要哪些组合'],
        decisionGuidance: [
            'SKU Batch 是受控业务执行技能；只有明确产出 SKU 图片或自选备注时才进入。',
            '能力问答、术语解释、做法说明、只读检查、规划讨论必须停留在对话或只读能力，不要调用 sku-batch。',
            '看到 SKU 这个领域词本身不代表执行授权；必须同时有“做/生成/导出/批量/补备注/追加备注”等产出动作。',
            'SKU 主链路分为“识别已有资源、设计模板、确认组合、批量生产”；这些阶段由 Agent 根据当前上下文和执行结果逐步决定，不是固定脚本流水线。',
            'SKU 模板设计不属于 sku-batch 的核心职责；sku-batch 只在源文档、模板与组合已经明确或已确认后负责受控生产。',
            '如果用户只要自选备注或备注图，设置 onlyNotes=true。',
            '普通“帮我做 SKU”默认生成每规格 5 个组合，并同时生成对应自选备注。',
            '只有用户明确说“只要组合”“仅组合”“不需要自选备注”“不要备注图”时，才关闭 generateNotes。',
            '如果用户明确只做 SKU 色卡素材、色卡源文档或卡片源文档，设置 sourceOnly=true，准备并保存源文档后停止，不生成组合图、自选备注或成品导出。',
            '如果用户明确说已有、现成、已经准备好的 SKU 色卡素材/源文件，或要求不要重新选图/制作色卡，设置 preferExistingSkuSourceForCardPreparation=true，并优先复用项目 PSD/SKU.psb 等已有源文档。',
            '“完成后只说明结果/保存路径”是执行后的汇报约束，不等同于“只说明、不执行”。',
            '“我还需要对应的 SKU 自选备注”是补备注任务，设置 onlyNotes=true，不要把 SKU 这个领域词误判为新增颜色组合。',
            '如果用户说“2-3-4 的自选备注”之类，提取 comboSizes=[2,3,4]。',
            '1双/单双不生成自选备注，因为 1双 SKU 已经逐个覆盖全部颜色。',
            '如果用户是在已有 SKU 任务上追加组合，优先理解为追加而不是整体覆盖。',
            'SKU 模板有两种受治理的放置方法，必须先用 skuLayout.inspectTemplateLayout 读取真实图层类型、面板顺序与 bounds，再选择方法；不得凭文件名或规格名猜。',
            'ordered_slots 对应 6.3 顺序替换：模板中“占位/占位符/占位组/placeholders”等容器下的一级图层组，按 Photoshop 图层面板从上到下一槽一色，占位组数量必须等于配色数量。',
            'region_composition 对应 6.0 矩形区域排版：一个矩形区域可以容纳多个颜色，多个区域按 Photoshop 图层面板顺序消费显式 regionCapacities；例如 4 双装上方大区放 3 双、下方小区放 1 双，计划为 [3,1]。',
            'TemplateLayoutPlan 可以根据矩形面积比例或名称中的“容量N”形成容量建议；只有高置信计划才可直接执行，中低置信必须先用截图复核。执行器只消费计划，不在写入时临场猜容量。',
            '配色表达式先被解析为有序颜色列表；“|”只可作为旧配置的区域提示，最终仍需由模板检查形成显式 regionCapacities，不允许把分隔符本身当成执行授权。',
            '不要主动要求 autoLayoutWithoutPlaceholders、无占位符自动避让、自动元素避开或隐式智能分区；模板无法识别时应修正模板、调整占位符或更换模板。',
            '调整既有占位符时，先从 inspectTemplateLayout 取得目标 layerId/bounds，用 transformLayer 修改该层，再次 inspectTemplateLayout 复验；不要叠加创建第二套占位结构。',
            '卡片式 SKU 如果项目缺少可用源文档，或旧 PSD/SKU.psb 与当前卡片素材不匹配，不要让用户手工补源文档；应在 allowSkuCardSourcePreparation=true 且视觉候选已确认时，先用受控 Photoshop 步骤整理独立 SKU 卡片源文档，再进入批量生成。',
            '如果卡片式 SKU 候选只有路径和尺寸信息、还没有视觉确认，可设置 runSkuCardVisualConfirmationBeforeSourcePreparation=true，让执行器先有限查看候选图并记录视觉观察，再重新判断是否能准备 SKU 源文档。',
            '卡片式 SKU 如果当前项目和备用库都缺少 2/3/4 双占位模板，默认路径是：先确认模板方向，再由 Agent 参考先行自主设计模板（设计后 createSkuPlaceholders 加占位、inspectTemplateLayout 验证、存入模板文件目录），最后回到批量出图。',
            '通用占位模板生成只是显式兜底：只有当用户话语明确要求快速/默认/占位模板（如“快速出一版”“用默认模板”“占位模板就行”），或 Agent 设计路径失败后用户选择了兜底选项时，才设置 skuPlaceholderTemplateFallbackApproved=true；产物会明示为“通用占位模板（非设计稿）”。绝不能因为“缺模板+要出图”就自行选择占位兜底。',
            '当用户是单独要求评审或确认 SKU 色卡模板 / 卡片模板 / 排版模板 / 模板设计时，设置 requireSkuCardTemplateDesignConfirmation=true：先给出可编辑模板方向确认卡片；确认后进入 Agent 自主设计，不要直接把通用占位脚本当作设计结果。',
            '当用户是在完整 SKU 生产任务中说明“没有模板、需要做模板”时，先交给自主 Agent 设计模板并观察结果；不要让 sku-batch 直接用通用占位脚本替代模板设计。',
            '卡片式 SKU、基于已有色卡素材继续生成 SKU 组合图、或需要 2/3/4 双组合与自选备注时，默认设置 requireSkuComboConfirmation=true：先给出可编辑组合确认卡片，用户确认后再执行出图。',
            '卡片式 SKU 源文档和模板准备只能使用当前项目与通用 Photoshop 工具；不能复制参考项目产物，不能把局部特写、模特图、多只合照当成颜色组源图。'
        ],
        routeStatusMessages: {
            deterministic: '确认当前项目、SKU 文档和模板后处理 SKU。'
        }
    },
    parameters: [
        arrParam('comboSizes', 'Combination size list, e.g. [2,3,4]'),
        numParam('countPerSize', 'Combinations generated per size', false, { default: 5 }),
        boolParam('generateNotes', 'Whether to generate note images alongside SKU renders; defaults to true for normal SKU requests unless the user explicitly asks for combo-only output', true),
        boolParam('onlyNotes', 'Generate note images only without SKU layout', false),
        boolParam('sourceOnly', 'Prepare the card-style SKU source document only, then stop before combo or note export', false),
        boolParam('requireSkuComboConfirmation', 'Set true whenever you need the user to confirm or adjust specific SKU color combinations before generating images (e.g. project already has SKU source material/templates, combos are algorithmic, or the request is ambiguous about which combos to produce). This produces a proper editable combination table (colors × sizes) as the confirmation card. Do NOT build your own confirmation card via createInteractiveCard for this — a generic card with abstract fields like "task type" or "style preference" is not what the user expects to see; they expect to see and edit the actual combinations.', false),
        boolParam('requireSkuCardTemplateDesignConfirmation', 'Set true only when there is genuinely no usable card-style SKU template and a design/style direction needs to be decided before creating one. Do not use this (and do not ask about style preference at all) when the project already has an existing SKU source document or template — style is already established in that case.', false),
        strParam('templateKeyword', 'Optional template keyword for combo layout'),
        strParam('skuFileKeyword', 'Keyword for SKU source files', false, { default: 'SKU' }),
        strParam('skuSourcePreparationMode', 'How SKU source document may be prepared when project PSD/SKU.psb is missing', false, {
            enum: ['disabled', 'card-source-from-project-images'],
            default: 'disabled'
        }),
        boolParam('allowSkuCardSourcePreparation', 'Allow controlled preparation of PSD/SKU.psb from visually confirmed project product images', false),
        boolParam('preferExistingSkuSourceForCardPreparation', 'Prefer an existing project SKU source document and do not regenerate the card source from project images', false),
        boolParam('runSkuCardVisualConfirmationBeforeSourcePreparation', 'When card-style SKU candidates are not visually confirmed, run bounded visual confirmation before preparing PSD/SKU.psb', false),
        numParam('skuCardVisualConfirmationMaxCandidates', 'Maximum SKU card candidates to visually confirm before source preparation', false, { default: 8 }),
        strParam('skuSourceOutputRelativePath', 'Relative output path for prepared SKU card source document', false, { default: 'PSD/SKU-card-source.psb' }),
        numParam('skuSourceCandidateLimit', 'Maximum visually confirmed project images used for SKU source preparation', false, { default: 8 }),
        strParam('skuTemplatePreparationMode', 'How SKU card templates may be prepared when project and library templates are missing', false, {
            enum: ['disabled', 'card-placeholder-templates'],
            default: 'disabled'
        }),
        boolParam('allowSkuCardTemplatePreparation', 'Allow controlled preparation of SKU placeholder templates for card-style SKU output', false),
        boolParam('skuPlaceholderTemplateFallbackApproved', 'Set true ONLY when the user explicitly asked for a quick/default/placeholder template (e.g. "快速出一版" / "用默认模板" / "占位模板就行"), or after the Agent design path failed and the user chose the placeholder fallback option. This produces a generic placeholder template that is clearly labeled 非设计稿. Never set it just because templates are missing — the default path is agent-designed templates.', false),
        strParam('skuTemplateOutputRelativeDir', 'Relative output folder for prepared SKU templates', false, { default: '模板文件' }),
        numParam('skuTemplateNotePlaceholderCount', 'Placeholder count for self-select note templates', false, { default: 8 }),
        arrParam('specifiedColors', 'Optional explicit color combinations, as an array of color-name arrays: [["双层边","木耳边"],["水晶丝","花苞"]] (each inner array is one combo). NOT objects like {size,colors}. Usually leave this unset: when resuming after the user confirmed combos on the card, combos are parsed automatically from the task text.'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'files',
        description: 'Exported SKU images.'
    },
    requiredTools: ['skuLayout', 'listDocuments', 'switchDocument', 'getDocumentInfo', 'createDocument', 'createRectangle', 'createTextLayer', 'createGroup', 'placeImage', 'moveLayerToGroup', 'createSkuPlaceholders', 'transformLayer', 'saveDocument', 'getAcceptanceSnapshot', 'quickExport', 'exportToSkuDir'],
    examples: [
        {
            userSays: '帮我批量做 SKU',
            parameters: { comboSizes: [2, 3], countPerSize: 2 }
        }
    ],
    estimatedTime: 30,
    hasDecisionPoints: true
};

export const ShapeMorphingSkill: SkillDeclaration = {
    id: 'shape-morphing',
    name: 'Shape Morphing',
    displayName: '形态变形',
    category: 'morphing',
    kind: 'operation',
    visibility: 'system-only',
    description: 'Internal morphology-normalization operation used by the retouching panel, not a general user-facing agent skill.',
    whenToUse: ['Internal panel workflow triggers shape normalization with an explicit reference shape and product layer set'],
    whenNotToUse: [
        'User asks for general design help in chat',
        'Reference shape or target product layers are not explicitly selected',
        'Task is an open-ended design request rather than a constrained retouching operation'
    ],
    parameters: [
        numParam('targetShapeLayerId', 'Reference shape layer id', true),
        arrParam('sourceLayerIds', 'Source product layer ids for batch morphing', false),
        numParam('sourceLayerId', 'Single source product layer id', false),
        numParam('edgeBandWidth', 'Edge-band warp width in pixels', false, { default: 50 }),
        numParam('transitionWidth', 'Transition band width in pixels', false, { default: 30 }),
        numParam('patternProtection', 'Pattern protection strength 0-1', false, { default: 0.8 }),
        boolParam('detectPatterns', 'Detect patterned areas automatically', true),
        boolParam('detectLace', 'Detect lace/cuff structure automatically', true),
        strParam('alignmentMethod', 'Alignment strategy', false, {
            enum: ['centroid', 'boundingBox', 'auto'],
            default: 'auto'
        }),
        strParam('qualityPreset', 'Quality preset', false, {
            enum: ['fast', 'balanced', 'quality'],
            default: 'balanced'
        })
    ],
    output: {
        type: 'layers',
        description: 'Shape-normalized layers or a preparation result for the internal morphing pipeline.'
    },
    requiredTools: ['morphToShape', 'batchMorphToShape'],
    examples: [
        {
            userSays: '内部面板将多个袜子图层统一到一个参考形状',
            parameters: { targetShapeLayerId: 101, sourceLayerIds: [201, 202], qualityPreset: 'balanced' }
        }
    ],
    estimatedTime: 20,
    hasDecisionPoints: true
};

export const LayoutReplicationSkill: SkillDeclaration = {
    id: 'layout-replication',
    name: 'Layout Replication',
    displayName: '版式复刻',
    category: 'replication',
    kind: 'workflow',
    visibility: 'user-facing',
    routeClass: 'business-workflow',
    visualSamplingScenario: 'reference-replication',
    controlledRouteEntry: 'autonomous-react-loop',
    modelDirectExecution: 'forbidden',
    description: 'Analyze and rebuild the editable visual structure of a concrete reference image. The requested deliverable type remains the primary task identity.',
    whenToUse: ['User explicitly asks to replicate, recreate, trace, or copy the layout structure of a concrete reference image'],
    whenNotToUse: [
        'User only asks to search for references or inspiration instead of using a specific reference image',
        'User asks for a finished poster, main image, banner, or other creative deliverable and only says the image is a reference; the full task must stay in the autonomous design loop',
        'User asks for open-ended creative design without a provided reference layout',
        'User asks for SKU production, detail-page content filling, document save/export, or single-layer edits without explicit reference replication'
    ],
    routing: {
        intentSignals: [
            '参考图复刻',
            '复刻',
            '照着做',
            '按图做',
            '仿照',
            '同款版式',
            'copy layout',
            'replicate layout',
            'recreate layout',
            'same layout'
        ],
        intentSignalGroups: [
            ['参考图', '样图', '海报', '版式', '布局', 'reference image', 'reference design', 'attached reference', 'layout'],
            ['复刻', '照着做', '按图做', '仿照', '复现', '还原', '临摹', '同款', 'replicate', 'copy layout', 'recreate', 'same layout']
        ],
        negativeSignals: ['关闭文档', '不保存', 'SKU', '抠图', '只问模型'],
        preconditions: ['需要用户提供参考图，或当前上下文已经附带参考图'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 artifactKind、outputMode、templateApply、templateBlueprintOnly、projectPath、outputWidth、outputHeight、是否保持参考图尺寸；artifactKind 只能来自用户明确交付物（poster/banner/main-image/detail-page），不能由 templateApply 推断成详情页'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果没有参考图，明确提示需要提供参考图而不是假装继续执行'],
        decisionGuidance: [
            'Layout Replication 需要具体参考图或已附带参考画面；只有“找参考/找灵感”时应使用 design-reference-search。',
            '“做什么”优先于“怎么做”：海报/主图/横幅/详情页是交付物身份，复刻只是实现方法，不能用本 Skill 覆盖交付物身份。',
            '用户说“参考这张图做海报”时保持完整海报任务进入自主设计循环；循环可把本 Skill 作为参考结构分析与可编辑骨架能力调用。',
            'template_apply 只是写入方式，不代表详情页。只有 artifactKind=detail-page 才允许多屏详情页结构与详情页自动填充。',
            '如果用户只要求单个图层移动、缩放、重命名或顺序调整，不要调用本 skill。'
        ],
        routeStatusMessages: {
            deterministic: '分析参考图的布局和元素关系，并决定复刻到当前画布还是生成可编辑骨架。'
        }
    },
    parameters: [
        strParam('mode', 'Input mode', false, {
            enum: ['current', 'local', 'url'],
            default: 'current'
        }),
        strParam('filePath', 'Local reference image path'),
        strParam('url', 'Reference image url'),
        strParam('outputMode', 'Execution output mode', false, {
            enum: ['apply', 'template_blueprint', 'template_apply'],
            default: 'apply'
        }),
        strParam('artifactKind', 'Explicit target deliverable identity', false, {
            enum: ['generic', 'poster', 'banner', 'main-image', 'detail-page']
        }),
        boolParam('templateBlueprintOnly', 'Analyze reference and output an artifact-aware editable blueprint only', false),
        boolParam('templateApply', 'Analyze reference and apply an artifact-aware editable skeleton', false),
        boolParam('autoCreateDocument', 'Auto-create document when applying template and no doc is open', true),
        numParam('outputWidth', 'Explicit output canvas width when auto-creating document'),
        numParam('outputHeight', 'Explicit output canvas height when auto-creating document'),
        boolParam('preserveReferenceCanvasSize', 'Auto-create document using the reference image canvas size', false),
        boolParam('matchReferenceCanvasSize', 'Alias for preserveReferenceCanvasSize', false),
        strParam('projectPath', 'Project path used for auto image matching and filling after template apply'),
        boolParam('autoFillAfterApply', 'Auto match images and fill placeholders after template apply', true),
        numParam('minAutoFillPlanScore', 'Auto-fill minimum plan score threshold (0-1)', false, { default: 0.62 }),
        numParam('minAutoFillImageCoverage', 'Auto-fill minimum matched-image coverage threshold (0-1)', false, { default: 0.6 }),
        boolParam('allowLowConfidenceFill', 'Allow low-confidence auto-fill to place images directly', true),
        boolParam('copyTypography', 'Apply typography from reference', true),
        boolParam('copySpacing', 'Apply spacing from reference', true)
    ],
    output: {
        type: 'document',
        description: 'Canvas updated with replicated layout.'
    },
    requiredTools: [
        'getDocumentInfo',
        'createDocument',
        'getElementMapping',
        'createTextLayer',
        'createRectangle',
        'addStroke',
        'setLayerOpacity',
        'groupLayers',
        'matchDetailPageContent',
        'fillDetailPage'
    ],
    examples: [
        {
            userSays: '按这张图复刻布局',
            parameters: { mode: 'local', filePath: 'D:/ref/layout.jpg' }
        }
    ],
    estimatedTime: 8,
    hasDecisionPoints: true
};

export const DesignReferenceSearchSkill: SkillDeclaration = {
    id: 'design-reference-search',
    name: 'Design Reference Search',
    displayName: '设计参考检索',
    category: 'analysis',
    kind: 'operation',
    visibility: 'user-facing',
    runtimeRequirements: {
        photoshop: 'not_required'
    },
    description: 'Search and fetch design references for the requested style.',
    whenToUse: ['User asks for visual style references'],
    whenNotToUse: [
        'User provides a concrete reference image and asks to replicate or rebuild its layout',
        'User asks to edit, fill, export, or save the current Photoshop document',
        'User asks for SKU production, background removal, or single-image visual analysis'
    ],
    routing: {
        intentSignalGroups: [
            ['搜索', '搜一下', '查找', '检索', '找一些', '找一下', '找', 'search', 'find'],
            ['参考', '参考图', '设计参考', '视觉参考', '参考案例', '灵感', '竞品', '竞店', '对标', '同款', '同类', '相似风格', '类似风格', '设计方案', '视觉方案', 'reference', 'inspiration']
        ],
        negativeSignals: ['复刻', '照着做', '按图做', '同款版式', 'copy layout', 'replicate', 'recreate', '抠图', 'SKU 组合图'],
        preconditions: ['用户给出参考检索主题，或上下文中存在上一轮明确的参考检索目标'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 query、mode=search、limit；保留产品、材质、风格和平台关键词'],
        clarificationHints: ['如果没有检索主题，询问要搜索的产品、风格或设计方向'],
        decisionGuidance: [
            '搜索参考、找灵感、找视觉案例时使用本 skill。',
            '不要把“找参考”误路由为参考图复刻；复刻需要用户提供具体参考图。',
            '这是外部/知识检索，不需要 Photoshop 文档写入。'
        ],
        routeStatusMessages: {
            deterministic: '检索相关设计参考，并整理可用于设计判断的视觉方向。'
        }
    },
    parameters: [
        strParam('query', 'Search query', true),
        strParam('mode', 'Search mode', false, {
            enum: ['search', 'fetchUrl'],
            default: 'search'
        }),
        strParam('url', 'URL to fetch when mode is fetchUrl'),
        numParam('limit', 'Result limit', false, { default: 8 })
    ],
    output: {
        type: 'data',
        description: 'Reference list and metadata.'
    },
    requiredTools: ['searchDesigns', 'fetchWebPageDesignContent'],
    examples: [
        {
            userSays: '找一些极简运动风参考图',
            parameters: { query: 'minimal sports ecommerce detail page', mode: 'search', limit: 8 }
        }
    ],
    estimatedTime: 5
};

export const VisualAnalysisSkill: SkillDeclaration = {
    id: 'visual-analysis',
    name: 'Visual Analysis',
    displayName: '视觉分析',
    category: 'analysis',
    kind: 'operation',
    visibility: 'user-facing',
    runtimeRequirements: {
        photoshop: 'source_dependent',
        photoshopFreeSourceTypes: ['attached_image', 'base64', 'local_file']
    },
    description: 'Analyze style, color, composition and elements from image input, active document, or a specific Photoshop layer.',
    whenToUse: [
        'User asks to analyze style, color, composition, or elements in a specific image/current document',
        'User names a Photoshop layer and asks what the image inside that layer contains',
        'User asks for read-only visual understanding before deciding a design direction'
    ],
    whenNotToUse: [
        'User asks to search external references or inspiration',
        'User asks to replicate a reference layout into Photoshop',
        'User asks to analyze an entire project image set or inventory',
        'User asks to edit, generate, export, or save design outputs'
    ],
    routing: {
        intentSignalGroups: [
            ['这个图', '这张图', '图片', '海报', '画面', '当前画面', '当前文档', 'image', 'poster', 'canvas'],
            ['分析', '看一下', '看看', '识别', '理解', '构图', '颜色', '风格', '元素', 'composition', 'color', 'style', 'analyze']
        ],
        negativeSignals: ['搜索', '找参考', '参考图', '灵感', '竞品', '复刻', '按图做', '照着做', '项目图片', '项目素材', '项目资源', 'SKU', '主图', '详情页', '导出', '保存', '生成'],
        preconditions: ['需要本轮附件图片、当前文档截图、目标图层名称/ID，或用户提供的本地图片路径'],
        supportedModes: ['inspect'],
        parameterExtractionHints: ['抽取 sourceType、filePath、layerName、layerId、analysisFocus；本轮有附件且用户说“这张图/图片”时 sourceType=attached_image；用户明确说某个图层里的图片时 sourceType=layer，传 layerName 或 layerId；明确说当前画面/当前文档时 sourceType=active_document'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果没有当前文档或图片输入，先让用户提供要分析的图片'],
        decisionGuidance: [
            'Visual Analysis 是只读视觉理解能力，不写入 Photoshop。',
            '指定图层分析必须先定位图层并导出该图层图像，再分析图层内容；不要退回整张画布截图。',
            '项目级素材理解使用 project-image-analysis，不要用单图分析替代项目分析。',
            '搜索外部参考使用 design-reference-search；复刻具体参考图使用 layout-replication。'
        ],
        routeStatusMessages: {
            deterministic: '读取目标画面后分析构图、颜色和视觉元素。'
        }
    },
    parameters: [
        strParam('sourceType', 'Image source type', true, {
            enum: ['attached_image', 'local_file', 'active_document', 'layer'],
            default: 'active_document'
        }),
        strParam('filePath', 'Local image path when sourceType is local_file'),
        strParam('layerName', 'Photoshop layer name when sourceType is layer'),
        numParam('layerId', 'Photoshop layer ID when sourceType is layer'),
        strParam('analysisFocus', 'Analysis focus', false, {
            enum: ['general', 'style', 'color', 'layout', 'elements'],
            default: 'general'
        }),
        strParam('exportMode', 'Optional layer export mode when sourceType is layer', false, {
            enum: ['imaging', 'native-png'],
            default: 'imaging'
        }),
        strParam('exportFormat', 'Optional layer export image format when sourceType is layer and exportMode is imaging', false, {
            enum: ['jpeg', 'png'],
            default: 'jpeg'
        })
    ],
    output: {
        type: 'data',
        description: 'Visual analysis JSON report.'
    },
    requiredTools: ['getCanvasSnapshot', 'findLayers', 'getLayerBounds', 'exportLayerAsBase64', 'visual:analyzeLocalImage', 'visual:analyzeBase64Image'],
    examples: [
        {
            userSays: '分析这个海报的构图',
            parameters: { sourceType: 'local_file', filePath: 'D:/project/poster.jpg', analysisFocus: 'layout' }
        },
        {
            userSays: '帮我看看图层 2026-05-10 090013 这张图片里面是什么内容',
            parameters: { sourceType: 'layer', layerName: '2026-05-10 090013', analysisFocus: 'elements' }
        }
    ],
    estimatedTime: 5
};

export const ProjectImageAnalysisSkill: SkillDeclaration = {
    id: 'project-image-analysis',
    name: 'Project Image Analysis',
    displayName: '项目图片分析',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'user-facing',
    routeClass: 'open-design',
    runtimeRequirements: {
        photoshop: 'not_required'
    },
    // 模型路由不得直执：项目图片分析要在 Agent 循环里根据观察结果逐步推进，不由模型路由一跳到底。
    modelDirectExecution: 'forbidden',
    description: 'Analyze images already scanned from the current project and summarize style, features, and detail-page direction.',
    whenToUse: [
        'User asks to understand project images or source photos',
        'User asks what style, features, or selling points can be inferred from project images',
        'User asks how the current project images can be used for detail-page design'
    ],
    whenNotToUse: [
        'User already uploaded a specific image and only wants single-image editing',
        'User asks to create, generate, export, or deliver a main image, detail page, SKU image, or other finished design from project assets',
        'No project is loaded and no project images are available'
    ],
    routing: {
        intentSignals: [
            '项目中的图片',
            '项目里的图片',
            'regex:(?:当前|这个|本)?项目(?:内|里|中)?(?:都)?(?:有什么|有哪些|包含什么|包括什么)',
            '项目图片',
            '项目素材',
            '这些图片',
            '这些图',
            '这些照片',
            '这些素材',
            '图片内容',
            '原图分析',
            '项目原图',
            '当前项目',
            '这个项目',
            '什么项目',
            '项目类型',
            '项目概况',
            '项目概览',
            '项目内容',
            '项目资源',
            '资源列表',
            '素材列表',
            '都有些什么',
            '有些什么',
            '都有啥',
            'regex:(?:分析|理解|看看|看一下|检查)(?:一下)?(?:当前|这个)?(?:项目|project)',
            'regex:(?:当前|这个).{0,8}(?:项目|project)'
        ],
        intentSignalGroups: [
            ['项目中的图片', '项目里的图片', 'regex:(?:当前|这个|本)?项目(?:内|里|中)?(?:都)?(?:有什么|有哪些|包含什么|包括什么)', '项目图片', '项目素材', '项目原图', '原图', '文件夹图片', '图片资源', '图片内容', '项目内容', '项目资源', '资源列表', '素材列表', '这些图片', '这些图', '这些照片', '这些素材', '当前项目', '这个项目', 'regex:(?:分析|理解|看看|看一下|检查)(?:一下)?(?:当前|这个)?(?:项目|project)', 'regex:(?:当前|这个).{0,8}(?:项目|project)'],
            ['分析', '理解', '看一下', '看看', '描述', '总结', '内容', '识别', '判断', '款式', '特征', '卖点', '详情页', '可以做什么', '是什么', '什么项目', '项目类型', '项目概况', '项目概览', '项目内容', '项目资源', '都有什么', '都有些什么', '有些什么', '都有啥', '有什么', '有哪些', '包含什么', '包括什么', '文件夹', '目录结构', '项目结构', '品类', '类目', '风格']
        ],
        negativeSignals: ['上传图片', '单张图片编辑', '主图模板创建', '进度', '完成了吗', '还剩', '剩余', '下一步', '下一项', '代码', '仓库', '工程', '架构'],
        preconditions: ['需要当前项目已扫描到图片'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 sampleSize、focus、directories'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果项目上下文不存在，先问用户当前要分析哪个项目'],
        decisionGuidance: [
            '如果最近对话已经在讨论项目图片，后续关于款式、特征、卖点、详情页方向的问题仍继续路由到本 skill。',
            '如果用户要求完成、生成、导出或验收主图、详情页、SKU 等成品，项目图片理解只是前置观察阶段，不能停在本 skill。',
            '当前项目已经有已扫描图片时，不要要求用户重新上传图片。'
        ],
        routeStatusMessages: {
            deterministic: '读取项目图片样本，分析款式、特征和后续可用于详情页的方向。',
            autonomous: '理解项目图片内容，判断款式特征和后续设计方向。'
        }
    },
    parameters: [
        numParam('sampleSize', 'How many project images to analyze', false, { default: 6 }),
        strParam('focus', 'Analysis focus', false, {
            enum: ['general', 'style-and-detail-page', 'style', 'detail-page', 'inventory'],
            default: 'style-and-detail-page'
        }),
        strParam('analysisMode', 'Analysis mode. Use inventory for fast project resource overview without visual model calls.', false, {
            enum: ['content', 'inventory'],
            default: 'content'
        }),
        arrParam('directories', 'Optional project directories to prioritize when selecting images'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Aggregated project-image analysis and detail-page suggestions.'
    },
    requiredTools: ['analyzeProjectContactSheetOverview', 'analyzeAssetContent'],
    examples: [
        {
            userSays: '理解一下项目里的图片，看看这款是什么款式，有哪些特征，后续详情页可以怎么做',
            parameters: { sampleSize: 6, focus: 'style-and-detail-page' }
        }
    ],
    estimatedTime: 12,
    hasDecisionPoints: true
};

export const LayerManagementSkill: SkillDeclaration = {
    id: 'layer-management',
    name: 'Layer Management',
    displayName: '图层管理',
    category: 'layout',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Perform deterministic Photoshop layer management operations such as selecting, renaming, deleting, duplicating, grouping, and changing stack order.',
    whenToUse: [
        'User asks to select, rename, delete, duplicate, group, ungroup, or move existing Photoshop layers into a group',
        'User asks to move layers up/down/top/bottom or above/below another layer in the Photoshop layer stack',
        'User asks to sort color layers from light to dark or dark to light in layer panel order',
        'User asks how many product color layers exist in the current Photoshop document',
        'User asks which text layer contains a specific copy string, or where that text layer is positioned'
    ],
    whenNotToUse: [
        'User asks to move a layer on the canvas by x/y position',
        'User asks to create a whole design, detail page, main image, or SKU batch',
        'User asks to save, close, switch, or create documents'
    ],
    routing: {
        intentSignals: ['图层顺序', '图层层级', '调整图层', '选中图层', '选择图层', '重命名图层', '删除图层', '复制图层', '图层编组', '解除编组', '移动到图层组', '移入图层组', '放到组内', '置顶', '置底', '上移图层', '下移图层', '移到上方', '移到下方', '从浅到深', '从深到浅', '几个颜色', '多少个颜色', '颜色图层', '几个图层', '隐藏图层', '看不到图层', '文案文本在哪个图层', '文本在哪个位置', '哪个图层', '所在图层', 'layer order', 'rename layer', 'delete layer', 'duplicate layer', 'group layers'],
        negativeSignals: ['保存文档', '关闭文档', '详情页', '主图', 'SKU', '自选备注', '抠图', '形态统一'],
        preconditions: ['需要 Photoshop 当前文档存在，且目标图层可通过 layerId、layerName、当前选择或图层层级读取确定'],
        supportedModes: ['select', 'rename', 'delete', 'duplicate', 'group', 'ungroup', 'move-to-group', 'reorder', 'inspect'],
        modeSignals: {
            select: ['选中图层', '选择图层', '定位图层', 'focus layer', 'select layer'],
            rename: ['重命名图层', '图层改名', 'rename layer'],
            delete: ['删除图层', '删掉图层', 'delete layer'],
            duplicate: ['复制图层', '拷贝图层', 'duplicate layer'],
            group: ['图层编组', '编组图层', 'group layers'],
            ungroup: ['解除编组', '取消编组', 'ungroup'],
            'move-to-group': ['移动到组', '放到组内', '移入图层组', '移动到目标图层组', 'move into group'],
            reorder: ['图层顺序', '图层层级', '置顶', '置底', '上移图层', '下移图层', '移到上方', '移到下方', '从浅到深', '从深到浅', 'layer order'],
            inspect: ['几个颜色', '多少个颜色', '颜色图层', '几个图层', '隐藏图层', '看不到图层', '查看图层', '读取图层', '文案在哪', '文本在哪', '哪个图层', '所在图层']
        },
        parameterExtractionHints: ['抽取 action、documentId、layerId、layerIds、layerName、targetLayerId、targetLayerName、newName、reorderAction、sortBy、sortDirection、inspectMode、textContent'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果目标图层不明确，先返回候选图层让用户确认，不要盲改'],
        decisionGuidance: [
            '改变 Photoshop 图层面板堆叠顺序必须使用 reorderLayer，不要使用 moveLayer。',
            '改变父子层级、把图层放入某个组内时使用 moveLayerToGroup，不要使用 moveLayer。',
            '源图层和目标组已经明确时，move-to-group 默认放入组内即可；不要额外追问顶部、底部或大小位置，除非用户明确要求组内排序或画布坐标调整。',
            'moveLayer 只用于画布 x/y 位置移动，不适用于“置顶/置底/上移/下移/从浅到深排序”。',
            '如果用户说“从浅到深/从深到浅”，先读取图层层级和图层属性，只在能从图层名称或属性推断明暗时执行。',
            '如果用户问当前文档有几个颜色，使用 inspectMode=color-layers，并读取隐藏图层；不要把背景、选区、蒙版、参考层计入商品颜色。',
            '如果用户问某段文案或文本在哪个图层、哪个位置，使用 inspectMode=text-layer-location，并用 textContent 传入要查找的文本内容。',
            '如果用户追问隐藏图层或图层数量，仍然属于 Photoshop 状态读取，不应被普通聊天问答吞掉。'
        ],
        routeStatusMessages: {
            deterministic: '读取图层层级，按明确目标执行图层管理操作并复核。',
            autonomous: '读取图层层级后处理图层管理操作。'
        }
    },
    parameters: [
        strParam('action', 'Layer management action', true, {
            enum: ['select', 'rename', 'delete', 'duplicate', 'group', 'ungroup', 'move-to-group', 'reorder', 'inspect']
        }),
        numParam('documentId', 'Optional opened Photoshop document id to switch before inspecting or editing layers'),
        numParam('layerId', 'Target layer id'),
        arrParam('layerIds', 'Target layer ids'),
        strParam('layerName', 'Target layer name'),
        strParam('targetDescription', 'Natural-language target layer description'),
        strParam('newName', 'New layer name for rename or duplicate'),
        strParam('reorderAction', 'Stack order action', false, {
            enum: ['up', 'down', 'top', 'bottom', 'above', 'below']
        }),
        numParam('targetLayerId', 'Reference layer id for above/below reorder'),
        numParam('targetGroupId', 'Target group id for move-to-group'),
        strParam('targetLayerName', 'Reference layer name for above/below reorder'),
        strParam('targetGroupName', 'Target group name for move-to-group'),
        strParam('sortBy', 'Sort strategy for reorder', false, {
            enum: ['lightness']
        }),
        strParam('sortDirection', 'Sort direction', false, {
            enum: ['light-to-dark', 'dark-to-light']
        }),
        strParam('textContent', 'Text content to locate in Photoshop text layers'),
        strParam('inspectMode', 'Inspection mode for layer analysis', false, {
            enum: ['color-layers', 'text-layer-location']
        }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Layer management execution result with actual tool results.'
    },
    requiredTools: [
        'listDocuments',
        'switchDocument',
        'getDocumentInfo',
        'getLayerHierarchy',
        'getAllTextLayers',
        'getLayerBounds',
        'getLayerProperties',
        'selectLayer',
        'renameLayer',
        'deleteLayer',
        'duplicateLayer',
        'groupLayers',
        'ungroupLayers',
        'moveLayerToGroup',
        'reorderLayer',
        'getAcceptanceSnapshot'
    ],
    examples: [
        {
            userSays: '把图层的颜色从浅到深，从上到下调整图层顺序',
            parameters: { action: 'reorder', sortBy: 'lightness', sortDirection: 'light-to-dark' }
        },
        {
            userSays: '把当前选中的图层置顶',
            parameters: { action: 'reorder', reorderAction: 'top' }
        },
        {
            userSays: '当前文档中的图层是几个颜色',
            parameters: { action: 'inspect', inspectMode: 'color-layers' }
        },
        {
            userSays: '“波浪边缘，增添法式感。”这段文案在哪个图层、什么位置',
            parameters: { action: 'inspect', inspectMode: 'text-layer-location', textContent: '波浪边缘，增添法式感。' }
        }
    ],
    estimatedTime: 4,
    hasDecisionPoints: false
};

export const FindEditElementSkill: SkillDeclaration = {
    id: 'find-and-edit-element',
    name: 'Find And Edit Element',
    displayName: '查找并编辑元素',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'user-facing',
    // 模型路由不得直执（真机病例 2026-07-07）：「改一下详情页的文案」被直执后，多候选
    // 分支以一句「候选图层不唯一」终结任务。定位/消歧必须在 Agent 循环里进行——多候选
    // 结果作为 observation 回给模型消歧或向用户展示清单，工作流输出不能当终局答案。
    modelDirectExecution: 'forbidden',
    description: 'Locate canvas element by visual-language description and edit it safely.',
    whenToUse: [
        'User can see an element on canvas but does not know its layer path',
        'User asks to edit top-right text, center image, corner icon and similar visual targets'
    ],
    whenNotToUse: [
        'User already gives a concrete layerId and asks for direct single-tool operation',
        'User asks to generate whole design set instead of editing an existing element'
    ],
    routing: {
        intentSignals: ['右上角文案', '左上角文案', '顶部标题', '底部按钮', '中间图片', '画布上的文字', '页面上的价格', '把文案改成', '把文字改成', '替换图片', '选中这个元素', '定位这个元素', '去除色卡编号', '隐藏色卡顺序编号'],
        negativeSignals: ['图层顺序', '图层层级', '置顶', '置底', '保存文档', '关闭文档', '详情页', '主图', 'SKU', '批量'],
        preconditions: ['需要 Photoshop 当前文档存在，并且 getElementMapping 能返回可编辑元素映射'],
        supportedModes: ['locate', 'select', 'setText', 'move', 'scale', 'setOpacity', 'setBlendMode', 'replaceImage', 'hide'],
        modeSignals: {
            locate: ['定位', '找到', '看看哪个元素'],
            select: ['选中', '选择'],
            setText: ['改成', '改为', '替换成', '换成', '写成', '设置为', '修改为'],
            move: ['移动', '挪到'],
            scale: ['放大', '缩小', '缩放'],
            setOpacity: ['透明度', '不透明度'],
            setBlendMode: ['混合模式'],
            replaceImage: ['替换图片', '换图'],
            hide: ['去除', '去掉', '移除', '隐藏', '不显示', '取消显示', '拿掉']
        },
        parameterExtractionHints: ['抽取 targetDescription、action、text、layerId、x、y、dx、dy、scalePercent、opacity、blendMode、filePath'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['候选分数不足或候选差距过小时，先让用户确认候选，不要盲改'],
        decisionGuidance: [
            '用户描述的是画布视觉位置和元素语义时，优先用 getElementMapping 定位，而不是直接猜 layerId。',
            '用户说“改成/改为/替换成”并且目标是文案/文字/标题/价格时，action 应为 setText。',
            '用户说“去除/隐藏”某个画布元素时，默认用 hide 做可逆隐藏；如果识别到同一类色卡编号，可以作为一组处理。',
            '用户说“图层顺序/置顶/置底/从浅到深”时不要使用本能力，应交给 layer-management。'
        ]
    },
    parameters: [
        strParam('targetDescription', 'Visual description of target element', true),
        strParam('action', 'Edit action', false, {
            enum: ['locate', 'select', 'setText', 'move', 'scale', 'setOpacity', 'setBlendMode', 'replaceImage', 'hide'],
            default: 'locate'
        }),
        strParam('selectionMode', 'Candidate handling strategy', false, {
            enum: ['auto', 'suggest', 'force'],
            default: 'auto'
        }),
        numParam('layerId', 'Explicit target layer id if already known'),
        strParam('text', 'New text when action is setText'),
        numParam('x', 'Absolute x for move'),
        numParam('y', 'Absolute y for move'),
        numParam('dx', 'Relative move offset x'),
        numParam('dy', 'Relative move offset y'),
        numParam('scalePercent', 'Scale percent for scale action'),
        numParam('opacity', 'Opacity for setOpacity action'),
        strParam('blendMode', 'Blend mode for setBlendMode action'),
        strParam('filePath', 'Image path for replaceImage action')
    ],
    output: {
        type: 'data',
        description: 'Selected layer info, candidate list (if needed), and execution result.'
    },
    requiredTools: [
        'getElementMapping',
        'selectLayer',
        'setTextContent',
        'moveLayer',
        'transformLayer',
        'setLayerOpacity',
        'setBlendMode',
        'replaceLayerContent'
    ],
    examples: [
        {
            userSays: '把右上角价格文案改成 到手价 39',
            parameters: { targetDescription: '右上角价格文案', action: 'setText', text: '到手价 39' }
        }
    ],
    estimatedTime: 4,
    hasDecisionPoints: true
};

export const AgentPanelBridgeSkill: SkillDeclaration = {
    id: 'agent-panel-bridge',
    name: 'Agent Panel Bridge',
    displayName: '面板操作桥接',
    category: 'analysis',
    kind: 'debug',
    visibility: 'internal-debug',
    description: 'Bridge debugging with agent panel and produce structured MCP-oriented actions.',
    whenToUse: [
        'User asks to debug with agent panel interaction',
        'User cannot describe issue clearly and needs guided troubleshooting workflow'
    ],
    whenNotToUse: [
        'Single straightforward tool execution without iterative debugging',
        'Pure casual chat without implementation or diagnosis task'
    ],
    routing: {
        intentSignals: ['agent 面板', '智能体面板', '桥接调试', 'MCP 调试', '联调', 'websocket'],
        negativeSignals: ['关闭文档', '切换文档', '改字体', '详情页模板', '主图模板'],
        preconditions: ['需要明确是在调试桌面端、面板、MCP 或桥接链路'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 goal、symptom、expectedResult、reproSteps、constraints'],
        retryPolicy: 're-evaluate',
        clarificationHints: ['如果调试目标不明确，先问用户当前现象和期望结果'],
        decisionGuidance: [
            '只有在用户明确提到面板、MCP、bridge、websocket 或联调时，才路由到这个 internal-debug skill。',
            '普通 Photoshop 操作不能路由到这个 skill。'
        ],
        routeStatusMessages: {
            deterministic: '检查桌面端、面板和工具链路以定位问题。',
            autonomous: '检查桌面端、面板和工具链路以定位问题。'
        }
    },
    parameters: [
        strParam('goal', 'Primary goal to implement or debug', true),
        strParam('symptom', 'Observed issue or failure symptom'),
        strParam('expectedResult', 'Expected successful outcome'),
        arrParam('reproSteps', 'Minimal reproduction steps'),
        arrParam('constraints', 'Restrictions and guardrails'),
        boolParam('needMcpTools', 'Whether to retrieve MCP tool list first', true),
        strParam('mcpToolName', 'Optional MCP tool name to call directly'),
        objParam('mcpArguments', 'Arguments for mcpToolName')
    ],
    output: {
        type: 'data',
        description: 'Structured bridge message, MCP context, verification criteria, and next-step checklist.'
    },
    requiredTools: ['mcp:tools:list', 'mcp:tools:call'],
    examples: [
        {
            userSays: '帮我和面板一起调试详情页文案溢出',
            parameters: { goal: '定位并修复详情页文案溢出', needMcpTools: true }
        }
    ],
    estimatedTime: 3,
    hasDecisionPoints: true
};

export const DocumentManagementSkill: SkillDeclaration = {
    id: 'document-management',
    name: 'Document Management',
    displayName: '文档管理',
    category: 'document',
    kind: 'operation',
    visibility: 'user-facing',
    // 模型路由不得直执：文档写操作需要循环内读后写纪律与上下文核对，不由模型路由直接落地。
    modelDirectExecution: 'forbidden',
    description: 'Perform deterministic Photoshop document operations such as listing, switching, creating, saving, or closing documents.',
    whenToUse: [
        'User asks to save or export the current Photoshop document',
        'User asks to save a document as PSD/PSB or into the current project',
        'User asks to close the current document',
        'User asks to close a document without saving',
        'User asks to switch to another already-open document',
        'User asks to list the currently open Photoshop documents',
        'User asks to create a new plain document'
    ],
    whenNotToUse: [
        'User asks to save the current document as a reusable template',
        'User asks to debug the desktop panel or MCP chain',
        'User asks to build a design template such as detail-page or main-image template'
    ],
    routing: {
        intentSignals: ['保存文档', '保存当前文档', '保存到项目', '保存为 PSD', '保存PSD', '存一下', '保存一下', '导出当前文档', '当前文档导出', '文档导出', '导出为 PNG', '导出PNG', '导出成PNG', '导出为 JPG', '导出JPG', '导出成JPG', '导出为 PDF', '导出PDF', '导出成PDF', '关闭文档', '关掉文档', '切换文档', '列出文档', '列出当前文档', '查看文档列表', '有哪些文档', '新建文档', 'save document', 'save psd', 'export document', 'export png', 'export jpg', 'export pdf', 'close document', 'switch document', 'list documents', 'create document'],
        negativeSignals: ['保存模板', '加入模板库', '加入设计库', '另存为模板', '详情页模板', '主图模板', '面板调试', 'MCP 调试'],
        preconditions: ['save/close/switch/list 需要 Photoshop 已连接；save/close/switch 需要目标文档存在'],
        supportedModes: ['save', 'close', 'switch', 'list', 'create'],
        modeSignals: {
            save: ['保存文档', '保存当前文档', '保存到项目', '保存为 PSD', '保存PSD', '存一下', '保存一下', '导出当前文档', '当前文档导出', '文档导出', '导出为 PNG', '导出PNG', '导出成PNG', '导出为 JPG', '导出JPG', '导出成JPG', '导出为 PDF', '导出PDF', '导出成PDF', 'save document', 'save psd', 'export document', 'export png', 'export jpg', 'export pdf'],
            close: ['关闭文档', '关掉文档', 'close document', 'close file'],
            switch: ['切换文档', '切到文档', 'switch document'],
            list: ['列出文档', '列出当前文档', '查看文档列表', '有哪些文档', 'list documents'],
            create: ['新建文档', '创建文档', 'create document']
        },
        parameterExtractionHints: ['抽取 action、documentName、documentId、save、format、path、saveAs、preset、width、height、name'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果要关闭或切换但目标文档不明确，先问用户具体文档名'],
        decisionGuidance: [
            '“保存详情页文档到项目的 PSD 中”之类的请求是文档保存，详情页只是文档对象上下文，不能路由到 detail-page-design。',
            '“关闭文档不保存”之类的请求应提取 action=close 且 save=false。',
            '这类普通文档操作不能路由到 agent-panel-bridge。'
        ],
        routeStatusMessages: {
            deterministic: '确认当前打开的文档后执行文档操作。',
            autonomous: '确认当前文档状态后处理文档操作。'
        }
    },
    parameters: [
        strParam('action', 'Document action', true, {
            enum: ['list', 'switch', 'close', 'create', 'save']
        }),
        strParam('documentName', 'Target document name for switch or close'),
        numParam('documentId', 'Target document id for close'),
        boolParam('save', 'Whether to save changes before close'),
        strParam('format', 'Save format for action=save', false, {
            enum: ['psd', 'psb', 'png', 'jpg', 'jpeg', 'tiff', 'pdf']
        }),
        strParam('path', 'Absolute save path for action=save'),
        strParam('projectSubdir', 'Optional current-project subdirectory for action=save, for example PSD'),
        boolParam('saveAs', 'Whether action=save should create a project save-as copy'),
        strParam('preset', 'Optional document preset for create'),
        numParam('width', 'Document width for create'),
        numParam('height', 'Document height for create'),
        strParam('name', 'New document name for create'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Document operation result and current document state.'
    },
    requiredTools: ['listDocuments', 'switchDocument', 'closeDocument', 'createDocument', 'getDocumentInfo', 'saveDocument'],
    examples: [
        {
            userSays: '帮我把详情页文档保存到项目的PSD中',
            parameters: { action: 'save', format: 'psd', saveAs: true }
        },
        {
            userSays: '帮我关闭文档不保存',
            parameters: { action: 'close', save: false }
        }
    ],
    estimatedTime: 3,
    hasDecisionPoints: false
};

export const SaveCurrentTemplateSkill: SkillDeclaration = {
    id: 'save-current-template',
    name: 'Save Current Template',
    displayName: '保存当前模板',
    category: 'ecommerce',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Save the current Photoshop document into the reusable template library.',
    whenToUse: [
        'User asks to save the current document as a template',
        'User asks to add the active Photoshop document into template library'
    ],
    whenNotToUse: [
        'No Photoshop document is open',
        'User asks to save a single element instead of whole document'
    ],
    routing: {
        intentSignals: ['保存模板', '加入设计库', '加入模板库', '另存为模板'],
        negativeSignals: ['详情页模板创建', '主图模板创建', '单图层'],
        preconditions: ['需要当前存在打开的 Photoshop 文档'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 type、description、tags、templateIntent'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果模板类型不明确，可先按当前文档内容询问用户归类'],
        routeStatusMessages: {
            deterministic: '整理当前文档内容，准备存入设计库。',
            autonomous: '整理当前文档和资源，准备存入设计库。'
        }
    },
    parameters: [
        strParam('type', 'Template type', false, {
            enum: ['sku', 'detail-page', 'banner', 'main-image', 'other'],
            default: 'other'
        }),
        strParam('description', 'Optional template description for reuse'),
        arrParam('tags', 'Optional tags for template retrieval'),
        strParam('templateIntent', 'Original user intent used for template type inference')
    ],
    output: {
        type: 'data',
        description: 'Saved template metadata.'
    },
    requiredTools: ['listDocuments'],
    examples: [
        {
            userSays: '把当前文档添加为模板',
            parameters: { type: 'other' }
        }
    ],
    estimatedTime: 2
};

export const TextFontReplaceSkill: SkillDeclaration = {
    id: 'text-font-replace',
    name: 'Text Font Replace',
    displayName: '文字字体替换',
    category: 'text',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Replace the font for all text layers or target text layers and verify the result.',
    whenToUse: [
        'User asks to change all fonts to a specific typeface',
        'User asks to replace text-layer fonts in the active document'
    ],
    whenNotToUse: [
        'User asks only to edit text content',
        'No Photoshop document is open'
    ],
    routing: {
        intentSignals: ['改字体', '换字体', '全部字体', '字体全部', '字体改成', '字体改为', 'replace font', 'change font'],
        negativeSignals: ['改文案内容', '改标题文案', '面板调试'],
        preconditions: ['需要当前文档存在文本图层'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 fontName、includeHidden、layerIds'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果目标字体名不明确，先问用户要改成哪种字体'],
        decisionGuidance: [
            '如果用户明确给出了字体名称，返回 skillParams.fontName。',
            '如果当前消息只是“再改一下/没改成功”之类的续作反馈，应优先继续上一条字体修改任务。',
            '字体替换后必须复核字号、字距、行距和文本边界变化；不能只因 fontName 写入成功就声明版面效果完成。'
        ],
        routeStatusMessages: {
            deterministic: '读取当前文档文本图层，批量替换字体并逐层验证结果。',
            autonomous: '读取文本图层，批量替换字体并验证。'
        }
    },
    parameters: [
        strParam('fontName', 'Target font family or PostScript name', true),
        arrParam('layerIds', 'Optional explicit text layer ids to update'),
        boolParam('includeHidden', 'Include hidden text layers', false),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Per-layer font update result with verification details.'
    },
    requiredTools: ['getAllTextLayers', 'setTextStyle'],
    examples: [
        {
            userSays: '帮我把字体全部改成思源黑体',
            parameters: { fontName: '思源黑体', includeHidden: false }
        }
    ],
    estimatedTime: 4,
    hasDecisionPoints: false
};

export const EcommerceSocksDesignSkill: SkillDeclaration = {
    id: 'ecommerce-socks-design',
    name: 'E-commerce Socks Design',
    displayName: '电商袜品设计编排',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    // 模型路由不得直执：父级编排工作流必须经 Agent 自主循环协调子任务与评审。
    modelDirectExecution: 'forbidden',
    description: 'Plan e-commerce socks design work as one parent skill, with main image, detail page, and SKU as child skills.',
    whenToUse: [
        'User asks for an overall socks e-commerce design plan',
        'User asks to coordinate main image, detail page, and SKU work for a socks project',
        'User asks for a full set of socks e-commerce deliverables'
    ],
    whenNotToUse: [
        'User only asks for a single existing child skill before the parent dispatch checkpoint',
        'User only asks to manage documents, layers, fonts, or templates',
        'User asks for generic design theory without execution planning'
    ],
    routing: {
        intentSignals: [
            '电商袜子设计',
            '袜子电商设计',
            '整套袜子设计',
            '一套袜子设计',
            '全套袜子电商',
            '主图详情页SKU',
            '主图 详情页 SKU',
            'socks ecommerce design'
        ],
        intentSignalGroups: [
            ['袜子', '袜', 'socks'],
            [
                '电商袜子设计',
                '袜子电商设计',
                '整套',
                '全套',
                '一套',
                '整体',
                '全链路',
                '全案',
                '完整',
                '全部',
                '全盘',
                '跑完',
                '自主跑完',
                '三个skill',
                '三个 skill',
                '三个技能',
                '主图详情页SKU',
                '主图 详情页 SKU',
                '主图、详情页和SKU',
                '主图、SKU、详情页',
                '详情页、SKU、主图',
                '主图+详情页+SKU',
                '主图+SKU+详情页',
                '主图/详情页/SKU',
                '主图/SKU/详情页',
                'main image detail page sku',
                'full set',
                'whole project'
            ]
        ],
        negativeSignals: ['只做SKU', '只做 SKU', '只做主图', '只做详情页', '临时详情页草稿', '临时主图草稿', '保存文档', '关闭文档', '改字体', '图层顺序'],
        preconditions: ['需要项目上下文、当前 Photoshop 文档或用户明确指定交付范围'],
        supportedModes: ['plan', 'execute'],
        parameterExtractionHints: [
            '抽取 deliverables: main-image/detail-page/sku；抽取 projectPath；默认只输出父 skill 编排计划',
            '只有用户明确要求执行整套子任务时才设置 executeChildren=true',
            '只有开发者验收或用户明确确认执行时才设置 confirmChildDispatch=true',
            'enableChildDispatch/runChildDispatch/executeRealChildDispatch 是真实子调度开关，不能从普通计划请求中推断'
        ],
        retryPolicy: 're-evaluate',
        clarificationHints: ['如果用户没有明确是整套设计还是单项交付，先确认交付范围'],
        decisionGuidance: [
            '当前阶段这是父 skill 入口，不直接改写主图、详情页、SKU 的业务策略。',
            '用户明确只做单项 SKU、主图或详情页时，保持现有子 skill 路由。',
            '用户提出整套袜子电商设计或同时包含主图/详情页/SKU 时，优先使用本 skill。'
        ],
        routeStatusMessages: {
            deterministic: '整理电商袜子设计目标，规划主图、详情页和 SKU 子能力的执行边界。'
        }
    },
    parameters: [
        strParam('userIntent', 'Original user request'),
        arrParam('deliverables', 'Requested child deliverables: main-image, detail-page, sku'),
        strParam('projectPath', 'Optional project path for socks assets'),
        boolParam('executeChildren', 'Whether parent skill may dispatch child skills; default is false', false),
        boolParam('confirmChildDispatch', 'Explicit confirmation that child skill dispatch is allowed', false),
        boolParam('enableChildDispatch', 'Developer-controlled switch that enables real child executor calls', false),
        boolParam('dryRunChildDispatch', 'Report child dispatch order without calling child executors', false),
        arrParam('childReports', 'Optional existing child reports for parent aggregation')
    ],
    output: {
        type: 'data',
        description: 'Parent orchestration context for main-image, detail-page, and SKU child skills.'
    },
    requiredTools: [],
    examples: [
        {
            userSays: '帮我规划一套电商袜子设计，包含主图、详情页和SKU',
            parameters: { deliverables: ['main-image', 'detail-page', 'sku'] }
        }
    ],
    estimatedTime: 3,
    hasDecisionPoints: true
};

export const MainImageSkill: SkillDeclaration = {
    id: 'main-image-design',
    name: 'Main Image Design',
    displayName: '主图设计',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    visualSamplingScenario: 'main-image',
    // 治理审计(2026-07-01)阶段3a：与 detail-page-design 统一路由方式——受控路由命中且有明确
    // 执行授权（isProjectContextMainImageDeliveryIntent 等）时交给 Agent 自主循环，main-image-design
    // 作为循环内可选技能工具（白底图/尺寸导出流水线能力仍在），不再由引擎在弱授权之外也直接短路。
    controlledRouteEntry: 'autonomous-react-loop',
    routeClass: 'business-workflow',
    // 模型路由不得直执：主图生产必须经 Agent 自主 ReAct 循环（看素材/看文档/逐步推进）。
    modelDirectExecution: 'forbidden',
    description: 'Spec-driven e-commerce main-image production: white-background images from SKU material, click/conversion documents, multi-size (800/750/1200) export. NOT for open creative main-image design — that goes through the autonomous design loop.',
    whenToUse: [
        'User asks for a white background image (白底图)',
        'User asks for a click image or conversion image with e-commerce spec rules',
        'User asks to export main images in standard sizes (800/750/1200) from SKU/project material'
    ],
    whenNotToUse: [
        'User asks for detail page generation',
        '用户要的是创意主图设计（用模特图/场景图做主视觉、按设计方向从零创作）——交给自主设计循环真实创作，不要套规格化生产流程'
    ],
    routing: {
        // 只在明确的规格化生产术语上触发；宽泛的「主图」不再独占——「做主图/设计主图/
        // 用模特图做主视觉」是创意设计意图，应落到自主循环真实设计而非规格化脚本。
        // 白底图含省略写法「白底」与错别字「自底图/自底」（SKU 素材白底图生产），一并覆盖。
        intentSignals: ['白底图', '白底', '自底图', '自底', '点击图', '转化图', 'white background', 'white-bg'],
        negativeSignals: ['详情页', '详情页模板', '项目图片分析'],
        preconditions: ['通常需要当前文档或主图素材'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 size、sizes、imageType、sourceAssetKind、outputDirPolicy、preferredStyle、backgroundPrompt、outputDir；未显式指定 size/sizes 时默认规划 800/750/1200 三规格；普通主图交付包含点击图和转化图规则，1200 只出点击图不出转化图；白底图能力定义为 main-image.white-bg-from-sku-material：sourceAssetKind=project-sku-material、outputDirPolicy=project-main-image-dir、PSD/SKU.psb -> 主图/白底.jpg；用户只是讨论、询问或规划时保持 strategy-only；用户明确要求用 SKU 素材生成/导出/保存白底图到主图目录时，可进入 product-disposable-live 并使用白底图专用工具；不要从 outputDir、selectedAsset、enableVisionPreflight 单独推断真实 Photoshop 写入；用户明确要求理解/分析所选项目图时可设置 enableVisionPreflight=true；不要默认批量分析项目图片，maxVisionCandidates 默认 1'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果用户同时提到模板和现有主图优化，先问是新建模板还是处理当前画面'],
        decisionGuidance: [
            '如果用户是在处理现有主图的优化、导出或排版，使用这个 skill，而不是模板创建 skill。',
            '普通“做主图”默认规划 800/750/1200 三个交付文档，不要退化成单 800 点击图。',
            '1200/9:16 只允许点击图，不能生成转化图；白底图是 SKU 源文件导出，不从点击图或转化图裁切。',
            '先判断用户是在询问/规划还是明确要求生成文件；工具边界负责限制写入范围，不要用固定规则禁止模型根据任务选择工具。',
            '普通创意主图请求默认先形成策略和设计计划；明确的 SKU 白底图导出请求属于确定性素材生产，可使用 product-disposable-live 白底图专用工具。'
        ],
        routeStatusMessages: {
            deterministic: '判断主图任务类型、素材来源和执行边界，再选择规划或受控导出路径。',
            autonomous: '查看当前画面、图层和素材后规划主图。'
        }
    },
    parameters: [
        strParam('size', 'Output size preset', false, {
            enum: ['800', '750', '1200', 'custom']
        }),
        objParam('customSize', 'Custom size object {width,height}'),
        numParam('productScale', 'Subject scale ratio', false, { default: 0.65 }),
        numParam('verticalOffset', 'Vertical offset ratio', false, { default: -0.03 }),
        strParam('outputDir', 'Output directory'),
        strParam('imageType', 'Main image type', false, {
            enum: ['click', 'conversion', 'white-bg']
        }),
        strParam('sourceAssetKind', 'Main-image source asset boundary', false, {
            enum: ['project-sku-material', 'selected-project-image', 'active-document']
        }),
        strParam('outputDirPolicy', 'Main-image output directory policy', false, {
            enum: ['project-main-image-dir', 'explicit-output-dir']
        }),
        strParam('mainImageCapability', 'Stable main-image business capability id'),
        strParam('whiteBackgroundSourceDocumentPath', 'White background source document path'),
        strParam('whiteBackgroundOutputRelativePath', 'White background export relative path'),
        arrParam('sizes', 'Batch output sizes list'),
        strParam('preferredStyle', 'Preferred style', false, {
            enum: ['minimal', 'rich', 'elegant', 'bold'],
            default: 'minimal'
        }),
        strParam('mainImageExecutionMode', 'Controlled execution mode for the main-image executor', false, {
            enum: ['strategy-only', 'product-disposable-live'],
            default: 'strategy-only'
        }),
        strParam('executionScope', 'Controlled Photoshop execution scope', false, {
            enum: ['disposable-document', 'active-document', 'project-document'],
            default: 'disposable-document'
        }),
        boolParam('approvedLiveExecution', 'Explicit approval to run the disposable live executor', false),
        boolParam('approvedLiveAdapterRun', 'Explicit approval to connect the guarded Photoshop adapter', false),
        boolParam('enableVisionPreflight', 'Explicitly analyze the selected project image before main-image planning; default false to avoid hidden model cost', false),
        numParam('maxVisionCandidates', 'Maximum project-image candidates to analyze when enableVisionPreflight is true; capped by executor, default 1', false, { default: 1 }),
        strParam('backgroundPrompt', 'Optional AI background prompt'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'files',
        description: 'Main-image production plan and, after explicit live approval, exported main-image files.'
    },
    requiredTools: ['getSubjectBounds', 'smartLayout', 'transformLayer', 'moveLayer', 'quickExport'],
    examples: [
        {
            userSays: '帮我做主图',
            parameters: { sizes: ['800', '750', '1200'], mainImageExecutionMode: 'strategy-only' }
        },
        {
            userSays: '做一张 800 点击图',
            parameters: { size: '800', imageType: 'click', mainImageExecutionMode: 'strategy-only' }
        },
        {
            userSays: '帮我做白底图',
            parameters: {
                imageType: 'white-bg',
                sourceAssetKind: 'project-sku-material',
                outputDirPolicy: 'project-main-image-dir',
                mainImageExecutionMode: 'strategy-only'
            }
        },
        {
            userSays: '帮我使用SKU素材做白底图导出到主图目录下',
            parameters: {
                imageType: 'white-bg',
                sourceAssetKind: 'project-sku-material',
                outputDirPolicy: 'project-main-image-dir',
                mainImageCapability: 'main-image.white-bg-from-sku-material',
                mainImageExecutionMode: 'product-disposable-live',
                executionScope: 'disposable-document',
                approvedLiveExecution: true,
                approvedLiveAdapterRun: true
            }
        }
    ],
    estimatedTime: 10,
    hasDecisionPoints: false
};

export const DetailPageDesignSkill: SkillDeclaration = {
    id: 'detail-page-design',
    name: 'Detail Page Design',
    displayName: '详情页设计',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    visualSamplingScenario: 'detail-page',
    // 详情页（含模板套版）不再内嵌固定流水线：受控路由命中也交给 Agent 自主循环，
    // detail-page-design 作为循环内可选技能工具（模板解析/填充能力仍在），不由引擎直执脚本。
    controlledRouteEntry: 'autonomous-react-loop',
    routeClass: 'business-workflow',
    // 模型路由不得直执：详情页设计必须经 Agent 自主 ReAct 循环（先看图后规划的视觉观察纪律在循环内强制）。
    modelDirectExecution: 'forbidden',
    description: '项目级详情页设计任务说明：先摸索项目、读取素材和当前文档，再判断走模板套版还是纯设计；模板优先但不是硬前提，复核未通过时调整策略后继续推进。',
    whenToUse: [
        '用户只说“做详情页 / 设计详情页 / 生成详情页 / 整理详情页”时，先进入本 Skill 的项目级 Agent 循环，不要先要求用户指定模板路径。',
        '项目或当前 Photoshop 文档里可能有详情页模板时，优先检查并理解模板，再决定是否套版。',
        '用户明确要求检查、解析、填充、替换内容或导出现有详情页模板/文档时，使用模板套版路径。套版两条纪律：版式主权（用户模板的占位框位置/尺寸/样式一律不动，只换文案与图片，版式问题报告用户不擅自改）；内容发挥（文案基于素材中可读取的卖点事实、市场洞察和文案框架撰写，选图按构图字段择优，不机械照抄占位符示意原文）。',
        '没有模板、模板不可用或用户要求纯设计时，继续走从零设计路径：理解素材、提炼卖点、规划阶段、创建画布、排版、观察、调整和复核。'
    ],
    whenNotToUse: [
        'User asks only single-layer manual edit',
        'User asks only to save/export the currently open document without changing detail-page content',
        'User asks for matting, background removal, or unrelated Photoshop maintenance work'
    ],
    routing: {
        intentSignals: ['详情页', '长图', '卖点页', '参数页', '面料页', 'detail page'],
        // 详情页 Skill 是任务说明书，不是模板解析器。模板是优先路径，找不到模板仍可继续纯设计。
        negativeSignals: ['保存文档', '保存当前文档', '保存到项目', '保存为 PSD', '保存PSD', '存一下', '保存一下', '导出当前文档', '当前文档导出', '文档导出', '详情页文档导出', '导出为 PNG', '导出PNG', '导出成PNG', '导出为 JPG', '导出JPG', '导出成JPG', '导出为 PDF', '导出PDF', '导出成PDF', 'save document', 'save psd', 'export document', 'export png', 'export jpg', 'export pdf', '仅改单个图层'],
        preconditions: ['需要能读取项目资源、当前 Photoshop 文档或用户提供素材中的至少一种上下文；找不到模板不是阻塞项，而是进入从零设计路径。'],
        supportedModes: ['inspect', 'execute'],
        modeSignals: {
            inspect: ['结构', '模板', '分析', '检查', '看一下', '可以吗', 'structure', 'analyze', 'inspect', 'review'],
            execute: ['设计', '填充', '生成', '制作', '整理', '处理', '导出', '出图', '排版', '换图', 'design', 'fill', 'generate', 'export']
        },
        parameterExtractionHints: ['抽取 inspectOnly、autoFix、structureMode、visualValidation、projectPath、outputDir'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['只有在项目和当前文档都无法提供素材、模板或产品信息时，才询问用户补充素材或项目路径。'],
        decisionGuidance: [
            '先形成阶段判断：项目摸索、模板判断、素材理解、执行路径、结果复核。',
            '循环推进时先判断当前是模板套版、模板修复后套版，还是无模板从零设计；再处理项目、视觉分析、预览或 Photoshop 画面，随后读回结果并判断是否达到当前阶段目标。',
            '模板优先：若项目或当前文档里有可理解的详情页模板，先读取完整图层关系、文案框、图片占位符、icon、矩形占位符和屏组结构，再套版。',
            '套版时只替换内容并检查标准：文案尽可能控制在原文字数/字符数附近，不主动改变字体、字号、位置和间距；模板不规范不是失败理由，设计助手应基于图层关系继续理解并必要时优化改善。',
            '图片置入时要基于用户或项目摄影图理解卖点，选择合适图片放入占位符，建立剪切蒙版，并根据版式气质调整缩放、裁切和主体位置。',
            '没有模板、模板不可用或用户要求纯设计时，继续从零设计：读取设计方法论和参考，理解素材，提炼卖点，创建详情页画布，按阶段渲染草稿，截图复核并调整。',
            '结果复核未通过时，不输出硬成功；分析失败原因、定位问题阶段、生成下一轮约束，再继续处理。'
        ],
        routeStatusMessages: {
            deterministic: '先摸索项目、模板和素材，再判断详情页走套版还是从零设计。',
            autonomous: '进入详情页设计循环，边观察项目内容边推进设计。'
        }
    },
    parameters: [
        strParam('agentMode', 'Bounded Agent handoff mode for detail-page work', false, {
            enum: ['auto', 'inspect', 'execute', 'export'],
            default: 'auto'
        }),
        strParam('reviewPolicy', 'Post-execution review policy for Agent handoff', false, {
            enum: ['review_required', 'stop_on_blocker'],
            default: 'review_required'
        }),
        strParam('projectPath', 'Project path for assets and export'),
        strParam('outputDir', 'Export directory'),
        boolParam('inspectOnly', 'Only inspect current detail-page structure without filling', false),
        boolParam('autoFix', 'Auto-fix detected layer issues', true),
        strParam('structureMode', 'Structure constraint mode', false, {
            enum: ['inspect', 'guided', 'strict', 'ignore'],
            default: 'guided'
        }),
        boolParam('visualValidation', 'Enable visual quality validation', true),
        boolParam('aiCopyGeneration', 'Generate copy when no knowledge hit', true),
        boolParam('copyReview', 'Enable copy review', true),
        numParam('copyMinScore', 'Copy quality minimum score threshold (0-1)', false, { default: 0.72 }),
        numParam('copyCandidateCount', 'Fallback candidate count for low-score copy', false, { default: 3 }),
        strParam('copyCreativeStyle', 'Copy creative style preference', false, {
            enum: ['natural', 'playful', 'professional'],
            default: 'natural'
        }),
        strParam('lowScoreCopyStrategy', 'Low-score copy handling strategy', false, {
            enum: ['replace', 'flag', 'keep'],
            default: 'replace'
        }),
        boolParam('copyLayoutFit', 'Enable layout-aware copy fitting', true),
        strParam('copyLineBreakStyle', 'Line break style for copy fitting', false, {
            enum: ['balanced', 'compact'],
            default: 'balanced'
        }),
        numParam('copyTitleMaxLines', 'Max lines for title copy', false, { default: 2 }),
        numParam('copySubtitleMaxLines', 'Max lines for subtitle copy', false, { default: 2 }),
        numParam('copyBodyMaxLines', 'Max lines for body copy', false, { default: 3 }),
        boolParam('copyOnly', 'Only optimize or fill copy and keep existing images', false),
        boolParam('planGuard', 'Guard low-confidence plans to avoid risky image replacement', false),
        boolParam('allowLowConfidenceFill', 'Allow low-confidence plans to fill images directly', true),
        numParam('minPlanConfidence', 'Minimum plan score threshold (0-1)', false, { default: 0.62 }),
        numParam('minImageCoverage', 'Minimum matched-image coverage threshold (0-1)', false, { default: 0.6 }),
        strParam('brandTone', 'Brand tone', false, {
            default: 'professional',
            examples: ['professional', 'playful', 'luxury', 'casual']
        }),
        strParam('exportFormat', 'Export format', false, {
            enum: ['jpeg', 'png'],
            default: 'jpeg'
        }),
        numParam('exportQuality', 'JPEG export quality 1-12', false, { default: 10 }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'files',
        description: 'Exported detail page slices.'
    },
    requiredTools: [
        'listProjectResources',
        'searchProjectResources',
        'analyzeAssetContent',
        'getDetailPageDesignFramework',
        'parseDetailPageTemplate',
        'detectLayerIssues',
        'fixLayerIssues',
        'matchDetailPageContent',
        'fillDetailPage',
        'createDocument',
        'renderLayout',
        'placeImage',
        'setTextContent',
        'setTextStyle',
        'getCanvasSnapshot',
        'exportDetailPageSlices'
    ],
    examples: [
        {
            userSays: '帮我做详情页',
            parameters: { agentMode: 'auto', autoFix: true, structureMode: 'guided' }
        },
        {
            userSays: '用当前详情页模板套版并导出',
            parameters: { agentMode: 'execute', autoFix: true, structureMode: 'guided' }
        }
    ],
    estimatedTime: 30,
    hasDecisionPoints: true
};

export const AutonomousAgentSkill: SkillDeclaration = {
    id: 'autonomous-agent',
    name: '自主智能体',
    displayName: '自主设计执行',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'system-only',
    routeClass: 'open-design',
    visualSamplingScenario: 'general-design',
    description: '自主处理复杂多步任务：观察真实结果、选择下一步动作，并在未达成目标时调整策略继续推进。',
    whenToUse: [
        'Complex tasks requiring multiple observed actions and reasoning',
        'User explicitly requests autonomous or fully-automatic mode',
        'Tasks that span observation, analysis, and execution phases'
    ],
    parameters: [
        strParam('userTask', 'The task description from user', true),
        strParam('modelId', 'Override model ID for agent'),
        numParam('maxIterations', 'Max autonomous loop iterations', false, { default: 25 }),
    ],
    output: {
        type: 'data',
        description: 'Agent execution result with tool call log'
    },
    requiredTools: [],
    examples: [
        {
            userSays: '分析当前文档结构并撰写文案',
            parameters: { userTask: '分析当前文档结构并撰写文案' }
        }
    ],
    estimatedTime: 60
};

export const SKILL_REGISTRY: SkillDeclaration[] = [
    MatteProductSkill,
    SmartLayoutSkill,
    SKUConfigSkill,
    SKUColorCardSkill,
    SKUBatchSkill,
    ShapeMorphingSkill,
    LayoutReplicationSkill,
    DesignReferenceSearchSkill,
    VisualAnalysisSkill,
    ProjectImageAnalysisSkill,
    LayerManagementSkill,
    FindEditElementSkill,
    AgentPanelBridgeSkill,
    DocumentManagementSkill,
    SaveCurrentTemplateSkill,
    TextFontReplaceSkill,
    EcommerceSocksDesignSkill,
    MainImageSkill,
    DetailPageDesignSkill,
    AutonomousAgentSkill
];

export function getSkillById(id: string): SkillDeclaration | undefined {
    return SKILL_REGISTRY.find((s) => s.id === id);
}

export function getSkillsByCategory(category: string): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((s) => s.category === category);
}

/**
 * 该技能在受控技能路由命中后是否应交给 Agent 自主 ReAct 循环（而非引擎直执固定流水线）。
 * 单一声明来源：SkillDeclaration.controlledRouteEntry === 'autonomous-react-loop'。
 */
export function isControlledRouteAutonomousEntrySkill(id: string): boolean {
    return getSkillById(id)?.controlledRouteEntry === 'autonomous-react-loop';
}

/** 全部声明为「受控路由命中→自主循环」的技能 id（声明式派生，供路由/收敛复用）。 */
export function getControlledRouteAutonomousEntrySkillIds(): string[] {
    return SKILL_REGISTRY
        .filter((s) => s.controlledRouteEntry === 'autonomous-react-loop')
        .map((s) => s.id);
}

/**
 * 该技能是否禁止模型路由直接执行（必须经 Agent 自主 ReAct 循环）。
 * 单一声明来源：SkillDeclaration.modelDirectExecution === 'forbidden'。
 * 这是护栏不是脚本：消费点是 engine 的 isModelSkillExecutionCompatibleWithIntentBoundary
 *（替代原硬编码 CREATIVE_DRAFT_CONTROLLED_SKILL_DENYLIST Set）。
 */
export function isModelDirectExecutionForbiddenSkill(id: string): boolean {
    return getSkillById(id)?.modelDirectExecution === 'forbidden';
}

/** 全部声明为「模型路由不得直执」的技能 id（声明式派生，供护栏/smoke 校验复用）。 */
export function getModelDirectExecutionForbiddenSkillIds(): string[] {
    return SKILL_REGISTRY
        .filter((s) => s.modelDirectExecution === 'forbidden')
        .map((s) => s.id);
}

export function getUserFacingSkills(): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((skill) => skill.visibility === 'user-facing');
}

export function getInternalDebugSkills(): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((skill) => skill.visibility === 'internal-debug');
}

export function getSkillVisibility(id: string) {
    return getSkillById(id)?.visibility;
}
