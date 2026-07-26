/**
 * v5 Reflexion contract
 *
 * Reflexion is a runtime boundary, not a hidden hardcoded answer.
 * When the workflow cannot safely continue, the runtime must expose a small
 * observe -> critique -> revise contract before any user-visible recovery card.
 */

import type { SkillRuntimeManifest, RuntimeComponentId } from './contracts';
import type {
    PlanningMode,
    VisualObservationBlocker,
    VisualObservationLevel,
    StructureOnlyConstraints
} from './visual-observation-gate';

export type ReflexionTrigger =
    | 'visual_observation_blocked'
    | 'structure_only_fallback';

export type ReflexionPhaseName = 'observe' | 'critique' | 'revise';

export interface RuntimeReflexionPhase {
    phase: ReflexionPhaseName;
    summary: string;
}

export interface RuntimeReflexionContract {
    version: 'runtime-reflexion/v0';
    status: 'required';
    owner: RuntimeComponentId;
    trigger: ReflexionTrigger;
    userVisiblePolicy: 'agent_mediated_before_card';
    phases: RuntimeReflexionPhase[];
}

export interface BuildPlanningReflexionContractInput {
    planningMode: PlanningMode;
    level: VisualObservationLevel;
    taskType: string;
    blocker?: VisualObservationBlocker;
    constraints?: StructureOnlyConstraints;
}

function describeObservationLevel(level: VisualObservationLevel): string {
    switch (level) {
        case 'verified_visual':
            return '已完成本次真实视觉分析。';
        case 'cached_visual_valid':
            return '已有带来源校验的可信视觉缓存。';
        case 'user_confirmed':
            return '只有用户人工确认的产品事实，尚未完成可回读的视觉观察。';
        case 'legacy_unverified':
            return '存在旧视觉缓存，但缺少文件哈希、提示版本或 schema 版本，不能确认它仍对应当前素材。';
        case 'metadata_only':
            return '当前只有尺寸、目录或素材元数据，尚未真实看图。';
        case 'filename_only':
            return '当前只有文件名或路径线索，尚未真实看图。';
        case 'missing':
        default:
            return '当前没有可用的视觉观察结果。';
    }
}

export function buildPlanningReflexionContract(
    input: BuildPlanningReflexionContractInput
): RuntimeReflexionContract {
    const trigger: ReflexionTrigger = input.planningMode === 'structure_only'
        ? 'structure_only_fallback'
        : 'visual_observation_blocked';
    const observation = describeObservationLevel(input.level);
    const blockedMessage = input.blocker?.message || '尚未完成可靠的视觉观察，不能可靠规划。';
    const critique = input.planningMode === 'structure_only'
        ? '结构草案只能表达通用版面与所需内容，不能落地 Photoshop 写入，也不能填写产品事实或卖点文案。'
        : `不能根据文件名、元数据或旧缓存直接生成设计方案；${blockedMessage}`;
    const revise = input.planningMode === 'structure_only'
        ? '下一步应引导用户选择代表图片并完成分析，或仅展示不含产品事实的结构草案供确认。'
        : '下一步应先完成视觉分析、选择代表图片，或让用户明确选择仅查看结构草案。';

    return {
        version: 'runtime-reflexion/v0',
        status: 'required',
        owner: input.planningMode === 'structure_only' ? 'R4' : 'R2',
        trigger,
        userVisiblePolicy: 'agent_mediated_before_card',
        phases: [
            {
                phase: 'observe',
                summary: `观察：任务类型 ${input.taskType}；${observation}`
            },
            {
                phase: 'critique',
                summary: `批判：${critique}`
            },
            {
                phase: 'revise',
                summary: `修正：${revise}`
            }
        ]
    };
}

export type ManifestBoundaryViolationCode =
    | 'TOOL_NAME_NOT_NAMESPACED'
    | 'TOOL_NAMESPACE_INVALID'
    | 'SKILL_ID_LEAKED_IN_TOOL_LIST';

export interface ManifestBoundaryViolation {
    code: ManifestBoundaryViolationCode;
    path: string;
    value: string;
}

export interface ManifestToolSkillBoundaryResult {
    valid: boolean;
    violations: ManifestBoundaryViolation[];
}

export interface ReActLoopPhase {
    phase: 'reason' | 'act' | 'observe' | 'evaluate';
    owner: RuntimeComponentId;
    purpose: string;
}

export interface ReActReflexionLoopContract {
    version: 'react-reflexion-loop/v0';
    r0: {
        owner: 'R0';
        skillId: string;
        taskType: string;
        runtimeStages: string[];
    };
    reactLoop: {
        owner: 'R0';
        phases: ReActLoopPhase[];
        toolBoundary: {
            /** manifest 首轮种子；不是排他的能力上限。 */
            availableTools: string[];
            forbiddenTools: string[];
            availableToolsAreInitialSeeds: true;
            onDemandExpansionAllowed: true;
        };
    };
    qualityGate: {
        owner: 'R5';
        passTarget: 'user_confirmation_or_delivery';
        failTarget: 'reflexion';
    };
    reflexion: {
        owner: 'R5';
        onQualityGateFailure: {
            analyzeFailure: true;
            locateStage: true;
            generateNextRoundConstraints: true;
            reenterLoop: 'react';
        };
    };
}

export interface ReflexionHandoff {
    version: 'quality-gate-reflexion-handoff/v0';
    status: 'reflexion_required' | 'not_required';
    sourceOwner: 'R5';
    targetStage: RuntimeComponentId;
    reenterLoop: 'react';
    failureAnalysis: string[];
    strategyAdjustments: string[];
    nextRoundConstraints: string[];
}

export type RuntimeEvolutionDiagnosisTarget =
    | 'project_memory'
    | 'skill'
    | 'tool_schema'
    | 'workflow'
    | 'context_manager'
    | 'model_router'
    | 'evaluation'
    | 'policy';

export interface RuntimeEvolutionIntake {
    version: 'runtime-evolution-intake/v0';
    status: 'needs_root_cause_diagnosis' | 'blocked_missing_failure_details';
    source: {
        sessionId: string;
        runId: string;
        generation: number;
        skillId: string;
        taskType: string;
        traceEventCount: number;
    };
    currentTaskRepair: {
        targetStage: RuntimeComponentId;
        failureAnalysis: string[];
        strategyAdjustments: string[];
        nextRoundConstraints: string[];
    };
    diagnosisTargets: RuntimeEvolutionDiagnosisTarget[];
    blockers: string[];
    governance: {
        rootCauseRequired: true;
        regressionEvaluationRequired: true;
        humanApprovalRequired: true;
        rollbackVersionRequired: true;
        autoApplyAllowed: false;
        agentMayModifyPolicy: false;
    };
    boundaries: {
        intakeOnly: true;
        doesNotPersistMemory: true;
        doesNotModifySkill: true;
        doesNotModifyWorkflow: true;
        doesNotModifyPolicy: true;
        doesNotChangeTaskResult: true;
    };
}

export interface BuildRuntimeEvolutionIntakeInput {
    sessionId: string;
    runId: string;
    generation: number;
    skillId: string;
    taskType: string;
    traceEventCount: number;
    reflexionHandoff?: ReflexionHandoff;
}

const RUNTIME_EVOLUTION_DIAGNOSIS_TARGETS: readonly RuntimeEvolutionDiagnosisTarget[] = Object.freeze([
    'project_memory',
    'skill',
    'tool_schema',
    'workflow',
    'context_manager',
    'model_router',
    'evaluation',
    'policy'
]);

function compactDistinct(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map(compactText).filter(Boolean)));
}

/**
 * 把“当前任务怎样返工”投影成“未来系统是否需要改变”的待诊断入口。
 *
 * Reflexion 仍只负责当前任务重入；本记录不选择根因 owner，不写 Memory，不改
 * Skill / Workflow / Policy。只有后续诊断、回放评测和人工批准都完成后，才允许
 * 由独立发布流程生成版本变化。
 */
export function buildRuntimeEvolutionIntake(
    input: BuildRuntimeEvolutionIntakeInput
): RuntimeEvolutionIntake | undefined {
    const handoff = input.reflexionHandoff;
    if (!handoff || handoff.status !== 'reflexion_required') return undefined;

    const failureAnalysis = compactDistinct(handoff.failureAnalysis || []);
    const strategyAdjustments = compactDistinct(handoff.strategyAdjustments || []);
    const nextRoundConstraints = compactDistinct(handoff.nextRoundConstraints || []);
    const hasFailureDetails = failureAnalysis.length > 0
        || strategyAdjustments.length > 0
        || nextRoundConstraints.length > 0;

    return {
        version: 'runtime-evolution-intake/v0',
        status: hasFailureDetails
            ? 'needs_root_cause_diagnosis'
            : 'blocked_missing_failure_details',
        source: {
            sessionId: compactText(input.sessionId),
            runId: compactText(input.runId),
            generation: Math.max(0, Math.floor(Number(input.generation) || 0)),
            skillId: compactText(input.skillId),
            taskType: compactText(input.taskType),
            traceEventCount: Math.max(0, Math.floor(Number(input.traceEventCount) || 0))
        },
        currentTaskRepair: {
            targetStage: handoff.targetStage,
            failureAnalysis,
            strategyAdjustments,
            nextRoundConstraints
        },
        diagnosisTargets: [...RUNTIME_EVOLUTION_DIAGNOSIS_TARGETS],
        blockers: hasFailureDetails ? [] : ['failure_details_required_before_evolution_diagnosis'],
        governance: {
            rootCauseRequired: true,
            regressionEvaluationRequired: true,
            humanApprovalRequired: true,
            rollbackVersionRequired: true,
            autoApplyAllowed: false,
            agentMayModifyPolicy: false
        },
        boundaries: {
            intakeOnly: true,
            doesNotPersistMemory: true,
            doesNotModifySkill: true,
            doesNotModifyWorkflow: true,
            doesNotModifyPolicy: true,
            doesNotChangeTaskResult: true
        }
    };
}

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/i;
const TOOL_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.$/i;

function pushToolNameViolations(input: {
    values: readonly string[] | undefined;
    path: string;
    manifest: SkillRuntimeManifest;
    violations: ManifestBoundaryViolation[];
}): void {
    const values = Array.isArray(input.values) ? input.values : [];
    values.forEach((value, index) => {
        const text = String(value || '').trim();
        const path = `${input.path}/${index}`;
        if (!TOOL_NAME_PATTERN.test(text)) {
            input.violations.push({ code: 'TOOL_NAME_NOT_NAMESPACED', path, value: text });
        }
        if (text === input.manifest.skill_id || text === input.manifest.task_type || text.startsWith('skill.')) {
            input.violations.push({ code: 'SKILL_ID_LEAKED_IN_TOOL_LIST', path, value: text });
        }
    });
}

/**
 * Manifest boundary guard:
 * Skill = task capability manifest. Tool = namespaced executable capability.
 * A manifest may list tools it can use, but must not put skill IDs or runtime
 * stages into available_tools / forbidden_tools.
 */
export function validateManifestToolSkillBoundary(
    manifest: SkillRuntimeManifest
): ManifestToolSkillBoundaryResult {
    const violations: ManifestBoundaryViolation[] = [];

    pushToolNameViolations({
        values: manifest.available_tools,
        path: '/available_tools',
        manifest,
        violations
    });
    pushToolNameViolations({
        values: manifest.forbidden_tools,
        path: '/forbidden_tools',
        manifest,
        violations
    });

    const namespaces = Array.isArray(manifest.tool_namespaces) ? manifest.tool_namespaces : [];
    namespaces.forEach((value, index) => {
        const text = String(value || '').trim();
        if (!TOOL_NAMESPACE_PATTERN.test(text) || text === 'skill.') {
            violations.push({ code: 'TOOL_NAMESPACE_INVALID', path: `/tool_namespaces/${index}`, value: text });
        }
    });

    return {
        valid: violations.length === 0,
        violations
    };
}

export function buildReActReflexionLoopContract(
    manifest: SkillRuntimeManifest
): ReActReflexionLoopContract {
    return {
        version: 'react-reflexion-loop/v0',
        r0: {
            owner: 'R0',
            skillId: manifest.skill_id,
            taskType: manifest.task_type,
            runtimeStages: [...manifest.runtime_stages]
        },
        reactLoop: {
            owner: 'R0',
            phases: [
                {
                    phase: 'reason',
                    owner: 'R0',
                    purpose: '判断当前阶段目标、缺口、可用观察与检查结果和下一步动作。'
                },
                {
                    phase: 'act',
                    owner: 'E1',
                    purpose: '调用当前已装载的视觉分析、预览、Photoshop 或交付工具；缺少 schema 时先按需请求能力，禁止项始终不可请求。'
                },
                {
                    phase: 'observe',
                    owner: 'R2',
                    purpose: '读取工具结果、视觉观察、预览状态或 Photoshop 回读结果。'
                },
                {
                    phase: 'evaluate',
                    owner: 'R5',
                    purpose: '判断当前阶段目标是否达成；未达成则带约束继续 ReAct。'
                }
            ],
            toolBoundary: {
                availableTools: [...manifest.available_tools],
                forbiddenTools: [...manifest.forbidden_tools],
                availableToolsAreInitialSeeds: true,
                onDemandExpansionAllowed: true
            }
        },
        qualityGate: {
            owner: 'R5',
            passTarget: 'user_confirmation_or_delivery',
            failTarget: 'reflexion'
        },
        reflexion: {
            owner: 'R5',
            onQualityGateFailure: {
                analyzeFailure: true,
                locateStage: true,
                generateNextRoundConstraints: true,
                reenterLoop: 'react'
            }
        }
    };
}

function normalizeReviewRuntimeUnit(value: unknown): RuntimeComponentId {
    const text = String(value || '').trim();
    if (['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'E1', 'E2'].includes(text)) {
        return text as RuntimeComponentId;
    }
    return 'R4';
}

function compactText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Convert an R5 failed review into constraints for the next ReAct round.
 * This keeps Reflexion as a runtime handoff, not a natural-language apology.
 */
export function buildReflexionHandoffFromReviewReport(reviewReport: any): ReflexionHandoff {
    const payload = reviewReport?.payload || {};
    const passed = payload.qualityPassed === true && payload.gateStatus !== 'failed';
    const targetStage = normalizeReviewRuntimeUnit(payload.rollbackTarget?.runtimeUnit);
    const issues = Array.isArray(payload.issues) ? payload.issues : [];
    const requiredFixes = Array.isArray(payload.requiredFixes) ? payload.requiredFixes : [];
    const suggestedFixes = Array.isArray(payload.suggestedFixes) ? payload.suggestedFixes : [];

    if (passed) {
        return {
            version: 'quality-gate-reflexion-handoff/v0',
            status: 'not_required',
            sourceOwner: 'R5',
            targetStage,
            reenterLoop: 'react',
            failureAnalysis: [],
            strategyAdjustments: [],
            nextRoundConstraints: []
        };
    }

    const failureAnalysis = issues
        .map((issue: any) => compactText(issue.description))
        .filter(Boolean);
    const strategyAdjustments = [
        compactText(payload.rollbackTarget?.reason),
        ...issues.map((issue: any) => compactText(issue.expectedFix))
    ].filter(Boolean);
    const nextRoundConstraints = [
        ...requiredFixes.map(compactText),
        ...suggestedFixes.map(compactText)
    ].filter(Boolean);

    return {
        version: 'quality-gate-reflexion-handoff/v0',
        status: 'reflexion_required',
        sourceOwner: 'R5',
        targetStage,
        reenterLoop: 'react',
        failureAnalysis,
        strategyAdjustments,
        nextRoundConstraints: nextRoundConstraints.length ? nextRoundConstraints : strategyAdjustments
    };
}
