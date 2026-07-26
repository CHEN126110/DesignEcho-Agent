/**
 * 图像协调工具 - UXP 端
 * 
 * 用于将前景图层与背景协调融合
 *
 * 注意（2026-07-24）：这两个类**没有注册进 ToolRegistry**（registry.ts 已下架）。
 * 原因：execute() 从未真正接线——不导出图层像素字节，只发图层 ID；调用了
 * WebSocketClient 上不存在的方法；setWebSocketClient 也从未被调用，调用必败。
 * 能用的协调路径是面板 WebView 的 handleHarmonize（index.ts → sendRequest('harmonize')）。
 * 要让本工具重新上架，需要：导出前景/背景图层字节（参考 exportLayerAsBase64）→
 * sendRequest('harmonize', { foreground, background, ... }) → 把 compositeImage
 * 写回图层（参考 replaceLayerContent），再接回 wsClient 并重新注册。
 */

import { Tool, ToolSchema, ToolResult } from '../types';

const { app } = require('photoshop');

/**
 * 图层协调工具 - 将前景与背景色调协调
 */
export class HarmonizeLayerTool implements Tool {
    private wsClient: any = null;
    
    get name(): string {
        return 'harmonize_layer';
    }
    
    get schema(): ToolSchema {
        return {
            name: this.name,
            description: '将前景图层与背景协调融合，调整色调和光照使其自然融入场景',
            parameters: {
                type: 'object',
                properties: {
                    foregroundLayerId: {
                        type: 'number',
                        description: '需要协调的前景图层 ID'
                    },
                    backgroundLayerId: {
                        type: 'number',
                        description: '背景参考图层 ID（可选，默认使用下方可见图层合并）'
                    },
                    intensity: {
                        type: 'number',
                        description: '协调强度 0-1，默认 0.7'
                    },
                    mode: {
                        type: 'string',
                        enum: ['fast', 'balanced', 'ai'],
                        description: '协调模式：fast=快速算法，balanced=平衡，ai=AI模型'
                    }
                },
                required: ['foregroundLayerId']
            }
        };
    }
    
    /**
     * 设置 WebSocket 客户端
     */
    setWebSocketClient(client: any): void {
        this.wsClient = client;
    }
    
    async execute(params: {
        foregroundLayerId: number;
        backgroundLayerId?: number;
        intensity?: number;
        mode?: 'fast' | 'balanced' | 'ai';
    }): Promise<ToolResult> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return {
                    success: false,
                    error: '没有打开的文档',
                    data: null
                };
            }
            
            const intensity = params.intensity ?? 0.7;
            const mode = params.mode ?? 'balanced';
            
            // 1. 查找前景图层
            const fgLayer = doc.layers.find((l: any) => l.id === params.foregroundLayerId);
            if (!fgLayer) {
                return {
                    success: false,
                    error: `找不到图层 ID: ${params.foregroundLayerId}`,
                    data: null
                };
            }
            
            console.log(`[HarmonizeTool] 处理图层: ${fgLayer.name} (ID: ${fgLayer.id})`);
            
            // 2. 检查 WebSocket 连接
            if (!this.wsClient) {
                return {
                    success: false,
                    error: 'WebSocket 未连接，无法调用协调服务',
                    data: null
                };
            }
            
            // 3. 发送协调请求到 Agent
            // 注意：实际图层数据导出需要使用 batchPlay，这里先返回占位符
            console.log(`[HarmonizeTool] 调用协调服务，模式: ${mode}, 强度: ${intensity}`);
            
            // 由于 UXP 中图层数据导出较复杂，这里只发送请求
            // 实际实现需要先导出图层为 Base64
            const result = await this.wsClient.request('harmonize', {
                foregroundLayerId: params.foregroundLayerId,
                backgroundLayerId: params.backgroundLayerId,
                mode: mode,
                intensity: intensity
            });
            
            if (!result || !result.success) {
                return {
                    success: false,
                    error: result?.error || '协调处理失败',
                    data: null
                };
            }
            
            return {
                success: true,
                data: {
                    layerId: fgLayer.id,
                    mode: mode,
                    intensity: intensity,
                    processingTime: result.processingTime
                }
            };
            
        } catch (error: any) {
            console.error('[HarmonizeTool] 执行错误:', error);
            return {
                success: false,
                error: error.message || '未知错误',
                data: null
            };
        }
    }
}

/**
 * 快速协调工具 - 简化接口
 */
export class QuickHarmonizeTool implements Tool {
    private harmonizeTool: HarmonizeLayerTool;
    
    constructor() {
        this.harmonizeTool = new HarmonizeLayerTool();
    }
    
    get name(): string {
        return 'quick_harmonize';
    }
    
    get schema(): ToolSchema {
        return {
            name: this.name,
            description: '快速协调当前选中的图层，使其与下方背景自然融合',
            parameters: {
                type: 'object',
                properties: {
                    intensity: {
                        type: 'number',
                        description: '协调强度 0-1，默认 0.7'
                    }
                },
                required: []
            }
        };
    }
    
    setWebSocketClient(client: any): void {
        this.harmonizeTool.setWebSocketClient(client);
    }
    
    async execute(params: { intensity?: number }): Promise<ToolResult> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }
            
            const activeLayer = doc.activeLayers[0];
            if (!activeLayer) {
                return { success: false, error: '没有选中的图层', data: null };
            }
            
            return await this.harmonizeTool.execute({
                foregroundLayerId: activeLayer.id,
                intensity: params.intensity ?? 0.7,
                mode: 'balanced'
            });
            
        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }
}
