import type { EcommerceSocksStrategyCheckpoint } from './ecommerce-socks-strategy-checkpoint';
import type { EcommerceSocksChildStrategyPacketSet } from './ecommerce-socks-child-strategy-packets';
import type { EcommerceSocksChildStrategyReviewGate } from './ecommerce-socks-child-strategy-review-gate';
import type { EcommerceSocksChildStrategyHandoff } from './ecommerce-socks-child-strategy-handoff';

export type EcommerceSocksDeliverable = 'main-image' | 'detail-page' | 'sku';

export interface EcommerceSocksChildSkillPlan {
    deliverable: EcommerceSocksDeliverable;
    skillId: 'main-image-design' | 'detail-page-design' | 'sku-batch';
    label: string;
    status: 'available' | 'missing';
    responsibility: string;
}

export type EcommerceSocksDispatchBlockReason =
    | 'child_dispatch_not_requested'
    | 'child_dispatch_requires_confirmation'
    | 'child_dispatch_checkpoint_not_implemented'
    | 'child_skill_missing';

export interface EcommerceSocksDispatchDecision {
    version: 'ecommerce-socks-dispatch/v0';
    requestedChildExecution: boolean;
    childDispatchConfirmed: boolean;
    canDispatchChildren: boolean;
    childExecutionOrder: EcommerceSocksChildSkillPlan[];
    blockedReasons: EcommerceSocksDispatchBlockReason[];
    parentNoPhotoshopWrites: true;
    noPhotoshopWrites: boolean;
    canClaimDesignComplete: false;
}

export type EcommerceSocksDispatchPhaseId =
    | 'context_intake'
    | 'child_dispatch'
    | 'child_acceptance'
    | 'parent_report';

export interface EcommerceSocksDispatchLifecyclePhase {
    id: EcommerceSocksDispatchPhaseId;
    label: string;
    status: 'planned' | 'blocked' | 'waiting';
    owner: 'parent-skill' | 'child-skill';
    details: string[];
}

export interface EcommerceSocksDispatchLifecycle {
    version: 'ecommerce-socks-dispatch-lifecycle/v0';
    status: 'planned' | 'blocked';
    userIntent: string;
    phases: EcommerceSocksDispatchLifecyclePhase[];
    acceptanceResponsibility: {
        parent: 'aggregate_child_reports_only';
        children: Array<{
            deliverable: EcommerceSocksDeliverable;
            skillId: EcommerceSocksChildSkillPlan['skillId'];
            ownsOutputQuality: true;
        }>;
    };
    blockers: EcommerceSocksDispatchBlockReason[];
    parentNoPhotoshopWrites: true;
    noPhotoshopWrites: boolean;
    canClaimDesignComplete: false;
}

export interface EcommerceSocksDispatchOrchestrationChildStep {
    order: number;
    deliverable: EcommerceSocksDeliverable;
    skillId: EcommerceSocksChildSkillPlan['skillId'];
    label: string;
    executionState: 'not_started';
    dependsOn: EcommerceSocksChildSkillPlan['skillId'][];
    progressRange: {
        start: number;
        end: number;
    };
    expectedReportKey: string;
}

export interface EcommerceSocksDispatchOrchestrationPlan {
    version: 'ecommerce-socks-dispatch-orchestration/v0';
    status: 'blocked' | 'ready';
    canExecuteChildren: boolean;
    childSteps: EcommerceSocksDispatchOrchestrationChildStep[];
    failurePolicy: {
        onChildFailure: 'continue_independent_and_report';
        onMissingRequiredInput: 'block_dispatch';
        onPartialSuccess: 'report_partial_without_quality_claim';
    };
    resultAggregation: {
        parentMayOnlyAggregate: true;
        requiredChildReports: string[];
        qualityClaimRequiresAllChildrenPassed: true;
    };
    blockers: EcommerceSocksDispatchBlockReason[];
    parentNoPhotoshopWrites: true;
    noPhotoshopWrites: boolean;
    canClaimDesignComplete: false;
}

export type EcommerceSocksDispatchAuthorizationStatus =
    | 'not_requested'
    | 'requires_user_approval'
    | 'denied'
    | 'approved'
    | 'approved_but_blocked';

export type EcommerceSocksDispatchAuthorizationBlocker =
    | EcommerceSocksDispatchBlockReason
    | 'user_denied_child_dispatch'
    | 'child_dispatch_not_executable'
    | 'child_skill_runner_missing';

export interface EcommerceSocksDispatchAuthorization {
    version: 'ecommerce-socks-dispatch-authorization/v0';
    status: EcommerceSocksDispatchAuthorizationStatus;
    requestedChildExecution: boolean;
    userApprovedChildDispatch: boolean;
    userDeniedChildDispatch: boolean;
    requiresExplicitUserApproval: true;
    canExecuteChildren: boolean;
    blockers: EcommerceSocksDispatchAuthorizationBlocker[];
    parentNoPhotoshopWrites: true;
    noPhotoshopWrites: boolean;
    canClaimDesignComplete: false;
}

export type EcommerceSocksChildDispatchRunStatus =
    | 'blocked'
    | 'dry_run_reported'
    | 'executed'
    | 'partial'
    | 'failed';

export interface EcommerceSocksChildDispatchRunResult {
    version: 'ecommerce-socks-child-report/v0';
    expectedReportKey: string;
    deliverable: EcommerceSocksDeliverable;
    skillId: EcommerceSocksChildSkillPlan['skillId'];
    success: boolean;
    status: EcommerceSocksChildReportStatus;
    canClaimOutputQuality: boolean;
    outputCount?: number;
    message?: string;
    error?: string;
    warnings: string[];
    blockers: string[];
    interactiveCards?: unknown[];
}

export interface EcommerceSocksChildDispatchRunRecord {
    order: number;
    deliverable: EcommerceSocksDeliverable;
    skillId: EcommerceSocksChildSkillPlan['skillId'];
    label: string;
    state: 'dry_run_skipped' | 'completed' | 'failed' | 'needs_review' | 'not_run_missing_result';
    expectedReportKey: string;
    reason?: 'dry_run_only_no_child_executor_call' | 'unified_child_skill_runner_call' | 'test_override_child_call' | 'missing_child_result';
    message?: string;
    error?: string;
    canClaimOutputQuality?: boolean;
}

export interface EcommerceSocksChildDispatchRun {
    version: 'ecommerce-socks-child-dispatch-run/v0';
    status: EcommerceSocksChildDispatchRunStatus;
    requestedDryRun: boolean;
    canCallChildExecutors: boolean;
    childExecutionPath: 'none' | 'dry_run' | 'unified_executor' | 'test_override';
    childRuns: EcommerceSocksChildDispatchRunRecord[];
    parentSummary: {
        parentMayOnlyAggregate: true;
        requiredChildReports: string[];
        receivedChildReports: string[];
        canAggregateQuality: false;
        qualityClaimRequiresAllChildrenPassed: true;
    };
    blockers: EcommerceSocksDispatchAuthorizationBlocker[];
    warnings: string[];
    parentNoPhotoshopWrites: true;
    noPhotoshopWrites: boolean;
    canClaimDesignComplete: false;
}

export type EcommerceSocksChildReportStatus =
    | 'completed'
    | 'partial'
    | 'failed'
    | 'needs_review';

export interface EcommerceSocksChildDispatchReport {
    version: 'ecommerce-socks-child-report/v0';
    expectedReportKey: string;
    deliverable: EcommerceSocksDeliverable;
    skillId: EcommerceSocksChildSkillPlan['skillId'];
    status: EcommerceSocksChildReportStatus;
    canClaimOutputQuality: boolean;
    outputCount?: number;
    warnings: string[];
    blockers: string[];
}

export type EcommerceSocksChildReportAggregationStatus =
    | 'blocked_missing_reports'
    | 'blocked_child_failed'
    | 'blocked_quality_unverified'
    | 'ready_to_report';

export type EcommerceSocksChildReportAggregationBlocker =
    | 'missing_child_report'
    | 'child_report_failed'
    | 'child_report_quality_unverified';

export interface EcommerceSocksChildReportAggregationItem {
    expectedReportKey: string;
    deliverable: EcommerceSocksDeliverable;
    skillId: EcommerceSocksChildSkillPlan['skillId'];
    status: EcommerceSocksChildReportStatus | 'missing';
    canClaimOutputQuality: boolean;
    outputCount: number;
    warnings: string[];
    blockers: string[];
}

export interface EcommerceSocksChildReportAggregation {
    version: 'ecommerce-socks-child-report-aggregation/v0';
    status: EcommerceSocksChildReportAggregationStatus;
    parentMayOnlyAggregate: true;
    requiredChildReports: string[];
    receivedChildReports: string[];
    missingChildReports: string[];
    childStatuses: EcommerceSocksChildReportAggregationItem[];
    canAggregateQuality: boolean;
    qualityClaimRequiresAllChildrenPassed: true;
    canClaimDesignComplete: boolean;
    completionClaimSource: 'child_reports_only' | 'none';
    blockers: EcommerceSocksChildReportAggregationBlocker[];
    mustNotRunChildSkills: true;
    noPhotoshopWrites: true;
}

export interface EcommerceSocksDesignState {
    version: 'ecommerce-socks-design/v0';
    parentSkillId: 'ecommerce-socks-design';
    scene: 'ecommerce-socks';
    executionMode: 'plan-only' | 'dispatch';
    userIntent: string;
    projectPath?: string;
    childSkills: EcommerceSocksChildSkillPlan[];
    dispatchDecision?: EcommerceSocksDispatchDecision;
    dispatchLifecycle?: EcommerceSocksDispatchLifecycle;
    dispatchOrchestration?: EcommerceSocksDispatchOrchestrationPlan;
    dispatchAuthorization?: EcommerceSocksDispatchAuthorization;
    childDispatchRun?: EcommerceSocksChildDispatchRun;
    childReportAggregation?: EcommerceSocksChildReportAggregation;
    strategyCheckpoint?: EcommerceSocksStrategyCheckpoint;
    childStrategyPacketSet?: EcommerceSocksChildStrategyPacketSet;
    childStrategyReviewGate?: EcommerceSocksChildStrategyReviewGate;
    childStrategyHandoff?: EcommerceSocksChildStrategyHandoff;
    parentNoPhotoshopWrites: true;
    childrenMayWritePhotoshop: boolean;
    canClaimDesignComplete: false;
    mustNotChangeChildBusinessStrategy: true;
    warnings: string[];
}

const CHILD_SKILL_BY_DELIVERABLE: Record<EcommerceSocksDeliverable, Omit<EcommerceSocksChildSkillPlan, 'status'>> = {
    'main-image': {
        deliverable: 'main-image',
        skillId: 'main-image-design',
        label: '主图',
        responsibility: '主图构图、主体置入、卖点文案、输出检查'
    },
    'detail-page': {
        deliverable: 'detail-page',
        skillId: 'detail-page-design',
        label: '详情页',
        responsibility: '详情页屏幕规划、素材分配、图文模块和长图验收'
    },
    sku: {
        deliverable: 'sku',
        skillId: 'sku-batch',
        label: 'SKU',
        responsibility: 'SKU 颜色规格组合、模板填充、导出命名和批量验收'
    }
};

const DEFAULT_DELIVERABLES: EcommerceSocksDeliverable[] = ['main-image', 'detail-page', 'sku'];

function normalizeDeliverable(value: unknown): EcommerceSocksDeliverable | null {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return null;
    if (['main-image', 'main_image', 'mainimage', 'main', '主图'].includes(text)) return 'main-image';
    if (['detail-page', 'detail_page', 'detailpage', 'detail', '详情页', '长图'].includes(text)) return 'detail-page';
    if (['sku', 'SKU'.toLowerCase(), '规格图', '组合图'].includes(text)) return 'sku';
    return null;
}

export function extractEcommerceSocksDeliverables(input: string): EcommerceSocksDeliverable[] {
    const text = String(input || '');
    const deliverables: EcommerceSocksDeliverable[] = [];

    if (/主图|main\s*image/i.test(text)) deliverables.push('main-image');
    if (/详情页|长图|detail\s*page/i.test(text)) deliverables.push('detail-page');
    if (/sku|规格图|组合图/i.test(text)) deliverables.push('sku');

    if (deliverables.length === 0 && /整套|全套|一套|电商袜子设计|袜子电商设计/i.test(text)) {
        return [...DEFAULT_DELIVERABLES];
    }

    return Array.from(new Set(deliverables));
}

export function normalizeEcommerceSocksDeliverables(value: unknown, userIntent = ''): EcommerceSocksDeliverable[] {
    if (Array.isArray(value)) {
        const normalized = value
            .map((item) => normalizeDeliverable(item))
            .filter((item): item is EcommerceSocksDeliverable => Boolean(item));
        if (normalized.length > 0) return Array.from(new Set(normalized));
    }

    const inferred = extractEcommerceSocksDeliverables(userIntent);
    return inferred.length > 0 ? inferred : [...DEFAULT_DELIVERABLES];
}

export function buildEcommerceSocksChildSkillPlan(params: {
    deliverables: EcommerceSocksDeliverable[];
    isSkillAvailable?: (skillId: string) => boolean;
}): EcommerceSocksChildSkillPlan[] {
    const isSkillAvailable = params.isSkillAvailable || (() => true);
    return params.deliverables.map((deliverable) => {
        const base = CHILD_SKILL_BY_DELIVERABLE[deliverable];
        return {
            ...base,
            status: isSkillAvailable(base.skillId) ? 'available' : 'missing'
        };
    });
}

export function buildEcommerceSocksDispatchDecision(params: {
    childSkills: EcommerceSocksChildSkillPlan[];
    executeChildren?: boolean;
    confirmChildDispatch?: boolean;
    childDispatchImplementationReady?: boolean;
}): EcommerceSocksDispatchDecision {
    const requestedChildExecution = params.executeChildren === true;
    const childDispatchConfirmed = params.confirmChildDispatch === true;
    const childDispatchImplementationReady = params.childDispatchImplementationReady === true;
    const blockedReasons: EcommerceSocksDispatchBlockReason[] = [];

    if (params.childSkills.some((item) => item.status === 'missing')) {
        blockedReasons.push('child_skill_missing');
    }

    if (!requestedChildExecution) {
        blockedReasons.push('child_dispatch_not_requested');
    } else if (!childDispatchConfirmed) {
        blockedReasons.push('child_dispatch_requires_confirmation');
    } else if (!childDispatchImplementationReady) {
        blockedReasons.push('child_dispatch_checkpoint_not_implemented');
    }

    const canDispatchChildren = requestedChildExecution
        && childDispatchConfirmed
        && childDispatchImplementationReady
        && blockedReasons.length === 0;

    return {
        version: 'ecommerce-socks-dispatch/v0',
        requestedChildExecution,
        childDispatchConfirmed,
        canDispatchChildren,
        childExecutionOrder: params.childSkills.map((item) => ({ ...item })),
        blockedReasons,
        parentNoPhotoshopWrites: true,
        noPhotoshopWrites: !canDispatchChildren,
        canClaimDesignComplete: false
    };
}

export function buildEcommerceSocksDispatchLifecycle(params: {
    userIntent: string;
    childSkills: EcommerceSocksChildSkillPlan[];
    dispatchDecision: EcommerceSocksDispatchDecision;
}): EcommerceSocksDispatchLifecycle {
    const childDispatchStatus = params.dispatchDecision.canDispatchChildren ? 'planned' : 'blocked';
    const downstreamStatus = params.dispatchDecision.canDispatchChildren ? 'planned' : 'waiting';

    return {
        version: 'ecommerce-socks-dispatch-lifecycle/v0',
        status: params.dispatchDecision.canDispatchChildren ? 'planned' : 'blocked',
        userIntent: params.userIntent,
        phases: [
            {
                id: 'context_intake',
                label: '项目上下文与交付范围读取',
                status: 'planned',
                owner: 'parent-skill',
                details: ['父 skill 负责整理用户需求、项目上下文和交付范围。']
            },
            {
                id: 'child_dispatch',
                label: '子 skill 调度',
                status: childDispatchStatus,
                owner: 'parent-skill',
                details: params.dispatchDecision.blockedReasons
            },
            {
                id: 'child_acceptance',
                label: '子 skill 输出验收',
                status: downstreamStatus,
                owner: 'child-skill',
                details: params.childSkills.map((item) => `${item.label} 质量验收归属 ${item.skillId}`)
            },
            {
                id: 'parent_report',
                label: '父 skill 汇总报告',
                status: downstreamStatus,
                owner: 'parent-skill',
                details: ['父 skill 只能汇总子 skill 报告，不能替代子 skill 质量验收。']
            }
        ],
        acceptanceResponsibility: {
            parent: 'aggregate_child_reports_only',
            children: params.childSkills.map((item) => ({
                deliverable: item.deliverable,
                skillId: item.skillId,
                ownsOutputQuality: true
            }))
        },
        blockers: params.dispatchDecision.blockedReasons,
        parentNoPhotoshopWrites: true,
        noPhotoshopWrites: !params.dispatchDecision.canDispatchChildren,
        canClaimDesignComplete: false
    };
}

export function buildEcommerceSocksDispatchOrchestrationPlan(params: {
    childSkills: EcommerceSocksChildSkillPlan[];
    dispatchDecision: EcommerceSocksDispatchDecision;
    dispatchLifecycle: EcommerceSocksDispatchLifecycle;
}): EcommerceSocksDispatchOrchestrationPlan {
    const childCount = Math.max(params.childSkills.length, 1);
    const progressStart = 15;
    const progressEnd = 85;
    const progressSpan = progressEnd - progressStart;

    return {
        version: 'ecommerce-socks-dispatch-orchestration/v0',
        status: params.dispatchLifecycle.status === 'blocked' ? 'blocked' : 'ready',
        canExecuteChildren: params.dispatchDecision.canDispatchChildren,
        childSteps: params.childSkills.map((item, index) => {
            const start = Math.round(progressStart + (progressSpan * index) / childCount);
            const end = Math.round(progressStart + (progressSpan * (index + 1)) / childCount);
            return {
                order: index + 1,
                deliverable: item.deliverable,
                skillId: item.skillId,
                label: item.label,
                executionState: 'not_started',
                dependsOn: [],
                progressRange: { start, end },
                expectedReportKey: `${item.skillId}Report`
            };
        }),
        failurePolicy: {
            onChildFailure: 'continue_independent_and_report',
            onMissingRequiredInput: 'block_dispatch',
            onPartialSuccess: 'report_partial_without_quality_claim'
        },
        resultAggregation: {
            parentMayOnlyAggregate: true,
            requiredChildReports: params.childSkills.map((item) => `${item.skillId}Report`),
            qualityClaimRequiresAllChildrenPassed: true
        },
        blockers: params.dispatchDecision.blockedReasons,
        parentNoPhotoshopWrites: true,
        noPhotoshopWrites: !params.dispatchDecision.canDispatchChildren,
        canClaimDesignComplete: false
    };
}

export function buildEcommerceSocksDispatchAuthorization(params: {
    dispatchDecision: EcommerceSocksDispatchDecision;
    dispatchOrchestration: EcommerceSocksDispatchOrchestrationPlan;
    userDeniedChildDispatch?: boolean;
}): EcommerceSocksDispatchAuthorization {
    const requestedChildExecution = params.dispatchDecision.requestedChildExecution;
    const userDeniedChildDispatch = params.userDeniedChildDispatch === true;
    const userApprovedChildDispatch = requestedChildExecution
        && params.dispatchDecision.childDispatchConfirmed
        && !userDeniedChildDispatch;

    const blockers: EcommerceSocksDispatchAuthorizationBlocker[] = [...params.dispatchDecision.blockedReasons];
    let status: EcommerceSocksDispatchAuthorizationStatus = 'not_requested';

    if (userDeniedChildDispatch) {
        status = 'denied';
        blockers.push('user_denied_child_dispatch');
    } else if (!requestedChildExecution) {
        status = 'not_requested';
    } else if (!params.dispatchDecision.childDispatchConfirmed) {
        status = 'requires_user_approval';
    } else if (params.dispatchDecision.canDispatchChildren && params.dispatchOrchestration.status === 'ready') {
        status = 'approved';
    } else {
        status = 'approved_but_blocked';
        if (params.dispatchOrchestration.status === 'blocked') {
            blockers.push('child_dispatch_not_executable');
        }
    }

    return {
        version: 'ecommerce-socks-dispatch-authorization/v0',
        status,
        requestedChildExecution,
        userApprovedChildDispatch,
        userDeniedChildDispatch,
        requiresExplicitUserApproval: true,
        canExecuteChildren: status === 'approved',
        blockers: Array.from(new Set(blockers)),
        parentNoPhotoshopWrites: true,
        noPhotoshopWrites: status !== 'approved',
        canClaimDesignComplete: false
    };
}

export function buildEcommerceSocksChildDispatchRun(params: {
    dispatchAuthorization: EcommerceSocksDispatchAuthorization;
    dispatchOrchestration: EcommerceSocksDispatchOrchestrationPlan;
    dryRunChildDispatch?: boolean;
    childRunResults?: EcommerceSocksChildDispatchRunResult[];
    childExecutionPath?: 'unified_executor' | 'test_override';
    runtimeBlockers?: EcommerceSocksDispatchAuthorizationBlocker[];
}): EcommerceSocksChildDispatchRun {
    const requestedDryRun = params.dryRunChildDispatch === true;
    const runtimeBlockers = params.runtimeBlockers || [];
    const canReportDryRun = requestedDryRun
        && params.dispatchAuthorization.userApprovedChildDispatch
        && (
            params.dispatchAuthorization.status === 'approved'
            || params.dispatchAuthorization.status === 'approved_but_blocked'
        );
    const canUseRealChildResults = params.dispatchAuthorization.canExecuteChildren
        && !requestedDryRun
        && runtimeBlockers.length === 0
        && Array.isArray(params.childRunResults)
        && params.childRunResults.length > 0;
    let childRuns: EcommerceSocksChildDispatchRunRecord[] = [];

    if (canReportDryRun) {
        childRuns = params.dispatchOrchestration.childSteps.map((item) => ({
            order: item.order,
            deliverable: item.deliverable,
            skillId: item.skillId,
            label: item.label,
            state: 'dry_run_skipped',
            expectedReportKey: item.expectedReportKey,
            reason: 'dry_run_only_no_child_executor_call'
        }));
    } else if (canUseRealChildResults) {
        childRuns = params.dispatchOrchestration.childSteps.map((step) => {
            const result = params.childRunResults?.find((item) => item.expectedReportKey === step.expectedReportKey);
            let state: EcommerceSocksChildDispatchRunRecord['state'] = 'not_run_missing_result';
            let reason: EcommerceSocksChildDispatchRunRecord['reason'] = 'missing_child_result';

            const childCallReason: EcommerceSocksChildDispatchRunRecord['reason'] = params.childExecutionPath === 'test_override'
                ? 'test_override_child_call'
                : 'unified_child_skill_runner_call';

            if (result?.success === true && result.status === 'completed') {
                state = 'completed';
                reason = childCallReason;
            } else if (result?.success === true) {
                state = 'needs_review';
                reason = childCallReason;
            } else if (result) {
                state = 'failed';
                reason = childCallReason;
            }

            return {
                order: step.order,
                deliverable: step.deliverable,
                skillId: step.skillId,
                label: step.label,
                state,
                expectedReportKey: step.expectedReportKey,
                reason,
                message: result?.message,
                error: result?.error,
                canClaimOutputQuality: result?.canClaimOutputQuality
            };
        });
    }
    const receivedChildReports = canUseRealChildResults
        ? params.childRunResults?.map((item) => item.expectedReportKey) || []
        : [];
    const hasFailedChild = canUseRealChildResults
        && params.childRunResults?.some((item) => item.success === false || item.status === 'failed');
    const hasIncompleteChild = canUseRealChildResults
        && params.childRunResults?.some((item) => item.status !== 'completed');
    let status: EcommerceSocksChildDispatchRunStatus = 'blocked';

    if (canReportDryRun) {
        status = 'dry_run_reported';
    } else if (canUseRealChildResults && hasFailedChild) {
        status = 'failed';
    } else if (canUseRealChildResults && hasIncompleteChild) {
        status = 'partial';
    } else if (canUseRealChildResults) {
        status = 'executed';
    }

    let childExecutionPath: EcommerceSocksChildDispatchRun['childExecutionPath'] = 'none';
    if (canReportDryRun) {
        childExecutionPath = 'dry_run';
    } else if (canUseRealChildResults) {
        childExecutionPath = params.childExecutionPath || 'unified_executor';
    }

    const warnings = canUseRealChildResults && childExecutionPath === 'test_override'
        ? ['child_dispatch_used_test_override_runner; production path must use unified_executor']
        : [];

    return {
        version: 'ecommerce-socks-child-dispatch-run/v0',
        status,
        requestedDryRun,
        canCallChildExecutors: params.dispatchAuthorization.canExecuteChildren
            && !requestedDryRun
            && runtimeBlockers.length === 0,
        childExecutionPath,
        childRuns,
        parentSummary: {
            parentMayOnlyAggregate: true,
            requiredChildReports: params.dispatchOrchestration.resultAggregation.requiredChildReports,
            receivedChildReports,
            canAggregateQuality: false,
            qualityClaimRequiresAllChildrenPassed: true
        },
        blockers: [
            ...params.dispatchAuthorization.blockers,
            ...runtimeBlockers
        ],
        warnings,
        parentNoPhotoshopWrites: true,
        noPhotoshopWrites: requestedDryRun
            || !params.dispatchAuthorization.canExecuteChildren
            || runtimeBlockers.length > 0,
        canClaimDesignComplete: false
    };
}

function indexChildReportsByKey(
    childReports: EcommerceSocksChildDispatchReport[] = []
): Map<string, EcommerceSocksChildDispatchReport> {
    return new Map(childReports.map((report) => [report.expectedReportKey, report]));
}

export function buildEcommerceSocksChildReportAggregation(params: {
    dispatchOrchestration: EcommerceSocksDispatchOrchestrationPlan;
    childReports?: EcommerceSocksChildDispatchReport[];
}): EcommerceSocksChildReportAggregation {
    const reportByKey = indexChildReportsByKey(params.childReports);
    const requiredChildReports = params.dispatchOrchestration.resultAggregation.requiredChildReports;
    const childStatuses: EcommerceSocksChildReportAggregationItem[] = params.dispatchOrchestration.childSteps.map((step) => {
        const report = reportByKey.get(step.expectedReportKey);
        if (!report) {
            return {
                expectedReportKey: step.expectedReportKey,
                deliverable: step.deliverable,
                skillId: step.skillId,
                status: 'missing',
                canClaimOutputQuality: false,
                outputCount: 0,
                warnings: [],
                blockers: ['missing_child_report']
            };
        }

        return {
            expectedReportKey: step.expectedReportKey,
            deliverable: step.deliverable,
            skillId: step.skillId,
            status: report.status,
            canClaimOutputQuality: report.canClaimOutputQuality,
            outputCount: report.outputCount || 0,
            warnings: report.warnings || [],
            blockers: report.blockers || []
        };
    });
    const receivedChildReports = childStatuses
        .filter((item) => item.status !== 'missing')
        .map((item) => item.expectedReportKey);
    const missingChildReports = childStatuses
        .filter((item) => item.status === 'missing')
        .map((item) => item.expectedReportKey);
    const blockers: EcommerceSocksChildReportAggregationBlocker[] = [];

    if (missingChildReports.length > 0) {
        blockers.push('missing_child_report');
    }
    if (childStatuses.some((item) => item.status === 'failed')) {
        blockers.push('child_report_failed');
    }
    if (childStatuses.some((item) => item.status !== 'missing' && !item.canClaimOutputQuality)) {
        blockers.push('child_report_quality_unverified');
    }

    let status: EcommerceSocksChildReportAggregationStatus = 'ready_to_report';
    if (blockers.includes('missing_child_report')) {
        status = 'blocked_missing_reports';
    } else if (blockers.includes('child_report_failed')) {
        status = 'blocked_child_failed';
    } else if (blockers.includes('child_report_quality_unverified')
        || childStatuses.some((item) => item.status !== 'completed')) {
        status = 'blocked_quality_unverified';
        if (!blockers.includes('child_report_quality_unverified')) {
            blockers.push('child_report_quality_unverified');
        }
    }

    const canAggregateQuality = status === 'ready_to_report';

    return {
        version: 'ecommerce-socks-child-report-aggregation/v0',
        status,
        parentMayOnlyAggregate: true,
        requiredChildReports,
        receivedChildReports,
        missingChildReports,
        childStatuses,
        canAggregateQuality,
        qualityClaimRequiresAllChildrenPassed: true,
        canClaimDesignComplete: canAggregateQuality,
        completionClaimSource: canAggregateQuality ? 'child_reports_only' : 'none',
        blockers: Array.from(new Set(blockers)),
        mustNotRunChildSkills: true,
        noPhotoshopWrites: true
    };
}

export function buildEcommerceSocksDesignState(params: {
    userIntent: string;
    projectPath?: string;
    deliverables: EcommerceSocksDeliverable[];
    executionMode?: 'plan-only' | 'dispatch';
    isSkillAvailable?: (skillId: string) => boolean;
    dispatchDecision?: EcommerceSocksDispatchDecision;
    dispatchLifecycle?: EcommerceSocksDispatchLifecycle;
    dispatchOrchestration?: EcommerceSocksDispatchOrchestrationPlan;
    dispatchAuthorization?: EcommerceSocksDispatchAuthorization;
    childDispatchRun?: EcommerceSocksChildDispatchRun;
    childReportAggregation?: EcommerceSocksChildReportAggregation;
    strategyCheckpoint?: EcommerceSocksStrategyCheckpoint;
    childStrategyPacketSet?: EcommerceSocksChildStrategyPacketSet;
    childStrategyReviewGate?: EcommerceSocksChildStrategyReviewGate;
    childStrategyHandoff?: EcommerceSocksChildStrategyHandoff;
}): EcommerceSocksDesignState {
    const childSkills = buildEcommerceSocksChildSkillPlan({
        deliverables: params.deliverables,
        isSkillAvailable: params.isSkillAvailable
    });
    const warnings = childSkills
        .filter((item) => item.status === 'missing')
        .map((item) => `${item.label} 子 skill 当前不可用`);

    return {
        version: 'ecommerce-socks-design/v0',
        parentSkillId: 'ecommerce-socks-design',
        scene: 'ecommerce-socks',
        executionMode: params.executionMode || 'plan-only',
        userIntent: params.userIntent,
        projectPath: params.projectPath,
        childSkills,
        dispatchDecision: params.dispatchDecision,
        dispatchLifecycle: params.dispatchLifecycle,
        dispatchOrchestration: params.dispatchOrchestration,
        dispatchAuthorization: params.dispatchAuthorization,
        childDispatchRun: params.childDispatchRun,
        childReportAggregation: params.childReportAggregation,
        strategyCheckpoint: params.strategyCheckpoint,
        childStrategyPacketSet: params.childStrategyPacketSet,
        childStrategyReviewGate: params.childStrategyReviewGate,
        childStrategyHandoff: params.childStrategyHandoff,
        parentNoPhotoshopWrites: true,
        childrenMayWritePhotoshop: params.executionMode === 'dispatch',
        canClaimDesignComplete: false,
        mustNotChangeChildBusinessStrategy: true,
        warnings
    };
}
