/**
 * Manifest-driven Skill package contract validation.
 *
 * The validator consumes existing Manifest, Skill declaration and Capability resolution truth. It
 * does not create another Registry, load providers, execute Tools or infer a task category.
 */

import type { SkillDeclaration } from '../types/skill.types';
import type { SkillRuntimeManifest, RuntimeStage } from './contracts';
import type { AgentCapabilityResolution } from './contracts/capability-resolution';
import { validateSkillRuntimeReferencePolicy } from './runtime-reference-context';

export type SkillPackageContractIssueCode =
    | 'duplicate_skill_id'
    | 'duplicate_task_type'
    | 'duplicate_legacy_alias'
    | 'invalid_version'
    | 'required_input_missing'
    | 'input_overlap'
    | 'input_source_missing'
    | 'input_source_unknown_key'
    | 'reference_policy_invalid'
    | 'runtime_stage_missing'
    | 'runtime_stage_order_invalid'
    | 'tool_boundary_empty'
    | 'tool_namespace_mismatch'
    | 'tool_allow_deny_overlap'
    | 'capability_kind_missing'
    | 'primary_method_tool_unbound'
    | 'review_rubric_unbound'
    | 'delivery_contract_missing'
    | 'exit_criteria_missing'
    | 'legacy_declaration_missing'
    | 'legacy_declaration_not_business_workflow'
    | 'legacy_declaration_direct_execution_allowed'
    | 'legacy_declaration_not_autonomous_entry'
    | 'capability_resolution_missing'
    | 'capability_resolution_identity_mismatch'
    | 'capability_reference_unresolved';

export interface SkillPackageContractIssue {
    code: SkillPackageContractIssueCode;
    skillId: string;
    path: string;
    detail: string;
}

export interface SkillPackageContractResult {
    version: 'skill-package-contract-result/v0';
    skillId: string;
    taskType: string;
    manifestVersion: string;
    status: 'valid' | 'invalid';
    declarationIds: string[];
    requestedCapabilityKinds: Array<'knowledge' | 'skill' | 'tool' | 'memory' | 'evaluation' | 'policy'>;
    issues: SkillPackageContractIssue[];
    boundaries: {
        manifestIsSource: true;
        createsRegistry: false;
        loadsProviders: false;
        executesTools: false;
        grantsPermission: false;
        claimsLiveE2E: false;
        claimsDesignQuality: false;
    };
}

export interface SkillPackageContractReport {
    version: 'skill-package-contract-report/v0';
    status: 'valid' | 'invalid';
    packageCount: number;
    validPackageCount: number;
    invalidPackageCount: number;
    results: SkillPackageContractResult[];
    issues: SkillPackageContractIssue[];
    boundaries: SkillPackageContractResult['boundaries'];
}

const REQUIRED_STAGE_ORDER: readonly RuntimeStage[] = [
    'R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'
];
// 每个 manifest 的 runtime_stages 必须是 REQUIRED_STAGE_ORDER 的合法有序子序列（顺序由下方 isCanonicalOrderedSubset 校验），
// 且至少包含这条「上下文→执行→复核」核心脊柱。R1 brief / R3 strategy / R4 action-plan / R2 观察 / E2 交付
// 属可选声明门：结构化生产任务（规格已确认）可省略它们走精简阶段链（如 ['R0','R2','E1','R5']），
// 不再被创意声明仪式锁在 E1 之外；创意任务仍可声明完整八阶段。
const MINIMUM_REQUIRED_STAGES: readonly RuntimeStage[] = ['R0', 'E1', 'R5'];
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function unique(values: readonly string[] | undefined): string[] {
    return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

/**
 * runtime_stages 必须是 canonical 阶段序的合法有序子序列：每个阶段都是已知阶段、
 * 按 canonical 相对顺序严格递增出现、无重复、无乱序。允许省略可选声明门（如结构化短链
 * ['R0','R2','E1','R5']），但不允许未知阶段或颠倒顺序。
 */
function isCanonicalOrderedSubset(
    stages: readonly string[],
    canonical: readonly RuntimeStage[]
): boolean {
    const canonicalIndex = new Map<string, number>(canonical.map((stage, index) => [stage, index]));
    let previousIndex = -1;
    for (const stage of stages) {
        const index = canonicalIndex.get(stage);
        if (index === undefined) return false;
        if (index <= previousIndex) return false;
        previousIndex = index;
    }
    return true;
}

function boundaries(): SkillPackageContractResult['boundaries'] {
    return {
        manifestIsSource: true,
        createsRegistry: false,
        loadsProviders: false,
        executesTools: false,
        grantsPermission: false,
        claimsLiveE2E: false,
        claimsDesignQuality: false
    };
}

export function validateSkillPackageContracts(input: {
    manifests: readonly SkillRuntimeManifest[];
    declarations: readonly SkillDeclaration[];
    resolutions?: ReadonlyMap<string, AgentCapabilityResolution>;
}): SkillPackageContractReport {
    const skillIdCounts = new Map<string, number>();
    const taskTypeCounts = new Map<string, number>();
    const aliasCounts = new Map<string, number>();
    for (const manifest of input.manifests) {
        skillIdCounts.set(manifest.skill_id, (skillIdCounts.get(manifest.skill_id) || 0) + 1);
        taskTypeCounts.set(manifest.task_type, (taskTypeCounts.get(manifest.task_type) || 0) + 1);
        for (const alias of unique(manifest.legacy_skill_ids)) {
            aliasCounts.set(alias, (aliasCounts.get(alias) || 0) + 1);
        }
    }

    const declarationById = new Map(input.declarations.map((declaration) => [declaration.id, declaration]));
    const results = input.manifests.map((manifest): SkillPackageContractResult => {
        const issues: SkillPackageContractIssue[] = [];
        const add = (code: SkillPackageContractIssueCode, path: string, detail: string): void => {
            issues.push({ code, skillId: manifest.skill_id, path, detail });
        };
        if ((skillIdCounts.get(manifest.skill_id) || 0) > 1) {
            add('duplicate_skill_id', 'skill_id', manifest.skill_id);
        }
        if ((taskTypeCounts.get(manifest.task_type) || 0) > 1) {
            add('duplicate_task_type', 'task_type', manifest.task_type);
        }
        if (!SEMVER_PATTERN.test(manifest.version)) {
            add('invalid_version', 'version', manifest.version);
        }
        const requiredInputs = unique(manifest.required_inputs);
        const optionalInputs = unique(manifest.optional_inputs);
        if (requiredInputs.length === 0) add('required_input_missing', 'required_inputs', 'at least one required input');
        const inputOverlap = requiredInputs.filter((key) => optionalInputs.includes(key));
        if (inputOverlap.length > 0) add('input_overlap', 'optional_inputs', inputOverlap.join(','));
        const allInputKeys = unique([
            ...requiredInputs,
            ...optionalInputs,
            ...Object.values(manifest.work_mode_contracts || {}).flatMap((contract) => (
                contract ? [...contract.required_inputs, ...contract.optional_inputs] : []
            ))
        ]);
        for (const inputKey of allInputKeys) {
            if (!Array.isArray(manifest.input_sources[inputKey]) || manifest.input_sources[inputKey].length === 0) {
                add('input_source_missing', `input_sources.${inputKey}`, inputKey);
            }
        }
        for (const inputKey of Object.keys(manifest.input_sources)) {
            if (!allInputKeys.includes(inputKey)) {
                add('input_source_unknown_key', `input_sources.${inputKey}`, inputKey);
            }
        }
        for (const referencePolicyIssue of validateSkillRuntimeReferencePolicy(manifest.reference_policy)) {
            add('reference_policy_invalid', 'reference_policy', referencePolicyIssue);
        }

        for (const stage of MINIMUM_REQUIRED_STAGES) {
            if (!manifest.runtime_stages.includes(stage)) {
                add('runtime_stage_missing', 'runtime_stages', stage);
            }
        }
        if (!isCanonicalOrderedSubset(manifest.runtime_stages, REQUIRED_STAGE_ORDER)) {
            add('runtime_stage_order_invalid', 'runtime_stages', manifest.runtime_stages.join('>'));
        }

        const availableTools = unique(manifest.available_tools);
        const forbiddenTools = unique(manifest.forbidden_tools);
        if (availableTools.length === 0 || forbiddenTools.length === 0) {
            add('tool_boundary_empty', 'available_tools/forbidden_tools', 'both allow seeds and deny boundary are required');
        }
        const toolOverlap = availableTools.filter((tool) => forbiddenTools.includes(tool));
        if (toolOverlap.length > 0) add('tool_allow_deny_overlap', 'forbidden_tools', toolOverlap.join(','));
        const namespaces = unique(manifest.tool_namespaces);
        for (const tool of availableTools) {
            if (namespaces.length > 0 && !namespaces.some((namespace) => tool.startsWith(namespace))) {
                add('tool_namespace_mismatch', 'available_tools', tool);
            }
        }

        const capabilityKinds = {
            knowledge: unique(manifest.knowledge_refs),
            skill: [manifest.skill_id],
            tool: availableTools,
            memory: unique(manifest.memory_refs),
            evaluation: unique(manifest.evaluation_refs),
            policy: unique(manifest.policy_refs)
        };
        if (manifest.primary_method_tool_ref
            && !capabilityKinds.knowledge.includes(manifest.primary_method_tool_ref)) {
            add('primary_method_tool_unbound', 'primary_method_tool_ref', manifest.primary_method_tool_ref);
        }
        const requestedCapabilityKinds = (Object.keys(capabilityKinds) as Array<keyof typeof capabilityKinds>)
            .filter((kind) => capabilityKinds[kind].length > 0);
        for (const [kind, refs] of Object.entries(capabilityKinds)) {
            if (refs.length === 0) add('capability_kind_missing', `${kind}_refs`, kind);
        }
        if (!manifest.review_rubric_ref
            || !capabilityKinds.evaluation.includes(manifest.review_rubric_ref)) {
            add('review_rubric_unbound', 'review_rubric_ref', manifest.review_rubric_ref || 'missing');
        }
        for (const [workMode, contract] of Object.entries(manifest.work_mode_contracts || {})) {
            const reviewRubricRef = contract?.review_rubric_ref;
            if (reviewRubricRef && !capabilityKinds.evaluation.includes(reviewRubricRef)) {
                add(
                    'review_rubric_unbound',
                    `work_mode_contracts.${workMode}.review_rubric_ref`,
                    reviewRubricRef
                );
            }
        }
        if (unique(manifest.delivery_outputs).length === 0) {
            add('delivery_contract_missing', 'delivery_outputs', 'missing');
        }
        if (unique(manifest.exit_criteria).length === 0) {
            add('exit_criteria_missing', 'exit_criteria', 'missing');
        }

        const declarationIds = unique(manifest.legacy_skill_ids);
        for (const alias of declarationIds) {
            if ((aliasCounts.get(alias) || 0) > 1) add('duplicate_legacy_alias', 'legacy_skill_ids', alias);
            const declaration = declarationById.get(alias);
            if (!declaration) {
                add('legacy_declaration_missing', 'legacy_skill_ids', alias);
                continue;
            }
            if (declaration.routeClass !== 'business-workflow') {
                add('legacy_declaration_not_business_workflow', `declaration:${alias}.routeClass`, String(declaration.routeClass));
            }
            if (declaration.modelDirectExecution !== 'forbidden') {
                add('legacy_declaration_direct_execution_allowed', `declaration:${alias}.modelDirectExecution`, String(declaration.modelDirectExecution));
            }
            if (declaration.controlledRouteEntry !== 'autonomous-react-loop') {
                add('legacy_declaration_not_autonomous_entry', `declaration:${alias}.controlledRouteEntry`, String(declaration.controlledRouteEntry));
            }
        }

        if (input.resolutions) {
            const resolution = input.resolutions.get(manifest.skill_id);
            if (!resolution) {
                add('capability_resolution_missing', 'capability_resolution', 'missing');
            } else if (resolution.manifestRef?.skillId !== manifest.skill_id
                || resolution.manifestRef?.taskType !== manifest.task_type
                || resolution.manifestRef?.version !== manifest.version) {
                add('capability_resolution_identity_mismatch', 'capability_resolution.manifestRef', JSON.stringify(resolution.manifestRef));
            } else if (resolution.referenceResolution.status !== 'resolved'
                || resolution.referenceResolution.metrics.unavailableCount > 0) {
                add(
                    'capability_reference_unresolved',
                    'capability_resolution.referenceResolution',
                    JSON.stringify(resolution.referenceResolution.unavailable)
                );
            }
        }

        return {
            version: 'skill-package-contract-result/v0',
            skillId: manifest.skill_id,
            taskType: manifest.task_type,
            manifestVersion: manifest.version,
            status: issues.length === 0 ? 'valid' : 'invalid',
            declarationIds,
            requestedCapabilityKinds,
            issues,
            boundaries: boundaries()
        };
    });
    const issues = results.flatMap((result) => result.issues);
    return {
        version: 'skill-package-contract-report/v0',
        status: issues.length === 0 ? 'valid' : 'invalid',
        packageCount: results.length,
        validPackageCount: results.filter((result) => result.status === 'valid').length,
        invalidPackageCount: results.filter((result) => result.status === 'invalid').length,
        results,
        issues,
        boundaries: boundaries()
    };
}
