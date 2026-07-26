#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(repoRoot, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const {
  selectMainImageAssetCandidate
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-asset-selection.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoMojibake(text, label) {
  const signals = [
    '\u9359',
    '\u93c8',
    '\u951b',
    '\u95c8',
    '\u7f01',
    '\u20ac',
    '\ufffd',
    '\u9428',
    '\u6d93',
    '\u95c2',
    '\u7efe',
    '\u9225',
    '\u4fd9'
  ];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

const cases = [];

function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

record('explicit-selected-asset-wins', () => {
  const result = selectMainImageAssetCandidate({
    userText: '帮我用袜子图做主图',
    selectedAsset: {
      path: 'C:/project/assets/袜子主图候选.png',
      name: '袜子主图候选.png',
      width: 1200,
      height: 1200,
      role: 'selected-project-image'
    },
    projectAssets: [
      { path: 'C:/project/assets/reference.png', name: 'reference.png', role: 'project-image' }
    ]
  });
  assert(result.readiness === 'ready', 'explicit selected asset should be ready');
  assert(result.preflightGate === 'pass', 'explicit selected asset gate should pass');
  assert(result.selectionMode === 'explicit-asset', `unexpected mode ${result.selectionMode}`);
  assert(result.assetDecisionSource === 'explicit', 'explicit asset should not be treated as heuristic');
  assert(result.requiresModelAssetDecision === false, 'explicit asset should not require model asset decision');
  assert(result.selectedAsset && result.selectedAsset.path.includes('袜子主图候选'), 'selected asset mismatch');
  return {
    mode: result.selectionMode,
    selected: result.selectedAsset.name,
    score: result.selectedAsset.score
  };
});

record('selected-project-image-is-prioritized', () => {
  const result = selectMainImageAssetCandidate({
    userText: '做一张袜子主图',
    projectAssets: [
      { path: 'C:/project/assets/参考图.jpg', name: '参考图.jpg', role: 'project-image' },
      { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'selected-project-image', source: 'selected-project-image' }
    ]
  });
  assert(result.readiness === 'ready', 'selected project image should be ready');
  assert(result.selectionMode === 'selected-project-image', `unexpected mode ${result.selectionMode}`);
  assert(result.assetDecisionSource === 'user-selection', 'selected project image should be marked as user-selection');
  assert(result.requiresModelAssetDecision === false, 'selected project image should not require another model asset decision');
  assert(result.selectedAsset.name.includes('商品袜子'), 'selected project image should win');
  return {
    mode: result.selectionMode,
    candidates: result.candidateCount,
    selected: result.selectedAsset.name
  };
});

record('active-document-is-fallback-not-visual-selection', () => {
  const result = selectMainImageAssetCandidate({
    userText: '帮我做主图',
    currentDocument: { id: 1, name: '当前商品.psd', width: 1000, height: 1000 }
  });
  assert(result.readiness === 'ready', 'active document fallback should be usable context');
  assert(result.selectionMode === 'active-document-fallback', `unexpected mode ${result.selectionMode}`);
  assert(result.assetDecisionSource === 'heuristic-candidate', 'active document fallback should be heuristic candidate only');
  assert(result.requiresModelAssetDecision === true, 'active document fallback should require model asset decision');
  assert(result.limitations.some((item) => item.includes('不做真实视觉审美判断')), 'must keep metadata-only limitation');
  assert(result.limitations.some((item) => item.includes('模型 Agent')), 'heuristic asset selection should surface model decision boundary');
  return {
    mode: result.selectionMode,
    selected: result.selectedAsset.name,
    limitationCount: result.limitations.length
  };
});

record('project-asset-candidate-requires-model-decision', () => {
  const result = selectMainImageAssetCandidate({
    userText: '帮我做一张袜子主图',
    projectAssets: [
      { path: 'C:/project/assets/reference.jpg', name: 'reference.jpg', role: 'project-image' },
      { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'project-image' }
    ]
  });
  assert(result.readiness === 'ready', 'project asset candidate should be usable context');
  assert(result.selectionMode === 'project-asset-candidate', `unexpected mode ${result.selectionMode}`);
  assert(result.assetDecisionSource === 'heuristic-candidate', 'project candidate should be marked as heuristic');
  assert(result.requiresModelAssetDecision === true, 'project candidate should require model asset decision');
  assert(result.limitations.some((item) => item.includes('最终主图素材需要模型 Agent')), 'project candidate should include model decision limitation');
  return {
    mode: result.selectionMode,
    decisionSource: result.assetDecisionSource,
    requiresModelAssetDecision: result.requiresModelAssetDecision
  };
});

record('missing-context-does-not-invent-asset', () => {
  const result = selectMainImageAssetCandidate({ userText: '帮我做一张主图' });
  assert(result.readiness === 'needs_context', 'missing context should need input');
  assert(result.preflightGate === 'needs_input', 'missing context gate should need input');
  assert(result.selectionMode === 'missing', 'missing context should not select asset');
  assert(!result.selectedAsset, 'missing context must not fabricate selected asset');
  return {
    readiness: result.readiness,
    warnings: result.warnings
  };
});

record('explicit-non-image-is-blocked', () => {
  const result = selectMainImageAssetCandidate({
    userText: '帮我做主图',
    selectedAsset: { path: 'C:/project/assets/商品说明.txt', name: '商品说明.txt' }
  });
  assert(result.readiness === 'blocked', 'explicit non-image should be blocked');
  assert(result.preflightGate === 'blocked', 'explicit non-image gate should be blocked');
  assert(result.blockers.some((item) => item.includes('不像图片')), 'missing non-image blocker');
  return {
    readiness: result.readiness,
    blockers: result.blockers
  };
});

record('source-and-output-have-no-mojibake', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'shared', 'main-image-asset-selection.ts'), 'utf8');
  const output = JSON.stringify(selectMainImageAssetCandidate({
    userText: '帮我做一张袜子主图',
    projectAssets: [{ path: 'C:/project/assets/商品袜子.jpg', name: '商品袜子.jpg' }]
  }), null, 2);
  assertNoMojibake(source, 'main-image-asset-selection.ts');
  assertNoMojibake(output, 'asset selection output');
  return {
    sourceLength: source.length,
    outputLength: output.length
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-asset-selection-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-asset-selection-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image Asset Selection Smoke',
  '',
  `success: ${report.success}`,
  '',
  ...cases.map((item) => `- ${item.name}: ${item.status}`)
].join('\n'), 'utf8');

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status, error }) => ({ name, status, error })),
  report: { json: jsonPath, md: mdPath }
}, null, 2));

process.exit(report.success ? 0 : 1);
