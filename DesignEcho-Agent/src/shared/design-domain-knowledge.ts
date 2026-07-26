export type DesignDomainConceptId =
    | 'main-image'
    | 'detail-page'
    | 'sku'
    | 'reference-replication'
    | 'poster'
    | 'banner'
    | 'template'
    | 'recipe'
    | 'smart-scaling'
    | 'visual-case';

export type DesignKnowledgeLayer =
    | 'domain-definition'
    | 'design-rule'
    | 'recipe'
    | 'visual-case'
    | 'benchmark';

export interface DesignDomainConcept {
    id: DesignDomainConceptId;
    zhName: string;
    enName?: string;
    aliases: string[];
    layer: DesignKnowledgeLayer;
    definition: string;
    primaryGoal: string;
    userIntentSignals: string[];
    typicalInputs: string[];
    typicalOutputs: string[];
    commonModules: string[];
    constraints: string[];
    notThis: string[];
    relatedSkillIds: string[];
    maturity: 'defined' | 'partial-implementation' | 'planned';
}

export const DESIGN_DOMAIN_CONCEPTS: DesignDomainConcept[] = [
    {
        id: 'main-image',
        zhName: '主图',
        enName: 'E-commerce Main Image',
        aliases: ['主图', '首图', '商品封面', '点击图', '转化图', '白底图', 'main image'],
        layer: 'domain-definition',
        definition: '电商商品在列表、搜索、详情入口中优先展示的封面视觉，通常是正方形或平台指定比例。',
        primaryGoal: '在很短时间内让用户看清商品主体、核心卖点和购买理由，提升点击或转化。',
        userIntentSignals: ['做主图', '新建主图文档', '主图模板', '800主图', '白底主图', '点击图'],
        typicalInputs: ['产品图', '主体图层', '卖点文案', '平台尺寸要求', '背景或风格偏好'],
        typicalOutputs: ['可编辑主图 PSD 结构', '主图导出图片', '真实主图草稿'],
        commonModules: ['商品主体', '核心卖点', '促销标签', '信任背书', '背景氛围'],
        constraints: ['主体必须清晰', '不要让文案遮挡商品', '信息密度通常低于详情页', '尺寸和安全区应可验证'],
        notThis: ['不是多屏长图详情页', '不是 SKU 组合表', '不是单纯抠图或背景替换'],
        relatedSkillIds: ['main-image-design'],
        maturity: 'partial-implementation'
    },
    {
        id: 'detail-page',
        zhName: '详情页',
        enName: 'Product Detail Page',
        aliases: ['详情页', '长图', '卖点页', '参数页', '面料页', 'detail page'],
        layer: 'domain-definition',
        definition: '用于完整介绍商品的纵向多屏设计，通常由首屏、卖点、材质、工艺、场景、参数、售后等模块组成。',
        primaryGoal: '按阅读顺序逐步说服用户理解商品价值、消除疑虑并完成购买决策。',
        userIntentSignals: ['设计详情页', '制作详情页', '填充详情页', '导出详情页', '详情页模板'],
        typicalInputs: ['商品素材', '项目图片', '卖点信息', '模板 PSD', '品牌语气', '页面宽度和屏数'],
        typicalOutputs: ['可编辑详情页 PSD', '分屏导出图', '真实详情页草稿', '填充计划和 QA 报告'],
        commonModules: ['首屏主视觉', '卖点卡片', '材质证明', '细节展示', '参数表', '场景图', '售后承诺'],
        constraints: ['屏职责应明确', '图文顺序应符合说服路径', '文本长度要适配版面', '图片替换需保护占位和裁切关系'],
        notThis: ['不是单张主图', '不是 SKU 批量组合图', '不是只改一个图层的小操作'],
        relatedSkillIds: ['detail-page-design'],
        maturity: 'partial-implementation'
    },
    {
        id: 'sku',
        zhName: 'SKU',
        enName: 'Stock Keeping Unit / SKU Design',
        aliases: ['SKU', 'sku', '规格图', '组合图', '颜色组合', '双装', '三装', '自选备注'],
        layer: 'domain-definition',
        definition: '商品销售属性或规格组合的展示与批量出图任务，强调准确表达颜色、尺码、数量、套餐和备注选项。',
        primaryGoal: '让用户准确理解可购买选项，降低选错规格的风险，并支持批量生成。',
        userIntentSignals: ['做SKU', '批量SKU', '组合图', '自选备注', '双装', '三装', '批量配色'],
        typicalInputs: ['SKU 源文件', '颜色配置', '组合规则', '模板 PSD', '备注模板', '导出目录'],
        typicalOutputs: ['SKU 组合图', '备注图', '批量导出文件', '规格配置数据'],
        commonModules: ['颜色图块', '规格标签', '组合占位', '备注区域', '导出命名规则'],
        constraints: ['准确性优先于创意', '不能随意改 SKU 逻辑', '模板匹配要保守', '失败时需要可追溯'],
        notThis: ['不是开放式海报设计', '不是详情页说服链路', '不是参考图复刻任务'],
        relatedSkillIds: ['sku-config', 'sku-batch'],
        maturity: 'partial-implementation'
    },
    {
        id: 'reference-replication',
        zhName: '参考图复刻',
        enName: 'Reference Image Replication',
        aliases: ['参考图复刻', '按图做', '照着做', '仿照', '复现', '同款版式', '参考图做设计'],
        layer: 'domain-definition',
        definition: '从一张扁平参考图中推断视觉结构、模块、图文关系和风格方向，并在 Photoshop 中重建一个相似且可编辑的设计方案。',
        primaryGoal: '生成高相似、可编辑、可复核、可继续迭代的设计稿，而不是还原原作者真实 PSD 或历史步骤。',
        userIntentSignals: ['按这张图做', '复刻这张图', '参考图做设计', '照着这个版式生成', '仿这个海报'],
        typicalInputs: ['参考图', '目标画布或新建文档要求', '商品素材', '品牌或类目约束', '期望输出类型'],
        typicalOutputs: ['参考图解析结果', '设计中间表示', '可编辑骨架', '素材落位计划', 'QA 报告'],
        commonModules: ['画布比例', '主视觉区', '标题区', '辅助文案', 'CTA', '装饰和背景', '视觉层级'],
        constraints: ['不能承诺 100% 还原真实 PSD', '必须区分事实和推断', '低置信度时应复核', '需要 benchmark 才能证明质量提升'],
        notThis: ['不是简单复制图片像素', '不是只给设计建议', '不是没有参考图也强行执行'],
        relatedSkillIds: ['layout-replication', 'visual-analysis', 'design-reference-search'],
        maturity: 'partial-implementation'
    },
    {
        id: 'poster',
        zhName: '海报',
        enName: 'Poster',
        aliases: ['海报', '营销海报', '活动海报', 'poster'],
        layer: 'domain-definition',
        definition: '以单张或少量画布传达活动、品牌或商品主题的视觉设计，通常更强调创意、氛围和传播性。',
        primaryGoal: '快速传达主题并制造视觉吸引力。',
        userIntentSignals: ['做海报', '营销海报', '活动海报', '参考海报'],
        typicalInputs: ['主题', '活动信息', '主视觉素材', '品牌调性', '尺寸'],
        typicalOutputs: ['可编辑海报设计', '导出图', '复刻或改版计划'],
        commonModules: ['主题标题', '主视觉', '活动信息', '品牌标识', '装饰背景'],
        constraints: ['创意空间更大', '与详情页的信息密度和阅读路径不同', '需要明确用途和尺寸'],
        notThis: ['不是 SKU 组合图', '不是完整详情页长图'],
        relatedSkillIds: ['layout-replication', 'visual-analysis', 'design-reference-search'],
        maturity: 'planned'
    },
    {
        id: 'banner',
        zhName: 'Banner',
        enName: 'Banner',
        aliases: ['banner', '横幅', '店铺横幅', '活动横幅'],
        layer: 'domain-definition',
        definition: '横向或指定比例的运营视觉，常用于店铺、活动入口、页面头图或广告位。',
        primaryGoal: '在受限尺寸中清晰传达活动或品牌主题。',
        userIntentSignals: ['做 banner', '横幅', '店铺头图', '活动横幅'],
        typicalInputs: ['尺寸', '活动主题', '商品素材', '主文案', 'CTA'],
        typicalOutputs: ['可编辑横幅设计', '导出图片'],
        commonModules: ['主标题', '商品或人物', '促销信息', 'CTA', '品牌标识'],
        constraints: ['横向空间有限', '文案必须简洁', '需要适配安全区'],
        notThis: ['不是纵向详情页', '不是 SKU 批量图'],
        relatedSkillIds: ['layout-replication', 'visual-analysis'],
        maturity: 'planned'
    },
    {
        id: 'template',
        zhName: '模板',
        enName: 'Template',
        aliases: ['模板', 'PSD模板', '可复用模板', 'template'],
        layer: 'domain-definition',
        definition: '可重复使用的 Photoshop 文档结构，通常包含占位层、文本层、分组、命名规范和可替换区域。',
        primaryGoal: '降低重复设计成本，并让后续填充、替换、导出更稳定。',
        userIntentSignals: ['创建模板', '保存模板', '加入模板库', '新建模板'],
        typicalInputs: ['当前 PSD', '模板类型', '占位规则', '描述和标签'],
        typicalOutputs: ['模板记录', '模板文件', 'AI 可读描述', '可复用占位结构'],
        commonModules: ['占位图层', '文本图层', '分组结构', '缩略图', '模板元数据'],
        constraints: ['模板不是最终成品', '必须保留可编辑性', '图层命名和占位约定要稳定'],
        notThis: ['不是一次性导出图', '不是普通素材文件'],
        relatedSkillIds: ['save-current-template'],
        maturity: 'partial-implementation'
    },
    {
        id: 'recipe',
        zhName: '设计 Recipe',
        enName: 'Design Recipe',
        aliases: ['recipe', '设计配方', '设计做法', '组件做法', '效果做法'],
        layer: 'recipe',
        definition: '把常见设计做法沉淀成可选择、可执行、可验证的结构化方案，例如标题样式、CTA、卖点卡片或商品主视觉排布。',
        primaryGoal: '减少模型临场猜测，让常见设计效果可复用、可审计。',
        userIntentSignals: ['高级一点', '做成这种效果', '按这种组件', '类似这个模块'],
        typicalInputs: ['适用场景', '目标模块', '风格约束', '执行参数'],
        typicalOutputs: ['recipe 选择结果', 'Photoshop 执行动作', '适用边界和风险'],
        commonModules: ['标题效果', '按钮', '角标', '卡片', '背景', '阴影', '参数表'],
        constraints: ['必须有适用边界', '不能把未验证效果当稳定能力', '需要和 Photoshop 工具能力对齐'],
        notThis: ['不是普通文字规则', '不是模型自由发挥的散文建议'],
        relatedSkillIds: ['layout-replication', 'detail-page-design', 'main-image-design'],
        maturity: 'planned'
    },
    {
        id: 'smart-scaling',
        zhName: '智能缩放',
        enName: 'Smart Scaling / Photoshop Transform Planning',
        aliases: ['智能缩放', '自由变换', '调整大小', '主体占比', '图片落位', '符合审美大小', 'smart scaling'],
        layer: 'design-rule',
        definition: '根据画布、目标区域、主体边界、素材角色和设计意图，计算图片在 Photoshop 中应该缩放到多大、放在何处以及是否允许裁切的设计决策。',
        primaryGoal: '让图片缩放不再依赖固定百分比，而能解释主体占比、留白、视觉重心和裁切风险。',
        userIntentSignals: ['缩放到合适大小', '自由变换一下', '调整图片大小', '主体放大一点', '图片太小', '图片太大', '放到画面里更协调'],
        typicalInputs: ['画布尺寸', '当前图层边界', '主体边界', '目标区域', '素材角色', '设计类型', '用户意图'],
        typicalOutputs: ['缩放比例', '目标位置', '目标框', '主体可见比例', '裁切风险', '置信度和复核建议'],
        commonModules: ['主体检测', '目标区域解析', '缩放策略', '锚点定位', '执行后 bounds 验证'],
        constraints: ['不能只靠固定百分比', '主体边界缺失时必须降低置信度', 'Photoshop 执行后必须读取真实 bounds 复核', '允许裁切必须由场景或背景意图支持'],
        notThis: ['不是单纯 transformLayer 百分比调用', '不是抠图', '不是完整参考图复刻', '不是液化或形态统一'],
        relatedSkillIds: ['smart-layout', 'layout-replication', 'main-image-design'],
        maturity: 'partial-implementation'
    },
    {
        id: 'visual-case',
        zhName: '视觉案例',
        enName: 'Visual Case',
        aliases: ['案例', '参考案例', '优秀案例', '参考图案例', 'visual case'],
        layer: 'visual-case',
        definition: '带有图片、结构化视觉分析、标签、适用场景和人工评分的设计案例。',
        primaryGoal: '让 Agent 不只依赖模型常识，而能从已验证案例中召回结构、风格和验收口径。',
        userIntentSignals: ['找参考', '类似案例', '参考案例', '学习这个图'],
        typicalInputs: ['案例图片', '设计类型', '标签', '视觉分析结果', '人工评价'],
        typicalOutputs: ['候选参考案例', '结构化案例描述', '可复用设计线索'],
        commonModules: ['原图', '缩略图', 'OCR', '主色', '模块拆解', '风格标签', '评分卡'],
        constraints: ['不能只存图片文件', '必须存解析后的结构化索引', '需要人工或 benchmark 验证'],
        notThis: ['不是无结构的图片文件夹', '不是纯文本 RAG'],
        relatedSkillIds: ['design-reference-search', 'layout-replication', 'visual-analysis'],
        maturity: 'planned'
    }
];

function normalizeText(value: string): string {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function getDesignDomainConcepts(): DesignDomainConcept[] {
    return DESIGN_DOMAIN_CONCEPTS;
}

export function getDesignDomainConceptById(id: string): DesignDomainConcept | undefined {
    return DESIGN_DOMAIN_CONCEPTS.find((concept) => concept.id === id);
}

export function searchDesignDomainConcepts(query: string): DesignDomainConcept[] {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];

    return DESIGN_DOMAIN_CONCEPTS.filter((concept) => {
        const haystack = [
            concept.id,
            concept.zhName,
            concept.enName || '',
            ...concept.aliases,
            ...concept.userIntentSignals,
            concept.definition,
            concept.primaryGoal
        ].map(normalizeText).join('|');
        return haystack.includes(normalizedQuery) || normalizedQuery.includes(normalizeText(concept.zhName));
    });
}

export function formatDesignDomainConceptsForRouter(): string[] {
    return DESIGN_DOMAIN_CONCEPTS
        .filter((concept) => ['main-image', 'detail-page', 'sku', 'reference-replication', 'template', 'smart-scaling'].includes(concept.id))
        .map((concept) => [
            `- ${concept.zhName} (${concept.id}, maturity=${concept.maturity}): ${concept.definition}`,
            `  goal: ${concept.primaryGoal}`,
            `  signals: ${concept.userIntentSignals.slice(0, 6).join(' / ')}`,
            `  notThis: ${concept.notThis.slice(0, 3).join(' / ')}`
        ].join('\n'));
}

export function formatDesignKnowledgeRoadmapForPlanning(): string[] {
    return [
        'Knowledge layers for DesignEcho should be built in this order:',
        '1. Domain definitions: clarify concepts such as main image, detail page, SKU, template, and reference replication.',
        '2. Design rules: layout, typography, color, smart scaling, platform constraints, and category-specific rules.',
        '3. Recipe registry: executable and reviewable design methods for common modules and effects.',
        '4. Visual case index: images plus structured visual analysis, tags, OCR, modules, and manual scores.',
        '5. Benchmark: real input/output cases with scorecards and manual verification.',
        'Do not treat a vector database as the first step. Embeddings become useful only after the structured knowledge shape is stable.'
    ];
}
