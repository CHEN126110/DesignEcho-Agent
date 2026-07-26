import type { AgentResult } from '../unified-agent.service';
import {
    buildBusinessSkillVisualContext,
    type BusinessSkillVisualContext,
    type BusinessSkillVisualObservationRecord
} from '../../../shared/business-skill-visual-context';
import {
    BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS,
    buildBusinessSkillExecutionPreflightGate,
    type BusinessSkillExecutionPreflightGate
} from '../../../shared/business-skill-execution-preflight-gate';
import {
    buildBusinessSkillPreflightPlannerContext,
    type BusinessSkillPreflightPlannerContext
} from '../../../shared/business-skill-preflight-planner-context';
import {
    buildBusinessSkillVisualObservationRefreshPlan
} from '../../../shared/business-skill-visual-observation-refresh-plan';
import {
    buildBusinessSkillVisualContextPreparation,
    type BusinessSkillVisualContextPreparation
} from '../../../shared/business-skill-visual-context-preparation';
import {
    buildBusinessSkillExecutionIntake,
    type BusinessSkillExecutionIntake,
    type BusinessSkillExecutionIntakeStage,
    type BusinessSkillVisualContextPreparationRunRecord
} from '../../../shared/business-skill-execution-intake';
import {
    buildProjectAssetUnderstandingIntake,
    type ProjectAssetUnderstandingIntake
} from '../../../shared/project-asset-understanding-intake';
import {
    buildBusinessSkillImagePlacementVerificationIntake,
    type BusinessSkillImagePlacementVerificationIntake
} from '../../../shared/business-skill-image-placement-verification-intake';
import {
    buildBusinessSkillExecutionPlanIntake,
    type BusinessSkillExecutionPlanIntake
} from '../../../shared/business-skill-execution-plan-intake';
import type { BusinessDesignSkillId } from '../../../shared/business-skill-implementation-checkpoint';
import { buildBusinessSkillVisualObservationFeedback } from '../../../shared/business-skill-visual-observation-feedback';
import {
    hasConcreteProjectVisualInsight,
    type ProjectVisualSamplingCacheEntry,
    type ProjectVisualSamplingScenario
} from '../../../shared/project-visual-sampling';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import type { SkillExecuteParams } from './types';
import {
    runProjectVisualInsightCacheFill,
    type RunProjectVisualInsightCacheFillInput
} from '../project-visual-insight-cache-fill';
import { buildProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';
import { detectBusinessSkillVisualObservationRefreshRuntime } from './business-skill-visual-observation-runtime';
import { isMainImageWhiteBackgroundFromSkuMaterialRequest } from '../../../shared/main-image-white-background-export-contract';

export function getBusinessVisualObservationScenarioForSkill(skillId: string): ProjectVisualSamplingScenario | undefined {
    return getSkillById(skillId)?.visualSamplingScenario;
}

export function isBusinessVisualObservationSkill(skillId: string): boolean {
    return Boolean(getBusinessVisualObservationScenarioForSkill(skillId));
}

export async function prepareBusinessSkillProjectContextForScenario(
    skillId: string,
    executeParams: SkillExecuteParams
): Promise<SkillExecuteParams> {
    const visualSamplingScenario = getBusinessVisualObservationScenarioForSkill(skillId);
    if (!visualSamplingScenario) return executeParams;

    const projectContext = executeParams.context?.projectContext as any;
    if (!projectContext) return executeParams;

    const currentScenario = projectContext.visualSamplingPlan?.scenario;
    const hasReusableScenarioContext = currentScenario === visualSamplingScenario
        && Boolean(projectContext.assetIndex)
        && Boolean(projectContext.visualSamplingPlan)
        && Boolean(projectContext.visualInsightCache);
    if (hasReusableScenarioContext) {
        return executeParams;
    }

    const projectPath = readOptionalString(projectContext.projectPath || projectContext.contextSnapshot?.project?.path);
    if (!projectPath) {
        return appendProjectContextWarning(
            executeParams,
            `缺少项目路径，无法为 ${skillId} 构建 ${visualSamplingScenario} 场景的只读项目快照。`
        );
    }

    if (typeof window === 'undefined' || !window.designEcho?.buildProjectContextSnapshot) {
        return appendProjectContextWarning(
            executeParams,
            `运行时没有提供 buildProjectContextSnapshot，继续使用 ${currentScenario || 'unknown'} 场景项目快照。`
        );
    }

    try {
        const result = await window.designEcho.buildProjectContextSnapshot({
            projectPath,
            projectName: readOptionalString(projectContext.contextSnapshot?.project?.name),
            selectedAssetPaths: readSelectedAssetPaths(projectContext),
            visualSamplingScenario
        });

        if (!result?.success || !result.contextSnapshot || !result.visualSamplingPlan || !result.assetIndex) {
            return appendProjectContextWarning(
                executeParams,
                `构建 ${visualSamplingScenario} 场景项目快照未返回完整项目信息，继续使用现有项目上下文。`
            );
        }

        return {
            ...executeParams,
            context: {
                ...(executeParams.context as any),
                projectContext: {
                    ...projectContext,
                    assetIndex: result.assetIndex,
                    visualSamplingPlan: result.visualSamplingPlan,
                    visualInsightCache: result.visualInsightCache,
                    contextSnapshot: result.contextSnapshot,
                    contextSnapshotSource: result.source || 'runtime-project-service',
                    contextSnapshotWarnings: mergeUniqueStrings(
                        projectContext.contextSnapshotWarnings,
                        result.warnings
                    ),
                    contextSnapshotLimitations: mergeUniqueStrings(
                        projectContext.contextSnapshotLimitations,
                        result.limitations
                    )
                }
            }
        };
    } catch (error) {
        return appendProjectContextWarning(
            executeParams,
            `构建 ${visualSamplingScenario} 场景项目快照失败：${readErrorText(error)}`
        );
    }
}

export function isBusinessSkillExecutionPreflightSkill(skillId: string): skillId is BusinessDesignSkillId {
    return BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS.includes(skillId as BusinessDesignSkillId);
}

function shouldRequireBusinessVisualObservationForSkill(
    skillId: string,
    executeParams: SkillExecuteParams
): boolean {
    if (skillId !== 'main-image-design') return true;
    return !isMainImageWhiteBackgroundFromSkuMaterialRequest({
        userIntent: executeParams.params?.userIntent || executeParams.context?.userInput,
        imageType: executeParams.params?.imageType,
        sourceAssetKind: executeParams.params?.sourceAssetKind,
        mainImageCapability: executeParams.params?.mainImageCapability
    });
}

export function buildBusinessVisualContextForSkill(
    skillId: string,
    executeParams: SkillExecuteParams
): BusinessSkillVisualContext | undefined {
    const scenario = getBusinessVisualObservationScenarioForSkill(skillId);
    if (!scenario) return undefined;

    const projectContext = executeParams.context?.projectContext;
    const requiresVisualObservation = shouldRequireBusinessVisualObservationForSkill(skillId, executeParams);
    return buildBusinessSkillVisualContext({
        scenario,
        projectPath: projectContext?.projectPath,
        assetIndex: projectContext?.assetIndex,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        visualInsightCache: projectContext?.visualInsightCache,
        requiresVisualObservation,
        contextualSourceCandidateCount: countBusinessContextualSourceCandidates(skillId, executeParams)
    });
}

export function buildBusinessSkillExecutionPreflightGateForSkill(
    skillId: string,
    executeParams: SkillExecuteParams,
    result?: AgentResult
): BusinessSkillExecutionPreflightGate | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    const projectContext = executeParams.context?.projectContext as any;
    const requiresVisualObservation = shouldRequireBusinessVisualObservationForSkill(skillId, executeParams);
    return buildBusinessSkillExecutionPreflightGate({
        skillId,
        requestKind: 'execute_existing',
        contextState: {
            hasProjectContext: Boolean(projectContext),
            hasAssetIndex: Boolean(projectContext?.assetIndex),
            hasVisualSamplingPlan: Boolean(projectContext?.visualSamplingPlan),
            hasVisualUnderstanding: !requiresVisualObservation || hasSkillScenarioVisualUnderstanding(skillId, projectContext),
            hasTemplateResult: hasTemplateResult(result)
        }
    });
}

export function attachBusinessVisualContextToResult(
    result: AgentResult,
    visualContext?: BusinessSkillVisualContext
): AgentResult {
    if (!visualContext) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessVisualContext: visualContext,
            businessVisualObservationFeedback: buildBusinessSkillVisualObservationFeedback(visualContext)
        }
    };
}

export function attachBusinessSkillExecutionPreflightGateToResult(
    result: AgentResult,
    gate?: BusinessSkillExecutionPreflightGate,
    executeParams?: SkillExecuteParams
): AgentResult {
    if (!gate) return result;
    const plannerContext = buildBusinessSkillPreflightPlannerContext(gate);
    const refreshPlan = buildBusinessSkillVisualObservationRefreshPlanForSkill(
        gate.skillId,
        executeParams,
        plannerContext
    );
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillExecutionPreflightGate: gate,
            businessSkillPreflightPlannerContext: plannerContext,
            ...(refreshPlan ? { businessSkillVisualObservationRefreshPlan: refreshPlan } : {})
        }
    };
}

export function buildBusinessSkillExecutionIntakeForSkill(
    skillId: string,
    input: {
        stage: BusinessSkillExecutionIntakeStage;
        visualContextPreparation?: BusinessSkillVisualContextPreparation;
        visualContextPreparationRun?: BusinessSkillVisualContextPreparationRunRecord;
        plannerContext?: BusinessSkillPreflightPlannerContext;
        refreshPlan?: any;
        refreshRun?: any;
    }
): BusinessSkillExecutionIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildBusinessSkillExecutionIntake({
        skillId,
        stage: input.stage,
        visualContextPreparation: input.visualContextPreparation,
        visualContextPreparationRun: input.visualContextPreparationRun,
        plannerContext: input.plannerContext,
        refreshPlan: input.refreshPlan,
        refreshRun: input.refreshRun
    });
}

export function buildBusinessSkillProjectAssetUnderstandingIntakeForSkill(
    skillId: string,
    executeParams: SkillExecuteParams
): ProjectAssetUnderstandingIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildProjectAssetUnderstandingIntake({
        skillId,
        projectContext: executeParams.context?.projectContext as any
    });
}

export function attachBusinessSkillExecutionIntakeToResult(
    result: AgentResult,
    intake?: BusinessSkillExecutionIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillExecutionIntake: intake
        }
    };
}

export function attachBusinessSkillProjectAssetUnderstandingIntakeToResult(
    result: AgentResult,
    intake?: ProjectAssetUnderstandingIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillProjectAssetUnderstandingIntake: intake
        }
    };
}

export function buildBusinessSkillImagePlacementVerificationIntakeForSkill(
    skillId: string,
    result: AgentResult
): BusinessSkillImagePlacementVerificationIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildBusinessSkillImagePlacementVerificationIntake({
        skillId,
        resultData: result.data as Record<string, unknown> | undefined
    });
}

export function attachBusinessSkillImagePlacementVerificationIntakeToResult(
    result: AgentResult,
    intake?: BusinessSkillImagePlacementVerificationIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillImagePlacementVerificationIntake: intake
        }
    };
}

export function buildBusinessSkillExecutionPlanIntakeForSkill(
    skillId: string,
    result: AgentResult
): BusinessSkillExecutionPlanIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildBusinessSkillExecutionPlanIntake({
        skillId,
        resultData: result.data as Record<string, unknown> | undefined
    });
}

export function attachBusinessSkillExecutionPlanIntakeToResult(
    result: AgentResult,
    intake?: BusinessSkillExecutionPlanIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillExecutionPlanIntake: intake
        }
    };
}

export interface BusinessSkillVisualObservationRefreshRunSummary {
    version: 'business-skill-visual-observation-refresh-run/v0';
    status: string;
    attempted: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount: number;
    successCount: number;
    failedCount: number;
    writtenEntryCount: number;
    warnings: string[];
    limitations: string[];
    observations: BusinessSkillVisualObservationRecord[];
    error?: string;
}

export interface BusinessSkillVisualObservationRefreshRunnerOptions {
    runCacheFill?: (input: RunProjectVisualInsightCacheFillInput) => Promise<{
        status?: string;
        analyzedCount?: number;
        successCount?: number;
        failedCount?: number;
        entries?: unknown[];
        warnings?: string[];
        limitations?: string[];
    }>;
}

export interface BusinessSkillVisualContextPreparationRunSummary {
    version: 'business-skill-visual-context-preparation-run/v0';
    stage: 'before_execution';
    status: string;
    attempted: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount: number;
    successCount: number;
    failedCount: number;
    writtenEntryCount: number;
    warnings: string[];
    limitations: string[];
    observations: BusinessSkillVisualObservationRecord[];
    error?: string;
}

export interface BusinessSkillVisualContextPreparationRunnerResult {
    executeParams: SkillExecuteParams;
    runSummary?: BusinessSkillVisualContextPreparationRunSummary;
}

export function buildBusinessSkillVisualContextPreparationForSkill(
    skillId: string,
    executeParams: SkillExecuteParams
): BusinessSkillVisualContextPreparation | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    const params = executeParams.params || {};
    const projectContext = executeParams.context?.projectContext as any;
    const runtimeReady = params.visualObservationRefreshRuntimeReady === true;
    const runtimeCapabilities = detectBusinessSkillVisualObservationRefreshRuntime();
    const requiresVisualObservation = shouldRequireBusinessVisualObservationForSkill(skillId, executeParams);

    return buildBusinessSkillVisualContextPreparation({
        skillId,
        projectPath: projectContext?.projectPath,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        expectedVisualSamplingScenario: getBusinessVisualObservationScenarioForSkill(skillId),
        hasProjectContext: Boolean(projectContext),
        hasAssetIndex: Boolean(projectContext?.assetIndex),
        hasVisualSamplingPlan: Boolean(projectContext?.visualSamplingPlan),
        hasVisualUnderstanding: hasSkillScenarioVisualUnderstanding(skillId, projectContext),
        requiresVisualObservation,
        runBeforeExecution: params.runBusinessVisualObservationRefreshBeforeExecution,
        runtimeCanAnalyze: params.visualObservationRefreshCanAnalyze === true
            || runtimeReady
            || runtimeCapabilities.canAnalyze,
        runtimeCanWriteCache: params.visualObservationRefreshCanWriteCache === true
            || runtimeReady
            || runtimeCapabilities.canWriteCache,
        maxCandidates: params.visualObservationRefreshMaxCandidates
    });
}

export async function runBusinessSkillVisualObservationRefreshBeforeExecution(
    preparation: BusinessSkillVisualContextPreparation | undefined,
    executeParams: SkillExecuteParams,
    options: BusinessSkillVisualObservationRefreshRunnerOptions = {}
): Promise<BusinessSkillVisualContextPreparationRunnerResult> {
    if (!preparation) return { executeParams };

    if (preparation.status !== 'refresh_requested') {
        return { executeParams };
    }

    const plan = preparation.refreshPlan;
    if (!plan || !plan.shouldCallAnalyzer) {
        const runSummary = buildBusinessSkillVisualContextPreparationRunSummary({
            status: 'skipped_plan_not_ready',
            attempted: false,
            planStatus: plan?.status,
            reason: plan?.reason || 'refresh_plan_not_ready',
            warnings: preparation.warnings,
            limitations: preparation.limitations,
            observations: []
        });
        return { executeParams, runSummary };
    }

    const runner = options.runCacheFill || runProjectVisualInsightCacheFill;
    try {
        const fillResult = await runner({
            projectPath: plan.projectPath,
            visualSamplingPlan: executeParams.context?.projectContext?.visualSamplingPlan,
            enabled: true,
            maxCandidates: plan.maxCandidates,
            modelId: readOptionalString(executeParams.params.visualObservationRefreshModelId)
        });
        const runSummary = buildBusinessSkillVisualContextPreparationRunSummary({
            status: fillResult.status || 'unknown',
            attempted: true,
            planStatus: plan.status,
            analyzedCount: fillResult.analyzedCount || 0,
            successCount: fillResult.successCount || 0,
            failedCount: fillResult.failedCount || 0,
            writtenEntryCount: Array.isArray(fillResult.entries) ? fillResult.entries.length : 0,
            warnings: fillResult.warnings || [],
            limitations: [
                '前置刷新只把结构化视觉摘要写入缓存，不把模型 payload 暴露给业务结果。',
                '前置刷新只更新只读上下文，不改变当前设计任务的处理策略。',
                ...(fillResult.limitations || [])
            ],
            observations: buildRefreshRunObservations(
                'business-skill-visual-context-preparation-run',
                fillResult.status,
                fillResult.analyzedCount,
                fillResult.successCount,
                fillResult.failedCount
            )
        });
        const updatedExecuteParams = updateExecuteParamsWithPreExecutionVisualObservation(
            executeParams,
            fillResult.successCount || 0,
            Array.isArray(fillResult.entries)
                ? (fillResult.entries as ProjectVisualSamplingCacheEntry[])
                : []
        );
        return {
            executeParams: updatedExecuteParams,
            runSummary
        };
    } catch (error) {
        const runSummary = buildBusinessSkillVisualContextPreparationRunSummary({
            status: 'failed',
            attempted: true,
            planStatus: plan.status,
            warnings: ['前置素材理解刷新失败；业务 Skill 将继续自行校验实际输入。'],
            limitations: [
                '前置刷新失败不代表业务任务失败。',
                '刷新结果只补充上下文，不拥有业务执行许可。'
            ],
            observations: [],
            error: readErrorText(error)
        });
        return { executeParams, runSummary };
    }
}

export function attachBusinessSkillVisualContextPreparationToResult(
    result: AgentResult,
    preparation?: BusinessSkillVisualContextPreparation,
    runSummary?: BusinessSkillVisualContextPreparationRunSummary
): AgentResult {
    if (!preparation && !runSummary) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            ...(preparation ? { businessSkillVisualContextPreparation: preparation } : {}),
            ...(runSummary ? { businessSkillVisualContextPreparationRun: runSummary } : {})
        }
    };
}

export async function runBusinessSkillVisualObservationRefreshAfterExecution(
    result: AgentResult,
    gate: BusinessSkillExecutionPreflightGate | undefined,
    executeParams: SkillExecuteParams,
    options: BusinessSkillVisualObservationRefreshRunnerOptions = {}
): Promise<AgentResult> {
    if (!gate) return result;

    const resultWithPlan = result.data?.businessSkillVisualObservationRefreshPlan
        ? result
        : attachBusinessSkillExecutionPreflightGateToResult(result, gate, executeParams);
    const plan = (resultWithPlan.data as any)?.businessSkillVisualObservationRefreshPlan;
    if (!plan) return resultWithPlan;

    if (!isBusinessVisualObservationRefreshRunnerEnabled(executeParams.params)) {
        return attachBusinessSkillVisualObservationRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-observation-refresh-run/v0',
            status: 'skipped_runner_disabled',
            attempted: false,
            planStatus: plan.status,
            reason: 'runner_not_enabled',
            analyzedCount: 0,
            successCount: 0,
            failedCount: 0,
            writtenEntryCount: 0,
            warnings: ['素材理解刷新 runner 未显式启用。'],
            limitations: [
                '刷新计划已生成，但不会自动调用视觉模型或写入缓存。',
                '该 runner 只在业务 executor 完成后运行，不能改变当前业务输出。'
            ],
            observations: []
        });
    }

    if (plan.shouldRunRefresh !== true) {
        return attachBusinessSkillVisualObservationRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-observation-refresh-run/v0',
            status: 'skipped_plan_not_ready',
            attempted: false,
            planStatus: plan.status,
            reason: plan.fillPlan?.reason || 'refresh_plan_not_ready',
            analyzedCount: 0,
            successCount: 0,
            failedCount: 0,
            writtenEntryCount: 0,
            warnings: plan.warnings || [],
            limitations: plan.limitations || [],
            observations: []
        });
    }

    const runner = options.runCacheFill || runProjectVisualInsightCacheFill;
    try {
        const fillResult = await runner({
            projectPath: plan.projectPath,
            visualSamplingPlan: executeParams.context?.projectContext?.visualSamplingPlan,
            enabled: true,
            maxCandidates: plan.fillPlan?.maxCandidates,
            modelId: readOptionalString(executeParams.params.visualObservationRefreshModelId)
        });
        return attachBusinessSkillVisualObservationRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-observation-refresh-run/v0',
            status: fillResult.status || 'unknown',
            attempted: true,
            planStatus: plan.status,
            analyzedCount: fillResult.analyzedCount || 0,
            successCount: fillResult.successCount || 0,
            failedCount: fillResult.failedCount || 0,
            writtenEntryCount: Array.isArray(fillResult.entries) ? fillResult.entries.length : 0,
            warnings: fillResult.warnings || [],
            limitations: [
                '刷新 runner 只把结构化视觉摘要写入缓存，不把模型 payload 暴露给业务结果。',
                '刷新 runner 在业务 executor 完成后运行，不能改变当前 Photoshop 输出。',
                ...(fillResult.limitations || [])
            ],
            observations: buildRefreshRunObservations(
                'business-skill-visual-observation-refresh-run',
                fillResult.status,
                fillResult.analyzedCount,
                fillResult.successCount,
                fillResult.failedCount
            )
        });
    } catch (error) {
        return attachBusinessSkillVisualObservationRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-observation-refresh-run/v0',
            status: 'failed',
            attempted: true,
            planStatus: plan.status,
            analyzedCount: 0,
            successCount: 0,
            failedCount: 0,
            writtenEntryCount: 0,
            warnings: ['素材理解刷新 runner 调用失败；当前业务结果保持不变。'],
            limitations: [
                '素材理解刷新失败只作为检查记录，不能直接当成设计任务失败。',
                '该错误不证明视觉理解已完成，也不证明设计质量通过。'
            ],
            observations: [],
            error: readErrorText(error)
        });
    }
}

export function buildBusinessSkillVisualObservationRefreshPlanForSkill(
    skillId: string,
    executeParams: SkillExecuteParams | undefined,
    plannerContext: BusinessSkillPreflightPlannerContext | undefined
) {
    if (!isBusinessSkillExecutionPreflightSkill(skillId) || !plannerContext) return undefined;

    const params = executeParams?.params || {};
    const projectContext = executeParams?.context?.projectContext as any;
    const runtimeReady = params.visualObservationRefreshRuntimeReady === true;
    const runtimeCapabilities = detectBusinessSkillVisualObservationRefreshRuntime();

    return buildBusinessSkillVisualObservationRefreshPlan({
        skillId,
        plannerContext,
        projectPath: projectContext?.projectPath,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        enabled: params.enableVisualObservationRefresh
            ?? params.enableBusinessVisualObservationRefresh
            ?? params.refreshVisualObservation,
        runtimeCanAnalyze: params.visualObservationRefreshCanAnalyze === true || runtimeReady || runtimeCapabilities.canAnalyze,
        runtimeCanWriteCache: params.visualObservationRefreshCanWriteCache === true || runtimeReady || runtimeCapabilities.canWriteCache,
        maxCandidates: params.visualObservationRefreshMaxCandidates
    });
}

function attachBusinessSkillVisualObservationRefreshRun(
    result: AgentResult,
    runSummary: BusinessSkillVisualObservationRefreshRunSummary
): AgentResult {
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillVisualObservationRefreshRun: runSummary
        }
    };
}

function isBusinessVisualObservationRefreshRunnerEnabled(params: Record<string, any>): boolean {
    return params.runBusinessVisualObservationRefresh === true
        || params.executeBusinessVisualObservationRefresh === true
        || params.runVisualObservationRefresh === true;
}

function appendProjectContextWarning(
    executeParams: SkillExecuteParams,
    warning: string
): SkillExecuteParams {
    const projectContext = executeParams.context?.projectContext as any;
    if (!projectContext) return executeParams;

    return {
        ...executeParams,
        context: {
            ...(executeParams.context as any),
            projectContext: {
                ...projectContext,
                contextSnapshotWarnings: mergeUniqueStrings(
                    projectContext.contextSnapshotWarnings,
                    [warning]
                )
            }
        }
    };
}

function readSelectedAssetPaths(projectContext: any): string[] {
    if (Array.isArray(projectContext?.contextSnapshot?.selectedAssetPaths)) {
        return projectContext.contextSnapshot.selectedAssetPaths
            .map((item: unknown) => readOptionalString(item))
            .filter((item: string | undefined): item is string => Boolean(item));
    }
    const selectedProjectImagePath = readOptionalString(projectContext?.selectedProjectImagePath);
    return selectedProjectImagePath ? [selectedProjectImagePath] : [];
}

function countBusinessContextualSourceCandidates(skillId: string, executeParams: SkillExecuteParams): number {
    const context = executeParams.context as any;
    const projectContext = context?.projectContext as any;
    const userText = readOptionalString(context?.userInput) || readOptionalString(executeParams.params?.userIntent) || '';
    const sourceKeys = new Set<string>();

    const addSource = (value: unknown) => {
        const text = readOptionalString(value);
        if (!text) return;
        sourceKeys.add(normalizeSourceKey(text));
    };

    const currentDocument = projectContext?.contextSnapshot?.currentDocument;
    if (isUsableBusinessSource(currentDocument?.path || currentDocument?.name)) {
        addSource(currentDocument.path || currentDocument.name);
    } else if (context?.photoshopContext?.hasDocument && isUsableBusinessSource(context.photoshopContext.documentName)) {
        addSource(context.photoshopContext.documentName);
    }

    const selectedProjectImagePath = readOptionalString(projectContext?.selectedProjectImagePath);
    if (isUsableBusinessSource(selectedProjectImagePath)) addSource(selectedProjectImagePath);

    const contextualDocumentHints = [
        projectContext?.skuDocumentName,
        projectContext?.skuDocumentPath,
        projectContext?.templateDocumentName,
        projectContext?.templateDocumentPath,
        context?.skuDocumentName,
        context?.skuDocumentPath,
        context?.templateDocumentName,
        context?.templateDocumentPath,
        context?.photoshopContext?.skuDocumentName,
        context?.photoshopContext?.skuDocumentPath,
        context?.photoshopContext?.templateDocumentName,
        context?.photoshopContext?.templateDocumentPath
    ];
    for (const hint of contextualDocumentHints) {
        if (isAssetUsableContextDocumentForBusinessSource(skillId, userText, hint)) {
            addSource(hint);
        }
    }

    const contextSnapshotDocuments = [
        projectContext?.contextSnapshot?.skuDocument,
        projectContext?.contextSnapshot?.templateDocument,
        projectContext?.contextSnapshot?.activeSkuDocument,
        projectContext?.contextSnapshot?.activeTemplateDocument
    ];
    for (const documentLike of contextSnapshotDocuments) {
        if (!documentLike || typeof documentLike !== 'object') continue;
        const pathOrName = (documentLike as any).path || (documentLike as any).name;
        if (isAssetUsableContextDocumentForBusinessSource(skillId, userText, pathOrName)) {
            addSource(pathOrName);
        }
    }

    const selectedAssetPaths = readSelectedAssetPaths(projectContext);
    for (const selectedPath of selectedAssetPaths) {
        if (isUsableBusinessSource(selectedPath)) addSource(selectedPath);
    }

    const assets = Array.isArray(projectContext?.assetIndex?.assets)
        ? projectContext.assetIndex.assets
        : [];
    for (const asset of assets) {
        if (!isAssetUsableForBusinessSource(skillId, userText, asset)) continue;
        addSource(asset.path || asset.relativePath || asset.name);
    }

    return sourceKeys.size;
}

function normalizeSourceKey(value: string): string {
    return value.replace(/\\/g, '/').trim().toLowerCase();
}

function getExtension(value: unknown): string {
    const text = String(value || '').trim().toLowerCase();
    const match = text.match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : '';
}

function isUsableBusinessSource(value: unknown): boolean {
    const ext = getExtension(value);
    if (!ext) return false;
    return ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'psd', 'psb'].includes(ext);
}

function isAssetUsableForBusinessSource(
    skillId: string,
    userText: string,
    asset: any
): boolean {
    if (!asset || typeof asset !== 'object') return false;
    if (asset.isOutput === true) return false;
    const pathOrName = asset.path || asset.relativePath || asset.name;
    if (!isUsableBusinessSource(pathOrName)) return false;

    const role = String(asset.role || '');
    const folderRole = String(asset.folderRole || '');
    const nameAndPath = `${asset.name || ''} ${asset.relativePath || ''} ${asset.path || ''}`;
    const wantsSkuSource = /sku/i.test(userText);

    if (asset.isImage === true && /raw-model-wear|raw-product-still|raw-detail-closeup|color-single|unknown/.test(role)) {
        return true;
    }
    if (asset.isDesignDocument === true) {
        if (skillId === 'main-image-design' && wantsSkuSource) {
            return /sku/i.test(nameAndPath) || /psd|sku/i.test(folderRole);
        }
        return /psd|source|素材|原图/i.test(folderRole) || /psd|psb/i.test(role);
    }

    return false;
}

function isAssetUsableContextDocumentForBusinessSource(
    skillId: string,
    userText: string,
    value: unknown
): boolean {
    if (!isUsableBusinessSource(value)) return false;
    const text = String(value || '');
    if (skillId === 'sku-batch') {
        return /sku|psd|psb/i.test(text);
    }
    if (skillId === 'main-image-design' && /sku/i.test(userText)) {
        return /sku|psd|psb/i.test(text);
    }
    if (skillId === 'detail-page-design') {
        return /模板|template|详情|detail|psd|psb/i.test(text);
    }
    return /psd|psb/i.test(text);
}

function mergeUniqueStrings(...values: unknown[]): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
            const text = readOptionalString(item);
            if (!text || seen.has(text)) continue;
            seen.add(text);
            merged.push(text);
        }
    }

    return merged;
}

function buildBusinessSkillVisualContextPreparationRunSummary(input: {
    status: string;
    attempted: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount?: number;
    successCount?: number;
    failedCount?: number;
    writtenEntryCount?: number;
    warnings?: string[];
    limitations?: string[];
    observations?: BusinessSkillVisualObservationRecord[];
    error?: string;
}): BusinessSkillVisualContextPreparationRunSummary {
    return {
        version: 'business-skill-visual-context-preparation-run/v0',
        stage: 'before_execution',
        status: input.status,
        attempted: input.attempted,
        planStatus: input.planStatus,
        reason: input.reason,
        analyzedCount: input.analyzedCount || 0,
        successCount: input.successCount || 0,
        failedCount: input.failedCount || 0,
        writtenEntryCount: input.writtenEntryCount || 0,
        warnings: input.warnings || [],
        limitations: input.limitations || [],
        observations: input.observations || [],
        error: input.error
    };
}

function buildRefreshRunObservations(
    source: string,
    status: unknown,
    analyzedCount: unknown,
    successCount: unknown,
    failedCount: unknown
): BusinessSkillVisualObservationRecord[] {
    const normalizedStatus = readOptionalString(status) || 'unknown';
    const success = Math.max(0, Number(successCount || 0));
    const failed = Math.max(0, Number(failedCount || 0));
    return [{
        source,
        summary: `status=${normalizedStatus}; analyzed=${Math.max(0, Number(analyzedCount || 0))}; success=${success}; failed=${failed}`
    }];
}

function updateExecuteParamsWithPreExecutionVisualObservation(
    executeParams: SkillExecuteParams,
    successCount: number,
    entries: ProjectVisualSamplingCacheEntry[] = []
): SkillExecuteParams {
    if (successCount <= 0) return executeParams;

    const projectContext = executeParams.context?.projectContext as any;
    if (!projectContext) return executeParams;

    const previousCache = projectContext.visualInsightCache || {};
    const previousEntries = Array.isArray(previousCache.entries) ? previousCache.entries : [];
    const readResult = buildProjectVisualInsightCacheReadResult({
        source: 'provided-options',
        exists: previousCache.exists !== false || entries.length > 0,
        entries: [
            ...previousEntries,
            ...entries
        ],
        warning: previousCache.warning
    });
    const previousSummary = previousCache.summary || {};
    const previousEntriesWithInsight = Number(previousSummary.entriesWithInsight || 0);
    const previousTotalEntries = Number(previousSummary.totalEntries || 0);
    const visualInsightCache = {
        cacheVersion: readResult.cacheVersion,
        source: readResult.source,
        cachePath: readResult.cachePath,
        exists: readResult.exists,
        entries: readResult.entries,
        warnings: [
            ...(Array.isArray(previousCache.warnings) ? previousCache.warnings : []),
            ...readResult.warnings
        ].filter(Boolean),
        limitations: [
            ...(Array.isArray(previousCache.limitations) ? previousCache.limitations : []),
            ...readResult.limitations
        ].filter(Boolean),
        summary: {
            ...readResult.summary,
            totalEntries: Math.max(readResult.summary.totalEntries, previousTotalEntries, previousEntriesWithInsight + successCount),
            entriesWithInsight: Math.max(readResult.summary.entriesWithInsight, previousEntriesWithInsight + successCount)
        }
    };

    return {
        ...executeParams,
        context: {
            ...(executeParams.context as any),
            projectContext: {
                ...projectContext,
                visualInsightCache
            }
        }
    };
}

function readOptionalString(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return text || undefined;
}

function readErrorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || '').trim() || 'unknown refresh runner error';
}

function hasVisualUnderstanding(projectContext: any): boolean {
    const entries = projectContext?.visualInsightCache?.entries;
    if (Array.isArray(entries) && entries.some((entry) => hasConcreteProjectVisualInsight(entry?.insight))) {
        return true;
    }

    const selectedCandidates = projectContext?.visualSamplingPlan?.selectedCandidates;
    return Array.isArray(selectedCandidates)
        && selectedCandidates.some((candidate) => hasConcreteProjectVisualInsight(candidate?.cachedInsight));
}

function hasSkillScenarioVisualUnderstanding(skillId: string, projectContext: any): boolean {
    const expectedScenario = getBusinessVisualObservationScenarioForSkill(skillId);
    if (expectedScenario && projectContext?.visualSamplingPlan?.scenario !== expectedScenario) {
        return false;
    }
    return hasVisualUnderstanding(projectContext);
}

function hasTemplateResult(result: AgentResult | undefined): boolean {
    const data = result?.data as Record<string, unknown> | undefined;
    if (!data) return false;

    return Boolean(
        data.designAgentOs
        || data.templateBlueprint
        || data.detailPageSkillReadiness
        || data.readiness
        || data.mainImageAgentDraft
        || data.mainImageWhiteBackgroundExportContract
        || data.skuPlan
        || data.executionPlan
    );
}
