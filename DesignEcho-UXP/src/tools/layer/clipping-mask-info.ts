/**
 * 剪切蒙版信息工具
 * 
 * 用于智能布局服务获取图层的剪切蒙版关系和边界
 * 
 * 功能：
 * - getClippingMaskInfo: 获取图层的剪切蒙版信息
 * - getClippingBaseBounds: 获取剪切蒙版基底的边界
 * - findClippingBase: 查找剪切蒙版的基底图层
 */

import { Tool, ToolSchema } from '../types';

const photoshop = require('photoshop');
const { app, action } = photoshop;

function isLayerClipped(layer: any): boolean {
    return layer?.isClippingMask === true || layer?.clipped === true;
}

// ==================== 剪切蒙版信息结果接口 ====================

interface ClippingMaskInfo {
    /** 图层 ID */
    layerId: number;
    /** 图层名称 */
    layerName: string;
    /** 是否被剪切（clipped） */
    isClipped: boolean;
    /** 是否是剪切蒙版的基底 */
    isClippingBase: boolean;
    /** 剪切蒙版基底图层 ID */
    clippingBaseId?: number;
    /** 剪切蒙版基底图层名称 */
    clippingBaseName?: string;
    /** 图层边界 */
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** 剪切蒙版基底边界（如果适用） */
    clippingBaseBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

// ==================== 获取剪切蒙版信息 ====================

export class GetClippingMaskInfoTool implements Tool {
    name = 'getClippingMaskInfo';
    
    schema: ToolSchema = {
        name: 'getClippingMaskInfo',
        description: '获取图层的剪切蒙版信息，包括是否被剪切、基底图层信息和边界',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选，默认当前选中图层）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            // 1. 获取目标图层
            const layer = params.layerId 
                ? this.findLayerById(doc.layers, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            // 2. 获取剪切蒙版信息
            const info = await this.getClippingInfo(layer, doc);
            
            return JSON.stringify({
                success: true,
                clippingMaskInfo: info
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    /**
     * 递归查找图层
     */
    private findLayerById(layers: any, id: number): any {
        for (const layer of layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
    
    /**
     * 获取图层的剪切蒙版信息
     */
    private async getClippingInfo(layer: any, doc: any): Promise<ClippingMaskInfo> {
        // 获取图层边界
        const bounds = this.getLayerBounds(layer);
        
        // 检查是否被剪切
        const isClipped = isLayerClipped(layer);
        
        // 查找剪切蒙版基底
        let clippingBaseId: number | undefined;
        let clippingBaseName: string | undefined;
        let clippingBaseBounds: ClippingMaskInfo['clippingBaseBounds'] | undefined;
        let isClippingBase = false;
        
        if (isClipped) {
            // 向下查找基底图层
            const base = this.findClippingBase(layer, doc);
            if (base) {
                clippingBaseId = base.id;
                clippingBaseName = base.name;
                clippingBaseBounds = this.getLayerBounds(base);
            }
        } else {
            // 检查是否是其他图层的基底
            isClippingBase = this.hasClippedLayersAbove(layer, doc);
        }
        
        return {
            layerId: layer.id,
            layerName: layer.name,
            isClipped,
            isClippingBase,
            clippingBaseId,
            clippingBaseName,
            bounds,
            clippingBaseBounds
        };
    }
    
    /**
     * 获取图层边界
     */
    private getLayerBounds(layer: any): ClippingMaskInfo['bounds'] {
        if (!layer.bounds) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        
        return {
            x: layer.bounds.left,
            y: layer.bounds.top,
            width: layer.bounds.right - layer.bounds.left,
            height: layer.bounds.bottom - layer.bounds.top
        };
    }
    
    /**
     * 查找剪切蒙版的基底图层
     */
    private findClippingBase(layer: any, doc: any): any {
        // 获取图层在父容器中的位置
        const parent = layer.parent || doc;
        const siblings = parent.layers;
        
        if (!siblings) return null;
        
        // 找到当前图层的索引
        let currentIndex = -1;
        for (let i = 0; i < siblings.length; i++) {
            if (siblings[i].id === layer.id) {
                currentIndex = i;
                break;
            }
        }
        
        if (currentIndex === -1) return null;
        
        // 向下（索引增大方向）查找第一个非 clipped 的图层
        // 注意：在 Photoshop 中，图层列表是从上到下排列的
        for (let i = currentIndex + 1; i < siblings.length; i++) {
            if (!isLayerClipped(siblings[i])) {
                return siblings[i];
            }
        }
        
        return null;
    }
    
    /**
     * 检查是否有被剪切的图层在上方
     */
    private hasClippedLayersAbove(layer: any, doc: any): boolean {
        const parent = layer.parent || doc;
        const siblings = parent.layers;
        
        if (!siblings) return false;
        
        // 找到当前图层的索引
        let currentIndex = -1;
        for (let i = 0; i < siblings.length; i++) {
            if (siblings[i].id === layer.id) {
                currentIndex = i;
                break;
            }
        }
        
        if (currentIndex === -1 || currentIndex === 0) return false;
        
        // 检查上方（索引减小方向）是否有 clipped 图层
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (isLayerClipped(siblings[i])) {
                return true;
            } else {
                // 遇到非 clipped 图层就停止
                break;
            }
        }
        
        return false;
    }
}

// ==================== 批量获取剪切蒙版信息 ====================

export class GetAllClippingMasksTool implements Tool {
    name = 'getAllClippingMasks';
    
    schema: ToolSchema = {
        name: 'getAllClippingMasks',
        description: '获取文档中所有剪切蒙版关系',
        parameters: {
            type: 'object',
            properties: {
                groupId: {
                    type: 'number',
                    description: '限定在某个图层组内查找（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { groupId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layers = params.groupId 
                ? this.findLayerById(doc.layers, params.groupId)?.layers
                : doc.layers;
                
            if (!layers) {
                return JSON.stringify({ success: false, error: '未找到指定图层组' });
            }
            
            const clippingGroups = this.findClippingGroups(layers);
            
            return JSON.stringify({
                success: true,
                clippingGroups,
                totalGroups: clippingGroups.length
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    /**
     * 递归查找图层
     */
    private findLayerById(layers: any, id: number): any {
        for (const layer of layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
    
    /**
     * 查找所有剪切蒙版组
     */
    private findClippingGroups(layers: any[]): any[] {
        const groups: any[] = [];
        
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            
            // 如果这个图层不是 clipped，检查它是否是剪切蒙版的基底
            if (!isLayerClipped(layer)) {
                const clippedLayers: any[] = [];
                
                // 向上查找所有 clipped 图层
                for (let j = i - 1; j >= 0; j--) {
                    if (isLayerClipped(layers[j])) {
                        clippedLayers.unshift({
                            id: layers[j].id,
                            name: layers[j].name,
                            bounds: this.getLayerBounds(layers[j])
                        });
                    } else {
                        break;
                    }
                }
                
                if (clippedLayers.length > 0) {
                    groups.push({
                        base: {
                            id: layer.id,
                            name: layer.name,
                            bounds: this.getLayerBounds(layer)
                        },
                        clippedLayers
                    });
                }
            }
            
            // 递归处理子图层
            if (layer.layers) {
                groups.push(...this.findClippingGroups(layer.layers));
            }
        }
        
        return groups;
    }
    
    private getLayerBounds(layer: any) {
        if (!layer.bounds) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        return {
            x: layer.bounds.left,
            y: layer.bounds.top,
            width: layer.bounds.right - layer.bounds.left,
            height: layer.bounds.bottom - layer.bounds.top
        };
    }
}

// ==================== 创建剪切蒙版 ====================

export class CreateClippingMaskTool implements Tool {
    name = 'createClippingMask';
    
    schema: ToolSchema = {
        name: 'createClippingMask',
        description: '将当前图层创建为剪切蒙版（剪切到下方图层）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要创建剪切蒙版的图层 ID（可选，默认当前选中）'
                },
                enable: {
                    type: 'boolean',
                    description: '是否启用剪切蒙版（默认 true）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number; enable?: boolean }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? this.findLayerById(doc.layers, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const enable = params.enable !== false;
            
            await photoshop.core.executeAsModal(async () => {
                // 使用 batchPlay 创建/释放剪切蒙版
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            group: enable
                        }
                    }
                ], { synchronousExecution: true });
            }, { commandName: enable ? '创建剪切蒙版' : '释放剪切蒙版' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                clippingMaskEnabled: enable
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(layers: any, id: number): any {
        for (const layer of layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
}
