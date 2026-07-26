import type { VerificationCheck, VerificationReport } from './design-agent-os-contracts';
import type {
    MainImageProductionDocumentPlan,
    MainImageProductionDocumentStructure
} from './main-image-production-document-structure';

export type MainImageGroupHierarchyContractStatus =
    | 'blocked_missing_production_structure'
    | 'blocked_invalid_production_structure'
    | 'blocked_missing_required_tool'
    | 'blocked_missing_hierarchy_semantics'
    | 'blocked_missing_group_export_semantics'
    | 'ready_for_disposable_group_hierarchy_adapter';

export interface MainImageGroupHierarchyToolSemantics {
    createGroupSupportsTopLevel?: boolean;
    createGroupSupportsParentPath?: boolean;
    createGroupSupportsSelectedParent?: boolean;
    moveToGroupToolName?: string;
    groupScopedExportToolName?: string;
}

export interface MainImageGroupHierarchyContractInput {
    productionDocumentStructure?: MainImageProductionDocumentStructure | null;
    availableToolNames?: string[];
    toolSemantics?: MainImageGroupHierarchyToolSemantics;
}

export interface MainImageGroupHierarchyDocumentContract {
    documentId: string;
    documentName: string;
    requiredParentGroups: Array<'点击图' | '转化图'>;
    requiredGroupPaths: string[][];
    exportGroupPaths: string[][];
    childGroupCount: number;
    exportSpecCount: number;
}

export interface MainImageGroupHierarchyContract {
    version: 'main-image-group-hierarchy-contract/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageGroupHierarchyContractStatus;
    documents: MainImageGroupHierarchyDocumentContract[];
    requiredToolNames: string[];
    availableToolNames: string[];
    missingToolNames: string[];
    canCreateTopLevelParentGroups: boolean;
    canCreateChildGroupsUnderParent: boolean;
    canMoveLayersIntoChildGroups: boolean;
    canExportChildGroupsToPath: boolean;
    canCreateAdapter: boolean;
    canWritePhotoshop: false;
    noPhotoshopWrites: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    verificationReport: VerificationReport;
}

const REQUIRED_PARENT_GROUPS = ['点击图', '转化图'] as const;
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

function hasTool(available: Set<string>, toolName: string | undefined): boolean {
    return Boolean(toolName && available.has(toolName));
}

function buildDocumentContract(
    document: MainImageProductionDocumentPlan,
    exportGroupPaths: string[][]
): MainImageGroupHierarchyDocumentContract {
    const requiredGroupPaths: string[][] = [];
    for (const parentGroup of document.parentGroups) {
        for (const childGroup of parentGroup.childGroups) {
            requiredGroupPaths.push([parentGroup.name, childGroup.name]);
        }
    }

    return {
        documentId: cleanString(document.id),
        documentName: cleanString(document.name),
        requiredParentGroups: [...REQUIRED_PARENT_GROUPS],
        requiredGroupPaths,
        exportGroupPaths,
        childGroupCount: requiredGroupPaths.length,
        exportSpecCount: exportGroupPaths.length
    };
}

function hasRequiredParentGroups(document: MainImageProductionDocumentPlan): boolean {
    const names = document.parentGroups.map((group) => group.name);
    return REQUIRED_PARENT_GROUPS.every((name) => names.includes(name));
}

function validateProductionStructure(
    production: MainImageProductionDocumentStructure
): string[] {
    const blockers: string[] = [];
    if (production.status !== 'ready_production_document_structure') {
        blockers.push(`production_structure_status=${production.status}`);
    }
    if (production.documents.length === 0) {
        blockers.push('production_structure_requires_documents');
    }
    for (const document of production.documents) {
        if (!hasRequiredParentGroups(document)) {
            blockers.push(`document_missing_required_parent_groups=${cleanString(document.id) || 'unknown'}`);
        }
    }
    if (production.exportSpecs.some((spec) => spec.groupPath.length !== 2)) {
        blockers.push('export_specs_require_parent_child_group_path');
    }
    return Array.from(new Set(blockers));
}

function buildDocumentContracts(
    production: MainImageProductionDocumentStructure
): MainImageGroupHierarchyDocumentContract[] {
    return production.documents.map((document) => {
        const exportGroupPaths = production.exportSpecs
            .filter((spec) => spec.documentId === document.id)
            .map((spec) => spec.groupPath.map(cleanString).filter(Boolean));
        return buildDocumentContract(document, exportGroupPaths);
    });
}

function buildRequiredTools(input: {
    createGroupReady: boolean;
    canCreateChildGroupsUnderParent: boolean;
    canMoveLayersIntoChildGroups: boolean;
    canExportChildGroupsToPath: boolean;
    moveToGroupToolName?: string;
    groupScopedExportToolName?: string;
}): string[] {
    const tools = new Set<string>();
    tools.add('createGroup');
    if (input.moveToGroupToolName) tools.add(input.moveToGroupToolName);
    if (input.groupScopedExportToolName) tools.add(input.groupScopedExportToolName);
    if (input.canExportChildGroupsToPath) tools.add(input.groupScopedExportToolName || 'exportGroup');
    return Array.from(tools).filter(Boolean);
}

function decideStatus(input: {
    hasProduction: boolean;
    structureBlockers: string[];
    missingToolNames: string[];
    canCreateChildGroupsUnderParent: boolean;
    canMoveLayersIntoChildGroups: boolean;
    canExportChildGroupsToPath: boolean;
}): MainImageGroupHierarchyContractStatus {
    if (!input.hasProduction) return 'blocked_missing_production_structure';
    if (input.structureBlockers.length > 0) return 'blocked_invalid_production_structure';
    if (input.missingToolNames.length > 0) return 'blocked_missing_required_tool';
    if (!input.canCreateChildGroupsUnderParent || !input.canMoveLayersIntoChildGroups) {
        return 'blocked_missing_hierarchy_semantics';
    }
    if (!input.canExportChildGroupsToPath) return 'blocked_missing_group_export_semantics';
    return 'ready_for_disposable_group_hierarchy_adapter';
}

function buildChecks(contract: MainImageGroupHierarchyContract): VerificationCheck[] {
    return [
        {
            id: 'production-structure',
            label: '生产结构',
            status: contract.status === 'blocked_missing_production_structure' || contract.status === 'blocked_invalid_production_structure'
                ? 'failed'
                : 'passed',
            summary: `documents=${contract.documents.length}; blockers=${contract.blockers.join('; ') || 'none'}`
        },
        {
            id: 'parent-child-group-semantics',
            label: '父级组与子组语义',
            status: contract.canCreateChildGroupsUnderParent && contract.canMoveLayersIntoChildGroups ? 'passed' : 'failed',
            summary: `createChildGroups=${contract.canCreateChildGroupsUnderParent}; moveIntoChildGroups=${contract.canMoveLayersIntoChildGroups}`
        },
        {
            id: 'group-export-semantics',
            label: '组级导出语义',
            status: contract.canExportChildGroupsToPath ? 'passed' : 'failed',
            summary: `groupScopedExport=${contract.canExportChildGroupsToPath}`
        },
        {
            id: 'quality-boundary',
            label: '质量声明边界',
            status: 'needs_review',
            summary: 'group hierarchy contract 不执行 Photoshop，也不能声明主图设计质量。'
        }
    ];
}

function buildContract(input: {
    status: MainImageGroupHierarchyContractStatus;
    documents: MainImageGroupHierarchyDocumentContract[];
    requiredToolNames: string[];
    availableToolNames: string[];
    missingToolNames: string[];
    canCreateTopLevelParentGroups: boolean;
    canCreateChildGroupsUnderParent: boolean;
    canMoveLayersIntoChildGroups: boolean;
    canExportChildGroupsToPath: boolean;
    blockers: string[];
    warnings: string[];
}): MainImageGroupHierarchyContract {
    const reportStatus = input.status === 'ready_for_disposable_group_hierarchy_adapter'
        ? 'passed'
        : 'failed';
    const contract: MainImageGroupHierarchyContract = {
        version: 'main-image-group-hierarchy-contract/v0' as const,
        skillId: 'main-image-design' as const,
        scene: 'ecommerce-socks' as const,
        status: input.status,
        documents: input.documents,
        requiredToolNames: input.requiredToolNames,
        availableToolNames: input.availableToolNames,
        missingToolNames: input.missingToolNames,
        canCreateTopLevelParentGroups: input.canCreateTopLevelParentGroups,
        canCreateChildGroupsUnderParent: input.canCreateChildGroupsUnderParent,
        canMoveLayersIntoChildGroups: input.canMoveLayersIntoChildGroups,
        canExportChildGroupsToPath: input.canExportChildGroupsToPath,
        canCreateAdapter: input.status === 'ready_for_disposable_group_hierarchy_adapter',
        canWritePhotoshop: false as const,
        noPhotoshopWrites: true as const,
        canClaimOutputQuality: false as const,
        canClaimDesignComplete: false as const,
        blockers: input.blockers,
        warnings: input.warnings,
        limitations: [
            '本 contract 只验证主图点击图/转化图父级组结构能否映射到真实 Photoshop 层级语义，不执行 Photoshop。',
            '子组创建需要 createGroup 与 moveLayerToGroup 组合，并在执行后读回 layer hierarchy 验证 parentId/path。',
            '图层几何移动仍必须使用 moveLayer；父子层级移动必须使用 moveLayerToGroup，不能混用。',
            '按 groupPath 导出到指定路径必须使用 exportGroup，并在执行后验证文件存在与导出尺寸。'
        ],
        verificationReport: {
            reportId: 'main-image-group-hierarchy-contract',
            scenario: 'main-image' as const,
            status: reportStatus,
            scope: 'task' as const,
            summary: input.status === 'ready_for_disposable_group_hierarchy_adapter'
                ? '主图父级组层级契约已可进入 disposable-document adapter 验证。'
                : `主图父级组层级契约被阻断：${input.status}`,
            checks: [],
            blockers: input.blockers,
            warnings: input.warnings,
            limitations: [
                '契约通过也不等于真实 Photoshop 已执行。',
                '真实主图质量仍需要 actualBounds、截图、导出文件和人工复核。'
            ]
        }
    };
    contract.verificationReport.checks = buildChecks(contract);
    return contract;
}

export function buildMainImageGroupHierarchyContract(
    input: MainImageGroupHierarchyContractInput
): MainImageGroupHierarchyContract {
    const availableToolNames = cleanStrings(input.availableToolNames);
    const available = new Set(availableToolNames);
    const semantics = input.toolSemantics || {};
    const moveToGroupToolName = semantics.moveToGroupToolName || 'moveLayerToGroup';
    const groupScopedExportToolName = semantics.groupScopedExportToolName || 'exportGroup';
    const production = input.productionDocumentStructure || null;
    const documents = production ? buildDocumentContracts(production) : [];
    const structureBlockers = production ? validateProductionStructure(production) : [];
    const createGroupReady = available.has('createGroup') && semantics.createGroupSupportsTopLevel !== false;
    const canCreateChildGroupsUnderParent = createGroupReady && (
        semantics.createGroupSupportsParentPath === true
        || semantics.createGroupSupportsSelectedParent === true
        || hasTool(available, moveToGroupToolName)
    );
    const canMoveLayersIntoChildGroups = hasTool(available, moveToGroupToolName);
    const canExportChildGroupsToPath = hasTool(available, groupScopedExportToolName);
    const requiredToolNames = buildRequiredTools({
        createGroupReady,
        canCreateChildGroupsUnderParent,
        canMoveLayersIntoChildGroups,
        canExportChildGroupsToPath,
        moveToGroupToolName,
        groupScopedExportToolName
    });
    const missingToolNames = requiredToolNames.filter((toolName) => !available.has(toolName));
    const status = decideStatus({
        hasProduction: Boolean(production),
        structureBlockers,
        missingToolNames,
        canCreateChildGroupsUnderParent,
        canMoveLayersIntoChildGroups,
        canExportChildGroupsToPath
    });
    const blockers = [...structureBlockers];
    if (missingToolNames.length > 0) {
        blockers.push(`missing_tools=${missingToolNames.join(',')}`);
    }
    if (!canCreateChildGroupsUnderParent) {
        blockers.push('missing_verified_parent_group_child_creation_semantics');
    }
    if (!canMoveLayersIntoChildGroups) {
        blockers.push('missing_verified_move_to_group_semantics');
    }
    if (!canExportChildGroupsToPath) {
        blockers.push('missing_verified_group_scoped_export_to_path');
    }

    const warnings = [
        ...(production?.warnings || []).map(cleanString).filter(Boolean)
    ];

    return buildContract({
        status,
        documents,
        requiredToolNames,
        availableToolNames,
        missingToolNames,
        canCreateTopLevelParentGroups: createGroupReady,
        canCreateChildGroupsUnderParent,
        canMoveLayersIntoChildGroups,
        canExportChildGroupsToPath,
        blockers: Array.from(new Set(blockers.map(cleanString).filter(Boolean))),
        warnings: Array.from(new Set(warnings))
    });
}
