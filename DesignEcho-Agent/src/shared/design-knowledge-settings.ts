import {
    buildSearxngConnectorStatus,
    normalizeSearxngEndpoint,
    type SearxngConnectorConfig,
    type SearxngConnectorStatus
} from './searxng-design-knowledge';

export interface DesignKnowledgeRuntimeSettings {
    searxng: {
        enabled: boolean;
        endpoint: string;
        language: string;
        safeSearch: 0 | 1 | 2;
        timeoutMs: number;
    };
    xiaomiWebSearch: {
        enabled: boolean;
        forceSearch: boolean;
        maxKeyword: number;
        limit: number;
        userLocation: string;
    };
}

export interface DesignKnowledgeSettingsSummary {
    provider: 'searxng';
    status: SearxngConnectorStatus;
    enabled: boolean;
    endpoint?: string;
    warnings: string[];
    boundaries: {
        settingsOnly: true;
        doesNotRunSearchAutomatically: true;
        doesNotRunPhotoshop: true;
        doesNotManageDocker: true;
    };
}

export const DEFAULT_DESIGN_KNOWLEDGE_SETTINGS: DesignKnowledgeRuntimeSettings = {
    searxng: {
        enabled: false,
        endpoint: '',
        language: 'zh-CN',
        safeSearch: 1,
        timeoutMs: 8000
    },
    xiaomiWebSearch: {
        enabled: false,
        forceSearch: false,
        maxKeyword: 3,
        limit: 5,
        userLocation: ''
    }
};

export function normalizeDesignKnowledgeSettings(input?: Partial<DesignKnowledgeRuntimeSettings> | null): DesignKnowledgeRuntimeSettings {
    const searxng: Partial<DesignKnowledgeRuntimeSettings['searxng']> = input?.searxng || {};
    const xiaomiWebSearch: Partial<DesignKnowledgeRuntimeSettings['xiaomiWebSearch']> = input?.xiaomiWebSearch || {};
    return {
        searxng: {
            enabled: searxng.enabled === true,
            endpoint: normalizeSearxngEndpoint(searxng.endpoint) || '',
            language: normalizeLanguage(searxng.language),
            safeSearch: normalizeSafeSearch(searxng.safeSearch),
            timeoutMs: normalizeTimeoutMs(searxng.timeoutMs)
        },
        xiaomiWebSearch: {
            enabled: xiaomiWebSearch.enabled === true,
            forceSearch: xiaomiWebSearch.forceSearch === true,
            maxKeyword: normalizeInteger(
                xiaomiWebSearch.maxKeyword,
                1,
                5,
                DEFAULT_DESIGN_KNOWLEDGE_SETTINGS.xiaomiWebSearch.maxKeyword
            ),
            limit: normalizeInteger(
                xiaomiWebSearch.limit,
                1,
                10,
                DEFAULT_DESIGN_KNOWLEDGE_SETTINGS.xiaomiWebSearch.limit
            ),
            userLocation: normalizeOptionalText(xiaomiWebSearch.userLocation) || ''
        }
    };
}

export function toSearxngConnectorConfig(settings?: Partial<DesignKnowledgeRuntimeSettings> | null): SearxngConnectorConfig {
    const normalized = normalizeDesignKnowledgeSettings(settings);
    return {
        enabled: normalized.searxng.enabled,
        endpoint: normalized.searxng.endpoint,
        language: normalized.searxng.language,
        safeSearch: normalized.searxng.safeSearch,
        timeoutMs: normalized.searxng.timeoutMs
    };
}

export function buildDesignKnowledgeSettingsSummary(
    settings?: Partial<DesignKnowledgeRuntimeSettings> | null
): DesignKnowledgeSettingsSummary {
    const normalized = normalizeDesignKnowledgeSettings(settings);
    const state = buildSearxngConnectorStatus(toSearxngConnectorConfig(normalized));
    return {
        provider: 'searxng',
        status: state.status,
        enabled: normalized.searxng.enabled,
        endpoint: state.endpoint,
        warnings: state.warnings,
        boundaries: {
            settingsOnly: true,
            doesNotRunSearchAutomatically: true,
            doesNotRunPhotoshop: true,
            doesNotManageDocker: true
        }
    };
}

function normalizeLanguage(value: unknown): string {
    const text = String(value || '').trim();
    return text || DEFAULT_DESIGN_KNOWLEDGE_SETTINGS.searxng.language;
}

function normalizeSafeSearch(value: unknown): 0 | 1 | 2 {
    const parsed = Number(value);
    if (parsed === 0 || parsed === 2) return parsed;
    return 1;
}

function normalizeTimeoutMs(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_DESIGN_KNOWLEDGE_SETTINGS.searxng.timeoutMs;
    if (parsed <= 0) return DEFAULT_DESIGN_KNOWLEDGE_SETTINGS.searxng.timeoutMs;
    return Math.max(1000, Math.min(30000, Math.floor(parsed)));
}

function normalizeInteger(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeOptionalText(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return text || undefined;
}
