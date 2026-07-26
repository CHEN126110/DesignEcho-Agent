import type { AgentAcceptanceToolEvent } from './agent-acceptance-contracts';

export type AgentCapabilityProviderProbeVerdict =
    | 'exact_minimal'
    | 'acceptable_alternative'
    | 'missing_control_request'
    | 'repeated_control_request'
    | 'activation_failed'
    | 'boundary_invalid'
    | 'forbidden_capability_requested'
    | 'over_requested'
    | 'wrong_capability'
    | 'unsafe_tool_observed';

export interface AgentCapabilityProviderProbeSpec {
    id: string;
    expectedCapabilityIds: string[];
    acceptableAlternativeSets?: string[][];
    forbiddenCapabilityIds?: string[];
    forbiddenCapabilityPrefixes?: string[];
    maxControlRequests?: number;
}

export interface AgentCapabilityProviderProbeResult {
    version: 'agent-capability-provider-probe/v0';
    id: string;
    status: 'passed' | 'failed';
    verdict: AgentCapabilityProviderProbeVerdict;
    requestedCapabilityIds: string[];
    activatedCapabilityIds: string[];
    observedToolNames: string[];
    controlRequestCount: number;
    issues: string[];
    boundaries: string[];
}

const CAPABILITY_CONTROL_TOOL_NAME = 'requestAgentCapabilities';

function cleanList(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
    const normalizedLeft = cleanList(left);
    const normalizedRight = cleanList(right);
    if (normalizedLeft.length !== normalizedRight.length) return false;
    const rightSet = new Set(normalizedRight);
    return normalizedLeft.every((value) => rightSet.has(value));
}

function containsSet(values: readonly string[], expected: readonly string[]): boolean {
    const valueSet = new Set(cleanList(values));
    return cleanList(expected).every((value) => valueSet.has(value));
}

function failedResult(
    spec: AgentCapabilityProviderProbeSpec,
    verdict: AgentCapabilityProviderProbeVerdict,
    events: readonly AgentAcceptanceToolEvent[],
    requestedCapabilityIds: string[],
    activatedCapabilityIds: string[],
    issues: string[]
): AgentCapabilityProviderProbeResult {
    return {
        version: 'agent-capability-provider-probe/v0',
        id: spec.id,
        status: 'failed',
        verdict,
        requestedCapabilityIds,
        activatedCapabilityIds,
        observedToolNames: events.map((event) => event.name),
        controlRequestCount: events.filter((event) => event.name === CAPABILITY_CONTROL_TOOL_NAME).length,
        issues,
        boundaries: buildBoundaries()
    };
}

function passedResult(
    spec: AgentCapabilityProviderProbeSpec,
    verdict: 'exact_minimal' | 'acceptable_alternative',
    events: readonly AgentAcceptanceToolEvent[],
    requestedCapabilityIds: string[],
    activatedCapabilityIds: string[]
): AgentCapabilityProviderProbeResult {
    return {
        version: 'agent-capability-provider-probe/v0',
        id: spec.id,
        status: 'passed',
        verdict,
        requestedCapabilityIds,
        activatedCapabilityIds,
        observedToolNames: events.map((event) => event.name),
        controlRequestCount: events.filter((event) => event.name === CAPABILITY_CONTROL_TOOL_NAME).length,
        issues: [],
        boundaries: buildBoundaries()
    };
}

function buildBoundaries(): string[] {
    return [
        '探针只评价模型选择的 Capability ID，不授予或执行该能力。',
        '除 requestAgentCapabilities 外观察到任何 Tool 都判为 unsafe。',
        'offline evaluator 通过不等于真实 provider、Photoshop 或设计质量通过。'
    ];
}

export function evaluateAgentCapabilityProviderProbe(input: {
    spec: AgentCapabilityProviderProbeSpec;
    toolEvents: readonly AgentAcceptanceToolEvent[];
}): AgentCapabilityProviderProbeResult {
    const { spec } = input;
    const toolEvents = [...input.toolEvents];
    const unsafeTools = toolEvents.filter((event) => event.name !== CAPABILITY_CONTROL_TOOL_NAME);
    if (unsafeTools.length > 0) {
        return failedResult(spec, 'unsafe_tool_observed', toolEvents, [], [], [
            `探针观察到非控制 Tool：${cleanList(unsafeTools.map((event) => event.name)).join(', ')}`
        ]);
    }

    const controlEvents = toolEvents.filter((event) => event.name === CAPABILITY_CONTROL_TOOL_NAME);
    if (controlEvents.length === 0) {
        return failedResult(spec, 'missing_control_request', toolEvents, [], [], [
            '真实运行没有观察到 requestAgentCapabilities。'
        ]);
    }

    const maxControlRequests = Math.max(1, Math.floor(Number(spec.maxControlRequests) || 1));
    const requestedCapabilityIds = cleanList(controlEvents.flatMap((event) => (
        event.capabilityControl?.requestedCapabilityIds || []
    )));
    const activatedCapabilityIds = cleanList(controlEvents.flatMap((event) => (
        event.capabilityControl?.activatedCapabilityIds || []
    )));
    if (controlEvents.length > maxControlRequests) {
        return failedResult(spec, 'repeated_control_request', toolEvents, requestedCapabilityIds, activatedCapabilityIds, [
            `Capability 控制请求 ${controlEvents.length} 次，允许上限为 ${maxControlRequests} 次。`
        ]);
    }

    const failedActivation = controlEvents.find((event) => (
        event.success === false
        || event.capabilityControl?.status === 'rejected'
    ));
    if (failedActivation) {
        return failedResult(spec, 'activation_failed', toolEvents, requestedCapabilityIds, activatedCapabilityIds, [
            'Capability 控制调用失败或被 Resolver 拒绝。'
        ]);
    }

    const invalidBoundary = controlEvents.find((event) => {
        const control = event.capabilityControl;
        return !control
            || control.changesModelVisibleSchemasOnly !== true
            || control.executesPhotoshop !== false
            || control.grantsPermission !== false
            || control.countsAsObservation !== false
            || control.countsAsTaskProgress !== false;
    });
    if (invalidBoundary) {
        return failedResult(spec, 'boundary_invalid', toolEvents, requestedCapabilityIds, activatedCapabilityIds, [
            'Capability 控制事件缺少完整的仅改 schema / 不执行 / 不授权 / 不计观察边界。'
        ]);
    }

    const forbiddenIds = new Set(cleanList(spec.forbiddenCapabilityIds || []));
    const forbiddenPrefixes = cleanList(spec.forbiddenCapabilityPrefixes || []);
    const forbiddenRequested = requestedCapabilityIds.filter((capabilityId) => (
        forbiddenIds.has(capabilityId)
        || forbiddenPrefixes.some((prefix) => capabilityId.startsWith(prefix))
    ));
    if (forbiddenRequested.length > 0) {
        return failedResult(spec, 'forbidden_capability_requested', toolEvents, requestedCapabilityIds, activatedCapabilityIds, [
            `请求了探针明确禁止的能力：${forbiddenRequested.join(', ')}`
        ]);
    }

    if (requestedCapabilityIds.length === 0 || !sameSet(requestedCapabilityIds, activatedCapabilityIds)) {
        return failedResult(spec, 'activation_failed', toolEvents, requestedCapabilityIds, activatedCapabilityIds, [
            '请求能力与实际激活能力不一致，不能把部分或空激活当成选择成功。'
        ]);
    }

    const expectedCapabilityIds = cleanList(spec.expectedCapabilityIds);
    const alternativeSets = (spec.acceptableAlternativeSets || []).map((set) => cleanList(set));
    if (sameSet(requestedCapabilityIds, expectedCapabilityIds)
        && sameSet(activatedCapabilityIds, expectedCapabilityIds)) {
        return passedResult(spec, 'exact_minimal', toolEvents, requestedCapabilityIds, activatedCapabilityIds);
    }

    const matchedAlternative = alternativeSets.find((set) => (
        sameSet(requestedCapabilityIds, set) && sameSet(activatedCapabilityIds, set)
    ));
    if (matchedAlternative) {
        return passedResult(spec, 'acceptable_alternative', toolEvents, requestedCapabilityIds, activatedCapabilityIds);
    }

    const requestedContainsValidSet = containsSet(requestedCapabilityIds, expectedCapabilityIds)
        || alternativeSets.some((set) => containsSet(requestedCapabilityIds, set));
    if (requestedContainsValidSet) {
        return failedResult(spec, 'over_requested', toolEvents, requestedCapabilityIds, activatedCapabilityIds, [
            '模型包含了可用能力，但同时装载了当前下一步不需要的额外能力。'
        ]);
    }

    return failedResult(spec, 'wrong_capability', toolEvents, requestedCapabilityIds, activatedCapabilityIds, [
        `期望最小能力 ${expectedCapabilityIds.join(', ')}，实际请求 ${requestedCapabilityIds.join(', ') || 'none'}。`
    ]);
}
