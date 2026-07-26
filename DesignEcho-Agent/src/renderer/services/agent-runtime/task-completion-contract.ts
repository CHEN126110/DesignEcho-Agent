import type {
    AgentExecutionStatus,
    AgentToolCallLogEntry,
    TaskCompletionContext,
    TaskCompletionContract,
    TaskCompletionVerification,
    TaskCompletionKind,
    TaskCompletionReferenceObservation,
    TaskCompletionRequirement
} from './types';
import { readAgentVisualObservation } from './visual-observation-strategy';
import type {
    DesignEvaluationProfile,
    DesignEvaluationProfileResult
} from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import {
    buildAgentOperationDocumentTimeline,
    findLatestObservedPhotoshopMutationIndex,
    sameAgentOperationDocumentContext
} from '../../../shared/agent-operation-document-timeline';
import {
    classifyAgentToolExecution,
    isAgentPhotoshopDocumentObservation
} from '../../../shared/agent-tool-execution-preflight';

const INSPECTION_TOOLS = new Set([
    'getDocumentInfo',
    'getLayerHierarchy',
    'getAllTextLayers',
    'getTextContent',
    'getLayerBounds',
    'getLayerProperties',
    'getCanvasSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'getAcceptanceSnapshot',
    'parseDetailPageTemplate',
    'describeImage',
    'listProjectResources',
    'searchProjectResources'
]);

const TEXT_MUTATION_TOOLS = new Set([
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'moveLayer',
    'quickScale'
]);

const LAYER_ORDER_MUTATION_TOOLS = new Set([
    'reorderLayer'
]);

const LAYER_ORDER_VERIFICATION_TOOLS = new Set([
    'getLayerHierarchy',
    'getAcceptanceSnapshot'
]);

const LAYER_MANAGEMENT_MUTATION_TOOLS = new Set([
    'selectLayer',
    'renameLayer',
    'batchRenameLayers',
    'deleteLayer',
    'duplicateLayer',
    'groupLayers',
    'ungroupLayers',
    'createGroup',
    'setLayerOpacity',
    'setBlendMode',
    'setLayerVisibility',
    'lockLayer',
    // 真机病例（2026-07-07）：「置入到组内矩形+建剪切蒙版」被分类为图层管理，但置入/剪切/
    // 移动/排序都不在本集合——任务实际完成却判 0/3 未完成，触发无谓重跑并重复置入。
    // 图层关系操作全量补齐：完成检查必须覆盖该分类下真实会用到的写工具。
    'placeImage',
    'createClippingMask',
    'releaseClippingMask',
    'moveLayer',
    'moveLayerToGroup',
    'reorderLayer',
    'fitLayerSubjectToRegion'
]);

const LAYER_MANAGEMENT_VERIFICATION_TOOLS = new Set([
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot',
    // 剪切关系/边界/查找类读回同样是有效复核结果
    'getClippingMaskInfo',
    'getAllClippingMasks',
    'getLayerBounds',
    'findLayers',
    'getCanvasSnapshot'
]);

const DOCUMENT_SAVE_TOOLS = new Set([
    'saveDocument',
    'smartSave',
    'quickExport',
    'exportDetailPageSlices',
    // 用户导出规范 4.0 移植（2026-07-07）：主图/详情页批量导出——完成契约必须认它为保存结果
    'exportMainImageDocuments'
]);

const DOCUMENT_CLOSE_TOOLS = new Set([
    'closeDocument'
]);

const DOCUMENT_VERIFICATION_TOOLS = new Set([
    'getDocumentInfo',
    'listDocuments',
    'getAcceptanceSnapshot'
]);

const REFERENCE_MUTATION_TOOLS = new Set([
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'createRectangle',
    'createShape',
    'placeImage',
    'replaceLayerContent',
    'moveLayer',
    'quickScale',
    'fillDetailPage',
    'matchDetailPageContent'
]);

const TEXT_VERIFICATION_TOOLS = new Set([
    'getAllTextLayers',
    'getTextContent',
    'getLayerBounds',
    'getLayerProperties',
    'getAcceptanceSnapshot'
]);

const VISUAL_VERIFICATION_TOOLS = new Set([
    'getScreenSnapshotsWithOverlay',
    'getScreenSnapshots',
    'getCanvasSnapshot',
    'auditDetailPagePlacement'
]);

// 创意设计（从零做主图/详情页/海报）的成品判定工具集：新建画布 → 主视觉 → 文案 → 画面复核。
const DESIGN_CREATE_DOCUMENT_TOOLS = new Set([
    'createDocument'
]);

// 主视觉 = 置入真实素材图（产品/模特），形状/色块只算视觉元素不算主视觉。
const DESIGN_SUBJECT_IMAGE_TOOLS = new Set([
    'placeImage',
    'replaceLayerContent',
    'applyRasterImageResult'
]);

const DESIGN_SHAPE_TOOLS = new Set([
    'renderLayout',
    'createRectangle',
    'createEllipse',
    'createShape',
    'setLayerFill',
    'addGradientOverlay'
]);

const DESIGN_COPY_TOOLS = new Set([
    'renderLayout',
    'createTextLayer',
    'setTextContent'
]);

const DESIGN_REVIEW_TOOLS = new Set([
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay'
]);

const REFERENCE_ANALYSIS_TOOLS = new Set([
    'describeImage',
    'analyzeAssetContent'
]);

interface ContractInput {
    task: string;
    context?: TaskCompletionContext;
    toolCallLog: AgentToolCallLogEntry[];
    evaluationProfile?: DesignEvaluationProfile;
    evaluationProfileResult?: DesignEvaluationProfileResult;
}

interface StableTaskIdentity {
    task: string;
    skillId: string;
    intentMode: string;
}

interface AcceptanceCounts {
    verified: number;
    failed: number;
    needsReview: number;
    noDocumentChangeRisk: number;
}

interface CoverageVerification {
    expected: number;
    applied: number;
    failed: number;
    skipped: number;
    missingIds?: string[];
}

interface LayoutReplicationCompositeResult {
    createdDocumentCount: number;
    actionCount: number;
    failedActions: number;
    subjectCount: number;
    shapeCount: number;
    copyCount: number;
}

type VisualVerification = NonNullable<TaskCompletionVerification['visual']>;

function toolSucceeded(entry: AgentToolCallLogEntry): boolean {
    return entry.result?.success !== false;
}

function readExplicitReferenceObservation(
    context: TaskCompletionContext | undefined
): TaskCompletionReferenceObservation | undefined {
    const observation = context?.referenceObservation;
    if (observation?.version !== 'task-completion-reference-observation/v1'
        || observation.observed !== true
        || !Number.isFinite(observation.observationCount)
        || observation.observationCount <= 0) {
        return undefined;
    }
    return {
        version: 'task-completion-reference-observation/v1',
        observed: true,
        source: observation.source,
        observationCount: Math.round(observation.observationCount),
        ...(observation.toolName ? { toolName: observation.toolName } : {})
    };
}

function hasStructuredReferenceAnalysis(result: any): boolean {
    if (readAgentVisualObservation(result)?.reviewed === true) return true;
    const analysis = result?.analysis ?? result?.data?.analysis;
    if (typeof analysis === 'string') return analysis.trim().length > 0;
    return Boolean(analysis && typeof analysis === 'object' && Object.keys(analysis).length > 0);
}

function resolveReferenceObservation(
    input: ContractInput
): TaskCompletionReferenceObservation | undefined {
    const explicit = readExplicitReferenceObservation(input.context);
    if (explicit) return explicit;
    const toolObservation = input.toolCallLog.find((item) => (
        REFERENCE_ANALYSIS_TOOLS.has(item.name)
        && toolSucceeded(item)
        && hasStructuredReferenceAnalysis(item.result)
    ));
    if (!toolObservation) return undefined;
    return {
        version: 'task-completion-reference-observation/v1',
        observed: true,
        source: 'reference_analysis_tool',
        observationCount: 1,
        toolName: toolObservation.name
    };
}

function getAcceptance(result: any): any {
    return result?.acceptance || result?.data?.acceptance || null;
}

function collectAcceptanceCounts(toolCallLog: AgentToolCallLogEntry[]): AcceptanceCounts {
    const counts: AcceptanceCounts = {
        verified: 0,
        failed: 0,
        needsReview: 0,
        noDocumentChangeRisk: 0
    };

    for (const item of toolCallLog) {
        const acceptance = getAcceptance(item.result);
        if (!acceptance?.enabled) continue;
        if (acceptance.verified === true) {
            counts.verified += 1;
        }
        if (acceptance.assertionStatus === 'failed') {
            counts.failed += 1;
        }
        if (acceptance.assertionStatus === 'needs_review'
            || acceptance.noDocumentChangeRisk === true
            || (acceptance.verified === false && acceptance.assertionStatus !== 'failed')) {
            counts.needsReview += 1;
        }
        if (acceptance.noDocumentChangeRisk === true) {
            counts.noDocumentChangeRisk += 1;
        }
    }

    return counts;
}

function buildSkillEvaluationProfileContract(
    input: ContractInput,
    acceptance: AcceptanceCounts
): TaskCompletionContract | undefined {
    const profile = input.evaluationProfile;
    const result = input.evaluationProfileResult;
    if (!profile || !result || result.profileId !== profile.profileId) return undefined;

    const missing = new Set(result.verification.missingRequiredCheckKeys);
    const failed = new Set(result.verification.failedCheckKeys);
    const needsReview = new Set(result.verification.needsReviewCheckKeys);
    const required = profile.checks
        .filter((check) => check.required)
        .map((check): TaskCompletionRequirement => {
            if (failed.has(check.key)) {
                return {
                    id: check.id,
                    label: check.label,
                    status: 'failed',
                    reason: check.expectedFix
                };
            }
            if (missing.has(check.key)) {
                return {
                    id: check.id,
                    label: check.label,
                    status: 'needs_review',
                    reason: `缺少${check.label}，${check.expectedFix}`
                };
            }
            if (needsReview.has(check.key)) {
                return {
                    id: check.id,
                    label: check.label,
                    status: 'needs_review',
                    reason: `${check.label}仍需复核，${check.expectedFix}`
                };
            }
            return {
                id: check.id,
                label: check.label,
                status: 'passed'
            };
        });
    const blockers = profile.checks
        .filter((check) => check.required && failed.has(check.key) && check.severity === 'blocker')
        .map((check) => `${check.label}未通过：${check.expectedFix}`);
    const warnings = required
        .filter((requirement) => requirement.status === 'needs_review')
        .map((requirement) => requirement.reason || `${requirement.label}需要复核。`);
    const status: AgentExecutionStatus = blockers.length > 0 || required.some((item) => item.status === 'failed')
        ? 'failed'
        : (warnings.length > 0 || result.status !== 'passed' ? 'needs_review' : 'completed');
    const passedCount = required.filter((item) => item.status === 'passed').length;

    return {
        kind: 'skill_evaluation_profile',
        status,
        required,
        verification: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: `${profile.capabilityGoal} 当前 ${passedCount}/${required.length} 项关键检查通过。`
    };
}

function isSimplePhotoshopToolValidationTask(text: string): boolean {
    const hasValidationIntent =
        /(工具调用|工具链|处理步骤|小型工具|小工具).{0,16}(验证|测试|联调)|(?:验证|测试|联调).{0,16}(工具调用|工具链|处理步骤|小型工具|小工具)/.test(text)
        || /反馈.{0,24}(layerid|groupid|layer id|group id|图层\s*id|组\s*id)/i.test(text)
        || /(layerid|groupid|layer id|group id).{0,24}(反馈|返回|读取|读回)/i.test(text);
    if (!hasValidationIntent) return false;
    return /(photoshop|ps|文档|画布|图层组|图层|矩形|形状|文字图层|文本图层|文字|文本|group|layer|rectangle|text)/i.test(text);
}

/**
 * Completion 只能消费入口已签发的 TaskPlan 来识别本轮交付物，不能在公开计划确认、
 * 续跑或 Reflexion 后从“确认/继续执行”这类当前消息重新猜任务身份。没有计划时，
 * 保留旧任务文本与 runtime context 的兼容行为。
 */
function resolveStableTaskIdentity(input: ContractInput): StableTaskIdentity {
    const plan = input.context?.agentTaskPlan;
    const plannedGoal = String(plan?.designBrief?.goal || '').trim();
    if (plan && plannedGoal) {
        return {
            task: plannedGoal,
            skillId: plan.skillId || input.context?.skillId || '',
            intentMode: plan.mode || input.context?.intentMode || ''
        };
    }
    return {
        task: String(input.task || ''),
        skillId: input.context?.skillId || '',
        intentMode: input.context?.intentMode || ''
    };
}

function inferTaskKind(input: ContractInput): TaskCompletionKind | null {
    const { task, skillId, intentMode } = resolveStableTaskIdentity(input);
    const text = `${task} ${skillId} ${intentMode}`.toLowerCase();
    const toolNames = input.toolCallLog.map((item) => item.name);
    const hasTextMutation = toolNames.some((name) => TEXT_MUTATION_TOOLS.has(name));

    // 只读评审/分析任务不套写类完成契约：关键词推断会把任务文本或已批准计划里的
    // 描述词（「对齐」「参考」「字体」）误当成编辑/复刻意图，把成功的分析标成未完成
    // （实测：团队评审被按「参考图复刻 0/4」+「文字排版 0/3」验收）。
    // 判定：明确分析语义 + 明确不改画面承诺 + 工具日志没有任何成功的写类操作。
    const isReadOnlyAnalysisIntent =
        /(评审|分析|审查|诊断|检查|查看|理解)/.test(text)
        && /(不要改|不改动|不修改|仅分析|只分析|先分析|评审通过前|不动画面|不会改动|只读)/.test(text);
    const hasAnyMutationSuccess = input.toolCallLog.some((item) =>
        toolSucceeded(item) && (
            TEXT_MUTATION_TOOLS.has(item.name)
            || LAYER_ORDER_MUTATION_TOOLS.has(item.name)
            || LAYER_MANAGEMENT_MUTATION_TOOLS.has(item.name)
            || DOCUMENT_SAVE_TOOLS.has(item.name)
            || DOCUMENT_CLOSE_TOOLS.has(item.name)
        ));
    if (isReadOnlyAnalysisIntent && !hasAnyMutationSuccess) {
        return null;
    }

    // 小型工具/处理步骤验证不是「从零设计成品」：即使它调用 createDocument +
    // createRectangle + createTextLayer，也只需要按真实工具结果和读回层级汇报。
    // 不能套用创意设计完成契约，否则会把成功的工具链验证误报成「缺少主视觉/画面复核」。
    if (isSimplePhotoshopToolValidationTask(text)) {
        return null;
    }

    // 创意设计成品（做主图/详情页/海报）的任务身份优先于实现方法：
    // “参考图/复刻 Skill”可以是海报的执行方法，但不能把海报交付物降级成纯参考复刻契约。
    // 必须优先于 layer_order/document/text/layer_management 等编辑类契约——设计过程中模型会调
    // reorderLayer/createTextLayer/saveDocument/setLayerOpacity 等原子工具，这些按 toolNames 命中会让
    // 编辑类契约抢先，把整个设计任务误判（实测被判「图层顺序编辑 0/3」「文字编辑 0/3」，措辞误导且
    // 判定标准不适用于设计成品）。只有没有明确成品身份的纯复刻任务才走 reference_replication。
    const compositeResult = collectLayoutReplicationCompositeResult(input.toolCallLog);
    const hasCreateDocumentSuccess = input.toolCallLog.some(
        (item) => item.name === 'createDocument' && toolSucceeded(item)
    ) || compositeResult.createdDocumentCount > 0;
    const isReplicationTask = skillId === 'layout-replication'
        || /参考图|复刻|仿照|照着|还原|复现|同款/.test(text);
    const isDocumentManagementTask = skillId === 'document-management';
    const hasCreativeDesignIntent =
        /从零|从0|从头|凭空|创意设计|创作/.test(text)
        || /(设计|做|画|制作|生成|创作).{0,5}(一[张个版幅])?\s*(主图|详情页|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/.test(text);
    // 工具序列识别：建文档 + 视觉元素(图/形状) + 文案文本层，本身就是创意设计行为。
    // 公开计划确认后 currentTask 会变成「确认执行公开计划」、丢掉原 brief 的设计意图，
    // 此时 hasCreativeDesignIntent 文本判定会落空（实测被误判成 text_content_edit），用工具序列认出。
    const hasDesignToolFootprint =
        hasCreateDocumentSuccess
        && (countSuccessful(input.toolCallLog, DESIGN_SUBJECT_IMAGE_TOOLS) + compositeResult.subjectCount > 0
            || countSuccessful(input.toolCallLog, DESIGN_SHAPE_TOOLS) + compositeResult.shapeCount > 0)
        && countSuccessful(input.toolCallLog, DESIGN_COPY_TOOLS) + compositeResult.copyCount > 0;
    if (hasCreativeDesignIntent && !isDocumentManagementTask) {
        return 'creative_design';
    }
    if (hasDesignToolFootprint && !isReplicationTask && !isDocumentManagementTask) {
        return 'creative_design';
    }

    // 复刻同样是高层任务，优先于原子编辑契约：复刻过程会调 reorderLayer/createTextLayer 等，
    // 否则被 layer_order/text 抢判（与 creative_design 同理）。只用明确复刻信号，不用裸「按.*图」
    // （会误命中「按从浅到深调整图层顺序」这类图层任务）。
    if (isReplicationTask || /参考.*设计/.test(text)) {
        return 'reference_replication';
    }

    if (/图层.{0,12}(顺序|层级|排序|置顶|置底|上移|下移)|(?:顺序|层级|排序|置顶|置底|上移|下移).{0,12}图层|从浅到深|从深到浅|移到.*(?:上方|下方|顶层|底层)/.test(text)
        || toolNames.some((name) => LAYER_ORDER_MUTATION_TOOLS.has(name))) {
        return 'layer_order_edit';
    }

    if (skillId === 'document-management' && intentMode === 'close'
        || /关闭文档|关掉文档|close document|close file/.test(text)
        || toolNames.some((name) => DOCUMENT_CLOSE_TOOLS.has(name))) {
        return 'document_close';
    }

    if (skillId === 'document-management' && intentMode === 'save'
        || /保存文档|保存当前文档|导出当前文档|保存为|导出为|save document|export document|save psd|export png/.test(text)
        || toolNames.some((name) => DOCUMENT_SAVE_TOOLS.has(name))) {
        return 'document_save';
    }

    if (/字体|字号|字重|字距|行距|思源|黑体|宋体|微软雅黑|居中|对齐|换行|标点|文字排版|文本排版/.test(text)) {
        return 'text_typography_edit';
    }

    if (/(文字|文本|文案|标题|副标题|内容).{0,16}(改成|替换|修改|删除|添加|创建|输入|写入)|(?:改成|替换|修改|删除|添加|创建|输入|写入).{0,16}(文字|文本|文案|标题|副标题|内容)|删除.*字|添加.*字|创建.*字/.test(text)
        || hasTextMutation) {
        return 'text_content_edit';
    }

    if (skillId === 'layer-management'
        || /图层.{0,12}(选中|选择|重命名|删除|复制|拷贝|编组|解除编组|透明度|混合模式)|(?:选中|选择|重命名|删除|复制|拷贝|编组|解除编组).{0,12}图层/.test(text)
        || toolNames.some((name) => LAYER_MANAGEMENT_MUTATION_TOOLS.has(name))) {
        return 'layer_management';
    }

    return null;
}

function firstSuccessfulIndex(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.findIndex((item) => names.has(item.name) && toolSucceeded(item));
}

function lastSuccessfulIndex(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        const item = toolCallLog[index];
        if (item && names.has(item.name) && toolSucceeded(item)) return index;
    }
    return -1;
}

function hasVerifiedAcceptanceAtOrAfter(
    toolCallLog: AgentToolCallLogEntry[],
    startIndex: number
): boolean {
    if (startIndex < 0) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[startIndex];
    return toolCallLog.some((item, index) => index >= startIndex
        && collectAcceptanceCounts([item]).verified > 0
        && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]));
}

function hasSuccessfulBefore(toolCallLog: AgentToolCallLogEntry[], names: Set<string>, beforeIndex: number): boolean {
    if (beforeIndex < 0) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[beforeIndex];
    return toolCallLog.some((item, index) => index < beforeIndex
        && names.has(item.name)
        && toolSucceeded(item)
        && isAgentPhotoshopDocumentObservation(item.name, item.arguments)
        && sameAgentOperationDocumentContext(timeline.entries[index], mutationContext));
}

function hasSuccessfulAfter(toolCallLog: AgentToolCallLogEntry[], names: Set<string>, afterIndex: number): boolean {
    if (afterIndex < 0) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[afterIndex];
    return toolCallLog.some((item, index) => index > afterIndex
        && names.has(item.name)
        && toolSucceeded(item)
        && isAgentPhotoshopDocumentObservation(item.name, item.arguments)
        && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]));
}

function countSuccessful(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.filter((item) => names.has(item.name) && toolSucceeded(item)).length;
}

function countFailed(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.filter((item) => names.has(item.name) && !toolSucceeded(item)).length;
}

function collectVisualReviewCounts(
    toolCallLog: AgentToolCallLogEntry[],
    names: Set<string>,
    latestMutationIndex: number = -1
): { capturedCount: number; reviewedCount: number; unreviewedCount: number } {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = latestMutationIndex >= 0
        ? timeline.entries[latestMutationIndex]
        : undefined;
    const captured = toolCallLog.filter((item, index) => names.has(item.name)
        && toolSucceeded(item)
        && (latestMutationIndex < 0
            || (index > latestMutationIndex
                && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]))));
    const reviewedCount = captured.filter((item) => readAgentVisualObservation(item.result)?.reviewed === true).length;
    return {
        capturedCount: captured.length,
        reviewedCount,
        unreviewedCount: Math.max(0, captured.length - reviewedCount)
    };
}

function isRenderLayoutSubjectRole(value: unknown): boolean {
    return /^(main-image|hero-image|product-image|model-image|product|model)$/i.test(String(value || '').trim());
}

function countRenderLayoutSubjectImages(toolCallLog: AgentToolCallLogEntry[]): number {
    let count = 0;
    for (const item of toolCallLog) {
        if (item.name !== 'renderLayout' || !toolSucceeded(item)) continue;
        const argumentBlocks = Array.isArray(item.arguments?.blocks) ? item.arguments.blocks : [];
        const createdBlocks = Array.isArray(item.result?.created) ? item.result.created : [];
        const argumentSubjectCount = argumentBlocks.filter((block: any) => {
            if (!isRenderLayoutSubjectRole(block?.role)) return false;
            return Boolean(block?.imagePath || block?.filePath || block?.sourcePath || block?.assetPath || block?.image);
        }).length;
        const createdSubjectCount = createdBlocks.filter((block: any) => isRenderLayoutSubjectRole(block?.role)).length;
        count += Math.max(argumentSubjectCount, createdSubjectCount);
    }
    return count;
}

function taskRequestsDelivery(input: ContractInput): boolean {
    const { task, skillId, intentMode } = resolveStableTaskIdentity(input);
    const text = `${task} ${skillId} ${intentMode}`;
    return /导出|保存|交付|输出.*文件|生成.*文件|存到|保存到|导出到|export|save/i.test(text);
}

function taskRequestsRasterDelivery(input: ContractInput): boolean {
    const { task, skillId, intentMode } = resolveStableTaskIdentity(input);
    const text = `${task} ${skillId} ${intentMode}`.toLowerCase();
    if (/\b(?:psd|psb)\b|源文件|可编辑文件|工程文件/.test(text)) return false;
    return /长图|图片|图像|jpg|jpeg|png|webp|上传|导出|输出|export/.test(text);
}

function collectDeliveryFormats(entry: AgentToolCallLogEntry): string[] {
    const result = entry.result || {};
    const values = [
        entry.arguments?.format,
        result.format,
        result.outputFormat,
        result.saveFormat
    ];
    const paths = [
        entry.arguments?.outputPath,
        entry.arguments?.savePath,
        result.outputPath,
        result.savePath,
        result.filePath,
        result.savedPath,
        ...(Array.isArray(result.exportedFiles) ? result.exportedFiles : [])
    ];
    for (const pathValue of paths) {
        const match = String(pathValue || '').match(/\.([a-z0-9]+)(?:$|[?#])/i);
        if (match?.[1]) values.push(match[1]);
    }
    return values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function isRasterDeliveryEntry(entry: AgentToolCallLogEntry): boolean {
    if (!DOCUMENT_SAVE_TOOLS.has(entry.name) || !toolSucceeded(entry)) return false;
    if (entry.name === 'quickExport' || entry.name === 'exportDetailPageSlices') return true;
    const formats = collectDeliveryFormats(entry);
    return formats.some((format) => /^(?:jpg|jpeg|png|webp|gif|tif|tiff)$/.test(format));
}

function countRasterDelivery(toolCallLog: AgentToolCallLogEntry[]): number {
    return toolCallLog.filter(isRasterDeliveryEntry).length;
}

function normalizeCoverage(value: any): CoverageVerification | null {
    if (!value || typeof value !== 'object') return null;
    const expected = Number(value.expected);
    const applied = Number(value.applied ?? value.successCount ?? value.matched);
    const failed = Number(value.failed ?? value.failCount ?? 0);
    const skipped = Number(value.skipped ?? 0);
    if (!Number.isFinite(expected) || !Number.isFinite(applied)) return null;
    return {
        expected,
        applied,
        failed: Number.isFinite(failed) ? failed : 0,
        skipped: Number.isFinite(skipped) ? skipped : 0,
        missingIds: Array.isArray(value.missingIds) ? value.missingIds.map(String) : undefined
    };
}

function readCompletionVerification(result: any): any {
    return result?.completionContract?.verification
        || result?.data?.completionContract?.verification;
}

function findCoverageVerification(toolCallLog: AgentToolCallLogEntry[]): CoverageVerification | undefined {
    for (const item of toolCallLog) {
        const result = item.result || {};
        const candidates = [
            readCompletionVerification(result)?.coverage,
            result?.data?.coverage,
            result?.coverage
        ];
        for (const candidate of candidates) {
            const coverage = normalizeCoverage(candidate);
            if (coverage) return coverage;
        }
    }
    return undefined;
}

function readNestedSkillToolResults(result: any): Array<{ toolName: string; result: any }> {
    const values = Array.isArray(result?.toolResults)
        ? result.toolResults
        : Array.isArray(result?.data?.toolResults)
            ? result.data.toolResults
            : [];
    return values
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => ({
            toolName: String(item.toolName || item.name || ''),
            result: item.result
        }));
}

function isRealCompositeCopy(value: unknown): boolean {
    const text = String(value || '').trim();
    if (!text) return false;
    return !/^\[(?:文案|文字)(?:占位)?\]/.test(text);
}

function collectLayoutReplicationCompositeResult(
    toolCallLog: AgentToolCallLogEntry[]
): LayoutReplicationCompositeResult {
    const compositeResult: LayoutReplicationCompositeResult = {
        createdDocumentCount: 0,
        actionCount: 0,
        failedActions: 0,
        subjectCount: 0,
        shapeCount: 0,
        copyCount: 0
    };

    for (const item of toolCallLog) {
        if (item.name !== 'layout-replication') continue;
        const result = item.result || {};
        const nestedToolResults = readNestedSkillToolResults(result);
        const createDocumentResult = nestedToolResults.find((nested) => nested.toolName === 'createDocument')?.result;
        if (result?.data?.createdDocument === true || createDocumentResult?.success === true) {
            compositeResult.createdDocumentCount += 1;
        }

        const applyResult = result?.data?.applyResult
            || nestedToolResults.find((nested) => nested.toolName === 'layout-template-apply')?.result;
        const generatedScreens = Array.isArray(applyResult?.generatedScreens)
            ? applyResult.generatedScreens
            : [];
        const copyPlaceholders = generatedScreens.flatMap((screen: any) =>
            Array.isArray(screen?.copyPlaceholders) ? screen.copyPlaceholders : []);
        const imagePlaceholders = generatedScreens.flatMap((screen: any) =>
            Array.isArray(screen?.imagePlaceholders) ? screen.imagePlaceholders : []);
        compositeResult.copyCount += copyPlaceholders.filter((placeholder: any) =>
            isRealCompositeCopy(placeholder?.currentText)).length;
        compositeResult.shapeCount += imagePlaceholders.length;

        const autoFillResult = result?.data?.autoFillResult
            || nestedToolResults.find((nested) => nested.toolName === 'layout-template-autofill')?.result;
        compositeResult.subjectCount += Math.max(0, Number(autoFillResult?.filledImages || 0));

        const elementResults = Array.isArray(applyResult?.elementResults)
            ? applyResult.elementResults
            : [];
        const appliedElements = elementResults.filter((element: any) => element?.status === 'applied').length;
        const failedElements = elementResults.filter((element: any) => element?.status === 'failed').length;
        const nestedMatchResult = nestedToolResults.find((nested) => nested.toolName === 'layout-replication')?.result;
        const coverage = findCoverageVerification([item]);
        compositeResult.actionCount += Math.max(
            appliedElements,
            Math.max(0, Number(coverage?.applied || 0)),
            Math.max(0, Number(nestedMatchResult?.successCount || 0)),
            Math.max(0, Number(applyResult?.createdLayers || 0))
        );
        compositeResult.failedActions += Math.max(
            failedElements,
            Math.max(0, Number(coverage?.failed || 0)),
            Math.max(0, Number(nestedMatchResult?.failCount || 0)),
            Math.max(0, Number(applyResult?.failedOps || 0))
        );
    }

    return compositeResult;
}

function hasLayoutReplicationCompositeMutation(entry: AgentToolCallLogEntry): boolean {
    return collectLayoutReplicationCompositeResult([entry]).actionCount > 0;
}

function getVisualVerification(toolCallLog: AgentToolCallLogEntry[], latestMutationIndex: number): VisualVerification {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[latestMutationIndex];
    const afterMutation = toolCallLog.filter((item, index) => index > latestMutationIndex
        && toolSucceeded(item)
        && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]));
    const overlayCount = afterMutation.filter((item) => item.name === 'getScreenSnapshotsWithOverlay').length;
    const visualReview = collectVisualReviewCounts(toolCallLog, DESIGN_REVIEW_TOOLS, latestMutationIndex);
    const screenshotCount = visualReview.capturedCount;
    const modelReviewCount = afterMutation.filter((item) => item.name === 'auditDetailPagePlacement').length;
    const boundsCount = afterMutation.filter((item) => item.name === 'getLayerBounds' || item.name === 'getLayerProperties').length;

    if (modelReviewCount > 0) {
        return {
            mode: 'model_review',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: visualReview.reviewedCount,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (visualReview.reviewedCount > 0 && overlayCount > 0) {
        return {
            mode: 'overlay',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: visualReview.reviewedCount,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (visualReview.reviewedCount > 0) {
        return {
            mode: 'screenshot',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: visualReview.reviewedCount,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (screenshotCount > 0) {
        return {
            mode: 'captured_only',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: 0,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (boundsCount > 0) {
        return { mode: 'bounds_only', snapshotCount: 0, overlayCount: 0 };
    }
    return { mode: 'none', snapshotCount: 0, overlayCount: 0 };
}

function resolveStatus(requirements: TaskCompletionRequirement[], blockers: string[], warnings: string[]): AgentExecutionStatus {
    if (blockers.length > 0 || requirements.some((item) => item.status === 'failed')) {
        return 'failed';
    }
    if (warnings.length > 0 || requirements.some((item) => item.status === 'needs_review')) {
        return 'needs_review';
    }
    return 'completed';
}

function buildSummary(kind: TaskCompletionKind, status: AgentExecutionStatus, requirements: TaskCompletionRequirement[]): string {
    const kindText: Record<TaskCompletionKind, string> = {
        skill_evaluation_profile: '当前设计能力',
        reference_replication: '参考图复刻',
        creative_design: '创意设计',
        text_content_edit: '文字内容编辑',
        text_typography_edit: '文字排版/字体编辑',
        layer_order_edit: '图层顺序编辑',
        layer_management: '图层管理',
        document_save: '文档保存/导出',
        document_close: '文档关闭'
    };
    const statusText: Record<AgentExecutionStatus, string> = {
        completed: '已完成',
        needs_review: '需复核',
        failed: '未完成',
        cancelled: '已取消',
        // 任务完成契约本身不会产出该状态（等待确认属于运行级暂停），此处仅为满足类型穷举。
        awaiting_confirmation: '等待确认'
    };
    const passed = requirements.filter((item) => item.status === 'passed').length;
    return `${kindText[kind]}完成契约：${statusText[status]}，${passed}/${requirements.length} 项通过。`;
}

function buildOperationContract(
    kind: 'layer_management' | 'document_save' | 'document_close',
    input: ContractInput,
    acceptance: AcceptanceCounts,
    mutationTools: Set<string>,
    verificationTools: Set<string>,
    labels: { context: string; mutation: string; verification: string }
): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, mutationTools);
    const lastMutation = Math.max(
        lastSuccessfulIndex(input.toolCallLog, mutationTools),
        findLatestObservedPhotoshopMutationIndex(input.toolCallLog)
    );
    const actionCount = countSuccessful(input.toolCallLog, mutationTools);
    const failedActions = countFailed(input.toolCallLog, mutationTools);
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = lastMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, verificationTools, lastMutation)
        || hasVerifiedAcceptanceAtOrAfter(input.toolCallLog, lastMutation)
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'operation-context-read',
            label: labels.context,
            status: inspectedBeforeMutation || kind === 'document_close' ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation || kind === 'document_close' ? undefined : '缺少操作前上下文读取结果。'
        },
        {
            id: 'operation-mutated',
            label: labels.mutation,
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的目标工具调用。'
        },
        {
            id: 'operation-verified',
            label: labels.verification,
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少操作后的状态复核或工具验收结果。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个目标工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation && kind !== 'document_close') {
        warnings.push('缺少修改前上下文读取，无法确认目标是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind,
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary(kind, status, requirements)
    };
}

function buildLayerOrderContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const lastMutation = Math.max(
        lastSuccessfulIndex(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS),
        findLatestObservedPhotoshopMutationIndex(input.toolCallLog)
    );
    const actionCount = countSuccessful(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const failedActions = countFailed(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = lastMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, LAYER_ORDER_VERIFICATION_TOOLS, lastMutation)
        || hasVerifiedAcceptanceAtOrAfter(input.toolCallLog, lastMutation)
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'layer-context-read',
            label: '读取图层层级上下文',
            status: inspectedBeforeMutation ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation ? undefined : '缺少排序前的图层层级读取结果。'
        },
        {
            id: 'layer-order-mutated',
            label: '执行图层顺序调整',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的 reorderLayer 调用。'
        },
        {
            id: 'layer-order-verified',
            label: '复核图层顺序',
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少排序后的图层层级或验收快照。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个图层顺序调整工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation) {
        warnings.push('图层顺序任务缺少修改前层级读取，无法确认目标集合是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('图层顺序任务缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind: 'layer_order_edit',
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary('layer_order_edit', status, requirements)
    };
}

function buildTextContract(
    kind: 'text_content_edit' | 'text_typography_edit',
    input: ContractInput,
    acceptance: AcceptanceCounts
): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const lastMutation = Math.max(
        lastSuccessfulIndex(input.toolCallLog, TEXT_MUTATION_TOOLS),
        findLatestObservedPhotoshopMutationIndex(input.toolCallLog)
    );
    const actionCount = countSuccessful(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const failedActions = countFailed(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = lastMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, TEXT_VERIFICATION_TOOLS, lastMutation)
        || hasVerifiedAcceptanceAtOrAfter(input.toolCallLog, lastMutation)
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'context-read',
            label: '读取文本/图层上下文',
            status: inspectedBeforeMutation ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation ? undefined : '缺少修改前的文本或图层读取结果。'
        },
        {
            id: 'text-mutated',
            label: '执行文字修改',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的文字修改工具调用。'
        },
        {
            id: 'text-verified',
            label: '复核文字字段或图层状态',
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少修改后的文本字段、图层边界或验收快照。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个文字修改工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation) {
        warnings.push('文字任务缺少修改前上下文读取，无法确认目标集合是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('文字任务缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind,
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary(kind, status, requirements)
    };
}

function buildReferenceContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const compositeResult = collectLayoutReplicationCompositeResult(input.toolCallLog);
    let latestMutation = -1;
    for (let index = 0; index < input.toolCallLog.length; index += 1) {
        const item = input.toolCallLog[index];
        if ((toolSucceeded(item) && REFERENCE_MUTATION_TOOLS.has(item.name))
            || hasLayoutReplicationCompositeMutation(item)) {
            latestMutation = index;
        }
    }
    latestMutation = Math.max(
        latestMutation,
        findLatestObservedPhotoshopMutationIndex(input.toolCallLog)
    );
    const actionCount = countSuccessful(input.toolCallLog, REFERENCE_MUTATION_TOOLS)
        + compositeResult.actionCount;
    const failedActions = countFailed(input.toolCallLog, REFERENCE_MUTATION_TOOLS)
        + compositeResult.failedActions;
    const referenceObservation = resolveReferenceObservation(input);
    const hasReferenceInput = Boolean(referenceObservation);
    const visual = latestMutation >= 0 ? getVisualVerification(input.toolCallLog, latestMutation) : { mode: 'none' as const, snapshotCount: 0, overlayCount: 0 };
    const coverage = findCoverageVerification(input.toolCallLog);
    const visualVerified = visual.mode === 'screenshot' || visual.mode === 'overlay' || visual.mode === 'model_review';
    const coveragePassed = Boolean(coverage && coverage.expected > 0 && coverage.applied >= coverage.expected && coverage.failed === 0);

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'reference-understood',
            label: '读取或理解参考图',
            status: hasReferenceInput ? 'passed' : 'needs_review',
            actual: referenceObservation,
            reason: hasReferenceInput
                ? undefined
                : '缺少参考图已被视觉模型或专用分析 Tool 真实读取后的观察结果；附件存在本身不代表已经理解。'
        },
        {
            id: 'editable-layout-created',
            label: '创建可编辑设计元素',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的文字、形状或图片创建/放置工具调用。'
        },
        {
            id: 'visual-verified',
            label: '复核生成结果画面',
            status: visualVerified ? 'passed' : 'needs_review',
            actual: visual,
            reason: visualVerified ? undefined : '缺少生成后的截图、overlay 或视觉复核结果。'
        },
        {
            id: 'reference-coverage',
            label: '参考元素覆盖率',
            status: coveragePassed ? 'passed' : 'needs_review',
            expected: coverage ? { expected: coverage.expected } : undefined,
            actual: coverage || undefined,
            reason: coveragePassed ? undefined : '缺少参考元素 expected/applied 覆盖率，不能确认复刻是否覆盖关键元素。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个参考图复刻相关工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!hasReferenceInput) {
        warnings.push('参考图复刻缺少参考图观察结果。');
    }
    if (!visualVerified) {
        warnings.push('参考图复刻缺少生成后画面复核。');
    }
    if (!coveragePassed) {
        warnings.push('参考图复刻缺少关键元素覆盖率检查。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind: 'reference_replication',
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance,
            visual,
            coverage,
            referenceObservation
        },
        blockers,
        warnings,
        summary: buildSummary('reference_replication', status, requirements)
    };
}

function resolveCreativeReferenceGuidance(input: ContractInput): {
    guided: boolean;
    strictReplication: boolean;
} {
    const { task, skillId } = resolveStableTaskIdentity(input);
    const normalizedTask = task.toLowerCase();
    const strictReplication = /复刻|复现|还原|仿照|照着|临摹|同款|按.{0,8}(图|图片|参考|版式)|replicate|recreate|copy\s+layout/.test(normalizedTask);
    const hasReferenceLanguage = /参考(?:这|该|附|上|下|图|图片|样图|海报|版式|风格)|reference/.test(normalizedTask);
    return {
        guided: skillId === 'layout-replication'
            || strictReplication
            || (hasReferenceLanguage && (input.context?.imageCount || 0) > 0),
        strictReplication
    };
}

// 创意设计成品契约：从零做主图/详情页/海报的完成标准 = 新建画布 + 主视觉 + 真实文案 + 画面复核。
// 这是设计任务该用的判定（不是「文字编辑 N 项」），缺文案会精确报「真实文案 failed」并给出补做指引，
// 供执行循环在模型早停时拉回继续（见 agent.ts 早停契约门禁）。
function buildCreativeDesignContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const log = input.toolCallLog;
    const compositeResult = collectLayoutReplicationCompositeResult(log);
    const createdDocument = countSuccessful(log, DESIGN_CREATE_DOCUMENT_TOOLS)
        + compositeResult.createdDocumentCount > 0;
    const subjectCount = countSuccessful(log, DESIGN_SUBJECT_IMAGE_TOOLS)
        + countRenderLayoutSubjectImages(log)
        + compositeResult.subjectCount;
    const shapeCount = countSuccessful(log, DESIGN_SHAPE_TOOLS)
        + compositeResult.shapeCount;
    const copyCount = countSuccessful(log, DESIGN_COPY_TOOLS)
        + compositeResult.copyCount;
    const latestMutation = findLatestObservedPhotoshopMutationIndex(log);
    const visualReview = collectVisualReviewCounts(log, DESIGN_REVIEW_TOOLS, latestMutation);
    const reviewCount = visualReview.reviewedCount;
    const referenceGuidance = resolveCreativeReferenceGuidance(input);
    const referenceObservation = referenceGuidance.guided
        ? resolveReferenceObservation(input)
        : undefined;
    const hasReferenceInput = Boolean(referenceObservation);
    const coverage = referenceGuidance.guided ? findCoverageVerification(log) : undefined;
    const referenceCoveragePassed = Boolean(
        coverage
        && coverage.expected > 0
        && coverage.applied > 0
        && coverage.failed === 0
        && (!referenceGuidance.strictReplication || coverage.applied >= coverage.expected)
    );
    const referenceTypographyCompositionCount = referenceGuidance.guided
        && referenceCoveragePassed
        && compositeResult.actionCount > 0
        && compositeResult.copyCount > 0
        ? 1
        : 0;
    const deliveryRequired = taskRequestsDelivery(input);
    const rasterDeliveryRequired = taskRequestsRasterDelivery(input);
    const deliveryCount = rasterDeliveryRequired
        ? countRasterDelivery(log)
        : countSuccessful(log, DOCUMENT_SAVE_TOOLS);

    const requirements: TaskCompletionRequirement[] = [{
        id: 'creative-document',
        label: '新建设计画布',
        status: createdDocument ? 'passed' : 'failed',
        reason: createdDocument ? undefined : '没有成功创建设计文档（createDocument），从零设计必须先新建画布。'
    }];

    if (referenceGuidance.guided) {
        requirements.push(
            {
                id: 'creative-reference-understood',
                label: '读取并理解参考图',
                status: hasReferenceInput ? 'passed' : 'needs_review',
                actual: referenceObservation,
                reason: hasReferenceInput
                    ? undefined
                    : '任务要求参考具体画面，但缺少视觉模型或专用分析 Tool 的真实观察结果；附件数量不足以确认已经理解。'
            },
            {
                id: 'creative-reference-coverage',
                label: referenceGuidance.strictReplication ? '参考元素覆盖率' : '参考结构落地',
                status: referenceCoveragePassed ? 'passed' : 'needs_review',
                expected: coverage ? { expected: coverage.expected } : undefined,
                actual: coverage || undefined,
                reason: referenceCoveragePassed
                    ? undefined
                    : (referenceGuidance.strictReplication
                        ? '缺少完整的参考元素 expected/applied 覆盖率，不能确认复刻要求已落实。'
                        : '缺少参考结构落地检查，不能确认成品确实使用了用户提供的参考画面。')
            }
        );
    }

    requirements.push(
        {
            id: 'creative-visual',
            label: '铺设主视觉',
            status: subjectCount > 0
                ? 'passed'
                : (shapeCount > 0 || referenceTypographyCompositionCount > 0 ? 'needs_review' : 'failed'),
            actual: { subjectCount, shapeCount, referenceTypographyCompositionCount },
            reason: subjectCount > 0
                ? undefined
                : (shapeCount > 0
                    ? '只有形状/色块，没有置入真实产品或模特图作为主视觉。'
                    : (referenceTypographyCompositionCount > 0
                        ? '已按参考完整生成文字构图，但没有主体图片或形状；保留为纯排版成品复核项。'
                        : '画面缺少任何视觉元素（产品图、模特图、形状或已验证的参考文字构图）。'))
        },
        {
            id: 'creative-copy',
            label: '真实文案',
            status: copyCount > 0 ? 'passed' : 'failed',
            actual: { copyCount },
            reason: copyCount > 0
                ? undefined
                : '没有创建任何文案文本图层，设计成品缺少标题和卖点文字。需用 createTextLayer 写入真实标题与卖点文案（不要占位词）。'
        },
        {
            id: 'creative-review',
            label: '画面复核',
            status: reviewCount > 0 ? 'passed' : 'needs_review',
            actual: {
                reviewCount,
                snapshotCount: visualReview.capturedCount,
                unreviewedCount: visualReview.unreviewedCount
            },
            reason: reviewCount > 0
                ? undefined
                : (visualReview.capturedCount > 0
                    ? '已取得画面截图，但没有主模型或视觉专家真正完成读图，不能确认排版与可读性。'
                    : '设计完成后缺少画面截图复核（getAnnotatedSnapshot / getCanvasSnapshot），无法确认排版与可读性。')
        }
    );

    if (deliveryRequired) {
        requirements.push({
            id: 'creative-delivery',
            label: '导出交付文件',
            status: deliveryCount > 0 ? 'passed' : 'failed',
            actual: { deliveryCount, rasterRequired: rasterDeliveryRequired },
            reason: deliveryCount > 0
                ? undefined
                : (rasterDeliveryRequired
                    ? '用户要求交付详情页长图/图片，但只保存 PSD/PSB 或没有检测到 JPG、PNG、WebP 等图片导出文件。'
                    : '用户要求保存/导出交付文件，但没有检测到成功的 saveDocument、quickExport 或导出工具调用。')
        });
    }

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (acceptance.failed > 0) {
        warnings.push(`有 ${acceptance.failed} 个工具步骤失败，需要判断是否影响最终成品。`);
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }
    if (referenceGuidance.guided && !hasReferenceInput) {
        warnings.push('参考引导的创意任务缺少参考图观察结果。');
    }
    if (referenceGuidance.guided && !referenceCoveragePassed) {
        warnings.push(
            referenceGuidance.strictReplication
                ? '创意成品缺少完整的参考元素覆盖率检查。'
                : '创意成品缺少参考结构落地检查。'
        );
    }

    const status = resolveStatus(requirements, blockers, warnings);
    return {
        kind: 'creative_design',
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance,
            visual: {
                mode: reviewCount > 0 ? 'screenshot' : (visualReview.capturedCount > 0 ? 'captured_only' : 'none'),
                snapshotCount: visualReview.capturedCount,
                reviewedCount: visualReview.reviewedCount,
                unreviewedCount: visualReview.unreviewedCount
            },
            coverage,
            referenceObservation
        },
        blockers,
        warnings,
        summary: buildSummary('creative_design', status, requirements)
    };
}

export function buildTaskCompletionContract(input: ContractInput): TaskCompletionContract | undefined {
    const acceptance = collectAcceptanceCounts(input.toolCallLog);
    const profileContract = buildSkillEvaluationProfileContract(input, acceptance);
    if (profileContract) return profileContract;

    const kind = inferTaskKind(input);
    if (!kind) return undefined;
    if (kind === 'reference_replication') {
        return buildReferenceContract(input, acceptance);
    }
    if (kind === 'creative_design') {
        return buildCreativeDesignContract(input, acceptance);
    }
    if (kind === 'layer_order_edit') {
        return buildLayerOrderContract(input, acceptance);
    }
    if (kind === 'layer_management') {
        return buildOperationContract(kind, input, acceptance, LAYER_MANAGEMENT_MUTATION_TOOLS, LAYER_MANAGEMENT_VERIFICATION_TOOLS, {
            context: '读取图层上下文',
            mutation: '执行图层管理操作',
            verification: '复核图层状态'
        });
    }
    if (kind === 'document_save') {
        return buildOperationContract(kind, input, acceptance, DOCUMENT_SAVE_TOOLS, DOCUMENT_VERIFICATION_TOOLS, {
            context: '读取文档状态',
            mutation: '执行文档保存或导出',
            verification: '复核文档保存结果'
        });
    }
    if (kind === 'document_close') {
        return buildOperationContract(kind, input, acceptance, DOCUMENT_CLOSE_TOOLS, DOCUMENT_VERIFICATION_TOOLS, {
            context: '确认待关闭文档',
            mutation: '执行文档关闭',
            verification: '复核文档关闭结果'
        });
    }
    if (kind === 'text_content_edit' || kind === 'text_typography_edit') {
        return buildTextContract(kind, input, acceptance);
    }
    return undefined;
}
