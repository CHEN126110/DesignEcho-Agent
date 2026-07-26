export type PhotoshopToolSemanticId =
    | 'text-layer-create'
    | 'text-content-edit'
    | 'text-style-edit'
    | 'text-layout-bounds'
    | 'layer-position-edit'
    | 'layer-order-edit'
    | 'layer-parent-group-edit'
    | 'layer-focus-feedback'
    | 'image-layer-place'
    | 'shape-layer-create'
    | 'basic-layer-style'
    | 'sku-template-layout'
    | 'sku-placeholder-authoring'
    | 'sku-combo-config-parse'
    | 'template-document-open';

export type PhotoshopToolSemanticMaturity = 'mvp' | 'planned';

export type PhotoshopToolSemanticCategory =
    | 'text'
    | 'selection'
    | 'transform'
    | 'layer-style'
    | 'mask'
    | 'shape'
    | 'image-placement'
    | 'sku-batch'
    | 'document';

export interface PhotoshopToolSemanticParameter {
    name: string;
    unit?: string;
    required: boolean;
    meaning: string;
    failureModes: string[];
}

export interface PhotoshopToolSemanticAcceptance {
    checks: string[];
    pass: string[];
    needsReview: string[];
    fail: string[];
}

export interface PhotoshopToolSemantic {
    id: PhotoshopToolSemanticId;
    category: PhotoshopToolSemanticCategory;
    zhName: string;
    maturity: PhotoshopToolSemanticMaturity;
    intentSignals: string[];
    photoshopTools: string[];
    dependsOnTools: string[];
    designSemantics: string[];
    parameters: PhotoshopToolSemanticParameter[];
    punctuationAndLineBreakRules?: string[];
    commonFailureModes: string[];
    acceptance: PhotoshopToolSemanticAcceptance;
    benchmarkNeeds: string[];
    notSolvedByThis: string[];
}

export const PHOTOSHOP_TOOL_SEMANTICS: PhotoshopToolSemantic[] = [
    {
        id: 'text-layer-create',
        category: 'text',
        zhName: '创建可编辑文本图层',
        maturity: 'mvp',
        intentSignals: ['添加文字', '新建标题', '复刻文字', '创建文案层', '生成可编辑文本'],
        photoshopTools: ['createTextLayer'],
        dependsOnTools: ['resolveFontName', 'getLayerBounds', 'moveLayer', 'getAcceptanceSnapshot'],
        designSemantics: [
            '用户看到的是文字视觉外接框，Photoshop 创建文本时通常使用文本基线或文本框锚点，二者不是同一个坐标。',
            '标题、字段、正文、价格和标签文案的字号、字重、对齐和安全区规则不同。',
            '创建后必须读取真实 bounds；不能只相信 createTextLayer 的入参位置。'
        ],
        parameters: [
            {
                name: 'content',
                required: true,
                meaning: '文本内容，必须保留用户或参考图中的中文、英文、数字和符号。',
                failureModes: ['空内容会创建无意义图层', 'OCR 或模型改写会导致参考图复刻失真']
            },
            {
                name: 'x/y',
                unit: 'px',
                required: true,
                meaning: 'Photoshop 文本创建初始位置，不等价于视觉外接框左上角。',
                failureModes: ['把视觉左上角直接当基线会导致文字整体偏移', '画布尺寸不一致会放大坐标误差']
            },
            {
                name: 'fontSize',
                unit: 'pt/px-like',
                required: true,
                meaning: 'Photoshop 字号参数；实际黑色像素高度受字体字形和渲染影响。',
                failureModes: ['同字号不同字体视觉高度不同', '只按参考图黑色像素高度估算可能偏大或偏小']
            },
            {
                name: 'colorHex',
                required: false,
                meaning: '文字颜色，参考图复刻时应来自视觉解析或样式 recipe。',
                failureModes: ['颜色缺失会退回默认黑色', '低对比颜色可能导致可读性差']
            },
            {
                name: 'tracking / leading / alignment',
                required: false,
                meaning: '创建文字时可同步写入字距、行高和段落对齐，减少创建后再补 setTextStyle 的工具调用。',
                failureModes: ['参考图解析缺失会导致默认排版', '实际渲染仍需通过 after snapshot 和 bounds 复核']
            }
        ],
        punctuationAndLineBreakRules: [
            '创建文本层时不得改写冒号、斜杠、连字符、百分号和空格。',
            '参考图中的手动换行应保留为换行符，不应合并成一行。'
        ],
        commonFailureModes: [
            '创建成功但 bounds 偏离目标视觉框。',
            '字体 fallback 导致实际宽度与参考图不同。',
            '文本内容被模型补全、删减或翻译。'
        ],
        acceptance: {
            checks: ['after snapshot text.content', 'after snapshot text.style', 'after layer bounds', 'text layer kind', 'optional overlay bounds'],
            pass: ['文本图层存在', '内容完全匹配', '可读的字号/字距/行高参数匹配', '实际 bounds 在阈值内'],
            needsReview: ['bounds 轻微偏差', '字体名称未知或 fallback', '缺少 overlay 画面'],
            fail: ['未创建文本图层', '内容不匹配', '实际 bounds 严重偏移']
        },
        benchmarkNeeds: ['单行标题', '左右列字段', '长句参数', '多行中文段落', '价格和促销文案'],
        notSolvedByThis: ['不解决字体授权安装', '不判断最终审美质量', '不还原原作者真实 PSD 文本框']
    },
    {
        id: 'text-content-edit',
        category: 'text',
        zhName: '修改文本内容',
        maturity: 'mvp',
        intentSignals: ['改文案', '替换文字', '把文字改成', '优化文案', '删除多余文字'],
        photoshopTools: ['setTextContent'],
        dependsOnTools: ['getAcceptanceSnapshot', 'getTextContent'],
        designSemantics: [
            '文本内容修改不是简单字符串替换；必须考虑原图层是否多行、是否包含手动换行和标点。',
            '电商参数、合格证、SKU 文字要求准确性优先，不能自由润色。',
            '营销标题可以重新撰写表达，但需要保持版面长度和换行约束。'
        ],
        parameters: [
            {
                name: 'layerId / layerName / updates',
                required: true,
                meaning: '明确目标文本图层或批量更新列表。',
                failureModes: ['隐式目标不明确会改错图层', '批量目标缺失会导致部分成功被误报']
            },
            {
                name: 'content',
                required: true,
                meaning: '目标文本内容，必须区分用户要求的准确替换和模型建议的文案撰写。',
                failureModes: ['把参数类文本改写成营销文案', '丢失换行和标点']
            }
        ],
        punctuationAndLineBreakRules: [
            '参数类文本必须保留冒号、斜杠、连字符、百分号、数字和单位。',
            '多行文本需要比较 LF 归一化后的内容，但不能忽略真实换行差异。',
            '中文标点和英文标点不能无理由互换。'
        ],
        commonFailureModes: [
            '工具返回成功但目标图层文本未变化。',
            '只改了部分批量更新项。',
            '换行被压成一行导致版面溢出。'
        ],
        acceptance: {
            checks: ['before/after text.content', 'target layer id list', 'diff textChanged count'],
            pass: ['显式目标内容全部匹配', '换行归一化后仍符合预期'],
            needsReview: ['目标来自当前选中图层且多选不明确', '内容匹配但视觉溢出未验证'],
            fail: ['显式目标不存在', '目标不是文本层', 'after 内容不匹配']
        },
        benchmarkNeeds: ['批量文字替换', '多行中文替换', '带标点参数替换', '空格和全半角保持'],
        notSolvedByThis: ['不自动判断文案好坏', '不替代文案模型生成', '不保证文本框自动适配']
    },
    {
        id: 'text-style-edit',
        category: 'text',
        zhName: '修改字体与文字样式',
        maturity: 'mvp',
        intentSignals: ['改字体', '改字号', '加粗', '调整字距', '改颜色', '统一字体'],
        photoshopTools: ['setTextStyle'],
        dependsOnTools: ['resolveFontName', 'getAcceptanceSnapshot', 'getTextStyle', 'getLayerBounds'],
        designSemantics: [
            '字体显示名、PostScript 名、字体族和中文别名需要映射；不能把用户说的字体名直接等同于 Photoshop 可用字体名。',
            '字号变化会影响实际 bounds、行距和换行，需要和几何验收联动。',
            '字体统一任务要求准确性，参考图复刻任务要求视觉相似，二者验收口径不同。'
        ],
        parameters: [
            {
                name: 'fontName',
                required: false,
                meaning: '用户或模型期望的字体名，可能是显示名、别名或 PostScript 名。',
                failureModes: ['系统未安装字体', 'Photoshop 使用替代字体', '中文名和 PostScript 名不一致']
            },
            {
                name: 'fontSize',
                unit: 'pt/px-like',
                required: false,
                meaning: 'Photoshop 字号；需要结合实际 bounds 验证视觉尺寸。',
                failureModes: ['字号参数已写入但视觉高度不符合参考图', '字号变化导致换行或溢出']
            },
            {
                name: 'tracking / leading / alignment',
                required: false,
                meaning: '字距、行距和对齐等排版细节；tracking/leading 已有写后读回，alignment 仍需要结合 bounds 或视觉验收。',
                failureModes: ['工具不支持的字段被静默忽略', 'alignment 写入后缺少段落级 readback']
            }
        ],
        punctuationAndLineBreakRules: [
            '样式修改不应改变文本内容和换行。',
            '调整字距和字号后要复核标点附近的视觉间距。'
        ],
        commonFailureModes: [
            '字体名看似匹配但 Photoshop 实际使用 fallback。',
            '字号断言通过但实际视觉宽度偏离。',
            '样式工具不支持的字段被当作已完成。'
        ],
        acceptance: {
            checks: ['after text.fontName', 'after text.fontSize', 'after layer bounds', 'font assertion summary'],
            pass: ['显式目标字体或字号匹配', '文本内容未被意外改变'],
            needsReview: ['字体名只能规范化匹配', '字体解析成功但写入未验证', '字号匹配但 bounds 明显变化', 'alignment 尚无真实 after 字段'],
            fail: ['显式目标不存在', 'after 字体或字号不匹配', '工具返回失败']
        },
        benchmarkNeeds: ['统一中文字体', '缺失字体反馈', '字号调整', '字距/行距规划 case', '中英混排字体'],
        notSolvedByThis: ['不负责安装字体', '不保证字体授权', '不把规范化名称匹配当成字形完全一致']
    },
    {
        id: 'text-layout-bounds',
        category: 'text',
        zhName: '文本排版与视觉边界',
        maturity: 'mvp',
        intentSignals: ['对齐文字', '调整换行', '排版文本', '参考图文字位置', '文字放这里'],
        photoshopTools: ['getLayerBounds', 'moveLayer'],
        dependsOnTools: ['createTextLayer', 'setTextContent', 'setTextStyle', 'getAcceptanceSnapshot'],
        designSemantics: [
            '文本排版需要同时理解计划视觉框、实际图层 bounds、文本框、基线和安全区。',
            '参考图复刻里，模型输出的 position/size 应视为视觉外接框，不是文本锚点。',
            'bounds-only 可以证明几何接近，但不能证明字体字形、像素相似度或审美质量。'
        ],
        parameters: [
            {
                name: 'plannedBox',
                unit: 'px',
                required: true,
                meaning: '设计或参考图期望的文字视觉外接框。',
                failureModes: ['模型用整行区域代替黑色像素框', '画布尺寸不一致导致比例错误']
            },
            {
                name: 'actualBounds',
                unit: 'px',
                required: true,
                meaning: 'Photoshop 创建或修改后的真实图层 bounds。',
                failureModes: ['读取失败时无法证明落位', 'effects bounds 和 noEffects bounds 混用']
            },
            {
                name: 'tolerancePx',
                unit: 'px',
                required: false,
                meaning: '几何验收容差；应按画布尺寸和任务类型设定。',
                failureModes: ['阈值过宽会掩盖偏移', '阈值过窄会把字体字形差异误判成坐标失败']
            }
        ],
        punctuationAndLineBreakRules: [
            '换行会改变 bounds，不能只比较字符串内容。',
            '长句文本需要同时验收内容、换行和右边界。'
        ],
        commonFailureModes: [
            '内容正确但换行错误。',
            '位置正确但字体 fallback 导致宽度不一致。',
            'bounds 接近但截图视觉不相似。'
        ],
        acceptance: {
            checks: ['plannedBox', 'actualBounds', 'IoU / edge delta / center offset', 'optional overlay screenshot'],
            pass: ['实际 bounds 在阈值内', '内容和主要样式已通过'],
            needsReview: ['轻微宽度差异可能来自字体字形', '只有 bounds 数据，没有结果截图'],
            fail: ['缺少 actualBounds', '偏移超过阈值', '换行导致文本溢出']
        },
        benchmarkNeeds: ['左右列文本排版', '多行详情页正文', '促销价格与角标', '按钮文字居中', '长中文句子右边界'],
        notSolvedByThis: ['不等于截图级视觉相似度', '不判断文案创意质量', '不自动修复字体缺失']
    },
    {
        id: 'layer-position-edit',
        category: 'transform',
        zhName: '图层移动、对齐与基础变换',
        maturity: 'mvp',
        intentSignals: ['移动图层', '对齐', '居中', '放大一点', '缩小一点', '调整位置', '自由变换'],
        photoshopTools: ['moveLayer', 'alignLayers', 'transformLayer', 'quickScale'],
        dependsOnTools: ['getLayerBounds', 'getAcceptanceSnapshot', 'getDocumentInfo'],
        designSemantics: [
            '位置调整必须区分绝对坐标、相对位移、画布安全区、参考元素和当前选区；不能只根据用户一句“居中”盲目移动。',
            '视觉上“合适大小”通常来自目标容器、主体占比、留白和相邻元素关系，不等于固定百分比缩放。',
            '想把图层“缩放到指定区域”时，优先给 transformLayer 传 targetBounds+targetFit 一次完成缩放和落位；不要先读 bounds 再手算相对百分比，这种链路容易累计误差。',
            '移动或缩放后需要读取真实 bounds；工具返回成功不代表视觉重心、间距或安全区已经正确。'
        ],
        parameters: [
            {
                name: 'layerId',
                required: false,
                meaning: '目标图层；缺省时通常依赖当前选中图层。transformLayer 支持 layerId，知道目标层时必须显式传入。',
                failureModes: ['当前选区不明确会移动/变换错图层', '多选时只验证单个图层会产生假成功']
            },
            {
                name: 'x/y',
                unit: 'px',
                required: false,
                meaning: '目标坐标或相对位移，必须结合 relative 判断。',
                failureModes: ['把相对位移当绝对坐标', '坐标没有按当前画布尺寸缩放']
            },
            {
                name: 'alignment',
                required: false,
                meaning: '对齐方向；需要知道对齐到画布还是参考图层（alignTo 只支持 canvas/firstLayer，对齐到选区暂不支持——UXP 执行器的 align 描述符只区分 alignToCanvas，传 selection 会静默按首图层对齐）。Agent 侧参数名 alignment 由归一化器映射为 UXP 端必填的 alignType，两名兼容。',
                failureModes: ['只传 left/center 却没有明确参照物', '对齐后破坏原本的网格或视觉节奏', '传出六个合法枚举（left/center/right/top/middle/bottom）以外的值不会被映射，执行端会失败', '误以为支持对齐到选区（alignTo=selection）——该能力暂不支持']
            },
            {
                name: 'scaleUniform / scaleX / scaleY / percent',
                unit: '%',
                required: false,
                meaning: '相对当前尺寸的百分比缩放；应来自目标框、主体占比或用户明确要求。scaleX/scaleY 支持非等比缩放。',
                failureModes: ['固定百分比导致主体过大或过小', '缩放后没有复核 bounds 和清晰度', '与 targetBounds 同时传会被执行端拒绝']
            },
            {
                name: 'targetBounds / targetFit',
                unit: 'px',
                required: false,
                meaning: '目标尺寸表达：把图层缩放并移动到指定区域，支持 {x,y,width,height} 或 {left,top,right,bottom}；targetFit 取 contain（默认）/cover/fill。',
                failureModes: ['宽高非正数或字段缺失会被执行端明确拒绝', '与 scaleUniform/scale/fitToCanvas/fitPercentage 互斥', 'cover/fill 可能裁掉或拉伸主体，需要结合主体占比判断']
            }
        ],
        commonFailureModes: [
            '目标图层不明确导致移动当前选中层而非用户指向层。',
            '对齐工具成功但参照物错误。',
            '缩放比例看似执行成功但实际主体占比不符合设计目标。',
            '先读 bounds 手算百分比再缩放，多步误差叠加导致最终尺寸偏离目标框。'
        ],
        acceptance: {
            checks: ['before/after layer bounds', 'target layer id', 'alignment or transform params', 'targetBounds/targetFit params', 'optional plannedBox'],
            pass: ['目标图层明确', 'after bounds 符合计划坐标或计划框', '带 targetBounds 时 after bounds 尺寸/落位偏差 ≤ max(2px,1%)', '未出现未解释的画布越界'],
            needsReview: ['依赖当前选区', '只有工具成功消息但缺少 plannedBox', '缩放后缺少结果截图'],
            fail: ['显式目标图层不存在', 'after bounds 未变化或偏差过大', '带 targetBounds 时尺寸偏差超过 max(2px,1%)', '移动到了画布外']
        },
        benchmarkNeeds: ['单图层绝对移动', '相对位移', '画布居中', '目标框缩放', '参考图主体落位'],
        notSolvedByThis: ['不自动判断审美最优构图', '不替代 Grid DSL', '不证明像素级视觉相似']
    },
    {
        id: 'layer-order-edit',
        category: 'transform',
        zhName: '图层堆叠顺序调整',
        maturity: 'mvp',
        intentSignals: ['图层顺序', '图层层级', '置顶', '置底', '上移一层', '下移一层', '从浅到深', '从深到浅'],
        photoshopTools: ['reorderLayer'],
        dependsOnTools: ['getLayerHierarchy', 'getAcceptanceSnapshot'],
        designSemantics: [
            '图层堆叠顺序是 Photoshop layer stack 的前后层级，不是画布 x/y 位置。',
            'moveLayer 只用于空间移动；用户说“调整图层顺序、置顶、置底、上移、下移”时应使用 reorderLayer。',
            '按颜色深浅排序这类任务应先读取层级和图层名，计算目标顺序，再逐层 reorderLayer，最后重新读取层级验证。'
        ],
        parameters: [
            {
                name: 'action',
                required: true,
                meaning: '排序动作：up/down/top/bottom/above/below。',
                failureModes: ['把 action 缺省为位置移动', 'above/below 缺少 targetLayerId']
            },
            {
                name: 'layerId',
                required: false,
                meaning: '要调整层级的图层；缺省时依赖当前选中图层。',
                failureModes: ['当前选区不明确导致调整错图层', '同名图层未先用 ID 消歧']
            },
            {
                name: 'targetLayerId',
                required: false,
                meaning: 'above/below 的目标图层 ID。',
                failureModes: ['目标层 ID 过期', '跨组移动时目标层不在同一可排序上下文']
            }
        ],
        commonFailureModes: [
            '误用 moveLayer，导致图层被移动到画布其他位置而不是调整层级。',
            '只选择图层但没有执行 reorderLayer。',
            '执行后没有重新读取层级，无法证明顺序已改变。'
        ],
        acceptance: {
            checks: ['before/after layer hierarchy', 'target layer id', 'reorderLayer action', 'targetLayerId for above/below'],
            pass: ['目标图层 ID 明确', 'after hierarchy 顺序符合目标', '无工具验收失败'],
            needsReview: ['依赖当前选区', '只验证单个图层但任务涉及批量排序'],
            fail: ['目标图层不存在', 'after hierarchy 未变化', '误用 moveLayer 处理层级排序']
        },
        benchmarkNeeds: ['置顶/置底', '移动到指定图层上方/下方', '批量颜色从浅到深排序', '跨组排序边界'],
        notSolvedByThis: ['不判断颜色真实深浅', '不替代批量排序规划器', '不处理 Photoshop 锁定/背景层限制']
    },
    {
        id: 'layer-parent-group-edit',
        category: 'transform',
        zhName: '图层父子分组调整',
        maturity: 'mvp',
        intentSignals: ['移动到组', '放到组内', '移入图层组', '父级组', '子组'],
        photoshopTools: ['moveLayerToGroup'],
        dependsOnTools: ['getLayerHierarchy', 'getAcceptanceSnapshot'],
        designSemantics: [
            '图层父子分组调整是把一个图层或图层组放入目标 group 内，不是画布 x/y 移动，也不是同级堆叠排序。',
            '用户说“放进某个组、移入图层组、作为子组”时应使用 moveLayerToGroup。',
            '执行前必须读取 getLayerHierarchy 获取 source layerId 和 targetGroupId，执行后必须再次读取层级验证 parentId/path 改变。'
        ],
        parameters: [
            {
                name: 'layerId',
                required: true,
                meaning: '要移动的源图层或源图层组 ID。',
                failureModes: ['源图层不明确', '尝试移动背景层或锁定层']
            },
            {
                name: 'targetGroupId',
                required: true,
                meaning: '目标父级图层组 ID。',
                failureModes: ['目标不是 group', '把组移动到自身或后代导致循环层级']
            }
        ],
        commonFailureModes: [
            '误用 moveLayer 导致画布位置改变。',
            '误用 reorderLayer 只改变同级堆叠，实际没有进入目标组。',
            '没有 readback 层级，无法证明 parent group 已改变。'
        ],
        acceptance: {
            checks: ['before/after layer hierarchy', 'source layerId', 'targetGroupId', 'moveLayerToGroup result'],
            pass: ['after hierarchy 中源图层 parentId/path 指向目标组', '没有锁定层或自身后代移动错误'],
            needsReview: ['目标组通过名称模糊匹配', '同名目标组需要用户确认'],
            fail: ['目标组不存在', '目标不是 group', 'after hierarchy 未变化']
        },
        benchmarkNeeds: ['单图层移入组', '子组移入父组', '拒绝移入自身/后代', '锁定层失败提示'],
        notSolvedByThis: ['不做按组导出', '不自动决定设计分组命名', '不替代 createGroup']
    },
    {
        id: 'layer-focus-feedback',
        category: 'selection',
        zhName: '聚焦并反馈正在修改的图层',
        maturity: 'mvp',
        intentSignals: ['让我看到修改的位置', '聚焦当前图层', '实时查看 Agent 修改', '选中刚改的元素'],
        photoshopTools: ['focusLayer'],
        dependsOnTools: ['selectLayer', 'getLayerBounds', 'getAcceptanceSnapshot'],
        designSemantics: [
            '这是可观察执行能力，不是设计生成能力；目标是让用户知道 Agent 正在改哪个 Photoshop 对象。',
            '第一阶段只承诺选中图层、前置 Photoshop、刷新 UI、返回真实 bounds。',
            'Photoshop UXP 当前没有稳定公开的按任意区域精确平移/缩放画布视口 DOM API，不能把截图裁剪或日志显示伪装成真实视口聚焦。'
        ],
        parameters: [
            {
                name: 'layerId',
                required: false,
                meaning: '优先使用真实图层 ID 聚焦，避免同名图层造成误聚焦。',
                failureModes: ['图层已被删除', '工具返回成功但目标不是刚修改的图层']
            },
            {
                name: 'layerName',
                required: false,
                meaning: '缺少 ID 时的备用定位方式，只允许无歧义匹配。',
                failureModes: ['同名图层或包含匹配过多会导致目标歧义']
            },
            {
                name: 'includeBounds',
                required: false,
                meaning: '返回真实图层 bounds，作为用户可见聚焦和后续验收读回。',
                failureModes: ['空图层或隐藏图层可能无法得到有效视觉边界']
            }
        ],
        commonFailureModes: [
            '把选中图层误说成已经完成精确画布视口居中。',
            '根据 layerName 模糊匹配到错误图层。',
            '工具调用过于频繁，干扰用户手动 Photoshop 操作或降低执行速度。'
        ],
        acceptance: {
            checks: ['focusLayer result.focusedLayer', 'focusLayer result.bounds', 'focusLayer result.viewport.exactPanZoomSupported'],
            pass: ['目标图层被选中', '返回真实图层 ID、名称和 bounds', '明确声明未做精确 pan/zoom'],
            needsReview: ['只提供 layerName 且名称有潜在歧义', '目标图层 bounds 为空或很小', '频繁聚焦影响任务性能'],
            fail: ['目标图层不存在', '工具声称完成 pan/zoom 但没有实际读回', '聚焦到非本轮修改图层']
        },
        benchmarkNeeds: ['创建文本后聚焦', '移动图层后聚焦', '批量任务按关键节点聚焦', '失败时聚焦最后修改对象'],
        notSolvedByThis: ['不实现精确 Photoshop 画布平移', '不实现按区域自动缩放', '不替代验收截图或视觉 QA']
    },
    {
        id: 'image-layer-place',
        category: 'image-placement',
        zhName: '图片置入、选图与落位',
        maturity: 'mvp',
        intentSignals: ['放入图片', '置入素材', '替换图片', '用这张图', '把产品图放到这里', '自动选图'],
        photoshopTools: ['placeImage', 'replaceLayerContent', 'replaceImagePlaceholder'],
        dependsOnTools: ['getLayerBounds', 'getAcceptanceSnapshot', 'moveLayer', 'transformLayer', 'quickScale'],
        designSemantics: [
            '置图需要同时处理素材来源、主体边界、目标容器、裁切策略、层级位置和可编辑性。',
            '自动选图必须保留候选来源和评分结果；不能把“找到一张图片”伪装成理解了用户要的图片。',
            '图片大小和位置应来自目标框、主体占比、安全区和相邻元素关系，而不是固定铺满或固定居中。'
        ],
        parameters: [
            {
                name: 'filePath / fileToken / imageData',
                required: false,
                meaning: '图片来源；三者至少需要一个可用来源或明确的自动选图请求。',
                failureModes: ['路径不可读', 'Base64 转换失败', '素材来源和用户需求不匹配']
            },
            {
                name: 'requirement / query / category',
                required: false,
                meaning: '自动选图时的检索需求和素材类别。',
                failureModes: ['需求过宽导致候选图片不相关', '类别错误导致背景图被当产品图']
            },
            {
                name: 'x/y/center/scale/fitToCanvas/allowUpscale',
                required: false,
                meaning: '初始落位参数；应只作为执行候选，最终仍需读取 after bounds。scale 是百分比且可大于 100 表示放大；fitToCanvas 默认只缩不放（封顶 100%），小图铺满画布需 allowUpscale:true。',
                failureModes: ['center=true 掩盖实际需要的视觉重心', 'fitToCanvas 破坏留白或裁切主体', '忘记 allowUpscale 时小图永远铺不满画布', '放大过度导致图片模糊']
            },
            {
                name: 'targetBounds / targetFit',
                unit: 'px',
                required: false,
                meaning: '目标尺寸表达：置入后直接缩放并落位到指定区域，支持 {x,y,width,height} 或 {left,top,right,bottom}；targetFit 取 contain（默认）/cover/fill。多图排版时优先使用，避免默认居中重叠。',
                failureModes: ['宽高非正数或字段缺失会被执行端忽略并退回默认落位', 'cover/fill 可能裁掉或拉伸主体', 'targetBounds 存在时 x/y/center/scale 落位路径被跳过']
            }
        ],
        commonFailureModes: [
            '图片成功置入但不是用户需要的素材。',
            '图片层成功创建但尺寸、层级或位置不符合设计目标。',
            '替换占位图后原图层残留或实际 bounds 与计划框不一致。'
        ],
        acceptance: {
            checks: ['result layerId', 'after layer bounds', 'source path or selection record', 'targetBounds/targetFit params', 'optional placementAudit'],
            pass: ['成功创建或替换目标图片层', '素材来源明确', 'actual bounds 与目标框或审计结果一致', '带 targetBounds 时 bounds 尺寸/落位偏差 ≤ max(2px,1%)'],
            needsReview: ['自动选图分数不足', '缺少主体边界', '只有 bounds 数据，没有结果截图'],
            fail: ['图片来源不可用', '未生成目标图片层', '替换后原占位图仍可见或 bounds 严重偏移', '带 targetBounds 时尺寸偏差超过 max(2px,1%)']
        },
        benchmarkNeeds: ['本地路径置图', '自动选图建议', '占位图替换', '目标框 cover/contain', '产品主体安全区'],
        notSolvedByThis: ['不解决抠图质量', '不判断图片美感和商品卖点', '不替代智能缩放策略或截图级 QA']
    },
    {
        id: 'shape-layer-create',
        category: 'shape',
        zhName: '基础形状与容器创建',
        maturity: 'mvp',
        intentSignals: ['画矩形', '创建卡片', '加背景块', '做按钮', '加标签', '圆角矩形'],
        photoshopTools: ['createRectangle'],
        dependsOnTools: ['getLayerBounds', 'getAcceptanceSnapshot', 'addStroke', 'setLayerOpacity'],
        designSemantics: [
            '形状层通常承担容器、按钮、标签、分割和背景承托；尺寸应来自内容、网格和安全区。',
            '圆角、填充、透明度和描边是视觉语义的一部分，不能只创建一个默认矩形。',
            '创建后应确认实际 bounds；否则卡片和文字很容易出现错位。'
        ],
        parameters: [
            {
                name: 'x/y/width/height',
                unit: 'px',
                required: true,
                meaning: '形状计划边界。',
                failureModes: ['宽高为 0 或负数', '目标框越界', '使用文字黑色像素框当容器框']
            },
            {
                name: 'fillColorHex',
                required: false,
                meaning: '形状填充色，通常来自参考图样式或品牌色。',
                failureModes: ['缺色导致默认样式不符合参考图', '对比度不足影响文字可读性']
            },
            {
                name: 'cornerRadius',
                unit: 'px',
                required: false,
                meaning: '圆角半径；按钮、卡片和徽章的视觉差异关键参数。',
                failureModes: ['半径过大破坏形状', '参考图圆角被忽略导致复刻不像']
            }
        ],
        commonFailureModes: [
            '形状已创建但层级压住了文字或图片。',
            '实际 bounds 与计划框不一致。',
            '颜色、圆角或描边未执行却被总结为完成。'
        ],
        acceptance: {
            checks: ['created layer id', 'after layer kind', 'after layer bounds', 'fill/corner parameters when readable'],
            pass: ['创建形状层', 'bounds 与计划框匹配', '核心样式有执行或明确记录为未验证'],
            needsReview: ['样式读回不足', '层级关系未验证', '只有结构读回，没有结果截图'],
            fail: ['未创建形状层', 'bounds 严重偏移', '创建结果不是形状层']
        },
        benchmarkNeeds: ['背景卡片', '按钮容器', '圆角标签', '分割块', '参考图容器复刻'],
        notSolvedByThis: ['不自动生成复杂矢量图标', '不替代品牌色系统', '不判断最终视觉层次是否高级']
    },
    {
        id: 'basic-layer-style',
        category: 'layer-style',
        zhName: '基础图层样式效果',
        maturity: 'planned',
        intentSignals: ['加描边', '加投影', '发光', '浮起来', '增强立体感', '突出边缘'],
        photoshopTools: ['addStroke', 'addDropShadow', 'addGlow', 'clearLayerEffects', 'setLayerFill'],
        dependsOnTools: ['getLayerBounds', 'getAcceptanceSnapshot'],
        designSemantics: [
            '图层样式是 recipe 问题：效果名称、颜色、半径、距离、不透明度、混合方式和目标图层都需要明确。',
            '参考图中的投影或描边可能来自图层样式、复制模糊层或预渲染贴图；成品图不能证明原作者真实做法。',
            '当前只能逐步实现可验证的基础 recipe，不能把视觉模型识别出的效果直接当作已执行。'
        ],
        parameters: [
            {
                name: 'target layer',
                required: true,
                meaning: '需要添加效果的目标图层。',
                failureModes: ['当前选中层错误', '效果加到组或错误图层上']
            },
            {
                name: 'color / opacity / size / distance',
                required: false,
                meaning: '基础效果参数；必须有默认边界和可审计来源。',
                failureModes: ['参数缺失导致默认效果不符合参考图', 'size/distance 过大破坏版面']
            },
            {
                name: 'effect recipe',
                required: false,
                meaning: '效果配方标识，例如基础描边、轻投影、柔和发光。',
                failureModes: ['同名效果不同做法混用', '没有 recipe 仍宣称高保真复刻']
            }
        ],
        commonFailureModes: [
            '视觉模型识别出 shadow/stroke，但 Photoshop 未实际执行。',
            '效果加在错误图层或错误层级。',
            '缺少结果截图时难以判断投影半径和透明度是否合理。'
        ],
        acceptance: {
            checks: ['tool result', 'target layer id', 'style recipe attempt summary', 'optional after bounds/effects snapshot'],
            pass: ['目标图层明确', 'recipe 执行成功', '效果参数在可接受范围内'],
            needsReview: ['Photoshop snapshot 不能读回具体效果参数', '只有工具成功消息，没有结果截图'],
            fail: ['目标图层缺失', '效果工具返回失败', 'recipe 未实现却被标记为完成']
        },
        benchmarkNeeds: ['纯色内描边', '轻投影卡片', '按钮描边', '文字外发光', '清除效果回滚'],
        notSolvedByThis: ['不还原原作者真实 PSD 做法', '不覆盖复杂混合模式和滤镜', '不证明审美质量']
    },
    {
        id: 'sku-template-layout',
        category: 'sku-batch',
        zhName: 'SKU 模板占位排版与导出',
        maturity: 'mvp',
        intentSignals: ['做SKU', 'SKU排版', '批量出SKU图', 'N双装组合图', '自选备注'],
        photoshopTools: ['skuLayout'],
        dependsOnTools: ['sockLayoutConfig', 'createSkuPlaceholders', 'transformLayer', 'openTemplate', 'listDocuments'],
        designSemantics: [
            '模板占位识别只有四种模式：ordered_slots（6.3，一槽一色）、legacy_single_region（6.0，单矩形区域承载整组多色）、legacy_multi_regions（6.0，多个矩形区域分别承载若干颜色）、none（未识别到占位）。',
            '动手写入前先跑 action=inspectTemplateLayout（只读），读取 mode、slot 的 layerId/type/panelIndex/bounds 与 blockers，再形成 TemplateLayoutPlan；不要凭模板文件名猜占位结构后直接 execute。',
            'ordered_slots 的 regionCapacities 恒为全 1 且槽数必须等于颜色数；region_composition 必须提供按 Photoshop 面板顺序排列的显式 regionCapacities，长度等于区域数、总和等于颜色数，例如 4 双装上 3 下 1 为 [3,1]。',
            '矩形区域容量可以由“容量N”命名或面积权重形成建议；非高置信建议必须经截图确认，写入工具不得自行猜测。',
            '结构不适配时应选择与模板语义一致的修复：用 transformLayer 调整现有占位的 layerId/bounds、用 createSkuPlaceholders 创建明确的方法化占位、或用 openTemplate 换开正确模板；不要把 6.0 多区域模板强行补成 6.3 槽组。'
        ],
        parameters: [
            {
                name: 'action',
                required: true,
                meaning: '子动作：inspectTemplateLayout / getCapabilities / listLayerSets / getProgress 只读；execute / executeOne / executeBatch / arrangeDynamic 写入并导出。',
                failureModes: ['跳过只读检查直接 execute', '把自选备注 arrangeDynamic 与组合 execute 混用']
            },
            {
                name: 'combos',
                required: false,
                meaning: '颜色组合列表，每个元素是一组颜色名数组；组内颜色数决定该组合需要的占位槽数。',
                failureModes: ['把整段多组文本当成一个组合', '颜色名与 SKU 素材图层组名对不上']
            },
            {
                name: 'templateDocName / skuDocName',
                required: false,
                meaning: '显式指定模板与 SKU 素材文档名；应来自 openTemplate 结果的 documentName 或 listDocuments，避免依赖活动文档。',
                failureModes: ['依赖活动文档猜测导致找错模板', '用文件路径末段猜文档名与实际打开名不一致']
            },
            {
                name: 'expectedItemCount',
                required: false,
                meaning: 'inspectTemplateLayout 用于对照的期望颜色数量，可提前暴露槽数不匹配。',
                failureModes: ['不传导致检查结果无法对照本次组合规格']
            },
            {
                name: 'regionCapacities',
                required: false,
                meaning: '6.0 region_composition 的显式区域容量计划，按图层面板顺序；长度必须等于区域数、总和必须等于本组颜色数。',
                failureModes: ['多区域模板未传容量计划', '容量长度或总和不匹配', '把低置信面积建议直接当作已确认计划']
            }
        ],
        commonFailureModes: [
            '模板布局计划不可执行：失败结果携带 mode / slotCount / requiredCount / regionCapacities / blockers，应修复结构或确认容量，不要原样重试。',
            '模板文档识别错位：名称含 sku/素材 的文档会被当成素材而不是模板。',
            '把 legacy_single_region 或 legacy_multi_regions 模板误判为缺槽而反复补槽。'
        ],
        acceptance: {
            checks: ['inspectTemplateLayout mode/slot layerId/type/panelIndex/bounds/blockers', 'TemplateLayoutPlan 与 regionCapacities', 'templateLayoutPlans 实际分配', 'exportedFiles', 'errors 与 placeholderMismatch 结构化数据', '实际 templateDocName'],
            pass: ['执行前有 inspectTemplateLayout 与可执行 TemplateLayoutPlan', 'regionCapacities 与实际模板区域、颜色数一致', 'exportedCount 与组合数一致', '无未处理 errors'],
            needsReview: ['区域容量来自中低置信面积建议', '单区域或多区域内的间距未做截图复核', '部分组合失败但其余导出成功'],
            fail: ['未导出任何文件', '槽数不匹配错误被原样重试', '模板/素材文档错认']
        },
        benchmarkNeeds: ['ordered_slots 标准 N 双装', '单参考区域整组排布', '4 双装上 3 下 1 多区域排布', '低置信区域容量确认', '结构不适配恢复', '自选备注导出'],
        notSolvedByThis: ['不设计模板本身的构图', '不校验颜色命名是否符合品牌规范', '不替代导出后的视觉 QA']
    },
    {
        id: 'sku-placeholder-authoring',
        category: 'sku-batch',
        zhName: 'SKU 占位槽创建（补槽）',
        maturity: 'mvp',
        intentSignals: ['补占位符', '加占位槽', '模板缺槽', '创建SKU占位'],
        photoshopTools: ['createSkuPlaceholders', 'transformLayer'],
        dependsOnTools: ['skuLayout', 'getSkuPlaceholders', 'getDocumentInfo', 'getLayerBounds'],
        designSemantics: [
            '先选择占位方法：ordered_slots 创建 N 个一色一槽的 6.3 占位组；region_composition 创建 M 个 6.0 矩形区域，并用 regionCapacities 声明每区容量且总和为 N。',
            '非破坏性：只新增占位图层组，不删除或覆盖模板现有内容；visible=false 时槽隐藏但 bounds 仍可被 skuLayout 识别。',
            '槽位几何应给标题、备注条等已有元素留出空间：优先传 area 或显式 slots，而不是默认铺满画布。',
            '调整既有占位不是再次创建：从 inspectTemplateLayout 读取目标 layerId/bounds，用 transformLayer 修改后重新 inspect 验证。'
        ],
        parameters: [
            {
                name: 'count',
                required: true,
                meaning: '要创建的物理占位数量：ordered_slots 时等于颜色数量 N；region_composition 时等于矩形区域数量 M。',
                failureModes: ['混淆颜色数量与区域数量', '显式 slots 数量与 count 不一致会被工具拒绝']
            },
            {
                name: 'placementMethod / regionCapacities',
                required: false,
                meaning: 'placementMethod 选择 ordered_slots 或 region_composition；区域模式必须给出长度为 count、正整数且总和为规格颜色数的容量数组。',
                failureModes: ['区域模式遗漏容量', '容量数组长度不等于区域数', '容量总和不等于颜色数']
            },
            {
                name: 'slots',
                required: false,
                meaning: 'Agent 已规划好的槽位数组（含 x/y/width/height）；传入后按槽位创建，不再重新计算几何。',
                failureModes: ['槽位宽高非正数被过滤', '槽位与模板已有元素重叠']
            },
            {
                name: 'area / layout / columns / centerLastRow',
                required: false,
                meaning: '自动计算几何时的排布区域与方式。',
                failureModes: ['不传 area 时默认按整画布减 padding 排布，可能压住标题或备注条']
            }
        ],
        commonFailureModes: [
            '补槽后没有重跑 inspectTemplateLayout 确认 slotCount 已达标。',
            '在 legacy_single_region 或 legacy_multi_regions 模板上补槽造成两套占位并存。',
            '区域模式把 count 填成颜色数而不是物理区域数。'
        ],
        acceptance: {
            checks: ['创建结果 placementMethod/regionCapacities/placeholders', '重跑 inspectTemplateLayout 的 mode/slotCount/slot bounds', '调整前后 layerId/bounds'],
            pass: ['ordered_slots 的 slotCount 等于规格颜色数，或 region_composition 的容量总和等于规格颜色数', '槽位不与关键元素重叠', '调整后仍只有一套可解析占位结构'],
            needsReview: ['槽位几何来自默认计算而未复核', '隐藏槽未确认可被识别'],
            fail: ['占位方法与模板语义不一致', '区域容量无效', '创建或调整后模板仍不可解析']
        },
        benchmarkNeeds: ['4双 ordered_slots', '3双 2+1 一槽一色网格', '4双上3下1 region_composition', '带 area 避让标题', '显式 slots 精确落位', '按 layerId 调整既有区域'],
        notSolvedByThis: ['不判断槽位构图是否美观', '不清理模板里多余旧槽', '不替代换模板决策']
    },
    {
        id: 'sku-combo-config-parse',
        category: 'sku-batch',
        zhName: 'SKU 组合配置解析（组合优先）',
        maturity: 'mvp',
        intentSignals: ['解析颜色组合', 'SKU配置', '组合清单', '排版CSV'],
        photoshopTools: ['sockLayoutConfig'],
        dependsOnTools: ['skuLayout', 'openTemplate'],
        designSemantics: [
            '输入格式契约：comboText 每行一组组合，行内颜色用 +、|、顿号或空格分隔；多组组合必须保留换行，绝不能把整段多组文本拼成一行当成一个组合。',
            '只读工具：只解析配置并产出 skuLayout 可直接消费的 combos 分组与执行计划，不写 Photoshop。',
            '颜色数自动匹配 N双装 模板；plan.status=blocked 时 blockers 是给模型的修复清单，不是终态失败。'
        ],
        parameters: [
            {
                name: 'action',
                required: false,
                meaning: '默认 buildPlan；parseCombos 仅解析组合，inferProjectPaths 推断项目目录。',
                failureModes: ['需要执行计划时只跑了 parseCombos 就直接执行']
            },
            {
                name: 'comboText',
                required: false,
                meaning: '组合优先输入：每行一组颜色，例如「白色+奶白+蓝色」占一行。',
                failureModes: ['整段文本无换行被解析成一个超长组合', '把说明性文字混进组合行被当成颜色名']
            },
            {
                name: 'templateName / availableTemplates',
                required: false,
                meaning: '全局模板覆盖与真实模板文件清单；不传时按 N双装 约定名推断，工具会尽力扫描模板目录。',
                failureModes: ['覆盖名与真实文件不符', '模板目录扫描失败时静默按约定名推断']
            }
        ],
        commonFailureModes: [
            '整段文本被当成一个组合，导致匹配不到对应双数模板。',
            '组合行里混入序号/备注文字被当成颜色名。',
            'plan.status=blocked 的计划被当成功继续执行。'
        ],
        acceptance: {
            checks: ['parseCombos 返回的 combos 分组', 'plan.status 与 blockers', '匹配到的模板名'],
            pass: ['combos 组数与输入行数一致', 'plan.status=ready'],
            needsReview: ['模板按约定名推断而非真实文件匹配', '组合内颜色名未与素材图层组核对'],
            fail: ['多组输入被解析成单组', 'blocked 计划未处理就执行']
        },
        benchmarkNeeds: ['多行组合解析', '混合分隔符', '带模板覆盖', '旧版双 CSV 兼容'],
        notSolvedByThis: ['不验证颜色图层组真实存在', '不执行排版写入', '不决定营销上的组合搭配']
    },
    {
        id: 'template-document-open',
        category: 'document',
        zhName: '打开 PSD/PSB 文档',
        maturity: 'mvp',
        intentSignals: ['打开模板', '打开PSD', '打开素材文件', '加载详情页源文件'],
        photoshopTools: ['openTemplate'],
        dependsOnTools: ['listDocuments', 'getDocumentInfo'],
        designSemantics: [
            '结果必读 documentName：成功结果 data.documentName 才是 Photoshop 实际打开的文档名，后续 skuLayout 等工具的 templateDocName 必须引用它，不要用文件路径末段猜文档名。',
            '同名/副本风险：Photoshop 打开副本或重名文件时文档名可能带序号后缀，与磁盘文件名不一致。',
            '失败结果可能带 suggestion=manual_open，表示需要用户在 Photoshop 手动打开；这不是可以静默重试的错误。'
        ],
        parameters: [
            {
                name: 'psdPath',
                required: true,
                meaning: 'PSD/PSB 文件完整路径；可以是模板、SKU 素材、详情页源文件。',
                failureModes: ['路径不存在或无访问权限', '把输出目录里的成品文件当模板打开']
            }
        ],
        commonFailureModes: [
            '打开成功但后续工具用路径猜的文档名找不到文档。',
            '未确认 documentName 就把当前活动文档当目标模板。',
            'manual_open 失败被当成已打开继续执行。'
        ],
        acceptance: {
            checks: ['result.data.documentName', 'result.data.filePath', 'listDocuments 中可见该文档'],
            pass: ['documentName 已读取并用于后续 templateDocName', '文档出现在打开列表中'],
            needsReview: ['documentName 与文件名不一致（副本/重名）', 'openedVia=jsx 回退路径'],
            fail: ['打开失败', '后续工具用未验证的文档名执行']
        },
        benchmarkNeeds: ['打开 N双装 模板', '重名文件区分', 'manual_open 失败处理', '打开后接 inspectTemplateLayout'],
        notSolvedByThis: ['不判断文件内容是否是正确模板', '不管理文档关闭与保存', '不解决文件权限授权']
    }
];

export function getPhotoshopToolSemantics(): PhotoshopToolSemantic[] {
    return PHOTOSHOP_TOOL_SEMANTICS;
}

export function getPhotoshopToolSemanticById(id: string): PhotoshopToolSemantic | undefined {
    return PHOTOSHOP_TOOL_SEMANTICS.find((item) => item.id === id);
}

export function getPhotoshopToolSemanticsByCategory(
    category: PhotoshopToolSemanticCategory
): PhotoshopToolSemantic[] {
    return PHOTOSHOP_TOOL_SEMANTICS.filter((item) => item.category === category);
}

export function getPhotoshopToolSemanticsByTool(toolName: string): PhotoshopToolSemantic[] {
    const normalized = String(toolName || '').trim();
    if (!normalized) return [];
    return PHOTOSHOP_TOOL_SEMANTICS.filter((item) => (
        item.photoshopTools.includes(normalized) || item.dependsOnTools.includes(normalized)
    ));
}

export function buildPhotoshopToolSemanticsSummary(category?: PhotoshopToolSemanticCategory): string {
    const items = category
        ? getPhotoshopToolSemanticsByCategory(category)
        : PHOTOSHOP_TOOL_SEMANTICS;
    return items.map((item) => [
        `${item.zhName} (${item.id}, ${item.maturity})`,
        `工具: ${item.photoshopTools.join(', ')}`,
        `关键语义: ${item.designSemantics.slice(0, 2).join(' / ')}`,
        `验收检查: ${item.acceptance.checks.join(', ')}`
    ].join('\n')).join('\n\n');
}
