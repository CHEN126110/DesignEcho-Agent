export type CopywritingTemplateId =
    | 'visual-carry'
    | 'scene-empathy'
    | 'pain-relief'
    | 'emotion-identity'
    | 'function-benefit';

export interface CopywritingFrameworkTemplate {
    id: CopywritingTemplateId;
    name: string;
    suitableFor: string;
    formula: string;
    examples: string[];
}

export interface CopywritingScoreCriterion {
    id: string;
    label: string;
    points: number;
    question: string;
}

export interface CopywritingSafetyRule {
    id: string;
    risk: string;
    avoid: string[];
    saferDirection: string;
}

export interface CopywritingContextChecklistInput {
    hasImage?: boolean;
    hasTargetAudience?: boolean;
    hasAudienceInterest?: boolean;
    hasVisualAnchors?: boolean;
    hasProductFacts?: boolean;
    hasUserScene?: boolean;
    hasProductProblem?: boolean;
}

export interface CopywritingContextChecklistResult {
    ready: boolean;
    missing: string[];
    rules: string[];
}

export const COPYWRITING_CORE_FORMULA = '目标人群 + 兴趣方向 + 图片真实信息 + 用户使用场景 + 产品解决的问题 + 有记忆点的表达';

export const COPYWRITING_PROCESS = [
    '人群设定',
    '兴趣方向',
    '场景代入',
    '痛点转译',
    '情绪表达',
    '产品卖点',
    '事实核对',
    '图文匹配',
    '轻行动引导',
    '风险检查'
] as const;

export const COPYWRITING_PISBFC = [
    'People 人群：谁使用、谁购买、谁决策、谁影响，先明确文案写给谁。',
    'Interest 兴趣：判断这类人会被什么审美、场景、情绪、功能或身份内容吸引。',
    'Scene 场景：把产品放进真实使用场景，避免“多场景适用”这种空话。',
    'Benefit 利益：把产品卖点翻译成用户能感受到的状态改善。',
    'Facts 事实：核对材质、结构、功能细节、图片可见信息和用户已提供信息。',
    'Conversion 转化：用轻行动引导，不逼单，不制造购买压力。'
] as const;

export const COPYWRITING_LAYER_RULES = [
    {
        layer: '写给谁',
        purpose: '先判断产品背后对应的人群和关系人，文案不能写给所有人。',
        focus: '使用者、购买者、决策者、影响者、生活状态、审美偏好、消费心理。'
    },
    {
        layer: '为什么在意',
        purpose: '找到目标人群会被什么内容吸引，再决定表达方向。',
        focus: '审美兴趣、场景兴趣、情绪兴趣、功能兴趣、身份兴趣、社交兴趣、安心兴趣。'
    },
    {
        layer: '看得见',
        purpose: '和图片有关，文案不能脱离画面。',
        focus: '人物状态、动作、场景、氛围、产品露出、产品细节。'
    },
    {
        layer: '想得到',
        purpose: '和用户场景有关，让用户能代入。',
        focus: '通勤、约会、旅行、居家、运动、久走、雨天、夏天等真实使用场景。'
    },
    {
        layer: '信得过',
        purpose: '和产品功能有关，把卖点翻译成用户感受。',
        focus: '轻便=不累，透气=不闷，防滑=安心，好搭=少纠结。'
    },
    {
        layer: '记得住',
        purpose: '和语言表现力有关，让句子短、顺、有画面、有分寸。',
        focus: '自然表达、轻微转折、生活瞬间，而不是广告口号。'
    }
] as const;

export const COPYWRITING_TEMPLATES: CopywritingFrameworkTemplate[] = [
    {
        id: 'visual-carry',
        name: '视觉承接型',
        suitableFor: '图片氛围明显、人物状态清晰、产品露出自然。',
        formula: '[画面气质]，也可以[产品功能/使用状态]。',
        examples: ['甜美，也可以随时开跑。', '好看，不必牺牲舒服。', '松弛一点，状态反而更好。']
    },
    {
        id: 'scene-empathy',
        name: '场景共鸣型',
        suitableFor: '日常使用品类，需要让用户代入具体生活场景。',
        formula: '[具体场景]，也能[理想状态]。',
        examples: ['通勤路上，也要走得轻松。', '周末出门，不用在好看和舒服之间选。', '一整天在外，也要保持自在。']
    },
    {
        id: 'pain-relief',
        name: '痛点化解型',
        suitableFor: '用户有怕累、怕闷、怕不好搭、怕麻烦等顾虑。',
        formula: '不用[用户顾虑]，也能[理想结果]。',
        examples: ['不用为了好看，委屈舒服。', '久走的日子，也可以轻松一点。', '不用复杂搭配，也能轻松出门。']
    },
    {
        id: 'emotion-identity',
        name: '情绪认同型',
        suitableFor: '品牌要传递态度、生活方式或审美感。',
        formula: '[一种生活态度] + [产品带来的支持]。',
        examples: ['今天不赶路，只跟着心情走。', '喜欢好看的，也喜欢好走的。', '慢慢走，也是在认真生活。']
    },
    {
        id: 'function-benefit',
        name: '功能佐证型',
        suitableFor: '产品有明确功能卖点，需要降低广告感并提高可信度。',
        formula: '[产品功能] -> [用户感受]。',
        examples: ['脚步轻了，路就没那么长。', '闷热的天气，也给双脚留点呼吸感。', '每一步都稳，才敢走得更自在。']
    }
];

export const COPYWRITING_SCORE_CRITERIA: CopywritingScoreCriterion[] = [
    { id: 'audience-clarity', label: '人群清晰度', points: 15, question: '是否明确写给哪类人，而不是写给所有人？' },
    { id: 'interest-match', label: '兴趣匹配度', points: 15, question: '是否抓住这类人的内容兴趣和审美偏好？' },
    { id: 'scene-empathy', label: '场景代入感', points: 15, question: '是否能让用户联想到自己的真实生活？' },
    { id: 'product-relevance', label: '产品相关性', points: 15, question: '是否真正围绕产品特点，而不是空泛表达？' },
    { id: 'emotion-resonance', label: '情绪共鸣', points: 10, question: '是否让用户产生认同、向往或舒服感？' },
    { id: 'fact-consistency', label: '事实可信度', points: 10, question: '功能细节、使用场景或真实体验是否与已有信息一致？' },
    { id: 'visual-link', label: '图文匹配', points: 10, question: '是否和图片中的人、状态、场景、氛围一致？' },
    { id: 'safety', label: '风险控制', points: 10, question: '是否避免冒犯、负面联想、夸张承诺和不适画面？' }
];

export const COPYWRITING_SAFETY_RULES: CopywritingSafetyRule[] = [
    {
        id: 'body-food',
        risk: '身体部位和食物组合容易产生不适联想。',
        avoid: ['脚像面包一样柔软', '袜子像奶油一样贴肤'],
        saferDirection: '改写成使用感受，例如“走久一点，也少一点负担”。'
    },
    {
        id: 'dirty-disease',
        risk: '脏污、疾病、疼痛词会降低美感并制造焦虑。',
        avoid: ['臭脚', '脚气', '烂脚', '痛到崩溃', '汗黏'],
        saferDirection: '用温和表达，例如“闷热天气，也让脚步清爽一点”。'
    },
    {
        id: 'shaming',
        risk: '羞辱用户会引发反感。',
        avoid: ['穿错鞋显廉价', '不会搭配很土'],
        saferDirection: '改成支持式表达，例如“简单一搭，出门就有状态”。'
    },
    {
        id: 'overclaim',
        risk: '夸张承诺会降低可信度。',
        avoid: ['立刻瘦十斤', '永远不累', '任何人都适合'],
        saferDirection: '改成有分寸的使用感，例如“走久一点，也不必太累”。'
    },
    {
        id: 'hard-sell',
        risk: '命令式逼单会增加广告感。',
        avoid: ['赶快购买', '女生必须拥有', '不买就亏'],
        saferDirection: '改成生活选择，例如“给日常多一个舒服选择”。'
    }
];

export function buildCopywritingContextChecklist(
    input: CopywritingContextChecklistInput
): CopywritingContextChecklistResult {
    const missing: string[] = [];
    if (!input.hasTargetAudience) {
        missing.push('缺少目标人群，不能默认所有人都会被同一套表达打动。');
    }
    if (!input.hasAudienceInterest) {
        missing.push('缺少人群兴趣方向，文案容易只围绕产品自说自话。');
    }
    if (!input.hasImage && !input.hasVisualAnchors) {
        missing.push('缺少图片或视觉锚点，不能编造画面状态。');
    }
    if (!input.hasProductFacts) {
        missing.push('缺少产品事实或卖点依据，不能凭空承诺功能。');
    }
    if (!input.hasUserScene) {
        missing.push('缺少用户使用场景，文案容易空泛。');
    }
    if (!input.hasProductProblem) {
        missing.push('缺少产品解决的问题或用户真实需求，文案容易只是在夸产品。');
    }

    return {
        ready: missing.length === 0,
        missing,
        rules: [
            '先判断写给谁，再判断这类人会被什么内容吸引。',
            '人群不明确时，只能写克制的通用表达，不得假设具体身份、年龄、性别或生活方式。',
            '先从图片提取视觉锚点，再写文案。',
            '没有图片可见信息时，只能写用户已提供或产品事实能支持的内容。',
            '缺少人群、视觉锚点、产品事实或用户场景时不能编造，只能标记信息不足或请求补充信息。',
            '产品卖点必须翻译成用户感受，不直接堆参数。',
            '信息不足时输出需要补充的内容，而不是一本正经地胡说。'
        ]
    };
}

export function formatCopywritingFrameworkForPrompt(): string {
    return [
        '【图文文案撰写框架】',
        `核心公式：${COPYWRITING_CORE_FORMULA}`,
        `工作顺序：${COPYWRITING_PROCESS.join(' -> ')}。`,
        'P-I-S-B-F-C：人群是谁 -> 兴趣是什么 -> 场景在哪里 -> 利益是什么 -> 已知事实是什么 -> 如何轻引导。',
        ...COPYWRITING_PISBFC.map(item => `- ${item}`),
        '',
        '【必须先判断上下文】',
        '1. 目标人群：先判断产品写给谁，使用者、购买者、决策者和影响者可能不同。',
        '2. 兴趣方向：判断这类人会被审美、场景、情绪、功能、身份、社交还是安心内容吸引。',
        '3. 图片真实信息：先找人物状态、动作、场景、氛围、产品露出和产品细节。',
        '4. 用户使用场景：通勤、约会、旅行、居家、运动、久走、雨天、夏天等，必须能被图片或用户信息支撑。',
        '5. 产品解决的问题：轻便=少负担，透气=不闷，防滑=安心，好搭=少纠结；不要只堆功能词。',
        '6. 有记忆点的表达：短、顺、有画面、有分寸，不要广告腔。',
        '',
        '【推荐模板】',
        ...COPYWRITING_TEMPLATES.map((template) => [
            `- ${template.name}: ${template.formula}`,
            `  适用：${template.suitableFor}`,
            `  示例：${template.examples.join(' / ')}`
        ].join('\n')),
        '',
        '【安全检查】',
        ...COPYWRITING_SAFETY_RULES.map((rule) => `- ${rule.risk} 避免：${rule.avoid.join(' / ')}。建议：${rule.saferDirection}`),
        '',
        '【评分标准】',
        ...COPYWRITING_SCORE_CRITERIA.map((item) => `- ${item.label} ${item.points}分：${item.question}`),
        '',
        '输出文案前必须自检：人群、兴趣、场景、产品、情绪、事实、图文、风险。低于 70 分应重写。'
    ].join('\n');
}

export function formatCopywritingFrameworkForKnowledge(): string {
    return [
        `核心公式：${COPYWRITING_CORE_FORMULA}`,
        `工作流：${COPYWRITING_PROCESS.join(' -> ')}。`,
        'P-I-S-B-F-C：People、Interest、Scene、Benefit、Facts、Conversion。',
        `模板：${COPYWRITING_TEMPLATES.map((item) => item.name).join('、')}。`,
        '边界：没有目标人群、图片可见信息或产品事实时，不允许编造人群身份、画面、功能或用户痛点。'
    ].join(' ');
}
