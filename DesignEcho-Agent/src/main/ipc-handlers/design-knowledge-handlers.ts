import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
    normalizeDesignKnowledgeSettings,
    toSearxngConnectorConfig,
    type DesignKnowledgeRuntimeSettings
} from '../../shared/design-knowledge-settings';
import { DesignKnowledgeSearchService } from '../services/design-knowledge-search-service';
import type { DesignKnowledgeQuery } from '../../shared/design-knowledge-search';
import type { ModelService } from '../services/model-service';

export function registerDesignKnowledgeHandlers(modelService?: ModelService | null): void {
    ipcMain.handle(
        'designKnowledge:probeSearxngHealth',
        async (_event: IpcMainInvokeEvent, settings: Partial<DesignKnowledgeRuntimeSettings>) => {
            try {
                const normalized = normalizeDesignKnowledgeSettings(settings);
                const result = await DesignKnowledgeSearchService.probeSearxngHealth(
                    toSearxngConnectorConfig(normalized)
                );
                return {
                    success: true,
                    ...result
                };
            } catch (error) {
                return {
                    success: false,
                    status: 'unavailable',
                    error: error instanceof Error ? error.message : String(error || 'unknown_error')
                };
            }
        }
    );

    // 完整设计知识检索：本地知识库（领域概念/配色规则/文案框架/复刻配方/记忆案例）+ SearXNG web 搜索。
    // 供创意循环的 searchDesignKnowledge 工具调用，让 Agent 像设计师一样先找参考再设计。
    ipcMain.handle(
        'designKnowledge:search',
        async (_event: IpcMainInvokeEvent, query: DesignKnowledgeQuery, settings?: Partial<DesignKnowledgeRuntimeSettings>) => {
            try {
                const normalized = normalizeDesignKnowledgeSettings(settings || {});
                const result = await DesignKnowledgeSearchService.search(query, {
                    searxng: toSearxngConnectorConfig(normalized),
                    // 小米 MiMo web_search 作联网搜索主力：实测稳定出活(约30-50秒)，替代失败的爬虫/Eagle。
                    xiaomiWebSearch: normalized.xiaomiWebSearch.enabled && modelService
                        ? async (q) => {
                            const r = await modelService.searchDesignWebViaXiaomi(q.query, {
                                limit: normalized.xiaomiWebSearch.limit,
                                maxKeyword: normalized.xiaomiWebSearch.maxKeyword,
                                forceSearch: normalized.xiaomiWebSearch.forceSearch,
                                userLocation: normalized.xiaomiWebSearch.userLocation
                            });
                            return {
                                available: r.available,
                                content: r.content,
                                citations: r.citations.map((c) => ({
                                    title: c.title,
                                    url: c.url,
                                    summary: c.summary,
                                    siteName: c.siteName
                                })),
                                error: r.error
                            };
                        }
                        : undefined
                });
                return {
                    success: true,
                    ...result
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error || 'unknown_error')
                };
            }
        }
    );
}
