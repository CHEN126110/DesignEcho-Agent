function layoutReplicationToNumber(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

export interface LayoutReplicationCompletionSummary {
    success: boolean;
    heading: string;
    messageLines: string[];
    error?: string;
    userReport?: LayoutReplicationUserReport;
    completionContract?: {
        kind: 'reference_replication';
        status: 'completed' | 'needs_review' | 'failed' | 'cancelled';
        verification: {
            coverage?: {
                expected: number;
                applied: number;
                failed: number;
                skipped: number;
                missingIds?: string[];
            };
            visual?: {
                mode: 'none' | 'screenshot' | 'overlay';
                snapshotCount?: number;
                overlayCount?: number;
                pixelProbe?: {
                    status?: string;
                    mae?: number;
                    rmse?: number;
                    highDeltaRatio?: number;
                    darkJaccard?: number;
                    softDarkJaccard?: number;
                    rawImagesRedacted: true;
                };
            };
        };
        blockers: string[];
        warnings: string[];
        summary: string;
    };
}

export interface LayoutReplicationUserReport {
    kind: 'reference_replication_user_report';
    status: 'completed' | 'needs_review' | 'failed' | 'cancelled';
    title: string;
    verdict: string;
    verificationLines: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    nextActions: string[];
}

type LayoutReplicationCompletionContract = NonNullable<LayoutReplicationCompletionSummary['completionContract']>;

export interface LayoutReplicationCoverageSummary {
    expected: number;
    applied: number;
    failed: number;
    skipped: number;
    missingIds?: string[];
}

function buildCoverageLine(coverage?: LayoutReplicationCoverageSummary): string {
    if (!coverage || coverage.expected <= 0) return '';
    const extras = [
        coverage.failed > 0 ? `失败 ${coverage.failed}` : '',
        coverage.skipped > 0 ? `跳过 ${coverage.skipped}` : ''
    ].filter(Boolean).join('，');
    return `元素覆盖: ${coverage.applied}/${coverage.expected}${extras ? `（${extras}）` : ''}`;
}

function resolveCoverageBlocker(coverage?: LayoutReplicationCoverageSummary): string {
    if (!coverage || coverage.expected <= 0) return '';
    if (coverage.failed > 0) return `存在 ${coverage.failed} 个参考元素执行失败。`;
    return '';
}

function resolveCoverageWarning(coverage?: LayoutReplicationCoverageSummary): string {
    if (!coverage || coverage.expected <= 0) return '';
    if (coverage.applied < coverage.expected) {
        return `参考元素覆盖不完整：${coverage.applied}/${coverage.expected}。`;
    }
    return '';
}

function buildCompletionContract(params: {
    success: boolean;
    coverage?: LayoutReplicationCoverageSummary;
    visualQa?: {
        snapshotObservation?: {
            source?: string;
            snapshotCount?: number;
            overlayCount?: number;
            pixelProbe?: {
                status?: string;
                mae?: number;
                rmse?: number;
                highDeltaRatio?: number;
                darkJaccard?: number;
                softDarkJaccard?: number;
                rawImagesRedacted?: true;
            };
        };
    } | null;
    blockers: string[];
    warnings: string[];
    summaryPrefix: string;
}): LayoutReplicationCompletionContract {
    const visualMode = params.visualQa?.snapshotObservation?.source === 'getScreenSnapshotsWithOverlay'
        ? 'overlay'
        : Number(params.visualQa?.snapshotObservation?.snapshotCount || 0) > 0
            ? 'screenshot'
            : 'none';
    const status = params.blockers.length > 0
        ? 'failed'
        : params.success && params.warnings.length === 0
            ? 'completed'
            : 'needs_review';

    return {
        kind: 'reference_replication',
        status,
        verification: {
            coverage: params.coverage,
            visual: {
                mode: visualMode,
                snapshotCount: Number(params.visualQa?.snapshotObservation?.snapshotCount || 0),
                overlayCount: Number(params.visualQa?.snapshotObservation?.overlayCount || 0),
                pixelProbe: params.visualQa?.snapshotObservation?.pixelProbe ? {
                    status: params.visualQa.snapshotObservation.pixelProbe.status,
                    mae: params.visualQa.snapshotObservation.pixelProbe.mae,
                    rmse: params.visualQa.snapshotObservation.pixelProbe.rmse,
                    highDeltaRatio: params.visualQa.snapshotObservation.pixelProbe.highDeltaRatio,
                    darkJaccard: params.visualQa.snapshotObservation.pixelProbe.darkJaccard,
                    softDarkJaccard: params.visualQa.snapshotObservation.pixelProbe.softDarkJaccard,
                    rawImagesRedacted: true
                } : undefined
            }
        },
        blockers: params.blockers,
        warnings: params.warnings,
        summary: `${params.summaryPrefix}: ${status === 'completed' ? '已完成' : status === 'failed' ? '未完成' : '需复核'}`
    };
}

function buildLayoutReplicationUserReport(
    contract: LayoutReplicationCompletionContract,
    messageLines: string[]
): LayoutReplicationUserReport {
    const status = contract.status;
    const visual = contract.verification.visual;
    const pixelProbe = visual?.pixelProbe;
    const coverage = contract.verification.coverage;
    const verificationLines = sanitizeLayoutReplicationUserLines([
        coverage && coverage.expected > 0
            ? `元素覆盖: ${coverage.applied}/${coverage.expected}`
                + (coverage.failed > 0 ? `，失败 ${coverage.failed}` : '')
                + (coverage.skipped > 0 ? `，跳过 ${coverage.skipped}` : '')
            : '',
        visual
            ? `视觉检查: ${visual.mode === 'overlay' ? '叠加截图标注' : visual.mode === 'screenshot' ? '截图检查' : '未采集截图'}`
                + (Number(visual.snapshotCount || 0) > 0 ? `，截图 ${visual.snapshotCount} 张` : '')
                + (Number(visual.overlayCount || 0) > 0 ? `，标注 ${visual.overlayCount} 项` : '')
            : '',
        pixelProbe
            ? `截图像素检查: ${pixelProbe.status || 'unknown'}`
                + (typeof pixelProbe.mae === 'number' ? `，MAE ${pixelProbe.mae}` : '')
                + (typeof pixelProbe.darkJaccard === 'number' ? `，暗部 Jaccard ${pixelProbe.darkJaccard}` : '')
                + '（检查项，不等于审美验收通过）'
            : '',
        ...messageLines.filter(line =>
            line.startsWith('样式 recipe:')
            || line.startsWith('QA:')
            || line.startsWith('自动填充:')
        )
    ].filter(Boolean));

    const limitations = [
        '当前报告只整合结构、位置框、截图标注和像素检查结果，不证明整体审美质量。',
        pixelProbe && pixelProbe.status && pixelProbe.status !== 'ok'
            ? `像素检查为 ${pixelProbe.status}，只能作为观察项，不能作为高保真通过结论。`
            : '',
        visual?.mode === 'none'
            ? '当前没有截图级检查结果，只能依据结构和图层数据判断。'
            : ''
    ].filter(Boolean);

    const nextActions = contract.blockers.length > 0
        ? [
            '先处理阻断项，再重新执行参考图复刻或 QA。',
            '回到 Photoshop 检查失败图层、缺失元素、位置框或截图结果。'
        ]
        : contract.warnings.length > 0
            ? [
                '人工复核观察项后再决定是否接受结果。',
                '需要更严格验收时，补充截图级检查或更多参考样本。'
            ]
            : [
                '可继续进行人工视觉验收或扩展到更复杂参考图样本。',
                '不要把当前通过外推为通用高保真复刻能力。'
            ];

    return {
        kind: 'reference_replication_user_report',
        status,
        title: status === 'completed'
            ? '参考图复刻基础验收通过'
            : status === 'failed'
                ? '参考图复刻未完成'
                : '参考图复刻需复核',
        verdict: status === 'completed'
            ? '已生成可编辑结果，并通过当前结构和截图检查；仍需要人工确认审美和像素质量。'
            : status === 'failed'
                ? '执行未达到完成条件，存在阻断项，不能把当前结果视为完成。'
                : '已生成部分结果或检查信息，但存在观察项或信息不足，不能判定为高保真复刻。',
        verificationLines,
        blockers: sanitizeLayoutReplicationUserLines(contract.blockers),
        warnings: sanitizeLayoutReplicationUserLines(contract.warnings),
        limitations: sanitizeLayoutReplicationUserLines(limitations),
        nextActions: sanitizeLayoutReplicationUserLines(nextActions)
    };
}

function sanitizeLayoutReplicationUserLines(lines: string[]): string[] {
    return lines.map(sanitizeLayoutReplicationUserCopy).filter(Boolean);
}

function sanitizeLayoutReplicationUserCopy(line: string): string {
    return String(line || '')
        .replace(/\bbounds\b/gi, '位置框')
        .replace(/\boverlay\b/gi, '叠加标注')
        .replace(/\bpixel-probe\b/gi, '像素检查')
        .replace(/\bbenchmark case\b/gi, '参考样本')
        .replace(/只能作为\s*位置框\s*级几何验收/g, '只能作为位置和结构检查参考')
        .trim();
}

export function formatLayoutReplicationUserReport(
    report: LayoutReplicationUserReport | undefined,
    fallbackLines: string[] = []
): string {
    if (!report) return fallbackLines.filter(Boolean).join('\n');
    const lines = [
        report.title,
        '',
        `结论: ${report.verdict}`,
        '',
        report.verificationLines.length > 0 ? '检查结果:' : '',
        ...report.verificationLines.map(line => `- ${line}`),
        report.blockers.length > 0 ? '' : '',
        report.blockers.length > 0 ? '阻断项:' : '',
        ...report.blockers.map(line => `- ${line}`),
        report.warnings.length > 0 ? '' : '',
        report.warnings.length > 0 ? '提醒:' : '',
        ...report.warnings.map(line => `- ${line}`),
        report.limitations.length > 0 ? '' : '',
        report.limitations.length > 0 ? '说明:' : '',
        ...report.limitations.map(line => `- ${line}`),
        report.nextActions.length > 0 ? '' : '',
        report.nextActions.length > 0 ? '下一步:' : '',
        ...report.nextActions.map(line => `- ${line}`)
    ];
    return lines.filter(line => line !== '').join('\n');
}

export function summarizeTemplateApplyCompletion(params: {
    headingSuccess: string;
    headingReview: string;
    baseSuccess: boolean;
    screenCount: number;
    createdLayers: number;
    rootGroupName?: string;
    failedOps?: number;
    designIntent?: string;
    qaSummary: string;
    styleRecipeStats?: {
        attempted?: number;
        applied?: number;
        failed?: number;
        skipped?: number;
    };
    coverage?: LayoutReplicationCoverageSummary;
    autoFill?: {
        success: boolean;
        filledScreens: number;
        filledImages: number;
        guardedScreens: number;
        failedScreens: number;
    } | null;
    visualQa?: {
        summary?: string;
        snapshotObservation?: {
            source?: string;
            snapshotCount?: number;
            overlayCount?: number;
            pixelProbe?: {
                status?: string;
                mae?: number;
                rmse?: number;
                highDeltaRatio?: number;
                darkJaccard?: number;
                softDarkJaccard?: number;
                rawImagesRedacted?: true;
            };
        };
        verificationReport?: {
            blockers?: string[];
            warnings?: string[];
        };
    } | null;
}): LayoutReplicationCompletionSummary {
    const failedOps = Math.max(0, Math.round(layoutReplicationToNumber(params.failedOps, 0)));
    const autoFillFailed = params.autoFill
        ? !params.autoFill.success || params.autoFill.failedScreens > 0
        : false;
    const visualBlocker = Array.isArray(params.visualQa?.verificationReport?.blockers)
        ? params.visualQa!.verificationReport!.blockers![0]
        : '';
    const visualWarning = !visualBlocker && Array.isArray(params.visualQa?.verificationReport?.warnings)
        ? params.visualQa!.verificationReport!.warnings![0]
        : '';
    const coverageBlocker = resolveCoverageBlocker(params.coverage);
    const coverageWarning = resolveCoverageWarning(params.coverage);
    const success = params.baseSuccess === true && failedOps === 0 && !autoFillFailed && !visualBlocker && !coverageBlocker && !coverageWarning;
    const heading = success ? params.headingSuccess : params.headingReview;
    const blockers = [
        visualBlocker,
        coverageBlocker,
        failedOps > 0 ? `存在 ${failedOps} 个失败/跳过操作。` : '',
        autoFillFailed ? '自动填充存在失败版面单元。' : ''
    ].filter(Boolean);
    const warnings = [
        visualWarning,
        coverageWarning
    ].filter(Boolean);
    const messageLines = [
        heading,
        `版面单元: ${params.screenCount}`,
        `创建图层: ${params.createdLayers}`,
        params.rootGroupName ? `根分组: ${params.rootGroupName}` : '',
        params.designIntent ? `设计意图: ${params.designIntent}` : '',
        failedOps > 0 ? `失败/跳过操作: ${failedOps}` : '',
        params.styleRecipeStats && Number(params.styleRecipeStats.attempted || 0) > 0
            ? `样式 recipe: ${Number(params.styleRecipeStats.applied || 0)}/${Number(params.styleRecipeStats.attempted || 0)} 执行成功`
            : '',
        buildCoverageLine(params.coverage),
        params.autoFill ? `自动填充: ${params.autoFill.filledScreens} 个版面单元成功, ${params.autoFill.filledImages} 张图片` : '',
        params.autoFill && params.autoFill.guardedScreens > 0 ? `保护策略: ${params.autoFill.guardedScreens} 个版面单元` : '',
        params.autoFill && params.autoFill.failedScreens > 0 ? `自动填充失败: ${params.autoFill.failedScreens} 个版面单元` : '',
        params.visualQa?.snapshotObservation?.source === 'getScreenSnapshotsWithOverlay'
            ? `Overlay 检查: ${Number(params.visualQa.snapshotObservation.snapshotCount || 0)} 张截图，${Number(params.visualQa.snapshotObservation.overlayCount || 0)} 项标注`
            : '',
        params.visualQa?.snapshotObservation?.pixelProbe
            ? `截图探针: ${params.visualQa.snapshotObservation.pixelProbe.status || 'unknown'}`
                + (typeof params.visualQa.snapshotObservation.pixelProbe.mae === 'number' ? `，MAE ${params.visualQa.snapshotObservation.pixelProbe.mae}` : '')
                + (typeof params.visualQa.snapshotObservation.pixelProbe.darkJaccard === 'number' ? `，暗部 Jaccard ${params.visualQa.snapshotObservation.pixelProbe.darkJaccard}` : '')
                + (typeof params.visualQa.snapshotObservation.pixelProbe.softDarkJaccard === 'number' ? `，软暗部 Jaccard ${params.visualQa.snapshotObservation.pixelProbe.softDarkJaccard}` : '')
            : '',
        visualBlocker ? `视觉验收阻断: ${visualBlocker}` : '',
        visualWarning ? `视觉验收提醒: ${visualWarning}` : '',
        `QA: ${params.qaSummary}`
    ].filter(Boolean);
    const completionContract = buildCompletionContract({
        success,
        coverage: params.coverage,
        visualQa: params.visualQa,
        blockers,
        warnings,
        summaryPrefix: '参考图模板骨架完成契约'
    });
    return {
        success,
        heading,
        messageLines,
        userReport: buildLayoutReplicationUserReport(completionContract, messageLines),
        completionContract
    };
}

export function summarizeLayoutMatchCompletion(params: {
    hasExecutableMatches: boolean;
    referenceElementCount: number;
    layoutType?: string;
    successCount?: number;
    failCount?: number;
    coverage?: LayoutReplicationCoverageSummary;
    matchSummary?: string;
    qaSummary?: string;
}): LayoutReplicationCompletionSummary {
    if (!params.hasExecutableMatches) {
        const heading = '布局分析完成，但没有生成可执行匹配。';
        const completionContract = buildCompletionContract({
            success: false,
            blockers: ['没有生成可执行匹配动作。'],
            warnings: [],
            summaryPrefix: '参考图布局匹配完成契约'
        });
        const messageLines = [
            heading,
            `参考布局类型: ${params.layoutType || 'unknown'}`,
            '建议先统一图层命名、补充可编辑元素或改用“生成可编辑骨架”。'
        ];
        return {
            success: false,
            heading,
            error: 'No executable layout matches',
            messageLines,
            userReport: buildLayoutReplicationUserReport(completionContract, messageLines),
            completionContract
        };
    }

    const successCount = Math.max(0, Math.round(layoutReplicationToNumber(params.successCount, 0)));
    const failCount = Math.max(0, Math.round(layoutReplicationToNumber(params.failCount, 0)));
    const coverageBlocker = resolveCoverageBlocker(params.coverage);
    const coverageWarning = resolveCoverageWarning(params.coverage);
    const success = successCount > 0 && failCount === 0 && !coverageBlocker && !coverageWarning;
    const heading = success
        ? '布局复刻已执行'
        : successCount > 0
            ? '布局复刻部分执行，需复核'
            : '布局复刻未执行成功';
    const blockers = [
        failCount > 0 ? `存在 ${failCount} 个布局匹配动作失败。` : '',
        coverageBlocker
    ].filter(Boolean);
    const warnings = [
        coverageWarning
    ].filter(Boolean);
    const messageLines = [
        heading,
        `参考元素: ${params.referenceElementCount}`,
        `成功调整: ${successCount}`,
        failCount > 0 ? `失败/跳过: ${failCount}` : '',
        buildCoverageLine(params.coverage),
        params.matchSummary || '',
        params.qaSummary ? `QA: ${params.qaSummary}` : ''
    ].filter(Boolean);
    const completionContract = buildCompletionContract({
        success,
        coverage: params.coverage,
        blockers,
        warnings,
        summaryPrefix: '参考图布局匹配完成契约'
    });
    return {
        success,
        heading,
        messageLines,
        userReport: buildLayoutReplicationUserReport(completionContract, messageLines),
        completionContract
    };
}
