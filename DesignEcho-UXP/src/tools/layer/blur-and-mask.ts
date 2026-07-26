/**
 * 高斯模糊与通用图层蒙版工具
 *
 * 电商高频操作：背景虚化突出主体、给图层加蒙版做非破坏性合成。
 * - gaussianBlurLayer：对栅格图层直接应用（破坏性）；目标为智能对象时 Photoshop
 *   会自动落成可编辑的智能滤镜。文本/形状图层需要先栅格化或转智能对象，
 *   命令不可用时按归一化失败如实返回，不弹原生对话框。
 * - createLayerMask / deleteLayerMask：通用蒙版增删，写后用 userMaskEnabled 读回验证。
 * 所有写操作都带 dialogOptions:'dontDisplay'。
 */

import { app, core, action } from 'photoshop';
import type { Tool } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

interface LayerToolResult {
    success: boolean;
    documentId?: number;
    layerId?: number;
    layerName?: string;
    hasUserMask?: boolean;
    message?: string;
    error?: string;
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function findLayerById(doc: any, layerId: number): any {
    const stack = [...(doc?.layers || [])];
    while (stack.length > 0) {
        const layer = stack.shift();
        if (!layer) break;
        if (layer.id === layerId) return layer;
        if (Array.isArray(layer.layers) && layer.layers.length > 0) {
            stack.push(...layer.layers);
        }
    }
    return null;
}

/** 解析目标图层：给了 layerId 用 id（找不到即失败），否则用当前活动图层。 */
function resolveTargetLayer(doc: any, toolName: string, layerId: unknown, params: unknown): { layer: any } | { failure: LayerToolResult } {
    if (layerId !== undefined && layerId !== null) {
        const id = Math.round(Number(layerId));
        const layer = Number.isFinite(id) ? findLayerById(doc, id) : null;
        if (!layer) {
            return {
                failure: createToolFailureResult({
                    toolName,
                    error: `未找到图层 ID: ${JSON.stringify(layerId)}。请先用 getLayerHierarchy 读取真实图层 ID，不要猜。`,
                    params
                })
            };
        }
        return { layer };
    }
    const active = doc.activeLayers?.[0];
    if (!active) {
        return {
            failure: createToolFailureResult({
                toolName,
                error: '没有选中的图层。请传 layerId 或先用 selectLayer 选中目标图层。',
                params
            })
        };
    }
    return { layer: active };
}

/** 读目标图层的 userMaskEnabled（读回验证用；读不到返回 undefined，不冒充）。 */
async function readUserMaskEnabled(layerId: number): Promise<boolean | undefined> {
    const result = await action.batchPlay([
        {
            _obj: 'get',
            _target: [{ _ref: 'layer', _id: layerId }],
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
    const value = result?.[0]?.userMaskEnabled;
    return typeof value === 'boolean' ? value : undefined;
}

/** 对目标图层应用高斯模糊。 */
export class GaussianBlurLayerTool implements Tool {
    name = 'gaussianBlurLayer';

    schema = {
        name: 'gaussianBlurLayer',
        description: '对目标图层应用高斯模糊（半径像素）。栅格图层为破坏性应用；智能对象自动成为可编辑智能滤镜。常用于虚化背景突出主体；文本/形状图层需先 convertToSmartObject。',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '目标图层 ID，不指定则使用当前选中图层' },
                radius: { type: 'number', description: '模糊半径（像素，0.1~250），默认 4' }
            }
        }
    };

    async execute(params: { layerId?: number; radius?: number }): Promise<LayerToolResult> {
        const doc = app.activeDocument as any;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法应用高斯模糊。', params });
        }
        const target = resolveTargetLayer(doc, this.name, params?.layerId, params);
        if ('failure' in target) return target.failure;

        const radius = clampFloat(params?.radius, 0.1, 250, 4);

        try {
            await core.executeAsModal(async () => {
                doc.activeLayers = [target.layer];
                await action.batchPlay([
                    {
                        _obj: 'gaussianBlur',
                        radius: { _unit: 'pixelsUnit', _value: radius },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: 高斯模糊' });

            return {
                success: true,
                documentId: doc.id,
                layerId: target.layer.id,
                layerName: target.layer.name,
                message: `已对图层「${target.layer.name}」应用 ${radius}px 高斯模糊。可用 getDocumentSnapshot 复核虚化效果。`
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

/** 给目标图层添加图层蒙版。 */
export class CreateLayerMaskTool implements Tool {
    name = 'createLayerMask';

    schema = {
        name: 'createLayerMask',
        description: '给目标图层添加图层蒙版（非破坏性合成的入口）：revealAll=显示全部，hideAll=隐藏全部，revealSelection=按当前选区生成。添加后用 getDocumentSnapshot 或蒙版读回验证。',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '目标图层 ID，不指定则使用当前选中图层' },
                mode: {
                    type: 'string',
                    enum: ['revealAll', 'hideAll', 'revealSelection'],
                    description: '蒙版初始状态，默认 revealAll。revealSelection 需要当前已有选区。'
                }
            }
        }
    };

    async execute(params: { layerId?: number; mode?: string }): Promise<LayerToolResult> {
        const doc = app.activeDocument as any;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法添加图层蒙版。', params });
        }
        const target = resolveTargetLayer(doc, this.name, params?.layerId, params);
        if ('failure' in target) return target.failure;

        const mode = ['revealAll', 'hideAll', 'revealSelection'].includes(String(params?.mode))
            ? String(params?.mode)
            : 'revealAll';

        try {
            let verifiedMask: boolean | undefined;
            await core.executeAsModal(async () => {
                doc.activeLayers = [target.layer];
                await action.batchPlay([
                    {
                        _obj: 'make',
                        new: { _class: 'channel' },
                        at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                        using: { _enum: 'userMaskEnabled', _value: mode },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                verifiedMask = await readUserMaskEnabled(target.layer.id);
            }, { commandName: 'DesignEcho: 添加图层蒙版' });

            if (verifiedMask === false) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: '蒙版添加命令已执行，但读回验证未看到蒙版（userMaskEnabled=false）。',
                    params
                });
            }

            return {
                success: true,
                documentId: doc.id,
                layerId: target.layer.id,
                layerName: target.layer.name,
                hasUserMask: verifiedMask,
                message: `已为图层「${target.layer.name}」添加 ${mode} 蒙版。`
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

/** 删除目标图层的图层蒙版（可选择是否应用蒙版效果到像素）。 */
export class DeleteLayerMaskTool implements Tool {
    name = 'deleteLayerMask';

    schema = {
        name: 'deleteLayerMask',
        description: '删除目标图层的图层蒙版：apply=false 直接丢弃蒙版（图层恢复原样），apply=true 先把蒙版效果应用到像素再删除（破坏性）。',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '目标图层 ID，不指定则使用当前选中图层' },
                apply: { type: 'boolean', description: '是否先把蒙版应用到像素再删除，默认 false（丢弃蒙版）' }
            }
        }
    };

    async execute(params: { layerId?: number; apply?: boolean }): Promise<LayerToolResult> {
        const doc = app.activeDocument as any;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法删除图层蒙版。', params });
        }
        const target = resolveTargetLayer(doc, this.name, params?.layerId, params);
        if ('failure' in target) return target.failure;

        const apply = params?.apply === true;

        try {
            const beforeMask = await readUserMaskEnabled(target.layer.id);
            if (beforeMask === false) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: `图层「${target.layer.name}」没有图层蒙版，无需删除。`,
                    params
                });
            }

            let verifiedMask: boolean | undefined;
            await core.executeAsModal(async () => {
                doc.activeLayers = [target.layer];
                await action.batchPlay([
                    {
                        _obj: 'delete',
                        _target: [{ _ref: 'channel', _enum: 'channel', _value: 'mask' }],
                        apply: { _enum: 'apply', _value: apply ? 'apply' : 'no' },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                verifiedMask = await readUserMaskEnabled(target.layer.id);
            }, { commandName: 'DesignEcho: 删除图层蒙版' });

            if (verifiedMask === true) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: '蒙版删除命令已执行，但读回验证蒙版仍存在（userMaskEnabled=true）。',
                    params
                });
            }

            return {
                success: true,
                documentId: doc.id,
                layerId: target.layer.id,
                layerName: target.layer.name,
                hasUserMask: verifiedMask,
                message: `已删除图层「${target.layer.name}」的蒙版（${apply ? '已先把蒙版应用到像素' : '未应用，直接丢弃'}）。`
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
