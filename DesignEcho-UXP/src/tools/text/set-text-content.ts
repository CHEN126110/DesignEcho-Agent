/**
 * Set text content while keeping the current text-layer formatting stable.
 *
 * The primary write path swaps only the text payload while anchoring style
 * remapping to the original baseline descriptor captured before candidate
 * replacement. This avoids compounding geometry drift across repeated
 * candidate swaps on transformed text layers.
 */

import { Tool, ToolSchema } from '../types';
import { safeBatchPlay } from '../../core/error-handler';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

const app = require('photoshop').app;
const { core } = require('photoshop');
const { LayerKind } = require('photoshop').constants;

type BoundsLike = { left: number; top: number; right: number; bottom: number };

type TextUpdate = {
    layerId: number;
    content: string;
    baselineContent?: string;
};

type FormattingBaseline = {
    baselineContent: string;
    descriptor: any | null;
};

export class SetTextContentTool implements Tool {
    name = 'setTextContent';
    private formattingBaselines: Map<number, FormattingBaseline> = new Map();

    schema: ToolSchema = {
        name: 'setTextContent',
        description: 'Set text content while preserving the current text layer formatting and layout as much as possible.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Target text layer ID. Uses the currently selected text layer when omitted.'
                },
                content: {
                    type: 'string',
                    description: 'New text content.'
                },
                baselineContent: {
                    type: 'string',
                    description: 'Original text captured when candidates were generated. Used only as a fallback baseline.'
                },
                updates: {
                    type: 'array',
                    description: 'Batch update multiple text layers.',
                    items: {
                        type: 'object'
                    }
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number; content?: string; baselineContent?: string; updates?: TextUpdate[] }): Promise<{
        success: boolean;
        layerId?: number;
        previousContent?: string;
        newContent?: string;
        results?: Array<{
            layerId: number;
            previousContent: string;
            newContent: string;
            checks: {
                isOutOfBounds: boolean;
                isClipped: boolean;
                overflowDirection?: string;
                suggestedFix?: string;
            };
            layerBounds?: BoundsLike;
        }>;
        error?: string;
        checks?: {
            isOutOfBounds: boolean;
            isClipped: boolean;
            overflowDirection?: string;
            suggestedFix?: string;
        };
        layerBounds?: BoundsLike;
        canvasBounds?: { width: number; height: number };
        errorDetails?: any;
        data?: null;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
            }

            const canvasWidth = Number(doc.width) || 0;
            const canvasHeight = Number(doc.height) || 0;
            const canvasBounds = { width: canvasWidth, height: canvasHeight };

            const buildChecks = (bounds: BoundsLike) => {
                const overflows: string[] = [];
                if (bounds.left < 0) overflows.push('左侧');
                if (bounds.top < 0) overflows.push('上方');
                if (bounds.right > canvasWidth) overflows.push('右侧');
                if (bounds.bottom > canvasHeight) overflows.push('下方');

                const isOutOfBounds = overflows.length > 0;
                const isClipped = isOutOfBounds;

                let suggestedFix = '';
                if (isOutOfBounds) {
                    if (overflows.includes('右侧') || overflows.includes('左侧')) {
                        suggestedFix = '建议：减小字号、缩短文案，或调整文本框宽度';
                    }
                    if (overflows.includes('下方') || overflows.includes('上方')) {
                        suggestedFix = '建议：调整文本位置或减少行数';
                    }
                    if (overflows.length > 1) {
                        suggestedFix = '建议：减小字号并重新定位文本';
                    }
                }

                return {
                    isOutOfBounds,
                    isClipped,
                    overflowDirection: overflows.length > 0 ? overflows.join('、') : undefined,
                    suggestedFix: suggestedFix || undefined
                };
            };

            if (params.updates && params.updates.length > 0) {
                const targetLayers = params.updates.map(update => {
                    const layer = this.findLayerById(doc, update.layerId);
                    if (!layer) {
                        throw new Error(`未找到图层 ID: ${update.layerId}`);
                    }
                    if (layer.kind !== LayerKind.TEXT) {
                        throw new Error(`图层 ID ${update.layerId} 不是文本图层`);
                    }
                    return {
                        layer,
                        previousContent: String(layer.textItem.contents || ''),
                        newContent: this.normalizeContent(update.content),
                        baselineContent: this.normalizeContent(update.baselineContent ?? '')
                    };
                });

                await core.executeAsModal(async () => {
                    for (const item of targetLayers) {
                        await this.applyContentPreservingFormatting(item.layer, item.newContent, item.baselineContent);
                    }
                }, { commandName: 'DesignEcho: 批量修改文本' });

                const results = targetLayers.map(item => {
                    const bounds = this.toBounds(item.layer.bounds);
                    return {
                        layerId: item.layer.id,
                        previousContent: item.previousContent,
                        newContent: item.newContent,
                        checks: buildChecks(bounds),
                        layerBounds: bounds
                    };
                });

                return {
                    success: true,
                    results,
                    canvasBounds
                };
            }

            if (typeof params.content !== 'string') {
                return createToolFailureResult({ toolName: this.name, error: '必须提供 content 或 updates', params });
            }

            const layer = this.resolveTargetLayer(doc, params.layerId);
            if (!layer) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: params.layerId ? `未找到图层 ID: ${params.layerId}` : '请先选中一个文本图层',
                    params
                });
            }
            if (layer.kind !== LayerKind.TEXT) {
                return createToolFailureResult({ toolName: this.name, error: '选中的不是文本图层', params });
            }

            const previousContent = String(layer.textItem.contents || '');
            const newContent = this.normalizeContent(params.content);
            const baselineContent = this.normalizeContent(params.baselineContent ?? '');

            await core.executeAsModal(async () => {
                await this.applyContentPreservingFormatting(layer, newContent, baselineContent);
            }, { commandName: 'DesignEcho: 修改文本' });

            const bounds = this.toBounds(layer.bounds);
            const checks = buildChecks(bounds);

            return {
                success: true,
                layerId: layer.id,
                previousContent,
                newContent,
                checks,
                layerBounds: bounds,
                canvasBounds
            };
        } catch (error) {
            console.error('[SetTextContent] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
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

    private toBounds(bounds: any): BoundsLike {
        return {
            left: Number(bounds.left) || 0,
            top: Number(bounds.top) || 0,
            right: Number(bounds.right) || 0,
            bottom: Number(bounds.bottom) || 0
        };
    }

    private cloneValue<T>(value: T): T {
        if (value === undefined || value === null) return value;
        return JSON.parse(JSON.stringify(value));
    }

    private getCurrentTextLayerDescriptor(descriptor: any | null): any | null {
        if (!descriptor || typeof descriptor !== 'object') return null;
        if (descriptor.textKey && typeof descriptor.textKey === 'object') {
            return descriptor.textKey;
        }
        return descriptor;
    }

    private remapRanges<T extends { from?: number; to?: number }>(
        ranges: T[] | undefined,
        sourceLength: number,
        targetLength: number
    ): T[] | undefined {
        if (!Array.isArray(ranges) || ranges.length === 0) return ranges;

        const safeSourceLength = Number.isFinite(sourceLength) && sourceLength > 0 ? sourceLength : targetLength;
        const useProportionalMapping = ranges.length > 1 && safeSourceLength > 0 && targetLength >= 0;

        const normalized = ranges
            .map(range => {
                const cloned = this.cloneValue(range);
                const originalFrom = Math.max(0, Math.min(Number(cloned.from) || 0, safeSourceLength));
                const originalTo = Math.max(originalFrom, Math.min(Number(cloned.to) || safeSourceLength, safeSourceLength));

                let from = originalFrom;
                let to = originalTo;

                if (useProportionalMapping) {
                    from = Math.floor((originalFrom / safeSourceLength) * targetLength);
                    to = Math.ceil((originalTo / safeSourceLength) * targetLength);
                }

                from = Math.max(0, Math.min(from, targetLength));
                to = Math.max(from, Math.min(to, targetLength));

                return {
                    ...cloned,
                    from,
                    to
                };
            })
            .filter(range => range.to >= range.from)
            .sort((a, b) => a.from - b.from || a.to - b.to);

        if (normalized.length === 0) return normalized;

        let cursor = 0;
        for (const range of normalized) {
            range.from = Math.max(cursor, Math.min(range.from, targetLength));
            range.to = Math.max(range.from, Math.min(range.to, targetLength));
            cursor = range.to;
        }

        normalized[0].from = 0;
        normalized[normalized.length - 1].to = targetLength;
        return normalized;
    }

    private getDescriptorContentLength(descriptor: any | null, fallbackContent = ''): number {
        const rawContent = typeof descriptor?.textKey === 'string'
            ? descriptor.textKey
            : fallbackContent;
        return this.normalizeContent(String(rawContent || '')).length;
    }

    private getParagraphSpans(content: string): Array<{ from: number; to: number }> {
        if (!content.length) {
            return [{ from: 0, to: 0 }];
        }

        const spans: Array<{ from: number; to: number }> = [];
        let cursor = 0;
        const lines = content.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const hasTrailingBreak = index < lines.length - 1;
            const from = cursor;
            const to = cursor + line.length + (hasTrailingBreak ? 1 : 0);
            spans.push({ from, to });
            cursor = to;
        }

        if (spans.length === 0) {
            spans.push({ from: 0, to: content.length });
        }

        spans[0].from = 0;
        spans[spans.length - 1].to = content.length;
        return spans;
    }

    private normalizeParagraphRanges(
        ranges: Array<{ from?: number; to?: number; paragraphStyle?: any }> | undefined,
        targetContent: string
    ): Array<{ from: number; to: number; paragraphStyle?: any }> | undefined {
        if (!Array.isArray(ranges) || ranges.length === 0) return ranges as any;

        const styles = ranges.map(range => this.cloneValue(range?.paragraphStyle || {}));
        const spans = this.getParagraphSpans(targetContent);

        return spans.map((span, index) => ({
            _obj: 'paragraphStyleRange',
            from: span.from,
            to: span.to,
            paragraphStyle: styles[Math.min(index, styles.length - 1)] || {}
        }));
    }

    private styleSignature(style: any): string {
        return JSON.stringify(this.cloneValue(style || {}));
    }

    private normalizeTextStyleRanges(
        ranges: Array<{ from?: number; to?: number; textStyle?: any }> | undefined,
        sourceLength: number,
        targetLength: number
    ): Array<{ from: number; to: number; textStyle?: any; _obj?: string }> | undefined {
        if (!Array.isArray(ranges) || ranges.length === 0) return ranges as any;

        const signatures = new Set(ranges.map(range => this.styleSignature(range?.textStyle)));
        if (signatures.size <= 1) {
            return [{
                _obj: 'textStyleRange',
                from: 0,
                to: targetLength,
                textStyle: this.cloneValue(ranges[0]?.textStyle || {})
            }];
        }

        return this.remapRanges(ranges as any, sourceLength, targetLength) as any;
    }

    private async getTextLayerDescriptor(layerId: number): Promise<any | null> {
        const result = await safeBatchPlay([{
            _obj: 'get',
            _target: [{ _ref: 'layer', _id: layerId }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true }, '获取文本图层描述');

        if (!result.success || !Array.isArray(result.result) || !result.result[0]) {
            return null;
        }

        return result.result[0];
    }

    private async getFormattingBaseline(layerId: number, baselineContent: string): Promise<any | null> {
        const normalizedBaselineContent = this.normalizeContent(baselineContent);
        const cached = this.formattingBaselines.get(layerId);

        if (cached && cached.baselineContent === normalizedBaselineContent) {
            return this.cloneValue(cached.descriptor);
        }

        if (cached && !normalizedBaselineContent) {
            return this.cloneValue(cached.descriptor);
        }

        const descriptor = await this.getTextLayerDescriptor(layerId);
        this.formattingBaselines.set(layerId, {
            baselineContent: normalizedBaselineContent,
            descriptor: this.cloneValue(descriptor)
        });
        return descriptor;
    }

    private async applyContentPreservingFormatting(layer: any, content: string, baselineContent = ''): Promise<void> {
        const normalizedContent = this.normalizeContent(content);
        const liveDescriptor = this.getCurrentTextLayerDescriptor(await this.getTextLayerDescriptor(layer.id));
        const baselineDescriptor = this.getCurrentTextLayerDescriptor(await this.getFormattingBaseline(layer.id, baselineContent));
        // Repeated candidate swaps must stay anchored to the original baseline
        // captured before the first replacement. If we prefer the live descriptor
        // here, Photoshop's post-write geometry can compound across swaps.
        const sourceDescriptor = baselineDescriptor || liveDescriptor;

        const totalLength = normalizedContent.length;
        const sourceLength = this.getDescriptorContentLength(sourceDescriptor, baselineContent);
        const textStyleRange = this.normalizeTextStyleRanges(this.cloneValue(sourceDescriptor?.textStyleRange), sourceLength, totalLength);
        const paragraphStyleRange = this.normalizeParagraphRanges(this.cloneValue(sourceDescriptor?.paragraphStyleRange), normalizedContent);
        const kerningRange = this.remapRanges(this.cloneValue(sourceDescriptor?.kerningRange), sourceLength, totalLength);

        const setDescriptor: any = {
            _obj: 'set',
            _target: [{ _ref: 'layer', _id: layer.id }],
            to: {
                _obj: 'textLayer',
                textKey: normalizedContent
            },
            _options: { dialogOptions: 'dontDisplay' }
        };

        if (Array.isArray(textStyleRange) && textStyleRange.length > 0) {
            setDescriptor.to.textStyleRange = textStyleRange;
        }
        if (Array.isArray(paragraphStyleRange) && paragraphStyleRange.length > 0) {
            setDescriptor.to.paragraphStyleRange = paragraphStyleRange;
        }
        if (Array.isArray(kerningRange) && kerningRange.length > 0) {
            setDescriptor.to.kerningRange = kerningRange;
        }
        if (Array.isArray(sourceDescriptor?.textShape) && sourceDescriptor.textShape.length > 0) {
            // Paragraph text and transformed text layers depend on the original
            // text shape geometry. Preserve the baseline text shape, but avoid
            // replaying live bounds/boundingBox values that can compound drift.
            setDescriptor.to.textShape = this.cloneValue(sourceDescriptor.textShape);
        }
        if (sourceDescriptor?.orientation) {
            setDescriptor.to.orientation = this.cloneValue(sourceDescriptor.orientation);
        }
        if (sourceDescriptor?.warp) {
            setDescriptor.to.warp = this.cloneValue(sourceDescriptor.warp);
        }

        const batchResult = await safeBatchPlay(
            [setDescriptor],
            { synchronousExecution: true },
            '设置文本内容（保留当前文本层格式）'
        );

        if (batchResult.success) {
            return;
        }

        layer.textItem.contents = normalizedContent;
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
}
