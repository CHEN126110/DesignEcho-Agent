/**
 * R0 selected Skill handoff.
 *
 * 该契约只保留 R0 已经完成的结构化 Skill 选择。选择可以来自模型路由，也可以
 * 来自唯一命中的 Skill declaration 路由元数据；后者只解决“哪个能力拥有交付物”，
 * 不规定执行步骤。契约不执行 Skill、不装载 Capability、不授予 Tool 权限。
 */

export const LEGACY_RUNTIME_SELECTED_SKILL_HANDOFF_VERSION = 'runtime-selected-skill-handoff/v0' as const;
export const RUNTIME_SELECTED_SKILL_HANDOFF_VERSION = 'runtime-selected-skill-handoff/v1' as const;
export const RUNTIME_CONTRACT_STATUS_VERSION = 'runtime-contract-status/v0' as const;

export type RuntimeSelectedSkillHandoffSource =
    | 'model_router_react_handoff'
    | 'skill_declaration_unique_match'
    | 'controlled_route_react_handoff';

export interface RuntimeSelectedSkillHandoff {
    version:
        | typeof RUNTIME_SELECTED_SKILL_HANDOFF_VERSION
        | typeof LEGACY_RUNTIME_SELECTED_SKILL_HANDOFF_VERSION;
    skillId: string;
    source: RuntimeSelectedSkillHandoffSource;
    routeClass: 'business-workflow';
    directExecution: 'forbidden';
    boundaries: {
        selectionRecordOnly: true;
        executesSkill: false;
        grantsToolPermission: false;
        derivedFromTaskText: boolean;
    };
}

export type RuntimeContractStatusKind =
    | 'resolved'
    | 'no_skill_selected'
    | 'selected_manifest_missing';

export interface RuntimeContractStatus {
    version: typeof RUNTIME_CONTRACT_STATUS_VERSION;
    status: RuntimeContractStatusKind;
    selectedSkillId?: string;
    selectedTaskType?: string;
    manifestSkillId?: string;
    selectionSource?: RuntimeSelectedSkillHandoffSource | 'explicit_runtime_declaration';
    reason: string;
    boundaries: {
        doesNotExecuteSkill: true;
        doesNotGrantToolPermission: true;
    };
}

const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]{0,79}$/;
const TASK_TYPE_PATTERN = /^[a-z][a-z0-9._-]{0,99}$/;

function normalizeSkillId(value: unknown): string {
    const skillId = String(value || '').trim().toLowerCase();
    return SKILL_ID_PATTERN.test(skillId) ? skillId : '';
}

function normalizeTaskType(value: unknown): string {
    const taskType = String(value || '').trim().toLowerCase();
    return TASK_TYPE_PATTERN.test(taskType) ? taskType : '';
}

export function buildRuntimeSelectedSkillHandoff(input: {
    skillId: unknown;
    source?: RuntimeSelectedSkillHandoffSource;
    routeClass: unknown;
    directExecution: unknown;
}): RuntimeSelectedSkillHandoff | undefined {
    const skillId = normalizeSkillId(input.skillId);
    if (!skillId) return undefined;
    if (input.source
        && input.source !== 'model_router_react_handoff'
        && input.source !== 'skill_declaration_unique_match'
        && input.source !== 'controlled_route_react_handoff') return undefined;
    if (input.routeClass !== 'business-workflow') return undefined;
    if (input.directExecution !== 'forbidden') return undefined;
    return {
        version: RUNTIME_SELECTED_SKILL_HANDOFF_VERSION,
        skillId,
        source: input.source || 'model_router_react_handoff',
        routeClass: 'business-workflow',
        directExecution: 'forbidden',
        boundaries: {
            selectionRecordOnly: true,
            executesSkill: false,
            grantsToolPermission: false,
            derivedFromTaskText: input.source === 'skill_declaration_unique_match'
        }
    };
}

export function validateRuntimeSelectedSkillHandoff(
    value: unknown
): value is RuntimeSelectedSkillHandoff {
    if (!value || typeof value !== 'object') return false;
    const handoff = value as Partial<RuntimeSelectedSkillHandoff>;
    const supportedVersion = handoff.version === RUNTIME_SELECTED_SKILL_HANDOFF_VERSION
        || handoff.version === LEGACY_RUNTIME_SELECTED_SKILL_HANDOFF_VERSION;
    const supportedSource = handoff.source === 'model_router_react_handoff'
        || handoff.source === 'skill_declaration_unique_match'
        || handoff.source === 'controlled_route_react_handoff';
    const expectedDerivedFromTaskText = handoff.source === 'skill_declaration_unique_match';
    const legacyShapeIsValid = handoff.version !== LEGACY_RUNTIME_SELECTED_SKILL_HANDOFF_VERSION
        || handoff.source === 'model_router_react_handoff';
    return supportedVersion
        && normalizeSkillId(handoff.skillId) === handoff.skillId
        && supportedSource
        && legacyShapeIsValid
        && handoff.routeClass === 'business-workflow'
        && handoff.directExecution === 'forbidden'
        && handoff.boundaries?.selectionRecordOnly === true
        && handoff.boundaries?.executesSkill === false
        && handoff.boundaries?.grantsToolPermission === false
        && handoff.boundaries?.derivedFromTaskText === expectedDerivedFromTaskText;
}

export function buildRuntimeContractStatus(input: {
    selectedSkillId?: unknown;
    selectedTaskType?: unknown;
    manifestSkillId?: unknown;
    selectionSource?: RuntimeContractStatus['selectionSource'];
    selectionExpected?: boolean;
}): RuntimeContractStatus {
    const selectedSkillId = normalizeSkillId(input.selectedSkillId);
    const selectedTaskType = normalizeTaskType(input.selectedTaskType);
    const manifestSkillId = String(input.manifestSkillId || '').trim();
    const boundaries = {
        doesNotExecuteSkill: true as const,
        doesNotGrantToolPermission: true as const
    };

    if (!selectedSkillId && !selectedTaskType && input.selectionExpected !== true) {
        return {
            version: RUNTIME_CONTRACT_STATUS_VERSION,
            status: 'no_skill_selected',
            reason: '当前任务没有结构化 Skill 或 task type 选择；保留通用 Agent 能力发现。',
            boundaries
        };
    }
    if (!manifestSkillId) {
        return {
            version: RUNTIME_CONTRACT_STATUS_VERSION,
            status: 'selected_manifest_missing',
            ...(selectedSkillId ? { selectedSkillId } : {}),
            ...(selectedTaskType ? { selectedTaskType } : {}),
            ...(input.selectionSource ? { selectionSource: input.selectionSource } : {}),
            reason: '已经存在结构化 Skill / task type 选择，但没有解析到对应 Manifest。',
            boundaries
        };
    }
    return {
        version: RUNTIME_CONTRACT_STATUS_VERSION,
        status: 'resolved',
        ...(selectedSkillId ? { selectedSkillId } : {}),
        ...(selectedTaskType ? { selectedTaskType } : {}),
        manifestSkillId,
        ...(input.selectionSource ? { selectionSource: input.selectionSource } : {}),
        reason: '结构化 Skill 选择已经解析到唯一 Runtime Manifest。',
        boundaries
    };
}
