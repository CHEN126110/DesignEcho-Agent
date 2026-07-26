export type MainImageLiveAdapterHandoffStatus =
    | 'blocked_missing_adapter_contract'
    | 'blocked_adapter_contract_not_ready'
    | 'blocked_missing_toolchain_check'
    | 'blocked_toolchain_not_validated'
    | 'blocked_toolchain_cleanup_not_safe'
    | 'ready_for_guarded_adapter_handoff';

export interface MainImageLiveAdapterContractLike {
    version?: string;
    status?: string;
    requestedOperationCount?: number;
    mappedOperationCount?: number;
    blockedOperationCount?: number;
    operationCount?: number;
    requiredToolNames?: string[];
    missingToolNames?: string[];
    readbackTools?: string[];
    mappings?: unknown[];
    canCreateAdapter?: boolean;
    canWritePhotoshop?: boolean;
    requiresDisposableDocument?: boolean;
    requiresExplicitLiveApproval?: boolean;
    blockers?: string[];
    warnings?: string[];
    limitations?: string[];
    sourceNotes?: Array<{
        source?: string;
        summary?: string;
        status?: string;
    }>;
}

export interface MainImageUxpToolchainCheck {
    source?: string;
    mode?: string;
    success?: boolean;
    preflightReady?: boolean;
    assertionCount?: number;
    failedAssertions?: string[];
    exportedPath?: string;
    exportFileExists?: boolean;
    cleanup?: {
        closed?: boolean;
        restoredOriginal?: boolean;
        disposableStillOpen?: boolean;
        errors?: string[];
    };
    requiredToolNames?: string[];
    missingToolNames?: string[];
}

export interface MainImageLiveAdapterHandoffInput {
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainCheck?: MainImageUxpToolchainCheck | null;
}

export interface MainImageLiveAdapterHandoff {
    version: 'main-image-live-adapter-handoff/v0';
    skillId: 'main-image-design';
    scene: 'design-skill-main-image';
    status: MainImageLiveAdapterHandoffStatus;
    canWireAdapter: boolean;
    canRunProduction: false;
    canWritePhotoshop: false;
    requiresDisposableDocument: true;
    requiresExplicitLiveApproval: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    operationSummary: {
        operationCount: number;
        mappedOperationCount: number;
        blockedOperationCount: number;
        mappingCount: number;
    };
    toolchainSummary: {
        source: string;
        mode: string;
        preflightReady: boolean;
        assertionCount: number;
        failedAssertionCount: number;
        exportFileExists: boolean;
        cleanupClosed: boolean;
        cleanupRestoredOriginal: boolean;
        disposableStillOpen: boolean;
    };
    requiredToolNames: string[];
    missingToolNames: string[];
    readbackTools: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

const READY_ADAPTER_CONTRACT_STATUS = 'ready_for_disposable_photoshop_adapter';

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

function readNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getOperationCount(contract: MainImageLiveAdapterContractLike | null | undefined): number {
    if (!contract) return 0;
    const requestedOperationCount = readNumber(contract.requestedOperationCount);
    if (requestedOperationCount > 0) return requestedOperationCount;
    return readNumber(contract.operationCount);
}

function getToolchainFailedAssertions(toolchainCheck: MainImageUxpToolchainCheck | null | undefined): string[] {
    return cleanStrings(toolchainCheck?.failedAssertions);
}

function getMissingToolNames(input: {
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainCheck?: MainImageUxpToolchainCheck | null;
}): string[] {
    return Array.from(new Set([
        ...cleanStrings(input.adapterContract?.missingToolNames),
        ...cleanStrings(input.toolchainCheck?.missingToolNames)
    ]));
}

function getRequiredToolNames(input: {
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainCheck?: MainImageUxpToolchainCheck | null;
}): string[] {
    return Array.from(new Set([
        ...cleanStrings(input.adapterContract?.requiredToolNames),
        ...cleanStrings(input.toolchainCheck?.requiredToolNames)
    ]));
}

function isAdapterContractReady(adapterContract: MainImageLiveAdapterContractLike): boolean {
    return adapterContract.status === READY_ADAPTER_CONTRACT_STATUS
        && adapterContract.canCreateAdapter === true
        && adapterContract.canWritePhotoshop !== true
        && adapterContract.requiresDisposableDocument === true
        && adapterContract.requiresExplicitLiveApproval === true
        && cleanStrings(adapterContract.missingToolNames).length === 0;
}

function isToolchainCheckPassed(toolchainCheck: MainImageUxpToolchainCheck): boolean {
    return toolchainCheck.success === true
        && toolchainCheck.preflightReady === true
        && readNumber(toolchainCheck.assertionCount) > 0
        && getToolchainFailedAssertions(toolchainCheck).length === 0
        && cleanStrings(toolchainCheck.missingToolNames).length === 0
        && toolchainCheck.exportFileExists === true;
}

function isCleanupSafe(toolchainCheck: MainImageUxpToolchainCheck): boolean {
    return toolchainCheck.cleanup?.closed === true
        && toolchainCheck.cleanup?.restoredOriginal === true
        && toolchainCheck.cleanup?.disposableStillOpen === false
        && cleanStrings(toolchainCheck.cleanup?.errors).length === 0;
}

function buildToolchainSummary(
    toolchainCheck: MainImageUxpToolchainCheck | null | undefined
): MainImageLiveAdapterHandoff['toolchainSummary'] {
    return {
        source: cleanString(toolchainCheck?.source) || 'unknown',
        mode: cleanString(toolchainCheck?.mode) || 'unknown',
        preflightReady: toolchainCheck?.preflightReady === true,
        assertionCount: readNumber(toolchainCheck?.assertionCount),
        failedAssertionCount: getToolchainFailedAssertions(toolchainCheck).length,
        exportFileExists: toolchainCheck?.exportFileExists === true,
        cleanupClosed: toolchainCheck?.cleanup?.closed === true,
        cleanupRestoredOriginal: toolchainCheck?.cleanup?.restoredOriginal === true,
        disposableStillOpen: toolchainCheck?.cleanup?.disposableStillOpen === true
    };
}

function buildOperationSummary(
    adapterContract: MainImageLiveAdapterContractLike | null | undefined
): MainImageLiveAdapterHandoff['operationSummary'] {
    return {
        operationCount: getOperationCount(adapterContract),
        mappedOperationCount: readNumber(adapterContract?.mappedOperationCount),
        blockedOperationCount: readNumber(adapterContract?.blockedOperationCount),
        mappingCount: Array.isArray(adapterContract?.mappings) ? adapterContract.mappings.length : 0
    };
}

function makeHandoff(input: {
    status: MainImageLiveAdapterHandoffStatus;
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainCheck?: MainImageUxpToolchainCheck | null;
    blockers?: string[];
    warnings?: string[];
    limitations?: string[];
}): MainImageLiveAdapterHandoff {
    const canWireAdapter = input.status === 'ready_for_guarded_adapter_handoff';
    const adapterContract = input.adapterContract;
    const toolchainCheck = input.toolchainCheck;

    return {
        version: 'main-image-live-adapter-handoff/v0',
        skillId: 'main-image-design',
        scene: 'design-skill-main-image',
        status: input.status,
        canWireAdapter,
        canRunProduction: false,
        canWritePhotoshop: false,
        requiresDisposableDocument: true,
        requiresExplicitLiveApproval: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        operationSummary: buildOperationSummary(adapterContract),
        toolchainSummary: buildToolchainSummary(toolchainCheck),
        requiredToolNames: getRequiredToolNames({ adapterContract, toolchainCheck }),
        missingToolNames: getMissingToolNames({ adapterContract, toolchainCheck }),
        readbackTools: cleanStrings(adapterContract?.readbackTools),
        blockers: input.blockers || [],
        warnings: [
            ...cleanStrings(adapterContract?.warnings),
            ...(input.warnings || [])
        ],
        limitations: [
            'main-image live adapter handoff 只判断是否允许后续接入真实 adapter，不执行 Photoshop。',
            'ready_for_guarded_adapter_handoff 不等于设计完成，也不等于视觉质量通过。',
            '真实 adapter 仍必须限制在 disposable document、显式 live approval、逐步 readback 和最终验收快照内。',
            ...(input.limitations || []),
            ...cleanStrings(adapterContract?.limitations)
        ]
    };
}

export function buildMainImageLiveAdapterHandoff(
    input: MainImageLiveAdapterHandoffInput = {}
): MainImageLiveAdapterHandoff {
    const adapterContract = input.adapterContract || null;
    const toolchainCheck = input.toolchainCheck || null;

    if (!adapterContract) {
        return makeHandoff({
            status: 'blocked_missing_adapter_contract',
            blockers: ['缺少 live Photoshop adapter contract，不能接入真实 adapter。']
        });
    }

    if (!isAdapterContractReady(adapterContract)) {
        return makeHandoff({
            status: 'blocked_adapter_contract_not_ready',
            adapterContract,
            toolchainCheck,
            blockers: [
                `live Photoshop adapter contract 未就绪：${cleanString(adapterContract.status) || 'unknown'}`,
                ...cleanStrings(adapterContract.blockers),
                ...getMissingToolNames({ adapterContract, toolchainCheck }).map((toolName) => `缺少工具能力：${toolName}`)
            ]
        });
    }

    if (!toolchainCheck) {
        return makeHandoff({
            status: 'blocked_missing_toolchain_check',
            adapterContract,
            blockers: ['缺少 disposable UXP toolchain 运行检查，不能接入真实 adapter。']
        });
    }

    if (!isToolchainCheckPassed(toolchainCheck)) {
        return makeHandoff({
            status: 'blocked_toolchain_not_validated',
            adapterContract,
            toolchainCheck,
            blockers: [
                'disposable UXP toolchain 运行检查未通过或结果不完整。',
                ...getToolchainFailedAssertions(toolchainCheck),
                ...getMissingToolNames({ adapterContract, toolchainCheck }).map((toolName) => `缺少工具能力：${toolName}`)
            ]
        });
    }

    if (!isCleanupSafe(toolchainCheck)) {
        return makeHandoff({
            status: 'blocked_toolchain_cleanup_not_safe',
            adapterContract,
            toolchainCheck,
            blockers: [
                'AGENT-141 disposable UXP toolchain live smoke 清理或原文档恢复不安全。',
                ...cleanStrings(toolchainCheck.cleanup?.errors)
            ]
        });
    }

    return makeHandoff({
        status: 'ready_for_guarded_adapter_handoff',
        adapterContract,
        toolchainCheck,
        warnings: [
            '下一步只能接入 guarded adapter，仍不能默认运行生产文档写入。'
        ]
    });
}
