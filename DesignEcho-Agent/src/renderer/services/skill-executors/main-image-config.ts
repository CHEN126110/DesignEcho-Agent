export interface MainImageSpec {
    imageType: string;
    designPrinciples: string[];
    dos: string[];
    donts: string[];
    productRatio?: { min: number; max: number };
    recommendedSections?: string[];
    requiredSections?: string[];
}

export interface PlatformRules {
    platform: string;
    rules: string[];
    sizes: Array<{ width: number; height: number; name: string }>;
}

const MAIN_IMAGE_FALLBACK_SPEC: Record<string, MainImageSpec> = {
    click: {
        imageType: 'click',
        designPrinciples: [
            '优先建立第一眼点击动机',
            '文案、图像和卖点要一一对应',
            '保持短句表达和清晰留白'
        ],
        dos: ['突出核心利益点', '保留主体识别度', '让画面能证明文案'],
        donts: ['堆砌口号', '过度装饰', '使用无事实支持的夸张描述'],
        productRatio: { min: 0.58, max: 0.72 },
        recommendedSections: ['点击图 01', '点击图 02'],
        requiredSections: ['点击图 01']
    },
    conversion: {
        imageType: 'conversion',
        designPrinciples: [
            '优先消除顾虑并强化购买理由',
            '每屏聚焦一个卖点',
            '图文关系必须明确'
        ],
        dos: ['覆盖材质和功能', '明确对比结果', '用场景辅助转化'],
        donts: ['泛泛而谈', '脱离画面空喊卖点'],
        productRatio: { min: 0.55, max: 0.7 },
        recommendedSections: ['材质面料', '核心卖点', '弹力功能', '穿搭场景'],
        requiredSections: ['材质面料', '核心卖点']
    },
    'white-bg': {
        imageType: 'white-bg',
        designPrinciples: ['保持商品主体完整清晰', '弱化装饰，强调商品本体'],
        dos: ['背景纯净', '边缘干净', '信息克制'],
        donts: ['复杂背景', '大段文案'],
        productRatio: { min: 0.62, max: 0.82 },
        recommendedSections: ['白底主图'],
        requiredSections: ['白底主图']
    }
};

const PLATFORM_RULES: Record<string, PlatformRules> = {
    taobao: {
        platform: 'taobao',
        rules: ['主图信息要聚焦', '首屏避免信息过密', '卖点需要快速识别'],
        sizes: [{ width: 800, height: 800, name: '主图方图' }]
    },
    tmall: {
        platform: 'tmall',
        rules: ['强调品质感和品牌秩序', '避免过度促销化堆叠'],
        sizes: [{ width: 800, height: 800, name: '主图方图' }]
    },
    jd: {
        platform: 'jd',
        rules: ['强调卖点直接和利益点清晰', '主体边缘和白底质量要稳定'],
        sizes: [{ width: 800, height: 800, name: '主图方图' }]
    }
};

export async function getMainImageSpec(imageType: string, _platform?: string): Promise<MainImageSpec | null> {
    const key = String(imageType || '').toLowerCase();
    return MAIN_IMAGE_FALLBACK_SPEC[key] || MAIN_IMAGE_FALLBACK_SPEC.click;
}

export async function getPlatformRules(platform: string): Promise<PlatformRules | null> {
    const key = String(platform || '').toLowerCase();
    return PLATFORM_RULES[key] || null;
}
