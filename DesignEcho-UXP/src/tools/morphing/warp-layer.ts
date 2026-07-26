/**
 * 图层预设变形工具（修图 / 液化感效果 v1）
 *
 * warpLayer: 对图层应用预设「自由变换变形(Free Transform Warp)」——膨胀/挤压/扭曲/弧形/波浪等。
 * 用于整体形变、液化感效果（如让主体更饱满 warpInflate、收窄 warpSqueeze）。默认在复制层上非破坏性执行。
 *
 * 边界说明（重要）：这是【整层包络变形】，不是局部图钉(Puppet Warp)液化。
 * 局部图钉液化的 batchPlay「移动图钉」描述符尚未在仓库真机录制验证，属 v2。
 *
 * 实现依据：描述符沿用 warp-explorer.ts 中已探测可行的 Free Transform Warp
 * （verifyNativeWarpSupport / applyFreeTransformWarp 的 transform+warp 结构）。
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult, ToolFailureResult } from '../../core/tool-error-normalizer';

const photoshop = require('photoshop');
const { app, action } = photoshop;
const { executeAsModal } = photoshop.core;

// Photoshop 自由变换 Warp 的预设样式
const WARP_STYLES = [
    'warpArc', 'warpArcUpper', 'warpArcLower', 'warpArch', 'warpBulge',
    'warpShellLower', 'warpShellUpper', 'warpFlag', 'warpWave', 'warpFish',
    'warpRise', 'warpFisheye', 'warpInflate', 'warpSqueeze', 'warpTwist'
];

function findLayerById(container: any, id: number): any {
    for (const layer of container?.layers || []) {
        if (layer.id === id) return layer;
        const nested = findLayerById(layer, id);
        if (nested) return nested;
    }
    return null;
}

export class WarpLayerTool implements Tool {
    name = 'warpLayer';

    schema: ToolSchema = {
        name: 'warpLayer',
        description: '对图层应用预设「自由变换变形(Warp)」：膨胀(warpInflate)、挤压(warpSqueeze)、扭曲(warpTwist)、弧形(warpArc)、波浪(warpWave)、鱼形(warpFish)等，用于整体形变/液化感效果。默认在复制层上非破坏性执行。注意：这是整层包络变形，不是局部图钉液化。',
        parameters: {
            type: 'object',
            properties: {
                style: {
                    type: 'string',
                    description: `变形样式：${WARP_STYLES.join(' / ')}`
                },
                value: {
                    type: 'number',
                    description: '变形强度 -100~100（默认 30）。同一样式用正负控制方向（如膨胀↔收缩）。'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选，默认当前活动图层）'
                },
                preserveOriginal: {
                    type: 'boolean',
                    description: '是否在复制层上执行、保留原图层（默认 true，非破坏性）'
                },
                resultLayerName: {
                    type: 'string',
                    description: '输出图层名（可选）'
                }
            },
            required: ['style']
        }
    };

    async execute(params: {
        style: string;
        value?: number;
        layerId?: number;
        preserveOriginal?: boolean;
        resultLayerName?: string;
    }): Promise<string | ToolFailureResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法执行变形', params });
        }

        const style = String(params.style || '').trim();
        if (!WARP_STYLES.includes(style)) {
            const failure = createToolFailureResult({
                toolName: this.name,
                error: `不支持的变形样式: ${params.style}。这是预设包络变形，可选值见 availableStyles；局部图钉液化属 v2 尚未提供。`,
                params
            });
            return { ...failure, availableStyles: WARP_STYLES } as ToolFailureResult & { availableStyles: string[] };
        }

        const value = Math.max(-100, Math.min(100, Number(params.value ?? 30)));
        const preserveOriginal = params.preserveOriginal !== false;

        const base = params.layerId ? findLayerById(doc, params.layerId) : doc.activeLayers?.[0];
        if (!base) {
            return createToolFailureResult({ toolName: this.name, error: '未找到要变形的图层', params });
        }

        let workId = Number(base.id);
        let workName = base.name;
        let createdDuplicate = false;

        try {
            await executeAsModal(async () => {
                if (preserveOriginal) {
                    const duplicated = await base.duplicate();
                    workId = Number(duplicated.id);
                    workName = duplicated.name;
                    createdDuplicate = true;
                }

                // 选中目标层
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: workId }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 应用 Free Transform Warp（结构沿用 warp-explorer 已验证描述符）
                await action.batchPlay([{
                    _obj: 'transform',
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                    warp: {
                        _obj: 'warp',
                        warpStyle: { _enum: 'warpStyle', _value: style },
                        warpValue: value,
                        warpPerspective: 0,
                        warpPerspectiveOther: 0,
                        warpRotate: { _enum: 'orientation', _value: 'horizontal' }
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                const out = findLayerById(doc, workId) || doc.activeLayers?.[0];
                if (out) {
                    if (params.resultLayerName) out.name = params.resultLayerName;
                    workId = Number(out.id);
                    workName = out.name;
                }
            }, { commandName: '应用图层预设变形' });

            return JSON.stringify({
                success: true,
                style,
                value,
                outputLayerId: workId,
                outputLayerName: workName,
                preservedOriginal: preserveOriginal
            });
        } catch (error: any) {
            if (createdDuplicate) {
                try {
                    await executeAsModal(async () => {
                        await action.batchPlay([{
                            _obj: 'delete',
                            _target: [{ _ref: 'layer', _id: workId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });
                    }, { commandName: '清理变形失败的副本' });
                } catch {
                    // ignore cleanup failure
                }
            }
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

export default WarpLayerTool;
