/**
 * 对齐到参考形状工具
 * 
 * 合并缩放和移动操作，减少通信开销
 */

import { Tool, ToolSchema } from '../types';

const { app, core, action } = require('photoshop');

export interface AlignToReferenceParams {
    layerId: number;              // 要对齐的图层 ID
    scalePercent: number;         // 缩放百分比（如 120 表示放大到 120%）
    targetCenterX: number;        // 目标中心点 X
    targetCenterY: number;        // 目标中心点 Y
    subjectOffsetX: number;       // 主体相对图层中心的偏移 X
    subjectOffsetY: number;       // 主体相对图层中心的偏移 Y
}

export interface AlignToReferenceResult {
    success: boolean;
    error?: string;
    originalBounds?: { left: number; top: number; width: number; height: number };
    newBounds?: { left: number; top: number; width: number; height: number };
    newSubjectCenter?: { x: number; y: number };
}

export class AlignToReferenceTool implements Tool {
    name = 'alignToReference';

    schema: ToolSchema = {
        name: 'alignToReference',
        description: '将图层缩放并对齐到目标中心（合并操作，高效）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要对齐的图层 ID'
                },
                scalePercent: {
                    type: 'number',
                    description: '缩放百分比（如 120 表示放大到 120%）'
                },
                targetCenterX: {
                    type: 'number',
                    description: '目标中心点 X'
                },
                targetCenterY: {
                    type: 'number',
                    description: '目标中心点 Y'
                },
                subjectOffsetX: {
                    type: 'number',
                    description: '主体相对图层中心的偏移 X（缩放前）'
                },
                subjectOffsetY: {
                    type: 'number',
                    description: '主体相对图层中心的偏移 Y（缩放前）'
                }
            },
            required: ['layerId', 'scalePercent', 'targetCenterX', 'targetCenterY', 'subjectOffsetX', 'subjectOffsetY']
        }
    };

    async execute(params: AlignToReferenceParams): Promise<AlignToReferenceResult> {
        console.log('[AlignToReference] 开始执行, 参数:', JSON.stringify(params));
        
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const layer = this.findLayerById(doc, params.layerId);
            if (!layer) {
                return { success: false, error: `未找到图层 ID: ${params.layerId}` };
            }

            if (layer.locked) {
                return { success: false, error: `图层 "${layer.name}" 已锁定` };
            }

            // 记录原始边界
            const originalBounds = layer.boundsNoEffects || layer.bounds;
            const originalResult = {
                left: originalBounds.left,
                top: originalBounds.top,
                width: originalBounds.right - originalBounds.left,
                height: originalBounds.bottom - originalBounds.top
            };

            const originalCenter = {
                x: originalBounds.left + originalResult.width / 2,
                y: originalBounds.top + originalResult.height / 2
            };

            let newSubjectCenter = { x: 0, y: 0 };
            let newBoundsResult = { left: 0, top: 0, width: 0, height: 0 };

            await core.executeAsModal(async () => {
                // ★★★ 关键修复：必须先选中目标图层 ★★★
                try {
                    await action.batchPlay([{
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }], { synchronousExecution: true });
                    console.log(`[AlignToReference] ✓ 已选中图层: ${layer.name} (ID: ${layer.id})`);
                } catch (selectErr) {
                    console.warn('[AlignToReference] 图层选择警告:', selectErr);
                }

                const k = params.scalePercent / 100;
                
                // ===== 详细诊断日志 =====
                console.log(`[AlignToReference] ──────── 执行参数 ────────`);
                console.log(`[AlignToReference]   缩放: ${params.scalePercent.toFixed(1)}% (k=${k.toFixed(3)})`);
                console.log(`[AlignToReference]   目标中心: (${params.targetCenterX.toFixed(1)}, ${params.targetCenterY.toFixed(1)})`);
                console.log(`[AlignToReference]   主体偏移: (${params.subjectOffsetX.toFixed(1)}, ${params.subjectOffsetY.toFixed(1)})`);
                console.log(`[AlignToReference]   原始边界: (${originalBounds.left.toFixed(0)}, ${originalBounds.top.toFixed(0)}) ${originalResult.width.toFixed(0)}x${originalResult.height.toFixed(0)}`);
                
                // 步骤 1：执行缩放（如果需要）
                const needScale = Math.abs(params.scalePercent - 100) > 0.5;
                console.log(`[AlignToReference]   是否缩放: ${needScale}`);
                
                if (needScale) {
                    // ★★★ 使用 batchPlay 实现缩放（更可靠）★★★
                    try {
                        await action.batchPlay([{
                            _obj: 'transform',
                            freeTransformCenterState: {
                                _enum: 'quadCenterState',
                                _value: 'QCSAverage'
                            },
                            width: { _unit: 'percentUnit', _value: params.scalePercent },
                            height: { _unit: 'percentUnit', _value: params.scalePercent },
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });
                        console.log(`[AlignToReference] ✓ 缩放完成: ${params.scalePercent.toFixed(1)}% (使用 batchPlay)`);
                    } catch (scaleErr: any) {
                        console.error(`[AlignToReference] ✗ 缩放失败:`, scaleErr);
                        throw scaleErr;
                    }
                } else {
                    console.log(`[AlignToReference] ⊙ 跳过缩放（变化 < 0.5%）`);
                }

                // 获取缩放后的边界
                const scaledBounds = layer.boundsNoEffects || layer.bounds;
                const scaledCenter = {
                    x: scaledBounds.left + (scaledBounds.right - scaledBounds.left) / 2,
                    y: scaledBounds.top + (scaledBounds.bottom - scaledBounds.top) / 2
                };

                // 计算缩放后的主体中心
                // 主体相对图层中心的偏移按 k 缩放
                const scaledSubjectCenter = {
                    x: scaledCenter.x + params.subjectOffsetX * k,
                    y: scaledCenter.y + params.subjectOffsetY * k
                };

                // 步骤 2：计算并执行移动
                const offsetX = params.targetCenterX - scaledSubjectCenter.x;
                const offsetY = params.targetCenterY - scaledSubjectCenter.y;

                console.log(`[AlignToReference]   缩放后图层中心: (${scaledCenter.x.toFixed(1)}, ${scaledCenter.y.toFixed(1)})`);
                console.log(`[AlignToReference]   缩放后主体中心: (${scaledSubjectCenter.x.toFixed(1)}, ${scaledSubjectCenter.y.toFixed(1)})`);
                console.log(`[AlignToReference]   需要移动距离: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);

                const needMove = Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5;
                console.log(`[AlignToReference]   是否移动: ${needMove}`);

                if (needMove) {
                    try {
                        await this.translateLayer(layer, offsetX, offsetY);
                        console.log(`[AlignToReference] ✓ 移动完成: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)}) (使用 DOM translate)`);
                    } catch (moveErr: any) {
                        console.error(`[AlignToReference] ✗ 移动失败:`, moveErr);
                        throw moveErr;
                    }
                } else {
                    console.log(`[AlignToReference] ⊙ 跳过移动（距离 < 0.5px）`);
                }

                // 获取最终边界
                const finalBounds = layer.boundsNoEffects || layer.bounds;
                newBoundsResult = {
                    left: finalBounds.left,
                    top: finalBounds.top,
                    width: finalBounds.right - finalBounds.left,
                    height: finalBounds.bottom - finalBounds.top
                };

                // 计算最终主体中心
                const finalCenter = {
                    x: finalBounds.left + newBoundsResult.width / 2,
                    y: finalBounds.top + newBoundsResult.height / 2
                };
                newSubjectCenter = {
                    x: finalCenter.x + params.subjectOffsetX * k,
                    y: finalCenter.y + params.subjectOffsetY * k
                };

            }, { commandName: 'DesignEcho: 对齐到参考形状' });

            console.log(`[AlignToReference] ✓ 完成, 新主体中心: (${newSubjectCenter.x.toFixed(1)}, ${newSubjectCenter.y.toFixed(1)})`);

            return {
                success: true,
                originalBounds: originalResult,
                newBounds: newBoundsResult,
                newSubjectCenter
            };

        } catch (error: any) {
            console.error('[AlignToReference] 错误:', error);
            return { success: false, error: error.message || '对齐失败' };
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

    private async translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
        if (typeof layer?.translate !== 'function') {
            throw new Error('alignToReference failed: target layer does not support DOM translate; native move is blocked to avoid Photoshop popups.');
        }
        await Promise.resolve(layer.translate(offsetX, offsetY));
    }
}
