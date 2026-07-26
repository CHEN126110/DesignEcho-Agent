/**
 * 外部 Artifact 名称到现有生产契约的治理校验。
 *
 * 该模块只验证 alias、owner 和 consumer，不保存 Artifact、不创建 Schema、
 * 不推进 Runtime，也不成为第二份 Artifact Registry。
 */

import type { RuntimeStage } from './contracts';

export type ArtifactAliasAuthority = 'reference_only' | 'advisory_data';

export interface ArtifactAliasGovernanceDeclaration {
    aliasId: string;
    version: string;
    canonicalArtifactId: string;
    canonicalOwner: string;
    canonicalSource: string;
    consumers: string[];
    stages: RuntimeStage[];
    persistenceOwner: string;
    authority: ArtifactAliasAuthority;
    adapterOnly: boolean;
    createsIndependentSchema?: boolean;
    ownsRuntimeState?: boolean;
    grantsToolPermission?: boolean;
    executesTools?: boolean;
    advancesRuntimeStage?: boolean;
    declaresCompletion?: boolean;
}

export type ArtifactAliasGovernanceIssueCode =
    | 'invalid_alias_id'
    | 'duplicate_alias_id'
    | 'invalid_version'
    | 'canonical_artifact_missing'
    | 'canonical_owner_missing'
    | 'canonical_source_missing'
    | 'consumer_missing'
    | 'stage_missing'
    | 'persistence_owner_missing'
    | 'adapter_boundary_missing'
    | 'independent_schema_forbidden'
    | 'runtime_state_ownership_forbidden'
    | 'tool_permission_forbidden'
    | 'tool_execution_forbidden'
    | 'stage_advancement_forbidden'
    | 'completion_declaration_forbidden';

export interface ArtifactAliasGovernanceIssue {
    code: ArtifactAliasGovernanceIssueCode;
    aliasId: string;
    path: string;
    detail: string;
}

export interface ArtifactAliasGovernanceResult {
    version: 'artifact-alias-governance-result/v0';
    aliasId: string;
    status: 'valid' | 'invalid';
    issues: ArtifactAliasGovernanceIssue[];
}

export interface ArtifactAliasGovernanceReport {
    version: 'artifact-alias-governance-report/v0';
    status: 'valid' | 'invalid';
    declarationCount: number;
    validCount: number;
    invalidCount: number;
    results: ArtifactAliasGovernanceResult[];
    issues: ArtifactAliasGovernanceIssue[];
    boundaries: {
        validatesAliasesOnly: true;
        createsRegistry: false;
        createsSchema: false;
        persistsArtifacts: false;
        ownsRuntimeState: false;
        executesTools: false;
        grantsPermission: false;
        advancesStage: false;
        declaresCompletion: false;
    };
}

const ALIAS_ID_PATTERN = /^[A-Z][A-Za-z0-9]{1,79}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function clean(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function boundaries(): ArtifactAliasGovernanceReport['boundaries'] {
    return {
        validatesAliasesOnly: true,
        createsRegistry: false,
        createsSchema: false,
        persistsArtifacts: false,
        ownsRuntimeState: false,
        executesTools: false,
        grantsPermission: false,
        advancesStage: false,
        declaresCompletion: false
    };
}

export function validateArtifactAliasGovernance(input: {
    declarations: readonly ArtifactAliasGovernanceDeclaration[];
}): ArtifactAliasGovernanceReport {
    const aliasCounts = new Map<string, number>();
    input.declarations.forEach((declaration) => {
        const aliasId = clean(declaration.aliasId);
        aliasCounts.set(aliasId, (aliasCounts.get(aliasId) || 0) + 1);
    });

    const results = input.declarations.map((declaration): ArtifactAliasGovernanceResult => {
        const aliasId = clean(declaration.aliasId);
        const issues: ArtifactAliasGovernanceIssue[] = [];
        function add(code: ArtifactAliasGovernanceIssueCode, path: string, detail: string): void {
            issues.push({ code, aliasId: aliasId || 'invalid', path, detail });
        }

        if (!ALIAS_ID_PATTERN.test(aliasId)) add('invalid_alias_id', 'aliasId', aliasId || 'missing');
        if ((aliasCounts.get(aliasId) || 0) > 1) add('duplicate_alias_id', 'aliasId', aliasId);
        if (!SEMVER_PATTERN.test(clean(declaration.version))) {
            add('invalid_version', 'version', clean(declaration.version) || 'missing');
        }
        if (!clean(declaration.canonicalArtifactId)) {
            add('canonical_artifact_missing', 'canonicalArtifactId', 'existing canonical contract required');
        }
        if (!clean(declaration.canonicalOwner)) {
            add('canonical_owner_missing', 'canonicalOwner', 'single production owner required');
        }
        if (!clean(declaration.canonicalSource)) {
            add('canonical_source_missing', 'canonicalSource', 'existing source path required');
        }
        if (unique(declaration.consumers).length === 0) {
            add('consumer_missing', 'consumers', 'at least one real consumer required');
        }
        if (unique(declaration.stages).length === 0) {
            add('stage_missing', 'stages', 'existing Runtime stage required');
        }
        if (!clean(declaration.persistenceOwner)) {
            add('persistence_owner_missing', 'persistenceOwner', 'ephemeral is allowed but must be explicit');
        }
        if (declaration.adapterOnly !== true) {
            add('adapter_boundary_missing', 'adapterOnly', 'external name must remain an adapter alias');
        }
        if (declaration.createsIndependentSchema === true) {
            add('independent_schema_forbidden', 'createsIndependentSchema', 'reuse canonical contract');
        }
        if (declaration.ownsRuntimeState === true) {
            add('runtime_state_ownership_forbidden', 'ownsRuntimeState', 'Runtime Session remains stage owner');
        }
        if (declaration.grantsToolPermission === true) {
            add('tool_permission_forbidden', 'grantsToolPermission', 'Artifact data cannot grant permission');
        }
        if (declaration.executesTools === true) {
            add('tool_execution_forbidden', 'executesTools', 'Artifact data cannot execute tools');
        }
        if (declaration.advancesRuntimeStage === true) {
            add('stage_advancement_forbidden', 'advancesRuntimeStage', 'canonical deterministic owner decides stage');
        }
        if (declaration.declaresCompletion === true) {
            add('completion_declaration_forbidden', 'declaresCompletion', 'alias cannot own completion decision');
        }

        return {
            version: 'artifact-alias-governance-result/v0',
            aliasId: aliasId || 'invalid',
            status: issues.length === 0 ? 'valid' : 'invalid',
            issues
        };
    });
    const issues = results.flatMap((result) => result.issues);
    return {
        version: 'artifact-alias-governance-report/v0',
        status: issues.length === 0 ? 'valid' : 'invalid',
        declarationCount: results.length,
        validCount: results.filter((result) => result.status === 'valid').length,
        invalidCount: results.filter((result) => result.status === 'invalid').length,
        results,
        issues,
        boundaries: boundaries()
    };
}
