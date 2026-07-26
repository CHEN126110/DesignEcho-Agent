/**
 * 图像协调 IPC 处理器
 * 
 * 暴露协调服务到渲染进程和 UXP 面板
 */

import { ipcMain } from 'electron';
import { 
    getHarmonizationService, 
    HarmonizationParams,
    HarmonizationMode 
} from '../services/harmonization-service';

/**
 * 注册协调相关 IPC 处理器
 */
export function registerHarmonizationHandlers(): void {
    console.log('[HarmonizationHandlers] 注册协调 IPC handlers...');
    
    // 获取服务状态
    ipcMain.handle('harmonization:getStatus', async () => {
        try {
            const service = getHarmonizationService();
            return await service.getStatus();
        } catch (error: any) {
            console.error('[HarmonizationHandlers] getStatus 错误:', error.message);
            return {
                initialized: false,
                aiModelAvailable: false,
                supportedModes: ['fast', 'balanced'],
                error: error.message
            };
        }
    });
    
    // 执行协调
    ipcMain.handle('harmonization:harmonize', async (_event, params: HarmonizationParams) => {
        try {
            console.log('[HarmonizationHandlers] 执行协调请求');
            
            const service = getHarmonizationService();
            const result = await service.harmonize(params);
            
            if (result.success) {
                console.log(`[HarmonizationHandlers] ✅ 协调成功，耗时: ${result.processingTime}ms`);
            } else {
                console.log(`[HarmonizationHandlers] ❌ 协调失败: ${result.error}`);
            }
            
            return result;
            
        } catch (error: any) {
            console.error('[HarmonizationHandlers] harmonize 错误:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    });
    
    // 快速协调（简化接口）
    ipcMain.handle('harmonization:quickHarmonize', async (_event, params: {
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
                intensity: params.intensity ?? 0.7,
                featherRadius: 3,
                preserveForeground: false
            });
        } catch (error: any) {
            console.error('[HarmonizationHandlers] quickHarmonize 错误:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    });
    
    // 检测 AI 模型是否可用
    ipcMain.handle('harmonization:checkAIModel', async () => {
        try {
            const service = getHarmonizationService();
            const status = await service.getStatus();
            return {
                available: status.aiModelAvailable,
                supportedModes: status.supportedModes
            };
        } catch (error: any) {
            return {
                available: false,
                error: error.message
            };
        }
    });
    
    console.log('[HarmonizationHandlers] ✅ 协调 IPC handlers 注册完成');
}
