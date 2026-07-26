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
  buildMainImageAgentDraftPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-agent-draft-plan.ts'));
const {
  buildMainImageExecutionAlignment
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-execution-alignment.ts'));

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

const baseSizePlan = {
  sizeKey: '800',
  targetSize: { width: 800, height: 800 },
  subjectSize: { width: 620, height: 720 },
  scale: 0.72,
  targetX: 118,
  targetY: 76,
  decisionReason: '主图 guideline scale 72%',
  layoutCandidateScore: 84,
  layoutCandidateReason: '主体居中且保留顶部标题区',
  smartLayoutPlanned: true,
  quickExportPlanned: true,
  quickExportOutputPath: 'C:/Exports/main-image-800.jpg'
};

const readyDraftInput = {
  userText: '帮我做一张袜子主图草案',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  subjectBounds: { left: 180, top: 160, right: 800, bottom: 880, width: 620, height: 720 },
  sizePlans: [baseSizePlan],
  copyCandidates: ['轻薄透气，春夏出行更自在'],
  outputDir: 'C:/Exports',
  visionSignal: {
    source: 'vision-model',
    assetRef: { id: '1', name: 'SKU.psb' },
    productType: '堆堆袜',
    subjectSummary: '白色条纹堆堆袜主体',
    backgroundSummary: '浅色背景',
    confidence: 0.78
  }
};

const cases = [];

function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

record('watch-when-copy-or-visual-review-is-not-backed-by-context', () => {
  const draft = buildMainImageAgentDraftPlan({
    ...readyDraftInput,
    sizePlans: [{ ...baseSizePlan, quickExportOutputPath: undefined }],
    manualReview: undefined
  });
  const alignment = buildMainImageExecutionAlignment({
    agentDraft: draft,
    sizePlans: draft.executionPlan.steps.length ? [{ ...baseSizePlan, quickExportOutputPath: undefined }] : [],
    toolResults: [
      { toolName: 'getDocumentInfo', result: { success: true } },
      { toolName: 'getSubjectBounds', result: { success: true, bounds: readyDraftInput.subjectBounds } },
      { toolName: 'smartLayout[800]', result: { success: true } },
      { toolName: 'moveLayer[800]', result: { success: true } },
      { toolName: 'quickExport[800]', result: { success: true } }
    ]
  });
  assert(alignment.status === 'watch', `expected watch, got ${alignment.status}`);
  assert(alignment.warnings.some((item) => item.includes('文本写入结果')), 'copy execution warning should be visible');
  assert(alignment.warnings.some((item) => item.includes('视觉验收阶段')), 'visual verification warning should be visible');
  return { status: alignment.status, warnings: alignment.warnings.length };
});

record('blocked-when-context-or-subject-context-is-missing', () => {
  const draft = buildMainImageAgentDraftPlan(readyDraftInput);
  const alignment = buildMainImageExecutionAlignment({
    agentDraft: draft,
    sizePlans: [baseSizePlan],
    toolResults: [
      { toolName: 'smartLayout[800]', result: { success: true } },
      { toolName: 'quickExport[800]', result: { success: true } }
    ]
  });
  assert(alignment.status === 'blocked', `expected blocked, got ${alignment.status}`);
  assert(alignment.blockers.some((item) => item.includes('getDocumentInfo')), 'missing document blocker absent');
  assert(alignment.blockers.some((item) => item.includes('getSubjectBounds/getLayerBounds')), 'missing subject blocker absent');
  return { blockers: alignment.blockers };
});

record('aligned-when-plan-dsl-tools-and-review-context-are-covered', () => {
  const draft = buildMainImageAgentDraftPlan({
    ...readyDraftInput,
    manualReview: {
      decision: 'approved',
      score: 0.86,
      reviewer: 'smoke'
    }
  });
  const alignment = buildMainImageExecutionAlignment({
    agentDraft: draft,
    sizePlans: [baseSizePlan],
    toolResults: [
      { toolName: 'getDocumentInfo', result: { success: true } },
      { toolName: 'getSubjectBounds', result: { success: true, bounds: readyDraftInput.subjectBounds } },
      { toolName: 'smartLayout[800]', result: { success: true } },
      { toolName: 'moveLayer[800]', result: { success: true } },
      { toolName: 'quickExport[800]', result: { success: true } },
      { toolName: 'createTextLayer[headline]', result: { success: true, layerId: 9 } }
    ]
  });
  assert(alignment.status === 'aligned', `expected aligned, got ${alignment.status}`);
  assert(alignment.checks.every((check) => check.status === 'aligned'), 'all checks should be aligned');
  assert(alignment.limitations.some((item) => item.includes('不代表截图相似')), 'quality limitation missing');
  return { status: alignment.status, checks: alignment.checks.length };
});

record('executor-and-maintenance-wiring-is-present', () => {
  const executor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assertIncludes(executor, 'buildMainImageControlledProductQaBundle', 'executor should use the unified controlled-product QA bundle');
  assertIncludes(executor, 'data.mainImageQaReport', 'executor should expose the unified main-image QA report');
  assert(pkg.scripts['smoke:main-image:execution-alignment'], 'package script missing execution alignment smoke');
  assertIncludes(pkg.scripts['maintenance:preflight'], 'smoke:main-image:execution-alignment', 'maintenance preflight missing execution alignment smoke');
  return { wired: true };
});

record('source-and-output-have-no-mojibake', () => {
  const files = [
    'src/shared/main-image-execution-alignment.ts',
    'src/renderer/services/skill-executors/main-image.executor.ts'
  ];
  for (const file of files) {
    assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
  }
  const draft = buildMainImageAgentDraftPlan(readyDraftInput);
  const output = buildMainImageExecutionAlignment({
    agentDraft: draft,
    sizePlans: [baseSizePlan],
    toolResults: [{ toolName: 'getDocumentInfo', result: { success: true } }]
  });
  assertNoMojibake(JSON.stringify(output, null, 2), 'execution alignment output');
  return { files: files.length, status: output.status };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-execution-alignment-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-execution-alignment-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image Execution Alignment Smoke',
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
