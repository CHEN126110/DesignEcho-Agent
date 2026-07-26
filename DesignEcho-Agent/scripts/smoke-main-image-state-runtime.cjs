#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const localStorageData = new Map();
global.localStorage = {
  getItem: (key) => localStorageData.has(key) ? localStorageData.get(key) : null,
  setItem: (key, value) => localStorageData.set(key, String(value)),
  removeItem: (key) => localStorageData.delete(key),
  clear: () => localStorageData.clear()
};

const calls = {
  getDesignState: [],
  updateDesignState: []
};

const projectState = {
  schemaVersion: 'design-project-state/v0',
  targetUser: '北方冬天的年轻女性',
  sellingPoints: ['加厚保暖', '不掉跟'],
  painPoints: ['冬天脚冷'],
  copywriting: [
    { slot: '点击图主文案', text: '厚暖短袜，冬天也舒服', basis: '加厚保暖' }
  ],
  visualDirection: '白底干净，暖光柔和，主体放大'
};

global.window = {
  designEcho: {
    getDesignState: async (projectPath) => {
      calls.getDesignState.push(projectPath);
      return projectState;
    },
    updateDesignState: async (projectPath, patch) => {
      calls.updateDesignState.push({ projectPath, patch });
      return { success: true, projectPath, patch };
    }
  }
};

const { mainImageExecutor } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'main-image.executor.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} leaked raw image payload markers: ${found.join(', ')}`, value);
}

async function run() {
  const params = {
    userIntent: '帮我做主图，给我几个方案',
    imageType: 'click',
    mainImageExecutionMode: 'strategy-only',
    assetPath: 'C:/project/assets/socks.png',
    assetWidth: 1600,
    assetHeight: 1600,
    outputDir: 'C:/project/主图',
    subjectBounds: {
      left: 260,
      top: 320,
      right: 1320,
      bottom: 980,
      width: 1060,
      height: 660
    },
    sizePlans: [{
      sizeKey: '800',
      targetSize: { width: 1440, height: 1440 },
      subjectSize: { width: 1060, height: 660 },
      scale: 0.72,
      targetX: 338,
      targetY: 482,
      decisionReason: 'runtime state smoke',
      smartLayoutPlanned: true,
      quickExportPlanned: true
    }]
  };

  const result = await mainImageExecutor.execute({
    params,
    callbacks: {
      onMessage: () => {},
      onProgress: () => {}
    },
    context: {
      userInput: params.userIntent,
      projectContext: {
        projectPath: 'C:/project/C-STATE',
        selectedProjectImagePath: params.assetPath,
        sampleImagePaths: [params.assetPath],
        visualInsightCache: {
          entries: [{
            cacheKey: 'project-visual:socks',
            path: params.assetPath,
            insight: {
              assetId: 'asset-socks',
              path: params.assetPath,
              productType: '短袜',
              summary: '白色短袜主体',
              scene: '浅色背景',
              styleTags: ['白色', '干净']
            }
          }]
        }
      }
    }
  });

  assert(result.success === true, 'strategy-only main-image executor should succeed with project State', result);
  assert(calls.getDesignState.length === 1, 'main-image executor should read Design Project State once', calls);
  assert(calls.getDesignState[0] === 'C:/project/C-STATE', 'main-image executor should read State by current projectPath', calls);
  assert(calls.updateDesignState.length === 1, 'strategy-only main-image executor should append one version record', calls);
  assert(
    calls.updateDesignState[0].patch?.appendVersion?.reason?.includes('主图多版本方案'),
    'strategy-only main-image executor should append a multi-version strategy record',
    calls.updateDesignState[0]
  );
  assert(
    result.toolResults.some((entry) => entry.toolName === 'getDesignProjectState[main-image]'),
    'runtime result should expose getDesignState tool result context',
    result.toolResults
  );
  assert(
    result.toolResults.some((entry) => String(entry.toolName || '').startsWith('updateDesignProjectState[main-image:strategy]')),
    'runtime result should expose updateDesignState tool result context',
    result.toolResults
  );
  assert(
    result.data?.mainImageStateContext?.copyCandidates?.includes('厚暖短袜，冬天也舒服'),
    'runtime data should contain State-derived copy candidates',
    result.data?.mainImageStateContext
  );
  assert(
    result.data?.mainImageCompositionVersions?.length >= 2,
    'runtime data should contain State-derived composition versions',
    result.data?.mainImageCompositionVersions
  );
  assert(
    result.data?.mainImageStrategyInputBundle?.strategyInputs?.copyRolePolicy?.candidates?.includes('厚暖短袜，冬天也舒服'),
    'State-derived copy should reach main-image strategy input context',
    result.data?.mainImageStrategyInputBundle?.strategyInputs?.copyRolePolicy
  );
  assertNoRawPayload(result, 'main-image state runtime result');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'main-image executor reads project Design Project State at runtime',
      'strategy-only path appends a main-image multi-version strategy record',
      'State-derived copy reaches runtime strategy input context',
      'runtime result exposes State context without raw image payloads'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
