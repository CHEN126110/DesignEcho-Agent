import type { VerificationCheck, VerificationReport } from './design-agent-os-contracts';
import type { MainImageLiveExecutorCheckpoint } from './main-image-live-executor-checkpoint';
import type { MainImageLiveExecutorOperationRequest } from './main-image-live-executor-request';

export type MainImageLivePhotoshopAdapterContractStatus =
    | 'blocked_missing_checkpoint'
    | 'blocked_checkpoint_not_ready'
    | 'blocked_non_disposable_scope'
    | 'blocked_missing_required_tool'
    | 'blocked_adapter_mapping_gaps'
    | 'ready_for_disposable_photoshop_adapter';

export type MainImageLivePhotoshopAdapterMappingStatus =
    | 'mapped'
    | 'blocked';

export interface MainImageLivePhotoshopAdapterContractInput {
    checkpoint?: MainImageLiveExecutorCheckpoint | null;
    availableToolNames?: string[];
}

export interface MainImageLivePhotoshopToolMapping {
    requestId: string;
    sourceTool: MainImageLiveExecutorOperationRequest['tool'];
    mappedToolName?: string;
    mappedToolNames: string[];
    status: MainImageLivePhotoshopAdapterMappingStatus;
    paramsPreview: Record<string, unknown>;
    requiredRuntimeState: string[];
    blockers: string[];
    warnings: string[];
    boundary: string;
}

export interface MainImageLivePhotoshopAdapterContract {
    version: 'main-image-live-photoshop-adapter-contract/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageLivePhotoshopAdapterContractStatus;
    requestedOperationCount: number;
    mappedOperationCount: number;
    blockedOperationCount: number;
    requiredToolNames: string[];
    missingToolNames: string[];
    mappings: MainImageLivePhotoshopToolMapping[];
    canCreateAdapter: boolean;
    canWritePhotoshop: false;
    requiresDisposableDocument: true;
    requiresExplicitLiveApproval: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    verificationReport: VerificationReport;
}

const REQUIRED_READBACK_TOOLS = [
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function sanitizeUnknown(value: unknown): unknown {
    if (typeof value === 'string') return cleanString(value);
    if (Array.isArray(value)) return value.map(sanitizeUnknown);
    if (!value || typeof value !== 'object') return value;

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        const cleanKey = cleanString(key);
        if (/raw|base64|imageData|binary|buffer/i.test(cleanKey)) {
            sanitized[cleanKey] = '[redacted-payload]';
            continue;
        }
        sanitized[cleanKey] = sanitizeUnknown(item);
    }
    return sanitized;
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
    const sanitized = sanitizeUnknown(value);
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized as Record<string, unknown>
        : {};
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readNumber(value: unknown): number | undefined {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
}

function readCoordinate(value: unknown): number | undefined {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
}

function hasDestinationBox(request: MainImageLiveExecutorOperationRequest): boolean {
    const payload = readRecord(request.payloadPreview);
    return Boolean(payload.destinationBox && typeof payload.destinationBox === 'object');
}

function getDestinationBox(request: MainImageLiveExecutorOperationRequest): Record<string, unknown> {
    const payload = readRecord(request.payloadPreview);
    return readRecord(payload.destinationBox);
}

function readDestinationX(destinationBox: Record<string, unknown>): number | undefined {
    const left = readCoordinate(destinationBox.left);
    if (left !== undefined) return left;
    return readCoordinate(destinationBox.x);
}

function readDestinationY(destinationBox: Record<string, unknown>): number | undefined {
    const top = readCoordinate(destinationBox.top);
    if (top !== undefined) return top;
    return readCoordinate(destinationBox.y);
}

function getGroupPath(request: MainImageLiveExecutorOperationRequest): string[] {
    return cleanStrings(request.groupPath || request.payloadPreview?.groupPath);
}

function getAssetPath(request: MainImageLiveExecutorOperationRequest): string {
    const payload = readRecord(request.payloadPreview);
    const asset = readRecord(payload.asset);
    return cleanString(asset.path) || cleanString(payload.filePath);
}

function getAssetName(request: MainImageLiveExecutorOperationRequest): string {
    const payload = readRecord(request.payloadPreview);
    const asset = readRecord(payload.asset);
    return cleanString(asset.name) || cleanString(payload.name);
}

function buildCreateDocumentParams(request: MainImageLiveExecutorOperationRequest): Record<string, unknown> {
    const payload = readRecord(request.payloadPreview);
    const canvasSize = readRecord(payload.canvasSize);
    return sanitizeRecord({
        name: cleanString(request.documentName) || cleanString(payload.documentName),
        width: readNumber(canvasSize.width),
        height: readNumber(canvasSize.height),
        backgroundColor: 'white'
    });
}

function buildCreateGroupParams(request: MainImageLiveExecutorOperationRequest): Record<string, unknown> {
    const groupPath = getGroupPath(request);
    return sanitizeRecord({
        groupName: groupPath[groupPath.length - 1]
    });
}

function buildNestedCreateGroupParams(request: MainImageLiveExecutorOperationRequest): Record<string, unknown> {
    const groupPath = getGroupPath(request);
    return sanitizeRecord({
        operationSequence: [
            {
                toolName: 'createGroup',
                params: buildCreateGroupParams(request)
            },
            {
                toolName: 'moveLayerToGroup',
                params: {
                    layerId: 'created_group_id_from_createGroup_result',
                    targetGroupId: `parent_group_id_from_path:${groupPath.slice(0, -1).join('/')}`,
                    position: 'inside-bottom'
                }
            }
        ],
        groupPath
    });
}

function buildPlaceImageParams(request: MainImageLiveExecutorOperationRequest): Record<string, unknown> {
    return sanitizeRecord({
        filePath: getAssetPath(request),
        name: getAssetName(request),
        center: true,
        fitToCanvas: false
    });
}

function buildTransformLayerParams(request: MainImageLiveExecutorOperationRequest): Record<string, unknown> {
    const payload = readRecord(request.payloadPreview);
    const destinationBox = getDestinationBox(request);
    const transformParams = sanitizeRecord({
        scaleUniform: readNumber(payload.scalePercent),
        targetLayerSource: 'previous_placeImage_result_or_active_layer'
    });
    if (!hasDestinationBox(request)) {
        return transformParams;
    }

    return sanitizeRecord({
        operationSequence: [
            {
                toolName: 'transformLayer',
                params: transformParams
            },
            {
                toolName: 'moveLayer',
                params: {
                    layerId: 'layerId_from_transform_target',
                    x: readDestinationX(destinationBox),
                    y: readDestinationY(destinationBox),
                    relative: false
                }
            }
        ],
        destinationBox: sanitizeRecord(destinationBox)
    });
}

function sanitizeFileSegment(value: unknown): string {
    const text = cleanString(value);
    return text.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'export';
}

function buildOutputPath(input: {
    outputDir: unknown;
    groupPath: string[];
    exportSpecId: unknown;
}): string {
    const outputDir = cleanString(input.outputDir).replace(/[\\/]+$/g, '');
    if (!outputDir) return '';
    const baseName = sanitizeFileSegment(input.exportSpecId)
        || sanitizeFileSegment(input.groupPath.join('_'));
    return `${outputDir}/${baseName}.png`;
}

function buildExportGroupParams(request: MainImageLiveExecutorOperationRequest): Record<string, unknown> {
    const payload = readRecord(request.payloadPreview);
    const exportSize = readRecord(payload.exportSize);
    const groupPath = getGroupPath(request);
    const targetWidth = readNumber(exportSize.width);
    const targetHeight = readNumber(exportSize.height);
    const outputPath = buildOutputPath({
        outputDir: payload.outputDir,
        groupPath,
        exportSpecId: payload.exportSpecId || request.id
    });

    return sanitizeRecord({
        groupPath,
        outputPath,
        format: 'png',
        targetWidth,
        targetHeight
    });
}

function buildToolNames(request: MainImageLiveExecutorOperationRequest): string[] {
    if (request.tool === 'exportGroup') return ['exportGroup'];
    if (request.tool === 'createGroup' && getGroupPath(request).length > 1) {
        return ['createGroup', 'moveLayerToGroup'];
    }
    if (request.tool === 'transformLayer' && hasDestinationBox(request)) {
        return ['transformLayer', 'moveLayer'];
    }
    return [request.tool];
}

function buildRequiredTools(checkpoint: MainImageLiveExecutorCheckpoint | null | undefined): string[] {
    if (!checkpoint) return [];
    const tools = new Set<string>(REQUIRED_READBACK_TOOLS);
    for (const request of checkpoint.operationRequests) {
        for (const mappedTool of buildToolNames(request)) {
            tools.add(mappedTool);
        }
    }
    return Array.from(tools);
}

function buildMapping(request: MainImageLiveExecutorOperationRequest): MainImageLivePhotoshopToolMapping {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const requiredRuntimeState: string[] = [];
    let mappedToolNames = buildToolNames(request);
    let paramsPreview: Record<string, unknown> = {};

    if (request.tool === 'createDocument') {
        paramsPreview = buildCreateDocumentParams(request);
        if (!readNumber(paramsPreview.width) || !readNumber(paramsPreview.height)) {
            blockers.push('createDocument_requires_canvas_width_and_height');
        }
    } else if (request.tool === 'createGroup') {
        const groupPath = getGroupPath(request);
        paramsPreview = groupPath.length > 1
            ? buildNestedCreateGroupParams(request)
            : buildCreateGroupParams(request);
        if (!paramsPreview.groupName) {
            const sequence = Array.isArray(paramsPreview.operationSequence)
                ? paramsPreview.operationSequence
                : [];
            const firstParams = readRecord(readRecord(sequence[0]).params);
            if (!firstParams.groupName) {
                blockers.push('createGroup_requires_groupName');
            }
        }
        if (groupPath.length > 1) {
            requiredRuntimeState.push('parent_group_id_from_groupPath_readback');
            requiredRuntimeState.push('created_group_id_from_createGroup_result');
        }
    } else if (request.tool === 'placeImage') {
        paramsPreview = buildPlaceImageParams(request);
        requiredRuntimeState.push('created_or_selected_target_group');
        if (!paramsPreview.filePath) {
            blockers.push('placeImage_requires_asset_filePath');
        }
    } else if (request.tool === 'transformLayer') {
        paramsPreview = buildTransformLayerParams(request);
        requiredRuntimeState.push('layerId_from_previous_placeImage_or_active_layer');
        if (!paramsPreview.scaleUniform) {
            const operationSequence = Array.isArray(paramsPreview.operationSequence)
                ? paramsPreview.operationSequence
                : [];
            const transformStep = readRecord(readRecord(operationSequence[0]).params);
            if (!transformStep.scaleUniform) {
                blockers.push('transformLayer_requires_scalePercent');
            }
        }
        if (hasDestinationBox(request)) {
            const destinationBox = getDestinationBox(request);
            requiredRuntimeState.push('actual_bounds_readback_after_transform_before_move');
            if (readDestinationX(destinationBox) === undefined || readDestinationY(destinationBox) === undefined) {
                blockers.push('destinationBox_requires_left_top_or_x_y_for_moveLayer');
            }
            warnings.push('destinationBox is still planned geometry; live runner must read back actualBounds after transform and move.');
        }
    } else if (request.tool === 'exportGroup') {
        paramsPreview = buildExportGroupParams(request);
        if (!paramsPreview.outputPath) {
            blockers.push('exportGroup_requires_full_outputPath');
        }
        const groupPath = Array.isArray(paramsPreview.groupPath)
            ? paramsPreview.groupPath
            : [];
        if (groupPath.length === 0 && !readNumber(paramsPreview.layerId)) {
            blockers.push('exportGroup_requires_groupPath_or_layerId');
        }
        if (!readNumber(paramsPreview.targetWidth) || !readNumber(paramsPreview.targetHeight)) {
            warnings.push('exportGroup has no explicit targetWidth/targetHeight; runner must verify exported PNG size.');
        }
        requiredRuntimeState.push('export_group_path_exists_in_layer_hierarchy');
        requiredRuntimeState.push('export_file_exists_after_run');
    } else {
        blockers.push(`unsupported_live_operation=${request.tool}`);
    }

    return {
        requestId: request.id,
        sourceTool: request.tool,
        mappedToolName: mappedToolNames[0],
        mappedToolNames,
        status: blockers.length === 0 ? 'mapped' : 'blocked',
        paramsPreview,
        requiredRuntimeState,
        blockers,
        warnings,
        boundary: 'adapter contract only; this mapping does not execute Photoshop or prove design quality'
    };
}

function collectBlockers(input: {
    status: MainImageLivePhotoshopAdapterContractStatus;
    checkpoint?: MainImageLiveExecutorCheckpoint | null;
    mappings: MainImageLivePhotoshopToolMapping[];
    missingToolNames: string[];
}): string[] {
    const blockers: string[] = [];
    if (input.status === 'blocked_missing_checkpoint') {
        blockers.push('main_image_live_executor_checkpoint_required');
    }
    if (input.status === 'blocked_checkpoint_not_ready') {
        blockers.push('checkpoint_status_must_be_ready_for_live_executor_run');
    }
    if (input.status === 'blocked_non_disposable_scope') {
        blockers.push('adapter_contract_requires_disposable_document_scope');
    }
    if (input.missingToolNames.length > 0) {
        blockers.push(`missing_photoshop_tools=${input.missingToolNames.join(',')}`);
    }
    for (const mapping of input.mappings) {
        blockers.push(...mapping.blockers.map((item) => `${mapping.sourceTool}:${item}`));
    }
    return Array.from(new Set(blockers.map(cleanString).filter(Boolean)));
}

function collectWarnings(input: {
    checkpoint?: MainImageLiveExecutorCheckpoint | null;
    mappings: MainImageLivePhotoshopToolMapping[];
}): string[] {
    return Array.from(new Set([
        ...(input.checkpoint?.warnings || []),
        ...input.mappings.flatMap((item) => item.warnings)
    ].map(cleanString).filter(Boolean)));
}

function buildChecks(input: {
    status: MainImageLivePhotoshopAdapterContractStatus;
    missingToolNames: string[];
    blockedOperationCount: number;
    mappedOperationCount: number;
}): VerificationCheck[] {
    return [
        {
            id: 'checkpoint-ready',
            label: 'checkpoint 可交接',
            status: input.status === 'blocked_missing_checkpoint' || input.status === 'blocked_checkpoint_not_ready'
                ? 'failed'
                : 'passed',
            summary: `status=${input.status}`
        },
        {
            id: 'registered-tools',
            label: '真实工具能力',
            status: input.missingToolNames.length === 0 ? 'passed' : 'failed',
            summary: `missing=${input.missingToolNames.join(',') || 'none'}`
        },
        {
            id: 'operation-mapping',
            label: '执行请求映射',
            status: input.blockedOperationCount === 0 && input.mappedOperationCount > 0 ? 'passed' : 'failed',
            summary: `mapped=${input.mappedOperationCount}; blocked=${input.blockedOperationCount}`
        },
        {
            id: 'quality-boundary',
            label: '质量声明边界',
            status: 'needs_review',
            summary: 'adapter contract 不执行 Photoshop，也不能声明主图质量。'
        }
    ];
}

function makeContract(input: {
    status: MainImageLivePhotoshopAdapterContractStatus;
    checkpoint?: MainImageLiveExecutorCheckpoint | null;
    availableToolNames?: string[];
    mappings?: MainImageLivePhotoshopToolMapping[];
}): MainImageLivePhotoshopAdapterContract {
    const mappings = input.mappings || [];
    const requiredToolNames = buildRequiredTools(input.checkpoint);
    const available = new Set(cleanStrings(input.availableToolNames));
    const missingToolNames = requiredToolNames.filter((toolName) => !available.has(toolName));
    const mappedOperationCount = mappings.filter((item) => item.status === 'mapped').length;
    const blockedOperationCount = mappings.filter((item) => item.status === 'blocked').length;
    const blockers = collectBlockers({
        status: input.status,
        checkpoint: input.checkpoint,
        mappings,
        missingToolNames
    });
    const warnings = collectWarnings({
        checkpoint: input.checkpoint,
        mappings
    });
    const reportStatus = input.status === 'ready_for_disposable_photoshop_adapter' ? 'passed' : 'failed';

    return {
        version: 'main-image-live-photoshop-adapter-contract/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        requestedOperationCount: input.checkpoint?.operationCount || 0,
        mappedOperationCount,
        blockedOperationCount,
        requiredToolNames,
        missingToolNames,
        mappings,
        canCreateAdapter: input.status === 'ready_for_disposable_photoshop_adapter',
        canWritePhotoshop: false,
        requiresDisposableDocument: true,
        requiresExplicitLiveApproval: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        blockers,
        warnings,
        limitations: [
            '本 contract 只验证 dry-run operationRequests 能否映射到真实 Photoshop 工具，不执行 Photoshop。',
            '映射通过也只允许进入 disposable-document live adapter；仍必须由 runner 读回 actualResult 和 acceptance snapshot。',
            '真实主图质量必须等待 actualBounds、截图 / pixel probe、导出文件和人工复核。'
        ],
        verificationReport: {
            reportId: 'main-image-live-photoshop-adapter-contract',
            scenario: 'main-image',
            status: reportStatus,
            scope: 'task',
            summary: input.status === 'ready_for_disposable_photoshop_adapter'
                ? '主图 live Photoshop adapter contract 已可进入 disposable-document adapter 实现。'
                : `主图 live Photoshop adapter contract 被阻断：${input.status}`,
            checks: buildChecks({
                status: input.status,
                missingToolNames,
                blockedOperationCount,
                mappedOperationCount
            }),
            blockers,
            warnings,
            limitations: [
                'adapter contract 不是 Photoshop 执行结果。',
                'adapter contract 不能替代 runner、截图 QA 或人工复核。'
            ]
        }
    };
}

export function buildMainImageLivePhotoshopAdapterContract(
    input: MainImageLivePhotoshopAdapterContractInput
): MainImageLivePhotoshopAdapterContract {
    const checkpoint = input.checkpoint;
    if (!checkpoint) {
        return makeContract({
            status: 'blocked_missing_checkpoint',
            availableToolNames: input.availableToolNames
        });
    }

    if (checkpoint.status !== 'ready_for_live_executor_run' || checkpoint.canStartLiveExecutor !== true) {
        return makeContract({
            status: 'blocked_checkpoint_not_ready',
            checkpoint,
            availableToolNames: input.availableToolNames
        });
    }

    if (checkpoint.runGuard.executionScope !== 'disposable-document') {
        return makeContract({
            status: 'blocked_non_disposable_scope',
            checkpoint,
            availableToolNames: input.availableToolNames
        });
    }

    const mappings = checkpoint.operationRequests.map(buildMapping);
    const requiredToolNames = buildRequiredTools(checkpoint);
    const available = new Set(cleanStrings(input.availableToolNames));
    const missingToolNames = requiredToolNames.filter((toolName) => !available.has(toolName));
    const blockedOperationCount = mappings.filter((item) => item.status === 'blocked').length;
    let status: MainImageLivePhotoshopAdapterContractStatus = 'ready_for_disposable_photoshop_adapter';
    if (missingToolNames.length > 0) {
        status = 'blocked_missing_required_tool';
    } else if (blockedOperationCount > 0) {
        status = 'blocked_adapter_mapping_gaps';
    }

    return makeContract({
        status,
        checkpoint,
        availableToolNames: input.availableToolNames,
        mappings
    });
}
