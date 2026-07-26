import type { MainImageSizePlan } from './design-agent-os-contracts';
import type { MainImageAgentDraftPlan } from './main-image-agent-draft-plan';

export type MainImageExecutionAlignmentStatus = 'aligned' | 'watch' | 'blocked';

export interface MainImageExecutionAlignmentCheck {
    id: string;
    label: string;
    status: MainImageExecutionAlignmentStatus;
    summary: string;
    expectedInputs: string[];
    actualResults: string[];
}

export interface MainImageExecutionAlignment {
    alignmentVersion: 'main-image-execution-alignment/v0';
    status: MainImageExecutionAlignmentStatus;
    scenario: 'main-image';
    planStepCount: number;
    dslRegionCount: number;
    toolCallCount: number;
    successfulToolCallCount: number;
    failedToolCallCount: number;
    checks: MainImageExecutionAlignmentCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface MainImageExecutionAlignmentInput {
    agentDraft: MainImageAgentDraftPlan;
    toolResults?: Array<{ toolName?: string; result?: any }>;
    sizePlans?: MainImageSizePlan[];
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizeToolName(value: unknown): string {
    return cleanString(value).replace(/\[.*?\]/g, '').toLowerCase();
}

function isToolSuccess(result: any): boolean {
    if (!result) return false;
    if (result.success === false) return false;
    if (typeof result.error === 'string' && result.error.trim()) return false;
    return result.success === true || Object.keys(result).length > 0;
}

function getToolResults(toolResults: MainImageExecutionAlignmentInput['toolResults']): {
    toolNames: string[];
    successfulToolNames: string[];
    failedToolNames: string[];
} {
    const entries = toolResults || [];
    const toolNames = entries.map((entry) => cleanString(entry?.toolName)).filter(Boolean);
    const successfulToolNames = entries
        .filter((entry) => isToolSuccess(entry?.result))
        .map((entry) => cleanString(entry?.toolName))
        .filter(Boolean);
    const failedToolNames = entries
        .filter((entry) => !isToolSuccess(entry?.result))
        .map((entry) => cleanString(entry?.toolName))
        .filter(Boolean);
    return { toolNames, successfulToolNames, failedToolNames };
}

function hasSuccessfulTool(toolNames: string[], matcher: RegExp): boolean {
    return toolNames.some((toolName) => matcher.test(normalizeToolName(toolName)));
}

function makeCheck(
    id: string,
    label: string,
    status: MainImageExecutionAlignmentStatus,
    summary: string,
    expectedInputs: string[],
    actualResults: string[]
): MainImageExecutionAlignmentCheck {
    return { id, label, status, summary, expectedInputs, actualResults };
}

function combineStatus(checks: MainImageExecutionAlignmentCheck[]): MainImageExecutionAlignmentStatus {
    if (checks.some((check) => check.status === 'blocked')) return 'blocked';
    if (checks.some((check) => check.status === 'watch')) return 'watch';
    return 'aligned';
}

function resolveCoverageStatus(input: {
    plannedCount: number;
    actualCount: number;
    emptyStatus: MainImageExecutionAlignmentStatus;
    partialStatus?: MainImageExecutionAlignmentStatus;
}): MainImageExecutionAlignmentStatus {
    if (input.plannedCount === 0) return input.emptyStatus;
    if (input.actualCount >= input.plannedCount) return 'aligned';
    if (input.actualCount > 0) return input.partialStatus || 'watch';
    return input.partialStatus || 'blocked';
}

function summarizeCoverage(input: {
    plannedCount: number;
    actualCount: number;
    emptySummary: string;
    completeSummary: string;
    partialSummary: string;
}): string {
    if (input.plannedCount === 0) return input.emptySummary;
    if (input.actualCount >= input.plannedCount) return input.completeSummary;
    return input.partialSummary;
}

function resolveCopyExecutionStatus(
    hasCopyStep: boolean,
    expectsCopyWrite: boolean,
    hasTextWrite: boolean
): MainImageExecutionAlignmentStatus {
    if (!hasCopyStep) return 'watch';
    if (!expectsCopyWrite) return 'aligned';
    return hasTextWrite ? 'aligned' : 'watch';
}

function summarizeCopyExecution(
    hasCopyStep: boolean,
    expectsCopyWrite: boolean,
    hasTextWrite: boolean
): string {
    if (!hasCopyStep) return '执行计划没有明确文案槽位步骤。';
    if (!expectsCopyWrite) return '计划选择保留文案槽位，当前没有文本写入不构成阻断。';
    if (hasTextWrite) return '执行结果中包含文本写入工具，可支撑文案槽位计划。';
    return '计划存在候选文案，但当前主图 executor 没有文本写入结果；只能视为文案槽位未落地。';
}

export function buildMainImageExecutionAlignment(input: MainImageExecutionAlignmentInput): MainImageExecutionAlignment {
    const draft = input.agentDraft;
    const sizePlans = input.sizePlans || [];
    const { toolNames, successfulToolNames, failedToolNames } = getToolResults(input.toolResults);
    const checks: MainImageExecutionAlignmentCheck[] = [];

    const hasDocumentInfo = hasSuccessfulTool(successfulToolNames, /^getdocumentinfo$/);
    checks.push(makeCheck(
        'context.document',
        'Photoshop 文档上下文',
        hasDocumentInfo ? 'aligned' : 'blocked',
        hasDocumentInfo
            ? '执行结果中包含 getDocumentInfo，主图计划具备文档上下文。'
            : '主图计划缺少 getDocumentInfo 成功结果，不能确认 Photoshop 文档上下文已读取。',
        ['getDocumentInfo success'],
        successfulToolNames.filter((toolName) => /^getdocumentinfo$/i.test(normalizeToolName(toolName)))
    ));

    const hasSubjectBounds = hasSuccessfulTool(successfulToolNames, /^getsubjectbounds$/)
        || hasSuccessfulTool(successfulToolNames, /^getlayerbounds$/);
    checks.push(makeCheck(
        'subject.bounds',
        '主体 bounds 结果',
        hasSubjectBounds ? 'aligned' : 'blocked',
        hasSubjectBounds
            ? '执行结果中包含主体检测或活动图层 bounds，可支撑缩放落位计划。'
            : '缺少 getSubjectBounds/getLayerBounds 成功结果，不能确认主体大小和位置已被读取。',
        ['getSubjectBounds or getLayerBounds success'],
        successfulToolNames.filter((toolName) => /getsubjectbounds|getlayerbounds/i.test(normalizeToolName(toolName)))
    ));

    const regionIds = new Set((draft.designDsl.regions || []).map((region) => region.id));
    const requiredRegions = ['safe-area', 'hero-subject-slot', 'headline-slot', 'benefit-tag-slot'];
    const missingRegions = requiredRegions.filter((id) => !regionIds.has(id));
    checks.push(makeCheck(
        'dsl.regions',
        '主图 DSL 区域',
        missingRegions.length > 0 ? 'blocked' : 'aligned',
        missingRegions.length > 0
            ? `主图 DSL 缺少区域：${missingRegions.join(', ')}。`
            : '主图 DSL 包含安全区、主视觉槽、标题槽和卖点槽。',
        requiredRegions.map((id) => `DesignDSL region ${id}`),
        Array.from(regionIds)
    ));

    const plannedLayoutCount = sizePlans.length;
    const successfulSmartLayout = successfulToolNames.filter((toolName) => /^smartlayout/i.test(normalizeToolName(toolName))).length;
    const successfulTransform = successfulToolNames.filter((toolName) => /^transformlayer/i.test(normalizeToolName(toolName))).length;
    const successfulMove = successfulToolNames.filter((toolName) => /^movelayer/i.test(normalizeToolName(toolName))).length;
    const layoutResultCount = Math.max(successfulSmartLayout, Math.min(successfulTransform, successfulMove));
    checks.push(makeCheck(
        'layout.execution',
        '主体缩放落位执行',
        resolveCoverageStatus({
            plannedCount: plannedLayoutCount,
            actualCount: layoutResultCount,
            emptyStatus: 'watch'
        }),
        summarizeCoverage({
            plannedCount: plannedLayoutCount,
            actualCount: layoutResultCount,
            emptySummary: '没有尺寸级 sizePlan，无法判断主图缩放落位是否覆盖计划。',
            completeSummary: `已找到 ${layoutResultCount}/${plannedLayoutCount} 个尺寸的布局执行结果。`,
            partialSummary: `只找到 ${layoutResultCount}/${plannedLayoutCount} 个尺寸的布局执行结果。`
        }),
        ['smartLayout success or transformLayer+moveLayer success per size'],
        successfulToolNames.filter((toolName) => /smartlayout|transformlayer|movelayer/i.test(normalizeToolName(toolName)))
    ));

    const plansRequiringExport = sizePlans.filter((plan) => plan.quickExportPlanned);
    const successfulExportCount = successfulToolNames.filter((toolName) => /^quickexport/i.test(normalizeToolName(toolName))).length;
    checks.push(makeCheck(
        'export.execution',
        '主图导出执行',
        resolveCoverageStatus({
            plannedCount: plansRequiringExport.length,
            actualCount: successfulExportCount,
            emptyStatus: 'aligned',
            partialStatus: 'watch'
        }),
        summarizeCoverage({
            plannedCount: plansRequiringExport.length,
            actualCount: successfulExportCount,
            emptySummary: '计划未要求导出，未导出不构成阻断。',
            completeSummary: `已找到 ${successfulExportCount}/${plansRequiringExport.length} 个 quickExport 成功结果。`,
            partialSummary: `计划要求导出 ${plansRequiringExport.length} 个尺寸，但只找到 ${successfulExportCount} 个 quickExport 成功结果。`
        }),
        plansRequiringExport.length > 0 ? ['quickExport success per planned export'] : ['no export required'],
        successfulToolNames.filter((toolName) => /^quickexport/i.test(normalizeToolName(toolName)))
    ));

    const copyStep = (draft.executionPlan.steps || []).find((step) => /fitCopyToTextSlots|reserveCopySlots/i.test(step.operation));
    const expectsCopyWrite = copyStep?.operation === 'fitCopyToTextSlots';
    const hasTextWrite = hasSuccessfulTool(successfulToolNames, /^(createtextlayer|settextcontent|settextstyle)$/);
    checks.push(makeCheck(
        'copy.execution',
        '文案槽位执行',
        resolveCopyExecutionStatus(Boolean(copyStep), expectsCopyWrite, hasTextWrite),
        summarizeCopyExecution(Boolean(copyStep), expectsCopyWrite, hasTextWrite),
        expectsCopyWrite ? ['createTextLayer or setTextContent/setTextStyle success'] : ['reserved copy slots or no copy write expected'],
        successfulToolNames.filter((toolName) => /createtextlayer|settextcontent|settextstyle/i.test(normalizeToolName(toolName)))
    ));

    const visualStage = draft.visualVerification.stage;
    checks.push(makeCheck(
        'verification.visual',
        '截图或人工复核',
        visualStage === 'passed' ? 'aligned' : 'watch',
        visualStage === 'passed'
            ? '视觉验收已经有通过结果。'
            : `视觉验收阶段为 ${visualStage}，工具执行成功不能替代截图或人工复核。`,
        ['result screenshot observation', 'manual review record'],
        [
            `visualVerification.stage=${visualStage}`,
            `visualVerification.status=${draft.visualVerification.status}`
        ]
    ));

    const status = combineStatus(checks);
    const blockers = checks
        .filter((check) => check.status === 'blocked')
        .map((check) => check.summary);
    const warnings = checks
        .filter((check) => check.status === 'watch')
        .map((check) => check.summary);

    return {
        alignmentVersion: 'main-image-execution-alignment/v0',
        status,
        scenario: 'main-image',
        planStepCount: draft.executionPlan.steps.length,
        dslRegionCount: draft.designDsl.regions.length,
        toolCallCount: toolNames.length,
        successfulToolCallCount: successfulToolNames.length,
        failedToolCallCount: failedToolNames.length,
        checks,
        blockers,
        warnings,
        limitations: [
            '该对齐报告只比较 Agent 主图计划、DSL 和 executor 工具结果。',
            '该报告不改变 Photoshop 工具参数、执行顺序或成功判定。',
            'aligned 只表示结果类别覆盖，不代表截图相似、审美质量或主图最终可交付。'
        ]
    };
}
