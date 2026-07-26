/**
 * Photoshop 操作的文档上下文投影（纯逻辑）。
 *
 * 唯一输入仍是当前 run 的有序 Tool 结果日志；本模块不持久化状态、不授予权限，
 * 只统一回答“每条操作当时属于哪个活动文档上下文”。视觉 Judge、Completion 与
 * 执行 preflight 共享同一上下文屏障语义，避免各自维护易漂移的工具白名单。
 */

import {
    classifyAgentToolExecution,
    isAgentDocumentContextBarrier,
    isAgentHarnessControlTool,
    type AgentToolExecutionKind
} from './agent-tool-execution-preflight';
import {
    resolveRuntimeExecutionTarget,
    sameRuntimeExecutionDocument,
    type RuntimeExecutionTargetAnchor
} from './agent-runtime-v5/runtime-execution-target';
import { isPolicyGateResult } from './tool-safety-policy';
import {
    hasObservedPhotoshopHistoryMutation,
    hasObservedPhotoshopMutationCommit,
    readPhotoshopMutationCommit,
    readPhotoshopHistoryTransition
} from './photoshop-history-state-ref';

const TARGET_TRACKING_KINDS = new Set<AgentToolExecutionKind>([
    'read_only_observation',
    'photoshop_write',
    'save_export',
    'stateful_context'
]);

export interface AgentOperationDocumentLogEntry {
    name?: string;
    arguments?: unknown;
    result?: any;
    succeeded?: boolean;
}

export interface AgentOperationDocumentContext {
    target?: RuntimeExecutionTargetAnchor;
    contextEpoch: number;
    continuityKnown: boolean;
}

export interface AgentOperationDocumentTimelineEntry extends AgentOperationDocumentContext {
    index: number;
    operation: AgentOperationDocumentLogEntry;
    kind: AgentToolExecutionKind;
    succeeded: boolean;
    /** 成功写入、Host 窗口变化，或失败结果明确声明动作已经执行；统一作为旧观察失效屏障。 */
    photoshopMutationObserved: boolean;
    documentContextBarrier: boolean;
}

export interface AgentOperationDocumentTimeline {
    entries: AgentOperationDocumentTimelineEntry[];
    finalContext: AgentOperationDocumentContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isSuccessfulAgentOperation(entry: AgentOperationDocumentLogEntry): boolean {
    return entry.succeeded !== false
        && entry.result?.success !== false
        && !isPolicyGateResult(entry.result);
}

function normalizeTargetResult(entry: AgentOperationDocumentLogEntry): unknown {
    const name = String(entry.name || '').trim();
    const result = entry.result;
    const operationArguments = isRecord(entry.arguments) ? entry.arguments : {};
    let normalizedResult = result;
    if (name === 'getSmartObjectLayers'
        && operationArguments.autoOpen === true
        && isRecord(result)) {
        const internalDocumentId = result.internalDocumentId;
        const internalDocumentName = result.internalDocumentName;
        normalizedResult = {
            ...result,
            ...(internalDocumentId != null ? { activeDocumentId: internalDocumentId } : {}),
            ...(internalDocumentName != null ? { activeDocumentName: internalDocumentName } : {})
        };
    }
    const mutationCommit = readPhotoshopMutationCommit(result);
    const historyTransition = readPhotoshopHistoryTransition(result);
    // acceptance.after 发生在 Tool callback 之后，若两者都存在，它才是日志项结束时
    // 更晚的活动文档；commit 仍用于证明 callback 内部是否真实发生 mutation。
    const afterHistoryStateRef = historyTransition?.after || mutationCommit?.after;
    if (!afterHistoryStateRef
        || !isRecord(normalizedResult)) {
        return normalizedResult;
    }
    return {
        ...normalizedResult,
        activeDocumentId: afterHistoryStateRef.documentId
    };
}

function resolveStableOperationTarget(
    entry: AgentOperationDocumentLogEntry,
    previous: RuntimeExecutionTargetAnchor | undefined,
    resetPrevious: boolean
): RuntimeExecutionTargetAnchor | undefined {
    const resolved = resolveRuntimeExecutionTarget({
        arguments: entry.arguments,
        result: normalizeTargetResult(entry),
        previous: resetPrevious ? undefined : previous
    });
    // 普通读写结果偶尔只回 documentName。已有不透明强 target 时，弱名称不能把同一文档的
    // 强身份替换成另一种 hash；真正的活动文档切换必须由 context barrier 重建。
    if (!resetPrevious
        && previous
        && resolved?.source === 'explicit_document_name') {
        return {
            ...previous,
            objectRefs: resolved.objectRefs.length > 0
                ? [...resolved.objectRefs]
                : [...previous.objectRefs],
            source: 'carried_active_document',
            boundaries: { ...previous.boundaries }
        };
    }
    return resolved;
}

export function buildAgentOperationDocumentTimeline(
    operationLog: readonly AgentOperationDocumentLogEntry[]
): AgentOperationDocumentTimeline {
    const operations = Array.isArray(operationLog) ? operationLog : [];
    const entries: AgentOperationDocumentTimelineEntry[] = [];
    let activeTarget: RuntimeExecutionTargetAnchor | undefined;
    let continuityKnown = true;
    let contextEpoch = 0;

    for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index] || {};
        const name = String(operation.name || '').trim();
        const kind = classifyAgentToolExecution(name, operation.arguments);
        const succeeded = Boolean(name)
            && isSuccessfulAgentOperation(operation)
            && !isAgentHarnessControlTool(name);
        const photoshopMutationObserved = kind === 'photoshop_write'
            && (succeeded
                || hasObservedPhotoshopMutationCommit(operation.result)
                || hasObservedPhotoshopHistoryMutation(operation.result)
                || readPhotoshopMutationCommit(operation.result)?.toolActionCompleted === true
                || operation.result?.toolActionCompleted === true);
        const documentContextBarrier = succeeded
            && isAgentDocumentContextBarrier(name, operation.arguments);

        if (documentContextBarrier) contextEpoch += 1;
        if ((succeeded || photoshopMutationObserved) && TARGET_TRACKING_KINDS.has(kind)) {
            if (name === 'closeDocument') {
                // closeDocument 的 result 只说明被关闭对象，不能证明 Photoshop 随后激活了哪个文档。
                activeTarget = undefined;
                continuityKnown = false;
            } else {
                const resolvedTarget = resolveStableOperationTarget(
                    operation,
                    activeTarget,
                    documentContextBarrier
                );
                if (resolvedTarget) {
                    activeTarget = resolvedTarget;
                    continuityKnown = true;
                } else if (documentContextBarrier) {
                    activeTarget = undefined;
                    continuityKnown = false;
                }
            }
        }

        entries.push({
            index,
            operation,
            kind,
            succeeded,
            photoshopMutationObserved,
            documentContextBarrier,
            target: activeTarget,
            contextEpoch,
            continuityKnown
        });
    }

    return {
        entries,
        finalContext: {
            target: activeTarget,
            contextEpoch,
            continuityKnown
        }
    };
}

/** 最后一次可证明改变 Photoshop 文档内容的日志位置；包含“工具报失败但 Host 已变化”。 */
export function findLatestObservedPhotoshopMutationIndex(
    operationLog: readonly AgentOperationDocumentLogEntry[]
): number {
    const timeline = buildAgentOperationDocumentTimeline(operationLog);
    for (let index = timeline.entries.length - 1; index >= 0; index -= 1) {
        if (timeline.entries[index]?.photoshopMutationObserved) return index;
    }
    return -1;
}

/**
 * 比较两次操作是否可证明属于同一活动文档上下文。
 * 有不透明 target 时必须相等；两边都无 target 时仅允许同一、未断裂的 context epoch。
 */
export function sameAgentOperationDocumentContext(
    left: AgentOperationDocumentContext | undefined,
    right: AgentOperationDocumentContext | undefined
): boolean {
    if (!left || !right) return false;
    if (left.target || right.target) {
        return sameRuntimeExecutionDocument(left.target, right.target);
    }
    return left.continuityKnown
        && right.continuityKnown
        && left.contextEpoch === right.contextEpoch;
}
