import type {
    AgentTaskPublicPlanControlledOperationRequest,
    AgentTaskPublicPlanExecutionRequest
} from './agent-task-public-plan-execution-request';
import { solveLayout, type LayoutBlock, type ResolvedBlock } from './layout/layout-engine';
import {
    runAgentResumeControlledExecutionRunner,
    type AgentResumeControlledExecutionAdapter,
    type AgentResumeControlledExecutionRun,
    type AgentResumeControlledExecutionRunnerTarget,
    type AgentResumeControlledOperationRequest
} from './agent-resume-controlled-execution';
import { sanitizeAgentResumePlanningValue } from './agent-resume-planning';

export type AgentTaskPublicPlanControlledRunnerVersion = 'agent-task-public-plan-controlled-runner/v0';

export type AgentTaskPublicPlanControlledRunnerStatus =
    | 'not_applicable'
    | 'blocked_request_not_ready'
    | 'blocked_adapter_required'
    | 'blocked_live_write_permission_missing'
    | 'blocked_live_execution_scope_required'
    | 'blocked_live_project_write_approval_required'
    | 'blocked_live_adapter_required'
    | 'blocked_live_operation_params_required'
    | 'blocked_readback_adapter_required'
    | 'completed_dry_run'
    | 'completed_fake_adapter_verified'
    | 'completed_live_adapter_verified'
    | 'failed_write_operation'
    | 'failed_readback';

export type AgentTaskPublicPlanControlledRunnerTarget =
    | 'dry-run'
    | 'fake-adapter'
    | 'live-photoshop';

export type AgentTaskPublicPlanLiveExecutionScope =
    | 'not_applicable'
    | 'disposable-document'
    | 'explicit-project-document';

export interface AgentTaskPublicPlanControlledAdapterResult {
    success?: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentTaskPublicPlanControlledAdapter {
    runWriteOperation(
        operation: AgentTaskPublicPlanControlledOperationRequest
    ): AgentTaskPublicPlanControlledAdapterResult;
    readbackAfterOperation?(
        operation: AgentTaskPublicPlanControlledOperationRequest,
        target: string
    ): AgentTaskPublicPlanControlledAdapterResult;
}

type MaybePromise<T> = T | Promise<T>;

export interface AgentTaskPublicPlanControlledAsyncAdapter {
    runWriteOperation(
        operation: AgentTaskPublicPlanControlledOperationRequest
    ): MaybePromise<AgentTaskPublicPlanControlledAdapterResult>;
    readbackAfterOperation?(
        operation: AgentTaskPublicPlanControlledOperationRequest,
        target: string
    ): MaybePromise<AgentTaskPublicPlanControlledAdapterResult>;
}

export interface AgentTaskPublicPlanControlledOperationResult {
    operationId: string;
    toolName: string;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentTaskPublicPlanControlledReadbackResult {
    operationId: string;
    toolName: string;
    target: string;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentTaskPublicPlanObservationDiff {
    version: 'agent-task-public-plan-observation-diff/v0';
    status: 'not_applicable' | 'matched' | 'mismatch';
    expectedVisibleCopy: string[];
    observedVisibleCopy: string[];
    missingVisibleCopy: string[];
    nextAction: 'continue' | 'repair_missing_visible_copy' | 'observe_again';
    userVisibleSummary: string;
}

export interface AgentTaskPublicPlanControlledRunnerInput {
    request?: AgentTaskPublicPlanExecutionRequest;
    executionTarget?: AgentTaskPublicPlanControlledRunnerTarget;
    allowPhotoshopWrites?: boolean;
    liveExecutionScope?: AgentTaskPublicPlanLiveExecutionScope;
    explicitProjectWriteApproval?: boolean;
    adapter?: AgentTaskPublicPlanControlledAdapter;
}

export interface AgentTaskPublicPlanControlledAsyncRunnerInput extends Omit<AgentTaskPublicPlanControlledRunnerInput, 'adapter'> {
    adapter?: AgentTaskPublicPlanControlledAsyncAdapter;
}

export interface AgentTaskPublicPlanControlledRun {
    version: AgentTaskPublicPlanControlledRunnerVersion;
    status: AgentTaskPublicPlanControlledRunnerStatus;
    requestId?: string;
    requestStatus?: AgentTaskPublicPlanExecutionRequest['status'];
    executionTarget: AgentTaskPublicPlanControlledRunnerTarget;
    liveExecutionScope: AgentTaskPublicPlanLiveExecutionScope;
    explicitProjectWriteApproval: boolean;
    requiresLiveExecutionScope: boolean;
    requiresExplicitProjectWriteApproval: boolean;
    fakeAdapterOnly: boolean;
    executionState: AgentResumeControlledExecutionRun['executionState'];
    verificationStatus: AgentResumeControlledExecutionRun['verificationStatus'];
    writesPerformed: boolean;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: boolean;
    mustNotRunWriteTools: boolean;
    mustNotClaimTaskCompletion: true;
    plannedWriteTools: string[];
    executedWriteTools: string[];
    readbackTargets: string[];
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[];
    operationResults: AgentTaskPublicPlanControlledOperationResult[];
    readbackResults: AgentTaskPublicPlanControlledReadbackResult[];
    observationDiff?: AgentTaskPublicPlanObservationDiff;
    publicPlanSummary?: string;
    executionPlanSummary?: string;
    dryRun: boolean;
    blockers: string[];
    warnings: string[];
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = String(item || '').trim();
        if (!text || output.includes(text)) continue;
        output.push(text);
    }
    return output;
}

function resolveExecutionTarget(
    input: { executionTarget?: AgentTaskPublicPlanControlledRunnerTarget }
): AgentTaskPublicPlanControlledRunnerTarget {
    if (input.executionTarget === 'fake-adapter') return 'fake-adapter';
    if (input.executionTarget === 'live-photoshop') return 'live-photoshop';
    return 'dry-run';
}

function resolveLiveExecutionScope(
    input: { liveExecutionScope?: AgentTaskPublicPlanLiveExecutionScope },
    target: AgentTaskPublicPlanControlledRunnerTarget
): AgentTaskPublicPlanLiveExecutionScope {
    if (target !== 'live-photoshop') return 'not_applicable';
    if (input.liveExecutionScope === 'disposable-document') return 'disposable-document';
    if (input.liveExecutionScope === 'explicit-project-document') return 'explicit-project-document';
    return 'not_applicable';
}

function toResumeOperation(
    operation: AgentTaskPublicPlanControlledOperationRequest
): AgentResumeControlledOperationRequest {
    return {
        operationId: operation.operationId,
        toolName: operation.toolName,
        params: operation.params,
        paramsSummary: operation.paramsSummary,
        readbackTargets: [...operation.readbackTargets]
    };
}

function toPublicOperation(
    operation: AgentResumeControlledOperationRequest
): AgentTaskPublicPlanControlledOperationRequest {
    return {
        operationId: operation.operationId,
        toolName: operation.toolName,
        params: operation.params,
        paramsSummary: operation.paramsSummary,
        readbackTargets: [...operation.readbackTargets]
    };
}

function toResumeAdapter(
    adapter?: AgentTaskPublicPlanControlledAdapter
): AgentResumeControlledExecutionAdapter | undefined {
    if (!adapter) return undefined;
    const readbackAfterOperation = adapter.readbackAfterOperation;
    return {
        runWriteOperation: (operation) => adapter.runWriteOperation(toPublicOperation(operation)),
        readbackAfterOperation: readbackAfterOperation
            ? (operation, target) => readbackAfterOperation(toPublicOperation(operation), target)
            : undefined
    };
}

function toResumeRequest(request: AgentTaskPublicPlanExecutionRequest) {
    return {
        version: 'agent-resume-controlled-execution-request/v0' as const,
        status: request.status === 'ready_for_controlled_execution_request'
            && request.canStartControlledRunner === true
            ? 'ready_for_controlled_runner' as const
            : 'blocked_execution_gate_not_ready' as const,
        requestId: request.requestId,
        writesPerformed: false as const,
        rawPayloadRedacted: true as const,
        shouldRunPhotoshop: false as const,
        mustNotRunWriteTools: true as const,
        mustNotClaimTaskCompletion: true as const,
        requiresControlledRunner: true as const,
        requiresReadbackAfterEachWrite: true as const,
        canStartControlledRunner: request.status === 'ready_for_controlled_execution_request'
            && request.canStartControlledRunner === true,
        approvedWriteTools: normalizeStringList(request.approvedWriteTools),
        readbackTargets: normalizeStringList(request.readbackTargets),
        operationRequests: request.operationRequests.map(toResumeOperation),
        executionPlan: {
            publicPlanSummary: request.publicPlanSummary,
            taskPlanStatus: request.taskPlanStatus,
            publicPlanStatus: request.publicPlanStatus
        },
        blockers: [...request.blockers],
        warnings: [...request.warnings]
    };
}

function mapStatus(status: AgentResumeControlledExecutionRun['status']): AgentTaskPublicPlanControlledRunnerStatus {
    if (status === 'not_applicable') return 'not_applicable';
    if (status === 'blocked_request_not_ready') return 'blocked_request_not_ready';
    if (status === 'blocked_adapter_required') return 'blocked_adapter_required';
    if (status === 'blocked_readback_adapter_required') return 'blocked_readback_adapter_required';
    if (status === 'completed_dry_run') return 'completed_dry_run';
    if (status === 'completed_fake_adapter_verified') return 'completed_fake_adapter_verified';
    if (status === 'completed_live_adapter_verified') return 'completed_live_adapter_verified';
    if (status === 'failed_write_operation') return 'failed_write_operation';
    if (status === 'failed_readback') return 'failed_readback';
    if (status === 'blocked_live_write_permission_missing') return 'blocked_live_write_permission_missing';
    if (status === 'blocked_live_adapter_required') return 'blocked_live_adapter_required';
    if (status === 'blocked_live_operation_params_required') return 'blocked_live_operation_params_required';
    return 'blocked_request_not_ready';
}

function mapTarget(
    target: AgentResumeControlledExecutionRunnerTarget
): AgentTaskPublicPlanControlledRunnerTarget {
    if (target === 'fake-adapter') return 'fake-adapter';
    if (target === 'live-photoshop') return 'live-photoshop';
    return 'dry-run';
}

function buildPublicPlanRun(
    input: {
        request?: AgentTaskPublicPlanExecutionRequest;
        target: AgentTaskPublicPlanControlledRunnerTarget;
        liveExecutionScope: AgentTaskPublicPlanLiveExecutionScope;
        explicitProjectWriteApproval?: boolean;
        resumeRun: AgentResumeControlledExecutionRun;
    }
): AgentTaskPublicPlanControlledRun {
    const request = input.request;
    return {
        version: 'agent-task-public-plan-controlled-runner/v0',
        status: mapStatus(input.resumeRun.status),
        requestId: request?.requestId,
        requestStatus: request?.status,
        executionTarget: mapTarget(input.resumeRun.executionTarget),
        liveExecutionScope: input.liveExecutionScope,
        explicitProjectWriteApproval: input.explicitProjectWriteApproval === true,
        requiresLiveExecutionScope: input.target === 'live-photoshop',
        requiresExplicitProjectWriteApproval: input.liveExecutionScope === 'explicit-project-document',
        fakeAdapterOnly: input.resumeRun.fakeAdapterOnly,
        executionState: input.resumeRun.executionState,
        verificationStatus: input.resumeRun.verificationStatus,
        writesPerformed: input.resumeRun.writesPerformed,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: input.resumeRun.shouldRunPhotoshop,
        mustNotRunWriteTools: input.resumeRun.mustNotRunWriteTools !== false,
        mustNotClaimTaskCompletion: true,
        plannedWriteTools: normalizeStringList(input.resumeRun.plannedWriteTools),
        executedWriteTools: normalizeStringList(input.resumeRun.executedWriteTools),
        readbackTargets: request?.readbackTargets || normalizeStringList(input.resumeRun.readbackTargets),
        operationRequests: request?.operationRequests || input.resumeRun.operationRequests.map(toPublicOperation),
        operationResults: input.resumeRun.operationResults.map((result) => ({
            operationId: result.operationId,
            toolName: result.toolName,
            success: result.success,
            error: result.error,
            data: sanitizeAgentResumePlanningValue(result.data)
        })),
        readbackResults: input.resumeRun.readbackResults.map((result) => ({
            operationId: result.operationId,
            toolName: result.toolName,
            target: result.target,
            success: result.success,
            error: result.error,
            data: sanitizeAgentResumePlanningValue(result.data)
        })),
        publicPlanSummary: request?.publicPlanSummary,
        executionPlanSummary: request?.executionPlanSummary,
        dryRun: input.resumeRun.dryRun,
        blockers: [...input.resumeRun.blockers],
        warnings: input.resumeRun.warnings.map((warning) =>
            warning.replace(/恢复/g, '公开计划')
        )
    };
}

function buildBlockedPublicPlanRun(input: {
    request?: AgentTaskPublicPlanExecutionRequest;
    target: AgentTaskPublicPlanControlledRunnerTarget;
    liveExecutionScope: AgentTaskPublicPlanLiveExecutionScope;
    explicitProjectWriteApproval?: boolean;
    status: AgentTaskPublicPlanControlledRunnerStatus;
    blockers: string[];
    warnings?: string[];
}): AgentTaskPublicPlanControlledRun {
    const request = input.request;
    return {
        version: 'agent-task-public-plan-controlled-runner/v0',
        status: input.status,
        requestId: request?.requestId,
        requestStatus: request?.status,
        executionTarget: input.target,
        liveExecutionScope: input.liveExecutionScope,
        explicitProjectWriteApproval: input.explicitProjectWriteApproval === true,
        requiresLiveExecutionScope: input.target === 'live-photoshop',
        requiresExplicitProjectWriteApproval: input.liveExecutionScope === 'explicit-project-document',
        fakeAdapterOnly: input.target === 'fake-adapter',
        executionState: 'not_started',
        verificationStatus: 'not_run',
        writesPerformed: false,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: false,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        plannedWriteTools: normalizeStringList(request?.operationRequests.map((operation) => operation.toolName)),
        executedWriteTools: [],
        readbackTargets: request?.readbackTargets || [],
        operationRequests: request?.operationRequests || [],
        operationResults: [],
        readbackResults: [],
        publicPlanSummary: request?.publicPlanSummary,
        executionPlanSummary: request?.executionPlanSummary,
        dryRun: false,
        blockers: input.blockers,
        warnings: [
            ...(request?.warnings || []),
            ...(input.warnings || [])
        ]
    };
}

function hasReadbackTargets(request?: AgentTaskPublicPlanExecutionRequest): boolean {
    return Boolean(request?.operationRequests.some((operation) =>
        Array.isArray(operation.readbackTargets) && operation.readbackTargets.length > 0
    ));
}

function isParamRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
}

function normalizeRenderLayoutCopy(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isRenderLayoutVisibleCopyRole(role: unknown): boolean {
    return ['title', 'subtitle', 'selling-point', 'tag'].includes(String(role || ''));
}

function looksLikeInternalVisibleCopy(text: string): boolean {
    if (!text) return false;
    return /使用(?:项目|当前|本地)?素材/u.test(text)
        || /项目素材(?:中|里|的)?/u.test(text)
        || /素材中(?:的)?/u.test(text)
        || /(?:选择|置入|放入|自动选|匹配).{0,12}(?:图片|素材|图)/u.test(text)
        || /(?:图片|素材|图).{0,12}(?:占位|待补充|待替换|后续)/u.test(text)
        || /(?:占位|placeholder|待补充|示例文案|模板文案|图片区域)/iu.test(text)
        || /(?:首屏|核心卖点|材质|透气|弹力|耐磨|颜色|搭配).{0,8}[：:].{0,28}(?:使用|展示|说明|提供|配以|放入|置入)/u.test(text);
}

function maxRenderLayoutCopyLength(role: unknown): number {
    if (String(role || '') === 'title') return 36;
    return 56;
}

function collectRenderLayoutVisibleCopyBlockers(
    operation: AgentTaskPublicPlanControlledOperationRequest,
    blocks: unknown[]
): string[] {
    const blockers: string[] = [];
    blocks.forEach((block, index) => {
        if (!isParamRecord(block)) return;
        const role = String(block.role || '').trim();
        if (!RENDER_LAYOUT_ROLES.has(role)) {
            blockers.push(`renderLayout block ${String(block.id || index + 1)} 的 role「${role || '空'}」不支持；只能使用 background/main-image/title/subtitle/selling-point/tag/decoration。`);
            return;
        }
        if (!isRenderLayoutVisibleCopyRole(block.role)) return;
        const copy = normalizeRenderLayoutCopy(block.content);
        if (!copy) {
            blockers.push(`renderLayout block ${String(block.id || index + 1)} 缺少可见文案。`);
            return;
        }
        if (looksLikeInternalVisibleCopy(copy)) {
            blockers.push(`renderLayout block ${String(block.id || index + 1)} 的可见文案像内部素材说明，不能画到画面上：${copy.slice(0, 60)}`);
        }
        if (copy.length > maxRenderLayoutCopyLength(block.role)) {
            blockers.push(`renderLayout block ${String(block.id || index + 1)} 的可见文案过长，应拆成买家可读的短标题或短卖点：${copy.slice(0, 60)}`);
        }
    });
    return blockers.map((blocker) =>
        operation.operationId ? `${operation.operationId}: ${blocker}` : blocker
    );
}

function normalizeTargetBounds(value: unknown): { left: number; top: number; width: number; height: number } | null {
    if (!isParamRecord(value)) return null;
    const left = readFiniteNumber(value.left) ?? readFiniteNumber(value.x);
    const top = readFiniteNumber(value.top) ?? readFiniteNumber(value.y);
    const width = readFiniteNumber(value.width);
    const height = readFiniteNumber(value.height);
    const right = readFiniteNumber(value.right);
    const bottom = readFiniteNumber(value.bottom);
    const resolvedWidth = width ?? (right !== undefined && left !== undefined ? right - left : undefined);
    const resolvedHeight = height ?? (bottom !== undefined && top !== undefined ? bottom - top : undefined);
    if (left === undefined || top === undefined || resolvedWidth === undefined || resolvedHeight === undefined) return null;
    if (resolvedWidth <= 0 || resolvedHeight <= 0) return null;
    return {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(resolvedWidth),
        height: Math.round(resolvedHeight)
    };
}

function normalizeCanvasSize(value: unknown): { width: number; height: number } | null {
    if (!isParamRecord(value)) return null;
    const width = readFiniteNumber(value.width);
    const height = readFiniteNumber(value.height);
    if (width === undefined || height === undefined || width <= 0 || height <= 0) return null;
    return { width: Math.round(width), height: Math.round(height) };
}

const RENDER_LAYOUT_ROLES = new Set([
    'background',
    'main-image',
    'title',
    'subtitle',
    'selling-point',
    'tag',
    'decoration'
]);

function normalizeLayoutBlock(value: unknown, index: number): LayoutBlock | null {
    if (!isParamRecord(value)) return null;
    const role = typeof value.role === 'string' ? value.role.trim() : '';
    if (!RENDER_LAYOUT_ROLES.has(role)) return null;
    const hAlign = typeof value.hAlign === 'string' && ['left', 'center', 'right'].includes(value.hAlign)
        ? value.hAlign
        : undefined;
    return {
        id: String(value.id || index + 1),
        role: role as LayoutBlock['role'],
        content: typeof value.content === 'string' ? value.content : undefined,
        heightRatio: readFiniteNumber(value.heightRatio),
        widthRatio: readFiniteNumber(value.widthRatio),
        hAlign: hAlign as LayoutBlock['hAlign'] | undefined
    };
}

function resolvePublicPlanCanvasSize(
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[]
): { width: number; height: number; source: string } | null {
    const documentCanvas = resolveCreateDocumentCanvasSize(operationRequests);
    if (documentCanvas) return documentCanvas;
    for (const operation of operationRequests) {
        if (operation.toolName !== 'renderLayout' || !isParamRecord(operation.params)) continue;
        const size = normalizeCanvasSize(operation.params.canvas);
        if (size) return { ...size, source: operation.operationId || 'renderLayout.canvas' };
    }
    return null;
}

function resolveCreateDocumentCanvasSize(
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[]
): { width: number; height: number; source: string } | null {
    for (const operation of operationRequests) {
        if (operation.toolName !== 'createDocument' || !isParamRecord(operation.params)) continue;
        const size = normalizeCanvasSize(operation.params);
        if (size) return { ...size, source: operation.operationId || 'createDocument' };
    }
    return null;
}

function collectRenderLayoutCanvasBlockers(
    operation: AgentTaskPublicPlanControlledOperationRequest,
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[]
): string[] {
    if (!isParamRecord(operation.params)) return [];
    const operationLabel = operation.operationId || 'renderLayout';
    const layoutCanvas = normalizeCanvasSize(operation.params.canvas);
    if (!layoutCanvas) {
        return [
            `${operationLabel}: renderLayout 需要 params.canvas.width/height，不能依赖默认 800x800；否则预检坐标和 Photoshop 实际渲染坐标会不一致。`
        ];
    }

    const documentCanvas = resolveCreateDocumentCanvasSize(operationRequests);
    if (!documentCanvas) return [];
    if (Math.abs(layoutCanvas.width - documentCanvas.width) > 1 || Math.abs(layoutCanvas.height - documentCanvas.height) > 1) {
        return [
            `${operationLabel}: renderLayout canvas ${layoutCanvas.width}x${layoutCanvas.height} 必须与 ${documentCanvas.source} 画布 ${documentCanvas.width}x${documentCanvas.height} 一致，避免图文分区预检失真。`
        ];
    }
    return [];
}

function rectArea(rect: { width: number; height: number }): number {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function rectIntersectionArea(
    a: { left: number; top: number; width: number; height: number },
    b: { left: number; top: number; width: number; height: number }
): number {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.left + a.width, b.left + b.width);
    const bottom = Math.min(a.top + a.height, b.top + b.height);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function resolvedBlockToBounds(block: ResolvedBlock): { left: number; top: number; width: number; height: number } {
    return {
        left: block.x,
        top: block.y,
        width: block.width,
        height: block.height
    };
}

function normalizeLayerBounds(value: unknown): { left: number; top: number; width: number; height: number } | null {
    if (!isParamRecord(value)) return null;
    const left = readFiniteNumber(value.left) ?? readFiniteNumber(value.x);
    const top = readFiniteNumber(value.top) ?? readFiniteNumber(value.y);
    const width = readFiniteNumber(value.width);
    const height = readFiniteNumber(value.height);
    const right = readFiniteNumber(value.right);
    const bottom = readFiniteNumber(value.bottom);
    const resolvedWidth = width ?? (right !== undefined && left !== undefined ? right - left : undefined);
    const resolvedHeight = height ?? (bottom !== undefined && top !== undefined ? bottom - top : undefined);
    if (left === undefined || top === undefined || resolvedWidth === undefined || resolvedHeight === undefined) return null;
    if (resolvedWidth <= 0 || resolvedHeight <= 0) return null;
    return {
        left,
        top,
        width: resolvedWidth,
        height: resolvedHeight
    };
}

interface ReadbackVisualLayer {
    id?: number;
    name: string;
    kind: string;
    visible: boolean;
    contents?: string;
    bounds: { left: number; top: number; width: number; height: number };
}

function normalizeReadbackVisualLayer(value: unknown): ReadbackVisualLayer | null {
    if (!isParamRecord(value)) return null;
    const bounds = normalizeLayerBounds(value.bounds);
    if (!bounds) return null;
    const id = readFiniteNumber(value.id);
    return {
        id: id === undefined ? undefined : Math.round(id),
        name: String(value.name || '').trim() || '未命名图层',
        kind: String(value.kind || '').trim(),
        visible: value.visible !== false,
        contents: normalizeVisibleCopyText(
            value.contents ?? value.content ?? value.text ?? value.textContent
        ) || undefined,
        bounds
    };
}

function collectReadbackVisualLayersFromValue(value: unknown, depth = 0): ReadbackVisualLayer[] {
    if (depth > 5 || value === null || value === undefined) return [];
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectReadbackVisualLayersFromValue(item, depth + 1));
    }
    if (!isParamRecord(value)) return [];

    const directLayer = normalizeReadbackVisualLayer(value);
    const layers: ReadbackVisualLayer[] = directLayer ? [directLayer] : [];
    for (const key of ['hierarchy', 'layers', 'children']) {
        const child = value[key];
        if (Array.isArray(child)) {
            layers.push(...collectReadbackVisualLayersFromValue(child, depth + 1));
        }
    }
    const data = value.data;
    if (isParamRecord(data)) {
        layers.push(...collectReadbackVisualLayersFromValue(data, depth + 1));
    }
    return layers;
}

function isReadbackTextLayer(layer: ReadbackVisualLayer): boolean {
    return /text/i.test(layer.kind);
}

function isReadbackImageLayer(layer: ReadbackVisualLayer): boolean {
    return /smart\s*object|smartObject|placed|image/i.test(layer.kind);
}

function normalizeVisibleCopyText(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function pushUniqueVisibleCopy(output: string[], value: unknown): void {
    const text = normalizeVisibleCopyText(value);
    if (!text || output.includes(text)) return;
    output.push(text);
}

function collectExpectedVisibleCopyTexts(
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[]
): string[] {
    const output: string[] = [];
    for (const operation of operationRequests) {
        const params = isParamRecord(operation.params) ? operation.params : {};
        if (operation.toolName === 'createTextLayer' || operation.toolName === 'setTextContent') {
            pushUniqueVisibleCopy(output, params.content ?? params.text);
            continue;
        }
        if (operation.toolName !== 'renderLayout') continue;
        const blocks = Array.isArray(params.blocks) ? params.blocks : [];
        for (const block of blocks) {
            if (!isParamRecord(block) || !isRenderLayoutVisibleCopyRole(block.role)) continue;
            pushUniqueVisibleCopy(output, block.content);
        }
    }
    return output;
}

function collectObservedVisibleCopyTextsFromValue(value: unknown, output: string[], depth = 0): void {
    if (depth > 7 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
        value.forEach((item) => collectObservedVisibleCopyTextsFromValue(item, output, depth + 1));
        return;
    }
    if (!isParamRecord(value)) return;

    const layerKind = String(value.kind || value.type || '').trim();
    const looksLikeTextLayer = /text/i.test(layerKind)
        || value.contents !== undefined
        || value.textContent !== undefined;
    if (looksLikeTextLayer && value.visible !== false) {
        pushUniqueVisibleCopy(
            output,
            value.contents ?? value.content ?? value.text ?? value.textContent
        );
    }

    for (const key of ['hierarchy', 'layers', 'children', 'textLayers']) {
        collectObservedVisibleCopyTextsFromValue(value[key], output, depth + 1);
    }
    collectObservedVisibleCopyTextsFromValue(value.data, output, depth + 1);
    collectObservedVisibleCopyTextsFromValue(value.summary, output, depth + 1);
    collectObservedVisibleCopyTextsFromValue(value.textLayerReadback, output, depth + 1);
}

function collectObservedVisibleCopyTexts(
    readbackResults: AgentTaskPublicPlanControlledReadbackResult[]
): string[] {
    const output: string[] = [];
    for (const result of readbackResults) {
        if (!result.success) continue;
        collectObservedVisibleCopyTextsFromValue(result.data, output);
    }
    return output;
}

function visibleCopyIsObserved(expected: string, observedTexts: string[]): boolean {
    return observedTexts.some((observed) =>
        observed === expected
        || observed.includes(expected)
        || expected.includes(observed)
    );
}

function collectMissingExpectedVisibleCopyBlockers(
    observationDiff: AgentTaskPublicPlanObservationDiff
): string[] {
    if (observationDiff.status !== 'mismatch') return [];
    if (observationDiff.observedVisibleCopy.length === 0) {
        return ['最终观察没有读到任何可见文字，不能证明计划中的标题或卖点仍在画面中。'];
    }
    return observationDiff.missingVisibleCopy
        .slice(0, 8)
        .map((expected) => `最终观察缺少计划中的可见文案「${expected}」，画面可能被用户或后续操作改动。`);
}

function buildVisibleCopyObservationDiff(
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[],
    readbackResults: AgentTaskPublicPlanControlledReadbackResult[]
): AgentTaskPublicPlanObservationDiff {
    const expectedVisibleCopy = collectExpectedVisibleCopyTexts(operationRequests);
    if (expectedVisibleCopy.length === 0) {
        return {
            version: 'agent-task-public-plan-observation-diff/v0',
            status: 'not_applicable',
            expectedVisibleCopy: [],
            observedVisibleCopy: [],
            missingVisibleCopy: [],
            nextAction: 'continue',
            userVisibleSummary: '本次计划没有可对照的可见文字。'
        };
    }
    const observedVisibleCopy = collectObservedVisibleCopyTexts(readbackResults);
    const missingVisibleCopy = expectedVisibleCopy.filter((expected) =>
        !visibleCopyIsObserved(expected, observedVisibleCopy)
    );
    if (missingVisibleCopy.length === 0) {
        return {
            version: 'agent-task-public-plan-observation-diff/v0',
            status: 'matched',
            expectedVisibleCopy,
            observedVisibleCopy,
            missingVisibleCopy: [],
            nextAction: 'continue',
            userVisibleSummary: '最终观察已看到计划中的可见文字。'
        };
    }
    return {
        version: 'agent-task-public-plan-observation-diff/v0',
        status: 'mismatch',
        expectedVisibleCopy,
        observedVisibleCopy,
        missingVisibleCopy,
        nextAction: observedVisibleCopy.length === 0 ? 'observe_again' : 'repair_missing_visible_copy',
        userVisibleSummary: `最终观察缺少 ${missingVisibleCopy.length} 段计划文案：${missingVisibleCopy.slice(0, 5).join('、')}。`
    };
}

function collectReadbackTextImageCollisionBlockers(
    readbackResults: AgentTaskPublicPlanControlledReadbackResult[]
): string[] {
    const layers = readbackResults
        .filter((result) => result.success && ['layer_hierarchy', 'acceptance_snapshot'].includes(result.target))
        .flatMap((result) => collectReadbackVisualLayersFromValue(result.data));
    if (layers.length === 0) return [];

    const textLayers = layers.filter((layer) => layer.visible && isReadbackTextLayer(layer));
    const imageLayers = layers.filter((layer) => layer.visible && isReadbackImageLayer(layer));
    const blockers: string[] = [];

    for (const textLayer of textLayers) {
        const textArea = rectArea(textLayer.bounds);
        if (textArea <= 0) continue;
        for (const imageLayer of imageLayers) {
            const intersection = rectIntersectionArea(textLayer.bounds, imageLayer.bounds);
            const overlapRatio = intersection / textArea;
            if (overlapRatio >= 0.25) {
                blockers.push(
                    `读回验收发现文字层「${textLayer.name}」与图片层「${imageLayer.name}」重叠 ${Math.round(overlapRatio * 100)}%，画面文字和图片压在一起。`
                );
                if (blockers.length >= 5) return blockers;
            }
        }
    }
    return blockers;
}

function collectResolvedRenderLayoutVisibleBlocks(
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[],
    fallbackCanvas: { width: number; height: number } | null
): Array<{ operationId: string; block: ResolvedBlock }> {
    const visibleBlocks: Array<{ operationId: string; block: ResolvedBlock }> = [];
    operationRequests.forEach((operation, operationIndex) => {
        if (operation.toolName !== 'renderLayout' || !isParamRecord(operation.params)) return;
        const canvas = normalizeCanvasSize(operation.params.canvas) ?? fallbackCanvas;
        const rawBlocks = Array.isArray(operation.params.blocks) ? operation.params.blocks : [];
        const blocks = rawBlocks
            .map((block, index) => normalizeLayoutBlock(block, index))
            .filter((block): block is LayoutBlock => Boolean(block));
        if (!canvas || blocks.length === 0) return;
        const resolved = solveLayout({ canvas, blocks });
        resolved.blocks.forEach((block) => {
            if (isRenderLayoutVisibleCopyRole(block.role)) {
                visibleBlocks.push({
                    operationId: operation.operationId || `renderLayout-${operationIndex + 1}`,
                    block
                });
            }
        });
    });
    return visibleBlocks;
}

function collectPlaceImageTextOverlapBlockers(
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[],
    canvasSize: { width: number; height: number } | null
): string[] {
    const imageOperations = operationRequests.filter((operation) => operation.toolName === 'placeImage');
    const visibleTextBlocks = collectResolvedRenderLayoutVisibleBlocks(operationRequests, canvasSize);
    if (imageOperations.length === 0 || visibleTextBlocks.length === 0) return [];
    const blockers: string[] = [];
    imageOperations.forEach((operation, index) => {
        const params = isParamRecord(operation.params) ? operation.params : {};
        const targetBounds = normalizeTargetBounds(params.targetBounds);
        if (!targetBounds) return;
        const imageArea = rectArea(targetBounds);
        if (imageArea <= 0) return;
        for (const item of visibleTextBlocks) {
            const textBounds = resolvedBlockToBounds(item.block);
            const textArea = rectArea(textBounds);
            const intersection = rectIntersectionArea(targetBounds, textBounds);
            const overlapRatio = textArea > 0 ? intersection / Math.min(imageArea, textArea) : 0;
            if (overlapRatio >= 0.12) {
                blockers.push(
                    `placeImage operation ${operation.operationId || index + 1} 的 targetBounds 与 renderLayout block ${item.operationId}/${item.block.id} 可见文案区域重叠 ${Math.round(overlapRatio * 100)}%，会导致图片和文字压在一起。`
                );
                break;
            }
        }
    });
    return blockers;
}

function resolvePlaceImagePlacementKey(params: Record<string, unknown>): string | null {
    const targetBounds = normalizeTargetBounds(params.targetBounds);
    if (targetBounds) {
        return `bounds:${targetBounds.left},${targetBounds.top},${targetBounds.width},${targetBounds.height}`;
    }
    const x = readFiniteNumber(params.x);
    const y = readFiniteNumber(params.y);
    if (x !== undefined && y !== undefined) {
        return `point:${Math.round(x)},${Math.round(y)}`;
    }
    return null;
}

function collectPlaceImagePlacementBlockers(
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[]
): string[] {
    const imageOperations = operationRequests.filter((operation) => operation.toolName === 'placeImage');
    const blockers: string[] = [];
    const seen = new Set<string>();
    const canvasSize = resolvePublicPlanCanvasSize(operationRequests);
    const hasRenderLayout = operationRequests.some((operation) => operation.toolName === 'renderLayout');
    imageOperations.forEach((operation, index) => {
        const params = isParamRecord(operation.params) ? operation.params : {};
        const placementKey = resolvePlaceImagePlacementKey(params);
        const targetBounds = normalizeTargetBounds(params.targetBounds);
        if (imageOperations.length > 1 && !placementKey) {
            blockers.push(`placeImage operation ${operation.operationId || index + 1} 缺少 targetBounds 或明确 x/y，多张图片会默认重叠。`);
            return;
        }
        if (placementKey && seen.has(placementKey)) {
            blockers.push(`placeImage operation ${operation.operationId || index + 1} 的位置与其它图片重复，多张图片会重叠。`);
        }
        if (placementKey) seen.add(placementKey);
        if (targetBounds && canvasSize) {
            const right = targetBounds.left + targetBounds.width;
            const bottom = targetBounds.top + targetBounds.height;
            if (targetBounds.left < 0 || targetBounds.top < 0 || right > canvasSize.width || bottom > canvasSize.height) {
                blockers.push(
                    `placeImage operation ${operation.operationId || index + 1} 的 targetBounds 超出画布 ${canvasSize.width}x${canvasSize.height}（来源 ${canvasSize.source}），会导出到画布外。`
                );
            }
        }
        if (hasRenderLayout) {
            const layerOrder = typeof params.layerOrder === 'string' ? params.layerOrder.trim() : '';
            if (layerOrder !== 'belowText') {
                blockers.push(
                    `placeImage operation ${operation.operationId || index + 1} 缺少 layerOrder="belowText"，图片和 renderLayout 可见文案同时存在时必须避免图片遮挡文字。`
                );
            }
        }
    });
    if (hasRenderLayout) {
        blockers.push(...collectPlaceImageTextOverlapBlockers(operationRequests, canvasSize));
    }
    return blockers;
}

export function collectAgentTaskPublicPlanOperationParamBlockers(
    operationRequests?: AgentTaskPublicPlanControlledOperationRequest[]
): string[] {
    if (!Array.isArray(operationRequests)) return ['live public-plan runner 需要可回放的 operation 参数。'];
    const blockers: string[] = [];
    operationRequests.forEach((operation, index) => {
        if (!isParamRecord(operation.params)) {
            blockers.push(`operation ${operation.toolName || index + 1} 缺少可回放 params，不能从 paramsSummary 推断 Photoshop 写入参数。`);
            return;
        }
        if (operation.toolName === 'renderLayout') {
            const blocks = operation.params.blocks;
            if (!Array.isArray(blocks) || blocks.length === 0) {
                blockers.push('renderLayout 需要 params.blocks 至少包含可执行的版面模块，不能只提供 canvas 或摘要。');
            } else {
                blockers.push(...collectRenderLayoutCanvasBlockers(operation, operationRequests));
                blockers.push(...collectRenderLayoutVisibleCopyBlockers(operation, blocks));
            }
        }
    });
    blockers.push(...collectPlaceImagePlacementBlockers(operationRequests));
    return blockers;
}

function collectOperationParamBlockers(request?: AgentTaskPublicPlanExecutionRequest): string[] {
    if (!request) return ['live public-plan runner 需要可回放的 operation 参数。'];
    return collectAgentTaskPublicPlanOperationParamBlockers(request.operationRequests);
}

function resolvePublicPlanExecutionState(
    status: AgentTaskPublicPlanControlledRunnerStatus
): AgentResumeControlledExecutionRun['executionState'] {
    if (status === 'completed_dry_run') return 'dry_run';
    if (status === 'completed_fake_adapter_verified' || status === 'completed_live_adapter_verified') {
        return 'completed';
    }
    if (status === 'failed_write_operation' || status === 'failed_readback') return 'failed';
    return 'not_started';
}

function resolvePublicPlanVerificationStatus(
    status: AgentTaskPublicPlanControlledRunnerStatus,
    readbackResults: AgentTaskPublicPlanControlledReadbackResult[]
): AgentResumeControlledExecutionRun['verificationStatus'] {
    if (status === 'failed_readback') return 'failed';
    if ((status === 'completed_fake_adapter_verified' || status === 'completed_live_adapter_verified')
        && readbackResults.length > 0
        && readbackResults.every((result) => result.success)) {
        return 'passed';
    }
    return 'not_run';
}

function buildExecutedPublicPlanRun(input: {
    request: AgentTaskPublicPlanExecutionRequest;
    target: AgentTaskPublicPlanControlledRunnerTarget;
    liveExecutionScope: AgentTaskPublicPlanLiveExecutionScope;
    explicitProjectWriteApproval?: boolean;
    status: AgentTaskPublicPlanControlledRunnerStatus;
    operationResults: AgentTaskPublicPlanControlledOperationResult[];
    readbackResults: AgentTaskPublicPlanControlledReadbackResult[];
    observationDiff?: AgentTaskPublicPlanObservationDiff;
    blockers?: string[];
    warnings?: string[];
}): AgentTaskPublicPlanControlledRun {
    const liveAttempt = input.target === 'live-photoshop';
    const completedWriteTools = normalizeStringList(
        input.operationResults
            .filter((result) => result.success)
            .map((result) => result.toolName)
    );
    return {
        version: 'agent-task-public-plan-controlled-runner/v0',
        status: input.status,
        requestId: input.request.requestId,
        requestStatus: input.request.status,
        executionTarget: input.target,
        liveExecutionScope: input.liveExecutionScope,
        explicitProjectWriteApproval: input.explicitProjectWriteApproval === true,
        requiresLiveExecutionScope: input.target === 'live-photoshop',
        requiresExplicitProjectWriteApproval: input.liveExecutionScope === 'explicit-project-document',
        fakeAdapterOnly: input.target === 'fake-adapter',
        executionState: resolvePublicPlanExecutionState(input.status),
        verificationStatus: resolvePublicPlanVerificationStatus(input.status, input.readbackResults),
        writesPerformed: input.target === 'live-photoshop' && completedWriteTools.length > 0,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: liveAttempt,
        mustNotRunWriteTools: !liveAttempt,
        mustNotClaimTaskCompletion: true,
        plannedWriteTools: normalizeStringList(input.request.operationRequests.map((operation) => operation.toolName)),
        executedWriteTools: completedWriteTools,
        readbackTargets: normalizeStringList(input.request.readbackTargets),
        operationRequests: input.request.operationRequests,
        operationResults: input.operationResults,
        readbackResults: input.readbackResults,
        observationDiff: input.observationDiff,
        publicPlanSummary: input.request.publicPlanSummary,
        executionPlanSummary: input.request.executionPlanSummary,
        dryRun: false,
        blockers: input.blockers || [],
        warnings: [
            ...input.request.warnings,
            ...(input.warnings || [])
        ]
    };
}

export function runAgentTaskPublicPlanControlledRunner(
    input: AgentTaskPublicPlanControlledRunnerInput
): AgentTaskPublicPlanControlledRun {
    const target = resolveExecutionTarget(input);
    const liveExecutionScope = resolveLiveExecutionScope(input, target);

    if (target === 'live-photoshop' && input.allowPhotoshopWrites === true) {
        if (liveExecutionScope === 'not_applicable') {
            return buildBlockedPublicPlanRun({
                request: input.request,
                target,
                liveExecutionScope,
                explicitProjectWriteApproval: input.explicitProjectWriteApproval,
                status: 'blocked_live_execution_scope_required',
                blockers: ['live Photoshop runner 需要明确 liveExecutionScope=disposable-document 或 explicit-project-document，不能只凭写入授权修改当前项目文档。'],
                warnings: ['没有一次性文档或明确项目文档授权时，不调用 live adapter。']
            });
        }

        if (liveExecutionScope === 'explicit-project-document' && input.explicitProjectWriteApproval !== true) {
            return buildBlockedPublicPlanRun({
                request: input.request,
                target,
                liveExecutionScope,
                explicitProjectWriteApproval: input.explicitProjectWriteApproval,
                status: 'blocked_live_project_write_approval_required',
                blockers: ['explicit-project-document live scope 需要 explicitProjectWriteApproval=true，不能由公开计划确认按钮自动授权真实项目文档写入。'],
                warnings: ['项目文档写入必须有独立授权；建议优先使用 disposable-document 验证。']
            });
        }
    }

    const operationParamBlockers = target === 'live-photoshop'
        && input.allowPhotoshopWrites === true
        && input.adapter
        && typeof input.adapter.runWriteOperation === 'function'
        ? collectOperationParamBlockers(input.request)
        : [];
    if (operationParamBlockers.length > 0) {
        return buildBlockedPublicPlanRun({
            request: input.request,
            target,
            liveExecutionScope,
            explicitProjectWriteApproval: input.explicitProjectWriteApproval,
            status: 'blocked_live_operation_params_required',
            blockers: operationParamBlockers,
            warnings: ['缺少可回放 params 时不调用 live adapter。']
        });
    }

    const resumeRun = runAgentResumeControlledExecutionRunner({
        request: input.request ? toResumeRequest(input.request) : undefined,
        executionTarget: target,
        allowPhotoshopWrites: input.allowPhotoshopWrites,
        adapter: toResumeAdapter(input.adapter)
    });

    return buildPublicPlanRun({
        request: input.request,
        target,
        liveExecutionScope,
        explicitProjectWriteApproval: input.explicitProjectWriteApproval,
        resumeRun
    });
}

export async function runAgentTaskPublicPlanControlledRunnerAsync(
    input: AgentTaskPublicPlanControlledAsyncRunnerInput
): Promise<AgentTaskPublicPlanControlledRun> {
    const target = resolveExecutionTarget(input);
    const liveExecutionScope = resolveLiveExecutionScope(input, target);

    if (target === 'dry-run') {
        return runAgentTaskPublicPlanControlledRunner({
            request: input.request,
            executionTarget: input.executionTarget,
            allowPhotoshopWrites: input.allowPhotoshopWrites,
            liveExecutionScope: input.liveExecutionScope,
            explicitProjectWriteApproval: input.explicitProjectWriteApproval
        });
    }

    if (target === 'live-photoshop') {
        if (input.allowPhotoshopWrites !== true) {
            return buildBlockedPublicPlanRun({
                request: input.request,
                target,
                liveExecutionScope,
                explicitProjectWriteApproval: input.explicitProjectWriteApproval,
                status: 'blocked_live_write_permission_missing',
                blockers: ['live Photoshop runner 需要 allowPhotoshopWrites=true，不能由公开计划确认按钮自动授权真实写入。'],
                warnings: ['没有显式 live 写入授权时，不调用 live adapter。']
            });
        }

        if (liveExecutionScope === 'not_applicable') {
            return buildBlockedPublicPlanRun({
                request: input.request,
                target,
                liveExecutionScope,
                explicitProjectWriteApproval: input.explicitProjectWriteApproval,
                status: 'blocked_live_execution_scope_required',
                blockers: ['live Photoshop runner 需要明确 liveExecutionScope=disposable-document 或 explicit-project-document，不能只凭写入授权修改当前项目文档。'],
                warnings: ['没有一次性文档或明确项目文档授权时，不调用 live adapter。']
            });
        }

        if (liveExecutionScope === 'explicit-project-document' && input.explicitProjectWriteApproval !== true) {
            return buildBlockedPublicPlanRun({
                request: input.request,
                target,
                liveExecutionScope,
                explicitProjectWriteApproval: input.explicitProjectWriteApproval,
                status: 'blocked_live_project_write_approval_required',
                blockers: ['explicit-project-document live scope 需要 explicitProjectWriteApproval=true，不能由公开计划确认按钮自动授权真实项目文档写入。'],
                warnings: ['项目文档写入必须有独立授权；建议优先使用 disposable-document 验证。']
            });
        }
    }

    const requestReady = input.request?.status === 'ready_for_controlled_execution_request'
        && input.request.canStartControlledRunner === true;
    if (!input.request || !requestReady) {
        return buildBlockedPublicPlanRun({
            request: input.request,
            target,
            liveExecutionScope,
            explicitProjectWriteApproval: input.explicitProjectWriteApproval,
            status: 'blocked_request_not_ready',
            blockers: input.request?.blockers?.length
                ? [...input.request.blockers]
                : ['公开计划受控执行请求尚未 ready，不能进入 adapter。'],
            warnings: input.request?.warnings
        });
    }

    if (!input.adapter || typeof input.adapter.runWriteOperation !== 'function') {
        return buildBlockedPublicPlanRun({
            request: input.request,
            target,
            liveExecutionScope,
            explicitProjectWriteApproval: input.explicitProjectWriteApproval,
            status: target === 'live-photoshop' ? 'blocked_live_adapter_required' : 'blocked_adapter_required',
            blockers: [target === 'live-photoshop'
                ? 'live public-plan runner 需要注入受控 Photoshop adapter，不能从 UI 确认按钮直接执行。'
                : 'public-plan runner 需要注入受控 adapter。'],
            warnings: ['adapter 缺失时不执行写入。']
        });
    }

    const operationParamBlockers = target === 'live-photoshop'
        ? collectOperationParamBlockers(input.request)
        : [];
    if (operationParamBlockers.length > 0) {
        return buildBlockedPublicPlanRun({
            request: input.request,
            target,
            liveExecutionScope,
            explicitProjectWriteApproval: input.explicitProjectWriteApproval,
            status: 'blocked_live_operation_params_required',
            blockers: operationParamBlockers,
            warnings: ['缺少可回放 params 时不调用 live adapter。']
        });
    }

    if (hasReadbackTargets(input.request) && typeof input.adapter.readbackAfterOperation !== 'function') {
        return buildBlockedPublicPlanRun({
            request: input.request,
            target,
            liveExecutionScope,
            explicitProjectWriteApproval: input.explicitProjectWriteApproval,
            status: 'blocked_readback_adapter_required',
            blockers: ['受控执行要求每次写入后读回；adapter 缺少 readbackAfterOperation。'],
            warnings: ['缺少读回 adapter 时不执行写入。']
        });
    }

    const operationResults: AgentTaskPublicPlanControlledOperationResult[] = [];
    const readbackResults: AgentTaskPublicPlanControlledReadbackResult[] = [];

    for (const operation of input.request.operationRequests) {
        let writeResult: AgentTaskPublicPlanControlledAdapterResult;
        try {
            writeResult = await input.adapter.runWriteOperation(operation);
        } catch (error) {
            writeResult = {
                success: false,
                error: error instanceof Error ? error.message : String(error || 'unknown async write failure')
            };
        }

        const operationResult: AgentTaskPublicPlanControlledOperationResult = {
            operationId: operation.operationId,
            toolName: operation.toolName,
            success: writeResult?.success === true,
            error: writeResult?.error,
            data: sanitizeAgentResumePlanningValue(writeResult?.data)
        };
        operationResults.push(operationResult);

        if (!operationResult.success) {
            return buildExecutedPublicPlanRun({
                request: input.request,
                target,
                liveExecutionScope,
                explicitProjectWriteApproval: input.explicitProjectWriteApproval,
                status: 'failed_write_operation',
                operationResults,
                readbackResults,
                blockers: [`写入操作失败：${operation.toolName}`],
                warnings: ['写入失败后已停止后续 public-plan operation。']
            });
        }

        for (const readbackTarget of operation.readbackTargets) {
            let readbackResult: AgentTaskPublicPlanControlledAdapterResult;
            try {
                readbackResult = await input.adapter.readbackAfterOperation!(operation, readbackTarget);
            } catch (error) {
                readbackResult = {
                    success: false,
                    error: error instanceof Error ? error.message : String(error || 'unknown async readback failure')
                };
            }

            const normalizedReadback: AgentTaskPublicPlanControlledReadbackResult = {
                operationId: operation.operationId,
                toolName: operation.toolName,
                target: readbackTarget,
                success: readbackResult?.success === true,
                error: readbackResult?.error,
                data: sanitizeAgentResumePlanningValue(readbackResult?.data)
            };
            readbackResults.push(normalizedReadback);

            if (!normalizedReadback.success) {
                return buildExecutedPublicPlanRun({
                    request: input.request,
                    target,
                    liveExecutionScope,
                    explicitProjectWriteApproval: input.explicitProjectWriteApproval,
                    status: 'failed_readback',
                    operationResults,
                    readbackResults,
                    blockers: [`写入后读回失败：${operation.toolName}/${readbackTarget}`],
                    warnings: ['读回失败后已停止后续 public-plan operation。']
                });
            }
        }
    }

    const observationDiff = target === 'live-photoshop'
        ? buildVisibleCopyObservationDiff(input.request.operationRequests, readbackResults)
        : undefined;
    const readbackStructureBlockers = target === 'live-photoshop'
        ? [
            ...collectReadbackTextImageCollisionBlockers(readbackResults),
            ...(observationDiff ? collectMissingExpectedVisibleCopyBlockers(observationDiff) : [])
        ]
        : [];
    if (readbackStructureBlockers.length > 0) {
        return buildExecutedPublicPlanRun({
            request: input.request,
            target,
            liveExecutionScope,
            explicitProjectWriteApproval: input.explicitProjectWriteApproval,
            status: 'failed_readback',
            operationResults,
            readbackResults,
            observationDiff,
            blockers: readbackStructureBlockers,
            warnings: ['写入后最终观察未通过：需要重新观察并修复差异，不能把该画面当作可验收成品。']
        });
    }

    return buildExecutedPublicPlanRun({
        request: input.request,
        target,
        liveExecutionScope,
        explicitProjectWriteApproval: input.explicitProjectWriteApproval,
        status: target === 'live-photoshop' ? 'completed_live_adapter_verified' : 'completed_fake_adapter_verified',
        operationResults,
        readbackResults,
        observationDiff
    });
}

export function stripRuntimeParamsFromPublicPlanControlledRun(
    run?: AgentTaskPublicPlanControlledRun
): AgentTaskPublicPlanControlledRun | undefined {
    if (!run) return undefined;
    return {
        ...run,
        operationRequests: run.operationRequests.map((operation) => ({
            operationId: operation.operationId,
            toolName: operation.toolName,
            paramsSummary: operation.paramsSummary,
            readbackTargets: [...operation.readbackTargets]
        }))
    };
}
