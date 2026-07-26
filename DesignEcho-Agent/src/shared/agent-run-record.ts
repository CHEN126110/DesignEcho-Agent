/**
 * Agent Run Record（Harness v1 · H1）：一次自主运行 = 一条可持久化、可回放的运行记录。
 *
 * 背景：此前运行状态只活在内存——触上限/中断即全丢，续跑靠从聊天历史反推
 * （agent-resumable-task-contract 是消息考古，不是状态恢复）；过程审计要手扒
 * conversations JSON。本模块把 AgentRunResult 已携带的全部事件（toolCallLog/
 * executionSummary/stopReason）+ 控制面决策，组装成统一 Trace 记录。
 *
 * 纯逻辑（无 IPC / 无文件系统 / 无 Date.now），smoke 可测：
 *  - 工具调用一律摘要化：不存原始 arguments/result（可能含 base64 大对象），
 *    只存 argsKeys/摘要行/成败/风险类，boundaries.argsDigestedOnly 钉死。
 *  - 风险分类复用 isAgentToolExecutionGuarded 单一口径（写类判定与新鲜度门禁同源）。
 *  - checkpoint v0 只记录可从日志确定性推导的状态旗标（为 H2 续跑供数，不宣称已可续跑）。
 *
 * 持久化在 main 进程 handler（agentRun:writeRecord，原子写 <project>/.designecho/runs/），
 * 写入方是 autonomous-agent 执行器边缘——记录失败绝不影响任务结果。
 */

import { isAgentToolExecutionGuarded } from './agent-tool-execution-preflight';
import {
    readPhotoshopHistoryTransition,
    readPhotoshopMutationCommit,
    type PhotoshopMutationCommit,
    type PhotoshopHistoryTransition
} from './photoshop-history-state-ref';
import type { RuntimeStageState } from './agent-runtime-v5/runtime-stage-state';
import type { RuntimeStageTraceDigest } from './agent-runtime-v5/runtime-stage-trace';
import type { RuntimeDesignBriefDigest } from './agent-runtime-v5/runtime-design-brief-declaration';
import type { RuntimeDesignStrategyDigest } from './agent-runtime-v5/runtime-design-strategy-declaration';
import type { RuntimeActionPlanDigest } from './agent-runtime-v5/runtime-action-plan-declaration';
import type { RuntimeActionPlanReconciliationDigest } from './agent-runtime-v5/runtime-action-plan-reconciliation';
import type { RuntimeActionPlanNoRedoShadowDigest } from './agent-runtime-v5/runtime-action-plan-no-redo-shadow';
import type { RuntimePlanningContextSeedDigest } from './agent-runtime-v5/runtime-planning-context-seed';
import {
    MAX_ARTIFACT_REFS,
    readArtifactRef,
    readArtifactRepositoryProjection,
    type ArtifactRepositoryReadProjection
} from './agent-runtime-v5/artifact-repository-contract';
import type { ArtifactRef } from './agent-runtime-v5/contracts/common';
import {
    validateRuntimeSessionIdentity,
    type RuntimeSessionDigest,
    type RuntimeSessionIdentity
} from './agent-runtime-v5/runtime-session';
import {
    buildRuntimeResumeContextAnchor,
    type RuntimeActionPlanResumeFreshness,
    type RuntimeResumeContextAnchor
} from './agent-runtime-v5/runtime-action-plan-resume-freshness';
import type { DesignVerdict } from './design-quality-verdict-bundle';

export type AgentRunRecordVersion = 'agent-run-record/v0';

export type RunToolRiskClass = 'write' | 'read';
export type AgentRunToolCallOrigin =
    | 'model_tool_call'
    | 'harness_opening_observation'
    | 'harness_quality_verification';
export type AgentRunQualityVerificationPhase = 'pre_judge' | 'post_judge' | 'final_summary';

export interface AgentRunToolCallEntry {
    seq: number;
    name: string;
    riskClass: RunToolRiskClass;
    success: boolean;
    /** 可选来源；旧运行记录缺省时仍按模型调用兼容。 */
    origin?: AgentRunToolCallOrigin;
    /** Harness 质量复核的闭合相位；只在 origin=harness_quality_verification 时保存。 */
    qualityVerificationPhase?: AgentRunQualityVerificationPhase;
    /** 写调用窗口的紧凑 Host before/after 对账；仍来自同一 Tool 结果，不另建版本账本。 */
    photoshopHistoryTransition?: PhotoshopHistoryTransition;
    /** UXP 在同一 executeAsModal 内形成的调用级提交；优先于外围快照对账。 */
    photoshopMutationCommit?: PhotoshopMutationCommit;
    /** 结果里的错误码（如有），如 blocked_missing_per_size_template */
    code?: string;
    /** 一行摘要（≤160 字符，已剥 base64/data URL），来自 error/message/固定成功语 */
    summary: string;
    /** 入参顶层键名（不存值——防大对象与敏感内容入档） */
    argsKeys: string[];
}

/** 本轮创建的关键画布实体（实体锚）：续跑时防止把自己的半成品当成文档原有内容而重做。 */
export interface AgentRunPlacedLayer {
    layerId: number;
    name?: string;
}

/** H2 续跑的确定性状态旗标：只记能从工具日志推导的事实，不做任何推测。 */
export interface AgentRunCheckpoint {
    documentCreated: boolean;
    layoutRendered: boolean;
    lastToolName?: string;
    successfulToolCount: number;
    /** 成功 placeImage 产物的图层 id/名（上限 8 条；结果里提不到 id 就不记，不臆造） */
    placedLayers?: AgentRunPlacedLayer[];
}

export interface AgentRunRecord {
    version: AgentRunRecordVersion;
    runId: string;
    /** Reflexion 重入链：本轮若是复盘重跑，指向上一轮记录 */
    parentRunId?: string;
    endedAt: string;
    goal: string;
    decision?: {
        requestKind?: string;
        route?: string;
        skillId?: string;
    };
    projectPath?: string;
    iterations: number;
    stopReason?: string;
    success: boolean;
    cancelled?: boolean;
    toolCalls: AgentRunToolCallEntry[];
    /** 超出上限被截断的调用数（中段丢弃，保头尾） */
    droppedToolCalls: number;
    blockers: string[];
    warnings: string[];
    quality?: {
        executionStatus?: string;
        hardBlocked?: boolean;
        verdictStatus?: DesignVerdict['status'];
        verdictSource?: DesignVerdict['source'];
        overallScore?: number;
    };
    /** 当前 generation 的生产 Runtime Session 摘要；runId 必须与记录主键完全一致。 */
    runtimeSession?: RuntimeSessionDigest;
    /** 仅由主进程 Artifact Repository reader 附加；不保存 payload、路径或调用方 hash。 */
    artifactRefs?: ArtifactRef[];
    /** 同一 Runtime identity 下超过持久化上限、未进入本记录的 Repository ref 数。 */
    droppedArtifactRefCount?: number;
    /** 同一活动 Session 内规划声明承接的审计摘要；绝不包含完整声明。 */
    planningContextCarry?: RuntimePlanningContextSeedDigest;
    /** Stage State 的脱敏摘要；完整 transition ledger 仍随本轮 Agent result 暂存，不复制进运行档案。 */
    stageState?: {
        status: RuntimeStageState['status'];
        currentStage?: string;
        lastDecision?: string;
        lastTargetStage?: string;
        transitionCount: number;
        issueCount: number;
    };
    /** Shadow Stage Trace 的脱敏对账摘要；完整 events 不进入长期运行档案。 */
    stageTrace?: {
        status: RuntimeStageTraceDigest['status'];
        eventCount: number;
        droppedEventCount: number;
        observedStages: string[];
        missingStages: string[];
        outOfOrderCount: number;
        unbackedTransitionCount: number;
        traceEventWithoutTransitionCount: number;
        issueCount: number;
    };
    /** 模型 R1 Design Brief 的续跑摘要；完整输入覆盖声明不进入长期运行档案。 */
    designBrief?: {
        readiness: RuntimeDesignBriefDigest['readiness'];
        taskGoal: string;
        deliverables: string[];
        requiredInputCount: number;
        providedRequiredInputCount: number;
        missingRequiredInputKeys: string[];
        assumedRequiredInputKeys: string[];
        contextRefs: string[];
        constraintCount: number;
    };
    /** 模型 R3 策略的续跑摘要；完整声明不进入长期运行档案。 */
    designStrategy?: {
        readiness: RuntimeDesignStrategyDigest['readiness'];
        stageGoal: string;
        primaryGoal: string;
        targetAudienceSummary: string;
        primaryMessage: string;
        moodKeywords: string[];
        compositionIntent: string[];
        contextRefs: string[];
        constraintCount: number;
        assumptionCount: number;
        missingInputCount: number;
    };
    /** 模型 R4 动态行动计划的续跑摘要；完整步骤、依赖图和 DSL 不进入长期运行档案。 */
    actionPlan?: {
        readiness: RuntimeActionPlanDigest['readiness'];
        planGoal: string;
        strategyStageGoal: string;
        stepCount: number;
        stepKinds: string[];
        rootStepIds: string[];
        terminalStepIds: string[];
        parallelGroupCount: number;
        capabilityRefs: string[];
        missingCapabilityRefs: string[];
        contextRefs: string[];
        designDsl?: {
            compositionIntent: string;
            regionCount: number;
            elementCount: number;
            readingOrder: string[];
        };
        missingInputCount: number;
        resumeReuseCount: number;
        resumeRedoRequiredCount: number;
    };
    /** R4 节点执行影子对账摘要；完整步骤状态和 observation attribution 不进入长期档案。 */
    actionPlanReconciliation?: {
        status: RuntimeActionPlanReconciliationDigest['status'];
        planReadiness: RuntimeActionPlanReconciliationDigest['planReadiness'];
        stepCount: number;
        completedStepIds: string[];
        completedStepDescriptors?: Array<{
            stepId: string;
            kind: string;
            capabilityRefs: string[];
            observedOutcomes: string[];
        }>;
        failedStepIds: string[];
        recoveredStepIds: string[];
        resumeStepIds: string[];
        observationCount: number;
        droppedObservationCount: number;
        ambiguousObservationCount: number;
        dependencyBlockedObservationCount: number;
        unmatchedObservationCount: number;
        repeatAfterCompletionCount: number;
        issueCount: number;
    };
    /** 跨轮防重做影子摘要；完整映射和当前 observation 不进入长期档案。 */
    actionPlanNoRedoShadow?: {
        status: RuntimeActionPlanNoRedoShadowDigest['status'];
        sourceRunId?: string;
        reuseCandidateStepIds: string[];
        repeatObservedStepIds: string[];
        intentionalRedoStepIds: string[];
        intentionalRedoObservedStepIds: string[];
        verifiedPriorCompletedStepCount: number;
        mappingCount: number;
        unmappedVerifiedPriorStepCount: number;
    };
    /** 上一轮结束时的 Context 指纹；只含 digest，不含原始文档 / 项目状态。 */
    contextAnchor?: RuntimeResumeContextAnchor;
    /** 本轮若采用旧档案，记录其新鲜度裁决；仍是建议性诊断信息。 */
    resumeFreshness?: RuntimeActionPlanResumeFreshness;
    checkpoint: AgentRunCheckpoint;
    boundaries: {
        argsDigestedOnly: true;
        containsRawImages: false;
        neverBlocksTaskResult: true;
        stageStateDigestOnly?: true;
        stageTraceDigestOnly?: true;
        designBriefDigestOnly?: true;
        designStrategyDigestOnly?: true;
        actionPlanDigestOnly?: true;
        actionPlanReconciliationDigestOnly?: true;
        actionPlanNoRedoShadowDigestOnly?: true;
        contextAnchorDigestOnly?: true;
        resumeFreshnessDigestOnly?: true;
        runtimeSessionDigestOnly?: true;
        planningContextCarryDigestOnly?: true;
        artifactRefsFromRepositoryOnly?: true;
    };
}

export interface BuildAgentRunRecordInput {
    /** ISO 时间（调用方传入，本模块不取时钟） */
    now: string;
    goal: unknown;
    projectPath?: unknown;
    projectState?: unknown;
    parentRunId?: string;
    /** 由生产 Runtime 在执行前签发；存在时取代收尾阶段的 late runId 生成。 */
    runtimeSessionIdentity?: RuntimeSessionIdentity;
    resumeFreshness?: RuntimeActionPlanResumeFreshness;
    controlPlane?: {
        requestKind?: unknown;
        route?: unknown;
        skillId?: unknown;
    } | null;
    result: {
        success?: unknown;
        cancelled?: unknown;
        iterations?: unknown;
        stopReason?: unknown;
        error?: unknown;
        toolCallLog?: Array<{
            name?: unknown;
            arguments?: unknown;
            result?: unknown;
            origin?: unknown;
            qualityVerificationPhase?: unknown;
        }>;
        executionSummary?: {
            status?: unknown;
            blockers?: unknown;
            warnings?: unknown;
            designQualityHardBlocked?: unknown;
            designVerdict?: DesignVerdict;
            runtimeStageState?: RuntimeStageState;
            runtimeStageTraceDigest?: RuntimeStageTraceDigest;
            runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
            runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
            runtimeActionPlanDigest?: RuntimeActionPlanDigest;
            runtimeActionPlanReconciliationDigest?: RuntimeActionPlanReconciliationDigest;
            runtimeActionPlanNoRedoShadowDigest?: RuntimeActionPlanNoRedoShadowDigest;
            runtimeSessionDigest?: RuntimeSessionDigest;
            runtimePlanningContextSeedDigest?: RuntimePlanningContextSeedDigest;
        } | null;
    };
}

const MAX_TOOL_CALLS = 400;
const KEEP_HEAD = 200;
const KEEP_TAIL = 200;
const MAX_LIST = 20;
const MAX_SUMMARY_CHARS = 160;
const MAX_GOAL_CHARS = 400;

const AGENT_RUN_RECORD_ALLOWED_KEYS = new Set<string>([
    'version',
    'runId',
    'parentRunId',
    'endedAt',
    'goal',
    'decision',
    'projectPath',
    'iterations',
    'stopReason',
    'success',
    'cancelled',
    'toolCalls',
    'droppedToolCalls',
    'blockers',
    'warnings',
    'quality',
    'runtimeSession',
    'artifactRefs',
    'droppedArtifactRefCount',
    'planningContextCarry',
    'stageState',
    'stageTrace',
    'designBrief',
    'designStrategy',
    'actionPlan',
    'actionPlanReconciliation',
    'actionPlanNoRedoShadow',
    'contextAnchor',
    'resumeFreshness',
    'checkpoint',
    'boundaries'
] as const satisfies readonly (keyof AgentRunRecord)[]);

const AGENT_RUN_RECORD_BOUNDARY_ALLOWED_KEYS = new Set<string>([
    'argsDigestedOnly',
    'containsRawImages',
    'neverBlocksTaskResult',
    'stageStateDigestOnly',
    'stageTraceDigestOnly',
    'designBriefDigestOnly',
    'designStrategyDigestOnly',
    'actionPlanDigestOnly',
    'actionPlanReconciliationDigestOnly',
    'actionPlanNoRedoShadowDigestOnly',
    'contextAnchorDigestOnly',
    'resumeFreshnessDigestOnly',
    'runtimeSessionDigestOnly',
    'planningContextCarryDigestOnly',
    'artifactRefsFromRepositoryOnly'
] as const satisfies readonly (keyof AgentRunRecord['boundaries'])[]);

function cleanText(value: unknown, maxLen: number): string {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return stripBulkPayloads(text).slice(0, maxLen);
}

function cleanStrategyText(value: unknown, maxLen: number): string {
    return cleanText(value, maxLen)
        .replace(/[A-Za-z]:[\\/][^\s，。；;]*/g, '[local-path-omitted]')
        .replace(/\\\\[^\\/\s]+[\\/][^\s，。；;]*/g, '[local-path-omitted]')
        .replace(/\/(?:Users|home|tmp|var|private)\/[^\s，。；;]*/g, '[local-path-omitted]')
        .slice(0, maxLen);
}

function cleanStrategyList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => cleanStrategyText(item, MAX_SUMMARY_CHARS))
        .filter(Boolean)
        .slice(0, limit);
}

function cleanStableRefs(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => String(item || '').trim())
        .filter((item) => /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(item))))
        .slice(0, limit);
}

/** 剥 data URL 与长 base64 串——记录里绝不进图像字节。 */
function stripBulkPayloads(text: string): string {
    return text
        .replace(/data:[a-zA-Z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/g, '[image-data-omitted]')
        .replace(/[A-Za-z0-9+/=]{200,}/g, '[bulk-payload-omitted]');
}

function stableHash(input: string): string {
    // FNV-1a 32bit，十六进制——确定性、无依赖（与仓内其他纯逻辑哈希做法一致）
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function generateAgentRunId(now: string, goal: string, toolNames: string[]): string {
    const compactTime = String(now || '').replace(/[-:TZ.]/g, '').slice(0, 14) || 'unknown';
    return `run-${compactTime}-${stableHash(goal)}-${stableHash(toolNames.join('>')).slice(0, 4)}`;
}

function digestToolCall(
    entry: {
        name?: unknown;
        arguments?: unknown;
        result?: unknown;
        origin?: unknown;
        qualityVerificationPhase?: unknown;
    },
    seq: number
): AgentRunToolCallEntry {
    const name = cleanText(entry.name, 80) || 'unknown_tool';
    const result = (entry.result && typeof entry.result === 'object') ? entry.result as Record<string, unknown> : {};
    const success = result.success !== false;
    const code = cleanText(result.code, 60);
    const rawSummary = !success
        ? (result.error ?? result.message ?? '失败（无错误信息）')
        : (result.message ?? '成功');
    const args = (entry.arguments && typeof entry.arguments === 'object' && !Array.isArray(entry.arguments))
        ? entry.arguments as Record<string, unknown>
        : {};
    const origin = entry.origin === 'model_tool_call'
        || entry.origin === 'harness_opening_observation'
        || entry.origin === 'harness_quality_verification'
        ? entry.origin
        : undefined;
    const qualityVerificationPhase = origin === 'harness_quality_verification'
        && (entry.qualityVerificationPhase === 'pre_judge'
            || entry.qualityVerificationPhase === 'post_judge'
            || entry.qualityVerificationPhase === 'final_summary')
        ? entry.qualityVerificationPhase
        : undefined;
    const photoshopHistoryTransition = readPhotoshopHistoryTransition(result);
    const photoshopMutationCommit = readPhotoshopMutationCommit(result);
    return {
        seq,
        name,
        riskClass: isAgentToolExecutionGuarded(name) ? 'write' : 'read',
        success,
        ...(origin ? { origin } : {}),
        ...(qualityVerificationPhase ? { qualityVerificationPhase } : {}),
        ...(photoshopMutationCommit ? { photoshopMutationCommit } : {}),
        ...(photoshopHistoryTransition ? { photoshopHistoryTransition } : {}),
        ...(code ? { code } : {}),
        summary: cleanText(rawSummary, MAX_SUMMARY_CHARS) || (success ? '成功' : '失败'),
        argsKeys: Object.keys(args).slice(0, 12)
    };
}

const MAX_PLACED_LAYERS = 8;

/** 从成功 placeImage 的原始结果里提取实体锚（layerId 必需；提不到不记，不臆造）。 */
function derivePlacedLayers(rawLog: unknown[]): AgentRunPlacedLayer[] {
    const placed: AgentRunPlacedLayer[] = [];
    for (const entry of rawLog) {
        if (placed.length >= MAX_PLACED_LAYERS) break;
        const record = entry as { name?: unknown; result?: unknown } | null;
        if (!record || String(record.name || '') !== 'placeImage') continue;
        const result = record.result as Record<string, any> | null | undefined;
        if (!result || result.success === false) continue;
        const layerId = Number(result.layerId ?? result.layer?.id ?? result.data?.layerId ?? result.newLayerId);
        if (!Number.isFinite(layerId) || layerId <= 0) continue;
        const rawName = result.layerName ?? result.layer?.name ?? result.data?.layerName;
        const name = cleanText(rawName, 40);
        placed.push(name ? { layerId, name } : { layerId });
    }
    return placed;
}

function deriveCheckpoint(calls: AgentRunToolCallEntry[], rawLog: unknown[]): AgentRunCheckpoint {
    let documentCreated = false;
    let layoutRendered = false;
    let successfulToolCount = 0;
    for (const call of calls) {
        if (!call.success) continue;
        if (call.origin === 'harness_opening_observation'
            || call.origin === 'harness_quality_verification') continue;
        successfulToolCount += 1;
        if (call.name === 'createDocument') documentCreated = true;
        if (call.name === 'renderLayout') layoutRendered = true;
    }
    const last = [...calls].reverse().find((call) => (
        call.origin !== 'harness_opening_observation'
        && call.origin !== 'harness_quality_verification'
    ));
    const placedLayers = derivePlacedLayers(rawLog);
    return {
        documentCreated,
        layoutRendered,
        ...(last ? { lastToolName: last.name } : {}),
        successfulToolCount,
        ...(placedLayers.length > 0 ? { placedLayers } : {})
    };
}

function cleanList(value: unknown, limit = MAX_LIST): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => cleanText(item, MAX_SUMMARY_CHARS))
        .filter(Boolean)
        .slice(0, limit);
}

export function buildAgentRunRecord(input: BuildAgentRunRecordInput): AgentRunRecord {
    const goal = cleanText(input.goal, MAX_GOAL_CHARS);
    const rawLog = Array.isArray(input.result.toolCallLog) ? input.result.toolCallLog : [];

    // 全量摘要化后按上限截断：保头（任务如何开局）+ 保尾（如何收场），中段计数丢弃
    const digestedAll = rawLog.map((entry, index) => digestToolCall(entry, index + 1));
    let toolCalls = digestedAll;
    let droppedToolCalls = 0;
    if (digestedAll.length > MAX_TOOL_CALLS) {
        droppedToolCalls = digestedAll.length - KEEP_HEAD - KEEP_TAIL;
        toolCalls = [...digestedAll.slice(0, KEEP_HEAD), ...digestedAll.slice(-KEEP_TAIL)];
    }

    const summary = input.result.executionSummary || null;
    const runtimeStageState = summary?.runtimeStageState;
    const runtimeStageTraceDigest = summary?.runtimeStageTraceDigest;
    const runtimeDesignBriefDigest = summary?.runtimeDesignBriefDigest;
    const runtimeDesignStrategyDigest = summary?.runtimeDesignStrategyDigest;
    const runtimeActionPlanDigest = summary?.runtimeActionPlanDigest;
    const runtimeActionPlanReconciliationDigest = summary?.runtimeActionPlanReconciliationDigest;
    const runtimeActionPlanNoRedoShadowDigest = summary?.runtimeActionPlanNoRedoShadowDigest;
    const runtimeSessionDigest = summary?.runtimeSessionDigest;
    const runtimePlanningContextSeedDigest = summary?.runtimePlanningContextSeedDigest;
    const runtimeSessionIdentity = input.runtimeSessionIdentity;
    if (runtimeSessionIdentity) {
        const validation = validateRuntimeSessionIdentity(runtimeSessionIdentity);
        if (!validation.ok) throw new Error(validation.issues.join(','));
    }
    if (runtimeSessionIdentity && runtimeSessionDigest && (
        runtimeSessionIdentity.sessionId !== runtimeSessionDigest.sessionId
        || runtimeSessionIdentity.runId !== runtimeSessionDigest.runId
        || runtimeSessionIdentity.generation !== runtimeSessionDigest.generation
    )) {
        throw new Error('runtime_session_run_record_identity_mismatch');
    }
    if (runtimeSessionIdentity?.parentRunId
        && input.parentRunId
        && runtimeSessionIdentity.parentRunId !== input.parentRunId) {
        throw new Error('runtime_session_run_record_parent_mismatch');
    }
    if (runtimeSessionDigest?.parentRunId
        && input.parentRunId
        && runtimeSessionDigest.parentRunId !== input.parentRunId) {
        throw new Error('runtime_session_run_record_parent_mismatch');
    }
    const contextAnchor = buildRuntimeResumeContextAnchor({
        toolCallLog: rawLog,
        projectState: input.projectState
    });
    const lastStageTransition = runtimeStageState?.transitions?.[runtimeStageState.transitions.length - 1];
    const controlPlane = input.controlPlane || null;
    const decision = controlPlane
        ? {
            ...(cleanText(controlPlane.requestKind, 60) ? { requestKind: cleanText(controlPlane.requestKind, 60) } : {}),
            ...(cleanText(controlPlane.route, 60) ? { route: cleanText(controlPlane.route, 60) } : {}),
            ...(cleanText(controlPlane.skillId, 60) ? { skillId: cleanText(controlPlane.skillId, 60) } : {})
        }
        : undefined;
    const projectPath = cleanText(input.projectPath, 260);

    return {
        version: 'agent-run-record/v0',
        runId: runtimeSessionIdentity?.runId
            || runtimeSessionDigest?.runId
            || generateAgentRunId(input.now, goal, digestedAll.map((call) => call.name)),
        ...(runtimeSessionIdentity?.parentRunId
            ? { parentRunId: runtimeSessionIdentity.parentRunId }
            : (runtimeSessionDigest?.parentRunId
                ? { parentRunId: runtimeSessionDigest.parentRunId }
                : (input.parentRunId ? { parentRunId: input.parentRunId } : {}))),
        endedAt: cleanText(input.now, 40),
        goal,
        ...(decision && Object.keys(decision).length > 0 ? { decision } : {}),
        ...(projectPath ? { projectPath } : {}),
        iterations: Number(input.result.iterations) || 0,
        ...(cleanText(input.result.stopReason, 60) ? { stopReason: cleanText(input.result.stopReason, 60) } : {}),
        success: input.result.success === true,
        ...(input.result.cancelled === true ? { cancelled: true } : {}),
        toolCalls,
        droppedToolCalls,
        blockers: cleanList(summary?.blockers),
        warnings: cleanList(summary?.warnings),
        ...(summary
            ? {
                quality: {
                    ...(cleanText(summary.status, 40) ? { executionStatus: cleanText(summary.status, 40) } : {}),
                    ...(summary.designQualityHardBlocked === true ? { hardBlocked: true } : {}),
                    ...(summary.designVerdict ? { verdictStatus: summary.designVerdict.status } : {}),
                    ...(summary.designVerdict ? { verdictSource: summary.designVerdict.source } : {}),
                    ...(typeof summary.designVerdict?.overallScore === 'number'
                        ? { overallScore: summary.designVerdict.overallScore }
                        : {})
                }
            }
            : {}),
        ...(runtimeSessionDigest ? { runtimeSession: runtimeSessionDigest } : {}),
        ...(runtimePlanningContextSeedDigest ? {
            planningContextCarry: {
                ...runtimePlanningContextSeedDigest,
                carriedStages: [...runtimePlanningContextSeedDigest.carriedStages],
                invalidatedStages: [...runtimePlanningContextSeedDigest.invalidatedStages],
                boundaries: { ...runtimePlanningContextSeedDigest.boundaries }
            }
        } : {}),
        ...(runtimeStageState ? {
            stageState: {
                status: runtimeStageState.status,
                ...(runtimeStageState.currentStage ? { currentStage: runtimeStageState.currentStage } : {}),
                ...(lastStageTransition ? { lastDecision: lastStageTransition.decision } : {}),
                ...(lastStageTransition?.targetStage ? { lastTargetStage: lastStageTransition.targetStage } : {}),
                transitionCount: runtimeStageState.transitions.length,
                issueCount: runtimeStageState.issues.length
            }
        } : {}),
        ...(runtimeStageTraceDigest ? {
            stageTrace: {
                status: runtimeStageTraceDigest.status,
                eventCount: runtimeStageTraceDigest.eventCount,
                droppedEventCount: runtimeStageTraceDigest.droppedEventCount,
                observedStages: runtimeStageTraceDigest.observedStages.slice(0, 12),
                missingStages: runtimeStageTraceDigest.missingStages.slice(0, 12),
                outOfOrderCount: runtimeStageTraceDigest.outOfOrderCount,
                unbackedTransitionCount: runtimeStageTraceDigest.unbackedTransitionCount,
                traceEventWithoutTransitionCount: runtimeStageTraceDigest.traceEventWithoutTransitionCount,
                issueCount: runtimeStageTraceDigest.issueCount
            }
        } : {}),
        ...(runtimeDesignBriefDigest ? {
            designBrief: {
                readiness: runtimeDesignBriefDigest.readiness,
                taskGoal: cleanStrategyText(runtimeDesignBriefDigest.taskGoal, 320),
                deliverables: cleanStrategyList(runtimeDesignBriefDigest.deliverables, 8),
                requiredInputCount: Math.max(0, Number(runtimeDesignBriefDigest.requiredInputCount) || 0),
                providedRequiredInputCount: Math.max(
                    0,
                    Number(runtimeDesignBriefDigest.providedRequiredInputCount) || 0
                ),
                missingRequiredInputKeys: cleanStableRefs(
                    runtimeDesignBriefDigest.missingRequiredInputKeys,
                    12
                ),
                assumedRequiredInputKeys: cleanStableRefs(
                    runtimeDesignBriefDigest.assumedRequiredInputKeys,
                    12
                ),
                contextRefs: cleanStableRefs(runtimeDesignBriefDigest.contextRefs, 16),
                constraintCount: Math.max(0, Number(runtimeDesignBriefDigest.constraintCount) || 0)
            }
        } : {}),
        ...(runtimeDesignStrategyDigest ? {
            designStrategy: {
                readiness: runtimeDesignStrategyDigest.readiness,
                stageGoal: cleanStrategyText(runtimeDesignStrategyDigest.stageGoal, 240),
                primaryGoal: cleanStrategyText(runtimeDesignStrategyDigest.primaryGoal, 240),
                targetAudienceSummary: cleanStrategyText(runtimeDesignStrategyDigest.targetAudienceSummary, 240),
                primaryMessage: cleanStrategyText(runtimeDesignStrategyDigest.primaryMessage, 320),
                moodKeywords: cleanStrategyList(runtimeDesignStrategyDigest.moodKeywords, 8),
                compositionIntent: cleanStrategyList(runtimeDesignStrategyDigest.compositionIntent, 8),
                contextRefs: cleanStableRefs(runtimeDesignStrategyDigest.contextRefs),
                constraintCount: Math.max(0, Number(runtimeDesignStrategyDigest.constraintCount) || 0),
                assumptionCount: Math.max(0, Number(runtimeDesignStrategyDigest.assumptionCount) || 0),
                missingInputCount: Math.max(0, Number(runtimeDesignStrategyDigest.missingInputCount) || 0)
            }
        } : {}),
        ...(runtimeActionPlanDigest ? {
            actionPlan: {
                readiness: runtimeActionPlanDigest.readiness,
                planGoal: cleanStrategyText(runtimeActionPlanDigest.planGoal, 280),
                strategyStageGoal: cleanStrategyText(runtimeActionPlanDigest.strategyStageGoal, 240),
                stepCount: Math.max(0, Number(runtimeActionPlanDigest.stepCount) || 0),
                stepKinds: cleanStableRefs(runtimeActionPlanDigest.stepKinds, 12),
                rootStepIds: cleanStableRefs(runtimeActionPlanDigest.rootStepIds, 12),
                terminalStepIds: cleanStableRefs(runtimeActionPlanDigest.terminalStepIds, 12),
                parallelGroupCount: Math.max(0, Number(runtimeActionPlanDigest.parallelGroupCount) || 0),
                capabilityRefs: cleanStableRefs(runtimeActionPlanDigest.capabilityRefs, 24),
                missingCapabilityRefs: cleanStableRefs(runtimeActionPlanDigest.missingCapabilityRefs, 24),
                contextRefs: cleanStableRefs(runtimeActionPlanDigest.contextRefs, 12),
                ...(runtimeActionPlanDigest.designDsl ? {
                    designDsl: {
                        compositionIntent: cleanStrategyText(
                            runtimeActionPlanDigest.designDsl.compositionIntent,
                            320
                        ),
                        regionCount: Math.max(0, Number(runtimeActionPlanDigest.designDsl.regionCount) || 0),
                        elementCount: Math.max(0, Number(runtimeActionPlanDigest.designDsl.elementCount) || 0),
                        readingOrder: cleanStableRefs(
                            runtimeActionPlanDigest.designDsl.readingOrder,
                            24
                        )
                    }
                } : {}),
                missingInputCount: Math.max(0, Number(runtimeActionPlanDigest.missingInputCount) || 0),
                resumeReuseCount: Math.max(0, Number(runtimeActionPlanDigest.resumeReuseCount) || 0),
                resumeRedoRequiredCount: Math.max(0, Number(runtimeActionPlanDigest.resumeRedoRequiredCount) || 0)
            }
        } : {}),
        ...(runtimeActionPlanReconciliationDigest ? {
            actionPlanReconciliation: {
                status: runtimeActionPlanReconciliationDigest.status,
                planReadiness: runtimeActionPlanReconciliationDigest.planReadiness,
                stepCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.stepCount) || 0),
                completedStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.completedStepIds,
                    12
                ),
                completedStepDescriptors: Array.isArray(
                    runtimeActionPlanReconciliationDigest.completedStepDescriptors
                )
                    ? runtimeActionPlanReconciliationDigest.completedStepDescriptors
                        .slice(0, 12)
                        .map((step) => ({
                            stepId: cleanStrategyText(step.stepId, 48),
                            kind: cleanStrategyText(step.kind, 48),
                            capabilityRefs: cleanStableRefs(step.capabilityRefs, 8),
                            observedOutcomes: cleanStableRefs(step.observedOutcomes, 8)
                        }))
                    : [],
                failedStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.failedStepIds,
                    12
                ),
                recoveredStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.recoveredStepIds,
                    12
                ),
                resumeStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.resumeStepIds,
                    12
                ),
                observationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.observationCount) || 0),
                droppedObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.droppedObservationCount) || 0),
                ambiguousObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.ambiguousObservationCount) || 0),
                dependencyBlockedObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.dependencyBlockedObservationCount) || 0),
                unmatchedObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.unmatchedObservationCount) || 0),
                repeatAfterCompletionCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.repeatAfterCompletionCount) || 0),
                issueCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.issueCount) || 0)
            }
        } : {}),
        ...(runtimeActionPlanNoRedoShadowDigest ? {
            actionPlanNoRedoShadow: {
                status: runtimeActionPlanNoRedoShadowDigest.status,
                ...(runtimeActionPlanNoRedoShadowDigest.sourceRunId
                    ? { sourceRunId: cleanStrategyText(runtimeActionPlanNoRedoShadowDigest.sourceRunId, 100) }
                    : {}),
                reuseCandidateStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.reuseCandidateStepIds,
                    12
                ),
                repeatObservedStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.repeatObservedStepIds,
                    12
                ),
                intentionalRedoStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.intentionalRedoStepIds,
                    12
                ),
                intentionalRedoObservedStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.intentionalRedoObservedStepIds,
                    12
                ),
                verifiedPriorCompletedStepCount: Math.max(
                    0,
                    Number(runtimeActionPlanNoRedoShadowDigest.verifiedPriorCompletedStepCount) || 0
                ),
                mappingCount: Math.max(0, Number(runtimeActionPlanNoRedoShadowDigest.mappingCount) || 0),
                unmappedVerifiedPriorStepCount: Math.max(
                    0,
                    Number(runtimeActionPlanNoRedoShadowDigest.unmappedVerifiedPriorStepCount) || 0
                )
            }
        } : {}),
        contextAnchor,
        ...(input.resumeFreshness ? { resumeFreshness: input.resumeFreshness } : {}),
        checkpoint: deriveCheckpoint(digestedAll, rawLog),
        boundaries: {
            argsDigestedOnly: true,
            containsRawImages: false,
            neverBlocksTaskResult: true,
            stageStateDigestOnly: true,
            stageTraceDigestOnly: true,
            designBriefDigestOnly: true,
            designStrategyDigestOnly: true,
            actionPlanDigestOnly: true,
            actionPlanReconciliationDigestOnly: true,
            actionPlanNoRedoShadowDigestOnly: true,
            contextAnchorDigestOnly: true,
            resumeFreshnessDigestOnly: true,
            ...(runtimeSessionDigest ? { runtimeSessionDigestOnly: true as const } : {}),
            ...(runtimePlanningContextSeedDigest ? { planningContextCarryDigestOnly: true as const } : {})
        }
    };
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function findUnknownKey(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): string | undefined {
    return Object.keys(value).find((key) => !allowedKeys.has(key));
}

/**
 * 把主进程 Repository 的严格只读投影附到运行档案。
 *
 * 本 helper 不读取 result/snapshot，也不接受调用方自行提供的 ref。只有投影与
 * Runtime Session 的 sessionId/runId/generation 完全一致时才返回新记录。
 */
export function attachRepositoryArtifactRefsToRunRecord(
    base: AgentRunRecord,
    projection: ArtifactRepositoryReadProjection | unknown
): AgentRunRecord {
    const baseValidation = validateAgentRunRecordForPersist(base);
    if (!baseValidation.ok) {
        throw new Error(`agent_run_record_base_invalid:${baseValidation.reason || 'unknown'}`);
    }
    if (hasOwn(base, 'artifactRefs')
        || hasOwn(base, 'droppedArtifactRefCount')
        || hasOwn(base.boundaries, 'artifactRefsFromRepositoryOnly')) {
        throw new Error('agent_run_record_artifact_authority_already_present');
    }

    const verifiedProjection = readArtifactRepositoryProjection(projection);
    if (!verifiedProjection) {
        throw new Error('agent_run_record_artifact_projection_invalid');
    }
    const runtimeSession = base.runtimeSession;
    if (!runtimeSession
        || runtimeSession.sessionId !== verifiedProjection.scope.sessionId
        || runtimeSession.runId !== verifiedProjection.scope.runId
        || runtimeSession.generation !== verifiedProjection.scope.generation) {
        throw new Error('agent_run_record_artifact_projection_identity_mismatch');
    }

    return {
        ...base,
        artifactRefs: verifiedProjection.refs.map((ref) => ({ ...ref })),
        droppedArtifactRefCount: verifiedProjection.droppedRefCount,
        boundaries: {
            ...base.boundaries,
            artifactRefsFromRepositoryOnly: true
        }
    };
}

/** 读取历史运行档案时，重新确认其 refs 仍与 Repository 当前严格投影完全一致。 */
export function matchesAgentRunRecordRepositoryProjection(
    record: AgentRunRecord,
    projection: ArtifactRepositoryReadProjection | unknown
): boolean {
    const verifiedProjection = readArtifactRepositoryProjection(projection);
    if (!verifiedProjection || !record.runtimeSession) return false;
    if (record.runtimeSession.sessionId !== verifiedProjection.scope.sessionId
        || record.runtimeSession.runId !== verifiedProjection.scope.runId
        || record.runtimeSession.generation !== verifiedProjection.scope.generation) {
        return false;
    }
    if (record.boundaries.artifactRefsFromRepositoryOnly !== true
        || !Array.isArray(record.artifactRefs)
        || record.artifactRefs.length !== verifiedProjection.refs.length
        || record.droppedArtifactRefCount !== verifiedProjection.droppedRefCount) {
        return false;
    }
    return record.artifactRefs.every((candidate, index) => {
        const ref = readArtifactRef(candidate);
        const repositoryRef = verifiedProjection.refs[index];
        return Boolean(ref && repositoryRef
            && ref.artifactId === repositoryRef.artifactId
            && ref.artifactType === repositoryRef.artifactType
            && ref.contentHash === repositoryRef.contentHash);
    });
}

/** 持久化前的最小合法性校验（handler 侧复用）：非法返回具体原因，不静默吞。 */
export function validateAgentRunRecordForPersist(record: unknown): { ok: boolean; reason?: string } {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return { ok: false, reason: '记录不是对象' };
    }
    const unknownRecordKey = findUnknownKey(
        record as Record<string, unknown>,
        AGENT_RUN_RECORD_ALLOWED_KEYS
    );
    if (unknownRecordKey) return { ok: false, reason: `运行档案含未知顶层字段：${unknownRecordKey}` };
    const r = record as Partial<AgentRunRecord>;
    if (!r.boundaries || typeof r.boundaries !== 'object' || Array.isArray(r.boundaries)) {
        return { ok: false, reason: 'boundaries 缺失或不是对象' };
    }
    const unknownBoundaryKey = findUnknownKey(
        r.boundaries as unknown as Record<string, unknown>,
        AGENT_RUN_RECORD_BOUNDARY_ALLOWED_KEYS
    );
    if (unknownBoundaryKey) return { ok: false, reason: `运行档案 boundaries 含未知字段：${unknownBoundaryKey}` };
    if (r.version !== 'agent-run-record/v0') return { ok: false, reason: `版本不符：${String(r.version)}` };
    if (!r.runId || !/^run-[a-z0-9-]+$/i.test(r.runId)) return { ok: false, reason: 'runId 缺失或格式非法' };
    if (!Array.isArray(r.toolCalls)) return { ok: false, reason: 'toolCalls 缺失' };
    if (!r.boundaries?.argsDigestedOnly) return { ok: false, reason: '缺 argsDigestedOnly 边界声明' };
    if (r.runtimeSession && r.boundaries?.runtimeSessionDigestOnly !== true) {
        return { ok: false, reason: '存在 Runtime Session 但缺 runtimeSessionDigestOnly 边界声明' };
    }
    if (r.runtimeSession && r.runtimeSession.version !== 'runtime-session-digest/v0') {
        return { ok: false, reason: 'Runtime Session digest 版本非法' };
    }
    if (r.runtimeSession && r.runtimeSession.runId !== r.runId) {
        return { ok: false, reason: 'Runtime Session runId 与 Run Record 主键不一致' };
    }
    if (r.runtimeSession && (
        typeof r.runtimeSession.sessionId !== 'string'
        || !r.runtimeSession.sessionId.trim()
        || r.runtimeSession.sessionId.length > 160
    )) {
        return { ok: false, reason: 'Runtime Session sessionId 非法' };
    }
    if (r.runtimeSession && r.runtimeSession.parentRunId !== r.parentRunId) {
        return { ok: false, reason: 'Runtime Session parentRunId 与 Run Record 不一致' };
    }
    if (r.runtimeSession && (!Number.isInteger(r.runtimeSession.generation) || r.runtimeSession.generation < 1)) {
        return { ok: false, reason: 'Runtime Session generation 非法' };
    }
    if (r.runtimeSession?.accounting
        && r.runtimeSession.accounting.version !== 'runtime-accounting-digest/v0') {
        return { ok: false, reason: 'Runtime accounting digest 版本非法' };
    }
    if (r.runtimeSession?.accounting && (
        r.runtimeSession.accounting.boundaries.reportedUsageOnly !== true
        || r.runtimeSession.accounting.boundaries.missingUsageNotEstimated !== true
        || r.runtimeSession.accounting.boundaries.enforcesBudget !== false
        || r.runtimeSession.accounting.costEstimate.status !== 'not_configured'
    )) {
        return { ok: false, reason: 'Runtime accounting 真实性边界非法' };
    }
    const hasArtifactRefs = hasOwn(r, 'artifactRefs');
    const hasDroppedArtifactRefCount = hasOwn(r, 'droppedArtifactRefCount');
    const hasArtifactBoundary = Boolean(r.boundaries)
        && hasOwn(r.boundaries as AgentRunRecord['boundaries'], 'artifactRefsFromRepositoryOnly');
    if (hasArtifactRefs || hasDroppedArtifactRefCount || hasArtifactBoundary) {
        if (r.boundaries?.artifactRefsFromRepositoryOnly !== true) {
            return { ok: false, reason: 'Artifact refs 缺 artifactRefsFromRepositoryOnly 边界声明' };
        }
        if (!Array.isArray(r.artifactRefs) || r.artifactRefs.length > MAX_ARTIFACT_REFS) {
            return { ok: false, reason: 'artifactRefs 缺失或超过 Repository 上限' };
        }
        if (!Number.isInteger(r.droppedArtifactRefCount) || Number(r.droppedArtifactRefCount) < 0) {
            return { ok: false, reason: 'droppedArtifactRefCount 必须是非负整数' };
        }
        if (r.artifactRefs.some((ref) => !readArtifactRef(ref))) {
            return { ok: false, reason: 'artifactRefs 必须是 Repository 返回的精确三字段引用' };
        }
        if (!r.runtimeSession) {
            return { ok: false, reason: 'Artifact refs 缺少可绑定的 Runtime Session identity' };
        }
    }
    if (r.planningContextCarry && r.boundaries?.planningContextCarryDigestOnly !== true) {
        return { ok: false, reason: '存在 planningContextCarry 但缺 planningContextCarryDigestOnly 边界声明' };
    }
    if (r.planningContextCarry && r.planningContextCarry.version !== 'runtime-planning-context-seed-digest/v0') {
        return { ok: false, reason: 'planningContextCarry digest 版本非法' };
    }
    if (r.planningContextCarry && (
        r.planningContextCarry.targetRunId !== r.runId
        || r.planningContextCarry.sessionId !== r.runtimeSession?.sessionId
        || r.planningContextCarry.targetGeneration !== r.runtimeSession?.generation
    )) {
        return { ok: false, reason: 'planningContextCarry 与 Runtime Session 身份不一致' };
    }
    if (r.planningContextCarry && ('declarations' in r.planningContextCarry || 'payload' in r.planningContextCarry)) {
        return { ok: false, reason: 'planningContextCarry 运行档案只能保存摘要，不能复制完整规划声明' };
    }
    if (r.stageState && r.boundaries?.stageStateDigestOnly !== true) {
        return { ok: false, reason: '存在 stageState 但缺 stageStateDigestOnly 边界声明' };
    }
    if (r.stageState && ('stages' in r.stageState || 'transitions' in r.stageState)) {
        return { ok: false, reason: 'stageState 运行档案只能保存摘要，不能复制完整阶段或 transition ledger' };
    }
    if (r.stageTrace && r.boundaries?.stageTraceDigestOnly !== true) {
        return { ok: false, reason: '存在 stageTrace 但缺 stageTraceDigestOnly 边界声明' };
    }
    if (r.stageTrace && ('events' in r.stageTrace || 'issues' in r.stageTrace)) {
        return { ok: false, reason: 'stageTrace 运行档案只能保存对账摘要，不能复制完整事件或 issue ledger' };
    }
    if (r.designBrief && r.boundaries?.designBriefDigestOnly !== true) {
        return { ok: false, reason: '存在 designBrief 但缺 designBriefDigestOnly 边界声明' };
    }
    if (r.designBrief && ('payload' in r.designBrief || 'inputCoverage' in r.designBrief || 'declaration' in r.designBrief)) {
        return { ok: false, reason: 'designBrief 运行档案只能保存摘要，不能复制完整声明或输入覆盖明细' };
    }
    if (r.designStrategy && r.boundaries?.designStrategyDigestOnly !== true) {
        return { ok: false, reason: '存在 designStrategy 但缺 designStrategyDigestOnly 边界声明' };
    }
    if (r.designStrategy && ('payload' in r.designStrategy || 'declaration' in r.designStrategy || 'meta' in r.designStrategy)) {
        return { ok: false, reason: 'designStrategy 运行档案只能保存摘要，不能复制完整声明或 artifact 元数据' };
    }
    if (r.actionPlan && r.boundaries?.actionPlanDigestOnly !== true) {
        return { ok: false, reason: '存在 actionPlan 但缺 actionPlanDigestOnly 边界声明' };
    }
    if (r.actionPlan && (
        'payload' in r.actionPlan
        || 'declaration' in r.actionPlan
        || 'steps' in r.actionPlan
        || 'graph' in r.actionPlan
    )) {
        return { ok: false, reason: 'actionPlan 运行档案只能保存摘要，不能复制完整步骤、依赖图或声明' };
    }
    if (r.actionPlanReconciliation && r.boundaries?.actionPlanReconciliationDigestOnly !== true) {
        return { ok: false, reason: '存在 actionPlanReconciliation 但缺 digest-only 边界声明' };
    }
    if (r.actionPlanReconciliation && (
        'steps' in r.actionPlanReconciliation
        || 'observations' in r.actionPlanReconciliation
        || 'attributions' in r.actionPlanReconciliation
        || 'issues' in r.actionPlanReconciliation
    )) {
        return { ok: false, reason: 'actionPlanReconciliation 运行档案只能保存摘要，不能复制步骤状态或观察归属 ledger' };
    }
    if (r.actionPlanReconciliation?.completedStepDescriptors?.some((step) => (
        !step || typeof step !== 'object'
        || Object.keys(step).some((key) => ![
            'stepId', 'kind', 'capabilityRefs', 'observedOutcomes'
        ].includes(key))
    ))) {
        return { ok: false, reason: '已完成步骤描述只能保存 stepId、kind、Capability 和 Outcome 摘要' };
    }
    if (r.actionPlanNoRedoShadow && r.boundaries?.actionPlanNoRedoShadowDigestOnly !== true) {
        return { ok: false, reason: '存在 actionPlanNoRedoShadow 但缺 digest-only 边界声明' };
    }
    if (r.actionPlanNoRedoShadow && (
        'mappings' in r.actionPlanNoRedoShadow
        || 'decisions' in r.actionPlanNoRedoShadow
        || 'reconciliation' in r.actionPlanNoRedoShadow
        || 'observations' in r.actionPlanNoRedoShadow
        || 'steps' in r.actionPlanNoRedoShadow
    )) {
        return { ok: false, reason: 'actionPlanNoRedoShadow 运行档案只能保存摘要，不能复制完整映射或观察状态' };
    }
    if (r.contextAnchor && r.boundaries?.contextAnchorDigestOnly !== true) {
        return { ok: false, reason: '存在 contextAnchor 但缺 digest-only 边界声明' };
    }
    if (r.contextAnchor) {
        const serializedAnchor = JSON.stringify(r.contextAnchor);
        if (/"(?:layers|hierarchy|flatList|elements|imageData|toolName|arguments|result|path)"\s*:/.test(serializedAnchor)) {
            return { ok: false, reason: 'contextAnchor 只能保存指纹，不能复制原始层、图片、路径或 Tool 载荷' };
        }
    }
    if (r.resumeFreshness && r.boundaries?.resumeFreshnessDigestOnly !== true) {
        return { ok: false, reason: '存在 resumeFreshness 但缺 digest-only 边界声明' };
    }
    if (r.resumeFreshness) {
        const serializedFreshness = JSON.stringify(r.resumeFreshness);
        if (/"(?:goal|toolName|arguments|result|path|layers|hierarchy|imageData)"\s*:/.test(serializedFreshness)) {
            return { ok: false, reason: 'resumeFreshness 只能保存指纹、节点描述符和裁决摘要，不能复制文本或 Tool 载荷' };
        }
    }
    const serialized = JSON.stringify(record);
    if (serialized.length > 1_500_000) return { ok: false, reason: `记录过大（${serialized.length} 字节），疑似摘要化失效` };
    if (/data:[a-zA-Z0-9/+.-]+;base64,/.test(serialized)) return { ok: false, reason: '检测到图像 data URL，违反 containsRawImages 边界' };
    return { ok: true };
}
