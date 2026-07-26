import {
    AGENT_ACCEPTANCE_MODE_IDS,
    buildAgentAcceptanceControlPlane,
    type AgentAcceptanceControlPlaneModeId,
    type AgentAcceptanceControlPlaneReport,
    type AgentAcceptanceControlPlaneRuntime
} from './agent-acceptance-control-plane';
import {
    buildLivePhotoshopAcceptanceIntake,
    type LivePhotoshopAcceptanceIntake
} from './live-photoshop-acceptance-intake';

export type AgentAcceptanceVerificationMatrixVersion = 'agent-acceptance-verification-matrix/v0';

export type AgentAcceptanceArtifactStatus =
    | 'not_found'
    | 'stale_for_mode'
    | 'skipped'
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'unknown';

export interface AgentAcceptanceRawArtifact {
    relativePath: string;
    exists: boolean;
    payload?: unknown;
    parseError?: string;
}

export interface AgentAcceptanceArtifactDigest {
    relativePath: string;
    exists: boolean;
    status: AgentAcceptanceArtifactStatus;
    mode: string | null;
    success: boolean | null;
    skipped: boolean;
    caseCount: number;
    failedCaseCount: number;
    blockerCount: number;
    summary: string;
    parseError?: string;
}

export interface BuildAgentAcceptanceVerificationMatrixInput {
    artifacts?: Partial<Record<AgentAcceptanceControlPlaneModeId, AgentAcceptanceRawArtifact>>;
    optInFlags?: Record<string, boolean | string | undefined>;
    runtime?: AgentAcceptanceControlPlaneRuntime;
}

export interface AgentAcceptanceVerificationModeSummary {
    mode: AgentAcceptanceControlPlaneModeId;
    controlPlane: AgentAcceptanceControlPlaneReport;
    artifact: AgentAcceptanceArtifactDigest;
    livePhotoshopIntake?: LivePhotoshopAcceptanceIntake;
    verificationReady: boolean;
    qualityClaimAllowed: false;
    nextAction: string;
}

export interface AgentAcceptanceVerificationMatrixReport {
    version: AgentAcceptanceVerificationMatrixVersion;
    generatedAt: string;
    modes: AgentAcceptanceVerificationModeSummary[];
    totals: {
        modeCount: number;
        verificationReadyCount: number;
        defaultRunnableCount: number;
        blockedCount: number;
        failedArtifactCount: number;
    };
    boundaries: string[];
}

const MODE_ARTIFACT_PATHS: Record<AgentAcceptanceControlPlaneModeId, string> = {
    'offline-static': 'tmp/acceptance/agent-acceptance-smoke.json',
    'desktop-fake-photoshop': 'tmp/acceptance/agent-desktop-acceptance-smoke.json',
    'real-provider-fake-photoshop': 'tmp/acceptance/agent-real-provider-acceptance.json',
    'live-photoshop-preflight': 'tmp/acceptance/agent-live-photoshop-acceptance.json',
    'live-photoshop-disposable': 'tmp/acceptance/agent-live-photoshop-acceptance.json',
    'live-provider-live-photoshop': 'not-supported'
};

const EXPECTED_ARTIFACT_MODES: Record<AgentAcceptanceControlPlaneModeId, string[]> = {
    'offline-static': [],
    'desktop-fake-photoshop': ['desktop-bridge-fake-provider-fake-photoshop'],
    'real-provider-fake-photoshop': [
        'guarded-real-provider-fake-photoshop',
        'desktop-bridge-real-provider-fake-photoshop'
    ],
    'live-photoshop-preflight': ['live-photoshop-preflight'],
    'live-photoshop-disposable': [
        'guarded-live-photoshop',
        'live-photoshop-disposable-document',
        'live-photoshop-deterministic-operations'
    ],
    'live-provider-live-photoshop': []
};

export function getAgentAcceptanceModeArtifactPath(
    mode: AgentAcceptanceControlPlaneModeId
): string {
    return MODE_ARTIFACT_PATHS[mode];
}

export function buildAgentAcceptanceVerificationMatrix(
    input: BuildAgentAcceptanceVerificationMatrixInput = {}
): AgentAcceptanceVerificationMatrixReport {
    const modes = AGENT_ACCEPTANCE_MODE_IDS.map((mode) => {
        const controlPlane = buildAgentAcceptanceControlPlane({
            mode,
            optInFlags: input.optInFlags,
            runtime: input.runtime
        });
        const artifact = summarizeArtifact(mode, input.artifacts?.[mode]);
        const livePhotoshopIntake = buildLivePhotoshopIntakeForMode(mode, input.artifacts?.[mode]);

        return {
            mode,
            controlPlane,
            artifact,
            livePhotoshopIntake,
            verificationReady: artifact.status === 'passed' || artifact.status === 'skipped',
            qualityClaimAllowed: false as const,
            nextAction: buildNextAction(controlPlane, artifact)
        };
    });

    return {
        version: 'agent-acceptance-verification-matrix/v0',
        generatedAt: new Date().toISOString(),
        modes,
        totals: {
            modeCount: modes.length,
            verificationReadyCount: modes.filter((mode) => mode.verificationReady).length,
            defaultRunnableCount: modes.filter((mode) => mode.controlPlane.canRunByDefault).length,
            blockedCount: modes.filter((mode) => !mode.controlPlane.canRun).length,
            failedArtifactCount: modes.filter((mode) => (
                mode.artifact.status === 'failed'
                || mode.artifact.status === 'blocked'
                || mode.artifact.status === 'stale_for_mode'
            )).length
        },
        boundaries: [
            'This matrix reads acceptance policy and artifacts only; it does not run providers or Photoshop.',
            'A passed artifact proves only the mode-specific boundary listed by the control plane.',
            'qualityClaimAllowed is always false here because design quality requires separate visual observation and review.'
        ]
    };
}

export function formatAgentAcceptanceVerificationMatrixMarkdown(
    report: AgentAcceptanceVerificationMatrixReport
): string {
    const lines = [
        '# Agent Acceptance Verification Matrix',
        '',
        `- version: ${report.version}`,
        `- generatedAt: ${report.generatedAt}`,
        `- verificationReady: ${report.totals.verificationReadyCount}/${report.totals.modeCount}`,
        `- failedArtifacts: ${report.totals.failedArtifactCount}`,
        '',
        '## Modes',
        ''
    ];

    for (const item of report.modes) {
        lines.push(`### ${item.mode}`);
        lines.push(`- controlStatus: ${item.controlPlane.status}`);
        lines.push(`- canRunByDefault: ${item.controlPlane.canRunByDefault}`);
        lines.push(`- artifactStatus: ${item.artifact.status}`);
        lines.push(`- artifact: ${item.artifact.relativePath}`);
        lines.push(`- artifactMode: ${item.artifact.mode || 'none'}`);
        lines.push(`- cases: ${item.artifact.caseCount}`);
        if (item.livePhotoshopIntake) {
            lines.push(`- livePhotoshopCheckStatus: ${item.livePhotoshopIntake.status}`);
            lines.push(`- livePhotoshopRequiredNextChecks: ${item.livePhotoshopIntake.requiredNextChecks.join(', ') || 'none'}`);
        }
        lines.push(`- qualityClaimAllowed: ${item.qualityClaimAllowed}`);
        lines.push(`- nextAction: ${item.nextAction}`);
        lines.push('');
    }

    lines.push('## Boundaries');
    for (const boundary of report.boundaries) {
        lines.push(`- ${boundary}`);
    }

    return `${lines.join('\n')}\n`;
}

function buildLivePhotoshopIntakeForMode(
    mode: AgentAcceptanceControlPlaneModeId,
    artifact: AgentAcceptanceRawArtifact | undefined
): LivePhotoshopAcceptanceIntake | undefined {
    if (!mode.startsWith('live-photoshop')) return undefined;
    return buildLivePhotoshopAcceptanceIntake({
        artifact,
        artifactExists: artifact?.exists === true,
        relativePath: artifact?.relativePath || MODE_ARTIFACT_PATHS[mode]
    });
}

function summarizeArtifact(
    mode: AgentAcceptanceControlPlaneModeId,
    artifact: AgentAcceptanceRawArtifact | undefined
): AgentAcceptanceArtifactDigest {
    const relativePath = artifact?.relativePath || MODE_ARTIFACT_PATHS[mode];
    if (!artifact?.exists) {
        return {
            relativePath,
            exists: false,
            status: 'not_found',
            mode: null,
            success: null,
            skipped: false,
            caseCount: 0,
            failedCaseCount: 0,
            blockerCount: 0,
            summary: 'No artifact has been generated for this mode.'
        };
    }

    if (artifact.parseError) {
        return {
            relativePath,
            exists: true,
            status: 'unknown',
            mode: null,
            success: null,
            skipped: false,
            caseCount: 0,
            failedCaseCount: 0,
            blockerCount: 0,
            summary: `Artifact exists but could not be parsed: ${artifact.parseError}`,
            parseError: artifact.parseError
        };
    }

    const payload = toRecord(artifact.payload);
    const artifactMode = toStringOrNull(payload.mode);
    const success = typeof payload.success === 'boolean' ? payload.success : null;
    const skipped = payload.skipped === true;
    const cases = extractCases(payload);
    const failedCaseCount = cases.filter((item) => !isPassedCase(item)).length;
    const blockerCount = countBlockers(payload);
    const status = deriveArtifactStatus(mode, {
        mode: artifactMode,
        success,
        skipped,
        failedCaseCount,
        blockerCount
    });

    return {
        relativePath,
        exists: true,
        status,
        mode: artifactMode,
        success,
        skipped,
        caseCount: cases.length,
        failedCaseCount,
        blockerCount,
        summary: buildArtifactSummary(status, success, skipped, cases.length, blockerCount)
    };
}

function deriveArtifactStatus(
    mode: AgentAcceptanceControlPlaneModeId,
    artifact: {
        mode: string | null;
        success: boolean | null;
        skipped: boolean;
        failedCaseCount: number;
        blockerCount: number;
    }
): AgentAcceptanceArtifactStatus {
    if (!artifactModeMatches(mode, artifact.mode)) return 'stale_for_mode';
    if (artifact.skipped) return 'skipped';
    if (artifact.success === false && artifact.blockerCount > 0) return 'blocked';
    if (artifact.success === false || artifact.failedCaseCount > 0) return 'failed';
    if (artifact.success === true) return 'passed';
    return 'unknown';
}

function artifactModeMatches(
    mode: AgentAcceptanceControlPlaneModeId,
    artifactMode: string | null
): boolean {
    const expectedModes = EXPECTED_ARTIFACT_MODES[mode];
    if (expectedModes.length === 0) return true;
    return artifactMode !== null && expectedModes.includes(artifactMode);
}

function buildArtifactSummary(
    status: AgentAcceptanceArtifactStatus,
    success: boolean | null,
    skipped: boolean,
    caseCount: number,
    blockerCount: number
): string {
    if (status === 'not_found') return 'No artifact exists.';
    if (status === 'stale_for_mode') return 'Artifact belongs to a different acceptance mode.';
    if (skipped) return 'Runner was skipped by guard flags.';
    if (status === 'blocked') return `Artifact is blocked with ${blockerCount} blocker(s).`;
    if (status === 'passed') return `Artifact passed with ${caseCount} case(s).`;
    if (status === 'failed') return `Artifact failed with success=${success}.`;
    return 'Artifact status could not be determined.';
}

function buildNextAction(
    controlPlane: AgentAcceptanceControlPlaneReport,
    artifact: AgentAcceptanceArtifactDigest
): string {
    if (controlPlane.status === 'future_not_supported') {
        return 'Do not run this mode yet; keep it as a future boundary.';
    }
    if (!controlPlane.canRun) {
        const missing = [
            ...controlPlane.missingOptInFlags,
            ...controlPlane.missingRuntime
        ].join(', ');
        return `Resolve required guards before running: ${missing || controlPlane.status}.`;
    }
    if (artifact.status === 'not_found') {
        return `Run ${controlPlane.script} to generate a verification artifact for this mode.`;
    }
    if (artifact.status === 'stale_for_mode') {
        return `Re-run ${controlPlane.script}; the current artifact belongs to another mode.`;
    }
    if (artifact.status === 'failed' || artifact.status === 'blocked') {
        return 'Open the artifact and triage the failure layer before retrying.';
    }
    return 'Artifact is available; use it only for this mode verification.';
}

function toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function toStringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractCases(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    if (Array.isArray(payload.cases)) {
        return payload.cases.filter((item): item is Record<string, unknown> => (
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        ));
    }
    if (Array.isArray(payload.reports)) {
        return payload.reports.filter((item): item is Record<string, unknown> => (
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        ));
    }
    return [];
}

function isPassedCase(item: Record<string, unknown>): boolean {
    return item.status === 'passed' || item.status === 'ok' || item.status === 'ready';
}

function countBlockers(payload: Record<string, unknown>): number {
    const directBlockers = Array.isArray(payload.blockers) ? payload.blockers.length : 0;
    const preflight = toRecord(payload.preflight);
    const preflightBlockers = Array.isArray(preflight.blockers) ? preflight.blockers.length : 0;
    const takeoverBlockers = Array.isArray(preflight.takeoverBlockers)
        ? preflight.takeoverBlockers.length
        : 0;
    return directBlockers + preflightBlockers + takeoverBlockers;
}
