/**
 * 中性灰减淡加深图层工具（修图基础能力）
 *
 * addDodgeBurnLayer: 新建一个「中性灰」图层——50% 灰填充 + 中性色混合模式（默认 Soft Light）。
 * 这是人像/产品精修的经典「中性灰减淡加深」技法：在该层上用白色柔边画笔涂抹=减淡(提亮)、
 * 黑色=加深(压暗)，非破坏性地重塑光影，原图层不动。
 *
 * 实现说明：用一条 batchPlay `make layer` 同时指定 mode + fillNeutral:true，
 * 等价于 PS「新建图层」对话框勾选「填充 Soft-Light 中性色(50% 灰)」——中性色在该混合模式下不可见，
 * 只有涂抹处才提亮/压暗。fillNeutral 仅在有中性色的混合模式(softLight/overlay 等)下有效，故对 blendMode 做白名单。
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult, ToolFailureResult } from '../../core/tool-error-normalizer';

const photoshop = require('photoshop');
const { app, action } = photoshop;
const { executeAsModal } = photoshop.core;

// 只有「有中性色」的混合模式，fillNeutral 填 50% 灰才不可见、可减淡加深
const NEUTRAL_BLEND_MODES = ['softLight', 'overlay', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'linearDodge'];

export class AddDodgeBurnLayerTool implements Tool {
    name = 'addDodgeBurnLayer';

    schema: ToolSchema = {
        name: 'addDodgeBurnLayer',
        description: '新建一个「中性灰」减淡加深图层：50% 灰填充 + Soft Light（默认）混合模式，用于非破坏性地提亮/压暗、重塑光影（人像/产品精修的中性灰技法）。建好后在该层上用白色柔边画笔涂抹=减淡(提亮)，黑色=加深(压暗)。原图层不受影响。',
        parameters: {
            type: 'object',
            properties: {
                blendMode: {
                    type: 'string',
                    description: '中性色混合模式，默认 softLight；overlay 对比更强。只能用有中性色的模式。'
                },
                layerName: {
                    type: 'string',
                    description: '图层名，默认「中性灰」。'
                }
            },
            required: []
        }
    };

    async execute(params: { blendMode?: string; layerName?: string }): Promise<string | ToolFailureResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法新建中性灰图层', params });
        }

        const mode = String(params.blendMode || 'softLight').trim();
        if (!NEUTRAL_BLEND_MODES.includes(mode)) {
            const failure = createToolFailureResult({
                toolName: this.name,
                error: `中性灰只能用「中性色」混合模式（当前=${params.blendMode}）：softLight/overlay 等在 50% 灰下不可见、可减淡加深；normal/multiply 等没有中性色，会盖住画面。`,
                params
            });
            return { ...failure, availableModes: NEUTRAL_BLEND_MODES } as ToolFailureResult & { availableModes: string[] };
        }

        const layerName = String(params.layerName || '中性灰').trim() || '中性灰';

        try {
            let newLayerId: number | undefined;
            await executeAsModal(async () => {
                // 一步建好：新建图层 + 中性色混合模式 + fillNeutral 填 50% 灰
                await action.batchPlay([{
                    _obj: 'make',
                    _target: [{ _ref: 'layer' }],
                    using: {
                        _obj: 'layer',
                        name: layerName,
                        mode: { _enum: 'blendMode', _value: mode },
                        fillNeutral: true
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                const created = doc.activeLayers?.[0];
                if (created) newLayerId = Number(created.id);
            }, { commandName: '新建中性灰减淡加深图层' });

            return JSON.stringify({
                success: true,
                layerName,
                blendMode: mode,
                layerId: newLayerId,
                usage: '已建好 50% 灰中性图层。用白色柔边低不透明度画笔在此层涂抹=减淡(提亮)，黑色=加深(压暗)；来回叠涂逐步塑形。'
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

export default AddDodgeBurnLayerTool;
