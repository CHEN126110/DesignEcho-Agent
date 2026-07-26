/**
 * 创建图层组工具
 */

import { app, core, action } from 'photoshop';
import type { Tool } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

async function selectLayersByIds(layerIds: number[]): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'select',
            _target: layerIds.map(id => ({ _ref: 'layer', _id: id })),
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], {});
}

export class CreateGroupTool implements Tool {
    name = 'createGroup';
    schema = {
        name: 'createGroup',
        description: '创建图层组。支持创建空组、将当前选中图层编组，或使用显式 layerIds 编组。',
        parameters: {
            type: 'object' as const,
            properties: {
                groupName: {
                    type: 'string',
                    description: '图层组名称。'
                },
                fromSelected: {
                    type: 'boolean',
                    description: '是否将当前选中图层编组。默认 false，表示创建空组。'
                },
                layerIds: {
                    type: 'array',
                    description: '要编组的图层 ID 列表。提供后优先级高于 fromSelected。',
                    items: { type: 'number' }
                }
            },
            required: ['groupName']
        }
    };

    async execute(params: {
        groupName: string;
        fromSelected?: boolean;
        layerIds?: number[];
    }): Promise<{
        success: boolean;
        entityType?: 'group';
        documentId?: number;
        layerId?: number;
        name?: string;
        groupedLayerCount?: number;
        groupName?: string;
        layerCount?: number;
        group?: {
            id: number;
            name: string;
            layerCount: number;
        };
        message?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: '没有打开的文档，无法创建图层组。',
                    params
                });
            }

            const groupName = String(params.groupName || '').trim();
            if (!groupName) {
                return { success: false, error: 'createGroup failed: groupName must not be empty.' };
            }

            const requestedLayerIds = isNumberArray(params.layerIds) ? params.layerIds : [];
            const useExplicitLayerIds = requestedLayerIds.length > 0;
            const fromSelected = useExplicitLayerIds ? true : params.fromSelected === true;
            let layerCount = 0;
            let createdGroupId: number | undefined;

            await core.executeAsModal(async () => {
                if (useExplicitLayerIds) {
                    await selectLayersByIds(requestedLayerIds);
                    layerCount = requestedLayerIds.length;
                } else if (fromSelected) {
                    const selectedLayers = doc.activeLayers;
                    if (!selectedLayers || selectedLayers.length === 0) {
                        throw new Error('createGroup failed: select at least one layer or provide layerIds.');
                    }
                    layerCount = selectedLayers.length;
                }

                if (fromSelected) {
                    await action.batchPlay([
                        {
                            _obj: 'make',
                            _target: [{ _ref: 'layerSection' }],
                            from: {
                                _ref: 'layer',
                                _enum: 'ordinal',
                                _value: 'targetEnum'
                            },
                            using: {
                                _obj: 'layerSection',
                                name: groupName
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                } else {
                    await action.batchPlay([
                        {
                            _obj: 'make',
                            _target: [{ _ref: 'layerSection' }],
                            _options: { dialogOptions: 'dontDisplay' }
                        },
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: {
                                _obj: 'layer',
                                name: groupName
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }

                createdGroupId = doc.activeLayers[0]?.id;
            }, { commandName: 'DesignEcho: 创建图层组' });

            const resultGroup = {
                id: createdGroupId || 0,
                name: groupName,
                layerCount
            };

            return {
                success: true,
                entityType: 'group',
                documentId: doc.id,
                layerId: createdGroupId,
                name: groupName,
                groupedLayerCount: layerCount,
                groupName,
                layerCount,
                group: resultGroup,
                message: fromSelected
                    ? `Created group "${groupName}" with ${layerCount} layer(s).`
                    : `Created empty group "${groupName}".`
            };
        } catch (error) {
            console.error('[CreateGroup] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

