import {
    AGENT_ACCEPTANCE_MODE_IDS,
    buildAgentAcceptanceControlPlane,
    type AgentAcceptanceControlPlaneModeId,
    type AgentAcceptanceControlPlaneReport,
    type AgentAcceptanceControlPlaneRuntime
} from './agent-acceptance-control-plane';

export type AgentAcceptanceExecutionSuiteVersion = 'agent-acceptance-execution-suite/v0';

export type AgentAcceptanceSuiteSelection =
    | 'default_safe'
    | 'all_available'
    | 'real_provider_opt_in'
    | 'live_photoshop_preflight'
    | 'live_photoshop_disposable';

export interface BuildAgentAcceptanceExecutionSuiteInput {
    selection?: AgentAcceptanceSuiteSelection;
    optInFlags?: Record<string, boolean | string | undefined>;
    runtime?: AgentAcceptanceControlPlaneRuntime;
}

export interface AgentAcceptanceSuiteCommand {
    mode: AgentAcceptanceControlPlaneModeId;
    npmScript: string;
    command: string;
}

export interface AgentAcceptanceSuiteModePlan {
    mode: AgentAcceptanceControlPlaneModeId;
    controlPlane: AgentAcceptanceControlPlaneReport;
    command: AgentAcceptanceSuiteCommand | null;
    selected: boolean;
    runnable: boolean;
    qualityClaimAllowed: false;
    skipReason: string;
    safety: {
        canRunByDefault: boolean;
        touchesPhotoshop: boolean;
        writesPhotoshop: boolean;
        usesRealProvider: boolean;
        futureOnly: boolean;
    };
}

export interface AgentAcceptanceExecutionSuitePlan {
    version: AgentAcceptanceExecutionSuiteVersion;
    selection: AgentAcceptanceSuiteSelection;
    generatedAt: string;
    modes: AgentAcceptanceSuiteModePlan[];
    selectedCommands: AgentAcceptanceSuiteCommand[];
    boundaries: string[];
}

const MODE_NPM_SCRIPTS: Partial<Record<AgentAcceptanceControlPlaneModeId, string>> = {
    'offline-static': 'smoke:agent:acceptance',
    'desktop-fake-photoshop': 'smoke:agent:acceptance:desktop',
    'real-provider-fake-photoshop': 'smoke:agent:acceptance:real-provider',
    'live-photoshop-preflight': 'smoke:agent:acceptance:live-photoshop:preflight',
    'live-photoshop-disposable': 'smoke:agent:acceptance:live-photoshop'
};

export function buildAgentAcceptanceExecutionSuitePlan(
    input: BuildAgentAcceptanceExecutionSuiteInput = {}
): AgentAcceptanceExecutionSuitePlan {
    const selection = input.selection || 'default_safe';
    const modes = AGENT_ACCEPTANCE_MODE_IDS.map((mode) => {
        const controlPlane = buildAgentAcceptanceControlPlane({
            mode,
            optInFlags: input.optInFlags,
            runtime: input.runtime
        });
        const command = buildCommand(mode);
        const runnable = controlPlane.canRun && command !== null;
        const selected = shouldSelectMode(selection, controlPlane, runnable);

        return {
            mode,
            controlPlane,
            command,
            selected,
            runnable,
            qualityClaimAllowed: false as const,
            skipReason: buildSkipReason(selection, controlPlane, command, selected, runnable),
            safety: {
                canRunByDefault: controlPlane.canRunByDefault,
                touchesPhotoshop: controlPlane.touchesPhotoshop,
                writesPhotoshop: controlPlane.writesPhotoshop,
                usesRealProvider: controlPlane.usesRealProvider,
                futureOnly: controlPlane.status === 'future_not_supported'
            }
        };
    });

    return {
        version: 'agent-acceptance-execution-suite/v0',
        selection,
        generatedAt: new Date().toISOString(),
        modes,
        selectedCommands: modes
            .filter((mode) => mode.selected && mode.command)
            .map((mode) => mode.command as AgentAcceptanceSuiteCommand),
        boundaries: [
            'The default suite can run only offline-static and desktop-fake-photoshop modes.',
            'Real provider and live Photoshop modes require explicit opt-in and runtime readiness.',
            'This suite orchestrates acceptance commands only; it does not prove design quality.',
            'qualityClaimAllowed is always false because visual design quality needs a separate screenshot, pixel, model, or human review.',
            'live-provider-live-photoshop is future-only and is never selected by this suite.'
        ]
    };
}

export function formatAgentAcceptanceExecutionSuiteMarkdown(
    plan: AgentAcceptanceExecutionSuitePlan
): string {
    const lines = [
        '# Agent Acceptance Execution Suite',
        '',
        `- version: ${plan.version}`,
        `- generatedAt: ${plan.generatedAt}`,
        `- selection: ${plan.selection}`,
        `- selectedCommands: ${plan.selectedCommands.length}`,
        '',
        '## Selected Commands',
        ''
    ];

    if (plan.selectedCommands.length === 0) {
        lines.push('- none');
    } else {
        for (const command of plan.selectedCommands) {
            lines.push(`- ${command.mode}: ${command.command}`);
        }
    }

    lines.push('');
    lines.push('## Modes');
    lines.push('');

    for (const item of plan.modes) {
        lines.push(`### ${item.mode}`);
        lines.push(`- selected: ${item.selected}`);
        lines.push(`- runnable: ${item.runnable}`);
        lines.push(`- controlStatus: ${item.controlPlane.status}`);
        lines.push(`- npmScript: ${item.command?.npmScript || 'none'}`);
        lines.push(`- skipReason: ${item.skipReason || 'none'}`);
        lines.push(`- qualityClaimAllowed: ${item.qualityClaimAllowed}`);
        lines.push(`- touchesPhotoshop: ${item.safety.touchesPhotoshop}`);
        lines.push(`- writesPhotoshop: ${item.safety.writesPhotoshop}`);
        lines.push(`- usesRealProvider: ${item.safety.usesRealProvider}`);
        lines.push('');
    }

    lines.push('## Boundaries');
    for (const boundary of plan.boundaries) {
        lines.push(`- ${boundary}`);
    }

    return `${lines.join('\n')}\n`;
}

function buildCommand(mode: AgentAcceptanceControlPlaneModeId): AgentAcceptanceSuiteCommand | null {
    const npmScript = MODE_NPM_SCRIPTS[mode];
    if (!npmScript) return null;
    return {
        mode,
        npmScript,
        command: `npm run ${npmScript}`
    };
}

function shouldSelectMode(
    selection: AgentAcceptanceSuiteSelection,
    controlPlane: AgentAcceptanceControlPlaneReport,
    runnable: boolean
): boolean {
    if (!runnable) return false;

    switch (selection) {
        case 'default_safe':
            return controlPlane.canRunByDefault === true;
        case 'all_available':
            return controlPlane.status !== 'future_not_supported';
        case 'real_provider_opt_in':
            return controlPlane.mode === 'real-provider-fake-photoshop';
        case 'live_photoshop_preflight':
            return controlPlane.mode === 'live-photoshop-preflight';
        case 'live_photoshop_disposable':
            return controlPlane.mode === 'live-photoshop-disposable';
        default:
            return false;
    }
}

function buildSkipReason(
    selection: AgentAcceptanceSuiteSelection,
    controlPlane: AgentAcceptanceControlPlaneReport,
    command: AgentAcceptanceSuiteCommand | null,
    selected: boolean,
    runnable: boolean
): string {
    if (selected) return '';
    if (!command) return 'No supported execution command is exposed for this mode.';
    if (!controlPlane.canRun) {
        const missing = [
            ...controlPlane.missingOptInFlags,
            ...controlPlane.missingRuntime
        ].join(', ');
        return `Blocked by control plane: ${missing || controlPlane.status}.`;
    }
    if (!runnable) return 'Mode is not runnable by this suite.';
    return `Not selected by suite selection ${selection}.`;
}
