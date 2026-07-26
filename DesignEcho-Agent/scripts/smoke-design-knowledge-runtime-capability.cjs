#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const {
  buildDesignKnowledgeRuntimeCapabilitySummary
} = require('../src/shared/design-knowledge-runtime-capability.ts');
const { normalizeDesignKnowledgeSettings } = require('../src/shared/design-knowledge-settings.ts');
const { getModelById } = require('../src/shared/config/models.config.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} should include ${needle}`);
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    String.fromCodePoint(0x93B4),
    String.fromCodePoint(0x93C9),
    String.fromCodePoint(0x6748),
    String.fromCodePoint(0x8930),
    String.fromCodePoint(0x7487),
    String.fromCodePoint(0x951B),
    String.fromCodePoint(0xFFFD)
  ];
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens ${found.join(', ')}`, { text });
}

const settings = normalizeDesignKnowledgeSettings({
  searxng: {
    enabled: true,
    endpoint: 'http://127.0.0.1:8080',
    language: 'zh-CN',
    safeSearch: 1,
    timeoutMs: 8000
  },
  xiaomiWebSearch: {
    enabled: true,
    forceSearch: true,
    maxKeyword: 9,
    limit: 99,
    userLocation: 'China'
  }
});

assert(settings.xiaomiWebSearch.enabled === true, 'normalizer should preserve Xiaomi Web Search enablement', settings);
assert(settings.xiaomiWebSearch.maxKeyword === 5, 'normalizer should clamp Xiaomi maxKeyword', settings);
assert(settings.xiaomiWebSearch.limit === 10, 'normalizer should clamp Xiaomi result limit', settings);

const xiaomiModel = getModelById('xiaomi-mimo-v2.5-pro');
assert(xiaomiModel, 'xiaomi-mimo-v2.5-pro should exist in model config');

const readySummary = buildDesignKnowledgeRuntimeCapabilitySummary({
  settings,
  model: xiaomiModel
});

assert(readySummary.status === 'ready', 'supported Xiaomi model with enabled search should be ready', readySummary);
assert(readySummary.selectedModel?.id === 'xiaomi-mimo-v2.5-pro', 'summary should expose selected model id', readySummary);
assert(readySummary.providerObservation.toolStream.mode === 'stream', 'Xiaomi provider should expose stream tool mode', readySummary);
assert(readySummary.providerNativeWebSearch.status === 'ready', 'Xiaomi web_search plan should be ready', readySummary);
assert(readySummary.providerNativeWebSearch.nativeTools[0].type === 'web_search', 'native web_search type must be preserved', readySummary);
assert(!JSON.stringify(readySummary.providerNativeWebSearch.nativeTools).includes('function'), 'web_search must not become a function tool', readySummary);
assert(readySummary.searxng.status === 'ready', 'SearXNG settings should remain visible in runtime summary', readySummary);
assert(readySummary.boundaries.doesNotRunProvider === true, 'summary must not run provider', readySummary);
assert(readySummary.boundaries.doesNotRunPhotoshop === true, 'summary must not run Photoshop', readySummary);
assert(readySummary.boundaries.doesNotSearchAutomatically === true, 'summary must not search automatically', readySummary);
assertNoMojibake(readySummary, 'ready runtime capability summary');

const googleModel = getModelById('google-gemini-3-pro');
const unsupportedSummary = buildDesignKnowledgeRuntimeCapabilitySummary({
  settings,
  model: googleModel
});

assert(unsupportedSummary.status === 'watch', 'unsupported provider with SearXNG ready should stay watch, not ready', unsupportedSummary);
assert(unsupportedSummary.providerNativeWebSearch.status === 'unsupported_provider', 'non-Xiaomi model should not receive Xiaomi web_search', unsupportedSummary);
assert(unsupportedSummary.warnings.some((warning) => warning.includes('Xiaomi')), 'unsupported summary should explain Xiaomi boundary', unsupportedSummary);

const disabledSummary = buildDesignKnowledgeRuntimeCapabilitySummary({
  settings: normalizeDesignKnowledgeSettings({}),
  model: xiaomiModel
});

assert(disabledSummary.status === 'disabled', 'all knowledge search off should report disabled', disabledSummary);
assert(disabledSummary.providerNativeWebSearch.status === 'disabled', 'disabled Xiaomi web search should not prepare native tools', disabledSummary);
assert(disabledSummary.searxng.status === 'disabled', 'disabled SearXNG should remain disabled', disabledSummary);

const settingsModal = read('src/renderer/components/SettingsModal.tsx');
assertIncludes(settingsModal, 'buildDesignKnowledgeRuntimeCapabilitySummary', 'SettingsModal runtime capability summary');
assertIncludes(settingsModal, '小米官方 Web Search', 'SettingsModal Xiaomi Web Search card');
assertIncludes(settingsModal, 'providerNativeWebSearch', 'SettingsModal provider-native web search status');
assertIncludes(settingsModal, '当前模型能力', 'SettingsModal model capability visibility');

const packageJson = JSON.parse(read('package.json'));
assert(packageJson.scripts['smoke:design-knowledge:runtime-capability'], 'package script should expose runtime capability smoke');
assert(
  packageJson.scripts['maintenance:preflight'].includes('smoke:design-knowledge:runtime-capability'),
  'maintenance preflight should include runtime capability smoke'
);

const architecture = read('scripts/report-agent-architecture.cjs');
assertIncludes(architecture, 'designKnowledgeRuntimeCapabilityAvailable', 'agent architecture report');
const cockpit = read('scripts/report-project-cockpit.cjs');
assertIncludes(cockpit, 'designKnowledgeRuntimeCapabilityAvailable', 'project cockpit report');

console.log(JSON.stringify({
  success: true,
  checks: [
    'design knowledge runtime capability summary combines selected model, provider observation, provider-native web_search and SearXNG status',
    'Xiaomi Web Search settings are explicit, clamped and disabled by default',
    'provider-native web_search remains provider-native and is not converted to function tools',
    'runtime capability summary is readonly and does not run providers, Photoshop or automatic search',
    'Settings UI exposes current model capability, Xiaomi Web Search and SearXNG status together',
    'maintenance reports expose design knowledge runtime capability availability'
  ]
}, null, 2));
