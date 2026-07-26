/**
 * 业务结果 → Evaluation Profile verification record 纯适配层。
 *
 * 这里只读取对应 Skill bridge 已返回的结构化、带版本契约；不调用 Tool / 模型，
 * 不根据任务文本或 result.success 猜测质量，也不拥有最终 DesignVerdict。
 */

import {
    DETAIL_PAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    SKU_BATCH_EVALUATION_PROFILE_ID,
    type DesignEvaluationVerificationRecord,
    type DesignEvaluationVerificationStatus,
    type DesignEvaluationProfile
} from './design-evaluation-profiles';

export interface DesignEvaluationSourceToolResult {
    name: string;
    result?: unknown;
}

export type DesignEvaluationResultAdapterIssueCode =
    | 'source_not_found'
    | 'source_contract_invalid'
    | 'source_stale_after_mutation'
    | 'explicit_failure_observed'
    | 'quality_review_required';

export interface DesignEvaluationResultAdapterResult {
    version: 'design-evaluation-result-adapter/v0';
    profileId: DesignEvaluationProfile['profileId'];
    sourceToolName?: string;
    sourceIndex?: number;
    records: DesignEvaluationVerificationRecord[];
    issueCodes: DesignEvaluationResultAdapterIssueCode[];
    boundaries: {
        executesTools: false;
        callsModel: false;
        trustsToolSuccessAsQualityPass: false;
        acceptsOnlyVersionedBusinessContracts: true;
        staleRecordsCanPass: false;
        finalVerdictOwnedByAdapter: false;
    };
}

const ADAPTER_BOUNDARIES: DesignEvaluationResultAdapterResult['boundaries'] = Object.freeze({
    executesTools: false,
    callsModel: false,
    trustsToolSuccessAsQualityPass: false,
    acceptsOnlyVersionedBusinessContracts: true,
    staleRecordsCanPass: false,
    finalVerdictOwnedByAdapter: false
});

const SOURCE_TOOL_BY_PROFILE: Record<DesignEvaluationProfile['profileId'], string> = {
    [MAIN_IMAGE_EVALUATION_PROFILE_ID]: 'main-image-design',
    [DETAIL_PAGE_EVALUATION_PROFILE_ID]: 'detail-page-design',
    [DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID]: 'detail-page-design',
    [SKU_COLOR_CARD_EVALUATION_PROFILE_ID]: 'sku-color-card',
    [SKU_BATCH_EVALUATION_PROFILE_ID]: 'sku-batch'
};

function readRecord(value: unknown): Record<string, any> | undefined {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

function readArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function readText(value: unknown): string {
    return String(value || '').trim();
}

function unique<T extends string>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function verificationRecord(
    key: string,
    status: DesignEvaluationVerificationStatus,
    verificationRef: string,
    source: DesignEvaluationVerificationRecord['source'] = 'quality_adapter'
): DesignEvaluationVerificationRecord {
    return { key, status, source, verificationRef };
}

function findLatestSource(input: {
    toolResults: readonly DesignEvaluationSourceToolResult[];
    sourceToolName: string;
}): { index: number; result: Record<string, any>; data?: Record<string, any> } | undefined {
    for (let index = input.toolResults.length - 1; index >= 0; index -= 1) {
        const entry = input.toolResults[index];
        if (entry.name !== input.sourceToolName) continue;
        const result = readRecord(entry.result);
        if (!result) return { index, result: {} };
        return { index, result, data: readRecord(result.data) };
    }
    return undefined;
}

function resultIssues(records: DesignEvaluationVerificationRecord[]): DesignEvaluationResultAdapterIssueCode[] {
    const issues: DesignEvaluationResultAdapterIssueCode[] = [];
    if (records.some((record) => record.status === 'failed')) issues.push('explicit_failure_observed');
    if (records.some((record) => record.status === 'needs_review')) issues.push('quality_review_required');
    return issues;
}

function buildMainImageRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    const report = readRecord(data.mainImageQaReport);
    if (report?.reportVersion !== 'main-image-qa-report/v0') return [];
    const qualityClaim = readRecord(report.qualityClaim);
    const redaction = readRecord(report.redaction);
    const stage = readText(report.stage);
    const reportStatus = readText(report.status);
    const explicitlyFailed = stage === 'blocked' || reportStatus === 'failed';
    const fullyPassed = stage === 'passed'
        && reportStatus === 'passed'
        && qualityClaim?.allowed === true
        && redaction?.rawImagesRedacted === true
        && redaction?.pathsRedacted === true;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return [verificationRecord(
        'main_image_qa_report',
        status,
        `quality-adapter:main-image-qa-report:${status}`
    )];
}

function buildDetailScreenCoverageRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const summary = readRecord(data.detailPageAgentResultSummary);
    const stats = readRecord(data.stats);
    const screenPlans = readArray(data.screenPlans);
    if (summary?.summaryVersion !== 'detail-page-agent-result-summary/v0' || !stats) return undefined;
    const processed = readNumber(stats.screensProcessed);
    const succeeded = readNumber(stats.screensSuccess);
    const failed = readNumber(stats.screensFailed);
    const summaryStatus = readText(summary.status);
    const explicitlyFailed = summaryStatus === 'failed'
        || summaryStatus === 'blocked'
        || failed > 0;
    const fullyCovered = summaryStatus === 'completed'
        && processed > 0
        && failed === 0
        && succeeded === processed
        && screenPlans.length >= processed;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyCovered ? 'passed' : 'needs_review';
    return verificationRecord(
        'detail_page_screen_coverage',
        status,
        `quality-adapter:detail-page-screen-coverage:${status}`
    );
}

function buildDetailPlacementRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const audit = readRecord(data.placementAudit);
    const diagnostics = readRecord(data.livePlacementDiagnostics);
    if (!audit || !diagnostics) return undefined;
    const warnings = readArray(audit.warnings);
    const riskyScreenIds = readArray(audit.riskyScreenIds);
    const placementCount = readNumber(diagnostics.placementCount);
    const unmatchedCount = readNumber(diagnostics.unmatchedPlaceholderCount);
    const explicitlyFailed = audit.success === false
        || warnings.length > 0
        || riskyScreenIds.length > 0
        || unmatchedCount > 0;
    const fullyPassed = audit.success === true
        && placementCount > 0
        && warnings.length === 0
        && riskyScreenIds.length === 0
        && unmatchedCount === 0;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return verificationRecord(
        'detail_page_placement_audit',
        status,
        `quality-adapter:detail-page-placement-audit:${status}`
    );
}

function buildDetailContentRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const contentVerification = readRecord(data.detailPageContentVerification);
    if (contentVerification?.version !== 'detail-page-content-verification/v0') return undefined;
    const explicitlyFailed = contentVerification.status === 'failed';
    const fullyPassed = contentVerification.status === 'passed'
        && contentVerification.verificationPassed === true
        && readRecord(contentVerification.summary)?.screenCount > 0
        && readRecord(contentVerification.boundaries)?.claimsDesignQuality === false;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return verificationRecord(
        'detail_page_content_verification',
        status,
        `quality-adapter:detail-page-content-verification:${status}`
    );
}

function buildDetailPageRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    return [
        buildDetailScreenCoverageRecord(data),
        buildDetailPlacementRecord(data),
        buildDetailContentRecord(data)
    ].filter((record): record is DesignEvaluationVerificationRecord => Boolean(record));
}

function buildDetailPageScopedEditRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    return [buildDetailPlacementRecord(data)]
        .filter((record): record is DesignEvaluationVerificationRecord => Boolean(record));
}

function buildSkuVariantCoverageRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const delivery = readRecord(data.skuDeliverySummary);
    const manifest = readArray(data.skuExecutionManifest).map(readRecord).filter(Boolean) as Record<string, any>[];
    if (delivery?.version !== 'sku-delivery-summary/v0' || manifest.length === 0) return undefined;
    const expectedComboCount = manifest.reduce((total, item) => {
        return total + (readArray(item.plannedActions).includes('combo') ? readNumber(item.comboCount) : 0);
    }, 0);
    const expectedNoteCount = manifest.filter((item) => readArray(item.plannedActions).includes('self-select-note')).length;
    const hasBlockedManifest = manifest.some((item) => readText(item.status) === 'blocked');
    const explicitlyFailed = hasBlockedManifest
        || delivery.status === 'failed'
        || delivery.status === 'partial'
        || readNumber(delivery.warningCount) > 0;
    const hasExpectedWork = expectedComboCount > 0 || expectedNoteCount > 0;
    const fullyCovered = delivery.status === 'completed'
        && hasExpectedWork
        && !hasBlockedManifest
        && readNumber(delivery.warningCount) === 0
        && readNumber(delivery.totalCombos) === expectedComboCount
        && readNumber(delivery.noteCount) === expectedNoteCount;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyCovered ? 'passed' : 'needs_review';
    return verificationRecord(
        'sku_variant_coverage',
        status,
        `quality-adapter:sku-variant-coverage:${status}`
    );
}

function buildSkuExportReadbackRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const readback = readRecord(data.skuExportReadback);
    if (readback?.version !== 'sku-export-readback/v0') return undefined;
    const expectedCount = readNumber(readback.expectedExportCount);
    const probes = readArray(readback.fileProbes);
    const everyProbeHasSafeMetrics = expectedCount > 0
        && probes.length === expectedCount
        && probes.every((value) => {
            const probe = readRecord(value);
            const metrics = readRecord(probe?.visualMetrics);
            return probe?.success === true
                && probe.rawImagesRedacted === true
                && metrics?.rawImagesRedacted === true;
        });
    const explicitlyFailed = readback.status === 'blocked' || readback.status === 'no_exports';
    const fullyPassed = readback.status === 'ready_for_review'
        && expectedCount > 0
        && readNumber(readback.okFileProbeCount) === expectedCount
        && readNumber(readback.failedFileProbeCount) === 0
        && readNumber(readback.missingFileProbeCount) === 0
        && readNumber(readback.dimensionMismatchCount) === 0
        && readNumber(readback.visualMetricBlockerCount) === 0
        && everyProbeHasSafeMetrics;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return verificationRecord(
        'sku_export_readback',
        status,
        `quality-adapter:sku-export-readback:${status}`
    );
}

function getSkuHumanReviewStatus(data: Record<string, any>): DesignEvaluationVerificationStatus | undefined {
    const binding = readRecord(data.skuHumanReviewBinding);
    if (binding?.version !== 'sku-human-review-binding/v0') return undefined;
    const status = readText(binding.status);
    const freshness = readRecord(binding.freshness);
    if (status === 'blocked_current_output' || status === 'invalid_review_ignored' || status === 'fresh_review_rejected') {
        return 'failed';
    }
    if (
        status === 'fresh_review_approved'
        && binding.canSatisfyHumanReviewCheck === true
        && freshness?.checked === true
        && freshness.subjectMatched === true
        && freshness.projectMatched === true
        && freshness.recordIntegrityVerified === true
    ) {
        return 'passed';
    }
    return 'needs_review';
}

function buildSkuRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    const records: Array<DesignEvaluationVerificationRecord | undefined> = [
        buildSkuVariantCoverageRecord(data),
        buildSkuExportReadbackRecord(data)
    ];
    const reviewStatus = getSkuHumanReviewStatus(data);
    if (reviewStatus) {
        records.push(
            verificationRecord(
                'sku_product_truth',
                reviewStatus,
                `quality-adapter:sku-product-truth:${reviewStatus}`,
                'human_review'
            ),
            verificationRecord(
                'sku_visual_consistency',
                reviewStatus,
                `quality-adapter:sku-visual-consistency:${reviewStatus}`,
                'human_review'
            )
        );
    }
    return records.filter((record): record is DesignEvaluationVerificationRecord => Boolean(record));
}

function buildSkuColorCardRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    const report = readRecord(data.report);
    if (report?.version !== 'sku-color-card-execution-report/v1') return [];
    const checks = readRecord(report.checks);
    if (!checks) return [];

    function statusForCheck(value: unknown): DesignEvaluationVerificationStatus {
        if (value === 'passed') return 'passed';
        if (value === 'failed') return 'failed';
        return 'needs_review';
    }

    const finalStructureStatus = statusForCheck(checks.finalStructureReadback);
    const sourceCoverageStatus = statusForCheck(checks.sourceCoverage);
    const smartObjectStatus = statusForCheck(checks.smartObjectEditability);
    const clippingStatus = statusForCheck(checks.clippingStructure);
    const labelTextFitStatus = statusForCheck(checks.labelTextFit);
    const visualCompositionStatus = statusForCheck(checks.visualComposition);
    return [
        verificationRecord(
            'sku_color_card_final_structure',
            finalStructureStatus,
            `quality-adapter:sku-color-card-structure:${finalStructureStatus}`
        ),
        verificationRecord(
            'sku_color_card_source_coverage',
            sourceCoverageStatus,
            `quality-adapter:sku-color-card-source-coverage:${sourceCoverageStatus}`
        ),
        verificationRecord(
            'sku_color_card_smart_object_editability',
            smartObjectStatus,
            `quality-adapter:sku-color-card-smart-object:${smartObjectStatus}`
        ),
        verificationRecord(
            'sku_color_card_clipping_structure',
            clippingStatus,
            `quality-adapter:sku-color-card-clipping:${clippingStatus}`
        ),
        verificationRecord(
            'sku_color_card_label_text_fit',
            labelTextFitStatus,
            `quality-adapter:sku-color-card-label-text-fit:${labelTextFitStatus}`
        ),
        verificationRecord(
            'sku_color_card_visual_consistency',
            visualCompositionStatus,
            `quality-adapter:sku-color-card-visual-consistency:${visualCompositionStatus}`
        )
    ];
}

function buildRecordsForProfile(
    profile: DesignEvaluationProfile,
    data: Record<string, any>
): DesignEvaluationVerificationRecord[] {
    switch (profile.profileId) {
        case MAIN_IMAGE_EVALUATION_PROFILE_ID:
            return buildMainImageRecords(data);
        case DETAIL_PAGE_EVALUATION_PROFILE_ID:
            return buildDetailPageRecords(data);
        case DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID:
            return buildDetailPageScopedEditRecords(data);
        case SKU_COLOR_CARD_EVALUATION_PROFILE_ID:
            return buildSkuColorCardRecords(data);
        case SKU_BATCH_EVALUATION_PROFILE_ID:
            return buildSkuRecords(data);
    }
}

function staleRecords(records: DesignEvaluationVerificationRecord[]): DesignEvaluationVerificationRecord[] {
    return records.map((record) => ({
        ...record,
        status: 'needs_review',
        verificationRef: `quality-adapter:${record.key}:stale`
    }));
}

export function adaptDesignEvaluationRecordsFromToolResults(input: {
    profile: DesignEvaluationProfile;
    toolResults: readonly DesignEvaluationSourceToolResult[];
    /** Agent 运行日志中最后一次成功 mutation 的下标；更早的质量记录必须失效。 */
    lastMutationIndex?: number;
}): DesignEvaluationResultAdapterResult {
    const sourceToolName = SOURCE_TOOL_BY_PROFILE[input.profile.profileId];
    const source = findLatestSource({ toolResults: input.toolResults, sourceToolName });
    if (!source) {
        return {
            version: 'design-evaluation-result-adapter/v0',
            profileId: input.profile.profileId,
            sourceToolName,
            records: [],
            issueCodes: ['source_not_found'],
            boundaries: ADAPTER_BOUNDARIES
        };
    }
    const records = source.data ? buildRecordsForProfile(input.profile, source.data) : [];
    if (records.length === 0) {
        return {
            version: 'design-evaluation-result-adapter/v0',
            profileId: input.profile.profileId,
            sourceToolName,
            sourceIndex: source.index,
            records: [],
            issueCodes: ['source_contract_invalid'],
            boundaries: ADAPTER_BOUNDARIES
        };
    }
    const lastMutationIndex = Number.isFinite(input.lastMutationIndex)
        ? Number(input.lastMutationIndex)
        : -1;
    const isStale = source.index < lastMutationIndex;
    const finalRecords = isStale ? staleRecords(records) : records;
    return {
        version: 'design-evaluation-result-adapter/v0',
        profileId: input.profile.profileId,
        sourceToolName,
        sourceIndex: source.index,
        records: finalRecords,
        issueCodes: unique([
            ...(isStale ? ['source_stale_after_mutation' as const] : []),
            ...resultIssues(finalRecords)
        ]),
        boundaries: ADAPTER_BOUNDARIES
    };
}
