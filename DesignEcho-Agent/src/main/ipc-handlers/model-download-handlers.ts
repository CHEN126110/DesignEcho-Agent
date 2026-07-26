/**
 * 模型下载相关 IPC Handlers
 */

import { ipcMain, app, dialog, shell, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import type { IPCContext } from './types';

// GitHub 镜像列表
const GITHUB_MIRRORS = [
    'https://ghfast.top/',
    'https://gh-proxy.com/',
    'https://mirror.ghproxy.com/',
    'https://ghproxy.net/',
    'https://gh.ddlc.top/',
    'https://github.moeyy.xyz/',
    'https://hub.gitmirror.com/',
    'https://slink.ltd/',
    'https://cors.isteed.cc/',
    'https://kkgithub.com/',
    'https://dgithub.xyz/',
    '',
];

// Hugging Face 镜像列表
const HF_MIRRORS = [
    'hf-mirror.com',
    'huggingface.sukaka.top',
    'hf.xwall.us.kg',
    'huggingface-mirror.com',
    'modelscope.cn',
    '',
];

/**
 * 获取镜像 URL
 */
function getMirrorUrl(originalUrl: string, mirrorPrefix: string): string {
    if (!mirrorPrefix) return originalUrl;
    
    const domainReplaceMirrors = [
        { pattern: 'gitclone.com', replace: (url: string) => url.replace('https://github.com/', mirrorPrefix) },
        { pattern: 'kkgithub.com', replace: (url: string) => url.replace('github.com', 'kkgithub.com') },
        { pattern: 'dgithub.xyz', replace: (url: string) => url.replace('github.com', 'dgithub.xyz') },
    ];
    
    for (const mirror of domainReplaceMirrors) {
        if (mirrorPrefix.includes(mirror.pattern)) {
            return mirror.replace(originalUrl);
        }
    }
    
    if (originalUrl.includes('github.com') || originalUrl.includes('raw.githubusercontent.com')) {
        return mirrorPrefix + originalUrl;
    }
    
    return originalUrl;
}

/**
 * 获取 HuggingFace 镜像 URL
 */
function getHFMirrorUrl(originalUrl: string, mirrorHost: string): string {
    if (!mirrorHost) return originalUrl;
    return originalUrl.replace('huggingface.co', mirrorHost);
}

/**
 * 注册模型下载相关 IPC handlers
 */
export function registerModelDownloadHandlers(context: IPCContext): void {
    const { mainWindow, logService, mattingService } = context;
    const CURL_PATH = 'C:\\Windows\\System32\\curl.exe';

    // 下载模型
    ipcMain.handle('model:download', async (
        _event: IpcMainInvokeEvent, 
        modelId: string, 
        downloadUrl: string, 
        targetPath: string, 
        fallbackUrls?: string[]
    ) => {
        const modelsDir = path.join(app.getPath('userData'), 'models');
        const fullTargetPath = path.join(modelsDir, targetPath);
        const targetDir = path.dirname(fullTargetPath);
        
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // 检查是否已存在
        if (fs.existsSync(fullTargetPath)) {
            const existingStats = fs.statSync(fullTargetPath);
            if (existingStats.size > 1000000) {
                logService?.logAgent('info', `[Download] 模型已存在: ${modelId}`);
                mainWindow?.webContents.send('model:download-progress', { modelId, percent: 100 });
                return { success: true, modelId, path: fullTargetPath, size: existingStats.size, skipped: true };
            }
            fs.unlinkSync(fullTargetPath);
        }
        
        logService?.logAgent('info', `[Download] 开始下载模型: ${modelId}`);
        mainWindow?.webContents.send('model:download-progress', { modelId, percent: 0, status: 'starting' });
        
        const isHuggingFace = downloadUrl.includes('huggingface.co');
        const mirrors = isHuggingFace ? HF_MIRRORS : GITHUB_MIRRORS;
        
        const tryDownloadWithMirror = async (mirrorIndex: number): Promise<any> => {
            if (mirrorIndex >= mirrors.length) {
                return { 
                    success: false, 
                    error: '所有下载源均失败',
                    suggestion: '您可以手动下载模型文件到：' + fullTargetPath
                };
            }
            
            const mirror = mirrors[mirrorIndex];
            const actualUrl = isHuggingFace 
                ? getHFMirrorUrl(downloadUrl, mirror)
                : getMirrorUrl(downloadUrl, mirror);
            const mirrorName = mirror ? `镜像 ${mirrorIndex}` : '直连';
            
            logService?.logAgent('info', `[Download] 尝试 ${mirrorName}: ${actualUrl}`);
            mainWindow?.webContents.send('model:download-progress', {
                modelId,
                percent: 0,
                status: mirror ? `尝试镜像 ${mirrorIndex}...` : '尝试直连...'
            });
            
            return new Promise((resolve) => {
                const curlArgs = [
                    '-L', '-o', fullTargetPath,
                    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    '--progress-bar', '--fail',
                    '--connect-timeout', '15',
                    '--max-time', '1800',
                    '--retry', '2',
                    '--retry-delay', '3',
                    actualUrl
                ];
                
                const curlProcess = spawn(CURL_PATH, curlArgs);
                let stderrData = '';
                let lastPercent = 0;
                let downloadStarted = false;
                
                const connectTimeout = setTimeout(() => {
                    if (!downloadStarted) {
                        logService?.logAgent('warn', `[Download] ${mirrorName} 连接超时`);
                        curlProcess.kill();
                    }
                }, 20000);
                
                curlProcess.stderr.on('data', (data: Buffer) => {
                    const output = data.toString();
                    stderrData += output;
                    
                    const percentMatch = output.match(/(\d+(?:\.\d+)?)\s*%/);
                    if (percentMatch) {
                        downloadStarted = true;
                        clearTimeout(connectTimeout);
                        
                        const percent = Math.floor(parseFloat(percentMatch[1]));
                        if (percent !== lastPercent && percent % 5 === 0) {
                            lastPercent = percent;
                            mainWindow?.webContents.send('model:download-progress', { modelId, percent });
                        }
                    }
                });
                
                curlProcess.on('close', async (code: number | null) => {
                    clearTimeout(connectTimeout);
                    
                    if (code === 0) {
                        try {
                            const stats = fs.statSync(fullTargetPath);
                            if (stats.size < 100000) {
                                const content = fs.readFileSync(fullTargetPath, 'utf8').slice(0, 500);
                                if (content.includes('<!DOCTYPE') || content.includes('<html')) {
                                    fs.unlinkSync(fullTargetPath);
                                    resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                                    return;
                                }
                            }
                            
                            logService?.logAgent('info', `[Download] ✓ 下载完成: ${modelId}`);
                            mainWindow?.webContents.send('model:download-progress', { modelId, percent: 100 });
                            resolve({ success: true, modelId, path: fullTargetPath, size: stats.size, source: mirrorName });
                        } catch {
                            resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                        }
                    } else {
                        try { fs.unlinkSync(fullTargetPath); } catch {}
                        
                        const isNetworkError = stderrData.includes('Could not resolve') || 
                                               stderrData.includes('Connection refused') ||
                                               stderrData.includes('timeout') ||
                                               code === 6 || code === 7 || code === 28;
                        
                        if (isNetworkError && mirrorIndex < mirrors.length - 1) {
                            resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                        } else {
                            resolve({ success: false, error: `下载失败 (code: ${code})`, triedMirrors: mirrorIndex + 1 });
                        }
                    }
                });
                
                curlProcess.on('error', async () => {
                    clearTimeout(connectTimeout);
                    try { fs.unlinkSync(fullTargetPath); } catch {}
                    resolve(await tryDownloadWithMirror(mirrorIndex + 1));
                });
            });
        };
        
        let result = await tryDownloadWithMirror(0);
        
        // 尝试备用链接
        if (!result.success && fallbackUrls && fallbackUrls.length > 0) {
            for (let i = 0; i < fallbackUrls.length; i++) {
                logService?.logAgent('info', `[Download] 尝试备用链接 ${i + 1}`);
                result = await tryDownloadWithMirror(0);
                if (result.success) break;
            }
        }
        
        return result;
    });
    
    // 检查模型是否存在
    ipcMain.handle('model:checkExists', async (_event: IpcMainInvokeEvent, modelPath: string) => {
        const modelsDir = path.join(app.getPath('userData'), 'models');
        const fullPath = path.join(modelsDir, modelPath);
        
        return {
            exists: fs.existsSync(fullPath),
            path: fullPath
        };
    });

    // 手动导入模型
    ipcMain.handle('model:import', async (_event: IpcMainInvokeEvent, modelId: string, targetPath: string) => {
        const targetFileName = path.basename(targetPath);
        
        try {
            const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
                title: `导入模型：${modelId} → ${targetFileName}`,
                message: `请选择 ONNX 模型文件\n文件将被保存为：${targetPath}`,
                filters: [
                    { name: 'ONNX 模型', extensions: ['onnx'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });
            
            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true };
            }
            
            const sourcePath = result.filePaths[0];
            const modelsDir = path.join(app.getPath('userData'), 'models');
            const fullTargetPath = path.join(modelsDir, targetPath);
            const targetDir = path.dirname(fullTargetPath);
            
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            logService?.logAgent('info', `[Import] 复制模型: ${sourcePath} → ${fullTargetPath}`);
            fs.copyFileSync(sourcePath, fullTargetPath);
            
            const stats = fs.statSync(fullTargetPath);
            logService?.logAgent('info', `[Import] ✓ 导入成功: ${modelId}`);
            
            return { success: true, modelId, path: fullTargetPath, size: stats.size, sourcePath };
        } catch (error: any) {
            logService?.logAgent('error', `[Import] 导入失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // 检查模型文件
    ipcMain.handle('model:checkModelFile', async (_event: IpcMainInvokeEvent, folder: string, fileName: string) => {
        const projectModelsDir = path.join(__dirname, '../../../models');
        const userModelsDir = path.join(app.getPath('userData'), 'models');
        
        const projectPath = path.join(projectModelsDir, folder, fileName);
        const userPath = path.join(userModelsDir, folder, fileName);
        
        const exists = fs.existsSync(projectPath) || fs.existsSync(userPath);
        console.log(`[Model Check] ${folder}/${fileName}: ${exists ? '✅' : '❌'}`);
        return exists;
    });

    // 下载模型到 models 目录
    ipcMain.handle('model:downloadToModels', async (
        event: IpcMainInvokeEvent, 
        url: string, 
        folder: string, 
        fileName: string, 
        progressChannel: string
    ) => {
        const modelsDir = path.join(__dirname, '../../../models');
        const targetDir = path.join(modelsDir, folder);
        const targetPath = path.join(targetDir, fileName);
        
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        console.log(`[Model Download] 开始下载: ${url}`);
        
        return new Promise((resolve, reject) => {
            const httpModule = url.startsWith('https') ? https : http;
            
            const makeRequest = (requestUrl: string, redirectCount = 0) => {
                if (redirectCount > 5) {
                    reject(new Error('重定向次数过多'));
                    return;
                }
                
                httpModule.get(requestUrl, (response) => {
                    if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            makeRequest(redirectUrl, redirectCount + 1);
                            return;
                        }
                    }
                    
                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}`));
                        return;
                    }
                    
                    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                    let downloadedSize = 0;
                    
                    const file = fs.createWriteStream(targetPath);
                    
                    response.on('data', (chunk: Buffer) => {
                        downloadedSize += chunk.length;
                        if (totalSize > 0) {
                            const progress = Math.round((downloadedSize / totalSize) * 100);
                            event.sender.send(progressChannel, progress);
                        }
                    });
                    
                    response.pipe(file);
                    
                    file.on('finish', () => {
                        file.close();
                        console.log(`[Model Download] ✅ 下载完成: ${fileName}`);
                        resolve(true);
                    });
                    
                    file.on('error', (err) => {
                        fs.unlinkSync(targetPath);
                        reject(err);
                    });
                }).on('error', (err) => {
                    reject(err);
                });
            };
            
            makeRequest(url);
        });
    });

    // 打开模型目录
    ipcMain.handle('model:openModelsFolder', async () => {
        const modelsDir = path.join(__dirname, '../../../models');
        console.log(`[Model] 打开模型目录: ${modelsDir}`);
        await shell.openPath(modelsDir);
    });
}
