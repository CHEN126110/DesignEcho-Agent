/**
 * 创建文字图层工具
 */

import { app, core, action } from 'photoshop';
import type { Tool } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { FontSuggestion, ResolvedFontInfo, resolveFont } from './font-resolver';

interface RGBColorValue {
    r: number;
    g: number;
    b: number;
}

function tryHexToRgb(hex: string): RGBColorValue {
    const normalized = String(hex || '').trim();
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
    return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        }
        : { r: 0, g: 0, b: 0 };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeColor(color?: RGBColorValue, colorHex?: string): RGBColorValue {
    if (color && [color.r, color.g, color.b].every(channel => Number.isFinite(channel))) {
        return color;
    }
    return tryHexToRgb(colorHex || '#000000');
}

function normalizeTextContent(content: string): string {
    return String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function toPhotoshopTextKey(content: string): string {
    // Photoshop text descriptors use carriage returns as paragraph separators.
    // Passing raw LF into make textLayer creates visually single-line text in
    // some hosts, which breaks bounds-based layout validation.
    return normalizeTextContent(content).replace(/\n/g, '\r');
}

async function tryExitModalState(): Promise<boolean> {
    try {
        await core.executeAsModal(async () => {
            await action.batchPlay([
                {
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });
        }, { commandName: 'DesignEcho: 退出 Photoshop 模态状态' });
        return true;
    } catch {
        return false;
    }
}

export class CreateTextLayerTool implements Tool {
    name = 'createTextLayer';
    schema = {
        name: 'createTextLayer',
        description: '在 Photoshop 中创建文字图层，可指定内容、位置、字号、颜色、字距、行高和对齐方式。',
        parameters: {
            type: 'object' as const,
            properties: {
                content: { type: 'string', description: '文字内容。' },
                text: { type: 'string', description: '文字内容，content 的别名。' },
                name: { type: 'string', description: '图层名称，默认使用文字内容。' },
                x: { type: 'number', description: '文字位置 X 坐标（像素）。' },
                y: { type: 'number', description: '文字位置 Y 坐标（像素）。' },
                fontSize: { type: 'number', description: '字号（point），默认 24。' },
                fontName: { type: 'string', description: '字体名称、字体族或 PostScript 名称；会先经 resolveFontName 精确解析，解析失败不创建带 fallback 字体的文字。' },
                tracking: { type: 'number', description: '字间距（Photoshop tracking，千分之一 em）。' },
                leading: { type: 'number', description: '行高（point）。' },
                colorHex: { type: 'string', description: '文字颜色，十六进制，例如 #000000。' },
                color: { type: 'object', description: '文字颜色 RGB 对象，优先级高于 colorHex。' },
                alignment: {
                    type: 'string',
                    enum: ['left', 'center', 'right'],
                    description: '段落对齐方式。'
                }
            },
            required: ['x', 'y']
        }
    };

    private retrying = false;

    async execute(params: {
        content?: string;
        text?: string;
        name?: string;
        x: number;
        y: number;
        fontSize?: number;
        fontName?: string;
        tracking?: number;
        leading?: number;
        colorHex?: string;
        color?: RGBColorValue;
        alignment?: 'left' | 'center' | 'right';
    }): Promise<{
        success: boolean;
        entityType?: 'text';
        documentId?: number;
        layerId?: number;
        name?: string;
        layerName?: string;
        content?: string;
        message?: string;
        resolvedFont?: ResolvedFontInfo;
        fontSuggestions?: FontSuggestion[];
        error?: string;
        errorDetails?: any;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
            }

            const content = normalizeTextContent(String(params.content ?? params.text ?? ''));
            if (!content) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'createTextLayer failed: content must not be empty.',
                    params
                });
            }
            if (!isFiniteNumber(params.x) || !isFiniteNumber(params.y)) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'createTextLayer failed: x and y must be numeric.',
                    params
                });
            }

            const fontSize = params.fontSize ?? 24;
            if (!isFiniteNumber(fontSize) || fontSize <= 0) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'createTextLayer failed: fontSize must be greater than 0.',
                    params
                });
            }
            if (params.tracking !== undefined && !isFiniteNumber(params.tracking)) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'createTextLayer failed: tracking must be numeric.',
                    params
                });
            }
            if (params.leading !== undefined && (!isFiniteNumber(params.leading) || params.leading <= 0)) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'createTextLayer failed: leading must be greater than 0.',
                    params
                });
            }

            const alignment = params.alignment || 'left';
            const color = normalizeColor(params.color, params.colorHex);
            const layerName = params.name?.trim() || content;
            let createdLayerId: number | undefined;
            let resolvedFont: ResolvedFontInfo | null = null;
            let fontSuggestions: FontSuggestion[] = [];

            if (params.fontName && params.fontName.trim()) {
                const fontResolution = resolveFont(params.fontName);
                resolvedFont = fontResolution.resolved;
                fontSuggestions = fontResolution.suggestions;
                if (!resolvedFont) {
                    return {
                        success: false,
                        error: `createTextLayer failed: 未找到可用字体：${params.fontName}`,
                        fontSuggestions,
                        errorDetails: {
                            requestedFont: params.fontName,
                            suggestions: fontSuggestions
                        }
                    };
                }
            }

            await core.executeAsModal(async () => {
                const textKey = toPhotoshopTextKey(content);
                const textStyle: Record<string, unknown> = {
                    _obj: 'textStyle',
                    size: { _unit: 'pointsUnit', _value: fontSize },
                    color: {
                        _obj: 'RGBColor',
                        red: color.r,
                        green: color.g,
                        blue: color.b
                    }
                };

                if (resolvedFont) {
                    textStyle.fontPostScriptName = resolvedFont.postScriptName;
                }
                if (isFiniteNumber(params.tracking)) {
                    textStyle.tracking = params.tracking;
                }
                if (isFiniteNumber(params.leading) && params.leading > 0) {
                    textStyle.leading = { _unit: 'pointsUnit', _value: params.leading };
                    textStyle.autoLeading = false;
                }

                await action.batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'textLayer' }],
                        using: {
                            _obj: 'textLayer',
                            textKey,
                            textStyleRange: [{
                                _obj: 'textStyleRange',
                                from: 0,
                                to: textKey.length,
                                textStyle
                            }],
                            paragraphStyleRange: [{
                                _obj: 'paragraphStyleRange',
                                from: 0,
                                to: textKey.length,
                                paragraphStyle: {
                                    _obj: 'paragraphStyle',
                                    align: {
                                        _enum: 'alignmentType',
                                        _value: ['center', 'right'].includes(alignment) ? alignment : 'left'
                                    }
                                }
                            }]
                        },
                        layerID: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        to: {
                            _obj: 'layer',
                            name: layerName
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                const createdLayer = doc.activeLayers[0] as any;
                if (!createdLayer) {
                    throw new Error('createTextLayer failed: created text layer is not active after make textLayer.');
                }

                const bounds = createdLayer.bounds || {};
                const currentX = Number(bounds.left);
                const currentY = Number(bounds.top);
                if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
                    throw new Error('createTextLayer failed: cannot read created text layer bounds before positioning.');
                }
                if (typeof createdLayer.translate !== 'function') {
                    throw new Error('createTextLayer failed: created layer does not support DOM translate.');
                }

                const deltaX = params.x - currentX;
                const deltaY = params.y - currentY;
                if (deltaX !== 0 || deltaY !== 0) {
                    await createdLayer.translate(deltaX, deltaY);
                }
                createdLayerId = createdLayer.id;
            }, { commandName: 'DesignEcho: 创建文字图层' });

            return {
                success: true,
                entityType: 'text',
                documentId: doc.id,
                layerId: createdLayerId,
                name: layerName,
                layerName,
                content,
                resolvedFont: resolvedFont || undefined,
                fontSuggestions: fontSuggestions.length > 0 ? fontSuggestions : undefined,
                message: `Created text layer "${layerName}".`
            };
        } catch (error: any) {
            const message = error?.message || String(error);
            if ((message.includes('modal') || message.includes('Modal')) && !this.retrying) {
                const exited = await tryExitModalState();
                if (exited) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    try {
                        this.retrying = true;
                        return await this.execute(params);
                    } finally {
                        this.retrying = false;
                    }
                }
            }

            console.error('[CreateTextLayer] Error:', error);
            return createToolFailureResult({ toolName: this.name, error: message || 'createTextLayer failed', params });
        }
    }
}

