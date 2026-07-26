/**
 * 获取图层边界工具
 */

import { Tool, ToolSchema, LayerBounds } from '../types';

const app = require('photoshop').app;

export class GetLayerBoundsTool implements Tool {
    name = 'getLayerBounds';

    schema: ToolSchema = {
        name: 'getLayerBounds',
        description: '获取指定图层的边界信息（位置和尺寸）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则获取当前选中的图层'
                },
                includeEffects: {
                    type: 'boolean',
                    description: '是否包含图层效果的边界，默认 true'
                }
            }
        }
    };

    async execute(params: { 
        layerId?: number | string; 
        includeEffects?: boolean 
    }): Promise<{
        success: boolean;
        layerId?: number;
        layerName?: string;
        layerKind?: string;
        bounds?: LayerBounds;
        boundsNoEffects?: LayerBounds;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let layer;
            
            if (params.layerId) {
                const numericId = typeof params.layerId === 'string' 
                    ? parseInt(params.layerId, 10) 
                    : params.layerId;
                layer = this.findLayerById(doc, numericId);
                if (!layer) {
                    return { success: false, error: `未找到图层 ID: ${params.layerId}` };
                }
            } else {
                const activeLayers = doc.activeLayers;
                if (!activeLayers || activeLayers.length === 0) {
                    return { success: false, error: '请先选中一个图层' };
                }
                layer = activeLayers[0];
            }

            const boundsWithEffects = layer.bounds;
            const boundsNoEffects = layer.boundsNoEffects || boundsWithEffects;

            const result: any = {
                success: true,
                layerId: layer.id,
                layerName: layer.name,
                layerKind: layer.kind  // 图层类型：pixel, smartObject, vector, text 等
            };

            // 主边界（可能包含效果）
            result.bounds = {
                left: boundsWithEffects.left,
                top: boundsWithEffects.top,
                right: boundsWithEffects.right,
                bottom: boundsWithEffects.bottom,
                width: boundsWithEffects.width,
                height: boundsWithEffects.height
            };

            // 不含效果的边界
            if (params.includeEffects !== false) {
                result.boundsNoEffects = {
                    left: boundsNoEffects.left,
                    top: boundsNoEffects.top,
                    right: boundsNoEffects.right,
                    bottom: boundsNoEffects.bottom,
                    width: boundsNoEffects.width,
                    height: boundsNoEffects.height
                };
            }

            return result;

        } catch (error) {
            console.error('[GetLayerBounds] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取边界失败'
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
}
