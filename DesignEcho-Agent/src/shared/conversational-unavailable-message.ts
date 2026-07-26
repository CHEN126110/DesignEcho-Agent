export type ConversationalProviderFailureKind = 'auth' | 'rate_limit' | 'network' | 'unknown';

export type ConversationalUnavailableAudience = 'general' | 'capability';

export function buildConversationalUnavailableActionHint(kind: ConversationalProviderFailureKind): string {
    if (kind === 'auth') return '请在设置里检查当前模型的 API Key 后再发。';
    if (kind === 'rate_limit') return '稍后再发一次即可。';
    if (kind === 'network') return '稍后再发一次即可。';
    return '';
}

export function buildConversationalUnavailableMessage(input: {
    audience?: ConversationalUnavailableAudience;
    kind?: ConversationalProviderFailureKind;
} = {}): string {
    const kind = input.kind || 'unknown';
    void input.audience;
    const actionHint = buildConversationalUnavailableActionHint(kind);
    if (kind === 'auth') {
        return ['当前模型没有通过认证。', actionHint].filter(Boolean).join('');
    }

    return ['这次没有拿到模型回复，先不继续处理。', actionHint]
        .filter(Boolean)
        .join('');
}
