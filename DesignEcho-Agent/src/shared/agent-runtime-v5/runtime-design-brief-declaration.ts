/**
 * R1 Runtime Design Brief Declaration。
 *
 * Brief 内容由模型通过结构化控制工具提交；Harness 只使用当前 Skill manifest 的
 * required_inputs / optional_inputs 校验输入覆盖，不推断品类、不生成设计策略、
 * 不执行 Tool，也不授予任何权限。
 */

import type {
    RuntimeDesignWorkMode,
    SkillRuntimeInputSourceKind,
    SkillRuntimeInputSourceMap
} from './contracts';

export const DECLARE_DESIGN_BRIEF_TOOL_NAME = 'declareDesignBrief';

export type RuntimeDesignBriefInputStatus = 'provided' | 'missing' | 'assumed';

export interface RuntimeDesignBriefInputCoverage {
    inputKey: string;
    status: RuntimeDesignBriefInputStatus;
    contextRefs: string[];
    note?: string;
}

/** Harness 在当前运行中实际发现的输入来源，不包含原始内容。 */
export interface RuntimeDesignBriefAvailableInputSource {
    sourceKind: SkillRuntimeInputSourceKind;
    /** structured_input 等只允许绑定到已解析出的精确字段；省略表示可按 Manifest 类型匹配。 */
    inputKeys?: readonly string[];
}

/** Harness 根据 Manifest 将实际来源绑定到具体 inputKey 后生成；模型只能引用。 */
export interface RuntimeDesignBriefResolvedInput {
    inputKey: string;
    sourceKind: SkillRuntimeInputSourceKind;
    contextRef: string;
}

export interface RuntimeDesignBriefDeclarationPayload {
    /** 由模型声明；存在 reference_policy 或 work_mode_contracts 时必填。 */
    workMode?: RuntimeDesignWorkMode;
    taskGoal: string;
    deliverables: string[];
    targetAudience?: string;
    channel?: string;
    outputRequirements: string[];
    constraints: string[];
    inputCoverage: RuntimeDesignBriefInputCoverage[];
    contextRefs: string[];
}

export interface RuntimeDesignBriefDeclaration {
    version: 'runtime-design-brief-declaration/v0';
    source: 'model_tool_call';
    readiness: 'ready' | 'needs_input';
    payload: RuntimeDesignBriefDeclarationPayload;
    boundaries: {
        modelAuthored: true;
        harnessValidatedOnly: true;
        manifestInputsAreSourceOfTruth: true;
        categoryNeutral: true;
        executesTools: false;
        grantsPermission: false;
        autoActivatesCapabilities: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
    };
}

export interface RuntimeDesignBriefDigest {
    version: 'runtime-design-brief-digest/v0';
    readiness: RuntimeDesignBriefDeclaration['readiness'];
    workMode?: RuntimeDesignWorkMode;
    taskGoal: string;
    deliverables: string[];
    requiredInputCount: number;
    providedRequiredInputCount: number;
    missingRequiredInputKeys: string[];
    assumedRequiredInputKeys: string[];
    contextRefs: string[];
    constraintCount: number;
    boundaries: {
        digestOnly: true;
        modelAuthored: true;
        changesTaskResult: false;
        grantsPermission: false;
    };
}

export interface RuntimeDesignBriefValidationIssue {
    code: string;
    path: string;
}

export interface RuntimeDesignBriefValidationResult {
    ok: boolean;
    readiness: 'invalid' | RuntimeDesignBriefDeclaration['readiness'];
    declaration?: RuntimeDesignBriefDeclaration;
    issues: RuntimeDesignBriefValidationIssue[];
}

export interface RuntimeDesignBriefToolSchema {
    name: typeof DECLARE_DESIGN_BRIEF_TOOL_NAME;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required: string[];
        additionalProperties: false;
    };
}

export interface RuntimeDesignBriefWorkModeInputContract {
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
}

export type RuntimeDesignBriefWorkModeInputContracts = Partial<
    Record<RuntimeDesignWorkMode, RuntimeDesignBriefWorkModeInputContract>
>;

const MAX_TEXT = 480;
const MAX_LIST = 16;
const MAX_ISSUES = 40;
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|tmp|var|private)\/)/;
const DATA_URL_PATTERN = /data:[^;,]{1,80}(?:;base64)?,/i;
const BASE64_PATTERN = /[A-Za-z0-9+/]{180,}={0,2}/;
const DESIGN_WORK_MODES: readonly RuntimeDesignWorkMode[] = [
    'create_new',
    'redesign',
    'template_fill',
    'edit_existing',
    'analyze_only',
    'export_only'
];

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(
    issues: RuntimeDesignBriefValidationIssue[],
    code: string,
    path: string
): void {
    if (issues.length >= MAX_ISSUES) return;
    if (issues.some((issue) => issue.code === code && issue.path === path)) return;
    issues.push({ code, path });
}

function validateKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    issues: RuntimeDesignBriefValidationIssue[]
): void {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) addIssue(issues, 'unknown_field', `${path}.${key}`);
    }
}

function cleanInputKey(value: unknown): string {
    const key = String(value || '').trim();
    return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(key) ? key : '';
}

function hasSensitivePayload(value: string): boolean {
    return LOCAL_PATH_PATTERN.test(value)
        || DATA_URL_PATTERN.test(value)
        || BASE64_PATTERN.test(value);
}

function hasImplementationDetail(value: string): boolean {
    return /\b(?:layerId|layerName|toolId|toolName|actionDescriptor|executeTool|batchPlay)\b/i.test(value)
        || /\b(?:create|set|get|move|render|export|delete|duplicate|select)[A-Z][A-Za-z0-9]+\b/.test(value)
        || /(?:Photoshop\s*命令|UXP\s*命令|图层编号|工具调用)/i.test(value)
        || /\b(?:x|y|width|height)\s*[:=]\s*-?\d/i.test(value);
}

function readText(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignBriefValidationIssue[];
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
    if (hasImplementationDetail(text)) addIssue(input.issues, 'implementation_detail_forbidden', input.path);
    return text;
}

function readTextList(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignBriefValidationIssue[];
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
        required: true
    })).filter(Boolean);
    if (values.length < (input.requiredItems || 0)) addIssue(input.issues, 'array_items_missing', input.path);
    if (new Set(values).size !== values.length) addIssue(input.issues, 'array_items_duplicate', input.path);
    return values;
}

function readContextRefs(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignBriefValidationIssue[];
    allowedContextRefs: ReadonlySet<string>;
    requiredItems?: number;
}): string[] {
    const refs = readTextList({
        value: input.value,
        path: input.path,
        issues: input.issues,
        requiredItems: input.requiredItems,
        maxItems: 16
    });
    refs.forEach((ref, index) => {
        if (!input.allowedContextRefs.has(ref)) {
            addIssue(input.issues, 'context_ref_not_available', `${input.path}[${index}]`);
        }
    });
    return refs;
}

function readInputCoverage(input: {
    value: unknown;
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
    allowedContextRefs: ReadonlySet<string>;
    declaredContextRefs: ReadonlySet<string>;
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    issues: RuntimeDesignBriefValidationIssue[];
}): RuntimeDesignBriefInputCoverage[] {
    if (!Array.isArray(input.value)) {
        addIssue(input.issues, 'array_required', 'inputCoverage');
        return [];
    }
    const knownKeys = new Set([...input.requiredInputKeys, ...input.optionalInputKeys]);
    const seenKeys = new Set<string>();
    const usedCoverageRefs = new Set<string>();
    if (input.value.length > knownKeys.size) addIssue(input.issues, 'array_too_long', 'inputCoverage');
    const coverage = input.value.slice(0, Math.max(knownKeys.size, 1)).map((item, index) => {
        const path = `inputCoverage[${index}]`;
        const record = isObject(item) ? item : {};
        if (!isObject(item)) addIssue(input.issues, 'object_required', path);
        validateKeys(record, ['inputKey', 'status', 'contextRefs', 'note'], path, input.issues);
        const inputKey = cleanInputKey(record.inputKey);
        if (!inputKey) addIssue(input.issues, 'input_key_invalid', `${path}.inputKey`);
        if (inputKey && !knownKeys.has(inputKey)) addIssue(input.issues, 'input_key_not_in_manifest', `${path}.inputKey`);
        if (inputKey && seenKeys.has(inputKey)) addIssue(input.issues, 'input_key_duplicate', `${path}.inputKey`);
        if (inputKey) seenKeys.add(inputKey);
        const statusText = String(record.status || '').trim();
        if (!['provided', 'missing', 'assumed'].includes(statusText)) {
            addIssue(input.issues, 'input_status_invalid', `${path}.status`);
        }
        const status: RuntimeDesignBriefInputStatus = ['provided', 'missing', 'assumed'].includes(statusText)
            ? statusText as RuntimeDesignBriefInputStatus
            : 'missing';
        const contextRefs = readContextRefs({
            value: record.contextRefs,
            path: `${path}.contextRefs`,
            issues: input.issues,
            allowedContextRefs: input.allowedContextRefs,
            requiredItems: status === 'provided' ? 1 : 0
        });
        contextRefs.forEach((ref, refIndex) => {
            if (!input.declaredContextRefs.has(ref)) {
                addIssue(input.issues, 'coverage_ref_not_declared', `${path}.contextRefs[${refIndex}]`);
            }
            const resolvedForKey = input.resolvedInputs.some((resolved) => (
                resolved.inputKey === inputKey && resolved.contextRef === ref
            ));
            if (!resolvedForKey) {
                addIssue(input.issues, 'input_ref_not_resolved_for_key', `${path}.contextRefs[${refIndex}]`);
            }
            if (usedCoverageRefs.has(ref)) {
                addIssue(input.issues, 'input_ref_reused', `${path}.contextRefs[${refIndex}]`);
            }
            usedCoverageRefs.add(ref);
        });
        if (status !== 'provided' && contextRefs.length > 0) {
            addIssue(input.issues, 'non_provided_input_ref_forbidden', `${path}.contextRefs`);
        }
        const note = readText({
            value: record.note,
            path: `${path}.note`,
            issues: input.issues,
            maxLength: 240
        });
        return {
            inputKey,
            status,
            contextRefs,
            ...(note ? { note } : {})
        };
    });
    input.requiredInputKeys.forEach((key) => {
        if (!seenKeys.has(key)) addIssue(input.issues, 'required_input_coverage_missing', `inputCoverage.${key}`);
    });
    return coverage;
}

function normalizeInputKeys(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(cleanInputKey).filter(Boolean)));
}

function buildResolvedInputContextRef(
    inputKey: string,
    sourceKind: SkillRuntimeInputSourceKind
): string {
    return `input:${inputKey}:${sourceKind}`;
}

export function resolveRuntimeDesignBriefInputs(input: {
    inputSources: SkillRuntimeInputSourceMap;
    availableSources: readonly RuntimeDesignBriefAvailableInputSource[];
}): RuntimeDesignBriefResolvedInput[] {
    const resolved: RuntimeDesignBriefResolvedInput[] = [];
    const seen = new Set<string>();
    for (const [rawInputKey, acceptedSourceKinds] of Object.entries(input.inputSources)) {
        const inputKey = cleanInputKey(rawInputKey);
        if (!inputKey) continue;
        for (const source of input.availableSources) {
            if (!acceptedSourceKinds.includes(source.sourceKind)) continue;
            const limitedKeys = normalizeInputKeys(source.inputKeys || []);
            if (limitedKeys.length > 0 && !limitedKeys.includes(inputKey)) continue;
            const contextRef = buildResolvedInputContextRef(inputKey, source.sourceKind);
            if (seen.has(contextRef)) continue;
            seen.add(contextRef);
            resolved.push({ inputKey, sourceKind: source.sourceKind, contextRef });
        }
    }
    return resolved;
}

function validateResolvedInputs(input: {
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    inputSources: SkillRuntimeInputSourceMap;
    knownInputKeys: ReadonlySet<string>;
    issues: RuntimeDesignBriefValidationIssue[];
}): RuntimeDesignBriefResolvedInput[] {
    const valid: RuntimeDesignBriefResolvedInput[] = [];
    const seen = new Set<string>();
    input.resolvedInputs.forEach((item, index) => {
        const path = `resolvedInputs[${index}]`;
        const inputKey = cleanInputKey(item.inputKey);
        // 同一 Manifest 可包含多个 workMode 的输入来源；当前模式只消费自己的完整替换契约。
        if (!inputKey || !input.knownInputKeys.has(inputKey)) return;
        const acceptedSourceKinds = input.inputSources[inputKey] || [];
        if (!acceptedSourceKinds.includes(item.sourceKind)) {
            addIssue(input.issues, 'resolved_input_source_not_allowed', `${path}.sourceKind`);
            return;
        }
        const expectedContextRef = buildResolvedInputContextRef(inputKey, item.sourceKind);
        if (item.contextRef !== expectedContextRef) {
            addIssue(input.issues, 'resolved_input_ref_invalid', `${path}.contextRef`);
            return;
        }
        if (seen.has(expectedContextRef)) return;
        seen.add(expectedContextRef);
        valid.push({ inputKey, sourceKind: item.sourceKind, contextRef: expectedContextRef });
    });
    return valid;
}

function describeWorkModeRequirement(input: {
    workModeRequired?: boolean;
    expectedWorkMode?: RuntimeDesignWorkMode;
}): string {
    if (!input.workModeRequired) {
        return 'workMode is optional because the selected Skill has no mode-dependent contract.';
    }
    if (input.expectedWorkMode) {
        return `Confirm the upstream-selected workMode ${input.expectedWorkMode}; R1 cannot replace it with another mode.`;
    }
    return 'Declare workMode explicitly; the selected Skill contract uses it and the Harness will not infer it from keywords.';
}

export function validateRuntimeDesignBriefDeclaration(input: {
    value: unknown;
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
    allowedContextRefs: readonly string[];
    inputSources: SkillRuntimeInputSourceMap;
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    workModeRequired?: boolean;
    expectedWorkMode?: RuntimeDesignWorkMode;
}): RuntimeDesignBriefValidationResult {
    const issues: RuntimeDesignBriefValidationIssue[] = [];
    const record = isObject(input.value) ? input.value : {};
    if (!isObject(input.value)) addIssue(issues, 'object_required', 'brief');
    validateKeys(
        record,
        [
            'workMode',
            'taskGoal',
            'deliverables',
            'targetAudience',
            'channel',
            'outputRequirements',
            'constraints',
            'inputCoverage',
            'contextRefs'
        ],
        'brief',
        issues
    );
    const requiredInputKeys = normalizeInputKeys(input.requiredInputKeys);
    const optionalInputKeys = normalizeInputKeys(input.optionalInputKeys)
        .filter((key) => !requiredInputKeys.includes(key));
    const knownInputKeys = new Set([...requiredInputKeys, ...optionalInputKeys]);
    const resolvedInputs = validateResolvedInputs({
        resolvedInputs: input.resolvedInputs,
        inputSources: input.inputSources,
        knownInputKeys,
        issues
    });
    const allowedContextRefs = new Set([
        ...input.allowedContextRefs.map((ref) => String(ref || '').trim()).filter(Boolean),
        ...resolvedInputs.map((item) => item.contextRef)
    ]);
    const workModeText = String(record.workMode || '').trim() as RuntimeDesignWorkMode;
    if (input.workModeRequired && !workModeText) addIssue(issues, 'work_mode_required', 'workMode');
    if (workModeText && !DESIGN_WORK_MODES.includes(workModeText)) {
        addIssue(issues, 'work_mode_invalid', 'workMode');
    }
    if (workModeText && input.expectedWorkMode && workModeText !== input.expectedWorkMode) {
        addIssue(issues, 'work_mode_identity_mismatch', 'workMode');
    }
    const contextRefs = readContextRefs({
        value: record.contextRefs,
        path: 'contextRefs',
        issues,
        allowedContextRefs,
        requiredItems: 1
    });
    const inputCoverage = readInputCoverage({
        value: record.inputCoverage,
        requiredInputKeys,
        optionalInputKeys,
        allowedContextRefs,
        declaredContextRefs: new Set(contextRefs),
        resolvedInputs,
        issues
    });
    const payload: RuntimeDesignBriefDeclarationPayload = {
        ...(workModeText && DESIGN_WORK_MODES.includes(workModeText) ? { workMode: workModeText } : {}),
        taskGoal: readText({ value: record.taskGoal, path: 'taskGoal', issues, required: true }),
        deliverables: readTextList({
            value: record.deliverables,
            path: 'deliverables',
            issues,
            requiredItems: 1,
            maxItems: 8
        }),
        ...(readText({ value: record.targetAudience, path: 'targetAudience', issues })
            ? { targetAudience: String(record.targetAudience).trim() }
            : {}),
        ...(readText({ value: record.channel, path: 'channel', issues })
            ? { channel: String(record.channel).trim() }
            : {}),
        outputRequirements: readTextList({
            value: record.outputRequirements,
            path: 'outputRequirements',
            issues,
            maxItems: 12
        }),
        constraints: readTextList({ value: record.constraints, path: 'constraints', issues, maxItems: 16 }),
        inputCoverage,
        contextRefs
    };
    if (issues.length > 0) {
        return { ok: false, readiness: 'invalid', issues };
    }
    const requiredCoverage = new Map(
        inputCoverage
            .filter((item) => requiredInputKeys.includes(item.inputKey))
            .map((item) => [item.inputKey, item.status])
    );
    const readiness: RuntimeDesignBriefDeclaration['readiness'] = requiredInputKeys.every(
        (key) => requiredCoverage.get(key) === 'provided'
    ) ? 'ready' : 'needs_input';
    return {
        ok: true,
        readiness,
        declaration: {
            version: 'runtime-design-brief-declaration/v0',
            source: 'model_tool_call',
            readiness,
            payload,
            boundaries: {
                modelAuthored: true,
                harnessValidatedOnly: true,
                manifestInputsAreSourceOfTruth: true,
                categoryNeutral: true,
                executesTools: false,
                grantsPermission: false,
                autoActivatesCapabilities: false,
                countsAsTaskProgress: false,
                countsAsQualityPass: false
            }
        },
        issues: []
    };
}

export function buildRuntimeDesignBriefDigest(input: {
    declaration: RuntimeDesignBriefDeclaration;
    requiredInputKeys: readonly string[];
}): RuntimeDesignBriefDigest {
    const requiredInputKeys = normalizeInputKeys(input.requiredInputKeys);
    const coverage = new Map(input.declaration.payload.inputCoverage.map((item) => [item.inputKey, item.status]));
    const missingRequiredInputKeys = requiredInputKeys.filter((key) => coverage.get(key) === 'missing');
    const assumedRequiredInputKeys = requiredInputKeys.filter((key) => coverage.get(key) === 'assumed');
    return {
        version: 'runtime-design-brief-digest/v0',
        readiness: input.declaration.readiness,
        ...(input.declaration.payload.workMode ? { workMode: input.declaration.payload.workMode } : {}),
        taskGoal: input.declaration.payload.taskGoal,
        deliverables: input.declaration.payload.deliverables.slice(0, 8),
        requiredInputCount: requiredInputKeys.length,
        providedRequiredInputCount: requiredInputKeys.filter((key) => coverage.get(key) === 'provided').length,
        missingRequiredInputKeys,
        assumedRequiredInputKeys,
        contextRefs: input.declaration.payload.contextRefs.slice(0, 16),
        constraintCount: input.declaration.payload.constraints.length,
        boundaries: {
            digestOnly: true,
            modelAuthored: true,
            changesTaskResult: false,
            grantsPermission: false
        }
    };
}

export function buildDeclareDesignBriefToolSchema(input: {
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
    allowedContextRefs: readonly string[];
    inputSources: SkillRuntimeInputSourceMap;
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    workModeRequired?: boolean;
    workModeInputContracts?: RuntimeDesignBriefWorkModeInputContracts;
    expectedWorkMode?: RuntimeDesignWorkMode;
}): RuntimeDesignBriefToolSchema {
    const requiredInputKeys = normalizeInputKeys(input.requiredInputKeys);
    const optionalInputKeys = normalizeInputKeys(input.optionalInputKeys)
        .filter((key) => !requiredInputKeys.includes(key));
    const workModeInputContracts = Object.fromEntries(
        DESIGN_WORK_MODES.flatMap((workMode) => {
            const contract = input.workModeInputContracts?.[workMode];
            if (!contract) return [];
            return [[workMode, {
                requiredInputKeys: normalizeInputKeys(contract.requiredInputKeys),
                optionalInputKeys: normalizeInputKeys(contract.optionalInputKeys)
            }]];
        })
    ) as RuntimeDesignBriefWorkModeInputContracts;
    const workModeContractEntries = DESIGN_WORK_MODES.flatMap((workMode) => {
        const contract = workModeInputContracts[workMode];
        return contract ? [[workMode, contract] as const] : [];
    });
    const knownInputKeys = normalizeInputKeys([
        ...requiredInputKeys,
        ...optionalInputKeys,
        ...workModeContractEntries.flatMap(([, contract]) => [
            ...contract.requiredInputKeys,
            ...contract.optionalInputKeys
        ])
    ]);
    const schemaResolvedInputs = input.resolvedInputs.filter((item) => (
        knownInputKeys.includes(item.inputKey)
        && (input.inputSources[item.inputKey] || []).includes(item.sourceKind)
        && item.contextRef === buildResolvedInputContextRef(item.inputKey, item.sourceKind)
    ));
    const contextRefs = Array.from(new Set([
        ...input.allowedContextRefs.map((ref) => String(ref || '').trim()).filter(Boolean),
        ...schemaResolvedInputs.map((item) => item.contextRef)
    ]));
    // inputCoverage 不是“本轮引用了哪些上下文”，而是“哪个精确输入已由哪个
    // Harness 解析来源满足”。通用 context:* 引用仍可放在顶层 contextRefs 中，
    // 但不能出现在 coverage 的 schema 选项里诱导模型把它当成 inputKey 绑定。
    const resolvedCoverageContextRefs = Array.from(new Set(
        schemaResolvedInputs.map((item) => item.contextRef)
    ));
    const requiredSummary = requiredInputKeys.length > 0 ? requiredInputKeys.join(', ') : 'none';
    const optionalSummary = optionalInputKeys.length > 0 ? optionalInputKeys.join(', ') : 'none';
    const workModeSummary = workModeContractEntries.map(([workMode, contract]) => {
        const required = contract.requiredInputKeys.length > 0
            ? contract.requiredInputKeys.join(', ')
            : 'none';
        const optional = contract.optionalInputKeys.length > 0
            ? contract.optionalInputKeys.join(', ')
            : 'none';
        return `${workMode}: required=[${required}], optional=[${optional}]`;
    }).join('; ');
    const usesWorkModeContracts = workModeContractEntries.length > 0;
    const resolvedInputSummary = knownInputKeys.map((inputKey) => {
        const refs = schemaResolvedInputs
            .filter((item) => item.inputKey === inputKey)
            .map((item) => item.contextRef);
        return `${inputKey}=[${refs.join(', ') || 'missing'}]`;
    }).join('; ');
    return {
        name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
        description: [
            'Declare the current R1 design brief as model-authored structured context before strategy or execution.',
            describeWorkModeRequirement(input),
            ...(usesWorkModeContracts
                ? [
                    `Work-mode input contracts from the selected Skill manifest: ${workModeSummary}.`,
                    'Select workMode first, then report the complete replacement contract for that mode; do not copy inputs from the default or another mode.'
                ]
                : [
                    `Required inputs from the selected Skill manifest: ${requiredSummary}.`,
                    `Optional inputs from the selected Skill manifest: ${optionalSummary}.`
                ]),
            `Harness-resolved input refs by inputKey: ${resolvedInputSummary || 'none'}.`,
            'Report every required input in inputCoverage. Mark it provided only by citing a resolved ref listed for that exact inputKey; a general context ref cannot satisfy another input.',
            'Missing or assumed required inputs keep the brief in needs_input; continue readonly observation or ask the user.',
            'This control tool does not execute Photoshop, activate capabilities, grant permission, count as progress or prove design quality.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                workMode: {
                    type: 'string',
                    enum: input.expectedWorkMode ? [input.expectedWorkMode] : [...DESIGN_WORK_MODES]
                },
                taskGoal: { type: 'string', minLength: 1, maxLength: MAX_TEXT },
                deliverables: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                },
                targetAudience: { type: 'string', maxLength: MAX_TEXT },
                channel: { type: 'string', maxLength: MAX_TEXT },
                outputRequirements: {
                    type: 'array',
                    maxItems: 12,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                },
                constraints: {
                    type: 'array',
                    maxItems: 16,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                },
                inputCoverage: {
                    type: 'array',
                    // JSON Schema 无法可靠地表达“先选 workMode，再切换整套输入契约”；
                    // 模式化 Skill 由下游确定性校验按已声明 workMode 强制，不能把默认输入误设为所有模式必填。
                    minItems: usesWorkModeContracts ? 0 : requiredInputKeys.length,
                    maxItems: Math.max(knownInputKeys.length, requiredInputKeys.length),
                    items: {
                        type: 'object',
                        properties: {
                            inputKey: {
                                type: 'string',
                                ...(knownInputKeys.length > 0 ? { enum: knownInputKeys } : {})
                            },
                            status: { type: 'string', enum: ['provided', 'missing', 'assumed'] },
                            contextRefs: {
                                type: 'array',
                                maxItems: resolvedCoverageContextRefs.length > 0 ? 8 : 0,
                                items: {
                                    type: 'string',
                                    ...(resolvedCoverageContextRefs.length > 0
                                        ? { enum: resolvedCoverageContextRefs }
                                        : {})
                                }
                            },
                            note: { type: 'string', maxLength: 240 }
                        },
                        required: ['inputKey', 'status', 'contextRefs'],
                        additionalProperties: false
                    }
                },
                contextRefs: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 16,
                    items: {
                        type: 'string',
                        ...(contextRefs.length > 0 ? { enum: contextRefs } : {})
                    }
                }
            },
            required: [
                ...(input.workModeRequired ? ['workMode'] : []),
                'taskGoal',
                'deliverables',
                'outputRequirements',
                'constraints',
                'inputCoverage',
                'contextRefs'
            ],
            additionalProperties: false
        }
    };
}

export function isDesignBriefControlTool(value: unknown): boolean {
    return String(value || '').trim() === DECLARE_DESIGN_BRIEF_TOOL_NAME;
}
