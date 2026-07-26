export type AgentResponseInterruptionVersion = 'agent-response-interruption/v0';

export type AgentResponseInterruptionKind = 'user_stopped';

export interface AgentResponseInterruption {
    version: AgentResponseInterruptionVersion;
    kind: AgentResponseInterruptionKind;
}

export const USER_STOPPED_RESPONSE_LABEL = '你已停止此响应';

const LEGACY_USER_STOP_SOURCES = new Set([
    'agent-run:stop',
    'agent-run:user-stopped',
    'agent-run:cancelled-result',
    'agent-run:cancelled-exception'
]);

export function buildUserStoppedResponseInterruption(): AgentResponseInterruption {
    return {
        version: 'agent-response-interruption/v0',
        kind: 'user_stopped'
    };
}

export function normalizeAgentResponseInterruption(
    value: unknown
): AgentResponseInterruption | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Partial<AgentResponseInterruption>;
    if (candidate.version !== 'agent-response-interruption/v0') return undefined;
    if (candidate.kind !== 'user_stopped') return undefined;
    return buildUserStoppedResponseInterruption();
}

export function resolveAgentResponseInterruption(input: {
    interruption?: unknown;
    assistantReplyOrigin?: unknown;
    content?: unknown;
}): AgentResponseInterruption | undefined {
    const explicit = normalizeAgentResponseInterruption(input.interruption);
    if (explicit) return explicit;
    if (!input.assistantReplyOrigin || typeof input.assistantReplyOrigin !== 'object') return undefined;

    const origin = input.assistantReplyOrigin as {
        origin?: unknown;
        source?: unknown;
    };
    if (origin.origin !== 'ui_status') return undefined;
    const source = typeof origin.source === 'string' ? origin.source.trim() : '';
    return LEGACY_USER_STOP_SOURCES.has(source)
        ? buildUserStoppedResponseInterruption()
        : undefined;
}

export function isAgentResponseInterruptionSentinelContent(value: unknown): boolean {
    const content = String(value || '')
        .replace(/\uFE0F/g, '')
        .trim();
    return /^(?:⏹\s*)?(?:已停止|任务已停止|你已停止此响应)$/u.test(content);
}

export function formatAgentResponseInterruption(
    value: unknown
): string | undefined {
    const interruption = normalizeAgentResponseInterruption(value);
    if (!interruption) return undefined;
    return USER_STOPPED_RESPONSE_LABEL;
}
