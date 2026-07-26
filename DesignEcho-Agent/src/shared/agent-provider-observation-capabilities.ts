import type { ModelProvider, ThinkingConfig, ThinkingFormat } from './config/models.config';

export type AgentProviderObservationCapabilitiesVersion = 'agent-provider-observation-capabilities/v0';

export type AgentProviderObservationStatus =
    | 'supported'
    | 'unsupported'
    | 'unknown';

export type AgentProviderToolStreamMode =
    | 'stream'
    | 'fallback'
    | 'unsupported'
    | 'unknown';

export type AgentProviderCapabilityBasis =
    | 'model-config'
    | 'runtime-implementation'
    | 'provider-adapter'
    | 'conservative-default';

export interface AgentProviderObservationCapabilityInput {
    modelId: string;
    apiModelId?: string;
    provider?: ModelProvider | string;
    supportsVision?: boolean;
    supportsToolUse?: boolean;
    supportsStreaming?: boolean;
    thinking?: Partial<ThinkingConfig>;
}

export interface AgentProviderObservationSignal {
    status: AgentProviderObservationStatus;
    basis: AgentProviderCapabilityBasis;
    reason: string;
    observationSource?: 'provider_thinking_delta' | 'provider_final_thinking' | 'model_visible_reasoning';
}

export interface AgentProviderToolStreamCapability {
    mode: AgentProviderToolStreamMode;
    status: AgentProviderObservationStatus;
    basis: AgentProviderCapabilityBasis;
    reason: string;
    chunkTypes: string[];
}

export interface AgentProviderObservationCapabilities {
    version: AgentProviderObservationCapabilitiesVersion;
    modelId: string;
    apiModelId?: string;
    provider: string;
    supportsVision: AgentProviderObservationSignal;
    supportsToolUse: AgentProviderObservationSignal;
    contentStream: AgentProviderObservationSignal;
    toolStream: AgentProviderToolStreamCapability;
    toolEvents: AgentProviderObservationSignal;
    providerThinkingDelta: AgentProviderObservationSignal;
    finalProviderThinking: AgentProviderObservationSignal;
    modelVisibleReasoning: AgentProviderObservationSignal;
    thinkingFormat: ThinkingFormat | 'unknown';
    observationSources: string[];
    warnings: string[];
    boundaries: {
        doesNotFabricateThinking: true;
        toolEventsAreNotThinking: true;
        modelVisibleReasoningIsPublicText: true;
        capabilityMatrixDoesNotRunProvider: true;
        capabilityMatrixDoesNotRunPhotoshop: true;
    };
}

const OPENAI_COMPATIBLE_TOOL_STREAM_PROVIDERS = new Set([
    'openai',
    'xiaomi',
    'gptsapi',
    'deepseek'
]);

const OPENROUTER_TOOL_STREAM_PROVIDERS = new Set([
    'openrouter'
]);

const FALLBACK_TOOL_STREAM_PROVIDERS = new Set([
    'google',
    'anthropic',
    'ollama',
    'ollama-cloud'
]);

export function buildAgentProviderObservationCapabilities(
    input: AgentProviderObservationCapabilityInput
): AgentProviderObservationCapabilities {
    const provider = normalizeProvider(input.provider);
    const supportsToolUse = buildBooleanSignal(input.supportsToolUse, {
        supported: 'Model config explicitly allows tool calling.',
        unsupported: 'Model config explicitly disables tool calling.',
        unknown: 'Model config does not explicitly declare tool-calling support.'
    });
    const contentStream = buildBooleanSignal(input.supportsStreaming, {
        supported: 'Model config explicitly allows plain text streaming.',
        unsupported: 'Model config explicitly disables streaming.',
        unknown: 'Model config does not explicitly declare streaming support.'
    });
    const supportsVision = buildBooleanSignal(input.supportsVision, {
        supported: 'Model config explicitly declares vision support.',
        unsupported: 'Model config does not declare vision support.',
        unknown: 'Model config does not explicitly declare vision support.'
    });
    const toolStream = buildToolStreamCapability(provider, input.supportsStreaming, input.supportsToolUse);
    const thinkingFormat = normalizeThinkingFormat(input.thinking?.format);
    const providerThinkingDelta = buildProviderThinkingDelta(provider, toolStream, input.thinking);
    const finalProviderThinking = buildFinalProviderThinking(provider, input.thinking);
    const toolEvents = buildToolEventsSignal(input.supportsToolUse, toolStream);
    const modelVisibleReasoning = buildModelVisibleReasoningSignal();
    const warnings = buildWarnings({
        provider,
        supportsToolUse: input.supportsToolUse,
        supportsStreaming: input.supportsStreaming,
        toolStream,
        providerThinkingDelta
    });

    return {
        version: 'agent-provider-observation-capabilities/v0',
        modelId: input.modelId,
        apiModelId: input.apiModelId,
        provider,
        supportsVision,
        supportsToolUse,
        contentStream,
        toolStream,
        toolEvents,
        providerThinkingDelta,
        finalProviderThinking,
        modelVisibleReasoning,
        thinkingFormat,
        observationSources: buildObservationSources(providerThinkingDelta, finalProviderThinking, modelVisibleReasoning),
        warnings,
        boundaries: {
            doesNotFabricateThinking: true,
            toolEventsAreNotThinking: true,
            modelVisibleReasoningIsPublicText: true,
            capabilityMatrixDoesNotRunProvider: true,
            capabilityMatrixDoesNotRunPhotoshop: true
        }
    };
}

export function buildAgentProviderObservationCapabilityMatrix(
    models: AgentProviderObservationCapabilityInput[]
): AgentProviderObservationCapabilities[] {
    return models.map((model) => buildAgentProviderObservationCapabilities(model));
}

export function isProviderObservationCapabilityBoundaryOk(
    capability: AgentProviderObservationCapabilities | undefined
): boolean {
    if (!capability) return false;
    if (capability.boundaries.doesNotFabricateThinking !== true) return false;
    if (capability.boundaries.toolEventsAreNotThinking !== true) return false;
    if (capability.boundaries.modelVisibleReasoningIsPublicText !== true) return false;
    if (capability.boundaries.capabilityMatrixDoesNotRunProvider !== true) return false;
    if (capability.boundaries.capabilityMatrixDoesNotRunPhotoshop !== true) return false;
    if (capability.toolEvents.observationSource === 'provider_thinking_delta') return false;
    if (capability.modelVisibleReasoning.observationSource !== 'model_visible_reasoning') return false;
    if (capability.providerThinkingDelta.status !== 'supported' && capability.observationSources.includes('provider_thinking_delta')) return false;
    return true;
}

function normalizeProvider(provider: AgentProviderObservationCapabilityInput['provider']): string {
    return String(provider || 'unknown').trim() || 'unknown';
}

function normalizeThinkingFormat(format: Partial<ThinkingConfig>['format']): ThinkingFormat | 'unknown' {
    if (!format) return 'unknown';
    return format;
}

function buildBooleanSignal(
    value: boolean | undefined,
    reasons: { supported: string; unsupported: string; unknown: string }
): AgentProviderObservationSignal {
    if (value === true) {
        return {
            status: 'supported',
            basis: 'model-config',
            reason: reasons.supported
        };
    }

    if (value === false) {
        return {
            status: 'unsupported',
            basis: 'model-config',
            reason: reasons.unsupported
        };
    }

    return {
        status: 'unknown',
        basis: 'conservative-default',
        reason: reasons.unknown
    };
}

function buildToolStreamCapability(
    provider: string,
    supportsStreaming: boolean | undefined,
    supportsToolUse: boolean | undefined
): AgentProviderToolStreamCapability {
    if (supportsToolUse === false) {
        return {
            mode: 'unsupported',
            status: 'unsupported',
            basis: 'model-config',
            reason: 'Model config explicitly disables tool calling.',
            chunkTypes: []
        };
    }

    if (supportsStreaming === false) {
        return {
            mode: 'unsupported',
            status: 'unsupported',
            basis: 'model-config',
            reason: 'Model config explicitly disables streaming.',
            chunkTypes: []
        };
    }

    if (OPENAI_COMPATIBLE_TOOL_STREAM_PROVIDERS.has(provider) || OPENROUTER_TOOL_STREAM_PROVIDERS.has(provider)) {
        return {
            mode: 'stream',
            status: 'supported',
            basis: 'runtime-implementation',
            reason: 'ModelService has an implemented tool stream path for this provider family.',
            chunkTypes: [
                'content_delta',
                'thinking_delta',
                'tool_call_delta',
                'tool_call_ready',
                'done',
                'error'
            ]
        };
    }

    if (FALLBACK_TOOL_STREAM_PROVIDERS.has(provider)) {
        return {
            mode: 'fallback',
            status: 'supported',
            basis: 'runtime-implementation',
            reason: 'Tool calling can run through chatWithTools fallback, but token-level tool streaming is not implemented.',
            chunkTypes: [
                'done',
                'error'
            ]
        };
    }

    return {
        mode: 'unknown',
        status: 'unknown',
        basis: 'conservative-default',
        reason: 'Provider tool streaming path is not classified.',
        chunkTypes: []
    };
}

function buildToolEventsSignal(
    supportsToolUse: boolean | undefined,
    toolStream: AgentProviderToolStreamCapability
): AgentProviderObservationSignal {
    if (supportsToolUse === false || toolStream.mode === 'unsupported') {
        return {
            status: 'unsupported',
            basis: 'model-config',
            reason: 'Tool events cannot be expected when tool calling is disabled.'
        };
    }

    if (supportsToolUse === true) {
        return {
            status: 'supported',
            basis: toolStream.basis,
            reason: 'Tool events are available as tool_call_delta/tool_call_ready or fallback final toolCalls.'
        };
    }

    return {
        status: 'unknown',
        basis: 'conservative-default',
        reason: 'Tool event support is unknown because supportsToolUse is not explicit.'
    };
}

function buildProviderThinkingDelta(
    provider: string,
    toolStream: AgentProviderToolStreamCapability,
    thinking: Partial<ThinkingConfig> | undefined
): AgentProviderObservationSignal {
    if (toolStream.mode !== 'stream') {
        return {
            status: 'unsupported',
            basis: 'runtime-implementation',
            reason: 'Provider thinking delta requires an implemented token-level tool stream path.',
            observationSource: 'provider_thinking_delta'
        };
    }

    if (thinking?.supported === true && thinking.format === 'reasoning_content') {
        return {
            status: 'supported',
            basis: 'runtime-implementation',
            reason: `Provider ${provider} uses an implemented stream path and model config declares reasoning_content thinking.`,
            observationSource: 'provider_thinking_delta'
        };
    }

    if (thinking?.supported === false || thinking?.format === 'none') {
        return {
            status: 'unsupported',
            basis: 'model-config',
            reason: 'Model config does not declare provider thinking support.',
            observationSource: 'provider_thinking_delta'
        };
    }

    return {
        status: 'unknown',
        basis: 'conservative-default',
        reason: 'Provider thinking delta support is not verified for this model.',
        observationSource: 'provider_thinking_delta'
    };
}

function buildFinalProviderThinking(
    provider: string,
    thinking: Partial<ThinkingConfig> | undefined
): AgentProviderObservationSignal {
    if (thinking?.supported === true && thinking.format && thinking.format !== 'none') {
        return {
            status: 'supported',
            basis: 'model-config',
            reason: 'Model config declares provider thinking support; final response thinking may be exposed when the adapter returns it.',
            observationSource: 'provider_final_thinking'
        };
    }

    if (thinking?.supported === false || thinking?.format === 'none') {
        return {
            status: 'unsupported',
            basis: 'model-config',
            reason: 'Model config does not declare final provider thinking support.',
            observationSource: 'provider_final_thinking'
        };
    }

    return {
        status: 'unknown',
        basis: 'conservative-default',
        reason: 'Final provider thinking support is not declared.',
        observationSource: 'provider_final_thinking'
    };
}

function buildModelVisibleReasoningSignal(): AgentProviderObservationSignal {
    return {
        status: 'supported',
        basis: 'runtime-implementation',
        reason: 'The Agent can request a short public model-authored explanation as model_visible_reasoning; this is not provider thinking.',
        observationSource: 'model_visible_reasoning'
    };
}

function buildObservationSources(
    providerThinkingDelta: AgentProviderObservationSignal,
    finalProviderThinking: AgentProviderObservationSignal,
    modelVisibleReasoning: AgentProviderObservationSignal
): string[] {
    const sources: string[] = [];
    if (providerThinkingDelta.status === 'supported') {
        sources.push('provider_thinking_delta');
    }
    if (finalProviderThinking.status === 'supported') {
        sources.push('provider_final_thinking');
    }
    if (modelVisibleReasoning.status === 'supported') {
        sources.push('model_visible_reasoning');
    }
    return sources;
}

function buildWarnings(input: {
    provider: string;
    supportsToolUse: boolean | undefined;
    supportsStreaming: boolean | undefined;
    toolStream: AgentProviderToolStreamCapability;
    providerThinkingDelta: AgentProviderObservationSignal;
}): string[] {
    const warnings: string[] = [];

    if (input.supportsToolUse === undefined) {
        warnings.push('supportsToolUse is undefined; do not treat tool calling as verified.');
    }

    if (input.supportsStreaming === undefined) {
        warnings.push('supportsStreaming is undefined; do not treat token streaming as verified.');
    }

    if (input.toolStream.mode === 'fallback') {
        warnings.push('tool stream fallback only returns final response events, not token-level tool deltas.');
    }

    if (input.providerThinkingDelta.status !== 'supported') {
        warnings.push('provider_thinking_delta is unavailable; UI must not show a local placeholder as thinking.');
    }

    return warnings;
}
