/**
 * 视觉标注服务
 * 
 * 核心功能：
 * 在画布截图上绘制图层边界框和编号标注，
 * 让 AI 能够将图层信息与画面中的视觉元素对应起来
 */

import sharp from 'sharp';

/**
 * 图层边界信息
 */
export interface LayerBounds {
    id: number;
    index: number;
    name: string;
    kind: string;
    visible: boolean;
    bounds: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
    textContent?: string;
    color?: string;
}

/**
 * 标注样式配置
 */
interface AnnotationStyle {
    strokeWidth: number;
    fontSize: number;
    showLabels: boolean;
    showBounds: boolean;
    labelBackground: boolean;
}

/**
 * 颜色配置 - 按图层类型分配不同颜色
 */
const LAYER_COLORS: Record<string, string> = {
    text: '#FF6B6B',          // 红色 - 文本图层
    pixel: '#4ECDC4',         // 青色 - 像素图层
    smartObject: '#45B7D1',   // 蓝色 - 智能对象
    group: '#96CEB4',         // 绿色 - 组
    shape: '#FFEAA7',         // 黄色 - 形状
    adjustment: '#DDA0DD',    // 紫色 - 调整图层
    default: '#FFFFFF'        // 白色 - 默认
};

/**
 * 视觉标注服务
 */
export class VisualAnnotationService {
    private defaultStyle: AnnotationStyle = {
        strokeWidth: 2,
        fontSize: 14,
        showLabels: true,
        showBounds: true,
        labelBackground: true
    };

    /**
     * 在截图上绘制图层边界框标注
     */
    async annotateSnapshot(
        imageBase64: string,
        layers: LayerBounds[],
        options?: Partial<AnnotationStyle>
    ): Promise<{
        success: boolean;
        annotatedImage?: string;
        layerMapping?: string;
        error?: string;
    }> {
        try {
            const style = { ...this.defaultStyle, ...options };
            
            // 解码 base64 图像
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            
            if (!metadata.width || !metadata.height) {
                throw new Error('无法获取图像尺寸');
            }

            // 为每个图层分配颜色
            const coloredLayers = layers.map(layer => ({
                ...layer,
                color: LAYER_COLORS[layer.kind] || LAYER_COLORS.default
            }));

            // 生成 SVG 标注层
            const svgAnnotations = this.generateSvgAnnotations(
                coloredLayers,
                metadata.width,
                metadata.height,
                style
            );

            // 将 SVG 叠加到图像上
            const annotatedBuffer = await image
                .composite([{
                    input: Buffer.from(svgAnnotations),
                    top: 0,
                    left: 0
                }])
                .jpeg({ quality: 92 })
                .toBuffer();

            // 生成图层映射文本
            const layerMapping = this.generateLayerMapping(coloredLayers);

            return {
                success: true,
                annotatedImage: annotatedBuffer.toString('base64'),
                layerMapping: layerMapping
            };

        } catch (error) {
            console.error('[VisualAnnotationService] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '标注失败'
            };
        }
    }

    /**
     * 生成 SVG 标注层
     */
    private generateSvgAnnotations(
        layers: LayerBounds[],
        width: number,
        height: number,
        style: AnnotationStyle
    ): string {
        const annotations: string[] = [];

        for (const layer of layers) {
            const { bounds, index, name, kind, color } = layer;
            
            // 跳过太小的图层
            if (bounds.width < 10 || bounds.height < 10) continue;

            // 绘制边界框
            if (style.showBounds) {
                annotations.push(`
                    <rect 
                        x="${bounds.left}" 
                        y="${bounds.top}" 
                        width="${bounds.width}" 
                        height="${bounds.height}"
                        fill="none"
                        stroke="${color}"
                        stroke-width="${style.strokeWidth}"
                        stroke-dasharray="${kind === 'group' ? '5,5' : 'none'}"
                    />
                `);
            }

            // 绘制编号标签
            if (style.showLabels) {
                const labelX = bounds.left + 2;
                const labelY = bounds.top + style.fontSize + 2;
                const labelText = `[${index}]`;
                const labelWidth = labelText.length * (style.fontSize * 0.6) + 8;
                const labelHeight = style.fontSize + 6;

                // 标签背景
                if (style.labelBackground) {
                    annotations.push(`
                        <rect 
                            x="${labelX - 2}" 
                            y="${bounds.top + 2}" 
                            width="${labelWidth}" 
                            height="${labelHeight}"
                            fill="${color}"
                            rx="2"
                        />
                    `);
                }

                // 标签文字
                annotations.push(`
                    <text 
                        x="${labelX + 2}" 
                        y="${labelY}"
                        fill="${style.labelBackground ? '#000' : color}"
                        font-family="Arial, sans-serif"
                        font-size="${style.fontSize}px"
                        font-weight="bold"
                    >${labelText}</text>
                `);
            }
        }

        return `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                ${annotations.join('\n')}
            </svg>
        `;
    }

    /**
     * 生成图层映射文本
     * 格式：[编号] 图层名称 (类型) - 简要描述
     */
    private generateLayerMapping(layers: LayerBounds[]): string {
        const typeLabels: Record<string, string> = {
            text: '文本',
            pixel: '图像',
            smartObject: '智能对象',
            group: '组',
            shape: '形状',
            adjustment: '调整图层'
        };

        const colorLabels: Record<string, string> = {
            '#FF6B6B': '红框',
            '#4ECDC4': '青框',
            '#45B7D1': '蓝框',
            '#96CEB4': '绿框',
            '#FFEAA7': '黄框',
            '#DDA0DD': '紫框',
            '#FFFFFF': '白框'
        };

        const lines: string[] = [
            '📋 图层映射表（编号对应截图中的标注框）：',
            '=' .repeat(50),
            ''
        ];

        for (const layer of layers) {
            const typeLabel = typeLabels[layer.kind] || layer.kind;
            const colorLabel = colorLabels[layer.color || '#FFFFFF'] || '';
            const position = this.describePosition(layer.bounds);
            
            let line = `[${layer.index}] ${layer.name} (${typeLabel})`;
            
            // 添加位置描述
            line += ` - ${position}`;
            
            // 如果是文本，添加内容预览
            if (layer.textContent) {
                const preview = layer.textContent.length > 20 
                    ? layer.textContent.substring(0, 20) + '...'
                    : layer.textContent;
                line += ` "${preview}"`;
            }

            lines.push(line);
        }

        lines.push('');
        lines.push('=' .repeat(50));
        lines.push('颜色说明：红=文本 | 青=图像 | 蓝=智能对象 | 绿=组 | 黄=形状');

        return lines.join('\n');
    }

    /**
     * 描述图层在画面中的位置
     */
    private describePosition(bounds: LayerBounds['bounds']): string {
        // 假设画面分为 3x3 九宫格
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        
        // 这里使用相对位置，实际使用时可以根据图像尺寸调整
        let horizontal = '';
        let vertical = '';

        // 简化的位置描述
        if (bounds.left < 100) horizontal = '左侧';
        else if (bounds.right > 1000) horizontal = '右侧';
        else horizontal = '中部';

        if (bounds.top < 100) vertical = '顶部';
        else if (bounds.bottom > 700) vertical = '底部';
        else vertical = '中间';

        return `${vertical}${horizontal}`;
    }

    /**
     * 获取图层颜色
     */
    getLayerColor(kind: string): string {
        return LAYER_COLORS[kind] || LAYER_COLORS.default;
    }
}

// 单例
let instance: VisualAnnotationService | null = null;

export function getVisualAnnotationService(): VisualAnnotationService {
    if (!instance) {
        instance = new VisualAnnotationService();
    }
    return instance;
}
