/**
 * 图层排序工具
 * 
 * 控制图层的上下层级关系
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
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

function findLayerLocation(container: any, id: number): { layer: any; parent: any; index: number } | null {
    const layers = container.layers || [];
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer.id === id) {
            return { layer, parent: container, index: i };
        }
        if (layer.layers) {
            const found = findLayerLocation(layer, id);
            if (found) return found;
        }
    }
    return null;
}

async function selectLayerById(layerId: number): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
}

function getElementPlacement(name: 'PLACEBEFORE' | 'PLACEAFTER'): unknown {
    return getPhotoshopElementPlacement(constants, name, 'ReorderLayer');
}

function moveLayerToFront(layer: any): void {
    if (typeof layer.bringToFront === 'function') {
        layer.bringToFront();
        return;
    }
    throw new Error('当前 Photoshop UXP 环境不支持 layer.bringToFront');
}

function moveLayerToBack(layer: any): void {
    if (typeof layer.sendToBack === 'function') {
        layer.sendToBack();
        return;
    }
    throw new Error('当前 Photoshop UXP 环境不支持 layer.sendToBack');
}

function moveLayerRelative(layer: any, relativeLayer: any, placementName: 'PLACEBEFORE' | 'PLACEAFTER'): void {
    if (typeof layer.move !== 'function') {
        throw new Error('当前 Photoshop UXP 环境不支持 layer.move');
    }
    layer.move(relativeLayer, getElementPlacement(placementName));
}

function moveLayerToSiblingIndex(doc: any, targetLayer: any, desiredIndex: number): void {
    const currentLocation = findLayerLocation(doc, targetLayer.id);
    if (!currentLocation) {
        throw new Error('无法读取图层当前位置');
    }

    const movableSiblings = (currentLocation.parent.layers || []).filter((layer: any) => !layer.isBackgroundLayer);
    const currentIndex = movableSiblings.findIndex((layer: any) => layer.id === targetLayer.id);
    if (currentIndex < 0) {
        throw new Error('无法在同级图层中定位目标图层');
    }

    const clampedIndex = Math.max(0, Math.min(movableSiblings.length - 1, desiredIndex));
    if (clampedIndex === currentIndex) return;

    const withoutTarget = movableSiblings.filter((layer: any) => layer.id !== targetLayer.id);
    if (clampedIndex === 0) {
        moveLayerToFront(targetLayer);
        return;
    }
    if (clampedIndex >= withoutTarget.length) {
        moveLayerToBack(targetLayer);
        return;
    }

    moveLayerRelative(targetLayer, withoutTarget[clampedIndex], 'PLACEBEFORE');
}

async function moveLayerWithinSiblings(doc: any, targetLayer: any, desiredIndex: number): Promise<void> {
    moveLayerToSiblingIndex(doc, targetLayer, desiredIndex);
    await selectLayerById(targetLayer.id);
}

export class ReorderLayerTool implements Tool {
    name = 'reorderLayer';

    schema: ToolSchema = {
        name: 'reorderLayer',
        description: '调整图层的堆叠顺序。可以将图层上移、下移、置顶、置底，或移动到指定图层的上方/下方。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要移动的图层 ID（可选，默认使用当前选中的图层）'
                },
                action: {
                    type: 'string',
                    enum: ['up', 'down', 'top', 'bottom', 'above', 'below'],
                    description: '移动方式: up(上移一层), down(下移一层), top(置顶), bottom(置底), above(移到指定图层上方), below(移到指定图层下方)'
                },
                targetLayerId: {
                    type: 'number',
                    description: '目标图层 ID（仅当 action 为 above 或 below 时需要）'
                },
                steps: {
                    type: 'number',
                    description: '移动的层数（仅当 action 为 up 或 down 时有效），默认 1'
                }
            },
            required: ['action']
        }
    };

    async execute(params: {
        layerId?: number;
        action: 'up' | 'down' | 'top' | 'bottom' | 'above' | 'below';
        targetLayerId?: number;
        steps?: number;
    }): Promise<{
        success: boolean;
        layer?: {
            id: number;
            name: string;
            newPosition: string;
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

            // 检查是否是背景图层
            if (targetLayer.isBackgroundLayer) {
                return { success: false, error: '背景图层不能移动' };
            }

            const steps = params.steps || 1;
            let newPosition = '';

            await core.executeAsModal(async () => {
                switch (params.action) {
                    case 'up':
                        {
                            const location = findLayerLocation(doc, targetLayer.id);
                            if (!location) throw new Error('无法读取图层当前位置');
                            await moveLayerWithinSiblings(doc, targetLayer, location.index - steps);
                        }
                        newPosition = `上移 ${steps} 层`;
                        break;

                    case 'down':
                        {
                            const location = findLayerLocation(doc, targetLayer.id);
                            if (!location) throw new Error('无法读取图层当前位置');
                            await moveLayerWithinSiblings(doc, targetLayer, location.index + steps);
                        }
                        newPosition = `下移 ${steps} 层`;
                        break;

                    case 'top':
                        moveLayerToFront(targetLayer);
                        await selectLayerById(targetLayer.id);
                        newPosition = '已置顶';
                        break;

                    case 'bottom':
                        moveLayerToBack(targetLayer);
                        await selectLayerById(targetLayer.id);
                        newPosition = '已置底';
                        break;

                    case 'above':
                    case 'below':
                        if (!params.targetLayerId) {
                            throw new Error('需要指定目标图层 ID');
                        }
                        const destLayer = findLayerById(doc, params.targetLayerId);
                        if (!destLayer) {
                            throw new Error(`未找到目标图层 ID: ${params.targetLayerId}`);
                        }

                        const destinationLocation = findLayerLocation(doc, destLayer.id);
                        const currentLocation = findLayerLocation(doc, targetLayer.id);
                        if (!currentLocation || !destinationLocation) {
                            throw new Error('无法读取图层当前位置');
                        }
                        if (currentLocation.parent !== destinationLocation.parent) {
                            // 跨组相对放置（2026-07-07）：DOM layer.move 原生支持——图层会自动
                            // 移入目标图层所在的父容器并落在其上/下方。此前这里人为 throw，
                            // 逼模型走「moveLayerToGroup 落组顶 + 单步盲移 ×N」长链（真机 110 步案例根因）。
                            moveLayerRelative(targetLayer, destLayer, params.action === 'above' ? 'PLACEBEFORE' : 'PLACEAFTER');
                            await selectLayerById(targetLayer.id);
                            newPosition = params.action === 'above'
                                ? `已跨组移到 "${destLayer.name}" 上方`
                                : `已跨组移到 "${destLayer.name}" 下方`;
                            break;
                        }

                        const movableSiblings = (currentLocation.parent.layers || []).filter((layer: any) => !layer.isBackgroundLayer);
                        const withoutTarget = movableSiblings.filter((layer: any) => layer.id !== targetLayer.id);
                        const destinationIndex = withoutTarget.findIndex((layer: any) => layer.id === destLayer.id);
                        if (destinationIndex < 0) {
                            throw new Error('无法在同级图层中定位目标图层');
                        }
                        const insertIndex = params.action === 'above' ? destinationIndex : destinationIndex + 1;
                        moveLayerToSiblingIndex(doc, targetLayer, insertIndex);
                        await selectLayerById(targetLayer.id);
                        newPosition = params.action === 'above' 
                            ? `移到 "${destLayer.name}" 上方` 
                            : `移到 "${destLayer.name}" 下方`;
                        break;
                }
            }, { commandName: 'DesignEcho: 调整图层顺序' });

            console.log(`[ReorderLayer] 图层 "${targetLayer.name}" ${newPosition}`);

            return {
                success: true,
                layer: {
                    id: targetLayer.id,
                    name: targetLayer.name,
                    newPosition
                }
            };

        } catch (error) {
            console.error('[ReorderLayer] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

}

/**
 * 图层编组工具
 */
export class GroupLayersTool implements Tool {
    name = 'groupLayers';

    schema: ToolSchema = {
        name: 'groupLayers',
        description: '将选中的图层编组（创建图层组）。',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    description: '要编组的图层 ID 列表（可选，默认使用当前选中的所有图层）',
                    items: { type: 'number' }
                },
                groupName: {
                    type: 'string',
                    description: '新建组的名称，默认为 "组 1"'
                }
            }
        }
    };

    async execute(params: {
        layerIds?: number[];
        groupName?: string;
    }): Promise<{
        success: boolean;
        group?: {
            id: number;
            name: string;
            layerCount: number;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 选中要编组的图层
            if (params.layerIds && params.layerIds.length > 0) {
                await core.executeAsModal(async () => {
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: params.layerIds!.map(id => ({ _ref: 'layer', _id: id })),
                            makeVisible: false,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }, { commandName: 'DesignEcho: 选择图层' });
            }

            if (doc.activeLayers.length < 1) {
                return { success: false, error: '至少需要选中一个图层才能编组' };
            }

            const layerCount = doc.activeLayers.length;

            // 创建编组
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'layerSection' }],
                        from: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
                        using: {
                            _obj: 'layerSection',
                            name: params.groupName || '组 1'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: 图层编组' });

            // 获取新建的组信息
            const newGroup = doc.activeLayers[0];

            console.log(`[GroupLayers] 已创建组 "${newGroup.name}"，包含 ${layerCount} 个图层`);

            return {
                success: true,
                group: {
                    id: newGroup.id,
                    name: newGroup.name,
                    layerCount
                }
            };

        } catch (error) {
            console.error('[GroupLayers] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

/**
 * 取消编组工具
 */
export class UngroupLayersTool implements Tool {
    name = 'ungroupLayers';

    schema: ToolSchema = {
        name: 'ungroupLayers',
        description: '取消图层组，将组内的图层释放出来。',
        parameters: {
            type: 'object',
            properties: {
                groupId: {
                    type: 'number',
                    description: '要取消编组的图层组 ID（可选，默认使用当前选中的组）'
                }
            }
        }
    };

    async execute(params: {
        groupId?: number;
    }): Promise<{
        success: boolean;
        ungroupedLayers?: Array<{
            id: number;
            name: string;
        }>;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetGroup: any;

            if (params.groupId) {
                targetGroup = findLayerById(doc, params.groupId);
                if (!targetGroup) {
                    return { success: false, error: `未找到 ID 为 ${params.groupId} 的图层组` };
                }
            } else {
                if (doc.activeLayers.length === 0) {
                    return { success: false, error: '没有选中的图层' };
                }
                targetGroup = doc.activeLayers[0];
            }

            // 检查是否是图层组
            const kind = targetGroup.kind?.toString() || '';
            if (!kind.includes('group') && !targetGroup.layers) {
                return { success: false, error: `图层 "${targetGroup.name}" 不是图层组` };
            }

            // 取消编组
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetGroup.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'ungroupLayersEvent',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: 取消编组' });

            // 获取释放出来的图层
            const ungroupedLayers = doc.activeLayers.map((l: any) => ({
                id: l.id,
                name: l.name
            }));

            console.log(`[UngroupLayers] 已取消编组，释放 ${ungroupedLayers.length} 个图层`);

            return {
                success: true,
                ungroupedLayers
            };

        } catch (error) {
            console.error('[UngroupLayers] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

}
