/**
 * 局部修改的通用验证记录。
 *
 * 这里只消费现有 Photoshop Tool acceptance 的 before/after diff 与参数断言；
 * 不读取任务文本、不猜品类，也不把普通 Tool success 当作修改正确。
 */

import type { DesignEvaluationVerificationRecord } from './design-evaluation-profiles';

interface RuntimeScopedChangeToolResult {
    name: string;
    result?: unknown;
}

interface AcceptanceAssertionLike {
    status?: unknown;
    affectedLayerIds?: unknown;
    expected?: unknown;
    actual?: unknown;
    scope?: unknown;
}

interface AcceptanceLike {
    enabled?: unknown;
    verified?: unknown;
    noDocumentChangeRisk?: unknown;
    assertionStatus?: unknown;
    assertions?: unknown;
    before?: unknown;
    after?: unknown;
    diff?: unknown;
}

const NON_VISUAL_STRUCTURE_ONLY_TOOLS = new Set([
    'renameLayer',
    'batchRenameLayers'
]);

function readRecord(value: unknown): Record<string, any> | undefined {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

function readAcceptance(result: unknown): AcceptanceLike | undefined {
    const record = readRecord(result);
    const acceptance = readRecord(record?.acceptance) || readRecord(readRecord(record?.data)?.acceptance);
    return acceptance?.enabled === true ? acceptance : undefined;
}

function readAssertions(acceptance: AcceptanceLike): AcceptanceAssertionLike[] {
    return Array.isArray(acceptance.assertions)
        ? acceptance.assertions.filter((item) => Boolean(readRecord(item))) as AcceptanceAssertionLike[]
        : [];
}

function readLayerIds(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)));
}

function readChangedLayerIds(acceptance: AcceptanceLike): number[] {
    const diff = readRecord(acceptance.diff);
    const changed = Array.isArray(diff?.changedLayers)
        ? diff.changedLayers.map((item) => Number(readRecord(item)?.id))
        : [];
    return Array.from(new Set([
        ...readLayerIds(diff?.addedLayerIds),
        ...readLayerIds(diff?.removedLayerIds),
        ...changed.filter((item) => Number.isFinite(item) && item > 0)
    ]));
}

function hasCompleteComparableDiff(acceptance: AcceptanceLike): boolean {
    const before = readRecord(acceptance.before);
    const after = readRecord(acceptance.after);
    const beforeSummary = readRecord(before?.summary);
    const afterSummary = readRecord(after?.summary);
    const diff = readRecord(acceptance.diff);
    const summary = readRecord(diff?.summary);
    if (diff?.comparable !== true
        || beforeSummary?.truncated === true
        || afterSummary?.truncated === true
        || !summary) return false;
    const listedChangeCount = readLayerIds(diff.addedLayerIds).length
        + readLayerIds(diff.removedLayerIds).length
        + (Array.isArray(diff.changedLayers) ? diff.changedLayers.length : 0);
    const reportedChangeCount = Number(summary.added || 0)
        + Number(summary.removed || 0)
        + Number(summary.changed || 0);
    return Number.isFinite(reportedChangeCount) && listedChangeCount === reportedChangeCount;
}

function hasPotentialVisualImpact(
    entry: RuntimeScopedChangeToolResult,
    acceptance: AcceptanceLike
): boolean {
    const diff = readRecord(acceptance.diff);
    if (readLayerIds(diff?.addedLayerIds).length > 0
        || readLayerIds(diff?.removedLayerIds).length > 0) return true;
    const changedLayers = Array.isArray(diff?.changedLayers)
        ? diff.changedLayers.map(readRecord).filter(Boolean) as Record<string, any>[]
        : [];
    return changedLayers.some((change) => {
        const kinds = Array.isArray(change.changes) ? change.changes.map(String) : [];
        if (kinds.some((kind) => kind === 'text' || kind === 'geometry' || kind === 'style')) return true;
        return kinds.includes('structure') && !NON_VISUAL_STRUCTURE_ONLY_TOOLS.has(entry.name);
    });
}

function isExplicitAssertion(assertion: AcceptanceAssertionLike): boolean {
    const scope = String(assertion.scope || '').toLowerCase();
    return !scope.includes('inferred')
        && assertion.expected !== undefined
        && assertion.actual !== undefined
        && readLayerIds(assertion.affectedLayerIds).length > 0;
}

function hasUnexpectedOutsideScopeChange(
    acceptance: AcceptanceLike,
    affectedLayerIds: ReadonlySet<number>
): boolean {
    const diff = readRecord(acceptance.diff);
    if (readLayerIds(diff?.addedLayerIds).some((layerId) => !affectedLayerIds.has(layerId))) return true;
    if (readLayerIds(diff?.removedLayerIds).some((layerId) => !affectedLayerIds.has(layerId))) return true;
    const changedLayers = Array.isArray(diff?.changedLayers)
        ? diff.changedLayers.map(readRecord).filter(Boolean) as Record<string, any>[]
        : [];
    const targetPaths = changedLayers
        .filter((change) => affectedLayerIds.has(Number(change.id)))
        .flatMap((change) => [String(change.before || ''), String(change.after || '')])
        .filter(Boolean);
    return changedLayers.some((change) => {
        if (affectedLayerIds.has(Number(change.id))) return false;
        const changes = Array.isArray(change.changes) ? change.changes.map(String) : [];
        const path = String(change.before || change.after || '');
        const ancestorGeometryOnly = changes.length > 0
            && changes.every((kind) => kind === 'geometry')
            && targetPaths.some((targetPath) => targetPath.startsWith(`${path}/`));
        return !ancestorGeometryOnly;
    });
}

function verificationRecord(
    key: 'requested_change_applied' | 'outside_scope_preserved',
    status: DesignEvaluationVerificationRecord['status']
): DesignEvaluationVerificationRecord {
    return {
        key,
        status,
        source: 'runtime_observation',
        verificationRef: `runtime:scoped-change:${key}:${status}`
    };
}

export function buildRuntimeScopedChangeVerificationRecords(
    toolResults: readonly RuntimeScopedChangeToolResult[]
): DesignEvaluationVerificationRecord[] {
    const relevant = toolResults.flatMap((entry) => {
        const acceptance = readAcceptance(entry.result);
        if (!acceptance) return [];
        // 不能丢弃没有任务断言的后续 mutation：它会使先前的局部范围通过失效，
        // 否则“先精准修改、再无范围写入”会把旧验收错误沿用到最终画布。
        const assertions = readAssertions(acceptance)
            .filter((assertion) => assertion.status !== 'not_applicable');
        return [{ entry, acceptance, assertions }];
    });
    if (relevant.length === 0) return [];

    let requestedChangeStatus: DesignEvaluationVerificationRecord['status'] = 'passed';
    let outsideScopeStatus: DesignEvaluationVerificationRecord['status'] = 'passed';

    for (const { entry, acceptance, assertions } of relevant) {
        const result = readRecord(entry.result);
        const assertionStatuses = assertions.map((assertion) => String(assertion.status || ''));
        const preciseAssertions = assertions.filter(isExplicitAssertion);
        const affectedLayerIds = new Set(preciseAssertions.flatMap((assertion) => (
            readLayerIds(assertion.affectedLayerIds)
        )));
        const changedLayerIds = readChangedLayerIds(acceptance);
        const completeComparableDiff = hasCompleteComparableDiff(acceptance);
        const outsideScopeChange = affectedLayerIds.size > 0
            && hasUnexpectedOutsideScopeChange(acceptance, affectedLayerIds);

        if (result?.success === false
            || acceptance.assertionStatus === 'failed'
            || assertionStatuses.includes('failed')
            || acceptance.noDocumentChangeRisk === true) {
            requestedChangeStatus = 'failed';
        } else if (requestedChangeStatus !== 'failed' && (
            acceptance.verified !== true
            || !preciseAssertions.some((assertion) => assertion.status === 'passed')
            || changedLayerIds.length === 0
            || !completeComparableDiff
        )) {
            requestedChangeStatus = 'needs_review';
        }

        if (outsideScopeChange) {
            outsideScopeStatus = 'failed';
        } else if (outsideScopeStatus !== 'failed' && (
            !completeComparableDiff
            || affectedLayerIds.size === 0
        )) {
            outsideScopeStatus = 'needs_review';
        }
    }

    return [
        verificationRecord('requested_change_applied', requestedChangeStatus),
        verificationRecord('outside_scope_preserved', outsideScopeStatus)
    ];
}

/**
 * 局部编辑只有在实际 mutation 可能改变像素呈现时，才动态要求同版本视觉复核。
 * 这不是另一套裁决：缺少视觉观察时只给现有 fresh_visual_evaluation key 写 needs_review，
 * 真正的新鲜视觉结果仍由 Agent 的 Host-bound Judge owner 签发 passed。
 */
export function buildRuntimeScopedVisualReviewVerificationRecords(
    toolResults: readonly RuntimeScopedChangeToolResult[],
    options: { hasFreshVisualEvaluation: boolean }
): DesignEvaluationVerificationRecord[] {
    if (options.hasFreshVisualEvaluation) return [];
    const requiresVisualReview = toolResults.some((entry) => {
        const acceptance = readAcceptance(entry.result);
        return Boolean(acceptance && hasPotentialVisualImpact(entry, acceptance));
    });
    if (!requiresVisualReview) return [];
    return [{
        key: 'fresh_visual_evaluation',
        status: 'needs_review',
        source: 'runtime_observation',
        verificationRef: 'runtime:scoped-change:fresh-visual:needs-review'
    }];
}
