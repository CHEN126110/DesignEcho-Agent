#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { ModelService } = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'model-service.ts'));
const {
  DEFAULT_MODEL_PREFERENCES,
  getModelById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts'));

const AGENT_ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(AGENT_ROOT, 'tmp', 'model-routing-live-quality-smoke.json');
const REPORT_MD = path.join(AGENT_ROOT, 'tmp', 'model-routing-live-quality-smoke.md');
const ENABLED = process.env.DESIGNECHO_LIVE_MODEL_SMOKE === '1';

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readPersistedRendererState() {
  const explicit = process.env.DESIGNECHO_APP_STATE_STORE;
  const stateStorePath = explicit || path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'designecho-agent',
    'app-state-store.json'
  );
  const store = readJsonIfExists(stateStorePath);
  const rawStorage = store?.entries?.['designecho-storage'];
  if (!rawStorage) {
    return { stateStorePath, state: {} };
  }
  try {
    const parsed = JSON.parse(rawStorage);
    return { stateStorePath, state: parsed?.state || {} };
  } catch {
    return { stateStorePath, state: {} };
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (nonEmpty(value)) return value.trim();
  }
  return '';
}

function buildModelConfig(state) {
  const keys = state.apiKeys || {};
  return {
    anthropicApiKey: firstNonEmpty(process.env.ANTHROPIC_API_KEY, keys.anthropic),
    googleApiKey: firstNonEmpty(process.env.GOOGLE_API_KEY, keys.google),
    xiaomiApiKey: firstNonEmpty(process.env.XIAOMI_API_KEY, keys.xiaomi),
    openaiApiKey: firstNonEmpty(process.env.OPENAI_API_KEY, keys.openai),
    gptsapiApiKey: firstNonEmpty(process.env.GPTSAPI_API_KEY, keys.gptsapi),
    openrouterApiKey: firstNonEmpty(process.env.OPENROUTER_API_KEY, keys.openrouter),
    deepseekApiKey: firstNonEmpty(process.env.DEEPSEEK_API_KEY, keys.deepseek),
    ollamaUrl: firstNonEmpty(process.env.OLLAMA_URL, keys.ollamaUrl),
    ollamaApiKey: firstNonEmpty(process.env.OLLAMA_API_KEY, keys.ollamaApiKey),
    bflApiKey: firstNonEmpty(process.env.BFL_API_KEY, keys.bfl)
  };
}

function redactKnownSecrets(text, config) {
  let output = String(text || '');
  for (const value of Object.values(config)) {
    if (nonEmpty(value) && value.length >= 8) {
      output = output.split(value).join('[REDACTED]');
    }
  }
  return output;
}

function keyNameForModel(model) {
  if (!model?.requiredApiKey) return null;
  switch (model.requiredApiKey) {
    case 'google': return 'googleApiKey';
    case 'xiaomi': return 'xiaomiApiKey';
    case 'openai': return 'openaiApiKey';
    case 'gptsapi': return 'gptsapiApiKey';
    case 'openrouter': return 'openrouterApiKey';
    case 'anthropic': return 'anthropicApiKey';
    case 'deepseek': return 'deepseekApiKey';
    case 'ollamaApiKey': return 'ollamaApiKey';
    case 'ollamaUrl': return 'ollamaUrl';
    default: return `${model.requiredApiKey}ApiKey`;
  }
}

function requireModelReady(bucket, modelId, modelConfig) {
  const model = getModelById(modelId);
  if (!model) {
    return { ok: false, reason: `Unknown model '${modelId}' for ${bucket}` };
  }
  const keyName = keyNameForModel(model);
  if (keyName && !nonEmpty(modelConfig[keyName])) {
    return { ok: false, reason: `Missing ${model.requiredApiKey} credential for ${modelId}` };
  }
  return { ok: true, model, keyName };
}

async function createTinyReferencePngBase64() {
  // Generate a standards-compliant PNG at runtime. A previously embedded tiny
  // PNG decoded locally but was rejected by Xiaomi with "invalid base64 format".
  const sharp = require('sharp');
  const svg = [
    '<svg width="96" height="96" xmlns="http://www.w3.org/2000/svg">',
    '<rect width="96" height="96" fill="white"/>',
    '<rect x="24" y="24" width="48" height="48" fill="black"/>',
    '</svg>'
  ].join('');
  return (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}

async function runChatProbe(service, bucket, modelId) {
  const prompts = {
    layoutAnalysis: 'Return exactly: LOGIC_OK',
    textOptimize: 'Rewrite this product phrase in Chinese, within 12 Chinese characters: comfortable breathable socks. Return only the rewritten phrase.',
    visualAnalyze: 'Look at the image. In one short Chinese sentence, say the main colors and shape.'
  };

  const content = bucket === 'visualAnalyze'
    ? [
        { type: 'text', text: prompts.visualAnalyze },
        {
          type: 'image',
          image: {
            data: await createTinyReferencePngBase64(),
            mediaType: 'image/png'
          }
        }
      ]
    : prompts[bucket];

  const startedAt = Date.now();
  const response = await service.chat(
    modelId,
    [{ role: 'user', content }],
    { maxTokens: 1024, temperature: 0 }
  );
  const text = String(response.text || '').trim();
  return {
    kind: 'chat',
    bucket,
    modelId,
    ok: text.length > 0,
    durationMs: Date.now() - startedAt,
    textPreview: text.slice(0, 160),
    usage: response.usage || null,
    thinkingChars: response.thinking ? response.thinking.length : 0
  };
}

async function runToolProbe(service, modelId) {
  const startedAt = Date.now();
  const response = await service.chatWithTools(
    modelId,
    [
      {
        role: 'system',
        content: 'You are testing tool calling. You must call echo_status once. Do not answer with plain text.'
      },
      {
        role: 'user',
        content: 'Call echo_status with status set to ok.'
      }
    ],
    [
      {
        name: 'echo_status',
        description: 'Return a simple status for live model smoke testing.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] }
          },
          required: ['status']
        }
      }
    ],
    { maxTokens: 96, temperature: 0 }
  );
  const toolCalls = response.toolCalls || [];
  return {
    kind: 'chatWithTools',
    bucket: 'layoutAnalysis',
    modelId,
    ok: toolCalls.some((call) => call.name === 'echo_status' && call.arguments?.status === 'ok'),
    durationMs: Date.now() - startedAt,
    toolCalls: toolCalls.map((call) => ({ name: call.name, arguments: call.arguments })),
    textPreview: String(response.content || '').trim().slice(0, 160),
    usage: response.usage || null,
    thinkingChars: response.thinking ? response.thinking.length : 0
  };
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# Model Routing Live Quality Smoke',
    '',
    `- enabled: ${report.enabled}`,
    `- outcome: ${report.outcome}`,
    `- generatedAt: ${report.generatedAt}`,
    `- stateStoreDetected: ${report.stateStoreDetected}`,
    '',
    '## Buckets',
    '',
    ...report.bucketModels.map((item) => `- ${item.bucket}: ${item.modelId} (${item.provider || 'unknown'}), credential=${item.credentialStatus}`),
    '',
    '## Results',
    '',
    ...report.results.map((item) => [
      `### ${item.kind} / ${item.bucket || 'tool'} / ${item.modelId || 'unknown'}`,
      '',
      `- ok: ${item.ok}`,
      `- durationMs: ${item.durationMs ?? 'n/a'}`,
      item.error ? `- error: ${item.error}` : `- textPreview: ${item.textPreview || ''}`,
      item.toolCalls ? `- toolCalls: ${JSON.stringify(item.toolCalls)}` : ''
    ].filter(Boolean).join('\n')),
    '',
    '## Boundary',
    '',
    '- This smoke makes real API calls only when DESIGNECHO_LIVE_MODEL_SMOKE=1.',
    '- It proves API reachability and minimal response shape for the configured buckets.',
    '- It does not prove design quality, Photoshop execution quality, or long-horizon task reliability.'
  ];
  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
}

async function main() {
  const { stateStorePath, state } = readPersistedRendererState();
  const modelPreferences = state.modelPreferences || DEFAULT_MODEL_PREFERENCES;
  const preferredCloudModels = modelPreferences.preferredCloudModels || DEFAULT_MODEL_PREFERENCES.preferredCloudModels;
  const modelConfig = buildModelConfig(state);
  const buckets = [
    { bucket: 'layoutAnalysis', modelId: preferredCloudModels.layoutAnalysis },
    { bucket: 'textOptimize', modelId: preferredCloudModels.textOptimize },
    { bucket: 'visualAnalyze', modelId: preferredCloudModels.visualAnalyze }
  ];

  const bucketModels = buckets.map(({ bucket, modelId }) => {
    const model = getModelById(modelId);
    const keyName = keyNameForModel(model);
    return {
      bucket,
      modelId,
      provider: model?.provider || null,
      supportsVision: !!model?.supportsVision,
      supportsToolUse: model?.supportsToolUse !== false,
      credentialStatus: keyName ? (nonEmpty(modelConfig[keyName]) ? 'present' : 'missing') : 'not-required'
    };
  });

  const report = {
    enabled: ENABLED,
    outcome: ENABLED ? 'pending' : 'skipped',
    generatedAt: new Date().toISOString(),
    stateStoreDetected: fs.existsSync(stateStorePath),
    bucketModels,
    results: [],
    reportPaths: {
      json: REPORT_JSON,
      markdown: REPORT_MD
    }
  };

  if (!ENABLED) {
    report.results.push({
      kind: 'guard',
      ok: true,
      textPreview: 'Set DESIGNECHO_LIVE_MODEL_SMOKE=1 to run real API probes.'
    });
    writeReports(report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const service = new ModelService(modelConfig);
  let failures = 0;

  for (const { bucket, modelId } of buckets) {
    const ready = requireModelReady(bucket, modelId, modelConfig);
    if (!ready.ok) {
      failures += 1;
      report.results.push({ kind: 'chat', bucket, modelId, ok: false, error: ready.reason });
      continue;
    }
    if (bucket === 'visualAnalyze' && ready.model.supportsVision !== true) {
      failures += 1;
      report.results.push({ kind: 'chat', bucket, modelId, ok: false, error: `${modelId} is not marked as vision-capable` });
      continue;
    }
    try {
      const result = await runChatProbe(service, bucket, modelId);
      if (!result.ok) failures += 1;
      report.results.push(result);
    } catch (error) {
      failures += 1;
      report.results.push({
        kind: 'chat',
        bucket,
        modelId,
        ok: false,
        error: redactKnownSecrets(error && error.stack ? error.stack : String(error), modelConfig).slice(0, 1200)
      });
    }
  }

  const layoutModelId = preferredCloudModels.layoutAnalysis;
  const layoutModel = getModelById(layoutModelId);
  if (layoutModel?.supportsToolUse === false) {
    failures += 1;
    report.results.push({
      kind: 'chatWithTools',
      bucket: 'layoutAnalysis',
      modelId: layoutModelId,
      ok: false,
      error: `${layoutModelId} is configured as not supporting tool use`
    });
  } else {
    const ready = requireModelReady('layoutAnalysis', layoutModelId, modelConfig);
    if (ready.ok) {
      try {
        const toolResult = await runToolProbe(service, layoutModelId);
        if (!toolResult.ok) failures += 1;
        report.results.push(toolResult);
      } catch (error) {
        failures += 1;
        report.results.push({
          kind: 'chatWithTools',
          bucket: 'layoutAnalysis',
          modelId: layoutModelId,
          ok: false,
          error: redactKnownSecrets(error && error.stack ? error.stack : String(error), modelConfig).slice(0, 1200)
        });
      }
    }
  }

  report.outcome = failures === 0 ? 'pass' : 'fail';
  writeReports(report);
  console.log(JSON.stringify(report, null, 2));
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  const fallback = {
    enabled: ENABLED,
    outcome: 'error',
    generatedAt: new Date().toISOString(),
    bucketModels: [],
    results: [{ kind: 'fatal', ok: false, error: error && error.stack ? error.stack : String(error) }]
  };
  writeReports(fallback);
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
