/**
 * 审美知识库服务
 * 
 * 核心职责：
 * 1. 管理专业设计知识（排版、配色、字体等审美参考）
 * 2. 为 AI 决策提供上下文
 * 3. 学习用户的设计偏好
 * 
 * 设计理念：
 * - 知识库提供"参考"而非"规则"
 * - AI 基于知识库 + 当前上下文做动态审美判断
 * - 支持用户私有知识的积累和学习
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
    AestheticKnowledgeBase,
    AestheticReference,
    LayoutKnowledge,
    ColorKnowledge,
    TypographyKnowledge,
    ProductAssetKnowledge,
    DesignType,
    DesignStyle
} from './types';

// ==================== 默认知识库 ====================

const DEFAULT_AESTHETIC_REFERENCES: AestheticReference[] = [
    {
        id: 'ref-main-minimal',
        name: '简约主图',
        description: '大量留白，产品突出，适合高端产品',
        designType: 'mainImage',
        style: 'minimal',
        visualParams: {
            subjectRatio: { min: 0.50, ideal: 0.60, max: 0.70 },
            position: {
                vertical: 'center',
                horizontal: 'center',
                offsetY: -0.03  // 略偏上
            },
            whitespace: { top: 0.15, bottom: 0.20, left: 0.15, right: 0.15 }
        },
        principles: [
            '留白赋予产品呼吸感，显得高端',
            '产品不宜太大，避免廉价感',
            '视觉重心略高于画面中心更舒适'
        ],
        applicableScenarios: ['高端产品', '简约风格', '强调品质感'],
        avoidScenarios: ['促销活动', '需要大量文案的设计'],
        weight: 0.9
    },
    {
        id: 'ref-main-rich',
        name: '饱满主图',
        description: '产品较大，信息丰富，适合大众消费品',
        designType: 'mainImage',
        style: 'rich',
        visualParams: {
            subjectRatio: { min: 0.65, ideal: 0.72, max: 0.80 },
            position: {
                vertical: 'center',
                horizontal: 'center',
                offsetY: 0
            },
            whitespace: { top: 0.08, bottom: 0.12, left: 0.10, right: 0.10 }
        },
        principles: [
            '产品占据主导，细节清晰可见',
            '适合需要展示产品细节的场景',
            '留出必要空间放置卖点标签'
        ],
        applicableScenarios: ['日用品', '需要展示细节', '性价比产品'],
        avoidScenarios: ['极简风格', '高端定位'],
        weight: 0.8
    },
    {
        id: 'ref-detail-hero-balanced',
        name: '详情页首屏平衡布局',
        description: '上方文案区 + 下方产品区的经典布局',
        designType: 'detailHero',
        style: 'elegant',
        visualParams: {
            subjectRatio: { min: 0.40, ideal: 0.50, max: 0.60 },
            position: {
                vertical: 'bottom-third',
                horizontal: 'center',
                offsetY: 0.15
            },
            whitespace: { top: 0.35, bottom: 0.05, left: 0.10, right: 0.10 }
        },
        principles: [
            '上方 35-40% 用于核心卖点文案',
            '产品作为视觉支撑在下方',
            '文案与产品形成视觉平衡'
        ],
        applicableScenarios: ['详情页首屏', '需要突出卖点', '标准电商布局'],
        avoidScenarios: ['纯产品展示'],
        weight: 0.9
    },
    {
        id: 'ref-sku-focused',
        name: 'SKU 聚焦布局',
        description: 'SKU 图以产品为绝对主体，最大化展示',
        designType: 'skuImage',
        style: 'minimal',
        visualParams: {
            subjectRatio: { min: 0.75, ideal: 0.82, max: 0.90 },
            position: {
                vertical: 'center',
                horizontal: 'center',
                offsetY: 0
            },
            whitespace: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 }
        },
        principles: [
            'SKU 图必须让用户快速识别颜色/款式',
            '背景简洁，不干扰产品判断',
            '保持所有 SKU 图风格统一'
        ],
        applicableScenarios: ['SKU 选择器', '颜色展示'],
        avoidScenarios: ['需要文案的设计'],
        weight: 1.0
    }
];

const DEFAULT_LAYOUT_KNOWLEDGE: LayoutKnowledge[] = [
    {
        id: 'layout-golden-ratio',
        type: 'composition',
        title: '黄金分割构图',
        description: '使用 1.618 的黄金比例创造视觉和谐',
        guidance: [
            '将画面按 1:1.618 分割',
            '主体放置在分割线附近',
            '适用于需要自然美感的设计'
        ],
        applicableTypes: ['mainImage', 'detailHero', 'banner'],
        keywords: ['黄金分割', '和谐', '经典构图']
    },
    {
        id: 'layout-rule-of-thirds',
        type: 'composition',
        title: '三分法构图',
        description: '将画面分成九宫格，重点放在交叉点',
        guidance: [
            '画面横竖各分三等分',
            '产品主体或视觉焦点放在四个交叉点之一',
            '避免完全居中（除非刻意为之）'
        ],
        applicableTypes: ['mainImage', 'detailHero', 'banner'],
        keywords: ['三分法', '九宫格', '焦点']
    },
    {
        id: 'layout-visual-balance',
        type: 'balance',
        title: '视觉平衡',
        description: '确保画面左右、上下的视觉重量平衡',
        guidance: [
            '大面积浅色与小面积深色可以平衡',
            '多个小元素可以平衡一个大元素',
            '空白也是一种视觉元素'
        ],
        applicableTypes: ['mainImage', 'detailHero', 'colorShowcase'],
        keywords: ['平衡', '对称', '重量感']
    },
    {
        id: 'layout-breathing-room',
        type: 'spacing',
        title: '呼吸感留白',
        description: '适当的留白让设计更高级',
        guidance: [
            '产品边缘与画布边缘保持 5-15% 的距离',
            '留白越多，越显高端',
            '但过多留白会显得产品太小'
        ],
        applicableTypes: ['mainImage', 'skuImage'],
        keywords: ['留白', '呼吸感', '高端']
    },
    {
        id: 'layout-visual-center',
        type: 'alignment',
        title: '视觉中心定位',
        description: '视觉中心略高于几何中心',
        guidance: [
            '人眼的视觉中心约在画面上方 45% 处',
            '产品重心对齐视觉中心更舒适',
            '底部留白略多于顶部'
        ],
        applicableTypes: ['mainImage', 'skuImage'],
        keywords: ['视觉中心', '居中', '舒适']
    }
];

const DEFAULT_COLOR_KNOWLEDGE: ColorKnowledge[] = [
    {
        id: 'color-neutral-elegance',
        name: '中性优雅',
        type: 'neutral',
        primaryColors: ['#FFFFFF', '#F5F5F5', '#E8E8E8'],
        accentColors: ['#333333', '#666666'],
        mood: ['高端', '简约', '专业'],
        suitableFor: ['高端产品主图', '品质感详情页'],
        guidelines: [
            '白底最适合淘宝搜索权重',
            '深灰色文字确保可读性',
            '避免纯黑，使用深灰更柔和'
        ]
    },
    {
        id: 'color-warm-natural',
        name: '暖色自然',
        type: 'analogous',
        primaryColors: ['#FFF8F0', '#FFE4D6'],
        accentColors: ['#D4A574', '#8B6914'],
        mood: ['温暖', '亲切', '自然'],
        suitableFor: ['棉质产品', '家居用品', '母婴产品'],
        guidelines: [
            '米白色背景传递温暖感',
            '棕色系强调天然材质',
            '适合强调舒适、亲肤的产品'
        ]
    },
    {
        id: 'color-fresh-vibrant',
        name: '清新活力',
        type: 'complementary',
        primaryColors: ['#E8F5E9', '#E3F2FD'],
        accentColors: ['#4CAF50', '#2196F3'],
        mood: ['清新', '活力', '年轻'],
        suitableFor: ['运动产品', '夏季产品', '年轻人群'],
        guidelines: [
            '浅绿浅蓝传递清新感',
            '适合运动、透气等卖点',
            '色彩饱和度不宜过高'
        ]
    }
];

const DEFAULT_TYPOGRAPHY_KNOWLEDGE: TypographyKnowledge[] = [
    {
        id: 'typo-headline-impact',
        purpose: 'headline',
        fontFamilies: ['阿里巴巴普惠体', 'PingFang SC', '思源黑体', '微软雅黑'],
        fontSize: { min: 48, ideal: 72, max: 120, unit: 'px' },
        lineHeight: 1.2,
        fontWeight: 'bold',
        applicableTypes: ['detailHero', 'banner'],
        guidelines: [
            '标题要大且醒目',
            '使用粗体增强冲击力',
            '行高紧凑，文字紧密'
        ]
    },
    {
        id: 'typo-body-readable',
        purpose: 'body',
        fontFamilies: ['PingFang SC', '思源黑体', '微软雅黑'],
        fontSize: { min: 24, ideal: 28, max: 36, unit: 'px' },
        lineHeight: 1.6,
        fontWeight: 'regular',
        applicableTypes: ['detailHero', 'detailSection'],
        guidelines: [
            '正文需要良好的可读性',
            '行高 1.5-1.8 确保阅读舒适',
            '避免过小的字号'
        ]
    },
    {
        id: 'typo-label-subtle',
        purpose: 'label',
        fontFamilies: ['PingFang SC', '思源黑体'],
        fontSize: { min: 18, ideal: 24, max: 32, unit: 'px' },
        lineHeight: 1.4,
        fontWeight: 'medium',
        applicableTypes: ['mainImage', 'skuImage'],
        guidelines: [
            '标签文字要简洁',
            '不要喧宾夺主，产品才是主体',
            '使用适当的对比度确保可读'
        ]
    }
];

// ==================== 服务类 ====================

export class AestheticKnowledgeService {
    private knowledgeBase: AestheticKnowledgeBase;
    private userKnowledgePath: string;
    private initialized: boolean = false;
    
    constructor() {
        this.userKnowledgePath = path.join(
            app.getPath('userData'),
            'aesthetic-knowledge'
        );
        
        // 初始化默认知识库
        this.knowledgeBase = {
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            references: DEFAULT_AESTHETIC_REFERENCES,
            layoutKnowledge: DEFAULT_LAYOUT_KNOWLEDGE,
            colorKnowledge: DEFAULT_COLOR_KNOWLEDGE,
            typographyKnowledge: DEFAULT_TYPOGRAPHY_KNOWLEDGE,
            productAssetKnowledge: []
        };
    }
    
    /**
     * 初始化服务
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        try {
            // 确保目录存在
            if (!fs.existsSync(this.userKnowledgePath)) {
                fs.mkdirSync(this.userKnowledgePath, { recursive: true });
            }
            
            // 加载用户自定义知识
            await this.loadUserKnowledge();
            
            this.initialized = true;
            console.log('[AestheticKnowledge] ✓ 初始化完成');
            console.log(`  - 审美参考: ${this.knowledgeBase.references.length} 条`);
            console.log(`  - 布局知识: ${this.knowledgeBase.layoutKnowledge.length} 条`);
            console.log(`  - 配色知识: ${this.knowledgeBase.colorKnowledge.length} 条`);
            console.log(`  - 字体知识: ${this.knowledgeBase.typographyKnowledge.length} 条`);
        } catch (error: any) {
            console.error('[AestheticKnowledge] 初始化失败:', error.message);
        }
    }
    
    /**
     * 加载用户自定义知识
     */
    private async loadUserKnowledge(): Promise<void> {
        const userKnowledgeFile = path.join(this.userKnowledgePath, 'user-knowledge.json');
        
        if (fs.existsSync(userKnowledgeFile)) {
            try {
                const content = fs.readFileSync(userKnowledgeFile, 'utf-8');
                const userKnowledge = JSON.parse(content);
                
                // 合并用户知识（用户知识优先级更高）
                if (userKnowledge.references) {
                    this.knowledgeBase.references = [
                        ...userKnowledge.references,
                        ...this.knowledgeBase.references
                    ];
                }
                if (userKnowledge.productAssetKnowledge) {
                    this.knowledgeBase.productAssetKnowledge = userKnowledge.productAssetKnowledge;
                }
                
                console.log('[AestheticKnowledge] 已加载用户自定义知识');
            } catch (error: any) {
                console.warn('[AestheticKnowledge] 加载用户知识失败:', error.message);
            }
        }
    }
    
    /**
     * 保存用户知识
     */
    private async saveUserKnowledge(): Promise<void> {
        const userKnowledgeFile = path.join(this.userKnowledgePath, 'user-knowledge.json');
        
        const userKnowledge = {
            productAssetKnowledge: this.knowledgeBase.productAssetKnowledge,
            lastUpdated: new Date().toISOString()
        };
        
        fs.writeFileSync(userKnowledgeFile, JSON.stringify(userKnowledge, null, 2), 'utf-8');
    }
    
    // ==================== 检索方法 ====================
    
    /**
     * 获取设计类型相关的审美参考
     */
    getReferencesForDesignType(designType: DesignType, style?: DesignStyle): AestheticReference[] {
        let refs = this.knowledgeBase.references.filter(
            ref => ref.designType === designType
        );
        
        if (style) {
            refs = refs.filter(ref => ref.style === style);
        }
        
        // 按权重排序
        return refs.sort((a, b) => b.weight - a.weight);
    }
    
    /**
     * 获取布局知识
     */
    getLayoutKnowledge(designType?: DesignType, keywords?: string[]): LayoutKnowledge[] {
        let knowledge = this.knowledgeBase.layoutKnowledge;
        
        if (designType) {
            knowledge = knowledge.filter(k => k.applicableTypes.includes(designType));
        }
        
        if (keywords && keywords.length > 0) {
            knowledge = knowledge.filter(k =>
                keywords.some(kw => k.keywords.includes(kw))
            );
        }
        
        return knowledge;
    }
    
    /**
     * 获取配色知识
     */
    getColorKnowledge(scenario?: string): ColorKnowledge[] {
        if (!scenario) return this.knowledgeBase.colorKnowledge;
        
        return this.knowledgeBase.colorKnowledge.filter(c =>
            c.suitableFor.some(s => s.includes(scenario))
        );
    }
    
    /**
     * 获取字体知识
     */
    getTypographyKnowledge(purpose?: TypographyKnowledge['purpose'], designType?: DesignType): TypographyKnowledge[] {
        let knowledge = this.knowledgeBase.typographyKnowledge;
        
        if (purpose) {
            knowledge = knowledge.filter(k => k.purpose === purpose);
        }
        
        if (designType) {
            knowledge = knowledge.filter(k => k.applicableTypes.includes(designType));
        }
        
        return knowledge;
    }
    
    // ==================== AI 决策上下文生成 ====================
    
    /**
     * 生成 AI 决策所需的知识上下文
     * 这是核心方法：将知识库转换为 LLM 可理解的提示词
     */
    generateKnowledgeContext(designType: DesignType, style?: DesignStyle): string {
        const references = this.getReferencesForDesignType(designType, style);
        const layoutKnowledge = this.getLayoutKnowledge(designType);
        
        let context = `## 设计审美参考\n\n`;
        
        // 审美参考
        if (references.length > 0) {
            context += `### 该设计类型的参考案例\n\n`;
            for (const ref of references.slice(0, 3)) {  // 最多 3 个
                context += `**${ref.name}** (${ref.style} 风格)\n`;
                context += `${ref.description}\n`;
                context += `- 主体占比参考: ${Math.round(ref.visualParams.subjectRatio.min * 100)}% ~ ${Math.round(ref.visualParams.subjectRatio.max * 100)}%，理想 ${Math.round(ref.visualParams.subjectRatio.ideal * 100)}%\n`;
                context += `- 位置: ${ref.visualParams.position.vertical} / ${ref.visualParams.position.horizontal}\n`;
                context += `- 设计原则:\n`;
                for (const principle of ref.principles) {
                    context += `  - ${principle}\n`;
                }
                context += `\n`;
            }
        }
        
        // 布局知识
        if (layoutKnowledge.length > 0) {
            context += `### 布局设计知识\n\n`;
            for (const knowledge of layoutKnowledge.slice(0, 4)) {
                context += `**${knowledge.title}**\n`;
                context += `${knowledge.description}\n`;
                for (const guide of knowledge.guidance) {
                    context += `- ${guide}\n`;
                }
                context += `\n`;
            }
        }
        
        return context;
    }
    
    /**
     * 生成完整的 AI 决策提示词
     */
    generateDecisionPrompt(
        designType: DesignType,
        canvasSize: { width: number; height: number },
        assetInfo: { width: number; height: number; subjectRatio?: number },
        userIntent?: string
    ): string {
        const knowledgeContext = this.generateKnowledgeContext(designType);
        
        return `你是专业的电商视觉设计师，需要决定如何在画布上放置产品图片。

${knowledgeContext}

## 当前任务

【画布信息】
- 尺寸: ${canvasSize.width} × ${canvasSize.height} px
- 设计类型: ${designType}

【素材信息】
- 原始尺寸: ${assetInfo.width} × ${assetInfo.height} px
${assetInfo.subjectRatio ? `- 主体占比: ${Math.round(assetInfo.subjectRatio * 100)}%` : ''}

${userIntent ? `【用户意图】\n${userIntent}\n` : ''}

## 决策要求

基于以上知识和当前场景，请决策：
1. 缩放比例 (scale): 主体应该缩放到多大
2. 位置 (x, y): 产品应该放在画布的什么位置（像素值）
3. 决策理由: 一句话解释为什么这样放置更好

请直接返回 JSON 格式：
{
    "scale": 数字,
    "position": { "x": 数字, "y": 数字 },
    "reason": "中文理由",
    "confidence": 0-1 的置信度
}

只返回 JSON，不要其他文字。`;
    }
    
    // ==================== 素材知识管理 ====================
    
    /**
     * 获取素材的关联知识
     */
    getAssetKnowledge(assetId: string): ProductAssetKnowledge | undefined {
        return this.knowledgeBase.productAssetKnowledge.find(k => k.assetId === assetId);
    }
    
    /**
     * 更新素材的关联知识
     */
    async updateAssetKnowledge(knowledge: ProductAssetKnowledge): Promise<void> {
        const index = this.knowledgeBase.productAssetKnowledge.findIndex(
            k => k.assetId === knowledge.assetId
        );
        
        if (index >= 0) {
            this.knowledgeBase.productAssetKnowledge[index] = knowledge;
        } else {
            this.knowledgeBase.productAssetKnowledge.push(knowledge);
        }
        
        await this.saveUserKnowledge();
    }
    
    /**
     * 记录素材使用历史（用于学习）
     */
    async recordAssetUsage(
        assetId: string,
        usage: {
            projectId: string;
            designType: DesignType;
            position: { x: number; y: number };
            scale: number;
            userFeedback?: 'positive' | 'negative' | 'neutral';
        }
    ): Promise<void> {
        let knowledge = this.getAssetKnowledge(assetId);
        
        if (!knowledge) {
            knowledge = {
                assetId,
                sellingPoints: [],
                usageScenarios: [],
                visualFeatures: {
                    subjectShape: 'square',
                    visualCenter: { x: 0.5, y: 0.5 },
                    hasTransparency: false,
                    dominantColors: []
                },
                recommendedUsage: [],
                usageHistory: []
            };
        }
        
        if (!knowledge.usageHistory) {
            knowledge.usageHistory = [];
        }
        
        knowledge.usageHistory.push({
            ...usage,
            timestamp: new Date().toISOString()
        });
        
        // 保留最近 50 条历史
        if (knowledge.usageHistory.length > 50) {
            knowledge.usageHistory = knowledge.usageHistory.slice(-50);
        }
        
        await this.updateAssetKnowledge(knowledge);
    }
    
    // ==================== 统计信息 ====================
    
    /**
     * 获取知识库统计信息
     */
    getStatistics(): {
        references: number;
        layoutKnowledge: number;
        colorKnowledge: number;
        typographyKnowledge: number;
        productAssets: number;
    } {
        return {
            references: this.knowledgeBase.references.length,
            layoutKnowledge: this.knowledgeBase.layoutKnowledge.length,
            colorKnowledge: this.knowledgeBase.colorKnowledge.length,
            typographyKnowledge: this.knowledgeBase.typographyKnowledge.length,
            productAssets: this.knowledgeBase.productAssetKnowledge.length
        };
    }
}

// ==================== 单例导出 ====================

let instance: AestheticKnowledgeService | null = null;

export function getAestheticKnowledgeService(): AestheticKnowledgeService {
    if (!instance) {
        instance = new AestheticKnowledgeService();
    }
    return instance;
}

export default AestheticKnowledgeService;
