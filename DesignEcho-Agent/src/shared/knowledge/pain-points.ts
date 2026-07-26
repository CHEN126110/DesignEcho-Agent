/**
 * 用户痛点库
 * 
 * 30+ 条用户购买袜子时关注的痛点，用于 Agent 智能匹配解决方案
 */

// ===== 类型定义 =====

/** 痛点条目 */
export interface PainPoint {
    id: string;
    /** 痛点标题（简短描述） */
    title: string;
    /** 痛点场景描述 */
    scenario: string;
    /** 用户心声（第一人称） */
    userVoice: string;
    /** 解决方案标题 */
    solutionTitle: string;
    /** 解决方案描述 */
    solutionDescription: string;
    /** 适用类目 */
    categories: string[];
    /** 痛点类型 */
    type: 'comfort' | 'durability' | 'hygiene' | 'function' | 'appearance' | 'health';
    /** 严重程度 (1-5，5最严重) */
    severity: number;
    /** 解决方案关联的卖点ID */
    relatedSellingPoints: string[];
    /** 设计建议 */
    designSuggestion: {
        /** 建议的视觉元素 */
        visualElements: string[];
        /** 建议的配色风格 */
        colorStyle: string;
        /** 文案风格 */
        copyStyle: string;
    };
}

// ===== 舒适性痛点 =====

const COMFORT_PAIN_POINTS: PainPoint[] = [
    {
        id: 'pp-c01',
        title: '袜子勒脚踝',
        scenario: '穿了一天袜子，脚踝被勒出红印',
        userVoice: '每次脱袜子都能看到深深的红印，太难受了',
        solutionTitle: '宽松袜口不勒脚',
        solutionDescription: '采用宽松弹力袜口设计，贴合不紧绷，告别勒痕',
        categories: ['crew', 'knee-high'],
        type: 'comfort',
        severity: 4,
        relatedSellingPoints: ['sp-c02', 'sp-c06'],
        designSuggestion: {
            visualElements: ['对比图（勒痕vs无勒痕）', '弹力示意图'],
            colorStyle: '温和舒适色调',
            copyStyle: '场景化描述'
        }
    },
    {
        id: 'pp-c02',
        title: '脚趾不舒服',
        scenario: '袜子缝合线硌脚趾',
        userVoice: '新买的袜子脚趾头那里总有条线硌得慌',
        solutionTitle: '无骨缝头零压力',
        solutionDescription: '手工对目缝合，无凸起缝线，脚趾舒适无压力',
        categories: ['all'],
        type: 'comfort',
        severity: 5,
        relatedSellingPoints: ['sp-c01'],
        designSuggestion: {
            visualElements: ['工艺对比图', '脚趾部位特写'],
            colorStyle: '专业品质感',
            copyStyle: '技术说明'
        }
    },
    {
        id: 'pp-c03',
        title: '船袜掉跟',
        scenario: '穿船袜走路老是往下掉',
        userVoice: '船袜穿着走几步就掉到脚底了，太烦人了',
        solutionTitle: '硅胶防滑不掉跟',
        solutionDescription: '后跟3D硅胶防滑设计，紧密贴合，全天不掉跟',
        categories: ['ankle'],
        type: 'comfort',
        severity: 5,
        relatedSellingPoints: ['sp-f03'],
        designSuggestion: {
            visualElements: ['硅胶特写', '穿着效果图'],
            colorStyle: '活力时尚',
            copyStyle: '场景化+功能说明'
        }
    },
    {
        id: 'pp-c04',
        title: '袜子太紧太松',
        scenario: '袜子要么太紧勒脚，要么太松会滑',
        userVoice: '找不到刚好合适的松紧度，好纠结',
        solutionTitle: '弹力适中刚刚好',
        solutionDescription: '高弹莱卡纤维，弹力均匀分布，贴合不紧绷',
        categories: ['all'],
        type: 'comfort',
        severity: 3,
        relatedSellingPoints: ['sp-c06', 'sp-f05'],
        designSuggestion: {
            visualElements: ['弹力测试图', '穿着贴合效果'],
            colorStyle: '舒适自然',
            copyStyle: '体验描述'
        }
    },
    {
        id: 'pp-c05',
        title: '脚冷',
        scenario: '冬天穿普通袜子脚还是很冷',
        userVoice: '穿了厚袜子脚还是冰凉的',
        solutionTitle: '羊毛加厚超保暖',
        solutionDescription: '澳洲美利奴羊毛+加厚毛圈，锁温保暖不再冷',
        categories: ['wool', 'crew'],
        type: 'comfort',
        severity: 4,
        relatedSellingPoints: ['sp-m04', 'sp-f04'],
        designSuggestion: {
            visualElements: ['保暖材质图', '温度对比'],
            colorStyle: '暖色调',
            copyStyle: '功能强调'
        }
    },
    {
        id: 'pp-c06',
        title: '脚热出汗',
        scenario: '夏天穿袜子脚闷热出汗',
        userVoice: '一穿袜子脚就出汗，黏糊糊的很不舒服',
        solutionTitle: '冰丝透气超清爽',
        solutionDescription: '冰丝面料+网眼透气，速干排汗不闷脚',
        categories: ['ankle', 'crew'],
        type: 'comfort',
        severity: 4,
        relatedSellingPoints: ['sp-m05', 'sp-f06', 'sp-f01'],
        designSuggestion: {
            visualElements: ['透气孔特写', '清爽效果图'],
            colorStyle: '清凉蓝绿色调',
            copyStyle: '清爽感描述'
        }
    }
];

// ===== 耐用性痛点 =====

const DURABILITY_PAIN_POINTS: PainPoint[] = [
    {
        id: 'pp-d01',
        title: '容易破洞',
        scenario: '袜子穿几次脚跟就破了',
        userVoice: '买的袜子总是脚后跟先破，太不耐穿了',
        solutionTitle: '加厚耐磨久穿不破',
        solutionDescription: '脚跟脚尖双层加厚，耐磨加固，穿一年不破洞',
        categories: ['all'],
        type: 'durability',
        severity: 5,
        relatedSellingPoints: ['sp-q05', 'sp-q02'],
        designSuggestion: {
            visualElements: ['加厚部位图', '耐磨测试'],
            colorStyle: '可靠稳重',
            copyStyle: '品质保证'
        }
    },
    {
        id: 'pp-d02',
        title: '起球严重',
        scenario: '洗几次就起毛球，影响美观',
        userVoice: '新买的袜子洗两次就起球了，看着像旧的',
        solutionTitle: '精梳棉不起球',
        solutionDescription: '精梳棉工艺去除短纤，洗涤50次依然如新',
        categories: ['all'],
        type: 'durability',
        severity: 4,
        relatedSellingPoints: ['sp-m02', 'sp-f09'],
        designSuggestion: {
            visualElements: ['面料对比', '洗涤后效果'],
            colorStyle: '清新整洁',
            copyStyle: '持久品质'
        }
    },
    {
        id: 'pp-d03',
        title: '褪色掉色',
        scenario: '深色袜子洗几次就褪色了',
        userVoice: '黑袜子变灰袜子了，颜色越洗越淡',
        solutionTitle: '环保染色不褪色',
        solutionDescription: '环保活性染料，色牢度4级，久洗如新',
        categories: ['all'],
        type: 'durability',
        severity: 3,
        relatedSellingPoints: ['sp-q06'],
        designSuggestion: {
            visualElements: ['色牢度测试', '洗涤对比'],
            colorStyle: '鲜艳持久',
            copyStyle: '科技说明'
        }
    },
    {
        id: 'pp-d04',
        title: '丝袜易勾丝',
        scenario: '丝袜穿一次就勾丝了',
        userVoice: '丝袜太娇气了，碰一下就抽丝',
        solutionTitle: '高密度防勾丝',
        solutionDescription: '300D高密度编织，T裆加固，不易勾丝',
        categories: ['silk'],
        type: 'durability',
        severity: 5,
        relatedSellingPoints: ['sp-f08'],
        designSuggestion: {
            visualElements: ['密度对比', '防勾丝测试'],
            colorStyle: '优雅精致',
            copyStyle: '技术说明'
        }
    }
];

// ===== 卫生类痛点 =====

const HYGIENE_PAIN_POINTS: PainPoint[] = [
    {
        id: 'pp-h01',
        title: '脚臭尴尬',
        scenario: '脱鞋时散发异味很尴尬',
        userVoice: '一脱鞋味道就出来了，在别人家特别尴尬',
        solutionTitle: '银离子长效防臭',
        solutionDescription: '银离子抗菌技术，抑制细菌滋生，从根源防臭',
        categories: ['all'],
        type: 'hygiene',
        severity: 5,
        relatedSellingPoints: ['sp-f02', 'sp-m03'],
        designSuggestion: {
            visualElements: ['抗菌原理图', '效果示意'],
            colorStyle: '清新干净',
            copyStyle: '科学解释'
        }
    },
    {
        id: 'pp-h02',
        title: '脚气反复',
        scenario: '袜子不透气导致脚气',
        userVoice: '穿袜子闷脚，脚气老是反反复复',
        solutionTitle: '透气抗菌防脚气',
        solutionDescription: '五指分趾+网眼透气+竹纤维抗菌，三重防护',
        categories: ['toe', 'ankle', 'crew'],
        type: 'hygiene',
        severity: 5,
        relatedSellingPoints: ['sp-h01', 'sp-f06', 'sp-m03'],
        designSuggestion: {
            visualElements: ['分趾设计图', '透气示意'],
            colorStyle: '健康清新',
            copyStyle: '健康科普'
        }
    },
    {
        id: 'pp-h03',
        title: '细菌滋生',
        scenario: '担心袜子里细菌多',
        userVoice: '袜子穿一天感觉细菌很多，不卫生',
        solutionTitle: '抑菌率99%更健康',
        solutionDescription: '抗菌纤维添加，经权威检测抑菌率达99%',
        categories: ['all'],
        type: 'hygiene',
        severity: 4,
        relatedSellingPoints: ['sp-f02', 'sp-m03'],
        designSuggestion: {
            visualElements: ['检测报告', '抑菌效果图'],
            colorStyle: '专业权威',
            copyStyle: '数据证明'
        }
    }
];

// ===== 功能性痛点 =====

const FUNCTION_PAIN_POINTS: PainPoint[] = [
    {
        id: 'pp-f01',
        title: '运动时磨脚',
        scenario: '跑步健身时袜子摩擦起水泡',
        userVoice: '跑完步脚上都是水泡，太疼了',
        solutionTitle: '毛圈减震防磨',
        solutionDescription: '加厚毛圈底+足弓支撑，减震防磨不起泡',
        categories: ['crew', 'ankle'],
        type: 'function',
        severity: 5,
        relatedSellingPoints: ['sp-f04', 'sp-c03'],
        designSuggestion: {
            visualElements: ['毛圈结构图', '运动场景'],
            colorStyle: '运动活力',
            copyStyle: '专业运动'
        }
    },
    {
        id: 'pp-f02',
        title: '久站脚酸',
        scenario: '站一天脚酸腿肿',
        userVoice: '上班站一天，下班脚都肿了',
        solutionTitle: '梯度压力缓解疲劳',
        solutionDescription: '科学梯度压力设计，促进血液循环，久站不累',
        categories: ['knee-high', 'crew'],
        type: 'function',
        severity: 4,
        relatedSellingPoints: ['sp-f07', 'sp-h02'],
        designSuggestion: {
            visualElements: ['压力分布图', '使用场景'],
            colorStyle: '专业医护',
            copyStyle: '功能解释'
        }
    },
    {
        id: 'pp-f03',
        title: '冬天静电',
        scenario: '冬天脱袜子时触电',
        userVoice: '冬天脱袜子被电到，劈里啪啦的',
        solutionTitle: '防静电更舒心',
        solutionDescription: '防静电纤维添加，告别冬季触电烦恼',
        categories: ['all'],
        type: 'function',
        severity: 2,
        relatedSellingPoints: ['sp-h05'],
        designSuggestion: {
            visualElements: ['防静电原理', '场景图'],
            colorStyle: '冬季温暖',
            copyStyle: '生活场景'
        }
    },
    {
        id: 'pp-f04',
        title: '袜子难晾干',
        scenario: '袜子洗完很久都不干',
        userVoice: '洗完袜子两三天都不干，着急穿',
        solutionTitle: '速干面料快速晾干',
        solutionDescription: '速干纤维材质，脱水后2小时即可穿着',
        categories: ['crew', 'ankle'],
        type: 'function',
        severity: 2,
        relatedSellingPoints: ['sp-f01', 'sp-f10'],
        designSuggestion: {
            visualElements: ['速干对比', '时间轴'],
            colorStyle: '便捷清新',
            copyStyle: '效率说明'
        }
    }
];

// ===== 外观类痛点 =====

const APPEARANCE_PAIN_POINTS: PainPoint[] = [
    {
        id: 'pp-a01',
        title: '袜子露出来难看',
        scenario: '穿板鞋运动鞋时袜子露出来',
        userVoice: '穿低帮鞋袜子露出来一截，太土了',
        solutionTitle: '隐形设计穿鞋看不见',
        solutionDescription: '超低帮隐形剪裁，完美隐藏在鞋内',
        categories: ['ankle'],
        type: 'appearance',
        severity: 4,
        relatedSellingPoints: ['sp-d01'],
        designSuggestion: {
            visualElements: ['穿鞋效果对比', '剪裁设计'],
            colorStyle: '时尚潮流',
            copyStyle: '效果展示'
        }
    },
    {
        id: 'pp-a02',
        title: '袜子单调无趣',
        scenario: '想要有个性的袜子搭配',
        userVoice: '总是买黑白灰，想要点不一样的',
        solutionTitle: '原创设计个性潮流',
        solutionDescription: '原创艺术家联名设计，让双脚也能表达态度',
        categories: ['crew', 'ankle'],
        type: 'appearance',
        severity: 2,
        relatedSellingPoints: ['sp-d03', 'sp-d04'],
        designSuggestion: {
            visualElements: ['图案展示', '搭配效果'],
            colorStyle: '个性鲜艳',
            copyStyle: '时尚态度'
        }
    },
    {
        id: 'pp-a03',
        title: '腿粗不好看',
        scenario: '穿长袜显腿粗',
        userVoice: '腿本来就粗，穿长袜更粗了',
        solutionTitle: '显瘦设计拉长腿型',
        solutionDescription: '竖条纹+梯度压力设计，视觉显瘦拉长',
        categories: ['knee-high', 'thigh-high'],
        type: 'appearance',
        severity: 3,
        relatedSellingPoints: ['sp-d07', 'sp-h02'],
        designSuggestion: {
            visualElements: ['前后对比', '穿着效果'],
            colorStyle: '修饰优雅',
            copyStyle: '效果描述'
        }
    }
];

// ===== 健康类痛点 =====

const HEALTH_PAIN_POINTS: PainPoint[] = [
    {
        id: 'pp-hl01',
        title: '担心材质安全',
        scenario: '不知道袜子材质是否安全',
        userVoice: '给宝宝买袜子怕材质不安全',
        solutionTitle: 'A类婴儿级安全标准',
        solutionDescription: '符合国家A类标准，婴幼儿可直接接触皮肤',
        categories: ['kids', 'ankle'],
        type: 'health',
        severity: 5,
        relatedSellingPoints: ['sp-m07', 'sp-m08'],
        designSuggestion: {
            visualElements: ['检测证书', '安全标识'],
            colorStyle: '母婴温馨',
            copyStyle: '安全保障'
        }
    },
    {
        id: 'pp-hl02',
        title: '孕期脚肿',
        scenario: '孕期水肿袜子勒脚',
        userVoice: '怀孕脚肿，普通袜子勒得难受',
        solutionTitle: '孕妇专用宽松设计',
        solutionDescription: '超宽松袜口，弹力轻柔，孕期也舒适',
        categories: ['crew', 'knee-high'],
        type: 'health',
        severity: 4,
        relatedSellingPoints: ['sp-c02', 'sp-c06'],
        designSuggestion: {
            visualElements: ['孕妇场景', '宽松对比'],
            colorStyle: '温馨柔和',
            copyStyle: '关怀呵护'
        }
    },
    {
        id: 'pp-hl03',
        title: '糖尿病足护理',
        scenario: '糖尿病人需要特殊袜子',
        userVoice: '医生说要穿宽松不勒的袜子',
        solutionTitle: '糖尿病人专用无勒痕',
        solutionDescription: '医学级宽松设计，无勒痕无压迫，呵护敏感双脚',
        categories: ['crew'],
        type: 'health',
        severity: 5,
        relatedSellingPoints: ['sp-c02', 'sp-c04'],
        designSuggestion: {
            visualElements: ['医学认证', '设计说明'],
            colorStyle: '医护专业',
            copyStyle: '医学关怀'
        }
    },
    {
        id: 'pp-hl04',
        title: '皮肤敏感过敏',
        scenario: '皮肤敏感穿袜子过敏',
        userVoice: '皮肤敏感，穿有些袜子会痒',
        solutionTitle: '敏感肌友好0刺激',
        solutionDescription: '有机棉材质，无化学添加，敏感肌放心穿',
        categories: ['all'],
        type: 'health',
        severity: 4,
        relatedSellingPoints: ['sp-m07', 'sp-m08', 'sp-c04'],
        designSuggestion: {
            visualElements: ['材质证明', '无添加标识'],
            colorStyle: '自然纯净',
            copyStyle: '温和呵护'
        }
    }
];

// ===== 合并所有痛点 =====

export const ALL_PAIN_POINTS: PainPoint[] = [
    ...COMFORT_PAIN_POINTS,
    ...DURABILITY_PAIN_POINTS,
    ...HYGIENE_PAIN_POINTS,
    ...FUNCTION_PAIN_POINTS,
    ...APPEARANCE_PAIN_POINTS,
    ...HEALTH_PAIN_POINTS
];

// ===== 工具函数 =====

/**
 * 根据类目获取相关痛点
 */
export function getPainPointsByCategory(categoryId: string): PainPoint[] {
    return ALL_PAIN_POINTS.filter(p => 
        p.categories.includes('all') || p.categories.includes(categoryId)
    );
}

/**
 * 根据类型获取痛点
 */
export function getPainPointsByType(type: PainPoint['type']): PainPoint[] {
    return ALL_PAIN_POINTS.filter(p => p.type === type);
}

/**
 * 搜索痛点
 */
export function searchPainPoints(keyword: string): PainPoint[] {
    const keywordLower = keyword.toLowerCase();
    return ALL_PAIN_POINTS.filter(p => 
        p.title.includes(keyword) ||
        p.scenario.includes(keyword) ||
        p.userVoice.includes(keyword) ||
        p.solutionTitle.includes(keyword)
    );
}

/**
 * 获取严重程度最高的痛点
 */
export function getTopPainPoints(categoryId: string, limit: number = 5): PainPoint[] {
    const points = getPainPointsByCategory(categoryId);
    return points.sort((a, b) => b.severity - a.severity).slice(0, limit);
}

/**
 * 根据卖点ID获取解决的痛点
 */
export function getPainPointsBySellingPoint(sellingPointId: string): PainPoint[] {
    return ALL_PAIN_POINTS.filter(p => 
        p.relatedSellingPoints.includes(sellingPointId)
    );
}

/**
 * 获取痛点-解决方案配对（用于设计）
 */
export function getPainSolutionPairs(categoryId: string): Array<{
    pain: string;
    solution: string;
    userVoice: string;
}> {
    return getPainPointsByCategory(categoryId).map(p => ({
        pain: p.title,
        solution: p.solutionTitle,
        userVoice: p.userVoice
    }));
}

export default {
    all: ALL_PAIN_POINTS,
    comfort: COMFORT_PAIN_POINTS,
    durability: DURABILITY_PAIN_POINTS,
    hygiene: HYGIENE_PAIN_POINTS,
    function: FUNCTION_PAIN_POINTS,
    appearance: APPEARANCE_PAIN_POINTS,
    health: HEALTH_PAIN_POINTS,
    getPainPointsByCategory,
    getPainPointsByType,
    searchPainPoints,
    getTopPainPoints,
    getPainPointsBySellingPoint,
    getPainSolutionPairs
};
