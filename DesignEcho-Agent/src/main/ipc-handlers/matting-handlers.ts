/**
 * 抠图服务相关 IPC Handlers
 */

import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { IPCContext } from './types';

/**
 * 注册抠图服务相关 IPC handlers
 */
export function registerMattingHandlers(context: IPCContext): void {
    const { mattingService, logService } = context;

    // 启用抠图服务（兼容旧 API）
    ipcMain.handle('python:enable', async () => {
        if (!mattingService) {
            logService?.logAgent('error', '[Matting] MattingService 未初始化');
            return false;
        }
        logService?.logAgent('info', '[Matting] 正在初始化本地抠图服务...');
        try {
            const result = await mattingService.reinitializePythonBackend();
            logService?.logAgent('info', `[Matting] 抠图服务初始化${result ? '成功' : '失败'}`);
            return result;
        } catch (error: any) {
            logService?.logAgent('error', `[Matting] 初始化失败: ${error.message}`);
            return false;
        }
    });

    // 禁用抠图服务（本地 ONNX 模式无实际操作）
    ipcMain.handle('python:disable', async () => {
        logService?.logAgent('info', '[Matting] 本地 ONNX 模式无需禁用');
    });

    // 获取抠图服务状态
    ipcMain.handle('python:status', async () => {
        if (!mattingService) {
            return { available: false, gpu: null, models: [] };
        }
        return await mattingService.getPythonBackendStatus();
    });

    // 获取抠图服务状态
    ipcMain.handle('matting:status', async () => {
        if (!mattingService) {
            return { initialized: false, available: false, error: 'MattingService 未初始化' };
        }
        return await mattingService.getPythonBackendStatus();
    });

    // 获取模型状态
    ipcMain.handle('matting:getModelsStatus', async () => {
        if (!mattingService) {
            return { available: false, models: [] };
        }
        return await mattingService.getPythonBackendStatus();
    });

    // 移除背景
    ipcMain.handle('matting:removeBackground', async (_event, imageBase64: string, options?: any) => {
        if (!mattingService) {
            throw new Error('抠图服务未初始化');
        }
        return await mattingService.removeBackground(imageBase64, options);
    });

    // 获取可用模型列表
    ipcMain.handle('matting:models', async () => {
        if (!mattingService) {
            return [];
        }
        const status = await mattingService.getPythonBackendStatus();
        return status.models || [];
    });

    // 扫描本地模型目录，返回详细信息
    ipcMain.handle('matting:scanLocalModels', async () => {
        const modelsDir = path.join(app.getPath('userData'), 'models');
        const result: { 
            modelsDir: string;
            models: Array<{
                name: string;
                fileName: string;
                size: number;
                sizeFormatted: string;
            }>;
        } = {
            modelsDir,
            models: []
        };
        
        if (!fs.existsSync(modelsDir)) {
            return result;
        }
        
        const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const modelPath = path.join(modelsDir, entry.name);
                const files = fs.readdirSync(modelPath);
                const onnxFile = files.find((f: string) => f.endsWith('.onnx'));
                if (onnxFile) {
                    const filePath = path.join(modelPath, onnxFile);
                    const stats = fs.statSync(filePath);
                    const sizeMB = stats.size / (1024 * 1024);
                    result.models.push({
                        name: entry.name,
                        fileName: onnxFile,
                        size: stats.size,
                        sizeFormatted: sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(stats.size / 1024).toFixed(0)} KB`
                    });
                }
            } else if (entry.name.endsWith('.onnx')) {
                const filePath = path.join(modelsDir, entry.name);
                const stats = fs.statSync(filePath);
                const sizeMB = stats.size / (1024 * 1024);
                result.models.push({
                    name: entry.name.replace('.onnx', ''),
                    fileName: entry.name,
                    size: stats.size,
                    sizeFormatted: sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(stats.size / 1024).toFixed(0)} KB`
                });
            }
        }
        
        console.log(`[Model Scan] 发现 ${result.models.length} 个本地模型:`, result.models.map(m => m.name).join(', '));
        return result;
    });
}
