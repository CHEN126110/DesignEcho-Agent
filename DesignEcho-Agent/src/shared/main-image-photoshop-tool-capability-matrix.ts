import type { VerificationCheck, VerificationReport } from './design-agent-os-contracts';

export type MainImagePhotoshopToolCapabilityId =
    | 'transform-move-positioning'
    | 'nested-group-authoring'
    | 'group-scoped-export';

export type MainImagePhotoshopToolCapabilityStatus =
    | 'supported'
    | 'blocked';

export interface MainImagePhotoshopToolCapability {
    id: MainImagePhotoshopToolCapabilityId;
    status: MainImagePhotoshopToolCapabilityStatus;
    requiredToolNames: string[];
    availableToolNames: string[];
    missingToolNames: string[];
    executionSemantics: string[];
    blockers: string[];
    warnings: string[];
    boundary: string;
}

export interface MainImagePhotoshopToolCapabilityMatrixInput {
    availableToolNames?: string[];
}

export interface MainImagePhotoshopToolCapabilityMatrix {
    version: 'main-image-photoshop-tool-capability-matrix/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    capabilities: MainImagePhotoshopToolCapability[];
    supportedCapabilityIds: MainImagePhotoshopToolCapabilityId[];
    blockedCapabilityIds: MainImagePhotoshopToolCapabilityId[];
    noPhotoshopWrites: true;
    canClaimOutputQuality: false;
    blockers: string[];
    warnings: string[];
    verificationReport: VerificationReport;
}

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function hasAllTools(available: Set<string>, requiredToolNames: string[]): boolean {
    return requiredToolNames.every((toolName) => available.has(toolName));
}

function makeCapability(input: {
    id: MainImagePhotoshopToolCapabilityId;
    requiredToolNames: string[];
    available: Set<string>;
    executionSemantics: string[];
    unsupportedReason?: string;
    warnings?: string[];
}): MainImagePhotoshopToolCapability {
    const availableToolNames = input.requiredToolNames.filter((toolName) => input.available.has(toolName));
    const missingToolNames = input.requiredToolNames.filter((toolName) => !input.available.has(toolName));
    const toolReady = hasAllTools(input.available, input.requiredToolNames);
    const blocked = !toolReady || Boolean(input.unsupportedReason);
    const blockers: string[] = [];
    if (!toolReady) {
        blockers.push(`missing_tools=${missingToolNames.join(',')}`);
    }
    if (input.unsupportedReason) {
        blockers.push(input.unsupportedReason);
    }

    return {
        id: input.id,
        status: blocked ? 'blocked' : 'supported',
        requiredToolNames: input.requiredToolNames,
        availableToolNames,
        missingToolNames,
        executionSemantics: input.executionSemantics,
        blockers,
        warnings: input.warnings || [],
        boundary: 'Capability matrix is a static no-write declaration; live Photoshop execution still requires a separate runner and readback.'
    };
}

function buildChecks(capabilities: MainImagePhotoshopToolCapability[]): VerificationCheck[] {
    return capabilities.map((capability) => ({
        id: capability.id,
        label: capability.id,
        status: capability.status === 'supported' ? 'passed' : 'failed',
        summary: capability.status === 'supported'
            ? `supported by ${capability.availableToolNames.join(',')}`
            : `blocked: ${capability.blockers.join('; ')}`
    }));
}

export function buildMainImagePhotoshopToolCapabilityMatrix(
    input: MainImagePhotoshopToolCapabilityMatrixInput
): MainImagePhotoshopToolCapabilityMatrix {
    const availableToolNames = cleanStrings(input.availableToolNames);
    const available = new Set(availableToolNames);
    const capabilities: MainImagePhotoshopToolCapability[] = [
        makeCapability({
            id: 'transform-move-positioning',
            requiredToolNames: ['transformLayer', 'moveLayer', 'getLayerProperties'],
            available,
            executionSemantics: [
                'transformLayer applies scale or rotation to the active/target layer.',
                'moveLayer supports absolute x/y positioning and returns post-move bounds plus visibility checks.',
                'live runner must read back actual bounds after transform and after move.'
            ]
        }),
        makeCapability({
            id: 'nested-group-authoring',
            requiredToolNames: ['createGroup', 'moveLayerToGroup'],
            available,
            executionSemantics: [
                'createGroup can create top-level empty groups or group selected layer ids.',
                'moveLayerToGroup moves an existing layer or child group into a target Photoshop group via PLACEINSIDE semantics.',
                'child group authoring should create the child group first, then move it under the verified parent group and read back getLayerHierarchy.'
            ]
        }),
        makeCapability({
            id: 'group-scoped-export',
            requiredToolNames: ['exportGroup'],
            available,
            executionSemantics: [
                'exportGroup exports a specified Photoshop groupPath or layerId to a PNG outputPath.',
                'exportGroup uses a temporary document isolation flow so the source document visibility is not changed.',
                'live runner must verify output file existence and exported dimensions after execution.'
            ]
        })
    ];
    const supportedCapabilityIds = capabilities
        .filter((capability) => capability.status === 'supported')
        .map((capability) => capability.id);
    const blockedCapabilityIds = capabilities
        .filter((capability) => capability.status === 'blocked')
        .map((capability) => capability.id);
    const blockers = Array.from(new Set(capabilities.flatMap((capability) => (
        capability.blockers.map((blocker) => `${capability.id}:${blocker}`)
    ))));
    const warnings = Array.from(new Set(capabilities.flatMap((capability) => capability.warnings)));
    return {
        version: 'main-image-photoshop-tool-capability-matrix/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        capabilities,
        supportedCapabilityIds,
        blockedCapabilityIds,
        noPhotoshopWrites: true,
        canClaimOutputQuality: false,
        blockers,
        warnings,
        verificationReport: {
            reportId: 'main-image-photoshop-tool-capability-matrix',
            scenario: 'main-image',
            status: blockedCapabilityIds.length === 0 ? 'passed' : 'failed',
            scope: 'task',
            summary: '静态工具能力矩阵用于决定 live adapter 能否进入真实 Photoshop runner。',
            checks: buildChecks(capabilities),
            blockers,
            warnings,
            limitations: [
                '工具能力矩阵不执行 Photoshop。',
                'supported 只代表工具语义足以生成 adapter 操作序列，不代表已经生成设计结果。',
                'blocked 能力必须先补真实 UXP 工具语义或显式降级策略，不能只靠 prompt 掩盖能力缺口。'
            ]
        }
    };
}
