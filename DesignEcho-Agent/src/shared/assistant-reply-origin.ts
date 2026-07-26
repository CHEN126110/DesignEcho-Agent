export type AssistantReplyOriginVersion = 'assistant-reply-origin/v0';

export type AssistantReplyOriginKind =
    | 'model_authored'
    | 'model_repaired'
    | 'local_conversation_summary'
    | 'ui_status'
    | 'tool_result_summary'
    | 'deterministic_blocker'
    | 'test_fixture'
    | 'unknown';

export type UserVisibleMessageKind =
    | 'assistant_speech'
    | 'status_notice'
    | 'tool_summary'
    | 'blocker_notice'
    | 'test_fixture';

export interface AssistantReplyOrigin {
    version: AssistantReplyOriginVersion;
    origin: AssistantReplyOriginKind;
    userVisibleKind: UserVisibleMessageKind;
    source: string;
    modelPurpose?: string;
    notes?: string[];
}

export function buildAssistantReplyOrigin(input: {
    origin: AssistantReplyOriginKind;
    userVisibleKind: UserVisibleMessageKind;
    source: string;
    modelPurpose?: string;
    notes?: string[];
}): AssistantReplyOrigin {
    return {
        version: 'assistant-reply-origin/v0',
        origin: input.origin,
        userVisibleKind: input.userVisibleKind,
        source: String(input.source || 'unknown').trim() || 'unknown',
        ...(input.modelPurpose ? { modelPurpose: input.modelPurpose } : {}),
        ...(Array.isArray(input.notes) && input.notes.length
            ? { notes: input.notes.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8) }
            : {})
    };
}

export function modelAuthoredReplyOrigin(source: string, modelPurpose = 'direct_response'): AssistantReplyOrigin {
    return buildAssistantReplyOrigin({
        origin: 'model_authored',
        userVisibleKind: 'assistant_speech',
        source,
        modelPurpose
    });
}

export function modelRepairedReplyOrigin(source: string, modelPurpose = 'direct_response_repair'): AssistantReplyOrigin {
    return buildAssistantReplyOrigin({
        origin: 'model_repaired',
        userVisibleKind: 'assistant_speech',
        source,
        modelPurpose
    });
}

export function localConversationSummaryOrigin(source: string): AssistantReplyOrigin {
    return buildAssistantReplyOrigin({
        origin: 'ui_status',
        userVisibleKind: 'status_notice',
        source,
        notes: ['local summaries are UI status only; assistant speech must come from model-authored or repaired replies']
    });
}

export function deterministicBlockerReplyOrigin(source: string): AssistantReplyOrigin {
    return buildAssistantReplyOrigin({
        origin: 'deterministic_blocker',
        userVisibleKind: 'blocker_notice',
        source
    });
}

export function uiStatusReplyOrigin(source: string): AssistantReplyOrigin {
    return buildAssistantReplyOrigin({
        origin: 'ui_status',
        userVisibleKind: 'status_notice',
        source
    });
}

export function toolSummaryReplyOrigin(source: string): AssistantReplyOrigin {
    return buildAssistantReplyOrigin({
        origin: 'tool_result_summary',
        userVisibleKind: 'tool_summary',
        source
    });
}

export function testFixtureReplyOrigin(source: string): AssistantReplyOrigin {
    return buildAssistantReplyOrigin({
        origin: 'test_fixture',
        userVisibleKind: 'test_fixture',
        source,
        notes: ['visible text came from a test provider fixture, not a production model response']
    });
}

export function isAssistantSpeechOrigin(origin: AssistantReplyOrigin | undefined): boolean {
    return origin?.userVisibleKind === 'assistant_speech'
        && (origin.origin === 'model_authored'
            || origin.origin === 'model_repaired');
}

export function normalizeAssistantReplyOriginForDisplay(origin: AssistantReplyOrigin | undefined): AssistantReplyOrigin {
    if (!origin) {
        return uiStatusReplyOrigin('display:missing-origin');
    }
    if (origin.origin === 'unknown') {
        return uiStatusReplyOrigin(origin.source || 'display:unknown-origin');
    }
    if (origin.userVisibleKind === 'assistant_speech' && !isAssistantSpeechOrigin(origin)) {
        return uiStatusReplyOrigin(origin.source || 'display:invalid-assistant-speech-origin');
    }
    return origin;
}

export function isDeterministicVisibleNoticeOrigin(origin: AssistantReplyOrigin | undefined): boolean {
    return origin?.userVisibleKind === 'status_notice'
        || origin?.userVisibleKind === 'blocker_notice'
        || origin?.userVisibleKind === 'tool_summary';
}
