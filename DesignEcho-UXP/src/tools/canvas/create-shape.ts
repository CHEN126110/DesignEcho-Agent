/**
 * 创建形状图层工具
 */

import { action } from 'photoshop';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { executePhotoshopMutation } from '../../core/photoshop-mutation-commit';
import type { Tool, ToolExecutionContext } from '../types';

interface RGBColorValue {
    r: number;
    g: number;
    b: number;
}

interface ShapeResult {
    success: boolean;
    entityType?: 'shape';
    documentId?: number;
    layerId?: number;
    name?: string;
    shapeType?: 'rectangle' | 'ellipse';
    layerName?: string;
    message?: string;
    error?: string;
}

function hexToRgb(hex: string): RGBColorValue {
    const normalized = String(hex || '').trim();
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
    return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        }
        : { r: 128, g: 128, b: 128 };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
    return isFiniteNumber(value) && value > 0;
}

function normalizeColor(color?: RGBColorValue, fillColorHex?: string): RGBColorValue {
    if (color && [color.r, color.g, color.b].every(channel => Number.isFinite(channel))) {
        return color;
    }
    return hexToRgb(fillColorHex || '#808080');
}

function findLayerById(container: any, layerId: number): any {
    for (const layer of container?.layers || []) {
        if (layer?.id === layerId) return layer;
        const nested = findLayerById(layer, layerId);
        if (nested) return nested;
    }
    return undefined;
}

function assertBatchPlaySucceeded(results: unknown, operation: string): void {
    if (!Array.isArray(results) || results.length === 0) {
        throw new Error(`${operation} failed: Photoshop 未返回命令结果。`);
    }
    const errorDescriptor = results.find((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const descriptor = item as Record<string, unknown>;
        return descriptor._obj === 'error'
            || (typeof descriptor.message === 'string'
                && descriptor.message.trim().length > 0
                && typeof descriptor.result === 'number'
                && descriptor.result !== 0);
    }) as Record<string, unknown> | undefined;
    if (!errorDescriptor) return;
    const detail = typeof errorDescriptor.message === 'string'
        ? errorDescriptor.message
        : `Photoshop error ${String(errorDescriptor.result ?? 'unknown')}`;
    throw new Error(`${operation} failed: ${detail}`);
}

async function renameLayerById(layerId: number, name: string): Promise<void> {
    const results = await action.batchPlay([
        {
            _obj: 'set',
            _target: [{ _ref: 'layer', _id: layerId }],
            to: {
                _obj: 'layer',
                name
            },
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
    assertBatchPlaySucceeded(results, 'rename shape layer');
}

export class CreateRectangleTool implements Tool {
    name = 'createRectangle';
    schema = {
        name: 'createRectangle',
        description: '在 Photoshop 中创建矩形形状图层，可指定位置、尺寸、颜色和圆角。',
        parameters: {
            type: 'object' as const,
            properties: {
                name: { type: 'string', description: '图层名称。' },
                x: { type: 'number', description: '左上角 X 坐标（像素）。' },
                y: { type: 'number', description: '左上角 Y 坐标（像素）。' },
                width: { type: 'number', description: '矩形宽度（像素）。' },
                height: { type: 'number', description: '矩形高度（像素）。' },
                fillColorHex: { type: 'string', description: '填充颜色，十六进制，例如 #FF0000。' },
                color: { type: 'object', description: '填充颜色 RGB 对象，优先级高于 fillColorHex。' },
                cornerRadius: { type: 'number', description: '圆角半径（像素），默认 0。' }
            },
            required: ['x', 'y', 'width', 'height']
        }
    };

    async execute(params: {
        name?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fillColorHex?: string;
        color?: RGBColorValue;
        cornerRadius?: number;
    }, context?: ToolExecutionContext): Promise<ShapeResult> {
        try {
            const { name = '矩形', x, y, width, height, fillColorHex = '#808080', color, cornerRadius = 0 } = params;
            if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isPositiveNumber(width) || !isPositiveNumber(height)) {
                return { success: false, error: 'createRectangle failed: x/y must be numeric and width/height must be greater than 0.' };
            }
            if (!isFiniteNumber(cornerRadius) || cornerRadius < 0) {
                return { success: false, error: 'createRectangle failed: cornerRadius must be a non-negative number.' };
            }

            const fillColor = normalizeColor(color, fillColorHex);
            return await executePhotoshopMutation({
                toolName: this.name,
                commandName: 'DesignEcho: 创建矩形',
                params,
                context,
                expectedEffect: 'mutation_required',
                mutate: async ({ document }) => {
                    const previousActiveLayerId = document.activeLayers[0]?.id;
                    const rectangleShape: any = {
                        _obj: 'rectangle',
                        unitValueQuadVersion: 1,
                        top: { _unit: 'pixelsUnit', _value: y },
                        left: { _unit: 'pixelsUnit', _value: x },
                        bottom: { _unit: 'pixelsUnit', _value: y + height },
                        right: { _unit: 'pixelsUnit', _value: x + width }
                    };

                    if (cornerRadius > 0) {
                        const radius = { _unit: 'pixelsUnit', _value: cornerRadius };
                        rectangleShape.topRight = radius;
                        rectangleShape.topLeft = radius;
                        rectangleShape.bottomRight = radius;
                        rectangleShape.bottomLeft = radius;
                    }

                    const makeResults = await action.batchPlay([
                        {
                            _obj: 'make',
                            _target: [{ _ref: 'contentLayer' }],
                            using: {
                                _obj: 'contentLayer',
                                type: {
                                    _obj: 'solidColorLayer',
                                    color: {
                                        _obj: 'RGBColor',
                                        red: fillColor.r,
                                        green: fillColor.g,
                                        blue: fillColor.b
                                    }
                                },
                                shape: rectangleShape
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    assertBatchPlaySucceeded(makeResults, 'createRectangle');

                    const createdLayerId = document.activeLayers[0]?.id;
                    if (!Number.isSafeInteger(createdLayerId)
                        || createdLayerId <= 0
                        || createdLayerId === previousActiveLayerId) {
                        throw new Error('createRectangle failed: 无法读取刚创建的形状图层 ID。');
                    }
                    await renameLayerById(createdLayerId, name);
                    const createdLayer = findLayerById(document, createdLayerId);
                    if (!createdLayer || createdLayer.name !== name) {
                        throw new Error('createRectangle failed: 新形状图层名称读回不一致。');
                    }
                    return {
                        success: true,
                        entityType: 'shape' as const,
                        documentId: document.id,
                        layerId: createdLayerId,
                        name,
                        shapeType: 'rectangle' as const,
                        layerName: name,
                        message: `Created rectangle "${name}".`
                    };
                }
            });
        } catch (error) {
            console.error('[CreateRectangle] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

export class CreateEllipseTool implements Tool {
    name = 'createEllipse';
    schema = {
        name: 'createEllipse',
        description: '在 Photoshop 中创建椭圆形状图层，可指定中心点、尺寸和颜色。',
        parameters: {
            type: 'object' as const,
            properties: {
                name: { type: 'string', description: '图层名称。' },
                x: { type: 'number', description: '椭圆中心 X 坐标（像素）。' },
                y: { type: 'number', description: '椭圆中心 Y 坐标（像素）。' },
                width: { type: 'number', description: '椭圆宽度（像素）。' },
                height: { type: 'number', description: '椭圆高度（像素）。' },
                fillColorHex: { type: 'string', description: '填充颜色，十六进制，例如 #FF0000。' },
                color: { type: 'object', description: '填充颜色 RGB 对象，优先级高于 fillColorHex。' }
            },
            required: ['x', 'y', 'width', 'height']
        }
    };

    async execute(params: {
        name?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fillColorHex?: string;
        color?: RGBColorValue;
    }, context?: ToolExecutionContext): Promise<ShapeResult> {
        try {
            const { name = '椭圆', x, y, width, height, fillColorHex = '#808080', color } = params;
            if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isPositiveNumber(width) || !isPositiveNumber(height)) {
                return { success: false, error: 'createEllipse failed: x/y must be numeric and width/height must be greater than 0.' };
            }

            const fillColor = normalizeColor(color, fillColorHex);
            const left = x - width / 2;
            const top = y - height / 2;
            const right = x + width / 2;
            const bottom = y + height / 2;
            return await executePhotoshopMutation({
                toolName: this.name,
                commandName: 'DesignEcho: 创建椭圆',
                params,
                context,
                expectedEffect: 'mutation_required',
                mutate: async ({ document }) => {
                    const previousActiveLayerId = document.activeLayers[0]?.id;
                    const makeResults = await action.batchPlay([
                        {
                            _obj: 'make',
                            _target: [{ _ref: 'contentLayer' }],
                            using: {
                                _obj: 'contentLayer',
                                type: {
                                    _obj: 'solidColorLayer',
                                    color: {
                                        _obj: 'RGBColor',
                                        red: fillColor.r,
                                        green: fillColor.g,
                                        blue: fillColor.b
                                    }
                                },
                                shape: {
                                    _obj: 'ellipse',
                                    unitValueQuadVersion: 1,
                                    top: { _unit: 'pixelsUnit', _value: top },
                                    left: { _unit: 'pixelsUnit', _value: left },
                                    bottom: { _unit: 'pixelsUnit', _value: bottom },
                                    right: { _unit: 'pixelsUnit', _value: right }
                                }
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    assertBatchPlaySucceeded(makeResults, 'createEllipse');

                    const createdLayerId = document.activeLayers[0]?.id;
                    if (!Number.isSafeInteger(createdLayerId)
                        || createdLayerId <= 0
                        || createdLayerId === previousActiveLayerId) {
                        throw new Error('createEllipse failed: 无法读取刚创建的形状图层 ID。');
                    }
                    await renameLayerById(createdLayerId, name);
                    const createdLayer = findLayerById(document, createdLayerId);
                    if (!createdLayer || createdLayer.name !== name) {
                        throw new Error('createEllipse failed: 新形状图层名称读回不一致。');
                    }
                    return {
                        success: true,
                        entityType: 'shape' as const,
                        documentId: document.id,
                        layerId: createdLayerId,
                        name,
                        shapeType: 'ellipse' as const,
                        layerName: name,
                        message: `Created ellipse "${name}".`
                    };
                }
            });
        } catch (error) {
            console.error('[CreateEllipse] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
