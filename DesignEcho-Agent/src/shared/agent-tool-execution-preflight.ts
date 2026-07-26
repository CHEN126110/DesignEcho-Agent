import { shouldCollectAcceptanceVerification } from './acceptance/tool-acceptance';
import { DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME } from './agent-runtime-v5/runtime-action-plan-control';
import { DECLARE_DESIGN_BRIEF_TOOL_NAME } from './agent-runtime-v5/runtime-design-brief-declaration';
import { DECLARE_REFERENCE_BRIEF_TOOL_NAME } from './agent-runtime-v5/runtime-reference-context';
import { DECLARE_DESIGN_STRATEGY_TOOL_NAME } from './agent-runtime-v5/runtime-design-strategy-declaration';
import {
    classifyPhotoshopToolSkillExecution,
    getPhotoshopToolSkillSemantics
} from './photoshop-tool-skill';
import { getSkillById } from './skills/skill-declarations';
import {
    readPhotoshopHistoryStateRef,
    readPhotoshopHistoryTransition,
    readPhotoshopMutationCommit,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export type AgentToolExecutionKind =
    | 'read_only_observation'
    | 'knowledge_search'
    | 'photoshop_write'
    | 'save_export'
    | 'external_generation'
    | 'stateful_context'
    | 'unknown';

export interface AgentToolExecutionPreflightTool {
    name: string;
    kind: AgentToolExecutionKind;
    guarded: boolean;
}

export const DESIGN_ECHO_TARGET_GUARD_ARGUMENT = '__designEchoTargetGuard';

export interface AgentToolExecutionTargetGuard {
    expectedDocumentId: number;
    expectedActiveLayerId?: number;
    expectedHistoryStateRef?: PhotoshopHistoryStateRef;
    observationTool: string;
}

export interface AgentToolExecutionPreflight {
    status: 'ready' | 'blocked' | 'not_applicable';
    ready: boolean;
    issue?: string;
    message?: string;
    blockedTool?: AgentToolExecutionPreflightTool;
    tools: AgentToolExecutionPreflightTool[];
    preconditions: {
        hasPriorDocumentRead: boolean;
        priorReadTools: string[];
        hasUserVisiblePreActionRationale: boolean;
        /** @deprecated use hasUserVisiblePreActionRationale */
        hasPublicPlan: boolean;
        hasVerificationTarget: boolean;
        knownLayerIds: number[];
        /**
         * 最近一次携带明确文档身份的成功读取/建文档结果。
         * 仅用于在真正的 Photoshop 写执行边界生成私有 target guard；不授予执行权限。
         */
        targetGuard?: AgentToolExecutionTargetGuard;
    };
    blockers: string[];
    warnings: string[];
}

export interface AgentToolExecutionPreflightLogEntry {
    name: string;
    arguments?: any;
    result?: any;
}

export interface AgentToolExecutionPreflightInput {
    assistantContent?: string;
    toolCalls: Array<{ name: string; arguments?: any }>;
    verificationToolCalls?: Array<{ name: string; arguments?: any }>;
    completedToolCalls?: AgentToolExecutionPreflightLogEntry[];
    requiresUserVisiblePreActionRationale?: boolean;
    /** @deprecated use requiresUserVisiblePreActionRationale */
    requiresPublicPlan?: boolean;
}

const READ_ONLY_OBSERVATION_TOOLS = new Set([
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getLayerHierarchy',
    'findLayers',
    'getAllTextLayers',
    'getLayerBounds',
    'getLayerProperties',
    'exportLayerAsBase64',
    'getTextContent',
    'getTextStyle',
    'getElementMapping',
    'analyzeLayout',
    'parseDetailPageTemplate',
    'detectLayerIssues',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'auditDetailPagePlacement',
    'describeImage',
    'diagnoseState'
]);

const PRIOR_DOCUMENT_READ_TOOLS = new Set([
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getLayerHierarchy',
    'findLayers',
    'getAllTextLayers',
    'getLayerBounds',
    'getLayerProperties',
    'exportLayerAsBase64',
    'getTextContent',
    'getTextStyle',
    'getElementMapping',
    'analyzeLayout',
    'parseDetailPageTemplate',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'auditDetailPagePlacement',
    'diagnoseState',
    // 治理审计(2026-07-01)补齐：形态变形所需的轮廓读取来源
    'extractShapePath',
    'getLayerContour',
    'getTemplateStructure'
]);

const CONTEXT_READ_TOOLS = new Set([
    'listDocuments',
    'listProjectResources',
    'searchProjectResources',
    'createProjectContactSheetOverview',
    'analyzeProjectContactSheetOverview',
    'analyzeProjectForDetailPage',
    'matchDetailPageContent',
    'resolveFontName',
    'getDesignProjectState',
    // 素材理解 / 推荐：只读分析，不改 Photoshop
    'analyzeAssetContent',
    'recommendAssets',
    // 设计源解析（PSD 知识库 P0）：离线读设计师 PSD/PSB 结构，只读不落盘
    'analyzePsdDesignSource',
    // 参考构图测量：本地主体检测+纯逻辑换算，只读不落盘
    'measureReferenceComposition',
    // Eagle 条目路径仅在主进程内部解析；返回的是去路径后的视觉观察。
    'analyzeEagleReference',
    // Eagle 素材真实视觉观察（P3）：从不透明 assetRef 观察素材图像，只读、回包无本地路径
    'observeEagleAsset'
]);

export const AGENT_HARNESS_CONTROL_TOOL_NAMES: readonly string[] = Object.freeze([
    // Capability Resolver：只改变下一轮模型可见 schema，不执行 Photoshop、也不算画面观察或任务进展。
    'requestAgentCapabilities',
    // V2「意图交给 Agent 理解」：模型自主声明本轮设计任务类型（元/控制工具，只读、不写 PS）。
    // 刻意归 stateful_context 而非 read_only_observation——它声明上下文、不观察画面，绝不能被完成门禁
    // 当成"改后已复核"的观察结果（那会放过幻觉式完成）。与 photoshop-tool-skill.ts 同步。
    'declareDesignIntent',
    // R1 Design Brief 由模型声明、Harness 按 manifest 输入校验；不执行动作、不算任务进展。
    DECLARE_DESIGN_BRIEF_TOOL_NAME,
    // R2 参考决策由模型声明、Harness 按 Skill reference_policy 与真实视觉观察校验。
    DECLARE_REFERENCE_BRIEF_TOOL_NAME,
    // R3 策略由模型结构化声明；Harness 只校验并记录阶段状态，不执行 Photoshop、不算任务进展。
    DECLARE_DESIGN_STRATEGY_TOOL_NAME,
    // R4 行动计划 / Design DSL 只形成运行计划，不拥有 Capability 激活或 Tool 调度权。
    DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME
]);

export function isAgentHarnessControlTool(toolName: unknown): boolean {
    const normalized = String(toolName || '').trim();
    return AGENT_HARNESS_CONTROL_TOOL_NAMES.includes(normalized);
}

/** 缺少 R1 输入时仍可使用的用户交互动作；只收集输入，不推进 Photoshop 执行阶段。 */
export function isAgentInputCollectionTool(toolName: unknown): boolean {
    return String(toolName || '').trim() === 'createInteractiveCard';
}

export const READ_ONLY_AGENT_CONTEXT_TOOL_NAMES: readonly string[] = Object.freeze([
    'requestAgentCapabilities',
    'switchDocument',
    'selectLayer',
    'focusLayer'
]);

export function isReadOnlyAgentContextTool(toolName: unknown): boolean {
    const normalized = String(toolName || '').trim();
    return READ_ONLY_AGENT_CONTEXT_TOOL_NAMES.includes(normalized);
}

const STATEFUL_CONTEXT_TOOLS = new Set([
    'createInteractiveCard',
    ...AGENT_HARNESS_CONTROL_TOOL_NAMES,
    'switchDocument',
    'openProjectFile',
    'selectLayer',
    'focusLayer',
    'delegateToAgent',
    // 写共享项目状态文件（非 Photoshop 写入），归为状态上下文类
    'updateDesignProjectState',
    // Eagle 素材复制进项目（P3）：写项目目录（非 Photoshop 写入），需串行；与 photoshop-tool-skill.ts 同步
    'importEagleAssetToProject',
    // 撤销/重做：改变历史与文档状态，需串行执行，但不要求前置文档读取
    'undo',
    'redo',
    // 浏览器扩展写/状态工具（改变用户浏览器视图或页面状态，需串行；与 photoshop-tool-skill.ts 同步）
    'captureBrowserTab',
    'navigateBrowserTab',
    'interactWithBrowserPage'
]);

const SAVE_EXPORT_TOOLS = new Set([
    'saveDocument',
    'smartSave',
    'quickExport',
    'exportGroup',
    'exportMainImageDocuments',
    'exportDetailPageSlices',
    'exportWhiteBgFromSkuMaterial',
    // 治理审计(2026-07-01)补齐：与 photoshop-tool-skill.ts 的 SAVE_EXPORT_TOOLS 保持同步
    'exportToSkuDir',
    'batchExport'
]);

const EXTERNAL_GENERATION_TOOLS = new Set([
    'generateImage'
]);

const KNOWLEDGE_SEARCH_TOOLS = new Set([
    'searchDesigns',
    'fetchWebPageDesignContent',
    'getMainImageDesignFramework',
    'getDetailPageDesignFramework',
    'getDesignPrinciples',
    'searchEagleReferences',
    'searchDesignKnowledge',
    // 浏览器扩展只读工具（与 photoshop-tool-skill.ts 的 KNOWLEDGE_SEARCH_TOOLS 保持同步，audit:tools 校验）
    'listBrowserTabs',
    'readBrowserPage'
]);

const EXTRA_PHOTOSHOP_WRITE_TOOLS = new Set([
    'fixLayerIssues',
    // 团队流水线含 executor 写入阶段，按写类工具纳入读后写纪律
    'runDesignTeamPipeline',
    // 主体感知缩放：组合工具（读主体/图框 → 求解 → alignToReference 写入），按写类纳入读后写纪律
    'fitLayerSubjectToRegion'
]);

const WRITE_TOOLS_ALLOWED_WITHOUT_PRIOR_DOCUMENT_READ = new Set([
    'createDocument',
    // 参考复刻 workflow bridge 在无文档时负责创建独立目标画布；其内部执行
    // 仍经过文档角色保护和原子 Tool guard，不把例外扩散给普通写工具。
    'layout-replication'
]);

const DOCUMENT_CONTEXT_BARRIER_TOOLS = new Set([
    'createDocument',
    'switchDocument',
    'openProjectFile',
    'openTemplate',
    'editSmartObjectContents',
    'closeDocument'
]);

/**
 * 会改变 Photoshop 活动文档的操作。参数化的 Smart Object 读取只有 autoOpen=true
 * 才是上下文屏障；集中在这里，避免 preflight、Completion 与视觉 Judge 各自维护白名单。
 */
export function isAgentDocumentContextBarrier(toolName: unknown, params: any = {}): boolean {
    const name = normalizeToolName(toolName);
    if (name === 'getSmartObjectLayers') return params?.autoOpen === true;
    return DOCUMENT_CONTEXT_BARRIER_TOOLS.has(name);
}

const ACTIVE_LAYER_CONTEXT_MUTATION_TOOLS = new Set([
    'selectLayer',
    'focusLayer',
    'undo',
    'redo'
]);

const PRE_ACTION_RATIONALE_KEYWORDS = /(计划|准备|我会|我将|将要|继续|生成|需要|先|然后|接着|下一步|读取|确认|检查|创建|修改|放置|执行|保存|导出|判断|依据|复核|plan|next|first|then)/i;
const VERIFICATION_KEYWORDS = /(验证|验收|复核|检查|确认|回读|截图|快照|结果|状态|图层|文档|画面|保存后|导出后|verify|check|inspect|snapshot|readback|result)/i;

export const SIMPLE_MECHANICAL_GUARDED_TOOLS = new Set([
    'createDocument',
    'createGroup',
    'createRectangle',
    'createEllipse',
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'setLayerOpacity',
    'setBlendMode',
    'setLayerFill',
    'addStroke',
    'addDropShadow',
    'clearLayerEffects',
    'renameLayer',
    'moveLayer',
    'reorderLayer',
    'moveLayerToGroup',
    'groupLayers',
    'ungroupLayers',
    'duplicateLayer',
    'deleteLayer',
    'selectLayer',
    'focusLayer',
    'quickExport',
    'saveDocument',
    'smartSave',
    'addBrightnessContrastAdjustment',
    'addHueSaturationAdjustment',
    'addLevelsAdjustment',
    'addColorBalanceAdjustment',
    'addVibranceAdjustment',
    'addPhotoFilterAdjustment',
    'createClippingMask',
    'releaseClippingMask'
]);

function toolSucceeded(entry: AgentToolExecutionPreflightLogEntry): boolean {
    return entry.result?.success !== false;
}

function normalizeToolName(name: unknown): string {
    return String(name || '').trim();
}

function normalizeAssistantContent(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isPriorDocumentReadTool(name: string): boolean {
    return PRIOR_DOCUMENT_READ_TOOLS.has(name);
}

function isFreshDocumentCreationResult(entry: AgentToolExecutionPreflightLogEntry): boolean {
    if (normalizeToolName(entry.name) !== 'createDocument') return false;
    if (!toolSucceeded(entry)) return false;
    const result = entry.result || {};
    if (result?.acceptance?.after?.hasDocument === true) return true;
    if (result?.document && typeof result.document === 'object') return true;
    if (result?.documentId || result?.id) return true;
    return Number(result?.width) > 0 && Number(result?.height) > 0;
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = typeof value === 'number'
        ? value
        : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function readFirstPositiveInteger(values: unknown[]): number | undefined {
    for (const value of values) {
        const parsed = readPositiveInteger(value);
        if (parsed !== undefined) return parsed;
    }
    return undefined;
}

function readDocumentIdFromObservationResult(toolName: string, result: any): number | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const nestedResult = result.result && typeof result.result === 'object' ? result.result : {};
    const document = result.document && typeof result.document === 'object' ? result.document : {};
    const activeDocument = result.activeDocument && typeof result.activeDocument === 'object'
        ? result.activeDocument
        : {};
    const documentInfo = result.documentInfo && typeof result.documentInfo === 'object'
        ? result.documentInfo
        : {};
    const stateDocumentInfo = result.state?.documentInfo && typeof result.state.documentInfo === 'object'
        ? result.state.documentInfo
        : {};
    const dataDocument = data.document && typeof data.document === 'object' ? data.document : {};
    const dataDocumentInfo = data.documentInfo && typeof data.documentInfo === 'object'
        ? data.documentInfo
        : {};
    const nestedDocument = nestedResult.document && typeof nestedResult.document === 'object'
        ? nestedResult.document
        : {};
    const firstSnapshot = Array.isArray(result.snapshots) && result.snapshots[0]
        && typeof result.snapshots[0] === 'object'
        ? result.snapshots[0]
        : {};

    return readFirstPositiveInteger([
        result.documentId,
        result.activeDocumentId,
        document.documentId,
        document.id,
        activeDocument.documentId,
        activeDocument.id,
        documentInfo.documentId,
        documentInfo.id,
        data.documentId,
        data.activeDocumentId,
        dataDocument.documentId,
        dataDocument.id,
        dataDocumentInfo.documentId,
        dataDocumentInfo.id,
        nestedResult.documentId,
        nestedDocument.documentId,
        nestedDocument.id,
        stateDocumentInfo.documentId,
        stateDocumentInfo.id,
        result.debug?.documentId,
        firstSnapshot.documentId,
        result.acceptance?.after?.documentId,
        result.acceptance?.after?.document?.id,
        // createDocument 的历史适配器曾把新文档 id 放在根级 id；其他读取工具的根级 id
        // 可能是图层/标注 id，绝不能泛化使用。
        toolName === 'createDocument' ? result.id : undefined
    ]);
}

function readActiveLayerIdFromObservationResult(result: any): number | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const nestedResult = result.result && typeof result.result === 'object' ? result.result : {};
    const document = result.document && typeof result.document === 'object' ? result.document : {};
    const activeDocument = result.activeDocument && typeof result.activeDocument === 'object'
        ? result.activeDocument
        : {};
    const documentInfo = result.documentInfo && typeof result.documentInfo === 'object'
        ? result.documentInfo
        : {};
    const dataDocument = data.document && typeof data.document === 'object' ? data.document : {};
    const dataDocumentInfo = data.documentInfo && typeof data.documentInfo === 'object'
        ? data.documentInfo
        : {};
    const nestedDocument = nestedResult.document && typeof nestedResult.document === 'object'
        ? nestedResult.document
        : {};

    return readFirstPositiveInteger([
        result.activeLayerId,
        result.activeLayer?.id,
        document.activeLayerId,
        document.activeLayer?.id,
        activeDocument.activeLayerId,
        activeDocument.activeLayer?.id,
        documentInfo.activeLayerId,
        documentInfo.activeLayer?.id,
        data.activeLayerId,
        data.activeLayer?.id,
        dataDocument.activeLayerId,
        dataDocument.activeLayer?.id,
        dataDocumentInfo.activeLayerId,
        dataDocumentInfo.activeLayer?.id,
        nestedResult.activeLayerId,
        nestedResult.activeLayer?.id,
        nestedDocument.activeLayerId,
        nestedDocument.activeLayer?.id
    ]);
}

interface ResolvedToolExecutionTargetGuard {
    guard?: AgentToolExecutionTargetGuard;
    logIndex: number;
}

function hasSuccessfulActiveLayerMutationAfter(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[],
    observationIndex: number
): boolean {
    return completedToolCalls.slice(observationIndex + 1).some((entry) => {
        if (!toolSucceeded(entry)) return false;
        const name = normalizeToolName(entry.name);
        return ACTIVE_LAYER_CONTEXT_MUTATION_TOOLS.has(name)
            || isAgentToolExecutionGuarded(name);
    });
}

function resolveLatestToolExecutionTargetGuard(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[]
): ResolvedToolExecutionTargetGuard | undefined {
    for (let index = completedToolCalls.length - 1; index >= 0; index -= 1) {
        const entry = completedToolCalls[index];
        const name = normalizeToolName(entry?.name);
        const mutationCommit = readPhotoshopMutationCommit(entry?.result);
        const historyTransition = readPhotoshopHistoryTransition(entry?.result);
        const crossedDocument = historyTransition?.documentChanged === true
            || mutationCommit?.documentChanged === true;
        if (crossedDocument) {
            const createdDocumentAfter = name === 'createDocument' && toolSucceeded(entry)
                ? (historyTransition?.after || mutationCommit?.after)
                : undefined;
            if (!createdDocumentAfter) {
                // 失败写、关闭/打开或外部切换不能把旧文档的“已读”资格搬到新文档。
                // 只有成功 createDocument 是受控的新目标生产者；其余必须重新观察。
                return { logIndex: index };
            }
            return {
                guard: {
                    expectedDocumentId: createdDocumentAfter.documentId,
                    expectedHistoryStateRef: {
                        documentId: createdDocumentAfter.documentId,
                        historyStateId: createdDocumentAfter.historyStateId
                    },
                    observationTool: `${name}:created_document_after`
                },
                logIndex: index
            };
        }
        if (historyTransition?.after) {
            const commitAfterMatchesAcceptance = Boolean(mutationCommit?.after
                && mutationCommit.after.documentId === historyTransition.after.documentId
                && mutationCommit.after.historyStateId === historyTransition.after.historyStateId);
            const matchingActiveLayerId = commitAfterMatchesAcceptance
                && typeof mutationCommit?.after?.activeLayerId === 'number'
                ? mutationCommit.after.activeLayerId
                : undefined;
            return {
                guard: {
                    expectedDocumentId: historyTransition.after.documentId,
                    expectedHistoryStateRef: historyTransition.after,
                    ...(matchingActiveLayerId === undefined
                        ? {}
                        : { expectedActiveLayerId: matchingActiveLayerId }),
                    observationTool: `${name}:acceptance_after`
                },
                logIndex: index
            };
        }
        if (mutationCommit?.after) {
            return {
                guard: {
                    expectedDocumentId: mutationCommit.after.documentId,
                    expectedHistoryStateRef: {
                        documentId: mutationCommit.after.documentId,
                        historyStateId: mutationCommit.after.historyStateId
                    },
                    ...(mutationCommit.after.activeLayerId === null
                        ? {}
                        : { expectedActiveLayerId: mutationCommit.after.activeLayerId }),
                    observationTool: `${name}:mutation_commit_after`
                },
                logIndex: index
            };
        }
        if (!toolSucceeded(entry)) continue;
        // createDocument 同时是上下文屏障和新目标生产者：若结果带稳定 id，下面仍应签发
        // 新文档 guard；其他屏障不能让更早观察跨过去继续生效。
        if (name !== 'createDocument' && isAgentDocumentContextBarrier(name, entry.arguments)) {
            return { logIndex: index };
        }
        if (!isPriorDocumentReadTool(name) && name !== 'createDocument') continue;
        const expectedDocumentId = readDocumentIdFromObservationResult(name, entry.result);
        if (expectedDocumentId === undefined) {
            // 成功 createDocument 已改变活动文档；若返回值没有稳定 id，旧目标不能跨越它继续生效。
            if (name === 'createDocument') return { logIndex: index };
            continue;
        }
        const expectedActiveLayerId = readActiveLayerIdFromObservationResult(entry.result);
        const activeLayerStillFresh = !hasSuccessfulActiveLayerMutationAfter(
            completedToolCalls,
            index
        );
        const expectedHistoryStateRef = activeLayerStillFresh
            ? readPhotoshopHistoryStateRef(entry.result)
            : undefined;
        return {
            guard: {
                expectedDocumentId,
                ...(activeLayerStillFresh && expectedActiveLayerId !== undefined
                    ? { expectedActiveLayerId }
                    : {}),
                ...(expectedHistoryStateRef?.documentId === expectedDocumentId
                    ? { expectedHistoryStateRef }
                    : {}),
                observationTool: name
            },
            logIndex: index
        };
    }
    return undefined;
}

function readRequiredToolName(result: any): string {
    if (!result || typeof result !== 'object') return '';
    return normalizeToolName(
        result.nextRequiredTool
        || result.requiredNextTool
        || result.requiredTool
        || result.data?.nextRequiredTool
        || result.data?.requiredNextTool
        || result.data?.requiredTool
    );
}

function hasRecoveryContextForTool(toolName: string, completedToolCalls: AgentToolExecutionPreflightLogEntry[]): boolean {
    const normalizedToolName = normalizeToolName(toolName);
    if (!normalizedToolName) return false;
    for (const entry of [...completedToolCalls].reverse()) {
        const requiredToolName = readRequiredToolName(entry.result);
        if (!requiredToolName) continue;
        return requiredToolName === normalizedToolName;
    }
    return false;
}

function hasNonEmptyParam(params: any, keys: string[]): boolean {
    if (!params || typeof params !== 'object') return false;
    return keys.some((key) => {
        const value = params?.[key];
        if (Array.isArray(value)) return value.length > 0;
        return typeof value === 'string'
            ? value.trim().length > 0
            : value !== undefined && value !== null;
    });
}

function hasExplicitSaveExportTarget(toolCalls: Array<{ name: string; arguments?: any }>): boolean {
    return toolCalls.some((call) => {
        const name = normalizeToolName(call?.name);
        if (!SAVE_EXPORT_TOOLS.has(name)) return false;
        return hasNonEmptyParam(call?.arguments, [
            'outputPath',
            'path',
            'outputDir',
            'projectSubdir',
            'sourceDocumentPath'
        ]);
    });
}

function hasExplicitReadbackVerificationTarget(toolCalls: Array<{ name: string; arguments?: any }>): boolean {
    return toolCalls.some((call) => {
        const name = normalizeToolName(call?.name);
        return PRIOR_DOCUMENT_READ_TOOLS.has(name);
    });
}

export function requiresUserVisiblePreActionRationaleForToolCalls(
    toolCalls: Array<{ name: string; arguments?: any }>
): boolean {
    const guardedCalls = (Array.isArray(toolCalls) ? toolCalls : [])
        .filter((call) => isAgentToolExecutionGuarded(call?.name, call?.arguments));
    if (guardedCalls.length === 0) return false;
    return guardedCalls.some((call) => !SIMPLE_MECHANICAL_GUARDED_TOOLS.has(normalizeToolName(call?.name)));
}

function collectLayerIdsFromValue(value: any, ids: Set<number>): void {
    if (!value || typeof value !== 'object') return;
    if (typeof value.layerId === 'number' && Number.isFinite(value.layerId)) ids.add(value.layerId);
    const looksLikeLayer = typeof value.name === 'string'
        && (
            value.kind !== undefined
            || value.layerKind !== undefined
            || value.bounds !== undefined
            || value.visible !== undefined
            || Array.isArray(value.children)
        );
    if (looksLikeLayer && typeof value.id === 'number' && Number.isFinite(value.id)) ids.add(value.id);
    if (value.layer && typeof value.layer === 'object') collectLayerIdsFromValue(value.layer, ids);
    if (value.data && typeof value.data === 'object') collectLayerIdsFromValue(value.data, ids);
    if (value.result && typeof value.result === 'object') collectLayerIdsFromValue(value.result, ids);
    if (Array.isArray(value.layers)) value.layers.forEach((item) => collectLayerIdsFromValue(item, ids));
    if (Array.isArray(value.children)) value.children.forEach((item) => collectLayerIdsFromValue(item, ids));
}

function collectKnownLayerIds(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[],
    latestTargetObservation?: ResolvedToolExecutionTargetGuard
): number[] {
    const ids = new Set<number>();
    if (latestTargetObservation?.guard?.expectedActiveLayerId !== undefined) {
        ids.add(latestTargetObservation.guard.expectedActiveLayerId);
    }
    const scopedCalls = latestTargetObservation
        ? completedToolCalls.slice(latestTargetObservation.logIndex)
        : completedToolCalls;
    for (const entry of scopedCalls) {
        if (!toolSucceeded(entry)) continue;
        collectLayerIdsFromValue(entry.result, ids);
    }
    return Array.from(ids).sort((a, b) => a - b);
}

function collectRequestedLayerIds(toolCalls: Array<{ name: string; arguments?: any }>): number[] {
    const ids = new Set<number>();
    for (const call of toolCalls || []) {
        const args = call?.arguments || {};
        if (typeof args.layerId === 'number' && Number.isFinite(args.layerId)) ids.add(args.layerId);
        if (Array.isArray(args.layerIds)) {
            for (const id of args.layerIds) {
                if (typeof id === 'number' && Number.isFinite(id)) ids.add(id);
            }
        }
    }
    return Array.from(ids).sort((a, b) => a - b);
}

/** 技能（多步工作流）在循环内以工具形式出现，按其实际行为分类 */
const READ_ONLY_SKILL_IDS = new Set(['visual-analysis', 'project-image-analysis']);
const KNOWLEDGE_SEARCH_SKILL_IDS = new Set(['design-reference-search']);

/** 带参数的只读模式：detail-page-design 纯检查（inspectOnly 且不自动修复）、layer-management 检查动作 */
function isReadOnlySkillInvocation(skillId: string, params: any): boolean {
    if (READ_ONLY_SKILL_IDS.has(skillId)) return true;
    if (skillId === 'detail-page-design') {
        return params?.inspectOnly === true && params?.autoFix !== true;
    }
    if (skillId === 'layer-management') {
        return params?.action === 'inspect';
    }
    return false;
}

/**
 * 只有真实读取当前 Photoshop 文档的调用，才可验证一次画布写入。
 * 项目资源、Memory、附件分析和 capability/context 读取即使分类为 read_only_observation，
 * 也不能取得 Photoshop 完成信用。
 */
export function isAgentPhotoshopDocumentObservation(toolName: unknown, params: any = {}): boolean {
    const name = normalizeToolName(toolName);
    if (!name || isAgentDocumentContextBarrier(name, params)) return false;
    const semantics = getPhotoshopToolSkillSemantics(name, params);
    if (semantics) {
        return semantics.capabilityKind === 'read_only_observation'
            && semantics.sideEffect === 'photoshop_read'
            && semantics.requiresPhotoshopConnection
            && semantics.requiresOpenDocument;
    }
    return (name === 'layer-management' || name === 'detail-page-design')
        && isReadOnlySkillInvocation(name, params);
}

export function classifyAgentToolExecution(toolName: string, params: any = {}): AgentToolExecutionKind {
    const name = normalizeToolName(toolName);
    if (!name) return 'unknown';
    if (name === 'getSmartObjectLayers' && params?.autoOpen === true) return 'stateful_context';
    if (name === 'delegateToAgent' && String(params?.role || '').trim() === 'executor') {
        // executor 子 Agent 可以写 Photoshop；父日志看不到其内部原子调用时按写入保守处理，
        // 强制后续由父 Agent 重新读取最终画面，不能沿用委派前快照。
        return 'photoshop_write';
    }
    const sharedSemanticsKind = classifyPhotoshopToolSkillExecution(name, params);
    if (sharedSemanticsKind !== 'unknown') return sharedSemanticsKind;
    if (READ_ONLY_OBSERVATION_TOOLS.has(name) || CONTEXT_READ_TOOLS.has(name)) return 'read_only_observation';
    if (KNOWLEDGE_SEARCH_TOOLS.has(name)) return 'knowledge_search';
    if (SAVE_EXPORT_TOOLS.has(name)) return 'save_export';
    if (EXTERNAL_GENERATION_TOOLS.has(name)) return 'external_generation';
    if (EXTRA_PHOTOSHOP_WRITE_TOOLS.has(name)) return 'photoshop_write';
    if (shouldCollectAcceptanceVerification(name, params)) return 'photoshop_write';
    if (STATEFUL_CONTEXT_TOOLS.has(name)) return 'stateful_context';
    if (getSkillById(name)) {
        if (isReadOnlySkillInvocation(name, params)) return 'read_only_observation';
        if (KNOWLEDGE_SEARCH_SKILL_IDS.has(name)) return 'knowledge_search';
        return 'photoshop_write';
    }
    return 'unknown';
}

export function isAgentToolExecutionGuarded(toolName: string, params: any = {}): boolean {
    const kind = classifyAgentToolExecution(toolName, params);
    return kind === 'photoshop_write' || kind === 'save_export';
}

export function buildAgentToolExecutionPreflight(
    input: AgentToolExecutionPreflightInput
): AgentToolExecutionPreflight {
    const assistantContent = normalizeAssistantContent(input.assistantContent);
    const requiresUserVisiblePreActionRationale = input.requiresUserVisiblePreActionRationale
        ?? input.requiresPublicPlan
        ?? true;
    const completedToolCalls = Array.isArray(input.completedToolCalls) ? input.completedToolCalls : [];
    const verificationToolCalls = Array.isArray(input.verificationToolCalls)
        ? input.verificationToolCalls
        : input.toolCalls;
    const tools = (Array.isArray(input.toolCalls) ? input.toolCalls : [])
        .map((call) => {
            const name = normalizeToolName(call?.name);
            const kind = classifyAgentToolExecution(name, call?.arguments);
            return {
                name,
                kind,
                guarded: kind === 'photoshop_write' || kind === 'save_export'
            };
        })
        .filter((tool) => tool.name);

    const priorReadTools = completedToolCalls
        .filter((entry) => {
            const name = normalizeToolName(entry.name);
            return (isPriorDocumentReadTool(name) && toolSucceeded(entry))
                || isFreshDocumentCreationResult(entry);
        })
        .map((entry) => normalizeToolName(entry.name));
    const hasPriorDocumentRead = priorReadTools.length > 0;
    const hasUserVisiblePreActionRationale = assistantContent.length >= 12 && PRE_ACTION_RATIONALE_KEYWORDS.test(assistantContent);
    const recoveryToolNames = new Set(
        tools
            .filter((tool) => tool.guarded && hasRecoveryContextForTool(tool.name, completedToolCalls))
            .map((tool) => tool.name)
    );
    const guardedToolNames = tools
        .filter((tool) => tool.guarded)
        .map((tool) => tool.name);
    const hasOnlySimpleMechanicalGuardedTools = guardedToolNames.length > 0
        && guardedToolNames.every((name) => SIMPLE_MECHANICAL_GUARDED_TOOLS.has(name));
    const hasVerificationTarget = VERIFICATION_KEYWORDS.test(assistantContent)
        || recoveryToolNames.size > 0
        || hasExplicitSaveExportTarget(input.toolCalls || [])
        || hasExplicitReadbackVerificationTarget(verificationToolCalls || []);
    const latestTargetObservation = resolveLatestToolExecutionTargetGuard(completedToolCalls);

    const preconditions = {
        hasPriorDocumentRead,
        priorReadTools: Array.from(new Set(priorReadTools)),
        hasUserVisiblePreActionRationale,
        hasPublicPlan: hasUserVisiblePreActionRationale,
        hasVerificationTarget,
        knownLayerIds: collectKnownLayerIds(completedToolCalls, latestTargetObservation),
        targetGuard: latestTargetObservation?.guard
    };

    if (tools.length === 0) {
        return {
            status: 'not_applicable',
            ready: true,
            tools,
            preconditions,
            blockers: [],
            warnings: []
        };
    }

    const guardedTool = tools.find((tool) => tool.guarded);
    if (!guardedTool) {
        const warnings = tools
            .filter((tool) => tool.kind === 'external_generation' || tool.kind === 'stateful_context' || tool.kind === 'unknown')
            .map((tool) => `${tool.name} 不是普通只读工具，后续写入前仍需读取目标 Photoshop 文档。`);
        return {
            status: 'ready',
            ready: true,
            tools,
            preconditions,
            blockers: [],
            warnings
        };
    }

    const blockers: string[] = [];
    if (requiresUserVisiblePreActionRationale && !hasUserVisiblePreActionRationale) {
        blockers.push('缺少给用户可见的动手前判断，不能直接发起 Photoshop 写入或保存导出。');
    }
    if (!hasVerificationTarget && !hasOnlySimpleMechanicalGuardedTools) {
        blockers.push('缺少明确的执行后复核目标，不能直接发起 Photoshop 写入或保存导出。');
    }
    if (!hasPriorDocumentRead && !WRITE_TOOLS_ALLOWED_WITHOUT_PRIOR_DOCUMENT_READ.has(guardedTool.name)) {
        blockers.push('尚未读取目标 Photoshop 文档或画面，不能确认目标文档、图层或画面状态。');
    }
    if (hasPriorDocumentRead
        && !preconditions.targetGuard
        && !WRITE_TOOLS_ALLOWED_WITHOUT_PRIOR_DOCUMENT_READ.has(guardedTool.name)) {
        blockers.push('已有读取结果未包含可校验的 documentId，不能精确锁定 Photoshop 写入目标。请先调用 getDocumentInfo 或其他会返回文档身份的只读工具。');
    }
    const requestedLayerIds = collectRequestedLayerIds(input.toolCalls || []);
    const unknownLayerIds = requestedLayerIds.filter((id) => !preconditions.knownLayerIds.includes(id));
    if (unknownLayerIds.length > 0) {
        blockers.push(`工具参数包含未从已完成图层创建或读取结果中确认的 layerId：${unknownLayerIds.join(', ')}。不能猜测目标图层。`);
    }

    if (blockers.length > 0) {
        return {
            status: 'blocked',
            ready: false,
            issue: 'agent_tool_execution_preflight_blocked',
            message: [
                `已阻止工具执行：${guardedTool.name}。`,
                ...blockers,
                '请先形成给用户可见的动手前判断，读取必要的文档、图层与画面状态，并说明执行后如何复核。'
            ].join('\n'),
            blockedTool: guardedTool,
            tools,
            preconditions,
            blockers,
            warnings: []
        };
    }

    return {
        status: 'ready',
        ready: true,
        tools,
        preconditions,
        blockers: [],
        warnings: []
    };
}
