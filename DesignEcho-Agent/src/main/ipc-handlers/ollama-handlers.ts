/**
 * Ollama 模型管理相关 IPC Handlers
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { IPCContext } from './types';

/**
 * 注册 Ollama 相关 IPC handlers
 */
export function registerOllamaHandlers(context: IPCContext): void {
    const { logService } = context;

    // 下载 Ollama 模型（流式 API）
    ipcMain.handle('ollama:pull', async (event: IpcMainInvokeEvent, modelName: string) => {
        try {
            logService?.logAgent('info', `开始下载 Ollama 模型: ${modelName}`);
            
            const response = await fetch('http://localhost:11434/api/pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName, stream: true })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama 返回错误: ${response.status} - ${errorText}`);
            }
            
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('无法读取响应流');
            }
            
            const decoder = new TextDecoder();
            let lastProgress = 0;
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const text = decoder.decode(value, { stream: true });
                const lines = text.split('\n').filter(l => l.trim());
                
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.total && data.completed) {
                            const progress = Math.round((data.completed / data.total) * 100);
                            if (progress !== lastProgress) {
                                lastProgress = progress;
                                event.sender.send('ollama:pullProgress', {
                                    modelName,
                                    progress,
                                    status: data.status || 'downloading'
                                });
                            }
                        } else if (data.status) {
                            event.sender.send('ollama:pullProgress', {
                                modelName,
                                progress: lastProgress,
                                status: data.status
                            });
                        }
                    } catch {
                        // 忽略解析错误
                    }
                }
            }
            
            logService?.logAgent('info', `Ollama 模型下载完成: ${modelName}`);
            return { success: true, status: 'success' };
        } catch (error: any) {
            logService?.logAgent('error', `Ollama 模型下载失败: ${error.message}`);
            
            if (error.message?.includes('fetch') || error.message?.includes('ECONNREFUSED')) {
                return { success: false, error: 'Ollama 服务未运行，请先启动 Ollama' };
            }
            return { success: false, error: error.message };
        }
    });
    
    // 在终端中下载 Ollama 模型
    ipcMain.handle('ollama:pullInTerminal', async (_event: IpcMainInvokeEvent, modelName: string) => {
        const { spawn } = await import('child_process');
        
        try {
            const child = spawn('powershell', [
                '-NoExit',
                '-Command',
                `Write-Host '正在下载模型 ${modelName}，请等待...' -ForegroundColor Cyan; ollama pull ${modelName}; Write-Host '下载完成！可以关闭此窗口。' -ForegroundColor Green; Read-Host '按 Enter 关闭'`
            ], {
                detached: true,
                stdio: 'ignore',
                shell: true
            });
            
            child.unref();
            
            return { success: true, message: '已在新终端中开始下载' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    // 获取 Ollama 模型列表
    ipcMain.handle('ollama:list', async () => {
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            return { success: true, models: data.models || [] };
        } catch (error: any) {
            return { success: false, error: error.message, models: [] };
        }
    });
    
    // 删除 Ollama 模型
    ipcMain.handle('ollama:delete', async (_event: IpcMainInvokeEvent, modelName: string) => {
        try {
            const response = await fetch('http://localhost:11434/api/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
}
