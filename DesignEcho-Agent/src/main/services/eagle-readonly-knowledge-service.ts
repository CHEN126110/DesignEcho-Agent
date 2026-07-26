import {
    buildEagleMcpToolCallBody,
    buildEagleReadonlyUnavailableResponse,
    normalizeEagleReadonlyKnowledgeResults,
    normalizeEagleReadonlySettings,
    type EagleMcpToolCallBody,
    type EagleReadonlyKnowledgeQuery,
    type EagleReadonlyKnowledgeResponse,
    type EagleReadonlySettings,
    type EagleReadonlyToolName
} from '../../shared/eagle-readonly-knowledge';

export type EagleReadonlyFetchImpl = (
    url: string,
    init: {
        method: 'POST';
        headers: Record<string, string>;
        body: string;
        signal?: AbortSignal;
    }
) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;

export interface EagleReadonlyKnowledgeServiceOptions {
    settings?: Partial<EagleReadonlySettings>;
    fetchImpl?: EagleReadonlyFetchImpl;
}

interface EagleToolCallResult {
    ok: boolean;
    status: number;
    body: unknown;
}

const EAGLE_AI_STATUS_TIMEOUT_MS = 1200;
const EAGLE_AI_SEARCH_TIMEOUT_MS = 3000;
const EAGLE_KEYWORD_FALLBACK_TIMEOUT_MS = 1500;

export interface EagleReadonlyResolvedItem {
    success: boolean;
    status: 'ok' | 'disabled' | 'unavailable' | 'not_found';
    item?: {
        id: string;
        title: string;
        tags: string[];
        folders: string[];
        ext?: string;
        width?: number;
        height?: number;
        /** 仅限主进程内部传给资源分析服务，禁止回传 Renderer/模型。 */
        localImagePath: string;
        /** 仅限主进程内部判断预览风险，禁止回传 Renderer/模型。 */
        localImageSource: 'thumbnail' | 'file';
    };
    warnings: string[];
    error?: string;
}

export interface EagleReadonlyUiPreviewResponse {
    success: boolean;
    status: 'ok' | 'disabled' | 'unavailable' | 'not_found';
    item?: {
        id: string;
        title: string;
        ext?: string;
    };
    preview?: {
        dataUrl: string;
        mimeType: 'image/jpeg';
        width: number;
        height: number;
        maxSize: number;
    };
    warnings: string[];
    error?: string;
    boundaries: {
        uiOnly: true;
        requiresExplicitRequest: true;
        singleItemOnly: true;
        requiredPurpose: 'knowledge_library_ui';
        maxPreviewSize: 512;
        localPathRedacted: true;
        doesNotEnterAgentContext: true;
        doesNotPersist: true;
        doesNotWriteEagle: true;
        doesNotRunPhotoshop: true;
    };
}

export type EagleReadonlyPreviewLoader = (
    localImagePath: string,
    maxSize: number
) => Promise<{
    success: boolean;
    imageData?: string;
    dimensions?: { width: number; height: number };
    error?: string;
}>;

export class EagleReadonlyKnowledgeService {
    static async getUiPreview(
        request: {
            itemId?: string;
            maxSize?: number;
            purpose?: 'knowledge_library_ui';
        },
        previewLoader: EagleReadonlyPreviewLoader,
        options: EagleReadonlyKnowledgeServiceOptions = {}
    ): Promise<EagleReadonlyUiPreviewResponse> {
        const boundaries = buildUiPreviewBoundaries();
        const maxSize = clampPreviewSize(request?.maxSize);
        if (request?.purpose !== 'knowledge_library_ui') {
            return {
                success: false,
                status: 'unavailable',
                warnings: [],
                error: 'Eagle 预览仅允许由知识库页面在用户明确操作后请求。',
                boundaries
            };
        }
        const resolved = await this.resolveItemForAnalysis(request?.itemId || '', options);
        if (!resolved.success || !resolved.item) {
            return {
                success: false,
                status: resolved.status,
                warnings: resolved.warnings,
                error: redactPublicDiagnostic(resolved.error, 'Eagle 预览条目不可用。'),
                boundaries
            };
        }
        if (
            resolved.item.localImageSource === 'file'
            && (resolved.item.ext === 'psd' || resolved.item.ext === 'psb')
        ) {
            return {
                success: false,
                status: 'unavailable',
                item: buildPublicPreviewItem(resolved.item),
                warnings: resolved.warnings,
                error: 'Eagle 没有为这个大型设计文件提供缩略图，本次未读取原始 PSD/PSB，以避免占用过多内存。',
                boundaries
            };
        }

        try {
            const loaded = await previewLoader(resolved.item.localImagePath, maxSize);
            const imageData = normalizePreviewBase64(loaded.imageData);
            if (!loaded.success || !imageData) {
                return {
                    success: false,
                    status: 'unavailable',
                    item: buildPublicPreviewItem(resolved.item),
                    warnings: resolved.warnings,
                    error: redactPublicDiagnostic(loaded.error, 'Eagle 预览生成失败。'),
                    boundaries
                };
            }
            const dimensions = fitPreviewDimensions(loaded.dimensions, maxSize);
            return {
                success: true,
                status: 'ok',
                item: buildPublicPreviewItem(resolved.item),
                preview: {
                    dataUrl: `data:image/jpeg;base64,${imageData}`,
                    mimeType: 'image/jpeg',
                    width: dimensions.width,
                    height: dimensions.height,
                    maxSize
                },
                warnings: resolved.warnings,
                boundaries
            };
        } catch (error) {
            return {
                success: false,
                status: 'unavailable',
                item: buildPublicPreviewItem(resolved.item),
                warnings: resolved.warnings,
                error: redactPublicDiagnostic(error, 'Eagle 预览生成失败。'),
                boundaries
            };
        }
    }

    static async resolveItemForAnalysis(
        itemId: string,
        options: EagleReadonlyKnowledgeServiceOptions = {}
    ): Promise<EagleReadonlyResolvedItem> {
        const id = String(itemId || '').trim();
        if (!id) {
            return {
                success: false,
                status: 'not_found',
                warnings: [],
                error: 'Eagle 参考分析失败：缺少 itemId。'
            };
        }
        const settings = normalizeEagleReadonlySettings(options.settings);
        if (!settings.enabled) {
            return {
                success: false,
                status: 'disabled',
                warnings: ['Eagle 只读连接器已禁用。'],
                error: 'Eagle 只读连接器已禁用。'
            };
        }
        const fetchImpl = resolveFetchImpl(options.fetchImpl);
        if (!fetchImpl) {
            return {
                success: false,
                status: 'unavailable',
                warnings: [],
                error: 'Eagle 参考分析不可用：当前运行时没有 fetch。'
            };
        }
        try {
            const result = await callEagleTool(settings, fetchImpl, 'item_get', {
                ids: [id],
                fullDetails: true,
                limit: 1
            });
            if (!result.ok) {
                return {
                    success: false,
                    status: 'unavailable',
                    warnings: [],
                    error: `Eagle 条目读取失败：HTTP ${result.status}。`
                };
            }
            const rawItem = extractEagleItems(unwrapEagleResult(result.body))
                .find((item) => String(item.id || '').trim() === id);
            if (!rawItem) {
                return {
                    success: false,
                    status: 'not_found',
                    warnings: [],
                    error: `Eagle 中未找到条目 ${id}。`
                };
            }
            const thumbnailPath = String(rawItem.thumbnailPath || '').trim();
            const filePath = String(rawItem.filePath || '').trim();
            const localImagePath = thumbnailPath || filePath;
            if (!localImagePath) {
                return {
                    success: false,
                    status: 'not_found',
                    warnings: [],
                    error: `Eagle 条目 ${id} 没有可读取的预览或文件路径。`
                };
            }
            return {
                success: true,
                status: 'ok',
                item: {
                    id,
                    title: normalizePublicMetadata(rawItem.name || rawItem.title, `Eagle item ${id}`),
                    tags: normalizeStringArray(rawItem.tags),
                    folders: normalizeStringArray(rawItem.folders),
                    ...(String(rawItem.ext || '').trim() ? { ext: String(rawItem.ext).replace(/^\./, '').toLowerCase() } : {}),
                    ...(positiveInteger(rawItem.width) ? { width: positiveInteger(rawItem.width) } : {}),
                    ...(positiveInteger(rawItem.height) ? { height: positiveInteger(rawItem.height) } : {}),
                    localImagePath,
                    localImageSource: thumbnailPath ? 'thumbnail' : 'file'
                },
                warnings: []
            };
        } catch (error) {
            return {
                success: false,
                status: 'unavailable',
                warnings: [],
                error: `Eagle 条目读取失败：${formatError(error)}。`
            };
        }
    }

    static async search(
        query: EagleReadonlyKnowledgeQuery,
        options: EagleReadonlyKnowledgeServiceOptions = {}
    ): Promise<EagleReadonlyKnowledgeResponse> {
        const settings = normalizeEagleReadonlySettings(options.settings);
        if (!settings.enabled) {
            return buildEagleReadonlyUnavailableResponse(
                query,
                'Eagle 只读知识连接器已禁用。',
                'disabled'
            );
        }

        const fetchImpl = resolveFetchImpl(options.fetchImpl);
        if (!fetchImpl) {
            return buildEagleReadonlyUnavailableResponse(
                query,
                'Eagle 只读知识连接器不可用：当前运行时没有 fetch。'
            );
        }

        const warnings: string[] = [];
        let searchCall: EagleMcpToolCallBody | undefined;
        const deadlineAt = Date.now() + settings.timeoutMs;
        try {
            searchCall = await chooseSearchCall(query, settings, fetchImpl, warnings, deadlineAt);
            const primaryTimeoutMs = resolveSearchCallTimeout(searchCall.tool, deadlineAt);
            const result = await callEagleTool(
                settings,
                fetchImpl,
                searchCall.tool,
                searchCall.params,
                primaryTimeoutMs
            );
            if (!result.ok) {
                return buildEagleReadonlyUnavailableResponse(
                    query,
                    `Eagle 只读知识搜索失败：HTTP ${result.status}。`
                );
            }
            return normalizeEagleReadonlyKnowledgeResults(
                query,
                unwrapEagleResult(result.body),
                {
                    sourceTool: searchCall.tool,
                    warnings
                }
            );
        } catch (error) {
            // AI 语义检索冷启动可达 50 秒以上（Eagle 的 FAISS 索引闲置 180 秒即休眠），
            // 超时后降级为不走 AI 后端的 item_query 关键词匹配（毫秒级响应），
            // 让用户先拿到基础结果而不是空手而归。
            // item_query 是整串匹配（「袜子详情页」匹配不到名为「袜子…」的素材），
            // 因此按空格拆词逐个查询并合并去重。
            if (searchCall?.tool === 'ai_search_by_text' && query.query) {
                warnings.push(
                    `Eagle AI 语义检索超时（索引可能正在从休眠中唤醒，稍后重试可恢复），本次已降级为关键词匹配：${formatError(error)}。`
                );
                try {
                    const keywordQueries = buildKeywordFallbackQueries(query.query);
                    const mergedItems: unknown[] = [];
                    const seenIds = new Set<string>();
                    for (const keyword of keywordQueries) {
                        const fallbackTimeoutMs = resolveRemainingTimeout(
                            deadlineAt,
                            EAGLE_KEYWORD_FALLBACK_TIMEOUT_MS
                        );
                        if (!fallbackTimeoutMs) {
                            warnings.push('Eagle 关键词匹配已到达本次检索的整体时间上限，剩余候选词未再请求。');
                            break;
                        }
                        const fallbackCall = buildEagleMcpToolCallBody('item_query', {
                            query: keyword,
                            fullDetails: false
                        });
                        const fallbackResult = await callEagleTool(
                            settings,
                            fetchImpl,
                            fallbackCall.tool,
                            fallbackCall.params,
                            fallbackTimeoutMs
                        );
                        if (!fallbackResult.ok) continue;
                        const items = unwrapEagleResult(fallbackResult.body);
                        for (const item of Array.isArray(items) ? items : []) {
                            const id = String((item as any)?.id || '');
                            if (id && seenIds.has(id)) continue;
                            if (id) seenIds.add(id);
                            mergedItems.push(item);
                        }
                    }
                    if (mergedItems.length > 0) {
                        return normalizeEagleReadonlyKnowledgeResults(
                            query,
                            mergedItems,
                            {
                                sourceTool: 'item_query',
                                warnings
                            }
                        );
                    }
                    warnings.push(`Eagle 关键词匹配（${keywordQueries.join('、')}）没有命中素材。`);
                } catch (fallbackError) {
                    warnings.push(`Eagle 关键词匹配降级也失败：${formatError(fallbackError)}。`);
                }
            }
            return buildEagleReadonlyUnavailableResponse(
                query,
                `Eagle 只读知识连接器不可用：${formatError(error)}。`,
                'unavailable',
                warnings
            );
        }
    }

    static async probe(
        options: EagleReadonlyKnowledgeServiceOptions = {}
    ): Promise<{
        success: boolean;
        status: 'disabled' | 'ok' | 'unavailable';
        endpoint: string;
        app?: unknown;
        aiSearch?: unknown;
        warnings: string[];
        error?: string;
    }> {
        const settings = normalizeEagleReadonlySettings(options.settings);
        const warnings: string[] = [];
        if (!settings.enabled) {
            return {
                success: true,
                status: 'disabled',
                endpoint: settings.endpoint,
                warnings: ['Eagle 只读知识连接器已禁用。']
            };
        }

        const fetchImpl = resolveFetchImpl(options.fetchImpl);
        if (!fetchImpl) {
            return {
                success: false,
                status: 'unavailable',
                endpoint: settings.endpoint,
                warnings: ['Eagle 只读知识连接器不可用：当前运行时没有 fetch。']
            };
        }

        try {
            const deadlineAt = Date.now() + settings.timeoutMs;
            const app = await callEagleTool(
                settings,
                fetchImpl,
                'get_app_info',
                {},
                resolveRemainingTimeout(deadlineAt) || 1
            );
            if (!app.ok) {
                return {
                    success: false,
                    status: 'unavailable',
                    endpoint: settings.endpoint,
                    warnings: [`Eagle 应用探针失败：HTTP ${app.status}。`]
                };
            }
            let aiSearch: unknown;
            try {
                const aiStatusTimeoutMs = resolveRemainingTimeout(deadlineAt, EAGLE_AI_STATUS_TIMEOUT_MS);
                if (aiStatusTimeoutMs) {
                    const aiSearchResult = await callEagleTool(
                        settings,
                        fetchImpl,
                        'ai_search_status',
                        {},
                        aiStatusTimeoutMs
                    );
                    aiSearch = aiSearchResult.ok ? unwrapEagleResult(aiSearchResult.body) : undefined;
                } else {
                    warnings.push('Eagle 应用已响应，但本次探针的整体时间已用尽，未继续检查 AI Search。');
                }
            } catch (error) {
                warnings.push(`Eagle AI Search 状态不可用：${formatError(error)}。`);
            }
            return {
                success: true,
                status: 'ok',
                endpoint: settings.endpoint,
                app: unwrapEagleResult(app.body),
                aiSearch,
                warnings
            };
        } catch (error) {
            return {
                success: false,
                status: 'unavailable',
                endpoint: settings.endpoint,
                warnings: [`Eagle 只读知识连接器不可用：${formatError(error)}。`],
                error: formatError(error)
            };
        }
    }
}

function buildUiPreviewBoundaries(): EagleReadonlyUiPreviewResponse['boundaries'] {
    return {
        uiOnly: true,
        requiresExplicitRequest: true,
        singleItemOnly: true,
        requiredPurpose: 'knowledge_library_ui',
        maxPreviewSize: 512,
        localPathRedacted: true,
        doesNotEnterAgentContext: true,
        doesNotPersist: true,
        doesNotWriteEagle: true,
        doesNotRunPhotoshop: true
    };
}

function buildPublicPreviewItem(
    item: NonNullable<EagleReadonlyResolvedItem['item']>
): NonNullable<EagleReadonlyUiPreviewResponse['item']> {
    return {
        id: item.id,
        title: item.title,
        ...(item.ext ? { ext: item.ext } : {})
    };
}

function clampPreviewSize(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 384;
    return Math.max(64, Math.min(512, Math.floor(parsed)));
}

function normalizePreviewBase64(value: unknown): string {
    const text = String(value || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '');
    if (!text || text.length > 2_000_000) return '';
    return /^[a-z0-9+/]+={0,2}$/i.test(text) ? text : '';
}

function fitPreviewDimensions(
    value: { width: number; height: number } | undefined,
    maxSize: number
): { width: number; height: number } {
    const width = positiveInteger(value?.width) || maxSize;
    const height = positiveInteger(value?.height) || maxSize;
    const scale = Math.min(1, maxSize / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

function redactPublicDiagnostic(value: unknown, fallback: string): string {
    const text = value instanceof Error ? value.message : String(value || fallback);
    return text
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[图片数据已隐藏]')
        .replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, '[本地路径已隐藏]')
        .replace(/file:\/\/[^\s]+/gi, '[本地路径已隐藏]')
        .slice(0, 1000);
}

async function chooseSearchCall(
    query: EagleReadonlyKnowledgeQuery,
    settings: Required<EagleReadonlySettings>,
    fetchImpl: EagleReadonlyFetchImpl,
    warnings: string[],
    deadlineAt: number
): Promise<EagleMcpToolCallBody> {
    // 选择和结构过滤是用户显式边界，优先级必须高于 AI 语义检索；AI 接口不支持这些过滤条件。
    if (query.selectedOnly) {
        return buildEagleMcpToolCallBody('item_get_selected', {
            fullDetails: false
        });
    }

    if (query.tags?.length || query.folders?.length || query.ext) {
        return buildEagleMcpToolCallBody('item_get', {
            tags: query.tags,
            folders: query.folders,
            ext: query.ext,
            limit: clampSearchLimit(query.limit),
            fullDetails: false
        });
    }

    if (query.preferAiSearch) {
        try {
            const statusTimeoutMs = resolveRemainingTimeout(deadlineAt, EAGLE_AI_STATUS_TIMEOUT_MS);
            if (!statusTimeoutMs) {
                warnings.push('Eagle AI Search 状态检查已到达本次检索的整体时间上限，已降级为只读 item_query。');
                return buildEagleMcpToolCallBody('item_query', {
                    query: query.query,
                    fullDetails: false
                });
            }
            const status = await callEagleTool(
                settings,
                fetchImpl,
                'ai_search_status',
                {},
                statusTimeoutMs
            );
            const aiStatus = unwrapEagleResult(status.body);
            if (status.ok && isAiSearchReady(aiStatus)) {
                return buildEagleMcpToolCallBody('ai_search_by_text', {
                    query: query.query,
                    limit: clampSearchLimit(query.limit),
                    fullDetails: false
                });
            }
            warnings.push('Eagle AI Search 未就绪，已降级为只读 item_query。');
        } catch (error) {
            warnings.push(`Eagle AI Search 状态检查失败，已降级为只读 item_query：${formatError(error)}。`);
        }
    }

    return buildEagleMcpToolCallBody('item_query', {
        query: query.query,
        fullDetails: false
    });
}

async function callEagleTool(
    settings: Required<EagleReadonlySettings>,
    fetchImpl: EagleReadonlyFetchImpl,
    tool: EagleReadonlyToolName,
    params: Record<string, unknown>,
    timeoutMs: number = settings.timeoutMs
): Promise<EagleToolCallResult> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const boundedTimeoutMs = Math.max(1, Math.min(settings.timeoutMs, Math.floor(timeoutMs)));
    const body = JSON.stringify(buildEagleMcpToolCallBody(tool, params));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const request = (async (): Promise<EagleToolCallResult> => {
        const response = await fetchImpl(`${settings.endpoint}/api/tools/call`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body,
            signal: controller?.signal
        });
        const json = await response.json();
        return {
            ok: response.ok,
            status: response.status,
            body: json
        };
    })();
    const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
            controller?.abort();
            reject(new Error(`Eagle request timeout after ${boundedTimeoutMs}ms`));
        }, boundedTimeoutMs);
    });
    try {
        return await Promise.race([request, deadline]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function resolveSearchCallTimeout(tool: EagleReadonlyToolName, deadlineAt: number): number {
    const cap = tool === 'ai_search_by_text' || tool === 'ai_search_by_item'
        ? EAGLE_AI_SEARCH_TIMEOUT_MS
        : undefined;
    const timeoutMs = resolveRemainingTimeout(deadlineAt, cap);
    if (!timeoutMs) {
        throw new Error('Eagle request timeout: the overall search deadline was reached before the next request.');
    }
    return timeoutMs;
}

function resolveRemainingTimeout(deadlineAt: number, cap?: number): number | undefined {
    const remainingMs = Math.floor(deadlineAt - Date.now());
    if (remainingMs <= 0) return undefined;
    if (!Number.isFinite(cap)) return remainingMs;
    return Math.max(1, Math.min(remainingMs, Math.floor(cap as number)));
}

function unwrapEagleResult(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    const value = body as Record<string, unknown>;
    if ('result' in value) return value.result;
    if ('data' in value) return value.data;
    return body;
}

function extractEagleItems(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    for (const key of ['items', 'data', 'result', 'results']) {
        if (Array.isArray(record[key])) return extractEagleItems(record[key]);
    }
    if (record.item && typeof record.item === 'object') return [record.item as Record<string, unknown>];
    if ('id' in record) return [record];
    return [];
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => normalizePublicMetadata(item))
        .filter(Boolean)))
        .slice(0, 50);
}

function normalizePublicMetadata(value: unknown, fallback = ''): string {
    const text = String(value || fallback).trim().slice(0, 1000);
    return text
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[图片数据已隐藏]')
        .replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, '[本地路径已隐藏]')
        .replace(/file:\/\/[^\s]+/gi, '[本地路径已隐藏]')
        .trim();
}

function positiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function isAiSearchReady(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const status = String((value as Record<string, unknown>).status || '').toLowerCase();
    const ready = (value as Record<string, unknown>).ready;
    return ready === true || status === 'ready' || status === 'ok';
}

function resolveFetchImpl(fetchImpl: EagleReadonlyFetchImpl | undefined): EagleReadonlyFetchImpl | undefined {
    if (fetchImpl) return fetchImpl;
    const runtimeFetch = (globalThis as any).fetch;
    if (typeof runtimeFetch !== 'function') return undefined;
    return runtimeFetch.bind(globalThis);
}

function clampSearchLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8;
    return Math.max(1, Math.min(100, Math.floor(parsed)));
}

/**
 * 关键词降级查询序列：原句 + 空格拆分的子词；无空格的中文长词再补
 * 头 2 字与尾 3 字两个 n-gram 候选（「袜子详情页」→「袜子」+「详情页」），
 * 因为 item_query 是整串匹配，整句几乎必然 0 命中。上限 4 个查询防连环请求。
 */
function buildKeywordFallbackQueries(rawQuery: string): string[] {
    const full = String(rawQuery || '').trim();
    if (!full) return [];
    const tokens = full.split(/\s+/).filter((token) => token.length >= 2);
    const queries = [full, ...tokens];
    if (tokens.length <= 1 && /^[一-鿿]{4,}$/.test(full)) {
        queries.push(full.slice(0, 2));
        queries.push(full.slice(-3));
    }
    return [...new Set(queries)].slice(0, 4);
}

function formatError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || 'unknown_error');
    if (/aborted|abort|timeout/i.test(message)) {
        return 'Eagle 在超时时间内没有响应（请求已中止）。Eagle 服务在线但素材库查询挂起时也会出现这种情况，请检查 Eagle 的 AI 搜索索引状态或重启 Eagle';
    }
    if (/ECONNREFUSED|fetch failed/i.test(message)) {
        return 'Eagle MCP 服务无法连接。请确认 Eagle（4.0+）正在运行，并已在偏好设置中启用 MCP Server（默认端口 41596）';
    }
    return message;
}

export default EagleReadonlyKnowledgeService;
