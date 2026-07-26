import {
    buildEagleWritebackGate,
    type EagleWritebackGate,
    type EagleWritebackPlanOperation,
    type EagleWritebackProposedAction
} from '../../shared/eagle-writeback-gate';

/**
 * Eagle Inspector 写回执行器（P2 双向编辑）。
 *
 * 边界（与 eagle-writeback-gate 的既定红线一致）：
 * - 写入只走运行中 Eagle 的 MCP API（127.0.0.1:41596 /api/tools/call），绝不直接改 .library JSON；
 * - 只执行 gate 判定为 ready 的安全操作（加/删标签、标注、评分、文件夹归属），危险操作被 gate 拒绝；
 * - 唯一入口是用户在 Inspector 的手动编辑（保存即确认）；不作为 Agent 工具暴露，Agent 对 Eagle 保持只读；
 * - 写前读当前值做冲突检测，写后读回验证，全程如实返回，不伪造成功。
 */

export const EAGLE_WRITEBACK_DEFAULT_ENDPOINT = 'http://127.0.0.1:41596';
const CALL_TIMEOUT_MS = 8000;

export interface EagleInspectorEditBaseline {
    tags: string[];
    annotation: string;
    rating: number;
}

export interface EagleInspectorEditRequest {
    itemId?: unknown;
    /** 编辑起点（用户开始编辑时看到的值），用于写前冲突检测。 */
    baseline?: Partial<EagleInspectorEditBaseline>;
    /** 编辑终值（用户想要保存的值）。 */
    edits?: Partial<EagleInspectorEditBaseline>;
    userConfirmed?: boolean;
    endpoint?: unknown;
}

export interface EagleInspectorWritebackResult {
    success: boolean;
    status:
        | 'ok'
        | 'no_changes'
        | 'blocked_by_gate'
        | 'eagle_offline'
        | 'conflict'
        | 'verify_failed'
        | 'write_failed';
    itemId: string;
    appliedOperations: string[];
    /** 冲突或验证失败时的 Eagle 实时当前值，供 UI 以最新值为基础继续编辑。 */
    currentValues?: EagleInspectorEditBaseline;
    gateStatus?: EagleWritebackGate['status'];
    gateBlockers?: string[];
    error?: string;
    boundaries: {
        writesViaEagleApiOnly: true;
        doesNotWriteLibraryJson: true;
        userConfirmedEdit: boolean;
        readbackVerified: boolean;
    };
}

type FetchImpl = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function executeEagleInspectorWriteback(
    request: EagleInspectorEditRequest,
    fetchImpl?: FetchImpl
): Promise<EagleInspectorWritebackResult> {
    const itemId = cleanText(request?.itemId, 180);
    const userConfirmed = request?.userConfirmed === true;
    const endpoint = normalizeEndpoint(request?.endpoint);
    const baseline = normalizeValues(request?.baseline);
    const edits = normalizeValues(request?.edits);

    if (!itemId) {
        return failure('write_failed', itemId, userConfirmed, 'Eagle 写回需要 itemId。');
    }

    const proposedActions = buildProposedActions(itemId, baseline, edits);
    if (proposedActions.length === 0) {
        return {
            success: true,
            status: 'no_changes',
            itemId,
            appliedOperations: [],
            boundaries: buildBoundaries(userConfirmed, false)
        };
    }

    // 闸门：复用既定安全策略（危险动作/批量超限/缺确认统一拦截）
    const gate = buildEagleWritebackGate({
        requestedBy: 'user_inspector_edit',
        source: 'manual_review',
        userConfirmed,
        proposedActions
    });
    if (gate.status !== 'ready_for_manual_writeback') {
        return {
            success: false,
            status: 'blocked_by_gate',
            itemId,
            appliedOperations: [],
            gateStatus: gate.status,
            gateBlockers: gate.blockers,
            error: `Eagle 写回被安全闸门拦截：${gate.blockers.join('、') || gate.status}。`,
            boundaries: buildBoundaries(userConfirmed, false)
        };
    }

    const doFetch = fetchImpl || (globalThis.fetch as unknown as FetchImpl);
    if (typeof doFetch !== 'function') {
        return failure('eagle_offline', itemId, userConfirmed, '当前运行时没有可用的网络能力，无法连接 Eagle。');
    }

    // 写前：读实时当前值（可达性探测 + 冲突检测共用一次调用）
    const before = await readItemValues(doFetch, endpoint, itemId);
    if (!before.reachable) {
        return failure('eagle_offline', itemId, userConfirmed,
            'Eagle MCP 服务无法连接：请确认 Eagle（4.0+）正在运行并已启用 MCP Server（默认端口 41596）。编辑可先存为草稿。');
    }
    if (!before.values) {
        return failure('write_failed', itemId, userConfirmed, '在运行中的 Eagle 里没有找到这个素材（可能已被删除）。');
    }
    if (!valuesMatch(before.values, baseline)) {
        return {
            success: false,
            status: 'conflict',
            itemId,
            appliedOperations: [],
            currentValues: before.values,
            error: '素材在你编辑期间已在 Eagle 中被修改：请基于最新值重新确认后再保存。',
            boundaries: buildBoundaries(userConfirmed, false)
        };
    }

    // 执行 gate 产出的写计划
    const applied: string[] = [];
    for (const operation of gate.writebackPlan) {
        const callResult = await callEagleTool(doFetch, endpoint, operation.eagleTool, buildToolParams(operation));
        if (!callResult.ok) {
            return {
                success: false,
                status: 'write_failed',
                itemId,
                appliedOperations: applied,
                error: `Eagle 写入失败（${operation.action}）：${callResult.error || '未知错误'}。已执行的操作：${applied.join('、') || '无'}。`,
                boundaries: buildBoundaries(userConfirmed, false)
            };
        }
        applied.push(operation.action);
    }

    // 写后：读回验证终值
    const after = await readItemValues(doFetch, endpoint, itemId);
    const readbackVerified = Boolean(after.values && valuesMatch(after.values, edits));
    if (!readbackVerified) {
        return {
            success: false,
            status: 'verify_failed',
            itemId,
            appliedOperations: applied,
            ...(after.values ? { currentValues: after.values } : {}),
            error: '写入已提交但读回验证与预期不符：请在 Eagle 中确认实际状态后再决定是否重试。',
            boundaries: buildBoundaries(userConfirmed, false)
        };
    }

    return {
        success: true,
        status: 'ok',
        itemId,
        appliedOperations: applied,
        currentValues: after.values as EagleInspectorEditBaseline,
        boundaries: buildBoundaries(userConfirmed, true)
    };
}

function buildProposedActions(
    itemId: string,
    baseline: EagleInspectorEditBaseline,
    edits: EagleInspectorEditBaseline
): EagleWritebackProposedAction[] {
    const actions: EagleWritebackProposedAction[] = [];
    const addedTags = edits.tags.filter((tag) => !baseline.tags.includes(tag));
    const removedTags = baseline.tags.filter((tag) => !edits.tags.includes(tag));
    if (addedTags.length > 0) {
        actions.push({ action: 'add_tags', itemId, tags: addedTags, reason: 'Inspector 手动添加标签' });
    }
    if (removedTags.length > 0) {
        actions.push({ action: 'remove_tags', itemId, tags: removedTags, reason: 'Inspector 手动移除标签' });
    }
    if (edits.annotation !== baseline.annotation) {
        actions.push({ action: 'update_annotation', itemId, annotation: edits.annotation, reason: 'Inspector 手动更新标注' });
    }
    if (edits.rating !== baseline.rating) {
        actions.push({ action: 'set_rating', itemId, rating: edits.rating, reason: 'Inspector 手动更新评分' });
    }
    return actions;
}

function buildToolParams(operation: EagleWritebackPlanOperation): Record<string, unknown> {
    switch (operation.action) {
        case 'add_tags':
        case 'remove_tags':
            return { ids: [operation.itemId], tags: operation.paramsPreview.tags };
        case 'update_annotation':
            return { items: [{ id: operation.itemId, annotation: operation.paramsPreview.annotation }] };
        case 'set_rating':
            return { items: [{ id: operation.itemId, star: operation.paramsPreview.rating }] };
        case 'add_to_folders':
        case 'remove_from_folders':
            return { ids: [operation.itemId], folders: operation.paramsPreview.folders };
    }
}

async function readItemValues(
    doFetch: FetchImpl,
    endpoint: string,
    itemId: string
): Promise<{ reachable: boolean; values?: EagleInspectorEditBaseline }> {
    const result = await callEagleTool(doFetch, endpoint, 'item_get', { ids: [itemId], fullDetails: true });
    if (!result.ok) return { reachable: false };
    const items = extractItems(result.body);
    const item = items.find((entry) => cleanText(entry?.id, 180) === itemId) || items[0];
    if (!item) return { reachable: true };
    return {
        reachable: true,
        values: {
            tags: normalizeStringList(item.tags),
            annotation: cleanText(item.annotation, 800),
            rating: clampRating(item.star)
        }
    };
}

async function callEagleTool(
    doFetch: FetchImpl,
    endpoint: string,
    tool: string,
    params: Record<string, unknown>
): Promise<{ ok: boolean; body?: unknown; error?: string }> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), CALL_TIMEOUT_MS) : undefined;
    try {
        const response = await doFetch(`${endpoint}/api/tools/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool, params }),
            ...(controller ? { signal: controller.signal } : {})
        });
        if (!response.ok) {
            return { ok: false, error: `Eagle 接口返回 HTTP ${response.status}` };
        }
        const body = await response.json() as Record<string, unknown>;
        if (body && body.success === false) {
            return { ok: false, error: cleanText(body.message || body.error, 300) || 'Eagle 拒绝了该操作' };
        }
        return { ok: true, body };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '');
        return { ok: false, error: /abort/i.test(message) ? `Eagle 响应超时（${CALL_TIMEOUT_MS}ms）` : message.slice(0, 300) };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function extractItems(body: unknown): Array<Record<string, unknown>> {
    if (!body || typeof body !== 'object') return [];
    const record = body as Record<string, unknown>;
    const candidates = [record.data, record.items, record.result];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate as Array<Record<string, unknown>>;
        if (candidate && typeof candidate === 'object') {
            const inner = (candidate as Record<string, unknown>).items;
            if (Array.isArray(inner)) return inner as Array<Record<string, unknown>>;
        }
    }
    return [];
}

function valuesMatch(left: EagleInspectorEditBaseline, right: EagleInspectorEditBaseline): boolean {
    return sameStringSet(left.tags, right.tags)
        && left.annotation === right.annotation
        && left.rating === right.rating;
}

function sameStringSet(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every((value) => rightSet.has(value));
}

function normalizeValues(value?: Partial<EagleInspectorEditBaseline>): EagleInspectorEditBaseline {
    return {
        tags: normalizeStringList(value?.tags),
        annotation: cleanText(value?.annotation, 800),
        rating: clampRating(value?.rating)
    };
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => cleanText(item, 240)).filter(Boolean))).slice(0, 100);
}

function clampRating(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(5, Math.round(parsed)));
}

function normalizeEndpoint(value: unknown): string {
    const text = cleanText(value, 300).replace(/\/+$/, '');
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(text) ? text : EAGLE_WRITEBACK_DEFAULT_ENDPOINT;
}

function cleanText(value: unknown, limit: number): string {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function buildBoundaries(userConfirmed: boolean, readbackVerified: boolean): EagleInspectorWritebackResult['boundaries'] {
    return {
        writesViaEagleApiOnly: true,
        doesNotWriteLibraryJson: true,
        userConfirmedEdit: userConfirmed,
        readbackVerified
    };
}

function failure(
    status: EagleInspectorWritebackResult['status'],
    itemId: string,
    userConfirmed: boolean,
    error: string
): EagleInspectorWritebackResult {
    return {
        success: false,
        status,
        itemId,
        appliedOperations: [],
        error,
        boundaries: buildBoundaries(userConfirmed, false)
    };
}
