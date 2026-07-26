/**
 * PlannerModelCaller —— 详情页规划模型调用的可注入收口（按 GPT 修正 2：统一单一 invoke 事件流）。
 *
 * 对外**只暴露 invoke**：每个逻辑调用返回一条标准化事件流（started → reasoning/content delta →
 * provider.completed → completed，或 failed/cancelled）。oneshot 只是 delivery 选项，不是另一套返回。
 * 调用方一律消费事件流，不再分流式/非流式两套代码。
 *
 * "invoke 只一次"指**逻辑调用**一次：底层 Provider Adapter 可重试/fallback（多 providerAttempts），
 * 但必须同一 callId、最终只产生一个 terminal event（completed | failed | cancelled）。
 *
 * 分层（shared 不依赖 renderer）：本模块只定义接口 + 事件协议 + 注入机制 + 计数 spy + invokeAndCollect
 * helper，纯逻辑、可 Node smoke。真实实现（包 streamChatAsync / designEcho.chat 为事件流）由 renderer
 * 启动时 setPlannerModelCaller 绑定。未绑定即调用显式抛错（fail-fast）。
 *
 * 注意：P0 阶段 blocked/structure_only 都不调模型，full 不触发，故 invoke 在 P0 真机不会被执行；
 * 它为未来 full 路径（Step 1A.0）与终结事件协议（假死修复）铺路，P0 仅用 smoke/注入测试验证。
 */

export type PlannerMessage = { role: string; content: string };

export interface TokenUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export type ModelFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'resource_error';

/** 标准化模型事件。每个 callId 恰好一个 terminal event：completed | failed | cancelled。 */
export type ModelStreamEvent =
    | { type: 'started'; callId: string; sequence: number }
    | { type: 'reasoning.delta'; callId: string; sequence: number; delta: string }
    | { type: 'content.delta'; callId: string; sequence: number; delta: string }
    | { type: 'usage'; callId: string; sequence: number; usage: TokenUsage }
    | { type: 'provider.completed'; callId: string; sequence: number; finishReason: ModelFinishReason }
    | { type: 'completed'; callId: string; sequence: number; result: { text: string; thinking?: string } }
    | { type: 'failed'; callId: string; sequence: number; error: { code: string; message: string } }
    | { type: 'cancelled'; callId: string; sequence: number };

/** 终结事件类型集合（每个 callId 恰好出现一次其中之一）。 */
export const TERMINAL_EVENT_TYPES: ReadonlyArray<ModelStreamEvent['type']> = ['completed', 'failed', 'cancelled'];

export function isTerminalEvent(event: ModelStreamEvent): boolean {
    return (TERMINAL_EVENT_TYPES as ReadonlyArray<string>).includes(event.type);
}

export interface ModelInvocationRequest {
    /** 单次逻辑调用 id；所有事件共享，provider 重试也保持同一 callId。 */
    callId: string;
    /** 能力档位（如 reasoning.default / vision.reference）——对外只声明能力，不暴露供应商模型名。 */
    modelProfile: string;
    /** 实际模型 id（内部路由用，不对外宣称）。 */
    modelId: string;
    messages: PlannerMessage[];
    temperature?: number;
    thinkingEnabled?: boolean;
}

export interface InvokeOptions {
    delivery: 'stream' | 'buffered';
    signal?: AbortSignal;
}

export interface PlannerModelCaller {
    /** 唯一对外方法：发起一次逻辑调用，返回标准化事件流。 */
    invoke(request: ModelInvocationRequest, options: InvokeOptions): AsyncIterable<ModelStreamEvent>;
}

const NOT_CONFIGURED_MESSAGE = 'PlannerModelCaller 未绑定：renderer 启动时须调用 setPlannerModelCaller 绑定真实 invoke 实现。';

const NOT_CONFIGURED_CALLER: PlannerModelCaller = {
    invoke() {
        async function* fail(): AsyncIterable<ModelStreamEvent> {
            throw new Error(NOT_CONFIGURED_MESSAGE);
        }
        return fail();
    }
};

let activeCaller: PlannerModelCaller = NOT_CONFIGURED_CALLER;

/** 绑定真实（或测试）invoke 实现。传 null/undefined 等价于复位为未绑定。 */
export function setPlannerModelCaller(caller: PlannerModelCaller | null | undefined): void {
    activeCaller = caller || NOT_CONFIGURED_CALLER;
}

/** 复位为未绑定（测试隔离用）。 */
export function resetPlannerModelCaller(): void {
    activeCaller = NOT_CONFIGURED_CALLER;
}

/** 取当前规划模型调用器。 */
export function getPlannerModelCaller(): PlannerModelCaller {
    return activeCaller;
}

/** 是否已绑定真实实现。 */
export function isPlannerModelCallerConfigured(): boolean {
    return activeCaller !== NOT_CONFIGURED_CALLER;
}

/**
 * 消费一次 invoke 事件流，累积成 { text, thinking }，并把增量喂给回调（供 UI 流式渲染）。
 * 收到 failed 抛错；收到 cancelled 返回已累积内容并标记 cancelled。每个 callId 只认一个 terminal event。
 */
export interface InvokeCollectCallbacks {
    onProgress?: (fullContent: string, delta: string) => void;
    onThinkingProgress?: (fullThinking: string, delta: string) => void;
}
export interface InvokeCollectResult {
    text: string;
    thinking?: string;
    cancelled: boolean;
}

export async function invokeAndCollect(
    caller: PlannerModelCaller,
    request: ModelInvocationRequest,
    options: InvokeOptions,
    callbacks?: InvokeCollectCallbacks
): Promise<InvokeCollectResult> {
    let text = '';
    let thinking = '';
    let terminalSeen = false;
    let cancelled = false;
    for await (const event of caller.invoke(request, options)) {
        if (terminalSeen) continue; //  终结事件后忽略多余事件（防御）
        switch (event.type) {
            case 'content.delta':
                text += event.delta;
                callbacks?.onProgress?.(text, event.delta);
                break;
            case 'reasoning.delta':
                thinking += event.delta;
                callbacks?.onThinkingProgress?.(thinking, event.delta);
                break;
            case 'completed':
                text = event.result.text || text;
                thinking = event.result.thinking || thinking;
                terminalSeen = true;
                break;
            case 'failed':
                terminalSeen = true;
                throw new Error(event.error?.message || '模型调用失败。');
            case 'cancelled':
                cancelled = true;
                terminalSeen = true;
                break;
            default:
                break; //  started / usage / provider.completed 不改累积值
        }
    }
    return { text, thinking: thinking || undefined, cancelled };
}

/**
 * 计数 spy（注入测试用）：记录逻辑 invoke 调用次数，并按脚本产生标准事件流。
 * providerAttempts 可模拟底层重试（多 attempt 仍一个 terminal event、一次 logicalCall）。
 */
export interface PlannerModelCallerSpy extends PlannerModelCaller {
    invokeCalls: number;
    lastDelivery?: 'stream' | 'buffered';
}

export function createCountingPlannerModelCaller(script?: {
    content?: string;
    thinking?: string;
    fail?: { code: string; message: string };
}): PlannerModelCallerSpy {
    const spy: PlannerModelCallerSpy = {
        invokeCalls: 0,
        invoke(request: ModelInvocationRequest, options: InvokeOptions): AsyncIterable<ModelStreamEvent> {
            spy.invokeCalls += 1;
            spy.lastDelivery = options.delivery;
            const callId = request.callId;
            const content = script?.content || '';
            const thinking = script?.thinking || '';
            const fail = script?.fail;
            async function* gen(): AsyncIterable<ModelStreamEvent> {
                let seq = 0;
                yield { type: 'started', callId, sequence: seq++ };
                if (thinking) yield { type: 'reasoning.delta', callId, sequence: seq++, delta: thinking };
                if (fail) {
                    yield { type: 'failed', callId, sequence: seq++, error: fail };
                    return;
                }
                if (content) yield { type: 'content.delta', callId, sequence: seq++, delta: content };
                yield { type: 'provider.completed', callId, sequence: seq++, finishReason: 'stop' };
                yield { type: 'completed', callId, sequence: seq++, result: { text: content, thinking: thinking || undefined } };
            }
            return gen();
        }
    };
    return spy;
}
