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
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..');
const { ResourceManagerService } = require('../src/main/services/resource-manager-service.ts');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include ${needle}`);
}

function assertNoUnsafe(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = [
    'data:image',
    'base64',
    'imageBase64',
    'rawImage',
    'buffer',
    'pixels',
    'confidence',
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((item) => text.includes(item));
  assert(found.length === 0, `${label} leaked unsafe payload, score marker or local path: ${found.join(', ')}`, value);
}

async function createFixtureImage() {
  const dir = path.join(repoRoot, 'tmp', 'design-learning-reference-analyzer-smoke');
  fs.mkdirSync(dir, { recursive: true });
  const imagePath = path.join(dir, 'sku-reference.jpg');
  await sharp({
    create: {
      width: 320,
      height: 220,
      channels: 3,
      background: '#f8f8f5'
    }
  })
    .composite([
      {
        input: Buffer.from('<svg width="320" height="220"><rect x="50" y="52" width="46" height="112" rx="9" fill="#ffffff" stroke="#d6d6d6"/><rect x="130" y="52" width="46" height="112" rx="9" fill="#b7b7b7"/><rect x="210" y="52" width="46" height="112" rx="9" fill="#242424"/><text x="65" y="196" font-size="18" fill="#333">1</text><text x="145" y="196" font-size="18" fill="#333">2</text><text x="225" y="196" font-size="18" fill="#333">3</text></svg>')
      }
    ])
    .jpeg({ quality: 88 })
    .toFile(imagePath);
  return imagePath;
}

async function run() {
  const imagePath = await createFixtureImage();
  const service = new ResourceManagerService();
  let capturedPrompt = '';
  let capturedImagePayload = '';

  const result = await service.analyzeDesignReference({
    imagePath,
    referenceTitle: '袜子 SKU 色卡参考',
    referenceTags: ['socks', 'sku', 'color-card'],
    referenceSource: 'eagle_readonly',
    topics: ['袜子 SKU 色卡排版', '统一光影'],
    cadence: 'daily'
  }, async (imageBase64, prompt) => {
    capturedImagePayload = imageBase64;
    capturedPrompt = prompt;
    return JSON.stringify({
      productCategory: 'socks',
      designType: 'sku-color-card',
      summary: '三只袜子以统一基线和留白建立清楚的颜色比较关系。',
      strengths: [
        {
          aspect: 'composition',
          observation: '主体按等距节奏排列，顶部和标签形成稳定扫描路径。',
          reason: '统一基线减少比较成本，让用户更快识别颜色差异。confidence=0.91',
          suitableFor: ['SKU 色卡', '颜色组合展示']
        },
        {
          aspect: 'lighting',
          observation: '投影很轻，白底保持干净。',
          reason: '轻阴影提供落地感，不会污染浅色袜子的层次。D:\\Eagle\\library\\bad.jpg',
          suitableFor: ['白底 SKU']
        },
        {
          aspect: 'typography',
          observation: '编号与产品中心对齐，文字没有抢主体。',
          reason: '辅助信息保持低干扰，适合做规格比较。',
          suitableFor: ['SKU 自选备注']
        }
      ],
      suitableScenarios: ['袜子 SKU 色卡', '多色组合比较'],
      avoidWhen: ['花边罗口或异形袜口需要保留真实轮廓，不能强行统一形态。'],
      reusableHeuristics: [
        '先统一主体高度和基线，再微调脚尖落点。',
        '浅色产品使用更轻投影，深色产品保留纹理高光。',
        '标签与主体中心线对齐，编号只承担扫描辅助。'
      ],
      confidence: 0.91
    });
  });

  assert(result.success === true, 'design reference analyzer should parse model JSON', result);
  assert(result.observation?.analysisSource === 'resource:analyzeDesignReference', 'analysis source should identify the runtime adapter', result);
  assert((result.observation?.strengths || []).length >= 3, 'design reference analyzer should preserve reasoned strengths', result);
  assert((result.observation?.reusableHeuristics || []).length >= 3, 'design reference analyzer should preserve reusable heuristics', result);
  assert(capturedImagePayload.startsWith('data:image/jpeg;base64,'), 'vision call should receive an image data URL internally');
  assertIncludes(capturedPrompt, '构图和主体关系', 'design reference prompt');
  assertIncludes(capturedPrompt, '光影和精修', 'design reference prompt');
  assertIncludes(capturedPrompt, 'reusableHeuristics', 'design reference prompt');
  assertNoUnsafe(result, 'design reference analyzer result');

  const shallow = await service.analyzeDesignReference({
    imagePath,
    referenceTitle: '浅层参考图'
  }, async () => JSON.stringify({
    summary: '这张图很好看。',
    strengths: [{ aspect: 'generic', observation: '画面干净。', reason: '舒服。' }],
    suitableScenarios: [],
    reusableHeuristics: []
  }));
  assert(shallow.success === false, 'shallow design analysis should be rejected', shallow);
  assert(!shallow.observation, 'shallow design analysis must not return an observation', shallow);
  assert(shallow.rawModelTextRedacted === true, 'shallow rejection should not expose raw model text', shallow);

  const invalidJson = await service.analyzeDesignReference({
    imagePath,
    referenceTitle: '非 JSON 参考图'
  }, async () => '这张图不错，但是我没有返回 JSON。');
  assert(invalidJson.success === false, 'invalid JSON should be rejected', invalidJson);
  assert(invalidJson.rawModelTextRedacted === true, 'invalid JSON rejection should not expose raw model text', invalidJson);

  const preload = read('src/main/preload.ts');
  const handlers = read('src/main/ipc-handlers/resource-handlers.ts');
  const types = read('src/renderer/types.d.ts');
  const orchestrator = read('src/renderer/services/design-learning-runtime-orchestrator.service.ts');
  const packageJson = JSON.parse(read('package.json'));

  assertIncludes(preload, 'analyzeDesignReference', 'preload bridge');
  assertIncludes(preload, 'resource:analyzeDesignReference', 'preload IPC channel');
  assertIncludes(handlers, "ipcMain.handle('resource:analyzeDesignReference'", 'resource IPC handler');
  assertIncludes(types, 'analyzeDesignReference: (input:', 'renderer types');
  assertIncludes(orchestrator, 'runtimeAnalyzeDesignReference', 'runtime orchestrator preload adapter');
  assert(packageJson.scripts['smoke:design-learning:reference-analyzer'], 'package script should expose design reference analyzer smoke');
  assert(
    String(packageJson.scripts['maintenance:preflight'] || '').includes('smoke:design-learning:reference-analyzer'),
    'maintenance:preflight should include design reference analyzer smoke'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'ResourceManagerService analyzes design references through a vision-model prompt',
      'design reference prompt asks for composition, placement, lighting, color, typography and reusable heuristics',
      'valid model JSON becomes a needs-review observation without local paths, raw images or confidence markers',
      'shallow or non-JSON model output is rejected without exposing raw model text',
      'IPC, preload, renderer type and runtime orchestrator default adapter are wired'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
