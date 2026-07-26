/**
 * 电商设计配色方案库
 * 
 * 10+ 套专业配色方案，适用于电商详情页设计
 */

// ===== 类型定义 =====

/** 单个颜色定义 */
export interface ColorDefinition {
    hex: string;
    name: string;
    usage: string;  // 使用场景描述
}

/** 配色方案 */
export interface ColorScheme {
    id: string;
    name: string;
    description: string;
    /** 适用场景 */
    scenes: string[];
    /** 适用类目 */
    categories: string[];
    /** 适用季节 */
    seasons: ('spring' | 'summer' | 'autumn' | 'winter' | 'all')[];
    /** 目标人群 */
    targetAudience: string[];
    /** 情感关键词 */
    emotions: string[];
    /** 主色 */
    primary: ColorDefinition;
    /** 辅助色 */
    secondary: ColorDefinition;
    /** 强调色 */
    accent: ColorDefinition;
    /** 背景色 */
    background: ColorDefinition;
    /** 文字色 */
    text: ColorDefinition;
    /** 扩展色板 */
    palette: ColorDefinition[];
    /** 渐变建议 */
    gradients?: {
        name: string;
        colors: string[];
        direction: string;
    }[];
    /** 设计建议 */
    designTips: string[];
}

// ===== 配色方案库 =====

export const COLOR_SCHEMES: ColorScheme[] = [
    // 1. 简约商务
    {
        id: 'cs-business',
        name: '简约商务',
        description: '沉稳专业的商务风格，适合高端品质定位',
        scenes: ['商务', '高端', '正装', '男士'],
        categories: ['crew', 'ankle'],
        seasons: ['all'],
        targetAudience: ['商务人士', '职场男性', '成熟用户'],
        emotions: ['专业', '可靠', '品质', '沉稳'],
        primary: { hex: '#1A1A2E', name: '深藏青', usage: '主标题、重点文字' },
        secondary: { hex: '#16213E', name: '墨蓝', usage: '次级标题、区块背景' },
        accent: { hex: '#E94560', name: '商务红', usage: '价格、促销标签' },
        background: { hex: '#F8F9FA', name: '浅灰白', usage: '页面背景' },
        text: { hex: '#2D3436', name: '炭黑', usage: '正文内容' },
        palette: [
            { hex: '#0F3460', name: '深海蓝', usage: '图标、线条' },
            { hex: '#E7E9EB', name: '银灰', usage: '分割线、边框' },
            { hex: '#FFFFFF', name: '纯白', usage: '卡片背景' }
        ],
        gradients: [
            { name: '商务渐变', colors: ['#1A1A2E', '#16213E'], direction: '135deg' }
        ],
        designTips: [
            '使用大量留白，保持页面整洁',
            '字体选择无衬线体，如苹方、思源黑体',
            '图片处理偏冷色调，增强质感',
            '强调色仅用于关键行动点'
        ]
    },

    // 2. 清新自然
    {
        id: 'cs-natural',
        name: '清新自然',
        description: '来自大自然的灵感，传递健康环保理念',
        scenes: ['有机', '环保', '健康', '天然'],
        categories: ['crew', 'ankle', 'kids'],
        seasons: ['spring', 'summer'],
        targetAudience: ['环保主义者', '追求健康生活'],
        emotions: ['自然', '清新', '健康', '纯净'],
        primary: { hex: '#2D6A4F', name: '森林绿', usage: '主标题、核心卖点' },
        secondary: { hex: '#40916C', name: '翠绿', usage: '次级标题' },
        accent: { hex: '#F9C74F', name: '阳光黄', usage: '强调、促销' },
        background: { hex: '#FEFAE0', name: '米白', usage: '页面背景' },
        text: { hex: '#344E41', name: '橄榄绿', usage: '正文内容' },
        palette: [
            { hex: '#52B788', name: '薄荷绿', usage: '标签、图标' },
            { hex: '#95D5B2', name: '浅绿', usage: '区块背景' },
            { hex: '#D8F3DC', name: '嫩芽绿', usage: '卡片背景' }
        ],
        gradients: [
            { name: '森林渐变', colors: ['#2D6A4F', '#52B788'], direction: '180deg' }
        ],
        designTips: [
            '可搭配植物、叶子等自然元素',
            '使用手写体或有机感字体作为点缀',
            '图片保持自然光感，不过度修饰',
            '适合强调材质天然、有机棉等卖点'
        ]
    },

    // 3. 活力运动
    {
        id: 'cs-sporty',
        name: '活力运动',
        description: '充满能量的运动风格，激发活力',
        scenes: ['运动', '健身', '户外', '青春'],
        categories: ['crew', 'ankle', 'toe'],
        seasons: ['all'],
        targetAudience: ['运动爱好者', '年轻人', '健身人群'],
        emotions: ['活力', '动感', '激情', '能量'],
        primary: { hex: '#FF6B35', name: '活力橙', usage: '主标题、核心卖点' },
        secondary: { hex: '#1A1A2E', name: '运动黑', usage: '次级标题、背景' },
        accent: { hex: '#00D9FF', name: '电光蓝', usage: '强调、标签' },
        background: { hex: '#FFFFFF', name: '纯白', usage: '页面背景' },
        text: { hex: '#2B2D42', name: '深灰', usage: '正文内容' },
        palette: [
            { hex: '#F72585', name: '荧光粉', usage: '女性运动系列' },
            { hex: '#4CC9F0', name: '天空蓝', usage: '科技感元素' },
            { hex: '#7209B7', name: '电光紫', usage: '潮流元素' }
        ],
        gradients: [
            { name: '活力渐变', colors: ['#FF6B35', '#F72585'], direction: '45deg' },
            { name: '科技渐变', colors: ['#00D9FF', '#7209B7'], direction: '135deg' }
        ],
        designTips: [
            '使用动态线条和几何形状',
            '字体选择粗体，增强力量感',
            '可使用渐变和光效增强视觉冲击',
            '图片选择运动场景，传递动感'
        ]
    },

    // 4. 温馨可爱
    {
        id: 'cs-cute',
        name: '温馨可爱',
        description: '甜美可爱的少女风格，充满童趣',
        scenes: ['儿童', '少女', '可爱', '卡通'],
        categories: ['kids', 'ankle', 'crew'],
        seasons: ['spring', 'summer'],
        targetAudience: ['儿童', '少女', '妈妈'],
        emotions: ['可爱', '甜美', '温馨', '童趣'],
        primary: { hex: '#FF85A1', name: '樱花粉', usage: '主标题' },
        secondary: { hex: '#FFC8DD', name: '浅粉', usage: '次级标题、背景' },
        accent: { hex: '#9B59B6', name: '梦幻紫', usage: '强调元素' },
        background: { hex: '#FFF5F7', name: '奶白粉', usage: '页面背景' },
        text: { hex: '#5D4E6D', name: '灰紫', usage: '正文内容' },
        palette: [
            { hex: '#A8E6CF', name: '薄荷绿', usage: '点缀色' },
            { hex: '#FDFFAB', name: '柠檬黄', usage: '活泼元素' },
            { hex: '#FFB5A7', name: '蜜桃色', usage: '温暖元素' }
        ],
        gradients: [
            { name: '甜美渐变', colors: ['#FF85A1', '#FFC8DD'], direction: '180deg' }
        ],
        designTips: [
            '搭配可爱卡通图案和手绘元素',
            '使用圆角、波点等柔和元素',
            '字体选择圆润可爱的款式',
            '保持画面轻松活泼的氛围'
        ]
    },

    // 5. 高级灰调
    {
        id: 'cs-premium-gray',
        name: '高级灰调',
        description: '极简高级的莫兰迪色系，彰显品味',
        scenes: ['高端', '极简', '设计师', '品味'],
        categories: ['crew', 'ankle', 'silk'],
        seasons: ['autumn', 'winter'],
        targetAudience: ['高端用户', '设计师', '品味人士'],
        emotions: ['高级', '品味', '内敛', '质感'],
        primary: { hex: '#5C5C5C', name: '高级灰', usage: '主标题' },
        secondary: { hex: '#8D8D8D', name: '中灰', usage: '次级标题' },
        accent: { hex: '#C9A87C', name: '香槟金', usage: '强调、价格' },
        background: { hex: '#F5F5F5', name: '浅灰', usage: '页面背景' },
        text: { hex: '#333333', name: '深灰', usage: '正文内容' },
        palette: [
            { hex: '#A9A9A9', name: '银灰', usage: '辅助元素' },
            { hex: '#D4C4A8', name: '燕麦色', usage: '温暖点缀' },
            { hex: '#BFBFBF', name: '铂金灰', usage: '边框线条' }
        ],
        gradients: [
            { name: '质感渐变', colors: ['#5C5C5C', '#8D8D8D'], direction: '135deg' }
        ],
        designTips: [
            '大面积留白，突出产品本身',
            '使用细线条和精致排版',
            '图片保持高对比度和质感',
            '金色点缀提升档次感'
        ]
    },

    // 6. 冬日温暖
    {
        id: 'cs-winter-warm',
        name: '冬日温暖',
        description: '温暖舒适的秋冬色调，营造温馨氛围',
        scenes: ['冬季', '保暖', '羊毛', '家居'],
        categories: ['wool', 'crew', 'thigh-high'],
        seasons: ['autumn', 'winter'],
        targetAudience: ['追求保暖', '家居场景'],
        emotions: ['温暖', '舒适', '居家', '安心'],
        primary: { hex: '#C84B31', name: '焦糖橙', usage: '主标题、重点' },
        secondary: { hex: '#ECDBBA', name: '奶茶色', usage: '背景、区块' },
        accent: { hex: '#2D4263', name: '深海蓝', usage: '强调对比' },
        background: { hex: '#FDF6EC', name: '暖白', usage: '页面背景' },
        text: { hex: '#4A3728', name: '咖啡棕', usage: '正文内容' },
        palette: [
            { hex: '#D4A373', name: '驼色', usage: '辅助元素' },
            { hex: '#E9EDC9', name: '燕麦绿', usage: '自然点缀' },
            { hex: '#FAEDCD', name: '米黄', usage: '卡片背景' }
        ],
        gradients: [
            { name: '暖阳渐变', colors: ['#C84B31', '#ECDBBA'], direction: '180deg' }
        ],
        designTips: [
            '使用温暖色调的产品图片',
            '可搭配毛毯、热饮等温馨场景',
            '字体选择圆润温和的款式',
            '强调保暖、舒适的产品特性'
        ]
    },

    // 7. 夏日清凉
    {
        id: 'cs-summer-cool',
        name: '夏日清凉',
        description: '清爽凉感的夏季配色，传递凉爽舒适',
        scenes: ['夏季', '清凉', '冰丝', '透气'],
        categories: ['ankle', 'crew', 'silk'],
        seasons: ['summer'],
        targetAudience: ['夏季用户', '追求清凉'],
        emotions: ['清凉', '清爽', '舒适', '轻盈'],
        primary: { hex: '#00B4D8', name: '海洋蓝', usage: '主标题' },
        secondary: { hex: '#90E0EF', name: '天空蓝', usage: '次级标题' },
        accent: { hex: '#FF6B6B', name: '西瓜红', usage: '强调促销' },
        background: { hex: '#FFFFFF', name: '纯白', usage: '页面背景' },
        text: { hex: '#023E8A', name: '深蓝', usage: '正文内容' },
        palette: [
            { hex: '#CAF0F8', name: '冰蓝', usage: '区块背景' },
            { hex: '#ADE8F4', name: '浅蓝', usage: '辅助元素' },
            { hex: '#48CAE4', name: '清泉蓝', usage: '图标' }
        ],
        gradients: [
            { name: '清凉渐变', colors: ['#00B4D8', '#CAF0F8'], direction: '180deg' }
        ],
        designTips: [
            '使用冰块、水滴等清凉元素',
            '保持画面清新简洁',
            '可添加降温数据增强说服力',
            '图片选择明亮清爽的光感'
        ]
    },

    // 8. 潮流街头
    {
        id: 'cs-streetwear',
        name: '潮流街头',
        description: '大胆前卫的街头风格，彰显个性态度',
        scenes: ['潮流', '街头', '年轻', '个性'],
        categories: ['crew', 'ankle'],
        seasons: ['all'],
        targetAudience: ['年轻人', '潮流爱好者', 'Z世代'],
        emotions: ['个性', '前卫', '大胆', '酷'],
        primary: { hex: '#000000', name: '纯黑', usage: '主背景、标题' },
        secondary: { hex: '#FFFFFF', name: '纯白', usage: '对比元素' },
        accent: { hex: '#F2FF00', name: '荧光黄', usage: '强调、标签' },
        background: { hex: '#121212', name: '深黑', usage: '页面背景' },
        text: { hex: '#FFFFFF', name: '纯白', usage: '正文内容' },
        palette: [
            { hex: '#FF0055', name: '荧光粉', usage: '活动促销' },
            { hex: '#00FF66', name: '荧光绿', usage: '限时标签' },
            { hex: '#FF6600', name: '荧光橙', usage: '热卖标签' }
        ],
        gradients: [
            { name: '霓虹渐变', colors: ['#F2FF00', '#FF0055'], direction: '45deg' }
        ],
        designTips: [
            '使用粗体、大字号增强冲击力',
            '可添加涂鸦、贴纸等街头元素',
            '黑白为主，荧光色点缀',
            '排版大胆打破常规'
        ]
    },

    // 9. 日系文艺
    {
        id: 'cs-japanese',
        name: '日系文艺',
        description: '清新淡雅的日式美学，温柔治愈',
        scenes: ['日系', '文艺', '森系', '清新'],
        categories: ['crew', 'ankle', 'knee-high'],
        seasons: ['spring', 'autumn'],
        targetAudience: ['文艺青年', '女性', '追求品质'],
        emotions: ['治愈', '温柔', '文艺', '自然'],
        primary: { hex: '#6B705C', name: '苔藓绿', usage: '主标题' },
        secondary: { hex: '#A5A58D', name: '橄榄灰', usage: '次级标题' },
        accent: { hex: '#CB997E', name: '肉桂粉', usage: '强调元素' },
        background: { hex: '#FFFCF2', name: '象牙白', usage: '页面背景' },
        text: { hex: '#3D405B', name: '墨灰', usage: '正文内容' },
        palette: [
            { hex: '#B7B7A4', name: '亚麻灰', usage: '辅助元素' },
            { hex: '#DDBEA9', name: '杏仁色', usage: '温暖元素' },
            { hex: '#FFE8D6', name: '奶油色', usage: '卡片背景' }
        ],
        gradients: [
            { name: '自然渐变', colors: ['#6B705C', '#A5A58D'], direction: '180deg' }
        ],
        designTips: [
            '使用自然光感的产品图片',
            '搭配干花、棉麻等自然元素',
            '字体选择细腻优雅的款式',
            '保持画面留白和呼吸感'
        ]
    },

    // 10. 母婴温馨
    {
        id: 'cs-baby',
        name: '母婴温馨',
        description: '安全柔和的母婴专属配色，传递关爱',
        scenes: ['母婴', '婴儿', '安全', '柔和'],
        categories: ['kids'],
        seasons: ['all'],
        targetAudience: ['妈妈', '婴幼儿', '送礼'],
        emotions: ['安全', '柔和', '关爱', '呵护'],
        primary: { hex: '#7EB09B', name: '薄荷绿', usage: '主标题' },
        secondary: { hex: '#F7D1BA', name: '婴儿粉', usage: '次级标题、背景' },
        accent: { hex: '#FFB347', name: '暖阳橙', usage: '强调元素' },
        background: { hex: '#FFFEF9', name: '乳白', usage: '页面背景' },
        text: { hex: '#5A5A5A', name: '温和灰', usage: '正文内容' },
        palette: [
            { hex: '#A8DADC', name: '婴儿蓝', usage: '男宝系列' },
            { hex: '#FADADD', name: '樱花粉', usage: '女宝系列' },
            { hex: '#F1E3D3', name: '燕麦奶', usage: '中性系列' }
        ],
        gradients: [
            { name: '柔和渐变', colors: ['#7EB09B', '#F7D1BA'], direction: '135deg' }
        ],
        designTips: [
            '强调安全认证和材质说明',
            '使用圆润可爱的设计元素',
            '图片选择柔和光线，传递温馨',
            '突出A类标准、有机棉等安全卖点'
        ]
    },

    // 11. 复古经典
    {
        id: 'cs-retro',
        name: '复古经典',
        description: '经典复古的时光美学，怀旧又时尚',
        scenes: ['复古', '经典', '怀旧', '时尚'],
        categories: ['crew', 'ankle'],
        seasons: ['autumn', 'winter'],
        targetAudience: ['复古爱好者', '时尚达人'],
        emotions: ['经典', '怀旧', '品味', '独特'],
        primary: { hex: '#8B4513', name: '复古棕', usage: '主标题' },
        secondary: { hex: '#DAA520', name: '复古金', usage: '强调元素' },
        accent: { hex: '#800020', name: '酒红', usage: '促销标签' },
        background: { hex: '#FDF5E6', name: '复古白', usage: '页面背景' },
        text: { hex: '#2F1810', name: '深褐', usage: '正文内容' },
        palette: [
            { hex: '#CD853F', name: '秘鲁棕', usage: '辅助元素' },
            { hex: '#D2691E', name: '巧克力', usage: '装饰元素' },
            { hex: '#F5DEB3', name: '小麦色', usage: '区块背景' }
        ],
        gradients: [
            { name: '复古渐变', colors: ['#8B4513', '#DAA520'], direction: '45deg' }
        ],
        designTips: [
            '使用复古质感的纹理背景',
            '字体选择衬线体或艺术字',
            '图片可做旧处理增加年代感',
            '搭配经典图案如格纹、条纹'
        ]
    },

    // 12. 节日促销
    {
        id: 'cs-festival',
        name: '节日促销',
        description: '热烈喜庆的节日氛围，刺激购买欲',
        scenes: ['促销', '节日', '大促', '双11'],
        categories: ['all'],
        seasons: ['all'],
        targetAudience: ['促销活动', '节日营销'],
        emotions: ['热烈', '喜庆', '紧迫', '优惠'],
        primary: { hex: '#E63946', name: '促销红', usage: '主标题、价格' },
        secondary: { hex: '#FFD700', name: '金色', usage: '优惠标签' },
        accent: { hex: '#1D3557', name: '深蓝', usage: '对比元素' },
        background: { hex: '#FFF8E7', name: '暖白', usage: '页面背景' },
        text: { hex: '#1D3557', name: '深蓝', usage: '正文内容' },
        palette: [
            { hex: '#FF6B6B', name: '珊瑚红', usage: '辅助促销' },
            { hex: '#F4A261', name: '橙黄', usage: '倒计时' },
            { hex: '#FEE440', name: '亮黄', usage: '爆款标签' }
        ],
        gradients: [
            { name: '促销渐变', colors: ['#E63946', '#FFD700'], direction: '45deg' }
        ],
        designTips: [
            '使用大字号突出优惠力度',
            '添加倒计时、限量等紧迫元素',
            '红金搭配营造喜庆氛围',
            '可添加礼花、红包等节日元素'
        ]
    }
];

// ===== 工具函数 =====

/**
 * 根据场景获取配色方案
 */
export function getSchemesByScene(scene: string): ColorScheme[] {
    const sceneLower = scene.toLowerCase();
    return COLOR_SCHEMES.filter(s => 
        s.scenes.some(sc => sc.toLowerCase().includes(sceneLower))
    );
}

/**
 * 根据类目获取配色方案
 */
export function getSchemesByCategory(categoryId: string): ColorScheme[] {
    return COLOR_SCHEMES.filter(s => 
        s.categories.includes('all') || s.categories.includes(categoryId)
    );
}

/**
 * 根据季节获取配色方案
 */
export function getSchemesBySeason(season: ColorScheme['seasons'][number]): ColorScheme[] {
    return COLOR_SCHEMES.filter(s => 
        s.seasons.includes('all') || s.seasons.includes(season)
    );
}

/**
 * 根据情感关键词搜索
 */
export function searchSchemesByEmotion(emotion: string): ColorScheme[] {
    const emotionLower = emotion.toLowerCase();
    return COLOR_SCHEMES.filter(s => 
        s.emotions.some(e => e.toLowerCase().includes(emotionLower))
    );
}

/**
 * 根据ID获取配色方案
 */
export function getSchemeById(id: string): ColorScheme | null {
    return COLOR_SCHEMES.find(s => s.id === id) || null;
}

/**
 * 获取配色方案的 CSS 变量
 */
export function getSchemeCSSVariables(scheme: ColorScheme): Record<string, string> {
    return {
        '--color-primary': scheme.primary.hex,
        '--color-secondary': scheme.secondary.hex,
        '--color-accent': scheme.accent.hex,
        '--color-background': scheme.background.hex,
        '--color-text': scheme.text.hex,
        ...scheme.palette.reduce((acc, color, index) => ({
            ...acc,
            [`--color-palette-${index + 1}`]: color.hex
        }), {})
    };
}

/**
 * 获取适合的渐变 CSS
 */
export function getGradientCSS(scheme: ColorScheme, gradientIndex: number = 0): string {
    if (!scheme.gradients || scheme.gradients.length === 0) {
        return `linear-gradient(135deg, ${scheme.primary.hex}, ${scheme.secondary.hex})`;
    }
    const gradient = scheme.gradients[gradientIndex];
    return `linear-gradient(${gradient.direction}, ${gradient.colors.join(', ')})`;
}

/**
 * 智能推荐配色方案
 */
export function recommendColorScheme(options: {
    category?: string;
    season?: string;
    emotion?: string;
    scene?: string;
}): ColorScheme[] {
    let candidates = [...COLOR_SCHEMES];
    
    if (options.category) {
        candidates = candidates.filter(s => 
            s.categories.includes('all') || s.categories.includes(options.category!)
        );
    }
    
    if (options.season) {
        const season = options.season as ColorScheme['seasons'][number];
        candidates = candidates.filter(s => 
            s.seasons.includes('all') || s.seasons.includes(season)
        );
    }
    
    if (options.emotion) {
        const emotionLower = options.emotion.toLowerCase();
        candidates = candidates.filter(s => 
            s.emotions.some(e => e.toLowerCase().includes(emotionLower))
        );
    }
    
    if (options.scene) {
        const sceneLower = options.scene.toLowerCase();
        candidates = candidates.filter(s => 
            s.scenes.some(sc => sc.toLowerCase().includes(sceneLower))
        );
    }
    
    // 如果筛选后没有结果，返回前3个默认方案
    if (candidates.length === 0) {
        return COLOR_SCHEMES.slice(0, 3);
    }
    
    return candidates;
}

export default {
    schemes: COLOR_SCHEMES,
    getSchemesByScene,
    getSchemesByCategory,
    getSchemesBySeason,
    searchSchemesByEmotion,
    getSchemeById,
    getSchemeCSSVariables,
    getGradientCSS,
    recommendColorScheme
};
