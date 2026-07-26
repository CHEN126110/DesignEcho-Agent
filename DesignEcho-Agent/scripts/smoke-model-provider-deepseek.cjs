#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  DEEPSEEK_MODELS,
  ALL_MODELS,
  getModelById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts'));

const repoRoot = path.resolve(__dirname, '..', '..');
const agentRoot = path.resolve(__dirname, '..');
const legacyProxyMarker = 'ds' + '-free-api';

function read(relPath, root = agentRoot) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} should include ${needle}`);
}

function assertNotIncludes(text, needle, label) {
  assert(!text.includes(needle), `${label} should not include ${needle}`);
}

function assertNoMojibake(text, label) {
  const samples = [
    '\u9365',
    '\u94c6',
    '\u5f6e',
    '\u20ac'
  ];
  for (const sample of samples) {
    assert(!text.includes(sample), `${label} contains likely mojibake sample`);
  }
}

function main() {
  const official = getModelById('deepseek-v4-pro');
  assert(official, 'missing deepseek-v4-pro');
  assert(official.provider === 'deepseek', 'deepseek-v4-pro provider must be deepseek');
  assert(official.requiredApiKey === 'deepseek', 'deepseek-v4-pro must require official DeepSeek API key');
  assert(official.apiModelId === 'deepseek-v4-pro', `unexpected apiModelId: ${official.apiModelId}`);
  assert(official.supportsVision === false, 'deepseek-v4-pro must not be exposed as a vision model');
  assert(official.supportsToolUse === true, 'deepseek-v4-pro should expose official Tool Calls support');
  assert(official.supportsStreaming === true, 'deepseek-v4-pro should support streaming');
  assert(official.thinking?.format === 'reasoning_content', 'deepseek-v4-pro should use reasoning_content thinking extraction');
  assert(official.contextWindow === 1000000, 'deepseek-v4-pro context window should follow official 1M docs');
  assert(official.maxTokens === 384000, 'deepseek-v4-pro max output should follow official 384K docs');
  assert(official.capabilities.includes('json-output'), 'deepseek-v4-pro should declare JSON Output');
  assert(official.capabilities.includes('tool-calling'), 'deepseek-v4-pro should declare Tool Calls');
  assert(DEEPSEEK_MODELS.length === 1, 'official DeepSeek list should only contain the verified requested model');
  assert(DEEPSEEK_MODELS[0].id === 'deepseek-v4-pro', 'deepseek-v4-pro should be the official DeepSeek option');

  const allIds = ALL_MODELS.map((model) => model.id);
  assert(new Set(allIds).size === allIds.length, 'model ids must be unique');

  const modelsConfig = read('src/shared/config/models.config.ts');
  assertIncludes(modelsConfig, "| 'deepseek'", 'ModelProvider');
  assertIncludes(modelsConfig, "| 'deepseek'", 'ApiKeyType');
  assertIncludes(modelsConfig, 'export const DEEPSEEK_MODELS', 'models config');
  assertIncludes(modelsConfig, '...DEEPSEEK_MODELS', 'ALL_MODELS');
  assertNotIncludes(modelsConfig, 'DS' + '_FREE_API_MODELS', 'models config');
  assertNotIncludes(modelsConfig, legacyProxyMarker, 'models config');

  const modelService = read('src/main/services/model-service.ts');
  assertIncludes(modelService, "const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'", 'ModelService');
  assertIncludes(modelService, 'deepseekApiKey?: string', 'ModelService config');
  assertIncludes(modelService, 'private deepseek: OpenAI | null = null', 'ModelService client');
  assertIncludes(modelService, "case 'deepseek':", 'ModelService provider switch');
  assertIncludes(modelService, 'async testDeepSeek', 'ModelService test method');
  assertIncludes(modelService, 'toTextOnlyMessages', 'ModelService text-only boundary');
  assertIncludes(modelService, 'max_tokens: 64', 'ModelService DeepSeek test token budget');
  assertIncludes(modelService, 'reasoningContent', 'ModelService DeepSeek reasoning-only test handling');
  assertIncludes(modelService, "thinking: { type: 'disabled' }", 'ModelService explicit DeepSeek disabled-thinking boundary');
  assertIncludes(modelService, 'thinkingRequestParams', 'ModelService should pass official thinking request params into tool adapters');
  assertNotIncludes(modelService, legacyProxyMarker, 'ModelService');

  const streamAdapter = read('src/main/services/stream-adapter.ts');
  assertIncludes(streamAdapter, 'deepseekApiKey?: string', 'stream adapter config');
  assertIncludes(streamAdapter, "case 'deepseek':", 'stream adapter provider switch');
  assertIncludes(streamAdapter, "'https://api.deepseek.com'", 'stream adapter base URL');
  assertNotIncludes(streamAdapter, legacyProxyMarker, 'stream adapter');

  const settings = read('src/renderer/components/SettingsModal.tsx');
  assertIncludes(settings, 'DEEPSEEK_MODELS as DEEPSEEK_MODELS_CONFIG', 'SettingsModal import');
  assertIncludes(settings, "requiredKey: 'deepseek' as const", 'SettingsModal model map');
  assertIncludes(settings, 'handleTestDeepSeek', 'SettingsModal DeepSeek test handler');
  assertIncludes(settings, 'DeepSeek (官方)', 'SettingsModal model optgroup');
  assertIncludes(settings, 'className="config-section api-section deepseek"', 'SettingsModal API key section');
  assertNotIncludes(settings, legacyProxyMarker, 'SettingsModal');

  const preload = read('src/main/preload.ts');
  const rendererTypes = read('src/renderer/types.d.ts');
  const websocketHandlers = read('src/main/ipc-handlers/websocket-handlers.ts');
  const configHandlers = read('src/main/ipc-handlers/config-handlers.ts');
  const mainIndex = read('src/main/index.ts');
  const app = read('src/renderer/App.tsx');
  const store = read('src/renderer/stores/app.store.ts');
  for (const [label, content] of [
    ['preload', preload],
    ['renderer types', rendererTypes],
    ['websocket handlers', websocketHandlers],
    ['config handlers', configHandlers],
    ['main index', mainIndex],
    ['app startup sync', app],
    ['app store', store]
  ]) {
    assertIncludes(content.toLowerCase(), 'deepseek', label);
    assertNotIncludes(content, legacyProxyMarker, label);
    assertNoMojibake(content, label);
  }

  const packageJson = read('package.json');
  assert(fs.existsSync(path.join(agentRoot, 'scripts/smoke-model-provider-deepseek.cjs')), 'DeepSeek smoke file should exist and remain directly runnable');
  assertNotIncludes(packageJson, 'smoke:model-provider:' + legacyProxyMarker, 'package scripts');

  const rootDocsPath = path.join(repoRoot, legacyProxyMarker + '接入文档.md');
  assert(!fs.existsSync(rootDocsPath), 'legacy local proxy docs should be removed from repo root');

  console.log(JSON.stringify({
    success: true,
    model: {
      id: official.id,
      provider: official.provider,
      apiModelId: official.apiModelId,
      supportsVision: official.supportsVision,
      supportsToolUse: official.supportsToolUse,
      maxTokens: official.maxTokens,
      contextWindow: official.contextWindow
    },
    boundary: [
      'Official DeepSeek is connected through https://api.deepseek.com.',
      'deepseek-v4-pro exposes official Tool Calls support in DesignEcho.',
      'DeepSeek chatWithTools follows model capability and user Thinking preference, while explicit disabled mode remains available.',
      'No official vision input support was found, so supportsVision remains false.',
      'The legacy local web proxy integration has been removed from runtime, settings, and smoke scripts.'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
