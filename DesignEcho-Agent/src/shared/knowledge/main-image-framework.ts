/**
 * 电商主图设计结构化框架（知识模块）
 *
 * 来源：用户方法论（docs/main-image-design-framework.md，权威）。
 * 消费方式：getMainImageDesignFramework 知识工具按需检索；
 * 角色提示可注入精简摘要。知识只作为上下文与评审依据，不直接授权写入，
 * 也不允许把本模块内容硬编码进 Agent 运行时分支。
 */

export type MainImageFrameworkFocus = 'overview' | 'click' | 'conversion' | 'selling-points' | 'review';

const OVERVIEW = [
    '主图 = 点击图 + 转化图。点击图负责吸引（解决"为什么点"，目标点击率）；转化图负责说服（解决"为什么买"，目标转化率）。',
    '设计前分析流程：明确产品 → 明确用户 → 明确场景 → 找到痛点 → 提炼卖点 → 找到差异化 → 设计点击图 → 设计转化图 → 检查视觉层级 → 检查说服逻辑。',
    '最简模型：点击图 = 场景 + 兴趣 + 钩子 + 对比 + 识别；转化图 = 需求 + 痛点 + 卖点 + 卖点说明 + 信任。'
].join('\n');

const CLICK_IMAGE = [
    '点击图核心任务：在用户快速滑动时给出一个明确点击理由。',
    '设计公式：点击图 = 产品主体 + 一个核心钩子 + 一个差异点 + 适度信任（袜子示例：模特上脚图 + 不掉跟/显腿细/透气不闷 + 镂空暗纹/新疆棉/硅胶防滑 + 高弹亲肤/多色可选）。',
    '内容组成：图片管产品识别与质感场景，文案管点击理由，元素管卖点强化与视线引导。',
    '判断要点：用户场景（搜索/推荐流/货架页）、用户兴趣（价格/颜值/功能/痛点/场景/稀缺感）、与竞品相比的点击理由、一眼能否看懂卖什么、画面识别度与对比。',
    '版式原则：主体要大（一眼识别）；文案要少（不塞详情页内容）；层级要清楚（主标题>副标题>标签）；对比要明显（大小/粗细/明暗/色彩/疏密）；画面要饱满不乱；留白克制（为突出主体，不是为了空）。',
    '错误做法：信息太多、画面太乱。'
].join('\n');

const CONVERSION_IMAGE = [
    '转化图核心任务：让已点进来的用户相信产品值得买。',
    '设计公式：转化图 = 痛点 + 解决方案 + 卖点说明 + 场景展示 + 信任背书（用户问题 → 产品卖点 → 事实说明 → 使用场景 → 下单理由）。',
    '需求层级（由低到高思考）：功能（能不能用）→ 安全（靠不靠谱）→ 便捷（方不方便）→ 舒适（用着舒服吗）→ 审美（好不好看）→ 情绪/身份（符合我想要的状态吗）。',
    '内容顺序：第1张讲痛点；第2张讲核心卖点；第3张讲产品事实（材质/结构/参数/对比）；第4张讲体验（舒适度/使用感/细节）；第5张讲场景（日常/通勤/居家/外出/送礼）；第6张讲信任（品牌/售后/检测/评价）；第7张讲购买理由（套装/价格/季节/现在买的理由）。',
    '判断要点：用户需求、过去踩过的坑（痛点）、犹豫原因（顾虑）、产品如何解决、卖点的事实依据、隐性需求、与竞品差异。',
    '错误做法：卖点堆砌、没有事实支持。'
].join('\n');

const SELLING_POINTS = [
    '有效卖点 = 产品优势 + 用户在意 + 竞品不突出。产品有但用户不关心，不算强卖点；竞品都有，不能作为核心差异化。',
    '提炼六问：产品有什么（材质/结构/功能/工艺/颜色/款式）？用户在意什么（舒适/好看/便宜/耐用/安全/方便）？用户怕什么（掉色/起球/掉跟/勒脚/闷热/踩坑）？竞品在强调什么？我们怎么更具体、更真实、更有画面感？这个卖点能否用图片/对比/特写视觉化？',
    '点击图只抓一个核心卖点；转化图多卖点分层展开。'
].join('\n');

const REVIEW_CHECKLIST = [
    '点击图检查：用户能不能一眼看懂卖什么？有没有一个明确点击理由？画面有没有对比和吸引力？文案是否短而有力？产品是否足够突出？',
    '转化图检查：有没有解决用户需求？有没有讲清楚用户痛点？卖点是否有事实支持？有没有体现差异化？有没有降低用户下单顾虑？',
    '两者区别速查：点击图信息量少/文案短强直接/视觉抢注意力/只抓一个核心点；转化图信息量多/文案有逻辑有证明/视觉建立信任/多卖点分层。'
].join('\n');

const SECTIONS: Record<MainImageFrameworkFocus, { title: string; content: string }> = {
    overview: { title: '主图总定义与分析流程', content: OVERVIEW },
    click: { title: '点击图结构与版式原则', content: CLICK_IMAGE },
    conversion: { title: '转化图结构与内容顺序', content: CONVERSION_IMAGE },
    'selling-points': { title: '卖点提炼结构', content: SELLING_POINTS },
    review: { title: '主图评审检查标准', content: REVIEW_CHECKLIST }
};

/**
 * 按焦点取主图框架内容；不传焦点返回全量（带小标题）。
 */
export function buildMainImageFrameworkSummary(focus?: MainImageFrameworkFocus | 'all'): string {
    if (focus && focus !== 'all' && SECTIONS[focus]) {
        const section = SECTIONS[focus];
        return `## ${section.title}\n${section.content}`;
    }
    return (Object.keys(SECTIONS) as MainImageFrameworkFocus[])
        .map((key) => `## ${SECTIONS[key].title}\n${SECTIONS[key].content}`)
        .join('\n\n');
}

export const MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES: Array<MainImageFrameworkFocus | 'all'> = [
    'all', 'overview', 'click', 'conversion', 'selling-points', 'review'
];
