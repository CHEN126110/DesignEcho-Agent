import type { AgentAcceptanceStatus } from './agent-acceptance-contracts';
import type { AgentAcceptanceDebugExport } from './agent-acceptance-export';
import type {
    AgentAcceptanceVerificationBoundary,
    AgentAcceptanceTriage,
    AgentAcceptanceTriageOwner,
    AgentAcceptanceTriageStatus
} from './agent-acceptance-triage';

export interface AgentAcceptanceTriageSummary {
    caseId: string;
    reportStatus: AgentAcceptanceStatus;
    status: AgentAcceptanceTriageStatus;
    primaryIssueLayer: AgentAcceptanceTriage['primaryIssueLayer'];
    owner: AgentAcceptanceTriageOwner;
    verificationBoundary: AgentAcceptanceVerificationBoundary;
    designQualityClaimAllowed: false;
    blockerCount: number;
    warningCount: number;
    nextActions: string[];
}

export interface AgentAcceptanceTriageReportCase {
    id: string;
    status: AgentAcceptanceStatus;
    summary: string;
    acceptanceTriage?: AgentAcceptanceTriage;
}

export function summarizeAgentAcceptanceTriageExport(
    debugExport: AgentAcceptanceDebugExport
): AgentAcceptanceTriageSummary {
    const triage = debugExport.acceptanceTriage;

    return {
        caseId: debugExport.report.caseId,
        reportStatus: debugExport.report.status,
        status: triage.status,
        primaryIssueLayer: triage.primaryIssueLayer,
        owner: triage.owner,
        verificationBoundary: triage.verificationBoundary,
        designQualityClaimAllowed: false,
        blockerCount: triage.blockerCount,
        warningCount: triage.warningCount,
        nextActions: [...triage.nextActions]
    };
}

export function formatAgentAcceptanceTriageMarkdown(
    debugExport: AgentAcceptanceDebugExport
): string {
    const summary = summarizeAgentAcceptanceTriageExport(debugExport);
    const lines = [
        '## Acceptance Triage',
        '',
        `- caseId: ${summary.caseId}`,
        `- reportStatus: ${summary.reportStatus}`,
        `- status: ${summary.status}`,
        `- primaryIssueLayer: ${summary.primaryIssueLayer}`,
        `- owner: ${summary.owner}`,
        `- verificationBoundary: ${summary.verificationBoundary}`,
        `- designQualityClaimAllowed: ${summary.designQualityClaimAllowed}`,
        `- blockerCount: ${summary.blockerCount}`,
        `- warningCount: ${summary.warningCount}`,
        '',
        '### Next Actions'
    ];

    if (summary.nextActions.length === 0) {
        lines.push('- none');
    } else {
        for (const action of summary.nextActions) {
            lines.push(`- ${action}`);
        }
    }

    return lines.join('\n');
}

export function formatAgentAcceptanceTriageCasesMarkdown(
    cases: AgentAcceptanceTriageReportCase[]
): string {
    const lines = [
        '## Acceptance Triage',
        '',
        'This section contains developer diagnostics. It does not prove design quality.'
    ];

    if (cases.length === 0) {
        lines.push('', '- none');
        return lines.join('\n');
    }

    for (const item of cases) {
        if (!item.acceptanceTriage) {
            lines.push(`- ${item.id}: ${item.status} / no-triage / unknown`);
            continue;
        }

        lines.push(
            `- ${item.id}: ${item.acceptanceTriage.status} / ${item.acceptanceTriage.primaryIssueLayer} / ${item.acceptanceTriage.owner}`,
            `  verificationBoundary: ${item.acceptanceTriage.verificationBoundary}`,
            `  designQualityClaimAllowed: ${item.acceptanceTriage.designQualityClaimAllowed}`,
            `  summary: ${item.summary}`
        );

        if (item.acceptanceTriage.nextActions.length > 0) {
            lines.push(`  nextActions: ${item.acceptanceTriage.nextActions.join(' | ')}`);
        }
    }

    return lines.join('\n');
}
