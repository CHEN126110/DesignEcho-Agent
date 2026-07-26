/**
 * Prompt / Capability governance contract.
 *
 * This validates ownership and authority metadata for prompt-like modules. It is not a Prompt
 * registry, workflow engine, state machine or provider loader. Runtime Session, Manifest,
 * Capability Resolver, Tool preflight and Completion gates remain the production authorities.
 */

import type { RuntimeStage } from './contracts';

export type PromptGovernanceOwner =
    | 'model'
    | 'runtime'
    | 'skill'
    | 'tool'
    | 'memory'
    | 'evaluation'
    | 'policy';

export type PromptGovernanceImplementation =
    | 'model_prompt'
    | 'deterministic_code'
    | 'hybrid';

export type PromptGovernanceAuthority =
    | 'advisory'
    | 'declarative'
    | 'execution'
    | 'completion';

export type PromptGovernanceScope = 'global' | 'capability' | 'skill';
export type PromptGovernanceActivation = 'always' | 'runtime_conditioned' | 'on_demand';
export type PromptGovernanceCapabilityKind =
    | 'knowledge'
    | 'skill'
    | 'tool'
    | 'memory'
    | 'evaluation'
    | 'policy';

export interface PromptCapabilityGovernanceDeclaration {
    promptId: string;
    version: string;
    owner: PromptGovernanceOwner;
    implementation: PromptGovernanceImplementation;
    authority: PromptGovernanceAuthority;
    scope: PromptGovernanceScope;
    activation: PromptGovernanceActivation;
    stages: RuntimeStage[];
    capabilityKinds: PromptGovernanceCapabilityKind[];
    skillIds?: string[];
    fixedSequence?: boolean;
    createsIndependentRuntimeState?: boolean;
    grantsToolPermission?: boolean;
    executesTools?: boolean;
    advancesRuntimeStage?: boolean;
    declaresCompletion?: boolean;
}

export type PromptCapabilityGovernanceIssueCode =
    | 'duplicate_prompt_id'
    | 'invalid_prompt_id'
    | 'invalid_version'
    | 'stage_missing'
    | 'capability_kind_missing'
    | 'fixed_sequence_forbidden'
    | 'independent_runtime_state_forbidden'
    | 'global_prompt_skill_binding'
    | 'skill_scope_missing_skill_id'
    | 'skill_prompt_always_active'
    | 'model_prompt_execution_authority'
    | 'model_prompt_completion_authority'
    | 'model_prompt_grants_permission'
    | 'model_prompt_executes_tools'
    | 'model_prompt_advances_stage'
    | 'model_prompt_declares_completion'
    | 'execution_requires_deterministic_code'
    | 'completion_requires_deterministic_code';

export interface PromptCapabilityGovernanceIssue {
    code: PromptCapabilityGovernanceIssueCode;
    promptId: string;
    path: string;
    detail: string;
}

export interface PromptCapabilityGovernanceResult {
    version: 'prompt-capability-governance-result/v0';
    promptId: string;
    status: 'valid' | 'invalid';
    issues: PromptCapabilityGovernanceIssue[];
}

export interface PromptCapabilityGovernanceReport {
    version: 'prompt-capability-governance-report/v0';
    status: 'valid' | 'invalid';
    declarationCount: number;
    validCount: number;
    invalidCount: number;
    results: PromptCapabilityGovernanceResult[];
    issues: PromptCapabilityGovernanceIssue[];
    boundaries: {
        createsPromptRegistry: false;
        createsWorkflowRuntime: false;
        createsCapabilityResolver: false;
        grantsPermission: false;
        executesTools: false;
        advancesRuntimeStage: false;
        declaresCompletion: false;
    };
}

const PROMPT_ID_PATTERN = /^[A-Z][A-Z0-9-]{1,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function unique(values: readonly string[] | undefined): string[] {
    return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function boundaries(): PromptCapabilityGovernanceReport['boundaries'] {
    return {
        createsPromptRegistry: false,
        createsWorkflowRuntime: false,
        createsCapabilityResolver: false,
        grantsPermission: false,
        executesTools: false,
        advancesRuntimeStage: false,
        declaresCompletion: false
    };
}

function isModelMediated(implementation: PromptGovernanceImplementation): boolean {
    return implementation === 'model_prompt' || implementation === 'hybrid';
}

export function validatePromptCapabilityGovernance(input: {
    declarations: readonly PromptCapabilityGovernanceDeclaration[];
}): PromptCapabilityGovernanceReport {
    const promptIdCounts = new Map<string, number>();
    for (const declaration of input.declarations) {
        const promptId = String(declaration.promptId || '').trim();
        promptIdCounts.set(promptId, (promptIdCounts.get(promptId) || 0) + 1);
    }

    const results = input.declarations.map((declaration): PromptCapabilityGovernanceResult => {
        const promptId = String(declaration.promptId || '').trim();
        const issues: PromptCapabilityGovernanceIssue[] = [];
        function add(code: PromptCapabilityGovernanceIssueCode, path: string, detail: string): void {
            issues.push({ code, promptId: promptId || 'invalid', path, detail });
        }

        if (!PROMPT_ID_PATTERN.test(promptId)) add('invalid_prompt_id', 'promptId', promptId || 'missing');
        if ((promptIdCounts.get(promptId) || 0) > 1) add('duplicate_prompt_id', 'promptId', promptId);
        if (!SEMVER_PATTERN.test(String(declaration.version || ''))) {
            add('invalid_version', 'version', String(declaration.version || 'missing'));
        }
        if (unique(declaration.stages).length === 0) add('stage_missing', 'stages', 'existing Runtime stage required');
        if (unique(declaration.capabilityKinds).length === 0) {
            add('capability_kind_missing', 'capabilityKinds', 'existing Capability kind required');
        }
        if (declaration.fixedSequence === true) {
            add('fixed_sequence_forbidden', 'fixedSequence', 'Prompt cannot define production workflow order');
        }
        if (declaration.createsIndependentRuntimeState === true) {
            add('independent_runtime_state_forbidden', 'createsIndependentRuntimeState', 'Runtime Session is stage owner');
        }

        const skillIds = unique(declaration.skillIds);
        if (declaration.scope === 'global' && skillIds.length > 0) {
            add('global_prompt_skill_binding', 'skillIds', skillIds.join(','));
        }
        if (declaration.scope === 'skill' && skillIds.length === 0) {
            add('skill_scope_missing_skill_id', 'skillIds', 'skill scope requires manifest identity');
        }
        if (declaration.scope === 'skill' && declaration.activation === 'always') {
            add('skill_prompt_always_active', 'activation', declaration.activation);
        }

        if (isModelMediated(declaration.implementation)) {
            if (declaration.authority === 'execution') add('model_prompt_execution_authority', 'authority', declaration.authority);
            if (declaration.authority === 'completion') add('model_prompt_completion_authority', 'authority', declaration.authority);
            if (declaration.grantsToolPermission === true) add('model_prompt_grants_permission', 'grantsToolPermission', 'true');
            if (declaration.executesTools === true) add('model_prompt_executes_tools', 'executesTools', 'true');
            if (declaration.advancesRuntimeStage === true) add('model_prompt_advances_stage', 'advancesRuntimeStage', 'true');
            if (declaration.declaresCompletion === true) add('model_prompt_declares_completion', 'declaresCompletion', 'true');
        }

        if (declaration.authority === 'execution' && declaration.implementation !== 'deterministic_code') {
            add('execution_requires_deterministic_code', 'implementation', declaration.implementation);
        }
        if (declaration.authority === 'completion' && declaration.implementation !== 'deterministic_code') {
            add('completion_requires_deterministic_code', 'implementation', declaration.implementation);
        }

        return {
            version: 'prompt-capability-governance-result/v0',
            promptId: promptId || 'invalid',
            status: issues.length === 0 ? 'valid' : 'invalid',
            issues
        };
    });
    const issues = results.flatMap((result) => result.issues);
    return {
        version: 'prompt-capability-governance-report/v0',
        status: issues.length === 0 ? 'valid' : 'invalid',
        declarationCount: results.length,
        validCount: results.filter((result) => result.status === 'valid').length,
        invalidCount: results.filter((result) => result.status === 'invalid').length,
        results,
        issues,
        boundaries: boundaries()
    };
}
