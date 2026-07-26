#!/usr/bin/env node

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node'
});
require('ts-node/register/transpile-only');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const { OpenAIAdapter } = require('../src/main/services/provider-adapters/openai-adapter.ts');
const {
  buildProviderNativeToolPlan
} = require('../src/shared/provider-native-tools.ts');
const {
  formatChatWebSearchCompletedStep,
  formatChatWebSearchVisibleStep,
  resolveChatWebSearchIntent,
  toProviderNativeWebSearchIntent
} = require('../src/shared/chat-web-search-policy.ts');

const plan = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2.5-pro',
  requestedTools: [
    {
      type: 'web_search',
      enabled: true,
      forceSearch: true,
      maxKeyword: 4,
      limit: 6,
      userLocation: {
        type: 'approximate',
        country: 'China',
        region: 'Hubei',
        city: 'Wuhan'
      }
    }
  ]
});

assert(plan.status === 'ready', 'test fixture should prepare Xiaomi native web_search', plan);

const autoSearchIntent = resolveChatWebSearchIntent({ userInput: '帮我看一下这张图的风格。' });
assert(autoSearchIntent === undefined, 'default chat input should not request provider-native web_search', autoSearchIntent);

const explicitSearchIntent = resolveChatWebSearchIntent({ userInput: '帮我搜索近期袜子详情页参考。' });
assert(explicitSearchIntent.mode === 'force' && explicitSearchIntent.forceSearch === true, 'explicit user search request should force provider-native search for this turn', explicitSearchIntent);
assert(explicitSearchIntent.userVisibleTopic === '近期袜子详情页参考', 'explicit search intent should expose a concise user-visible search topic', explicitSearchIntent);
assert(formatChatWebSearchVisibleStep(explicitSearchIntent) === '联网搜索：近期袜子详情页参考', 'visible search step should tell the user what topic is being searched', explicitSearchIntent);
assert(
  formatChatWebSearchCompletedStep(explicitSearchIntent, { citationCount: 2 }) === '联网搜索：近期袜子详情页参考（已返回 2 个来源）',
  'completed visible search step should summarize returned source count',
  explicitSearchIntent
);

const providerIntent = toProviderNativeWebSearchIntent(explicitSearchIntent, {
  xiaomiWebSearch: {
    enabled: false,
    forceSearch: false,
    maxKeyword: 4,
    limit: 6,
    userLocation: 'China,Hubei,Wuhan'
  }
});
assert(providerIntent.enabled === true && providerIntent.forceSearch === true, 'per-turn search intent should not depend on persistent enablement', providerIntent);

const xiaomiAdapter = new OpenAIAdapter('xiaomi');
const formatted = xiaomiAdapter.formatMessages(
  [{ role: 'user', content: '请搜索近期电商袜子详情页设计趋势。' }],
  [
    {
      name: 'getDocumentInfo',
      description: 'Read current Photoshop document.',
      inputSchema: { type: 'object', properties: {} }
    }
  ],
  {
    nativeTools: plan.nativeTools,
    maxTokens: 1024,
    temperature: 0.2,
    thinkingEnabled: false
  }
);

assert(Array.isArray(formatted.tools), 'formatted request should include tools array', formatted);
assert(formatted.temperature === 0.2, 'explicit Xiaomi temperature should be preserved', formatted);
assert(formatted.top_p === 0.95, 'Xiaomi request should include official recommended top_p', formatted);
assert(formatted.max_completion_tokens === 1024, 'Xiaomi request should use official max_completion_tokens field', formatted);
assert(formatted.max_tokens === undefined, 'Xiaomi request should not use OpenAI max_tokens alias in official requests', formatted);
assert(formatted.thinking?.type === 'disabled', 'Xiaomi tool requests should disable thinking when the caller explicitly disables it', formatted);
assert(formatted.tools.some((tool) => tool.type === 'function'), 'function tools should be preserved', formatted.tools);
assert(formatted.tools.some((tool) => tool.type === 'web_search'), 'Xiaomi web_search should be injected as provider-native tool', formatted.tools);
assert(!formatted.tools.some((tool) => tool.type === 'function' && tool.function?.name === 'web_search'), 'web_search must not be converted into function tool', formatted.tools);
assert(
  formatted.tools.find((tool) => tool.type === 'web_search')?.force_search === true,
  'provider-native web_search options should be preserved',
  formatted.tools
);
assert(
  formatted.tools.find((tool) => tool.type === 'web_search')?.user_location?.city === 'Wuhan',
  'provider-native web_search should preserve official structured user_location',
  formatted.tools
);

const formattedWithoutNativeTools = xiaomiAdapter.formatMessages(
  [{ role: 'user', content: '只读文档。' }],
  [
    {
      name: 'getDocumentInfo',
      description: 'Read current Photoshop document.',
      inputSchema: { type: 'object', properties: {} }
    }
  ],
  { maxTokens: 1024 }
);

assert(
  !formattedWithoutNativeTools.tools.some((tool) => tool.type === 'web_search'),
  'web_search should not be injected unless options.nativeTools is present',
  formattedWithoutNativeTools.tools
);
assert(formattedWithoutNativeTools.temperature === 1.0, 'Xiaomi default temperature should follow official V2.5 recommendation', formattedWithoutNativeTools);
assert(formattedWithoutNativeTools.top_p === 0.95, 'Xiaomi default top_p should follow official V2.5 recommendation', formattedWithoutNativeTools);
assert(formattedWithoutNativeTools.max_completion_tokens === 1024, 'Xiaomi default request should use max_completion_tokens', formattedWithoutNativeTools);
assert(formattedWithoutNativeTools.thinking === undefined, 'undefined thinking preference should remain unspecified at the adapter boundary', formattedWithoutNativeTools);

const formattedWithThinking = xiaomiAdapter.formatMessages(
  [{ role: 'user', content: '分析当前设计。' }],
  [],
  {
    maxTokens: 1024,
    thinkingEnabled: true,
    thinkingRequestParams: { thinking: { type: 'enabled' } }
  }
);
assert(formattedWithThinking.thinking?.type === 'enabled', 'explicit model thinking parameters should pass through the adapter', formattedWithThinking);

const parsed = xiaomiAdapter.parseResponse({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: '可以参考近期袜子详情页趋势。',
        annotations: [
          {
            type: 'url_citation',
            url_citation: {
              url: 'https://example.com/socks-design',
              title: 'Socks Design Reference',
              summary: 'Recent socks design reference',
              site_name: 'Example Design',
              publish_time: '2026-06-02T00:00:00+08:00',
              logo_url: 'https://example.com/favicon.ico'
            }
          }
        ]
      }
    }
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    web_search_usage: {
      request_count: 1
    }
  }
});

assert(parsed.citations?.length === 1, 'Xiaomi url_citation annotations should normalize into ProviderResponse.citations', parsed);
assert(parsed.citations[0].provider === 'xiaomi', 'citation provider should be Xiaomi', parsed.citations);
assert(parsed.citations[0].summary === 'Recent socks design reference', 'Xiaomi citations should keep official summary metadata', parsed.citations);
assert(parsed.citations[0].siteName === 'Example Design', 'Xiaomi citations should keep official site_name metadata', parsed.citations);
assert(parsed.citations[0].publishTime === '2026-06-02T00:00:00+08:00', 'Xiaomi citations should keep official publish_time metadata', parsed.citations);
assert(parsed.nativeToolUsage?.length === 1, 'Xiaomi web_search_usage should normalize into ProviderResponse.nativeToolUsage', parsed);
assert(parsed.nativeToolUsage[0].toolType === 'web_search', 'native tool usage should identify web_search', parsed.nativeToolUsage);

const serviceSource = read('src/main/services/model-service.ts');
assert(serviceSource.includes('nativeTools: options?.nativeTools'), 'ModelService should forward options.nativeTools into adapter.formatMessages');

const streamTypes = read('src/shared/agent-tool-stream.ts');
assert(streamTypes.includes('nativeTools?: ProviderNativeToolRequest[]'), 'Agent stream request options should allow provider-native tools');

const chatPanel = read('src/renderer/components/ChatPanel.tsx');
assert(!chatPanel.includes('data-testid="chat-xiaomi-web-search-toggle"'), 'ChatPanel should not expose a Web Search button in the chat window');
assert(!chatPanel.includes('web-search-toggle'), 'ChatPanel should not keep orphaned Web Search button styles');
assert(chatPanel.includes('resolveChatWebSearchIntent'), 'ChatPanel should resolve per-turn web search policy from user text');
assert(chatPanel.includes('providerNativeWebSearchIntent'), 'ChatPanel should pass the per-turn search intent into the Agent context');
assert(chatPanel.includes('buildRequestNativeToolsForModel'), 'direct model calls should build provider-native tools per candidate model');
assert(chatPanel.includes('canAttachProviderNativeWebSearchToModelCall'), 'ChatPanel should gate web_search away from silent router/preflight model calls');
assert(chatPanel.includes("purpose === 'direct_response' || purpose === 'direct_response_repair'"), 'ChatPanel should attach web_search only to user-facing direct-response model calls');
assert(chatPanel.includes('markProviderNativeWebSearchStarted'), 'ChatPanel should show a visible web_search step before provider-native search requests');
assert(chatPanel.includes('formatChatWebSearchCompletedStep'), 'ChatPanel should complete the visible web_search step with source count when available');
assert(chatPanel.includes('PROVIDER_NATIVE_WEB_SEARCH_MODEL_PRIORITY'), 'ChatPanel should prioritize Xiaomi models for explicit provider-native web_search requests');
assert(chatPanel.includes('getProviderNativeWebSearchModelPriority(latestApiKeys)'), 'ChatPanel should prepend configured Xiaomi web_search models before ordinary model preferences');
assert(!chatPanel.includes('setDesignKnowledgeSettings({'), 'ChatPanel search control must not mutate persistent design knowledge settings');

const autonomousExecutor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
assert(autonomousExecutor.includes('designKnowledgeSettings'), 'autonomous agent should read design knowledge settings from store');
assert(autonomousExecutor.includes('requestWebSearchIntent'), 'autonomous agent should accept per-turn web search intent');
assert(autonomousExecutor.includes('if (!requestWebSearchIntent) return options;'), 'autonomous agent should not inject web_search without a per-turn search intent');
assert(autonomousExecutor.includes('nativeTools: providerNativeWebSearch.nativeTools'), 'autonomous agent should pass planned native tools to provider options');
assert(autonomousExecutor.includes('emitProviderNativeWebSearchStarted'), 'autonomous agent should surface provider-native web_search start events');
assert(autonomousExecutor.includes('emitProviderNativeWebSearchCompleted'), 'autonomous agent should surface provider-native web_search completion events');
assert(autonomousExecutor.includes("toolName: 'providerNativeWebSearch'"), 'autonomous agent should use a stable visible tool id for provider-native web_search');
assert(autonomousExecutor.includes('getProviderNativeWebSearchModelId'), 'autonomous agent should prefer a Xiaomi web_search-capable model for explicit search requests');

const toolDisplayInfo = read('src/renderer/services/tool-display-info.ts');
assert(toolDisplayInfo.includes('providerNativeWebSearch'), 'tool display info should name the provider-native web_search visible step');

const visibleFeedback = read('src/renderer/services/agent-visible-feedback.ts');
assert(visibleFeedback.includes("toolName === 'providerNativeWebSearch'"), 'visible feedback should render provider-native web_search detail instead of a generic tool label');

console.log(JSON.stringify({
  success: true,
  checks: [
    'Xiaomi provider-native web_search can be merged with function tools without conversion',
    'Xiaomi provider-native web_search uses official max_completion_tokens and user_location object',
    'Xiaomi thinking preference preserves explicit enabled, explicit disabled, and unspecified states',
    'ChatPanel removes the Web Search button and uses user text intent only',
    'ChatPanel shows the user-visible search topic and returned source count',
    'ChatPanel keeps web_search out of silent router/preflight model calls',
    'ChatPanel prioritizes Xiaomi web_search-capable models for explicit search requests',
    'explicit user search text forces only the current turn',
    'web_search is absent unless nativeTools is explicitly provided',
    'Xiaomi url_citation annotations and web_search_usage normalize into ProviderResponse',
    'ModelService forwards nativeTools into both non-stream and stream adapter formatting',
    'Agent stream request options can carry provider-native tools',
    'autonomous agent derives nativeTools only from per-turn search intent',
    'autonomous agent emits visible provider-native web_search start/completion steps',
    'autonomous agent prefers a Xiaomi web_search-capable model for explicit search requests'
  ]
}, null, 2));
