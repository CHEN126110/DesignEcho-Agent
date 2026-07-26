/**
 * 智能布局 IPC Handlers
 * 
 * 暴露 SmartLayoutService 给渲染进程和 AI Agent
 */

import { ipcMain } from 'electron';
import { 
    SmartLayoutService, 
    getSmartLayoutService,
    BoundingBox,
    ImageSize,
    LayerContext,
    SmartScaleConfig,
    SubjectDetectionMode
} from '../services/smart-layout-service';
import { MattingService } from '../services/matting-service';

// 单例服务
let smartLayoutService: SmartLayoutService | null = null;
let mattingService: MattingService | null = null;

/**
 * 获取 SmartLayoutService 实例
 */
function getService(): SmartLayoutService {
    if (!smartLayoutService) {
        // 如果 mattingService 已存在，复用它
        smartLayoutService = getSmartLayoutService(mattingService || undefined);
    }
    return smartLayoutService;
}

/**
 * 设置 MattingService 实例（由外部注入）
 */
export function setMattingService(service: MattingService): void {
    mattingService = service;
    // 重新创建 SmartLayoutService 以使用新的 MattingService
    smartLayoutService = new SmartLayoutService(service);
}

/**
 * 注册智能布局相关的 IPC handlers
 */
export function registerSmartLayoutHandlers(): void {
    console.log('[SmartLayoutHandlers] 注册智能布局 IPC handlers...');

    // ==================== 主体检测 ====================

    /**
     * 检测图像主体边界
     */
    ipcMain.handle('smartLayout:detectSubject', async (_event, params: {
        imageData: string;  // Base64
        imageSize: ImageSize;
        layerContext?: LayerContext;
    }) => {
        try {
            const service = getService();
            const result = await service.detectSubject(
                params.imageData,
                params.imageSize,
                params.layerContext
            );
            return result;
        } catch (error: any) {
            console.error('[SmartLayoutHandlers] detectSubject 错误:', error.message);
            return {
                success: false,
                bounds: { x: 0, y: 0, width: params.imageSize.width, height: params.imageSize.height },
                mode: SubjectDetectionMode.CANVAS,
                usedFallback: true,
                error: error.message
            };
        }
    });

    // ==================== 智能缩放计算 ====================

    /**
     * 计算智能缩放和定位
     */
    ipcMain.handle('smartLayout:calculateScale', async (_event, params: {
        subjectBounds: BoundingBox;
        sourceImageSize: ImageSize;
        targetArea: BoundingBox;
        config?: SmartScaleConfig;
    }) => {
        try {
            const service = getService();
            const result = service.calculateSmartScale(
                params.subjectBounds,
                params.sourceImageSize,
                params.targetArea,
                params.config
            );
            return {
                success: true,
                ...result
            };
        } catch (error: any) {
            console.error('[SmartLayoutHandlers] calculateScale 错误:', error.message);
            return {
                success: false,
                scale: 1,
                position: { x: 0, y: 0 },
                error: error.message
            };
        }
    });

    // ==================== 一站式智能布局 ====================

    /**
     * 一站式智能布局：检测主体 + 计算缩放定位
     */
    ipcMain.handle('smartLayout:layout', async (_event, params: {
        imageData: string;  // Base64
        imageSize: ImageSize;
        targetArea: BoundingBox;
        layerContext?: LayerContext;
        config?: SmartScaleConfig;
    }) => {
        try {
            const service = getService();
            const result = await service.smartLayout(
                params.imageData,
                params.imageSize,
                params.targetArea,
                {
                    layerContext: params.layerContext,
                    config: params.config
                }
            );
            return result;
        } catch (error: any) {
            console.error('[SmartLayoutHandlers] layout 错误:', error.message);
            return {
                success: false,
                scale: 1,
                position: { x: 0, y: 0 },
                subjectBounds: { x: 0, y: 0, width: params.imageSize.width, height: params.imageSize.height },
                mode: SubjectDetectionMode.CANVAS,
                usedFallback: true,
                error: error.message
            };
        }
    });

    // ==================== 批量智能布局 ====================

    /**
     * 批量智能布局（多张图片）
     * 简化版：直接调用服务层的批量处理方法
     */
    ipcMain.handle('smartLayout:batchLayout', async (_event, params: {
        items: Array<{
            imageData: string;
            imageSize: ImageSize;
            targetArea: BoundingBox;
            layerContext?: LayerContext;
        }>;
        config?: SmartScaleConfig;
    }) => {
        try {
            const service = getService();
            return await service.batchSmartLayout(params.items, params.config);
        } catch (error: any) {
            console.error('[SmartLayoutHandlers] batchLayout 错误:', error.message);
            return {
                success: false,
                results: [],
                totalCount: 0,
                successCount: 0,
                error: error.message
            };
        }
    });

    // ==================== 服务状态 ====================

    /**
     * 获取服务状态
     */
    ipcMain.handle('smartLayout:getStatus', async () => {
        try {
            const service = getService();
            return {
                success: true,
                status: service.getStatus()
            };
        } catch (error: any) {
            return {
                success: false,
                status: { initialized: false, mattingAvailable: false },
                error: error.message
            };
        }
    });

    // ==================== GPU 状态 ====================

    /**
     * 获取 GPU 加速状态
     */
    ipcMain.handle('smartLayout:getGPUStatus', async () => {
        try {
            if (!mattingService) {
                return {
                    success: false,
                    error: 'MattingService 未初始化'
                };
            }
            
            return {
                success: true,
                gpuStatus: mattingService.getGPUStatus()
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * 设置 GPU 模式
     */
    ipcMain.handle('smartLayout:setGPUMode', async (_event, mode: 'auto' | 'cuda' | 'directml' | 'cpu') => {
        try {
            if (!mattingService) {
                return {
                    success: false,
                    error: 'MattingService 未初始化'
                };
            }
            
            const gpuStatus = await mattingService.setGPUMode(mode);
            
            return {
                success: true,
                gpuStatus
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    });

    console.log('[SmartLayoutHandlers] ✅ 智能布局 IPC handlers 注册完成');
}
