export type AgentNoRedoProviderProbeExpectedPolicy =
    | 'reuse_completed_step'
    | 'redo_required'
    | 'none';

export type AgentNoRedoProviderProbeVerdict =
    | 'exact_reuse'
    | 'exact_redo'
    | 'correct_no_mapping'
    | 'missing_declaration'
    | 'repeated_declaration'
    | 'invalid_declaration'
    | 'boundary_record_invalid'
    | 'unsafe_tool_observed'
    | 'mapping_omitted'
    | 'false_equivalence'
    | 'wrong_prior_step'
    | 'wrong_policy'
    | 'over_mapped';

export interface AgentNoRedoProviderProbeSpec {
    id: string;
    expectedPolicy: AgentNoRedoProviderProbeExpectedPolicy;
    expectedPriorStepId?: string;
    maxDeclarations?: number;
}

export interface AgentNoRedoProviderProbeMappingRecord {
    currentStepId: string;
    priorStepId: string;
    policy: 'reuse_completed_step' | 'redo_required';
}

export interface AgentNoRedoProviderProbeEvent {
    name: string;
    success: boolean;
    planControl?: {
        status: 'validated' | 'invalid';
        mappings: AgentNoRedoProviderProbeMappingRecord[];
        issueCodes: string[];
        modelAuthored: boolean;
        harnessValidatedOnly: boolean;
        executesTools: boolean;
        blocksTools: boolean;
        skipsTools: boolean;
        schedulerAuthority: boolean;
    };
}

export interface AgentNoRedoProviderProbeResult {
    version: 'agent-no-redo-provider-probe/v0';
    id: string;
    status: 'passed' | 'failed';
    verdict: AgentNoRedoProviderProbeVerdict;
    mappings: AgentNoRedoProviderProbeMappingRecord[];
    observedToolNames: string[];
    declarationCount: number;
    validationIssueCodes: string[];
    issues: string[];
    metrics: {
        mappingCount: number;
        reuseMappingCount: number;
        redoMappingCount: number;
    };
    boundaries: {
        allowlistedRecordsOnly: true;
        containsRawArguments: false;
        containsFullPlan: false;
        containsProviderText: false;
        evaluatesFreeText: false;
        executesTools: false;
        executesPhotoshop: false;
        grantsPermission: false;
        changesTaskResult: false;
        countsAsDesignQuality: false;
    };
}

const DECLARE_ACTION_PLAN_TOOL = 'declareRuntimeActionPlan';
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;

function cleanTokens(values: readonly unknown[], limit = 20): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter((value) => /^[A-Za-z0-9_.:-]{1,100}$/.test(value))))
        .slice(0, limit);
}

function cleanMappings(
    values: readonly AgentNoRedoProviderProbeMappingRecord[]
): AgentNoRedoProviderProbeMappingRecord[] {
    const mappings: AgentNoRedoProviderProbeMappingRecord[] = [];
    for (const value of values) {
        const currentStepId = String(value?.currentStepId || '').trim();
        const priorStepId = String(value?.priorStepId || '').trim();
        const policy = value?.policy;
        if (!ID_PATTERN.test(currentStepId) || !ID_PATTERN.test(priorStepId)) continue;
        if (policy !== 'reuse_completed_step' && policy !== 'redo_required') continue;
        mappings.push({ currentStepId, priorStepId, policy });
        if (mappings.length >= 12) break;
    }
    return mappings;
}

function boundaries(): AgentNoRedoProviderProbeResult['boundaries'] {
    return {
        allowlistedRecordsOnly: true,
        containsRawArguments: false,
        containsFullPlan: false,
        containsProviderText: false,
        evaluatesFreeText: false,
        executesTools: false,
        executesPhotoshop: false,
        grantsPermission: false,
        changesTaskResult: false,
        countsAsDesignQuality: false
    };
}

function buildResult(input: {
    spec: AgentNoRedoProviderProbeSpec;
    events: readonly AgentNoRedoProviderProbeEvent[];
    status: AgentNoRedoProviderProbeResult['status'];
    verdict: AgentNoRedoProviderProbeVerdict;
    mappings?: AgentNoRedoProviderProbeMappingRecord[];
    issueCodes?: string[];
    issues?: string[];
}): AgentNoRedoProviderProbeResult {
    const mappings = cleanMappings(input.mappings || []);
    return {
        version: 'agent-no-redo-provider-probe/v0',
        id: String(input.spec.id || '').slice(0, 100),
        status: input.status,
        verdict: input.verdict,
        mappings,
        observedToolNames: cleanTokens(input.events.map((event) => event.name)),
        declarationCount: input.events.filter((event) => event.name === DECLARE_ACTION_PLAN_TOOL).length,
        validationIssueCodes: cleanTokens(input.issueCodes || []),
        issues: (input.issues || []).map((issue) => String(issue || '').slice(0, 240)).slice(0, 12),
        metrics: {
            mappingCount: mappings.length,
            reuseMappingCount: mappings.filter((mapping) => mapping.policy === 'reuse_completed_step').length,
            redoMappingCount: mappings.filter((mapping) => mapping.policy === 'redo_required').length
        },
        boundaries: boundaries()
    };
}

function failed(input: Omit<Parameters<typeof buildResult>[0], 'status'>): AgentNoRedoProviderProbeResult {
    return buildResult({ ...input, status: 'failed' });
}

function passed(input: Omit<Parameters<typeof buildResult>[0], 'status'>): AgentNoRedoProviderProbeResult {
    return buildResult({ ...input, status: 'passed' });
}

export function evaluateAgentNoRedoProviderProbe(input: {
    spec: AgentNoRedoProviderProbeSpec;
    events: readonly AgentNoRedoProviderProbeEvent[];
}): AgentNoRedoProviderProbeResult {
    const spec = input.spec;
    const events = [...input.events];
    const unsafeEvents = events.filter((event) => event.name !== DECLARE_ACTION_PLAN_TOOL);
    if (unsafeEvents.length > 0) {
        return failed({
            spec,
            events,
            verdict: 'unsafe_tool_observed',
            issues: ['探针观察到 declareRuntimeActionPlan 之外的 Tool；该 Tool 未执行。']
        });
    }
    const declarationEvents = events.filter((event) => event.name === DECLARE_ACTION_PLAN_TOOL);
    if (declarationEvents.length === 0) {
        return failed({
            spec,
            events,
            verdict: 'missing_declaration',
            issues: ['provider 没有提交结构化 R4 声明。']
        });
    }
    const maxDeclarations = Math.max(1, Math.floor(Number(spec.maxDeclarations) || 1));
    if (declarationEvents.length > maxDeclarations) {
        return failed({
            spec,
            events,
            verdict: 'repeated_declaration',
            issues: [`观察到 ${declarationEvents.length} 次声明，允许上限为 ${maxDeclarations}。`]
        });
    }
    const event = declarationEvents[0];
    const planControl = event.planControl;
    const issueCodes = cleanTokens(planControl?.issueCodes || []);
    if (event.success !== true || !planControl || planControl.status !== 'validated') {
        return failed({
            spec,
            events,
            verdict: 'invalid_declaration',
            issueCodes,
            issues: ['provider 声明未通过生产 R4 validator。']
        });
    }
    if (planControl.modelAuthored !== true
        || planControl.harnessValidatedOnly !== true
        || planControl.executesTools !== false
        || planControl.blocksTools !== false
        || planControl.skipsTools !== false
        || planControl.schedulerAuthority !== false) {
        return failed({
            spec,
            events,
            verdict: 'boundary_record_invalid',
            mappings: planControl.mappings,
            issues: ['声明事件缺少模型拥有 / Harness 只校验 / 不执行不阻断不跳过不调度边界。']
        });
    }
    const mappings = cleanMappings(planControl.mappings || []);
    if (spec.expectedPolicy === 'none') {
        if (mappings.length === 0) {
            return passed({ spec, events, verdict: 'correct_no_mapping', mappings });
        }
        return failed({
            spec,
            events,
            verdict: 'false_equivalence',
            mappings,
            issues: ['当前动作与旧完成节点无明确等价关系，但模型仍提交了 resumeMapping。']
        });
    }
    if (mappings.length === 0) {
        return failed({
            spec,
            events,
            verdict: 'mapping_omitted',
            issues: ['当前样本要求显式复用或重做映射，但声明没有 resumeMapping。']
        });
    }
    if (mappings.length > 1) {
        return failed({
            spec,
            events,
            verdict: 'over_mapped',
            mappings,
            issues: ['当前聚焦样本只允许一个映射，模型提交了多个映射。']
        });
    }
    const mapping = mappings[0];
    if (mapping.priorStepId !== String(spec.expectedPriorStepId || '').trim()) {
        return failed({
            spec,
            events,
            verdict: 'wrong_prior_step',
            mappings,
            issues: ['模型映射到错误的旧完成节点。']
        });
    }
    if (mapping.policy !== spec.expectedPolicy) {
        return failed({
            spec,
            events,
            verdict: 'wrong_policy',
            mappings,
            issues: ['旧节点选择正确，但复用 / 重做策略错误。']
        });
    }
    return passed({
        spec,
        events,
        verdict: spec.expectedPolicy === 'reuse_completed_step' ? 'exact_reuse' : 'exact_redo',
        mappings
    });
}
