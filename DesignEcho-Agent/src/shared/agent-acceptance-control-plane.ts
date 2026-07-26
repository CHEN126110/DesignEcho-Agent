export type AgentAcceptanceControlPlaneVersion = 'agent-acceptance-control-plane/v0';

export type AgentAcceptanceControlPlaneModeId =
    | 'offline-static'
    | 'desktop-fake-photoshop'
    | 'real-provider-fake-photoshop'
    | 'live-photoshop-preflight'
    | 'live-photoshop-disposable'
    | 'live-provider-live-photoshop';

export type AgentAcceptanceControlPlaneStatus =
    | 'available'
    | 'blocked_requires_opt_in'
    | 'blocked_missing_runtime'
    | 'future_not_supported';

export type AgentAcceptanceRuntimeRequirement =
    | 'agent_desktop_built'
    | 'uxp_plugin_connected'
    | 'photoshop_bridge_ready'
    | 'disposable_document_allowed';

export type AgentAcceptanceProof =
    | 'acceptance_contract_mapping'
    | 'shared_evaluator_report_shape'
    | 'chatpanel_runtime_bridge'
    | 'fake_tool_flow'
    | 'real_provider_request_path'
    | 'photoshop_bridge_readiness'
    | 'guarded_disposable_photoshop_write';

export type AgentAcceptanceNonProof =
    | 'desktop_ui_runtime'
    | 'agent_task_completion'
    | 'real_provider_quality'
    | 'real_photoshop_write'
    | 'open_ended_design_quality'
    | 'production_design_reliability';

export interface AgentAcceptanceControlPlaneRuntime {
    agentDesktopBuilt?: boolean;
    uxpPluginConnected?: boolean;
    photoshopBridgeReady?: boolean;
    disposableDocumentAllowed?: boolean;
}

export interface BuildAgentAcceptanceControlPlaneInput {
    mode: AgentAcceptanceControlPlaneModeId;
    optInFlags?: Record<string, boolean | string | undefined>;
    runtime?: AgentAcceptanceControlPlaneRuntime;
}

export interface AgentAcceptanceModePolicy {
    id: AgentAcceptanceControlPlaneModeId;
    script: string;
    description: string;
    canRunByDefault: boolean;
    touchesPhotoshop: boolean;
    writesPhotoshop: boolean;
    usesRealProvider: boolean;
    usesFakeProvider: boolean;
    usesFakePhotoshop: boolean;
    requiredOptInFlags: string[];
    requiredRuntime: AgentAcceptanceRuntimeRequirement[];
    proves: AgentAcceptanceProof[];
    doesNotProve: AgentAcceptanceNonProof[];
    boundaries: string[];
    futureOnly?: boolean;
}

export interface AgentAcceptanceControlPlaneReport {
    version: AgentAcceptanceControlPlaneVersion;
    mode: AgentAcceptanceControlPlaneModeId;
    status: AgentAcceptanceControlPlaneStatus;
    canRun: boolean;
    canRunByDefault: boolean;
    script: string;
    description: string;
    touchesPhotoshop: boolean;
    writesPhotoshop: boolean;
    usesRealProvider: boolean;
    usesFakeProvider: boolean;
    usesFakePhotoshop: boolean;
    requiredOptInFlags: string[];
    missingOptInFlags: string[];
    requiredRuntime: AgentAcceptanceRuntimeRequirement[];
    missingRuntime: AgentAcceptanceRuntimeRequirement[];
    proves: AgentAcceptanceProof[];
    doesNotProve: AgentAcceptanceNonProof[];
    boundaries: string[];
}

export const AGENT_ACCEPTANCE_MODE_IDS: AgentAcceptanceControlPlaneModeId[] = [
    'offline-static',
    'desktop-fake-photoshop',
    'real-provider-fake-photoshop',
    'live-photoshop-preflight',
    'live-photoshop-disposable',
    'live-provider-live-photoshop'
];

const MODE_POLICIES: Record<AgentAcceptanceControlPlaneModeId, AgentAcceptanceModePolicy> = {
    'offline-static': {
        id: 'offline-static',
        script: 'scripts/acceptance-run-agent-case.cjs',
        description: 'Synthetic acceptance evaluator smoke with no desktop, provider, or Photoshop dependency.',
        canRunByDefault: true,
        touchesPhotoshop: false,
        writesPhotoshop: false,
        usesRealProvider: false,
        usesFakeProvider: false,
        usesFakePhotoshop: false,
        requiredOptInFlags: [],
        requiredRuntime: [],
        proves: [
            'acceptance_contract_mapping',
            'shared_evaluator_report_shape'
        ],
        doesNotProve: [
            'desktop_ui_runtime',
            'real_provider_quality',
            'real_photoshop_write',
            'open_ended_design_quality',
            'production_design_reliability'
        ],
        boundaries: [
            'Runs only synthetic bundles through the shared acceptance evaluator.',
            'Does not launch Electron, call a model provider, or connect to Photoshop.'
        ]
    },
    'desktop-fake-photoshop': {
        id: 'desktop-fake-photoshop',
        script: 'scripts/acceptance-run-agent-desktop-case.cjs',
        description: 'Electron ChatPanel acceptance smoke with fake model and fake Photoshop bridge.',
        canRunByDefault: true,
        touchesPhotoshop: false,
        writesPhotoshop: false,
        usesRealProvider: false,
        usesFakeProvider: true,
        usesFakePhotoshop: true,
        requiredOptInFlags: [],
        requiredRuntime: [],
        proves: [
            'chatpanel_runtime_bridge',
            'fake_tool_flow'
        ],
        doesNotProve: [
            'real_provider_quality',
            'real_photoshop_write',
            'open_ended_design_quality',
            'production_design_reliability'
        ],
        boundaries: [
            'Validates ChatPanel test bridge and shared debug export with controlled fake runtime.',
            'Fake Photoshop results must not be treated as a real document write.'
        ]
    },
    'real-provider-fake-photoshop': {
        id: 'real-provider-fake-photoshop',
        script: 'scripts/acceptance-run-agent-real-provider-case.cjs',
        description: 'Real provider acceptance path with fake Photoshop to avoid document writes.',
        canRunByDefault: false,
        touchesPhotoshop: false,
        writesPhotoshop: false,
        usesRealProvider: true,
        usesFakeProvider: false,
        usesFakePhotoshop: true,
        requiredOptInFlags: [
            'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE=1',
            'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API=1'
        ],
        requiredRuntime: [],
        proves: [
            'real_provider_request_path',
            'chatpanel_runtime_bridge'
        ],
        doesNotProve: [
            'real_provider_quality',
            'real_photoshop_write',
            'open_ended_design_quality',
            'production_design_reliability'
        ],
        boundaries: [
            'Confirms that a real provider can enter the Agent request path when explicitly armed.',
            'Still uses fake Photoshop, so it cannot validate Photoshop tool behavior or design quality.'
        ]
    },
    'live-photoshop-preflight': {
        id: 'live-photoshop-preflight',
        script: 'scripts/acceptance-run-agent-live-photoshop-case.cjs --preflight',
        description: 'Read-only live Photoshop bridge readiness check.',
        canRunByDefault: false,
        touchesPhotoshop: true,
        writesPhotoshop: false,
        usesRealProvider: false,
        usesFakeProvider: false,
        usesFakePhotoshop: false,
        requiredOptInFlags: [],
        requiredRuntime: [
            'agent_desktop_built',
            'uxp_plugin_connected',
            'photoshop_bridge_ready'
        ],
        proves: [
            'photoshop_bridge_readiness'
        ],
        doesNotProve: [
            'agent_task_completion',
            'real_provider_quality',
            'real_photoshop_write',
            'open_ended_design_quality',
            'production_design_reliability'
        ],
        boundaries: [
            'Preflight reports live-environment readiness only.',
            'It must not be treated as proof that an Agent task completed.'
        ]
    },
    'live-photoshop-disposable': {
        id: 'live-photoshop-disposable',
        script: 'scripts/acceptance-run-agent-live-photoshop-case.cjs',
        description: 'Guarded live Photoshop acceptance with explicit takeover and disposable document flags.',
        canRunByDefault: false,
        touchesPhotoshop: true,
        writesPhotoshop: true,
        usesRealProvider: false,
        usesFakeProvider: true,
        usesFakePhotoshop: false,
        requiredOptInFlags: [
            'DESIGNECHO_LIVE_AGENT_ACCEPTANCE=1',
            'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER=1',
            'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT=1'
        ],
        requiredRuntime: [
            'agent_desktop_built',
            'uxp_plugin_connected',
            'photoshop_bridge_ready',
            'disposable_document_allowed'
        ],
        proves: [
            'chatpanel_runtime_bridge',
            'guarded_disposable_photoshop_write'
        ],
        doesNotProve: [
            'real_provider_quality',
            'open_ended_design_quality',
            'production_design_reliability'
        ],
        boundaries: [
            'Writes only to runner-created disposable Photoshop documents after explicit opt-in.',
            'Validates controlled tool execution, not open-ended design quality.'
        ]
    },
    'live-provider-live-photoshop': {
        id: 'live-provider-live-photoshop',
        script: 'not-supported',
        description: 'Future full live provider plus live Photoshop acceptance mode.',
        canRunByDefault: false,
        touchesPhotoshop: true,
        writesPhotoshop: true,
        usesRealProvider: true,
        usesFakeProvider: false,
        usesFakePhotoshop: false,
        requiredOptInFlags: [
            'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE=1',
            'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API=1',
            'DESIGNECHO_LIVE_AGENT_ACCEPTANCE=1',
            'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER=1',
            'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT=1'
        ],
        requiredRuntime: [
            'agent_desktop_built',
            'uxp_plugin_connected',
            'photoshop_bridge_ready',
            'disposable_document_allowed'
        ],
        proves: [],
        doesNotProve: [
            'real_provider_quality',
            'real_photoshop_write',
            'open_ended_design_quality',
            'production_design_reliability'
        ],
        boundaries: [
            'This mode is intentionally not supported until the lower-risk acceptance modes are stable.',
            'It must not be exposed as a runnable maintenance command.'
        ],
        futureOnly: true
    }
};

export function buildAgentAcceptanceControlPlane(
    input: BuildAgentAcceptanceControlPlaneInput
): AgentAcceptanceControlPlaneReport {
    const policy = MODE_POLICIES[input.mode];
    const missingOptInFlags = findMissingOptInFlags(policy.requiredOptInFlags, input.optInFlags);
    const missingRuntime = findMissingRuntime(policy.requiredRuntime, input.runtime);
    const status = deriveStatus(policy, missingOptInFlags, missingRuntime);

    return {
        version: 'agent-acceptance-control-plane/v0',
        mode: policy.id,
        status,
        canRun: status === 'available',
        canRunByDefault: policy.canRunByDefault && status === 'available',
        script: policy.script,
        description: policy.description,
        touchesPhotoshop: policy.touchesPhotoshop,
        writesPhotoshop: policy.writesPhotoshop,
        usesRealProvider: policy.usesRealProvider,
        usesFakeProvider: policy.usesFakeProvider,
        usesFakePhotoshop: policy.usesFakePhotoshop,
        requiredOptInFlags: [...policy.requiredOptInFlags],
        missingOptInFlags,
        requiredRuntime: [...policy.requiredRuntime],
        missingRuntime,
        proves: [...policy.proves],
        doesNotProve: [...policy.doesNotProve],
        boundaries: [...policy.boundaries]
    };
}

export function listAgentAcceptanceControlPlaneReports(): AgentAcceptanceControlPlaneReport[] {
    return AGENT_ACCEPTANCE_MODE_IDS.map((mode) => buildAgentAcceptanceControlPlane({ mode }));
}

function deriveStatus(
    policy: AgentAcceptanceModePolicy,
    missingOptInFlags: string[],
    missingRuntime: AgentAcceptanceRuntimeRequirement[]
): AgentAcceptanceControlPlaneStatus {
    if (policy.futureOnly) return 'future_not_supported';
    if (missingOptInFlags.length > 0) return 'blocked_requires_opt_in';
    if (missingRuntime.length > 0) return 'blocked_missing_runtime';
    return 'available';
}

function findMissingOptInFlags(
    requiredFlags: string[],
    providedFlags: BuildAgentAcceptanceControlPlaneInput['optInFlags']
): string[] {
    return requiredFlags.filter((flag) => {
        const key = flag.split('=')[0];
        const value = providedFlags?.[key];
        return value !== true && value !== '1';
    });
}

function findMissingRuntime(
    requiredRuntime: AgentAcceptanceRuntimeRequirement[],
    runtime: AgentAcceptanceControlPlaneRuntime | undefined
): AgentAcceptanceRuntimeRequirement[] {
    return requiredRuntime.filter((requirement) => !isRuntimeRequirementMet(requirement, runtime));
}

function isRuntimeRequirementMet(
    requirement: AgentAcceptanceRuntimeRequirement,
    runtime: AgentAcceptanceControlPlaneRuntime | undefined
): boolean {
    if (!runtime) return false;
    switch (requirement) {
        case 'agent_desktop_built':
            return runtime.agentDesktopBuilt === true;
        case 'uxp_plugin_connected':
            return runtime.uxpPluginConnected === true;
        case 'photoshop_bridge_ready':
            return runtime.photoshopBridgeReady === true;
        case 'disposable_document_allowed':
            return runtime.disposableDocumentAllowed === true;
        default:
            return false;
    }
}
