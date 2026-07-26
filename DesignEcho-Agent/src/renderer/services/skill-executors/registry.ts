import type { SkillExecutor, SkillExecutorRegistry, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import type { SkillExecutionOutcomeStatus } from '../../../shared/agent-react-observation-contract';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import { resolveSkillExecutionOutcome } from '../../../shared/agent-react-observation-contract';
import { getInternalAgentStatusPublicMessage } from '../../../shared/agent-user-visible-state';
import {
    attachPendingInteractiveContinuation,
    buildPendingInteractiveContinuation,
    resolvePendingInteractiveContinuationLeaf,
    type PendingInteractiveContinuationScopeObservation
} from '../../../shared/pending-interactive-continuation';
import { startTiming, endTiming } from '../performance-tracker';
import { getPhotoshopContext } from '../agent-orchestration/context';
import {
    attachBusinessSkillImagePlacementVerificationIntakeToResult,
    attachBusinessSkillExecutionPlanIntakeToResult,
    attachBusinessSkillProjectAssetUnderstandingIntakeToResult,
    attachBusinessSkillExecutionIntakeToResult,
    attachBusinessSkillVisualContextPreparationToResult,
    attachBusinessSkillExecutionPreflightGateToResult,
    attachBusinessVisualContextToResult,
    buildBusinessSkillImagePlacementVerificationIntakeForSkill,
    buildBusinessSkillExecutionPlanIntakeForSkill,
    buildBusinessSkillProjectAssetUnderstandingIntakeForSkill,
    buildBusinessSkillExecutionIntakeForSkill,
    buildBusinessSkillVisualContextPreparationForSkill,
    buildBusinessSkillExecutionPreflightGateForSkill,
    buildBusinessVisualContextForSkill,
    prepareBusinessSkillProjectContextForScenario,
    runBusinessSkillVisualObservationRefreshBeforeExecution,
    runBusinessSkillVisualObservationRefreshAfterExecution
} from './business-skill-visual-context';

const executorRegistry: SkillExecutorRegistry = new Map();

function getSafeSkillLabel(skillId: string): string {
    const skill = getSkillById(skillId);
    if (!skill) {
        return '该能力';
    }
    return skill.visibility === 'user-facing' ? skill.name : '当前请求';
}

function compactSkillResultText(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function buildSkillUnavailableStatusMessage(): string {
    return getInternalAgentStatusPublicMessage('skill executor not found')
        || '这个操作暂时还不能直接完成；本轮不会改动画面。';
}

function summarizeSkillResult(result: AgentResult): string {
    return resolveSkillExecutionOutcome(result).summary;
}

function attachResolvedSkillOutcome(result: AgentResult): AgentResult {
    return {
        ...result,
        skillOutcome: resolveSkillExecutionOutcome(result)
    };
}

function getSkillOutcomeTitle(status: SkillExecutionOutcomeStatus): string {
    switch (status) {
        case 'completed':
            return '能力完成';
        case 'executed':
            return '能力已执行';
        case 'partial':
            return '能力部分完成';
        case 'needs_review':
            return '能力待复核';
        case 'awaiting_confirmation':
            return '能力待确认';
        case 'blocked':
            return '能力受阻';
        case 'failed':
            return '能力失败';
        case 'cancelled':
            return '能力已停止';
        default:
            return '能力未完成';
    }
}

function isSkillOutcomeFailure(status: SkillExecutionOutcomeStatus): boolean {
    return status === 'blocked' || status === 'failed' || status === 'cancelled';
}

function isSkillExecutionCancelled(executeParams: SkillExecuteParams | undefined): boolean {
    return Boolean(executeParams?.signal?.aborted);
}

async function capturePendingContinuationScopeObservation(
    outcomeStatus: SkillExecutionOutcomeStatus,
    signal?: AbortSignal
): Promise<PendingInteractiveContinuationScopeObservation | undefined> {
    if (outcomeStatus !== 'awaiting_confirmation') return undefined;
    const observedAt = new Date().toISOString();
    const photoshopContext = await getPhotoshopContext({ signal });
    if (!photoshopContext) {
        return {
            version: 'pending-interactive-continuation-scope-observation/v0',
            observedAt,
            source: 'pause_boundary_get_document_info',
            photoshopDocumentState: 'unknown'
        };
    }
    if (!photoshopContext.hasDocument) {
        return {
            version: 'pending-interactive-continuation-scope-observation/v0',
            observedAt: photoshopContext.observedAt || observedAt,
            source: 'pause_boundary_get_document_info',
            photoshopDocumentState: 'absent'
        };
    }
    const documentId = Number(photoshopContext.documentId || 0);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return {
            version: 'pending-interactive-continuation-scope-observation/v0',
            observedAt: photoshopContext.observedAt || observedAt,
            source: 'pause_boundary_get_document_info',
            photoshopDocumentState: 'unknown'
        };
    }
    return {
        version: 'pending-interactive-continuation-scope-observation/v0',
        observedAt: photoshopContext.observedAt || observedAt,
        source: 'pause_boundary_get_document_info',
        photoshopDocumentState: 'present',
        photoshopDocumentId: documentId
    };
}

function buildCancelledSkillResult(skillLabel: string = '当前能力'): AgentResult {
    return attachResolvedSkillOutcome({
        success: false,
        cancelled: true,
        message: `${skillLabel}已停止。`,
        error: 'cancelled'
    });
}

function emitSkillExecutionCancelled(
    executeParams: SkillExecuteParams,
    skillId: string,
    skillStepId: string,
    skillLabel: string
): AgentResult {
    const result = buildCancelledSkillResult(skillLabel);
    executeParams.callbacks?.onStep?.({
        kind: 'stopped',
        title: `能力已停止：${skillLabel}`,
        detail: '用户取消了当前请求。',
        status: 'error',
        toolName: skillId,
        toolCallId: skillStepId,
        percent: 100,
        issue: 'cancelled'
    });
    endTiming(`技能:${skillId}`, { cancelled: true });
    return result;
}

export function getSkillExecutor(skillId: string): SkillExecutor | undefined {
    return executorRegistry.get(skillId);
}

export function registerSkillExecutor(executor: SkillExecutor): void {
    executorRegistry.set(executor.skillId, executor);
}

function withUnifiedSkillRunner(executeParams: SkillExecuteParams): SkillExecuteParams {
    return {
        ...executeParams,
        runSkill: (childSkillId, childExecuteParams) => executeSkillWithExecutor(childSkillId, {
            ...childExecuteParams,
            runtimeDesignBriefDeclaration: childExecuteParams.runtimeDesignBriefDeclaration
                || executeParams.runtimeDesignBriefDeclaration,
            runtimeDesignBriefDigest: childExecuteParams.runtimeDesignBriefDigest
                || executeParams.runtimeDesignBriefDigest,
            runtimeDesignBriefRequiredInputKeys: childExecuteParams.runtimeDesignBriefRequiredInputKeys
                || executeParams.runtimeDesignBriefRequiredInputKeys,
            runtimeReferenceBriefDeclaration: childExecuteParams.runtimeReferenceBriefDeclaration
                || executeParams.runtimeReferenceBriefDeclaration,
            runtimeReferenceBriefDigest: childExecuteParams.runtimeReferenceBriefDigest
                || executeParams.runtimeReferenceBriefDigest,
            runtimeDesignStrategyDeclaration: childExecuteParams.runtimeDesignStrategyDeclaration
                || executeParams.runtimeDesignStrategyDeclaration,
            runtimeDesignStrategyDigest: childExecuteParams.runtimeDesignStrategyDigest
                || executeParams.runtimeDesignStrategyDigest,
            runtimeActionPlanDeclaration: childExecuteParams.runtimeActionPlanDeclaration
                || executeParams.runtimeActionPlanDeclaration,
            runtimeActionPlanDigest: childExecuteParams.runtimeActionPlanDigest
                || executeParams.runtimeActionPlanDigest,
            agentTaskPlan: childExecuteParams.agentTaskPlan || executeParams.agentTaskPlan
        })
    };
}

export async function executeSkillWithExecutor(
    skillId: string,
    executeParams: SkillExecuteParams
): Promise<AgentResult> {
    startTiming(`技能:${skillId}`, { params: Object.keys(executeParams.params) });
    const skillStepId = `skill-${skillId}-${Date.now()}`;

    const skill = getSkillById(skillId);
    if (!skill) {
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `能力不可用：${skillId}`,
            detail: '技能注册表中没有找到该能力。',
            status: 'error',
            toolName: skillId,
            toolCallId: skillStepId,
            issue: 'skill_not_found'
        });
        endTiming(`技能:${skillId}`, { error: 'not found' });
        return attachResolvedSkillOutcome({
            success: false,
            message: buildSkillUnavailableStatusMessage(),
            error: 'Skill not found'
        });
    }

    const userVisibleSkill = skill.visibility === 'user-facing';
    const skillLabel = getSafeSkillLabel(skillId);
    if (isSkillExecutionCancelled(executeParams)) {
        return emitSkillExecutionCancelled(executeParams, skillId, skillStepId, skillLabel);
    }

    executeParams.callbacks?.onProgress?.(
        userVisibleSkill ? `执行能力：${skill.name}` : '正在处理请求',
        0
    );
    executeParams.callbacks?.onMessage?.(
        userVisibleSkill ? `正在执行「${skill.name}」。` : '正在处理请求。'
    );

    const executor = getSkillExecutor(skillId);

    executeParams.callbacks?.onStep?.({
        kind: 'tool_started',
        title: `开始能力：${skillLabel}`,
        detail: `能力 ID: ${skillId}`,
        status: 'running',
        toolName: skillId,
        toolCallId: skillStepId,
        percent: 32
    });

    if (!executor) {
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `能力不可用：${skillLabel}`,
            detail: '该能力缺少可执行处理器。',
            status: 'error',
            toolName: skillId,
            toolCallId: skillStepId,
            issue: 'skill_executor_not_found'
        });
        endTiming(`技能:${skillId}`, { error: 'no executor' });
        return attachResolvedSkillOutcome({
            success: false,
            message: buildSkillUnavailableStatusMessage(),
            error: 'Skill executor not implemented'
        });
    }

    try {
        const preExecutionResult = executor.resolvePreExecutionResult?.(executeParams);
        if (preExecutionResult) {
            const normalizedPreExecutionResult = attachResolvedSkillOutcome(preExecutionResult);
            const outcomeStatus = normalizedPreExecutionResult.skillOutcome!.status;
            const outcomeFailed = isSkillOutcomeFailure(outcomeStatus);
            executeParams.callbacks?.onStep?.({
                kind: 'tool_completed',
                title: `${getSkillOutcomeTitle(outcomeStatus)}：${skillLabel}`,
                detail: summarizeSkillResult(normalizedPreExecutionResult),
                status: outcomeFailed ? 'error' : 'success',
                toolName: skillId,
                toolCallId: skillStepId,
                percent: 95,
                issue: outcomeFailed
                    ? compactSkillResultText(normalizedPreExecutionResult.error) || 'skill_pre_execution_failed'
                    : undefined
            });
            endTiming(`技能:${skillId}`, {
                success: normalizedPreExecutionResult.success,
                outcome: outcomeStatus,
                preExecutionResult: true
            });
            return normalizedPreExecutionResult;
        }

        const scenarioPreparedExecuteParams = await prepareBusinessSkillProjectContextForScenario(skillId, executeParams);
        if (isSkillExecutionCancelled(scenarioPreparedExecuteParams)) {
            return emitSkillExecutionCancelled(scenarioPreparedExecuteParams, skillId, skillStepId, skillLabel);
        }
        const businessVisualContext = buildBusinessVisualContextForSkill(skillId, scenarioPreparedExecuteParams);
        const businessSkillProjectAssetUnderstandingIntake =
            buildBusinessSkillProjectAssetUnderstandingIntakeForSkill(skillId, scenarioPreparedExecuteParams);
        const businessSkillVisualContextPreparation =
            buildBusinessSkillVisualContextPreparationForSkill(skillId, scenarioPreparedExecuteParams);
        const businessSkillInitialExecutionIntake = buildBusinessSkillExecutionIntakeForSkill(skillId, {
            stage: 'before_executor',
            visualContextPreparation: businessSkillVisualContextPreparation
        });
        const preExecutionVisualObservation = await runBusinessSkillVisualObservationRefreshBeforeExecution(
            businessSkillVisualContextPreparation,
            scenarioPreparedExecuteParams
        );
        if (isSkillExecutionCancelled(preExecutionVisualObservation.executeParams)) {
            return emitSkillExecutionCancelled(preExecutionVisualObservation.executeParams, skillId, skillStepId, skillLabel);
        }

        const executeParamsForBusiness = withUnifiedSkillRunner(preExecutionVisualObservation.executeParams);
        const executorResult = await executor.execute(executeParamsForBusiness);
        if (isSkillExecutionCancelled(executeParamsForBusiness)) {
            return emitSkillExecutionCancelled(executeParamsForBusiness, skillId, skillStepId, skillLabel);
        }
        const businessSkillExecutionPreflightGate = buildBusinessSkillExecutionPreflightGateForSkill(
            skillId,
            executeParamsForBusiness,
            executorResult
        );
        const resultWithObservation = attachBusinessSkillExecutionPreflightGateToResult(
            attachBusinessSkillVisualContextPreparationToResult(
                attachBusinessSkillProjectAssetUnderstandingIntakeToResult(
                    attachBusinessVisualContextToResult(executorResult, businessVisualContext),
                    businessSkillProjectAssetUnderstandingIntake
                ),
                businessSkillVisualContextPreparation,
                preExecutionVisualObservation.runSummary
            ),
            businessSkillExecutionPreflightGate,
            executeParamsForBusiness
        );
        const resultWithRefreshObservation = await runBusinessSkillVisualObservationRefreshAfterExecution(
            resultWithObservation,
            businessSkillExecutionPreflightGate,
            executeParamsForBusiness
        );
        if (isSkillExecutionCancelled(executeParamsForBusiness)) {
            return emitSkillExecutionCancelled(executeParamsForBusiness, skillId, skillStepId, skillLabel);
        }
        const resultWithPlacementIntake = attachBusinessSkillImagePlacementVerificationIntakeToResult(
            resultWithRefreshObservation,
            buildBusinessSkillImagePlacementVerificationIntakeForSkill(skillId, resultWithRefreshObservation)
        );
        const resultWithExecutionPlanIntake = attachBusinessSkillExecutionPlanIntakeToResult(
            resultWithPlacementIntake,
            buildBusinessSkillExecutionPlanIntakeForSkill(skillId, resultWithPlacementIntake)
        );
        const resultData = (resultWithExecutionPlanIntake.data || {}) as any;
        const finalExecutionIntake = buildBusinessSkillExecutionIntakeForSkill(skillId, {
            stage: 'after_executor',
            visualContextPreparation: resultData.businessSkillVisualContextPreparation,
            visualContextPreparationRun: resultData.businessSkillVisualContextPreparationRun,
            plannerContext: resultData.businessSkillPreflightPlannerContext,
            refreshPlan: resultData.businessSkillVisualObservationRefreshPlan,
            refreshRun: resultData.businessSkillVisualObservationRefreshRun
        });
        const resultWithoutContinuation = attachResolvedSkillOutcome(attachBusinessSkillExecutionIntakeToResult(
            resultWithExecutionPlanIntake,
            finalExecutionIntake || businessSkillInitialExecutionIntake
        ));
        // 编排器只透传叶子 Skill 已签发的 continuation，不能把同一张卡重新包装成自己的操作。
        // 先解析 owner 也避免在外层收尾重复读取 Photoshop，并把暂停边界绑定到另一份状态。
        const leafInteractiveContinuation = resolvePendingInteractiveContinuationLeaf(resultWithoutContinuation);
        let pendingInteractiveContinuation = leafInteractiveContinuation;
        if (!pendingInteractiveContinuation && userVisibleSkill) {
            const pendingContinuationScopeObservation = await capturePendingContinuationScopeObservation(
                resultWithoutContinuation.skillOutcome!.status,
                executeParamsForBusiness.signal
            );
            pendingInteractiveContinuation = buildPendingInteractiveContinuation({
                skillId,
                params: executeParamsForBusiness.params,
                result: resultWithoutContinuation,
                outcomeStatus: resultWithoutContinuation.skillOutcome!.status,
                sourceTask: String(
                    executeParamsForBusiness.context?.userInput
                    || executeParamsForBusiness.params.userIntent
                    || executeParamsForBusiness.params.userTask
                    || ''
                ),
                requestId: executeParamsForBusiness.context?.requestId,
                conversationId: executeParamsForBusiness.context?.conversationId,
                projectId: executeParamsForBusiness.context?.projectContext?.projectId,
                projectPath: executeParamsForBusiness.context?.projectContext?.projectPath,
                scopeObservation: pendingContinuationScopeObservation,
                agentTaskPlan: executeParamsForBusiness.agentTaskPlan
            }) || undefined;
        }
        const result = attachPendingInteractiveContinuation(
            resultWithoutContinuation,
            pendingInteractiveContinuation || null
        ) as AgentResult;
        const outcomeStatus = result.skillOutcome!.status;
        const outcomeFailed = isSkillOutcomeFailure(outcomeStatus);
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `${getSkillOutcomeTitle(outcomeStatus)}：${skillLabel}`,
            detail: summarizeSkillResult(result),
            status: outcomeFailed ? 'error' : 'success',
            toolName: skillId,
            toolCallId: skillStepId,
            percent: 95,
            issue: outcomeFailed ? compactSkillResultText(result.error) || 'skill_failed' : undefined
        });
        endTiming(`技能:${skillId}`, { success: result.success, outcome: outcomeStatus });
        return result;
    } catch (e: any) {
        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `能力异常：${skillLabel}`,
            detail: compactSkillResultText(e.message) || '能力执行过程发生异常。',
            status: 'error',
            toolName: skillId,
            toolCallId: skillStepId,
            percent: 95,
            issue: compactSkillResultText(e.message) || 'skill_exception'
        });
        endTiming(`技能:${skillId}`, { error: e.message });
        return attachResolvedSkillOutcome({
            success: false,
            message: compactSkillResultText(e.message) || buildSkillUnavailableStatusMessage(),
            error: e.message
        });
    }
}
