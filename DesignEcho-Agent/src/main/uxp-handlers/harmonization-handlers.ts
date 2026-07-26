/**
 * 协调服务 UXP 处理器
 * 
 * 处理来自 UXP 插件的协调请求
 */

import { getHarmonizationService, HarmonizationParams } from '../services/harmonization-service';
import type { UXPContext } from './types';

/**
 * 注册协调相关 UXP 处理器
 */
export function registerHarmonizationUXPHandlers(context: UXPContext): void {
    const { wsServer } = context;
    
    if (!wsServer) {
        console.log('[Harmonization UXP] WebSocket 未连接，跳过注册');
        return;
    }
    
    console.log('[Harmonization UXP] 注册协调 handlers...');
    
    // 协调请求处理
    wsServer.registerHandler('harmonize', async (params: HarmonizationParams) => {
        console.log('[Harmonization UXP] 收到协调请求');
        
        try {
            const service = getHarmonizationService();
            const result = await service.harmonize(params);
            
            if (result.success) {
                console.log(`[Harmonization UXP] ✅ 协调成功，耗时: ${result.processingTime}ms`);
            } else {
                console.log(`[Harmonization UXP] ❌ 协调失败: ${result.error}`);
            }
            
            return result;
            
        } catch (error: any) {
            console.error('[Harmonization UXP] 错误:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    });
    
    // 获取协调服务状态
    wsServer.registerHandler('harmonization:getStatus', async () => {
        try {
            const service = getHarmonizationService();
            return await service.getStatus();
        } catch (error: any) {
            return {
                initialized: false,
                aiModelAvailable: false,
                error: error.message
            };
        }
    });
    
    // 快速协调
    wsServer.registerHandler('harmonization:quick', async (params: {
        foreground: string;
        background: string;
        intensity?: number;
    }) => {
        try {
            const service = getHarmonizationService();
            return await service.harmonize({
                foreground: params.foreground,
                background: params.background,
                mode: 'balanced',
                intensity: params.intensity ?? 0.7
            });
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    });
    
    console.log('[Harmonization UXP] ✅ 协调 handlers 注册完成');
}

/**
 * 获取协调工具 Schema（用于 Agent 工具列表）
 */
export function getHarmonizationToolSchemas(): any[] {
    return [
        {
            name: 'harmonize',
            description: '将前景图像与背景协调融合，调整色调和光照使其自然融入场景',
            inputSchema: {
                type: 'object',
                properties: {
                    foreground: {
                        type: 'string',
                        description: '前景图像 Base64 (带透明通道 PNG)'
                    },
                    background: {
                        type: 'string',
                        description: '背景图像 Base64'
                    },
                    mode: {
                        type: 'string',
                        enum: ['fast', 'balanced', 'ai'],
                        description: '协调模式：fast=快速算法，balanced=平衡，ai=AI模型'
                    },
                    intensity: {
                        type: 'number',
                        description: '协调强度 0-1，默认 0.7'
                    },
                    preserveForeground: {
                        type: 'boolean',
                        description: '是否保留前景原始色调（轻度协调）'
                    }
                },
                required: ['foreground', 'background']
            }
        },
        {
            name: 'harmonize_layer',
            description: '协调 Photoshop 中的前景图层与背景融合',
            inputSchema: {
                type: 'object',
                properties: {
                    foregroundLayerId: {
                        type: 'number',
                        description: '需要协调的前景图层 ID'
                    },
                    backgroundLayerId: {
                        type: 'number',
                        description: '背景参考图层 ID（可选）'
                    },
                    intensity: {
                        type: 'number',
                        description: '协调强度 0-1'
                    },
                    mode: {
                        type: 'string',
                        enum: ['fast', 'balanced', 'ai'],
                        description: '协调模式'
                    }
                },
                required: ['foregroundLayerId']
            }
        }
    ];
}
