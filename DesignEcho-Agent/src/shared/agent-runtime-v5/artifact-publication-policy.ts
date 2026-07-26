/**
 * Artifact 发布前的纯策略校验。
 *
 * Repository 继续拥有不可变写入、hash、lineage 与磁盘校验；本模块只回答某个调用
 * authority 是否可以把某种 payload 草稿交给 Repository。它不执行 IO、不发布 Artifact，
 * 也不授予 Runtime、Tool、Approval、质量或完成权限。
 */

import { DESIGN_QUALITY_VERDICT_CAPABILITY_ID } from './capability-provider-identities';
import {
    isArtifactRuntimeBinding,
    isCanonicalArtifactType,
    MAX_ARTIFACT_REFS,
    readArtifactRef
} from './artifact-repository-contract';
import type { ArtifactRef } from './contracts/common';
import { V5_ARTIFACT_TYPES, type V5ArtifactType } from './contracts/index';
import {
    readStrictDesignVerdict,
    readStrictRuntimeActionPlanDeclaration,
    readStrictRuntimeDeliveryVerification,
    readStrictRuntimeDesignBriefDeclaration,
    readStrictRuntimeDesignStrategyDeclaration
} from './runtime-artifact-declaration-readers';
import { buildRuntimeArtifactId } from './runtime-artifact-finalization';
import { validateUpstreamRefs } from './validators/contract-validators';

export type ArtifactPublicationAuthority = 'runtime_renderer' | 'approval_service' | 'internal';
export type ArtifactPublicationTransport = 'renderer_ipc' | 'main_process';

export interface ArtifactPublicationPolicyInput {
    authority: ArtifactPublicationAuthority;
    transport: ArtifactPublicationTransport;
    request: unknown;
}

export interface ArtifactPublicationPolicyIssue {
    code: string;
    path: string;
    message: string;
}

export interface ArtifactPublicationPolicyResult {
    ok: boolean;
    issues: ArtifactPublicationPolicyIssue[];
}

type JsonPayloadValidator = (
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
) => void;

const RUNTIME_RENDERER_ARTIFACT_TYPES = new Set<V5ArtifactType>([
    V5_ARTIFACT_TYPES.runtimeDesignBrief,
    V5_ARTIFACT_TYPES.runtimeDesignStrategy,
    V5_ARTIFACT_TYPES.runtimeActionPlan,
    V5_ARTIFACT_TYPES.evaluationReport,
    V5_ARTIFACT_TYPES.runtimeDeliveryVerification
]);

const BINARY_ARTIFACT_TYPES = new Set<V5ArtifactType>([
    V5_ARTIFACT_TYPES.photoshopDocument,
    V5_ARTIFACT_TYPES.exportedAsset
]);

const RUNTIME_JSON_VALIDATORS: Partial<Record<V5ArtifactType, JsonPayloadValidator>> = {
    [V5_ARTIFACT_TYPES.runtimeDesignBrief]: validateRuntimeDesignBrief,
    [V5_ARTIFACT_TYPES.runtimeDesignStrategy]: validateRuntimeDesignStrategy,
    [V5_ARTIFACT_TYPES.runtimeActionPlan]: validateRuntimeActionPlan,
    [V5_ARTIFACT_TYPES.evaluationReport]: validateEvaluationReport,
    [V5_ARTIFACT_TYPES.runtimeDeliveryVerification]: validateRuntimeDeliveryVerification
};

const FORBIDDEN_RUNTIME_PAYLOAD_KEYS = new Set([
    'artifactid',
    'artifacttype',
    'base64',
    'binary',
    'blob',
    'buffer',
    'bytes',
    'contenthash',
    'dataurl',
    'filename',
    'imagedata',
    'meta',
    'owner',
    'payload',
    'physicalpath',
    'producer',
    'rawresult',
    'result',
    'resultdata',
    'toolresult'
]);

const MAX_AUTHORITY_SCAN_DEPTH = 24;
const MAX_AUTHORITY_SCAN_NODES = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function addIssue(
    issues: ArtifactPublicationPolicyIssue[],
    code: string,
    path: string,
    message: string
): void {
    if (issues.some((issue) => issue.code === code && issue.path === path)) return;
    issues.push({ code, path, message });
}

function validateExactObject(
    value: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[],
    path: string,
    issues: ArtifactPublicationPolicyIssue[]
): value is Record<string, unknown> {
    if (!isRecord(value)) {
        addIssue(issues, 'object_required', path, `${path} 必须是对象。`);
        return false;
    }
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    for (const key of requiredKeys) {
        if (!hasOwn(value, key)) {
            addIssue(issues, 'required_field_missing', `${path}.${key}`, `缺少必填字段 ${key}。`);
        }
    }
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            addIssue(issues, 'unknown_field', `${path}.${key}`, `不允许未知字段 ${key}。`);
        }
    }
    return true;
}

function validateLiteral(
    actual: unknown,
    expected: unknown,
    path: string,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (actual !== expected) {
        addIssue(issues, 'literal_mismatch', path, `${path} 必须为 ${JSON.stringify(expected)}。`);
    }
}

function validateEnum(
    actual: unknown,
    allowed: readonly string[],
    path: string,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (typeof actual !== 'string' || !allowed.includes(actual)) {
        addIssue(issues, 'enum_mismatch', path, `${path} 只允许 ${allowed.join(' / ')}。`);
    }
}

function validateStringArray(
    value: unknown,
    path: string,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        addIssue(issues, 'string_array_required', path, `${path} 必须是字符串数组。`);
    }
}

function validateBoolean(
    value: unknown,
    path: string,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (typeof value !== 'boolean') {
        addIssue(issues, 'boolean_required', path, `${path} 必须是 boolean。`);
    }
}

function validateLiteralBoundaries(
    value: unknown,
    expected: Readonly<Record<string, boolean>>,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (!validateExactObject(value, Object.keys(expected), [], 'request.payload.value.boundaries', issues)) {
        return;
    }
    for (const [key, literal] of Object.entries(expected)) {
        validateLiteral(value[key], literal, `request.payload.value.boundaries.${key}`, issues);
    }
}

function validateRuntimeDesignBrief(
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (!validateExactObject(
        value,
        ['version', 'source', 'readiness', 'payload', 'boundaries'],
        [],
        'request.payload.value',
        issues
    )) return;
    validateLiteral(value.version, 'runtime-design-brief-declaration/v0', 'request.payload.value.version', issues);
    validateLiteral(value.source, 'model_tool_call', 'request.payload.value.source', issues);
    validateEnum(value.readiness, ['ready', 'needs_input'], 'request.payload.value.readiness', issues);
    if (!isRecord(value.payload)) {
        addIssue(issues, 'declaration_payload_required', 'request.payload.value.payload', 'Brief payload 必须是对象。');
    }
    validateLiteralBoundaries(value.boundaries, {
        modelAuthored: true,
        harnessValidatedOnly: true,
        manifestInputsAreSourceOfTruth: true,
        categoryNeutral: true,
        executesTools: false,
        grantsPermission: false,
        autoActivatesCapabilities: false,
        countsAsTaskProgress: false,
        countsAsQualityPass: false
    }, issues);
    if (!readStrictRuntimeDesignBriefDeclaration(value)) {
        addIssue(
            issues,
            'declaration_shape_invalid',
            'request.payload.value',
            'Brief 必须是由 Runtime 校验器生成的完整严格声明。'
        );
    }
}

function validateRuntimeDesignStrategy(
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (!validateExactObject(
        value,
        ['version', 'source', 'readiness', 'payload', 'boundaries'],
        [],
        'request.payload.value',
        issues
    )) return;
    validateLiteral(value.version, 'runtime-design-strategy-declaration/v0', 'request.payload.value.version', issues);
    validateLiteral(value.source, 'model_tool_call', 'request.payload.value.source', issues);
    validateEnum(value.readiness, ['ready', 'needs_input'], 'request.payload.value.readiness', issues);
    if (!isRecord(value.payload)) {
        addIssue(issues, 'declaration_payload_required', 'request.payload.value.payload', 'Strategy payload 必须是对象。');
    }
    validateLiteralBoundaries(value.boundaries, {
        modelAuthored: true,
        harnessValidatedOnly: true,
        artifactPublished: false,
        executesTools: false,
        grantsPermission: false,
        countsAsTaskProgress: false,
        countsAsQualityPass: false,
        categoryNeutral: true
    }, issues);
    if (!readStrictRuntimeDesignStrategyDeclaration(value)) {
        addIssue(
            issues,
            'declaration_shape_invalid',
            'request.payload.value',
            'Strategy 必须是由 Runtime 校验器生成的完整严格声明。'
        );
    }
}

function validateRuntimeActionPlan(
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (!validateExactObject(
        value,
        ['version', 'source', 'readiness', 'payload', 'missingCapabilityRefs', 'graph', 'boundaries'],
        [],
        'request.payload.value',
        issues
    )) return;
    validateLiteral(value.version, 'runtime-action-plan-declaration/v0', 'request.payload.value.version', issues);
    validateLiteral(value.source, 'model_tool_call', 'request.payload.value.source', issues);
    validateEnum(
        value.readiness,
        ['ready', 'needs_capability', 'needs_input'],
        'request.payload.value.readiness',
        issues
    );
    if (!isRecord(value.payload)) {
        addIssue(issues, 'declaration_payload_required', 'request.payload.value.payload', 'Action Plan payload 必须是对象。');
    }
    validateStringArray(value.missingCapabilityRefs, 'request.payload.value.missingCapabilityRefs', issues);
    if (!isRecord(value.graph)) {
        addIssue(issues, 'graph_required', 'request.payload.value.graph', 'Action Plan graph 必须是对象。');
    }
    validateLiteralBoundaries(value.boundaries, {
        modelAuthored: true,
        harnessValidatedOnly: true,
        strategyAligned: true,
        categoryNeutral: true,
        semanticDslOnly: true,
        resumeMappingModelAuthored: true,
        shadowOnly: true,
        executable: false,
        schedulerAuthority: false,
        autoActivatesCapabilities: false,
        executesTools: false,
        grantsPermission: false,
        countsAsTaskProgress: false,
        countsAsQualityPass: false
    }, issues);
    if (!readStrictRuntimeActionPlanDeclaration(value)) {
        addIssue(
            issues,
            'declaration_shape_invalid',
            'request.payload.value',
            'Action Plan 必须是由 Runtime 校验器生成且 graph 可重算的完整严格声明。'
        );
    }
}

function validateEvaluationReport(
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (!validateExactObject(
        value,
        ['version', 'status', 'source', 'contractFailedRequirementIds', 'blockers', 'warnings', 'summary'],
        ['contractStatus', 'scorecardGate', 'overallScore'],
        'request.payload.value',
        issues
    )) return;
    validateLiteral(value.version, DESIGN_QUALITY_VERDICT_CAPABILITY_ID, 'request.payload.value.version', issues);
    validateEnum(
        value.status,
        ['passed', 'failed', 'needs_review', 'passed_unverified', 'not_applicable'],
        'request.payload.value.status',
        issues
    );
    validateEnum(value.source, ['contract', 'scorecard', 'contract+scorecard', 'none'], 'request.payload.value.source', issues);
    validateStringArray(value.contractFailedRequirementIds, 'request.payload.value.contractFailedRequirementIds', issues);
    validateStringArray(value.blockers, 'request.payload.value.blockers', issues);
    validateStringArray(value.warnings, 'request.payload.value.warnings', issues);
    if (typeof value.summary !== 'string') {
        addIssue(issues, 'string_required', 'request.payload.value.summary', 'Evaluation summary 必须是字符串。');
    }
    if (value.contractStatus !== undefined && typeof value.contractStatus !== 'string') {
        addIssue(issues, 'string_required', 'request.payload.value.contractStatus', 'contractStatus 必须是字符串。');
    }
    if (value.scorecardGate !== undefined) {
        validateEnum(
            value.scorecardGate,
            ['passed', 'failed', 'needs_review', 'incomplete_verification', 'insufficient_observations'],
            'request.payload.value.scorecardGate',
            issues
        );
    }
    if (value.overallScore !== undefined
        && (typeof value.overallScore !== 'number'
            || !Number.isFinite(value.overallScore)
            || value.overallScore < 0
            || value.overallScore > 100)) {
        addIssue(issues, 'score_out_of_range', 'request.payload.value.overallScore', 'overallScore 必须是 0..100 有限数。');
    }
    if (!readStrictDesignVerdict(value)) {
        addIssue(
            issues,
            'declaration_shape_invalid',
            'request.payload.value',
            'Evaluation Report 必须是严格且内部一致的 DesignVerdict。'
        );
    }
}

function validateRuntimeDeliveryVerification(
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (!validateExactObject(
        value,
        [
            'version', 'status', 'requiredOutputs', 'confirmedOutputs', 'missingOutputs',
            'targetBound', 'reviewedPreviewBound', 'sourceHistoryStateBound', 'boundaries'
        ],
        [],
        'request.payload.value',
        issues
    )) return;
    validateLiteral(value.version, 'runtime-delivery-verification/v1', 'request.payload.value.version', issues);
    validateEnum(value.status, ['passed', 'incomplete'], 'request.payload.value.status', issues);
    validateStringArray(value.requiredOutputs, 'request.payload.value.requiredOutputs', issues);
    validateStringArray(value.confirmedOutputs, 'request.payload.value.confirmedOutputs', issues);
    validateStringArray(value.missingOutputs, 'request.payload.value.missingOutputs', issues);
    validateBoolean(value.targetBound, 'request.payload.value.targetBound', issues);
    validateBoolean(value.reviewedPreviewBound, 'request.payload.value.reviewedPreviewBound', issues);
    validateBoolean(value.sourceHistoryStateBound, 'request.payload.value.sourceHistoryStateBound', issues);
    validateLiteralBoundaries(value.boundaries, {
        manifestRequirementsOnly: true,
        explicitReceiptRequired: true,
        sameTargetPreviewRequired: true,
        exactSourceHistoryRequired: true,
        qualityVerdictAuthority: false,
        grantsPermission: false,
        executesTools: false
    }, issues);
    if (!readStrictRuntimeDeliveryVerification(value)) {
        addIssue(
            issues,
            'declaration_shape_invalid',
            'request.payload.value',
            'Delivery Verification 必须是严格且内部一致的 Runtime 核验结果。'
        );
    }
}

function normalizedFieldName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isForbiddenRuntimePayloadKey(key: string, allowRootPayload: boolean): boolean {
    const normalized = normalizedFieldName(key);
    if (allowRootPayload && normalized === 'payload') return false;
    return FORBIDDEN_RUNTIME_PAYLOAD_KEYS.has(normalized)
        || normalized.endsWith('path')
        || normalized.includes('base64');
}

function scanRuntimePayloadAuthorityLeaks(
    value: unknown,
    path: string,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    const seen = new Set<object>();
    const state = { nodes: 0, overflowReported: false };
    scanRuntimePayloadNode(value, path, 0, true, seen, state, issues);
}

function scanRuntimePayloadNode(
    value: unknown,
    path: string,
    depth: number,
    allowRootPayload: boolean,
    seen: Set<object>,
    state: { nodes: number; overflowReported: boolean },
    issues: ArtifactPublicationPolicyIssue[]
): void {
    if (depth > MAX_AUTHORITY_SCAN_DEPTH || state.nodes >= MAX_AUTHORITY_SCAN_NODES) {
        if (!state.overflowReported) {
            state.overflowReported = true;
            addIssue(issues, 'payload_scan_limit_exceeded', path, 'Runtime payload 超出安全递归扫描上限。');
        }
        return;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        if (typeof value === 'string'
            && (/^data:[^,]*;base64,/i.test(value) || /^file:/i.test(value))) {
            addIssue(issues, 'authority_value_forbidden', path, 'Runtime payload 不得内嵌 data URL/base64 或 file URI。');
        }
        return;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            addIssue(issues, 'non_json_value', path, 'Runtime payload 数字必须是有限数。');
        }
        return;
    }
    if (typeof value !== 'object') {
        addIssue(issues, 'non_json_value', path, 'Runtime payload 只能包含 JSON 值。');
        return;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        addIssue(issues, 'binary_value_forbidden', path, 'Runtime JSON payload 不得内嵌二进制值。');
        return;
    }
    if (seen.has(value)) {
        addIssue(issues, 'cyclic_value_forbidden', path, 'Runtime payload 不得包含循环引用。');
        return;
    }
    seen.add(value);
    state.nodes += 1;
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            scanRuntimePayloadNode(item, `${path}[${index}]`, depth + 1, false, seen, state, issues);
        });
        seen.delete(value);
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (isForbiddenRuntimePayloadKey(key, allowRootPayload)) {
            addIssue(
                issues,
                'authority_field_forbidden',
                childPath,
                `Runtime payload 不得携带 ${key} 权威或载荷字段。`
            );
        }
        scanRuntimePayloadNode(child, childPath, depth + 1, false, seen, state, issues);
    }
    seen.delete(value);
}

function sameArtifactRef(left: ArtifactRef, right: ArtifactRef): boolean {
    return left.artifactId === right.artifactId
        && left.artifactType === right.artifactType
        && left.contentHash === right.contentHash;
}

function validateSourceRefs(
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
): ArtifactRef[] {
    if (!Array.isArray(value) || value.length > MAX_ARTIFACT_REFS) {
        addIssue(issues, 'source_refs_invalid', 'request.sourceRefs', 'sourceRefs 必须是有界数组。');
        return [];
    }
    const refs: ArtifactRef[] = [];
    const artifactIds = new Set<string>();
    value.forEach((candidate, index) => {
        const ref = readArtifactRef(candidate);
        if (!ref) {
            addIssue(
                issues,
                'source_ref_not_strict',
                `request.sourceRefs[${index}]`,
                'sourceRefs 只允许严格三字段 ArtifactRef。'
            );
            return;
        }
        if (artifactIds.has(ref.artifactId)) {
            addIssue(
                issues,
                'source_ref_duplicate',
                `request.sourceRefs[${index}]`,
                `sourceRefs 重复 artifactId ${ref.artifactId}。`
            );
            return;
        }
        artifactIds.add(ref.artifactId);
        refs.push(ref);
    });
    return refs;
}

function requireStrictSourceRef(
    candidate: unknown,
    path: string,
    sourceRefs: readonly ArtifactRef[],
    issues: ArtifactPublicationPolicyIssue[],
    weakValidatorAlreadyReported: boolean
): void {
    if (!isRecord(candidate)) {
        if (!weakValidatorAlreadyReported) {
            addIssue(issues, 'upstream_ref_missing', path, `${path} 必须是 ArtifactRef。`);
        }
        return;
    }
    const ref = readArtifactRef(candidate);
    if (!ref) {
        addIssue(issues, 'upstream_ref_not_strict', path, `${path} 只允许严格三字段 ArtifactRef。`);
        return;
    }
    if (!sourceRefs.some((sourceRef) => sameArtifactRef(sourceRef, ref))) {
        addIssue(
            issues,
            'upstream_ref_not_in_source_refs',
            path,
            `${path} 必须精确存在于 request.sourceRefs。`
        );
    }
}

function validateLegacyAndCrossArtifactRefs(
    artifactType: V5ArtifactType,
    payload: unknown,
    sourceRefs: readonly ArtifactRef[],
    issues: ArtifactPublicationPolicyIssue[]
): void {
    const body = isRecord(payload) ? payload : {};
    const legacyType = artifactType === V5_ARTIFACT_TYPES.creativeStrategy
        || artifactType === V5_ARTIFACT_TYPES.detailPagePlan
        || artifactType === V5_ARTIFACT_TYPES.reviewReport;
    if (legacyType) {
        const upstream = validateUpstreamRefs(artifactType, payload);
        for (const issue of upstream.issues) {
            addIssue(issues, issue.code, issue.path, issue.message);
        }
    }

    if (artifactType === V5_ARTIFACT_TYPES.creativeStrategy) {
        requireStrictSourceRef(body.contextSnapshotRef, 'payload.contextSnapshotRef', sourceRefs, issues, true);
    } else if (artifactType === V5_ARTIFACT_TYPES.detailPagePlan) {
        requireStrictSourceRef(body.contextSnapshotRef, 'payload.contextSnapshotRef', sourceRefs, issues, true);
        requireStrictSourceRef(body.creativeStrategyRef, 'payload.creativeStrategyRef', sourceRefs, issues, true);
    } else if (artifactType === V5_ARTIFACT_TYPES.reviewReport) {
        requireStrictSourceRef(body.subjectRef, 'payload.subjectRef', sourceRefs, issues, true);
    } else if (artifactType === V5_ARTIFACT_TYPES.contextSnapshot) {
        requireStrictSourceRef(body.briefRef, 'payload.briefRef', sourceRefs, issues, false);
    } else if (artifactType === V5_ARTIFACT_TYPES.previewScene) {
        requireStrictSourceRef(body.planRef, 'payload.planRef', sourceRefs, issues, false);
    } else if (artifactType === V5_ARTIFACT_TYPES.approvalRecord) {
        const subject = isRecord(body.subject) ? body.subject : {};
        requireStrictSourceRef(
            subject.previewSceneRef,
            'payload.subject.previewSceneRef',
            sourceRefs,
            issues,
            false
        );
        requireStrictSourceRef(
            subject.reviewReportRef,
            'payload.subject.reviewReportRef',
            sourceRefs,
            issues,
            false
        );
    }
}

function validateAuthority(
    authority: ArtifactPublicationAuthority,
    transport: ArtifactPublicationTransport,
    artifactType: V5ArtifactType,
    request: Record<string, unknown>,
    issues: ArtifactPublicationPolicyIssue[]
): void {
    const runtimeBinding = request.runtimeBinding;
    if (authority === 'runtime_renderer') {
        if (transport !== 'renderer_ipc') {
            addIssue(issues, 'authority_transport_mismatch', 'transport', 'runtime_renderer 只允许 renderer_ipc。');
        }
        if (!RUNTIME_RENDERER_ARTIFACT_TYPES.has(artifactType)) {
            addIssue(
                issues,
                'runtime_artifact_type_forbidden',
                'request.artifactType',
                `runtime_renderer 不得发布 ${artifactType}。`
            );
        }
        if (!isArtifactRuntimeBinding(runtimeBinding)) {
            addIssue(
                issues,
                'runtime_binding_required',
                'request.runtimeBinding',
                'runtime_renderer 发布必须绑定严格 sessionId/runId/generation。'
            );
        } else {
            if (request.sourceRevision !== runtimeBinding.generation) {
                addIssue(
                    issues,
                    'runtime_revision_mismatch',
                    'request.sourceRevision',
                    'Runtime Artifact sourceRevision 必须等于当前 generation。'
                );
            }
            if (request.artifactId !== buildRuntimeArtifactId(artifactType, runtimeBinding)) {
                addIssue(
                    issues,
                    'runtime_artifact_id_mismatch',
                    'request.artifactId',
                    'Runtime Artifact ID 必须由主进程根据 type 与 Runtime identity 生成。'
                );
            }
        }
        if (request.capabilityStatus !== 'manual_verification_pending') {
            addIssue(
                issues,
                'runtime_capability_status_forbidden',
                'request.capabilityStatus',
                'Renderer 不得把 Runtime Artifact 能力状态提升为已实机验证。'
            );
        }
        if (request.modelProfile !== undefined) {
            addIssue(
                issues,
                'runtime_model_profile_forbidden',
                'request.modelProfile',
                'Renderer 收尾不得自报 modelProfile 权威。'
            );
        }
        return;
    }

    if (transport !== 'main_process') {
        addIssue(issues, 'authority_transport_mismatch', 'transport', `${authority} 不得通过 renderer_ipc 发布。`);
    }
    if (authority === 'approval_service') {
        if (artifactType !== V5_ARTIFACT_TYPES.approvalRecord) {
            addIssue(
                issues,
                'approval_artifact_type_forbidden',
                'request.artifactType',
                'approval_service 只能发布 approval_record。'
            );
        }
        if (runtimeBinding !== undefined) {
            addIssue(
                issues,
                'approval_runtime_binding_forbidden',
                'request.runtimeBinding',
                'approval_record 不得伪装为 Runtime scope Artifact。'
            );
        }
        return;
    }

    if (artifactType === V5_ARTIFACT_TYPES.approvalRecord) {
        addIssue(
            issues,
            'internal_approval_forbidden',
            'request.artifactType',
            'internal authority 不得替代 ApprovalService 发布 approval_record。'
        );
    }
    if (runtimeBinding !== undefined && !isArtifactRuntimeBinding(runtimeBinding)) {
        addIssue(issues, 'runtime_binding_invalid', 'request.runtimeBinding', 'internal runtimeBinding 结构非法。');
    }
}

function validatePayloadEnvelope(
    artifactType: V5ArtifactType,
    value: unknown,
    issues: ArtifactPublicationPolicyIssue[]
): unknown {
    if (!isRecord(value)) {
        addIssue(issues, 'payload_envelope_invalid', 'request.payload', 'Artifact payload envelope 必须是对象。');
        return undefined;
    }
    const expectedKind = BINARY_ARTIFACT_TYPES.has(artifactType) ? 'binary' : 'json';
    if (value.kind !== expectedKind) {
        addIssue(
            issues,
            'payload_kind_mismatch',
            'request.payload.kind',
            `${artifactType} 必须使用 ${expectedKind} payload。`
        );
        return undefined;
    }
    if (expectedKind === 'json') {
        validateExactObject(value, ['kind', 'value'], [], 'request.payload', issues);
        if (value.value === undefined) {
            addIssue(issues, 'json_value_required', 'request.payload.value', 'JSON Artifact 必须携带 value。');
        }
        return value.value;
    }
    validateExactObject(value, ['kind', 'bytes'], ['mediaType', 'fileName'], 'request.payload', issues);
    if (!(value.bytes instanceof Uint8Array) && !ArrayBuffer.isView(value.bytes) && !(value.bytes instanceof ArrayBuffer)) {
        addIssue(issues, 'binary_bytes_required', 'request.payload.bytes', 'Binary Artifact 必须携带二进制 bytes。');
    }
    return undefined;
}

/**
 * 发布前 fail-closed 策略。调用方可把 issues 转换为自身错误类型后再抛出；本函数本身无副作用。
 */
export function validateArtifactPublicationPolicy(
    input: ArtifactPublicationPolicyInput
): ArtifactPublicationPolicyResult {
    const issues: ArtifactPublicationPolicyIssue[] = [];
    if (!isRecord(input.request)) {
        return {
            ok: false,
            issues: [{ code: 'request_invalid', path: 'request', message: 'Artifact 发布请求必须是对象。' }]
        };
    }
    const request = input.request;
    if (!isCanonicalArtifactType(request.artifactType)) {
        addIssue(
            issues,
            'artifact_type_unknown',
            'request.artifactType',
            `未知 Artifact 类型：${String(request.artifactType)}`
        );
        return { ok: false, issues };
    }
    const artifactType = request.artifactType;
    const sourceRefs = validateSourceRefs(request.sourceRefs, issues);
    const authority = input.authority as string;
    const transport = input.transport as string;
    if (!['runtime_renderer', 'approval_service', 'internal'].includes(authority)) {
        addIssue(issues, 'authority_unknown', 'authority', `未知发布 authority：${authority}`);
    } else if (!['renderer_ipc', 'main_process'].includes(transport)) {
        addIssue(issues, 'transport_unknown', 'transport', `未知发布 transport：${transport}`);
    } else {
        validateAuthority(
            authority as ArtifactPublicationAuthority,
            transport as ArtifactPublicationTransport,
            artifactType,
            request,
            issues
        );
    }
    const jsonPayload = validatePayloadEnvelope(artifactType, request.payload, issues);

    if (jsonPayload !== undefined) {
        const validator = RUNTIME_JSON_VALIDATORS[artifactType];
        if (validator) {
            validator(jsonPayload, issues);
            scanRuntimePayloadAuthorityLeaks(jsonPayload, 'request.payload.value', issues);
        }
        validateLegacyAndCrossArtifactRefs(artifactType, jsonPayload, sourceRefs, issues);
    }
    return { ok: issues.length === 0, issues };
}
