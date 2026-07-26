/**
 * 获取文本样式工具
 */

import { Tool, ToolSchema, TextStyle } from '../types';
import { safeBatchPlay } from '../../core/error-handler';

const app = require('photoshop').app;
const { LayerKind } = require('photoshop').constants;

export class GetTextStyleTool implements Tool {
    name = 'getTextStyle';

    schema: ToolSchema = {
        name: 'getTextStyle',
        description: '获取文本图层的样式信息（字号、字体、颜色等）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则获取当前选中的文本图层'
                }
            }
        }
    };

    async execute(params: { layerId?: number }): Promise<{
        success: boolean;
        layerId?: number;
        style?: TextStyle;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let layer;
            
            if (params.layerId) {
                layer = this.findLayerById(doc, params.layerId);
                if (!layer) {
                    return { success: false, error: `未找到图层 ID: ${params.layerId}` };
                }
            } else {
                const activeLayers = doc.activeLayers;
                if (!activeLayers || activeLayers.length === 0) {
                    return { success: false, error: '请先选中一个文本图层' };
                }
                layer = activeLayers[0];
            }

            if (layer.kind !== LayerKind.TEXT) {
                return { success: false, error: '选中的不是文本图层' };
            }

            const textItem = layer.textItem;
            const charStyle = textItem.characterStyle;
            const descriptorStyle = await this.readDescriptorTextStyle(layer.id);

            const style: TextStyle = {
                fontSize: this.pickNumber(descriptorStyle.fontSize, charStyle.size),
                fontName: descriptorStyle.fontName || charStyle.font,
                fontStyle: charStyle.fontStyle,
                tracking: this.pickNumber(descriptorStyle.tracking, charStyle.tracking),
                leading: this.pickNumber(descriptorStyle.leading, charStyle.leading),
                horizontalScale: this.pickNumber(descriptorStyle.horizontalScale, charStyle.horizontalScale),
                verticalScale: this.pickNumber(descriptorStyle.verticalScale, charStyle.verticalScale)
            };

            // 尝试获取颜色
            try {
                if (charStyle.color) {
                    const color = charStyle.color;
                    style.color = {
                        r: Math.round(color.rgb.red),
                        g: Math.round(color.rgb.green),
                        b: Math.round(color.rgb.blue)
                    };
                }
            } catch (e) {
                // 颜色获取可能失败，忽略
            }

            return {
                success: true,
                layerId: layer.id,
                style
            };

        } catch (error) {
            console.error('[GetTextStyle] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取样式失败'
            };
        }
    }

    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) {
                return layer;
            }
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }

    private async readDescriptorTextStyle(layerId: number): Promise<Partial<TextStyle>> {
        try {
            const result = await safeBatchPlay([{
                _obj: 'get',
                _target: [{ _ref: 'layer', _id: layerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true }, '获取文本样式描述');

            if (!result.success || !Array.isArray(result.result) || !result.result[0]) {
                return {};
            }

            const textStyle = result.result[0]?.textKey?.textStyleRange?.[0]?.textStyle || {};
            return {
                fontSize: this.readUnitNumber(textStyle.size),
                fontName: typeof textStyle.fontPostScriptName === 'string' ? textStyle.fontPostScriptName : undefined,
                tracking: this.readUnitNumber(textStyle.tracking),
                leading: this.readUnitNumber(textStyle.leading),
                horizontalScale: this.readUnitNumber(textStyle.horizontalScale),
                verticalScale: this.readUnitNumber(textStyle.verticalScale)
            };
        } catch {
            return {};
        }
    }

    private readUnitNumber(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (value && typeof value === 'object') {
            const unitValue = Number((value as { _value?: unknown })._value);
            if (Number.isFinite(unitValue)) return unitValue;
        }
        return undefined;
    }

    private pickNumber(primary: unknown, fallback: unknown): number | undefined {
        const primaryValue = this.readUnitNumber(primary);
        if (typeof primaryValue === 'number') return primaryValue;
        return this.readUnitNumber(fallback);
    }
}
