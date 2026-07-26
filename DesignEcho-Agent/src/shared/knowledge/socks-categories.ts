/**
 * 袜子类目分类体系
 * 
 * 用于 Photoshop 设计 Agent 的袜子/电商场景产品知识库
 */

// ===== 类型定义 =====

/** 产品类别 */
export interface ProductCategory {
    id: string;
    name: string;
    alias: string[];          // 别名/同义词
    description: string;
    keywords: string[];       // 搜索关键词
    targetAudience: string[]; // 目标人群
    features: string[];       // 特征
    commonMaterials: string[]; // 常用材质
    priceRange: {
        low: number;
        high: number;
    };
    subcategories?: ProductCategory[];
}

/** 材质信息 */
export interface MaterialInfo {
    id: string;
    name: string;
    alias: string[];
    description: string;
    features: string[];       // 特点
    benefits: string[];       // 优势
    drawbacks: string[];      // 缺点
    careInstructions: string[]; // 护理说明
    priceLevel: 'low' | 'mid' | 'high' | 'premium';
}

/** 风格定义 */
export interface StyleInfo {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    targetAudience: string[];
    colorPreferences: string[];
    designElements: string[];
}

// ===== 袜子类目分类 =====

export const SOCKS_CATEGORIES: ProductCategory[] = [
    {
        id: 'ankle',
        name: '船袜/隐形袜',
        alias: ['船袜', '隐形袜', '浅口袜', '低帮袜', '短袜'],
        description: '露出脚踝的超短袜，适合搭配运动鞋、板鞋',
        keywords: ['船袜', '隐形', '浅口', '低帮', '防滑', '硅胶'],
        targetAudience: ['年轻人', '运动爱好者', '日常穿搭'],
        features: ['隐形设计', '后跟防滑', '透气网眼'],
        commonMaterials: ['棉', '涤纶', '氨纶'],
        priceRange: { low: 5, high: 30 },
        subcategories: [
            {
                id: 'ankle-silicone',
                name: '硅胶防滑船袜',
                alias: ['防滑船袜', '硅胶袜'],
                description: '后跟带硅胶防滑设计',
                keywords: ['硅胶', '防滑', '不掉跟'],
                targetAudience: ['女性', '穿高跟鞋人群'],
                features: ['硅胶防滑', '360度包裹'],
                commonMaterials: ['棉', '冰丝', '蕾丝'],
                priceRange: { low: 8, high: 25 }
            },
            {
                id: 'ankle-mesh',
                name: '网眼透气船袜',
                alias: ['透气船袜', '网眼袜'],
                description: '网眼设计增强透气性',
                keywords: ['网眼', '透气', '夏季'],
                targetAudience: ['夏季穿着', '运动人群'],
                features: ['网眼透气', '速干'],
                commonMaterials: ['棉', '涤纶'],
                priceRange: { low: 5, high: 20 }
            }
        ]
    },
    {
        id: 'crew',
        name: '中筒袜',
        alias: ['中筒袜', '运动袜', '标准袜', '棉袜'],
        description: '袜口到小腿中部，最常见的袜子款式',
        keywords: ['中筒', '运动', '日常', '棉袜'],
        targetAudience: ['全年龄', '运动', '日常穿搭'],
        features: ['舒适包裹', '保暖性好', '款式多样'],
        commonMaterials: ['纯棉', '精梳棉', '毛圈'],
        priceRange: { low: 8, high: 50 },
        subcategories: [
            {
                id: 'crew-sports',
                name: '运动中筒袜',
                alias: ['运动袜', '跑步袜', '健身袜'],
                description: '专为运动设计，加厚毛圈底',
                keywords: ['运动', '跑步', '健身', '毛圈', '减震'],
                targetAudience: ['运动爱好者', '健身人群'],
                features: ['毛圈加厚', '减震', '速干'],
                commonMaterials: ['棉', '涤纶', '氨纶'],
                priceRange: { low: 15, high: 50 }
            },
            {
                id: 'crew-business',
                name: '商务中筒袜',
                alias: ['商务袜', '正装袜', '绅士袜'],
                description: '正式场合穿着的素色袜子',
                keywords: ['商务', '正装', '素色', '绅士'],
                targetAudience: ['商务人士', '上班族'],
                features: ['素色设计', '舒适透气', '不易起球'],
                commonMaterials: ['精梳棉', '莫代尔', '竹纤维'],
                priceRange: { low: 15, high: 60 }
            },
            {
                id: 'crew-fashion',
                name: '潮流中筒袜',
                alias: ['潮袜', '街头袜', '印花袜'],
                description: '时尚图案设计的个性袜子',
                keywords: ['潮流', '街头', '印花', '涂鸦', 'ins'],
                targetAudience: ['年轻人', '潮流爱好者'],
                features: ['个性图案', '撞色设计', '潮流元素'],
                commonMaterials: ['棉', '涤纶'],
                priceRange: { low: 10, high: 40 }
            }
        ]
    },
    {
        id: 'knee-high',
        name: '长筒袜',
        alias: ['长筒袜', '及膝袜', '小腿袜', '高筒袜'],
        description: '袜口到膝盖以下的长袜',
        keywords: ['长筒', '及膝', '小腿', '高筒', 'jk'],
        targetAudience: ['女性', '学生', '日系穿搭'],
        features: ['修饰腿型', '保暖', '时尚'],
        commonMaterials: ['棉', '天鹅绒', '羊毛'],
        priceRange: { low: 15, high: 80 },
        subcategories: [
            {
                id: 'knee-high-jk',
                name: 'JK制服袜',
                alias: ['jk袜', '制服袜', '学生袜'],
                description: '日系制服风格的长筒袜',
                keywords: ['jk', '制服', '学生', '日系', '百褶裙'],
                targetAudience: ['学生', '日系爱好者'],
                features: ['纯色/条纹', '弹力好', '不易滑落'],
                commonMaterials: ['棉', '涤纶'],
                priceRange: { low: 10, high: 40 }
            },
            {
                id: 'knee-high-compression',
                name: '压力瘦腿袜',
                alias: ['压力袜', '瘦腿袜', '塑形袜'],
                description: '带有压力设计的塑形袜',
                keywords: ['压力', '瘦腿', '塑形', '久站'],
                targetAudience: ['久站人群', '塑形需求'],
                features: ['梯度压力', '促进循环', '缓解疲劳'],
                commonMaterials: ['锦纶', '氨纶'],
                priceRange: { low: 25, high: 100 }
            }
        ]
    },
    {
        id: 'thigh-high',
        name: '过膝袜',
        alias: ['过膝袜', '大腿袜', '长腿袜'],
        description: '袜口超过膝盖的超长袜',
        keywords: ['过膝', '大腿', '性感', '保暖'],
        targetAudience: ['女性', '时尚达人'],
        features: ['显腿长', '保暖', '时尚'],
        commonMaterials: ['棉', '天鹅绒', '羊毛'],
        priceRange: { low: 20, high: 100 }
    },
    {
        id: 'toe',
        name: '五指袜',
        alias: ['五指袜', '分趾袜', '脚趾袜'],
        description: '每个脚趾单独包裹的健康袜',
        keywords: ['五指', '分趾', '健康', '吸汗'],
        targetAudience: ['健康意识人群', '运动人群'],
        features: ['分趾设计', '防止脚气', '舒适健康'],
        commonMaterials: ['纯棉', '竹纤维'],
        priceRange: { low: 10, high: 40 }
    },
    {
        id: 'kids',
        name: '儿童袜',
        alias: ['儿童袜', '宝宝袜', '婴儿袜', '童袜'],
        description: '专为儿童设计的袜子',
        keywords: ['儿童', '宝宝', '婴儿', '卡通', '可爱'],
        targetAudience: ['婴幼儿', '儿童', '学生'],
        features: ['柔软亲肤', '无骨缝头', '卡通图案'],
        commonMaterials: ['精梳棉', '有机棉'],
        priceRange: { low: 5, high: 30 },
        subcategories: [
            {
                id: 'kids-baby',
                name: '婴儿袜',
                alias: ['婴儿袜', '新生儿袜', '宝宝袜'],
                description: '0-3岁婴幼儿专用袜',
                keywords: ['婴儿', '新生儿', '柔软', '无骨'],
                targetAudience: ['婴幼儿'],
                features: ['无骨缝头', 'A类标准', '柔软亲肤'],
                commonMaterials: ['有机棉', '精梳棉'],
                priceRange: { low: 8, high: 35 }
            },
            {
                id: 'kids-cartoon',
                name: '卡通童袜',
                alias: ['卡通袜', '动漫袜', '可爱童袜'],
                description: '带卡通图案的儿童袜',
                keywords: ['卡通', '动漫', '可爱', '公主', '汽车'],
                targetAudience: ['儿童', '小学生'],
                features: ['卡通图案', '鲜艳颜色', '弹力好'],
                commonMaterials: ['棉', '涤纶'],
                priceRange: { low: 5, high: 25 }
            }
        ]
    },
    {
        id: 'wool',
        name: '羊毛袜',
        alias: ['羊毛袜', '毛线袜', '保暖袜', '冬季袜'],
        description: '羊毛材质的保暖袜子',
        keywords: ['羊毛', '保暖', '冬季', '加厚', '毛线'],
        targetAudience: ['冬季穿着', '怕冷人群'],
        features: ['超强保暖', '吸湿排汗', '柔软舒适'],
        commonMaterials: ['羊毛', '羊绒', '兔毛'],
        priceRange: { low: 20, high: 150 }
    },
    {
        id: 'silk',
        name: '丝袜/连裤袜',
        alias: ['丝袜', '连裤袜', '打底袜', '薄款袜'],
        description: '薄款丝质袜子，多用于正装搭配',
        keywords: ['丝袜', '连裤袜', '打底', '薄款', '透肉'],
        targetAudience: ['女性', '职场人士'],
        features: ['轻薄透气', '修饰腿型', '优雅大方'],
        commonMaterials: ['锦纶', '氨纶'],
        priceRange: { low: 10, high: 80 },
        subcategories: [
            {
                id: 'silk-sheer',
                name: '超薄丝袜',
                alias: ['超薄袜', '透明丝袜', '0D丝袜'],
                description: '极薄透明的丝袜',
                keywords: ['超薄', '透明', '0D', '5D', '透肉'],
                targetAudience: ['女性', '夏季'],
                features: ['极薄透明', '自然肤色', '不易勾丝'],
                commonMaterials: ['锦纶', '氨纶'],
                priceRange: { low: 10, high: 50 }
            },
            {
                id: 'silk-thick',
                name: '加厚打底袜',
                alias: ['打底裤袜', '加绒袜', '冬季丝袜'],
                description: '加厚保暖的连裤袜',
                keywords: ['加厚', '打底', '加绒', '保暖', '冬季'],
                targetAudience: ['女性', '冬季'],
                features: ['加绒保暖', '显瘦', '不起球'],
                commonMaterials: ['锦纶', '氨纶', '绒毛'],
                priceRange: { low: 20, high: 80 }
            }
        ]
    }
];

// ===== 材质库 =====

export const MATERIALS: MaterialInfo[] = [
    {
        id: 'cotton',
        name: '纯棉',
        alias: ['棉', '全棉', '100%棉'],
        description: '天然棉花纤维制成，舒适透气',
        features: ['柔软', '透气', '吸汗', '亲肤'],
        benefits: ['舒适度高', '不易过敏', '四季皆宜'],
        drawbacks: ['易缩水', '易皱', '弹性较差'],
        careInstructions: ['温水洗涤', '不可漂白', '低温烘干'],
        priceLevel: 'mid'
    },
    {
        id: 'combed-cotton',
        name: '精梳棉',
        alias: ['精梳棉', '长绒棉', '高支棉'],
        description: '经过精梳工艺处理的优质棉',
        features: ['更加柔软', '不易起球', '质感细腻'],
        benefits: ['品质更高', '更耐穿', '光泽度好'],
        drawbacks: ['价格较高'],
        careInstructions: ['温水洗涤', '轻柔模式', '自然晾干'],
        priceLevel: 'high'
    },
    {
        id: 'bamboo',
        name: '竹纤维',
        alias: ['竹纤维', '竹炭纤维', '竹棉'],
        description: '从竹子中提取的天然纤维',
        features: ['抗菌', '除臭', '吸湿', '透气'],
        benefits: ['天然抗菌', '清凉感', '环保'],
        drawbacks: ['强度较低', '易变形'],
        careInstructions: ['冷水洗涤', '避免暴晒', '不可拧干'],
        priceLevel: 'mid'
    },
    {
        id: 'wool',
        name: '羊毛',
        alias: ['羊毛', '绵羊毛', '美利奴羊毛'],
        description: '天然羊毛纤维，保暖性极佳',
        features: ['超强保暖', '吸湿排汗', '弹性好'],
        benefits: ['保暖效果最好', '调节温度', '柔软舒适'],
        drawbacks: ['价格高', '需要特殊护理', '可能缩水'],
        careInstructions: ['手洗', '羊毛洗涤剂', '平铺晾干'],
        priceLevel: 'premium'
    },
    {
        id: 'nylon',
        name: '锦纶/尼龙',
        alias: ['锦纶', '尼龙', 'Nylon'],
        description: '高强度合成纤维',
        features: ['耐磨', '弹性好', '不易变形'],
        benefits: ['结实耐穿', '易洗快干', '光泽度好'],
        drawbacks: ['不透气', '易起静电'],
        careInstructions: ['冷水洗涤', '不可熨烫', '阴凉处晾干'],
        priceLevel: 'low'
    },
    {
        id: 'spandex',
        name: '氨纶/莱卡',
        alias: ['氨纶', '莱卡', 'Spandex', 'Lycra'],
        description: '高弹性纤维，通常与其他纤维混纺',
        features: ['超强弹性', '贴合度高', '不易变形'],
        benefits: ['舒适贴身', '运动自如', '塑形效果'],
        drawbacks: ['不能单独使用', '耐热性差'],
        careInstructions: ['冷水洗涤', '避免高温', '不可漂白'],
        priceLevel: 'mid'
    },
    {
        id: 'modal',
        name: '莫代尔',
        alias: ['莫代尔', 'Modal'],
        description: '从木浆中提取的再生纤维素纤维',
        features: ['丝般柔滑', '透气', '悬垂性好'],
        benefits: ['触感极佳', '不易起球', '环保'],
        drawbacks: ['湿强度低', '价格较高'],
        careInstructions: ['温水洗涤', '轻柔模式', '不可拧干'],
        priceLevel: 'high'
    },
    {
        id: 'ice-silk',
        name: '冰丝',
        alias: ['冰丝', '冰爽丝', '粘胶纤维'],
        description: '夏季清凉感面料',
        features: ['清凉', '透气', '垂感好'],
        benefits: ['夏季首选', '凉爽舒适', '光泽度好'],
        drawbacks: ['易皱', '强度较低'],
        careInstructions: ['冷水洗涤', '避免暴晒', '低温熨烫'],
        priceLevel: 'mid'
    }
];

// ===== 风格库 =====

export const STYLES: StyleInfo[] = [
    {
        id: 'minimalist',
        name: '简约风',
        description: '简洁大方，注重品质感',
        keywords: ['简约', '素色', '高级', '品质'],
        targetAudience: ['商务人士', '成熟用户'],
        colorPreferences: ['黑', '白', '灰', '米色', '藏青'],
        designElements: ['纯色', '细条纹', '简洁线条']
    },
    {
        id: 'sporty',
        name: '运动风',
        description: '活力动感，功能性强',
        keywords: ['运动', '活力', '健康', '动感'],
        targetAudience: ['运动爱好者', '年轻人'],
        colorPreferences: ['荧光色', '黑白', '红蓝'],
        designElements: ['LOGO', '条纹', '撞色拼接']
    },
    {
        id: 'cute',
        name: '可爱风',
        description: '甜美可爱，少女心',
        keywords: ['可爱', '甜美', '少女', '卡通'],
        targetAudience: ['女性', '年轻女孩'],
        colorPreferences: ['粉色', '紫色', '浅蓝', '黄色'],
        designElements: ['卡通图案', '蕾丝', '蝴蝶结', '波点']
    },
    {
        id: 'streetwear',
        name: '街头潮流',
        description: '个性张扬，潮流前卫',
        keywords: ['潮流', '街头', 'ins', '个性'],
        targetAudience: ['年轻人', '潮流爱好者'],
        colorPreferences: ['黑白', '荧光', '迷彩'],
        designElements: ['涂鸦', '字母', 'LOGO', '撞色']
    },
    {
        id: 'japanese',
        name: '日系风',
        description: '清新文艺，自然舒适',
        keywords: ['日系', '文艺', '清新', '森系'],
        targetAudience: ['文艺青年', '女性'],
        colorPreferences: ['大地色', '莫兰迪', '浅色系'],
        designElements: ['条纹', '格子', '小碎花']
    },
    {
        id: 'retro',
        name: '复古风',
        description: '怀旧经典，时尚回潮',
        keywords: ['复古', '经典', '怀旧', 'vintage'],
        targetAudience: ['时尚达人', '设计师'],
        colorPreferences: ['棕色', '墨绿', '酒红', '芥末黄'],
        designElements: ['几何图案', '复古印花', '条纹']
    }
];

// ===== 工具函数 =====

/**
 * 根据关键词搜索类目
 */
export function searchCategories(keyword: string): ProductCategory[] {
    const results: ProductCategory[] = [];
    const keywordLower = keyword.toLowerCase();
    
    const searchInCategory = (category: ProductCategory) => {
        const matchName = category.name.toLowerCase().includes(keywordLower);
        const matchAlias = category.alias.some(a => a.toLowerCase().includes(keywordLower));
        const matchKeywords = category.keywords.some(k => k.toLowerCase().includes(keywordLower));
        
        if (matchName || matchAlias || matchKeywords) {
            results.push(category);
        }
        
        if (category.subcategories) {
            category.subcategories.forEach(searchInCategory);
        }
    };
    
    SOCKS_CATEGORIES.forEach(searchInCategory);
    return results;
}

/**
 * 获取所有类目（扁平化）
 */
export function getAllCategories(): ProductCategory[] {
    const all: ProductCategory[] = [];
    
    const flatten = (category: ProductCategory) => {
        all.push(category);
        if (category.subcategories) {
            category.subcategories.forEach(flatten);
        }
    };
    
    SOCKS_CATEGORIES.forEach(flatten);
    return all;
}

/**
 * 根据 ID 获取类目
 */
export function getCategoryById(id: string): ProductCategory | null {
    const all = getAllCategories();
    return all.find(c => c.id === id) || null;
}

/**
 * 搜索材质
 */
export function searchMaterials(keyword: string): MaterialInfo[] {
    const keywordLower = keyword.toLowerCase();
    return MATERIALS.filter(m => 
        m.name.toLowerCase().includes(keywordLower) ||
        m.alias.some(a => a.toLowerCase().includes(keywordLower))
    );
}

/**
 * 搜索风格
 */
export function searchStyles(keyword: string): StyleInfo[] {
    const keywordLower = keyword.toLowerCase();
    return STYLES.filter(s => 
        s.name.toLowerCase().includes(keywordLower) ||
        s.keywords.some(k => k.toLowerCase().includes(keywordLower))
    );
}

export default {
    categories: SOCKS_CATEGORIES,
    materials: MATERIALS,
    styles: STYLES,
    searchCategories,
    getAllCategories,
    getCategoryById,
    searchMaterials,
    searchStyles
};
