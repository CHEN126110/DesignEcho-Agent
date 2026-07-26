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

const path = require('path');
const { EventEmitter } = require('events');

const ROOT = path.resolve(__dirname, '..');
const { TaskOrchestrator } = require(path.join(ROOT, 'src', 'main', 'services', 'task-orchestrator.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

async function run() {
  const calls = [];
  const fakeModelService = {
    getModelSelectionApiKeys() {
      return {
        xiaomi: 'configured-xiaomi',
        google: 'configured-google',
        openrouter: 'configured-openrouter',
        deepseek: 'configured-deepseek',
        gptsapi: 'configured-gptsapi'
      };
    },
    async chat(modelId) {
      calls.push(modelId);
      if (modelId === 'xiaomi-mimo-v2.5') {
        throw new Error('401 Invalid API Key');
      }
      return { text: JSON.stringify({ ok: true, selectedModel: modelId }) };
    },
    chatStream(modelId) {
      calls.push(`stream:${modelId}`);
      const emitter = new EventEmitter();
      setTimeout(() => {
        if (modelId === 'xiaomi-mimo-v2.5') {
          emitter.emit('chunk', { type: 'error', error: '401 Invalid API Key' });
          return;
        }
        emitter.emit('chunk', {
          type: 'done',
          fullResponse: { text: JSON.stringify({ ok: true, selectedModel: modelId }) }
        });
      }, 0);
      return emitter;
    }
  };

  const orchestrator = new TaskOrchestrator(fakeModelService);
  orchestrator.updatePreferences({
    mode: 'cloud',
    autoFallback: false,
    preferredCloudModels: {
      layoutAnalysis: 'xiaomi-mimo-v2.5',
      textOptimize: 'xiaomi-mimo-v2.5',
      visualAnalyze: 'xiaomi-mimo-v2.5'
    },
    preferredLocalModels: {
      layoutAnalysis: 'local-qwen2.5-32b',
      textOptimize: 'local-qwen2.5-32b',
      visualAnalyze: 'local-llava-llama3-8b'
    }
  });

  let executeError;
  try {
    await orchestrator.execute('text-optimize', { text: '生成袜子卖点文案' });
  } catch (error) {
    executeError = error;
  }
  assert(
    executeError && calls.length === 1 && calls[0] === 'xiaomi-mimo-v2.5',
    'execute must fail honestly on the configured primary model instead of trying an unrelated hidden provider',
    calls
  );
  assert(
    executeError.fallbackState?.stage === 'all_candidates_failed'
      && executeError.fallbackState?.primaryModel === 'xiaomi-mimo-v2.5'
      && executeError.fallbackState?.fallbackModel === null,
    'execute must record the configured model failure without fabricating a fallback success',
    executeError.fallbackState
  );

  calls.length = 0;
  let streamError;
  try {
    await orchestrator.executeStream('text-optimize', { text: '生成袜子卖点文案' });
  } catch (error) {
    streamError = error;
  }
  assert(
    streamError && calls.length === 1 && calls[0] === 'stream:xiaomi-mimo-v2.5',
    'executeStream must fail on the configured model instead of trying a hidden provider',
    calls
  );
  assert(
    streamError.fallbackState?.stage === 'all_candidates_failed'
      && streamError.fallbackState?.primaryModel === 'xiaomi-mimo-v2.5',
    'executeStream must record the configured model failure state',
    streamError.fallbackState
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'TaskOrchestrator execute does not cross configured model roles after auth failure',
      'TaskOrchestrator executeStream does not cross configured model roles after auth failure',
      'failure state records the configured primary model truthfully'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
