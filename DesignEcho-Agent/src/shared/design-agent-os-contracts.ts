import type { MinimalDesignElement, MinimalDesignRepresentation } from './reference-replication';
import type {
    SmartScalingAssetRole,
    SmartScalingDecision,
    SmartScalingDesignType,
    SmartScalingIntent
} from './design-smart-scaling-policy';
import type {
    DesignKnowledgeQuery,
    DesignKnowledgeResult,
    DesignKnowledgeSearchResponse
} from './design-knowledge-search';

export type DesignAgentOsScenario =
    | 'main-image'
    | 'detail-page'
    | 'sku'
    | 'reference-replication'
    | 'template'
    | 'copywriting'
    | 'general-design'
    | 'unknown';

export type DesignAgentOsAction =
    | 'chat'
    | 'analyze'
    | 'create'
    | 'edit'
    | 'save'
    | 'export'
    | 'verify'
    | 'unknown';

export type DesignAgentOsStatus =
    | 'passed'
    | 'needs_review'
    | 'failed'
    | 'not_run'
    | 'unknown';

export interface DesignAgentSourceRef {
    source: string;
    summary: string;
}

export interface DesignAgentObservation {
    source: string;
    summary: string;
}

export interface DesignIntentContext {
    rawText: string;
    normalizedText: string;
    targetScenario: DesignAgentOsScenario;
    action: DesignAgentOsAction;
    requiresPhotoshop: boolean;
    constraints: string[];
    sourceRefs: DesignAgentSourceRef[];
}

export interface DesignPlanInputs {
    scenario: DesignAgentOsScenario;
    goal: string;
    audience?: string;
    styleDirection?: string;
    outputSpec?: {
        width?: number;
        height?: number;
        format?: string;
    };
    constraints: string[];
    sourceRefs: DesignAgentSourceRef[];
}

export interface DesignAssetObservations {
    source: string;
    assetCount?: number;
    selectedAssetName?: string;
    selectedAssetPath?: string;
    subjectBounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
    risks: string[];
    observations: DesignAgentObservation[];
}

export interface DesignVisualObservations {
    source: string;
    canvas: {
        width: number;
        height: number;
    };
    layoutType: string;
    designIntent?: string;
    elementCount: number;
    nodeKindCounts: Record<string, number>;
    roleCounts: Record<string, number>;
    primaryRoles: string[];
    observations: DesignAgentObservation[];
    limitations: string[];
}

export interface DesignDslRegion {
    id: string;
    kind: string;
    role: string;
    box: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    content?: string;
    styleKeys: string[];
}

export interface DesignDSL {
    dslVersion: 'design-agent-os/v0';
    scenario: DesignAgentOsScenario;
    canvas: {
        width: number;
        height: number;
    };
    layoutType?: string;
    regions: DesignDslRegion[];
    constraints: string[];
    sourceRefs: DesignAgentSourceRef[];
}

export interface ExecutionPlanStep {
    id: string;
    operation: string;
    target: string;
    params: Record<string, unknown>;
    reason?: string;
    expectedOutcomes: string[];
}

export interface ExecutionPlan {
    planId: string;
    scenario: DesignAgentOsScenario;
    status: 'planned' | 'executed' | 'partial' | 'unknown';
    steps: ExecutionPlanStep[];
    inputs: DesignAgentSourceRef[];
    limitations: string[];
}

export interface ExecutionTraceToolCall {
    toolName: string;
    success: boolean;
    summary: string;
}

export interface ExecutionTrace {
    traceId: string;
    scenario: DesignAgentOsScenario;
    toolCallCount: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    toolCalls: ExecutionTraceToolCall[];
}

export interface VerificationCheck {
    id: string;
    label: string;
    status: DesignAgentOsStatus;
    summary: string;
}

export interface VerificationReport {
    reportId: string;
    scenario: DesignAgentOsScenario;
    status: DesignAgentOsStatus;
    scope: 'structure' | 'bounds' | 'screenshot' | 'aesthetic' | 'task';
    summary: string;
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface DesignAgentOsRecord {
    intentContext: DesignIntentContext;
    planInputs: DesignPlanInputs;
    assetObservations?: DesignAssetObservations;
    visualObservations?: DesignVisualObservations;
    designDsl?: DesignDSL;
    executionPlan?: ExecutionPlan;
    executionTrace?: ExecutionTrace;
    verificationReport?: VerificationReport;
}

export interface MainImageSizePlan {
    sizeKey: string;
    targetSize: { width: number; height: number };
    subjectSize: { width: number; height: number };
    scale: number;
    targetX: number;
    targetY: number;
    decisionReason: string;
    layoutCandidateScore?: number;
    layoutCandidateReason?: string;
    smartLayoutPlanned: boolean;
    quickExportPlanned: boolean;
    quickExportOutputPath?: string;
}

export interface DetailPageScreenPlanInput {
    screenId: string;
    role?: string;
    decisionSource?: string;
    requiresModelDecision?: boolean;
    riskCount?: number;
    plannedCopyCount?: number;
    plannedImageCount?: number;
    resultStatus?: string;
}

export interface SkuBatchPlanInput {
    size: number;
    comboCount: number;
    exportedCount?: number;
    noteMode?: boolean;
    noteGenerated?: boolean;
    warnings?: string[];
}

export interface CopywritingCandidate {
    text?: string;
    charCount?: number;
    fitStatus?: 'ok' | 'watch' | 'risk' | string;
    risks?: string[];
}

export interface SmartScalingExecutionRecord {
    designType?: SmartScalingDesignType;
    assetRole?: SmartScalingAssetRole;
    intent?: SmartScalingIntent;
    decision: SmartScalingDecision;
    postTransformBounds?: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
        width?: number;
        height?: number;
    } | null;
}

function clamp01(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function countBy<T extends string>(items: T[]): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
    }, {});
}

function toNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function inferScenario(text: string, fallback: DesignAgentOsScenario = 'unknown'): DesignAgentOsScenario {
    if (/sku|SKU|组合图|双装|三双|颜色组合/.test(text)) return 'sku';
    if (/详情页|长图|卖点屏|详情模板/.test(text)) return 'detail-page';
    if (/主图|白底图|点击图|转化图/.test(text)) return 'main-image';
    if (/参考图|复刻|照着|版式|海报/.test(text)) return 'reference-replication';
    if (/模板|template/i.test(text)) return 'template';
    if (/文案|标题|配文|卖点/.test(text)) return 'copywriting';
    return fallback;
}

function inferAction(text: string): DesignAgentOsAction {
    if (/保存|存成|psd|PSD/.test(text)) return 'save';
    if (/导出|输出|export/i.test(text)) return 'export';
    if (/分析|理解|看看|识别/.test(text)) return 'analyze';
    if (/修改|调整|替换|改成|优化/.test(text)) return 'edit';
    if (/创建|新建|制作|生成|做一/.test(text)) return 'create';
    if (/验收|检查|复核/.test(text)) return 'verify';
    if (/什么模型|是谁|你好|为什么/.test(text)) return 'chat';
    return 'unknown';
}

function requiresPhotoshop(action: DesignAgentOsAction, scenario: DesignAgentOsScenario): boolean {
    if (action === 'chat' || action === 'analyze') return false;
    return scenario !== 'unknown' || action === 'save' || action === 'export' || action === 'edit' || action === 'create';
}

function styleKeysOf(element: MinimalDesignElement): string[] {
    const style = element.style;
    if (!style) return [];
    return Object.entries(style)
        .filter(([, value]) => {
            if (Array.isArray(value)) return value.length > 0;
            return value !== undefined && value !== null && value !== '';
        })
        .map(([key]) => key);
}

function summarizeToolResult(result: unknown): string {
    if (!result || typeof result !== 'object') return String(result || '');
    const value = result as Record<string, unknown>;
    if (typeof value.summaryText === 'string') return value.summaryText;
    if (typeof value.message === 'string') return value.message;
    if (typeof value.error === 'string') return value.error;
    if (typeof value.name === 'string') return value.name;
    return value.success === false ? 'tool returned success=false' : 'tool result recorded';
}

function normalizeTaskStatus(status: unknown): DesignAgentOsStatus {
    const value = String(status || '').toLowerCase();
    if (value === 'passed' || value === 'completed' || value === 'success' || value === 'ok') return 'passed';
    if (value === 'failed' || value === 'error') return 'failed';
    if (value === 'needs_review' || value === 'review' || value === 'warning') return 'needs_review';
    if (value === 'not_applicable' || value === 'not_run' || value === 'skipped') return 'not_run';
    return 'unknown';
}

function statusFromFailureAndReview(failed: boolean, needsReview: boolean): DesignAgentOsStatus {
    if (failed) return 'failed';
    if (needsReview) return 'needs_review';
    return 'passed';
}

function statusFromSmartScalingCropRisk(cropRisk: string): DesignAgentOsStatus {
    if (cropRisk === 'high') return 'failed';
    return 'needs_review';
}

export function buildDesignIntentContextFromText(
    rawText: unknown,
    options: {
        scenario?: DesignAgentOsScenario;
        action?: DesignAgentOsAction;
        constraints?: string[];
    } = {}
): DesignIntentContext {
    const raw = normalizeText(rawText);
    const scenario = options.scenario || inferScenario(raw);
    const action = options.action || inferAction(raw);
    return {
        rawText: raw,
        normalizedText: raw.replace(/\s+/g, ' '),
        targetScenario: scenario,
        action,
        requiresPhotoshop: requiresPhotoshop(action, scenario),
        constraints: Array.isArray(options.constraints) ? options.constraints.filter(Boolean) : [],
        sourceRefs: raw
            ? [{
                source: 'user-input',
                summary: '用户本轮输入。'
            }]
            : []
    };
}

export function buildDesignPlanInputsFromIntent(
    intent: DesignIntentContext,
    options: {
        goal?: string;
        audience?: string;
        styleDirection?: string;
        outputSpec?: DesignPlanInputs['outputSpec'];
        constraints?: string[];
    } = {}
): DesignPlanInputs {
    const constraints = [
        ...intent.constraints,
        ...(Array.isArray(options.constraints) ? options.constraints : [])
    ].filter(Boolean);
    return {
        scenario: intent.targetScenario,
        goal: normalizeText(options.goal) || intent.normalizedText || '未提供明确设计目标。',
        audience: normalizeText(options.audience) || undefined,
        styleDirection: normalizeText(options.styleDirection) || undefined,
        outputSpec: options.outputSpec,
        constraints,
        sourceRefs: intent.sourceRefs.slice()
    };
}

export function buildDesignVisualObservationsFromMinimalRepresentation(
    representation: MinimalDesignRepresentation,
    options: { source?: string; limitations?: string[] } = {}
): DesignVisualObservations {
    const elements = Array.isArray(representation.elements) ? representation.elements : [];
    const nodeKindCounts = countBy(elements.map((element) => element.nodeKind || 'unknown'));
    const roleCounts = countBy(elements.map((element) => element.role || 'unknown'));
    const primaryRoles = elements
        .filter((element) => element.visualWeight === 'primary')
        .map((element) => element.role)
        .filter(Boolean)
        .slice(0, 6);
    return {
        source: options.source || 'minimal-design-representation',
        canvas: {
            width: Math.round(Number(representation.canvas?.width || 0)),
            height: Math.round(Number(representation.canvas?.height || 0))
        },
        layoutType: normalizeText(representation.layout?.layoutType) || 'unknown',
        designIntent: normalizeText(representation.layout?.designIntent) || undefined,
        elementCount: elements.length,
        nodeKindCounts,
        roleCounts,
        primaryRoles,
        observations: options.source
            ? [{
                source: options.source,
                summary: `参考素材的结构化观察，包含 ${elements.length} 个元素。`
            }]
            : [],
        limitations: options.limitations || [
            '该结果来自参考图结构解析，不代表还原原作者 PSD 图层或历史步骤。'
        ]
    };
}

export function buildDesignDslFromMinimalRepresentation(
    representation: MinimalDesignRepresentation,
    options: {
        scenario?: DesignAgentOsScenario;
        constraints?: string[];
        sourceRefs?: DesignAgentSourceRef[];
    } = {}
): DesignDSL {
    const elements = Array.isArray(representation.elements) ? representation.elements : [];
    return {
        dslVersion: 'design-agent-os/v0',
        scenario: options.scenario || 'reference-replication',
        canvas: {
            width: Math.round(Number(representation.canvas?.width || 0)),
            height: Math.round(Number(representation.canvas?.height || 0))
        },
        layoutType: normalizeText(representation.layout?.layoutType) || undefined,
        regions: elements.map((element) => ({
            id: element.id,
            kind: element.nodeKind || 'unknown',
            role: element.role || 'unknown',
            box: {
                x: Number(element.box?.x || 0),
                y: Number(element.box?.y || 0),
                width: Number(element.box?.width || 0),
                height: Number(element.box?.height || 0)
            },
            content: element.content,
            styleKeys: styleKeysOf(element)
        })),
        constraints: options.constraints || [
            '只读 DSL 结构，不直接改变 Photoshop 执行参数。'
        ],
        sourceRefs: Array.isArray(options.sourceRefs) ? options.sourceRefs.slice() : []
    };
}

export function buildExecutionTraceFromToolResults(
    toolResults: Array<{ toolName?: string; result?: unknown }> = [],
    scenario: DesignAgentOsScenario
): ExecutionTrace {
    const toolCalls = toolResults.map((entry, index) => {
        const result = entry?.result as Record<string, unknown> | undefined;
        const success = result?.success !== false;
        return {
            toolName: normalizeText(entry?.toolName) || `tool-${index + 1}`,
            success,
            summary: summarizeToolResult(result)
        };
    });
    const failedToolCalls = toolCalls.filter((call) => !call.success).length;
    const successfulToolCalls = toolCalls.length - failedToolCalls;
    return {
        traceId: `${scenario}-trace`,
        scenario,
        toolCallCount: toolCalls.length,
        successfulToolCalls,
        failedToolCalls,
        toolCalls
    };
}

export function buildVerificationReportFromQa(input: {
    scenario: DesignAgentOsScenario;
    success: boolean;
    qaReport?: {
        summary?: string;
        needsReview?: boolean;
        limitations?: string[];
        visualQa?: { score?: number | null; counts?: { ok?: number; total?: number } };
    } | null;
    completionContract?: {
        status?: string;
        summary?: string;
        blockers?: string[];
        warnings?: string[];
        required?: Array<{ id?: string; label?: string; status?: string; reason?: string }>;
    } | null;
    critique?: { beforeScore?: number; afterScore?: number; delta?: number } | null;
    limitations?: string[];
}): VerificationReport {
    const qa = input.qaReport || null;
    const contract = input.completionContract || null;
    const blockers = Array.isArray(contract?.blockers) ? contract!.blockers.filter(Boolean) : [];
    const warnings = Array.isArray(contract?.warnings) ? contract!.warnings.filter(Boolean) : [];
    const limitations = [
        ...(Array.isArray(qa?.limitations) ? qa!.limitations : []),
        ...(Array.isArray(input.limitations) ? input.limitations : [])
    ].filter(Boolean);
    const failed = !input.success || String(contract?.status || '').toLowerCase() === 'failed' || blockers.length > 0;
    const needsReview = !failed && (qa?.needsReview || limitations.length > 0 || warnings.length > 0 || !contract?.status);
    const status = statusFromFailureAndReview(failed, needsReview);
    const requiredChecks = Array.isArray(contract?.required) ? contract!.required : [];
    const checks: VerificationCheck[] = requiredChecks.map((item, index) => ({
        id: normalizeText(item.id) || `requirement-${index + 1}`,
        label: normalizeText(item.label) || '任务要求',
        status: normalizeTaskStatus(item.status),
        summary: normalizeText(item.reason) || '来自任务 completion contract。'
    }));
    if (qa?.summary) {
        checks.push({
            id: 'qa-summary',
            label: 'QA 摘要',
            status: qa.needsReview ? 'needs_review' : 'passed',
            summary: qa.summary
        });
    }
    if (input.critique) {
        checks.push({
            id: 'critique-summary',
            label: '设计评审摘要',
            status: 'needs_review',
            summary: `评分 ${input.critique.beforeScore ?? '?'} -> ${input.critique.afterScore ?? '?'}，delta=${input.critique.delta ?? '?'}。`
        });
    }
    return {
        reportId: `${input.scenario}-verification`,
        scenario: input.scenario,
        status,
        scope: qa?.visualQa ? 'bounds' : 'structure',
        summary: normalizeText(contract?.summary) || normalizeText(qa?.summary) || (input.success ? '执行结果已记录，仍需按设计质量复核。' : '执行失败。'),
        checks,
        blockers,
        warnings,
        limitations
    };
}

export function buildMainImageExecutionPlan(input: {
    sizePlans: MainImageSizePlan[];
    inputs?: DesignAgentSourceRef[];
}): ExecutionPlan {
    const steps: ExecutionPlanStep[] = [];
    for (const plan of input.sizePlans) {
        steps.push({
            id: `main-image-layout-${plan.sizeKey}`,
            operation: plan.smartLayoutPlanned ? 'smartLayout' : 'transformLayer+moveLayer',
            target: plan.sizeKey,
            params: {
                targetSize: plan.targetSize,
                subjectSize: plan.subjectSize,
                scale: plan.scale,
                targetX: plan.targetX,
                targetY: plan.targetY,
                layoutCandidateScore: plan.layoutCandidateScore
            },
            reason: plan.decisionReason,
            expectedOutcomes: ['tool result', 'layer bounds', 'execution summary']
        });
        if (plan.quickExportPlanned) {
            steps.push({
                id: `main-image-export-${plan.sizeKey}`,
                operation: 'quickExport',
                target: plan.sizeKey,
                params: { targetSize: plan.targetSize },
                reason: '用户提供 outputDir 或执行计划启用导出。',
                expectedOutcomes: ['export tool result']
            });
        }
    }
    return {
        planId: 'main-image-execution-plan',
        scenario: 'main-image',
        status: steps.length > 0 ? 'executed' : 'unknown',
        steps,
        inputs: Array.isArray(input.inputs) ? input.inputs.slice() : [],
        limitations: [
            '该计划记录实际执行依据，不代表审美质量自动通过。'
        ]
    };
}

export function buildDetailPageExecutionPlan(input: {
    screens?: DetailPageScreenPlanInput[];
    screenCount?: number;
    assetCount?: number;
    inputs?: DesignAgentSourceRef[];
}): ExecutionPlan {
    const screens = Array.isArray(input.screens) ? input.screens : [];
    const steps: ExecutionPlanStep[] = screens.map((screen, index) => ({
        id: `detail-page-screen-${screen.screenId || index + 1}`,
        operation: 'fillDetailPageScreen',
        target: screen.screenId || String(index + 1),
        params: {
            role: screen.role,
            plannedCopyCount: screen.plannedCopyCount,
            plannedImageCount: screen.plannedImageCount,
            resultStatus: screen.resultStatus
        },
        reason: screen.role ? `屏幕角色：${screen.role}` : '详情页屏幕填充计划。',
        expectedOutcomes: ['fill result', 'layer bounds', 'copy audit', 'placement audit']
    }));
    return {
        planId: 'detail-page-execution-plan',
        scenario: 'detail-page',
        status: steps.length > 0 ? 'executed' : 'unknown',
        steps,
        inputs: Array.isArray(input.inputs) ? input.inputs.slice() : [],
        limitations: [
            '详情页计划记录屏级输入和预期结果，不代表版式质量或截图级验收通过。'
        ]
    };
}

export function buildSkuExecutionPlan(input: {
    specs?: SkuBatchPlanInput[];
    colorCount?: number;
    totalCombinations?: number;
    inputs?: DesignAgentSourceRef[];
}): ExecutionPlan {
    const specs = Array.isArray(input.specs) ? input.specs : [];
    const steps: ExecutionPlanStep[] = specs.map((spec) => ({
        id: `sku-${spec.size}-pair`,
        operation: spec.noteMode ? 'skuLayoutNote' : 'skuLayout',
        target: `${spec.size}双装`,
        params: {
            size: spec.size,
            comboCount: spec.comboCount,
            exportedCount: spec.exportedCount,
            noteMode: spec.noteMode,
            noteGenerated: spec.noteGenerated
        },
        reason: spec.noteMode ? 'SKU 自选备注输出计划。' : 'SKU 组合图输出计划。',
        expectedOutcomes: ['skuLayout result', 'export result', 'combination summary']
    }));
    return {
        planId: 'sku-execution-plan',
        scenario: 'sku',
        status: steps.length > 0 ? 'executed' : 'unknown',
        steps,
        inputs: Array.isArray(input.inputs) ? input.inputs.slice() : [],
        limitations: [
            'SKU 计划记录组合与导出目标，不替代真实文件检查或颜色图层视觉验收。'
        ]
    };
}

export function buildReferenceReplicationDesignAgentOsRecord(input: {
    userInput?: string;
    representation: MinimalDesignRepresentation;
    qaReport?: Parameters<typeof buildVerificationReportFromQa>[0]['qaReport'];
    completionContract?: Parameters<typeof buildVerificationReportFromQa>[0]['completionContract'];
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
    success: boolean;
    mode?: string;
}): DesignAgentOsRecord {
    const intent = buildDesignIntentContextFromText(input.userInput, {
        scenario: 'reference-replication',
        action: 'create',
        constraints: ['参考图复刻契约只记录运行上下文，不代表高保真完成。']
    });
    const brief = buildDesignPlanInputsFromIntent(intent, {
        goal: input.representation.layout.designIntent || intent.normalizedText,
        constraints: ['从参考图推断可编辑重建方案，不还原原始 PSD。']
    });
    return {
        intentContext: intent,
        planInputs: brief,
        visualObservations: buildDesignVisualObservationsFromMinimalRepresentation(input.representation),
        designDsl: buildDesignDslFromMinimalRepresentation(input.representation, {
            scenario: 'reference-replication',
            sourceRefs: intent.sourceRefs
        }),
        executionTrace: buildExecutionTraceFromToolResults(input.toolResults || [], 'reference-replication'),
        verificationReport: buildVerificationReportFromQa({
            scenario: 'reference-replication',
            success: input.success,
            qaReport: input.qaReport,
            completionContract: input.completionContract,
            limitations: [
                `执行模式：${input.mode || 'unknown'}`,
                '当前运行记录不等于截图级高保真复刻。'
            ]
        })
    };
}

export function buildMainImageDesignAgentOsRecord(input: {
    userInput?: string;
    imageType?: string;
    docInfo?: { width?: number; height?: number; name?: string } | null;
    subjectBounds?: { left?: number; top?: number; right?: number; bottom?: number } | null;
    sizePlans: MainImageSizePlan[];
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
    success: boolean;
    critique?: { beforeScore?: number; afterScore?: number; delta?: number } | null;
}): DesignAgentOsRecord {
    const intent = buildDesignIntentContextFromText(input.userInput, {
        scenario: 'main-image',
        action: 'create',
        constraints: ['主图运行记录不改变当前主图执行参数。']
    });
    const firstSize = input.sizePlans[0]?.targetSize;
    const brief = buildDesignPlanInputsFromIntent(intent, {
        goal: intent.normalizedText || '主图设计',
        outputSpec: firstSize ? { width: firstSize.width, height: firstSize.height } : undefined,
        constraints: input.imageType ? [`imageType=${input.imageType}`] : []
    });
    const subject = input.subjectBounds
        ? {
            left: toNumber(input.subjectBounds.left),
            top: toNumber(input.subjectBounds.top),
            right: toNumber(input.subjectBounds.right),
            bottom: toNumber(input.subjectBounds.bottom),
            width: Math.max(0, toNumber(input.subjectBounds.right) - toNumber(input.subjectBounds.left)),
            height: Math.max(0, toNumber(input.subjectBounds.bottom) - toNumber(input.subjectBounds.top))
        }
        : undefined;
    const photoshopDocumentRefs: DesignAgentSourceRef[] = input.docInfo
        ? [{
            source: normalizeText(input.docInfo.name) || 'photoshop-document',
            summary: `Photoshop 文档读回：画布 ${input.docInfo.width || '?'}x${input.docInfo.height || '?'}。`
        }]
        : [];
    return {
        intentContext: intent,
        planInputs: brief,
        assetObservations: {
            source: 'main-image-subject-bounds',
            selectedAssetName: normalizeText(input.docInfo?.name) || undefined,
            subjectBounds: subject,
            risks: subject ? [] : ['缺少主体 bounds 观察结果。'],
            observations: photoshopDocumentRefs
        },
        executionPlan: buildMainImageExecutionPlan({
            sizePlans: input.sizePlans,
            inputs: photoshopDocumentRefs
        }),
        executionTrace: buildExecutionTraceFromToolResults(input.toolResults || [], 'main-image'),
        verificationReport: buildVerificationReportFromQa({
            scenario: 'main-image',
            success: input.success,
            critique: input.critique,
            limitations: [
                '当前主图运行记录包含缩放和工具结果，不代表审美质量自动通过。',
                '截图级主图验收和人工评分仍需后续闭环。'
            ]
        })
    };
}

export function buildDetailPageDesignAgentOsRecord(input: {
    userInput?: string;
    screenCount?: number;
    assetCount?: number;
    screens?: DetailPageScreenPlanInput[];
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
    success: boolean;
    completionContract?: Parameters<typeof buildVerificationReportFromQa>[0]['completionContract'];
    warnings?: string[];
    blockers?: string[];
}): DesignAgentOsRecord {
    const intent = buildDesignIntentContextFromText(input.userInput, {
        scenario: 'detail-page',
        action: 'create',
        constraints: ['详情页运行记录只读，不改变填充计划或 Photoshop 写入顺序。']
    });
    const brief = buildDesignPlanInputsFromIntent(intent, {
        goal: intent.normalizedText || '详情页设计',
        constraints: [`screenCount=${input.screenCount ?? 'unknown'}`]
    });
    const syntheticContract = input.completionContract || {
        status: input.success ? 'needs_review' : 'failed',
        summary: input.success ? '详情页执行结果已记录，仍需设计质量复核。' : '详情页执行失败或存在阻断。',
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
    return {
        intentContext: intent,
        planInputs: brief,
        assetObservations: {
            source: 'detail-page-assets',
            assetCount: input.assetCount,
            risks: input.assetCount ? [] : ['缺少可确认的详情页素材数量观察。'],
            observations: []
        },
        executionPlan: buildDetailPageExecutionPlan({
            screens: input.screens,
            screenCount: input.screenCount,
            assetCount: input.assetCount,
            inputs: intent.sourceRefs
        }),
        executionTrace: buildExecutionTraceFromToolResults(input.toolResults || [], 'detail-page'),
        verificationReport: buildVerificationReportFromQa({
            scenario: 'detail-page',
            success: input.success,
            completionContract: syntheticContract,
            limitations: [
                '详情页运行记录不等于版式质量、截图级 QA 或完整设计验收。',
                '屏级职责和素材匹配仍需要真实 Photoshop 结果复核。'
            ]
        })
    };
}

export function buildSkuDesignAgentOsRecord(input: {
    userInput?: string;
    colorCount?: number;
    totalCombinations?: number;
    specs?: SkuBatchPlanInput[];
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
    success: boolean;
    warnings?: string[];
    blockers?: string[];
}): DesignAgentOsRecord {
    const intent = buildDesignIntentContextFromText(input.userInput, {
        scenario: 'sku',
        action: 'create',
        constraints: ['SKU 运行记录只读，不改变组合生成和导出逻辑。']
    });
    const brief = buildDesignPlanInputsFromIntent(intent, {
        goal: intent.normalizedText || 'SKU 批量组合图',
        constraints: [`colorCount=${input.colorCount ?? 'unknown'}`, `totalCombinations=${input.totalCombinations ?? 'unknown'}`]
    });
    return {
        intentContext: intent,
        planInputs: brief,
        assetObservations: {
            source: 'sku-color-layers',
            assetCount: input.colorCount,
            risks: input.colorCount ? [] : ['缺少颜色图层数量观察。'],
            observations: []
        },
        executionPlan: buildSkuExecutionPlan({
            specs: input.specs,
            colorCount: input.colorCount,
            totalCombinations: input.totalCombinations,
            inputs: intent.sourceRefs
        }),
        executionTrace: buildExecutionTraceFromToolResults(input.toolResults || [], 'sku'),
        verificationReport: buildVerificationReportFromQa({
            scenario: 'sku',
            success: input.success,
            completionContract: {
                status: input.success && !(input.blockers || []).length ? 'needs_review' : 'failed',
                summary: input.success ? 'SKU 批量处理结果已记录，仍需文件与视觉复核。' : 'SKU 批量处理失败或未产生有效输出。',
                blockers: input.blockers || [],
                warnings: input.warnings || []
            },
            limitations: [
                'SKU 运行记录不替代导出文件存在性、颜色准确性和版式视觉验收。'
            ]
        })
    };
}

function countTextChars(value: unknown): number {
    return normalizeText(value).replace(/[\r\n]/g, '').length;
}

function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(item => normalizeText(item)).filter(Boolean);
    }
    return normalizeText(value)
        .split(/[，,；;\n|]/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeCopywritingCandidates(value: CopywritingCandidate[] | string[] | undefined): CopywritingCandidate[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): CopywritingCandidate => {
            if (typeof item === 'string') {
                return {
                    text: item,
                    charCount: countTextChars(item),
                    fitStatus: 'unknown',
                    risks: []
                };
            }
            return {
                text: normalizeText(item.text) || undefined,
                charCount: typeof item.charCount === 'number' ? item.charCount : countTextChars(item.text),
                fitStatus: item.fitStatus || 'unknown',
                risks: normalizeStringArray(item.risks)
            };
        })
        .filter(item => item.text || typeof item.charCount === 'number');
}

export function buildCopywritingDesignAgentOsRecord(input: {
    userInput?: string;
    originalText?: string;
    layerId?: number | null;
    candidates?: CopywritingCandidate[] | string[];
    success: boolean;
    degraded?: boolean;
    error?: string;
    hasImage?: boolean;
    targetAudience?: string;
    productBrief?: string;
    contentType?: string;
    copyRole?: string;
    lockedKeywords?: string[] | string;
    forbiddenKeywords?: string[] | string;
    goals?: string[] | string;
    missingContext?: string[];
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
}): DesignAgentOsRecord {
    const candidates = normalizeCopywritingCandidates(input.candidates);
    const originalCharCount = countTextChars(input.originalText);
    const missingContext = Array.from(new Set([
        ...normalizeStringArray(input.missingContext),
        input.hasImage ? '' : '缺少图片观察',
        normalizeText(input.targetAudience) ? '' : '缺少目标人群',
        normalizeText(input.productBrief) ? '' : '缺少商品事实或商品简报'
    ].filter(Boolean)));
    const candidateRisks = candidates.flatMap(candidate => normalizeStringArray(candidate.risks));
    const riskCandidateCount = candidates.filter(candidate => candidate.fitStatus === 'risk' || normalizeStringArray(candidate.risks).length > 0).length;
    const intent = buildDesignIntentContextFromText(input.userInput || '撰写文案', {
        scenario: 'copywriting',
        action: 'create',
        constraints: [
            '文案运行记录只读，不改变文本生成或 Photoshop 写入行为。',
            '原文本只作为字数、行数、换行和标点骨架，不作为语义参考。'
        ]
    });
    const brief = buildDesignPlanInputsFromIntent(intent, {
        goal: normalizeText(input.userInput) || '按版式骨架撰写可替换文案',
        audience: normalizeText(input.targetAudience) || undefined,
        styleDirection: normalizeText(input.goals) || undefined,
        constraints: [
            `originalCharCount=${originalCharCount || 'unknown'}`,
            `contentType=${normalizeText(input.contentType) || 'unknown'}`,
            `copyRole=${normalizeText(input.copyRole) || 'unknown'}`,
            normalizeStringArray(input.lockedKeywords).length ? `lockedKeywords=${normalizeStringArray(input.lockedKeywords).join('/')}` : '',
            normalizeStringArray(input.forbiddenKeywords).length ? `forbiddenKeywords=${normalizeStringArray(input.forbiddenKeywords).join('/')}` : ''
        ].filter(Boolean)
    });
    const failed = !input.success || candidates.length === 0;
    const needsReview = !failed && (Boolean(input.degraded) || missingContext.length > 0 || candidateRisks.length > 0 || riskCandidateCount > 0);
    const verificationStatus = statusFromFailureAndReview(failed, needsReview);

    return {
        intentContext: intent,
        planInputs: brief,
        executionPlan: {
            planId: 'copywriting-execution-plan',
            scenario: 'copywriting',
            status: failed ? 'partial' : 'executed',
            steps: [
                {
                    id: 'copywriting-layout-skeleton',
                    operation: 'readTextLayoutSkeleton',
                    target: input.layerId ? `text-layer-${input.layerId}` : 'provided-text',
                    params: {
                        layerId: input.layerId || null,
                        originalCharCount
                    },
                    reason: '只读取版式骨架，避免沿用旧文案语义。',
                    expectedOutcomes: ['original character count', 'line count', 'punctuation skeleton']
                },
                {
                    id: 'copywriting-generate-candidates',
                    operation: 'generateCopywritingCandidates',
                    target: 'copywriting-model',
                    params: {
                        requestedGoals: normalizeStringArray(input.goals),
                        hasImage: Boolean(input.hasImage),
                        targetAudience: normalizeText(input.targetAudience) || null
                    },
                    reason: '按目标人群、商品事实、图片观察和版式约束生成候选。',
                    expectedOutcomes: ['model output', 'candidate list']
                },
                {
                    id: 'copywriting-validate-layout',
                    operation: 'validateTextSkeleton',
                    target: 'candidate-list',
                    params: {
                        candidateCount: candidates.length,
                        riskCandidateCount
                    },
                    reason: '候选必须满足原字数、原行数、每行字数和标点骨架。',
                    expectedOutcomes: ['candidate fit status', 'risk notes']
                }
            ],
            inputs: intent.sourceRefs.slice(),
            limitations: [
                '该计划记录文案生成输入和版式校验目标，不代表已写入 Photoshop。',
                '缺少图片、商品事实或目标人群时，只能生成克制通用表达。'
            ]
        },
        executionTrace: buildExecutionTraceFromToolResults(input.toolResults || [], 'copywriting'),
        verificationReport: {
            reportId: 'copywriting-verification',
            scenario: 'copywriting',
            status: verificationStatus,
            scope: 'task',
            summary: failed
                ? (normalizeText(input.error) || '文案候选生成失败或没有可用候选。')
                : `文案候选已生成 ${candidates.length} 条，仍需按图片事实、商品事实和版式结果复核。`,
            checks: [
                {
                    id: 'copywriting-context',
                    label: '文案上下文完整性',
                    status: missingContext.length ? 'needs_review' : 'passed',
                    summary: missingContext.length ? `缺口：${missingContext.join('；')}` : '已提供基础人群、商品和图片上下文。'
                },
                {
                    id: 'copywriting-layout-fit',
                    label: '版式骨架匹配',
                    status: riskCandidateCount > 0 || candidates.length === 0 ? 'needs_review' : 'passed',
                    summary: `候选 ${candidates.length} 条，风险候选 ${riskCandidateCount} 条。`
                }
            ],
            blockers: failed ? [normalizeText(input.error) || '没有满足版式骨架的文案候选。'] : [],
            warnings: [
                ...missingContext,
                ...candidateRisks.slice(0, 8),
                input.degraded ? '候选数量不足或经过降级处理。' : ''
            ].filter(Boolean),
            limitations: [
                '文案检查结果不替代人工判断语感、图文匹配和品牌调性。',
                '当前文本内容不得作为新文案语义参考，只能作为版式骨架。'
            ]
        }
    };
}

function scenarioFromSmartScalingDesignType(designType: SmartScalingDesignType | undefined): DesignAgentOsScenario {
    if (designType === 'main-image' || designType === 'detail-page' || designType === 'sku' || designType === 'reference-replication') {
        return designType;
    }
    return 'general-design';
}

function normalizePostTransformBounds(bounds: SmartScalingExecutionRecord['postTransformBounds']): DesignAssetObservations['subjectBounds'] | undefined {
    if (!bounds) return undefined;
    const left = toNumber(bounds.left);
    const top = toNumber(bounds.top);
    const width = toNumber(bounds.width, Math.max(0, toNumber(bounds.right) - toNumber(bounds.left)));
    const height = toNumber(bounds.height, Math.max(0, toNumber(bounds.bottom) - toNumber(bounds.top)));
    return {
        left,
        top,
        right: toNumber(bounds.right, left + width),
        bottom: toNumber(bounds.bottom, top + height),
        width,
        height
    };
}

export function buildSmartScalingDesignAgentOsRecord(input: SmartScalingExecutionRecord & {
    userInput?: string;
    success?: boolean;
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
}): DesignAgentOsRecord {
    const scenario = scenarioFromSmartScalingDesignType(input.designType);
    const intent = buildDesignIntentContextFromText(input.userInput || '智能缩放与放置', {
        scenario,
        action: 'edit',
        constraints: ['智能缩放运行记录只读；planned destinationBox 不等于 Photoshop 已执行结果。']
    });
    const postBounds = normalizePostTransformBounds(input.postTransformBounds);
    const cropRisk = input.decision.cropRisk;
    const warnings = [
        ...normalizeStringArray(input.decision.warnings),
        postBounds ? '' : '缺少 Photoshop 执行后的 layer bounds 读回结果。',
        cropRisk !== 'none' ? `裁切风险：${cropRisk}` : ''
    ].filter(Boolean);
    const failed = input.success === false;
    const verificationStatus = statusFromFailureAndReview(failed, true);
    const photoshopBoundsRefs: DesignAgentSourceRef[] = postBounds
        ? [{
            source: 'photoshop-layer-bounds',
            summary: `Photoshop 图层 bounds 读回：left=${postBounds.left}; top=${postBounds.top}; width=${postBounds.width}; height=${postBounds.height}。`
        }]
        : [];

    return {
        intentContext: intent,
        planInputs: buildDesignPlanInputsFromIntent(intent, {
            goal: '将素材缩放并放入目标视觉区域',
            constraints: [
                `designType=${input.designType || 'generic'}`,
                `assetRole=${input.assetRole || 'unknown'}`,
                `intent=${input.intent || 'unknown'}`,
                `cropRisk=${cropRisk}`,
                `subjectVisibleRatio=${input.decision.subjectVisibleRatio.toFixed(2)}`
            ]
        }),
        assetObservations: {
            source: 'smart-scaling-decision',
            subjectBounds: postBounds,
            risks: warnings,
            observations: photoshopBoundsRefs
        },
        executionPlan: {
            planId: 'smart-scaling-execution-plan',
            scenario,
            status: postBounds ? 'executed' : 'planned',
            steps: [{
                id: 'smart-scaling-transform',
                operation: 'transformLayerWithSmartScalingDecision',
                target: 'selected-image-layer-or-placeholder',
                params: {
                    destinationBox: input.decision.destinationBox,
                    subjectDestinationBox: input.decision.subjectDestinationBox,
                    targetBox: input.decision.targetBox,
                    scalePercent: input.decision.scalePercent,
                    cropRisk,
                    fallbackUsed: input.decision.fallbackUsed
                },
                reason: input.decision.reasons.join('；') || '根据目标区域、主体 bounds 和设计意图计算缩放。',
                expectedOutcomes: ['Photoshop transform result', 'post-transform layer bounds', 'visual QA']
            }],
            inputs: photoshopBoundsRefs,
            limitations: [
                '智能缩放只计算几何放置，不保证审美最佳。',
                '没有执行后 bounds 和截图 QA 时，不能宣称缩放已正确完成。'
            ]
        },
        executionTrace: buildExecutionTraceFromToolResults(input.toolResults || [], scenario),
        verificationReport: {
            reportId: 'smart-scaling-verification',
            scenario,
            status: verificationStatus,
            scope: 'bounds',
            summary: failed
                ? '智能缩放执行失败或调用方标记失败。'
                : postBounds
                    ? '已记录智能缩放执行后 bounds，仍需截图级视觉验收。'
                    : '智能缩放仅有计划，缺少 Photoshop 执行后 bounds。',
            checks: [
                {
                    id: 'smart-scaling-subject-visibility',
                    label: '主体可见比例',
                    status: input.decision.subjectVisibleRatio >= 0.6 ? 'needs_review' : 'failed',
                    summary: `subjectVisibleRatio=${input.decision.subjectVisibleRatio.toFixed(2)}。`
                },
                {
                    id: 'smart-scaling-post-bounds',
                    label: '执行后 bounds',
                    status: postBounds ? 'needs_review' : 'failed',
                    summary: postBounds ? '存在执行后 bounds 读回结果。' : '缺少执行后 bounds，不能确认 Photoshop 已完成变换。'
                },
                {
                    id: 'smart-scaling-crop-risk',
                    label: '裁切风险',
                    status: statusFromSmartScalingCropRisk(cropRisk),
                    summary: `cropRisk=${cropRisk}; subjectVisibleRatio=${input.decision.subjectVisibleRatio.toFixed(2)}。`
                }
            ],
            blockers: failed ? ['智能缩放执行失败。'] : [],
            warnings,
            limitations: [
                'planned destinationBox 不是执行结果。',
                'bounds 通过也不代表构图美观或主体视觉大小符合人工审美。'
            ]
        }
    };
}

function scenarioFromKnowledgeResults(query: DesignKnowledgeQuery, results: DesignKnowledgeResult[]): DesignAgentOsScenario {
    const intents = new Set([...(query.intents || []), ...results.map(item => item.intent)]);
    if (intents.has('copywriting')) return 'copywriting';
    if (intents.has('reference') || intents.has('recipe')) return 'reference-replication';
    if (/(主图|main image|main-image)/i.test(query.query)) return 'main-image';
    if (/详情页|detail/i.test(query.query)) return 'detail-page';
    if (/sku|SKU|组合图/.test(query.query)) return 'sku';
    return 'general-design';
}

export function buildKnowledgeSearchDesignAgentOsRecord(input: {
    userInput?: string;
    query: DesignKnowledgeQuery;
    response: DesignKnowledgeSearchResponse;
    success?: boolean;
}): DesignAgentOsRecord {
    const results = Array.isArray(input.response.results) ? input.response.results : [];
    const scenario = scenarioFromKnowledgeResults(input.query, results);
    const invalidDirectAction = results.filter(result => (result.allowedUses as unknown[]).includes('direct_photoshop_action'));
    const intent = buildDesignIntentContextFromText(input.userInput || input.query.query || '检索设计知识', {
        scenario,
        action: 'analyze',
        constraints: ['知识搜索只提供设计上下文和 recipe 线索，不直接执行 Photoshop。']
    });
    const status: DesignAgentOsStatus = input.success === false
        ? 'failed'
        : invalidDirectAction.length > 0
            ? 'failed'
            : results.length > 0
                ? 'needs_review'
                : 'unknown';
    const planInputs = buildDesignPlanInputsFromIntent(intent, {
        goal: normalizeText(input.query.query) || '检索可用于设计任务的上下文知识',
        constraints: [
            `resultCount=${results.length}`,
            `intents=${(input.query.intents || []).join('/') || 'unspecified'}`,
            `sourceTypes=${(input.query.sourceTypes || []).join('/') || 'unspecified'}`
        ]
    });
    planInputs.sourceRefs.push(...results.slice(0, 6).map((result) => ({
        source: result.sourceType,
        summary: `${result.title}: ${result.summary.slice(0, 160)}; sourceLevel=${result.sourceLevel}; sourceRank=${result.sourceRank}`
    })));

    return {
        intentContext: intent,
        planInputs,
        executionPlan: {
            planId: 'design-knowledge-search-plan',
            scenario,
            status: 'executed',
            steps: [{
                id: 'design-knowledge-search',
                operation: 'searchDesignKnowledge',
                target: 'local-design-knowledge',
                params: {
                    query: input.query.query,
                    intents: input.query.intents || [],
                    sourceTypes: input.query.sourceTypes || [],
                    limit: input.query.limit || null
                },
                reason: '为设计任务召回规则、recipe、案例或文案框架上下文。',
                expectedOutcomes: ['knowledge results', 'allowed uses', 'source summaries']
            }],
            inputs: planInputs.sourceRefs.slice(),
            limitations: [
                '知识搜索结果只能进入上下文或 recipe 选择，不能直接当作 Photoshop 操作。',
                '本地知识 MVP 不等于完整 RAG 或多模态知识图谱。'
            ]
        },
        verificationReport: {
            reportId: 'design-knowledge-search-verification',
            scenario,
            status,
            scope: 'task',
            summary: results.length > 0
                ? `设计知识搜索返回 ${results.length} 条结果。`
                : '设计知识搜索没有返回可用结果。',
            checks: [
                {
                    id: 'knowledge-result-count',
                    label: '知识结果数量',
                    status: results.length > 0 ? 'needs_review' : 'unknown',
                    summary: `resultCount=${results.length}。`
                },
                {
                    id: 'knowledge-allowed-uses',
                    label: '知识用途边界',
                    status: invalidDirectAction.length > 0 ? 'failed' : 'passed',
                    summary: invalidDirectAction.length > 0
                        ? '发现不允许的 direct_photoshop_action 用途。'
                        : '知识结果未声明直接 Photoshop 执行用途。'
                }
            ],
            blockers: invalidDirectAction.length > 0 ? ['知识结果用途越界。'] : [],
            warnings: [
                ...normalizeStringArray(input.response.warnings),
                results.length === 0 ? '没有检索到可用知识。' : ''
            ].filter(Boolean),
            limitations: [
                '知识检索结果不证明模型已经理解或正确使用这些知识。',
                '外部网页搜索、引用归一化和多模态检索仍需后续接入。'
            ]
        }
    };
}
