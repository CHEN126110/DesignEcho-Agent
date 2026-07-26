/**
 * 分布图层工具
 * 
 * 均匀分布多个图层的间距
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

const app = require('photoshop').app;
const { core } = require('photoshop');
const { action } = require('photoshop');

type DistributeType = 'horizontal' | 'vertical' | 'horizontalCenters' | 'verticalCenters';

export class DistributeLayersTool implements Tool {
    name = 'distributeLayers';

    schema: ToolSchema = {
        name: 'distributeLayers',
        description: '均匀分布多个图层的间距',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '要分布的图层ID数组（至少3个），如果不提供则使用当前选中的图层'
                },
                distributeType: {
                    type: 'string',
                    enum: ['horizontal', 'vertical', 'horizontalCenters', 'verticalCenters'],
                    description: '分布方式：horizontal（水平间距）、vertical（垂直间距）、horizontalCenters（水平中心）、verticalCenters（垂直中心）'
                }
            },
            required: ['distributeType']
        }
    };

    async execute(params: {
        layerIds?: number[];
        distributeType: DistributeType;
    }): Promise<{
        success: boolean;
        distributedLayers?: number[];
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 获取要分布的图层
            let layers: any[] = [];
            
            if (params.layerIds && params.layerIds.length > 0) {
                for (const id of params.layerIds) {
                    const layer = this.findLayerById(doc, id);
                    if (layer) {
                        layers.push(layer);
                    }
                }
            } else {
                layers = doc.activeLayers || [];
            }

            if (layers.length < 3) {
                return { success: false, error: '至少需要选中3个图层才能进行分布' };
            }

            await core.executeAsModal(async () => {
                // 先选中这些图层
                if (params.layerIds && params.layerIds.length > 0) {
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: params.layerIds.map(id => ({ _ref: 'layer', _id: id })),
                            makeVisible: false,
                            layerID: params.layerIds,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }

                // 构建分布命令
                const distributeDescriptor = this.getDistributeDescriptor(params.distributeType);
                
                await action.batchPlay([distributeDescriptor], { synchronousExecution: true });

            }, { commandName: 'DesignEcho: 分布图层' });

            return {
                success: true,
                distributedLayers: layers.map(l => l.id)
            };

        } catch (error) {
            console.error('[DistributeLayers] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

    private getDistributeDescriptor(distributeType: DistributeType): any {
        // 映射分布类型到 Photoshop 的 alignDistributeSelector
        const distributeMap: Record<DistributeType, string> = {
            'horizontal': 'ADSDistributeH',
            'vertical': 'ADSDistributeV',
            'horizontalCenters': 'ADSDistributeCentersH',
            'verticalCenters': 'ADSDistributeCentersV'
        };

        return {
            _obj: 'distribute',
            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
            using: { _enum: 'alignDistributeSelector', _value: distributeMap[distributeType] },
            _options: { dialogOptions: 'dontDisplay' }
        };
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
