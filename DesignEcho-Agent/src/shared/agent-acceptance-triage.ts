import type {
    AgentAcceptanceIssueLayer,
    AgentAcceptanceReport
} from './agent-acceptance-contracts';
import type { AgentAcceptanceDiagnostics } from './agent-acceptance-export';

export type AgentAcceptanceTriageVersion = 'agent-acceptance-triage/v0';

export type AgentAcceptanceTriageStatus = 'ok' | 'needs_review' | 'blocked';

export type AgentAcceptanceTriageOwner =
    | 'none'
    | 'agent_control_plane'
    | 'model_or_provider'
    | 'photoshop_tooling'
    | 'verification'
    | 'user_experience'
    | 'unknown';

export type AgentAcceptanceVerificationBoundary =
    | 'none'
    | 'diagnostic_checks_ready'
    | 'diagnostic_checks_invalid'
    | 'missing_diagnostic_observation';

export interface AgentAcceptanceTriage {
    version: AgentAcceptanceTriageVersion;
    status: AgentAcceptanceTriageStatus;
    primaryIssueLayer: AgentAcceptanceIssueLayer | 'none';
    owner: AgentAcceptanceTriageOwner;
    verificationBoundary: AgentAcceptanceVerificationBoundary;
    designQualityClaimAllowed: false;
    blockerCount: number;
    warningCount: number;
    nextActions: string[];
}

export interface BuildAgentAcceptanceTriageInput {
    report: AgentAcceptanceReport;
    diagnostics: AgentAcceptanceDiagnostics;
}

const ISSUE_LAYER_PRIORITY: Array<AgentAcceptanceIssueLayer> = [
    'intent',
    'routing',
    'context',
    'model',
    'tool',
    'photoshop',
    'verification',
    'performance',
    'ux',
    'unknown'
];

export function buildAgentAcceptanceTriage(input: BuildAgentAcceptanceTriageInput): AgentAcceptanceTriage {
    const status = deriveTriageStatus(input.report.status);
    const verificationBoundary = deriveVerificationBoundary(input.diagnostics);
    const primaryIssueLayer = status === 'ok'
        ? 'none'
        : derivePrimaryIssueLayer(input.report.issueLayers, verificationBoundary);

    return {
        version: 'agent-acceptance-triage/v0',
        status,
        primaryIssueLayer,
        owner: deriveOwner(primaryIssueLayer),
        verificationBoundary,
        designQualityClaimAllowed: false,
        blockerCount: input.report.blockers.length,
        warningCount: input.report.warnings.length,
        nextActions: status === 'ok'
            ? []
            : deriveNextActions(primaryIssueLayer, verificationBoundary)
    };
}

function deriveTriageStatus(reportStatus: AgentAcceptanceReport['status']): AgentAcceptanceTriageStatus {
    if (reportStatus === 'passed') return 'ok';
    if (reportStatus === 'needs_review') return 'needs_review';
    return 'blocked';
}

function derivePrimaryIssueLayer(
    issueLayers: AgentAcceptanceIssueLayer[],
    verificationBoundary: AgentAcceptanceVerificationBoundary
): AgentAcceptanceIssueLayer {
    if (verificationBoundary === 'diagnostic_checks_invalid') {
        return 'verification';
    }

    for (const layer of ISSUE_LAYER_PRIORITY) {
        if (issueLayers.includes(layer)) return layer;
    }
    return 'unknown';
}

function deriveOwner(primaryIssueLayer: AgentAcceptanceIssueLayer | 'none'): AgentAcceptanceTriageOwner {
    switch (primaryIssueLayer) {
        case 'none':
            return 'none';
        case 'intent':
        case 'routing':
        case 'context':
            return 'agent_control_plane';
        case 'model':
            return 'model_or_provider';
        case 'tool':
        case 'photoshop':
            return 'photoshop_tooling';
        case 'verification':
        case 'performance':
            return 'verification';
        case 'ux':
            return 'user_experience';
        case 'unknown':
        default:
            return 'unknown';
    }
}

function deriveVerificationBoundary(diagnostics: AgentAcceptanceDiagnostics): AgentAcceptanceVerificationBoundary {
    const boundaries = [
        diagnostics.imagePlacementIntakeBoundaryOk,
        diagnostics.executionPlanIntakeBoundaryOk
    ].filter((value): value is boolean => typeof value === 'boolean');
    if (boundaries.length === 0) {
        return diagnostics.hasLifecycle || diagnostics.hasExecutionSummary
            ? 'missing_diagnostic_observation'
            : 'none';
    }

    if (boundaries.some((value) => value === false)) {
        return 'diagnostic_checks_invalid';
    }

    return 'diagnostic_checks_ready';
}

function deriveNextActions(
    primaryIssueLayer: AgentAcceptanceIssueLayer | 'none',
    verificationBoundary: AgentAcceptanceVerificationBoundary
): string[] {
    if (verificationBoundary === 'diagnostic_checks_invalid') {
        return [
            'fix business verification intake boundary before accepting the run'
        ];
    }

    switch (primaryIssueLayer) {
        case 'intent':
        case 'routing':
            return ['inspect routing lifecycle and deterministic skill selection before tool execution'];
        case 'context':
            return ['inspect project/document context snapshot and required context blockers'];
        case 'model':
            return ['inspect provider response, model configuration and tool-call compatibility'];
        case 'tool':
        case 'photoshop':
            return ['inspect Photoshop tool events, tool parameters and acceptance snapshots'];
        case 'verification':
            return ['inspect acceptance report blockers, warnings and verification checks'];
        case 'performance':
            return ['inspect runtime budget, iteration count and tool-call latency'];
        case 'ux':
            return ['inspect visible feedback boundary and user-facing report rendering'];
        case 'unknown':
        case 'none':
        default:
            return ['inspect acceptance report checks and debug bundle run records'];
    }
}
