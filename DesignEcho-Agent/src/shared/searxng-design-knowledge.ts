import {
    normalizeExternalDesignKnowledgeResults,
    type DesignKnowledgeQuery,
    type DesignKnowledgeResult
} from './design-knowledge-search';

export type SearxngConnectorStatus =
    | 'disabled'
    | 'missing_endpoint'
    | 'ready';

export interface SearxngConnectorConfig {
    enabled?: boolean;
    endpoint?: string;
    language?: string;
    safeSearch?: 0 | 1 | 2;
    page?: number;
    timeoutMs?: number;
    fetchedAt?: string;
}

export interface SearxngConnectorState {
    provider: 'searxng';
    status: SearxngConnectorStatus;
    endpoint?: string;
    warnings: string[];
    boundaries: {
        doesNotRunProviderModel: true;
        doesNotRunPhotoshop: true;
        doesNotManageDocker: true;
        doesNotCreateDirectPhotoshopActions: true;
        requiresExplicitEnablement: true;
        requiresEndpoint: true;
    };
}

export interface SearxngRawResult {
    title?: unknown;
    url?: unknown;
    content?: unknown;
    snippet?: unknown;
    pretty_url?: unknown;
    engine?: unknown;
    engines?: unknown;
}

export interface SearxngRawResponse {
    results?: SearxngRawResult[];
}

export function buildSearxngConnectorStatus(config: SearxngConnectorConfig | undefined): SearxngConnectorState {
    const normalized = normalizeConfig(config);

    if (!normalized.enabled) {
        return buildState({
            status: 'disabled',
            endpoint: normalized.endpoint,
            warnings: ['SearXNG 连接器未启用。']
        });
    }

    if (!normalized.endpoint) {
        return buildState({
            status: 'missing_endpoint',
            warnings: ['SearXNG 需要填写明确的 endpoint 后才能搜索。']
        });
    }

    return buildState({
        status: 'ready',
        endpoint: normalized.endpoint,
        warnings: [
            'SearXNG 只提供外部知识依据。',
            'DesignEcho 不负责管理 Docker、Harbor 或 SearXNG 的生命周期。'
        ]
    });
}

export function buildSearxngSearchUrl(
    config: SearxngConnectorConfig,
    query: Pick<DesignKnowledgeQuery, 'query' | 'limit'>
): string {
    const normalized = normalizeConfig(config);
    if (!normalized.endpoint) {
        throw new Error('缺少 SearXNG endpoint。');
    }

    const url = new URL('/search', ensureTrailingSlash(normalized.endpoint));
    url.searchParams.set('q', String(query.query || '').trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', normalized.language);
    url.searchParams.set('safesearch', String(normalized.safeSearch));
    url.searchParams.set('pageno', String(normalized.page));
    return url.toString();
}

export function normalizeSearxngResults(
    query: DesignKnowledgeQuery,
    response: SearxngRawResponse,
    options: { fetchedAt?: string } = {}
): DesignKnowledgeResult[] {
    const fetchedAt = options.fetchedAt || new Date().toISOString();
    const rawResults = Array.isArray(response?.results) ? response.results : [];

    return normalizeExternalDesignKnowledgeResults(
        query,
        rawResults
            .map((item, index) => {
                const title = normalizeOptionalText(item.title) || `SearXNG 结果 ${index + 1}`;
                const sourceUrl = normalizeHttpUrl(item.url);
                const summary = normalizeOptionalText(item.content)
                    || normalizeOptionalText(item.snippet)
                    || normalizeOptionalText(item.pretty_url)
                    || 'SearXNG 返回了结果，但没有可用摘要。';

                if (!sourceUrl) return undefined;

                return {
                    id: `searxng:${hashStableId(`${sourceUrl}:${title}`)}`,
                    title,
                    intent: inferIntent(query),
                    sourceType: 'web_page' as const,
                    summary,
                    sourceNotes: [
                        `SearXNG 获取时间：${fetchedAt}`,
                        `来源 URL：${sourceUrl}`,
                        '边界：仅作为外部网页知识，不是 Photoshop 操作。'
                    ],
                    tags: ['searxng', 'external-web-knowledge', ...normalizeEngines(item)],
                    allowedUses: ['prompt_context', 'user_reference'],
                    sourceLevel: 'external_snippet' as const,
                    sourceRank: Math.max(1, 58 - index),
                    sourceUrl,
                    updatedAt: fetchedAt
                };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item))
    );
}

export function shouldUseSearxngForQuery(query: DesignKnowledgeQuery, config: SearxngConnectorConfig | undefined): boolean {
    const state = buildSearxngConnectorStatus(config);
    if (state.status !== 'ready') return false;
    if (!String(query.query || '').trim()) return false;
    if (!Array.isArray(query.sourceTypes) || query.sourceTypes.length === 0) return true;
    return query.sourceTypes.includes('web_page');
}

export function isSearxngKnowledgeBoundaryOk(state: SearxngConnectorState | undefined): boolean {
    if (!state) return false;
    if (state.provider !== 'searxng') return false;
    if (state.boundaries.doesNotRunProviderModel !== true) return false;
    if (state.boundaries.doesNotRunPhotoshop !== true) return false;
    if (state.boundaries.doesNotManageDocker !== true) return false;
    if (state.boundaries.doesNotCreateDirectPhotoshopActions !== true) return false;
    if (state.boundaries.requiresExplicitEnablement !== true) return false;
    if (state.boundaries.requiresEndpoint !== true) return false;
    if (state.status === 'ready' && !state.endpoint) return false;
    return true;
}

export function normalizeSearxngEndpoint(value: unknown): string | undefined {
    const text = normalizeOptionalText(value);
    if (!text) return undefined;
    try {
        const url = new URL(text);
        if (!/^https?:$/i.test(url.protocol)) return undefined;
        url.hash = '';
        url.search = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return undefined;
    }
}

export function clampSearxngLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8;
    return Math.max(1, Math.min(10, Math.floor(parsed)));
}

function buildState(input: {
    status: SearxngConnectorStatus;
    endpoint?: string;
    warnings: string[];
}): SearxngConnectorState {
    return {
        provider: 'searxng',
        status: input.status,
        endpoint: input.endpoint,
        warnings: input.warnings,
        boundaries: {
            doesNotRunProviderModel: true,
            doesNotRunPhotoshop: true,
            doesNotManageDocker: true,
            doesNotCreateDirectPhotoshopActions: true,
            requiresExplicitEnablement: true,
            requiresEndpoint: true
        }
    };
}

function normalizeConfig(config: SearxngConnectorConfig | undefined): Required<Pick<SearxngConnectorConfig, 'enabled' | 'language' | 'safeSearch' | 'page' | 'timeoutMs'>> & {
    endpoint?: string;
    fetchedAt?: string;
} {
    return {
        enabled: config?.enabled === true,
        endpoint: normalizeSearxngEndpoint(config?.endpoint),
        language: normalizeOptionalText(config?.language) || 'zh-CN',
        safeSearch: clampSafeSearch(config?.safeSearch),
        page: clampPage(config?.page),
        timeoutMs: clampTimeout(config?.timeoutMs),
        fetchedAt: normalizeOptionalText(config?.fetchedAt)
    };
}

function ensureTrailingSlash(endpoint: string): string {
    return endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
}

function inferIntent(query: DesignKnowledgeQuery): DesignKnowledgeResult['intent'] {
    if (Array.isArray(query.intents) && query.intents.length > 0) {
        return query.intents[0];
    }
    return 'reference';
}

function normalizeEngines(item: SearxngRawResult): string[] {
    const engines = Array.isArray(item.engines) ? item.engines : [item.engine];
    return engines
        .map((engine) => normalizeOptionalText(engine))
        .filter((engine): engine is string => Boolean(engine))
        .slice(0, 5);
}

function normalizeOptionalText(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return text || undefined;
}

function normalizeHttpUrl(value: unknown): string | undefined {
    const text = normalizeOptionalText(value);
    if (!text) return undefined;
    try {
        const url = new URL(text);
        if (!/^https?:$/i.test(url.protocol)) return undefined;
        url.hash = '';
        return url.toString();
    } catch {
        return undefined;
    }
}

function clampSafeSearch(value: unknown): 0 | 1 | 2 {
    const parsed = Number(value);
    if (parsed === 0 || parsed === 2) return parsed;
    return 1;
}

function clampPage(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.max(1, Math.min(20, Math.floor(parsed)));
}

function clampTimeout(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8000;
    return Math.max(1000, Math.min(30000, Math.floor(parsed)));
}

function hashStableId(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
}
