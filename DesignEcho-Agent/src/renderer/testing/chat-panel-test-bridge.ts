import {
    buildAgentRunDebugBundleFromMessage,
    evaluateAgentAcceptance,
    type AgentAcceptanceCase,
} from '../../shared/agent-acceptance-contracts';
import {
    buildAgentAcceptanceDebugExport,
    type AgentAcceptanceDebugExport
} from '../../shared/agent-acceptance-export';
import type { AssistantReplyOrigin } from '../../shared/assistant-reply-origin';

export type ChatPanelAcceptanceDebugResult = AgentAcceptanceDebugExport;

export function buildChatPanelAcceptanceDebug(input: {
    acceptanceCase: AgentAcceptanceCase;
    message: Parameters<typeof buildAgentRunDebugBundleFromMessage>[0]['message'];
}): ChatPanelAcceptanceDebugResult {
    const bundle = buildAgentRunDebugBundleFromMessage(input);
    const report = evaluateAgentAcceptance(input.acceptanceCase, bundle);
    return buildAgentAcceptanceDebugExport({ bundle, report });
}

export type ChatPanelTestSnapshot = {
    isLoading: boolean;
    messageCount: number;
    messages: Array<{
        id: string;
        role: string;
        assistantReplyOrigin?: AssistantReplyOrigin;
        contentPreview: string;
        visibleTextPreview: string;
        hasImage: boolean;
        thinkingStepCount: number;
        thinkingPreview: string;
        thinkingBlockTitles: string[];
        cardTitles: string[];
        cardVariants: string[];
        agentUserVisibleState?: {
            category: string;
            title: string;
            toolUse: string;
            summaryPreview: string;
            nextStepPreview: string;
            canStartTools: boolean;
            userActionRequired: boolean;
        };
        agentDiagnosticRecordKeys?: string[];
        modelMediatedUserReplyUnavailable?: {
            reason?: string;
            rawResponseShape?: string;
            rawTextPreview?: string;
            sanitizedTextPreview?: string;
            errorPreview?: string;
        };
        businessPreflightCardTitles: string[];
        businessPreflightCardCount: number;
        hasBusinessVisualObservationFeedback: boolean;
        hasPublicPlanExecutionRequest: boolean;
        publicPlanRawStatus?: string;
        publicPlanRequestStatus?: string;
        publicPlanProposedWriteTools?: string[];
        publicPlanAllowedWriteTools?: string[];
        publicPlanReadbackTargets?: string[];
        publicPlanOperationCount?: number;
        publicPlanApprovalStatus?: string;
        hasPublicPlanControlledRun: boolean;
        publicPlanControlledRunStatus?: string;
        toolResultCount: number;
        executionStatus?: string;
        executionSummaryPreview?: string;
        conversationalFailureKind?: string;
        conversationalFailureAttempts?: Array<{
            purpose: string;
            status: string;
            errorKind?: string;
            reason?: string;
        }>;
    }>;
};

export type ChatPanelTestBridge = {
    version: number;
    submit: (
        text: string,
        options?: {
            image?: { data: string; type: string };
            timeoutMs?: number;
            publicPlanConfirmationSourceMessageId?: string;
            publicPlanDisposableLiveAdapter?: boolean;
        }
    ) => Promise<ChatPanelTestSnapshot>;
    getSnapshot: () => ChatPanelTestSnapshot;
    resetConversation?: () => ChatPanelTestSnapshot;
    waitForIdle: (timeoutMs?: number) => Promise<ChatPanelTestSnapshot>;
    getLatestAcceptanceDebug: (
        acceptanceCase: AgentAcceptanceCase,
        options?: { messageId?: string }
    ) => ChatPanelAcceptanceDebugResult | Promise<ChatPanelAcceptanceDebugResult>;
};

const CHAT_TEST_BRIDGE_KEY = '__DESIGNECHO_CHAT_TEST_BRIDGE__';

export function isChatPanelTestBridgeEnabled(search = window.location.search || ''): boolean {
    try {
        return new URLSearchParams(search).get('designechoChatTestBridge') === '1';
    } catch {
        return false;
    }
}

export function installChatPanelTestBridge(bridge: ChatPanelTestBridge): () => void {
    if (!isChatPanelTestBridgeEnabled()) {
        delete (window as any)[CHAT_TEST_BRIDGE_KEY];
        return () => {
            delete (window as any)[CHAT_TEST_BRIDGE_KEY];
        };
    }

    (window as any)[CHAT_TEST_BRIDGE_KEY] = bridge;
    return () => {
        const current = (window as any)[CHAT_TEST_BRIDGE_KEY];
        if (current?.version === bridge.version) {
            delete (window as any)[CHAT_TEST_BRIDGE_KEY];
        }
    };
}
