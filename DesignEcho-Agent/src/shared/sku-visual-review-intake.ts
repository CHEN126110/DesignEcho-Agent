import type { HumanReviewDecision, HumanReviewSourceViewModel } from './human-review-intake';
import type { SkuColorCardImageProbeReview } from './sku-color-card-image-probes';
import type { SkuColorCardRetouchStrategy } from './sku-color-card-retouch-strategy';

export type SkuVisualReviewIntakeVersion = 'sku-visual-review-intake/v0';

export type SkuVisualReviewIntakeStatus =
    | 'blocked_missing_export_readback'
    | 'blocked_export_readback'
    | 'blocked_execution_manifest'
    | 'blocked_auto_layout_qa'
    | 'ready_for_human_review'
    | 'human_review_recorded';

export interface SkuVisualReviewHumanReviewLike {
    decision?: unknown;
    reviewer?: unknown;
    score?: unknown;
    notes?: unknown;
    reviewedAt?: unknown;
}

export interface SkuVisualReviewHumanReview {
    decision: HumanReviewDecision;
    reviewer?: string;
    score?: number;
    notes: string[];
    reviewedAt?: string;
}

export interface SkuVisualReviewSummary {
    configuredPlanStatus: string;
    retouchStrategyStatus: string;
    retouchRequirementCount: number;
    imageProbeReviewStatus: string;
    imageProbeMetricCount: number;
    autoLayoutDecisionCount: number;
    autoLayoutNoPlaceholderDecisionCount: number;
    autoLayoutQaDiagnosticCount: number;
    autoLayoutQaBlockerCount: number;
    autoLayoutQaWarningCount: number;
    manifestReadyCount: number;
    manifestBlockedCount: number;
    comboExecutionCount: number;
    noteExecutionCount: number;
    expectedExportCount: number;
    fileProbeCount: number;
    okFileProbeCount: number;
    failedFileProbeCount: number;
    missingFileProbeCount: number;
    dimensionMismatchCount: number;
    resultFileNames: string[];
}

export interface BuildSkuVisualReviewIntakeInput {
    configuredPlan?: unknown;
    executionManifest?: unknown;
    exportReadback?: unknown;
    colorCardRetouchStrategy?: SkuColorCardRetouchStrategy | unknown;
    colorCardImageProbeReview?: SkuColorCardImageProbeReview | unknown;
    autoLayoutDecisions?: unknown;
    autoLayoutQaDiagnostics?: unknown;
    humanReview?: SkuVisualReviewHumanReviewLike | null;
    generatedAt?: unknown;
}

export interface SkuVisualReviewRetouchReview {
    strategyVersion: string;
    strategyStatus: string;
    required: boolean;
    requirements: string[];
    shapeChecks: string[];
    lightChecks: string[];
    shadowChecks: string[];
    boundaries: string[];
}

export interface SkuVisualReviewIntake {
    version: SkuVisualReviewIntakeVersion;
    status: SkuVisualReviewIntakeStatus;
    statusLabel: string;
    generatedAt: string;
    summary: SkuVisualReviewSummary;
    reviewSource?: HumanReviewSourceViewModel;
    retouchReview?: SkuVisualReviewRetouchReview;
    autoLayoutReview?: SkuVisualReviewAutoLayoutReview;
    imageProbeReview?: SkuColorCardImageProbeReview;
    humanReview?: SkuVisualReviewHumanReview;
    requirements: string[];
    blockers: string[];
    warnings: string[];
    qualityClaim: {
        allowed: false;
        reason: string;
        boundary: string;
    };
    boundaries: {
        readOnly: true;
        rawImagesRedacted: true;
        localPathsRedacted: true;
        doesNotRunProvider: true;
        doesNotRunPhotoshop: true;
        doesNotClaimDesignQuality: true;
    };
    canPrepareHumanReview: boolean;
    canClaimDesignQuality: false;
    canRunProvider: false;
    canRunPhotoshop: false;
}

export interface SkuVisualReviewAutoLayoutReview {
    version: 'sku-auto-layout-visual-review/v0';
    status: 'not_used' | 'ready_for_visual_review' | 'needs_visual_review' | 'blocked_actual_bounds_qa';
    noPlaceholderRequired: boolean;
    decisionCount: number;
    noPlaceholderDecisionCount: number;
    comboDecisionCount: number;
    noteDecisionCount: number;
    decisionSources: string[];
    requirements: string[];
    blockers: string[];
    warnings: string[];
    boundaries: {
        usesActualBoundsDiagnostics: true;
        rawPayloadRedacted: true;
        claimsDesignQuality: false;
    };
}

const DEFAULT_REQUIREMENTS = [
    '核对 SKU 颜色数量、颜色名称和导出文件是否与项目配置一致。',
    '核对对应规格的自选备注是否存在，且备注图覆盖用户可选颜色。',
    '核对袜子形态、尺寸比例、罗口方向、边缘干净度、光影和阴影是否统一自然。',
    '核对图片没有明显拉伸、错位、裁切、图层残影或背景污染。',
    '核对导出文件可解码且尺寸与模板预期一致。'
];

const AUTO_LAYOUT_REQUIREMENTS = [
    '核对无占位符自动排版后的实际边界与计划框一致，不能只看计划值。',
    '核对袜子组合之间保持足够间距，不能互相重叠或压到模板文字、Logo、价格、角标和其他固定元素。',
    '核对多数量组合和自选备注中的袜子共享缩放比例，罗口方向、脚尖角度和底部基线保持一致。',
    '核对自选备注图中的袜子、颜色名、序号和备注区域仍然清晰可读，不能因为自动压缩导致拥挤。',
    '核对旧模板有可靠占位符时仍沿用占位符路径；只有缺少可靠占位符或用户明确要求时才使用无占位符自动排版。'
];

export function buildSkuVisualReviewIntake(
    input: BuildSkuVisualReviewIntakeInput
): SkuVisualReviewIntake {
    const generatedAt = normalizeIsoTime(input.generatedAt);
    const configuredPlan = readRecord(input.configuredPlan);
    const exportReadback = readRecord(input.exportReadback);
    const retouchReview = buildRetouchReview(input.colorCardRetouchStrategy);
    const imageProbeReview = normalizeImageProbeReview(input.colorCardImageProbeReview);
    const autoLayoutReview = buildAutoLayoutReview({
        decisions: input.autoLayoutDecisions,
        diagnostics: input.autoLayoutQaDiagnostics
    });
    const executionManifest = Array.isArray(input.executionManifest) ? input.executionManifest : [];
    const humanReview = normalizeHumanReview(input.humanReview, generatedAt);

    const summary = buildSummary({
        configuredPlan,
        executionManifest,
        exportReadback,
        retouchReview,
        imageProbeReview,
        autoLayoutReview
    });
    const blockers = uniqueStrings([
        ...normalizeTextList(configuredPlan?.blockers),
        ...executionManifest.flatMap((item) => normalizeTextList(readRecord(item)?.blockers)),
        ...normalizeTextList(exportReadback?.blockers),
        ...autoLayoutReview.blockers
    ]);
    const warnings = uniqueStrings([
        ...normalizeTextList(configuredPlan?.warnings),
        ...normalizeTextList(exportReadback?.warnings),
        ...(retouchReview ? [] : ['缺少 SKU 色卡精修策略，人工复核只能使用默认视觉检查项。']),
        ...normalizeTextList(imageProbeReview?.warnings),
        ...normalizeTextList(imageProbeReview?.blockers).map((item) => `图像探针待复核：${item}`),
        ...autoLayoutReview.warnings
    ]);

    let status: SkuVisualReviewIntakeStatus = 'ready_for_human_review';

    if (!exportReadback) {
        status = 'blocked_missing_export_readback';
        blockers.unshift('缺少 skuExportReadback，不能确认 SKU 导出文件是否存在、可解码或尺寸正确。');
    } else if (sanitizeText(exportReadback.status) !== 'ready_for_review') {
        status = 'blocked_export_readback';
        blockers.unshift(`SKU 导出读回未通过：${sanitizeText(exportReadback.status) || 'unknown'}`);
    } else if (summary.manifestBlockedCount > 0) {
        status = 'blocked_execution_manifest';
        blockers.unshift(`SKU 执行清单仍有 ${summary.manifestBlockedCount} 个规格阻断，不能进入人工质量复核。`);
    } else if (autoLayoutReview.status === 'blocked_actual_bounds_qa') {
        status = 'blocked_auto_layout_qa';
        blockers.unshift('SKU 无占位符自动排版实际边界校验未通过，不能进入人工质量复核。');
    } else if (humanReview && humanReview.decision !== 'none') {
        status = 'human_review_recorded';
    }

    const reviewSource = status === 'ready_for_human_review' || status === 'human_review_recorded'
        ? buildReviewSource({ status, summary })
        : undefined;

    return {
        version: 'sku-visual-review-intake/v0',
        status,
        statusLabel: getStatusLabel(status),
        generatedAt,
        summary,
        reviewSource,
        retouchReview,
        autoLayoutReview: autoLayoutReview.decisionCount > 0 || autoLayoutReview.blockers.length > 0 || autoLayoutReview.warnings.length > 0
            ? autoLayoutReview
            : undefined,
        imageProbeReview,
        humanReview: humanReview && humanReview.decision !== 'none' ? humanReview : undefined,
        requirements: uniqueStrings([
            ...DEFAULT_REQUIREMENTS,
            ...(autoLayoutReview.noPlaceholderRequired ? autoLayoutReview.requirements : []),
            ...(retouchReview?.requirements || []),
            ...(imageProbeReview?.probeRequirements || [])
        ]),
        blockers: uniqueStrings(blockers).slice(0, 12),
        warnings: uniqueStrings(warnings).slice(0, 12),
        qualityClaim: {
            allowed: false,
            reason: status === 'human_review_recorded'
                ? '已记录人工复核输入，但最终业务验收仍需要可回放结果、复核记录和交付记录共同证明。'
                : '当前只准备 SKU 视觉复核入口，不能把导出读回或工具执行直接升级为设计质量结论。',
            boundary: '该契约只汇总 SKU 配置、执行清单、导出读回和人工复核输入；不会调用模型、不会写 Photoshop，也不会声明最终设计质量完成。'
        },
        boundaries: {
            readOnly: true,
            rawImagesRedacted: true,
            localPathsRedacted: true,
            doesNotRunProvider: true,
            doesNotRunPhotoshop: true,
            doesNotClaimDesignQuality: true
        },
        canPrepareHumanReview: status === 'ready_for_human_review',
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

function buildSummary(input: {
    configuredPlan?: Record<string, unknown>;
    executionManifest: unknown[];
    exportReadback?: Record<string, unknown>;
    retouchReview?: SkuVisualReviewRetouchReview;
    imageProbeReview?: SkuColorCardImageProbeReview;
    autoLayoutReview: SkuVisualReviewAutoLayoutReview;
}): SkuVisualReviewSummary {
    const manifestItems = input.executionManifest.map(readRecord).filter(Boolean) as Record<string, unknown>[];
    return {
        configuredPlanStatus: sanitizeText(input.configuredPlan?.status) || 'not_available',
        retouchStrategyStatus: input.retouchReview?.strategyStatus || 'not_available',
        retouchRequirementCount: input.retouchReview?.requirements.length || 0,
        imageProbeReviewStatus: input.imageProbeReview?.status || 'not_available',
        imageProbeMetricCount: input.imageProbeReview?.summary.metricProbeCount || 0,
        autoLayoutDecisionCount: input.autoLayoutReview.decisionCount,
        autoLayoutNoPlaceholderDecisionCount: input.autoLayoutReview.noPlaceholderDecisionCount,
        autoLayoutQaDiagnosticCount: input.autoLayoutReview.blockers.length + input.autoLayoutReview.warnings.length,
        autoLayoutQaBlockerCount: input.autoLayoutReview.blockers.length,
        autoLayoutQaWarningCount: input.autoLayoutReview.warnings.length,
        manifestReadyCount: manifestItems.filter((item) => sanitizeText(item.status) === 'ready').length,
        manifestBlockedCount: manifestItems.filter((item) => sanitizeText(item.status) === 'blocked').length,
        comboExecutionCount: toCount(input.configuredPlan?.comboExecutionCount),
        noteExecutionCount: toCount(input.configuredPlan?.noteExecutionCount),
        expectedExportCount: toCount(input.exportReadback?.expectedExportCount),
        fileProbeCount: toCount(input.exportReadback?.fileProbeCount),
        okFileProbeCount: toCount(input.exportReadback?.okFileProbeCount),
        failedFileProbeCount: toCount(input.exportReadback?.failedFileProbeCount),
        missingFileProbeCount: toCount(input.exportReadback?.missingFileProbeCount),
        dimensionMismatchCount: toCount(input.exportReadback?.dimensionMismatchCount),
        resultFileNames: normalizeTextList(input.exportReadback?.resultFileNames).slice(0, 30)
    };
}

function buildAutoLayoutReview(input: {
    decisions?: unknown;
    diagnostics?: unknown;
}): SkuVisualReviewAutoLayoutReview {
    const decisions = normalizeRecordList(input.decisions);
    const diagnostics = normalizeTextList(input.diagnostics);
    const enabledDecisions = decisions.filter((decision) => decision.enabled === true);
    const comboDecisionCount = enabledDecisions.filter((decision) => sanitizeText(decision.action) === 'execute').length;
    const noteDecisionCount = enabledDecisions.filter((decision) => sanitizeText(decision.action) === 'arrangeDynamic').length;
    const decisionSources = uniqueStrings(enabledDecisions.map((decision) => sanitizeText(decision.source)));
    const blockers = uniqueStrings(diagnostics.filter(isAutoLayoutBlockingDiagnostic));
    const warnings = uniqueStrings(diagnostics.filter((diagnostic) => !isAutoLayoutBlockingDiagnostic(diagnostic)));
    const noPlaceholderRequired = enabledDecisions.length > 0;
    const status: SkuVisualReviewAutoLayoutReview['status'] = blockers.length > 0
        ? 'blocked_actual_bounds_qa'
        : warnings.length > 0
            ? 'needs_visual_review'
            : noPlaceholderRequired
                ? 'ready_for_visual_review'
                : 'not_used';

    return {
        version: 'sku-auto-layout-visual-review/v0',
        status,
        noPlaceholderRequired,
        decisionCount: decisions.length,
        noPlaceholderDecisionCount: enabledDecisions.length,
        comboDecisionCount,
        noteDecisionCount,
        decisionSources,
        requirements: noPlaceholderRequired ? AUTO_LAYOUT_REQUIREMENTS : [],
        blockers,
        warnings,
        boundaries: {
            usesActualBoundsDiagnostics: true,
            rawPayloadRedacted: true,
            claimsDesignQuality: false
        }
    };
}

function isAutoLayoutBlockingDiagnostic(value: string): boolean {
    const text = sanitizeText(value);
    return /未通过|不能导出|已停止|失败|遮挡|重叠|间距不足|超出安全区|缺少有效实际边界|缺少状态字段|状态为\s*blocked|post-execution QA not ready/i.test(text);
}

function normalizeRecordList(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.map(readRecord).filter(Boolean) as Record<string, unknown>[];
}

function normalizeImageProbeReview(value: unknown): SkuColorCardImageProbeReview | undefined {
    const review = readRecord(value);
    if (!review || sanitizeText(review.version) !== 'sku-color-card-image-probes/v0') return undefined;
    return review as unknown as SkuColorCardImageProbeReview;
}

function buildRetouchReview(value: unknown): SkuVisualReviewRetouchReview | undefined {
    const strategy = readRecord(value);
    if (!strategy) return undefined;
    const strategyVersion = sanitizeText(strategy.version);
    if (strategyVersion !== 'sku-color-card-retouch-strategy/v0') return undefined;

    const shapeStrategy = readRecord(strategy.shapeStrategy);
    const lightStrategy = readRecord(strategy.lightStrategy);
    const shadowStrategy = readRecord(strategy.shadowStrategy);
    const strategyInputPatch = readRecord(strategy.strategyInputPatch);
    const patchRetouch = readRecord(strategyInputPatch?.skuColorCardRetouchStrategy);

    const requirements = uniqueStrings([
        ...mapRetouchRequirementLabels(strategy.reviewRequirements),
        ...mapRetouchRequirementLabels(patchRetouch?.reviewRequirements),
        '核对 SKU 色卡袜口顶部、袜身轴线、后跟位置、脚尖角度和底部基线是否统一。',
        '核对花边罗口、特殊罗口和真实款式差异是否被保留，不能为了统一造成失真。',
        '核对中性灰式光影修正后针织纹理、白袜高光和黑袜暗部细节是否仍然可见。',
        '核对白场处理后阴影层、正片叠底效果、接触阴影方向和边缘灰影是否自然。'
    ]);

    return {
        strategyVersion,
        strategyStatus: sanitizeText(strategy.status) || 'unknown',
        required: true,
        requirements,
        shapeChecks: uniqueStrings([
            ...mapRetouchRequirementLabels(shapeStrategy?.reviewRequirements),
            ...mapRetouchRequirementLabels(shapeStrategy?.unifiedPoseTargets),
            '袜口、袜身、后跟、脚尖和底部基线统一复核'
        ]).slice(0, 12),
        lightChecks: uniqueStrings([
            ...mapRetouchRequirementLabels(lightStrategy?.reviewRequirements),
            ...mapRetouchRequirementLabels(lightStrategy?.methods),
            '白点、体积光、明暗过渡和针织纹理复核'
        ]).slice(0, 12),
        shadowChecks: uniqueStrings([
            ...mapRetouchRequirementLabels(shadowStrategy?.reviewRequirements),
            ...mapRetouchRequirementLabels(shadowStrategy?.methods),
            ...mapRetouchRequirementLabels(shadowStrategy?.whiteFieldPolicy),
            '阴影分离、正片叠底、接触阴影和白底边缘复核'
        ]).slice(0, 12),
        boundaries: uniqueStrings([
            ...normalizeTextList(strategy.limitations),
            '该复核入口只检查色卡精修目标，不执行 Photoshop，也不把策略通过升级为设计质量完成。'
        ]).slice(0, 12)
    };
}

function mapRetouchRequirementLabels(value: unknown): string[] {
    return normalizeTextList(value).map((item) => {
        const label = RETOUCH_REQUIREMENT_LABELS[item] || RETOUCH_REQUIREMENT_LABELS[item.toLowerCase()];
        return label || item
            .replace(/_/g, ' ')
            .replace(/\breview required\b/gi, '复核')
            .trim();
    }).filter(Boolean);
}

const RETOUCH_REQUIREMENT_LABELS: Record<string, string> = {
    shape_consistency_review_required: '复核袜子形态、姿态、比例和基线是否统一。',
    cuff_shape_manual_review_required: '人工复核袜口、罗口、花边和特殊造型是否保真。',
    texture_distortion_review_required: '复核针织纹理没有被拉伸、压扁或涂抹。',
    product_identity_preservation_required: '复核不同颜色仍保持真实商品款式特征。',
    lighting_consistency_review_required: '复核不同颜色之间光影方向、强度和体积感一致。',
    white_point_manual_review_required: '人工复核白场和白点处理没有污染商品颜色。',
    knit_texture_detail_review_required: '复核针织纹理、罗纹结构和深浅色细节仍然可见。',
    dark_light_color_separate_review_required: '复核白袜不过曝、黑袜不死黑、灰色层次清楚。',
    shadow_consistency_review_required: '复核所有袜子的投影方向、位置和强度一致。',
    multiply_blend_shadow_review_required: '复核正片叠底阴影层效果自然且可独立检查。',
    white_background_edge_review_required: '复核白底边缘没有灰边、残影、脏边或背景污染。',
    contact_shadow_position_review_required: '复核接触阴影贴合袜子底部且不漂浮。',
    result_screenshot_or_manual_review_required: '保留结果截图或人工复核记录后再进入质量判断。',
    export_readback_required: '导出读回必须通过后才能进入视觉质量复核。',
    aligned_cuff_top: '袜口顶部对齐。',
    consistent_sock_body_axis: '袜身轴线一致。',
    consistent_heel_turn_position: '后跟转折位置一致。',
    consistent_toe_angle: '脚尖角度一致。',
    consistent_bottom_baseline: '底部基线一致。',
    white_point_reference_review: '白点参考复核。',
    neutral_gray_dodge_burn_review: '中性灰式明暗修正复核。',
    per_color_tone_curve_review: '逐色调曲线复核。',
    highlight_clipping_check: '高光溢出检查。',
    dark_texture_detail_check: '深色纹理细节检查。',
    shadow_layer_isolation_review: '阴影层分离复核。',
    multiply_shadow_layer_review: '正片叠底阴影层复核。',
    shadow_group_b_comparison_review: '阴影组 B 对比复核。',
    edge_halo_cleanup_review: '边缘灰影和光晕清理复核。',
    separate_product_from_shadow_after_white_point: '白场后商品和阴影保持分离。',
    keep_shadow_layer_reviewable_after_background_cleanup: '背景清理后阴影层仍可复核。',
    do_not_erase_contact_shadow_when_exporting_white_background: '导出白底时不能误删接触阴影。',
    do_not_bake_unreviewed_shadow_into_product_layer: '未复核阴影不能直接烘焙进商品层。'
};

function buildReviewSource(input: {
    status: SkuVisualReviewIntakeStatus;
    summary: SkuVisualReviewSummary;
}): HumanReviewSourceViewModel {
    const statusText = input.status === 'human_review_recorded'
        ? 'human_review_recorded'
        : 'ready_for_human_review';
    return {
        kind: 'sku_visual_review',
        stage: statusText,
        summary: `SKU 已导出 ${input.summary.expectedExportCount} 个文件，读回通过 ${input.summary.okFileProbeCount} 个；组合 ${input.summary.comboExecutionCount} 个，自选备注 ${input.summary.noteExecutionCount} 个，等待人工检查视觉质量。`
    };
}

function normalizeHumanReview(
    value: SkuVisualReviewHumanReviewLike | null | undefined,
    generatedAt: string
): SkuVisualReviewHumanReview | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const decision = normalizeDecision(value.decision);
    const reviewer = sanitizeText(value.reviewer);
    const score = normalizeScore(value.score);
    const notes = normalizeTextList(value.notes).slice(0, 8);
    return {
        decision,
        reviewer: reviewer || undefined,
        score,
        notes,
        reviewedAt: sanitizeText(value.reviewedAt) || (decision === 'none' ? undefined : generatedAt)
    };
}

function normalizeDecision(value: unknown): HumanReviewDecision {
    const normalized = sanitizeText(value).toLowerCase();
    if (normalized === 'approved') return 'approved';
    if (normalized === 'needs_review') return 'needs_review';
    if (normalized === 'rejected') return 'rejected';
    return 'none';
}

function normalizeScore(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) return undefined;
    return Math.round(numeric * 1000) / 1000;
}

function getStatusLabel(status: SkuVisualReviewIntakeStatus): string {
    if (status === 'blocked_missing_export_readback') return '缺少导出读回';
    if (status === 'blocked_export_readback') return '导出读回未通过';
    if (status === 'blocked_execution_manifest') return '执行清单未通过';
    if (status === 'blocked_auto_layout_qa') return '自动排版校验未通过';
    if (status === 'human_review_recorded') return '已记录人工复核';
    return '等待人工复核';
}

function normalizeIsoTime(value: unknown): string {
    const text = sanitizeText(value);
    const date = text ? new Date(text) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTextList(value: unknown): string[] {
    const rawValues = Array.isArray(value) ? value : [value];
    return rawValues.map(sanitizeText).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(sanitizeText).filter(Boolean)));
}

function toCount(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function sanitizeText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>]+/gi, '[已移除图片内容]')
        .replace(/\bbase64\b/gi, '[已移除编码内容]')
        .replace(/\brawImage\b/gi, '[已移除图片字段]')
        .replace(/\braw-image-payload\b/gi, '[已移除图片字段]')
        .replace(/\bbase64-image-payload\b/gi, '[已移除编码内容]')
        .replace(/[A-Za-z]:\\[^\s，。；;'"<>]+/g, '[已移除本地路径]')
        .replace(/\s+/g, ' ')
        .trim();
}
