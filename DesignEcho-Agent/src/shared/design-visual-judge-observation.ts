/**
 * 视觉 Judge 的最终画面观察选择（纯逻辑，可 smoke）。
 *
 * 这个模块不拥有运行时状态，也不建立新的通用账本。它只从当前运行已有、
 * 按执行顺序追加的 Tool 结果日志中派生一次选择：
 * - 只接受干净的完整画布图像工具；区域截图只用于局部观察，不能冒充全局审美评价；
 * - 一旦发生 Photoshop 画布修改，只接受最后一次修改之后、且属于同一文档的观察；
 * - 文档目标不明确时 fail closed，不用旧图或其他文档的图替新结果打分；
 * - save / export 不改变画布像素，因此不会让已经在最后一次画布修改后取得的观察失效。
 *
 * 图像编码是否真的可提取仍由 renderer 现有 extractImageFromToolResult 负责；这里不复制
 * base64 解析规则，只约束观察的时序、对象与完整画布语义。
 */

import {
    buildAgentOperationDocumentTimeline,
    isSuccessfulAgentOperation,
    sameAgentOperationDocumentContext
} from './agent-operation-document-timeline';
import type { RuntimeExecutionTargetAnchor } from './agent-runtime-v5/runtime-execution-target';

const FULL_SURFACE_VISUAL_OBSERVATION_TOOLS = new Set([
    'getCanvasSnapshot',
    'getDocumentSnapshot'
]);

export interface DesignVisualJudgeOperationLogEntry {
    name?: string;
    arguments?: unknown;
    result?: any;
}

export interface DesignVisualJudgeObservationSelection {
    entryIndex: number;
    entry: DesignVisualJudgeOperationLogEntry;
    target?: RuntimeExecutionTargetAnchor;
    latestCanvasMutationIndex: number | null;
    freshness: 'unchanged_surface' | 'after_latest_canvas_mutation';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containsRegionSelection(value: unknown): boolean {
    if (!isRecord(value)) return false;
    if (value.region != null) return true;
    return isRecord(value.data) && value.data.region != null;
}

/**
 * 判断单条操作结果是否代表干净的完整画布观察。
 * getAcceptanceSnapshot 只有结构数据，不是像素图；annotated / generated / asset preview
 * 也不是最终成品画面，因此都不在候选集合中。
 */
export function isFullSurfaceVisualJudgeObservationEntry(
    entry: DesignVisualJudgeOperationLogEntry
): boolean {
    const name = String(entry.name || '').trim();
    if (!isSuccessfulAgentOperation(entry) || !FULL_SURFACE_VISUAL_OBSERVATION_TOOLS.has(name)) {
        return false;
    }
    if (name !== 'getCanvasSnapshot') return true;
    return !containsRegionSelection(entry.arguments) && !containsRegionSelection(entry.result);
}

/**
 * 从一次运行的操作日志中选择可供最终视觉 Judge 使用的最近完整画布观察。
 * 返回值是即时派生结果，不应持久化为新的状态 owner。
 */
export function selectLatestDesignVisualJudgeObservation(
    operationLog: readonly DesignVisualJudgeOperationLogEntry[]
): DesignVisualJudgeObservationSelection | null {
    const entries = Array.isArray(operationLog) ? operationLog : [];
    const timeline = buildAgentOperationDocumentTimeline(entries);
    let latestCanvasMutationIndex = -1;
    for (const item of timeline.entries) {
        if (item.photoshopMutationObserved) {
            latestCanvasMutationIndex = item.index;
        }
    }

    const lowerBound = latestCanvasMutationIndex >= 0 ? latestCanvasMutationIndex : -1;
    for (let index = entries.length - 1; index > lowerBound; index -= 1) {
        const entry = entries[index];
        if (!entry || !isFullSurfaceVisualJudgeObservationEntry(entry)) continue;
        const candidateContext = timeline.entries[index];
        const target = candidateContext?.target;
        if (latestCanvasMutationIndex >= 0
            && !sameAgentOperationDocumentContext(
                timeline.entries[latestCanvasMutationIndex],
                candidateContext
            )) {
            continue;
        }
        if (!sameAgentOperationDocumentContext(candidateContext, timeline.finalContext)) {
            continue;
        }
        return {
            entryIndex: index,
            entry,
            target,
            latestCanvasMutationIndex: latestCanvasMutationIndex >= 0
                ? latestCanvasMutationIndex
                : null,
            freshness: latestCanvasMutationIndex >= 0
                ? 'after_latest_canvas_mutation'
                : 'unchanged_surface'
        };
    }

    return null;
}
