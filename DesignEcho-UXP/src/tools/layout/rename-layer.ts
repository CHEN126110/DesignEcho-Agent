/**
 * 重命名图层工具
 * 
 * 修改图层名称
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core, action } = require('photoshop');

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

export class RenameLayerTool implements Tool {
    name = 'renameLayer';

    schema: ToolSchema = {
        name: 'renameLayer',
        description: '重命名指定的图层。可以通过图层 ID 或当前选中的图层来指定目标。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要重命名的图层 ID（可选，默认使用当前选中的图层）'
                },
                newName: {
                    type: 'string',
                    description: '新的图层名称'
                }
            },
            required: ['newName']
        }
    };

    async execute(params: {
        layerId?: number;
        newName: string;
    }): Promise<{
        success: boolean;
        layer?: {
            id: number;
            oldName: string;
            newName: string;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            if (!params.newName || params.newName.trim() === '') {
                return { success: false, error: '图层名称不能为空' };
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

            const oldName = targetLayer.name;
            const newName = params.newName.trim();

            // 重命名图层
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: targetLayer.id }],
                        to: {
                            _obj: 'layer',
                            name: newName
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }, { commandName: 'DesignEcho: 重命名图层' });

            console.log(`[RenameLayer] 图层 "${oldName}" 重命名为 "${newName}"`);

            return {
                success: true,
                layer: {
                    id: targetLayer.id,
                    oldName,
                    newName
                }
            };

        } catch (error) {
            console.error('[RenameLayer] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '重命名图层失败'
            };
        }
    }

}

/**
 * 批量重命名图层工具
 */
export class BatchRenameLayersTool implements Tool {
    name = 'batchRenameLayers';

    schema: ToolSchema = {
        name: 'batchRenameLayers',
        description: '批量重命名多个图层。可以使用模式替换或序号命名。',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    description: '要重命名的图层 ID 列表（可选，默认使用当前选中的所有图层）',
                    items: { type: 'number' }
                },
                pattern: {
                    type: 'string',
                    description: '命名模式，使用 {n} 表示序号（从1开始），{name} 表示原名称。例如: "图层_{n}" 或 "{name}_副本"'
                },
                startNumber: {
                    type: 'number',
                    description: '起始序号，默认 1'
                },
                findReplace: {
                    type: 'object',
                    description: '查找替换模式',
                    properties: {
                        find: { type: 'string', description: '要查找的文本' },
                        replace: { type: 'string', description: '替换为的文本' }
                    }
                }
            }
        }
    };

    async execute(params: {
        layerIds?: number[];
        pattern?: string;
        startNumber?: number;
        findReplace?: { find: string; replace: string };
    }): Promise<{
        success: boolean;
        renamedLayers?: Array<{
            id: number;
            oldName: string;
            newName: string;
        }>;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetLayers: any[] = [];

            if (params.layerIds && params.layerIds.length > 0) {
                for (const id of params.layerIds) {
                    const layer = findLayerById(doc, id);
                    if (layer) {
                        targetLayers.push(layer);
                    }
                }
            } else {
                targetLayers = [...doc.activeLayers];
            }

            if (targetLayers.length === 0) {
                return { success: false, error: '没有要重命名的图层' };
            }

            const results: Array<{ id: number; oldName: string; newName: string }> = [];
            const startNumber = params.startNumber || 1;

            await core.executeAsModal(async () => {
                for (let i = 0; i < targetLayers.length; i++) {
                    const layer = targetLayers[i];
                    const oldName = layer.name;
                    let newName = oldName;

                    // 使用模式命名
                    if (params.pattern) {
                        newName = params.pattern
                            .replace(/\{n\}/g, String(startNumber + i))
                            .replace(/\{name\}/g, oldName);
                    }
                    // 使用查找替换
                    else if (params.findReplace && params.findReplace.find) {
                        newName = oldName.replace(
                            new RegExp(this.escapeRegExp(params.findReplace.find), 'g'),
                            params.findReplace.replace || ''
                        );
                    }

                    if (newName !== oldName) {
                        await action.batchPlay([
                            {
                                _obj: 'set',
                                _target: [{ _ref: 'layer', _id: layer.id }],
                                to: {
                                    _obj: 'layer',
                                    name: newName
                                },
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], {});

                        results.push({
                            id: layer.id,
                            oldName,
                            newName
                        });
                    }
                }
            }, { commandName: 'DesignEcho: 批量重命名图层' });

            console.log(`[BatchRenameLayers] 已重命名 ${results.length} 个图层`);

            return {
                success: true,
                renamedLayers: results
            };

        } catch (error) {
            console.error('[BatchRenameLayers] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '批量重命名失败'
            };
        }
    }

    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
