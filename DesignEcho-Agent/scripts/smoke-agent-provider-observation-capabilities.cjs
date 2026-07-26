#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

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

function loadSharedModule(relativePath) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled.outputText, `${filename}.js`);
  return loaded.exports;
}

const capabilityModule = loadSharedModule('src/shared/agent-provider-observation-capabilities.ts');
const {
  buildAgentProviderObservationCapabilities,
  buildAgentProviderObservationCapabilityMatrix,
  isProviderObservationCapabilityBoundaryOk
} = capabilityModule;

assert(typeof buildAgentProviderObservationCapabilities === 'function', 'capability builder should be exported');
assert(typeof buildAgentProviderObservationCapabilityMatrix === 'function', 'capability matrix builder should be exported');
assert(typeof isProviderObservationCapabilityBoundaryOk === 'function', 'capability boundary helper should be exported');

const xiaomi = buildAgentProviderObservationCapabilities({
  modelId: 'mimo-v2.5-pro',
  provider: 'xiaomi',
  supportsStreaming: true,
  supportsToolUse: true,
  thinking: { supported: true, format: 'reasoning_content' }
});
assert(xiaomi.toolStream.mode === 'stream', 'xiaomi should be marked as OpenAI-compatible tool stream', xiaomi);
assert(xiaomi.providerThinkingDelta.status === 'supported', 'xiaomi reasoning_content thinking should be derived from model capability, not disabled by provider name', xiaomi);
assert(xiaomi.finalProviderThinking.status === 'supported', 'xiaomi final provider thinking should be derived from model capability', xiaomi);
assert(
  !xiaomi.warnings.some((warning) => warning.includes('Xiaomi MiMo') && warning.includes('disables thinking')),
  'xiaomi capability matrix must not carry a hardcoded provider-name thinking ban',
  xiaomi
);
assert(xiaomi.toolEvents.status === 'supported', 'xiaomi tool events should be supported', xiaomi);

const deepseek = buildAgentProviderObservationCapabilities({
  modelId: 'deepseek-v4-pro',
  provider: 'deepseek',
  supportsStreaming: true,
  supportsToolUse: true,
  thinking: { supported: true, format: 'reasoning_content' }
});
assert(deepseek.toolStream.mode === 'stream', 'deepseek should still use OpenAI-compatible tool stream transport', deepseek);
assert(deepseek.providerThinkingDelta.status === 'supported', 'deepseek reasoning_content thinking should be derived from model capability', deepseek);
assert(deepseek.finalProviderThinking.status === 'supported', 'deepseek final provider thinking should be derived from model capability', deepseek);
assert(!deepseek.warnings.some((warning) => warning.includes('tool path disables thinking')), 'deepseek matrix must not carry a hardcoded provider-name thinking ban', deepseek);

const google = buildAgentProviderObservationCapabilities({
  modelId: 'gemini-3-pro-preview',
  provider: 'google',
  supportsStreaming: true,
  supportsToolUse: true,
  thinking: { supported: false, format: 'none' }
});
assert(google.toolStream.mode === 'fallback', 'google tool stream should be fallback until implemented', google);
assert(google.providerThinkingDelta.status === 'unsupported', 'google should not claim provider thinking delta', google);
assert(google.modelVisibleReasoning.status === 'supported', 'google can still return model-authored public visible reasoning', google);

const anthropic = buildAgentProviderObservationCapabilities({
  modelId: 'claude-sonnet',
  provider: 'anthropic',
  supportsStreaming: true,
  supportsToolUse: true,
  thinking: { supported: true, format: 'extended_thinking' }
});
assert(anthropic.toolStream.mode === 'fallback', 'anthropic tool stream should be fallback until tool streaming is implemented', anthropic);
assert(anthropic.providerThinkingDelta.status === 'unsupported', 'anthropic fallback tool path should not claim thinking delta', anthropic);
assert(anthropic.finalProviderThinking.status === 'supported', 'anthropic non-stream response may expose final thinking block', anthropic);

const ollama = buildAgentProviderObservationCapabilities({
  modelId: 'local-qwen',
  provider: 'ollama',
  supportsStreaming: true,
  supportsToolUse: undefined,
  thinking: { supported: true, format: 'think_tag' }
});
assert(ollama.toolStream.mode === 'fallback', 'ollama tool stream should be fallback unless native streaming is wired', ollama);
assert(ollama.supportsToolUse.status === 'unknown', 'undefined supportsToolUse must remain unknown, not supported', ollama);

const disabledStreaming = buildAgentProviderObservationCapabilities({
  modelId: 'no-stream-model',
  provider: 'openai',
  supportsStreaming: false,
  supportsToolUse: true,
  thinking: { supported: true, format: 'reasoning_content' }
});
assert(disabledStreaming.contentStream.status === 'unsupported', 'disabled streaming should block content stream', disabledStreaming);
assert(disabledStreaming.toolStream.mode === 'unsupported', 'disabled streaming should block tool stream', disabledStreaming);

const matrix = buildAgentProviderObservationCapabilityMatrix([
  { id: 'm1', provider: 'openai', supportsStreaming: true, supportsToolUse: true, thinking: { supported: true, format: 'reasoning_content' } },
  { id: 'm2', provider: 'google', supportsStreaming: true, supportsToolUse: true, thinking: { supported: false, format: 'none' } }
]);
assert(matrix.length === 2, 'matrix should preserve input size', matrix);
assert(matrix.every(isProviderObservationCapabilityBoundaryOk), 'matrix entries should satisfy no-fake-thinking boundaries', matrix);

const source = read('src/shared/agent-provider-observation-capabilities.ts');
assert(!source.includes('tool path disables thinking'), 'shared module should not document a hardcoded provider-name thinking ban');
assert(source.includes('model_visible_reasoning'), 'shared module should keep model-visible reasoning separate from provider thinking');

const architectureReport = read('scripts/report-agent-architecture.cjs');
const cockpitReport = read('scripts/report-project-cockpit.cjs');
assert(architectureReport.includes('agentProviderObservationCapabilitiesAvailable'), 'architecture report should expose provider observation capabilities');
assert(cockpitReport.includes('agentProviderObservationCapabilitiesAvailable'), 'cockpit report should expose provider observation capabilities');

console.log(JSON.stringify({
  success: true,
  checks: [
    'provider observation capability matrix exists',
    'OpenAI-compatible providers can be marked as tool stream',
    'Xiaomi provider thinking follows model capability',
    'DeepSeek provider thinking follows model capability',
    'Google Anthropic Ollama fallback paths are explicit',
    'model visible reasoning stays separate from provider thinking',
    'reports expose the new truth source'
  ]
}, null, 2));
