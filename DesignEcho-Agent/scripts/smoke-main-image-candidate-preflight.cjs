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
  buildMainImageCandidatePreflightPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-asset-selection.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(value, needle, message) {
  assert(String(value || '').includes(needle), message || `Expected ${JSON.stringify(value)} to include ${needle}`);
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
    assert(!String(text).includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
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

record('default-is-metadata-only-and-does-not-call-model', () => {
  const plan = buildMainImageCandidatePreflightPlan({
    userText: '帮我做一张袜子主图',
    projectAssets: [
      { path: 'C:/project/images/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'selected-project-image', source: 'selected-project-image' },
      { path: 'C:/project/images/参考图.png', name: '参考图.png', role: 'project-image' }
    ],
    hasAnalyzer: true
  });
  assert(plan.status === 'metadata_only', `unexpected status ${plan.status}`);
  assert(plan.shouldCallAnalyzer === false, 'default must not call analyzer');
  assert(plan.shouldAnalyzePaths.length === 0, 'default must not request analysis paths');
  assert(plan.selectedCandidate.name.includes('商品袜子'), 'selected project image should rank first');
  return { status: plan.status, selected: plan.selectedCandidate.name };
});

record('enabled-analyzes-only-top-candidate-by-default', () => {
  const plan = buildMainImageCandidatePreflightPlan({
    userText: '理解项目中最适合做主图的袜子图',
    enableVisionPreflight: true,
    hasAnalyzer: true,
    projectAssets: [
      { path: 'C:/project/images/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'selected-project-image', source: 'selected-project-image' },
      { path: 'C:/project/images/商品袜子02.jpg', name: '商品袜子02.jpg', role: 'project-image' }
    ]
  });
  assert(plan.status === 'ready_to_analyze', `unexpected status ${plan.status}`);
  assert(plan.shouldCallAnalyzer === true, 'enabled plan should request analyzer');
  assert(plan.maxVisionCandidates === 1, 'default max should be 1');
  assert(plan.shouldAnalyzePaths.length === 1, 'should analyze one candidate by default');
  assert(plan.shouldAnalyzePaths[0].endsWith('商品袜子01.jpg'), 'selected candidate path should be first');
  return { paths: plan.shouldAnalyzePaths };
});

record('explicit-asset-wins-over-project-candidates', () => {
  const plan = buildMainImageCandidatePreflightPlan({
    userText: '用我指定的商品图做主图',
    enableVisionPreflight: true,
    hasAnalyzer: true,
    selectedAsset: { path: 'C:/project/images/指定商品图.png', name: '指定商品图.png', role: 'explicit-main-image-asset' },
    projectAssets: [
      { path: 'C:/project/images/项目商品图.jpg', name: '项目商品图.jpg', role: 'selected-project-image', source: 'selected-project-image' }
    ]
  });
  assert(plan.selectedCandidate.source === 'explicit-asset', `unexpected source ${plan.selectedCandidate.source}`);
  assert(plan.shouldAnalyzePaths[0].endsWith('指定商品图.png'), 'explicit asset should be analyzed first');
  return { selected: plan.selectedCandidate.name, source: plan.selectedCandidate.source };
});

record('missing-analyzer-blocks-without-faking-vision', () => {
  const plan = buildMainImageCandidatePreflightPlan({
    userText: '分析这张主图素材',
    enableVisionPreflight: true,
    hasAnalyzer: false,
    projectAssets: [
      { path: 'C:/project/images/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'selected-project-image', source: 'selected-project-image' }
    ]
  });
  assert(plan.status === 'blocked', `unexpected status ${plan.status}`);
  assert(plan.shouldCallAnalyzer === false, 'missing analyzer must not call analyzer');
  assert(plan.blockers.some((item) => item.includes('analyzeAssetContent')), 'missing analyzer blocker absent');
  return { blockers: plan.blockers };
});

record('candidate-limit-is-capped-to-three', () => {
  const plan = buildMainImageCandidatePreflightPlan({
    userText: '分析项目候选图',
    enableVisionPreflight: 'auto',
    maxVisionCandidates: 9,
    hasAnalyzer: true,
    projectAssets: [
      { path: 'C:/project/images/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'selected-project-image', source: 'selected-project-image' },
      { path: 'C:/project/images/商品袜子02.jpg', name: '商品袜子02.jpg', role: 'project-image' },
      { path: 'C:/project/images/商品袜子03.jpg', name: '商品袜子03.jpg', role: 'project-image' },
      { path: 'C:/project/images/商品袜子04.jpg', name: '商品袜子04.jpg', role: 'project-image' }
    ]
  });
  assert(plan.maxVisionCandidates === 3, `expected max 3, got ${plan.maxVisionCandidates}`);
  assert(plan.shouldAnalyzePaths.length === 3, 'analysis paths should be capped to 3');
  return { maxVisionCandidates: plan.maxVisionCandidates, pathCount: plan.shouldAnalyzePaths.length };
});

record('executor-and-declaration-are-wired', () => {
  const executor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
  const declarations = fs.readFileSync(path.join(repoRoot, 'src/shared/skills/skill-declarations.ts'), 'utf8');
  assertIncludes(executor, 'buildMainImageCandidatePreflightPlan', 'executor missing candidate preflight builder');
  assertIncludes(executor, 'mainImageCandidatePreflight', 'executor missing candidate preflight data exposure');
  assertIncludes(declarations, 'maxVisionCandidates', 'skill declaration missing maxVisionCandidates');
  return { wired: true };
});

record('source-and-output-have-no-mojibake', () => {
  const files = [
    'src/shared/main-image-asset-selection.ts',
    'src/renderer/services/skill-executors/main-image.executor.ts',
    'src/shared/skills/skill-declarations.ts'
  ];
  for (const file of files) {
    assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
  }
  const output = buildMainImageCandidatePreflightPlan({
    userText: '帮我做袜子主图',
    enableVisionPreflight: true,
    hasAnalyzer: true,
    projectAssets: [{ path: 'C:/project/images/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'selected-project-image', source: 'selected-project-image' }]
  });
  assertNoMojibake(JSON.stringify(output, null, 2), 'candidate preflight output');
  return { files: files.length, status: output.status };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-candidate-preflight-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-candidate-preflight-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image Candidate Preflight Smoke',
  '',
  `success: ${report.success}`,
  '',
  ...cases.map((item) => `- ${item.name}: ${item.status}${item.error ? ` - ${item.error}` : ''}`)
].join('\n'), 'utf8');

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status, error }) => ({ name, status, error })),
  report: { json: jsonPath, md: mdPath }
}, null, 2));

process.exit(report.success ? 0 : 1);
