import type { DesignKnowledgeRuntimeSettings } from './design-knowledge-settings';
import type { ProviderNativeWebSearchIntent } from './provider-native-tools';

export interface ChatWebSearchIntent {
    version: 'chat-web-search-policy/v0';
    mode: 'force';
    enabled: true;
    forceSearch: true;
    userExplicitlyRequested: true;
    source: 'user_text';
    userVisibleTopic: string;
    originalUserInput: string;
}

const EXPLICIT_WEB_SEARCH_PATTERN = /(?:联网|网页|网上|互联网|全网|web\s*search|search\s+the\s+web|look\s+up|查资料|搜索|搜一下|帮我搜|帮我查|查找|检索|找.{0,14}(参考|案例|灵感|趋势|竞品|资料|来源|出处|设计方案)|最新|近期|最近|今年|当前趋势|latest|recent|trend)/iu;
const SEARCH_TRIGGER_WORDS_PATTERN = /(?:请|麻烦|帮我|你帮我|给我|我想|我要|需要|可以)?\s*(?:联网|网页|网上|互联网|全网|web\s*search|search\s+the\s+web|look\s+up|查资料|搜索一下|搜索|搜一下|帮我搜|帮我搜索|帮我查|查一下|查找|检索|找一下|找找|找)\s*/giu;
const MAX_VISIBLE_TOPIC_LENGTH = 80;

export function userExplicitlyRequestsWebSearch(input: string): boolean {
    return EXPLICIT_WEB_SEARCH_PATTERN.test(String(input || '').replace(/\s+/g, ' ').trim());
}

export function resolveChatWebSearchIntent(input: {
    userInput?: string;
} = {}): ChatWebSearchIntent | undefined {
    const originalUserInput = normalizeSearchText(input.userInput || '');
    const userExplicitlyRequested = userExplicitlyRequestsWebSearch(originalUserInput);
    if (!userExplicitlyRequested) return undefined;

    return {
        version: 'chat-web-search-policy/v0',
        mode: 'force',
        enabled: true,
        forceSearch: true,
        userExplicitlyRequested: true,
        source: 'user_text',
        userVisibleTopic: buildUserVisibleWebSearchTopic(originalUserInput),
        originalUserInput
    };
}

export function buildUserVisibleWebSearchTopic(input: string): string {
    const normalized = normalizeSearchText(input);
    if (!normalized) return '当前请求相关资料';

    const withoutTriggerWords = normalized
        .replace(SEARCH_TRIGGER_WORDS_PATTERN, '')
        .replace(/^(?:一下|一下子|下|关于|有关|一下关于)\s*/u, '')
        .replace(/[。！？!?]+$/u, '')
        .trim();

    const topic = withoutTriggerWords || normalized;
    return clampVisibleSearchTopic(topic);
}

export function formatChatWebSearchVisibleStep(intent: ChatWebSearchIntent): string {
    return `联网搜索：${intent.userVisibleTopic}`;
}

export function formatChatWebSearchCompletedStep(
    intent: ChatWebSearchIntent,
    input: { citationCount?: number } = {}
): string {
    const citationCount = Number.isFinite(input.citationCount)
        ? Math.max(0, Math.floor(input.citationCount || 0))
        : 0;
    if (citationCount > 0) {
        return `联网搜索：${intent.userVisibleTopic}（已返回 ${citationCount} 个来源）`;
    }
    return `联网搜索：${intent.userVisibleTopic}（已提交给模型整理结果）`;
}

function normalizeSearchText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

function clampVisibleSearchTopic(input: string): string {
    const text = normalizeSearchText(input);
    if (!text) return '当前请求相关资料';
    if (text.length <= MAX_VISIBLE_TOPIC_LENGTH) return text;
    return `${text.slice(0, MAX_VISIBLE_TOPIC_LENGTH - 1)}…`;
}

export function toProviderNativeWebSearchIntent(
    intent: ChatWebSearchIntent | undefined,
    settings?: Partial<DesignKnowledgeRuntimeSettings> | null
): ProviderNativeWebSearchIntent | undefined {
    if (!intent?.enabled) return undefined;
    const xiaomiWebSearch = (settings?.xiaomiWebSearch || {}) as Partial<DesignKnowledgeRuntimeSettings['xiaomiWebSearch']>;
    return {
        type: 'web_search',
        enabled: true,
        forceSearch: intent.forceSearch,
        maxKeyword: xiaomiWebSearch.maxKeyword,
        limit: xiaomiWebSearch.limit,
        userLocation: xiaomiWebSearch.userLocation
    };
}
