/**
 * Move a layer or group into another group.
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult, ToolFailureResult } from '../../core/tool-error-normalizer';
import { getPhotoshopElementPlacement } from './photoshop-runtime-adapters';

const app = require('photoshop').app;
const { action, constants, core } = require('photoshop');

type MoveLayerToGroupPosition = 'inside' | 'inside-top' | 'inside-bottom';

interface LayerLocation {
    layer: any;
    parent: any;
    index: number;
    path: string[];
    pathIds: number[];
}

function findLayerLocation(container: any, id: number, path: string[] = [], pathIds: number[] = []): LayerLocation | null {
    const layers = container.layers || [];
    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        const layerPath = [...path, String(layer.name || `Layer ${layer.id}`)];
        const layerPathIds = [...pathIds, Number(layer.id)];

        if (Number(layer.id) === id) {
            return {
                layer,
                parent: container,
                index,
                path: layerPath,
                pathIds: layerPathIds
            };
        }

        if (layer.layers) {
            const found = findLayerLocation(layer, id, layerPath, layerPathIds);
            if (found) return found;
        }
    }
    return null;
}

function isGroupLayer(layer: any): boolean {
    return Boolean(layer && layer.layers);
}

function getLayerName(layer: any): string {
    return String(layer?.name || `Layer ${layer?.id || 0}`);
}

function getParentId(parent: any): number | null {
    return Number.isFinite(Number(parent?.id)) ? Number(parent.id) : null;
}

function getParentName(parent: any): string | null {
    if (!parent || !Number.isFinite(Number(parent.id))) return null;
    return getLayerName(parent);
}

function getPlaceInsideConstant(): unknown {
    return getPhotoshopElementPlacement(constants, 'PLACEINSIDE', 'MoveLayerToGroup');
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

async function applyPosition(layer: any, position: MoveLayerToGroupPosition): Promise<void> {
    if (position === 'inside-top') {
        if (typeof layer.bringToFront !== 'function') {
            throw new Error('当前 Photoshop UXP 环境不支持 layer.bringToFront');
        }
        await Promise.resolve(layer.bringToFront());
        return;
    }

    if (position === 'inside-bottom') {
        if (typeof layer.sendToBack !== 'function') {
            throw new Error('当前 Photoshop UXP 环境不支持 layer.sendToBack');
        }
        await Promise.resolve(layer.sendToBack());
    }
}

function normalizePosition(value: unknown): MoveLayerToGroupPosition {
    if (value === 'inside-top' || value === 'inside-bottom') {
        return value;
    }
    return 'inside';
}

export class MoveLayerToGroupTool implements Tool {
    name = 'moveLayerToGroup';

    schema: ToolSchema = {
        name: 'moveLayerToGroup',
        description: 'Move an existing Photoshop layer or group into a target group. This changes layer hierarchy only; use moveLayer for canvas x/y positioning.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Source layer or group ID to move.'
                },
                targetGroupId: {
                    type: 'number',
                    description: 'Target group layer ID. The target must be a Photoshop group layer.'
                },
                position: {
                    type: 'string',
                    enum: ['inside', 'inside-top', 'inside-bottom'],
                    description: 'Optional placement inside the target group. Default: inside.'
                }
            },
            required: ['layerId', 'targetGroupId']
        }
    };

    async execute(params: {
        layerId?: number;
        targetGroupId?: number;
        position?: MoveLayerToGroupPosition;
    }): Promise<{
        success: boolean;
        layerId?: number;
        targetGroupId?: number;
        previousParentId?: number | null;
        previousParentName?: string | null;
        newParentId?: number | null;
        newParentName?: string | null;
        previousPath?: string[];
        newPath?: string[];
        position?: MoveLayerToGroupPosition;
        message?: string;
        error?: string;
        errorDetails?: ToolFailureResult['errorDetails'];
        data?: null;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
            }

            const layerId = Number(params.layerId);
            const targetGroupId = Number(params.targetGroupId);
            if (!Number.isFinite(layerId) || layerId <= 0) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'moveLayerToGroup failed: layerId must be a positive number.',
                    params
                });
            }
            // targetGroupId === 0：移到文档根级顶部（2026-07-07）。createGroup 的出生位置取决于
            // 当前选中图层，新组可能误生在其它组内部（真机病例：B 屏组嵌进 A 屏的图标子组）——
            // 归位到文档根级是结构保证的必要能力。
            if (Number.isFinite(targetGroupId) && targetGroupId === 0) {
                const rootSource = findLayerLocation(doc, layerId);
                if (!rootSource) {
                    return createToolFailureResult({ toolName: this.name, error: `Layer not found: ${layerId}`, params });
                }
                if (typeof rootSource.layer.move !== 'function') {
                    return createToolFailureResult({ toolName: this.name, error: 'Current Photoshop UXP environment does not support layer.move.', params });
                }
                const previousParentIdRoot = getParentId(rootSource.parent);
                const previousParentNameRoot = getParentName(rootSource.parent);
                const rootFirst = (doc.layers || [])[0];
                await core.executeAsModal(async () => {
                    if (rootFirst && Number(rootFirst.id) !== layerId) {
                        await Promise.resolve(rootSource.layer.move(
                            rootFirst,
                            getPhotoshopElementPlacement(constants, 'PLACEBEFORE', 'MoveLayerToGroup')
                        ));
                    }
                    await selectLayerById(layerId);
                }, { commandName: 'DesignEcho: 移到文档根级' });
                const rootNewLocation = findLayerLocation(doc, layerId);
                return {
                    success: true,
                    layerId,
                    targetGroupId: 0,
                    previousParentId: previousParentIdRoot,
                    previousParentName: previousParentNameRoot,
                    newParentId: rootNewLocation ? getParentId(rootNewLocation.parent) : null,
                    newParentName: rootNewLocation ? getParentName(rootNewLocation.parent) : null,
                    previousPath: rootSource.path,
                    newPath: rootNewLocation ? rootNewLocation.path : [getLayerName(rootSource.layer)],
                    position: 'inside' as MoveLayerToGroupPosition,
                    message: `Moved "${getLayerName(rootSource.layer)}" to document root (top).`
                };
            }
            if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'moveLayerToGroup failed: targetGroupId must be a positive number (or 0 to move to document root).',
                    params
                });
            }

            const sourceLocation = findLayerLocation(doc, layerId);
            const targetLocation = findLayerLocation(doc, targetGroupId);
            if (!sourceLocation) {
                return createToolFailureResult({ toolName: this.name, error: `Layer not found: ${layerId}`, params });
            }
            if (!targetLocation) {
                return createToolFailureResult({ toolName: this.name, error: `Target group not found: ${targetGroupId}`, params });
            }
            if (!isGroupLayer(targetLocation.layer)) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: `Target layer "${getLayerName(targetLocation.layer)}" is not a group.`,
                    params
                });
            }
            if (layerId === targetGroupId || targetLocation.pathIds.includes(layerId)) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'Cannot move a layer or group into itself or its descendant.',
                    params
                });
            }
            if (sourceLocation.layer.isBackgroundLayer) {
                return createToolFailureResult({ toolName: this.name, error: 'Background layer cannot be moved into a group.', params });
            }
            if (sourceLocation.layer.locked || sourceLocation.layer.allLocked || sourceLocation.layer.positionLocked) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: `Layer "${getLayerName(sourceLocation.layer)}" is locked and cannot be moved.`,
                    params
                });
            }
            if (typeof sourceLocation.layer.move !== 'function') {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'Current Photoshop UXP environment does not support layer.move.',
                    params
                });
            }

            const position = normalizePosition(params.position);
            const previousParentId = getParentId(sourceLocation.parent);
            const previousParentName = getParentName(sourceLocation.parent);
            await core.executeAsModal(async () => {
                await Promise.resolve(sourceLocation.layer.move(targetLocation.layer, getPlaceInsideConstant()));
                await applyPosition(sourceLocation.layer, position);
                await selectLayerById(layerId);
            }, { commandName: 'DesignEcho: 移动图层到组' });
            const newLocation = findLayerLocation(doc, layerId);

            return {
                success: true,
                layerId,
                targetGroupId,
                previousParentId,
                previousParentName,
                newParentId: newLocation ? getParentId(newLocation.parent) : null,
                newParentName: newLocation ? getParentName(newLocation.parent) : null,
                previousPath: sourceLocation.path,
                newPath: newLocation ? newLocation.path : [...targetLocation.path, getLayerName(sourceLocation.layer)],
                position,
                message: `Moved "${getLayerName(sourceLocation.layer)}" into group "${getLayerName(targetLocation.layer)}".`
            };
        } catch (error) {
            console.error('[MoveLayerToGroup] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
