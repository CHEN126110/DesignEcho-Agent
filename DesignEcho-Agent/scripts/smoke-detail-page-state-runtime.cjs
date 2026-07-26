#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  buildDetailTemplateState,
  resolveDetailExecutionScope
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'design-skills', 'detail-page-design.skill.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoMojibake(text, label) {
  const suspiciousTokens = [
    0x93b4,
    0x93c9,
    0x951b,
    0x95c8,
    0xfffd
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

const screens = [
  {
    id: 1,
    name: '首屏主视觉',
    type: 'C_HERO',
    order: 0,
    bounds: { left: 0, top: 0, width: 750, height: 1000 },
    copyPlaceholders: [{
      layerId: 101,
      layerName: '标题',
      currentText: '原标题',
      role: 'title',
      bounds: { left: 80, top: 80, width: 320, height: 90 },
      fontSize: 42
    }],
    imagePlaceholders: [{
      layerId: 201,
      layerName: '主图',
      bounds: { left: 80, top: 220, width: 590, height: 620 },
      aspectRatio: 0.95
    }]
  },
  {
    id: 2,
    name: '面料证明',
    type: 'G_MATERIAL',
    order: 1,
    bounds: { left: 0, top: 1000, width: 750, height: 1000 },
    copyPlaceholders: [{
      layerId: 102,
      layerName: '卖点',
      currentText: '原卖点',
      role: 'benefit',
      bounds: { left: 80, top: 1080, width: 380, height: 110 },
      fontSize: 34
    }],
    imagePlaceholders: [{
      layerId: 202,
      layerName: '细节图',
      bounds: { left: 80, top: 1220, width: 590, height: 560 },
      aspectRatio: 1.05
    }]
  }
];

const state = {
  schemaVersion: 'design-project-state/v0',
  sellingPoints: ['加厚保暖', '袜口柔软不勒脚'],
  copywriting: [
    { slot: '首屏主文案', text: '厚暖短袜，冬天穿也舒服', basis: '加厚保暖' },
    { slot: '面料证明', text: '细密毛圈锁住温度', basis: '面料细节' }
  ],
  visualDirection: '干净白底，暖感柔和，高级但不花哨',
  reviewResult: {
    verdict: 'needs_fix',
    issues: [{
      owner: 'layout',
      target: '面料证明',
      problem: '第二屏文案和图片关系不清楚',
      suggestion: '只重做面料证明屏'
    }]
  }
};

async function fakeRunTool(toolName) {
  if (toolName === 'getDocumentInfo') {
    return { success: false, error: 'runtime smoke skips live Photoshop geometry' };
  }
  if (toolName === 'detectLayerIssues') {
    return { success: true, issues: [] };
  }
  return { success: true };
}

async function run() {
  const results = [];
  const templateState = await buildDetailTemplateState({
    screens,
    issues: [],
    crossScreenRiskCount: 0,
    runTool: fakeRunTool,
    results,
    designProjectState: state
  });

  assert(templateState.projectStateContext.projectStateAvailable === true, 'template state should mark project State available', templateState.projectStateContext);
  assert(templateState.projectStateContext.stylePrompts.some((line) => line.includes('干净白底')), 'visual direction should enter runtime template state', templateState.projectStateContext);
  assert(templateState.screenPlans.length === 2, 'runtime template state should produce screen plans', templateState.screenPlans);
  assert(templateState.screenPlans.every((plan) => plan.decisionSource === 'agent'), 'State-derived decisions should satisfy screen plan agent decision source', templateState.screenPlans);
  assert(templateState.screenPlans.every((plan) => plan.requiresModelDecision === false), 'State-derived decisions should remove pending model decision from screen plans', templateState.screenPlans);
  assert(templateState.screenPlans[0].mainMessage === '厚暖短袜，冬天穿也舒服', 'runtime screen plan should consume State copywriting for first screen', templateState.screenPlans[0]);
  assert(templateState.screenPlans[1].mainMessage === '细密毛圈锁住温度', 'runtime screen plan should consume State copywriting for matched screen', templateState.screenPlans[1]);
  assert(templateState.projectStateContext.redoScreenIds.length === 1 && templateState.projectStateContext.redoScreenIds[0] === 2, 'runtime state context should expose review-targeted screen redo id', templateState.projectStateContext);

  const scope = await resolveDetailExecutionScope({
    screens,
    issues: [],
    crossScreenRiskCount: 0,
    autoFix: false,
    runTool: fakeRunTool,
    results: [],
    designProjectState: state
  });

  assert(scope.canProceed === true, 'runtime execution scope should proceed with recoverable screens', scope);
  assert(scope.templateState.screenPlans[1].mainMessage === '细密毛圈锁住温度', 'execution scope should preserve State-derived screen plans', scope.templateState.screenPlans[1]);
  assertNoMojibake(JSON.stringify({ templateState, scope }), 'detail-page runtime state smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'detail-page template state consumes Design Project State at runtime',
      'State-derived copywriting becomes agent screen decisions',
      'visualDirection enters runtime template state',
      'review target is exposed for screen-level redo'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
