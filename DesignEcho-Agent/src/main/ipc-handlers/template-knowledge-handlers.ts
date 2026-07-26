/**
 * 模板知识库 IPC Handlers
 */

import { ipcMain, dialog } from 'electron';
import { TemplateKnowledgeService } from '../services/template-knowledge.service';
import type {
    TemplateQuery,
    AddTemplateParams,
    AddTemplateFromPhotoshopParams,
    ResolvePhotoshopTemplateFileParams,
    FindSKUTemplateParams,
    GetAvailableSKUSpecsParams,
    TemplateResolverSettings,
    UpdateTemplateParams
} from '../../shared/types/template.types';

export function registerTemplateKnowledgeHandlers(): void {
    // 获取模板解析设置
    ipcMain.handle('template-knowledge:getResolverSettings', async () => {
        try {
            return TemplateKnowledgeService.getResolverSettings();
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getResolverSettings 错误:', error);
            throw error;
        }
    });

    // 保存模板解析设置
    ipcMain.handle('template-knowledge:setResolverSettings', async (_, settings: Partial<TemplateResolverSettings>) => {
        try {
            return TemplateKnowledgeService.setResolverSettings(settings || {});
        } catch (error: any) {
            console.error('[IPC] template-knowledge:setResolverSettings 错误:', error);
            throw error;
        }
    });

    // 选择本地模板库目录
    ipcMain.handle('template-knowledge:selectLocalLibraryFolder', async (_, defaultPath?: string) => {
        try {
            const result = await dialog.showOpenDialog({
                title: '选择本地模板库目录',
                defaultPath: typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath : undefined,
                properties: ['openDirectory', 'createDirectory']
            });

            if (result.canceled || result.filePaths.length === 0) {
                return null;
            }

            return result.filePaths[0];
        } catch (error: any) {
            console.error('[IPC] template-knowledge:selectLocalLibraryFolder 错误:', error);
            throw error;
        }
    });

    // 获取 SKU 模板候选（本地模板库 + 知识库）
    ipcMain.handle('template-knowledge:getSKUTemplateCandidates', async () => {
        try {
            return TemplateKnowledgeService.getSKUTemplateCandidates();
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getSKUTemplateCandidates 错误:', error);
            throw error;
        }
    });

    // 查找最匹配 SKU 模板
    ipcMain.handle('template-knowledge:findTemplateForSKU', async (_, params: FindSKUTemplateParams) => {
        try {
            return TemplateKnowledgeService.findTemplateForSKU(params || { comboSize: 0 });
        } catch (error: any) {
            console.error('[IPC] template-knowledge:findTemplateForSKU 错误:', error);
            throw error;
        }
    });

    // 获取可用 SKU 规格
    ipcMain.handle('template-knowledge:getAvailableSKUSpecs', async (_, params?: GetAvailableSKUSpecsParams) => {
        try {
            return TemplateKnowledgeService.getAvailableSKUSpecs(params);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getAvailableSKUSpecs 错误:', error);
            throw error;
        }
    });

    // 获取所有模板
    ipcMain.handle('template-knowledge:getAll', async () => {
        try {
            return TemplateKnowledgeService.getAll();
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getAll 错误:', error);
            throw error;
        }
    });
    
    // 查询模板
    ipcMain.handle('template-knowledge:query', async (_, params: TemplateQuery) => {
        try {
            return TemplateKnowledgeService.query(params);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:query 错误:', error);
            throw error;
        }
    });
    
    // 获取单个模板
    ipcMain.handle('template-knowledge:getById', async (_, id: string) => {
        try {
            return TemplateKnowledgeService.getById(id);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getById 错误:', error);
            throw error;
        }
    });
    
    // 按类型获取
    ipcMain.handle('template-knowledge:getByType', async (_, type: string) => {
        try {
            return TemplateKnowledgeService.getByType(type as any);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getByType 错误:', error);
            throw error;
        }
    });
    
    // 获取 SKU 模板
    ipcMain.handle('template-knowledge:getSKUTemplate', async (_, comboSize: number) => {
        try {
            return TemplateKnowledgeService.getSKUTemplate(comboSize);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getSKUTemplate 错误:', error);
            throw error;
        }
    });
    
    // 添加模板
    ipcMain.handle('template-knowledge:add', async (_, params: AddTemplateParams) => {
        try {
            return await TemplateKnowledgeService.add(params);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:add 错误:', error);
            throw error;
        }
    });

    // 从 Photoshop 文档添加模板
    ipcMain.handle('template-knowledge:addFromPhotoshop', async (_, params: AddTemplateFromPhotoshopParams) => {
        try {
            return await TemplateKnowledgeService.addFromPhotoshop(params);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:addFromPhotoshop 错误:', error);
            throw error;
        }
    });

    // 解析 Photoshop 文档对应文件（用于面板快速填充）
    ipcMain.handle('template-knowledge:resolvePhotoshopDocumentFile', async (_, params: ResolvePhotoshopTemplateFileParams) => {
        try {
            return TemplateKnowledgeService.resolvePhotoshopDocumentFile(params);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:resolvePhotoshopDocumentFile 错误:', error);
            throw error;
        }
    });
    
    // 更新模板
    ipcMain.handle('template-knowledge:update', async (_, params: UpdateTemplateParams) => {
        try {
            return TemplateKnowledgeService.update(params);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:update 错误:', error);
            throw error;
        }
    });
    
    // 删除模板
    ipcMain.handle('template-knowledge:delete', async (_, id: string) => {
        try {
            return TemplateKnowledgeService.delete(id);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:delete 错误:', error);
            throw error;
        }
    });
    
    // 设置缩略图
    ipcMain.handle('template-knowledge:setThumbnail', async (_, id: string, thumbnail: string) => {
        try {
            return TemplateKnowledgeService.setThumbnail(id, thumbnail);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:setThumbnail 错误:', error);
            throw error;
        }
    });
    
    // 获取模板 AI 描述
    ipcMain.handle('template-knowledge:getAIDescription', async (_, id: string) => {
        try {
            return TemplateKnowledgeService.getTemplateDescriptionForAI(id);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getAIDescription 错误:', error);
            throw error;
        }
    });
    
    // 获取所有模板 AI 摘要
    ipcMain.handle('template-knowledge:getAllForAI', async () => {
        try {
            return TemplateKnowledgeService.getAllTemplatesForAI();
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getAllForAI 错误:', error);
            throw error;
        }
    });
    
    // 选择模板文件
    ipcMain.handle('template-knowledge:selectFile', async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: '选择模板文件',
                filters: [
                    { name: 'Photoshop 文件', extensions: ['psd', 'psb', 'tif', 'tiff'] }
                ],
                properties: ['openFile']
            });
            
            if (result.canceled || result.filePaths.length === 0) {
                return null;
            }
            
            return result.filePaths[0];
        } catch (error: any) {
            console.error('[IPC] template-knowledge:selectFile 错误:', error);
            throw error;
        }
    });
    
    // 导出 JSON
    ipcMain.handle('template-knowledge:exportJSON', async () => {
        try {
            return TemplateKnowledgeService.exportJSON();
        } catch (error: any) {
            console.error('[IPC] template-knowledge:exportJSON 错误:', error);
            throw error;
        }
    });
    
    // 导入 JSON
    ipcMain.handle('template-knowledge:importJSON', async (_, jsonContent: string) => {
        try {
            return TemplateKnowledgeService.importJSON(jsonContent);
        } catch (error: any) {
            console.error('[IPC] template-knowledge:importJSON 错误:', error);
            throw error;
        }
    });

    // 模板库存储信息
    ipcMain.handle('template-knowledge:getStorageInfo', async () => {
        try {
            return TemplateKnowledgeService.getStorageInfo();
        } catch (error: any) {
            console.error('[IPC] template-knowledge:getStorageInfo 错误:', error);
            throw error;
        }
    });
    
    console.log('[IPC] 模板知识库 handlers 已注册');
}
