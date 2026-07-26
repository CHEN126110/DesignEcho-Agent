export type AgentAcceptanceRequestedMode =
    | 'production'
    | 'developer_acceptance'
    | 'automated_smoke';

export type AgentAcceptanceAudience =
    | 'end_user'
    | 'developer';

export type AgentAcceptanceRuntimeBlocker =
    | 'explicit_acceptance_opt_in_required';

export interface AgentAcceptanceRuntimeModeInput {
    requestedMode?: AgentAcceptanceRequestedMode;
    explicitAcceptanceOptIn?: boolean;
    allowRealProvider?: boolean;
    allowLivePhotoshop?: boolean;
}

export interface AgentAcceptanceRuntimeMode {
    version: 'agent-acceptance-runtime-mode/v0';
    mode: AgentAcceptanceRequestedMode;
    requestedMode: AgentAcceptanceRequestedMode;
    audience: AgentAcceptanceAudience;
    canRunCodexDrivenAgentAcceptance: boolean;
    canSpendExtraValidationTokens: boolean;
    canUseRealProvider: boolean;
    canUseLivePhotoshop: boolean;
    canExposeTechnicalDiagnosticsToUser: false;
    canExposeTechnicalDiagnosticsToDeveloper: boolean;
    userFacingTelemetryLevel: 'clean' | 'diagnostic';
    mustKeepSeparateFromProduction: true;
    mustNotDisplayAsProviderThinking: true;
    mustNotPersistDiagnosticsInUserHistory: true;
    requiredLabels: string[];
    blockers: AgentAcceptanceRuntimeBlocker[];
}

function normalizeRequestedMode(value: unknown): AgentAcceptanceRequestedMode {
    if (value === 'developer_acceptance') return 'developer_acceptance';
    if (value === 'automated_smoke') return 'automated_smoke';
    return 'production';
}

function buildProductionMode(
    requestedMode: AgentAcceptanceRequestedMode,
    blockers: AgentAcceptanceRuntimeBlocker[] = []
): AgentAcceptanceRuntimeMode {
    return {
        version: 'agent-acceptance-runtime-mode/v0',
        mode: 'production',
        requestedMode,
        audience: 'end_user',
        canRunCodexDrivenAgentAcceptance: false,
        canSpendExtraValidationTokens: false,
        canUseRealProvider: false,
        canUseLivePhotoshop: false,
        canExposeTechnicalDiagnosticsToUser: false,
        canExposeTechnicalDiagnosticsToDeveloper: false,
        userFacingTelemetryLevel: 'clean',
        mustKeepSeparateFromProduction: true,
        mustNotDisplayAsProviderThinking: true,
        mustNotPersistDiagnosticsInUserHistory: true,
        requiredLabels: ['production'],
        blockers
    };
}

export function buildAgentAcceptanceRuntimeMode(
    input: AgentAcceptanceRuntimeModeInput = {}
): AgentAcceptanceRuntimeMode {
    const requestedMode = normalizeRequestedMode(input.requestedMode);

    if (requestedMode === 'production') {
        return buildProductionMode(requestedMode);
    }

    if (input.explicitAcceptanceOptIn !== true) {
        return buildProductionMode(requestedMode, ['explicit_acceptance_opt_in_required']);
    }

    if (requestedMode === 'automated_smoke') {
        return {
            version: 'agent-acceptance-runtime-mode/v0',
            mode: 'automated_smoke',
            requestedMode,
            audience: 'developer',
            canRunCodexDrivenAgentAcceptance: false,
            canSpendExtraValidationTokens: false,
            canUseRealProvider: false,
            canUseLivePhotoshop: false,
            canExposeTechnicalDiagnosticsToUser: false,
            canExposeTechnicalDiagnosticsToDeveloper: true,
            userFacingTelemetryLevel: 'diagnostic',
            mustKeepSeparateFromProduction: true,
            mustNotDisplayAsProviderThinking: true,
            mustNotPersistDiagnosticsInUserHistory: true,
            requiredLabels: ['developer-mode', 'automated-smoke'],
            blockers: []
        };
    }

    return {
        version: 'agent-acceptance-runtime-mode/v0',
        mode: 'developer_acceptance',
        requestedMode,
        audience: 'developer',
        canRunCodexDrivenAgentAcceptance: true,
        canSpendExtraValidationTokens: true,
        canUseRealProvider: input.allowRealProvider === true,
        canUseLivePhotoshop: input.allowLivePhotoshop === true,
        canExposeTechnicalDiagnosticsToUser: false,
        canExposeTechnicalDiagnosticsToDeveloper: true,
        userFacingTelemetryLevel: 'diagnostic',
        mustKeepSeparateFromProduction: true,
        mustNotDisplayAsProviderThinking: true,
        mustNotPersistDiagnosticsInUserHistory: true,
        requiredLabels: ['developer-mode', 'codex-agent-acceptance'],
        blockers: []
    };
}

export function summarizeAgentAcceptanceRuntimeMode(mode: AgentAcceptanceRuntimeMode): string {
    const provider = mode.canUseRealProvider ? 'real provider allowed' : 'real provider disabled';
    const photoshop = mode.canUseLivePhotoshop ? 'live Photoshop allowed' : 'live Photoshop disabled';
    return [
        `mode=${mode.mode}`,
        `audience=${mode.audience}`,
        provider,
        photoshop,
        'developer diagnostics are not user-facing',
        'not user-facing'
    ].join('; ');
}
