import { Tool, ToolSchema, TextStyle } from '../types';
import { safeBatchPlay } from '../../core/error-handler';

const app = require('photoshop').app;
const { LayerKind } = require('photoshop').constants;

type BoundsLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
};

export class AuditTextReplacementTool implements Tool {
    name = 'auditTextReplacement';

    schema: ToolSchema = {
        name: 'auditTextReplacement',
        description: 'Inspect the current text layer before replacement and return stable formatting diagnostics.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Target text layer ID. Uses the currently selected text layer when omitted.'
                },
                proposedContent: {
                    type: 'string',
                    description: 'Optional proposed replacement text for delta analysis.'
                },
                baselineContent: {
                    type: 'string',
                    description: 'Optional baseline content captured when candidates were generated.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number; proposedContent?: string; baselineContent?: string }): Promise<{
        success: boolean;
        error?: string;
        layerId?: number;
        layerName?: string;
        currentContent?: string;
        baselineContent?: string;
        proposedContent?: string;
        bounds?: BoundsLike;
        style?: TextStyle;
        descriptorSummary?: {
            textStyleRangeCount: number;
            paragraphStyleRangeCount: number;
            kerningRangeCount: number;
            textShapeCount: number;
            hasMultipleTextStyles: boolean;
            hasMultipleParagraphStyles: boolean;
        };
        comparison?: {
            currentLength: number;
            proposedLength: number;
            lengthDelta: number;
            currentLineCount: number;
            proposedLineCount: number;
            lineDelta: number;
        };
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const layer = this.resolveTargetLayer(doc, params.layerId);
            if (!layer) {
                return { success: false, error: params.layerId ? `未找到图层 ID: ${params.layerId}` : '请先选中一个文本图层' };
            }
            if (layer.kind !== LayerKind.TEXT) {
                return { success: false, error: '选中的不是文本图层' };
            }

            const currentContent = this.normalizeContent(String(layer.textItem?.contents || ''));
            const proposedContent = this.normalizeContent(String(params.proposedContent || ''));
            const baselineContent = this.normalizeContent(String(params.baselineContent || ''));
            const descriptor = await this.getTextDescriptor(layer.id);
            const textDescriptor = descriptor?.textKey && typeof descriptor.textKey === 'object'
                ? descriptor.textKey
                : descriptor;

            const style: TextStyle = this.readTextStyle(layer);
            const bounds = this.readBounds(layer.bounds);

            const textStyleRangeCount = Array.isArray(textDescriptor?.textStyleRange) ? textDescriptor.textStyleRange.length : 0;
            const paragraphStyleRangeCount = Array.isArray(textDescriptor?.paragraphStyleRange) ? textDescriptor.paragraphStyleRange.length : 0;
            const kerningRangeCount = Array.isArray(textDescriptor?.kerningRange) ? textDescriptor.kerningRange.length : 0;
            const textShapeCount = Array.isArray(textDescriptor?.textShape) ? textDescriptor.textShape.length : 0;

            return {
                success: true,
                layerId: layer.id,
                layerName: String(layer.name || ''),
                currentContent,
                baselineContent: baselineContent || undefined,
                proposedContent: proposedContent || undefined,
                bounds,
                style,
                descriptorSummary: {
                    textStyleRangeCount,
                    paragraphStyleRangeCount,
                    kerningRangeCount,
                    textShapeCount,
                    hasMultipleTextStyles: textStyleRangeCount > 1,
                    hasMultipleParagraphStyles: paragraphStyleRangeCount > 1
                },
                comparison: proposedContent ? {
                    currentLength: currentContent.replace(/[\r\n]/g, '').length,
                    proposedLength: proposedContent.replace(/[\r\n]/g, '').length,
                    lengthDelta: proposedContent.replace(/[\r\n]/g, '').length - currentContent.replace(/[\r\n]/g, '').length,
                    currentLineCount: currentContent.length ? currentContent.split('\n').length : 0,
                    proposedLineCount: proposedContent.length ? proposedContent.split('\n').length : 0,
                    lineDelta: (proposedContent.length ? proposedContent.split('\n').length : 0) - (currentContent.length ? currentContent.split('\n').length : 0)
                } : undefined
            };
        } catch (error) {
            console.error('[AuditTextReplacement] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '审计文本替换失败'
            };
        }
    }

    private resolveTargetLayer(doc: any, layerId?: number): any | null {
        if (layerId) {
            return this.findLayerById(doc, layerId);
        }
        const activeLayers = doc.activeLayers;
        if (!activeLayers || activeLayers.length === 0) {
            return null;
        }
        return activeLayers[0];
    }

    private normalizeContent(content: string): string {
        return String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    private readBounds(bounds: any): BoundsLike {
        const left = Number(bounds?.left) || 0;
        const top = Number(bounds?.top) || 0;
        const right = Number(bounds?.right) || 0;
        const bottom = Number(bounds?.bottom) || 0;
        return {
            left,
            top,
            right,
            bottom,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top)
        };
    }

    private readTextStyle(layer: any): TextStyle {
        const charStyle = layer.textItem?.characterStyle;
        return {
            fontSize: Number(charStyle?.size) || undefined,
            fontName: charStyle?.font || undefined,
            fontStyle: charStyle?.fontStyle || undefined,
            tracking: Number(charStyle?.tracking) || undefined,
            leading: Number(charStyle?.leading) || undefined,
            horizontalScale: Number(charStyle?.horizontalScale) || undefined,
            verticalScale: Number(charStyle?.verticalScale) || undefined
        };
    }

    private async getTextDescriptor(layerId: number): Promise<any | null> {
        const result = await safeBatchPlay([{
            _obj: 'get',
            _target: [{ _ref: 'layer', _id: layerId }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true }, '审计文本图层描述');

        if (!result.success || !Array.isArray(result.result) || !result.result[0]) {
            return null;
        }

        return result.result[0];
    }

    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers || []) {
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
}
