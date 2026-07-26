/**
 * 设计规范引擎
 * 
 * 检查设计输出是否符合电商平台规范
 */

// ===== 规范规则类型 =====

export interface SpecRule {
    id: string;
    name: string;
    description: string;
    category: 'dimension' | 'format' | 'content' | 'quality';
    severity: 'error' | 'warning' | 'info';
    check: (context: DesignContext) => SpecCheckResult;
}

export interface SpecCheckResult {
    passed: boolean;
    message: string;
    details?: string;
    suggestion?: string;
}

export interface DesignContext {
    type: 'mainImage' | 'sku' | 'detailPage';
    width: number;
    height: number;
    format?: string;
    fileSize?: number;  // KB
    hasText?: boolean;
    textCount?: number;
    hasProduct?: boolean;
    backgroundColor?: string;
    dominantColors?: string[];
}

export interface SpecCheckReport {
    passed: boolean;
    score: number;  // 0-100
    errors: SpecCheckResult[];
    warnings: SpecCheckResult[];
    infos: SpecCheckResult[];
    summary: string;
}

// ===== 淘宝平台规范 =====

const TAOBAO_SPECS = {
    mainImage: {
        width: { min: 800, max: 1500, recommended: 800 },
        height: { min: 800, max: 1500, recommended: 800 },
        ratio: 1,  // 正方形
        maxFileSize: 3000,  // KB
        formats: ['jpg', 'png'],
        minQuality: 80
    },
    sku: {
        width: { min: 800, max: 800, recommended: 800 },
        height: { min: 800, max: 800, recommended: 800 },
        ratio: 1,
        maxFileSize: 500,
        formats: ['jpg'],
        minQuality: 85
    },
    detailPage: {
        width: { min: 750, max: 790, recommended: 750 },
        maxHeight: 10000,
        maxFileSize: 5000,
        formats: ['jpg', 'png'],
        minQuality: 80
    }
};

// ===== 规范规则定义 =====

const SPEC_RULES: SpecRule[] = [
    // 尺寸规则
    {
        id: 'dim-001',
        name: '主图尺寸检查',
        description: '主图尺寸必须为 800×800 像素',
        category: 'dimension',
        severity: 'error',
        check: (ctx) => {
            if (ctx.type !== 'mainImage') return { passed: true, message: '不适用' };
            const spec = TAOBAO_SPECS.mainImage;
            const passed = ctx.width >= spec.width.min && 
                          ctx.width <= spec.width.max &&
                          ctx.height >= spec.height.min && 
                          ctx.height <= spec.height.max;
            return {
                passed,
                message: passed 
                    ? `尺寸正确: ${ctx.width}×${ctx.height}` 
                    : `尺寸不符: ${ctx.width}×${ctx.height}`,
                suggestion: passed ? undefined : `建议使用 ${spec.width.recommended}×${spec.height.recommended}`
            };
        }
    },
    {
        id: 'dim-002',
        name: '主图比例检查',
        description: '主图必须为正方形 (1:1)',
        category: 'dimension',
        severity: 'error',
        check: (ctx) => {
            if (ctx.type !== 'mainImage') return { passed: true, message: '不适用' };
            const ratio = ctx.width / ctx.height;
            const passed = Math.abs(ratio - 1) < 0.01;
            return {
                passed,
                message: passed 
                    ? '比例正确 (1:1)' 
                    : `比例不正确: ${ratio.toFixed(2)}:1`,
                suggestion: passed ? undefined : '主图必须为正方形'
            };
        }
    },
    {
        id: 'dim-003',
        name: 'SKU图尺寸检查',
        description: 'SKU图尺寸必须为 800×800 像素',
        category: 'dimension',
        severity: 'error',
        check: (ctx) => {
            if (ctx.type !== 'sku') return { passed: true, message: '不适用' };
            const passed = ctx.width === 800 && ctx.height === 800;
            return {
                passed,
                message: passed 
                    ? 'SKU图尺寸正确' 
                    : `SKU图尺寸不符: ${ctx.width}×${ctx.height}`,
                suggestion: passed ? undefined : 'SKU图必须为 800×800'
            };
        }
    },
    {
        id: 'dim-004',
        name: '详情页宽度检查',
        description: '详情页宽度必须为 750-790 像素',
        category: 'dimension',
        severity: 'error',
        check: (ctx) => {
            if (ctx.type !== 'detailPage') return { passed: true, message: '不适用' };
            const spec = TAOBAO_SPECS.detailPage;
            const passed = ctx.width >= spec.width.min && ctx.width <= spec.width.max;
            return {
                passed,
                message: passed 
                    ? `详情页宽度正确: ${ctx.width}px` 
                    : `详情页宽度不符: ${ctx.width}px`,
                suggestion: passed ? undefined : `宽度应在 ${spec.width.min}-${spec.width.max}px 之间`
            };
        }
    },

    // 格式规则
    {
        id: 'fmt-001',
        name: '文件格式检查',
        description: '图片格式必须为 JPG 或 PNG',
        category: 'format',
        severity: 'error',
        check: (ctx) => {
            if (!ctx.format) return { passed: true, message: '格式未知' };
            const validFormats = ['jpg', 'jpeg', 'png'];
            const passed = validFormats.includes(ctx.format.toLowerCase());
            return {
                passed,
                message: passed 
                    ? `格式正确: ${ctx.format.toUpperCase()}` 
                    : `格式不支持: ${ctx.format}`,
                suggestion: passed ? undefined : '请使用 JPG 或 PNG 格式'
            };
        }
    },
    {
        id: 'fmt-002',
        name: '文件大小检查',
        description: '文件大小不能超过限制',
        category: 'format',
        severity: 'warning',
        check: (ctx) => {
            if (!ctx.fileSize) return { passed: true, message: '大小未知' };
            let maxSize = 3000;  // 默认 3MB
            if (ctx.type === 'sku') maxSize = 500;
            if (ctx.type === 'detailPage') maxSize = 5000;
            
            const passed = ctx.fileSize <= maxSize;
            return {
                passed,
                message: passed 
                    ? `文件大小正常: ${(ctx.fileSize / 1024).toFixed(1)}MB` 
                    : `文件过大: ${(ctx.fileSize / 1024).toFixed(1)}MB`,
                suggestion: passed ? undefined : `建议压缩至 ${maxSize / 1024}MB 以下`
            };
        }
    },

    // 内容规则
    {
        id: 'cnt-001',
        name: '产品主体检查',
        description: '图片应包含产品主体',
        category: 'content',
        severity: 'warning',
        check: (ctx) => {
            if (ctx.hasProduct === undefined) return { passed: true, message: '未检测' };
            return {
                passed: ctx.hasProduct,
                message: ctx.hasProduct ? '检测到产品主体' : '未检测到产品主体',
                suggestion: ctx.hasProduct ? undefined : '确保产品主体清晰可见'
            };
        }
    },
    {
        id: 'cnt-002',
        name: '文字数量检查',
        description: '主图文字不宜过多',
        category: 'content',
        severity: 'info',
        check: (ctx) => {
            if (ctx.type !== 'mainImage') return { passed: true, message: '不适用' };
            if (ctx.textCount === undefined) return { passed: true, message: '未检测' };
            const passed = ctx.textCount <= 5;
            return {
                passed,
                message: passed 
                    ? `文字数量适中: ${ctx.textCount} 处` 
                    : `文字较多: ${ctx.textCount} 处`,
                suggestion: passed ? undefined : '建议减少文字，突出产品'
            };
        }
    },
    {
        id: 'cnt-003',
        name: '背景颜色检查',
        description: '检查背景是否为纯色或简洁',
        category: 'content',
        severity: 'info',
        check: (ctx) => {
            if (!ctx.backgroundColor) return { passed: true, message: '未检测' };
            const isWhite = ctx.backgroundColor.toLowerCase() === '#ffffff' || 
                           ctx.backgroundColor.toLowerCase() === 'white';
            return {
                passed: true,
                message: isWhite ? '白底背景' : `背景色: ${ctx.backgroundColor}`,
                details: isWhite ? '白底有利于搜索排名' : undefined
            };
        }
    }
];

// ===== 设计规范服务类 =====

class DesignSpecService {
    private rules: SpecRule[] = SPEC_RULES;

    /**
     * 检查设计是否符合规范
     */
    check(context: DesignContext): SpecCheckReport {
        const errors: SpecCheckResult[] = [];
        const warnings: SpecCheckResult[] = [];
        const infos: SpecCheckResult[] = [];

        for (const rule of this.rules) {
            const result = rule.check(context);
            
            // 跳过"不适用"的规则
            if (result.message === '不适用') continue;

            if (!result.passed) {
                switch (rule.severity) {
                    case 'error':
                        errors.push({ ...result, message: `[${rule.name}] ${result.message}` });
                        break;
                    case 'warning':
                        warnings.push({ ...result, message: `[${rule.name}] ${result.message}` });
                        break;
                    case 'info':
                        infos.push({ ...result, message: `[${rule.name}] ${result.message}` });
                        break;
                }
            }
        }

        // 计算得分
        const errorWeight = 20;
        const warningWeight = 5;
        let score = 100 - (errors.length * errorWeight) - (warnings.length * warningWeight);
        score = Math.max(0, Math.min(100, score));

        const passed = errors.length === 0;

        // 生成摘要
        let summary = '';
        if (passed && warnings.length === 0) {
            summary = '✅ 设计完全符合规范';
        } else if (passed) {
            summary = `⚠️ 设计基本符合规范，有 ${warnings.length} 条建议`;
        } else {
            summary = `❌ 设计不符合规范，有 ${errors.length} 个错误需要修复`;
        }

        return {
            passed,
            score,
            errors,
            warnings,
            infos,
            summary
        };
    }

    /**
     * 获取特定类型的规范要求
     */
    getRequirements(type: 'mainImage' | 'sku' | 'detailPage'): object {
        return TAOBAO_SPECS[type];
    }

    /**
     * 获取所有规则
     */
    getRules(): SpecRule[] {
        return this.rules;
    }

    /**
     * 快速检查尺寸是否合规
     */
    checkDimensions(type: 'mainImage' | 'sku' | 'detailPage', width: number, height: number): {
        valid: boolean;
        message: string;
    } {
        if (type === 'mainImage') {
            const spec = TAOBAO_SPECS.mainImage;
            const validWidth = width >= spec.width.min && width <= spec.width.max;
            const validHeight = height >= spec.height.min && height <= spec.height.max;
            const valid = validWidth && validHeight;
            
            return {
                valid,
                message: valid 
                    ? `尺寸符合主图规范` 
                    : `尺寸不符合规范，建议 ${spec.width.recommended}×${spec.height.recommended}`
            };
        }
        
        if (type === 'sku') {
            const spec = TAOBAO_SPECS.sku;
            const validWidth = width >= spec.width.min && width <= spec.width.max;
            const validHeight = height >= spec.height.min && height <= spec.height.max;
            const valid = validWidth && validHeight;
            
            return {
                valid,
                message: valid 
                    ? `尺寸符合SKU规范` 
                    : `尺寸不符合规范，建议 ${spec.width.recommended}×${spec.height.recommended}`
            };
        }
        
        if (type === 'detailPage') {
            const spec = TAOBAO_SPECS.detailPage;
            const valid = width >= spec.width.min && width <= spec.width.max;
            return {
                valid,
                message: valid 
                    ? '详情页宽度符合规范' 
                    : `详情页宽度应为 ${spec.width.min}-${spec.width.max}px`
            };
        }

        return { valid: true, message: '未知类型' };
    }

    /**
     * 生成规范建议
     */
    getSuggestions(type: 'mainImage' | 'sku' | 'detailPage'): string[] {
        const suggestions: Record<string, string[]> = {
            mainImage: [
                '使用 800×800 像素尺寸',
                '产品主体占画面 60-70%',
                '使用白底或简洁背景',
                '文字标签不超过 3 个',
                '确保产品清晰无遮挡'
            ],
            sku: [
                '使用 800×800 像素尺寸',
                '产品居中显示',
                '使用统一的背景色',
                '颜色名称清晰可读',
                '保持各 SKU 风格一致'
            ],
            detailPage: [
                '宽度使用 750px',
                '每屏高度控制在 1000px 以内',
                '首屏突出核心卖点',
                '图片压缩至 500KB 以下',
                '文字清晰可读'
            ]
        };

        return suggestions[type] || [];
    }
}

// ===== 导出单例 =====

export const designSpecService = new DesignSpecService();
