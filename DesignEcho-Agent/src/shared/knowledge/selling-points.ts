/**
 * 袜子类目核心卖点库
 * 
 * 50+ 条电商文案卖点，用于 Agent 智能生成设计文案
 */

// ===== 类型定义 =====

/** 卖点条目 */
export interface SellingPoint {
    id: string;
    /** 卖点标题（短语，适合标签） */
    title: string;
    /** 卖点描述（一句话） */
    description: string;
    /** 详细说明（可选） */
    detail?: string;
    /** 适用类目 */
    categories: string[];
    /** 适用场景 */
    scenes: string[];
    /** 关联关键词 */
    keywords: string[];
    /** 卖点类型 */
    type: 'material' | 'function' | 'comfort' | 'design' | 'quality' | 'health';
    /** 优先级 (1-5，5最高) */
    priority: number;
    /** 适合的标签样式 */
    labelStyle?: 'badge' | 'tag' | 'banner' | 'icon';
    /** 推荐配色 */
    suggestedColors?: string[];
}

// ===== 材质类卖点 =====

const MATERIAL_POINTS: SellingPoint[] = [
    {
        id: 'sp-m01',
        title: '100%纯棉',
        description: '精选优质纯棉，柔软亲肤不刺激',
        detail: '采用新疆长绒棉，纤维长度超过33mm，手感更柔软',
        categories: ['all'],
        scenes: ['日常', '贴身'],
        keywords: ['纯棉', '全棉', '棉'],
        type: 'material',
        priority: 5,
        labelStyle: 'badge',
        suggestedColors: ['#4CAF50', '#8BC34A']
    },
    {
        id: 'sp-m02',
        title: '精梳棉',
        description: '精梳工艺去除短纤，更加柔软不起球',
        categories: ['crew', 'kids'],
        scenes: ['高端', '舒适'],
        keywords: ['精梳', '长绒棉', '高支'],
        type: 'material',
        priority: 4,
        labelStyle: 'badge'
    },
    {
        id: 'sp-m03',
        title: '竹纤维抗菌',
        description: '天然竹纤维，抑菌除臭更健康',
        detail: '竹纤维含有"竹琨"抗菌因子，抑菌率达95%以上',
        categories: ['crew', 'ankle', 'toe'],
        scenes: ['夏季', '运动', '商务'],
        keywords: ['竹纤维', '抗菌', '除臭'],
        type: 'material',
        priority: 4,
        labelStyle: 'badge',
        suggestedColors: ['#009688', '#4DB6AC']
    },
    {
        id: 'sp-m04',
        title: '羊毛保暖',
        description: '澳洲美利奴羊毛，温暖不扎脚',
        categories: ['wool', 'crew'],
        scenes: ['冬季', '保暖'],
        keywords: ['羊毛', '保暖', '冬季'],
        type: 'material',
        priority: 5,
        labelStyle: 'badge',
        suggestedColors: ['#795548', '#A1887F']
    },
    {
        id: 'sp-m05',
        title: '冰丝凉感',
        description: '冰丝面料，接触凉感降温3-5℃',
        categories: ['ankle', 'silk'],
        scenes: ['夏季', '清凉'],
        keywords: ['冰丝', '凉感', '夏季'],
        type: 'material',
        priority: 4,
        labelStyle: 'badge',
        suggestedColors: ['#03A9F4', '#4FC3F7']
    },
    {
        id: 'sp-m06',
        title: '莫代尔丝滑',
        description: '莫代尔面料，丝绸般顺滑触感',
        categories: ['crew', 'silk'],
        scenes: ['舒适', '高端'],
        keywords: ['莫代尔', '丝滑', '柔软'],
        type: 'material',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-m07',
        title: 'A类婴儿级',
        description: '符合A类标准，婴儿可直接接触皮肤',
        categories: ['kids', 'ankle'],
        scenes: ['婴儿', '敏感肌'],
        keywords: ['A类', '婴儿级', '安全'],
        type: 'material',
        priority: 5,
        labelStyle: 'badge',
        suggestedColors: ['#E91E63', '#F48FB1']
    },
    {
        id: 'sp-m08',
        title: '有机棉',
        description: '有机认证棉花，无农药无化肥更安心',
        categories: ['kids', 'crew'],
        scenes: ['婴儿', '环保'],
        keywords: ['有机棉', '天然', '环保'],
        type: 'material',
        priority: 4,
        labelStyle: 'badge',
        suggestedColors: ['#8BC34A', '#AED581']
    }
];

// ===== 功能类卖点 =====

const FUNCTION_POINTS: SellingPoint[] = [
    {
        id: 'sp-f01',
        title: '吸汗速干',
        description: '高效吸湿排汗，时刻保持干爽',
        categories: ['crew', 'ankle', 'toe'],
        scenes: ['运动', '夏季', '户外'],
        keywords: ['吸汗', '速干', '排汗'],
        type: 'function',
        priority: 4,
        labelStyle: 'badge',
        suggestedColors: ['#2196F3', '#64B5F6']
    },
    {
        id: 'sp-f02',
        title: '防臭抗菌',
        description: '银离子抗菌技术，有效抑制脚臭',
        detail: '添加银离子抗菌剂，抑菌率99%，洗涤50次不减效',
        categories: ['all'],
        scenes: ['日常', '运动', '商务'],
        keywords: ['防臭', '抗菌', '银离子'],
        type: 'function',
        priority: 5,
        labelStyle: 'badge',
        suggestedColors: ['#607D8B', '#90A4AE']
    },
    {
        id: 'sp-f03',
        title: '硅胶防滑',
        description: '后跟硅胶防滑设计，走路不掉跟',
        categories: ['ankle'],
        scenes: ['隐形袜', '高跟鞋'],
        keywords: ['防滑', '不掉跟', '硅胶'],
        type: 'function',
        priority: 5,
        labelStyle: 'tag',
        suggestedColors: ['#9C27B0', '#CE93D8']
    },
    {
        id: 'sp-f04',
        title: '加厚毛圈',
        description: '底部毛圈加厚，减震防磨更舒适',
        categories: ['crew', 'ankle'],
        scenes: ['运动', '跑步', '健身'],
        keywords: ['毛圈', '加厚', '减震'],
        type: 'function',
        priority: 4,
        labelStyle: 'tag'
    },
    {
        id: 'sp-f05',
        title: '360°包裹',
        description: '全方位弹力包裹，贴合不勒脚',
        categories: ['ankle', 'crew'],
        scenes: ['舒适', '运动'],
        keywords: ['包裹', '弹力', '贴合'],
        type: 'function',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-f06',
        title: '网眼透气',
        description: '透气网眼设计，清爽一整天',
        categories: ['ankle', 'crew'],
        scenes: ['夏季', '运动'],
        keywords: ['透气', '网眼', '清爽'],
        type: 'function',
        priority: 4,
        labelStyle: 'tag',
        suggestedColors: ['#00BCD4', '#4DD0E1']
    },
    {
        id: 'sp-f07',
        title: '久站不累',
        description: '梯度压力设计，久站不疲劳',
        categories: ['knee-high', 'crew'],
        scenes: ['久站', '工作', '护士'],
        keywords: ['压力', '久站', '不累'],
        type: 'function',
        priority: 4,
        labelStyle: 'badge'
    },
    {
        id: 'sp-f08',
        title: '防勾丝',
        description: '高密度编织，不易勾丝起球',
        categories: ['silk', 'knee-high'],
        scenes: ['丝袜', '正装'],
        keywords: ['防勾丝', '不起球', '耐穿'],
        type: 'function',
        priority: 4,
        labelStyle: 'tag'
    },
    {
        id: 'sp-f09',
        title: '不起球',
        description: '优质纤维，洗涤50次不起球',
        categories: ['all'],
        scenes: ['日常', '耐用'],
        keywords: ['不起球', '耐穿', '持久'],
        type: 'function',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-f10',
        title: '速干免烫',
        description: '快速晾干，无需熨烫直接穿',
        categories: ['crew', 'ankle'],
        scenes: ['出差', '便捷'],
        keywords: ['速干', '免烫', '便捷'],
        type: 'function',
        priority: 2,
        labelStyle: 'tag'
    }
];

// ===== 舒适类卖点 =====

const COMFORT_POINTS: SellingPoint[] = [
    {
        id: 'sp-c01',
        title: '无骨缝头',
        description: '无骨缝合技术，脚趾零压力',
        detail: '采用手工对目缝合，无凸起缝线，穿着更舒适',
        categories: ['all'],
        scenes: ['舒适', '敏感肌'],
        keywords: ['无骨', '缝头', '舒适'],
        type: 'comfort',
        priority: 5,
        labelStyle: 'badge',
        suggestedColors: ['#FF9800', '#FFB74D']
    },
    {
        id: 'sp-c02',
        title: '宽松袜口',
        description: '宽松不勒设计，血液循环更通畅',
        categories: ['crew', 'knee-high'],
        scenes: ['孕妇', '老人', '糖尿病'],
        keywords: ['宽松', '不勒', '松口'],
        type: 'comfort',
        priority: 4,
        labelStyle: 'tag'
    },
    {
        id: 'sp-c03',
        title: '人体工学',
        description: '人体工学设计，完美贴合足弓',
        categories: ['crew', 'ankle'],
        scenes: ['运动', '专业'],
        keywords: ['人体工学', '足弓', '贴合'],
        type: 'comfort',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-c04',
        title: '柔软亲肤',
        description: '柔软触感，如云朵般亲肤',
        categories: ['all'],
        scenes: ['舒适', '日常'],
        keywords: ['柔软', '亲肤', '舒适'],
        type: 'comfort',
        priority: 4,
        labelStyle: 'tag'
    },
    {
        id: 'sp-c05',
        title: '加宽袜底',
        description: '加宽袜底设计，大脚更舒适',
        categories: ['crew', 'ankle'],
        scenes: ['大码', '舒适'],
        keywords: ['加宽', '大码', '宽脚'],
        type: 'comfort',
        priority: 2,
        labelStyle: 'tag'
    },
    {
        id: 'sp-c06',
        title: '弹力舒适',
        description: '高弹莱卡添加，穿脱轻松不紧绷',
        categories: ['all'],
        scenes: ['舒适', '弹力'],
        keywords: ['弹力', '莱卡', '舒适'],
        type: 'comfort',
        priority: 3,
        labelStyle: 'tag'
    }
];

// ===== 设计类卖点 =====

const DESIGN_POINTS: SellingPoint[] = [
    {
        id: 'sp-d01',
        title: '隐形设计',
        description: '超低帮隐形设计，穿鞋看不见',
        categories: ['ankle'],
        scenes: ['时尚', '搭配'],
        keywords: ['隐形', '低帮', '看不见'],
        type: 'design',
        priority: 4,
        labelStyle: 'tag'
    },
    {
        id: 'sp-d02',
        title: '百搭款式',
        description: '经典纯色，百搭不挑鞋',
        categories: ['all'],
        scenes: ['日常', '百搭'],
        keywords: ['百搭', '纯色', '经典'],
        type: 'design',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-d03',
        title: '潮流印花',
        description: '原创潮流图案，时尚个性',
        categories: ['crew', 'ankle'],
        scenes: ['潮流', '个性'],
        keywords: ['潮流', '印花', '原创'],
        type: 'design',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-d04',
        title: '撞色设计',
        description: '大胆撞色拼接，吸睛不单调',
        categories: ['crew', 'ankle'],
        scenes: ['潮流', '运动'],
        keywords: ['撞色', '拼接', '时尚'],
        type: 'design',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-d05',
        title: '刺绣工艺',
        description: '精致刺绣logo，品质感加分',
        categories: ['crew'],
        scenes: ['高端', '品牌'],
        keywords: ['刺绣', '精致', '品质'],
        type: 'design',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-d06',
        title: '可爱卡通',
        description: '萌趣卡通图案，童心满满',
        categories: ['kids', 'crew'],
        scenes: ['儿童', '可爱'],
        keywords: ['卡通', '可爱', '萌趣'],
        type: 'design',
        priority: 3,
        labelStyle: 'tag',
        suggestedColors: ['#E91E63', '#FF4081']
    },
    {
        id: 'sp-d07',
        title: '显腿长',
        description: '竖条纹设计，视觉拉长腿部',
        categories: ['knee-high', 'thigh-high'],
        scenes: ['时尚', '显瘦'],
        keywords: ['显腿长', '条纹', '显瘦'],
        type: 'design',
        priority: 3,
        labelStyle: 'tag'
    }
];

// ===== 品质类卖点 =====

const QUALITY_POINTS: SellingPoint[] = [
    {
        id: 'sp-q01',
        title: '国际品质',
        description: '通过国际SGS检测认证',
        categories: ['all'],
        scenes: ['品质', '信任'],
        keywords: ['SGS', '认证', '品质'],
        type: 'quality',
        priority: 4,
        labelStyle: 'badge'
    },
    {
        id: 'sp-q02',
        title: '双线缝制',
        description: '双线加固缝制，更加结实耐穿',
        categories: ['all'],
        scenes: ['耐穿', '品质'],
        keywords: ['双线', '加固', '耐穿'],
        type: 'quality',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-q03',
        title: '200针高密',
        description: '200针高密度编织，质感更佳',
        categories: ['crew', 'ankle'],
        scenes: ['品质', '高端'],
        keywords: ['高密度', '200针', '精细'],
        type: 'quality',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-q04',
        title: '出口品质',
        description: '外贸出口品质，内销同享',
        categories: ['all'],
        scenes: ['品质', '信任'],
        keywords: ['出口', '外贸', '品质'],
        type: 'quality',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-q05',
        title: '加厚耐磨',
        description: '脚跟脚尖加厚，久穿不破',
        categories: ['crew', 'ankle'],
        scenes: ['耐穿', '运动'],
        keywords: ['加厚', '耐磨', '不破'],
        type: 'quality',
        priority: 4,
        labelStyle: 'tag'
    },
    {
        id: 'sp-q06',
        title: '环保染色',
        description: '环保活性染料，不褪色不掉色',
        categories: ['all'],
        scenes: ['环保', '耐穿'],
        keywords: ['环保', '不褪色', '活性染'],
        type: 'quality',
        priority: 3,
        labelStyle: 'tag'
    }
];

// ===== 健康类卖点 =====

const HEALTH_POINTS: SellingPoint[] = [
    {
        id: 'sp-h01',
        title: '分趾健康',
        description: '五指分趾设计，预防脚气更健康',
        categories: ['toe'],
        scenes: ['健康', '养生'],
        keywords: ['分趾', '五指', '健康'],
        type: 'health',
        priority: 4,
        labelStyle: 'badge'
    },
    {
        id: 'sp-h02',
        title: '促进循环',
        description: '梯度压力促进血液循环',
        categories: ['knee-high'],
        scenes: ['健康', '久站'],
        keywords: ['循环', '压力', '健康'],
        type: 'health',
        priority: 4,
        labelStyle: 'badge'
    },
    {
        id: 'sp-h03',
        title: '足底按摩',
        description: '凸点按摩设计，缓解足部疲劳',
        categories: ['crew'],
        scenes: ['按摩', '养生'],
        keywords: ['按摩', '凸点', '缓解'],
        type: 'health',
        priority: 2,
        labelStyle: 'tag'
    },
    {
        id: 'sp-h04',
        title: '矫正足弓',
        description: '足弓支撑设计，矫正扁平足',
        categories: ['crew'],
        scenes: ['矫正', '健康'],
        keywords: ['足弓', '矫正', '支撑'],
        type: 'health',
        priority: 3,
        labelStyle: 'tag'
    },
    {
        id: 'sp-h05',
        title: '防静电',
        description: '防静电纤维，冬季不电人',
        categories: ['all'],
        scenes: ['冬季', '舒适'],
        keywords: ['防静电', '冬季', '舒适'],
        type: 'health',
        priority: 2,
        labelStyle: 'tag'
    }
];

// ===== 合并所有卖点 =====

export const ALL_SELLING_POINTS: SellingPoint[] = [
    ...MATERIAL_POINTS,
    ...FUNCTION_POINTS,
    ...COMFORT_POINTS,
    ...DESIGN_POINTS,
    ...QUALITY_POINTS,
    ...HEALTH_POINTS
];

// ===== 工具函数 =====

/**
 * 根据类目获取适用卖点
 */
export function getPointsByCategory(categoryId: string): SellingPoint[] {
    return ALL_SELLING_POINTS.filter(p => 
        p.categories.includes('all') || p.categories.includes(categoryId)
    );
}

/**
 * 根据场景获取卖点
 */
export function getPointsByScene(scene: string): SellingPoint[] {
    const sceneLower = scene.toLowerCase();
    return ALL_SELLING_POINTS.filter(p => 
        p.scenes.some(s => s.toLowerCase().includes(sceneLower))
    );
}

/**
 * 根据类型获取卖点
 */
export function getPointsByType(type: SellingPoint['type']): SellingPoint[] {
    return ALL_SELLING_POINTS.filter(p => p.type === type);
}

/**
 * 搜索卖点
 */
export function searchSellingPoints(keyword: string): SellingPoint[] {
    const keywordLower = keyword.toLowerCase();
    return ALL_SELLING_POINTS.filter(p => 
        p.title.toLowerCase().includes(keywordLower) ||
        p.description.toLowerCase().includes(keywordLower) ||
        p.keywords.some(k => k.toLowerCase().includes(keywordLower))
    );
}

/**
 * 获取推荐卖点（按优先级）
 */
export function getTopSellingPoints(categoryId: string, limit: number = 5): SellingPoint[] {
    const points = getPointsByCategory(categoryId);
    return points.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

/**
 * 随机获取卖点组合（避免重复）
 */
export function getRandomPointsCombination(
    categoryId: string, 
    count: number = 3
): SellingPoint[] {
    const points = getPointsByCategory(categoryId);
    const shuffled = [...points].sort(() => Math.random() - 0.5);
    
    // 尝试获取不同类型的卖点
    const result: SellingPoint[] = [];
    const usedTypes = new Set<string>();
    
    for (const point of shuffled) {
        if (!usedTypes.has(point.type)) {
            result.push(point);
            usedTypes.add(point.type);
        }
        if (result.length >= count) break;
    }
    
    // 如果类型不够，补充高优先级的
    if (result.length < count) {
        const remaining = shuffled.filter(p => !result.includes(p));
        result.push(...remaining.slice(0, count - result.length));
    }
    
    return result;
}

export default {
    all: ALL_SELLING_POINTS,
    material: MATERIAL_POINTS,
    function: FUNCTION_POINTS,
    comfort: COMFORT_POINTS,
    design: DESIGN_POINTS,
    quality: QUALITY_POINTS,
    health: HEALTH_POINTS,
    getPointsByCategory,
    getPointsByScene,
    getPointsByType,
    searchSellingPoints,
    getTopSellingPoints,
    getRandomPointsCombination
};
