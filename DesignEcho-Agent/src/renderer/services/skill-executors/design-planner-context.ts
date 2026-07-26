import type { MinimalDesignRepresentation } from '../../../shared/reference-replication';
import type { MainImageSizePlan } from '../../../shared/design-agent-os-contracts';
import type { DesignKnowledgeResult } from '../../../shared/design-knowledge-search';
import { selectDesignKnowledgeResultsForUse } from '../../../shared/design-knowledge-governance';
import {
    buildDesignPlacementIntelligencePlan,
    type DesignPlacementIntelligencePlan,
    type DesignPlacementTargetInput
} from '../../../shared/design-placement-intelligence';
import type { EagleVisualCaseIndex } from '../../../shared/eagle-visual-case-index';
import type {
    ImagePlacementBox,
    ImagePlacementExecutionTool
} from '../../../shared/design-image-placement-core';
import type { ProjectVisualSamplingScenario } from '../../../shared/project-visual-sampling';
import {
    buildPlannerExecutionPreflightGate as buildPlannerExecutionPreflightGateFromOutput,
    mapPlannerOutputToDesignAgentOsRecord,
    planDesignTask,
    type DesignPlannerExecutionPreflightGate,
    type DesignPlannerExecutionPreflightGateOptions
} from '../../../shared/design-planner';
import {
    buildDesignIntelligencePlan,
    type DesignIntelligenceAgentDecision,
    type DesignIntelligencePlan
} from '../../../shared/design-intelligence-plan';
import {
    buildMainImageAgentDraftPlan,
    type MainImageAgentDraftPlan
} from '../../../shared/main-image-agent-draft-plan';
import type { MainImageStrategyInputKey } from '../../../shared/main-image-strategy-contract';
import type { MainImageVisionSignal } from '../../../shared/main-image-visual-loop';
import {
    buildMainImageMemoryContext,
    type MainImageMemoryContext
} from '../../../shared/main-image-memory-context';
import {
    buildBusinessSkillMemoryContext,
    type BusinessSkillMemoryContext,
    type BusinessSkillMemoryScenario
} from '../../../shared/business-skill-memory-context';
import {
    buildBusinessSkillMemoryStrategy,
    type BusinessSkillMemoryStrategy
} from '../../../shared/business-skill-memory-strategy';
import {
    buildEcommerceSocksChildStrategyInput,
    resolveEcommerceSocksChildStrategyHandoff,
    type EcommerceSocksChildStrategyInput
} from '../../../shared/ecommerce-socks-child-strategy-consumer';
import {
    buildSkuColorCardRetouchStrategy,
    type SkuColorCardRetouchStrategy
} from '../../../shared/sku-color-card-retouch-strategy';
import type { EcommerceSocksChildStrategyHandoff } from '../../../shared/ecommerce-socks-child-strategy-handoff';
import { resolveAgentProjectMemoryScope } from '../agent-orchestration/types';
import type { SkillExecuteParams } from './types';
import { getMemoryService } from '../memory.service';

type PlannerContextResult = ReturnType<typeof buildPlannerContext>;
type MainImagePlannerContextResult = PlannerContextResult & {
    mainImageAgentDraft: MainImageAgentDraftPlan;
    mainImageDesignPlacementIntelligence: DesignPlacementIntelligencePlan;
    ecommerceSocksChildStrategyInput: EcommerceSocksChildStrategyInput;
};
type BusinessSkillPlannerContextResult = PlannerContextResult & {
    businessSkillMemoryContext: BusinessSkillMemoryContext;
    businessSkillMemoryStrategy: BusinessSkillMemoryStrategy;
    businessSkillDesignPlacementIntelligence: DesignPlacementIntelligencePlan;
    ecommerceSocksChildStrategyInput: EcommerceSocksChildStrategyInput;
};
type DetailPagePlannerContextResult = BusinessSkillPlannerContextResult & {
    detailPageMemoryStrategy: BusinessSkillMemoryStrategy;
    detailPageDesignPlacementIntelligence: DesignPlacementIntelligencePlan;
};
type SkuBatchPlannerContextResult = BusinessSkillPlannerContextResult & {
    skuMemoryStrategy: BusinessSkillMemoryStrategy;
    skuDesignPlacementIntelligence: DesignPlacementIntelligencePlan;
    skuColorCardRetouchStrategy: SkuColorCardRetouchStrategy;
};
export type PlannerExecutionPlanAlignmentStatus = 'aligned' | 'watch' | 'blocked';

export interface PlannerExecutionPlanAlignment {
    status: PlannerExecutionPlanAlignmentStatus;
    plannedOperations: string[];
    executorOperations: string[];
    matchedCategories: string[];
    missingCategories: string[];
    warnings: string[];
    limitations: string[];
}

function toNumber(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function buildPlannerCurrentDocumentFromToolResult(docInfo: any) {
    if (!docInfo?.success) return null;
    const width = toNumber(docInfo.width ?? docInfo.canvasWidth ?? docInfo.size?.width, 0);
    const height = toNumber(docInfo.height ?? docInfo.canvasHeight ?? docInfo.size?.height, 0);
    return {
        id: docInfo.id ?? docInfo.documentId ?? undefined,
        name: docInfo.name ?? docInfo.documentName ?? undefined,
        width: width > 0 ? Math.round(width) : undefined,
        height: height > 0 ? Math.round(height) : undefined,
        path: docInfo.path ?? docInfo.filePath ?? undefined,
        hasUnsavedChanges: typeof docInfo.hasUnsavedChanges === 'boolean' ? docInfo.hasUnsavedChanges : undefined
    };
}

export function buildPlannerCurrentDocumentFromContext(context?: SkillExecuteParams['context']) {
    const doc = context?.photoshopContext;
    if (!doc?.hasDocument) return null;
    return {
        name: doc.documentName,
        width: doc.canvasSize?.width,
        height: doc.canvasSize?.height
    };
}

function buildProjectAssetsFromContext(context?: SkillExecuteParams['context']) {
    const projectContext = context?.projectContext;
    const selectedProjectImagePath = cleanString(projectContext?.selectedProjectImagePath);
    return [
        ...(projectContext?.sampleImagePaths || []),
        projectContext?.selectedProjectImagePath
    ].filter(Boolean).slice(0, 12).map((assetPath) => ({
        path: String(assetPath),
        name: String(assetPath).split(/[\\/]/).pop(),
        role: selectedProjectImagePath && String(assetPath) === selectedProjectImagePath
            ? 'selected-project-image'
            : 'project-image',
        source: selectedProjectImagePath && String(assetPath) === selectedProjectImagePath
            ? 'selected-project-image'
            : 'project-asset'
    }));
}

function buildReferenceHintsFromParams(params: Record<string, any>) {
    return Array.isArray(params.referenceHints) ? params.referenceHints : [];
}

function buildKnowledgeResultsFromParams(params: Record<string, any>) {
    return Array.isArray(params.knowledgeResults) ? params.knowledgeResults : [];
}

function extractDesignPlacementVisualCaseIndex(params: Record<string, any>): EagleVisualCaseIndex | null {
    const candidates = [
        params.eagleVisualCaseIndex,
        params.visualCaseIndex,
        params.designPlacementVisualCaseIndex,
        params.detailPageVisualCaseIndex,
        params.skuVisualCaseIndex,
        isRecord(params.designPlacementIntelligence) ? params.designPlacementIntelligence.visualCaseIndex : null
    ];
    return candidates.find((item) => isRecord(item) && Array.isArray(item.cases)) as EagleVisualCaseIndex | null || null;
}

export function extractEcommerceSocksChildStrategyHandoffFromContext(input: {
    params?: Record<string, any>;
    context?: SkillExecuteParams['context'];
}): EcommerceSocksChildStrategyHandoff | null {
    const params = input.params || {};
    const projectContext = input.context?.projectContext as Record<string, unknown> | undefined;
    const candidates = [
        params.ecommerceSocksChildStrategyHandoff,
        params.childStrategyHandoff,
        isRecord(params.ecommerceSocksDesign) ? params.ecommerceSocksDesign.childStrategyHandoff : null,
        projectContext?.ecommerceSocksChildStrategyHandoff,
        isRecord(projectContext?.ecommerceSocksDesign) ? projectContext?.ecommerceSocksDesign.childStrategyHandoff : null
    ];
    for (const candidate of candidates) {
        const handoff = resolveEcommerceSocksChildStrategyHandoff(candidate);
        if (handoff) return handoff;
    }
    return null;
}

function toPositive(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function toFinite(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

const IMAGE_PLACEMENT_EXECUTION_TOOLS = new Set<ImagePlacementExecutionTool>([
    'placeImage',
    'replaceImagePlaceholder',
    'fillDetailPage',
    'transformLayer',
    'custom-adapter'
]);

function normalizeImagePlacementExecutionTool(
    value: unknown,
    fallback?: ImagePlacementExecutionTool
): ImagePlacementExecutionTool {
    return IMAGE_PLACEMENT_EXECUTION_TOOLS.has(value as ImagePlacementExecutionTool)
        ? value as ImagePlacementExecutionTool
        : fallback || 'custom-adapter';
}

function normalizePlacementBox(value: unknown): ImagePlacementBox | null {
    if (!isRecord(value)) return null;
    const x = toFinite(value.x ?? value.left);
    const y = toFinite(value.y ?? value.top);
    const width = toPositive(value.width ?? (toFinite(value.right) !== undefined && x !== undefined ? Number(value.right) - x : undefined));
    const height = toPositive(value.height ?? (toFinite(value.bottom) !== undefined && y !== undefined ? Number(value.bottom) - y : undefined));
    if (x === undefined || y === undefined || !width || !height) return null;
    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function normalizeDesignPlacementTargetInput(
    value: unknown,
    executionTool?: ImagePlacementExecutionTool
): DesignPlacementTargetInput | null {
    if (!isRecord(value)) return null;
    const canvasRecord = isRecord(value.canvas) ? value.canvas : value;
    const canvasWidth = toPositive(canvasRecord.width ?? canvasRecord.canvasWidth);
    const canvasHeight = toPositive(canvasRecord.height ?? canvasRecord.canvasHeight);
    const box = normalizePlacementBox(value.box ?? value.targetBox ?? value.slotBox ?? value.slot);
    if (!canvasWidth || !canvasHeight || !box) return null;
    const safeBox = normalizePlacementBox(value.safeBox ?? value.safeArea);
    const slotRole = cleanString(value.slotRole ?? value.role);
    return {
        canvas: {
            width: Math.round(canvasWidth),
            height: Math.round(canvasHeight)
        },
        box,
        ...(safeBox ? { safeBox } : {}),
        ...(slotRole ? { slotRole } : {}),
        executionTool: normalizeImagePlacementExecutionTool(value.executionTool, executionTool)
    };
}

function extractDesignPlacementTargetFromParams(
    params: Record<string, any>,
    keys: string[],
    executionTool?: ImagePlacementExecutionTool
): DesignPlacementTargetInput | null {
    for (const key of keys) {
        const target = normalizeDesignPlacementTargetInput(params[key], executionTool);
        if (target) return target;
    }
    if (isRecord(params.designPlacementIntelligence)) {
        const target = normalizeDesignPlacementTargetInput(params.designPlacementIntelligence.target, executionTool);
        if (target) return target;
    }
    return null;
}

function buildPlacementTargetFromMainImageSizePlans(
    sizePlans: MainImageSizePlan[] | undefined,
    executionTool?: ImagePlacementExecutionTool
): DesignPlacementTargetInput | null {
    const plan = (sizePlans || []).find((item) => toPositive(item.targetSize?.width) && toPositive(item.targetSize?.height));
    const canvasWidth = toPositive(plan?.targetSize?.width);
    const canvasHeight = toPositive(plan?.targetSize?.height);
    if (!plan || !canvasWidth || !canvasHeight) return null;

    const safeMarginX = Math.round(canvasWidth * 0.06);
    const safeMarginY = Math.round(canvasHeight * 0.06);
    const safeBox = {
        x: safeMarginX,
        y: safeMarginY,
        width: Math.max(1, Math.round(canvasWidth - safeMarginX * 2)),
        height: Math.max(1, Math.round(canvasHeight - safeMarginY * 2))
    };
    const scale = toPositive(plan.scale) || 1;
    const plannedWidth = toPositive(plan.subjectSize?.width)
        ? Math.round(Number(plan.subjectSize?.width) * scale)
        : Math.round(safeBox.width * 0.72);
    const plannedHeight = toPositive(plan.subjectSize?.height)
        ? Math.round(Number(plan.subjectSize?.height) * scale)
        : Math.round(safeBox.height * 0.72);
    const width = clamp(plannedWidth, 1, safeBox.width);
    const height = clamp(plannedHeight, 1, safeBox.height);
    const fallbackX = Math.round((canvasWidth - width) / 2);
    const fallbackY = Math.round((canvasHeight - height) / 2);
    const rawX = Number.isFinite(Number(plan.targetX)) ? Number(plan.targetX) : fallbackX;
    const rawY = Number.isFinite(Number(plan.targetY)) ? Number(plan.targetY) : fallbackY;

    return {
        canvas: {
            width: Math.round(canvasWidth),
            height: Math.round(canvasHeight)
        },
        box: {
            x: clamp(Math.round(rawX), safeBox.x, Math.max(safeBox.x, safeBox.x + safeBox.width - width)),
            y: clamp(Math.round(rawY), safeBox.y, Math.max(safeBox.y, safeBox.y + safeBox.height - height)),
            width,
            height
        },
        safeBox,
        slotRole: 'hero-product',
        executionTool: executionTool || 'custom-adapter'
    };
}

function extractDesignIntelligenceAgentDecision(params: Record<string, any>): DesignIntelligenceAgentDecision | null {
    const candidates = [
        params.designIntelligenceDecision,
        params.designAgentDecision,
        params.agentDesignDecision
    ];
    const decision = candidates.find((item) => item && typeof item === 'object');
    return decision ? decision as DesignIntelligenceAgentDecision : null;
}

function dedupeKnowledgeResults(results: DesignKnowledgeResult[]): DesignKnowledgeResult[] {
    const seen = new Set<string>();
    const deduped: DesignKnowledgeResult[] = [];
    for (const result of results) {
        const id = cleanString(result.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        deduped.push(result);
    }
    return deduped;
}

export function buildDesignMemoryKnowledgeResultsForSkill(input: {
    params?: Record<string, any>;
    userText?: string;
    scenario?: string;
    limit?: number;
    context?: SkillExecuteParams['context'];
}): DesignKnowledgeResult[] {
    const params = input.params || {};
    const explicitResults = buildKnowledgeResultsFromParams(params) as DesignKnowledgeResult[];
    const query = [
        input.userText,
        input.scenario,
        '用户偏好',
        '设计风格',
        '字体',
        '排版',
        '颜色',
        '配色',
        '文案',
        '工作流',
        '主图',
        '详情页',
        'SKU'
    ].map(cleanString).filter(Boolean).join(' ');
    const memoryScope = resolveAgentProjectMemoryScope(input.context?.projectContext);
    const memoryResults = getMemoryService().getDesignKnowledgeResults({
        query,
        sourceTypes: ['local_case'],
        limit: input.limit || 6
    }, { scope: memoryScope });
    return dedupeKnowledgeResults([...explicitResults, ...memoryResults]);
}

/**
 * 把已复核采纳（active）的设计经验记忆格式化成有界系统提示片段（纯函数，可 smoke）。
 * 只取 local_case（积累的项目经验），限 limit 条、摘要截断，控上下文。无记忆→空串（静默跳过）。
 * 红线：供参考不照搬；优先服从用户当前指令与项目状态。
 */
export function formatDesignMemoryPromptSection(results: DesignKnowledgeResult[], limit = 3): string {
    const selection = selectDesignKnowledgeResultsForUse(results, { purpose: 'prompt_context' });
    const cases = selection.usableResults
        .filter((r) => r && r.sourceType === 'local_case')
        .slice(0, Math.max(1, limit));
    if (cases.length === 0) return '';
    const lines = cases.map((r, index) => {
        const summary = String(r.summary || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        const tags = (r.tags || []).slice(0, 4).filter(Boolean).join('、');
        return `${index + 1}. ${r.title}${summary ? `：${summary}` : ''}${tags ? `（标签：${tags}）` : ''}`;
    });
    return [
        '## 已沉淀的设计经验（来自历史项目、已人工复核采纳）',
        '以下是过往积累并经人工复核确认有价值的设计经验，供你参考借鉴，不要照搬复刻；优先服从用户当前指令与项目状态。',
        '其中 project_rule / brand_preference 仍只是规则来源：只有进入当前 Design Project State 的 ruleRecords 并通过复核后，才可成为质量/交付 Policy；任何记忆都不授予工具执行权限。',
        ...lines
    ].join('\n');
}

/**
 * 通用设计循环用：读 active 设计记忆（复用单一读取路径 buildDesignMemoryKnowledgeResultsForSkill，
 * needs_review 已被过滤）并格式化为有界提示片段。供 autonomous-agent 主循环在创意设计任务时注入，
 * 兑现"学了能用上"——而不再只有 main-image/detail-page/sku 三个 executor 能读到。
 */
export function buildDesignMemoryPromptSection(input: {
    userText?: string;
    scenario?: string;
    limit?: number;
    context?: SkillExecuteParams['context'];
}): string {
    const limit = input.limit ?? 3;
    const results = buildDesignMemoryKnowledgeResultsForSkill({
        userText: input.userText,
        scenario: input.scenario,
        limit,
        context: input.context
    });
    return formatDesignMemoryPromptSection(results, limit);
}

export function buildMainImageMemoryContextForSkill(input: {
    params?: Record<string, any>;
    userText?: string;
    limit?: number;
    knowledgeResults?: DesignKnowledgeResult[];
    context?: SkillExecuteParams['context'];
}): MainImageMemoryContext {
    const knowledgeResults = input.knowledgeResults || buildDesignMemoryKnowledgeResultsForSkill({
        params: input.params,
        userText: input.userText,
        scenario: 'main-image',
        limit: input.limit,
        context: input.context
    });
    return buildMainImageMemoryContext({
        userText: input.userText,
        knowledgeResults
    });
}

export function buildMainImageDesignPlacementIntelligencePlan(input: {
    params?: Record<string, any>;
    context?: SkillExecuteParams['context'];
    sizePlans?: MainImageSizePlan[];
    executionTool?: ImagePlacementExecutionTool;
    memoryContext?: MainImageMemoryContext | BusinessSkillMemoryContext | null;
}): DesignPlacementIntelligencePlan {
    const params = input.params || {};
    const projectContext = input.context?.projectContext;
    return buildDesignPlacementIntelligencePlan({
        scenario: 'main-image',
        assetIndex: projectContext?.assetIndex,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        visualInsightCache: projectContext?.visualInsightCache,
        visualCaseIndex: extractDesignPlacementVisualCaseIndex(params),
        memoryContext: input.memoryContext,
        target: buildPlacementTargetFromMainImageSizePlans(input.sizePlans, input.executionTool)
    });
}

export function buildBusinessSkillDesignPlacementIntelligencePlan(input: {
    scenario: Extract<ProjectVisualSamplingScenario, 'detail-page' | 'sku'>;
    params?: Record<string, any>;
    context?: SkillExecuteParams['context'];
    target?: DesignPlacementTargetInput | null;
    targetParamNames?: string[];
    executionTool?: ImagePlacementExecutionTool;
    memoryContext?: BusinessSkillMemoryContext | null;
}): DesignPlacementIntelligencePlan {
    const params = input.params || {};
    const projectContext = input.context?.projectContext;
    const target = input.target ?? extractDesignPlacementTargetFromParams(
        params,
        input.targetParamNames || ['designPlacementTarget', 'placementTarget'],
        input.executionTool
    );
    return buildDesignPlacementIntelligencePlan({
        scenario: input.scenario,
        assetIndex: projectContext?.assetIndex,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        visualInsightCache: projectContext?.visualInsightCache,
        visualCaseIndex: extractDesignPlacementVisualCaseIndex(params),
        memoryContext: input.memoryContext,
        target
    });
}

export function buildDetailPageDesignPlacementIntelligencePlan(input: {
    params?: Record<string, any>;
    context?: SkillExecuteParams['context'];
    target?: DesignPlacementTargetInput | null;
    memoryContext?: BusinessSkillMemoryContext | null;
}): DesignPlacementIntelligencePlan {
    return buildBusinessSkillDesignPlacementIntelligencePlan({
        scenario: 'detail-page',
        params: input.params,
        context: input.context,
        target: input.target,
        memoryContext: input.memoryContext,
        targetParamNames: [
            'detailPagePlacementTarget',
            'detailPageDesignPlacementTarget',
            'designPlacementTarget',
            'placementTarget'
        ],
        executionTool: 'fillDetailPage'
    });
}

export function buildSkuBatchDesignPlacementIntelligencePlan(input: {
    params?: Record<string, any>;
    context?: SkillExecuteParams['context'];
    target?: DesignPlacementTargetInput | null;
    memoryContext?: BusinessSkillMemoryContext | null;
}): DesignPlacementIntelligencePlan {
    return buildBusinessSkillDesignPlacementIntelligencePlan({
        scenario: 'sku',
        params: input.params,
        context: input.context,
        target: input.target,
        memoryContext: input.memoryContext,
        targetParamNames: [
            'skuPlacementTarget',
            'skuDesignPlacementTarget',
            'designPlacementTarget',
            'placementTarget'
        ],
        executionTool: 'custom-adapter'
    });
}

export function buildBusinessSkillMemoryContextForSkill(input: {
    scenario: BusinessSkillMemoryScenario;
    params?: Record<string, any>;
    userText?: string;
    limit?: number;
    knowledgeResults?: DesignKnowledgeResult[];
    context?: SkillExecuteParams['context'];
}): BusinessSkillMemoryContext {
    const knowledgeResults = input.knowledgeResults || buildDesignMemoryKnowledgeResultsForSkill({
        params: input.params,
        userText: input.userText,
        scenario: input.scenario,
        limit: input.limit,
        context: input.context
    });
    return buildBusinessSkillMemoryContext({
        scenario: input.scenario,
        userText: input.userText,
        knowledgeResults
    });
}

function buildPlannerContext(
    input: Parameters<typeof planDesignTask>[0],
    options: {
        agentDecision?: DesignIntelligenceAgentDecision | null;
        memoryContext?: { status?: string } | null;
    } = {}
) {
    const output = planDesignTask(input);
    const designIntelligencePlan: DesignIntelligencePlan = buildDesignIntelligencePlan({
        userText: input.userText,
        scenario: output.executionPlan.scenario,
        plannerReadiness: output.readiness,
        knowledgeResults: input.knowledgeResults,
        projectContext: input.projectContext,
        memoryContext: options.memoryContext,
        agentDecision: options.agentDecision
    });
    return {
        output,
        designAgentOs: mapPlannerOutputToDesignAgentOsRecord(output),
        designIntelligencePlan
    };
}

export function buildPlannerExecutionPreflightGate(
    planner: PlannerContextResult,
    options: DesignPlannerExecutionPreflightGateOptions = {}
): DesignPlannerExecutionPreflightGate {
    return buildPlannerExecutionPreflightGateFromOutput(planner.output, options);
}

function normalizeOperationCategory(operation: string): string {
    const value = cleanString(operation).toLowerCase();
    if (!value) return 'unknown';
    if (/read|context|document|analyze/.test(value)) return 'context';
    if (/dsl|blueprint|layout/.test(value)) return 'dsl';
    if (/knowledge|recipe/.test(value)) return 'knowledge';
    if (/asset|autofill|image/.test(value)) return 'asset';
    if (/canvas|createdocument/.test(value)) return 'canvas';
    if (/place|transform|apply|match|write|text|style/.test(value)) return 'photoshop-write';
    if (/verify|qa|review|acceptance|completion/.test(value)) return 'verify';
    if (/save|export/.test(value)) return 'save-export';
    return value;
}

export function comparePlannerExecutionPlanToExecutor(
    planner: PlannerContextResult,
    executorOperations: string[]
): PlannerExecutionPlanAlignment {
    const plannedOperations = (planner.output.executionPlan.steps || []).map((step) => step.operation);
    const plannerCategories = Array.from(new Set(plannedOperations.map(normalizeOperationCategory)));
    const executorCategories = Array.from(new Set((executorOperations || []).map(normalizeOperationCategory)));
    const optionalCategories = new Set(['knowledge', 'asset', 'canvas']);
    const missingCategories = plannerCategories.filter((category) => !executorCategories.includes(category) && !optionalCategories.has(category));
    const matchedCategories = plannerCategories.filter((category) => executorCategories.includes(category));
    const warnings = missingCategories.map((category) => `Planner category ${category} is not represented by the executor operation trace.`);
    return {
        status: planner.output.readiness === 'blocked'
            ? 'blocked'
            : missingCategories.length > 0
                ? 'watch'
                : 'aligned',
        plannedOperations,
        executorOperations: executorOperations || [],
        matchedCategories,
        missingCategories,
        warnings,
        limitations: [
            'This alignment compares planner operation categories with the executor operation trace only.',
            'It does not change Photoshop tool parameters or prove visual design quality.',
            'Aligned categories are not a substitute for screenshot, bounds, or manual acceptance.'
        ]
    };
}

export function buildReferenceReplicationPlannerContext(input: {
    userInput: string;
    params: Record<string, any>;
    representation: MinimalDesignRepresentation;
    docInfo?: any;
    projectPath?: string;
    context?: SkillExecuteParams['context'];
    mode: string;
}): PlannerContextResult {
    const projectContext = input.context?.projectContext;
    return buildPlannerContext({
        userText: cleanString(input.userInput) || '参考图复刻',
        attachments: [{
            kind: 'reference-image',
            name: 'reference-image',
            width: Math.round(input.representation.canvas.width),
            height: Math.round(input.representation.canvas.height)
        }],
        currentDocument: buildPlannerCurrentDocumentFromToolResult(input.docInfo),
        projectContext: {
            projectPath: input.projectPath || projectContext?.projectPath,
            assets: buildProjectAssetsFromContext(input.context),
            assetIndex: projectContext?.assetIndex,
            visualSamplingPlan: projectContext?.visualSamplingPlan,
            visualInsightCache: projectContext?.visualInsightCache
        },
        referenceRepresentation: input.representation,
        constraints: [
            `layoutReplicationMode=${input.mode}`,
            `outputMode=${cleanString(input.params.outputMode) || 'match_existing_document'}`,
            'Planner context is read-only and must not change Photoshop execution parameters.'
        ],
        executionMode: 'plan-only'
    }, {
        agentDecision: extractDesignIntelligenceAgentDecision(input.params)
    });
}

export function buildMainImagePlannerContext(input: {
    params: Record<string, any>;
    context: SkillExecuteParams['context'];
    docInfo: any;
    imageType: string;
    sizeKeys: string[];
    sizePlans: MainImageSizePlan[];
    subjectBounds?: any;
    copyCandidates?: string[];
    toolNames?: string[];
    visionSignal?: MainImageVisionSignal | null;
}): MainImagePlannerContextResult {
    const projectContext = input.context?.projectContext;
    const currentDocument = buildPlannerCurrentDocumentFromToolResult(input.docInfo);
    const projectAssets = buildProjectAssetsFromContext(input.context);
    const strategyReviewGate = input.params.mainImageStrategyReviewGate
        || input.params.childStrategyReviewGate
        || input.params.ecommerceSocksChildStrategyReviewGate
        || null;
    const explicitStrategyInputs = input.params.mainImageStrategyInputs
        || input.params.strategyInputs
        || undefined;
    const ecommerceSocksChildStrategyInput = buildEcommerceSocksChildStrategyInput({
        handoff: extractEcommerceSocksChildStrategyHandoffFromContext({
            params: input.params,
            context: input.context
        }),
        skillId: 'main-image-design',
        expectedScenario: 'main-image'
    });
    const parentHandoffStrategyInputs = ecommerceSocksChildStrategyInput.canUseAsChildStrategyInput
        ? ecommerceSocksChildStrategyInput.strategyInputsPatch
        : undefined;
    const strategyInputs = parentHandoffStrategyInputs || explicitStrategyInputs
        ? {
            ...(parentHandoffStrategyInputs || {}),
            ...(explicitStrategyInputs || {})
        }
        : undefined;
    const referenceHints = buildReferenceHintsFromParams(input.params);
    const userText = cleanString(input.params.userIntent || input.context?.userInput) || '帮我做主图';
    const knowledgeResults = buildDesignMemoryKnowledgeResultsForSkill({
        params: input.params,
        userText,
        scenario: 'main-image',
        context: input.context
    });
    const mainImageMemoryContext = buildMainImageMemoryContextForSkill({
        userText,
        knowledgeResults,
        context: input.context
    });
    const mainImageDesignPlacementIntelligence = buildMainImageDesignPlacementIntelligencePlan({
        params: input.params,
        context: input.context,
        sizePlans: input.sizePlans,
        executionTool: 'custom-adapter',
        memoryContext: mainImageMemoryContext
    });
    const planner = buildPlannerContext({
        userText,
        currentDocument,
        projectContext: {
            projectPath: projectContext?.projectPath,
            assets: projectAssets,
            assetIndex: projectContext?.assetIndex,
            visualSamplingPlan: projectContext?.visualSamplingPlan,
            visualInsightCache: projectContext?.visualInsightCache
        },
        knowledgeResults,
        constraints: [
            'scenario=main-image',
            `imageType=${input.imageType}`,
            `sizes=${input.sizeKeys.join('/')}`,
            `plannedSizeCount=${input.sizePlans.length}`,
            `ecommerceSocksChildStrategy=${ecommerceSocksChildStrategyInput.status}`,
            'Planner context is read-only and must not change Photoshop execution parameters.'
        ],
        executionMode: 'plan-only'
    }, {
        agentDecision: extractDesignIntelligenceAgentDecision(input.params),
        memoryContext: mainImageMemoryContext
    });
    return {
        ...planner,
        mainImageAgentDraft: buildMainImageAgentDraftPlan({
            userText,
            imageType: input.imageType,
            currentDocument,
            projectAssets,
            selectedAsset: projectContext?.selectedProjectImagePath ? {
                path: projectContext.selectedProjectImagePath,
                name: String(projectContext.selectedProjectImagePath).split(/[\\/]/).pop(),
                role: 'selected-project-image',
                source: 'selected-project-image'
            } : undefined,
            subjectBounds: input.subjectBounds,
            sizePlans: input.sizePlans,
            copyCandidates: input.copyCandidates || [],
            outputDir: cleanString(input.params.outputDir) || undefined,
            toolNames: input.toolNames || [],
            visionSignal: input.visionSignal || null,
            referenceHints,
            knowledgeResults,
            mainImageMemoryContext,
            designPlacementIntelligencePlan: mainImageDesignPlacementIntelligence,
            ecommerceSocksChildStrategyInput,
            strategyReviewGate,
            strategyInputs: strategyInputs as Partial<Record<MainImageStrategyInputKey, unknown>> | undefined
        }),
        mainImageDesignPlacementIntelligence,
        ecommerceSocksChildStrategyInput
    };
}

export function buildDetailPagePlannerContext(input: {
    userInput: string;
    params: Record<string, any>;
    context: SkillExecuteParams['context'];
    projectPath?: string;
    screenCount?: number;
    mode: 'inspect' | 'execute';
    readinessMode?: string;
    screenPlanCount?: number;
}): DetailPagePlannerContextResult {
    const userText = cleanString(input.userInput) || '帮我做详情页';
    const knowledgeResults = buildDesignMemoryKnowledgeResultsForSkill({
        params: input.params,
        userText,
        scenario: 'detail-page',
        context: input.context
    });
    const businessSkillMemoryContext = buildBusinessSkillMemoryContextForSkill({
        scenario: 'detail-page',
        userText,
        knowledgeResults,
        context: input.context
    });
    const businessSkillMemoryStrategy = buildBusinessSkillMemoryStrategy({
        scenario: 'detail-page',
        memoryContext: businessSkillMemoryContext
    });
    const detailPageDesignPlacementIntelligence = buildDetailPageDesignPlacementIntelligencePlan({
        params: input.params,
        context: input.context,
        memoryContext: businessSkillMemoryContext
    });
    const ecommerceSocksChildStrategyInput = buildEcommerceSocksChildStrategyInput({
        handoff: extractEcommerceSocksChildStrategyHandoffFromContext({
            params: input.params,
            context: input.context
        }),
        skillId: 'detail-page-design',
        expectedScenario: 'detail-page'
    });
    const planner = buildPlannerContext({
        userText,
        currentDocument: buildPlannerCurrentDocumentFromContext(input.context),
        projectContext: {
            projectPath: input.projectPath || input.context?.projectContext?.projectPath,
            assets: buildProjectAssetsFromContext(input.context),
            assetIndex: input.context?.projectContext?.assetIndex,
            visualSamplingPlan: input.context?.projectContext?.visualSamplingPlan,
            visualInsightCache: input.context?.projectContext?.visualInsightCache
        },
        knowledgeResults,
        constraints: [
            'scenario=detail-page',
            `detailMode=${input.mode}`,
            `screenCount=${Number(input.screenCount || 0)}`,
            `screenPlanCount=${Number(input.screenPlanCount || 0)}`,
            input.readinessMode ? `templateReadiness=${input.readinessMode}` : '',
            `businessSkillMemory=${businessSkillMemoryContext.status}`,
            `ecommerceSocksChildStrategy=${ecommerceSocksChildStrategyInput.status}`,
            'Planner context is read-only and must not change Photoshop execution parameters.'
        ].filter(Boolean),
        executionMode: 'plan-only'
    }, {
        agentDecision: extractDesignIntelligenceAgentDecision(input.params),
        memoryContext: businessSkillMemoryContext
    });
    return {
        ...planner,
        businessSkillMemoryContext,
        businessSkillMemoryStrategy,
        detailPageMemoryStrategy: businessSkillMemoryStrategy,
        businessSkillDesignPlacementIntelligence: detailPageDesignPlacementIntelligence,
        detailPageDesignPlacementIntelligence,
        ecommerceSocksChildStrategyInput
    };
}

export function buildSkuBatchPlannerContext(input: {
    userInput: string;
    params: Record<string, any>;
    context: SkillExecuteParams['context'];
    projectPath?: string;
    comboSizes: number[];
    colorCount: number;
    totalCombinations: number;
    processedSizeCount: number;
}): SkuBatchPlannerContextResult {
    const userText = cleanString(input.userInput) || '帮我做 SKU';
    const knowledgeResults = buildDesignMemoryKnowledgeResultsForSkill({
        params: input.params,
        userText,
        scenario: 'sku',
        context: input.context
    });
    const businessSkillMemoryContext = buildBusinessSkillMemoryContextForSkill({
        scenario: 'sku',
        userText,
        knowledgeResults,
        context: input.context
    });
    const businessSkillMemoryStrategy = buildBusinessSkillMemoryStrategy({
        scenario: 'sku',
        memoryContext: businessSkillMemoryContext
    });
    const skuDesignPlacementIntelligence = buildSkuBatchDesignPlacementIntelligencePlan({
        params: input.params,
        context: input.context,
        memoryContext: businessSkillMemoryContext
    });
    const ecommerceSocksChildStrategyInput = buildEcommerceSocksChildStrategyInput({
        handoff: extractEcommerceSocksChildStrategyHandoffFromContext({
            params: input.params,
            context: input.context
        }),
        skillId: 'sku-batch',
        expectedScenario: 'sku'
    });
    const skuColorCardRetouchStrategy = buildSkuColorCardRetouchStrategy({
        userText,
        colorCount: input.colorCount,
        comboSizes: input.comboSizes,
        sourceHints: [
            input.params.skuFileKeyword,
            input.params.skuSourceFile,
            input.params.skuTemplateFile,
            input.context?.projectContext?.selectedProjectImagePath,
            ...(input.context?.projectContext?.sampleImagePaths || [])
        ]
    });
    const planner = buildPlannerContext({
        userText,
        currentDocument: buildPlannerCurrentDocumentFromContext(input.context),
        projectContext: {
            projectPath: input.projectPath || input.context?.projectContext?.projectPath,
            assets: buildProjectAssetsFromContext(input.context),
            assetIndex: input.context?.projectContext?.assetIndex,
            visualSamplingPlan: input.context?.projectContext?.visualSamplingPlan,
            visualInsightCache: input.context?.projectContext?.visualInsightCache
        },
        knowledgeResults,
        constraints: [
            'scenario=sku',
            `comboSizes=${input.comboSizes.join('/')}`,
            `colorCount=${input.colorCount}`,
            `totalCombinations=${input.totalCombinations}`,
            `processedSizeCount=${input.processedSizeCount}`,
            `businessSkillMemory=${businessSkillMemoryContext.status}`,
            `ecommerceSocksChildStrategy=${ecommerceSocksChildStrategyInput.status}`,
            `skuColorCardRetouchStrategy=${skuColorCardRetouchStrategy.status}`,
            'Planner context is read-only and must not change Photoshop execution parameters.'
        ],
        executionMode: 'plan-only'
    }, {
        agentDecision: extractDesignIntelligenceAgentDecision(input.params),
        memoryContext: businessSkillMemoryContext
    });
    return {
        ...planner,
        businessSkillMemoryContext,
        businessSkillMemoryStrategy,
        skuMemoryStrategy: businessSkillMemoryStrategy,
        businessSkillDesignPlacementIntelligence: skuDesignPlacementIntelligence,
        skuDesignPlacementIntelligence,
        ecommerceSocksChildStrategyInput,
        skuColorCardRetouchStrategy
    };
}
