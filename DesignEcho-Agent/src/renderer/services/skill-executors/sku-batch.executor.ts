/**
 * SKU 批量生成技能执行器
 * @description 规则驱动的 SKU 颜色组合生成 + 批量排版导出
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { useAppStore } from '../../stores/app.store';
import { decideSkuSelfSelectNoteGeneration } from '../../../shared/sku-self-select-note-policy';
import {
    buildSkuExportReadback,
    sanitizeSkuToolResultsForPublicResult
} from '../../../shared/sku-export-readback';
import { buildSkuDeliverySummary } from '../../../shared/sku-delivery-summary';
import {
    buildSkuConfiguredExecutionPlan,
    buildSkuConfiguredExecutionBlockerMessage,
    type SkuConfiguredExecutionPlan,
    type SkuConfiguredFileInput,
    type SkuConfiguredTemplateInput
} from '../../../shared/sku-configured-execution-plan';
import { buildSkuLayoutComboBatches } from '../../../shared/sku-layout-execution-batches';
import { buildSkuVisualReviewIntake } from '../../../shared/sku-visual-review-intake';
import {
    buildSkuHumanReviewBinding,
    buildSkuHumanReviewCard,
    buildSkuHumanReviewTarget
} from '../../../shared/sku-human-review';
import { buildSkuColorCardImageProbeReview } from '../../../shared/sku-color-card-image-probes';
import {
    buildSkuCardAssetCandidateReport,
    type SkuCardAssetCandidateReport
} from '../../../shared/sku-card-asset-candidates';
import { buildSkuCardVisualConfirmationPlan } from '../../../shared/sku-card-visual-confirmation-plan';
import {
    buildSkuCardSourcePreparationPlan,
    type SkuCardSourcePreparationPlan
} from '../../../shared/sku-card-source-preparation-plan';
import {
    buildSkuCardTemplatePreparationPlan,
    type SkuCardTemplatePreparationPlan
} from '../../../shared/sku-card-template-preparation-plan';
import {
    buildSkuTemplateDesignHandoffContract,
    evaluateSkuTemplatePlaceholderBatchEntryGate,
    hasDeclinedSkuCardTemplateDesignText,
    resolveSkuTemplatePreparationRoute
} from '../../../shared/sku-template-design-loop';
import {
    buildSkuAutoLayoutExecutorPolicy,
    buildSkuTemplateLayoutPreflightFromRuntimeInspection,
    type SkuAutoLayoutExecutorDecision,
    type SkuTemplateLayoutPreflight
} from '../../../shared/sku-auto-layout-executor-policy';
import {
    buildSkuDesignAgentOsRecord,
    type SkuBatchPlanInput
} from '../../../shared/design-agent-os-contracts';
import {
    buildSkuWorkflowStagePlan,
    shouldHoldSkuBatchForAgentDesignDecision
} from '../../../shared/sku-workflow-stages';
import { buildSkuComboConfirmationRequest } from '../../../shared/sku-combo-confirmation-request';
import { buildSkuComboMultisetIdentity } from '../../../shared/sku-combo-identity';
import {
    validateSkuComboEditorValue,
    type SkuComboEditorCard,
    type SkuComboEditorValue
} from '../../../shared/sku-combo-interactive-card';
import type { InteractiveCardSubmission } from '../../../shared/interactive-card-contract';
import {
    buildEditableConfirmationInteractiveCard,
    validateEditableConfirmationValue,
    type EditableConfirmationCard,
    type EditableConfirmationValue
} from '../../../shared/editable-confirmation-interactive-card';
import { buildProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';
import {
    buildProjectProductUnderstanding,
    type ProjectProductUnderstanding
} from '../../../shared/project-product-understanding';
import { sanitizeUserVisibleDiagnosticText } from '../../../shared/chat-response-cleaner';
import { inferDesignDocumentRoleFromName } from '../../../shared/design-document-role';
import { buildSkuBatchPlannerContext } from './design-planner-context';
import { emitSkillStep } from './skill-step-events';
import { runProjectVisualInsightCacheFill } from '../project-visual-insight-cache-fill';
import { getMemoryService } from '../memory.service';
// ==================== 辅助函数 ====================

const REQUIRED_SKU_NO_PLACEHOLDER_REVISION = 'sku-no-placeholder-auto-layout/v2';
const REQUIRED_SKU_RECURSIVE_COLOR_GROUPS_REVISION = 'sku-recursive-color-layer-groups/v1';
const REQUIRED_SKU_COMBO_EXPORT_NAMING_REVISION = 'sku-combo-export-naming/v1';
const REQUIRED_SKU_REGION_COMPOSITION_REVISION = 'sku-region-composition/v1';
const CURRENT_GENERATED_CARD_TEMPLATE_REVISION = 4;

type SkuCardSourceSelection = SkuCardSourcePreparationPlan['selectedSources'][number];

function formatSkuCardSourceLocation(source: SkuCardSourceSelection): string {
    const relativePath = String(source.relativePath || '').trim();
    const fallbackName = String(source.path || '')
        .split(/[\\/]/)
        .filter(Boolean)
        .slice(-2)
        .join('/');
    return sanitizeUserVisibleDiagnosticText((relativePath || fallbackName || '项目素材').replace(/\\/g, '/'));
}

function formatSkuCardRecommendedUse(value: unknown): string {
    if (value === 'primary_sku_card') return '优先色卡图';
    if (value === 'secondary_sku_card') return '可用色卡图';
    if (value === 'reference_only') return '仅作参考';
    return '待判断';
}

function summarizeSkuCardSourceSelectionJudgment(
    selectedSources: SkuCardSourceSelection[],
    report?: SkuCardAssetCandidateReport | null
): string {
    const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
    const directCandidateCount = candidates.filter((candidate) =>
        candidate.recommendedUse === 'primary_sku_card' || candidate.recommendedUse === 'secondary_sku_card'
    ).length;
    const referenceOnlyCount = candidates.filter((candidate) => candidate.recommendedUse === 'reference_only').length;
    const visualPendingCount = candidates.filter((candidate) =>
        candidate.needsVisualConfirmation && candidate.recommendedUse !== 'reference_only'
    ).length;
    const selectedNames = selectedSources
        .map((source) => `${source.colorName}号${source.displayName}`)
        .join(' / ');
    const parts = [
        `从 ${candidates.length} 张候选中选择 ${selectedSources.length} 张作为色卡素材`,
        selectedNames ? `顺序为 ${selectedNames}` : '',
        `优先依据是单只或单双、主体完整、适合统一裁切`,
        directCandidateCount > selectedSources.length
            ? `另有 ${directCandidateCount - selectedSources.length} 张可用候选未进入本轮`
            : '',
        referenceOnlyCount > 0 ? `${referenceOnlyCount} 张更适合作为参考图` : '',
        visualPendingCount > 0 ? `${visualPendingCount} 张仍需要继续看图确认` : ''
    ].filter(Boolean);
    return parts.join('；');
}

function summarizeSkuCardSourceDocumentStructure(plan: SkuCardSourcePreparationPlan): string {
    const selectedSources = Array.isArray(plan.selectedSources) ? plan.selectedSources : [];
    const colorNames = selectedSources
        .map((source) => `${source.colorName}号${source.displayName}`)
        .join(' / ');
    return [
        `将创建 ${selectedSources.length} 张独立色卡`,
        colorNames ? `颜色顺序：${colorNames}` : '',
        '每张卡片保留编号、色名、商品图和色卡底',
        '商品图会先置入卡片区域，再剪切到色卡底，避免溢出'
    ].filter(Boolean).join('；');
}

async function getProjectContext(): Promise<{ projectPath?: string } | null> {
    const currentProject = useAppStore.getState().currentProject;
    if (currentProject?.path) {
        return { projectPath: currentProject.path };
    }
    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isProbeableExportPath(value: string): boolean {
    const text = String(value || '').trim();
    return /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('\\\\') || text.startsWith('/');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${stage} timeout after ${timeoutMs}ms`)), timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

type SkuNoPlaceholderRuntimeReadiness = {
    ready: boolean;
    error?: string;
    result?: any;
    data?: Record<string, any>;
};

function normalizeCapabilityActions(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function buildSkuNoPlaceholderRuntimeError(detail?: unknown): string {
    const suffix = detail ? ` 原因：${String(detail)}` : '';
    return `当前 UXP 插件运行版本不支持当前 SKU 执行契约，请重新加载 DesignEcho UXP 插件或重启 Photoshop 后再执行；本次已停止写入，避免旧 runtime 生成错误命名或错误排版。${suffix}`;
}

function supportsRecursiveSkuColorGroups(result: any): boolean {
    if (!result || result.success === false) return false;
    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    const colorGroups = data.skuSourceColorGroups && typeof data.skuSourceColorGroups === 'object'
        ? data.skuSourceColorGroups
        : {};
    const colorGroupActions = normalizeCapabilityActions(colorGroups.actions);
    return (data.supportsRecursiveSkuLayerSets === true || colorGroups.recursiveLayerSets === true)
        && colorGroups.revision === REQUIRED_SKU_RECURSIVE_COLOR_GROUPS_REVISION
        && colorGroups.canResolveNestedColorGroups === true
        && colorGroups.returnsLayerSetPaths === true
        && ['listLayerSets', 'execute', 'arrangeDynamic'].every((action) => colorGroupActions.includes(action));
}

function buildSkuRecursiveColorGroupRuntimeError(detail?: unknown): string {
    const suffix = detail ? ` 原因：${String(detail)}` : '';
    return `当前运行中的 UXP 插件还没有加载 SKU 递归颜色组识别能力，请重新加载 DesignEcho UXP 插件后再执行；本次不会继续生成，避免把嵌套颜色组误判成素材缺失。${suffix}`;
}

function supportsSkuComboExportNaming(result: any): boolean {
    if (!result || result.success === false) return false;
    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    const naming = data.comboExportNaming && typeof data.comboExportNaming === 'object'
        ? data.comboExportNaming
        : {};
    return naming.revision === REQUIRED_SKU_COMBO_EXPORT_NAMING_REVISION
        && naming.usesColorComboAsFileName === true
        && naming.keepsExecutionOrderOutOfFileName === true;
}

function supportsSkuRegionComposition(result: any): boolean {
    if (!result || result.success === false) return false;
    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    const capability = data.templateRegionComposition && typeof data.templateRegionComposition === 'object'
        ? data.templateRegionComposition
        : {};
    const actions = normalizeCapabilityActions(capability.actions);
    return capability.revision === REQUIRED_SKU_REGION_COMPOSITION_REVISION
        && capability.acceptsExplicitRegionCapacities === true
        && capability.preservesPhotoshopPanelOrder === true
        && actions.includes('inspectTemplateLayout')
        && actions.includes('execute');
}

function evaluateSkuNoPlaceholderRuntimeReadiness(result: any): SkuNoPlaceholderRuntimeReadiness {
    if (!result || result.success === false) {
        return {
            ready: false,
            result,
            error: buildSkuNoPlaceholderRuntimeError(result?.error || result?.message || '未返回 skuLayout 能力信息')
        };
    }

    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    const actions = normalizeCapabilityActions(data.actions);
    const noPlaceholderAutoLayout = data.noPlaceholderAutoLayout && typeof data.noPlaceholderAutoLayout === 'object'
        ? data.noPlaceholderAutoLayout
        : {};
    const noPlaceholderActions = normalizeCapabilityActions(noPlaceholderAutoLayout.actions);
    const supportsNoPlaceholderAutoLayout = data.supportsNoPlaceholderAutoLayout === true;
    const supportsExecute = actions.includes('execute') && noPlaceholderActions.includes('execute');
    const supportsNote = actions.includes('arrangeDynamic') && noPlaceholderActions.includes('arrangeDynamic');
    const hasCurrentRevision = noPlaceholderAutoLayout.revision === REQUIRED_SKU_NO_PLACEHOLDER_REVISION;
    const returnsActualSubjectBoundsQa = noPlaceholderAutoLayout.returnsActualSubjectBoundsQa === true;
    const hasRecursiveColorGroups = supportsRecursiveSkuColorGroups(result);
    const hasComboExportNaming = supportsSkuComboExportNaming(result);

    if (!supportsNoPlaceholderAutoLayout || !supportsExecute || !supportsNote || !hasCurrentRevision || !returnsActualSubjectBoundsQa || !hasRecursiveColorGroups || !hasComboExportNaming) {
        const missing = [
            !supportsNoPlaceholderAutoLayout ? 'supportsNoPlaceholderAutoLayout' : '',
            !supportsExecute ? 'execute' : '',
            !supportsNote ? 'arrangeDynamic' : '',
            !hasCurrentRevision ? `revision=${REQUIRED_SKU_NO_PLACEHOLDER_REVISION}` : '',
            !returnsActualSubjectBoundsQa ? 'returnsActualSubjectBoundsQa' : '',
            !hasRecursiveColorGroups ? `revision=${REQUIRED_SKU_RECURSIVE_COLOR_GROUPS_REVISION}` : '',
            !hasComboExportNaming ? `revision=${REQUIRED_SKU_COMBO_EXPORT_NAMING_REVISION}` : ''
        ].filter(Boolean).join(' / ');
        return {
            ready: false,
            result,
            data,
            error: buildSkuNoPlaceholderRuntimeError(`skuLayout 能力信息缺少当前无占位符自动排版契约：${missing}`)
        };
    }

    return {
        ready: true,
        result,
        data
    };
}

function summarizeSkuNoPlaceholderRuntimeReadiness(readiness: SkuNoPlaceholderRuntimeReadiness | null): Record<string, any> | null {
    if (!readiness) return null;
    return {
        ready: readiness.ready,
        error: readiness.error,
        schema: readiness.data?.schema,
        supportsNoPlaceholderAutoLayout: readiness.data?.supportsNoPlaceholderAutoLayout === true,
        noPlaceholderRevision: readiness.data?.noPlaceholderAutoLayout?.revision,
        returnsActualSubjectBoundsQa: readiness.data?.noPlaceholderAutoLayout?.returnsActualSubjectBoundsQa === true,
        supportsRecursiveSkuColorGroups: supportsRecursiveSkuColorGroups(readiness.result),
        comboExportNamingRevision: readiness.data?.comboExportNaming?.revision,
        supportsSkuComboExportNaming: supportsSkuComboExportNaming(readiness.result)
    };
}

function normalizeDiagnosticStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function appendUniqueDiagnostics(target: string[], diagnostics: string[]): void {
    for (const diagnostic of diagnostics) {
        if (!diagnostic || target.includes(diagnostic)) continue;
        target.push(diagnostic);
    }
}

function formatSkuAutoLayoutSummaryDiagnostic(plan: any): string {
    const summary = plan?.summary || plan?.diagnostics?.summary;
    if (!summary || typeof summary !== 'object') return '';

    const itemCount = Number(summary.itemCount || 0);
    const obstacleCount = Number(summary.obstacleCount || 0);
    const freeRegionCount = Number(summary.freeRegionCount || 0);
    const largest = summary.largestFreeRegion || {};
    const largestWidth = Math.round(Number(largest.width || 0));
    const largestHeight = Math.round(Number(largest.height || 0));
    const likelyBlockers = Array.isArray(summary.likelyBlockers)
        ? summary.likelyBlockers.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];

    if (likelyBlockers.includes('no_free_region')) {
        return `模板安全区没有可用空闲区域，已识别 ${obstacleCount} 个需避让元素。`;
    }
    if (likelyBlockers.includes('high_item_count_needs_more_canvas_area')) {
        return `SKU 数量 ${itemCount} 较多，当前画布可用面积不足以保持最小缩放和间距。`;
    }
    if (likelyBlockers.includes('free_regions_are_fragmented')) {
        return `模板可用区域被切成 ${freeRegionCount} 个小区域，最大区域约 ${largestWidth}x${largestHeight}px。`;
    }
    if (likelyBlockers.includes('template_obstacles_consume_safe_area')) {
        return `模板元素占用了大部分安全区，最大空闲区域约 ${largestWidth}x${largestHeight}px。`;
    }
    if (freeRegionCount > 0) {
        return `已识别 ${freeRegionCount} 个空闲区域，最大区域约 ${largestWidth}x${largestHeight}px，需避让元素 ${obstacleCount} 个。`;
    }
    return '';
}

function collectSkuAutoLayoutQaDiagnostics(result: any, sourceLabel: string): string[] {
    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    const planGroups = [
        ...(Array.isArray(data.autoLayoutPlans) ? data.autoLayoutPlans : []),
        ...(Array.isArray(data.noteAutoLayoutPlans) ? data.noteAutoLayoutPlans : [])
    ];
    const diagnostics: string[] = [];

    planGroups.forEach((plan, index) => {
        const qa = plan?.autoLayoutQa;
        if (!qa || typeof qa !== 'object') return;

        const status = String(qa.status || '').trim();
        const parts = [
            sourceLabel,
            plan?.comboIndex !== undefined ? `组合${Number(plan.comboIndex) + 1}` : '',
            plan?.regionIndex !== undefined ? `区域${Number(plan.regionIndex) + 1}` : ''
        ].filter(Boolean);
        const label = `${parts.join(' ')} 自动排版执行后校验`;
        const blockers = normalizeDiagnosticStrings(qa.blockers);
        const warnings = normalizeDiagnosticStrings(qa.warnings);

        for (const blocker of blockers) diagnostics.push(`${label}: ${blocker}`);
        for (const warning of warnings) diagnostics.push(`${label}: ${warning}`);
        if (status === 'blocked' && blockers.length === 0) {
            diagnostics.push(`${label}: Photoshop 实际边界校验未通过，已停止导出。`);
        } else if (status === 'needs_review' && warnings.length === 0) {
            diagnostics.push(`${label}: Photoshop 实际边界需要复核。`);
        }

        if (status && status !== 'ready' && blockers.length === 0 && warnings.length === 0) {
            diagnostics.push(`${label}: autoLayoutQa 状态为 ${status}。`);
        }

        if (!status && planGroups.length === 1 && index === 0) {
            diagnostics.push(`${label}: autoLayoutQa 缺少状态字段。`);
        }
    });

    return diagnostics;
}

function collectSkuLayoutFailureDiagnostics(result: any, sourceLabel: string): string[] {
    const data = result?.data && typeof result.data === 'object' ? result.data : {};
    const diagnostics: string[] = [];

    for (const error of normalizeDiagnosticStrings(data.errors)) {
        diagnostics.push(`${sourceLabel}: ${error}`);
    }

    const planGroups = [
        ...(Array.isArray(data.autoLayoutPlans) ? data.autoLayoutPlans : []),
        ...(Array.isArray(data.noteAutoLayoutPlans) ? data.noteAutoLayoutPlans : [])
    ];
    planGroups.forEach((plan, index) => {
        const parts = [
            sourceLabel,
            plan?.comboIndex !== undefined ? `组合${Number(plan.comboIndex) + 1}` : '',
            plan?.regionIndex !== undefined ? `区域${Number(plan.regionIndex) + 1}` : '',
            `自动排版计划${index + 1}`
        ].filter(Boolean);
        const label = parts.join(' ');
        const blockers = normalizeDiagnosticStrings(plan?.blockers);
        const warnings = normalizeDiagnosticStrings(plan?.warnings);

        for (const blocker of blockers) diagnostics.push(`${label}: ${blocker}`);
        for (const warning of warnings) diagnostics.push(`${label}: ${warning}`);
        const summaryDiagnostic = formatSkuAutoLayoutSummaryDiagnostic(plan);
        if (summaryDiagnostic) diagnostics.push(`${label}: ${summaryDiagnostic}`);
        if (String(plan?.status || '').trim() === 'blocked' && blockers.length === 0) {
            diagnostics.push(`${label}: 模板没有可用排版区域，已停止导出。`);
        }
    });

    return Array.from(new Set(diagnostics));
}

type TemplateLibraryItem = {
    id: string;
    name: string;
    filePath: string;
    description?: string;
    metadata?: {
        comboSize?: number;
    };
    source: 'project-folder' | 'local-library' | 'template-library';
    sourcePriority: number;
};

type ProjectSkuSourceFile = {
    name: string;
    path: string;
    relativePath?: string;
};

type ProjectSkuConfigFile = {
    fileName: string;
    filePath: string;
};

type ResolvedSkuExecutionAssets = {
    size: number;
    comboCount: number;
    shouldRunCombo: boolean;
    shouldRunNote: boolean;
    comboTemplateDoc?: any;
    noteTemplateDoc?: any;
    comboTemplateError?: string;
    noteTemplateError?: string;
};

type BlockedSkuTemplateLayout = {
    size: number;
    action: 'execute' | 'arrangeDynamic';
    templateName?: string;
    expectedItemCount?: number;
    placeholderCount: number;
    message: string;
};

type SkuFinalExportRecord = {
    path: string;
    expectedDimensions?: { width: number; height: number };
};

const TEMPLATE_FILE_PATTERN = /\.(psd|psb|tif|tiff)$/i;
const SKU_CONFIG_FILE_PATTERN = /\.csv$/i;
const NOTE_TEMPLATE_KEYWORD = '自选备注';

function normalizeNameWithoutExt(input: string): string {
    return String(input || '').replace(/\.[^.]+$/, '').toLowerCase();
}

function normalizePositiveInteger(input: unknown): number | undefined {
    const value = Number(input);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return Math.round(value);
}

function getDocumentExportDimensions(doc: any): { width: number; height: number } | undefined {
    const width = normalizePositiveInteger(doc?.width);
    const height = normalizePositiveInteger(doc?.height);
    if (!width || !height) return undefined;
    return { width, height };
}

function normalizeDocumentPathBasename(input: string): string {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const base = raw.split(/[/\\]/).pop() || raw;
    return normalizeNameWithoutExt(base);
}

function escapeRegExp(input: string): string {
    return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSkuSourceDocumentBaseName(baseName: string, skuKeyword: string): boolean {
    const name = normalizeNameWithoutExt(baseName);
    const keyword = normalizeNameWithoutExt(String(skuKeyword || 'SKU'));
    if (!name || !keyword) return false;
    if (name === keyword) return true;

    const pattern = new RegExp(
        `^${escapeRegExp(keyword)}(?:[-_\\s]*(?:card[-_\\s]*)?source|[-_\\s]*(?:source|素材|源素材|色卡源)|(?:素材|源素材|色卡源))$`,
        'i'
    );
    return pattern.test(name);
}

function getSkuDocumentNameScore(doc: any, skuKeyword: string): number {
    const keyword = normalizeNameWithoutExt(String(skuKeyword || 'SKU'));
    const docName = normalizeNameWithoutExt(doc?.name || '');
    const docBaseNameFromPath = normalizeDocumentPathBasename(doc?.path || '');
    const role = inferDesignDocumentRoleFromName(String(doc?.name || doc?.path || ''));
    let score = 0;

    for (const candidate of [docName, docBaseNameFromPath]) {
        if (!candidate || !keyword) continue;
        if (candidate === keyword) score = Math.max(score, 120);
        else if (isSkuSourceDocumentBaseName(candidate, keyword)) score = Math.max(score, 95);
    }

    if (role === 'sku') score = Math.max(score, 60);
    return score;
}

function normalizePathForCompare(input: string): string {
    return String(input || '')
        .trim()
        .replace(/\//g, '\\')
        .replace(/\\+$/, '')
        .toLowerCase();
}

function isPathInsideDirectory(filePath?: string, directory?: string): boolean {
    const normalizedFile = normalizePathForCompare(filePath || '');
    const normalizedDir = normalizePathForCompare(directory || '');
    if (!normalizedFile || !normalizedDir) return false;
    return normalizedFile === normalizedDir || normalizedFile.startsWith(`${normalizedDir}\\`);
}

function isDocumentFromTemplateDirectory(doc: any, templateDir?: string): boolean {
    // 没有解析到项目模板目录时，不能把任意打开的文档当作「模板目录内文档」。
    // 否则用户从插件随手打开的素材会被误判成组合模板（根因：templateDir 依赖项目路径，
    // 项目路径为空时此处曾放行一切打开文档）。与 SKU 源文档一致地坚持「项目优先」：
    // 保守返回 false，让模板解析回退到项目模板文件扫描，而不是误用打开的素材。
    if (!templateDir) return false;
    // 同时要求文档有真实磁盘路径——无路径（pathless）的打开文档不能冒充项目模板。
    if (!doc?.path) return false;
    return isPathInsideDirectory(doc.path, templateDir);
}

function isExactTemplateDocument(doc: any, templateFilePath?: string): boolean {
    const normalizedDocPath = normalizePathForCompare(doc?.path || '');
    const normalizedTemplatePath = normalizePathForCompare(templateFilePath || '');
    if (!normalizedDocPath || !normalizedTemplatePath) return false;
    return normalizedDocPath === normalizedTemplatePath;
}

function matchesSkuDocument(
    doc: any,
    skuKeyword: string,
    options: {
        projectPath?: string;
        expectedPath?: string;
    } = {}
): boolean {
    const keyword = normalizeNameWithoutExt(String(skuKeyword || ''));
    if (!keyword) return false;

    const normalizedDocPath = normalizePathForCompare(doc?.path || '');
    const normalizedExpectedPath = normalizePathForCompare(options.expectedPath || '');
    if (normalizedDocPath && normalizedExpectedPath && normalizedDocPath === normalizedExpectedPath) {
        return true;
    }

    const docName = normalizeNameWithoutExt(doc?.name || '');
    const docBaseNameFromPath = normalizeDocumentPathBasename(doc?.path || '');
    const nameScore = getSkuDocumentNameScore(doc, skuKeyword);

    const matchedByName = [docName, docBaseNameFromPath].some((candidate) =>
        isSkuSourceDocumentBaseName(candidate, keyword)
    );
    const matchedByRole = inferDesignDocumentRoleFromName(String(doc?.name || doc?.path || '')) === 'sku';

    if (!matchedByName && !matchedByRole) return false;
    if (nameScore <= 0) return false;

    if (options.expectedPath) {
        const expectedBaseName = normalizeDocumentPathBasename(options.expectedPath);
        if (
            normalizedDocPath
            && docName !== expectedBaseName
            && docBaseNameFromPath !== expectedBaseName
        ) {
            return false;
        }
    }

    if (options.projectPath) {
        if (normalizedDocPath) {
            return isPathInsideDirectory(normalizedDocPath, options.projectPath);
        }
        return doc?.isActive === true && nameScore >= 60;
    }

    return true;
}

function scoreOpenedSkuDocument(
    doc: any,
    skuKeyword: string,
    options: {
        projectPath?: string;
        expectedPath?: string;
    } = {}
): number {
    if (!matchesSkuDocument(doc, skuKeyword, options)) return -1;

    let score = getSkuDocumentNameScore(doc, skuKeyword);
    const normalizedDocPath = normalizePathForCompare(doc?.path || '');
    const normalizedExpectedPath = normalizePathForCompare(options.expectedPath || '');
    if (normalizedDocPath && normalizedExpectedPath && normalizedDocPath === normalizedExpectedPath) score += 1000;
    if (doc?.isActive === true) score += 80;
    if (options.projectPath && normalizedDocPath && isPathInsideDirectory(normalizedDocPath, options.projectPath)) score += 120;
    if (!normalizedDocPath && doc?.isActive === true) score += 40;
    if (/(^|\\)psd(\\|$)/i.test(normalizedDocPath)) score += 20;
    return score;
}

function isLikelyOpenedComboTemplate(doc: any, skuKeyword: string, templateDir?: string): boolean {
    const name = normalizeNameWithoutExt(doc?.name || '');
    if (!name) return false;
    if (name.includes(normalizeNameWithoutExt(skuKeyword))) return false;
    if (name.includes(NOTE_TEMPLATE_KEYWORD)) return false;

    const fromProjectTemplateDir = isDocumentFromTemplateDirectory(doc, templateDir);
    const looksLikeTemplateName = /模板|双装|双模板/.test(String(doc?.name || ''));

    return fromProjectTemplateDir || looksLikeTemplateName;
}

function collectSizesFromOpenedTemplateDocs(docs: any[], skuKeyword: string, templateDir?: string): number[] {
    const sizes = new Set<number>();
    for (const doc of Array.isArray(docs) ? docs : []) {
        if (!isLikelyOpenedComboTemplate(doc, skuKeyword, templateDir)) continue;
        const size = extractComboSize(String(doc?.name || '') || String(doc?.path || ''));
        if (size && size > 0) sizes.add(size);
    }
    return Array.from(sizes).sort((a, b) => a - b);
}

function shouldAllowLibraryTemplateFallback(projectPath?: string, explicitFlag?: unknown, projectTemplateCount = 0): boolean {
    if (!projectPath) return true;
    if (projectTemplateCount <= 0) return true;
    return explicitFlag === true;
}

function isTruthyExecutionFlag(value: unknown): boolean {
    if (value === true) return true;
    const text = String(value || '').trim().toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled', 'auto', 'required'].includes(text);
}

function shouldRunSkuCardVisualConfirmationRefresh(params: Record<string, any>): boolean {
    return isTruthyExecutionFlag(params.runSkuCardVisualConfirmationBeforeSourcePreparation)
        || isTruthyExecutionFlag(params.runBusinessVisualObservationRefreshBeforeExecution)
        || isTruthyExecutionFlag(params.runVisualObservationRefreshBeforeExecution)
        || isTruthyExecutionFlag(params.executeBusinessVisualObservationRefreshBeforeExecution)
        || isTruthyExecutionFlag(params.executeVisualObservationRefreshBeforeExecution);
}

function isReasonableSkuSize(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 50;
}

function normalizeSkuSizeList(value: unknown): number[] {
    const raw = Array.isArray(value) ? value : [value];
    return Array.from(new Set(raw
        .map(item => Number(item))
        .filter(item => isReasonableSkuSize(item))))
        .sort((a, b) => a - b);
}

function resolveEarlySkuRequiredColorSlots(params: Record<string, any>): number {
    const directCandidates = normalizeSkuSizeList([
        params.skuRequiredColorSlots,
        params.requiredColorSlots,
        params.minimumSourceCount,
        params.minimumSkuSourceCount
    ]);
    const sizeCandidates = [
        ...normalizeSkuSizeList(params.comboSizes),
        ...normalizeSkuSizeList(params.comboSize)
    ].filter(isReasonableSkuSize);
    return Math.max(1, ...directCandidates, ...sizeCandidates);
}

function normalizeColorKey(input: string): string {
    return String(input || '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase();
}

function dedupeColorNames(names: string[]): { uniqueColors: string[]; duplicateColors: string[] } {
    const uniqueColors: string[] = [];
    const duplicateColors: string[] = [];
    const seen = new Set<string>();

    for (const rawName of names) {
        const normalized = normalizeColorKey(rawName);
        if (!normalized) continue;
        if (seen.has(normalized)) {
            duplicateColors.push(String(rawName || '').trim());
            continue;
        }
        seen.add(normalized);
        uniqueColors.push(String(rawName || '').trim());
    }

    return { uniqueColors, duplicateColors };
}

const NON_SKU_COLOR_LAYER_PATTERNS = [
    /(?:点击图|转化图|主图|首图|详情页|详情长图|白底图|海报|banner|poster)/i,
    /(?:main[-_\s]?image|click[-_\s]?image|conversion[-_\s]?image|detail[-_\s]?page|white[-_\s]?bg)/i,
    /(?:自选备注|备注图|组合图|模板|配置|参考|背景|标题|文案|卖点|按钮|价格|水印|logo)/i
];

function normalizeSkuLayerName(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isNumericSkuColorLayerName(name: string): boolean {
    return /^\d{1,3}$/.test(name);
}

function isLikelySkuColorLayerName(name: string): boolean {
    const normalized = normalizeSkuLayerName(name);
    if (!normalized) return false;
    if (isNumericSkuColorLayerName(normalized)) return true;
    return !NON_SKU_COLOR_LAYER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function readLayerSetBoundsRatio(layerSet: any): number | null {
    const bounds = layerSet?.bounds;
    if (!bounds || typeof bounds !== 'object') return null;
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const ratio = width / height;
    if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 2.5) return null;
    return Math.max(0.35, Math.min(1.8, ratio));
}

function estimateSkuSourceCardAspectRatio(layersResult: any, validColors: string[]): number | undefined {
    const layerSets = Array.isArray(layersResult?.data?.layerSets) ? layersResult.data.layerSets : [];
    if (layerSets.length === 0 || validColors.length === 0) return undefined;

    const validColorKeys = new Set(validColors.map((name) => normalizeColorKey(name)));
    const ratios: number[] = layerSets
        .filter((layerSet: any) => validColorKeys.has(normalizeColorKey(layerSet?.name)))
        .map(readLayerSetBoundsRatio)
        .filter((ratio: number | null): ratio is number => typeof ratio === 'number');
    if (ratios.length === 0) return undefined;

    const sorted = ratios.slice().sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

function extractComboSize(input: string): number | null {
    const text = String(input || '').replace(/\.[^.]+$/, '');
    const patterns = [
        /(?:^|[^\d])(\d{1,2})\s*(?:\u53cc\u88c5\u81ea\u9009\u5907\u6ce8|\u53cc\u81ea\u9009\u5907\u6ce8|\u53cc\u88c5|\u53cc\u6a21\u677f|\u53cc)(?!\d)/i,
        /(?:^|[^\d])(\d{1,2})\s*(?:\u7ec4|\u5957)(?!\d)/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const value = parseInt(match[1], 10);
        if (isReasonableSkuSize(value)) return value;
    }

    return null;
}

function inferTemplateSize(template: TemplateLibraryItem): number | null {
    if (typeof template.metadata?.comboSize === 'number') return template.metadata.comboSize;
    const byName = extractComboSize(template.name);
    if (byName) return byName;
    return extractComboSize(template.filePath);
}

function isCardStyleTemplateText(value: string): boolean {
    const text = normalizeNameWithoutExt(value);
    return /卡片|色卡|card|designecho/.test(text);
}

function isCardStyleTemplateCandidate(template: TemplateLibraryItem): boolean {
    return isCardStyleTemplateText([
        template.name,
        template.filePath,
        template.description || ''
    ].join(' '));
}

function scoreSkuCardTemplateRevision(value: string): number {
    const text = normalizeNameWithoutExt(value);
    const versions = Array.from(text.matchAll(/卡片模板v(\d+)/gi))
        .map(match => Number(match[1]))
        .filter(version => Number.isInteger(version) && version > 0);
    return versions.length > 0 ? Math.max(...versions) : 0;
}

function getGeneratedCardTemplateRevision(template: TemplateLibraryItem): number {
    return scoreSkuCardTemplateRevision([
        template.name,
        template.filePath,
        template.description || ''
    ].join(' '));
}

function isOutdatedGeneratedCardTemplateCandidate(template: TemplateLibraryItem): boolean {
    const revision = getGeneratedCardTemplateRevision(template);
    return revision > 0 && revision < CURRENT_GENERATED_CARD_TEMPLATE_REVISION;
}

function pickBestTemplateFromLibrary(
    templates: TemplateLibraryItem[],
    options: { size: number; keyword?: string; noteMode: boolean }
): TemplateLibraryItem | null {
    const keyword = String(options.keyword || '').trim().toLowerCase();
    const sizeKeyword = `${options.size}双`;

    const scored = templates
        .map(template => {
            const fileName = normalizeNameWithoutExt(template.name || template.filePath.split(/[/\\]/).pop() || '');
            const isNote = fileName.includes(NOTE_TEMPLATE_KEYWORD);
            if (options.noteMode && !isNote) return { template, score: -Infinity };
            if (!options.noteMode && isNote) return { template, score: -Infinity };

            let score = 0;
            const inferredSize = inferTemplateSize(template);
            if (inferredSize !== null && inferredSize !== options.size) return { template, score: -Infinity };
            if (inferredSize === options.size) score += 100;
            if (fileName.includes(sizeKeyword)) score += 60;
            if (keyword && (fileName.includes(keyword) || String(template.description || '').toLowerCase().includes(keyword))) {
                score += 25;
            }
            // 治理2026-07-06：生成占位模板（名字带「卡片模板v{n}」，一定是占位生成器产物、非设计稿）
            // 只作无其他同规格候选时的兜底——一律减分，不再靠版号/卡片风格加分赢过用户自己的
            // 规格模板（如「2双装.tif」）。用户模板在场时必须选用户模板。
            const cardRevision = getGeneratedCardTemplateRevision(template);
            if (cardRevision > 0) score -= 80;
            else if (isCardStyleTemplateCandidate(template)) score += 40;
            if (fileName.includes('模板')) score += 8;
            if (TEMPLATE_FILE_PATTERN.test(template.filePath)) score += 5;
            if (/\.psd$/i.test(template.filePath)) score += 3;

            return { template, score };
        })
        .filter(item => Number.isFinite(item.score))
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;
    return scored[0].template;
}

function collectSizesFromLibrary(templates: TemplateLibraryItem[]): number[] {
    const sizes = new Set<number>();
    for (const template of templates) {
        const fileName = normalizeNameWithoutExt(template.name || '');
        if (fileName.includes(NOTE_TEMPLATE_KEYWORD)) continue;
        const size = inferTemplateSize(template);
        if (size && size > 0) sizes.add(size);
    }
    return Array.from(sizes).sort((a, b) => a - b);
}

function buildComboIdentity(combo: string[]): string {
    return buildSkuComboMultisetIdentity(combo, (color) => normalizeColorKey(color));
}

function dedupeCombosForSize(combos: string[][]): {
    uniqueCombos: string[][];
    removedCombos: string[][];
} {
    const uniqueCombos: string[][] = [];
    const removedCombos: string[][] = [];
    const seen = new Set<string>();

    for (const combo of combos) {
        const identity = buildComboIdentity(combo);
        if (!identity) continue;

        if (seen.has(identity)) {
            removedCombos.push(combo);
            continue;
        }

        seen.add(identity);
        uniqueCombos.push(combo);
    }

    return { uniqueCombos, removedCombos };
}

function dedupeAllCombosBySize(combosBySize: Record<number, string[][]>): Array<{
    size: number;
    removedCombos: string[][];
}> {
    const removals: Array<{ size: number; removedCombos: string[][] }> = [];

    for (const [sizeStr, combos] of Object.entries(combosBySize)) {
        const size = parseInt(sizeStr, 10);
        if (!Array.isArray(combos) || combos.length <= 1) continue;

        const { uniqueCombos, removedCombos } = dedupeCombosForSize(combos);
        combosBySize[size] = uniqueCombos;

        if (removedCombos.length > 0) {
            removals.push({ size, removedCombos });
        }
    }

    return removals;
}

function buildColorAliasEntries(availableColors: string[]): Array<{ actual: string; aliases: string[] }> {
    return availableColors.map(color => {
        const normalized = normalizeColorKey(color);
        const trimmed = String(color || '').trim();
        return {
            actual: color,
            aliases: Array.from(new Set([
                trimmed,
                trimmed.replace(/色$/u, ''),
                normalized,
                normalized.replace(/色$/u, '')
            ].filter(Boolean)))
        };
    });
}

function isNumericColorAlias(alias: string): boolean {
    return /^\d+$/.test(String(alias || '').trim());
}

function matchesNumericColorToken(rawToken: string, alias: string): boolean {
    const normalizedToken = normalizeColorKey(rawToken);
    const normalizedAlias = String(alias || '').trim();
    if (!normalizedToken || !normalizedAlias) return false;
    if (normalizedToken === normalizedAlias) return true;

    const escapedAlias = escapeRegExp(normalizedAlias);
    return new RegExp(`(?:颜色|色号|色|款式|款|编号|号)${escapedAlias}|${escapedAlias}(?:号色|色号|号|色|款)`).test(normalizedToken);
}

function resolveColorToken(
    token: string,
    aliasEntries: Array<{ actual: string; aliases: string[] }>
): string | null {
    const rawToken = String(token || '');
    const normalizedToken = normalizeColorKey(token)
        .replace(/(这个|那个|组合|搭配|颜色|款式|帮我|做|生成|新增|增加|追加|再加|再做|只做|只要|一个|每个规格|规格|双装|双|全是|都是)/g, '')
        .trim();

    if (!normalizedToken) return null;

    for (const entry of aliasEntries) {
        const numericAliases = entry.aliases.filter(isNumericColorAlias);
        if (numericAliases.length > 0 && numericAliases.some(alias => matchesNumericColorToken(rawToken, alias))) {
            return entry.actual;
        }
        if (numericAliases.length === entry.aliases.length) {
            continue;
        }
        if (entry.aliases.some(alias => alias && !isNumericColorAlias(alias) && (normalizedToken === alias || normalizedToken.endsWith(alias) || normalizedToken.startsWith(alias)))) {
            return entry.actual;
        }
    }

    for (const entry of aliasEntries) {
        const numericAliases = entry.aliases.filter(isNumericColorAlias);
        if (numericAliases.length === entry.aliases.length) {
            continue;
        }
        if (entry.aliases.some(alias => alias && !isNumericColorAlias(alias) && normalizedToken.includes(alias))) {
            return entry.actual;
        }
    }

    return null;
}

/**
 * 归一化模型传入的 specifiedColors。契约形态是「颜色名数组的数组」string[][]，
 * 但模型高频误传对象数组 [{size,colors:[...]}] / [{colors}] / 混入非数组元素——
 * 旧代码 `as string[][]` 直接强转，下游对内层 combo 做 .map 崩 "e.map is not a function"
 * （真机两次复现，一次 94 秒）。这里两形态兼容 + 逐元素校验，非法元素带格式示例明确报错。
 * 返回 { combos, error }：error 非空表示输入非法，调用方应中止并回传该错误（不静默吞）。
 */
function normalizeSpecifiedColors(
    raw: unknown
): { combos: string[][] | undefined; error?: string } {
    if (raw === undefined || raw === null) return { combos: undefined };
    const formatHint = '正确格式：颜色名数组的数组，如 [["双层边","木耳边"],["水晶丝","花苞"]]（每个内层数组是一个组合）。';
    if (!Array.isArray(raw)) {
        return { combos: undefined, error: `specifiedColors 必须是数组，收到 ${typeof raw}。${formatHint}` };
    }
    if (raw.length === 0) return { combos: undefined };
    const combos: string[][] = [];
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        // 形态1：内层就是颜色名数组 ["双层边","木耳边"]
        let colorList: unknown = item;
        // 形态2：对象 {size?, colors:[...]} —— 取 colors 字段
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            colorList = (item as any).colors ?? (item as any).colorNames ?? (item as any).colorList;
        }
        if (!Array.isArray(colorList)) {
            return { combos: undefined, error: `specifiedColors[${i}] 不是颜色名数组（也不含 colors 字段）。${formatHint}` };
        }
        const colors = colorList.map((c) => String(c ?? '').trim()).filter(Boolean);
        if (colors.length === 0) {
            return { combos: undefined, error: `specifiedColors[${i}] 的颜色列表为空。${formatHint}` };
        }
        combos.push(colors);
    }
    return { combos };
}

function parseRequestedExplicitCombos(userInput: string, availableColors: string[]): string[][] {
    const text = String(userInput || '').trim();
    if (!text) return [];

    const aliasEntries = buildColorAliasEntries(availableColors);
    if (aliasEntries.length === 0) return [];

    const combos: string[][] = [];
    const clauses = text
        .replace(/[“”"'`]/g, '')
        .split(/[；;。！？!\n]/)
        .map(item => item.trim())
        .filter(Boolean);

    for (const clause of clauses) {
        if (!/[+＋、，,\/／|｜]/.test(clause)) continue;

        const tokens = clause
            .split(/[+＋、，,\/／|｜]/)
            .map(item => item.trim())
            .filter(Boolean);

        const resolved = tokens
            .map(token => resolveColorToken(token, aliasEntries))
            .filter((color): color is string => !!color);

        if (resolved.length >= 1) {
            combos.push(resolved);
        }
    }

    return combos;
}

/**
 * 解析"确认续跑"文本里用户在交互卡上确认/编辑的组合（真实颜色名 + 严格格式）。
 * 格式契约（由 ChatPanel 的确认处理器产出）：每规格一段 `N双装：色A+色B / 色C+色D`，
 * 段间用 `；` 或换行分隔——组合之间用 `/` 分隔、组合内颜色用 `+` 分隔（两者严格区分，
 * 解决通用解析器把 `，`/`/` 都当颜色分隔导致多组合被错误合并的问题）。
 * 只在"确认续跑"文本上调用，返回真实颜色名的扁平组合列表（每个组合长度=其规格）。
 * 这样即便颜色名是"白色/绿色"这种非数字命名，也能正确落回用户确认的组合、不被重新生成。
 */
function parseConfirmedSkuCombosFromResumeText(userInput: string, availableColors: string[]): string[][] {
    const text = String(userInput || '').trim();
    if (!text) return [];
    const aliasEntries = buildColorAliasEntries(availableColors);
    if (aliasEntries.length === 0) return [];

    const combos: string[][] = [];
    // 逐个匹配 "N双装：<组合列表>"，组合列表在遇到分号/句号/换行前结束
    // （句号必须作为终止符：末规格组后跟的是"。需要生成自选备注。…"这类尾巴文本，
    //  不终止会把尾巴吞进最后一个组合把它撑坏）
    const sectionPattern = /(\d{1,2})\s*双装?\s*[:：]\s*([^；;。\n\r]+)/g;
    let match: RegExpExecArray | null;
    while ((match = sectionPattern.exec(text)) !== null) {
        const size = parseInt(match[1], 10);
        if (!isReasonableSkuSize(size)) continue;
        const comboList = String(match[2] || '').trim();
        // 组合之间用 / 或 ／ 分隔
        const comboChunks = comboList.split(/[\/／]/).map(chunk => chunk.trim()).filter(Boolean);
        for (const chunk of comboChunks) {
            // 组合内颜色用 + 分隔（不含 / 和 ，，避免跨组合合并）
            const tokens = chunk.split(/[+＋]/).map(token => token.trim()).filter(Boolean);
            const resolved = tokens
                .map(token => resolveColorToken(token, aliasEntries))
                .filter((color): color is string => !!color);
            // 只接受完整解析、且颜色数与声明规格一致的组合，避免把"请基于确认后的组合继续执行"这类
            // 尾巴文本误当成组合
            if (resolved.length === size) {
                combos.push(resolved);
            }
        }
    }
    return combos;
}

interface StructuredSkuComboConfirmation {
    provided: boolean;
    combos: string[][];
    sizes: number[];
    generateSelfSelectNotes?: boolean;
    error?: string;
}

/**
 * 交互卡确认以结构化 submission 为唯一新链路；文本解析只保留给历史会话兼容。
 * Slot → 颜色名的解释属于 SKU Skill，本函数不会把 SKU 语义上移到通用 Agent。
 */
function resolveStructuredSkuComboConfirmation(
    params: Record<string, any>,
    availableColors: string[]
): StructuredSkuComboConfirmation {
    const card = params.interactiveCardDefinition as SkuComboEditorCard | undefined;
    const submission = params.interactiveCardSubmission as InteractiveCardSubmission<SkuComboEditorValue> | undefined;
    const isSkuComboContinuation = card?.version === 'interactive-card/v0'
        && card.kind === 'sku_combo_editor';
    if (!isSkuComboContinuation && submission?.kind !== 'sku_combo_editor') {
        return { provided: false, combos: [], sizes: [] };
    }
    if (!card || card.payload?.version !== 'sku-combo-editor/v0' || !submission) {
        return {
            provided: true,
            combos: [],
            sizes: [],
            error: 'SKU 组合确认缺少原卡片或结构化提交，已停止执行。'
        };
    }
    if (submission.cardId !== card.id || submission.kind !== card.kind) {
        return {
            provided: true,
            combos: [],
            sizes: [],
            error: 'SKU 组合提交与原确认卡不匹配，已停止执行。'
        };
    }
    const validation = validateSkuComboEditorValue(card.payload, submission.value);
    if (!validation.canSubmit) {
        return {
            provided: true,
            combos: [],
            sizes: [],
            error: validation.blockers.join('；') || 'SKU 组合确认内容没有通过校验。'
        };
    }
    const aliasEntries = buildColorAliasEntries(availableColors);
    const confirmedColorSlots = validation.normalizedValue.colorSlots || card.payload.colorSlots;
    const labelBySlot = new Map(
        confirmedColorSlots.map((slot) => [slot.slot, slot.label])
    );
    const combos: string[][] = [];
    for (const group of validation.normalizedValue.groups) {
        for (const combo of group.combos) {
            const colors = combo.map((slot) => {
                const label = labelBySlot.get(slot);
                return label ? resolveColorToken(label, aliasEntries) : null;
            });
            if (colors.length !== group.size || colors.some((color) => !color)) {
                return {
                    provided: true,
                    combos: [],
                    sizes: [],
                    error: `${group.size}双装组合包含当前 SKU 文档中不存在的颜色，已停止执行。`
                };
            }
            combos.push(colors as string[]);
        }
    }
    return {
        provided: true,
        combos,
        sizes: Array.from(new Set(validation.normalizedValue.groups.map((group) => group.size))).sort((a, b) => a - b),
        generateSelfSelectNotes: validation.normalizedValue.generateSelfSelectNotes
    };
}

function hasApprovedStructuredSkuTemplateConfirmation(params: Record<string, any>): boolean {
    const card = params.interactiveCardDefinition as EditableConfirmationCard | undefined;
    const submission = params.interactiveCardSubmission as InteractiveCardSubmission<EditableConfirmationValue> | undefined;
    if (card?.kind !== 'editable_confirmation' || submission?.kind !== 'editable_confirmation') {
        return false;
    }
    if (card.id !== submission.cardId || card.payload?.version !== 'editable-confirmation/v0') {
        return false;
    }
    const validation = validateEditableConfirmationValue(card.payload, submission.value);
    return validation.canSubmit
        && String(validation.normalizedValue.values.template_confirmation || '').trim() === '确认';
}

function resolveRequestedMonochromeColors(userInput: string, availableColors: string[]): string[] {
    const text = String(userInput || '').trim();
    if (!text) return [];

    const asksExtraCombo = /(增加|新增|再加|再增加|额外)/.test(text)
        && /(组合|搭配|款式)/.test(text);

    if (!asksExtraCombo) return [];

    const resolved: string[] = [];
    const pushResolved = (color?: string | null) => {
        if (!color) return;
        if (!resolved.includes(color)) resolved.push(color);
    };

    for (const color of availableColors) {
        const normalized = normalizeColorKey(color);
        if (!normalized) continue;

        const aliases = Array.from(new Set([
            color,
            color.replace(/色$/u, ''),
            normalized,
            normalized.replace(/色$/u, '')
        ].filter(Boolean)));

        const matched = aliases.some(alias => {
            const pattern = new RegExp(`(?:全|纯)?${escapeRegExp(alias)}(?:色)?`);
            return pattern.test(text);
        });

        if (matched) {
            pushResolved(color);
        }
    }

    if (resolved.length === 0 && /(全白|纯白|白色\+白色|全是白色|都是白色)/.test(text)) {
        pushResolved(availableColors.find(color => /白/.test(color)));
    }

    return resolved;
}

function appendRequestedExtraCombos(
    combosBySize: Record<number, string[][]>,
    comboSizes: number[],
    requestedMonochromeColors: string[]
): { added: Array<{ size: number; combo: string[] }>; skipped: string[] } {
    const added: Array<{ size: number; combo: string[] }> = [];
    const skipped: string[] = [];

    for (const size of comboSizes) {
        if (!combosBySize[size]) combosBySize[size] = [];
        const existing = new Set(combosBySize[size].map(buildComboIdentity));

        for (const color of requestedMonochromeColors) {
            const combo = Array(size).fill(color);
            const comboKey = buildComboIdentity(combo);
            if (existing.has(comboKey)) {
                skipped.push(`${size}双=${combo.join('+')}`);
                continue;
            }

            combosBySize[size].push(combo);
            existing.add(comboKey);
            added.push({ size, combo });
        }
    }

    return { added, skipped };
}

function appendRequestedSpecificCombos(
    combosBySize: Record<number, string[][]>,
    requestedCombos: string[][]
): { added: Array<{ size: number; combo: string[] }>; skipped: string[] } {
    const added: Array<{ size: number; combo: string[] }> = [];
    const skipped: string[] = [];

    for (const combo of requestedCombos) {
        const size = combo.length;
        if (!isReasonableSkuSize(size)) continue;

        if (!combosBySize[size]) combosBySize[size] = [];
        const existing = new Set(combosBySize[size].map(buildComboIdentity));
        const comboKey = buildComboIdentity(combo);

        if (existing.has(comboKey)) {
            skipped.push(`${size}双=${combo.join('+')}`);
            continue;
        }

        combosBySize[size].push(combo);
        existing.add(comboKey);
        added.push({ size, combo });
    }

    return { added, skipped };
}

function summarizeTemplateAvailability(options: {
    templateDir?: string;
    projectTemplates: TemplateLibraryItem[];
    localTemplates: TemplateLibraryItem[];
    localSpecs: number[];
}): string {
    const lines: string[] = [];
    const hasProjectTemplateDir = Boolean(String(options.templateDir || '').trim());
    const projectCount = options.projectTemplates.length;
    const localCount = options.localTemplates.length;
    const projectSpecs = collectSizesFromLibrary(options.projectTemplates);
    const localSpecs = options.localSpecs.length > 0
        ? options.localSpecs
        : collectSizesFromLibrary(options.localTemplates);

    if (hasProjectTemplateDir) {
        if (projectCount > 0) {
            lines.push(`当前项目模板文件夹已识别 ${projectCount} 个模板文件`);
            if (projectSpecs.length > 0) {
                lines.push(`当前项目模板可用规格：${projectSpecs.join(' / ')}双`);
            }
        } else {
            lines.push('当前项目模板文件夹没有识别到可用的 PSD/PSB/TIF/TIFF 模板');
        }
    }

    if (localCount > 0) {
        lines.push(`备用 SKU 模板可用：${localCount} 个`);
        if (localSpecs.length > 0) {
            lines.push(`备用模板可用规格：${localSpecs.join(' / ')}双`);
        }
    } else {
        lines.push('备用 SKU 模板当前也没有可用模板');
    }

    lines.push('支持的模板命名示例：2双装、3双装、4双装、2双模板');
    return lines.map(line => `- ${line}`).join('\n');
}

function normalizeTemplateCandidate(item: any): TemplateLibraryItem | null {
    if (!item || typeof item.filePath !== 'string' || !TEMPLATE_FILE_PATTERN.test(item.filePath)) {
        return null;
    }
    return {
        id: String(item.id || ''),
        name: String(item.name || ''),
        filePath: String(item.filePath || ''),
        description: typeof item.description === 'string' ? item.description : undefined,
        metadata: item.metadata && typeof item.metadata === 'object'
            ? { comboSize: typeof item.metadata.comboSize === 'number' ? item.metadata.comboSize : undefined }
            : undefined,
        source: item.source === 'template-library' ? 'template-library' : 'local-library',
        sourcePriority: typeof item.sourcePriority === 'number' ? item.sourcePriority : 0
    };
}

async function loadSkuTemplateLibrary(): Promise<TemplateLibraryItem[]> {
    try {
        const list = await window.designEcho?.invoke?.('template-knowledge:getSKUTemplateCandidates');
        if (!Array.isArray(list)) return [];
        return list
            .map(normalizeTemplateCandidate)
            .filter((item): item is TemplateLibraryItem => !!item);
    } catch (error) {
        console.warn('[SKU-Batch] 加载模板候选失败:', error);
        return [];
    }
}

async function loadLocalLibrarySpecs(): Promise<number[]> {
    try {
        const specs = await window.designEcho?.invoke?.('template-knowledge:getAvailableSKUSpecs', {
            sources: ['local-library']
        });
        if (!Array.isArray(specs)) return [];
        return specs
            .map((size: any) => Number(size))
            .filter((size: number) => Number.isFinite(size) && size > 0)
            .sort((a: number, b: number) => a - b);
    } catch (error) {
        console.warn('[SKU-Batch] 加载本地模板库规格失败:', error);
        return [];
    }
}

async function scanProjectTemplateFiles(templateDir?: string): Promise<TemplateLibraryItem[]> {
    const dir = String(templateDir || '').trim();
    if (!dir) return [];

    try {
        const entries = await window.designEcho?.readDirectory?.(dir, {
            recursive: true
        });
        if (!Array.isArray(entries)) return [];

        const result: TemplateLibraryItem[] = [];
        const seen = new Set<string>();
        for (const entry of entries) {
            if (!entry || entry.type !== 'file' || typeof entry.path !== 'string') continue;
            const filePath = String(entry.path);
            if (!TEMPLATE_FILE_PATTERN.test(filePath)) continue;
            const normalizedPath = filePath.toLowerCase();
            if (seen.has(normalizedPath)) continue;
            seen.add(normalizedPath);
            const fileName = filePath.split(/[/\\]/).pop() || filePath;
            result.push({
                id: `project-${normalizedPath}`,
                name: fileName.replace(/\.[^.]+$/, ''),
                filePath,
                source: 'project-folder',
                sourcePriority: 0
            });
        }
        return result;
    } catch (error) {
        console.warn('[SKU-Batch] 扫描项目模板目录失败:', error);
        return [];
    }
}

async function scanProjectSkuConfigFiles(configDir?: string): Promise<ProjectSkuConfigFile[]> {
    const dir = String(configDir || '').trim();
    if (!dir) return [];

    try {
        const entries = await window.designEcho?.readDirectory?.(dir, {
            recursive: true
        });
        if (!Array.isArray(entries)) return [];

        const result: ProjectSkuConfigFile[] = [];
        const seen = new Set<string>();
        for (const entry of entries) {
            if (!entry || entry.type !== 'file' || typeof entry.path !== 'string') continue;
            const filePath = String(entry.path);
            if (!SKU_CONFIG_FILE_PATTERN.test(filePath)) continue;
            const normalizedPath = filePath.toLowerCase();
            if (seen.has(normalizedPath)) continue;
            seen.add(normalizedPath);
            result.push({
                fileName: filePath.split(/[/\\]/).pop() || filePath,
                filePath
            });
        }
        return result;
    } catch (error) {
        console.warn('[SKU-Batch] 扫描项目 SKU 配置目录失败:', error);
        return [];
    }
}

async function loadProjectSkuConfigInputs(files: ProjectSkuConfigFile[]): Promise<SkuConfiguredFileInput[]> {
    const inputs: SkuConfiguredFileInput[] = [];
    for (const file of files) {
        try {
            const base64 = await window.designEcho?.readFile?.(file.filePath, 'base64');
            if (typeof base64 === 'string' && base64.trim()) {
                inputs.push({
                    fileName: file.fileName,
                    base64
                });
            }
        } catch (error) {
            console.warn('[SKU-Batch] 读取项目 SKU 配置失败:', file.fileName, error);
        }
    }
    return inputs;
}

function toConfiguredTemplateInputs(templates: TemplateLibraryItem[], noteMode: boolean): SkuConfiguredTemplateInput[] {
    return templates
        .filter((template) => {
            const name = String(template.filePath || template.name || '');
            const isNote = name.includes(NOTE_TEMPLATE_KEYWORD);
            return noteMode ? isNote : !isNote;
        })
        .map((template) => ({
            fileName: template.filePath.split(/[/\\]/).pop() || template.name,
            filePath: template.filePath
        }));
}

function isSkuSourceDesignFile(file: any, skuKeyword: string): file is ProjectSkuSourceFile {
    const filePath = String(file?.path || '').trim();
    const fileName = String(file?.name || filePath.split(/[/\\]/).pop() || '').trim();
    if (!filePath || !fileName || !/\.(psd|psb)$/i.test(fileName)) return false;

    const keyword = normalizeNameWithoutExt(skuKeyword || 'SKU');
    const baseName = normalizeNameWithoutExt(fileName);
    return isSkuSourceDocumentBaseName(baseName, keyword);
}

function scoreProjectSkuSourceFile(file: ProjectSkuSourceFile, skuKeyword: string, projectPath?: string): number {
    const keyword = normalizeNameWithoutExt(skuKeyword || 'SKU');
    const fileName = String(file.name || file.path.split(/[/\\]/).pop() || '');
    const baseName = normalizeNameWithoutExt(fileName);
    const normalizedPath = normalizePathForCompare(file.path);
    const normalizedRelative = normalizePathForCompare(file.relativePath || '');

    let score = 0;
    if (baseName === keyword) score += 100;
    else if (isSkuSourceDocumentBaseName(baseName, keyword)) score += 70;

    if (projectPath && isPathInsideDirectory(file.path, projectPath)) score += 25;
    if (/(^|\\)psd(\\|$)/i.test(normalizedPath) || /(^|\\)psd(\\|$)/i.test(normalizedRelative)) score += 12;
    if (/\.psd$/i.test(fileName)) score += 6;
    if (/\.psb$/i.test(fileName)) score += 5;
    return score;
}

function pickBestProjectSkuSourceFile(
    files: any[],
    skuKeyword: string,
    projectPath?: string
): ProjectSkuSourceFile | null {
    const candidates = (Array.isArray(files) ? files : [])
        .filter((file) => isSkuSourceDesignFile(file, skuKeyword))
        .map((file) => ({
            name: String(file.name || file.path.split(/[/\\]/).pop() || ''),
            path: String(file.path || ''),
            relativePath: typeof file.relativePath === 'string' ? file.relativePath : undefined,
            score: scoreProjectSkuSourceFile(file, skuKeyword, projectPath)
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.name.localeCompare(b.name, 'zh-CN');
        });

    if (candidates.length === 0) return null;
    const { score: _score, ...candidate } = candidates[0];
    return candidate;
}

const SKU_CONTRAST_PAIR_SCORING_ENABLED = false;

/**
 * 生成指定大小的颜色组合（含组合模式评分）
 */
function generateCombinationsOfSize(
    colors: string[], size: number, count: number
): string[][] {
    const totalColors = colors.length;
    if (totalColors === 0 || size <= 0 || count <= 0) return [];

    const buildCountsKey = (counts: number[]) => counts.join(',');
    const countsToCombo = (counts: number[]) => {
        const combo: string[] = [];
        for (let i = 0; i < counts.length; i++) {
            for (let k = 0; k < counts[i]; k++) combo.push(colors[i]);
        }
        return combo;
    };

    const buildContrastPairs = () => {
        if (totalColors < 4) return new Set<string>();
        const dist = Math.floor(totalColors / 2);
        const pairs = new Set<string>();
        for (let i = 0; i < totalColors; i++) {
            const j = (i + dist) % totalColors;
            const a = Math.min(i, j);
            const b = Math.max(i, j);
            pairs.add(`${a}-${b}`);
        }
        return pairs;
    };

    const isStraight = (counts: number[]) => {
        const idxs = counts.map((c, i) => (c > 0 ? i : -1)).filter(i => i >= 0);
        if (idxs.length !== size) return false;
        idxs.sort((a, b) => a - b);
        let consecutive = true;
        for (let i = 1; i < idxs.length; i++) {
            if (idxs[i] !== idxs[i - 1] + 1) {
                consecutive = false;
                break;
            }
        }
        if (consecutive) return true;
        const wrapped = idxs[0] === 0 && idxs[idxs.length - 1] === totalColors - 1;
        if (!wrapped) return false;
        for (let i = 1; i < idxs.length; i++) {
            if (idxs[i] !== idxs[i - 1] + 1) return false;
        }
        return true;
    };

    const buildPatternCandidates = () => {
        const candidates: number[][] = [];
        const seen = new Set<string>();
        const push = (counts: number[]) => {
            const key = buildCountsKey(counts);
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push(counts);
        };

        for (let i = 0; i < totalColors; i++) {
            const counts = new Array(totalColors).fill(0);
            counts[i] = size;
            push(counts);
        }

        if (totalColors >= size) {
            for (let start = 0; start < totalColors; start++) {
                const counts = new Array(totalColors).fill(0);
                for (let k = 0; k < size; k++) counts[(start + k) % totalColors] = 1;
                push(counts);
            }
        }

        if (size >= 2) {
            for (let i = 0; i < totalColors; i++) {
                for (let j = 0; j < totalColors; j++) {
                    if (j === i) continue;
                    const counts = new Array(totalColors).fill(0);
                    counts[i] = 2;
                    let remaining = size - 2;
                    for (let k = 0; k < totalColors && remaining > 0; k++) {
                        if (k === i) continue;
                        const add = Math.min(1, remaining);
                        counts[k] += add;
                        remaining -= add;
                    }
                    if (remaining > 0) counts[i] += remaining;
                    push(counts);
                }
            }
        }

        if (size >= 4) {
            for (let i = 0; i < totalColors; i++) {
                for (let j = i + 1; j < totalColors; j++) {
                    const counts = new Array(totalColors).fill(0);
                    counts[i] = 2;
                    counts[j] = 2;
                    let remaining = size - 4;
                    for (let k = 0; k < totalColors && remaining > 0; k++) {
                        if (k === i || k === j) continue;
                        counts[k] += 1;
                        remaining -= 1;
                    }
                    if (remaining > 0) counts[i] += remaining;
                    push(counts);
                }
            }
        }

        if (size >= 3) {
            for (let i = 0; i < totalColors; i++) {
                for (let j = 0; j < totalColors; j++) {
                    if (j === i) continue;
                    const counts = new Array(totalColors).fill(0);
                    counts[i] = 3;
                    let remaining = size - 3;
                    for (let k = 0; k < totalColors && remaining > 0; k++) {
                        if (k === i) continue;
                        const add = Math.min(1, remaining);
                        counts[k] += add;
                        remaining -= add;
                    }
                    if (remaining > 0) counts[i] += remaining;
                    push(counts);
                }
            }
        }

        const randomCounts = () => {
            const counts = new Array(totalColors).fill(0);
            for (let t = 0; t < size; t++) {
                counts[Math.floor(Math.random() * totalColors)] += 1;
            }
            return counts;
        };

        const extraTarget = Math.max(200, count * 60);
        let attempts = 0;
        while (candidates.length < extraTarget && attempts < extraTarget * 8) {
            push(randomCounts());
            attempts++;
        }

        return candidates;
    };

    const candidates = buildPatternCandidates();
    const contrastPairs = SKU_CONTRAST_PAIR_SCORING_ENABLED
        ? buildContrastPairs()
        : new Set<string>();

    const usage = new Array(totalColors).fill(0);
    const selected: number[][] = [];
    const usedKeys = new Set<string>();

    const scoreCandidate = (counts: number[]) => {
        const next = usage.map((u, i) => u + counts[i]);
        const mean = next.reduce((a, b) => a + b, 0) / next.length;
        const variance = next.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / next.length;
        const balanceScore = -Math.sqrt(variance);

        let missingBonus = 0;
        for (let i = 0; i < totalColors; i++) {
            if (usage[i] === 0 && counts[i] > 0) missingBonus += 2.5;
        }

        let contrastBonus = 0;
        if (contrastPairs.size > 0) {
            for (const pair of contrastPairs) {
                const [aStr, bStr] = pair.split('-');
                const a = parseInt(aStr, 10);
                const b = parseInt(bStr, 10);
                if (counts[a] > 0 && counts[b] > 0) {
                    contrastBonus += 1.2 + 0.2 * Math.min(counts[a], counts[b]);
                }
            }
        }

        const maxCount = Math.max(...counts);
        const distinct = counts.filter(c => c > 0).length;
        let patternBonus = 0;
        if (distinct === 1) patternBonus -= 1.5;
        if (isStraight(counts)) patternBonus += 1.6;
        if (maxCount >= 3) patternBonus += 1.2;
        const pairs = counts.filter(c => c === 2).length;
        if (pairs >= 2) patternBonus += 1.8;
        else if (pairs === 1) patternBonus += 0.9;

        return balanceScore + missingBonus + contrastBonus + patternBonus;
    };

    const pickBest = () => {
        let bestIdx = -1;
        let bestScore = -Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const counts = candidates[i];
            const key = buildCountsKey(counts);
            if (usedKeys.has(key)) continue;
            const score = scoreCandidate(counts);
            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        if (bestIdx === -1) return null;
        const chosen = candidates[bestIdx];
        usedKeys.add(buildCountsKey(chosen));
        for (let i = 0; i < totalColors; i++) usage[i] += chosen[i];
        selected.push(chosen);
        return chosen;
    };

    while (selected.length < count) {
        const chosen = pickBest();
        if (!chosen) break;
    }

    const missing = usage
        .map((u, i) => ({ u, i }))
        .filter(x => x.u === 0)
        .map(x => x.i);

    if (missing.length > 0 && selected.length > 0) {
        for (const missIdx of missing) {
            const replacement = candidates
                .filter(c => c[missIdx] > 0)
                .filter(c => !usedKeys.has(buildCountsKey(c)))
                .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
            if (!replacement) continue;

            let worstIdx = -1;
            let worstScore = Infinity;
            for (let i = 0; i < selected.length; i++) {
                const s = scoreCandidate(selected[i]);
                if (s < worstScore) {
                    worstScore = s;
                    worstIdx = i;
                }
            }
            if (worstIdx >= 0) {
                usedKeys.delete(buildCountsKey(selected[worstIdx]));
                usedKeys.add(buildCountsKey(replacement));
                selected[worstIdx] = replacement;
            }
        }
    }

    return selected.map(countsToCombo);
}

function hasConfirmedSkuComboText(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text) return false;
    return /(?:我已确认|已确认|确认使用|确认后的组合|基于确认后的组合).{0,48}(?:SKU|sku)?.{0,32}(?:组合|配方)/i.test(text)
        || /(?:SKU|sku)?.{0,24}(?:组合|配方).{0,48}(?:我已确认|已确认|确认使用|确认后)/i.test(text);
}

function hasConfirmedSkuCardTemplateDesignText(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text) return false;
    if (hasDeclinedSkuCardTemplateDesignText(text)) {
        return false;
    }
    if (/(?:模板方向确认)[:：]\s*(?:确认|是|同意|可以)/.test(text)) {
        return true;
    }
    return /(?:我已确认|已确认|确认使用|确认后的|基于确认后的).{0,48}(?:SKU|sku)?.{0,32}(?:色卡模板|卡片模板|排版模板|模板设计|模板方案)/i.test(text)
        || /(?:SKU|sku)?.{0,24}(?:色卡模板|卡片模板|排版模板|模板设计|模板方案).{0,48}(?:我已确认|已确认|确认使用|确认后)/i.test(text);
}

function shouldPreferExistingSkuSource(input: {
    params: Record<string, any>;
    userInput: string;
    sourceOnly: boolean;
}): boolean {
    if (input.sourceOnly) return false;
    if (input.params.preferExistingSkuSourceForCardPreparation === true) return true;
    const text = String(input.userInput || '').trim();
    if (!text) return false;
    const mentionsExisting = /(已有|现有|已经有|项目中有|当前项目.*有|基于已有|基于现有|基于我们项目中)/.test(text);
    const mentionsSkuSource = /(?:SKU|sku|色卡素材|色卡源|颜色素材|颜色组|素材文档)/.test(text);
    const rejectsRebuild = /(不要|无需|不用|不需要|别|先别).{0,16}(?:重新|重建|再做|创建|生成).{0,16}(?:色卡|源素材|素材文档)/.test(text);
    const asksTemplateFromSku = /(?:基于|使用|用).{0,24}(?:SKU|sku|色卡素材|色卡源).{0,24}(?:模板|排版模板|组合|自选)/.test(text);
    return (mentionsExisting && mentionsSkuSource) || rejectsRebuild || asksTemplateFromSku;
}

// shouldAutoPrepareSkuCardTemplateForProduction 已删除（治理2026-07-02）：
// 它让"缺模板+生产措辞"静默跳过模板方向确认、直落硬编码占位模板——与
// 「默认路径必须走 确认模板方向 → 移交 Agent 自主设计」的治理语义相反。
// 缺模板路由的单一真相源见 shared/sku-template-design-loop.ts（resolveSkuTemplatePreparationRoute）。

/**
 * 从项目产品画面观察派生确认卡默认值：
 * 产品类型与风格只来自结构化视觉观察，不读取任务文本、不推断品类；拿不到观察时
 * 用中性文案「按项目产品与风格自定」，把方向留给用户与后续设计判断。
 * 另：默认文案刻意避开 sku_template 任务类型的 excludeSignals（如「出图」「批量」），
 * 避免确认卡重提交文本命中排除信号、误杀后续纪律激活（防御层；声明式激活见 declaredTaskTypeId）。
 */
function deriveSkuCardTemplateDesignCardDefaults(understanding?: ProjectProductUnderstanding | null): {
    productLabel: string;
    styleText: string;
} {
    const productType = String(understanding?.observations.productTypes[0] || '').trim();
    const styleTags = Array.isArray(understanding?.observations.styleTags)
        ? understanding.observations.styleTags
        : [];
    return {
        productLabel: productType,
        styleText: styleTags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 3).join('、')
    };
}

function buildSkuCardTemplateDesignConfirmationCard(input: {
    projectId?: string;
    comboSizes: number[];
    colorCount: number;
    understanding?: ProjectProductUnderstanding | null;
}) {
    const comboSizesText = input.comboSizes.length > 0
        ? input.comboSizes.map((size) => `${size}双`).join(' / ')
        : '2双 / 3双 / 4双';
    const colorCountText = input.colorCount > 0 ? `${input.colorCount} 个颜色` : '当前颜色';
    const { productLabel, styleText } = deriveSkuCardTemplateDesignCardDefaults(input.understanding);

    return buildEditableConfirmationInteractiveCard({
        id: 'sku-card-template-design-confirmation',
        title: '确认 SKU 色卡模板方向',
        description: '先确认模板版式和复核重点，确认后由我参考项目素材与设计参考自主设计可编辑模板，并自动添加与规格数一致的占位符；只有你明确要求时才使用通用占位模板（非设计稿）兜底。',
        projectId: input.projectId,
        ...(productLabel ? { productType: productLabel } : {}),
        ...(styleText ? { style: styleText } : {}),
        memoryEnabled: true,
        memoryKind: 'project_rule',
        tags: ['sku', '色卡模板'],
        fields: [
            {
                id: 'template_confirmation',
                label: '模板方向确认',
                type: 'choice',
                value: '确认',
                options: [
                    { value: '确认', label: '确认这个方向' },
                    { value: '需要调整', label: '需要先调整' }
                ],
                required: true
            },
            {
                id: 'style_direction',
                label: '视觉方向',
                type: 'long_text',
                value: styleText
                    ? `延续项目素材已识别的风格（${styleText}），背景干净、商品卡片清晰留白。`
                    : '按项目产品与素材风格自定，背景干净、商品卡片清晰留白；如需特定风格请在此补充。',
                required: true,
                maxLength: 160
            },
            {
                id: 'combo_layout',
                label: '组合版式',
                type: 'long_text',
                value: `${comboSizesText}；每组从 ${colorCountText} 中选择，卡片间距统一，主体不溢出。`,
                required: true,
                maxLength: 180
            },
            {
                id: 'note_layout',
                label: '自选备注',
                type: 'long_text',
                value: '保留自选备注标题和留言提示，色卡区整齐排列，后续可直接填写颜色组合。',
                required: true,
                maxLength: 180
            },
            {
                id: 'acceptance_focus',
                label: '复核重点',
                type: 'long_text',
                value: `${productLabel || '产品'}图不溢出；卡片圆角和边距统一；标题、颜色名和备注清晰；交付前再看真实画面。`,
                required: true,
                maxLength: 220
            },
            {
                id: 'allow_basic_template',
                label: '允许先生成可编辑基础模板',
                type: 'boolean',
                value: true,
                required: true
            }
        ]
    });
}

// ==================== SKU 执行器 ====================

export const skuBatchExecutor: SkillExecutor = {
    skillId: 'sku-batch',

    resolvePreExecutionResult({ params, context }: SkillExecuteParams): AgentResult | null {
        const userInput = String(
            context?.userInput || params.userIntent || params.userTask || params.task || params.userInput || ''
        ).trim();
        if (!shouldHoldSkuBatchForAgentDesignDecision({ userInput, params })) return null;

        const skuWorkflowStagePlan = buildSkuWorkflowStagePlan({
            userInput,
            hasExistingSkuSource: params.preferExistingSkuSourceForCardPreparation === true
        });
        const handoffContract = buildSkuTemplateDesignHandoffContract({
            missingSizes: normalizeSkuSizeList(params.comboSizes),
            colorCount: undefined
        });
        return {
            success: false,
            message: handoffContract.message,
            error: handoffContract.message,
            nonFatal: true,
            data: {
                status: handoffContract.status,
                audience: handoffContract.audience,
                declaredDesignTaskTypeId: handoffContract.declaredDesignTaskTypeId,
                skuWorkflowStagePlan,
                requiredReferenceObservationTools: handoffContract.requiredReferenceObservationTools,
                completionChecklist: handoffContract.completionChecklist,
                suggestedNextActions: handoffContract.completionChecklist
            }
        } as AgentResult;
    },
    
    async execute({
        params,
        callbacks,
        signal,
        context: _context,
        runtimeDesignBriefDigest,
        runSkill
    }: SkillExecuteParams): Promise<AgentResult> {
        const emitStep = (
            kind: Parameters<typeof emitSkillStep>[1]['kind'],
            title: string,
            detail?: string,
            status: Parameters<typeof emitSkillStep>[1]['status'] = 'running',
            percent?: number
        ) => emitSkillStep(callbacks, { kind, title, detail, status, percent });
        const emitStatus = (message: string, percent?: number): void => {
            const normalized = String(message || '').trim();
            if (!normalized) return;
            callbacks?.onStatus?.(normalized);
            if (typeof percent === 'number') {
                callbacks?.onProgress?.(normalized, percent);
            }
        };
        const isCancelled = () => Boolean(signal?.aborted);
        const buildCancelledResult = (message = '任务已取消'): AgentResult => ({
            success: false,
            message,
            error: message,
            cancelled: true,
            stopReason: 'cancelled'
        } as AgentResult);

        const sourceOnly = params.sourceOnly === true;
        emitStep(
            'observation',
            sourceOnly ? '准备整理 SKU 色卡素材' : '准备处理 SKU 任务',
            sourceOnly
                ? '先识别适合做色卡的商品图，并创建色卡源文档。'
                : '读取项目素材、SKU 模板和 Photoshop 当前文档。',
            'running',
            0.03
        );
        emitStatus('正在分析 SKU 项目结构。', 6);

        // 并行加载项目上下文与模板候选
        const [projectContext, skuTemplateCandidates, localLibrarySpecs] = await Promise.all([
            getProjectContext(),
            loadSkuTemplateLibrary(),
            loadLocalLibrarySpecs()
        ]);
        const localSkuTemplates = skuTemplateCandidates.filter(item => item.source === 'local-library');
        if (localSkuTemplates.length > 0) {
            emitStatus('已读取 SKU 模板候选。', 8);
        }
        if (localLibrarySpecs.length > 0) {
            emitStatus('已读取 SKU 规格候选。', 8);
        }
        console.log('[SKU-Batch] 项目上下文:', projectContext);

        const runtimeProjectContext = _context?.projectContext;
        const earlyNormalizedUserInput = String(params.userIntent || _context?.userInput || '');
        const projectProductUnderstanding = buildProjectProductUnderstanding({
            assetIndex: runtimeProjectContext?.assetIndex,
            visualInsightCache: runtimeProjectContext?.visualInsightCache
        });
        const skuPlanningContext = {
            projectProductUnderstanding,
            ...(runtimeDesignBriefDigest ? { runtimeDesignBriefDigest } : {})
        };
        const earlySkuRequiredColorSlots = resolveEarlySkuRequiredColorSlots(params);
        let skuCardAssetCandidateReport = buildSkuCardAssetCandidateReport({
            assetIndex: runtimeProjectContext?.assetIndex,
            visualInsightCache: runtimeProjectContext?.visualInsightCache,
            maxCandidates: 8
        });
        let skuCardVisualConfirmationPlan = buildSkuCardVisualConfirmationPlan({
            skuCardAssetCandidateReport,
            maxCandidates: params.skuCardVisualConfirmationMaxCandidates || params.visualObservationRefreshMaxCandidates || 8
        });
        let skuCardVisualConfirmationRun: Record<string, any> | null = null;
        let skuCardSourcePreparationPlan: SkuCardSourcePreparationPlan | null = null;
        let skuCardSourcePreparationRun: Record<string, any> | null = null;
        let skuCardTemplatePreparationPlan: SkuCardTemplatePreparationPlan | null = null;
        let skuCardTemplatePreparationRun: Record<string, any> | null = null;

        const templateDir = projectContext?.projectPath ? `${projectContext.projectPath}\\模板文件` : undefined;
        const configDir = projectContext?.projectPath ? `${projectContext.projectPath}\\配置文件` : undefined;
        const outputDir = projectContext?.projectPath ? `${projectContext.projectPath}\\SKU` : undefined;
        let [projectSkuTemplates, projectSkuConfigFiles] = await Promise.all([
            scanProjectTemplateFiles(templateDir),
            // 治理2026-07-01：不再读取本地 SKU 配置 CSV（用户明确要求"不看本地CSV配置直接生成"）。
            // 项目里格式不规范的 CSV（如缺"模板"/"配色"列）会让整个 SKU 任务直接失败；现在组合一律
            // 交给规范生成器出默认组合、或用户在确认卡上确认/编辑的组合，不依赖本地配置文件。
            Promise.resolve([] as Awaited<ReturnType<typeof scanProjectSkuConfigFiles>>)
        ]);
        if (isCancelled()) {
            return buildCancelledResult();
        }
        const allowLibraryTemplateFallback = shouldAllowLibraryTemplateFallback(
            projectContext?.projectPath,
            params.allowLibraryTemplateFallback,
            projectSkuTemplates.length
        );
        const skuCardVisualCoverage = skuCardAssetCandidateReport.visualInsightCoverage;
        const skuAssetReadinessSummary = `SKU 色卡素材候选 ${skuCardAssetCandidateReport.candidateCount} 张，已视觉确认 ${skuCardVisualCoverage.matchedCandidateCount} 张，待观察 ${skuCardVisualCoverage.candidatesNeedingConfirmation} 张。`;
        const skuTemplateReadinessSummary = `项目模板 ${projectSkuTemplates.length} 个，备用模板候选 ${localSkuTemplates.length} 个，项目配置 ${projectSkuConfigFiles.length} 个。`;
        if (projectSkuTemplates.length > 0) {
            emitStatus('已识别当前项目的 SKU 模板。', 10);
        } else if (projectContext?.projectPath && localSkuTemplates.length > 0) {
            emitStatus('当前项目模板不完整，将使用可用模板候选继续准备。', 10);
        }
        emitStep(
            'verification',
            sourceOnly ? 'SKU 色卡素材准备信息读取完成' : 'SKU 准备信息读取完成',
            sourceOnly
                ? `已读取项目素材和当前 Photoshop 文档：${skuAssetReadinessSummary}`
                : `已读取项目素材、SKU 模板和配置：${skuAssetReadinessSummary}${skuTemplateReadinessSummary}`,
            'success',
            0.08
        );
        if (!allowLibraryTemplateFallback && projectContext?.projectPath) {
            emitStatus('本轮会优先使用当前项目内的 SKU 文件。', 12);
        }
        if (projectSkuConfigFiles.length > 0) {
            emitStatus('已识别项目 SKU 配置，会优先按配置生成。', 12);
        }
        
        // 从 AI 决策中获取参数
        const skuKeyword = params.skuFileKeyword || 'SKU';
        const templateKeyword = params.templateKeyword || '';
        const excludeColors = params.excludeColors as string[] || [];

        console.log('[SKU-Batch] AI 提供的参数:', {
            skuKeyword, templateKeyword, excludeColors,
            comboSizes: params.comboSizes,
            countPerSize: params.countPerSize,
            sourceOnly
        });

        const safeToolCall = async (
            toolName: string,
            toolParams: Record<string, any>,
            timeoutMs: number,
            stage: string
        ): Promise<any> => {
            if (isCancelled()) {
                return {
                    success: false,
                    cancelled: true,
                    error: '任务已取消',
                    stage
                };
            }
            try {
                const result = await withTimeout(executeToolCall(toolName, toolParams, { signal }), timeoutMs, stage);
                if (isCancelled() && result?.cancelled !== true) {
                    return {
                        success: false,
                        cancelled: true,
                        error: '任务已取消',
                        stage
                    };
                }
                return result;
            } catch (error: any) {
                const message = error?.message || String(error);
                if (isCancelled() || /请求已取消|任务已取消|cancelled|canceled|abort/i.test(message)) {
                    return {
                        success: false,
                        cancelled: true,
                        error: '任务已取消',
                        stage
                    };
                }
                console.warn(`[SKU-Batch] ${stage} failed:`, message);
                return {
                    success: false,
                    timeout: /timeout/i.test(message),
                    error: message
                };
            }
        };

        const isModalStateError = (result: any): boolean =>
            /host is in a modal state/i.test(String(result?.error || result?.message || ''));

        const executeSkuLayoutWithModalRetry = async (
            toolParams: Record<string, any>,
            stage: string,
            timeoutMs = 5 * 60 * 1000
        ): Promise<any> => {
            let result = await safeToolCall('skuLayout', toolParams, timeoutMs, stage);
            if (!result?.success && isModalStateError(result)) {
                emitStep('warning', 'SKU 工具遇到 Photoshop modal state', '等待 Photoshop 释放状态后重试一次。', 'running', 0.68);
                await sleep(1800);
                try {
                    await refreshDocuments();
                } catch {}
                result = await safeToolCall('skuLayout', toolParams, timeoutMs, `${stage}-modal-retry`);
                if (result?.success) {
                    result = {
                        ...result,
                        retriedAfterModalState: true
                    };
                }
            }
            return result;
        };

        const preferExistingSkuSourceForCardPreparation = shouldPreferExistingSkuSource({
            params,
            userInput: earlyNormalizedUserInput,
            sourceOnly
        });
        const shouldAllowSkuCardSourcePreparation = !preferExistingSkuSourceForCardPreparation && (
            sourceOnly
            || params.allowSkuCardSourcePreparation === true
            || params.skuSourcePreparationMode === 'card-source-from-project-images'
        );
        const shouldAllowSkuCardTemplatePreparation = !sourceOnly && (
            params.allowSkuCardTemplatePreparation === true
            || params.skuTemplatePreparationMode === 'card-placeholder-templates'
        );

        const executeSkuCardSourcePreparationPlan = async (
            plan: SkuCardSourcePreparationPlan
        ): Promise<Record<string, any>> => {
            if (!runSkill) {
                return {
                    success: false,
                    status: 'blocked_sku_color_card_skill_runner_unavailable',
                    error: '统一 Skill runner 未注入，不能绕过 Registry 直接执行 SKU 色卡。'
                };
            }

            emitStep(
                'tool_planned',
                '委派 SKU 色卡能力',
                `将 ${plan.selectedSources.length} 张已确认素材交给独立 SKU 色卡 Skill 处理。`,
                'running',
                0.16
            );
            const childResult = await runSkill('sku-color-card', {
                params: {
                    sources: plan.selectedSources.map((source) => ({
                        filePath: source.path,
                        relativePath: source.relativePath,
                        assetId: source.assetId,
                        colorName: source.displayName || source.colorName
                    })),
                    outputPath: plan.outputDocumentPath,
                    canvasWidth: 1500,
                    canvasHeight: 1500,
                    cardWidth: 250,
                    cardHeight: 380,
                    cardCornerRadius: 10,
                    showIndexNumbers: true,
                    userIntent: earlyNormalizedUserInput
                },
                callbacks,
                signal,
                context: _context
            });
            const report = childResult?.data?.report;
            const preparedCards = Array.isArray(report?.preparedCards) ? report.preparedCards : [];

            return {
                success: childResult.success === true,
                status: childResult.success
                    ? (report?.status || 'structure_ready')
                    : (report?.failureStage || 'failed_sku_color_card_skill'),
                outputDocumentPath: report?.outputPath || plan.outputDocumentPath,
                sourceDocumentId: report?.documentId,
                requiresVisualAdjustment: report?.checks?.visualComposition !== 'passed',
                visualAdjustmentHandoff: childResult?.data?.visualAdjustmentHandoff,
                agentReActContinuation: childResult?.data?.agentReActContinuation,
                snapshot: childResult?.data?.snapshot,
                preparedGroups: preparedCards.map((card: any, index: number) => ({
                    colorName: String(index + 1),
                    displayName: card.colorName,
                    groupId: card.groupId,
                    layerId: card.smartObjectLayerId,
                    sourcePath: card.sourcePath
                })),
                snapshotResult: childResult?.data?.snapshotResult,
                saveResult: childResult?.data?.saveResult,
                toolResults: childResult.toolResults || [],
                report,
                error: childResult.error
            };
        };

        const executeSkuCardTemplatePreparationPlan = async (
            plan: SkuCardTemplatePreparationPlan
        ): Promise<Record<string, any>> => {
            const toolResults: Array<{ toolName: string; result: any; size?: number; templateKind?: string; outputPath?: string }> = [];
            const preparedTemplates: Array<{ size: number; kind: string; outputPath: string }> = [];

            const callTemplateTool = async (
                toolName: string,
                toolParams: Record<string, any>,
                stage: string,
                timeoutMs = 60 * 1000,
                meta: { size?: number; templateKind?: string; outputPath?: string } = {}
            ) => {
                callbacks?.onToolStart?.(toolName);
                const result = await safeToolCall(toolName, toolParams, timeoutMs, stage);
                callbacks?.onToolComplete?.(toolName, result);
                toolResults.push({ toolName, result, ...meta });
                return result;
            };

            emitStep(
                'tool_planned',
                '准备 SKU 模板',
                `将准备 ${plan.templateOutputs.length} 个 SKU 占位模板。`,
                'running',
                0.43
            );

            for (const output of plan.templateOutputs) {
                const requests = plan.toolRequests.filter((request) =>
                    request.size === output.size && request.templateKind === output.kind
                );

                for (const request of requests) {
                    const timeoutMs = request.toolName === 'saveDocument' ? 2 * 60 * 1000 : 60 * 1000;
                    const result = await callTemplateTool(
                        request.toolName,
                        request.params,
                        `sku-card-template-${output.size}-${output.kind}-${request.toolName}`,
                        timeoutMs,
                        {
                            size: output.size,
                            templateKind: output.kind,
                            outputPath: output.outputPath
                        }
                    );
                    if (!result?.success) {
                        return {
                            success: false,
                            status: `failed_${request.toolName}`,
                            error: result?.error || result?.message || `${output.name} 模板准备失败。`,
                            failedTemplate: output,
                            toolResults,
                            preparedTemplates
                        };
                    }
                }

                preparedTemplates.push({
                    size: output.size,
                    kind: output.kind,
                    outputPath: output.outputPath
                });
            }

            emitStep(
                'verification',
                'SKU 模板准备完成',
                `已准备 ${preparedTemplates.length} 个 SKU 占位模板。`,
                'success',
                0.46
            );

            return {
                success: true,
                status: 'prepared',
                preparedTemplates,
                toolResults
            };
        };

        // 1. 获取文档列表
        callbacks?.onToolStart?.('listDocuments');
        let docsResult = await executeToolCall('listDocuments', { includeDetails: true }, { signal });
        callbacks?.onToolComplete?.('listDocuments', docsResult);

        const refreshDocuments = async () => {
            docsResult = await executeToolCall('listDocuments', { includeDetails: true }, { signal });
            return docsResult;
        };

        if (!docsResult?.success) {
            const docsErrorDetail = sanitizeUserVisibleDiagnosticText(String(docsResult?.error || 'UXP 插件未连接'))
                || '请在 PS 中打开 DesignEcho 插件面板，确认顶部显示已连接后再试。';
            const docsReadBlockerMessage = '当前还不能读取已打开的设计文档，因此暂时不能继续处理 SKU。';
            emitStep('warning', 'SKU 文档列表读取失败', docsErrorDetail, 'error', 0.12);
            return {
                success: false,
                message: docsReadBlockerMessage,
                error: docsErrorDetail
            };
        }

        const matchLibraryOpenedDoc = (template: TemplateLibraryItem, size: number, noteMode: boolean): any | null => {
            const docs = docsResult?.documents || [];
            const fileName = normalizeNameWithoutExt(template.filePath.split(/[/\\]/).pop() || '');
            const displayName = normalizeNameWithoutExt(template.name || '');

            return docs.find((d: any) => {
                if (template.source === 'project-folder' && !isDocumentFromTemplateDirectory(d, templateDir)) {
                    return false;
                }
                if (isExactTemplateDocument(d, template.filePath)) {
                    return true;
                }
                const name = normalizeNameWithoutExt(d?.name || '');
                if (!name) return false;
                if (name.includes(skuKeyword.toLowerCase())) return false;
                const hasNote = name.includes(NOTE_TEMPLATE_KEYWORD);
                if (noteMode && !hasNote) return false;
                if (!noteMode && hasNote) return false;

                if (name === fileName || name === displayName || name.includes(fileName) || name.includes(displayName)) {
                    return true;
                }

                const inferredSize = extractComboSize(name);
                if (inferredSize === size && name.includes('模板')) return true;
                return false;
            }) || null;
        };

        const findOpenedTemplateDocument = (options: {
            size: number;
            noteMode: boolean;
            templateKeyword?: string;
        }): any | null => {
            const docs = docsResult?.documents || [];
            const sizeKeyword = `${options.size}双`;
            const keyword = String(options.templateKeyword || '').trim().toLowerCase();

            const matches = docs.filter((d: any) => {
                if (!d?.name) return false;
                if (!isDocumentFromTemplateDirectory(d, templateDir)) return false;

                const name = String(d.name || '').toLowerCase();
                if (name.includes(skuKeyword.toLowerCase())) return false;

                const hasNote = name.includes(NOTE_TEMPLATE_KEYWORD);
                if (options.noteMode !== hasNote) return false;

                if (keyword && !name.includes(keyword)) return false;

                if (options.noteMode) {
                    return name.includes(sizeKeyword);
                }

                return name.includes(sizeKeyword) && (name.includes(`${options.size}双装`) || name.includes(`${options.size}双模板`) || name.includes('模板'));
            });

            return matches
                .sort((left: any, right: any) => {
                    const score = (doc: any): number => {
                        const text = `${doc?.name || ''} ${doc?.path || ''}`;
                        let value = 0;
                        if (isCardStyleTemplateText(text)) value += 100;
                        const revision = scoreSkuCardTemplateRevision(text);
                        if (revision >= CURRENT_GENERATED_CARD_TEMPLATE_REVISION) value += 30 + revision;
                        else if (revision > 0) value -= 15;
                        if (String(doc?.path || '').includes(templateDir || '')) value += 10;
                        return value;
                    };
                    return score(right) - score(left);
                })[0] || null;
        };

        const tryOpenProjectTemplate = async (size: number, noteMode: boolean): Promise<{ success: boolean; templateDoc?: any; template?: TemplateLibraryItem; error?: string }> => {
            const candidate = pickBestTemplateFromLibrary(projectSkuTemplates, {
                size,
                keyword: templateKeyword,
                noteMode
            });

            if (!candidate) {
                return { success: false, error: noteMode ? `项目模板目录缺少 ${size}双自选备注模板` : `项目模板目录缺少 ${size}双模板` };
            }

            // 透明红线：兜底选中历史生成的占位模板时必须明示（非设计稿）并指路设计出口，不静默复用。
            if (getGeneratedCardTemplateRevision(candidate) > 0) {
                emitStep(
                    'observation',
                    '当前使用通用占位模板（非设计稿）',
                    `${size}双${noteMode ? '自选备注' : '组合图'}没有找到你自己的规格模板，将使用历史生成的通用占位模板「${candidate.name}」。如需设计稿模板，回复「设计模板」，我会参考项目素材自主设计并按规格命名保存。`,
                    'success',
                    0.3
                );
            }

            emitStatus(`正在打开 ${size}双${noteMode ? '自选备注' : '组合图'}模板。`);

            try {
                await window.designEcho?.openPath?.(candidate.filePath);
            } catch (error: any) {
                return { success: false, error: error?.message || String(error) };
            }

            for (let i = 0; i < 8; i++) {
                await sleep(700);
                await refreshDocuments();
                const matched = matchLibraryOpenedDoc(candidate, size, noteMode);
                if (matched) {
                    return { success: true, templateDoc: matched, template: candidate };
                }
            }

            return { success: false, error: `已打开项目模板文件但未在文档列表中识别到：${candidate.name}` };
        };

        const tryOpenLibraryTemplate = async (size: number, noteMode: boolean): Promise<{ success: boolean; templateDoc?: any; template?: TemplateLibraryItem; error?: string }> => {
            if (!allowLibraryTemplateFallback) {
                return { success: false, error: '当前任务已锁定当前项目模板文件夹，未启用备用模板' };
            }
            let candidate: TemplateLibraryItem | null = null;

            // 优先使用主进程模板服务的匹配逻辑，保证评分规则一致
            try {
                const serviceCandidate = await window.designEcho?.invoke?.('template-knowledge:findTemplateForSKU', {
                    comboSize: size,
                    keyword: templateKeyword || undefined,
                    noteMode,
                    sources: ['local-library']
                });
                candidate = normalizeTemplateCandidate(serviceCandidate);
            } catch (error) {
                console.warn('[SKU-Batch] 调用模板服务匹配失败，改用前端本地候选匹配:', error);
            }

            // 模板服务不可用时，改用前端本地候选内匹配
            if (!candidate) {
                candidate = pickBestTemplateFromLibrary(localSkuTemplates, {
                    size,
                    keyword: templateKeyword,
                    noteMode
                });
            }

            if (!candidate) {
                return { success: false, error: noteMode ? `备用模板缺少 ${size}双自选备注模板` : `备用模板缺少 ${size}双模板` };
            }

            emitStatus(`正在打开 ${size}双${noteMode ? '自选备注' : '组合图'}模板。`);

            try {
                await window.designEcho?.openPath?.(candidate.filePath);
            } catch (error: any) {
                return { success: false, error: error?.message || String(error) };
            }

            for (let i = 0; i < 8; i++) {
                await sleep(700);
                await refreshDocuments();
                const matched = matchLibraryOpenedDoc(candidate, size, noteMode);
                if (matched) {
                    return { success: true, templateDoc: matched, template: candidate };
                }
            }

            return { success: false, error: `已打开备用模板文件但未在文档列表中识别到：${candidate.name}` };
        };

        const findOpenedSkuDocument = (options: {
            expectedPath?: string;
        } = {}): any | null => {
            const docs = docsResult?.documents || [];
            const scored: Array<{ doc: any; score: number }> = docs
                .map((doc: any) => ({
                    doc,
                    score: scoreOpenedSkuDocument(doc, skuKeyword, {
                        projectPath: projectContext?.projectPath,
                        expectedPath: options.expectedPath
                    })
                }))
                .filter((item: { doc: any; score: number }) => item.score >= 0)
                .sort((a: { doc: any; score: number }, b: { doc: any; score: number }) => {
                    if (b.score !== a.score) return b.score - a.score;
                    return String(a.doc?.name || '').localeCompare(String(b.doc?.name || ''), 'zh-CN');
                });
            return scored[0]?.doc || null;
        };

        const waitForSkuDocument = async (expectedPath?: string): Promise<any | null> => {
            for (let i = 0; i < 10; i++) {
                await sleep(700);
                await refreshDocuments();
                const exact = findOpenedSkuDocument({ expectedPath });
                if (exact) return exact;
            }

            return null;
        };

        const openProjectSkuSourceFile = async (candidate: ProjectSkuSourceFile): Promise<any | null> => {
            emitStatus('正在打开当前项目的 SKU 素材。');
            emitStep(
                'tool_planned',
                '准备打开项目 SKU 素材',
                `从当前项目选择：${candidate.path}`,
                'running',
                0.14
            );

            try {
                const openResult = await (window as any).designEcho?.openPath?.(candidate.path);
                if (openResult && openResult !== '' && openResult !== true) {
                    console.warn('[SKU-Batch] 打开项目 SKU 素材失败:', openResult);
                    return null;
                }
            } catch (error) {
                console.warn('[SKU-Batch] 打开项目 SKU 素材异常:', error);
                return null;
            }

            return await waitForSkuDocument(candidate.path);
        };

        const resolveProjectSkuSourceDocument = async (): Promise<{
            skuDoc: any | null;
            projectSkuSourceFile?: ProjectSkuSourceFile;
            error?: string;
        }> => {
            const projectPath = projectContext?.projectPath;

            if (projectPath) {
                await window.designEcho?.setProjectRoot?.(projectPath);

                if (shouldAllowSkuCardSourcePreparation) {
                    return {
                        skuDoc: null,
                        error: 'card-source preparation requested; existing SKU source will be regenerated from project images'
                    };
                }

                callbacks?.onToolStart?.('searchProjectResources');
                const searchResult = await safeToolCall('searchProjectResources', {
                    query: skuKeyword,
                    type: 'design',
                    directory: projectPath,
                    limit: 50
                }, 12000, 'search-project-sku-source-file');
                callbacks?.onToolComplete?.('searchProjectResources', searchResult);

                const projectSkuSourceFile = pickBestProjectSkuSourceFile(
                    searchResult?.results || [],
                    skuKeyword,
                    projectPath
                );

                if (projectSkuSourceFile) {
                    const openedProjectDoc = findOpenedSkuDocument({
                        expectedPath: projectSkuSourceFile.path
                    });
                    if (openedProjectDoc) {
                        emitStatus('已复用当前项目的 SKU 素材文档。');
                        return { skuDoc: openedProjectDoc, projectSkuSourceFile };
                    }

                    const openedDoc = await openProjectSkuSourceFile(projectSkuSourceFile);
                    if (openedDoc) {
                        return { skuDoc: openedDoc, projectSkuSourceFile };
                    }

                    return {
                        skuDoc: null,
                        projectSkuSourceFile,
                        error: `已找到当前项目 SKU 素材「${projectSkuSourceFile.name}」，但打开后无法在 Photoshop 文档列表中确认该文件。`
                    };
                }

                const openedProjectDoc = findOpenedSkuDocument();
                if (openedProjectDoc) {
                    emitStatus('已找到当前项目打开的 SKU 素材文档。');
                    return { skuDoc: openedProjectDoc };
                }

                return { skuDoc: null, error: searchResult?.error ? String(searchResult.error) : undefined };
            }

            const openedDoc = (docsResult?.documents || []).find((d: any) => matchesSkuDocument(d, skuKeyword));
            if (openedDoc) {
                emitStatus('未加载项目，暂按当前打开的 SKU 素材文档处理。');
            }
            return { skuDoc: openedDoc || null };
        };

        // 2. 查找 SKU 文件
        let skuSourceResolution = await resolveProjectSkuSourceDocument();
        let skuDoc = skuSourceResolution.skuDoc;
        if (
            skuDoc
            && shouldAllowSkuCardSourcePreparation
            && params.skuSourcePreparationMode === 'card-source-from-project-images'
            && params.preferExistingSkuSourceForCardPreparation !== true
        ) {
            emitStatus('当前任务会基于项目图片整理新的 SKU 卡片源素材。', 14);
            skuSourceResolution = {
                skuDoc: null,
                projectSkuSourceFile: skuSourceResolution.projectSkuSourceFile,
                ignoredExistingSkuDoc: {
                    name: skuDoc.name,
                    path: skuDoc.path
                },
                reason: 'card-source-from-project-images'
            } as any;
            skuDoc = null;
        }

        if (!skuDoc) {
            skuCardSourcePreparationPlan = buildSkuCardSourcePreparationPlan({
                projectPath: projectContext?.projectPath,
                skuCardAssetCandidateReport,
                maxSources: params.skuSourceCandidateLimit || (sourceOnly ? 8 : earlySkuRequiredColorSlots),
                minimumSourceCount: sourceOnly ? 1 : earlySkuRequiredColorSlots,
                outputRelativePath: params.skuSourceOutputRelativePath
            });

            if (
                shouldAllowSkuCardSourcePreparation
                && skuCardSourcePreparationPlan.status === 'blocked_candidates_not_ready'
                && shouldRunSkuCardVisualConfirmationRefresh(params)
            ) {
                if (skuCardVisualConfirmationPlan.cacheSummary.shouldAnalyze > 0) {
                    emitStatus('正在确认 SKU 候选图是否适合作为卡片素材。', 15);
                    emitStep(
                        'observation',
                        '确认 SKU 候选图',
                        `将查看 ${skuCardVisualConfirmationPlan.selectedCandidates.length} 张候选图，确认主体完整度和裁切风险。`,
                        'running',
                        0.15
                    );
                    try {
                        const fillResult = await runProjectVisualInsightCacheFill({
                            projectPath: projectContext?.projectPath,
                            visualSamplingPlan: skuCardVisualConfirmationPlan,
                            enabled: true,
                            maxCandidates: params.skuCardVisualConfirmationMaxCandidates || params.visualObservationRefreshMaxCandidates || 8,
                            modelId: params.skuCardVisualConfirmationModelId || params.visualObservationRefreshModelId
                        });
                        skuCardVisualConfirmationRun = fillResult as unknown as Record<string, any>;
                        if ((fillResult.successCount || 0) > 0) {
                            const refreshedVisualInsightCache = buildProjectVisualInsightCacheReadResult({
                                source: 'provided-options',
                                exists: true,
                                entries: [
                                    ...((runtimeProjectContext?.visualInsightCache?.entries || []) as any[]),
                                    ...(Array.isArray(fillResult.entries) ? fillResult.entries : [])
                                ]
                            });
                            skuCardAssetCandidateReport = buildSkuCardAssetCandidateReport({
                                assetIndex: runtimeProjectContext?.assetIndex,
                                visualInsightCache: refreshedVisualInsightCache,
                                maxCandidates: 8
                            });
                            skuCardVisualConfirmationPlan = buildSkuCardVisualConfirmationPlan({
                                skuCardAssetCandidateReport,
                                maxCandidates: params.skuCardVisualConfirmationMaxCandidates || params.visualObservationRefreshMaxCandidates || 8
                            });
                            skuCardSourcePreparationPlan = buildSkuCardSourcePreparationPlan({
                                projectPath: projectContext?.projectPath,
                                skuCardAssetCandidateReport,
                                maxSources: params.skuSourceCandidateLimit || (sourceOnly ? 8 : earlySkuRequiredColorSlots),
                                minimumSourceCount: sourceOnly ? 1 : earlySkuRequiredColorSlots,
                                outputRelativePath: params.skuSourceOutputRelativePath
                            });
                            emitStep(
                                'verification',
                                'SKU 候选图确认完成',
                                `已获得 ${fillResult.successCount || 0} 条素材观察，重新判断源素材准备。`,
                                'success',
                                0.16
                            );
                        } else {
                            emitStep(
                                'warning',
                                'SKU 候选图确认未完成',
                                '没有获得可用于 SKU 源素材准备的视觉观察结果，本轮不会继续生成。',
                                'error',
                                0.16
                            );
                        }
                    } catch (error) {
                        skuCardVisualConfirmationRun = {
                            status: 'failed',
                            error: error instanceof Error ? error.message : String(error || 'SKU 候选图确认失败。')
                        };
                        emitStep(
                            'warning',
                            'SKU 候选图确认失败',
                            skuCardVisualConfirmationRun.error || '视觉确认流程没有完成。',
                            'error',
                            0.16
                        );
                    }
                }
            }

            if (shouldAllowSkuCardSourcePreparation && skuCardSourcePreparationPlan.status === 'ready_for_preparation') {
                emitStep(
                    'verification',
                    'SKU 色卡候选判断完成',
                    summarizeSkuCardSourceSelectionJudgment(
                        skuCardSourcePreparationPlan.selectedSources,
                        skuCardAssetCandidateReport
                    ),
                    'success',
                    0.145
                );
                emitStatus('正在整理 SKU 卡片源素材。', 16);
                skuCardSourcePreparationRun = await executeSkuCardSourcePreparationPlan(skuCardSourcePreparationPlan);
                if (skuCardSourcePreparationRun?.success) {
                    await refreshDocuments();
                    const preparedDoc = findOpenedSkuDocument({
                        expectedPath: skuCardSourcePreparationPlan.outputDocumentPath
                    }) || findOpenedSkuDocument();
                    if (preparedDoc) {
                        skuDoc = preparedDoc;
                        skuSourceResolution = {
                            skuDoc,
                            projectSkuSourceFile: {
                                name: 'SKU-card-source.psb',
                                path: skuCardSourcePreparationPlan.outputDocumentPath,
                                relativePath: params.skuSourceOutputRelativePath || 'PSD/SKU-card-source.psb'
                            }
                        };
                        if (skuCardSourcePreparationRun.requiresVisualAdjustment === true) {
                            const outputDocumentPath = skuCardSourcePreparationRun.outputDocumentPath
                                || skuCardSourcePreparationPlan.outputDocumentPath;
                            const preparedGroupCount = Array.isArray(skuCardSourcePreparationRun.preparedGroups)
                                ? skuCardSourcePreparationRun.preparedGroups.length
                                : 0;
                            emitStatus('SKU 色卡结构草稿已生成，正在等待视觉调整。', 88);
                            emitStep(
                                'observation',
                                'SKU 色卡需要视觉调整',
                                `已整理 ${preparedGroupCount} 个颜色卡片；需要先看图调整商品主体大小和裁切，再继续后续 SKU 生产。`,
                                'running',
                                0.88
                            );
                            return {
                                success: true,
                                message: `SKU 色卡结构草稿已保存到 ${outputDocumentPath}；商品主体大小与裁切仍需 Agent 看图调整。`,
                                toolResults: sanitizeSkuToolResultsForPublicResult(skuCardSourcePreparationRun.toolResults || []),
                                data: {
                                    status: 'source_structure_ready',
                                    sourceOnly,
                                    outputDocumentPath,
                                    exportCount: 0,
                                    preparedGroupCount,
                                    snapshot: skuCardSourcePreparationRun.snapshot,
                                    visualAdjustmentHandoff: skuCardSourcePreparationRun.visualAdjustmentHandoff,
                                    agentReActContinuation: skuCardSourcePreparationRun.agentReActContinuation,
                                    ...skuPlanningContext,
                                    skuCardAssetCandidateReport,
                                    skuCardVisualConfirmationPlan,
                                    skuCardVisualConfirmationRun,
                                    skuCardSourcePreparationPlan,
                                    skuCardSourcePreparationRun
                                }
                            };
                        }
                        if (sourceOnly) {
                            const outputDocumentPath = skuCardSourcePreparationRun.outputDocumentPath
                                || skuCardSourcePreparationPlan.outputDocumentPath;
                            const preparedGroupCount = Array.isArray(skuCardSourcePreparationRun.preparedGroups)
                                ? skuCardSourcePreparationRun.preparedGroups.length
                                : 0;
                            emitStatus('SKU 色卡素材已准备好，本轮不生成组合图。', 100);
                            emitStep(
                                'finalizing',
                                'SKU 色卡素材已准备好',
                                `已整理 ${preparedGroupCount} 个颜色卡片，并保存到 ${outputDocumentPath}。`,
                                'success',
                                1
                            );
                            return {
                                success: true,
                                message: `SKU 色卡素材已准备好，已保存到：${outputDocumentPath}`,
                                toolResults: sanitizeSkuToolResultsForPublicResult(skuCardSourcePreparationRun.toolResults || []),
                                data: {
                                    status: 'source_prepared',
                                    sourceOnly: true,
                                    outputDocumentPath,
                                    exportCount: 0,
                                    preparedGroupCount,
                                    ...skuPlanningContext,
                                    skuCardAssetCandidateReport,
                                    skuCardVisualConfirmationPlan,
                                    skuCardVisualConfirmationRun,
                                    skuCardSourcePreparationPlan,
                                    skuCardSourcePreparationRun
                                }
                            };
                        }
                        emitStatus('已准备 SKU 源文档，继续生成 SKU。', 20);
                    } else {
                        const readbackError = 'SKU 源文档已保存，但 Photoshop 文档列表暂时没有读回该文档。';
                        emitStep(
                            'warning',
                            'SKU 源文档读回失败',
                            readbackError,
                            'error',
                            0.2
                        );
                        return {
                            success: false,
                            message: 'SKU 源素材已整理，但还不能确认当前 Photoshop 文档状态，本轮先停止，避免继续错误出图。',
                            error: readbackError,
                            data: {
                                status: 'blocked_sku_card_source_readback_failed',
                                ...skuPlanningContext,
                                skuCardAssetCandidateReport,
                                skuCardVisualConfirmationPlan,
                                skuCardVisualConfirmationRun,
                                skuCardSourcePreparationPlan,
                                skuCardSourcePreparationRun
                            }
                        };
                    }
                } else {
                    const runError = String(skuCardSourcePreparationRun?.error || 'SKU 卡片源文档准备失败。');
                    emitStep(
                        'warning',
                        'SKU 源文档准备失败',
                        runError,
                        'error',
                        0.18
                    );
                    return {
                        success: false,
                        message: 'SKU 源素材整理没有完成，本轮不会继续生成 SKU。',
                        error: runError,
                        data: {
                            status: skuCardSourcePreparationRun?.status || 'blocked_sku_card_source_preparation_failed',
                            ...skuPlanningContext,
                            skuCardAssetCandidateReport,
                            skuCardVisualConfirmationPlan,
                            skuCardVisualConfirmationRun,
                            skuCardSourcePreparationPlan,
                            skuCardSourcePreparationRun
                        }
                    };
                }
            }
        }

        if (!skuDoc) {
            const planBlockers = skuCardSourcePreparationPlan?.blockers || [];
            const missingSkuSourceMessage = shouldAllowSkuCardSourcePreparation
                ? [
                    '当前还不能直接生成 SKU：缺少可用的 SKU 源素材文档。',
                    planBlockers.length > 0
                        ? `还需要先完成：${planBlockers.join('；')}`
                        : '需要先把已确认的单只/平铺素材整理成 SKU 源文档。'
                ].join('\n')
                : `当前还缺少 SKU 源素材：没有找到项目内可用的 SKU PSD/PSB。需要先完成 SKU 源素材准备，再继续生成。`;
            emitStep(
                'warning',
                'SKU 素材文档未找到',
                `未找到当前项目中匹配「${skuKeyword}」的 PSD/PSB 文档。${skuSourceResolution.error ? ` ${skuSourceResolution.error}` : ''}`,
                'error',
                0.18
            );
            return {
                success: false,
                message: missingSkuSourceMessage,
                error: missingSkuSourceMessage,
                data: {
                    status: shouldAllowSkuCardSourcePreparation
                        ? 'blocked_sku_card_source_preparation_not_ready'
                        : 'blocked_missing_sku_source_file',
                    ...skuPlanningContext,
                    skuCardAssetCandidateReport,
                    skuCardVisualConfirmationPlan,
                    skuCardVisualConfirmationRun,
                    skuCardSourcePreparationPlan
                }
            };
        }
        
        // 3. 切换到 SKU 文件
        if (skuDoc) {
            emitStep('verification', 'SKU 素材文档已定位', `当前素材文档：${skuDoc.name}`, 'success', 0.2);
            callbacks?.onToolStart?.('switchDocument');
            await executeToolCall('switchDocument', { documentName: skuDoc.name }, { signal });
            callbacks?.onToolComplete?.('switchDocument', { success: true });
        }

        callbacks?.onToolStart?.('skuLayout');
        const skuLayoutCapabilitiesResult = await safeToolCall(
            'skuLayout',
            { action: 'getCapabilities' },
            15000,
            'sku-layout-capabilities'
        );
        callbacks?.onToolComplete?.('skuLayout', skuLayoutCapabilitiesResult);
        const runtimeSupportsRecursiveColorGroups = supportsRecursiveSkuColorGroups(skuLayoutCapabilitiesResult);
        
        // 4. 获取 SKU 文件的图层组（颜色）
        callbacks?.onToolStart?.('skuLayout');
        const layersResult = await executeToolCall('skuLayout', { action: 'listLayerSets' }, { signal });
        callbacks?.onToolComplete?.('skuLayout', layersResult);
        
        if (!layersResult?.success || !layersResult?.data?.layerSets) {
            emitStep(
                'warning',
                'SKU 颜色图层读取失败',
                String(layersResult?.error || 'skuLayout listLayerSets 未返回有效 layerSets。'),
                'error',
                0.24
            );
            return {
                success: false,
                message: '⚠️ **无法读取图层组**\n\n请确保 SKU 素材 PSD 已打开且包含颜色图层组。',
                error: layersResult?.error || 'Failed to read layers'
            };
        }
        
        const allLayerNames = layersResult.data.layerSets.map((s: any) => s.name);
        
        // Filter non-color groups, then collapse duplicate color names from the SKU source document.
        const defaultExcludes = ['参考组', '参考', '背景', '图层组', 'background', 'ref', 'group'];
        const excludeList = excludeColors.length > 0 ? excludeColors : defaultExcludes;
        
        const excludedLayerNames: string[] = [];
        const rawValidColors = allLayerNames.filter((c: string) => {
            const layerName = normalizeSkuLayerName(c);
            const excludedByUserOrDefault = excludeList.some(ex => layerName.toLowerCase().includes(String(ex || '').toLowerCase()));
            const isSkuColor = isLikelySkuColorLayerName(layerName);
            if (excludedByUserOrDefault || !isSkuColor) {
                excludedLayerNames.push(layerName || String(c || ''));
                return false;
            }
            return true;
        });
        const { uniqueColors: validColors, duplicateColors } = dedupeColorNames(rawValidColors);
        
        console.log('[SKU-Batch] 颜色图层组分析:', {
            all: allLayerNames,
            excludeList,
            excludedLayerNames,
            rawValidColors,
            validColors,
            duplicateColors
        });
        if (duplicateColors.length > 0) {
            emitStatus('已处理重复颜色图层组。');
        }

        const skuDocName = skuDoc?.name || '未知文档';
        if (validColors.length === 0) {
            const layerSetsAreRecursive = layersResult?.data?.recursive === true;
            const staleRecursiveRuntime = !runtimeSupportsRecursiveColorGroups && !layerSetsAreRecursive;
            if (staleRecursiveRuntime) {
                const recursiveRuntimeMessage = buildSkuRecursiveColorGroupRuntimeError(
                    skuLayoutCapabilitiesResult?.error || skuLayoutCapabilitiesResult?.message
                );
                emitStep(
                    'warning',
                    'SKU 递归颜色组能力未加载',
                    recursiveRuntimeMessage,
                    'error',
                    0.26
                );
                return {
                    success: false,
                    message: recursiveRuntimeMessage,
                    error: recursiveRuntimeMessage,
                    data: {
                        status: 'blocked_stale_uxp_runtime_missing_recursive_sku_color_groups',
                        skuDocName,
                        layerGroups: allLayerNames,
                        ...skuPlanningContext,
                        skuCardAssetCandidateReport,
                        skuCardVisualConfirmationPlan,
                        skuCardVisualConfirmationRun,
                        skuLayoutCapabilities: skuLayoutCapabilitiesResult?.data || null
                    }
                };
            }

            const colorGroupMissingMessage = [
                `SKU 素材「${skuDocName}」没有识别到可用颜色图层组，暂时不能生成 SKU。`,
                '',
                allLayerNames.length > 0
                    ? `当前识别到的图层组：${allLayerNames.slice(0, 12).join('、')}${allLayerNames.length > 12 ? ' 等' : ''}。`
                    : '当前文档没有返回任何图层组。',
                '请确认项目 PSD/SKU.psb 中存在以颜色命名的袜子图层组，或重新加载最新版 UXP 插件后再试。'
            ].join('\n');
            emitStep(
                'warning',
                'SKU 颜色图层为空',
                `在「${skuDocName}」中没有识别到可用颜色图层组。`,
                'error',
                0.26
            );
            return {
                success: false,
                message: colorGroupMissingMessage,
                error: colorGroupMissingMessage,
                data: {
                    status: 'blocked_missing_sku_color_groups',
                    skuDocName,
                    ...skuPlanningContext,
                    skuCardAssetCandidateReport,
                    skuCardVisualConfirmationPlan,
                    skuCardVisualConfirmationRun,
                    layerGroups: allLayerNames
                }
            };
        }
        emitStep(
            'verification',
            'SKU 颜色图层读取完成',
            `识别到 ${validColors.length} 个可用颜色：${validColors.slice(0, 8).join(' / ')}${validColors.length > 8 ? ' ...' : ''}`,
            'success',
            0.28
        );
        const sourceCardAspectRatio = estimateSkuSourceCardAspectRatio(layersResult, validColors);
        
        // 5. 解析参数与自动推断规格
        const requestedComboSizes = normalizeSkuSizeList(params.comboSizes);
        let comboSizes = [...requestedComboSizes];
        const countPerSize = Math.max(1, Number((params.countPerSize as number) || 5));
        const structuredComboConfirmation = resolveStructuredSkuComboConfirmation(params, validColors);
        if (structuredComboConfirmation.error) {
            emitStep('warning', 'SKU 组合确认无法承接', structuredComboConfirmation.error, 'error', 0.3);
            return {
                success: false,
                message: structuredComboConfirmation.error,
                error: structuredComboConfirmation.error,
                data: { status: 'blocked_invalid_structured_sku_confirmation', skuDocName }
            };
        }
        const specifiedColorsNormalized = normalizeSpecifiedColors(params.specifiedColors);
        if (specifiedColorsNormalized.error && !structuredComboConfirmation.provided) {
            emitStep('warning', 'SKU 组合参数格式不正确', specifiedColorsNormalized.error, 'error', 0.3);
            return {
                success: false,
                message: `无法开始出图：${specifiedColorsNormalized.error}\n\n提示：确认续跑时组合会自动从任务文本解析，通常无需手动传 specifiedColors 参数。`,
                error: specifiedColorsNormalized.error,
                data: { status: 'blocked_invalid_specified_colors', skuDocName }
            };
        }
        // 一旦进入结构化确认续跑，卡片值就是组合真相源；原始参数中的候选组合只能用于出卡，
        // 不能在用户编辑后重新覆盖确认结果。
        const specifiedColors = structuredComboConfirmation.provided
            ? undefined
            : specifiedColorsNormalized.combos;
        const normalizedUserInput = String(params.userIntent || _context?.userInput || '');
        const generateNotes = params.generateNotes !== false;
        const onlyNotes = params.onlyNotes as boolean || false;
        
        // 如果未指定规格，尝试自动发现
        if (comboSizes.length === 0 && !params.comboSize) {
            emitStatus('正在确认可用 SKU 规格。', 30);
            const foundSpecs = new Set<number>();

            // 1. 从项目模板目录推断（本地文件系统直扫，避免检索漏检）
            const projectSpecs = collectSizesFromLibrary(projectSkuTemplates);
            for (const size of projectSpecs) {
                if (isReasonableSkuSize(size)) foundSpecs.add(size);
            }
            if (projectSpecs.length > 0) {
                emitStatus('已从项目模板确认 SKU 规格。', 31);
            }

            // 2. 从当前已打开的模板文档中补充推断，但只接受模板目录中的组合模板
            const openedTemplateSpecs = collectSizesFromOpenedTemplateDocs(
                docsResult?.documents || [],
                skuKeyword,
                templateDir
            );
            for (const size of openedTemplateSpecs) {
                if (isReasonableSkuSize(size)) foundSpecs.add(size);
            }
            if (openedTemplateSpecs.length > 0) {
                emitStatus('已从打开的模板确认 SKU 规格。', 32);
            }

            // 3. 从本地模板库推断
            const librarySpecs = localLibrarySpecs.length > 0
                ? localLibrarySpecs
                : collectSizesFromLibrary(localSkuTemplates);
            for (const size of librarySpecs) {
                if (isReasonableSkuSize(size)) foundSpecs.add(size);
            }
            if (librarySpecs.length > 0) {
                emitStatus('已从模板候选确认 SKU 规格。', 33);
            }
            
            if (foundSpecs.size > 0) {
                comboSizes = Array.from(foundSpecs).filter(isReasonableSkuSize).sort((a, b) => a - b);
                emitStatus(`已确认可处理规格：${comboSizes.join('、')}双。`, 34);
            } else {
                comboSizes = [2]; // 默认降级
                emitStatus('未发现明确规格模板，将先尝试默认规格。', 34);
            }
            if (projectSpecs.length > 0 || openedTemplateSpecs.length > 0) {
                comboSizes = Array.from(new Set([...projectSpecs, ...openedTemplateSpecs]))
                    .filter(isReasonableSkuSize)
                    .sort((a, b) => a - b);
            }
        } else if (comboSizes.length === 0) {
            comboSizes = [params.comboSize || 2].filter(isReasonableSkuSize);
        }

        if (structuredComboConfirmation.provided && structuredComboConfirmation.sizes.length > 0) {
            comboSizes = [...structuredComboConfirmation.sizes];
        }

        const requestedMonochromeColors = structuredComboConfirmation.provided
            ? []
            : resolveRequestedMonochromeColors(normalizedUserInput, validColors);
        // 确认续跑：用户在交互卡上确认/编辑过的组合（真实颜色名、严格格式）拥有最高优先级——
        // 必须严格照用户确认的组合出图，绝不重新生成、也不被模型 specifiedCombos 覆盖。
        // 这是修复"用户在卡片上改/加组合却被丢弃"（非数字色卡反解失败退回重生成）的关键点。
        let confirmedResumeCombos: string[][] = [];
        if (structuredComboConfirmation.provided) {
            confirmedResumeCombos = structuredComboConfirmation.combos;
        } else if (hasConfirmedSkuComboText(normalizedUserInput)) {
            confirmedResumeCombos = parseConfirmedSkuCombosFromResumeText(normalizedUserInput, validColors);
        }
        // 组合只接受结构化参数、确认卡续跑或用户明确写出的颜色；
        // 执行器不再二次调用模型重解释需求，避免与主 Agent 争夺计划所有权。
        const userTypedExplicitCombos = parseRequestedExplicitCombos(normalizedUserInput, validColors);
        const requestedExplicitCombos = confirmedResumeCombos.length > 0
            ? confirmedResumeCombos
            : userTypedExplicitCombos;

        const hasAppendIntent = /(在原有|原有基础|基础上|增加|新增|追加|再加|额外)/.test(normalizedUserInput);
        const hasSpecifiedOnlyIntent = /(只做|只要|单独做|单独生成|仅做|就做)/.test(normalizedUserInput);
        const runSpecifiedOnly = !onlyNotes
            && !specifiedColors
            && requestedExplicitCombos.length > 0
            && (
                confirmedResumeCombos.length > 0  // 确认续跑：严格照用户确认的组合，不再受意图词影响
                || hasSpecifiedOnlyIntent
                || !hasAppendIntent
            );
        const effectiveSpecifiedColors = specifiedColors && specifiedColors.length > 0
            ? specifiedColors
            : (runSpecifiedOnly ? requestedExplicitCombos : undefined);
        const effectiveCountPerSize = countPerSize;
        let effectiveGenerateNotes = structuredComboConfirmation.generateSelfSelectNotes === undefined
            ? generateNotes
            : structuredComboConfirmation.generateSelfSelectNotes;
        const effectiveRequestedTargetSizes = requestedComboSizes;

        let skuConfiguredExecutionPlan: SkuConfiguredExecutionPlan | null = null;
        let useConfiguredExecutionPlan = false;
        const configuredNoteCombosBySize: Record<number, string[][]> = {};

        if (projectSkuConfigFiles.length > 0) {
            const configuredInputs = await loadProjectSkuConfigInputs(projectSkuConfigFiles);
            skuConfiguredExecutionPlan = buildSkuConfiguredExecutionPlan({
                csvConfigs: configuredInputs,
                comboTemplates: toConfiguredTemplateInputs(projectSkuTemplates, false),
                noteTemplates: toConfiguredTemplateInputs(projectSkuTemplates, true),
                availableColorNames: validColors,
                requestedSizes: effectiveRequestedTargetSizes
            });

            const explicitComboOverride = Boolean(
                (effectiveSpecifiedColors && effectiveSpecifiedColors.length > 0)
                || runSpecifiedOnly
                || requestedExplicitCombos.length > 0
                || requestedMonochromeColors.length > 0
            );
            const configuredSizes = skuConfiguredExecutionPlan.sizes.map((item) => item.size);
            const requestedSizesCoveredByConfiguredPlan = effectiveRequestedTargetSizes.length === 0
                || effectiveRequestedTargetSizes.every((size) => configuredSizes.includes(size));
            const blockedByConfiguredExecutionPlan = skuConfiguredExecutionPlan.status === 'blocked_configured_execution_plan'
                && !explicitComboOverride
                && requestedSizesCoveredByConfiguredPlan;
            useConfiguredExecutionPlan = skuConfiguredExecutionPlan.status === 'ready_configured_execution_plan'
                && !explicitComboOverride
                && requestedSizesCoveredByConfiguredPlan;

            if (useConfiguredExecutionPlan) {
                comboSizes = skuConfiguredExecutionPlan.sizes.map((item) => item.size);
                if (
                    structuredComboConfirmation.generateSelfSelectNotes !== false
                    && generateNotes
                    && skuConfiguredExecutionPlan.noteExecutionCount > 0
                ) {
                    effectiveGenerateNotes = true;
                }
                emitStatus(
                    `已读取项目 SKU 配置：${skuConfiguredExecutionPlan.comboExecutionCount} 个组合，` +
                    `${skuConfiguredExecutionPlan.noteExecutionCount} 个自选备注。`,
                    35
                );
            } else if (!requestedSizesCoveredByConfiguredPlan) {
                emitStatus('项目 SKU 配置没有覆盖全部请求规格，将按显式规格继续生成。', 38);
            } else if (blockedByConfiguredExecutionPlan) {
                const blockerMessage = buildSkuConfiguredExecutionBlockerMessage({
                    plan: skuConfiguredExecutionPlan,
                    skuDocName,
                    userRequestedExplicitCombos: explicitComboOverride
                });
                emitStep(
                    'warning',
                    'SKU 项目配置暂不能执行',
                    skuConfiguredExecutionPlan.blockers.slice(0, 3).join('；'),
                    'error',
                    0.38
                );
                emitStatus('项目 SKU 配置和素材还没有对齐，本轮不会继续猜测生成。', 38);
                return {
                    success: false,
                    message: blockerMessage,
                    error: skuConfiguredExecutionPlan.blockers[0] || 'SKU configured execution plan is blocked',
                    data: {
                        status: 'blocked_configured_execution_plan',
                        skuDocName,
                        blockers: skuConfiguredExecutionPlan.blockers,
                        warnings: skuConfiguredExecutionPlan.warnings,
                        skuConfiguredExecutionPlan,
                        ...skuPlanningContext,
                        skuCardAssetCandidateReport,
                        skuCardVisualConfirmationPlan,
                        skuCardVisualConfirmationRun,
                        requiresUserAction: true,
                        canRetryWithExplicitCombos: true
                    }
                };
            } else if (skuConfiguredExecutionPlan.blockers.length > 0) {
                emitStatus('项目 SKU 配置暂不能直接执行。', 38);
            }
        }

        if (runSpecifiedOnly) {
            comboSizes = Array.from(new Set(requestedExplicitCombos.map(combo => combo.length)))
                .filter(isReasonableSkuSize)
                .sort((a, b) => a - b);
        }

        console.log('[SKU-Batch] 参数解析:', {
            comboSizes,
            countPerSize: effectiveCountPerSize,
            specifiedColors: effectiveSpecifiedColors,
            generateNotes: effectiveGenerateNotes,
            onlyNotes,
            requestedMonochromeColors,
            requestedExplicitCombos,
            requestedTargetSizes: effectiveRequestedTargetSizes,
            runSpecifiedOnly,
            skuConfiguredExecutionPlan
        });
        
        if (onlyNotes) {
            emitStatus(`已确认只生成自选备注，规格 ${comboSizes.join('、')} 双。`, 36);
        } else {
            emitStatus(`已确认 SKU 规格 ${comboSizes.join('、')} 双。`, 36);
        }
        emitStep(
            'verification',
            'SKU 任务参数解析完成',
            onlyNotes
                ? `只生成自选备注，规格 ${comboSizes.join(' / ')} 双。`
                : `规格 ${comboSizes.join(' / ')} 双，每规格目标 ${effectiveCountPerSize} 个组合，生成备注：${effectiveGenerateNotes ? '是' : '否'}。`,
            'success',
            0.36
        );

        if (runSpecifiedOnly && requestedExplicitCombos.length > 0) {
            emitStatus('已识别为指定组合任务。', 38);
        }
        if (!onlyNotes && requestedMonochromeColors.length > 0) {
            emitStatus('已识别需要追加的 SKU 组合要求。', 39);
        }

        const comboTemplateNeeded = !onlyNotes;
        const noteTemplateNeeded = effectiveGenerateNotes || onlyNotes;
        const pickTemplateCandidate = (size: number, noteMode: boolean): TemplateLibraryItem | null => {
            const projectCandidate = pickBestTemplateFromLibrary(projectSkuTemplates, {
                size,
                keyword: templateKeyword,
                noteMode
            });
            if (projectCandidate) return projectCandidate;
            if (!allowLibraryTemplateFallback) return null;
            return pickBestTemplateFromLibrary(localSkuTemplates, {
                size,
                keyword: templateKeyword,
                noteMode
            });
        };
        const hasTemplateCandidate = (size: number, noteMode: boolean): boolean => {
            return Boolean(pickTemplateCandidate(size, noteMode));
        };
        const hasCardTemplateCandidate = (size: number, noteMode: boolean): boolean => {
            const candidate = pickTemplateCandidate(size, noteMode);
            return Boolean(
                candidate
                && isCardStyleTemplateCandidate(candidate)
                && !isOutdatedGeneratedCardTemplateCandidate(candidate)
            );
        };
        const missingTemplateCandidate = comboSizes.some((size) =>
            (comboTemplateNeeded && !hasTemplateCandidate(size, false))
            || (noteTemplateNeeded && !hasTemplateCandidate(size, true))
        );
        const missingCardTemplateCandidate = shouldAllowSkuCardTemplatePreparation && comboSizes.some((size) =>
            (comboTemplateNeeded && !hasCardTemplateCandidate(size, false))
            || (noteTemplateNeeded && !hasCardTemplateCandidate(size, true))
        );
        const skuCardTemplateDesignApproved = params.skuCardTemplateDesignApproved === true
            || hasApprovedStructuredSkuTemplateConfirmation(params)
            || hasConfirmedSkuCardTemplateDesignText(normalizedUserInput);
        // 治理2026-07-02（硬编码降级为显式兜底）：缺模板时的路由单一真相源在
        // shared/sku-template-design-loop.ts——显式兜底 > 明确拒绝 > 已确认方向(移交 Agent 自主设计) > 先确认方向。
        // 旧 shouldAutoPrepareSkuCardTemplateForProduction（"缺模板+生产措辞"静默跳过确认、直落硬编码
        // 占位模板）是用户观察到"有概率用硬编码"的来源之一，已删除：默认路径必须走
        // 确认模板方向 → 移交 Agent 自主设计（参考先行→设计→占位→验证→存模板→回批量）。
        const skuTemplatePreparationRoute = resolveSkuTemplatePreparationRoute({
            userInput: normalizedUserInput,
            params,
            templateDesignConfirmed: skuCardTemplateDesignApproved
        });
        const explicitPlaceholderTemplateFallback = skuTemplatePreparationRoute.route === 'placeholder_preparation';
        const shouldRequestSkuCardTemplateDesignConfirmation = !onlyNotes
            && shouldAllowSkuCardTemplatePreparation
            && params.requireSkuCardTemplateDesignConfirmation === true
            && skuTemplatePreparationRoute.route === 'confirmation_required'
            && (missingTemplateCandidate || missingCardTemplateCandidate);

        if (shouldRequestSkuCardTemplateDesignConfirmation) {
            const confirmationCard = buildSkuCardTemplateDesignConfirmationCard({
                projectId: projectContext?.projectPath,
                comboSizes,
                colorCount: validColors.length,
                understanding: projectProductUnderstanding
            });
            emitStep(
                'observation',
                'SKU 色卡模板需要先确认方向',
                '当前缺少可直接使用的卡片式模板。我不会直接生成通用占位模板，请先确认模板版式和复核重点。',
                'success',
                0.42
            );
            return {
                success: true,
                message: [
                    '当前缺少可直接使用的 SKU 卡片模板。',
                    '我不会直接把通用占位脚本当成设计模板；请先确认下面的模板方向，确认后我会参考项目素材与设计参考自主设计可编辑模板、加好批量占位符，再继续生成组合。',
                    '如果只需要快速出图，可以直接回复「用默认占位模板」，我会生成通用占位模板（非设计稿）兜底。'
                ].join('\n'),
                toolResults: sanitizeSkuToolResultsForPublicResult([
                    { toolName: 'listDocuments', result: docsResult },
                    { toolName: 'skuLayout-getCapabilities', result: skuLayoutCapabilitiesResult },
                    { toolName: 'skuLayout-listLayerSets', result: layersResult }
                ]),
                data: {
                    status: 'pending_sku_card_template_design_confirmation',
                    skuDocName,
                    comboSizes,
                    templateDesignConfirmationRequired: true,
                    interactiveCards: [confirmationCard],
                    ...skuPlanningContext,
                    skuCardAssetCandidateReport,
                    skuCardVisualConfirmationPlan,
                    skuCardVisualConfirmationRun,
                    requiresUserAction: true
                }
            };
        }

        // 治理2026-07-02：硬编码占位模板生成只在「显式兜底」时可达（用户话语显式要求快速/默认/占位模板，
        // 或设计路径失败后用户选择兜底 params.skuPlaceholderTemplateFallbackApproved）。
        // 显式兜底本身即授权（不再依赖 allowSkuCardTemplatePreparation 关键词参数），sourceOnly 除外。
        if (
            (missingTemplateCandidate || missingCardTemplateCandidate)
            && !sourceOnly
            && explicitPlaceholderTemplateFallback
        ) {
            const notePlaceholderCount = Math.max(
                1,
                Math.min(12, Number(validColors.length || params.skuTemplateNotePlaceholderCount || params.skuSourceCandidateLimit || 8))
            );
            skuCardTemplatePreparationPlan = buildSkuCardTemplatePreparationPlan({
                projectPath: projectContext?.projectPath,
                requiredSizes: comboSizes,
                templateOutputRelativeDir: params.skuTemplateOutputRelativeDir,
                notePlaceholderCount,
                sourceCardAspectRatio
            });

            if (skuCardTemplatePreparationPlan.status === 'ready_for_preparation') {
                emitStatus('正在按你的要求生成通用占位模板（非设计稿）。', 40);
                skuCardTemplatePreparationRun = await executeSkuCardTemplatePreparationPlan(skuCardTemplatePreparationPlan);
                if (!skuCardTemplatePreparationRun?.success) {
                    const templateRunError = String(skuCardTemplatePreparationRun?.error || 'SKU 模板准备失败。');
                    emitStep(
                        'warning',
                        'SKU 模板准备失败',
                        templateRunError,
                        'error',
                        0.46
                    );
                    return {
                        success: false,
                        message: 'SKU 模板准备没有完成，本轮不会继续生成 SKU。',
                        error: templateRunError,
                        data: {
                            status: skuCardTemplatePreparationRun?.status || 'blocked_sku_card_template_preparation_failed',
                            ...skuPlanningContext,
                            skuCardAssetCandidateReport,
                            skuCardVisualConfirmationPlan,
                            skuCardVisualConfirmationRun,
                            skuCardSourcePreparationPlan,
                            skuCardSourcePreparationRun,
                            skuCardTemplatePreparationPlan,
                            skuCardTemplatePreparationRun
                        }
                    };
                }

                await refreshDocuments();
                if (templateDir) {
                    projectSkuTemplates = await scanProjectTemplateFiles(templateDir);
                }
                emitStatus('已生成通用占位模板（非设计稿），继续批量出图。', 46);
            } else {
                const templatePlanBlockers = skuCardTemplatePreparationPlan.blockers || [];
                emitStep(
                    'warning',
                    'SKU 模板准备条件不足',
                    templatePlanBlockers.join('；') || '模板准备计划不可执行。',
                    'error',
                    0.46
                );
            }
        }

        // 治理2026-07-02（默认路径闭环）：按规格严格判定缺模板（与执行同源同粒度：
        // hasTemplateCandidate 项目+库候选 + findOpenedTemplateDocument 已打开文档），
        // 缺模板时按 skuTemplatePreparationRoute 路由：
        //   - confirmation_required → 弹「模板方向」确认卡（默认路径不再死终结，绝不静默落硬编码占位模板）
        //   - agent_design_handoff → 移交 Agent 自主设计（参考先行→设计→占位→验证→存模板→回批量）
        //   - placeholder_preparation（显式兜底但上方准备未补齐）/ blocked_missing_template（用户拒绝方向）
        //     → 落到后面的确定性失败信息（放模板/打开模板/设计模板三选一），不弹卡、不猜测。
        if (!onlyNotes && !sourceOnly) {
            const designGateUnresolvableSizes = comboSizes.filter((size) =>
                !hasTemplateCandidate(size, false)
                && !findOpenedTemplateDocument({ size, noteMode: false })
            );
            if (designGateUnresolvableSizes.length > 0 && skuTemplatePreparationRoute.route === 'agent_design_handoff') {
                const handoffContract = buildSkuTemplateDesignHandoffContract({
                    missingSizes: designGateUnresolvableSizes,
                    colorCount: validColors.length
                });
                emitStep(
                    'observation',
                    'SKU 模板进入 Agent 自主设计阶段',
                    `缺少 ${designGateUnresolvableSizes.join(' / ')} 双模板，模板方向已确认：由 Agent 参考先行自主设计，不使用通用占位脚本代替设计稿。`,
                    'success',
                    0.44
                );
                return {
                    success: false,
                    message: handoffContract.message,
                    error: handoffContract.message,
                    nonFatal: true,
                    toolResults: sanitizeSkuToolResultsForPublicResult([
                        { toolName: 'listDocuments', result: docsResult },
                        { toolName: 'skuLayout-getCapabilities', result: skuLayoutCapabilitiesResult },
                        { toolName: 'skuLayout-listLayerSets', result: layersResult }
                    ]),
                    data: {
                        status: handoffContract.status,
                        audience: handoffContract.audience,
                        // 确定性纪律激活通道（评审修复 2026-07-03）：自主循环包装器据此显式激活
                        // 设计纪律上下文（declaredTaskTypeId），参考先行门禁在移交续跑路径可达。
                        declaredDesignTaskTypeId: handoffContract.declaredDesignTaskTypeId,
                        skuDocName,
                        comboSizes,
                        missingTemplateSizes: designGateUnresolvableSizes,
                        requiredReferenceObservationTools: handoffContract.requiredReferenceObservationTools,
                        completionChecklist: handoffContract.completionChecklist,
                        ...skuPlanningContext,
                        skuCardAssetCandidateReport
                    }
                } as AgentResult;
            }
            if (designGateUnresolvableSizes.length > 0 && skuTemplatePreparationRoute.route === 'confirmation_required') {
                const confirmationCard = buildSkuCardTemplateDesignConfirmationCard({
                    projectId: projectContext?.projectPath,
                    comboSizes,
                    colorCount: validColors.length,
                    understanding: projectProductUnderstanding
                });
                emitStep(
                    'observation',
                    'SKU 色卡模板需要先确认方向',
                    `以下规格没有可用排版模板：${designGateUnresolvableSizes.join(' / ')} 双。我不会直接生成通用占位模板，请先确认模板方向，确认后由我自主设计。`,
                    'success',
                    0.42
                );
                return {
                    success: true,
                    message: [
                        `当前项目缺少 ${designGateUnresolvableSizes.map((s) => `${s}双装`).join('、')} 的可用排版模板。`,
                        '我不会直接把通用占位脚本当成设计模板；请先确认下面的模板方向，确认后我会参考项目素材与设计参考自主设计可编辑模板、加好批量占位符，再继续生成组合。',
                        '如果只需要快速出图，可以直接回复「用默认占位模板」，我会生成通用占位模板（非设计稿）兜底。'
                    ].join('\n'),
                    toolResults: sanitizeSkuToolResultsForPublicResult([
                        { toolName: 'listDocuments', result: docsResult },
                        { toolName: 'skuLayout-getCapabilities', result: skuLayoutCapabilitiesResult },
                        { toolName: 'skuLayout-listLayerSets', result: layersResult }
                    ]),
                    data: {
                        status: 'pending_sku_card_template_design_confirmation',
                        skuDocName,
                        comboSizes,
                        missingTemplateSizes: designGateUnresolvableSizes,
                        templateDesignConfirmationRequired: true,
                        interactiveCards: [confirmationCard],
                        ...skuPlanningContext,
                        skuCardAssetCandidateReport,
                        skuCardVisualConfirmationPlan,
                        skuCardVisualConfirmationRun,
                        requiresUserAction: true
                    }
                };
            }
        }

        if (!onlyNotes) {
            const openedTemplateCount = (docsResult?.documents || []).filter((d: any) => {
                const name = String(d?.name || '').toLowerCase();
                return /(\d+)双/.test(name) && !name.includes(skuKeyword.toLowerCase());
            }).length;
            const hasLibraryTemplate = comboSizes.some(size =>
                !!pickBestTemplateFromLibrary(localSkuTemplates, {
                    size,
                    keyword: templateKeyword,
                    noteMode: false
                })
            );

            if (openedTemplateCount === 0 && templateDir) {
                let foundTemplateCount = projectSkuTemplates.length;
                let probeError: string | undefined;

                if (foundTemplateCount === 0) {
                    const probe = await safeToolCall('searchProjectResources', {
                        query: '模板',
                        type: 'all',
                        directory: templateDir,
                        limit: 20
                    }, 10000, 'probe-template-files');

                    const foundTemplateFiles = (probe?.results || []).filter((f: any) =>
                        TEMPLATE_FILE_PATTERN.test(String(f?.name || ''))
                    );
                    foundTemplateCount = foundTemplateFiles.length;
                    probeError = probe?.error;
                }

                if (foundTemplateCount === 0) {
                    if (!hasLibraryTemplate) {
                        const availabilitySummary = summarizeTemplateAvailability({
                            templateDir,
                            projectTemplates: projectSkuTemplates,
                            localTemplates: localSkuTemplates,
                            localSpecs: localLibrarySpecs
                        });
                        emitStep(
                            'warning',
                            'SKU 模板不可用',
                            `当前项目模板和备用模板都没有命中所需规格：${comboSizes.join(' / ')} 双。`,
                            'error',
                            0.42
                        );
                        return {
                            success: false,
                            message: `⚠️ SKU 批量生成失败\n\n未找到可用模板文件。\n\n**当前检查结果**\n${availabilitySummary}\n\n**处理建议**\n1. 在当前项目的「模板文件」文件夹放入如「2双装 / 3双装 / 4双装」模板\n2. 或先在 Photoshop 打开对应规格模板后再执行\n3. 或在模板设置中补充备用 SKU 模板`,
                            error: probeError || 'Template files not found'
                        };
                    }
                    emitStatus('当前项目模板未命中，将使用可用模板候选继续执行。', 42);
                }
            } else if (openedTemplateCount === 0 && !hasLibraryTemplate) {
                const availabilitySummary = summarizeTemplateAvailability({
                    templateDir,
                    projectTemplates: projectSkuTemplates,
                    localTemplates: localSkuTemplates,
                    localSpecs: localLibrarySpecs
                });
                emitStep(
                    'warning',
                    'SKU 模板不可用',
                    `未找到已打开模板，也没有备用 SKU 模板：${comboSizes.join(' / ')} 双。`,
                    'error',
                    0.42
                );
                return {
                    success: false,
                    message: `⚠️ SKU 批量生成失败\n\n未找到可用模板。\n\n**当前检查结果**\n${availabilitySummary}\n\n请先打开模板文件，或在模板设置中补充备用 SKU 模板后重试。`,
                    error: 'Template files not found'
                };
            }
        }
        
        // 5.9 组合确认卡/出图前——按规格严格预检模板可用性（治理2026-07-02）。
        // 背景：上面的宽松门(3846 起)只按"有没有任意模板"计数(openedTemplateCount/foundTemplateCount/
        // hasLibraryTemplate)，而执行期 resolveComboTemplateDocument 是"按规格"找 opened/project/library
        // 模板。二者粒度不一致→项目里有个被当成模板的东西(或某单一规格模板)就放行→弹组合卡→用户确认后
        // 按规格找不到真模板而必然失败(用户实测反馈:看过文件知道没模板，却仍弹卡、执行必败)。
        // 这里用与执行【同源同粒度】的 per-size 预检兜住：任一所需规格没有可解析模板，就在弹卡/出图前直接
        // 失败并指路，不让用户白确认。hasTemplateCandidate 走 项目+库(库受 allowLibraryTemplateFallback
        // 约束，与执行期 tryOpenLibraryTemplate 同一开关，口径一致不误拦)；findOpenedTemplateDocument 覆盖
        // 已打开的按规格模板。三源与执行完全对齐。
        if (!onlyNotes) {
            const unresolvableComboSizes = comboSizes.filter((size) =>
                !hasTemplateCandidate(size, false)
                && !findOpenedTemplateDocument({ size, noteMode: false })
            );
            if (unresolvableComboSizes.length > 0) {
                const availabilitySummary = summarizeTemplateAvailability({
                    templateDir,
                    projectTemplates: projectSkuTemplates,
                    localTemplates: localSkuTemplates,
                    localSpecs: localLibrarySpecs
                });
                const missingSizeLabel = unresolvableComboSizes.map((s) => `${s}双装`).join('、');
                emitStep(
                    'warning',
                    'SKU 模板按规格不可用',
                    `以下规格没有可用排版模板，出图必失败，已在弹组合确认卡前拦下：${unresolvableComboSizes.join(' / ')} 双。`,
                    'error',
                    0.42
                );
                return {
                    success: false,
                    message: [
                        `⚠️ 暂时无法出图：以下规格没有可用的排版模板 —— **${missingSizeLabel}**。`,
                        '',
                        '项目当前只有色卡源、没有对应规格的模板文件；即使确认组合也无法排版出图，所以我没有弹出组合确认卡、也没有开始生产。',
                        '',
                        '**处理建议（任选其一）**',
                        `1. 在项目「模板文件」文件夹放入「${unresolvableComboSizes.map((s) => `${s}双装`).join('/')}」模板；`,
                        '2. 或先在 Photoshop 打开对应规格的模板文档后重试；',
                        '3. 或回复「设计模板」，我会基于当前色卡与设计参考先设计一版可编辑模板（设计后自动添加批量占位符）；只要快速出图可回复「用默认占位模板」（通用占位模板，非设计稿）。',
                        '',
                        '**当前检查结果**',
                        availabilitySummary
                    ].join('\n'),
                    error: 'Per-size template not resolvable before combo confirmation',
                    toolResults: sanitizeSkuToolResultsForPublicResult([
                        { toolName: 'listDocuments', result: docsResult },
                        { toolName: 'skuLayout-getCapabilities', result: skuLayoutCapabilitiesResult },
                        { toolName: 'skuLayout-listLayerSets', result: layersResult }
                    ]),
                    data: {
                        status: 'blocked_missing_per_size_template',
                        skuDocName,
                        comboSizes,
                        unresolvableComboSizes,
                        requiresUserAction: true
                    }
                };
            }
        }

        // 6. 按规格分组生成颜色组合
        const combosBySize: Record<number, string[][]> = {};
        
        if (useConfiguredExecutionPlan && skuConfiguredExecutionPlan) {
            for (const sizePlan of skuConfiguredExecutionPlan.sizes) {
                combosBySize[sizePlan.size] = onlyNotes
                    ? []
                    : sizePlan.comboRows.map((row) => row.colorNames);
                configuredNoteCombosBySize[sizePlan.size] = sizePlan.noteRows.map((row) => row.colorNames);
            }
        } else if (onlyNotes) {
            for (const size of comboSizes) {
                combosBySize[size] = [];
            }
        } else if (effectiveSpecifiedColors && effectiveSpecifiedColors.length > 0) {
            for (const combo of effectiveSpecifiedColors) {
                const size = combo.length;
                if (!combosBySize[size]) combosBySize[size] = [];
                combosBySize[size].push(combo);
            }
        } else {
            for (const size of comboSizes) {
                const sizeCombos = generateCombinationsOfSize(validColors, size, effectiveCountPerSize);
                if (sizeCombos.length < effectiveCountPerSize) {
                    emitStatus(`${size}双组合数量已按不重复原则调整。`);
                }
                combosBySize[size] = sizeCombos;
            }
        }

        if (!useConfiguredExecutionPlan && !onlyNotes && !runSpecifiedOnly && requestedExplicitCombos.length > 0 && hasAppendIntent) {
            const explicitComboResult = appendRequestedSpecificCombos(combosBySize, requestedExplicitCombos);
            if (explicitComboResult.added.length > 0) {
                emitStatus('已按要求追加指定 SKU 组合。');
            }
            if (explicitComboResult.skipped.length > 0) {
                emitStatus('部分指定 SKU 组合已存在，未重复追加。');
            }
        }

        if (!useConfiguredExecutionPlan && !onlyNotes && requestedMonochromeColors.length > 0) {
            const targetSizes = effectiveRequestedTargetSizes.length > 0 ? effectiveRequestedTargetSizes : comboSizes;
            const extraComboResult = appendRequestedExtraCombos(combosBySize, targetSizes, requestedMonochromeColors);
            if (extraComboResult.added.length > 0) {
                const preview = extraComboResult.added
                    .slice(0, 6)
                    .map(item => `${item.size}双=${item.combo.join('+')}`)
                    .join(' / ');
                emitStatus('已追加指定 SKU 组合。');
            }
            if (extraComboResult.skipped.length > 0) {
                emitStatus('部分指定 SKU 组合已存在，未重复追加。');
            }
        }

        // 7. 按规格循环处理
        if (!onlyNotes) {
            const duplicateRemovals = dedupeAllCombosBySize(combosBySize);
            if (duplicateRemovals.length > 0) {
                const removalSummary = duplicateRemovals
                    .map(item => `${item.size}双去重 ${item.removedCombos.length} 组`)
                    .join(' / ');
                emitStatus(`已自动去除重复 SKU 组合：${removalSummary}。`);
            }
        }
        const skuComboConfirmationApproved = params.skuComboConfirmationApproved === true
            || structuredComboConfirmation.provided
            || hasConfirmedSkuComboText(normalizedUserInput);
        const shouldRequestSkuComboConfirmation = !onlyNotes
            && params.requireSkuComboConfirmation === true
            && !skuComboConfirmationApproved;
        if (shouldRequestSkuComboConfirmation) {
            const confirmationSource = useConfiguredExecutionPlan
                ? 'project-config'
                : (effectiveSpecifiedColors && effectiveSpecifiedColors.length > 0) || requestedExplicitCombos.length > 0
                    ? 'explicit'
                    : 'algorithm';
            // 评审修复 2026-07-03：产品/风格提示从项目画面观察派生，不硬编码品类（拿不到则省略）。
            const comboCardDefaults = deriveSkuCardTemplateDesignCardDefaults(projectProductUnderstanding);
            const confirmationRequest = buildSkuComboConfirmationRequest({
                availableColors: validColors,
                requiredSizes: comboSizes,
                combosBySize,
                generateSelfSelectNotes: effectiveGenerateNotes,
                source: confirmationSource,
                projectId: projectContext?.projectPath,
                ...(comboCardDefaults.productLabel ? { productType: comboCardDefaults.productLabel } : {}),
                ...(comboCardDefaults.styleText ? { style: comboCardDefaults.styleText } : {})
            });
            emitStep(
                confirmationRequest.status === 'pending_user_confirmation' ? 'observation' : 'warning',
                'SKU 组合候选已复核',
                confirmationRequest.review.summary,
                confirmationRequest.status === 'pending_user_confirmation' ? 'success' : 'error',
                0.5
            );
            if (!confirmationRequest.card) {
                const blockers = confirmationRequest.review.blockers.join('\n') || '候选组合没有通过检查。';
                return {
                    success: false,
                    message: [
                        '我已经生成了 SKU 组合候选，但候选内容还不能交给你确认。',
                        blockers,
                        '我不会继续出图，请先重新确认颜色数量、规格和组合要求。'
                    ].join('\n'),
                    error: blockers,
                    data: {
                        status: 'blocked_invalid_sku_combo_confirmation_candidate',
                        skuComboConfirmationReview: confirmationRequest.review,
                        ...skuPlanningContext,
                        skuCardAssetCandidateReport,
                        skuCardVisualConfirmationPlan,
                        skuCardVisualConfirmationRun,
                        requiresUserAction: true
                    }
                };
            }

            return {
                success: true,
                message: [
                    '我已经根据当前 SKU 色卡生成了一版组合候选，这一步还没有开始出图。',
                    `候选概览：${confirmationRequest.review.summary}。`,
                    '请在下面卡片里确认或修改组合，确认后我再继续生成 SKU 组合图和自选备注。'
                ].join('\n'),
                toolResults: sanitizeSkuToolResultsForPublicResult([
                    { toolName: 'listDocuments', result: docsResult },
                    { toolName: 'skuLayout-getCapabilities', result: skuLayoutCapabilitiesResult },
                    { toolName: 'skuLayout-listLayerSets', result: layersResult }
                ]),
                data: {
                    status: 'pending_sku_combo_confirmation',
                    skuDocName,
                    comboSizes,
                    comboConfirmationRequired: true,
                    skuComboConfirmationReview: confirmationRequest.review,
                    interactiveCards: [confirmationRequest.card],
                    ...skuPlanningContext,
                    skuCardAssetCandidateReport,
                    skuCardVisualConfirmationPlan,
                    skuCardVisualConfirmationRun,
                    requiresUserAction: true
                }
            };
        }
        const plannedComboCount = Object.values(combosBySize).reduce((sum, combos) => sum + combos.length, 0);
        const plannedNoteSizes = comboSizes
            .filter(size => decideSkuSelfSelectNoteGeneration({
                comboSize: size,
                notesRequested: effectiveGenerateNotes,
                onlyNotes
            }).shouldGenerate);
        emitStatus(
            `🧭 SKU 执行计划已确认：素材「${skuDocName}」，规格 ${comboSizes.join(' / ')} 双，` +
            `组合 ${plannedComboCount} 组，自选备注 ${plannedNoteSizes.length > 0 ? `${plannedNoteSizes.join(' / ')} 双` : '不生成或已跳过'}。`,
            50
        );
        emitStep(
            'tool_planned',
            'SKU 执行计划已确认',
            `规格 ${Object.keys(combosBySize).join(' / ')} 双，计划组合 ${plannedComboCount} 组，自选备注 ${plannedNoteSizes.join(' / ') || '无'}。`,
            'success',
            0.5
        );

        const allFinalFiles: string[] = [];
        const allFinalExportRecords: SkuFinalExportRecord[] = [];
        const allCopyErrors: string[] = [];
        const skuAutoLayoutQaDiagnostics: string[] = [];
        const skuAutoLayoutDecisions: SkuAutoLayoutExecutorDecision[] = [];
        const skuTemplateLayoutPreflights: SkuTemplateLayoutPreflight[] = [];
        const blockedSkuTemplateLayouts: BlockedSkuTemplateLayout[] = [];
        const allToolResults: any[] = [
            { toolName: 'listDocuments', result: docsResult },
            { toolName: 'skuLayout-getCapabilities', result: skuLayoutCapabilitiesResult },
            { toolName: 'skuLayout-listLayerSets', result: layersResult }
        ];
        let skuNoPlaceholderRuntimeReadiness: SkuNoPlaceholderRuntimeReadiness | null = null;
        const ensureSkuNoPlaceholderRuntimeReady = async (stage: string): Promise<SkuNoPlaceholderRuntimeReadiness> => {
            if (skuNoPlaceholderRuntimeReadiness) {
                return skuNoPlaceholderRuntimeReadiness;
            }

            const capabilityResult = skuLayoutCapabilitiesResult?.success === false && !skuLayoutCapabilitiesResult?.data
                ? await safeToolCall(
                    'skuLayout',
                    { action: 'getCapabilities' },
                    30 * 1000,
                    `${stage}-sku-capabilities`
                )
                : skuLayoutCapabilitiesResult;
            skuNoPlaceholderRuntimeReadiness = evaluateSkuNoPlaceholderRuntimeReadiness(capabilityResult);
            if (capabilityResult !== skuLayoutCapabilitiesResult) {
                allToolResults.push({
                    toolName: 'skuLayout-getCapabilities',
                    result: capabilityResult
                });
            }

            if (!skuNoPlaceholderRuntimeReadiness.ready) {
                emitStep(
                    'warning',
                    'SKU 执行能力不可用',
                    skuNoPlaceholderRuntimeReadiness.error || '当前运行时缺少当前 SKU 执行能力。',
                    'error',
                    0.66
                );
            }

            return skuNoPlaceholderRuntimeReadiness;
        };
        const buildInvalidSkuTemplateLayoutBlocker = (
            input: {
                size: number;
                action: 'execute' | 'arrangeDynamic';
                templateDoc: any;
                preflight?: SkuTemplateLayoutPreflight;
                expectedItemCount: number;
            }
        ): BlockedSkuTemplateLayout | null => {
            const preflight = input.preflight;
            if (!preflight) return null;
            if (preflight.layoutPlan?.status === 'blocked') {
                return {
                    size: input.size,
                    action: input.action,
                    templateName: String(input.templateDoc?.name || preflight.templateName || '').trim(),
                    expectedItemCount: input.expectedItemCount,
                    placeholderCount: preflight.placeholderCount,
                    message: preflight.layoutPlan.blockers.join('；') || 'SKU 模板布局计划不可执行。'
                };
            }
            if (preflight.layoutPlan?.status === 'needs_visual_confirmation') {
                return {
                    size: input.size,
                    action: input.action,
                    templateName: String(input.templateDoc?.name || preflight.templateName || '').trim(),
                    expectedItemCount: input.expectedItemCount,
                    placeholderCount: preflight.placeholderCount,
                    message: preflight.layoutPlan.warnings.join('；')
                        || 'SKU 矩形区域容量只有候选计划，需要先结合模板截图确认后再执行。'
                };
            }
            // 设计后占位闭环（治理2026-07-02）：拦截条件与旧实现逐字节一致
            // （inspectionStatus=inspected 且占位不可靠才拦），仅把拒绝消息收敛到共享门禁，
            // 指路 createSkuPlaceholders 补占位 → inspectTemplateLayout 复验，
            // 保证 Agent 设计产物没加占位符时得到可执行的修复路径而非死路。
            const gate = evaluateSkuTemplatePlaceholderBatchEntryGate({
                size: input.size,
                action: input.action,
                templateName: String(input.templateDoc?.name || preflight.templateName || '').trim(),
                expectedItemCount: input.expectedItemCount,
                placeholderCount: preflight.placeholderCount,
                skuPlaceholderInspectionStatus: preflight.skuPlaceholderInspectionStatus,
                hasReliableSkuPlaceholders: preflight.hasReliableSkuPlaceholders
            });
            if (!gate) return null;

            return {
                size: gate.size,
                action: gate.action,
                templateName: gate.templateName,
                expectedItemCount: gate.expectedItemCount,
                placeholderCount: gate.placeholderCount,
                message: gate.message
            };
        };
        const recordInvalidSkuTemplateLayout = (blocker: BlockedSkuTemplateLayout): void => {
            blockedSkuTemplateLayouts.push(blocker);
            allCopyErrors.push(blocker.message);
            emitStep(
                'warning',
                blocker.action === 'arrangeDynamic' ? 'SKU 自选备注模板结构不可用' : 'SKU 组合模板结构不可用',
                blocker.message,
                'error',
                blocker.action === 'arrangeDynamic' ? 0.84 : 0.72
            );
        };
        const skuRuntimeReadiness = await ensureSkuNoPlaceholderRuntimeReady('sku-runtime-preflight');
        if (!skuRuntimeReadiness.ready) {
            const runtimeError = skuRuntimeReadiness.error || '当前运行时缺少当前 SKU 执行能力。';
            return {
                success: false,
                message: runtimeError,
                error: runtimeError,
                data: {
                    status: 'blocked_stale_uxp_runtime_missing_sku_execution_contract',
                    skuDocName,
                    comboSizes,
                    ...skuPlanningContext,
                    skuCardAssetCandidateReport,
                    skuCardVisualConfirmationPlan,
                    skuCardVisualConfirmationRun,
                    skuLayoutRuntimeReadiness: summarizeSkuNoPlaceholderRuntimeReadiness(skuRuntimeReadiness)
                }
            };
        }
        const skuTemplateLayoutPreflightCache = new Map<string, SkuTemplateLayoutPreflight>();
        const preflightSkuTemplateLayout = async (input: {
            templateDoc: any;
            action: 'execute' | 'arrangeDynamic';
            expectedItemCount: number;
            stage: string;
        }): Promise<any> => {
            const templateName = String(input.templateDoc?.name || '').trim();
            const cacheKey = `${templateName}::${input.action}::${input.expectedItemCount}`;
            if (skuTemplateLayoutPreflightCache.has(cacheKey)) {
                const cached = skuTemplateLayoutPreflightCache.get(cacheKey)!;
                return {
                    ...input.templateDoc,
                    ...cached,
                    skuTemplateLayoutPreflight: cached
                };
            }

            const inspectionResult = await safeToolCall(
                'skuLayout',
                {
                    action: 'inspectTemplateLayout',
                    templateDocName: templateName,
                    expectedItemCount: input.expectedItemCount
                },
                20 * 1000,
                `${input.stage}-template-layout-inspection`
            );
            const runtimeInspection = inspectionResult?.success
                ? (inspectionResult.data ?? null)
                : null;
            const runtimePreflight = buildSkuTemplateLayoutPreflightFromRuntimeInspection({
                templateDoc: input.templateDoc,
                inspection: runtimeInspection,
                expectedItemCount: input.expectedItemCount
            });
            const preflightWithWarnings: SkuTemplateLayoutPreflight = inspectionResult?.success
                ? runtimePreflight
                : {
                    ...runtimePreflight,
                    warnings: [
                        ...runtimePreflight.warnings,
                        `模板结构检查失败：${inspectionResult?.error || 'skuLayout inspectTemplateLayout unavailable'}`
                    ]
                };

            skuTemplateLayoutPreflightCache.set(cacheKey, preflightWithWarnings);
            skuTemplateLayoutPreflights.push(preflightWithWarnings);
            allToolResults.push({
                toolName: `${input.stage}-inspectTemplateLayout`,
                result: {
                    success: Boolean(inspectionResult?.success),
                    templateName: runtimeInspection?.templateName,
                    mode: runtimeInspection?.mode,
                    slotCount: runtimeInspection?.slotCount,
                    blockers: runtimeInspection?.blockers,
                    warnings: runtimeInspection?.warnings,
                    layoutPlan: preflightWithWarnings.layoutPlan,
                    error: inspectionResult?.error
                }
            });

            return {
                ...input.templateDoc,
                ...preflightWithWarnings,
                skuTemplateLayoutPreflight: preflightWithWarnings
            };
        };
        const processedSizes: string[] = [];
        const completedComboSizes = new Set<number>();
        const generatedNoteSizes = new Set<number>();
        const skippedNoteSizes = new Set<number>();

        const resolveExportedFileRecord = async (
            rawFileInfo: string,
            relativeDirName: string
        ): Promise<{ success: boolean; record?: string; error?: string }> => {
            try {
                const info = JSON.parse(rawFileInfo);

                if (info.status === 'exported_to_temp' && info.tempPath) {
                    const correctTargetDir = outputDir || info.targetDir;
                    const targetPath = `${correctTargetDir}\\${relativeDirName}\\${info.targetName}`;

                    const copyFn = (window as any).designEcho?.copyFile;
                    if (!copyFn) {
                        return { success: false, error: `${info.targetName}: copyFile unavailable` };
                    }

                    const copyResult = await copyFn(info.tempPath, targetPath);
                    if (!copyResult?.success) {
                        return { success: false, error: `${info.targetName}: ${copyResult?.error || '复制失败'}` };
                    }

                    try {
                        await (window as any).designEcho?.invoke?.('fs:deleteFile', info.tempPath);
                    } catch (e) {
                        // ignore temp cleanup failures
                    }

                    return { success: true, record: targetPath };
                }

                if (info.status === 'exported_jsx') {
                    const exportedPath = String(info.path || '').trim();
                    if (exportedPath) {
                        return { success: true, record: exportedPath };
                    }
                    if (info.targetName) {
                        return {
                            success: true,
                            record: `${relativeDirName}\\${String(info.targetName).trim()}`
                        };
                    }
                }

                if (!info.status) {
                    return { success: true, record: rawFileInfo };
                }

                return { success: false, error: `${rawFileInfo}: unsupported export status ${info.status}` };
            } catch (e) {
                const fileName = rawFileInfo.split('\\').pop() || rawFileInfo.split('/').pop() || rawFileInfo;
                return { success: true, record: fileName };
            }
        };

        const resolveComboTemplateDocument = async (
            size: number
        ): Promise<{ templateDoc?: any; error?: string }> => {
            const sizeKeyword = `${size}双`;
            const excludeNoteKeyword = '自选备注';
            let templateDoc: any = null;

            await refreshDocuments();

            if (templateKeyword && !templateKeyword.toLowerCase().includes(excludeNoteKeyword)) {
                templateDoc = findOpenedTemplateDocument({
                    size,
                    noteMode: false,
                    templateKeyword
                });
            }

            if (!templateDoc) {
                templateDoc = findOpenedTemplateDocument({
                    size,
                    noteMode: false
                });
            }

            console.log('[SKU-Batch] 组合模板预解析:', {
                sizeKeyword,
                templateKeyword: templateKeyword || '(未指定)',
                selected: templateDoc?.name ?? null,
                excluded: '含「自选备注」的文档已排除'
            });

            if (templateDoc) {
                return { templateDoc };
            }

            emitStatus(`正在准备 ${sizeKeyword}装模板。`);

            const projectResult = await tryOpenProjectTemplate(size, false);
            if (projectResult.success && projectResult.templateDoc) {
                templateDoc = projectResult.templateDoc;
            }

            if (!templateDoc) {
                let openResult: any = await safeToolCall('openProjectFile', {
                    query: `${sizeKeyword}卡片模板`,
                    type: 'all',
                    directory: templateDir
                }, 20000, `open-${sizeKeyword}-template-card`);

                if (!openResult?.success) {
                    openResult = await safeToolCall('openProjectFile', {
                        query: `${sizeKeyword}装`,
                        type: 'all',
                        directory: templateDir
                    }, 20000, `open-${sizeKeyword}-template-primary`);
                }

                if (!openResult?.success) {
                    openResult = await safeToolCall('openProjectFile', {
                        query: sizeKeyword,
                        type: 'all',
                        directory: templateDir
                    }, 20000, `open-${sizeKeyword}-template-secondary`);
                }

                if (openResult?.success) {
                    // 早退轮询取代固定 sleep(1000)：openProjectFile 成功后文档未必即时进入 listDocuments。
                    // 原写法固定等 1000ms 再查【一次】——文档若在 1000ms 之后才出现会被漏掉而落入 library 兜底，
                    // 文档若很快就绪也白等满 1000ms。改为「刷新+查找」轮询，命中即返回；总等待预算 ≥ 原 1000ms。
                    // 注意：只改这一处等待方式，不触碰每组合重解析护栏（skuLayout 每组合导出后会关闭模板，重解析是刚需）。
                    for (let attempt = 0; attempt < 4 && !templateDoc; attempt++) {
                        if (attempt > 0) await sleep(500);
                        await refreshDocuments();
                        templateDoc = findOpenedTemplateDocument({
                            size,
                            noteMode: false
                        });
                    }
                }

                const libResult = templateDoc
                    ? { success: true, templateDoc }
                    : await tryOpenLibraryTemplate(size, false);
                if (libResult.success && libResult.templateDoc) {
                    templateDoc = libResult.templateDoc;
                } else {
                    const reason = openResult?.error
                        ? String(openResult.error)
                        : (projectResult.error || (openResult?.timeout ? '打开模板超时' : '未找到模板文件'));
                    const mergedReason = libResult.error ? `${reason}; 备用模板: ${libResult.error}` : reason;
                    return { error: `${size}双模板: ${mergedReason}` };
                }
            }

            if (!templateDoc) {
                return { error: `${size}双: 模板不可用` };
            }

            return { templateDoc };
        };

        const resolveNoteTemplateDocument = async (
            size: number
        ): Promise<{ templateDoc?: any; error?: string }> => {
            await refreshDocuments();
            let noteTemplateDoc = findOpenedTemplateDocument({
                size,
                noteMode: true
            });

            if (noteTemplateDoc) {
                return { templateDoc: noteTemplateDoc };
            }

            const noteProjectResult = await tryOpenProjectTemplate(size, true);
            if (noteProjectResult.success && noteProjectResult.templateDoc) {
                noteTemplateDoc = noteProjectResult.templateDoc;
            }

            if (!noteTemplateDoc) {
                let noteOpenResult: any = await safeToolCall('openProjectFile', {
                    query: `${size}双自选备注卡片模板`,
                    type: 'all',
                    directory: templateDir
                }, 20000, `open-${size}note-template-card`);

                if (!noteOpenResult?.success) {
                    noteOpenResult = await safeToolCall('openProjectFile', {
                        query: `${size}双自选备注`,
                        type: 'all',
                        directory: templateDir
                    }, 20000, `open-${size}note-template-primary`);
                }

                if (!noteOpenResult?.success) {
                    noteOpenResult = await safeToolCall('openProjectFile', {
                        query: `${size}双装自选备注`,
                        type: 'all',
                        directory: templateDir
                    }, 20000, `open-${size}note-template-secondary`);
                }

                // 早退轮询取代固定 sleep(600)（口径同组合模板）：命中即返回，总等待预算 ≥ 原 600ms。
                for (let attempt = 0; attempt < 3 && !noteTemplateDoc; attempt++) {
                    if (attempt > 0) await sleep(400);
                    await refreshDocuments();
                    noteTemplateDoc = findOpenedTemplateDocument({
                        size,
                        noteMode: true
                    });
                }

                const noteLibResult = noteTemplateDoc
                    ? { success: true, templateDoc: noteTemplateDoc }
                    : await tryOpenLibraryTemplate(size, true);
                if (noteLibResult.success && noteLibResult.templateDoc) {
                    noteTemplateDoc = noteLibResult.templateDoc;
                } else {
                    const reason = noteLibResult.error
                        || noteOpenResult?.error
                        || noteProjectResult.error
                        || (noteOpenResult?.timeout ? '打开自选备注模板超时' : '未找到自选备注模板');
                    return { error: `${size}双自选备注: ${reason}` };
                }
            }

            if (!noteTemplateDoc) {
                return { error: `${size}双自选备注: 未找到模板` };
            }

            return { templateDoc: noteTemplateDoc };
        };

        const resolvedSkuAssetsBySize = new Map<number, ResolvedSkuExecutionAssets>();
        emitStatus('正在准备 SKU 模板和素材。', 51);
        emitStep(
            'tool_planned',
            '准备 SKU 批量执行清单',
            '先解析所有规格、组合模板和自选备注模板，再连续执行 Photoshop 排版。',
            'running',
            0.51
        );

        for (const [sizeStr, combos] of Object.entries(combosBySize)) {
            const size = parseInt(sizeStr, 10);
            const noteDecision = decideSkuSelfSelectNoteGeneration({
                comboSize: size,
                notesRequested: effectiveGenerateNotes,
                onlyNotes
            });
            const shouldRunCombo = !onlyNotes && Array.isArray(combos) && combos.length > 0;
            const shouldRunNote = (effectiveGenerateNotes || onlyNotes) && noteDecision.shouldGenerate;
            const resolvedAssets: ResolvedSkuExecutionAssets = {
                size,
                comboCount: Array.isArray(combos) ? combos.length : 0,
                shouldRunCombo,
                shouldRunNote
            };

            if (shouldRunCombo) {
                const comboTemplate = await resolveComboTemplateDocument(size);
                resolvedAssets.comboTemplateDoc = comboTemplate.templateDoc;
                resolvedAssets.comboTemplateError = comboTemplate.error;
            }

            if (shouldRunNote) {
                const noteTemplate = await resolveNoteTemplateDocument(size);
                resolvedAssets.noteTemplateDoc = noteTemplate.templateDoc;
                resolvedAssets.noteTemplateError = noteTemplate.error;
            }

            resolvedSkuAssetsBySize.set(size, resolvedAssets);
        }

        const skuExecutionManifest = Array.from(resolvedSkuAssetsBySize.values()).map((item) => {
            const blockers = [
                item.shouldRunCombo && !item.comboTemplateDoc ? item.comboTemplateError || `${item.size}双模板不可用` : '',
                item.shouldRunNote && !item.noteTemplateDoc ? item.noteTemplateError || `${item.size}双自选备注模板不可用` : ''
            ].filter(Boolean);

            const plannedActions = [
                item.shouldRunCombo ? 'combo' : '',
                item.shouldRunNote ? 'self-select-note' : ''
            ].filter(Boolean);

            return {
                size: item.size,
                comboCount: item.comboCount,
                plannedActions,
                comboTemplateName: item.comboTemplateDoc?.name,
                noteTemplateName: item.noteTemplateDoc?.name,
                status: blockers.length > 0
                    ? 'blocked'
                    : plannedActions.length > 0
                        ? 'ready'
                        : 'skipped',
                blockers
            };
        });

        const readyManifestCount = skuExecutionManifest.filter(item => item.status === 'ready').length;
        const blockedManifestCount = skuExecutionManifest.filter(item => item.status === 'blocked').length;
        emitStatus(
            `SKU 准备完成：可执行 ${readyManifestCount} 个规格` +
            `${blockedManifestCount > 0 ? `，阻断 ${blockedManifestCount} 个规格` : ''}。`,
            56
        );
        emitStep(
            blockedManifestCount > 0 ? 'warning' : 'verification',
            'SKU 执行清单准备完成',
            `ready=${readyManifestCount}; blocked=${blockedManifestCount}; sizes=${skuExecutionManifest.map(item => item.size).join(' / ')}`,
            blockedManifestCount > 0 ? 'running' : 'success',
            0.56
        );
        
        for (const [sizeStr, combos] of Object.entries(combosBySize)) {
            const size = parseInt(sizeStr, 10);
            emitStep(
                'observation',
                '准备处理 SKU 规格',
                onlyNotes ? `${size} 双自选备注。` : `${size} 双，组合 ${combos.length} 组。`,
                'running',
                0.52
            );
            
            if (signal?.aborted) {
                emitStep('stopped', 'SKU 批量生成已停止', '用户取消或信号中止。', 'error', 1);
                return {
                    success: true,
                    cancelled: true,
                    message: '⏹️ 已停止'
                };
            }
            
            if (!onlyNotes && combos.length === 0) continue;
            
            if (onlyNotes) {
                emitStatus(`正在处理 ${size}双自选备注。`);
            } else {
                emitStatus(`正在处理 ${size}双规格。`);
            }
            
            const resolvedAssets = resolvedSkuAssetsBySize.get(size);
            const templateDoc = resolvedAssets?.comboTemplateDoc || null;

            // 使用执行前已解析的模板文档，避免每个规格边规划边执行。
            if (!onlyNotes) {
                if (!templateDoc) {
                    allCopyErrors.push(resolvedAssets?.comboTemplateError || `${size}双: 模板不可用`);
                    emitStep('warning', 'SKU 规格模板不可用', `${size} 双没有找到可用组合模板。`, 'error', 0.62);
                    continue;
                }

                await executeToolCall('switchDocument', { documentName: templateDoc.name }, { signal });
            }
            
            // 执行 SKU 排版（非 onlyNotes 模式）
            if (!onlyNotes) {
                emitStatus(`正在排版 ${size}双 SKU。`);
                
                const comboBatches = buildSkuLayoutComboBatches({
                    size,
                    combos,
                    maxRowsPerToolCall: 1
                });
                let producedComboFiles = 0;
                let shouldStopComboBatches = false;

                for (const batch of comboBatches) {
                    emitStatus(`正在排版 ${size}双 SKU 批次 ${batch.batchIndex}/${batch.batchCount}。`);
                    const batchTemplateResult = batch.batchIndex === 1
                        ? { templateDoc }
                        : await resolveComboTemplateDocument(size);
                    const batchTemplateDoc = batchTemplateResult.templateDoc;
                    if (!batchTemplateDoc) {
                        const batchError = batchTemplateResult.error || `${size}双批次 ${batch.batchIndex}/${batch.batchCount}: 模板不可用`;
                        allCopyErrors.push(batchError);
                        emitStep('warning', 'SKU 规格模板批次不可用', batchError, 'error', 0.72);
                        break;
                    }
                    const comboExpectedItemCount = Math.max(1, Number(batch.combos?.[0]?.length || size || 1));
                    const comboTemplateDocWithPreflight = await preflightSkuTemplateLayout({
                        templateDoc: batchTemplateDoc,
                        action: 'execute',
                        expectedItemCount: comboExpectedItemCount,
                        stage: `sku-layout-${size}-batch-${batch.batchIndex}`
                    });
                    const comboTemplateBlocker = buildInvalidSkuTemplateLayoutBlocker({
                        size,
                        action: 'execute',
                        templateDoc: comboTemplateDocWithPreflight,
                        preflight: comboTemplateDocWithPreflight.skuTemplateLayoutPreflight,
                        expectedItemCount: comboExpectedItemCount
                    });
                    if (comboTemplateBlocker) {
                        recordInvalidSkuTemplateLayout(comboTemplateBlocker);
                        shouldStopComboBatches = true;
                        break;
                    }
                    const comboLayoutPlan = comboTemplateDocWithPreflight.skuTemplateLayoutPreflight?.layoutPlan;
                    if (
                        comboLayoutPlan?.placementMethod === 'region_composition'
                        && !supportsSkuRegionComposition(skuLayoutCapabilitiesResult)
                    ) {
                        const regionCapabilityBlocker: BlockedSkuTemplateLayout = {
                            size,
                            action: 'execute',
                            templateName: String(comboTemplateDocWithPreflight.name || '').trim(),
                            expectedItemCount: comboExpectedItemCount,
                            placeholderCount: Number(comboTemplateDocWithPreflight.skuTemplateLayoutPreflight?.placeholderCount || 0),
                            message: `当前 UXP 运行版本缺少 ${REQUIRED_SKU_REGION_COMPOSITION_REVISION}，不能安全执行 6.0 矩形区域组合排版；请重新加载 DesignEcho UXP 插件后重试。`
                        };
                        recordInvalidSkuTemplateLayout(regionCapabilityBlocker);
                        shouldStopComboBatches = true;
                        break;
                    }
                    const comboAutoLayoutDecision = buildSkuAutoLayoutExecutorPolicy({
                        userInput: normalizedUserInput,
                        params,
                        action: 'execute',
                        templateDoc: comboTemplateDocWithPreflight
                    });
                    skuAutoLayoutDecisions.push(comboAutoLayoutDecision);
                    if (comboAutoLayoutDecision.enabled) {
                        const runtimeReady = await ensureSkuNoPlaceholderRuntimeReady(`sku-layout-${size}-batch-${batch.batchIndex}`);
                        if (!runtimeReady.ready) {
                            const batchError = `${size}双批次 ${batch.batchIndex}/${batch.batchCount}: ${runtimeReady.error || 'SKU 无占位符自动排版能力不可用'}`;
                            allCopyErrors.push(batchError);
                            emitStep('warning', 'SKU 无占位符排版已停止', batchError, 'error', 0.72);
                            shouldStopComboBatches = true;
                            break;
                        }
                    }
                    const executeResult = await executeSkuLayoutWithModalRetry({
                        action: 'execute',
                        combos: batch.combos,
                        skuDocName: skuDocName,
                        templateDocName: comboTemplateDocWithPreflight.name,
                        autoLayoutWithoutPlaceholders: comboAutoLayoutDecision.enabled,
                        regionCapacities: comboLayoutPlan?.placementMethod === 'region_composition'
                            ? comboLayoutPlan.regionCapacities
                            : undefined,
                        outputFormat: 'jpg',
                        quality: 12,
                        outputDir: outputDir
                    }, `sku-layout-${size}-batch-${batch.batchIndex}`);

                    allToolResults.push({
                        toolName: `skuLayout-${size}双-${batch.batchIndex}/${batch.batchCount}`,
                        result: executeResult
                    });
                    const comboQaDiagnostics = collectSkuAutoLayoutQaDiagnostics(executeResult, `${size}双批次 ${batch.batchIndex}/${batch.batchCount}`);
                    appendUniqueDiagnostics(skuAutoLayoutQaDiagnostics, comboQaDiagnostics);
                    appendUniqueDiagnostics(allCopyErrors, comboQaDiagnostics);
                    const comboFailureDiagnostics = collectSkuLayoutFailureDiagnostics(executeResult, `${size}双批次 ${batch.batchIndex}/${batch.batchCount}`);
                    appendUniqueDiagnostics(allCopyErrors, comboFailureDiagnostics);

                    if (executeResult?.success) {
                        const exportedFiles = executeResult.data?.exportedFiles || [];

                        for (const fileInfo of exportedFiles) {
                            const resolvedFile = await resolveExportedFileRecord(fileInfo, `${size}\u53cc`);
                            if (resolvedFile.success && resolvedFile.record) {
                                allFinalFiles.push(resolvedFile.record);
                                allFinalExportRecords.push({
                                    path: resolvedFile.record,
                                    expectedDimensions: getDocumentExportDimensions(comboTemplateDocWithPreflight)
                                });
                                producedComboFiles += 1;
                            } else if (resolvedFile.error) {
                                allCopyErrors.push(resolvedFile.error);
                            }
                        }

                        continue;
                    }

                    const batchError = comboFailureDiagnostics[0] || `${size}双批次 ${batch.batchIndex}/${batch.batchCount}: ${executeResult?.error || '排版失败'}`;
                    if (!allCopyErrors.includes(batchError)) allCopyErrors.push(batchError);
                    emitStep('warning', 'SKU 规格排版批次失败', batchError, 'error', 0.72);
                    if (executeResult?.timeout) {
                        shouldStopComboBatches = true;
                        break;
                    }
                }

                if (producedComboFiles > 0) {
                    completedComboSizes.add(size);
                    processedSizes.push(
                        producedComboFiles === combos.length
                            ? `${size}双 (${combos.length}组)`
                            : `${size}双 (${producedComboFiles}/${combos.length}组)`
                    );
                    emitStep(
                        producedComboFiles === combos.length ? 'verification' : 'warning',
                        producedComboFiles === combos.length ? 'SKU 规格排版完成' : 'SKU 规格排版部分完成',
                        `${size} 双导出 ${producedComboFiles}/${combos.length} 个组合文件。`,
                        producedComboFiles === combos.length ? 'success' : 'error',
                        0.72
                    );
                } else {
                    allCopyErrors.push(`${size}双: 未导出任何文件`);
                    emitStep('warning', 'SKU 规格排版无导出', `${size} 双没有导出文件。`, 'error', 0.72);
                }

                if (shouldStopComboBatches) {
                    emitStep('warning', 'SKU 规格排版已停止继续批次', `${size} 双有批次超时，停止该规格剩余批次以避免重复写入。`, 'error', 0.72);
                }
            }
            
            // 生成自选备注
            if (effectiveGenerateNotes || onlyNotes) {
                const noteDecision = decideSkuSelfSelectNoteGeneration({
                    comboSize: size,
                    notesRequested: effectiveGenerateNotes,
                    onlyNotes
                });

                if (!noteDecision.shouldGenerate) {
                    skippedNoteSizes.add(size);
                    emitStep('verification', 'SKU 自选备注已跳过', `${size} 双：${noteDecision.message}`, 'success', 0.78);
                    emitStatus(`已跳过 ${size}双自选备注：${noteDecision.message}。`);
                    if (onlyNotes && !processedSizes.includes(`${size}双 (自选备注已跳过)`)) {
                        processedSizes.push(`${size}双 (自选备注已跳过)`);
                    }
                    continue;
                }

                emitStatus(`正在生成 ${size}双自选备注。`);
                const noteTemplateDoc = resolvedAssets?.noteTemplateDoc || null;

                if (noteTemplateDoc) {
                    await executeToolCall('switchDocument', { documentName: noteTemplateDoc.name }, { signal });
                    const configuredNoteCombos = configuredNoteCombosBySize[size] || [];
                    
                    const noteCombos = configuredNoteCombos.length > 0 ? configuredNoteCombos : [validColors];
                    const noteBatches = buildSkuLayoutComboBatches({
                        size,
                        combos: noteCombos,
                        maxRowsPerToolCall: 1
                    });
                    let producedNoteFiles = 0;
                    let noteBatchFailed = false;

                    for (const batch of noteBatches) {
                        const batchNoteTemplateResult = batch.batchIndex === 1
                            ? { templateDoc: noteTemplateDoc }
                            : await resolveNoteTemplateDocument(size);
                        const batchNoteTemplateDoc = batchNoteTemplateResult.templateDoc;
                        if (!batchNoteTemplateDoc) {
                            noteBatchFailed = true;
                            const noteError = batchNoteTemplateResult.error || `${size}双自选备注批次 ${batch.batchIndex}/${batch.batchCount}: 模板不可用`;
                            allCopyErrors.push(noteError);
                            emitStep('warning', 'SKU 自选备注模板批次不可用', noteError, 'error', 0.84);
                            break;
                        }
                        const noteExpectedItemCount = Math.max(1, Number(batch.combos?.[0]?.length || size || 1));
                        const noteTemplateDocWithPreflight = await preflightSkuTemplateLayout({
                            templateDoc: batchNoteTemplateDoc,
                            action: 'arrangeDynamic',
                            expectedItemCount: noteExpectedItemCount,
                            stage: `sku-note-${size}-batch-${batch.batchIndex}`
                        });
                        const noteTemplateBlocker = buildInvalidSkuTemplateLayoutBlocker({
                            size,
                            action: 'arrangeDynamic',
                            templateDoc: noteTemplateDocWithPreflight,
                            preflight: noteTemplateDocWithPreflight.skuTemplateLayoutPreflight,
                            expectedItemCount: noteExpectedItemCount
                        });
                        if (noteTemplateBlocker) {
                            noteBatchFailed = true;
                            recordInvalidSkuTemplateLayout(noteTemplateBlocker);
                            break;
                        }
                        const noteAutoLayoutDecision = buildSkuAutoLayoutExecutorPolicy({
                            userInput: normalizedUserInput,
                            params,
                            action: 'arrangeDynamic',
                            templateDoc: noteTemplateDocWithPreflight
                        });
                        skuAutoLayoutDecisions.push(noteAutoLayoutDecision);
                        if (noteAutoLayoutDecision.enabled) {
                            const runtimeReady = await ensureSkuNoPlaceholderRuntimeReady(`sku-note-${size}-batch-${batch.batchIndex}`);
                            if (!runtimeReady.ready) {
                                noteBatchFailed = true;
                                const noteError = `${size}双自选备注批次 ${batch.batchIndex}/${batch.batchCount}: ${runtimeReady.error || 'SKU 无占位符自动排版能力不可用'}`;
                                allCopyErrors.push(noteError);
                                emitStep('warning', 'SKU 自选备注无占位符排版已停止', noteError, 'error', 0.84);
                                break;
                            }
                        }
                        const noteResult = await executeSkuLayoutWithModalRetry({
                            action: 'arrangeDynamic',
                            combos: batch.combos,
                            skuDocName: skuDocName,
                            templateDocName: noteTemplateDocWithPreflight.name,
                            autoLayoutWithoutPlaceholders: noteAutoLayoutDecision.enabled,
                            outputFormat: 'jpg',
                            quality: 12,
                            outputDir: outputDir,
                            noteFilePrefix: noteBatches.length > 1
                                ? `${size}双自选备注-${batch.batchIndex}`
                                : `${size}双自选备注`
                        }, `sku-note-${size}-batch-${batch.batchIndex}`);

                        allToolResults.push({
                            toolName: `skuLayout-${size}双自选备注-${batch.batchIndex}/${batch.batchCount}`,
                            result: noteResult
                        });
                        const noteQaDiagnostics = collectSkuAutoLayoutQaDiagnostics(noteResult, `${size}双自选备注批次 ${batch.batchIndex}/${batch.batchCount}`);
                        appendUniqueDiagnostics(skuAutoLayoutQaDiagnostics, noteQaDiagnostics);
                        appendUniqueDiagnostics(allCopyErrors, noteQaDiagnostics);
                        const noteFailureDiagnostics = collectSkuLayoutFailureDiagnostics(noteResult, `${size}双自选备注批次 ${batch.batchIndex}/${batch.batchCount}`);
                        appendUniqueDiagnostics(allCopyErrors, noteFailureDiagnostics);

                        if (noteResult?.success) {
                            const noteFiles = noteResult.data?.exportedFiles || [];

                            for (const fileInfo of noteFiles) {
                                const resolvedFile = await resolveExportedFileRecord(fileInfo, `${size}\u53cc\u81ea\u9009\u5907\u6ce8`);
                                if (resolvedFile.success && resolvedFile.record) {
                                    allFinalFiles.push(resolvedFile.record);
                                    allFinalExportRecords.push({
                                        path: resolvedFile.record,
                                        expectedDimensions: getDocumentExportDimensions(noteTemplateDocWithPreflight)
                                    });
                                    producedNoteFiles += 1;
                                } else if (resolvedFile.error) {
                                    allCopyErrors.push(resolvedFile.error);
                                }
                            }

                            continue;
                        }

                        noteBatchFailed = true;
                        const noteError = noteFailureDiagnostics[0] || `${size}双自选备注批次 ${batch.batchIndex}/${batch.batchCount}: ${String(noteResult?.error || '生成失败')}`;
                        if (!allCopyErrors.includes(noteError)) allCopyErrors.push(noteError);
                        emitStep('warning', 'SKU 自选备注批次失败', noteError, 'error', 0.84);
                        if (noteResult?.timeout) break;
                    }

                    if (producedNoteFiles > 0) {
                        generatedNoteSizes.add(size);
                        emitStep(
                            noteBatchFailed ? 'warning' : 'verification',
                            noteBatchFailed ? 'SKU 自选备注部分完成' : 'SKU 自选备注生成完成',
                            `${size} 双自选备注导出 ${producedNoteFiles} 个文件。`,
                            noteBatchFailed ? 'error' : 'success',
                            0.84
                        );
                    } else {
                        allCopyErrors.push(`${size}双自选备注: 未导出任何文件`);
                        emitStep('warning', 'SKU 自选备注无导出', `${size} 双自选备注没有导出文件。`, 'error', 0.84);
                    }

                    if (onlyNotes && producedNoteFiles > 0 && !processedSizes.includes(`${size}双 (自选备注)`)) {
                        processedSizes.push(`${size}双 (自选备注)`);
                    }
                } else {
                    allCopyErrors.push(resolvedAssets?.noteTemplateError || `${size}双自选备注: 未找到模板`);
                    emitStep('warning', 'SKU 自选备注模板不可用', `${size} 双没有找到自选备注模板。`, 'error', 0.84);
                }
            }
        }
        
        // 8. 汇总结果
        const completedCombosBySize = Object.fromEntries(
            Object.entries(combosBySize).filter(([size]) => completedComboSizes.has(Number(size)))
        ) as Record<string, string[][]>;
        const totalCombos = Object.values(completedCombosBySize).reduce((sum, arr) => sum + arr.length, 0);
        const noteCount = generatedNoteSizes.size;
        
        const exportFileNames = allFinalFiles.map(f => {
            const fileName = f.split(/[/\\]/).pop() || f;
            return fileName;
        });

        const totalGenerated = totalCombos + noteCount;
        const skippedNoteCount = skippedNoteSizes.size;
        const skuExportFileProbes: any[] = [];
        const probeImageFile = (window as any).designEcho?.probeImageFile;
        if (allFinalFiles.length > 0 && typeof probeImageFile === 'function') {
            for (const exportedPath of allFinalFiles) {
                if (!isProbeableExportPath(exportedPath)) continue;
                try {
                    const probe = await probeImageFile(exportedPath);
                    if (probe) skuExportFileProbes.push(probe);
                } catch (error) {
                    skuExportFileProbes.push({
                        success: false,
                        path: exportedPath,
                        status: 'decode_failed',
                        rawImagesRedacted: true,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }
        const skuExportReadback = buildSkuExportReadback({
            expectedExportPaths: allFinalFiles,
            expectedExports: allFinalExportRecords,
            fileProbes: skuExportFileProbes
        });
        const designPlanner = buildSkuBatchPlannerContext({
            userInput: String(params.userIntent || _context?.userInput || '').trim(),
            params,
            context: _context,
            projectPath: projectContext?.projectPath,
            comboSizes,
            colorCount: validColors.length,
            totalCombinations: totalCombos,
            processedSizeCount: processedSizes.length
        });
        const skuColorCardImageProbeReview = buildSkuColorCardImageProbeReview({
            exportReadback: skuExportReadback,
            colorCardRetouchStrategy: designPlanner.skuColorCardRetouchStrategy
        });
        const skuHumanReviewTarget = buildSkuHumanReviewTarget({
            projectIdentity: projectContext?.projectPath,
            exportReadback: skuExportReadback
        });
        const skuHumanReviewRecords = skuHumanReviewTarget.projectFingerprint
            ? getMemoryService().listHumanReviewRecords({
                projectId: skuHumanReviewTarget.projectFingerprint,
                scenario: 'sku',
                limit: 50
            })
            : [];
        const matchingSkuHumanReviewRecord = skuHumanReviewTarget.subject
            ? skuHumanReviewRecords.find((record) => (
                record.source?.subject?.fingerprint === skuHumanReviewTarget.subject?.fingerprint
            ))
            : undefined;
        const skuHumanReviewBinding = buildSkuHumanReviewBinding({
            target: skuHumanReviewTarget,
            record: matchingSkuHumanReviewRecord || skuHumanReviewRecords[0]
        });
        const skuVisualReviewIntake = buildSkuVisualReviewIntake({
            configuredPlan: skuConfiguredExecutionPlan,
            executionManifest: skuExecutionManifest,
            exportReadback: skuExportReadback,
            colorCardRetouchStrategy: designPlanner.skuColorCardRetouchStrategy,
            colorCardImageProbeReview: skuColorCardImageProbeReview,
            autoLayoutDecisions: skuAutoLayoutDecisions,
            autoLayoutQaDiagnostics: skuAutoLayoutQaDiagnostics,
            humanReview: skuHumanReviewBinding.review
        });
        const skuHumanReviewCard = skuVisualReviewIntake.status === 'ready_for_human_review'
            ? buildSkuHumanReviewCard({
                target: skuHumanReviewTarget,
                requirements: skuVisualReviewIntake.requirements
            })
            : undefined;
        if (skuExportReadback.status === 'blocked') {
            allCopyErrors.push(`SKU 导出读回失败：${skuExportReadback.blockers.join('；')}`);
        } else if (skuExportReadback.status === 'needs_file_probe') {
            allCopyErrors.push(`SKU 导出读回待复核：${skuExportReadback.blockers.join('；')}`);
        }
        const templateRelatedFailure = allCopyErrors.some(e => e.includes('模板'));
        const hasProcessedSizes = processedSizes.length > 0;
        const hasWarnings = allCopyErrors.length > 0;
        const blockedByInvalidSkuTemplateLayout = blockedSkuTemplateLayouts.length > 0 && !hasProcessedSizes;
        const deliveryStatus = !hasProcessedSizes ? 'failed' : hasWarnings ? 'partial' : 'completed';
        const resultStatus = blockedByInvalidSkuTemplateLayout
            ? 'blocked_invalid_sku_template_layout'
            : deliveryStatus;
        const skuDeliverySummary = buildSkuDeliverySummary({
            status: deliveryStatus,
            skuDocName,
            processedSizes,
            completedCombosBySize,
            generatedNoteSizes,
            skippedNoteSizes,
            exportedFileNames: exportFileNames,
            warnings: allCopyErrors
        });
        const errorSummary = allCopyErrors.length > 0
            ? `\n\n需要复核：\n${allCopyErrors.map(e => `- ${e}`).join('\n')}`
            : '';
        const templateHint = templateRelatedFailure
            ? `\n\n**排查建议**\n${summarizeTemplateAvailability({
                templateDir,
                projectTemplates: projectSkuTemplates,
                localTemplates: localSkuTemplates,
                localSpecs: localLibrarySpecs
            })}\n1. 在当前项目的「模板文件」文件夹放入如「2双装/3双装/4双装」模板文件\n2. 或先在 Photoshop 打开对应规格模板后再执行\n3. 或在模板设置中补充备用 SKU 模板（支持 PSD/PSB/TIF）`
            : '';
        
        const successMessage = processedSizes.length > 0
            ? skuDeliverySummary.compactText
            : `⚠️ SKU 批量生成失败\n\n未能处理任何规格。${errorSummary}${templateHint}`;
        const skuPlanInputs: SkuBatchPlanInput[] = Object.entries(combosBySize)
            .map(([size, combos]) => ({
                size: Number(size),
                comboCount: Array.isArray(combos) ? combos.length : 0,
                noteGenerated: generatedNoteSizes.has(Number(size)),
                warnings: allCopyErrors.filter((error) => String(error).includes(`${size}双`))
            }))
            .filter((item) => Number.isFinite(item.size));
        const publicToolResults = sanitizeSkuToolResultsForPublicResult(allToolResults);
        const designAgentOs = buildSkuDesignAgentOsRecord({
            userInput: String(params.userIntent || _context?.userInput || '').trim(),
            colorCount: validColors.length,
            totalCombinations: totalCombos,
            specs: skuPlanInputs,
            toolResults: publicToolResults,
            success: processedSizes.length > 0,
            warnings: allCopyErrors,
            blockers: processedSizes.length > 0 ? [] : ['未能处理任何 SKU 规格。']
        });
        emitStep(
            'finalizing',
            'SKU 批量生成结果已汇总',
            `处理规格 ${processedSizes.length} 个，组合 ${totalCombos} 个，导出文件 ${allFinalFiles.length} 个，警告 ${allCopyErrors.length} 条。`,
            processedSizes.length > 0 ? 'success' : 'error',
            1
        );
        
        return {
            success: processedSizes.length > 0,
            message: successMessage,
            toolResults: publicToolResults,
            data: {
                totalCombos,
                totalGenerated,
                processedSizes,
                exportCount: allFinalFiles.length,
                warningCount: allCopyErrors.length,
                status: resultStatus,
                partial: resultStatus === 'partial',
                warnings: allCopyErrors,
                blockedSkuTemplateLayouts,
                skuDeliverySummary,
                skuNoPlaceholderRuntimeReadiness: summarizeSkuNoPlaceholderRuntimeReadiness(skuNoPlaceholderRuntimeReadiness),
                skuConfiguredExecutionPlan,
                ...skuPlanningContext,
                skuCardAssetCandidateReport,
                skuCardVisualConfirmationPlan,
                skuCardVisualConfirmationRun,
                skuCardSourcePreparationPlan,
                skuCardSourcePreparationRun,
                skuCardTemplatePreparationPlan,
                skuCardTemplatePreparationRun,
                skuExportReadback,
                skuVisualReviewIntake,
                skuHumanReviewTarget,
                skuHumanReviewBinding,
                ...(skuHumanReviewCard ? { interactiveCards: [skuHumanReviewCard] } : {}),
                skuColorCardImageProbeReview,
                skuAutoLayoutDecisions,
                skuTemplateLayoutPreflights,
                skuAutoLayoutQaDiagnostics,
                skuExecutionManifest,
                skippedNoteSizes: Array.from(skippedNoteSizes).sort((a, b) => a - b),
                designAgentOs,
                skuMemoryContext: designPlanner.businessSkillMemoryContext,
                businessSkillMemoryContext: designPlanner.businessSkillMemoryContext,
                skuMemoryStrategy: designPlanner.skuMemoryStrategy,
                businessSkillMemoryStrategy: designPlanner.businessSkillMemoryStrategy,
                ecommerceSocksChildStrategyInput: designPlanner.ecommerceSocksChildStrategyInput,
                skuColorCardRetouchStrategy: designPlanner.skuColorCardRetouchStrategy,
                skuDesignPlacementIntelligence: designPlanner.skuDesignPlacementIntelligence,
                businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence,
                designPlanner
            }
        };
    }
};
