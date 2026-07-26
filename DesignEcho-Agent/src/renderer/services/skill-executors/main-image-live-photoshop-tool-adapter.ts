import type {
    MainImageLiveExecutorAdapter,
    MainImageLiveExecutorAdapterOperationResult,
    MainImageLiveExecutorAdapterReadbackResult
} from '../../../shared/main-image-live-executor-runner';
import type {
    MainImageLiveExecutorOperationRequest
} from '../../../shared/main-image-live-executor-request';
import type {
    MainImageLivePhotoshopAdapterContract,
    MainImageLivePhotoshopToolMapping
} from '../../../shared/main-image-live-photoshop-adapter-contract';

export type MainImageLivePhotoshopToolAdapterStatus =
    | 'blocked_missing_adapter_contract'
    | 'blocked_adapter_contract_not_ready'
    | 'blocked_requires_explicit_live_approval'
    | 'blocked_non_disposable_scope'
    | 'blocked_missing_execute_tool'
    | 'ready_for_guarded_live_adapter';

export type MainImageLivePhotoshopExecuteTool = (
    toolName: string,
    params: Record<string, unknown>
) => Promise<unknown> | unknown;

export interface MainImageLivePhotoshopToolAdapterInput {
    adapterContract?: MainImageLivePhotoshopAdapterContract | null;
    executeTool?: MainImageLivePhotoshopExecuteTool | null;
    approvedLiveAdapterRun?: boolean;
    executionScope?: 'disposable-document' | 'active-document' | 'project-document';
}

export interface MainImageLivePhotoshopToolAdapterBuildResult {
    version: 'main-image-live-photoshop-tool-adapter/v0';
    status: MainImageLivePhotoshopToolAdapterStatus;
    canRunGuardedLiveAdapter: boolean;
    canWritePhotoshop: boolean;
    canRunProduction: false;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    adapter: MainImageLiveExecutorAdapter | null;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

interface ToolCallResult {
    toolName: string;
    params: Record<string, unknown>;
    result: unknown;
    success: boolean;
    error?: string;
}

interface AdapterRuntimeState {
    lastLayerId?: number;
    lastGroupId?: number;
    groupIdsByPath: Map<string, number>;
}

const READY_CONTRACT_STATUS = 'ready_for_disposable_photoshop_adapter';

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function readRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | undefined {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return undefined;
    return normalized;
}

function readPositiveId(value: unknown): number | undefined {
    const normalized = readNumber(value);
    if (normalized === undefined || normalized <= 0) return undefined;
    return Math.round(normalized);
}

function getGroupPathKey(value: unknown): string {
    return cleanStrings(value).join('/');
}

function getRequestGroupPathKey(request: MainImageLiveExecutorOperationRequest): string {
    return getGroupPathKey(request.groupPath || request.payloadPreview?.groupPath);
}

function extractLayerId(result: unknown): number | undefined {
    const record = readRecord(result);
    const candidates = [
        record.layerId,
        record.id,
        readRecord(record.layer).id,
        readRecord(record.group).id,
        readRecord(record.document).activeLayerId,
        readRecord(record.data).layerId,
        readRecord(record.data).id
    ];

    for (const candidate of candidates) {
        const id = readPositiveId(candidate);
        if (id !== undefined) return id;
    }
    return undefined;
}

function extractDocumentId(result: unknown): number | undefined {
    const record = readRecord(result);
    const candidates = [
        record.documentId,
        record.id,
        readRecord(record.document).id,
        readRecord(record.data).documentId,
        readRecord(record.data).id
    ];

    for (const candidate of candidates) {
        const id = readPositiveId(candidate);
        if (id !== undefined) return id;
    }
    return undefined;
}

function normalizeDocumentNameForCompare(value: unknown): string {
    return cleanString(value)
        .replace(/\.(psd|psb)$/i, '')
        .toLowerCase();
}

function documentNameMatches(expected: unknown, actual: unknown): boolean {
    const expectedName = normalizeDocumentNameForCompare(expected);
    const actualName = normalizeDocumentNameForCompare(actual);
    if (!expectedName || !actualName) return true;
    return expectedName === actualName
        || actualName.startsWith(`${expectedName} `)
        || actualName.startsWith(`${expectedName}-`)
        || actualName.startsWith(`${expectedName}_`);
}

function extractResultDocumentRecord(result: unknown): Record<string, unknown> {
    const record = readRecord(result);
    const document = readRecord(record.document);
    const dataDocument = readRecord(readRecord(record.data).document);
    return {
        ...dataDocument,
        ...document,
        ...record
    };
}

function buildCreateDocumentResultMismatch(input: {
    request: MainImageLiveExecutorOperationRequest;
    params: Record<string, unknown>;
    result: unknown;
}): string {
    const expectedName = cleanString(input.params.name) || cleanString(input.request.documentName);
    const expectedWidth = readNumber(input.params.width);
    const expectedHeight = readNumber(input.params.height);
    const actual = extractResultDocumentRecord(input.result);
    const actualName = cleanString(actual.name);
    const actualWidth = readNumber(actual.width);
    const actualHeight = readNumber(actual.height);
    const blockers: string[] = [];

    if (expectedName && actualName && !documentNameMatches(expectedName, actualName)) {
        blockers.push(`documentName expected=${expectedName} actual=${actualName}`);
    }
    if (expectedWidth !== undefined && actualWidth !== undefined && Math.round(expectedWidth) !== Math.round(actualWidth)) {
        blockers.push(`width expected=${expectedWidth} actual=${actualWidth}`);
    }
    if (expectedHeight !== undefined && actualHeight !== undefined && Math.round(expectedHeight) !== Math.round(actualHeight)) {
        blockers.push(`height expected=${expectedHeight} actual=${actualHeight}`);
    }

    return blockers.join('; ');
}

function isToolSuccess(result: unknown): boolean {
    const record = readRecord(result);
    return record.success !== false;
}

function extractToolError(result: unknown): string | undefined {
    const record = readRecord(result);
    return cleanString(record.error) || cleanString(record.message) || undefined;
}

function replaceRuntimePlaceholders(
    value: unknown,
    state: AdapterRuntimeState
): unknown {
    if (typeof value === 'string') {
        if (value === 'created_group_id_from_createGroup_result') return state.lastGroupId;
        if (value === 'layerId_from_transform_target') return state.lastLayerId;
        if (value === 'layerId_from_previous_placeImage_or_active_layer') return state.lastLayerId;
        if (value === 'previous_placeImage_result_or_active_layer') return state.lastLayerId;
        if (value.startsWith('parent_group_id_from_path:')) {
            const pathKey = value.slice('parent_group_id_from_path:'.length);
            return state.groupIdsByPath.get(pathKey);
        }
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => replaceRuntimePlaceholders(item, state));
    }

    if (!value || typeof value !== 'object') return value;

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        output[key] = replaceRuntimePlaceholders(item, state);
    }
    return output;
}

function getOperationSequence(
    mapping: MainImageLivePhotoshopToolMapping
): Array<{ toolName: string; params: Record<string, unknown> }> {
    const sequence = mapping.paramsPreview.operationSequence;
    if (!Array.isArray(sequence)) {
        return [{
            toolName: mapping.mappedToolName || mapping.mappedToolNames[0] || mapping.sourceTool,
            params: { ...mapping.paramsPreview }
        }];
    }

    return sequence.map((step) => {
        const record = readRecord(step);
        return {
            toolName: cleanString(record.toolName),
            params: readRecord(record.params)
        };
    }).filter((step) => Boolean(step.toolName));
}

function updateStateAfterToolCall(input: {
    state: AdapterRuntimeState;
    request: MainImageLiveExecutorOperationRequest;
    toolName: string;
    result: unknown;
}): void {
    const layerId = extractLayerId(input.result);
    if (layerId !== undefined) {
        input.state.lastLayerId = layerId;
    }

    if (input.toolName === 'createGroup' && layerId !== undefined) {
        input.state.lastGroupId = layerId;
        const pathKey = getRequestGroupPathKey(input.request);
        if (pathKey) input.state.groupIdsByPath.set(pathKey, layerId);
    }

    if (input.toolName === 'createDocument') {
        const documentId = extractDocumentId(input.result);
        if (documentId !== undefined) {
            input.state.lastLayerId = undefined;
            input.state.lastGroupId = undefined;
            input.state.groupIdsByPath.clear();
        }
    }
}

function buildPlaceImageFollowupMove(
    request: MainImageLiveExecutorOperationRequest,
    state: AdapterRuntimeState
): { toolName: string; params: Record<string, unknown> } | null {
    const pathKey = getRequestGroupPathKey(request);
    const targetGroupId = pathKey ? state.groupIdsByPath.get(pathKey) : undefined;
    if (!targetGroupId || !state.lastLayerId) return null;
    return {
        toolName: 'moveLayerToGroup',
        params: {
            layerId: state.lastLayerId,
            targetGroupId,
            position: 'inside-bottom'
        }
    };
}

function normalizeToolParams(
    toolName: string,
    params: Record<string, unknown>,
    state: AdapterRuntimeState
): Record<string, unknown> {
    if (toolName === 'transformLayer') {
        const targetLayerId = readPositiveId(params.targetLayerSource);
        if (targetLayerId !== undefined && readPositiveId(params.layerId) === undefined) {
            const { targetLayerSource, ...rest } = params;
            return {
                ...rest,
                layerId: targetLayerId
            };
        }
    }
    if (toolName === 'exportGroup') {
        const explicitLayerId = readPositiveId(params.layerId);
        const pathKey = getGroupPathKey(params.groupPath);
        const runtimeGroupId = pathKey ? state.groupIdsByPath.get(pathKey) : undefined;
        const layerId = explicitLayerId ?? runtimeGroupId;
        if (layerId !== undefined) {
            const { groupPath, ...rest } = params;
            return {
                ...rest,
                layerId
            };
        }
    }
    return params;
}

async function runToolStep(input: {
    executeTool: MainImageLivePhotoshopExecuteTool;
    request: MainImageLiveExecutorOperationRequest;
    state: AdapterRuntimeState;
    toolName: string;
    params: Record<string, unknown>;
}): Promise<ToolCallResult> {
    const params = normalizeToolParams(
        input.toolName,
        replaceRuntimePlaceholders(input.params, input.state) as Record<string, unknown>,
        input.state
    );
    if (input.toolName === 'moveLayerToGroup') {
        const layerId = readPositiveId(params.layerId);
        const targetGroupId = readPositiveId(params.targetGroupId);
        if (layerId === undefined || targetGroupId === undefined) {
            return {
                toolName: input.toolName,
                params,
                result: {
                    success: false,
                    error: 'moveLayerToGroup_runtime_target_missing',
                    reason: 'layerId and targetGroupId must both come from the current document run before moving a layer into a group.'
                },
                success: false,
                error: 'moveLayerToGroup_runtime_target_missing'
            };
        }
    }
    const result = await input.executeTool(input.toolName, params);
    const success = isToolSuccess(result);
    if (success && input.toolName === 'createDocument') {
        const mismatch = buildCreateDocumentResultMismatch({
            request: input.request,
            params,
            result
        });
        if (mismatch) {
            return {
                toolName: input.toolName,
                params,
                result,
                success: false,
                error: `createDocument_result_mismatch: ${mismatch}`
            };
        }
    }
    if (success) {
        updateStateAfterToolCall({
            state: input.state,
            request: input.request,
            toolName: input.toolName,
            result
        });
    }

    return {
        toolName: input.toolName,
        params,
        result,
        success,
        error: success ? undefined : extractToolError(result)
    };
}

function findMapping(
    contract: MainImageLivePhotoshopAdapterContract,
    request: MainImageLiveExecutorOperationRequest
): MainImageLivePhotoshopToolMapping | undefined {
    const exact = contract.mappings.find((mapping) => mapping.requestId === request.id)
        || contract.mappings.find((mapping) => mapping.requestId === request.requestId);
    if (exact) return exact;

    const sameToolMappings = contract.mappings.filter((mapping) => mapping.sourceTool === request.tool);
    return sameToolMappings.length === 1 ? sameToolMappings[0] : undefined;
}

function makeOperationResult(input: {
    request: MainImageLiveExecutorOperationRequest;
    toolCalls: ToolCallResult[];
}): MainImageLiveExecutorAdapterOperationResult {
    const failed = input.toolCalls.find((call) => !call.success);
    if (failed) {
        return {
            success: false,
            summary: `failed ${failed.toolName} for ${input.request.tool}`,
            error: failed.error || `${failed.toolName}_failed`,
            actualResult: {
                requestId: input.request.requestId,
                toolCalls: input.toolCalls
            }
        };
    }

    return {
        success: true,
        summary: `executed ${input.request.tool} through guarded Photoshop adapter`,
        actualResult: {
            requestId: input.request.requestId,
            toolCalls: input.toolCalls
        }
    };
}

function makeReadbackParams(toolName: string, state: AdapterRuntimeState): Record<string, unknown> {
    if (toolName === 'getLayerProperties') {
        return state.lastLayerId ? { layerId: state.lastLayerId } : {};
    }
    if (toolName === 'getLayerHierarchy') {
        return { includeHidden: true, includeBounds: true, flatList: true };
    }
    if (toolName === 'getAcceptanceSnapshot') {
        return { includeHidden: true, includeBounds: true, includeText: true, maxLayers: 260 };
    }
    return {};
}

function inferStatus(
    input: MainImageLivePhotoshopToolAdapterInput
): MainImageLivePhotoshopToolAdapterStatus {
    if (!input.adapterContract) return 'blocked_missing_adapter_contract';
    if (input.adapterContract.status === 'blocked_non_disposable_scope') {
        return 'blocked_non_disposable_scope';
    }
    if (input.adapterContract.status !== READY_CONTRACT_STATUS || input.adapterContract.canCreateAdapter !== true) {
        return 'blocked_adapter_contract_not_ready';
    }
    if (input.approvedLiveAdapterRun !== true) return 'blocked_requires_explicit_live_approval';
    if (input.executionScope !== 'disposable-document') return 'blocked_non_disposable_scope';
    if (!input.executeTool) return 'blocked_missing_execute_tool';
    return 'ready_for_guarded_live_adapter';
}

function collectBlockers(
    status: MainImageLivePhotoshopToolAdapterStatus,
    input: MainImageLivePhotoshopToolAdapterInput
): string[] {
    const blockers: string[] = [];
    if (status === 'blocked_missing_adapter_contract') blockers.push('main_image_live_adapter_contract_required');
    if (status === 'blocked_adapter_contract_not_ready') {
        blockers.push('main_image_live_adapter_contract_must_be_ready');
        blockers.push(...(input.adapterContract?.blockers || []));
    }
    if (status === 'blocked_requires_explicit_live_approval') blockers.push('explicit_live_adapter_approval_required');
    if (status === 'blocked_non_disposable_scope') blockers.push('guarded_adapter_requires_disposable_document_scope');
    if (status === 'blocked_missing_execute_tool') blockers.push('execute_tool_function_required');
    return cleanStrings(blockers);
}

export function createMainImageLivePhotoshopToolAdapter(
    input: MainImageLivePhotoshopToolAdapterInput
): MainImageLivePhotoshopToolAdapterBuildResult {
    const status = inferStatus(input);
    const canRunGuardedLiveAdapter = status === 'ready_for_guarded_live_adapter';
    const executeTool = input.executeTool;
    const contract = input.adapterContract || null;
    const state: AdapterRuntimeState = {
        groupIdsByPath: new Map()
    };

    let adapter: MainImageLiveExecutorAdapter | null = null;
    if (canRunGuardedLiveAdapter && executeTool && contract) {
        adapter = {
            async executeOperation(request): Promise<MainImageLiveExecutorAdapterOperationResult> {
                const mapping = findMapping(contract, request);
                if (!mapping || mapping.status !== 'mapped') {
                    return {
                        success: false,
                        summary: `adapter mapping missing for ${request.tool}`,
                        error: 'adapter_mapping_missing',
                        actualResult: null
                    };
                }

                const toolCalls: ToolCallResult[] = [];
                for (const step of getOperationSequence(mapping)) {
                    const call = await runToolStep({
                        executeTool,
                        request,
                        state,
                        toolName: step.toolName,
                        params: step.params
                    });
                    toolCalls.push(call);
                    if (!call.success) return makeOperationResult({ request, toolCalls });
                }

                if (request.tool === 'placeImage') {
                    const followup = buildPlaceImageFollowupMove(request, state);
                    if (followup) {
                        const call = await runToolStep({
                            executeTool,
                            request,
                            state,
                            toolName: followup.toolName,
                            params: followup.params
                        });
                        toolCalls.push(call);
                    }
                }

                return makeOperationResult({ request, toolCalls });
            },
            async readbackAfterOperation(request, toolName): Promise<MainImageLiveExecutorAdapterReadbackResult> {
                const result = await executeTool(toolName, makeReadbackParams(toolName, state));
                return {
                    success: isToolSuccess(result),
                    summary: `readback ${toolName} after ${request.tool}`,
                    error: extractToolError(result),
                    data: readRecord(result)
                };
            },
            async captureFinalAcceptanceSnapshot(): Promise<MainImageLiveExecutorAdapterReadbackResult> {
                const result = await executeTool('getAcceptanceSnapshot', makeReadbackParams('getAcceptanceSnapshot', state));
                return {
                    success: isToolSuccess(result),
                    summary: 'final acceptance snapshot captured by guarded adapter',
                    error: extractToolError(result),
                    data: readRecord(result)
                };
            }
        };
    }

    return {
        version: 'main-image-live-photoshop-tool-adapter/v0',
        status,
        canRunGuardedLiveAdapter,
        canWritePhotoshop: canRunGuardedLiveAdapter,
        canRunProduction: false,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        adapter,
        blockers: collectBlockers(status, input),
        warnings: cleanStrings(input.adapterContract?.warnings),
        limitations: [
            'This adapter factory only wires an approved disposable-document runner to Photoshop tools.',
            'It must not be used for production documents by default.',
            'A successful run still requires actual readback, screenshot QA, pixel probe and manual review before any design-quality claim.'
        ]
    };
}
