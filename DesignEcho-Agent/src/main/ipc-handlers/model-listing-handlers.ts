/**
 * Provider 列模型 IPC handlers。
 *
 * 暴露 'model:listProviderModels'：渲染侧传 provider，主进程从 modelService 取对应
 * apiKey，调用列模型服务返回标准化的 FetchedProviderModel[]。
 *
 * 红线：apiKey 只在主进程内取用，绝不要求渲染侧回传明文 key。
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { ModelProvider } from '../../shared/config/models.config';
import { getModelsByProvider } from '../../shared/config/models.config';
import { mergeFetchedProviderModels } from '../../shared/config/provider-model-merge';
import {
    getDynamicModels,
    setDynamicModels
} from '../../shared/config/dynamic-model-registry';
import {
    listModelsForProvider,
    providerRequiresApiKeyForListing,
    type ListModelsResult
} from '../services/provider-model-listing-service';
import type { IPCContext } from './types';

/** provider → modelService.getModelSelectionApiKeys() 里的 key 名。 */
const PROVIDER_TO_API_KEY_FIELD: Partial<Record<ModelProvider, string>> = {
    google: 'google',
    xiaomi: 'xiaomi',
    openrouter: 'openrouter',
    gptsapi: 'gptsapi',
    deepseek: 'deepseek',
    'ollama-cloud': 'ollamaApiKey'
    // ollama（本地）不需要 apiKey，用默认地址。
};

const SUPPORTED_PROVIDERS = new Set<ModelProvider>([
    'google',
    'xiaomi',
    'openrouter',
    'gptsapi',
    'deepseek',
    'ollama-cloud',
    'ollama'
]);

export function registerModelListingHandlers(context: IPCContext): void {
    const { modelService, logService } = context;

    ipcMain.handle(
        'model:listProviderModels',
        async (_event: IpcMainInvokeEvent, provider?: string): Promise<ListModelsResult> => {
            const normalized = String(provider || '').trim() as ModelProvider;

            if (!normalized || !SUPPORTED_PROVIDERS.has(normalized)) {
                return {
                    success: false,
                    models: [],
                    error: `不支持的 provider「${provider}」，无法列模型。`
                };
            }

            if (!modelService) {
                return {
                    success: false,
                    models: [],
                    error: '模型服务未初始化，无法列模型。'
                };
            }

            let apiKey: string | undefined;
            if (providerRequiresApiKeyForListing(normalized)) {
                const field = PROVIDER_TO_API_KEY_FIELD[normalized];
                const keys = modelService.getModelSelectionApiKeys();
                apiKey = field ? keys[field] : undefined;
                if (!apiKey?.trim()) {
                    return {
                        success: false,
                        models: [],
                        error: `尚未配置 ${normalized} 的 API Key，无法拉取最新模型。请先在「API 密钥」页面填写。`
                    };
                }
            }

            try {
                const result = await listModelsForProvider(normalized, apiKey);
                if (!result.success) {
                    logService?.logAgent?.(
                        'warn',
                        `列模型失败 [${normalized}]：${result.error || '未知错误'}`
                    );
                    return result;
                }

                // 成功即回灌主进程动态模型注册表：合并出完整 ModelConfig（含正确 apiModelId），
                // 让主进程的 getModelById 在 chat()/chatStream() 同步调用时能查到带点 apiModelId，
                // 不再走 slug 反推。整体替换语义——保留其它 provider 的动态项，只替换本 provider。
                try {
                    const merged = mergeFetchedProviderModels(
                        normalized,
                        result.models || [],
                        getModelsByProvider(normalized)
                    );
                    const newIdSet = new Set(merged.newModelIds);
                    const newModelConfigs = merged.models.filter((m) => newIdSet.has(m.id));
                    const keptOtherProviders = getDynamicModels().filter(
                        (m) => m.provider !== normalized
                    );
                    setDynamicModels([...keptOtherProviders, ...newModelConfigs]);
                } catch (registryError: any) {
                    // 回灌失败不影响列模型结果返回；但要如实记录，便于诊断主进程为何查不到动态模型。
                    logService?.logAgent?.(
                        'warn',
                        `动态模型注册表回灌失败 [${normalized}]：${registryError?.message || String(registryError)}`
                    );
                }

                return result;
            } catch (error: any) {
                const message = `列模型异常 [${normalized}]：${error?.message || String(error)}`;
                logService?.logAgent?.('error', message);
                return { success: false, models: [], error: message };
            }
        }
    );
}
