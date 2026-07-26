/**
 * 文件系统相关 IPC Handlers
 */

import { ipcMain, dialog, shell, app, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import type { IPCContext } from './types';

const fsPromises = fs.promises;

interface FileEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    ext?: string;
}

/**
 * 递归读取目录内容
 */
async function readDirectoryRecursive(
    dirPath: string, 
    options?: { recursive?: boolean; filter?: string[] }
): Promise<FileEntry[]> {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const item: FileEntry = {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? 'directory' : 'file'
        };

        if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            item.ext = ext;
            
            if (options?.filter && !options.filter.includes(ext)) {
                continue;
            }
            
            try {
                const stats = await fsPromises.stat(fullPath);
                item.size = stats.size;
            } catch {
                // 忽略统计错误
            }
        }

        result.push(item);

        if (options?.recursive && entry.isDirectory()) {
            try {
                const subItems = await readDirectoryRecursive(fullPath, options);
                result.push(...subItems);
            } catch {
                // 忽略子目录读取错误
            }
        }
    }

    return result;
}

/**
 * 注册文件系统相关 IPC handlers
 */
export function registerFileSystemHandlers(context: IPCContext): void {
    const { mainWindow, logService } = context;

    // 选择文件夹
    ipcMain.handle('fs:selectFolder', async (_event: IpcMainInvokeEvent, title?: string) => {
        const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
            title: title || '选择项目文件夹',
            properties: ['openDirectory', 'createDirectory']
        });
        
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, path: null };
        }
        return { success: true, path: result.filePaths[0] };
    });

    // 选择文件
    ipcMain.handle('fs:selectFile', async (_event: IpcMainInvokeEvent, options?: {
        title?: string;
        filters?: { name: string; extensions: string[] }[];
    }) => {
        const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
            title: options?.title || '选择文件',
            properties: ['openFile'],
            filters: options?.filters || [
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });

    // 读取目录内容
    ipcMain.handle('fs:readDirectory', async (_event: IpcMainInvokeEvent, dirPath: string, options?: {
        recursive?: boolean;
        filter?: string[];
    }) => {
        try {
            return await readDirectoryRecursive(dirPath, options);
        } catch (error: any) {
            throw new Error(`读取目录失败: ${error.message}`);
        }
    });

    // 读取文件
    ipcMain.handle('fs:readFile', async (_event: IpcMainInvokeEvent, filePath: string, encoding?: string) => {
        try {
            if (encoding === 'base64') {
                const buffer = await fsPromises.readFile(filePath);
                return buffer.toString('base64');
            }
            return await fsPromises.readFile(filePath, { encoding: (encoding || 'utf-8') as BufferEncoding });
        } catch (error: any) {
            throw new Error(`读取文件失败: ${error.message}`);
        }
    });

    // 写入文件
    ipcMain.handle('fs:writeFile', async (_event: IpcMainInvokeEvent, filePath: string, content: string | Buffer) => {
        try {
            const dir = path.dirname(filePath);
            await fsPromises.mkdir(dir, { recursive: true });
            await fsPromises.writeFile(filePath, content);
            return true;
        } catch (error: any) {
            throw new Error(`写入文件失败: ${error.message}`);
        }
    });

    // 检查路径是否存在
    ipcMain.handle('fs:exists', async (_event: IpcMainInvokeEvent, targetPath: string) => {
        try {
            await fsPromises.access(targetPath);
            return true;
        } catch {
            return false;
        }
    });

    // 创建目录
    ipcMain.handle('fs:createDirectory', async (_event: IpcMainInvokeEvent, dirPath: string) => {
        try {
            await fsPromises.mkdir(dirPath, { recursive: true });
            return true;
        } catch (error: any) {
            if (error.code === 'EPERM') {
                throw new Error(`权限被拒绝: ${dirPath} — 请检查 Windows Defender "受控文件夹访问" 设置，或选择其他目录`);
            }
            throw new Error(`创建目录失败: ${error.message}`);
        }
    });

    // 创建目录（别名，返回对象格式）
    ipcMain.handle('fs:mkdir', async (_event: IpcMainInvokeEvent, dirPath: string) => {
        try {
            await fsPromises.mkdir(dirPath, { recursive: true });
            console.log(`[fs:mkdir] 目录创建成功: ${dirPath}`);
            return { success: true, path: dirPath };
        } catch (error: any) {
            const code = error?.code || '';
            const syscall = error?.syscall || '';
            const details = [code ? `code=${code}` : '', syscall ? `syscall=${syscall}` : '', `path=${dirPath}`]
                .filter(Boolean)
                .join(', ');
            console.error(`[fs:mkdir] 创建目录失败: ${error.message} (${details})`);
            // Windows Defender "受控文件夹访问" 会导致 EPERM
            if (error.code === 'EPERM') {
                return {
                    success: false,
                    code,
                    path: dirPath,
                    syscall,
                    details,
                    error: `权限被拒绝: ${dirPath}\n\n可能原因: Windows Defender 的"受控文件夹访问"（勒索软件防护）阻止了此操作。\n\n解决方法:\n1. 打开 Windows 安全中心 → 病毒和威胁防护 → 勒索软件防护\n2. 点击"允许应用通过受控文件夹访问"\n3. 添加 Electron 应用，或\n4. 选择一个非受保护的目录（如 D: 盘）`
                };
            }
            return {
                success: false,
                code,
                path: dirPath,
                syscall,
                details,
                error: error?.message || '创建目录失败'
            };
        }
    });

    // 复制文件
    ipcMain.handle('fs:copyFile', async (_event: IpcMainInvokeEvent, sourcePath: string, destPath: string) => {
        try {
            // 确保目标目录存在
            const destDir = path.dirname(destPath);
            await fsPromises.mkdir(destDir, { recursive: true });
            
            // 复制文件
            await fsPromises.copyFile(sourcePath, destPath);
            
            console.log(`[fs:copyFile] 文件复制成功: ${sourcePath} -> ${destPath}`);
            return { success: true, path: destPath };
        } catch (error: any) {
            console.error(`[fs:copyFile] 文件复制失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // 删除文件（用于清理临时文件）
    // 修改：使用 shell.trashItem 安全删除，避免不可逆操作
    ipcMain.handle('fs:deleteFile', async (_event: IpcMainInvokeEvent, filePath: string) => {
        try {
            if (fs.existsSync(filePath)) {
                await shell.trashItem(filePath);
                console.log(`[fs:deleteFile] 文件已移至回收站: ${filePath}`);
            }
            return { success: true };
        } catch (error: any) {
            // 文件不存在也算成功
            if (error.code === 'ENOENT') {
                return { success: true };
            }
            console.error(`[fs:deleteFile] 删除失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // 新增：移动到垃圾桶（显式语义）
    ipcMain.handle('fs:moveToTrash', async (_event: IpcMainInvokeEvent, filePath: string) => {
        try {
            if (fs.existsSync(filePath)) {
                await shell.trashItem(filePath);
                console.log(`[fs:moveToTrash] 文件已移至回收站: ${filePath}`);
            }
            return { success: true };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return { success: true };
            }
            console.error(`[fs:moveToTrash] 移动失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // 获取文件信息
    ipcMain.handle('fs:getFileInfo', async (_event: IpcMainInvokeEvent, filePath: string) => {
        try {
            const stats = await fsPromises.stat(filePath);
            return {
                name: path.basename(filePath),
                path: filePath,
                size: stats.size,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
                created: stats.birthtime,
                modified: stats.mtime,
                ext: path.extname(filePath).toLowerCase()
            };
        } catch (error: any) {
            throw new Error(`获取文件信息失败: ${error.message}`);
        }
    });

    // 打开文件/文件夹
    ipcMain.handle('fs:openPath', async (_event: IpcMainInvokeEvent, targetPath: string) => {
        try {
            await shell.openPath(targetPath);
            return true;
        } catch (error: any) {
            throw new Error(`打开路径失败: ${error.message}`);
        }
    });

    // 在默认浏览器中打开链接
    ipcMain.handle('shell:openExternal', async (_event: IpcMainInvokeEvent, url: string) => {
        try {
            await shell.openExternal(url);
            return true;
        } catch (error: any) {
            throw new Error(`打开链接失败: ${error.message}`);
        }
    });
}
