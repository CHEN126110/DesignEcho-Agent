/**
 * 移动图层工具
 */

import { Tool, ToolSchema } from '../types';
import { diagnosePhotoshopState, wrapError } from '../../core/error-handler';
import { createToolFailureResult, normalizePhotoshopToolError } from '../../core/tool-error-normalizer';

const app = require('photoshop').app;
const { core } = require('photoshop');

export class MoveLayerTool implements Tool {
    name = 'moveLayer';

    schema: ToolSchema = {
        name: 'moveLayer',
        description: '移动图层（带智能检查）。会自动检测移动后图层是否超出画布、可见比例等，并给出修复建议。返回的 checks 对象包含 visibilityPercent（可见比例%）、suggestedFix（修复建议）等信息。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则移动当前选中的图层'
                },
                x: {
                    type: 'number',
                    description: 'X 轴目标位置或偏移量 (px)，不提供时保持当前位置'
                },
                y: {
                    type: 'number',
                    description: 'Y 轴目标位置或偏移量 (px)，不提供时保持当前位置'
                },
                relative: {
                    type: 'boolean',
                    description: '是否为相对移动（偏移），默认 false（绝对位置）'
                }
            },
            required: []  // x, y 都是可选的，不提供时保持原位置
        }
    };

    async execute(params: {
        layerId?: number;
        x?: number;
        y?: number;
        relative?: boolean;
    }): Promise<{
        success: boolean;
        layerId?: number;
        previousPosition?: { x: number; y: number };
        newPosition?: { x: number; y: number };
        error?: string;
        errorDetails?: any;
        // 新增：智能检查结果
        checks?: {
            isOutOfBounds: boolean;      // 是否超出画布
            isPartiallyVisible: boolean; // 是否部分可见
            visibilityPercent: number;   // 可见比例 0-100
            overflowDirection?: string;  // 超出方向
            suggestedFix?: string;       // 建议修复方式
        };
        method?: 'domTranslate';
        layerBounds?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
        canvasBounds?: { width: number; height: number };
    }> {
        console.log('[MoveLayer] 开始执行, 参数:', JSON.stringify(params));
        
        try {
            // 先诊断当前状态
            const diagnosis = await diagnosePhotoshopState();
            console.log('[MoveLayer] Photoshop 状态:', JSON.stringify(diagnosis, null, 2));
            
            if (!diagnosis.hasDocument) {
                const failure = createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
                return {
                    ...failure,
                    errorDetails: {
                        ...failure.errorDetails,
                        diagnosis
                    }
                };
            }

            const doc = app.activeDocument;
            if (!doc) {
                const failure = createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
                return {
                    ...failure,
                    errorDetails: {
                        ...failure.errorDetails,
                        diagnosis
                    }
                };
            }
            
            let layer;
            
            if (params.layerId) {
                // 确保 layerId 是数字类型
                const numericId = typeof params.layerId === 'string' 
                    ? parseInt(params.layerId, 10) 
                    : params.layerId;
                layer = this.findLayerById(doc, numericId);
                if (!layer) {
                    console.error(`[MoveLayer] 未找到图层 ID: ${numericId}`);
                    // 列出所有可用图层 ID 帮助调试
                    const allLayerIds = this.getAllLayerIds(doc);
                    console.error(`[MoveLayer] 可用图层 IDs:`, allLayerIds);
                    const failure = createToolFailureResult({ toolName: this.name, error: `未找到图层 ID: ${params.layerId}`, params });
                    return {
                        ...failure,
                        errorDetails: {
                            ...failure.errorDetails,
                            requestedLayerId: params.layerId,
                            availableLayerIds: allLayerIds
                        }
                    };
                }
            } else {
                const activeLayers = doc.activeLayers;
                if (!activeLayers || activeLayers.length === 0) {
                    const failure = createToolFailureResult({ toolName: this.name, error: '请先选中一个图层', params });
                    return {
                        ...failure,
                        errorDetails: {
                            ...failure.errorDetails,
                            diagnosis
                        }
                    };
                }
                layer = activeLayers[0];
            }

            console.log(`[MoveLayer] 目标图层: ID=${layer.id}, Name="${layer.name}", Kind=${layer.kind}, Locked=${layer.locked}`);

            // 检查图层是否锁定
            if (layer.locked) {
                const failure = createToolFailureResult({ toolName: this.name, error: `图层 "${layer.name}" 已锁定，无法移动`, params });
                return {
                    ...failure,
                    errorDetails: {
                        ...failure.errorDetails,
                        locked: true,
                        layerId: layer.id,
                        layerName: layer.name
                    }
                };
            }

            // 检查是否是背景图层
            if (layer.isBackgroundLayer) {
                const failure = createToolFailureResult({ toolName: this.name, error: `背景图层无法移动，请先将其转换为普通图层`, params });
                return {
                    ...failure,
                    errorDetails: {
                        ...failure.errorDetails,
                        isBackgroundLayer: true
                    }
                };
            }

            const bounds = layer.bounds;
            const previousPosition = {
                x: bounds.left,
                y: bounds.top
            };
            
            console.log('[MoveLayer] 当前位置:', previousPosition);

            let deltaX = 0;
            let deltaY = 0;

            if (params.relative) {
                deltaX = params.x ?? 0;
                deltaY = params.y ?? 0;
            } else {
                const targetX = params.x ?? bounds.left;
                const targetY = params.y ?? bounds.top;
                deltaX = targetX - bounds.left;
                deltaY = targetY - bounds.top;
            }
            
            console.log('[MoveLayer] 目标移动偏移:', { deltaX, deltaY });

            if (deltaX === 0 && deltaY === 0) {
                console.log('[MoveLayer] 无需移动 (偏移为0)');
                return {
                    success: true,
                    layerId: layer.id,
                    previousPosition,
                    newPosition: previousPosition
                };
            }

            let moveError: any = null;

            // 使用 UXP DOM translate，避免 Photoshop 原生 move 命令在不可用状态下弹出阻塞窗口。
            await core.executeAsModal(async () => {
                try {
                    console.log('[MoveLayer] 执行 layer.translate:', { deltaX, deltaY });
                    await this.translateLayer(layer, deltaX, deltaY);
                    console.log('[MoveLayer] layer.translate 完成');
                } catch (err: any) {
                    console.error('[MoveLayer] layer.translate 失败:', err);
                    moveError = err;
                }
            }, { commandName: 'DesignEcho: 移动图层' });

            if (moveError) {
                const wrappedError = wrapError(moveError, 'moveLayer', params);
                const normalized = normalizePhotoshopToolError({ toolName: this.name, error: moveError });
                console.error('[MoveLayer] 错误详情:', JSON.stringify(wrappedError, null, 2));
                return {
                    success: false,
                    layerId: layer.id,
                    previousPosition,
                    error: normalized.userMessage,
                    errorDetails: {
                        ...wrappedError,
                        normalized
                    }
                };
            }

            // 重新获取位置
            const movedLayer = this.findLayerById(doc, layer.id) || layer;
            const newBounds = movedLayer.bounds;
            const newPosition = {
                x: newBounds.left,
                y: newBounds.top
            };
            
            console.log('[MoveLayer] 移动完成, 新位置:', newPosition);

            // ========== 智能检查：图层是否超出画布 ==========
            const canvasWidth = doc.width;
            const canvasHeight = doc.height;
            
            const layerBounds = {
                left: newBounds.left,
                top: newBounds.top,
                right: newBounds.right,
                bottom: newBounds.bottom,
                width: newBounds.right - newBounds.left,
                height: newBounds.bottom - newBounds.top
            };
            
            const canvasBounds = { width: canvasWidth, height: canvasHeight };
            
            // 计算可见区域
            const visibleLeft = Math.max(0, newBounds.left);
            const visibleTop = Math.max(0, newBounds.top);
            const visibleRight = Math.min(canvasWidth, newBounds.right);
            const visibleBottom = Math.min(canvasHeight, newBounds.bottom);
            
            const visibleWidth = Math.max(0, visibleRight - visibleLeft);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            const visibleArea = visibleWidth * visibleHeight;
            const totalArea = layerBounds.width * layerBounds.height;
            const visibilityPercent = totalArea > 0 ? Math.round((visibleArea / totalArea) * 100) : 0;
            
            // 检查是否超出
            const overflows: string[] = [];
            if (newBounds.left < 0) overflows.push('左侧');
            if (newBounds.top < 0) overflows.push('上方');
            if (newBounds.right > canvasWidth) overflows.push('右侧');
            if (newBounds.bottom > canvasHeight) overflows.push('下方');
            
            const isOutOfBounds = overflows.length > 0;
            const isPartiallyVisible = isOutOfBounds && visibilityPercent > 0 && visibilityPercent < 100;
            
            // 生成建议
            let suggestedFix = '';
            if (visibilityPercent === 0) {
                suggestedFix = '⚠️ 图层完全在画布外，用户看不到！建议将图层移回画布内。';
            } else if (visibilityPercent < 50) {
                suggestedFix = `⚠️ 图层只有 ${visibilityPercent}% 可见，大部分内容被裁剪。建议调整位置。`;
            } else if (isOutOfBounds) {
                suggestedFix = `提示：图层${overflows.join('、')}超出画布，${100 - visibilityPercent}% 内容被裁剪。`;
            }

            return {
                success: true,
                layerId: layer.id,
                previousPosition,
                newPosition,
                // 返回检查结果
                checks: {
                    isOutOfBounds,
                    isPartiallyVisible,
                    visibilityPercent,
                    overflowDirection: overflows.length > 0 ? overflows.join('、') : undefined,
                    suggestedFix: suggestedFix || undefined
                },
                method: 'domTranslate',
                layerBounds,
                canvasBounds
            };

        } catch (error: any) {
            console.error('[MoveLayer] 捕获异常:', error);
            
            const wrappedError = wrapError(error, 'moveLayer', params);
            const normalized = normalizePhotoshopToolError({ toolName: this.name, error });
            console.error('[MoveLayer] 错误详情:', JSON.stringify(wrappedError, null, 2));
            
            return {
                success: false,
                error: normalized.userMessage,
                errorDetails: {
                    ...wrappedError,
                    normalized
                }
            };
        }
    }

    private async translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
        if (typeof layer?.translate !== 'function') {
            throw new Error('当前图层对象不支持 translate，已拒绝调用 Photoshop 原生 move 命令以避免弹窗。');
        }
        await Promise.resolve(layer.translate(offsetX, offsetY));
    }
    
    private getAllLayerIds(container: any): number[] {
        const ids: number[] = [];
        for (const layer of container.layers) {
            ids.push(layer.id);
            if (layer.layers) {
                ids.push(...this.getAllLayerIds(layer));
            }
        }
        return ids;
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
