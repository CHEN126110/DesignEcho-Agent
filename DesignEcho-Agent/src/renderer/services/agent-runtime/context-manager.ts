/**
 * Context Manager
 *
 * 以消息来源和完整 Tool exchange 为单位管理 Agent 运行上下文。
 * Token 预算只是最后一道容量约束；当前用户目标、消息权限与 Tool 协议完整性优先。
 */

import { buildAgentContextWindowBudget } from '../../../shared/agent-performance-policy';
import { buildRuntimeContextEnvelope } from '../../../shared/agent-runtime-v5/runtime-context-compiler';
import type { AgentMessage, ToolResult } from './types';

interface ContextManagerConfig {
    maxTokens: number;
    /** 保留最近 N 个完整模型轮次 / 消息单元。 */
    keepRecentRounds: number;
}

interface MessageUnit {
    messages: AgentMessage[];
    protected: boolean;
    recent: boolean;
}

const DEFAULT_CONTEXT_BUDGET = buildAgentContextWindowBudget();

const DEFAULT_CONFIG: ContextManagerConfig = {
    maxTokens: DEFAULT_CONTEXT_BUDGET.maxTokens,
    keepRecentRounds: DEFAULT_CONTEXT_BUDGET.keepRecentRounds
};

const SAFE_TOOL_RESULT_KEYS = [
    'success',
    'status',
    'code',
    'error',
    'message',
    'summary',
    'reason',
    'documentId',
    'layerId',
    'documentName',
    'layerName',
    'count',
    'total',
    'changed',
    'cancelled',
    'notExecuted',
    'countsAsObservation',
    'countsAsTaskProgress'
] as const;

function estimateTokens(message: AgentMessage): number {
    let chars = 0;
    if (message.content) chars += message.content.length;
    for (const block of message.contentBlocks || []) {
        if (block.type === 'text') chars += String(block.text || '').length;
        if (block.type === 'image') chars += 1200;
    }
    for (const call of message.toolCalls || []) {
        chars += call.name.length;
        chars += JSON.stringify(call.arguments).length;
    }
    for (const result of message.toolResults || []) {
        const output = typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output);
        chars += output.length;
    }
    return Math.ceil(chars / 1.5);
}

function estimateMessages(messages: readonly AgentMessage[]): number {
    return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function compactText(value: unknown, maxCharacters: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxCharacters) return text;
    return `${text.slice(0, Math.max(0, maxCharacters - 13)).trimEnd()}…[已截断]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildCompressedToolOutput(result: ToolResult): Record<string, unknown> {
    const raw = result.output;
    const record = isRecord(raw) ? raw : undefined;
    const compact: Record<string, unknown> = {
        compressedHistoricalToolResult: true,
        success: result.success
    };
    if (record) {
        for (const key of SAFE_TOOL_RESULT_KEYS) {
            const value = record[key];
            if (value === undefined) continue;
            if (typeof value === 'string') {
                compact[key] = compactText(value, key === 'error' ? 360 : 240);
            } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
                compact[key] = value;
            }
        }
    } else if (raw !== undefined) {
        compact.summary = compactText(raw, result.success ? 240 : 360);
    }
    compact.contextEnvelope = buildRuntimeContextEnvelope({
        source: 'historical-tool-result',
        trust: 'tool_observation',
        slot: 'tool_observation'
    });
    return compact;
}

function compressToolResultMessage(message: AgentMessage): AgentMessage {
    if (message.role !== 'tool_result' || !message.toolResults) return message;
    return {
        ...message,
        toolResults: message.toolResults.map((result) => ({
            ...result,
            output: buildCompressedToolOutput(result)
        }))
    };
}

function toolResultCoversToolCalls(assistantMessage: AgentMessage, toolResultMessage: AgentMessage): boolean {
    const expected = new Set(
        (assistantMessage.toolCalls || [])
            .map((call) => String(call?.id || '').trim())
            .filter(Boolean)
    );
    if (expected.size === 0) return true;
    if (toolResultMessage.role !== 'tool_result' || !Array.isArray(toolResultMessage.toolResults)) return false;
    const actual = new Set(
        toolResultMessage.toolResults
            .map((result) => String(result?.callId || '').trim())
            .filter(Boolean)
    );
    for (const id of expected) {
        if (!actual.has(id)) return false;
    }
    return true;
}

function preserveToolCallProtocol(messages: AgentMessage[]): AgentMessage[] {
    const result: AgentMessage[] = [];
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
            const next = messages[index + 1];
            if (next && toolResultCoversToolCalls(message, next)) {
                result.push(message, next);
                index += 1;
            }
            continue;
        }
        if (message.role === 'tool_result') continue;
        result.push(message);
    }
    return result;
}

function isCurrentUserMessage(message: AgentMessage, currentUserFound: boolean): boolean {
    if (message.role !== 'user') return false;
    if (message.contextMetadata?.origin === 'current_user_instruction') return true;
    if (message.contextMetadata?.authority === 'policy' || message.contextMetadata?.authority === 'data_only') {
        return false;
    }
    return !currentUserFound;
}

function buildMessageUnits(messages: AgentMessage[]): MessageUnit[] {
    const units: MessageUnit[] = [];
    let currentUserFound = false;
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role === 'tool_result') continue;
        const currentUser = isCurrentUserMessage(message, currentUserFound);
        if (currentUser) currentUserFound = true;

        if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
            const next = messages[index + 1];
            if (!next || !toolResultCoversToolCalls(message, next)) continue;
            const unitMessages = [message, next];
            index += 1;
            while (index + 1 < messages.length) {
                const candidate = messages[index + 1];
                if (candidate.role !== 'user'
                    || candidate.contextMetadata?.origin === 'current_user_instruction') {
                    break;
                }
                unitMessages.push(candidate);
                index += 1;
            }
            units.push({ messages: unitMessages, protected: false, recent: false });
            continue;
        }

        units.push({
            messages: [message],
            protected: message.role === 'system'
                || currentUser
                || message.contextMetadata?.retention === 'pinned',
            recent: false
        });
    }
    return units;
}

function removeSupersededEphemeralMessages(units: MessageUnit[]): MessageUnit[] {
    const seenScopes = new Set<string>();
    const reversed = [...units].reverse().map((unit) => {
        const messages = [...unit.messages].reverse().filter((message) => {
            const metadata = message.contextMetadata;
            if (metadata?.retention !== 'ephemeral' || !metadata.scope) return true;
            if (seenScopes.has(metadata.scope)) return false;
            seenScopes.add(metadata.scope);
            return true;
        }).reverse();
        return { ...unit, messages };
    }).reverse();
    return reversed.filter((unit) => unit.messages.length > 0);
}

function flattenUnits(units: readonly MessageUnit[]): AgentMessage[] {
    return units.flatMap((unit) => unit.messages);
}

export class ContextManager {
    private config: ContextManagerConfig;

    constructor(config?: Partial<ContextManagerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 容量治理顺序：
     * 1. System 与当前用户目标固定保留；同 scope 的旧临时观察先失效。
     * 2. assistant(tool_calls) + tool_result 作为不可拆分单元。
     * 3. 先结构化压缩旧 Tool result，再按完整单元删除最旧历史。
     * 4. 最近单元最后压缩；绝不以固定“三条消息”等价一轮。
     */
    trim(messages: AgentMessage[]): AgentMessage[] {
        const protocolSafe = preserveToolCallProtocol(messages);
        let units = removeSupersededEphemeralMessages(buildMessageUnits(protocolSafe));
        if (estimateMessages(flattenUnits(units)) <= this.config.maxTokens) {
            return flattenUnits(units);
        }

        let recentRemaining = this.config.keepRecentRounds;
        for (let index = units.length - 1; index >= 0 && recentRemaining > 0; index -= 1) {
            if (units[index].protected) continue;
            units[index].recent = true;
            recentRemaining -= 1;
        }

        units = units.map((unit) => unit.recent || unit.protected
            ? unit
            : { ...unit, messages: unit.messages.map(compressToolResultMessage) });
        if (estimateMessages(flattenUnits(units)) <= this.config.maxTokens) {
            return flattenUnits(units);
        }

        for (let index = 0; index < units.length; index += 1) {
            if (estimateMessages(flattenUnits(units)) <= this.config.maxTokens) break;
            const unit = units[index];
            if (unit.protected || unit.recent) continue;
            units.splice(index, 1);
            index -= 1;
        }

        if (estimateMessages(flattenUnits(units)) > this.config.maxTokens) {
            units = units.map((unit) => unit.protected
                ? unit
                : { ...unit, messages: unit.messages.map(compressToolResultMessage) });
        }

        for (let index = 0; index < units.length; index += 1) {
            if (estimateMessages(flattenUnits(units)) <= this.config.maxTokens) break;
            if (units[index].protected) continue;
            units.splice(index, 1);
            index -= 1;
        }

        return preserveToolCallProtocol(flattenUnits(units));
    }

    estimateTotal(messages: AgentMessage[]): number {
        return estimateMessages(messages);
    }
}
