export type ProviderNativeToolsVersion = 'provider-native-tools/v0';

export type ProviderNativeToolType = 'web_search';

export type ProviderNativeToolPlanStatus =
    | 'ready'
    | 'disabled'
    | 'not_requested'
    | 'unsupported_provider'
    | 'unsupported_model';

export interface ProviderNativeWebSearchRequest {
    type: 'web_search';
    max_keyword?: number;
    force_search?: boolean;
    limit?: number;
    user_location?: ProviderNativeWebSearchUserLocation;
}

export type ProviderNativeToolRequest = ProviderNativeWebSearchRequest;

export interface ProviderNativeWebSearchUserLocation {
    type: 'approximate';
    country?: string;
    region?: string;
    city?: string;
}

export interface ProviderNativeWebSearchIntent {
    type: 'web_search';
    enabled?: boolean;
    maxKeyword?: number;
    forceSearch?: boolean;
    limit?: number;
    userLocation?: string | Partial<ProviderNativeWebSearchUserLocation>;
}

export type ProviderNativeToolIntent = ProviderNativeWebSearchIntent;

export interface ProviderNativeToolPlanInput {
    provider: string;
    modelId: string;
    requestedTools?: ProviderNativeToolIntent[];
}

export interface ProviderNativeToolPlan {
    version: ProviderNativeToolsVersion;
    provider: string;
    modelId: string;
    status: ProviderNativeToolPlanStatus;
    nativeTools: ProviderNativeToolRequest[];
    warnings: string[];
    boundaries: {
        doesNotRunProvider: true;
        doesNotRunPhotoshop: true;
        doesNotConvertToFunctionTool: true;
        requiresExplicitEnablement: true;
        citationsRequiredForKnowledgeUse: true;
    };
}

export interface ProviderNativeToolCitation {
    provider: string;
    type: 'url_citation';
    title?: string;
    url: string;
    summary?: string;
    siteName?: string;
    publishTime?: string;
    logoUrl?: string;
    fetchedAt: string;
}

export interface ProviderNativeToolUsage {
    provider: string;
    toolType: ProviderNativeToolType;
    rawUsage?: unknown;
}

const XIAOMI_WEB_SEARCH_MODELS = new Set([
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'mimo-v2-flash'
]);

export function buildProviderNativeToolPlan(input: ProviderNativeToolPlanInput): ProviderNativeToolPlan {
    const provider = normalizeText(input.provider);
    const modelId = normalizeText(input.modelId);
    const webSearchIntent = findWebSearchIntent(input.requestedTools);

    if (!webSearchIntent) {
        return buildPlan({
            provider,
            modelId,
            status: 'not_requested',
            nativeTools: [],
            warnings: ['No provider-native tool was requested.']
        });
    }

    if (webSearchIntent.enabled !== true) {
        return buildPlan({
            provider,
            modelId,
            status: 'disabled',
            nativeTools: [],
            warnings: ['Provider-native web_search is disabled by settings or request policy.']
        });
    }

    if (provider !== 'xiaomi') {
        return buildPlan({
            provider,
            modelId,
            status: 'unsupported_provider',
            nativeTools: [],
            warnings: ['Xiaomi MiMo web_search must not be injected into non-Xiaomi providers.']
        });
    }

    if (!XIAOMI_WEB_SEARCH_MODELS.has(modelId)) {
        return buildPlan({
            provider,
            modelId,
            status: 'unsupported_model',
            nativeTools: [],
            warnings: [`Model ${modelId || 'unknown'} is not in official MiMo Web Search support list.`]
        });
    }

    return buildPlan({
        provider,
        modelId,
        status: 'ready',
        nativeTools: [buildXiaomiWebSearchTool(webSearchIntent)],
        warnings: [
            'Provider-native web_search is planned only; callers must still verify API/plugin availability at runtime.',
            'Search results are knowledge context only and must not become direct Photoshop actions.'
        ]
    });
}

export function normalizeProviderNativeToolCitations(
    annotations: unknown,
    options: { provider: string; fetchedAt?: string }
): ProviderNativeToolCitation[] {
    if (!Array.isArray(annotations)) return [];

    const provider = normalizeText(options.provider);
    const fetchedAt = options.fetchedAt || new Date().toISOString();

    return annotations
        .map((annotation): ProviderNativeToolCitation | undefined => {
            const item = annotation as any;
            if (item?.type !== 'url_citation') return undefined;
            const nested = item.url_citation || {};
            const url = normalizeUrl(nested.url || item.url);
            if (!url) return undefined;
            return {
                provider,
                type: 'url_citation',
                title: normalizeOptionalText(nested.title || item.title),
                url,
                summary: normalizeOptionalText(nested.summary || item.summary),
                siteName: normalizeOptionalText(nested.site_name || nested.siteName || item.site_name || item.siteName),
                publishTime: normalizeOptionalText(nested.publish_time || nested.publishTime || item.publish_time || item.publishTime),
                logoUrl: normalizeUrl(nested.logo_url || nested.logoUrl || item.logo_url || item.logoUrl),
                fetchedAt
            };
        })
        .filter((item): item is ProviderNativeToolCitation => Boolean(item));
}

export function isProviderNativeToolPlanBoundaryOk(plan: ProviderNativeToolPlan | undefined): boolean {
    if (!plan) return false;
    if (plan.boundaries.doesNotRunProvider !== true) return false;
    if (plan.boundaries.doesNotRunPhotoshop !== true) return false;
    if (plan.boundaries.doesNotConvertToFunctionTool !== true) return false;
    if (plan.boundaries.requiresExplicitEnablement !== true) return false;
    if (plan.boundaries.citationsRequiredForKnowledgeUse !== true) return false;
    if (JSON.stringify(plan.nativeTools).includes('"function"')) return false;
    if (plan.status !== 'ready' && plan.nativeTools.length > 0) return false;
    return true;
}

export function getSupportedXiaomiWebSearchModels(): string[] {
    return Array.from(XIAOMI_WEB_SEARCH_MODELS);
}

function buildPlan(input: {
    provider: string;
    modelId: string;
    status: ProviderNativeToolPlanStatus;
    nativeTools: ProviderNativeToolRequest[];
    warnings: string[];
}): ProviderNativeToolPlan {
    return {
        version: 'provider-native-tools/v0',
        provider: input.provider,
        modelId: input.modelId,
        status: input.status,
        nativeTools: input.nativeTools,
        warnings: input.warnings,
        boundaries: {
            doesNotRunProvider: true,
            doesNotRunPhotoshop: true,
            doesNotConvertToFunctionTool: true,
            requiresExplicitEnablement: true,
            citationsRequiredForKnowledgeUse: true
        }
    };
}

function findWebSearchIntent(requestedTools: ProviderNativeToolIntent[] | undefined): ProviderNativeWebSearchIntent | undefined {
    if (!Array.isArray(requestedTools)) return undefined;
    return requestedTools.find((tool): tool is ProviderNativeWebSearchIntent => tool?.type === 'web_search');
}

function buildXiaomiWebSearchTool(intent: ProviderNativeWebSearchIntent): ProviderNativeWebSearchRequest {
    const tool: ProviderNativeWebSearchRequest = {
        type: 'web_search',
        max_keyword: clampInteger(intent.maxKeyword, 1, 5, 3),
        force_search: intent.forceSearch === true,
        limit: clampInteger(intent.limit, 1, 10, 5)
    };

    const userLocation = normalizeUserLocation(intent.userLocation);
    if (userLocation) {
        tool.user_location = userLocation;
    }

    return tool;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeText(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function normalizeOptionalText(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return text || undefined;
}

function normalizeUserLocation(value: unknown): ProviderNativeWebSearchUserLocation | undefined {
    if (!value) return undefined;

    if (typeof value === 'object') {
        const raw = value as Partial<ProviderNativeWebSearchUserLocation>;
        const country = normalizeOptionalText(raw.country);
        const region = normalizeOptionalText(raw.region);
        const city = normalizeOptionalText(raw.city);
        if (!country && !region && !city) return undefined;
        return {
            type: 'approximate',
            ...(country ? { country } : {}),
            ...(region ? { region } : {}),
            ...(city ? { city } : {})
        };
    }

    const text = normalizeOptionalText(value);
    if (!text) return undefined;
    const parts = text
        .split(/[,\uff0c/|>]+/)
        .map((part) => part.trim())
        .filter(Boolean);
    const [country, region, city] = parts.length > 1 ? parts : [text, undefined, undefined];
    return {
        type: 'approximate',
        ...(country ? { country } : {}),
        ...(region ? { region } : {}),
        ...(city ? { city } : {})
    };
}

function normalizeUrl(value: unknown): string | undefined {
    const url = normalizeOptionalText(value);
    if (!url) return undefined;
    if (!/^https?:\/\//i.test(url)) return undefined;
    return url;
}
