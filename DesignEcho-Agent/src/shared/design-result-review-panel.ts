import type { AgentRequestLifecycleRecord } from './agent-request-lifecycle';
import type { HumanReviewRecord } from './human-review-record';

export type DesignResultReviewPanelVersion = 'design-result-review-panel/v0';

export type DesignResultReviewScenario =
    | 'main-image'
    | 'detail-page'
    | 'sku';

export type DesignResultReviewDerivedScenario =
    | DesignResultReviewScenario
    | 'general-design';

export type DesignResultReviewStatus =
    | 'not_started'
    | 'needs_review'
    | 'review_recorded'
    | 'blocked';

export interface DesignResultReviewExecutionSummaryLike {
    status?: unknown;
    acceptanceVerified?: unknown;
    acceptanceFailed?: unknown;
    acceptanceNeedsReview?: unknown;
    blockers?: unknown;
    warnings?: unknown;
    summaryText?: unknown;
}

export interface DesignResultReviewDiagnosticRecordLike {
    recordKeys?: unknown;
    payloadRedacted?: unknown;
    [key: string]: unknown;
}

export interface DesignResultReviewMessageLike {
    id?: string;
    role?: string;
    executionSummary?: DesignResultReviewExecutionSummaryLike;
    agentRequestLifecycle?: Partial<AgentRequestLifecycleRecord>;
    agentDiagnosticRecord?: unknown;
}

export interface DesignResultReviewEcommerceSummaryLike {
    totalImages?: unknown;
    totalFolders?: unknown;
    byFolderType?: {
        source?: unknown;
        psd?: unknown;
        mainImage?: unknown;
        detail?: unknown;
        sku?: unknown;
        [key: string]: unknown;
    };
}

export interface BuildDesignResultReviewPanelInput {
    projectName?: unknown;
    isPluginConnected?: boolean;
    ecommerceSummary?: DesignResultReviewEcommerceSummaryLike | null;
    messages?: DesignResultReviewMessageLike[];
    humanReviewRecords?: HumanReviewRecord[];
    generatedAt?: unknown;
}

export interface DesignResultReviewQaSummary {
    verified: number;
    failed: number;
    needsReview: number;
}

export interface DesignResultReviewHumanReviewSummary {
    total: number;
    approved: number;
    needsReview: number;
    rejected: number;
    latestStatusLabel?: string;
    latestRecordedAt?: string;
}

export interface DesignResultReviewDeliverableSummary {
    count: number;
    source: 'project-structure';
}

export interface DesignResultReviewBusinessResultSummary {
    hasRunData: boolean;
    readinessStatuses: string[];
    qaStages: string[];
    plannedStepCount: number;
    toolCallCount: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    verificationCheckCount: number;
    resultImageCount: number;
    fileProbeCount: number;
    okFileProbeCount: number;
    requiredNextChecks: string[];
    blockers: string[];
    warnings: string[];
}

export interface DesignResultReviewScenarioViewModel {
    scenario: DesignResultReviewScenario;
    label: string;
    status: DesignResultReviewStatus;
    statusLabel: string;
    summary: string;
    deliverables: DesignResultReviewDeliverableSummary;
    qa: DesignResultReviewQaSummary;
    businessResult: DesignResultReviewBusinessResultSummary;
    humanReview: DesignResultReviewHumanReviewSummary;
    recordKeys: string[];
    blockers: string[];
    warnings: string[];
    nextActions: string[];
    boundary: string;
    canClaimDesignQuality: false;
    canRunProvider: false;
    canRunAgentRuntime: false;
    canRunPhotoshop: false;
    canRunEagle: false;
}

export interface DesignResultReviewPanelTotals {
    scenarioCount: number;
    deliverableCount: number;
    qaVerified: number;
    qaFailed: number;
    qaNeedsReview: number;
    humanReviewRecords: number;
}

export interface DesignResultReviewPanelViewModel {
    version: DesignResultReviewPanelVersion;
    projectName: string;
    generatedAt: string;
    status: DesignResultReviewStatus;
    statusLabel: string;
    summary: string;
    totals: DesignResultReviewPanelTotals;
    scenarios: DesignResultReviewScenarioViewModel[];
    blockers: string[];
    warnings: string[];
    boundary: string;
    canClaimDesignQuality: false;
    canRunProvider: false;
    canRunAgentRuntime: false;
    canRunPhotoshop: false;
    canRunEagle: false;
}

const BUSINESS_SCENARIOS: readonly DesignResultReviewScenario[] = [
    'main-image',
    'detail-page',
    'sku'
];

const SCENARIO_LABELS: Record<DesignResultReviewScenario, string> = {
    'main-image': '主图',
    'detail-page': '详情页',
    sku: 'SKU'
};

const STATUS_LABELS: Record<DesignResultReviewStatus, string> = {
    not_started: '待开始',
    needs_review: '待复核',
    review_recorded: '已有复核',
    blocked: '存在阻断'
};

export function deriveDesignResultReviewScenario(skillId: unknown): DesignResultReviewDerivedScenario {
    const normalized = sanitizeText(skillId).toLowerCase();
    if (!normalized) return 'general-design';
    if (normalized.includes('main-image') || normalized.includes('mainimage')) return 'main-image';
    if (normalized.includes('detail-page') || normalized.includes('detailpage')) return 'detail-page';
    if (normalized.includes('sku')) return 'sku';
    return 'general-design';
}

export function buildDesignResultReviewPanel(
    input: BuildDesignResultReviewPanelInput
): DesignResultReviewPanelViewModel {
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const humanReviewRecords = Array.isArray(input.humanReviewRecords) ? input.humanReviewRecords : [];
    const scenarios = BUSINESS_SCENARIOS.map((scenario) => buildScenario({
        scenario,
        ecommerceSummary: input.ecommerceSummary,
        messages,
        humanReviewRecords
    }));
    const totals = {
        scenarioCount: scenarios.length,
        deliverableCount: scenarios.reduce((sum, item) => sum + item.deliverables.count, 0),
        qaVerified: scenarios.reduce((sum, item) => sum + item.qa.verified, 0),
        qaFailed: scenarios.reduce((sum, item) => sum + item.qa.failed, 0),
        qaNeedsReview: scenarios.reduce((sum, item) => sum + item.qa.needsReview, 0),
        humanReviewRecords: scenarios.reduce((sum, item) => sum + item.humanReview.total, 0)
    };
    const blockers = uniqueStrings(scenarios.flatMap((item) => item.blockers)).slice(0, 8);
    const warnings = uniqueStrings(scenarios.flatMap((item) => item.warnings)).slice(0, 8);
    const status = derivePanelStatus(scenarios);

    return {
        version: 'design-result-review-panel/v0',
        projectName: sanitizeText(input.projectName) || 'current-project',
        generatedAt: sanitizeIsoTime(input.generatedAt),
        status,
        statusLabel: STATUS_LABELS[status],
        summary: buildPanelSummary({ status, totals, isPluginConnected: input.isPluginConnected === true }),
        totals,
        scenarios,
        blockers,
        warnings,
        boundary: '交付进度只汇总已有执行、交付和人工复核记录；它不调用模型、不触发 Agent、不写 Photoshop，也不替代最终业务验收。',
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunAgentRuntime: false,
        canRunPhotoshop: false,
        canRunEagle: false
    };
}

function buildScenario(input: {
    scenario: DesignResultReviewScenario;
    ecommerceSummary?: DesignResultReviewEcommerceSummaryLike | null;
    messages: DesignResultReviewMessageLike[];
    humanReviewRecords: HumanReviewRecord[];
}): DesignResultReviewScenarioViewModel {
    const relevantMessages = input.messages.filter((message) => messageMatchesScenario(message, input.scenario));
    const recordKeys = uniqueStrings([
        ...relevantMessages.flatMap((message) => getDiagnosticRecordKeys(message.agentDiagnosticRecord)),
        ...(relevantMessages.some((message) => message.executionSummary) ? ['executionSummary'] : []),
        ...(relevantMessages.some((message) => message.agentRequestLifecycle) ? ['agentRequestLifecycle'] : [])
    ]);
    const qa = relevantMessages.reduce<DesignResultReviewQaSummary>((acc, message) => {
        acc.verified += toCount(message.executionSummary?.acceptanceVerified);
        acc.failed += toCount(message.executionSummary?.acceptanceFailed);
        acc.needsReview += toCount(message.executionSummary?.acceptanceNeedsReview);
        return acc;
    }, { verified: 0, failed: 0, needsReview: 0 });
    const humanReview = buildHumanReviewSummary(
        input.humanReviewRecords.filter((record) => record?.scenario === input.scenario)
    );
    const businessResult = buildBusinessResultSummary(
        relevantMessages.map((message) => message.agentDiagnosticRecord)
    );
    const deliverables = {
        count: scenarioDeliverableCount(input.ecommerceSummary, input.scenario),
        source: 'project-structure' as const
    };
    const blockers = uniqueStrings([
        ...relevantMessages.flatMap((message) => normalizeTextList(message.executionSummary?.blockers)),
        ...relevantMessages.flatMap((message) => normalizeTextList(message.agentRequestLifecycle?.blockers)),
        ...businessResult.blockers
    ]);
    const warnings = uniqueStrings([
        ...relevantMessages.flatMap((message) => normalizeTextList(message.executionSummary?.warnings)),
        ...relevantMessages.flatMap((message) => normalizeTextList(message.agentRequestLifecycle?.warnings)),
        ...businessResult.warnings
    ]);
    const status = deriveScenarioStatus({ recordKeys, qa, businessResult, blockers, humanReview });

    return {
        scenario: input.scenario,
        label: SCENARIO_LABELS[input.scenario],
        status,
        statusLabel: STATUS_LABELS[status],
        summary: buildScenarioSummary({
            scenario: input.scenario,
            status,
            deliverables,
            qa,
            humanReview,
            businessResult,
            recordKeys
        }),
        deliverables,
        qa,
        businessResult,
        humanReview,
        recordKeys,
        blockers: blockers.slice(0, 8),
        warnings: warnings.slice(0, 8),
        nextActions: buildScenarioNextActions({ status, scenario: input.scenario, blockers }),
        boundary: '该业务行只展示交付状态；信息不足时保持待复核，不把工具执行、文件数量或人工记录自动升级成设计质量结论。',
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunAgentRuntime: false,
        canRunPhotoshop: false,
        canRunEagle: false
    };
}

function messageMatchesScenario(
    message: DesignResultReviewMessageLike,
    scenario: DesignResultReviewScenario
): boolean {
    const skillScenario = deriveDesignResultReviewScenario(message.agentRequestLifecycle?.decision?.skillId);
    if (skillScenario === scenario) return true;
    return inferScenarioFromDiagnosticRecord(message.agentDiagnosticRecord) === scenario;
}

function inferScenarioFromDiagnosticRecord(
    record: unknown
): DesignResultReviewDerivedScenario {
    if (!isRecord(record)) return 'general-design';
    const keys = getDiagnosticRecordKeys(record);
    const joinedKeys = keys.join(' ').toLowerCase();
    if (joinedKeys.includes('mainimage') || joinedKeys.includes('main-image')) return 'main-image';
    if (joinedKeys.includes('detailpage') || joinedKeys.includes('detail-page')) return 'detail-page';
    if (joinedKeys.includes('sku')) return 'sku';

    const scenario = sanitizeText((record.businessSkillExecutionPlanIntake as { scenario?: unknown } | undefined)?.scenario)
        || sanitizeText((record.businessSkillImagePlacementVerificationIntake as { scenario?: unknown } | undefined)?.scenario);
    return deriveDesignResultReviewScenario(scenario);
}

function getDiagnosticRecordKeys(
    record: unknown
): string[] {
    if (!isRecord(record)) return [];
    const keys = Array.isArray(record.recordKeys)
        ? record.recordKeys.map(sanitizeText)
        : [];
    return uniqueStrings(keys);
}

function buildBusinessResultSummary(
    runRecords: unknown[]
): DesignResultReviewBusinessResultSummary {
    const summary = createEmptyBusinessResultSummary();

    for (const record of runRecords) {
        if (!isRecord(record)) continue;
        mergeMainImageQaReport(summary, record.mainImageQaReport);
        mergeMainImageScreenshotReview(summary, record.mainImageScreenshotQa);
        mergeMainImageScreenshotReview(summary, record.mainImageScreenshotProbeReadiness);
        mergeDetailPageReadiness(summary, record.detailPageSkillReadiness);
        mergeBusinessSkillExecutionPlanIntake(summary, record.businessSkillExecutionPlanIntake);
        mergeBusinessSkillPlacementIntake(summary, record.businessSkillImagePlacementVerificationIntake);
        mergeSkuVisualReviewIntake(summary, record.skuVisualReviewIntake);
        mergeDesignAgentOsRecord(summary, record.designAgentOs);
    }

    summary.hasRunData = Boolean(
        summary.readinessStatuses.length
        || summary.qaStages.length
        || summary.plannedStepCount
        || summary.toolCallCount
        || summary.verificationCheckCount
        || summary.resultImageCount
        || summary.fileProbeCount
        || summary.requiredNextChecks.length
        || summary.blockers.length
        || summary.warnings.length
    );
    summary.readinessStatuses = uniqueStrings(summary.readinessStatuses).slice(0, 8);
    summary.qaStages = uniqueStrings(summary.qaStages).slice(0, 8);
    summary.requiredNextChecks = uniqueStrings(summary.requiredNextChecks).slice(0, 8);
    summary.blockers = uniqueStrings(summary.blockers).slice(0, 8);
    summary.warnings = uniqueStrings(summary.warnings).slice(0, 8);
    return summary;
}

function createEmptyBusinessResultSummary(): DesignResultReviewBusinessResultSummary {
    return {
        hasRunData: false,
        readinessStatuses: [],
        qaStages: [],
        plannedStepCount: 0,
        toolCallCount: 0,
        successfulToolCalls: 0,
        failedToolCalls: 0,
        verificationCheckCount: 0,
        resultImageCount: 0,
        fileProbeCount: 0,
        okFileProbeCount: 0,
        requiredNextChecks: [],
        blockers: [],
        warnings: []
    };
}

function mergeMainImageQaReport(
    summary: DesignResultReviewBusinessResultSummary,
    value: unknown
): void {
    if (!isRecord(value)) return;
    summary.readinessStatuses.push(sanitizeText(value.status));
    summary.qaStages.push(sanitizeText(value.stage));
    const resultImageSummary = readRecord(value.resultImageSummary);
    summary.resultImageCount = Math.max(summary.resultImageCount, toCount(resultImageSummary?.resultImageCount));
    summary.fileProbeCount = Math.max(summary.fileProbeCount, toCount(resultImageSummary?.fileProbeCount));
    summary.okFileProbeCount = Math.max(summary.okFileProbeCount, toCount(resultImageSummary?.okFileProbeCount));
    summary.verificationCheckCount += toArray(value.sections).length + toArray(value.checks).length;
    const qualityClaim = readRecord(value.qualityClaim);
    summary.requiredNextChecks.push(...normalizeTextList(qualityClaim?.requiredChecks));
    summary.requiredNextChecks.push(...normalizeTextList(qualityClaim?.blockers));
    summary.blockers.push(...normalizeTextList(value.blockers));
    summary.warnings.push(...normalizeTextList(value.warnings));
    summary.requiredNextChecks.push(...normalizeTextList(value.nextActions));
}

function mergeMainImageScreenshotReview(
    summary: DesignResultReviewBusinessResultSummary,
    value: unknown
): void {
    if (!isRecord(value)) return;
    summary.qaStages.push(sanitizeText(value.stage));
    const resultImageRecord = readRecord(value.resultImageRecord);
    const resultPaths = toArray(resultImageRecord?.resultPaths);
    summary.resultImageCount = Math.max(
        summary.resultImageCount,
        resultPaths.length,
        toCount(resultImageRecord?.successfulExportCount)
    );
    const resultFileProbes = toArray(value.resultFileProbes).filter(isRecord);
    summary.fileProbeCount = Math.max(summary.fileProbeCount, resultFileProbes.length);
    summary.okFileProbeCount = Math.max(
        summary.okFileProbeCount,
        resultFileProbes.filter((item) => sanitizeText(item.status) === 'ok').length
    );
    summary.requiredNextChecks.push(...normalizeTextList(value.requiredNextChecks));
    summary.blockers.push(...normalizeTextList(value.blockers));
    summary.warnings.push(...normalizeTextList(value.warnings));
}

function mergeDetailPageReadiness(
    summary: DesignResultReviewBusinessResultSummary,
    value: unknown
): void {
    if (!isRecord(value)) return;
    summary.readinessStatuses.push(sanitizeText(value.status));
    summary.requiredNextChecks.push(...normalizeTextList(value.requiredNextChecks));
    summary.blockers.push(...normalizeTextList(value.blockers));
    summary.warnings.push(...normalizeTextList(value.warnings));
}

function mergeBusinessSkillPlacementIntake(
    summary: DesignResultReviewBusinessResultSummary,
    value: unknown
): void {
    if (!isRecord(value)) return;
    summary.readinessStatuses.push(sanitizeText(value.status));
    summary.requiredNextChecks.push(...normalizeTextList(value.requiredNextChecks));
    summary.blockers.push(...normalizeTextList(value.blockers));
    summary.warnings.push(...normalizeTextList(value.warnings));
}

function mergeBusinessSkillExecutionPlanIntake(
    summary: DesignResultReviewBusinessResultSummary,
    value: unknown
): void {
    if (!isRecord(value)) return;
    summary.readinessStatuses.push(sanitizeText(value.status));
    summary.requiredNextChecks.push(...normalizeTextList(value.requiredNextChecks));
    summary.blockers.push(...normalizeTextList(value.blockers));
    summary.warnings.push(...normalizeTextList(value.warnings));
}

function mergeSkuVisualReviewIntake(
    summary: DesignResultReviewBusinessResultSummary,
    value: unknown
): void {
    if (!isRecord(value)) return;
    const reviewSummary = readRecord(value.summary);
    summary.readinessStatuses.push(sanitizeText(value.status));
    summary.fileProbeCount = Math.max(summary.fileProbeCount, toCount(reviewSummary?.fileProbeCount));
    summary.okFileProbeCount = Math.max(summary.okFileProbeCount, toCount(reviewSummary?.okFileProbeCount));
    summary.resultImageCount = Math.max(summary.resultImageCount, toCount(reviewSummary?.expectedExportCount));
    summary.requiredNextChecks.push(...normalizeTextList(value.requirements));
    summary.blockers.push(...normalizeTextList(value.blockers));
    summary.warnings.push(...normalizeTextList(value.warnings));
}

function mergeDesignAgentOsRecord(
    summary: DesignResultReviewBusinessResultSummary,
    value: unknown
): void {
    if (!isRecord(value)) return;
    const executionPlan = readRecord(value.executionPlan);
    const executionTrace = readRecord(value.executionTrace);
    const verificationReport = readRecord(value.verificationReport);

    summary.readinessStatuses.push(sanitizeText(executionPlan?.status));
    summary.readinessStatuses.push(sanitizeText(verificationReport?.status));
    summary.plannedStepCount += toArray(executionPlan?.steps).length;
    summary.toolCallCount += toCount(executionTrace?.toolCallCount);
    summary.successfulToolCalls += toCount(executionTrace?.successfulToolCalls);
    summary.failedToolCalls += toCount(executionTrace?.failedToolCalls);
    summary.verificationCheckCount += toArray(verificationReport?.checks).length;
    summary.blockers.push(...normalizeTextList(verificationReport?.blockers));
    summary.warnings.push(...normalizeTextList(verificationReport?.warnings));
}

function buildHumanReviewSummary(records: HumanReviewRecord[]): DesignResultReviewHumanReviewSummary {
    const normalized = records
        .filter(Boolean)
        .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
    return {
        total: normalized.length,
        approved: normalized.filter((record) => record.status === 'recorded_approved').length,
        needsReview: normalized.filter((record) => record.status === 'recorded_needs_review').length,
        rejected: normalized.filter((record) => record.status === 'recorded_rejected').length,
        latestStatusLabel: sanitizeText(normalized[0]?.statusLabel) || undefined,
        latestRecordedAt: sanitizeText(normalized[0]?.recordedAt) || undefined
    };
}

function scenarioDeliverableCount(
    summary: DesignResultReviewEcommerceSummaryLike | null | undefined,
    scenario: DesignResultReviewScenario
): number {
    if (scenario === 'main-image') return toCount(summary?.byFolderType?.mainImage);
    if (scenario === 'detail-page') return toCount(summary?.byFolderType?.detail);
    return toCount(summary?.byFolderType?.sku);
}

function deriveScenarioStatus(input: {
    recordKeys: string[];
    qa: DesignResultReviewQaSummary;
    businessResult: DesignResultReviewBusinessResultSummary;
    blockers: string[];
    humanReview: DesignResultReviewHumanReviewSummary;
}): DesignResultReviewStatus {
    if (
        input.blockers.length > 0
        || input.businessResult.failedToolCalls > 0
        || input.businessResult.blockers.length > 0
        || input.qa.failed > 0
        || input.humanReview.rejected > 0
    ) {
        return 'blocked';
    }
    if (input.humanReview.total > 0) {
        return 'review_recorded';
    }
    if (
        input.recordKeys.length > 0
        || input.businessResult.hasRunData
        || input.qa.verified > 0
        || input.qa.needsReview > 0
    ) {
        return 'needs_review';
    }
    return 'not_started';
}

function derivePanelStatus(scenarios: DesignResultReviewScenarioViewModel[]): DesignResultReviewStatus {
    if (scenarios.some((item) => item.status === 'blocked')) return 'blocked';
    if (scenarios.some((item) => item.status === 'needs_review')) return 'needs_review';
    if (scenarios.some((item) => item.status === 'review_recorded')) return 'review_recorded';
    return 'not_started';
}

function buildPanelSummary(input: {
    status: DesignResultReviewStatus;
    totals: DesignResultReviewPanelTotals;
    isPluginConnected: boolean;
}): string {
    const plugin = input.isPluginConnected ? 'Photoshop 已连接' : 'Photoshop 未连接';
    if (input.status === 'blocked') {
        return `${plugin}；当前有 ${input.totals.qaFailed} 项失败验收或业务阻断，需要先处理。`;
    }
    if (input.status === 'needs_review') {
        return `${plugin}；当前有 ${input.totals.qaNeedsReview} 项待复核验收，不能直接声明设计完成。`;
    }
    if (input.status === 'review_recorded') {
        return `${plugin}；已记录 ${input.totals.humanReviewRecords} 条人工复核，仍需按业务验收记录收口。`;
    }
    return `${plugin}；还没有可复核的业务执行结果。`;
}

function buildScenarioSummary(input: {
    scenario: DesignResultReviewScenario;
    status: DesignResultReviewStatus;
    deliverables: DesignResultReviewDeliverableSummary;
    qa: DesignResultReviewQaSummary;
    businessResult: DesignResultReviewBusinessResultSummary;
    humanReview: DesignResultReviewHumanReviewSummary;
    recordKeys: string[];
}): string {
    const label = SCENARIO_LABELS[input.scenario];
    if (input.status === 'blocked') {
        return `${label}存在失败验收或人工驳回；交付 ${input.deliverables.count} 项，失败 ${input.qa.failed} 项。`;
    }
    if (input.status === 'review_recorded') {
        return `${label}已有 ${input.humanReview.total} 条人工复核记录；交付 ${input.deliverables.count} 项。`;
    }
    if (input.status === 'needs_review') {
        return `${label}已有执行记录；通过 ${input.qa.verified}，待复核 ${input.qa.needsReview}，工具 ${input.businessResult.toolCallCount} 次。`;
    }
    return `${label}还没有可用于复核的执行或 QA 结果。`;
}

function buildScenarioNextActions(input: {
    status: DesignResultReviewStatus;
    scenario: DesignResultReviewScenario;
    blockers: string[];
}): string[] {
    if (input.status === 'blocked') {
        return input.blockers.length > 0
            ? input.blockers.slice(0, 4)
            : ['先处理失败验收、人工驳回或执行阻断，再重新审查。'];
    }
    if (input.status === 'review_recorded') {
        return ['把本地人工复核记录继续接入对应业务验收记录，避免停留在 UI 台账。'];
    }
    if (input.status === 'needs_review') {
        return ['查看结果图、QA、探针和人工复核输入，再决定是否进入业务验收记录。'];
    }
    return [`先运行或导入 ${SCENARIO_LABELS[input.scenario]} 的执行/QA 结果。`];
}

function toCount(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
}

function normalizeTextList(value: unknown): string[] {
    const rawValues = Array.isArray(value) ? value : [value];
    return rawValues.map(sanitizeText).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(sanitizeText).filter(Boolean)));
}

function toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

function sanitizeIsoTime(value: unknown): string {
    const text = sanitizeText(value);
    if (!text) return new Date().toISOString();
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sanitizeText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>]+/gi, '[已移除图片内容]')
        .replace(/\bbase64\b/gi, '[已移除编码内容]')
        .replace(/\brawImage\b/gi, '[已移除图片字段]')
        .replace(/[A-Za-z]:\\[^\s，。；;'"<>]+/g, '[已移除本地路径]')
        .replace(/\s+/g, ' ')
        .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
