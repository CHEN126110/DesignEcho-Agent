import {
    buildAgentProviderObservationCapabilities,
    type AgentProviderObservationCapabilities
} from './agent-provider-observation-capabilities';
import type { ModelConfig } from './config/models.config';
import {
    buildDesignKnowledgeSettingsSummary,
    normalizeDesignKnowledgeSettings,
    type DesignKnowledgeRuntimeSettings,
    type DesignKnowledgeSettingsSummary
} from './design-knowledge-settings';
import {
    buildProviderNativeToolPlan,
    type ProviderNativeToolPlan
} from './provider-native-tools';

export type DesignKnowledgeRuntimeCapabilityStatus = 'ready' | 'watch' | 'disabled' | 'unknown';

export interface DesignKnowledgeRuntimeCapabilitySummary {
    status: DesignKnowledgeRuntimeCapabilityStatus;
    selectedModel?: {
        id: string;
        name: string;
        provider: string;
        apiModelId: string;
        supportsVision: boolean;
        supportsToolUse: boolean | undefined;
        supportsStreaming: boolean;
    };
    providerObservation: AgentProviderObservationCapabilities;
    providerNativeWebSearch: ProviderNativeToolPlan;
    searxng: DesignKnowledgeSettingsSummary;
    warnings: string[];
    boundaries: {
        readonlySummary: true;
        doesNotRunProvider: true;
        doesNotRunPhotoshop: true;
        doesNotSearchAutomatically: true;
        doesNotManageDocker: true;
        doesNotConvertProviderNativeToolToFunctionTool: true;
    };
}

export interface DesignKnowledgeRuntimeCapabilityInput {
    settings?: Partial<DesignKnowledgeRuntimeSettings> | null;
    model?: ModelConfig;
}

export function buildDesignKnowledgeRuntimeCapabilitySummary(
    input: DesignKnowledgeRuntimeCapabilityInput
): DesignKnowledgeRuntimeCapabilitySummary {
    const settings = normalizeDesignKnowledgeSettings(input.settings);
    const model = input.model;
    const providerObservation = buildAgentProviderObservationCapabilities({
        modelId: model?.id || 'unknown',
        apiModelId: model?.apiModelId,
        provider: model?.provider || 'unknown',
        supportsVision: model?.supportsVision,
        supportsToolUse: model?.supportsToolUse,
        supportsStreaming: model?.supportsStreaming,
        thinking: model?.thinking
    });
    const providerNativeWebSearch = buildProviderNativeToolPlan({
        provider: model?.provider || 'unknown',
        modelId: model?.apiModelId || model?.id || 'unknown',
        requestedTools: [
            {
                type: 'web_search',
                enabled: settings.xiaomiWebSearch.enabled,
                forceSearch: settings.xiaomiWebSearch.forceSearch,
                maxKeyword: settings.xiaomiWebSearch.maxKeyword,
                limit: settings.xiaomiWebSearch.limit,
                userLocation: settings.xiaomiWebSearch.userLocation
            }
        ]
    });
    const searxng = buildDesignKnowledgeSettingsSummary(settings);
    const warnings = buildWarnings(providerNativeWebSearch, searxng);

    return {
        status: buildStatus(providerNativeWebSearch, searxng),
        selectedModel: model
            ? {
                id: model.id,
                name: model.name,
                provider: model.provider,
                apiModelId: model.apiModelId,
                supportsVision: model.supportsVision,
                supportsToolUse: model.supportsToolUse,
                supportsStreaming: model.supportsStreaming
            }
            : undefined,
        providerObservation,
        providerNativeWebSearch,
        searxng,
        warnings,
        boundaries: {
            readonlySummary: true,
            doesNotRunProvider: true,
            doesNotRunPhotoshop: true,
            doesNotSearchAutomatically: true,
            doesNotManageDocker: true,
            doesNotConvertProviderNativeToolToFunctionTool: true
        }
    };
}

function buildStatus(
    providerNativeWebSearch: ProviderNativeToolPlan,
    searxng: DesignKnowledgeSettingsSummary
): DesignKnowledgeRuntimeCapabilityStatus {
    const hasEnabledButUnsupportedProviderNativeSearch = [
        'unsupported_provider',
        'unsupported_model'
    ].includes(providerNativeWebSearch.status);

    if (hasEnabledButUnsupportedProviderNativeSearch) return 'watch';
    if (providerNativeWebSearch.status === 'ready' || searxng.status === 'ready') return 'ready';
    if (providerNativeWebSearch.status === 'disabled' && searxng.status === 'disabled') return 'disabled';
    if (providerNativeWebSearch.status === 'not_requested' && searxng.status === 'disabled') return 'disabled';
    return 'watch';
}

function buildWarnings(
    providerNativeWebSearch: ProviderNativeToolPlan,
    searxng: DesignKnowledgeSettingsSummary
): string[] {
    const warnings = [
        ...providerNativeWebSearch.warnings,
        ...searxng.warnings
    ];

    if (providerNativeWebSearch.status === 'unsupported_provider') {
        warnings.push('Xiaomi Web Search 只能用于小米官方 provider，不能注入其他 provider。');
    }

    if (providerNativeWebSearch.status === 'unsupported_model') {
        warnings.push('当前模型不在 Xiaomi Web Search 支持列表中。');
    }

    return Array.from(new Set(warnings));
}
