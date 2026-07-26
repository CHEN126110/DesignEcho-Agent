/**
 * R2 reference context resolution。
 *
 * Skill Manifest 决定不同工作模式是否需要参考；模型声明选择和可复用洞察；Harness
 * 只核对 R1 workMode、已取得的参考上下文、搜索预算和降级边界。该声明用于确认
 * R2 参考上下文是否足以进入策略阶段，不执行 Tool，也不承担执行授权或质量评价。
 */

import type {
    RuntimeDesignWorkMode,
    RuntimeReferenceRequirement,
    RuntimeReferenceSourceKind,
    SkillRuntimeReferencePolicy
} from './contracts';

export const DECLARE_REFERENCE_BRIEF_TOOL_NAME = 'declareReferenceBrief';
/** Provider Tool 适配表集中在参考契约层；Agent 核心只问语义，不维护品类分支。 */
export const RUNTIME_REFERENCE_SEARCH_TOOL_NAMES: readonly string[] = Object.freeze([
    'searchEagleReferences'
]);
export const RUNTIME_REFERENCE_VISUAL_TOOL_NAMES: readonly string[] = Object.freeze([
    'analyzeEagleReference'
]);

export type RuntimeReferenceDecision = 'search_new' | 'reuse_existing' | 'skip_not_needed';
export type RuntimeReferenceReadiness = 'ready' | 'degraded' | 'waived';
export type RuntimeReferenceInsightAspect =
    | 'composition'
    | 'layout'
    | 'placement'
    | 'color'
    | 'typography'
    | 'lighting'
    | 'retouching';

export interface RuntimeReferenceSourceEntry {
    kind: RuntimeReferenceSourceKind;
    sourceRefs: string[];
}

export interface RuntimeReferenceInsight {
    aspect: RuntimeReferenceInsightAspect;
    observation: string;
    application: string;
    observationRefs: string[];
}

export interface RuntimeReferenceBriefDeclaration {
    version: 'runtime-reference-brief/v0';
    source: 'model_tool_call';
    workMode: RuntimeDesignWorkMode;
    requirement: RuntimeReferenceRequirement;
    decision: RuntimeReferenceDecision;
    readiness: RuntimeReferenceReadiness;
    sources: RuntimeReferenceSourceEntry[];
    insights: RuntimeReferenceInsight[];
    limitations: string[];
    boundaries: {
        modelAuthored: true;
        harnessValidatedOnly: true;
        skillPolicyIsSourceOfTruth: true;
        categoryNeutral: true;
        executesTools: false;
    };
}

export interface RuntimeReferenceBriefDigest {
    version: 'runtime-reference-brief-digest/v0';
    workMode: RuntimeDesignWorkMode;
    requirement: RuntimeReferenceRequirement;
    decision: RuntimeReferenceDecision;
    readiness: RuntimeReferenceReadiness;
    sourceKinds: RuntimeReferenceSourceKind[];
    insightCount: number;
    searchAttemptCount: number;
    searchFailureCount: number;
    visualAnalysisFailureCount: number;
    limitationCount: number;
    boundaries: {
        digestOnly: true;
    };
}

export interface RuntimeReferenceBriefValidationResult {
    ok: boolean;
    readiness: 'invalid' | RuntimeReferenceReadiness;
    declaration?: RuntimeReferenceBriefDeclaration;
    issues: Array<{ code: string; path: string }>;
}

export interface RuntimeReferenceContextState {
    allowedContextRefs: string[];
    visualObservations: RuntimeReferenceContextObservation[];
    searchAttemptCount: number;
    searchFailureCount: number;
    visualAnalysisFailureCount: number;
}

export interface RuntimeReferenceContextObservation {
    ref: string;
    summary: string;
    aspects: Array<{
        aspect: RuntimeReferenceInsightAspect;
        observation: string;
    }>;
}

const WORK_MODES: readonly RuntimeDesignWorkMode[] = [
    'create_new',
    'redesign',
    'template_fill',
    'edit_existing',
    'analyze_only',
    'export_only'
];
const REQUIREMENTS: readonly RuntimeReferenceRequirement[] = ['required', 'reuse_or_optional', 'not_required'];
const SOURCE_KINDS: readonly RuntimeReferenceSourceKind[] = ['user_reference', 'brand_template', 'project_case', 'eagle', 'web'];
const DECISIONS: readonly RuntimeReferenceDecision[] = ['search_new', 'reuse_existing', 'skip_not_needed'];
const READINESS_VALUES: readonly RuntimeReferenceReadiness[] = ['ready', 'degraded', 'waived'];
const INSIGHT_ASPECTS: readonly RuntimeReferenceInsightAspect[] = [
    'composition',
    'layout',
    'placement',
    'color',
    'typography',
    'lighting',
    'retouching'
];
const MAX_TEXT = 360;
const MAX_ISSUES = 32;
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|tmp|var|private)\/)/;
const DATA_URL_PATTERN = /data:[^;,]{1,80}(?:;base64)?,/i;

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues: Array<{ code: string; path: string }>, code: string, path: string): void {
    if (issues.length >= MAX_ISSUES) return;
    if (!issues.some((issue) => issue.code === code && issue.path === path)) issues.push({ code, path });
}

function validateKeys(
    record: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    issues: Array<{ code: string; path: string }>
): void {
    const allowedSet = new Set(allowed);
    Object.keys(record).forEach((key) => {
        if (!allowedSet.has(key)) addIssue(issues, 'unknown_field', `${path}.${key}`);
    });
}

function readText(
    value: unknown,
    path: string,
    issues: Array<{ code: string; path: string }>,
    required = true
): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (required && !text) addIssue(issues, 'text_required', path);
    if (text.length > MAX_TEXT) addIssue(issues, 'text_too_long', path);
    if (LOCAL_PATH_PATTERN.test(text) || DATA_URL_PATTERN.test(text)) addIssue(issues, 'sensitive_payload_forbidden', path);
    return text;
}

function readAllowedRefs(input: {
    value: unknown;
    path: string;
    issues: Array<{ code: string; path: string }>;
    allowed: ReadonlySet<string>;
    required?: boolean;
}): string[] {
    if (!Array.isArray(input.value)) {
        addIssue(input.issues, 'array_required', input.path);
        return [];
    }
    if (input.value.length > 12) addIssue(input.issues, 'array_too_long', input.path);
    const refs = input.value.slice(0, 12).map((value, index) => (
        readText(value, `${input.path}[${index}]`, input.issues)
    )).filter(Boolean);
    if (input.required && refs.length === 0) addIssue(input.issues, 'context_ref_required', input.path);
    refs.forEach((ref, index) => {
        if (!input.allowed.has(ref)) addIssue(input.issues, 'context_ref_not_available', `${input.path}[${index}]`);
    });
    return Array.from(new Set(refs));
}

export function normalizeRuntimeReferenceContextObservation(
    ref: string,
    value: unknown
): RuntimeReferenceContextObservation | undefined {
    const record = isObject(value) ? value : {};
    const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
    if (!summary) return undefined;
    const aspects = Array.isArray(record.strengths)
        ? record.strengths.map((value) => {
            const item = isObject(value) ? value : {};
            const aspect = String(item.aspect || '').trim() as RuntimeReferenceInsightAspect;
            const observation = typeof item.observation === 'string' ? item.observation.trim() : '';
            if (!INSIGHT_ASPECTS.includes(aspect) || !observation) return undefined;
            return { aspect, observation };
        }).filter(Boolean) as RuntimeReferenceContextObservation['aspects']
        : [];
    if (aspects.length === 0) return undefined;
    return {
        ref: String(ref || '').trim(),
        summary,
        aspects
    };
}

export function getReferenceRequirement(
    policy: SkillRuntimeReferencePolicy,
    workMode: RuntimeDesignWorkMode
): RuntimeReferenceRequirement {
    return policy.work_mode_requirements[workMode];
}

export function validateSkillRuntimeReferencePolicy(policy: SkillRuntimeReferencePolicy | undefined): string[] {
    if (!policy) return [];
    const issues: string[] = [];
    if (policy.version !== 'skill-reference-policy/v0') issues.push('reference_policy_version_invalid');
    WORK_MODES.forEach((mode) => {
        if (!REQUIREMENTS.includes(policy.work_mode_requirements?.[mode])) {
            issues.push(`reference_policy_work_mode_invalid:${mode}`);
        }
    });
    if (!Array.isArray(policy.allowed_sources) || policy.allowed_sources.length === 0) {
        issues.push('reference_policy_sources_missing');
    } else if (policy.allowed_sources.some((source) => !SOURCE_KINDS.includes(source))) {
        issues.push('reference_policy_source_invalid');
    }
    if (!Number.isInteger(policy.max_search_rounds)
        || policy.max_search_rounds < 1
        || policy.max_search_rounds > 4) {
        issues.push('reference_policy_search_budget_invalid');
    }
    if (!['continue_degraded', 'block'].includes(policy.unavailable_behavior)) {
        issues.push('reference_policy_unavailable_behavior_invalid');
    }
    return issues;
}

export function validateRuntimeReferenceBriefDeclaration(input: {
    value: unknown;
    policy: SkillRuntimeReferencePolicy;
    workMode: RuntimeDesignWorkMode;
    context: RuntimeReferenceContextState;
}): RuntimeReferenceBriefValidationResult {
    const issues: Array<{ code: string; path: string }> = [];
    const record = isObject(input.value) ? input.value : {};
    if (!isObject(input.value)) addIssue(issues, 'object_required', 'referenceBrief');
    validateKeys(record, ['decision', 'readiness', 'sources', 'insights', 'limitations'], 'referenceBrief', issues);
    const decisionText = String(record.decision || '').trim() as RuntimeReferenceDecision;
    const readinessText = String(record.readiness || '').trim() as RuntimeReferenceReadiness;
    if (!DECISIONS.includes(decisionText)) addIssue(issues, 'reference_decision_invalid', 'decision');
    if (!READINESS_VALUES.includes(readinessText)) addIssue(issues, 'reference_readiness_invalid', 'readiness');
    const allowedRefs = new Set(input.context.allowedContextRefs);
    const visualObservations = new Map(
        input.context.visualObservations.map((item) => [item.ref, item])
    );
    const visualRefs = new Set(visualObservations.keys());
    const allowedSources = new Set(input.policy.allowed_sources);

    const sources: RuntimeReferenceSourceEntry[] = Array.isArray(record.sources)
        ? record.sources.slice(0, 8).map((value, index) => {
            const path = `sources[${index}]`;
            const source = isObject(value) ? value : {};
            if (!isObject(value)) addIssue(issues, 'object_required', path);
            validateKeys(source, ['kind', 'sourceRefs'], path, issues);
            const kind = String(source.kind || '').trim() as RuntimeReferenceSourceKind;
            if (!SOURCE_KINDS.includes(kind) || !allowedSources.has(kind)) {
                addIssue(issues, 'reference_source_not_allowed', `${path}.kind`);
            }
            return {
                kind,
                sourceRefs: readAllowedRefs({
                    value: source.sourceRefs,
                    path: `${path}.sourceRefs`,
                    issues,
                    allowed: allowedRefs,
                    required: true
                })
            };
        })
        : [];
    if (!Array.isArray(record.sources)) addIssue(issues, 'array_required', 'sources');

    const insights: RuntimeReferenceInsight[] = Array.isArray(record.insights)
        ? record.insights.slice(0, 12).map((value, index) => {
            const path = `insights[${index}]`;
            const insight = isObject(value) ? value : {};
            if (!isObject(value)) addIssue(issues, 'object_required', path);
            validateKeys(insight, ['aspect', 'application', 'observationRefs'], path, issues);
            const aspect = String(insight.aspect || '').trim() as RuntimeReferenceInsightAspect;
            if (!INSIGHT_ASPECTS.includes(aspect)) addIssue(issues, 'reference_insight_aspect_invalid', `${path}.aspect`);
            const observationRefs = readAllowedRefs({
                value: insight.observationRefs,
                path: `${path}.observationRefs`,
                issues,
                allowed: allowedRefs,
                required: true
            });
            observationRefs.forEach((ref, refIndex) => {
                if (!visualRefs.has(ref)) {
                    addIssue(issues, 'reference_visual_observation_required', `${path}.observationRefs[${refIndex}]`);
                }
            });
            const observedText = Array.from(new Set(observationRefs.flatMap((ref) => {
                const observation = visualObservations.get(ref);
                if (!observation) return [];
                const matching = observation.aspects
                    .filter((item) => item.aspect === aspect)
                    .map((item) => item.observation);
                return matching.length > 0 ? matching : [observation.summary];
            }).filter(Boolean))).join('；');
            if (!observedText) {
                addIssue(issues, 'reference_observation_content_missing', `${path}.observationRefs`);
            }
            return {
                aspect,
                observation: observedText,
                application: readText(insight.application, `${path}.application`, issues),
                observationRefs
            };
        })
        : [];
    if (!Array.isArray(record.insights)) addIssue(issues, 'array_required', 'insights');
    const limitations = Array.isArray(record.limitations)
        ? record.limitations.slice(0, 8).map((value, index) => (
            readText(value, `limitations[${index}]`, issues)
        )).filter(Boolean)
        : [];
    if (!Array.isArray(record.limitations)) addIssue(issues, 'array_required', 'limitations');

    const requirement = getReferenceRequirement(input.policy, input.workMode);
    if (readinessText === 'ready' && (sources.length === 0 || insights.length === 0)) {
        addIssue(issues, 'reference_ready_requires_visual_insight', 'readiness');
    }
    if (readinessText === 'ready' && decisionText === 'skip_not_needed') {
        addIssue(issues, 'reference_ready_decision_conflict', 'decision');
    }
    if (requirement === 'required' && readinessText === 'waived') {
        addIssue(issues, 'required_reference_cannot_be_waived', 'readiness');
    }
    if (requirement === 'not_required' && readinessText !== 'waived') {
        addIssue(issues, 'not_required_reference_must_be_waived', 'readiness');
    }
    if (readinessText === 'degraded') {
        if (requirement !== 'required' || input.policy.unavailable_behavior !== 'continue_degraded') {
            addIssue(issues, 'reference_degraded_not_allowed', 'readiness');
        }
        if (decisionText !== 'search_new') addIssue(issues, 'reference_degraded_requires_search', 'decision');
        const budgetExhausted = input.context.searchAttemptCount >= input.policy.max_search_rounds;
        if (!budgetExhausted) addIssue(issues, 'reference_search_budget_not_exhausted', 'readiness');
        if (input.context.searchFailureCount === 0 && input.context.visualAnalysisFailureCount === 0) {
            addIssue(issues, 'reference_degraded_without_failed_reference_attempt', 'readiness');
        }
        if (limitations.length === 0) addIssue(issues, 'reference_degraded_limitations_required', 'limitations');
    }
    if (readinessText === 'waived' && decisionText !== 'skip_not_needed') {
        addIssue(issues, 'reference_waived_decision_conflict', 'decision');
    }

    if (issues.length > 0) return { ok: false, readiness: 'invalid', issues };
    const declaration: RuntimeReferenceBriefDeclaration = {
        version: 'runtime-reference-brief/v0',
        source: 'model_tool_call',
        workMode: input.workMode,
        requirement,
        decision: decisionText,
        readiness: readinessText,
        sources,
        insights,
        limitations,
        boundaries: {
            modelAuthored: true,
            harnessValidatedOnly: true,
            skillPolicyIsSourceOfTruth: true,
            categoryNeutral: true,
            executesTools: false
        }
    };
    return { ok: true, readiness: declaration.readiness, declaration, issues: [] };
}

export function buildRuntimeReferenceBriefDigest(input: {
    declaration: RuntimeReferenceBriefDeclaration;
    context: RuntimeReferenceContextState;
}): RuntimeReferenceBriefDigest {
    return {
        version: 'runtime-reference-brief-digest/v0',
        workMode: input.declaration.workMode,
        requirement: input.declaration.requirement,
        decision: input.declaration.decision,
        readiness: input.declaration.readiness,
        sourceKinds: Array.from(new Set(input.declaration.sources.map((source) => source.kind))),
        insightCount: input.declaration.insights.length,
        searchAttemptCount: input.context.searchAttemptCount,
        searchFailureCount: input.context.searchFailureCount,
        visualAnalysisFailureCount: input.context.visualAnalysisFailureCount,
        limitationCount: input.declaration.limitations.length,
        boundaries: {
            digestOnly: true
        }
    };
}

export function buildDeclareReferenceBriefToolSchema(input: {
    policy: SkillRuntimeReferencePolicy;
    workMode: RuntimeDesignWorkMode;
    context: RuntimeReferenceContextState;
}): {
    name: typeof DECLARE_REFERENCE_BRIEF_TOOL_NAME;
    description: string;
    inputSchema: Record<string, unknown>;
} {
    const requirement = getReferenceRequirement(input.policy, input.workMode);
    const allowedRefs = Array.from(new Set(input.context.allowedContextRefs));
    const visualRefs = Array.from(new Set(input.context.visualObservations.map((item) => item.ref)));
    return {
        name: DECLARE_REFERENCE_BRIEF_TOOL_NAME,
        description: [
            `Declare the R2 reference decision for workMode=${input.workMode}; Skill requirement=${requirement}.`,
            'Searching candidates is not visual understanding. readiness=ready requires at least one insight backed by structured output from a visual-reference tool.',
            'Choose an aspect and explain its application; the observation text is supplied by the Harness from that tool output and cannot be authored here.',
            `At most ${input.policy.max_search_rounds} reference search rounds are allowed.`,
            input.policy.unavailable_behavior === 'continue_degraded'
                ? 'If searches fail or the budget is exhausted, degraded is allowed only with explicit limitations.'
                : 'Reference unavailability blocks progression; degraded is not allowed.',
            'This declaration can satisfy R2 reference-context readiness after validation. It does not search references, execute Photoshop, authorize writes, or evaluate design quality.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                decision: { type: 'string', enum: [...DECISIONS] },
                readiness: { type: 'string', enum: [...READINESS_VALUES] },
                sources: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                        type: 'object',
                        properties: {
                            kind: { type: 'string', enum: input.policy.allowed_sources },
                            sourceRefs: {
                                type: 'array',
                                minItems: 1,
                                maxItems: 12,
                                items: { type: 'string', ...(allowedRefs.length ? { enum: allowedRefs } : {}) }
                            }
                        },
                        required: ['kind', 'sourceRefs'],
                        additionalProperties: false
                    }
                },
                insights: {
                    type: 'array',
                    maxItems: 12,
                    items: {
                        type: 'object',
                        properties: {
                            aspect: { type: 'string', enum: [...INSIGHT_ASPECTS] },
                            application: { type: 'string', minLength: 1, maxLength: MAX_TEXT },
                            observationRefs: {
                                type: 'array',
                                minItems: 1,
                                maxItems: 8,
                                items: { type: 'string', ...(visualRefs.length ? { enum: visualRefs } : {}) }
                            }
                        },
                        required: ['aspect', 'application', 'observationRefs'],
                        additionalProperties: false
                    }
                },
                limitations: {
                    type: 'array',
                    maxItems: 8,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                }
            },
            required: ['decision', 'readiness', 'sources', 'insights', 'limitations'],
            additionalProperties: false
        }
    };
}

export function isReferenceBriefControlTool(value: unknown): boolean {
    return String(value || '').trim() === DECLARE_REFERENCE_BRIEF_TOOL_NAME;
}

export function isRuntimeReferenceSearchTool(value: unknown): boolean {
    return RUNTIME_REFERENCE_SEARCH_TOOL_NAMES.includes(String(value || '').trim());
}

export function isRuntimeReferenceVisualTool(value: unknown): boolean {
    return RUNTIME_REFERENCE_VISUAL_TOOL_NAMES.includes(String(value || '').trim());
}

export function isRuntimeReferenceContextResolved(
    declaration: RuntimeReferenceBriefDeclaration | undefined
): boolean {
    return declaration?.readiness === 'ready'
        || declaration?.readiness === 'degraded'
        || declaration?.readiness === 'waived';
}

export function hasRuntimeReferenceVisualObservation(
    declaration: RuntimeReferenceBriefDeclaration | undefined
): boolean {
    return declaration?.readiness === 'ready'
        && declaration.insights.some((insight) => insight.observationRefs.length > 0 && Boolean(insight.observation));
}
