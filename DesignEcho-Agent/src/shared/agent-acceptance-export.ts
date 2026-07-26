import type {
    AgentAcceptanceBusinessSkillVerificationIntake,
    AgentAcceptanceIssueLayer,
    AgentAcceptanceReport,
    AgentAcceptanceStatus,
    AgentRunDebugBundle
} from './agent-acceptance-contracts';
import {
    buildAgentAcceptanceTriage,
    type AgentAcceptanceTriage
} from './agent-acceptance-triage';
import type { AgentExecutionLifecycleSnapshot } from './agent-execution-lifecycle';
import { isAgentExecutionLifecycleBoundaryOk } from './agent-execution-lifecycle';
import type { AgentIntentDecisionIntake } from './agent-intent-decision-intake';
import { isAgentIntentDecisionBoundaryOk } from './agent-intent-decision-intake';

export type AgentAcceptanceDiagnosticsVersion = 'agent-acceptance-diagnostics/v0';

export interface AgentAcceptanceDiagnostics {
    version: AgentAcceptanceDiagnosticsVersion;
    caseId: string;
    reportStatus: AgentAcceptanceStatus;
    issueLayers: AgentAcceptanceIssueLayer[];
    blockerCount: number;
    warningCount: number;
    diagnosticRecordKeys: string[];
    hasDiagnosticRecord: boolean;
    hasLifecycle: boolean;
    agentExecutionLifecycleSnapshot?: AgentExecutionLifecycleSnapshot;
    agentIntentDecisionIntake?: AgentIntentDecisionIntake;
    hasExecutionSummary: boolean;
    toolCount: number;
    businessSkillImagePlacementVerificationIntake?: AgentAcceptanceBusinessSkillVerificationIntake;
    businessSkillExecutionPlanIntake?: AgentAcceptanceBusinessSkillVerificationIntake;
    executionLifecycleBoundaryOk?: boolean;
    intentDecisionIntakeBoundaryOk?: boolean;
    imagePlacementIntakeBoundaryOk?: boolean;
    executionPlanIntakeBoundaryOk?: boolean;
}

export interface AgentAcceptanceDebugExport {
    bundle: AgentRunDebugBundle;
    report: AgentAcceptanceReport;
    acceptanceDiagnostics: AgentAcceptanceDiagnostics;
    acceptanceTriage: AgentAcceptanceTriage;
}

export interface BuildAgentAcceptanceDebugExportInput {
    bundle: AgentRunDebugBundle;
    report: AgentAcceptanceReport;
}

export function buildAgentAcceptanceDebugExport(
    input: BuildAgentAcceptanceDebugExportInput
): AgentAcceptanceDebugExport {
    const acceptanceDiagnostics = buildAgentAcceptanceDiagnostics(input.report);

    return {
        bundle: input.bundle,
        report: input.report,
        acceptanceDiagnostics,
        acceptanceTriage: buildAgentAcceptanceTriage({
            report: input.report,
            diagnostics: acceptanceDiagnostics
        })
    };
}

function buildAgentAcceptanceDiagnostics(report: AgentAcceptanceReport): AgentAcceptanceDiagnostics {
    return {
        version: 'agent-acceptance-diagnostics/v0',
        caseId: report.caseId,
        reportStatus: report.status,
        issueLayers: report.issueLayers,
        blockerCount: report.blockers.length,
        warningCount: report.warnings.length,
        diagnosticRecordKeys: report.runRecords.diagnosticRecordKeys,
        hasDiagnosticRecord: report.runRecords.hasDiagnosticRecord,
        hasLifecycle: report.runRecords.hasLifecycle,
        agentExecutionLifecycleSnapshot: report.runRecords.agentExecutionLifecycleSnapshot,
        agentIntentDecisionIntake: report.runRecords.agentIntentDecisionIntake,
        hasExecutionSummary: report.runRecords.hasExecutionSummary,
        toolCount: report.runRecords.toolCount,
        businessSkillImagePlacementVerificationIntake: report.runRecords.businessSkillImagePlacementVerificationIntake,
        businessSkillExecutionPlanIntake: report.runRecords.businessSkillExecutionPlanIntake,
        executionLifecycleBoundaryOk: isAgentExecutionLifecycleBoundaryOk(
            report.runRecords.agentExecutionLifecycleSnapshot
        ),
        intentDecisionIntakeBoundaryOk: isAgentIntentDecisionBoundaryOk(report.runRecords.agentIntentDecisionIntake),
        imagePlacementIntakeBoundaryOk: deriveBusinessSkillIntakeBoundary(
            report.runRecords.businessSkillImagePlacementVerificationIntake
        ),
        executionPlanIntakeBoundaryOk: deriveBusinessSkillIntakeBoundary(
            report.runRecords.businessSkillExecutionPlanIntake
        )
    };
}

function deriveBusinessSkillIntakeBoundary(
    intake: AgentAcceptanceBusinessSkillVerificationIntake | undefined
): boolean | undefined {
    if (!intake) return undefined;
    return intake.canClaimDesignQuality === false
        && intake.userVisible === false
        && intake.controlContextOnly === true;
}
