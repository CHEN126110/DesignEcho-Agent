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
const {
  buildMainImageScreenshotQa
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-screenshot-qa.ts'));

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

const passingToolResults = [
  { toolName: 'getDocumentInfo', result: { success: true } },
  { toolName: 'getSubjectBounds', result: { success: true, bounds: readyDraftInput.subjectBounds } },
  { toolName: 'smartLayout[800]', result: { success: true } },
  { toolName: 'moveLayer[800]', result: { success: true } },
  { toolName: 'quickExport[800]', result: { success: true, outputPath: 'C:/Exports/main-image-800.jpg' } },
  { toolName: 'createTextLayer[headline]', result: { success: true, layerId: 9 } }
];

const cases = [];

function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

function buildReadyAlignment(manualReview) {
  const draft = buildMainImageAgentDraftPlan({
    ...readyDraftInput,
    manualReview
  });
  return {
    draft,
    alignment: buildMainImageExecutionAlignment({
      agentDraft: draft,
      sizePlans: [baseSizePlan],
      toolResults: passingToolResults
    })
  };
}

record('needs-result-image-when-no-export-or-screenshot-exists', () => {
  const qa = buildMainImageScreenshotQa({
    sizePlans: [{ ...baseSizePlan, quickExportPlanned: false, quickExportOutputPath: undefined }],
    toolResults: passingToolResults.filter((entry) => !String(entry.toolName).startsWith('quickExport'))
  });
  assert(qa.status === 'needs_review', `expected needs_review, got ${qa.status}`);
  assert(qa.stage === 'needs_result_image', `expected needs_result_image, got ${qa.stage}`);
  assert(qa.warnings.some((item) => item.includes('没有结果图')), 'missing result image warning absent');
  return { stage: qa.stage, warnings: qa.warnings.length };
});

record('blocks-when-export-was-planned-but-no-quick-export-succeeded', () => {
  const qa = buildMainImageScreenshotQa({
    sizePlans: [{ ...baseSizePlan, quickExportOutputPath: undefined }],
    toolResults: passingToolResults.filter((entry) => !String(entry.toolName).startsWith('quickExport'))
  });
  assert(qa.status === 'failed', `expected failed, got ${qa.status}`);
  assert(qa.stage === 'blocked', `expected blocked, got ${qa.stage}`);
  assert(qa.blockers.some((item) => item.includes('没有 quickExport 成功结果')), 'missing quickExport blocker absent');
  return { blockers: qa.blockers };
});

record('needs-pixel-probe-when-result-image-exists', () => {
  const { draft, alignment } = buildReadyAlignment(undefined);
  const qa = buildMainImageScreenshotQa({
    sizePlans: [baseSizePlan],
    toolResults: passingToolResults,
    visualVerification: draft.visualVerification,
    executionAlignment: alignment
  });
  assert(qa.status === 'needs_review', `expected needs_review, got ${qa.status}`);
  assert(qa.stage === 'needs_pixel_probe', `expected needs_pixel_probe, got ${qa.stage}`);
  assert(qa.resultImageRecord.resultPaths.includes('C:/Exports/main-image-800.jpg'), 'result path absent');
  assert(qa.warnings.some((item) => item.includes('没有 pixel probe')), 'pixel probe warning absent');
  return { stage: qa.stage, resultPaths: qa.resultImageRecord.resultPaths.length };
});

record('accepts-explicit-result-image-context-without-fake-quick-export', () => {
  const qa = buildMainImageScreenshotQa({
    sizePlans: [{ ...baseSizePlan, quickExportPlanned: false, quickExportOutputPath: undefined }],
    toolResults: passingToolResults.filter((entry) => !String(entry.toolName).startsWith('quickExport')),
    resultImageRecord: {
      plannedExportCount: 1,
      successfulExportCount: 1,
      resultPaths: ['C:/DesignEcho/Exports/controlled-main-image-800.png'],
      missingOutputPathCount: 0,
      sources: ['controlledProduct.exportGroup.actualResult']
    }
  });
  assert(qa.status === 'needs_review', `expected needs_review, got ${qa.status}`);
  assert(qa.stage === 'needs_pixel_probe', `expected needs_pixel_probe, got ${qa.stage}`);
  assert(qa.resultImageRecord.resultPaths.includes('C:/DesignEcho/Exports/controlled-main-image-800.png'), 'explicit result path absent');
  assert(qa.resultImageRecord.sources.includes('controlledProduct.exportGroup.actualResult'), 'explicit result context source absent');
  assert(qa.resultImageRecord.successfulExportCount === 1, 'explicit successful export count should be preserved');
  return { stage: qa.stage, sources: qa.resultImageRecord.sources };
});

record('needs-manual-review-when-pixel-probe-is-ok', () => {
  const { draft, alignment } = buildReadyAlignment(undefined);
  const qa = buildMainImageScreenshotQa({
    sizePlans: [baseSizePlan],
    toolResults: passingToolResults,
    visualVerification: draft.visualVerification,
    executionAlignment: alignment,
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      mae: 8.5,
      highDeltaRatio: 0.04,
      darkJaccard: 0.82,
      rawImagesRedacted: true,
      boundary: 'diagnostic only'
    }
  });
  assert(qa.status === 'needs_review', `expected needs_review, got ${qa.status}`);
  assert(qa.stage === 'needs_manual_review', `expected needs_manual_review, got ${qa.stage}`);
  assert(qa.warnings.some((item) => item.includes('缺少人工复核')), 'manual review warning absent');
  return { stage: qa.stage, pixelProbe: qa.pixelProbe.status };
});

record('passes-only-with-result-image-pixel-probe-and-approved-review', () => {
  const manualReview = { decision: 'approved', score: 0.88, reviewer: 'smoke' };
  const { draft, alignment } = buildReadyAlignment(manualReview);
  const qa = buildMainImageScreenshotQa({
    sizePlans: [baseSizePlan],
    toolResults: passingToolResults,
    visualVerification: draft.visualVerification,
    executionAlignment: alignment,
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      mae: 7.2,
      highDeltaRatio: 0.03,
      darkJaccard: 0.86,
      rawImagesRedacted: true,
      boundary: 'diagnostic only'
    },
    manualReview
  });
  assert(qa.status === 'passed', `expected passed, got ${qa.status}`);
  assert(qa.stage === 'passed', `expected passed, got ${qa.stage}`);
  assert(qa.limitations.some((item) => item.includes('不是审美评分器')), 'quality limitation missing');
  return { stage: qa.stage, checks: qa.checks.length };
});

record('blocks-raw-image-leak-in-pixel-probe', () => {
  const { draft, alignment } = buildReadyAlignment(undefined);
  const qa = buildMainImageScreenshotQa({
    sizePlans: [baseSizePlan],
    toolResults: passingToolResults,
    visualVerification: draft.visualVerification,
    executionAlignment: alignment,
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      rawImagesRedacted: false,
      boundary: 'diagnostic only'
    }
  });
  assert(qa.status === 'failed', `expected failed, got ${qa.status}`);
  assert(qa.blockers.some((item) => item.includes('rawImagesRedacted=true')), 'raw image redaction blocker absent');
  return { blockers: qa.blockers };
});

record('executor-and-maintenance-wiring-is-present', () => {
  const executor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assertIncludes(executor, 'buildMainImageControlledProductQaBundle', 'executor should obtain screenshot QA from the unified QA bundle');
  assertIncludes(executor, 'mainImageScreenshotQa', 'executor missing screenshot QA result data');
  assert(pkg.scripts['smoke:main-image:screenshot-qa'], 'package script missing screenshot QA smoke');
  assertIncludes(pkg.scripts['maintenance:preflight'], 'smoke:main-image:screenshot-qa', 'maintenance preflight missing screenshot QA smoke');
  return { wired: true };
});

record('source-and-output-have-no-mojibake', () => {
  const files = [
    'src/shared/main-image-screenshot-qa.ts',
    'src/renderer/services/skill-executors/main-image.executor.ts'
  ];
  for (const file of files) {
    assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
  }
  const qa = buildMainImageScreenshotQa({
    sizePlans: [baseSizePlan],
    toolResults: passingToolResults
  });
  assertNoMojibake(JSON.stringify(qa, null, 2), 'screenshot QA output');
  return { files: files.length, stage: qa.stage };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-screenshot-qa-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-screenshot-qa-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image Screenshot QA Smoke',
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
