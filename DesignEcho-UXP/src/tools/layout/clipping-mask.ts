/**
 * 剪切蒙版工具
 * 
 * 创建和释放剪切蒙版
 */

import { Tool, ToolSchema } from '../types';
import { getPhotoshopElementPlacement } from './photoshop-runtime-adapters';

const app = require('photoshop').app;
const { core, action, constants } = require('photoshop');

function findLayerById(container: any, id: number): any {
    for (const layer of container.layers || []) {
        if (layer.id === id) return layer;
        if (layer.layers) {
            const found = findLayerById(layer, id);
            if (found) return found;
        }
    }
    return null;
}

export class CreateClippingMaskTool implements Tool {
    name = 'createClippingMask';

    schema: ToolSchema = {
        name: 'createClippingMask',
        description: '将图层创建为剪切蒙版，剪切到下方图层。给了 baseLayerId 时会先把目标图层移到基底正上方（支持跨组）再建蒙版——移动+剪切一步完成。剪切蒙版会使上方图层只显示在下方图层的不透明区域内。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要创建剪切蒙版的图层 ID（可选，默认使用当前选中的图层）'
                },
                baseLayerId: {
                    type: 'number',
                    description: '剪切基底图层 ID（推荐显式指定，如目标矩形）。工具会先把目标图层移到基底正上方再建蒙版；不给则以当前正下方图层为基底——若正下方是组或空图层结果可能非预期'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
        baseLayerId?: number;
    }): Promise<{
        success: boolean;
        clippedLayer?: {
            id: number;
            name: string;
        };
        baseLayer?: {
            id: number;
            name: string;
        };
        warnings?: string[];
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetLayer: any;

            // 如果提供了 layerId，先选中该图层
            if (params.layerId) {
                targetLayer = findLayerById(doc, params.layerId);
                if (!targetLayer) {
                    return { success: false, error: `未找到 ID 为 ${params.layerId} 的图层` };
                }
            } else {
                // 使用当前选中的图层
                if (doc.activeLayers.length === 0) {
                    return { success: false, error: '没有选中的图层' };
                }
                targetLayer = doc.activeLayers[0];
            }

            // 检查是否已经是剪切蒙版
            if (targetLayer.isClippingMask) {
                return { success: false, error: `图层 "${targetLayer.name}" 已经是剪切蒙版` };
            }

            // 显式基底（2026-07-07）：先把目标图层移到基底正上方（DOM move 支持跨组），
            // 再建蒙版——"移动+剪切"一步完成，替代「置入→进组→单步盲移→剪错」长链。
            if (params.baseLayerId) {
                const explicitBase = findLayerById(doc, params.baseLayerId);
                if (!explicitBase) {
                    return { success: false, error: `未找到基底图层 ID: ${params.baseLayerId}` };
                }
                if (explicitBase.id === targetLayer.id) {
                    return { success: false, error: '基底图层不能是目标图层自身。' };
                }
                if (typeof targetLayer.move !== 'function') {
                    return { success: false, error: '当前 Photoshop UXP 环境不支持 layer.move，无法自动就位到基底上方。' };
                }
                await core.executeAsModal(async () => {
                    targetLayer.move(explicitBase, getPhotoshopElementPlacement(constants, 'PLACEBEFORE', 'CreateClippingMask'));
                }, { commandName: 'DesignEcho: 移动到剪切基底上方' });
            }

            // 获取下方图层（基底层）信息
            const baseLayer = this.getLayerBelow(doc, targetLayer);
            if (!baseLayer) {
                return { success: false, error: '没有可用的下方图层作为剪切蒙版基底' };
            }

            // 基底预检（确定性，防"剪了等于没剪"）：空基底直接拒绝；组基底如实告警
            const warnings: string[] = [];
            const baseBounds = baseLayer.boundsNoEffects || baseLayer.bounds;
            const baseWidth = baseBounds ? Number(baseBounds.right) - Number(baseBounds.left) : 0;
            const baseHeight = baseBounds ? Number(baseBounds.bottom) - Number(baseBounds.top) : 0;
            if (!(baseWidth > 0 && baseHeight > 0)) {
                return {
                    success: false,
                    error: `剪切基底「${baseLayer.name}」没有可见像素（bounds 为空），剪切后目标图层将完全不可见。请用 baseLayerId 显式指定真实基底（如目标矩形图层），工具会自动把图层移到它正上方再剪切。`
                };
            }
            if (baseLayer.layers) {
                warnings.push(`基底「${baseLayer.name}」是图层组：剪切范围是组内全部内容的联合不透明区。若想精确剪到某个矩形，用 baseLayerId 指定该矩形图层。`);
            }

            // 创建剪切蒙版
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetLayer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'groupEvent',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }, { commandName: 'DesignEcho: 创建剪切蒙版' });

            console.log(`[CreateClippingMask] 已将图层 "${targetLayer.name}" 剪切到 "${baseLayer.name}"`);

            return {
                success: true,
                clippedLayer: {
                    id: targetLayer.id,
                    name: targetLayer.name
                },
                baseLayer: {
                    id: baseLayer.id,
                    name: baseLayer.name
                },
                warnings: warnings.length > 0 ? warnings : undefined
            };

        } catch (error) {
            console.error('[CreateClippingMask] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '创建剪切蒙版失败'
            };
        }
    }

    /**
     * 获取图层下方的图层
     */
    private getLayerBelow(doc: any, targetLayer: any): any {
        const allLayers = this.getAllLayersFlat(doc);
        const targetIndex = allLayers.findIndex((l: any) => l.id === targetLayer.id);
        
        if (targetIndex >= 0 && targetIndex < allLayers.length - 1) {
            return allLayers[targetIndex + 1];
        }
        return null;
    }

    /**
     * 获取所有图层的扁平列表（按视觉顺序）
     */
    private getAllLayersFlat(container: any): any[] {
        const layers: any[] = [];
        for (const layer of container.layers) {
            layers.push(layer);
            if (layer.layers) {
                layers.push(...this.getAllLayersFlat(layer));
            }
        }
        return layers;
    }
}

export class ReleaseClippingMaskTool implements Tool {
    name = 'releaseClippingMask';

    schema: ToolSchema = {
        name: 'releaseClippingMask',
        description: '释放当前选中图层的剪切蒙版关系，使其成为独立图层。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要释放剪切蒙版的图层 ID（可选，默认使用当前选中的图层）'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
    }): Promise<{
        success: boolean;
        releasedLayer?: {
            id: number;
            name: string;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetLayer: any;

            if (params.layerId) {
                targetLayer = findLayerById(doc, params.layerId);
                if (!targetLayer) {
                    return { success: false, error: `未找到 ID 为 ${params.layerId} 的图层` };
                }
            } else {
                if (doc.activeLayers.length === 0) {
                    return { success: false, error: '没有选中的图层' };
                }
                targetLayer = doc.activeLayers[0];
            }

            // 检查是否是剪切蒙版
            if (!targetLayer.isClippingMask) {
                return { success: false, error: `图层 "${targetLayer.name}" 不是剪切蒙版` };
            }

            // 释放剪切蒙版
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetLayer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'ungroup',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }, { commandName: 'DesignEcho: 释放剪切蒙版' });

            console.log(`[ReleaseClippingMask] 已释放图层 "${targetLayer.name}" 的剪切蒙版`);

            return {
                success: true,
                releasedLayer: {
                    id: targetLayer.id,
                    name: targetLayer.name
                }
            };

        } catch (error) {
            console.error('[ReleaseClippingMask] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '释放剪切蒙版失败'
            };
        }
    }

}
