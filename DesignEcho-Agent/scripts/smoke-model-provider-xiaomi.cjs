#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  XIAOMI_MODELS,
  OPENROUTER_MODELS,
  ALL_MODELS,
  getModelById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts'));
const {
  ModelService
} = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'model-service.ts'));

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const official = getModelById('xiaomi-mimo-v2.5-pro');
  const officialOmniV25 = getModelById('xiaomi-mimo-v2.5');
  const officialLegacy = getModelById('xiaomi-mimo-v2-pro');
  const officialLegacyOmni = getModelById('xiaomi-mimo-v2-omni');
  const openrouter = getModelById('openrouter-mimo-v2.5-pro');
  const openrouterOmniV25 = getModelById('openrouter-mimo-v2.5');
  const openrouterLegacy = getModelById('openrouter-mimo-v2-pro');

  assert(official, 'missing xiaomi-mimo-v2.5-pro');
  assert(official.provider === 'xiaomi', 'xiaomi-mimo-v2.5-pro provider must be xiaomi');
  assert(official.requiredApiKey === 'xiaomi', 'xiaomi-mimo-v2.5-pro must require xiaomi API key');
  assert(official.apiModelId === 'mimo-v2.5-pro', `unexpected official apiModelId: ${official.apiModelId}`);
  assert(official.supportsToolUse === true, 'xiaomi-mimo-v2.5-pro should support tool use');
  assert(official.recommended === true, 'xiaomi-mimo-v2.5-pro should be recommended');

  assert(officialOmniV25, 'missing xiaomi-mimo-v2.5');
  assert(officialOmniV25.provider === 'xiaomi', 'xiaomi-mimo-v2.5 provider must be xiaomi');
  assert(officialOmniV25.requiredApiKey === 'xiaomi', 'xiaomi-mimo-v2.5 must require xiaomi API key');
  assert(officialOmniV25.apiModelId === 'mimo-v2.5', `unexpected official MiMo V2.5 apiModelId: ${officialOmniV25.apiModelId}`);
  assert(officialOmniV25.supportsVision === true, 'xiaomi-mimo-v2.5 should be available for visual analysis');
  assert(officialOmniV25.supportsToolUse === true, 'xiaomi-mimo-v2.5 should support tool use');
  assert(officialOmniV25.recommended === true, 'xiaomi-mimo-v2.5 should be recommended');

  assert(!officialLegacy, 'legacy xiaomi-mimo-v2-pro should be removed from selectable models');
  assert(!officialLegacyOmni, 'legacy xiaomi-mimo-v2-omni should be removed from selectable models');

  assert(openrouter, 'missing openrouter-mimo-v2.5-pro');
  assert(openrouter.provider === 'openrouter', 'openrouter-mimo-v2.5-pro provider must be openrouter');
  assert(openrouter.apiModelId === 'xiaomi/mimo-v2.5-pro', `unexpected OpenRouter apiModelId: ${openrouter.apiModelId}`);

  assert(openrouterOmniV25, 'missing openrouter-mimo-v2.5');
  assert(openrouterOmniV25.provider === 'openrouter', 'openrouter-mimo-v2.5 provider must be openrouter');
  assert(openrouterOmniV25.apiModelId === 'xiaomi/mimo-v2.5', `unexpected OpenRouter MiMo V2.5 apiModelId: ${openrouterOmniV25.apiModelId}`);
  assert(openrouterOmniV25.supportsVision === true, 'openrouter-mimo-v2.5 should be available for visual analysis');

  assert(!openrouterLegacy, 'legacy openrouter-mimo-v2-pro should be removed from selectable models');

  const allIds = ALL_MODELS.map((model) => model.id);
  assert(new Set(allIds).size === allIds.length, 'model ids must be unique');
  assert(XIAOMI_MODELS[0].id === 'xiaomi-mimo-v2.5-pro', 'Xiaomi MiMo V2.5 Pro should be first official Xiaomi option');
  assert(XIAOMI_MODELS[1].id === 'xiaomi-mimo-v2.5', 'Xiaomi MiMo V2.5 should be second official Xiaomi option');
  assert(OPENROUTER_MODELS.some((model) => model.id === 'openrouter-mimo-v2.5-pro'), 'OpenRouter MiMo V2.5 Pro missing from OpenRouter list');
  assert(OPENROUTER_MODELS.some((model) => model.id === 'openrouter-mimo-v2.5'), 'OpenRouter MiMo V2.5 missing from OpenRouter list');

  const modelServiceSource = read('src/main/services/model-service.ts');
  assert(modelServiceSource.includes('OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS'), 'OpenAI-compatible providers must share an explicit timeout constant');
  assert(modelServiceSource.includes('OPENAI_COMPATIBLE_MIN_TIMEOUT_MS'), 'OpenAI-compatible providers must clamp too-small request timeouts');
  assert(modelServiceSource.includes('OPENAI_COMPATIBLE_MAX_TIMEOUT_MS'), 'OpenAI-compatible providers must clamp too-large request timeouts');
  assert(modelServiceSource.includes('resolveOpenAICompatibleTimeoutMs(options)'), 'OpenAI-compatible chat calls must pass resolved request timeout');
  assert(modelServiceSource.includes('XIAOMI_MIMO_DEFAULT_TEMPERATURE = 1.0'), 'Xiaomi official calls should use documented default temperature');
  assert(modelServiceSource.includes('XIAOMI_MIMO_DEFAULT_TOP_P = 0.95'), 'Xiaomi official calls should use documented default top_p');
  assert(modelServiceSource.includes('isXiaomiMimo'), 'Xiaomi official calls should be recognized in OpenAI-compatible path');
  assert(modelServiceSource.includes('max_completion_tokens'), 'Xiaomi official calls should use documented max_completion_tokens field');
  assert(modelServiceSource.includes('top_p: XIAOMI_MIMO_DEFAULT_TOP_P'), 'Xiaomi official calls should send documented top_p');
  assert(modelServiceSource.includes("thinking: { type: 'disabled' }"), 'Xiaomi official calls should support explicit disabled thinking when the user turns Thinking off');
  assert(modelServiceSource.includes('...thinkingParams'), 'Xiaomi official calls should use resolved thinking params instead of a hardcoded provider ban');
  assert(modelServiceSource.includes('formatXiaomiError'), 'Xiaomi official calls should use a provider-specific user-facing error formatter');
  assert((modelServiceSource.match(/maxRetries:\s*0/g) || []).length >= 4, 'OpenAI-compatible clients should not multiply UI latency through SDK retries');

  const modelService = new ModelService({});
  assert(typeof modelService.formatXiaomiError === 'function', 'Xiaomi error formatter should be callable at runtime');
  const reasoningError = modelService.formatXiaomiError(
    { status: 400, message: 'Bad request: missing reasoning_content in assistant messages' },
    'mimo-v2.5-pro'
  );
  assert(reasoningError.includes('reasoning_content'), '400 reasoning_content error should explain the missing field', reasoningError);
  assert(reasoningError.includes('思考模式') || reasoningError.includes('工具调用历史'), '400 reasoning_content error should tell the user why it affects Agent stability', reasoningError);

  const rateLimitError = modelService.formatXiaomiError(
    { status: 429, message: 'Too many requests' },
    'mimo-v2.5-pro'
  );
  assert(rateLimitError.includes('请求过于频繁') || rateLimitError.includes('稍后重试'), '429 should be formatted as a rate-limit retry hint', rateLimitError);

  const serviceBusyError = modelService.formatXiaomiError(
    { status: 503, message: 'Service unavailable' },
    'mimo-v2.5-pro'
  );
  assert(serviceBusyError.includes('服务') && serviceBusyError.includes('稍后重试'), '503 should be formatted as a service busy hint', serviceBusyError);

  const chatPanelSource = read('src/renderer/components/ChatPanel.tsx');
  assert(chatPanelSource.includes('const modelTimeoutMs = typeof options?.timeoutMs'), 'ChatPanel callModel must derive a bounded model timeout');
  assert(chatPanelSource.includes('isRouterCall || isVisibleReasoningCall || isDirectResponseLikeCall ? 15_000'), 'chat, router, visible reasoning and direct-response repair calls should use the short interactive timeout');
  assert((chatPanelSource.match(/timeoutMs:\s*modelTimeoutMs/g) || []).length >= 2, 'non-stream model fallback and direct calls must pass timeoutMs to IPC');

  console.log(JSON.stringify({
    success: true,
    official: {
      id: official.id,
      apiModelId: official.apiModelId,
      recommended: official.recommended
    },
    removedLegacy: [
      'xiaomi-mimo-v2-pro',
      'xiaomi-mimo-v2-omni',
      'openrouter-mimo-v2-pro'
    ],
    officialOmniV25: {
      id: officialOmniV25.id,
      apiModelId: officialOmniV25.apiModelId,
      supportsVision: officialOmniV25.supportsVision
    },
    openrouter: {
      id: openrouter.id,
      apiModelId: openrouter.apiModelId
    },
    openrouterOmniV25: {
      id: openrouterOmniV25.id,
      apiModelId: openrouterOmniV25.apiModelId,
      supportsVision: openrouterOmniV25.supportsVision
    },
    boundary: [
      'This smoke validates Xiaomi MiMo model configuration only.',
      'It does not call Xiaomi or OpenRouter APIs and does not prove quota availability.',
      'OpenAI-compatible non-stream chat has bounded timeout and no SDK retry amplification.',
      'Official Xiaomi calls use documented V2.5 defaults; Thinking follows model capability and user preference.'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
