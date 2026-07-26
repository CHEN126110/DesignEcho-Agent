/**
 * 获取所有文本图层工具
 */

import { Tool, ToolSchema, TextLayerInfo } from '../types';
import { safeBatchPlay } from '../../core/error-handler';
import { observeActiveDocumentAtHistoryState } from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';
const { LayerKind } = require('photoshop').constants;

export class GetAllTextLayersTool implements Tool {
    name = 'getAllTextLayers';

    schema: ToolSchema = {
        name: 'getAllTextLayers',
        description: '获取当前文档中所有文本图层的信息，包括内容、位置、样式',
        parameters: {
            type: 'object',
            properties: {
                includeHidden: {
                    type: 'boolean',
                    description: '是否包含隐藏的图层，默认 false'
                }
            }
        }
    };

    async execute(params: { includeHidden?: boolean }): Promise<{
        success: boolean;
        layers?: TextLayerInfo[];
        count?: number;
        historyStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        try {
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 读取文本图层',
                unavailableMessage: '无法读取 Photoshop 文档历史版本，请重新读取当前文字结构。',
                changedMessage: '读取文本图层期间 Photoshop 文档发生变化，请重新读取当前文字结构。'
            }, async (doc) => {
                const layers: TextLayerInfo[] = [];
                await this.collectTextLayers(doc, layers, params.includeHidden ?? false);
                return { layers, count: layers.length };
            });

            return {
                success: true,
                layers: observation.value.layers,
                count: observation.value.count,
                historyStateRef: observation.historyStateRef
            };

        } catch (error) {
            console.error('[GetAllTextLayers] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取图层失败'
            };
        }
    }

    /**
     * 递归收集文本图层
     */
    private async collectTextLayers(
        container: any, 
        result: TextLayerInfo[], 
        includeHidden: boolean
    ): Promise<void> {
        for (const layer of container.layers) {
            // 跳过隐藏图层（如果不需要）
            if (!includeHidden && !layer.visible) {
                continue;
            }

            // 如果是组，递归处理
            if (layer.kind === LayerKind.GROUP) {
                await this.collectTextLayers(layer, result, includeHidden);
                continue;
            }

            // 如果是文本图层
            if (layer.kind === LayerKind.TEXT) {
                try {
                    const textItem = layer.textItem;
                    const charStyle = textItem.characterStyle;
                    const descriptorStyle = await this.readDescriptorTextStyle(layer.id);
                    const bounds = this.normalizeBounds(layer.bounds);
                    const boundsNoEffects = this.normalizeBounds(layer.boundsNoEffects || layer.bounds);

                    result.push({
                        id: layer.id,
                        name: layer.name,
                        contents: textItem.contents,
                        bounds,
                        boundsNoEffects,
                        style: {
                            fontSize: this.pickNumber(descriptorStyle.fontSize, charStyle.size),
                            fontName: descriptorStyle.fontName || charStyle.font,
                            fontStyle: charStyle.fontStyle,
                            tracking: this.pickNumber(descriptorStyle.tracking, charStyle.tracking),
                            leading: this.pickNumber(descriptorStyle.leading, charStyle.leading),
                            horizontalScale: this.pickNumber(descriptorStyle.horizontalScale, charStyle.horizontalScale),
                            verticalScale: this.pickNumber(descriptorStyle.verticalScale, charStyle.verticalScale),
                            // 段落对齐：仅描述符可读且各段一致时输出（读不到就缺省，绝不默认 center）
                            ...(descriptorStyle.textAlign ? { textAlign: descriptorStyle.textAlign } : {})
                        }
                    });
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    throw new Error(`读取文本图层「${layer.name}」(ID: ${layer.id}) 失败：${reason}`);
                }
            }
        }
    }

    private normalizeBounds(value: any) {
        const left = this.readUnitNumber(value?.left);
        const top = this.readUnitNumber(value?.top);
        const right = this.readUnitNumber(value?.right);
        const bottom = this.readUnitNumber(value?.bottom);
        const width = this.readUnitNumber(value?.width);
        const height = this.readUnitNumber(value?.height);

        const normalizedLeft = left ?? 0;
        const normalizedTop = top ?? 0;
        const normalizedRight = right ?? (normalizedLeft + (width ?? 0));
        const normalizedBottom = bottom ?? (normalizedTop + (height ?? 0));
        return {
            left: normalizedLeft,
            top: normalizedTop,
            right: normalizedRight,
            bottom: normalizedBottom,
            width: width ?? Math.max(0, normalizedRight - normalizedLeft),
            height: height ?? Math.max(0, normalizedBottom - normalizedTop)
        };
    }

    private async readDescriptorTextStyle(layerId: number): Promise<{
        fontSize?: number;
        fontName?: string;
        tracking?: number;
        leading?: number;
        horizontalScale?: number;
        verticalScale?: number;
        textAlign?: 'left' | 'center' | 'right';
    }> {
        try {
            const result = await safeBatchPlay([{
                _obj: 'get',
                _target: [{ _ref: 'layer', _id: layerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true }, '批量获取文本样式描述');

            if (!result.success || !Array.isArray(result.result) || !result.result[0]) {
                return {};
            }

            const textKey = result.result[0]?.textKey;
            const textStyle = textKey?.textStyleRange?.[0]?.textStyle || {};
            const textAlign = this.readParagraphAlignment(textKey);
            return {
                fontSize: this.readUnitNumber(textStyle.size),
                fontName: typeof textStyle.fontPostScriptName === 'string' ? textStyle.fontPostScriptName : undefined,
                tracking: this.readUnitNumber(textStyle.tracking),
                leading: this.readUnitNumber(textStyle.leading),
                horizontalScale: this.readUnitNumber(textStyle.horizontalScale),
                verticalScale: this.readUnitNumber(textStyle.verticalScale),
                ...(textAlign ? { textAlign } : {})
            };
        } catch {
            return {};
        }
    }

    /**
     * 从 textKey.paragraphStyleRange 读取段落对齐并映射为 'left'|'center'|'right'
     * （与 createTextLayer 写入侧的 paragraphStyle.align {_enum:'alignmentType'} 互为读写对）。
     * 纪律：所有段落都带可读 align 且取值一致才输出；任一段缺失、多段不一致、
     * 或取值不在三值域内（如 justifyAll 等）时返回 undefined——绝不默认 center、绝不猜测。
     * 【需真机验证】：batchPlay get 描述符是否总回传 align（Photoshop 描述符可能省略默认值，
     * 省略时左对齐文本会诚实缺省不输出），以及 align 取值形态（{_value:'left'} 或裸字符串）。
     */
    private readParagraphAlignment(textKey: any): 'left' | 'center' | 'right' | undefined {
        const ranges = Array.isArray(textKey?.paragraphStyleRange) ? textKey.paragraphStyleRange : [];
        if (ranges.length === 0) return undefined;

        let unified: string | undefined;
        for (const range of ranges) {
            const raw = range?.paragraphStyle?.align;
            const value = typeof raw === 'string'
                ? raw
                : (raw && typeof raw === 'object' ? (raw as { _value?: unknown })._value : undefined);
            if (typeof value !== 'string' || value.length === 0) return undefined; // 有段落缺对齐信息 → 不输出
            if (unified === undefined) unified = value;
            else if (unified !== value) return undefined; // 多段对齐不一致 → 不输出
        }

        return unified === 'left' || unified === 'center' || unified === 'right' ? unified : undefined;
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
