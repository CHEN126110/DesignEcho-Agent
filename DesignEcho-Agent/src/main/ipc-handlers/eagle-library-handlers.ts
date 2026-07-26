import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type {
    EagleLibraryOpenResponse,
    EagleLibraryPreviewRequest,
    EagleLibraryQueryRequest
} from '../../shared/eagle-library';
import { eagleLibraryService } from '../services/eagle-library-service';
import { importEagleAssetToProject } from '../services/eagle-asset-import-service';
import {
    executeEagleInspectorWriteback,
    type EagleInspectorEditRequest
} from '../services/eagle-writeback-executor-service';
import type { IPCContext } from './types';

export function registerEagleLibraryHandlers(context: IPCContext): void {
    ipcMain.handle(
        'eagleLibrary:select',
        async (
            _event: IpcMainInvokeEvent,
            options?: { defaultPath?: string }
        ): Promise<EagleLibraryOpenResponse> => {
            const dialogOptions: Electron.OpenDialogOptions = {
                title: '选择 Eagle 素材库（.library）',
                buttonLabel: '导入素材库',
                properties: ['openDirectory'],
                ...(String(options?.defaultPath || '').trim()
                    ? { defaultPath: String(options?.defaultPath || '').trim() }
                    : {})
            };
            const result = context.mainWindow
                ? await dialog.showOpenDialog(context.mainWindow, dialogOptions)
                : await dialog.showOpenDialog(dialogOptions);
            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, status: 'cancelled' };
            }
            return eagleLibraryService.openLibrary(result.filePaths[0], false);
        }
    );

    ipcMain.handle(
        'eagleLibrary:open',
        async (
            _event: IpcMainInvokeEvent,
            libraryPath: string,
            forceRefresh?: boolean
        ) => eagleLibraryService.openLibrary(libraryPath, forceRefresh === true)
    );

    ipcMain.handle(
        'eagleLibrary:query',
        async (
            _event: IpcMainInvokeEvent,
            request: EagleLibraryQueryRequest
        ) => eagleLibraryService.queryLibrary(request)
    );

    ipcMain.handle(
        'eagleLibrary:getPreview',
        async (
            _event: IpcMainInvokeEvent,
            request: EagleLibraryPreviewRequest
        ) => eagleLibraryService.getPreview(request)
    );

    // P3 Agent 参考：把 Eagle 素材作为真实视觉观察（回包无本地路径，图像经循环观察通道回传模型）
    ipcMain.handle(
        'eagleLibrary:observeAsset',
        async (
            _event: IpcMainInvokeEvent,
            request: { libraryId?: string; itemId?: string; maxSize?: number }
        ) => eagleLibraryService.observeAssetForAgent(request || {})
    );

    // P3 项目复制：从不透明引用解析源文件并复制进项目，留下来源追踪；只写项目、不写 Eagle
    ipcMain.handle(
        'eagleLibrary:importAssetToProject',
        async (
            _event: IpcMainInvokeEvent,
            request: { libraryId?: string; itemId?: string; projectPath?: string; targetSubdir?: string }
        ) => importEagleAssetToProject(request || {})
    );

    // P2 双向编辑：Inspector 手动编辑经安全闸门写回运行中的 Eagle（API only，写前冲突检测+写后读回验证）
    ipcMain.handle(
        'eagleLibrary:executeInspectorWriteback',
        async (
            _event: IpcMainInvokeEvent,
            request: EagleInspectorEditRequest
        ) => executeEagleInspectorWriteback(request || {})
    );
}
