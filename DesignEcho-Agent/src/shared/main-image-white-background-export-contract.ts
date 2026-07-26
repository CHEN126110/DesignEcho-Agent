import { MAIN_IMAGE_WHITE_BACKGROUND_SPEC } from './main-image-design-core';

export const MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID = 'main-image.white-bg-from-sku-material';

export type MainImageWhiteBackgroundSourceAssetKind =
    | 'project-sku-material'
    | 'selected-project-image'
    | 'active-document'
    | 'unknown';

export type MainImageWhiteBackgroundOutputDirPolicy =
    | 'project-main-image-dir'
    | 'explicit-output-dir'
    | 'unknown';

export type MainImageWhiteBackgroundExportContractStatus =
    | 'not_applicable'
    | 'ready_strategy_only_contract'
    | 'ready_live_execution_contract'
    | 'blocked_live_execution_not_approved';

export interface MainImageWhiteBackgroundIntentDefaultsInput {
    userIntent?: unknown;
    params?: Record<string, unknown>;
}

export interface BuildMainImageWhiteBackgroundExportContractInput {
    userIntent?: unknown;
    imageType?: unknown;
    sourceAssetKind?: unknown;
    outputDirPolicy?: unknown;
    outputDir?: unknown;
    projectPath?: unknown;
    preferredSkuColor?: unknown;
    mainImageExecutionMode?: unknown;
    approvedLiveExecution?: unknown;
    approvedLiveAdapterRun?: unknown;
}

export interface MainImageWhiteBackgroundExportContract {
    version: 'main-image-white-background-export-contract/v0';
    capabilityId: typeof MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID;
    skillId: 'main-image-design';
    status: MainImageWhiteBackgroundExportContractStatus;
    imageType: 'white-bg';
    source: {
        kind: MainImageWhiteBackgroundSourceAssetKind;
        relativeDocumentPath: string;
        projectPath?: string;
        preferredSkuColor?: string;
        sourcePolicy: string;
    };
    exportTarget: {
        policy: MainImageWhiteBackgroundOutputDirPolicy;
        relativePath: string;
        outputDir?: string;
        folderRole: 'main-image-output';
    };
    canvasSize: {
        width: 800;
        height: 800;
    };
    subjectPolicy: {
        targetSubjectHeightPx: 760;
        totalHorizontalMarginPx: 40;
        rules: string[];
    };
    toolContract: {
        requiredToolCapabilities: string[];
        executionBoundary: string;
        readbackTargets: string[];
    };
    photoshopWriteAllowed: boolean;
    requiredChecks: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface MainImageWhiteBackgroundLiveToolRequest {
    version: 'main-image-white-background-live-tool-request/v0';
    capabilityId: typeof MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID;
    skillId: 'main-image-design';
    status:
        | 'ready'
        | 'blocked_missing_contract'
        | 'blocked_contract_not_ready'
        | 'blocked_missing_project_path';
    toolName: 'exportWhiteBgFromSkuMaterial';
    canExecute: boolean;
    params: {
        sourceDocumentPath: string;
        outputPath: string;
        preferredLayerName?: string;
        canvasWidth: 800;
        canvasHeight: 800;
        targetSubjectHeightPx: 760;
        horizontalMarginPx: 40;
        jpegQuality: 12;
    };
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePathForTool(value: string): string {
    return cleanString(value).replace(/\\/g, '/').replace(/\/+/g, '/');
}

function joinProjectRelativePath(projectPath: string, relativePath: string): string {
    const root = normalizePathForTool(projectPath).replace(/\/+$/g, '');
    const child = normalizePathForTool(relativePath).replace(/^\/+/g, '');
    if (!root || !child) return '';
    return `${root}/${child}`;
}

function normalizeImageType(value: unknown): string {
    return cleanString(value).toLowerCase();
}

function hasWhiteBackgroundSignal(value: unknown): boolean {
    return /白底图|自底图|白底|white[-\s]?bg|white background/i.test(cleanString(value));
}

function hasSkuSourceSignal(value: unknown): boolean {
    return /sku/i.test(cleanString(value));
}

function normalizeSourceAssetKind(value: unknown): MainImageWhiteBackgroundSourceAssetKind {
    const text = cleanString(value).toLowerCase();
    if (text === 'project-sku-material') return 'project-sku-material';
    if (text === 'selected-project-image') return 'selected-project-image';
    if (text === 'active-document') return 'active-document';
    return 'unknown';
}

function normalizeOutputDirPolicy(value: unknown): MainImageWhiteBackgroundOutputDirPolicy {
    const text = cleanString(value).toLowerCase();
    if (text === 'project-main-image-dir') return 'project-main-image-dir';
    if (text === 'explicit-output-dir') return 'explicit-output-dir';
    return 'unknown';
}

function normalizeExecutionMode(value: unknown): string {
    const text = cleanString(value).toLowerCase();
    if (text === 'product-disposable-live' || text === 'legacy-active-document') return text;
    return 'strategy-only';
}

function isWhiteBackgroundRequest(input: {
    userIntent?: unknown;
    imageType?: unknown;
    mainImageCapability?: unknown;
}): boolean {
    if (cleanString(input.mainImageCapability) === MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID) return true;
    if (normalizeImageType(input.imageType) === 'white-bg') return true;
    return hasWhiteBackgroundSignal(input.userIntent);
}

export function resolveMainImageWhiteBackgroundIntentDefaults(
    input: MainImageWhiteBackgroundIntentDefaultsInput
): Record<string, unknown> {
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const imageType = normalizeImageType(params.imageType);
    const applies = imageType === 'white-bg' || hasWhiteBackgroundSignal(input.userIntent);
    if (!applies) return {};

    const defaults: Record<string, unknown> = {
        mainImageCapability: MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID,
        whiteBackgroundSourceDocumentPath: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.sourceDocumentPath,
        whiteBackgroundOutputRelativePath: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.outputPath
    };

    if (normalizeSourceAssetKind(params.sourceAssetKind) === 'unknown') {
        defaults.sourceAssetKind = 'project-sku-material';
    }

    if (normalizeOutputDirPolicy(params.outputDirPolicy) === 'unknown') {
        defaults.outputDirPolicy = 'project-main-image-dir';
    }

    return defaults;
}

export function isMainImageWhiteBackgroundFromSkuMaterialRequest(input: {
    userIntent?: unknown;
    imageType?: unknown;
    sourceAssetKind?: unknown;
    mainImageCapability?: unknown;
}): boolean {
    if (!isWhiteBackgroundRequest(input)) return false;
    const sourceKind = normalizeSourceAssetKind(input.sourceAssetKind);
    if (sourceKind === 'project-sku-material') return true;
    return hasSkuSourceSignal(input.userIntent);
}

function buildStatus(input: {
    applies: boolean;
    mainImageExecutionMode: string;
    photoshopWriteAllowed: boolean;
}): MainImageWhiteBackgroundExportContractStatus {
    if (!input.applies) return 'not_applicable';
    if (input.mainImageExecutionMode === 'strategy-only') return 'ready_strategy_only_contract';
    return input.photoshopWriteAllowed
        ? 'ready_live_execution_contract'
        : 'blocked_live_execution_not_approved';
}

export function buildMainImageWhiteBackgroundExportContract(
    input: BuildMainImageWhiteBackgroundExportContractInput
): MainImageWhiteBackgroundExportContract {
    const applies = isWhiteBackgroundRequest(input);
    const sourceKind = normalizeSourceAssetKind(input.sourceAssetKind) === 'unknown'
        ? 'project-sku-material'
        : normalizeSourceAssetKind(input.sourceAssetKind);
    const outputPolicy = normalizeOutputDirPolicy(input.outputDirPolicy) === 'unknown'
        ? 'project-main-image-dir'
        : normalizeOutputDirPolicy(input.outputDirPolicy);
    const mainImageExecutionMode = normalizeExecutionMode(input.mainImageExecutionMode);
    const photoshopWriteAllowed = mainImageExecutionMode !== 'strategy-only'
        && input.approvedLiveExecution === true
        && input.approvedLiveAdapterRun === true;
    const status = buildStatus({ applies, mainImageExecutionMode, photoshopWriteAllowed });
    const projectPath = cleanString(input.projectPath);
    const outputDir = cleanString(input.outputDir);
    const preferredSkuColor = cleanString(input.preferredSkuColor);

    return {
        version: 'main-image-white-background-export-contract/v0',
        capabilityId: MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID,
        skillId: 'main-image-design',
        status,
        imageType: 'white-bg',
        source: {
            kind: sourceKind,
            relativeDocumentPath: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.sourceDocumentPath,
            ...(projectPath ? { projectPath } : {}),
            ...(preferredSkuColor ? { preferredSkuColor } : {}),
            sourcePolicy: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.sourcePolicy
        },
        exportTarget: {
            policy: outputPolicy,
            relativePath: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.outputPath,
            ...(outputDir ? { outputDir } : {}),
            folderRole: 'main-image-output'
        },
        canvasSize: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.canvasSize,
        subjectPolicy: {
            targetSubjectHeightPx: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.targetSubjectHeightPx,
            totalHorizontalMarginPx: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.totalHorizontalMarginPx,
            rules: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.rules
        },
        toolContract: {
            requiredToolCapabilities: [
                'exportWhiteBgFromSkuMaterial',
                'locateProjectSkuDocument',
                'selectSkuColorOrFirstValidSkuSource',
                'composeCleanWhiteBackgroundCanvas',
                'exportWhiteBackgroundImageToProjectMainImageDir',
                'readBackExportFile'
            ],
            executionBoundary: mainImageExecutionMode === 'strategy-only'
                ? 'strategy-only：只生成工具契约和交付边界，不写 Photoshop。'
                : 'live：必须显式批准后才能写入 Photoshop，并且写入后要读回导出文件。',
            readbackTargets: [
                MAIN_IMAGE_WHITE_BACKGROUND_SPEC.sourceDocumentPath,
                MAIN_IMAGE_WHITE_BACKGROUND_SPEC.outputPath
            ]
        },
        photoshopWriteAllowed,
        requiredChecks: [
            'project_context',
            'project_sku_document',
            'white_background_export_target',
            'readback_or_export_result'
        ],
        blockers: status === 'blocked_live_execution_not_approved'
            ? ['approved_live_execution_required', 'approved_live_adapter_run_required']
            : [],
        warnings: sourceKind === 'project-sku-material'
            ? []
            : ['white_background_export_source_is_not_project_sku_material'],
        limitations: [
            '该契约只定义白底图生产工具边界，不声明设计质量已通过。',
            '白底图导出不等于 SKU 组合图或自选备注任务。',
            '真实写入必须由 main-image 受控 live 工具链执行，不能由聊天回复伪装完成。'
        ]
    };
}

export function buildMainImageWhiteBackgroundLiveToolRequest(
    contract?: MainImageWhiteBackgroundExportContract | null
): MainImageWhiteBackgroundLiveToolRequest {
    const projectPath = cleanString(contract?.source.projectPath);
    const sourceDocumentPath = joinProjectRelativePath(projectPath, contract?.source.relativeDocumentPath || '');
    const outputPath = contract?.exportTarget.policy === 'explicit-output-dir'
        ? joinProjectRelativePath(contract.exportTarget.outputDir || projectPath, contract.exportTarget.relativePath)
        : joinProjectRelativePath(projectPath, contract?.exportTarget.relativePath || '');
    const blockers: string[] = [];
    let status: MainImageWhiteBackgroundLiveToolRequest['status'] = 'ready';

    if (!contract) {
        status = 'blocked_missing_contract';
        blockers.push('main_image_white_background_export_contract_required');
    } else if (contract.status !== 'ready_live_execution_contract' || contract.photoshopWriteAllowed !== true) {
        status = 'blocked_contract_not_ready';
        blockers.push('main_image_white_background_contract_must_be_ready_live_execution');
        blockers.push(...contract.blockers);
    } else if (!projectPath) {
        status = 'blocked_missing_project_path';
        blockers.push('project_path_required_for_white_background_export');
    }

    return {
        version: 'main-image-white-background-live-tool-request/v0',
        capabilityId: MAIN_IMAGE_WHITE_BG_FROM_SKU_CAPABILITY_ID,
        skillId: 'main-image-design',
        status,
        toolName: 'exportWhiteBgFromSkuMaterial',
        canExecute: status === 'ready',
        params: {
            sourceDocumentPath,
            outputPath,
            ...(contract?.source.preferredSkuColor ? { preferredLayerName: contract.source.preferredSkuColor } : {}),
            canvasWidth: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.canvasSize.width,
            canvasHeight: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.canvasSize.height,
            targetSubjectHeightPx: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.targetSubjectHeightPx,
            horizontalMarginPx: MAIN_IMAGE_WHITE_BACKGROUND_SPEC.totalHorizontalMarginPx,
            jpegQuality: 12
        },
        blockers: Array.from(new Set(blockers.map(cleanString).filter(Boolean))),
        warnings: contract?.warnings || [],
        limitations: [
            '该请求只允许调用白底图专用工具，不代表通用主图设计质量完成。',
            '工具执行后必须读回导出文件，不能只依赖 Photoshop 调用成功。',
            '如果 SKU 源图层不明确，应由工具返回阻断信息，而不是猜测商品颜色。'
        ]
    };
}
