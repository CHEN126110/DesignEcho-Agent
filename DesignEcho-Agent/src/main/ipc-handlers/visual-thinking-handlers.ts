
/**
 * 视觉思维服务 IPC Handlers
 * 
 * 暴露 VisualThinkingService 的能力给渲染进程
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IPCContext } from './types';
import { VisualThinkingService } from '../services/visual-thinking-service';
import fs from 'fs';
import path from 'path';

let visualThinkingService: VisualThinkingService | null = null;

function resolveMediaTypeFromExtension(extension: string): 'image/jpeg' | 'image/png' | 'image/webp' {
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    return 'image/jpeg';
}

export function registerVisualThinkingHandlers(context: IPCContext): void {
    const { modelService, taskOrchestrator } = context;

    if (modelService) {
        visualThinkingService = new VisualThinkingService(modelService);
        // 用用户配置的 visualModel（而非硬编码）。
        const visualModelId = taskOrchestrator?.getAgentModels?.()?.vision;
        if (visualModelId) {
            visualThinkingService.setVisionModelId(visualModelId);
        }
    }

    /**
     * 每次调用前同步最新视觉模型配置。
     * 修复：原来只在注册时读取一次，用户后续修改设置不会生效。
     */
    function syncVisionModelConfig(): void {
        const currentVisionModel = taskOrchestrator?.getAgentModels?.()?.vision;
        if (currentVisionModel) {
            visualThinkingService?.setVisionModelId(currentVisionModel);
        }
    }

    /**
     * 分析本地图片文件
     * 读取文件 -> 转Base64 -> 调用视觉模型
     */
    ipcMain.handle('visual:analyzeLocalImage', async (_event: IpcMainInvokeEvent, filePath: string, hint?: string) => {
        if (!visualThinkingService) {
            return { success: false, error: 'VisualThinkingService not initialized (ModelService missing)' };
        }
        syncVisionModelConfig();

        try {
            // 1. 读取文件
            if (!fs.existsSync(filePath)) {
                return { success: false, error: `File not found: ${filePath}` };
            }

            const buffer = await fs.promises.readFile(filePath);
            // 简单的类型检测，实际应更严谨
            const ext = path.extname(filePath).toLowerCase();
            const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
            
            if (!validExts.includes(ext)) {
                return { success: false, error: 'Unsupported image format. Use JPG, PNG or WEBP.' };
            }

            const base64 = buffer.toString('base64');
            const mediaType = resolveMediaTypeFromExtension(ext);

            // 2. 调用分析
            const analysis = await visualThinkingService.analyzeGenericImage(base64, hint, mediaType);

            return { success: true, data: analysis };
        } catch (error: any) {
            console.error('[VisualHandlers] Analysis failed:', error);
            return { success: false, error: error.message };
        }
    });

    /**
     * 分析 Base64 图片
     */
    ipcMain.handle('visual:analyzeBase64Image', async (
        _event: IpcMainInvokeEvent,
        base64: string,
        hint?: string,
        mediaType?: string
    ) => {
        if (!visualThinkingService) {
            return { success: false, error: 'VisualThinkingService not initialized' };
        }

        syncVisionModelConfig();

        try {
            const analysis = await visualThinkingService.analyzeGenericImage(base64, hint, mediaType);
            return { success: true, data: analysis };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            console.error('[VisualHandlers] Base64 analysis failed:', errorMessage);
            return { success: false, error: errorMessage };
        }
    });
}
