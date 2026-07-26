/**
 * 资源管理相关 IPC Handlers
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { IPCContext } from './types';
import type { ModelService } from '../services/model-service';
import type { TaskOrchestrator } from '../services/task-orchestrator';

/** 把 dataURL 或裸 base64 拆成 ModelService 多模态消息需要的 {mediaType, data} */
function splitImageBase64(imageBase64: string): { mediaType: string; data: string } {
    const dataUrlMatch = /^data:([^;]+);base64,(.*)$/s.exec(imageBase64);
    if (dataUrlMatch) {
        return { mediaType: dataUrlMatch[1], data: dataUrlMatch[2] };
    }
    return { mediaType: 'image/jpeg', data: imageBase64 };
}

/**
 * 构造视觉模型调用：只使用用户配置的 visualModel（taskOrchestrator.getAgentModels().vision）。
 * 图像必须用 ModelService 的 {type:'image', image:{mediaType,data}} 内容块——
 * OpenAI 风格 {type:'image_url'} 会被各 provider 转换器静默丢弃，模型只看到文本（实测教训）。
 */
export function buildVisionModelCall(
    modelService: ModelService,
    taskOrchestrator: TaskOrchestrator | null
): (imageBase64: string, prompt: string) => Promise<string> {
    return async (imageBase64: string, prompt: string): Promise<string> => {
        // 只使用用户配置的视觉模型，不硬编码回退到其他供应商模型。
        const configuredVisionModel = taskOrchestrator?.getAgentModels?.()?.vision;
        if (!configuredVisionModel) {
            throw new Error('未配置视觉模型。请在设置中选择一个支持视觉的国内模型（如 xiaomi-mimo-v2.5、ollama-cloud-qwen3-vl）。');
        }

        const { mediaType, data } = splitImageBase64(imageBase64);
        try {
            const response = await modelService.chat(
                configuredVisionModel,
                [{ role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image', image: { mediaType, data } }
                ] as any }]
            );
            const text = response.text || '';
            if (text.trim()) return text;
            throw new Error(`${configuredVisionModel}: 返回了空文本`);
        } catch (e) {
            throw new Error(`视觉模型 ${configuredVisionModel} 调用失败：${e instanceof Error ? e.message : e}`);
        }
    };
}

/**
 * 注册资源管理相关 IPC handlers
 */
export function registerResourceHandlers(context: IPCContext): void {
    const { resourceManagerService, modelService, taskOrchestrator } = context;

    // 设置项目根目录
    ipcMain.handle('resource:setProjectRoot', async (_event: IpcMainInvokeEvent, rootPath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        resourceManagerService.setProjectRoot(rootPath);
        return { success: true, path: rootPath };
    });

    // 获取项目根目录
    ipcMain.handle('resource:getProjectRoot', async () => {
        if (!resourceManagerService) {
            return null;
        }
        return resourceManagerService.getProjectRoot();
    });

    // 扫描目录
    ipcMain.handle('resource:scanDirectory', async (_event: IpcMainInvokeEvent, dirPath?: string, options?: {
        recursive?: boolean;
        includeDesignFiles?: boolean;
        maxDepth?: number;
        generateThumbnails?: boolean;
    }) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.scanDirectory(dirPath, options);
    });

    // 搜索资源
    ipcMain.handle('resource:search', async (_event: IpcMainInvokeEvent, query: string, options?: {
        directory?: string;
        type?: 'image' | 'design' | 'all';
        limit?: number;
    }) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.searchResources(query, options);
    });

    // 获取目录结构
    ipcMain.handle('resource:getStructure', async (_event: IpcMainInvokeEvent, directory?: string, maxDepth?: number) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getDirectoryStructure(directory, maxDepth);
    });

    // 获取资源摘要
    ipcMain.handle('resource:getSummary', async (_event: IpcMainInvokeEvent, directory?: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.generateResourceSummary(directory);
    });

    // 按类别获取资源
    ipcMain.handle('resource:getByCategory', async (_event: IpcMainInvokeEvent, directory?: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getResourcesByCategory(directory);
    });

    // 获取图片预览
    ipcMain.handle('resource:getPreview', async (_event: IpcMainInvokeEvent, imagePath: string, maxSize?: number) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getImagePreview(imagePath, maxSize);
    });

    // 生成项目素材总览图：给 Agent 观察项目图片集合，不直接替 Agent 做业务判断
    ipcMain.handle('resource:createContactSheetOverview', async (_event: IpcMainInvokeEvent, options?: {
        projectPath?: string;
        images?: Array<{
            path: string;
            relativePath?: string;
            labelHint?: string;
            role?: string;
        }>;
        columns?: number;
        tileWidth?: number;
        tileHeight?: number;
        maxImages?: number;
    }) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.createProjectContactSheetOverview(options || {});
    });

    // 生成并理解项目素材总览图：给 Agent 做项目第一眼观察，再由 Agent 决定后续单图复核
    ipcMain.handle('resource:analyzeContactSheetOverview', async (_event: IpcMainInvokeEvent, options?: {
        projectPath?: string;
        images?: Array<{
            path: string;
            relativePath?: string;
            labelHint?: string;
            role?: string;
        }>;
        columns?: number;
        tileWidth?: number;
        tileHeight?: number;
        maxImages?: number;
        focus?: string;
        userIntent?: string;
    }) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }

        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);
        return await resourceManagerService.analyzeProjectContactSheetOverview(options || {}, visionModelCall);
    });

    // 读取图片为 Base64
    ipcMain.handle('resource:readImageBase64', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.readImageAsBase64(imagePath);
    });

    // 只读图片文件探针：返回尺寸/大小/hash，不返回 base64 或原始图片内容
    ipcMain.handle('resource:probeImageFile', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.probeImageFile(imagePath);
    });

    // 只读图片像素探针：比较参考图与结果图，不返回 base64 或原始图片内容
    ipcMain.handle('resource:compareImageFiles', async (_event: IpcMainInvokeEvent, referencePath: string, resultPath: string, options?: any) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.compareImageFiles(referencePath, resultPath, options);
    });

    // 分析素材内容（使用视觉模型）
    ipcMain.handle('resource:analyzeAsset', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }
        
        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);
        
        return await resourceManagerService.analyzeAssetContent(imagePath, visionModelCall);
    });

    // 测量参考图构图（本地主体检测+纯逻辑换算，0 token，只读不落盘）
    ipcMain.handle('resource:measureComposition', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.measureReferenceComposition(imagePath);
    });

    // 分析设计参考图为什么有效（使用视觉模型，只生成待复核经验观察）
    ipcMain.handle('resource:analyzeDesignReference', async (_event: IpcMainInvokeEvent, request: {
        imagePath?: string;
        referenceTitle?: string;
        referenceTags?: string[];
        referenceSource?: string;
        topics?: string[];
        cadence?: string;
    }) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }

        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);

        return await resourceManagerService.analyzeDesignReference({
            imagePath: request?.imagePath || '',
            referenceTitle: request?.referenceTitle,
            referenceTags: request?.referenceTags,
            referenceSource: request?.referenceSource,
            topics: request?.topics,
            cadence: request?.cadence
        }, visionModelCall);
    });

    // 智能推荐素材
    ipcMain.handle('resource:recommendAssets', async (_event: IpcMainInvokeEvent, params: {
        requirement: string;
        maxResults?: number;
        category?: string;
    }) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }
        
        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);
        
        return await resourceManagerService.recommendAssets(
            params.requirement,
            visionModelCall,
            { maxResults: params.maxResults, category: params.category }
        );
    });

    // 获取素材详情
    ipcMain.handle('resource:getAssetDetails', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getAssetDetails(imagePath);
    });
}
