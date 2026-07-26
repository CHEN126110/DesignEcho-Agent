/**
 * 图层效果工具
 * 
 * P1 优先级 - 效果能力
 * - addDropShadow: 添加投影效果
 * - addStroke: 添加描边效果
 * - addGlow: 添加发光效果
 * - addGradientOverlay: 添加渐变叠加
 * - clearLayerEffects: 清除图层效果
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult, ToolFailureResult } from '../../core/tool-error-normalizer';

type LayerEffectsResult = string | ToolFailureResult;

const photoshop = require('photoshop');
const { app, action } = photoshop;
const { executeAsModal } = photoshop.core;

function findLayerById(container: any, id: number): any {
    for (const layer of container?.layers || []) {
        if (layer.id === id) return layer;
        const nested = findLayerById(layer, id);
        if (nested) return nested;
    }
    return null;
}

function resolveLayer(doc: any, params: { layerId?: number }): any {
    if (params.layerId) return findLayerById(doc, Number(params.layerId));
    return doc.activeLayers?.[0];
}

// ==================== 添加投影效果 ====================

export class AddDropShadowTool implements Tool {
    name = 'addDropShadow';
    
    schema: ToolSchema = {
        name: 'addDropShadow',
        description: '为图层添加投影效果',
        parameters: {
            type: 'object',
            properties: {
                color: {
                    type: 'object',
                    description: '投影颜色 { r, g, b }（默认黑色）'
                },
                opacity: {
                    type: 'number',
                    description: '不透明度（0-100，默认 75）'
                },
                angle: {
                    type: 'number',
                    description: '角度（-180 到 180，默认 120）'
                },
                distance: {
                    type: 'number',
                    description: '距离（像素，默认 5）'
                },
                spread: {
                    type: 'number',
                    description: '扩展（0-100，默认 0）'
                },
                size: {
                    type: 'number',
                    description: '大小/模糊（像素，默认 5）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: {
        color?: { r: number; g: number; b: number };
        opacity?: number;
        angle?: number;
        distance?: number;
        spread?: number;
        size?: number;
        layerId?: number;
    }): Promise<LayerEffectsResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            // 默认值
            const color = params.color || { r: 0, g: 0, b: 0 };
            const opacity = params.opacity ?? 75;
            const angle = params.angle ?? 120;
            const distance = params.distance ?? 5;
            const spread = params.spread ?? 0;
            const size = params.size ?? 5;
            
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            layerEffects: {
                                _obj: 'layerEffects',
                                dropShadow: {
                                    _obj: 'dropShadow',
                                    enabled: true,
                                    mode: { _enum: 'blendMode', _value: 'multiply' },
                                    color: {
                                        _obj: 'RGBColor',
                                        red: color.r,
                                        green: color.g,  // Photoshop 使用 green 而非 grain
                                        blue: color.b
                                    },
                                    opacity: { _unit: 'percentUnit', _value: opacity },
                                    useGlobalAngle: false,
                                    localLightingAngle: { _unit: 'angleUnit', _value: angle },
                                    distance: { _unit: 'pixelsUnit', _value: distance },
                                    chokeMatte: { _unit: 'percentUnit', _value: spread },  // spread 使用百分比
                                    blur: { _unit: 'pixelsUnit', _value: size }
                                }
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: '添加投影效果' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                effect: 'dropShadow',
                settings: { color, opacity, angle, distance, spread, size }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 添加描边效果 ====================

export class AddStrokeTool implements Tool {
    name = 'addStroke';
    
    schema: ToolSchema = {
        name: 'addStroke',
        description: '为图层添加描边效果',
        parameters: {
            type: 'object',
            properties: {
                color: {
                    type: 'object',
                    description: '描边颜色 { r, g, b }（默认黑色）'
                },
                size: {
                    type: 'number',
                    description: '描边宽度（像素，默认 3）'
                },
                position: {
                    type: 'string',
                    description: '描边位置：outside（外部）、inside（内部）、center（居中，默认）'
                },
                opacity: {
                    type: 'number',
                    description: '不透明度（0-100，默认 100）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: {
        color?: { r: number; g: number; b: number };
        size?: number;
        position?: 'outside' | 'inside' | 'center';
        opacity?: number;
        layerId?: number;
    }): Promise<LayerEffectsResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            // 默认值
            const color = params.color || { r: 0, g: 0, b: 0 };
            const size = params.size ?? 3;
            const position = params.position || 'center';
            const opacity = params.opacity ?? 100;
            
            // 位置映射
            const positionMap: Record<string, string> = {
                'outside': 'outsetFrame',
                'inside': 'insetFrame',
                'center': 'centeredFrame'
            };
            
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            layerEffects: {
                                _obj: 'layerEffects',
                                frameFX: {
                                    _obj: 'frameFX',
                                    enabled: true,
                                    style: { _enum: 'frameStyle', _value: positionMap[position] },
                                    paintType: { _enum: 'frameFill', _value: 'solidColor' },
                                    mode: { _enum: 'blendMode', _value: 'normal' },
                                    opacity: { _unit: 'percentUnit', _value: opacity },
                                    size: { _unit: 'pixelsUnit', _value: size },
                                    color: {
                                        _obj: 'RGBColor',
                                        red: color.r,
                                        green: color.g,  // Photoshop 使用 green 而非 grain
                                        blue: color.b
                                    }
                                }
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: '添加描边效果' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                effect: 'stroke',
                settings: { color, size, position, opacity }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 添加发光效果 ====================

export class AddGlowTool implements Tool {
    name = 'addGlow';
    
    schema: ToolSchema = {
        name: 'addGlow',
        description: '为图层添加发光效果（外发光或内发光）',
        parameters: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: '发光类型：outer（外发光，默认）、inner（内发光）'
                },
                color: {
                    type: 'object',
                    description: '发光颜色 { r, g, b }（默认白色）'
                },
                opacity: {
                    type: 'number',
                    description: '不透明度（0-100，默认 75）'
                },
                size: {
                    type: 'number',
                    description: '大小（像素，默认 5）'
                },
                spread: {
                    type: 'number',
                    description: '扩展（0-100，默认 0）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: {
        type?: 'outer' | 'inner';
        color?: { r: number; g: number; b: number };
        opacity?: number;
        size?: number;
        spread?: number;
        layerId?: number;
    }): Promise<LayerEffectsResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            // 默认值
            const glowType = params.type || 'outer';
            const color = params.color || { r: 255, g: 255, b: 255 };
            const opacity = params.opacity ?? 75;
            const size = params.size ?? 5;
            const spread = params.spread ?? 0;
            
            const glowObj = glowType === 'outer' ? 'outerGlow' : 'innerGlow';
            
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            layerEffects: {
                                _obj: 'layerEffects',
                                [glowObj]: {
                                    _obj: glowObj,
                                    enabled: true,
                                    mode: { _enum: 'blendMode', _value: 'screen' },
                                    color: {
                                        _obj: 'RGBColor',
                                        red: color.r,
                                        green: color.g,  // Photoshop 使用 green 而非 grain
                                        blue: color.b
                                    },
                                    opacity: { _unit: 'percentUnit', _value: opacity },
                                    chokeMatte: { _unit: 'percentUnit', _value: spread },  // spread 使用百分比
                                    blur: { _unit: 'pixelsUnit', _value: size },
                                    noise: { _unit: 'percentUnit', _value: 0 }
                                }
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: `添加${glowType === 'outer' ? '外' : '内'}发光效果` });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                effect: glowObj,
                settings: { color, opacity, size, spread }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 添加渐变叠加 ====================

export class AddGradientOverlayTool implements Tool {
    name = 'addGradientOverlay';
    
    schema: ToolSchema = {
        name: 'addGradientOverlay',
        description: '为图层添加渐变叠加效果',
        parameters: {
            type: 'object',
            properties: {
                startColor: {
                    type: 'object',
                    description: '起始颜色 { r, g, b }'
                },
                endColor: {
                    type: 'object',
                    description: '结束颜色 { r, g, b }'
                },
                angle: {
                    type: 'number',
                    description: '渐变角度（默认 90，即从上到下）'
                },
                opacity: {
                    type: 'number',
                    description: '不透明度（0-100，默认 100）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['startColor', 'endColor']
        }
    };
    
    async execute(params: {
        startColor: { r: number; g: number; b: number };
        endColor: { r: number; g: number; b: number };
        angle?: number;
        opacity?: number;
        layerId?: number;
    }): Promise<LayerEffectsResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const angle = params.angle ?? 90;
            const opacity = params.opacity ?? 100;
            
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            layerEffects: {
                                _obj: 'layerEffects',
                                gradientFill: {
                                    _obj: 'gradientFill',
                                    enabled: true,
                                    mode: { _enum: 'blendMode', _value: 'normal' },
                                    opacity: { _unit: 'percentUnit', _value: opacity },
                                    gradient: {
                                        _obj: 'gradientClassEvent',
                                        name: 'Custom',
                                        gradientForm: { _enum: 'gradientForm', _value: 'customStops' },
                                        colors: [
                                            {
                                                _obj: 'colorStop',
                                                color: {
                                                    _obj: 'RGBColor',
                                                    red: params.startColor.r,
                                                    green: params.startColor.g,  // 使用 green
                                                    blue: params.startColor.b
                                                },
                                                type: { _enum: 'colorStopType', _value: 'userStop' },
                                                location: 0,
                                                midpoint: 50
                                            },
                                            {
                                                _obj: 'colorStop',
                                                color: {
                                                    _obj: 'RGBColor',
                                                    red: params.endColor.r,
                                                    green: params.endColor.g,  // 使用 green
                                                    blue: params.endColor.b
                                                },
                                                type: { _enum: 'colorStopType', _value: 'userStop' },
                                                location: 4096,
                                                midpoint: 50
                                            }
                                        ],
                                        transparency: [
                                            {
                                                _obj: 'transferSpec',
                                                opacity: { _unit: 'percentUnit', _value: 100 },
                                                location: 0,
                                                midpoint: 50
                                            },
                                            {
                                                _obj: 'transferSpec',
                                                opacity: { _unit: 'percentUnit', _value: 100 },
                                                location: 4096,
                                                midpoint: 50
                                            }
                                        ]
                                    },
                                    angle: { _unit: 'angleUnit', _value: angle },
                                    type: { _enum: 'gradientType', _value: 'linear' },
                                    reverse: false,
                                    dither: false,
                                    align: true,
                                    scale: { _unit: 'percentUnit', _value: 100 }
                                }
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: '添加渐变叠加' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                effect: 'gradientOverlay',
                settings: { startColor: params.startColor, endColor: params.endColor, angle, opacity }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 清除图层效果 ====================

export class ClearLayerEffectsTool implements Tool {
    name = 'clearLayerEffects';
    
    schema: ToolSchema = {
        name: 'clearLayerEffects',
        description: '清除图层的所有效果（投影、描边、发光等）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number }): Promise<LayerEffectsResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            await executeAsModal(async () => {
                // 使用 set 命令将 layerEffects 设置为空，完全删除效果
                // 注意：disableLayerStyle 只是禁用，不是删除
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            layerEffects: {
                                _obj: 'null'  // 清空效果
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: '清除图层效果' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                message: '已清除所有图层效果'
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
