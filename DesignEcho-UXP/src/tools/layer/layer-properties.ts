/**
 * 图层属性工具
 * 
 * P0 优先级 - 基础能力
 * - setLayerOpacity: 设置图层不透明度
 * - setBlendMode: 设置混合模式
 * - setLayerFill: 设置图层填充
 * - duplicateLayer: 复制图层
 * - deleteLayer: 删除图层
 * - lockLayer: 锁定/解锁图层
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult, ToolFailureResult } from '../../core/tool-error-normalizer';

type LayerPropertiesResult = string | ToolFailureResult;

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

function findLayerByName(container: any, name: string): any {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) return null;
    for (const layer of container?.layers || []) {
        if (String(layer.name || '').toLowerCase().includes(needle)) return layer;
        const nested = findLayerByName(layer, name);
        if (nested) return nested;
    }
    return null;
}

function resolveLayer(doc: any, params: { layerId?: number; layerName?: string }): any {
    if (params.layerId) return findLayerById(doc, params.layerId);
    if (params.layerName) return findLayerByName(doc, params.layerName);
    return doc.activeLayers?.[0];
}

// ==================== 设置图层不透明度 ====================

export class SetLayerOpacityTool implements Tool {
    name = 'setLayerOpacity';
    
    schema: ToolSchema = {
        name: 'setLayerOpacity',
        description: '设置图层不透明度（0-100%）',
        parameters: {
            type: 'object',
            properties: {
                opacity: {
                    type: 'number',
                    description: '不透明度百分比（0-100）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选，默认当前选中）'
                }
            },
            required: ['opacity']
        }
    };
    
    async execute(params: { opacity: number; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const opacity = Math.max(0, Math.min(100, params.opacity));
            
            await executeAsModal(async () => {
                layer.opacity = opacity;
            }, { commandName: '设置图层不透明度' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                opacity: opacity
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 设置图层可见性 ====================

export class SetLayerVisibilityTool implements Tool {
    name = 'setLayerVisibility';

    schema: ToolSchema = {
        name: 'setLayerVisibility',
        description: '设置图层或分组的可见性。layerIds 省略时作用于全部顶层图层/分组（用于恢复被导出/截图流程隐藏的屏分组）。',
        parameters: {
            type: 'object',
            properties: {
                visible: {
                    type: 'boolean',
                    description: 'true 显示 / false 隐藏'
                },
                layerIds: {
                    type: 'array',
                    description: '目标图层 ID 列表（可选，省略时作用于全部顶层图层）'
                }
            },
            required: ['visible']
        }
    };

    async execute(params: { visible: boolean; layerIds?: number[] }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }

        try {
            const targetIds = Array.isArray(params.layerIds) && params.layerIds.length > 0
                ? new Set(params.layerIds.map(Number))
                : null;
            const changed: Array<{ id: number; name: string }> = [];

            await executeAsModal(async () => {
                const apply = (layers: any[]) => {
                    for (const layer of layers || []) {
                        if (!targetIds || targetIds.has(Number(layer.id))) {
                            if (layer.visible !== params.visible) {
                                layer.visible = params.visible;
                                changed.push({ id: Number(layer.id), name: String(layer.name) });
                            }
                        }
                        // 指定 layerIds 时递归查找；全顶层模式只作用于顶层
                        if (targetIds && layer.layers && layer.layers.length > 0) {
                            apply(layer.layers);
                        }
                    }
                };
                apply(Array.isArray(doc.layers) ? doc.layers : []);
            }, { commandName: '设置图层可见性' });

            return JSON.stringify({
                success: true,
                visible: params.visible,
                changedCount: changed.length,
                changed: changed.slice(0, 20)
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 设置混合模式 ====================

/**
 * Photoshop 支持的混合模式
 */
const BLEND_MODES = [
    'normal', 'dissolve',
    'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor',
    'lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor',
    'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
    'difference', 'exclusion', 'subtract', 'divide',
    'hue', 'saturation', 'color', 'luminosity'
];

export class SetBlendModeTool implements Tool {
    name = 'setBlendMode';
    
    schema: ToolSchema = {
        name: 'setBlendMode',
        description: '设置图层混合模式（normal, multiply, screen, overlay, softLight, hardLight, colorDodge, colorBurn, difference, exclusion 等）',
        parameters: {
            type: 'object',
            properties: {
                blendMode: {
                    type: 'string',
                    description: '混合模式名称'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['blendMode']
        }
    };
    
    async execute(params: { blendMode: string; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            // 验证混合模式
            const mode = params.blendMode.toLowerCase();
            if (!BLEND_MODES.includes(mode)) {
                const failure = createToolFailureResult({
                    toolName: this.name,
                    error: `不支持的混合模式: ${params.blendMode}`,
                    params
                });
                return {
                    ...failure,
                    availableModes: BLEND_MODES
                } as ToolFailureResult & { availableModes: string[] };
            }
            
            await executeAsModal(async () => {
                layer.blendMode = mode;
            }, { commandName: '设置混合模式' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                blendMode: mode
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 设置图层填充颜色 ====================

export class SetLayerFillTool implements Tool {
    name = 'setLayerFill';
    
    schema: ToolSchema = {
        name: 'setLayerFill',
        description: '设置形状图层的填充颜色',
        parameters: {
            type: 'object',
            properties: {
                color: {
                    type: 'object',
                    description: 'RGB 颜色值 { r: 0-255, g: 0-255, b: 0-255 }'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['color']
        }
    };
    
    async execute(params: { color: { r: number; g: number; b: number }; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const { r, g, b } = params.color;
            
            await executeAsModal(async () => {
                // 使用 batchPlay 设置填充颜色
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            adjustment: {
                                _obj: 'solidColorLayer',
                                color: {
                                    _obj: 'RGBColor',
                                    red: r,
                                    green: g,  // 标准 RGB green 通道
                                    blue: b
                                }
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: '设置填充颜色' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                color: { r, g, b }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 复制图层 ====================

export class DuplicateLayerTool implements Tool {
    name = 'duplicateLayer';
    
    schema: ToolSchema = {
        name: 'duplicateLayer',
        description: '复制当前选中的图层',
        parameters: {
            type: 'object',
            properties: {
                newName: {
                    type: 'string',
                    description: '新图层名称（可选，默认在原名后加"副本"）'
                },
                layerId: {
                    type: 'number',
                    description: '要复制的图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { newName?: string; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            let newLayer: any;
            
            await executeAsModal(async () => {
                newLayer = await layer.duplicate();
                if (params.newName) {
                    newLayer.name = params.newName;
                }
            }, { commandName: '复制图层' });
            
            return JSON.stringify({
                success: true,
                originalLayer: layer.name,
                newLayerId: newLayer?.id,
                newLayerName: newLayer?.name
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 删除图层 ====================

export class DeleteLayerTool implements Tool {
    name = 'deleteLayer';
    
    schema: ToolSchema = {
        name: 'deleteLayer',
        description: '删除指定图层。删除会进入 Photoshop 历史记录，可在文档保持打开时撤销；仍应优先传入明确的 layerId，并在删除后读回图层结构。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要删除的图层 ID（可选，默认当前选中）'
                },
                layerName: {
                    type: 'string',
                    description: '要删除的图层名称（可选，支持模糊匹配）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number; layerName?: string }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            let layer: any;
            
            layer = resolveLayer(doc, params);
            
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const deletedName = layer.name;
            const deletedId = layer.id;
            
            await executeAsModal(async () => {
                await layer.delete();
            }, { commandName: '删除图层' });
            
            return JSON.stringify({
                success: true,
                deletedLayerId: deletedId,
                deletedLayerName: deletedName
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 锁定/解锁图层 ====================

export class LockLayerTool implements Tool {
    name = 'lockLayer';
    
    schema: ToolSchema = {
        name: 'lockLayer',
        description: '锁定或解锁图层（可分别控制位置锁定、透明度锁定、完全锁定）',
        parameters: {
            type: 'object',
            properties: {
                lock: {
                    type: 'boolean',
                    description: '是否锁定（true=锁定，false=解锁）'
                },
                lockType: {
                    type: 'string',
                    description: '锁定类型：all（完全锁定）、position（位置）、transparent（透明度）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['lock']
        }
    };
    
    async execute(params: { lock: boolean; lockType?: string; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const lockType = params.lockType || 'all';
            
            await executeAsModal(async () => {
                if (lockType === 'all') {
                    layer.allLocked = params.lock;
                } else if (lockType === 'position') {
                    layer.positionLocked = params.lock;
                } else if (lockType === 'transparent') {
                    layer.transparentPixelsLocked = params.lock;
                }
            }, { commandName: params.lock ? '锁定图层' : '解锁图层' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                locked: params.lock,
                lockType: lockType
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 获取图层属性 ====================

export class GetLayerPropertiesTool implements Tool {
    name = 'getLayerProperties';
    
    schema: ToolSchema = {
        name: 'getLayerProperties',
        description: '获取图层的详细属性（不透明度、混合模式、锁定状态等）',
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
    
    async execute(params: { layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            return JSON.stringify({
                success: true,
                properties: {
                    id: layer.id,
                    name: layer.name,
                    kind: layer.kind,
                    opacity: layer.opacity,
                    blendMode: layer.blendMode,
                    visible: layer.visible,
                    locked: {
                        all: layer.allLocked,
                        position: layer.positionLocked,
                        transparent: layer.transparentPixelsLocked
                    },
                    bounds: layer.bounds ? {
                        left: layer.bounds.left,
                        top: layer.bounds.top,
                        right: layer.bounds.right,
                        bottom: layer.bounds.bottom,
                        width: layer.bounds.right - layer.bounds.left,
                        height: layer.bounds.bottom - layer.bounds.top
                    } : null
                }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
