/**
 * R4 Runtime Action Plan / Semantic Design DSL Declaration。
 *
 * 模型负责声明动态步骤、依赖和语义版面；Harness 只校验真实 R3、Context、
 * Capability 与图结构。声明是只读计划投影，不调度 Tool、不授予权限、不执行 DAG。
 */

import type { AgentCapabilityResolution } from './contracts/capability-resolution';
import type { ElementPlan, LayoutRegion, MissingInput } from './contracts/common';
import { DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME } from './runtime-action-plan-control';
import type { RuntimeDesignStrategyDigest } from './runtime-design-strategy-declaration';
import type { RuntimeActionPlanResumeFreshness } from './runtime-action-plan-resume-freshness';
import { validateSemanticLayout } from './validators/contract-validators';

export { DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME } from './runtime-action-plan-control';
export {
    buildRuntimeActionPlanDeclarationFingerprint,
    buildRuntimeActionPlanReconciliationDigest,
    reconcileRuntimeActionPlanExecution
} from './runtime-action-plan-reconciliation';
export {
    buildRuntimeActionPlanNoRedoShadowDecision,
    buildRuntimeActionPlanNoRedoShadowDigest
} from './runtime-action-plan-no-redo-shadow';
export const CURRENT_R3_STRATEGY_REF = 'current:r3_design_strategy';

export type RuntimeActionPlanReadiness = 'ready' | 'needs_capability' | 'needs_input';
export type RuntimeActionPlanStepKind =
    | 'observe'
    | 'research'
    | 'compose_dsl'
    | 'preview'
    | 'mutate'
    | 'verify'
    | 'deliver'
    | 'request_input';
export type RuntimeActionPlanFailurePolicy =
    | 'replan'
    | 'retry_after_observation'
    | 'request_input'
    | 'enter_reflexion'
    | 'stop';
export type RuntimeActionPlanResumePolicy = 'reuse_completed_step' | 'redo_required';
export type RuntimeActionPlanResultKind =
    | 'project_context'
    | 'visual_observation'
    | 'knowledge_result'
    | 'runtime_context'
    | 'design_dsl'
    | 'preview'
    | 'document_change'
    | 'readback'
    | 'quality_report'
    | 'delivery_record'
    | 'user_confirmation'
    | 'generated_asset';

export interface RuntimeActionPlanResumeMapping {
    priorStepId: string;
    policy: RuntimeActionPlanResumePolicy;
}

export interface RuntimeActionPlanStep {
    stepId: string;
    kind: RuntimeActionPlanStepKind;
    goal: string;
    dependsOn: string[];
    parallelGroup?: string;
    capabilityRefs: string[];
    inputContextRefs: string[];
    expectedOutcomes: RuntimeActionPlanResultKind[];
    completionCriteria: string[];
    failurePolicy: RuntimeActionPlanFailurePolicy;
    resumeMapping?: RuntimeActionPlanResumeMapping;
}

export interface RuntimeSemanticDesignDsl {
    compositionIntent: string;
    regions: LayoutRegion[];
    elements: ElementPlan[];
    readingOrder: string[];
    constraints: string[];
}

export interface RuntimeActionPlanDeclarationPayload {
    planGoal: string;
    strategyRef: typeof CURRENT_R3_STRATEGY_REF;
    contextRefs: string[];
    steps: RuntimeActionPlanStep[];
    designDsl?: RuntimeSemanticDesignDsl;
    missingInputs: MissingInput[];
}

export interface RuntimeActionPlanGraphSummary {
    acyclic: true;
    rootStepIds: string[];
    terminalStepIds: string[];
    parallelGroups: string[];
}

export interface RuntimeActionPlanDeclaration {
    version: 'runtime-action-plan-declaration/v0';
    source: 'model_tool_call';
    readiness: RuntimeActionPlanReadiness;
    payload: RuntimeActionPlanDeclarationPayload;
    missingCapabilityRefs: string[];
    graph: RuntimeActionPlanGraphSummary;
    boundaries: {
        modelAuthored: true;
        harnessValidatedOnly: true;
        strategyAligned: true;
        categoryNeutral: true;
        semanticDslOnly: true;
        resumeMappingModelAuthored: true;
        shadowOnly: true;
        executable: false;
        schedulerAuthority: false;
        autoActivatesCapabilities: false;
        executesTools: false;
        grantsPermission: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
    };
}

export interface RuntimeActionPlanDigest {
    version: 'runtime-action-plan-digest/v0';
    readiness: RuntimeActionPlanReadiness;
    planGoal: string;
    strategyStageGoal: string;
    stepCount: number;
    stepKinds: RuntimeActionPlanStepKind[];
    rootStepIds: string[];
    terminalStepIds: string[];
    parallelGroupCount: number;
    capabilityRefs: string[];
    missingCapabilityRefs: string[];
    contextRefs: string[];
    designDsl?: {
        compositionIntent: string;
        regionCount: number;
        elementCount: number;
        readingOrder: string[];
    };
    missingInputCount: number;
    resumeReuseCount: number;
    resumeRedoRequiredCount: number;
    boundaries: {
        digestOnly: true;
        modelAuthored: true;
        shadowOnly: true;
        executable: false;
        changesTaskResult: false;
    };
}

export interface RuntimeActionPlanCapabilityContext {
    discoveredCapabilityRefs: string[];
    activeActionCapabilityRefs: string[];
    onDemandActionCapabilityRefs: string[];
}

export interface RuntimeActionPlanValidationIssue {
    code: string;
    path: string;
}

export interface RuntimeActionPlanValidationResult {
    ok: boolean;
    readiness: 'invalid' | RuntimeActionPlanReadiness;
    declaration?: RuntimeActionPlanDeclaration;
    issues: RuntimeActionPlanValidationIssue[];
}

export interface RuntimeActionPlanToolSchema {
    name: typeof DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required: string[];
        additionalProperties: false;
    };
}

const MAX_TEXT = 360;
const MAX_LONG_TEXT = 720;
const MAX_STEPS = 12;
const MAX_REGIONS = 24;
const MAX_ELEMENTS = 32;
const MAX_LIST = 16;
const MAX_ISSUES = 50;
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|tmp|var|private)\/)/;
const DATA_URL_PATTERN = /data:[^;,]{1,80}(?:;base64)?,/i;
const BASE64_PATTERN = /[A-Za-z0-9+/]{180,}={0,2}/;
const STEP_KINDS: readonly RuntimeActionPlanStepKind[] = Object.freeze([
    'observe', 'research', 'compose_dsl', 'preview', 'mutate', 'verify', 'deliver', 'request_input'
]);
const FAILURE_POLICIES: readonly RuntimeActionPlanFailurePolicy[] = Object.freeze([
    'replan', 'retry_after_observation', 'request_input', 'enter_reflexion', 'stop'
]);
const RESUME_POLICIES: readonly RuntimeActionPlanResumePolicy[] = Object.freeze([
    'reuse_completed_step', 'redo_required'
]);
const RESULT_KINDS: readonly RuntimeActionPlanResultKind[] = Object.freeze([
    'project_context', 'visual_observation', 'knowledge_result', 'runtime_context', 'design_dsl',
    'preview', 'document_change', 'readback', 'quality_report', 'delivery_record',
    'user_confirmation', 'generated_asset'
]);
const REGION_ROLES: readonly LayoutRegion['role'][] = Object.freeze([
    'primary_visual', 'secondary_visual', 'headline', 'supporting_copy', 'tag_cluster',
    'feature_detail', 'parameters', 'brand', 'decoration'
]);
const ELEMENT_ROLES: readonly ElementPlan['role'][] = Object.freeze([
    'feature_icon', 'badge', 'divider', 'callout', 'background_shape', 'decoration'
]);
const ELEMENT_TYPES: readonly ElementPlan['elementType'][] = Object.freeze([
    'shape', 'icon', 'line', 'badge', 'decoration'
]);
const TRANSFORM_ANCHORS: readonly NonNullable<ElementPlan['transform']>['anchor'][] = Object.freeze([
    'center', 'top_left', 'top_right', 'bottom_left', 'bottom_right'
]);

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function addIssue(issues: RuntimeActionPlanValidationIssue[], code: string, path: string): void {
    if (issues.length >= MAX_ISSUES) return;
    if (issues.some((issue) => issue.code === code && issue.path === path)) return;
    issues.push({ code, path });
}

function validateKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    issues: RuntimeActionPlanValidationIssue[]
): void {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) addIssue(issues, 'unknown_field', `${path}.${key}`);
    }
}

function hasSensitivePayload(value: string): boolean {
    return LOCAL_PATH_PATTERN.test(value) || DATA_URL_PATTERN.test(value) || BASE64_PATTERN.test(value);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasImplementationDetail(value: string, forbiddenToolNames: readonly string[]): boolean {
    if (/\b(?:toolName|toolId|operation|arguments|params|layerId|layerName|actionDescriptor|executeTool)\b/i.test(value)) {
        return true;
    }
    if (/\b(?:create|set|get|move|render|export|delete|duplicate|select)[A-Z][A-Za-z0-9]+\b/.test(value)) {
        return true;
    }
    if (/\b(?:Photoshop|UXP|batchPlay|PSD API|PS API)\b/i.test(value)) return true;
    if (/(?:图层名|工具编号|工具调用|Photoshop\s*命令|像素坐标)/i.test(value)) return true;
    if (/\b(?:x|y|width|height)\s*[:=]\s*-?\d/i.test(value)) return true;
    return unique(forbiddenToolNames).some((toolName) => (
        toolName.length >= 5 && new RegExp(escapeRegExp(toolName), 'i').test(value)
    ));
}

function readText(input: {
    value: unknown;
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
    forbiddenToolNames: readonly string[];
    required?: boolean;
    maxLength?: number;
}): string {
    if (typeof input.value !== 'string') {
        if (input.required || input.value !== undefined) addIssue(input.issues, 'text_required', input.path);
        return '';
    }
    const text = input.value.trim();
    if (input.required && !text) addIssue(input.issues, 'text_required', input.path);
    if (text.length > (input.maxLength || MAX_TEXT)) addIssue(input.issues, 'text_too_long', input.path);
    if (hasSensitivePayload(text)) addIssue(input.issues, 'sensitive_payload_forbidden', input.path);
    if (hasImplementationDetail(text, input.forbiddenToolNames)) {
        addIssue(input.issues, 'implementation_detail_forbidden', input.path);
    }
    return text;
}

function readId(input: {
    value: unknown;
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
    required?: boolean;
}): string {
    const value = typeof input.value === 'string' ? input.value.trim() : '';
    if (input.required && !value) addIssue(input.issues, 'id_required', input.path);
    if (value && !ID_PATTERN.test(value)) addIssue(input.issues, 'id_invalid', input.path);
    return value;
}

function readReferenceList(input: {
    value: unknown;
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
    requiredItems?: number;
    maxItems?: number;
}): string[] {
    if (!Array.isArray(input.value)) {
        addIssue(input.issues, 'array_required', input.path);
        return [];
    }
    const maxItems = input.maxItems || MAX_LIST;
    if (input.value.length > maxItems) addIssue(input.issues, 'array_too_long', input.path);
    const refs = input.value.slice(0, maxItems).map((item, index) => {
        const ref = typeof item === 'string' ? item.trim() : '';
        if (!ref) addIssue(input.issues, 'reference_required', `${input.path}[${index}]`);
        if (ref.length > 180) addIssue(input.issues, 'reference_too_long', `${input.path}[${index}]`);
        if (hasSensitivePayload(ref)) addIssue(input.issues, 'sensitive_payload_forbidden', `${input.path}[${index}]`);
        return ref;
    }).filter(Boolean);
    if (refs.length < (input.requiredItems || 0)) addIssue(input.issues, 'array_items_missing', input.path);
    if (new Set(refs).size !== refs.length) addIssue(input.issues, 'array_items_duplicate', input.path);
    return refs;
}

function readSingleReference(input: {
    value: unknown;
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
    required?: boolean;
}): string {
    const ref = typeof input.value === 'string' ? input.value.trim() : '';
    if (input.required && !ref) addIssue(input.issues, 'reference_required', input.path);
    if (ref.length > 180) addIssue(input.issues, 'reference_too_long', input.path);
    if (ref && hasSensitivePayload(ref)) addIssue(input.issues, 'sensitive_payload_forbidden', input.path);
    return ref;
}

function readTextList(input: {
    value: unknown;
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
    forbiddenToolNames: readonly string[];
    requiredItems?: number;
    maxItems?: number;
}): string[] {
    if (!Array.isArray(input.value)) {
        addIssue(input.issues, 'array_required', input.path);
        return [];
    }
    const maxItems = input.maxItems || MAX_LIST;
    if (input.value.length > maxItems) addIssue(input.issues, 'array_too_long', input.path);
    const values = input.value.slice(0, maxItems).map((item, index) => readText({
        value: item,
        path: `${input.path}[${index}]`,
        issues: input.issues,
        forbiddenToolNames: input.forbiddenToolNames,
        required: true
    })).filter(Boolean);
    if (values.length < (input.requiredItems || 0)) addIssue(input.issues, 'array_items_missing', input.path);
    if (new Set(values).size !== values.length) addIssue(input.issues, 'array_items_duplicate', input.path);
    return values;
}

function readEnum<T extends string>(input: {
    value: unknown;
    allowed: readonly T[];
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
    fallback: T;
}): T {
    const value = String(input.value || '').trim();
    if (!input.allowed.includes(value as T)) addIssue(input.issues, 'enum_invalid', input.path);
    return input.allowed.includes(value as T) ? value as T : input.fallback;
}

function readFiniteNumber(input: {
    value: unknown;
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
    minimum: number;
    maximum: number;
    integer?: boolean;
    fallback: number;
}): number {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < input.minimum || value > input.maximum) {
        addIssue(input.issues, 'number_out_of_range', input.path);
        return input.fallback;
    }
    if (input.integer && !Number.isInteger(value)) {
        addIssue(input.issues, 'integer_required', input.path);
        return input.fallback;
    }
    return value;
}

function readMissingInputs(
    value: unknown,
    issues: RuntimeActionPlanValidationIssue[],
    forbiddenToolNames: readonly string[]
): MissingInput[] {
    if (!Array.isArray(value)) {
        addIssue(issues, 'array_required', 'missingInputs');
        return [];
    }
    if (value.length > 8) addIssue(issues, 'array_too_long', 'missingInputs');
    const ids = new Set<string>();
    return value.slice(0, 8).map((item, index) => {
        const path = `missingInputs[${index}]`;
        const record = isObject(item) ? item : {};
        if (!isObject(item)) addIssue(issues, 'object_required', path);
        validateKeys(record, ['inputId', 'field', 'question', 'severity', 'defaultPolicy'], path, issues);
        const inputId = readId({ value: record.inputId, path: `${path}.inputId`, issues, required: true });
        if (ids.has(inputId)) addIssue(issues, 'id_duplicate', `${path}.inputId`);
        ids.add(inputId);
        const severity = readEnum({
            value: record.severity,
            allowed: ['blocking', 'degradable', 'optional'] as const,
            path: `${path}.severity`,
            issues,
            fallback: 'blocking'
        });
        const defaultPolicy = readText({
            value: record.defaultPolicy,
            path: `${path}.defaultPolicy`,
            issues,
            forbiddenToolNames
        });
        return {
            inputId,
            field: readText({
                value: record.field,
                path: `${path}.field`,
                issues,
                forbiddenToolNames,
                required: true
            }),
            question: readText({
                value: record.question,
                path: `${path}.question`,
                issues,
                forbiddenToolNames,
                required: true
            }),
            severity,
            ...(defaultPolicy ? { defaultPolicy } : {})
        };
    });
}

function readStep(
    value: unknown,
    index: number,
    issues: RuntimeActionPlanValidationIssue[],
    forbiddenToolNames: readonly string[]
): RuntimeActionPlanStep {
    const path = `steps[${index}]`;
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', path);
    validateKeys(
        record,
        [
            'stepId', 'kind', 'goal', 'dependsOn', 'parallelGroup', 'capabilityRefs',
            'inputContextRefs', 'expectedOutcomes', 'completionCriteria', 'failurePolicy',
            'resumeMapping'
        ],
        path,
        issues
    );
    const parallelGroup = readId({ value: record.parallelGroup, path: `${path}.parallelGroup`, issues });
    const expectedOutcomes = readReferenceList({
        value: record.expectedOutcomes,
        path: `${path}.expectedOutcomes`,
        issues,
        requiredItems: 1,
        maxItems: 8
    }).map((item, outcomeIndex) => {
        if (!RESULT_KINDS.includes(item as RuntimeActionPlanResultKind)) {
            addIssue(issues, 'expected_outcome_invalid', `${path}.expectedOutcomes[${outcomeIndex}]`);
            return 'project_context';
        }
        return item as RuntimeActionPlanResultKind;
    });
    const dependsOn = readReferenceList({
        value: record.dependsOn,
        path: `${path}.dependsOn`,
        issues,
        maxItems: MAX_STEPS
    });
    dependsOn.forEach((dependency, dependencyIndex) => {
        if (!ID_PATTERN.test(dependency)) addIssue(issues, 'id_invalid', `${path}.dependsOn[${dependencyIndex}]`);
    });
    const resumeMappingRecord = isObject(record.resumeMapping) ? record.resumeMapping : undefined;
    if (record.resumeMapping !== undefined && !resumeMappingRecord) {
        addIssue(issues, 'object_required', `${path}.resumeMapping`);
    }
    if (resumeMappingRecord) {
        validateKeys(
            resumeMappingRecord,
            ['priorStepId', 'policy'],
            `${path}.resumeMapping`,
            issues
        );
    }
    const resumeMapping = resumeMappingRecord
        ? {
            priorStepId: readId({
                value: resumeMappingRecord.priorStepId,
                path: `${path}.resumeMapping.priorStepId`,
                issues,
                required: true
            }),
            policy: readEnum({
                value: resumeMappingRecord.policy,
                allowed: RESUME_POLICIES,
                path: `${path}.resumeMapping.policy`,
                issues,
                fallback: 'reuse_completed_step'
            })
        }
        : undefined;
    return {
        stepId: readId({ value: record.stepId, path: `${path}.stepId`, issues, required: true }),
        kind: readEnum({ value: record.kind, allowed: STEP_KINDS, path: `${path}.kind`, issues, fallback: 'observe' }),
        goal: readText({ value: record.goal, path: `${path}.goal`, issues, forbiddenToolNames, required: true }),
        dependsOn,
        ...(parallelGroup ? { parallelGroup } : {}),
        capabilityRefs: readReferenceList({
            value: record.capabilityRefs,
            path: `${path}.capabilityRefs`,
            issues,
            maxItems: 10
        }),
        inputContextRefs: readReferenceList({
            value: record.inputContextRefs,
            path: `${path}.inputContextRefs`,
            issues,
            requiredItems: 1,
            maxItems: 10
        }),
        expectedOutcomes,
        completionCriteria: readTextList({
            value: record.completionCriteria,
            path: `${path}.completionCriteria`,
            issues,
            forbiddenToolNames,
            requiredItems: 1,
            maxItems: 8
        }),
        failurePolicy: readEnum({
            value: record.failurePolicy,
            allowed: FAILURE_POLICIES,
            path: `${path}.failurePolicy`,
            issues,
            fallback: 'replan'
        }),
        ...(resumeMapping ? { resumeMapping } : {})
    };
}

function readRegion(
    value: unknown,
    index: number,
    issues: RuntimeActionPlanValidationIssue[]
): LayoutRegion {
    const path = `designDsl.regions[${index}]`;
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', path);
    validateKeys(record, ['regionId', 'role', 'bounds', 'zIndex', 'alignment', 'overflow'], path, issues);
    const bounds = isObject(record.bounds) ? record.bounds : {};
    if (!isObject(record.bounds)) addIssue(issues, 'object_required', `${path}.bounds`);
    validateKeys(bounds, ['x', 'y', 'width', 'height'], `${path}.bounds`, issues);
    const alignment = isObject(record.alignment) ? record.alignment : {};
    if (!isObject(record.alignment)) addIssue(issues, 'object_required', `${path}.alignment`);
    validateKeys(alignment, ['horizontal', 'vertical'], `${path}.alignment`, issues);
    return {
        regionId: readId({ value: record.regionId, path: `${path}.regionId`, issues, required: true }),
        role: readEnum({ value: record.role, allowed: REGION_ROLES, path: `${path}.role`, issues, fallback: 'decoration' }),
        bounds: {
            x: readFiniteNumber({ value: bounds.x, path: `${path}.bounds.x`, issues, minimum: 0, maximum: 1, fallback: 0 }),
            y: readFiniteNumber({ value: bounds.y, path: `${path}.bounds.y`, issues, minimum: 0, maximum: 1, fallback: 0 }),
            width: readFiniteNumber({ value: bounds.width, path: `${path}.bounds.width`, issues, minimum: Number.EPSILON, maximum: 1, fallback: 1 }),
            height: readFiniteNumber({ value: bounds.height, path: `${path}.bounds.height`, issues, minimum: Number.EPSILON, maximum: 1, fallback: 1 })
        },
        zIndex: readFiniteNumber({ value: record.zIndex, path: `${path}.zIndex`, issues, minimum: 0, maximum: 100, integer: true, fallback: 0 }),
        alignment: {
            horizontal: readEnum({
                value: alignment.horizontal,
                allowed: ['start', 'center', 'end', 'stretch'] as const,
                path: `${path}.alignment.horizontal`,
                issues,
                fallback: 'start'
            }),
            vertical: readEnum({
                value: alignment.vertical,
                allowed: ['start', 'center', 'end', 'stretch'] as const,
                path: `${path}.alignment.vertical`,
                issues,
                fallback: 'start'
            })
        },
        overflow: readEnum({
            value: record.overflow,
            allowed: ['clip', 'visible'] as const,
            path: `${path}.overflow`,
            issues,
            fallback: 'clip'
        })
    };
}

function readElement(
    value: unknown,
    index: number,
    issues: RuntimeActionPlanValidationIssue[]
): ElementPlan {
    const path = `designDsl.elements[${index}]`;
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', path);
    validateKeys(record, ['elementId', 'role', 'elementType', 'regionId', 'source', 'styleTokenRefs', 'transform', 'required'], path, issues);
    const source = isObject(record.source) ? record.source : undefined;
    if (record.source !== undefined && !source) addIssue(issues, 'object_required', `${path}.source`);
    if (source) validateKeys(source, ['kind', 'refId'], `${path}.source`, issues);
    const transform = isObject(record.transform) ? record.transform : undefined;
    if (record.transform !== undefined && !transform) addIssue(issues, 'object_required', `${path}.transform`);
    if (transform) {
        validateKeys(transform, ['anchor', 'offsetX', 'offsetY', 'scale', 'rotationDeg'], `${path}.transform`, issues);
    }
    const styleTokenRefs = readReferenceList({
        value: record.styleTokenRefs,
        path: `${path}.styleTokenRefs`,
        issues,
        maxItems: 12
    });
    if (typeof record.required !== 'boolean') addIssue(issues, 'boolean_required', `${path}.required`);
    return {
        elementId: readId({ value: record.elementId, path: `${path}.elementId`, issues, required: true }),
        role: readEnum({ value: record.role, allowed: ELEMENT_ROLES, path: `${path}.role`, issues, fallback: 'decoration' }),
        elementType: readEnum({
            value: record.elementType,
            allowed: ELEMENT_TYPES,
            path: `${path}.elementType`,
            issues,
            fallback: 'decoration'
        }),
        regionId: readId({ value: record.regionId, path: `${path}.regionId`, issues, required: true }),
        ...(source ? {
            source: {
                kind: readEnum({
                    value: source.kind,
                    allowed: ['icon', 'asset', 'token'] as const,
                    path: `${path}.source.kind`,
                    issues,
                    fallback: 'token'
                }),
                refId: readSingleReference({
                    value: source.refId,
                    path: `${path}.source.refId`,
                    issues,
                    required: true
                })
            }
        } : {}),
        styleTokenRefs,
        ...(transform ? {
            transform: {
                anchor: readEnum({
                    value: transform.anchor,
                    allowed: TRANSFORM_ANCHORS,
                    path: `${path}.transform.anchor`,
                    issues,
                    fallback: 'center'
                }),
                offsetX: readFiniteNumber({ value: transform.offsetX, path: `${path}.transform.offsetX`, issues, minimum: -1, maximum: 1, fallback: 0 }),
                offsetY: readFiniteNumber({ value: transform.offsetY, path: `${path}.transform.offsetY`, issues, minimum: -1, maximum: 1, fallback: 0 }),
                scale: readFiniteNumber({ value: transform.scale, path: `${path}.transform.scale`, issues, minimum: Number.EPSILON, maximum: 10, fallback: 1 }),
                rotationDeg: readFiniteNumber({ value: transform.rotationDeg, path: `${path}.transform.rotationDeg`, issues, minimum: -180, maximum: 180, fallback: 0 })
            }
        } : {}),
        required: record.required === true
    };
}

function readDesignDsl(
    value: unknown,
    issues: RuntimeActionPlanValidationIssue[],
    forbiddenToolNames: readonly string[]
): RuntimeSemanticDesignDsl | undefined {
    if (value === undefined) return undefined;
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', 'designDsl');
    validateKeys(record, ['compositionIntent', 'regions', 'elements', 'readingOrder', 'constraints'], 'designDsl', issues);
    const regionValues = Array.isArray(record.regions) ? record.regions : [];
    const elementValues = Array.isArray(record.elements) ? record.elements : [];
    if (!Array.isArray(record.regions)) addIssue(issues, 'array_required', 'designDsl.regions');
    if (!Array.isArray(record.elements)) addIssue(issues, 'array_required', 'designDsl.elements');
    if (regionValues.length > MAX_REGIONS) addIssue(issues, 'array_too_long', 'designDsl.regions');
    if (elementValues.length > MAX_ELEMENTS) addIssue(issues, 'array_too_long', 'designDsl.elements');
    const regions = regionValues.slice(0, MAX_REGIONS).map((item, index) => readRegion(item, index, issues));
    const elements = elementValues.slice(0, MAX_ELEMENTS).map((item, index) => readElement(item, index, issues));
    const readingOrder = readReferenceList({
        value: record.readingOrder,
        path: 'designDsl.readingOrder',
        issues,
        maxItems: MAX_REGIONS
    });
    const regionIds = new Set(regions.map((region) => region.regionId).filter(Boolean));
    readingOrder.forEach((regionId, index) => {
        if (!regionIds.has(regionId)) addIssue(issues, 'reading_order_region_not_found', `designDsl.readingOrder[${index}]`);
    });
    const crossField = validateSemanticLayout({
        regions,
        elements
    });
    for (const issue of crossField.issues) {
        addIssue(issues, issue.code, issue.path.replace('payload.screens[0].layout.normalizedRegions', 'designDsl.regions')
            .replace('payload.screens[0].elements', 'designDsl.elements'));
    }
    return {
        compositionIntent: readText({
            value: record.compositionIntent,
            path: 'designDsl.compositionIntent',
            issues,
            forbiddenToolNames,
            required: true,
            maxLength: MAX_LONG_TEXT
        }),
        regions,
        elements,
        readingOrder,
        constraints: readTextList({
            value: record.constraints,
            path: 'designDsl.constraints',
            issues,
            forbiddenToolNames,
            maxItems: 12
        })
    };
}

function validateReferences(input: {
    refs: readonly string[];
    allowed: ReadonlySet<string>;
    code: string;
    path: string;
    issues: RuntimeActionPlanValidationIssue[];
}): void {
    input.refs.forEach((ref, index) => {
        if (!input.allowed.has(ref)) addIssue(input.issues, input.code, `${input.path}[${index}]`);
    });
}

function validateStepGraph(
    steps: readonly RuntimeActionPlanStep[],
    issues: RuntimeActionPlanValidationIssue[]
): RuntimeActionPlanGraphSummary {
    const stepById = new Map<string, RuntimeActionPlanStep>();
    steps.forEach((step, index) => {
        if (stepById.has(step.stepId)) addIssue(issues, 'step_id_duplicate', `steps[${index}].stepId`);
        stepById.set(step.stepId, step);
    });
    steps.forEach((step, index) => {
        step.dependsOn.forEach((dependency, dependencyIndex) => {
            if (dependency === step.stepId) addIssue(issues, 'step_self_dependency', `steps[${index}].dependsOn[${dependencyIndex}]`);
            if (!stepById.has(dependency)) addIssue(issues, 'step_dependency_not_found', `steps[${index}].dependsOn[${dependencyIndex}]`);
        });
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    let hasCycle = false;
    function visit(stepId: string): void {
        if (visiting.has(stepId)) {
            hasCycle = true;
            return;
        }
        if (visited.has(stepId)) return;
        visiting.add(stepId);
        for (const dependency of stepById.get(stepId)?.dependsOn || []) {
            if (stepById.has(dependency)) visit(dependency);
        }
        visiting.delete(stepId);
        visited.add(stepId);
    }
    steps.forEach((step) => visit(step.stepId));
    if (hasCycle) addIssue(issues, 'dependency_cycle', 'steps');
    const dependedOn = new Set(steps.flatMap((step) => step.dependsOn));
    return {
        acyclic: true,
        rootStepIds: steps.filter((step) => step.dependsOn.length === 0).map((step) => step.stepId),
        terminalStepIds: steps.filter((step) => !dependedOn.has(step.stepId)).map((step) => step.stepId),
        parallelGroups: unique(steps.map((step) => step.parallelGroup || ''))
    };
}

export function buildRuntimeActionPlanCapabilityContext(
    resolution: AgentCapabilityResolution | undefined
): RuntimeActionPlanCapabilityContext {
    if (!resolution) {
        return {
            discoveredCapabilityRefs: [],
            activeActionCapabilityRefs: [],
            onDemandActionCapabilityRefs: []
        };
    }
    const actionRefs = unique([
        ...resolution.selectedCapabilityIds,
        ...resolution.onDemandCapabilityIds
    ]);
    const references = resolution.references;
    return {
        discoveredCapabilityRefs: unique([
            ...actionRefs,
            ...references.knowledgeRefs,
            ...references.skillRefs,
            ...references.memoryRefs,
            ...references.evaluationRefs,
            ...references.policyRefs
        ]),
        activeActionCapabilityRefs: unique(resolution.selectedCapabilityIds),
        onDemandActionCapabilityRefs: unique(resolution.onDemandCapabilityIds)
    };
}

export function validateRuntimeActionPlanDeclaration(input: {
    value: unknown;
    strategyDigest?: RuntimeDesignStrategyDigest;
    allowedContextRefs: readonly string[];
    capabilityContext: RuntimeActionPlanCapabilityContext;
    resumeFreshness?: RuntimeActionPlanResumeFreshness;
    forbiddenToolNames?: readonly string[];
}): RuntimeActionPlanValidationResult {
    const issues: RuntimeActionPlanValidationIssue[] = [];
    const forbiddenToolNames = unique(input.forbiddenToolNames || []);
    if (!input.strategyDigest || input.strategyDigest.readiness !== 'ready') {
        addIssue(issues, 'strategy_not_ready', 'strategyRef');
    }
    const record = isObject(input.value) ? input.value : {};
    if (!isObject(input.value)) addIssue(issues, 'object_required', 'actionPlan');
    validateKeys(record, ['planGoal', 'strategyRef', 'contextRefs', 'steps', 'designDsl', 'missingInputs'], 'actionPlan', issues);
    const strategyRef = String(record.strategyRef || '').trim();
    if (strategyRef !== CURRENT_R3_STRATEGY_REF) addIssue(issues, 'strategy_ref_invalid', 'strategyRef');
    const contextRefs = readReferenceList({
        value: record.contextRefs,
        path: 'contextRefs',
        issues,
        requiredItems: 1,
        maxItems: 12
    });
    const allowedContext = new Set(unique(input.allowedContextRefs));
    validateReferences({
        refs: contextRefs,
        allowed: allowedContext,
        code: 'context_ref_not_available',
        path: 'contextRefs',
        issues
    });
    if (!contextRefs.includes('context:design_strategy')) {
        addIssue(issues, 'strategy_context_required', 'contextRefs');
    }
    const rawSteps = Array.isArray(record.steps) ? record.steps : [];
    if (!Array.isArray(record.steps)) addIssue(issues, 'array_required', 'steps');
    if (rawSteps.length < 1) addIssue(issues, 'array_items_missing', 'steps');
    if (rawSteps.length > MAX_STEPS) addIssue(issues, 'array_too_long', 'steps');
    const steps = rawSteps.slice(0, MAX_STEPS).map((item, index) => readStep(item, index, issues, forbiddenToolNames));
    const discoveredCapabilities = new Set(unique(input.capabilityContext.discoveredCapabilityRefs));
    const actionCapabilities = new Set(unique([
        ...input.capabilityContext.activeActionCapabilityRefs,
        ...input.capabilityContext.onDemandActionCapabilityRefs
    ]));
    const onDemandCapabilities = new Set(unique(input.capabilityContext.onDemandActionCapabilityRefs));
    const verifiedCompletedStepIds = new Set(
        input.resumeFreshness?.status === 'verified'
            ? unique(input.resumeFreshness.verifiedCompletedStepIds || [])
            : []
    );
    const verifiedPendingStepIds = new Set(
        input.resumeFreshness?.status === 'verified'
            ? unique(input.resumeFreshness.verifiedResumeStepIds || [])
            : []
    );
    const mappedPriorStepIds = new Set<string>();
    steps.forEach((step, stepIndex) => {
        validateReferences({
            refs: step.capabilityRefs,
            allowed: discoveredCapabilities,
            code: 'capability_ref_not_discovered',
            path: `steps[${stepIndex}].capabilityRefs`,
            issues
        });
        validateReferences({
            refs: step.inputContextRefs,
            allowed: allowedContext,
            code: 'context_ref_not_available',
            path: `steps[${stepIndex}].inputContextRefs`,
            issues
        });
        if (['preview', 'mutate', 'deliver'].includes(step.kind)
            && !step.capabilityRefs.some((ref) => actionCapabilities.has(ref))) {
            addIssue(issues, 'action_capability_required', `steps[${stepIndex}].capabilityRefs`);
        }
        const mapping = step.resumeMapping;
        if (!mapping) return;
        const path = `steps[${stepIndex}].resumeMapping.priorStepId`;
        if (input.resumeFreshness?.status !== 'verified') {
            addIssue(issues, 'resume_mapping_freshness_not_verified', path);
        } else if (verifiedPendingStepIds.has(mapping.priorStepId)) {
            addIssue(issues, 'resume_mapping_prior_step_pending', path);
        } else if (!verifiedCompletedStepIds.has(mapping.priorStepId)) {
            addIssue(issues, 'resume_mapping_prior_step_not_verified', path);
        }
        if (mappedPriorStepIds.has(mapping.priorStepId)) {
            addIssue(issues, 'resume_mapping_prior_step_duplicate', path);
        }
        mappedPriorStepIds.add(mapping.priorStepId);
    });
    const graph = validateStepGraph(steps, issues);
    const designDsl = readDesignDsl(record.designDsl, issues, forbiddenToolNames);
    const missingInputs = readMissingInputs(record.missingInputs, issues, forbiddenToolNames);
    const payload: RuntimeActionPlanDeclarationPayload = {
        planGoal: readText({ value: record.planGoal, path: 'planGoal', issues, forbiddenToolNames, required: true }),
        strategyRef: CURRENT_R3_STRATEGY_REF,
        contextRefs,
        steps,
        ...(designDsl ? { designDsl } : {}),
        missingInputs
    };
    if (issues.length > 0) return { ok: false, readiness: 'invalid', issues };
    const missingCapabilityRefs = unique(
        steps.flatMap((step) => step.capabilityRefs).filter((ref) => onDemandCapabilities.has(ref))
    );
    const readiness: RuntimeActionPlanReadiness = missingInputs.some((item) => item.severity === 'blocking')
        || steps.some((step) => step.kind === 'request_input')
        ? 'needs_input'
        : missingCapabilityRefs.length > 0
            ? 'needs_capability'
            : 'ready';
    return {
        ok: true,
        readiness,
        declaration: {
            version: 'runtime-action-plan-declaration/v0',
            source: 'model_tool_call',
            readiness,
            payload,
            missingCapabilityRefs,
            graph,
            boundaries: {
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
            }
        },
        issues: []
    };
}

export function buildRuntimeActionPlanDigest(input: {
    declaration: RuntimeActionPlanDeclaration;
    strategyDigest: RuntimeDesignStrategyDigest;
}): RuntimeActionPlanDigest {
    const declaration = input.declaration;
    const dsl = declaration.payload.designDsl;
    return {
        version: 'runtime-action-plan-digest/v0',
        readiness: declaration.readiness,
        planGoal: declaration.payload.planGoal,
        strategyStageGoal: input.strategyDigest.stageGoal,
        stepCount: declaration.payload.steps.length,
        stepKinds: Array.from(new Set(declaration.payload.steps.map((step) => step.kind))),
        rootStepIds: declaration.graph.rootStepIds.slice(0, MAX_STEPS),
        terminalStepIds: declaration.graph.terminalStepIds.slice(0, MAX_STEPS),
        parallelGroupCount: declaration.graph.parallelGroups.length,
        capabilityRefs: unique(declaration.payload.steps.flatMap((step) => step.capabilityRefs)).slice(0, 24),
        missingCapabilityRefs: declaration.missingCapabilityRefs.slice(0, 24),
        contextRefs: declaration.payload.contextRefs.slice(0, 12),
        ...(dsl ? {
            designDsl: {
                compositionIntent: dsl.compositionIntent,
                regionCount: dsl.regions.length,
                elementCount: dsl.elements.length,
                readingOrder: dsl.readingOrder.slice(0, MAX_REGIONS)
            }
        } : {}),
        missingInputCount: declaration.payload.missingInputs.length,
        resumeReuseCount: declaration.payload.steps.filter((step) => (
            step.resumeMapping?.policy === 'reuse_completed_step'
        )).length,
        resumeRedoRequiredCount: declaration.payload.steps.filter((step) => (
            step.resumeMapping?.policy === 'redo_required'
        )).length,
        boundaries: {
            digestOnly: true,
            modelAuthored: true,
            shadowOnly: true,
            executable: false,
            changesTaskResult: false
        }
    };
}

function buildRegionSchema(): Record<string, any> {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            regionId: { type: 'string', pattern: ID_PATTERN.source },
            role: { type: 'string', enum: [...REGION_ROLES] },
            bounds: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    x: { type: 'number', minimum: 0, maximum: 1 },
                    y: { type: 'number', minimum: 0, maximum: 1 },
                    width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
                    height: { type: 'number', exclusiveMinimum: 0, maximum: 1 }
                },
                required: ['x', 'y', 'width', 'height']
            },
            zIndex: { type: 'integer', minimum: 0, maximum: 100 },
            alignment: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    horizontal: { type: 'string', enum: ['start', 'center', 'end', 'stretch'] },
                    vertical: { type: 'string', enum: ['start', 'center', 'end', 'stretch'] }
                },
                required: ['horizontal', 'vertical']
            },
            overflow: { type: 'string', enum: ['clip', 'visible'] }
        },
        required: ['regionId', 'role', 'bounds', 'zIndex', 'alignment', 'overflow']
    };
}

function buildElementSchema(): Record<string, any> {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            elementId: { type: 'string', pattern: ID_PATTERN.source },
            role: { type: 'string', enum: [...ELEMENT_ROLES] },
            elementType: { type: 'string', enum: [...ELEMENT_TYPES] },
            regionId: { type: 'string', pattern: ID_PATTERN.source },
            source: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    kind: { type: 'string', enum: ['icon', 'asset', 'token'] },
                    refId: { type: 'string', maxLength: 180 }
                },
                required: ['kind', 'refId']
            },
            styleTokenRefs: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string' } },
            transform: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    anchor: { type: 'string', enum: [...TRANSFORM_ANCHORS] },
                    offsetX: { type: 'number', minimum: -1, maximum: 1 },
                    offsetY: { type: 'number', minimum: -1, maximum: 1 },
                    scale: { type: 'number', exclusiveMinimum: 0, maximum: 10 },
                    rotationDeg: { type: 'number', minimum: -180, maximum: 180 }
                },
                required: ['anchor', 'offsetX', 'offsetY', 'scale', 'rotationDeg']
            },
            required: { type: 'boolean' }
        },
        required: ['elementId', 'role', 'elementType', 'regionId', 'styleTokenRefs', 'required']
    };
}

export function buildDeclareRuntimeActionPlanToolSchema(input: {
    allowedContextRefs: readonly string[];
    discoveredCapabilityRefs: readonly string[];
    verifiedCompletedStepIds?: readonly string[];
}): RuntimeActionPlanToolSchema {
    const contextRefs = unique(input.allowedContextRefs);
    const capabilityRefs = unique(input.discoveredCapabilityRefs);
    const verifiedCompletedStepIds = unique(input.verifiedCompletedStepIds || [])
        .filter((stepId) => ID_PATTERN.test(stepId))
        .slice(0, MAX_STEPS);
    const contextRefSchema: Record<string, any> = {
        type: 'string',
        ...(contextRefs.length > 0 ? { enum: contextRefs } : {})
    };
    const capabilityRefSchema: Record<string, any> = {
        type: 'string',
        ...(capabilityRefs.length > 0 ? { enum: capabilityRefs } : {})
    };
    return {
        name: DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
        description: [
            'Declare the current R4 dynamic Action Plan and optional semantic Design DSL after a ready R3 strategy.',
            'Steps may reference only current Context and discovered Capability ids. On-demand Capability refs produce needs_capability; this Tool never loads or executes them.',
            verifiedCompletedStepIds.length > 0
                ? 'For a current step that is explicitly equivalent to a freshness-verified completed prior step, resumeMapping may declare reuse_completed_step or redo_required. Never infer or invent a mapping.'
                : 'No freshness-verified completed prior step is available, so do not declare resumeMapping.',
            'Dependencies are a shadow-only planning projection. Do not include legacy Tool names, operations, params, layer ids, commands, local paths or pixel coordinates.',
            'Normalized 0..1 LayoutRegion bounds are allowed inside designDsl only. This does not schedule a DAG, grant permission, complete the task or pass quality review.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                planGoal: { type: 'string', maxLength: MAX_TEXT },
                strategyRef: { type: 'string', enum: [CURRENT_R3_STRATEGY_REF] },
                contextRefs: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 12,
                    uniqueItems: true,
                    items: contextRefSchema
                },
                steps: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_STEPS,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            stepId: { type: 'string', pattern: ID_PATTERN.source },
                            kind: { type: 'string', enum: [...STEP_KINDS] },
                            goal: { type: 'string', maxLength: MAX_TEXT },
                            dependsOn: { type: 'array', maxItems: MAX_STEPS, uniqueItems: true, items: { type: 'string', pattern: ID_PATTERN.source } },
                            parallelGroup: { type: 'string', pattern: ID_PATTERN.source },
                            capabilityRefs: { type: 'array', maxItems: 10, uniqueItems: true, items: capabilityRefSchema },
                            inputContextRefs: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: contextRefSchema },
                            expectedOutcomes: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string', enum: [...RESULT_KINDS] } },
                            completionCriteria: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string', maxLength: MAX_TEXT } },
                            failurePolicy: { type: 'string', enum: [...FAILURE_POLICIES] },
                            ...(verifiedCompletedStepIds.length > 0 ? {
                                resumeMapping: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        priorStepId: {
                                            type: 'string',
                                            enum: verifiedCompletedStepIds
                                        },
                                        policy: { type: 'string', enum: [...RESUME_POLICIES] }
                                    },
                                    required: ['priorStepId', 'policy']
                                }
                            } : {})
                        },
                        required: [
                            'stepId', 'kind', 'goal', 'dependsOn', 'capabilityRefs', 'inputContextRefs',
                            'expectedOutcomes', 'completionCriteria', 'failurePolicy'
                        ]
                    }
                },
                designDsl: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        compositionIntent: { type: 'string', maxLength: MAX_LONG_TEXT },
                        regions: { type: 'array', maxItems: MAX_REGIONS, items: buildRegionSchema() },
                        elements: { type: 'array', maxItems: MAX_ELEMENTS, items: buildElementSchema() },
                        readingOrder: { type: 'array', maxItems: MAX_REGIONS, uniqueItems: true, items: { type: 'string', pattern: ID_PATTERN.source } },
                        constraints: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string', maxLength: MAX_TEXT } }
                    },
                    required: ['compositionIntent', 'regions', 'elements', 'readingOrder', 'constraints']
                },
                missingInputs: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            inputId: { type: 'string', pattern: ID_PATTERN.source },
                            field: { type: 'string', maxLength: MAX_TEXT },
                            question: { type: 'string', maxLength: MAX_TEXT },
                            severity: { type: 'string', enum: ['blocking', 'degradable', 'optional'] },
                            defaultPolicy: { type: 'string', maxLength: MAX_TEXT }
                        },
                        required: ['inputId', 'field', 'question', 'severity']
                    }
                }
            },
            required: ['planGoal', 'strategyRef', 'contextRefs', 'steps', 'missingInputs']
        }
    };
}
