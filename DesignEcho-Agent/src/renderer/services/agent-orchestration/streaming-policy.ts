export type ProviderStreamBlockReason =
    | 'not_requested'
    | 'unsupported_purpose'
    | 'attached_image'
    | 'tool_calling'
    | 'structured_content';

export type ProviderStreamMessage = {
    role: string;
    content: string | unknown[];
};

export type ProviderStreamOptions = {
    stream?: boolean;
    purpose?: string;
};

export type ProviderStreamContext = {
    hasAttachedImage?: boolean;
    hasToolCalling?: boolean;
};

export type ProviderStreamPolicyResult = {
    enabled: boolean;
    reason?: ProviderStreamBlockReason;
};

export function evaluatePlainTextProviderStreamPolicy(
    messages: ProviderStreamMessage[],
    options: ProviderStreamOptions | undefined,
    context: ProviderStreamContext = {}
): ProviderStreamPolicyResult {
    if (options?.stream !== true) {
        return { enabled: false, reason: 'not_requested' };
    }

    if (
        options?.purpose !== 'direct_response'
        && options?.purpose !== 'direct_response_repair'
        && options?.purpose !== 'visible_reasoning'
    ) {
        return { enabled: false, reason: 'unsupported_purpose' };
    }

    if (context.hasAttachedImage) {
        return { enabled: false, reason: 'attached_image' };
    }

    if (context.hasToolCalling) {
        return { enabled: false, reason: 'tool_calling' };
    }

    if (!messages.every(message => typeof message.content === 'string')) {
        return { enabled: false, reason: 'structured_content' };
    }

    return { enabled: true };
}

export function canUsePlainTextProviderStream(
    messages: ProviderStreamMessage[],
    options: ProviderStreamOptions | undefined,
    context: ProviderStreamContext = {}
): boolean {
    return evaluatePlainTextProviderStreamPolicy(messages, options, context).enabled;
}
