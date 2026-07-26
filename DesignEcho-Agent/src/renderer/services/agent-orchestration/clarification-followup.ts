import type { AgentContext } from './types';

export interface ClarificationFollowupContext {
    previousClarification: string;
    recentUserRequest?: string;
}

const SHORT_FOLLOWUP_PATTERNS = [
    /^(那)?(比如|比如呢|比如说|例如|例如呢|举例|举个例子|举几个例子|给我几个例子|可以举例吗)[？?。.!！\s]*$/i,
    /^(什么意思|啥意思|具体一点|说具体点|展开说说)[？?。.!！\s]*$/i,
    /^(怎么说|怎么补充|要补什么|需要什么|哪些信息|哪些内容|你要我说什么)[？?。.!！\s]*$/i
];

const CLARIFICATION_MARKERS = [
    /需要先明确/,
    /请补充/,
    /要处理哪个/,
    /想达到什么效果/,
    /是否允许修改/,
    /缺少明确/,
    /信息不足/,
    /澄清/,
    /clarification/i
];

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isClarificationFollowupInput(input: unknown): boolean {
    const text = normalizeText(input);
    if (!text) return false;
    return SHORT_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(text));
}

function findRecentClarificationMessage(context: AgentContext): string | null {
    const history = Array.isArray(context.conversationHistory) ? context.conversationHistory : [];
    for (const item of [...history].reverse().slice(0, 8)) {
        if (item?.role !== 'assistant') continue;
        const content = normalizeText(item.content);
        if (!content) continue;
        if (CLARIFICATION_MARKERS.some((pattern) => pattern.test(content))) {
            return content;
        }
    }
    return null;
}

function findRecentUserRequestBeforeClarification(context: AgentContext, clarification: string): string | undefined {
    const history = Array.isArray(context.conversationHistory) ? context.conversationHistory : [];
    let clarificationIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.role === 'assistant' && normalizeText(item.content) === clarification) {
            clarificationIndex = index;
            break;
        }
    }
    const searchEnd = clarificationIndex >= 0 ? clarificationIndex : history.length;

    for (let index = searchEnd - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.role !== 'user') continue;
        const content = normalizeText(item.content);
        if (content) return content;
    }
    return undefined;
}

export function detectClarificationFollowupContext(context: AgentContext): ClarificationFollowupContext | null {
    if (!isClarificationFollowupInput(context.userInput)) return null;

    const previousClarification = findRecentClarificationMessage(context);
    if (!previousClarification) return null;

    return {
        previousClarification,
        recentUserRequest: findRecentUserRequestBeforeClarification(context, previousClarification)
    };
}
