/**
 * BFL (Black Forest Labs) FLUX API IPC Handlers
 * 
 * 处理图像生成相关的 IPC 调用
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { bflService, BFLModelType, BFLGenerateOptions, BFLI2IOptions } from '../services/bfl-service';

/**
 * 注册 BFL 相关 IPC handlers
 */
export function registerBFLHandlers(): void {
    // 测试 BFL API Key
    ipcMain.handle('bfl:testApiKey', async (_event: IpcMainInvokeEvent, apiKey: string) => {
        try {
            const result = await bflService.testApiKey(apiKey);
            return result;
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    // 设置 BFL API Key
    ipcMain.handle('bfl:setApiKey', async (_event: IpcMainInvokeEvent, apiKey: string) => {
        bflService.setApiKey(apiKey);
        return { success: true };
    });

    // 检查 API Key 状态
    ipcMain.handle('bfl:hasApiKey', async () => {
        return bflService.hasApiKey();
    });

    // 文生图
    ipcMain.handle('bfl:text2image', async (
        _event: IpcMainInvokeEvent,
        model: BFLModelType,
        prompt: string,
        options?: BFLGenerateOptions
    ) => {
        try {
            console.log(`[BFL Handler] 文生图请求: ${model}, prompt: "${prompt.substring(0, 50)}..."`);
            const result = await bflService.generateText2Image(model, prompt, options);
            return { success: true, data: result };
        } catch (err: any) {
            console.error('[BFL Handler] 文生图失败:', err.message);
            return { success: false, error: err.message };
        }
    });

    // 图生图
    ipcMain.handle('bfl:image2image', async (
        _event: IpcMainInvokeEvent,
        model: BFLModelType,
        prompt: string,
        inputImage: string,
        options?: BFLI2IOptions
    ) => {
        try {
            console.log(`[BFL Handler] 图生图请求: ${model}, prompt: "${prompt.substring(0, 50)}..."`);
            const result = await bflService.generateImage2Image(model, prompt, inputImage, options);
            return { success: true, data: result };
        } catch (err: any) {
            console.error('[BFL Handler] 图生图失败:', err.message);
            return { success: false, error: err.message };
        }
    });

    // 局部重绘
    ipcMain.handle('bfl:inpaint', async (
        _event: IpcMainInvokeEvent,
        prompt: string,
        inputImage: string,
        maskImage: string,
        options?: BFLGenerateOptions
    ) => {
        try {
            console.log(`[BFL Handler] 局部重绘请求: prompt: "${prompt.substring(0, 50)}..."`);
            const result = await bflService.inpaint(prompt, inputImage, maskImage, options);
            return { success: true, data: result };
        } catch (err: any) {
            console.error('[BFL Handler] 局部重绘失败:', err.message);
            return { success: false, error: err.message };
        }
    });

    // 下载图像
    ipcMain.handle('bfl:downloadImage', async (
        _event: IpcMainInvokeEvent,
        url: string
    ) => {
        try {
            const buffer = await bflService.downloadImage(url);
            return { success: true, data: buffer.toString('base64') };
        } catch (err: any) {
            console.error('[BFL Handler] 下载失败:', err.message);
            return { success: false, error: err.message };
        }
    });

    // 批量生成
    ipcMain.handle('bfl:batchGenerate', async (
        _event: IpcMainInvokeEvent,
        model: BFLModelType,
        prompts: string[],
        options?: BFLGenerateOptions
    ) => {
        try {
            console.log(`[BFL Handler] 批量生成请求: ${prompts.length} 个提示词`);
            const results = await bflService.generateBatch(model, prompts, options);
            
            const successResults = results.filter(r => !(r instanceof Error));
            const errorResults = results.filter(r => r instanceof Error);
            
            return { 
                success: errorResults.length === 0, 
                data: successResults,
                errors: errorResults.map((e: any) => e.message)
            };
        } catch (err: any) {
            console.error('[BFL Handler] 批量生成失败:', err.message);
            return { success: false, error: err.message };
        }
    });

    console.log('[BFL Handlers] 已注册 7 个 IPC handlers');
}
