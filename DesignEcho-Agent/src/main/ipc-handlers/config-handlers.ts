/**
 * 配置相关 IPC Handlers
 */

import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { IPCContext } from './types';
import type { ModelConfig } from '../../shared/config/models.config';
import { setDynamicModels } from '../../shared/config/dynamic-model-registry';
import { bflService } from '../services/bfl-service';
import { volcengineJimengInpaintingService } from '../services/volcengine-jimeng-inpainting-service';
import { volcengineJimengImageService } from '../services/volcengine-jimeng-image-service';
import { volcengineSeedreamService } from '../services/volcengine-seedream-service';
import { volcengineTosUploadService } from '../services/volcengine-tos-upload-service';
import { gptsapiGeminiImageService } from '../services/gptsapi-gemini-image-service';
import { openRouterGeminiImageService } from '../services/openrouter-gemini-image-service';
import { serializedFileOperations } from '../services/serialized-file-operations';

// 形态统一设置缓存
const morphingSettingsCache = {
    subjectDetectionModel: 'u2netp' as string,
    contourPrecision: 'balanced' as 'fast' | 'balanced' | 'quality',
    scaleThreshold: 2,
    positionThreshold: 2
};

// 用户配置的抠图模型设置
const userMattingConfig = {
    textGrounding: 'grounding-skip',
    objectDetection: 'detection-skip',
    segmentation: 'segment-birefnet',
    edgeRefine: 'refine-smart'
};

/**
 * 获取形态统一设置缓存
 */
export function getMorphingSettingsCache(): typeof morphingSettingsCache {
    return morphingSettingsCache;
}

/**
 * 获取抠图模型配置
 */
export function getUserMattingConfig(): typeof userMattingConfig {
    return userMattingConfig;
}

/**
 * 注册配置相关 IPC handlers
 */
export function registerConfigHandlers(context: IPCContext): void {
    const { modelService, taskOrchestrator, logService } = context;
    const stateStorePath = path.join(app.getPath('userData'), 'app-state-store.json');
    const rendererStateKey = 'rendererState';
    const readStateStore = async (): Promise<{ entries: Record<string, string> }> => {
        try {
            const raw = await fs.readFile(stateStorePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
                return { entries: {} };
            }
            return { entries: { ...(parsed.entries as Record<string, string>) } };
        } catch {
            return { entries: {} };
        }
    };

    const writeStateStore = async (entries: Record<string, string>): Promise<boolean> => {
        try {
            const payload = JSON.stringify({ updatedAt: Date.now(), entries }, null, 2);
            await serializedFileOperations.writeUtf8Atomically(stateStorePath, payload);
            return true;
        } catch (error: any) {
            logService?.logAgent('error', `[Config] State store write failed: ${error?.message || String(error)}`);
            return false;
        }
    };

    const enqueueStateStoreMutation = async (
        mutate: (entries: Record<string, string>) => void
    ): Promise<{ success: boolean; entries: Record<string, string>; error?: string }> => {
        let output: { success: boolean; entries: Record<string, string>; error?: string } = { success: false, entries: {} };
        await serializedFileOperations.runExclusive(stateStorePath, async () => {
                const { entries } = await readStateStore();
                mutate(entries);
                const written = await writeStateStore(entries);
                output = written
                    ? { success: true, entries }
                    : { success: false, entries, error: 'file write failed' };
        });
        return output;
    };

    const readStateStoreSync = (): { entries: Record<string, string> } => {
        try {
            const raw = fsSync.readFileSync(stateStorePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
                return { entries: {} };
            }
            return { entries: { ...(parsed.entries as Record<string, string>) } };
        } catch {
            return { entries: {} };
        }
    };

    // 更新 API Keys
    ipcMain.handle('config:setApiKeys', async (_event: IpcMainInvokeEvent, keys: {
        anthropic?: string;
        google?: string;
        xiaomi?: string;
        openai?: string;
        gptsapi?: string;
        openrouter?: string;
        deepseek?: string;
        ollamaUrl?: string;
        ollamaApiKey?: string;
        bfl?: string;
        volcengineJimengAccessKeyId?: string;
        volcengineJimengSecretAccessKey?: string;
        volcengineSeedreamApiKey?: string;
        volcengineTosRegion?: string;
        volcengineTosEndpoint?: string;
        volcengineTosBucket?: string;
        volcengineTosPublicBaseUrl?: string;
        volcengineTosKeyPrefix?: string;
    }) => {
        if (modelService) {
            const modelConfigPatch: Record<string, string> = {};
            if (keys.anthropic !== undefined) modelConfigPatch.anthropicApiKey = keys.anthropic;
            if (keys.google !== undefined) modelConfigPatch.googleApiKey = keys.google;
            if (keys.xiaomi !== undefined) modelConfigPatch.xiaomiApiKey = keys.xiaomi;
            if (keys.openai !== undefined) modelConfigPatch.openaiApiKey = keys.openai;
            if (keys.gptsapi !== undefined) modelConfigPatch.gptsapiApiKey = keys.gptsapi;
            if (keys.openrouter !== undefined) modelConfigPatch.openrouterApiKey = keys.openrouter;
            if (keys.deepseek !== undefined) modelConfigPatch.deepseekApiKey = keys.deepseek;
            if (keys.ollamaUrl !== undefined) modelConfigPatch.ollamaUrl = keys.ollamaUrl;
            if (keys.ollamaApiKey !== undefined) modelConfigPatch.ollamaApiKey = keys.ollamaApiKey;
            if (keys.bfl !== undefined) modelConfigPatch.bflApiKey = keys.bfl;
            modelService.updateConfig(modelConfigPatch);
            logService?.logAgent(
                'info',
                `API Keys 已更新: ${Object.keys(keys).filter(k => keys[k as keyof typeof keys]).join(', ')}`
            );
        }
        
        // 同步更新 BFL Service 的 API Key
        if (keys.bfl !== undefined) {
            bflService.setApiKey(keys.bfl || '');
            logService?.logAgent('info', keys.bfl ? '[Config] BFL API Key 已同步到 BFLService' : '[Config] BFL API Key 已清空');
        }
        if (keys.volcengineJimengAccessKeyId !== undefined || keys.volcengineJimengSecretAccessKey !== undefined) {
            volcengineJimengInpaintingService.setCredentials(
                keys.volcengineJimengAccessKeyId,
                keys.volcengineJimengSecretAccessKey
            );
            volcengineJimengImageService.setCredentials(
                keys.volcengineJimengAccessKeyId,
                keys.volcengineJimengSecretAccessKey
            );
            logService?.logAgent(
                'info',
                (keys.volcengineJimengAccessKeyId || keys.volcengineJimengSecretAccessKey)
                    ? '[Config] 即梦AI Access Key 已同步到 JimengInpaintingService'
                    : '[Config] 即梦AI Access Key 已清空'
            );
        }
        if (
            keys.volcengineTosRegion !== undefined ||
            keys.volcengineTosEndpoint !== undefined ||
            keys.volcengineTosBucket !== undefined ||
            keys.volcengineTosPublicBaseUrl !== undefined ||
            keys.volcengineTosKeyPrefix !== undefined
        ) {
            volcengineTosUploadService.setConfig({
                region: keys.volcengineTosRegion,
                endpoint: keys.volcengineTosEndpoint,
                bucket: keys.volcengineTosBucket,
                publicBaseUrl: keys.volcengineTosPublicBaseUrl,
                keyPrefix: keys.volcengineTosKeyPrefix
            });
            logService?.logAgent('info', '[Config] TOS 图像上传配置已同步');
        }
        if (keys.volcengineSeedreamApiKey !== undefined) {
            volcengineSeedreamService.setApiKey(keys.volcengineSeedreamApiKey);
            logService?.logAgent(
                'info',
                keys.volcengineSeedreamApiKey
                    ? '[Config] Seedream API Key 已同步到 SeedreamService'
                    : '[Config] Seedream API Key 已清空'
            );
        }
        if (keys.gptsapi !== undefined) {
            gptsapiGeminiImageService.setApiKey(keys.gptsapi);
            logService?.logAgent(
                'info',
                keys.gptsapi
                    ? '[Config] GPTs API Key 已同步到 GPTsAPI Gemini Image Service'
                    : '[Config] GPTs API Key 已清空'
            );
        }
        if (keys.openrouter !== undefined) {
            openRouterGeminiImageService.setApiKey(keys.openrouter);
            logService?.logAgent(
                'info',
                keys.openrouter
                    ? '[Config] OpenRouter API Key 已同步到 OpenRouter Gemini Image Service'
                    : '[Config] OpenRouter API Key 已清空'
            );
        }
        return { success: true };
    });

    ipcMain.handle(
        'volcengine:testJimengCredentials',
        async (
            _event: IpcMainInvokeEvent,
            accessKeyId: string,
            secretAccessKey: string
        ) => {
            try {
                return await volcengineJimengInpaintingService.testCredentials(accessKeyId, secretAccessKey);
            } catch (error: any) {
                return { success: false, error: error?.message || String(error) };
            }
        }
    );

    ipcMain.handle('volcengine:testSeedreamApiKey', async (_event: IpcMainInvokeEvent, apiKey: string) => {
        try {
            return await volcengineSeedreamService.testApiKey(apiKey);
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('state:getPersistedValue', async (_event: IpcMainInvokeEvent, key: string) => {
        try {
            const { entries } = await readStateStore();
            const value = Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
            return { success: true, value };
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('state:setPersistedValue', async (_event: IpcMainInvokeEvent, key: string, value: string) => {
        try {
            const mutation = await enqueueStateStoreMutation((entries) => {
                entries[key] = String(value ?? '');
            });
            if (!mutation.success) {
                logService?.logAgent('warn', `[Config] 持久化写入失败，key: ${key}`);
                return { success: false, error: mutation.error || 'file write failed' };
            }
            return { success: true };
        } catch (error: any) {
            logService?.logAgent('warn', `[Config] 持久化写入失败: ${error?.message || String(error)}`);
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('state:removePersistedValue', async (_event: IpcMainInvokeEvent, key: string) => {
        try {
            const mutation = await enqueueStateStoreMutation((entries) => {
                delete entries[key];
            });
            return mutation.success ? { success: true } : { success: false, error: mutation.error || 'file write failed' };
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.on('state:getPersistedValueSync', (event, key: string) => {
        try {
            const { entries } = readStateStoreSync();
            const value = Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
            event.returnValue = { success: true, value };
        } catch (error: any) {
            logService?.logAgent('error', `[Config] state:getPersistedValueSync failed: ${error?.message || String(error)}`);
            event.returnValue = { success: false, error: error?.message || String(error), value: null };
        }
    });

    // 更新抠图设置
    ipcMain.handle('config:setMattingSettings', async () => {
        logService?.logAgent('info', '[Config] 抠图设置更新（本地 ONNX 模式）');
        return { success: true };
    });

    ipcMain.handle('config:saveRendererState', async (_event: IpcMainInvokeEvent, state: any) => {
        try {
            const mutation = await enqueueStateStoreMutation((entries) => {
                entries[rendererStateKey] = JSON.stringify(state ?? null);
            });
            if (!mutation.success) {
                return { success: false, error: mutation.error || 'file write failed' };
            }
            return { success: true };
        } catch (error: any) {
            logService?.logAgent('warn', `[Config] 保存 RendererState 失败: ${error?.message || String(error)}`);
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('config:loadRendererState', async () => {
        try {
            const { entries } = await readStateStore();
            const raw = Object.prototype.hasOwnProperty.call(entries, rendererStateKey) ? entries[rendererStateKey] : null;
            if (!raw) return { success: true, state: null };
            try {
                return { success: true, state: JSON.parse(raw) };
            } catch {
                return { success: true, state: null };
            }
        } catch (error: any) {
            return { success: false, error: error?.message || String(error), state: null };
        }
    });

    // 更新模型偏好设置
    ipcMain.handle('config:setModelPreferences', async (_event: IpcMainInvokeEvent, prefs: {
        mode?: 'local' | 'cloud' | 'auto';
        autoFallback?: boolean;
        preferredLocalModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
        preferredCloudModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
        thinking?: { enabled?: boolean };
        // 动态拉取模型快照（renderer 持久化的全部 dynamicModels）。随偏好同步通道一起下发，
        // 是主进程冷启动回灌的天然落点：App.tsx 的偏好同步 effect 在挂载即运行，
        // 确保主进程 getModelById 在首次 chat() 前就能查到带点 apiModelId（不走 slug 反推）。
        dynamicModels?: ModelConfig[];
    }) => {
        if (taskOrchestrator) {
            taskOrchestrator.updatePreferences(prefs);
            logService?.logAgent('info', `模型偏好已更新: 模式=${prefs.mode || 'unchanged'}`);
        }
        // 整体替换主进程动态模型注册表（renderer 传来的是完整快照，非增量）。
        // 仅当字段存在时才回灌——缺省（旧 renderer / 无动态模型）不动注册表，避免误清空
        // listProviderModels 刚回灌的项。
        if (Array.isArray(prefs.dynamicModels)) {
            setDynamicModels(prefs.dynamicModels);
            logService?.logAgent(
                'info',
                `[Config] 动态模型注册表已同步: ${prefs.dynamicModels.length} 个`
            );
        }
        return { success: true };
    });

    // 获取模型偏好设置
    ipcMain.handle('config:getModelPreferences', async () => {
        if (taskOrchestrator) {
            return taskOrchestrator.getPreferences();
        }
        return null;
    });

    // 形态统一设置
    ipcMain.handle('config:setMorphingSettings', async (_event: IpcMainInvokeEvent, settings: Partial<typeof morphingSettingsCache>) => {
        Object.assign(morphingSettingsCache, settings);
        logService?.logAgent('info', `[Config] 形态统一设置已更新: 模型=${morphingSettingsCache.subjectDetectionModel}`);
        return { success: true };
    });

    ipcMain.handle('config:getMorphingSettings', async () => {
        return morphingSettingsCache;
    });
}
