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

const { buildMainImageAgentDraftPlan } = require(path.join(repoRoot, 'src/shared/main-image-agent-draft-plan.ts'));
const { buildMainImageCandidatePreflightPlan } = require(path.join(repoRoot, 'src/shared/main-image-asset-selection.ts'));
const { buildMainImageVisionPreflightResult, buildMainImageVisionPreflightPlan } = require(path.join(repoRoot, 'src/shared/main-image-vision-preflight.ts'));
const { buildMainImageExecutionAlignment } = require(path.join(repoRoot, 'src/shared/main-image-execution-alignment.ts'));
const { buildMainImageScreenshotQa } = require(path.join(repoRoot, 'src/shared/main-image-screenshot-qa.ts'));
const { buildMainImageScreenshotProbeReadiness } = require(path.join(repoRoot, 'src/shared/main-image-screenshot-probe-readiness.ts'));
const { buildMainImageQaReport } = require(path.join(repoRoot, 'src/shared/main-image-qa-report.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(value, needle, message) {
  assert(String(value || '').includes(needle), message || `Expected ${JSON.stringify(value)} to include ${needle}`);
}

function assertNoMojibake(text, label) {
  const signals = [
    '\u9359', '\u93c8', '\u951b', '\u95c8', '\u7f01', '\u20ac', '\ufffd',
    '\u9428', '\u6d93', '\u95c2', '\u7efe', '\u9225', '\u4fd9'
  ];
  for (const signal of signals) {
    assert(!String(text).includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function assertNoRawImageLeak(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['imageData', 'data:image/', '"buffer"'];
  for (const item of forbidden) {
    assert(!text.includes(item), `${label} leaked ${item}`);
  }
}

const sizePlan = {
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
  quickExportOutputPath: 'C:/Exports/private/main-image-800.jpg'
};

const baseInput = {
  userText: '帮我做一张袜子主图草案',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  projectAssets: [{ name: 'white-sock.jpg', path: 'C:/Assets/private/white-sock.jpg', role: 'selected-project-image', width: 1000, height: 1000 }],
  selectedAsset: { name: 'white-sock.jpg', path: 'C:/Assets/private/white-sock.jpg', role: 'selected-project-image', width: 1000, height: 1000 },
  subjectBounds: { left: 180, top: 160, right: 800, bottom: 880, width: 620, height: 720 },
  sizePlans: [sizePlan],
  copyCandidates: ['轻薄透气，春夏出行更自在'],
  outputDir: 'C:/Exports/private',
  visionSignal: {
    source: 'vision-model',
    assetRef: { path: 'C:/Assets/private/white-sock.jpg', name: 'white-sock.jpg' },
    productType: '堆堆袜',
    subjectSummary: '白色条纹堆堆袜主体',
    backgroundSummary: '浅色背景',
    confidence: 0.78
  }
};

const toolResults = [
  { toolName: 'getDocumentInfo', result: { success: true } },
  { toolName: 'getSubjectBounds', result: { success: true, bounds: baseInput.subjectBounds } },
  { toolName: 'smartLayout[800]', result: { success: true } },
  { toolName: 'quickExport[800]', result: { success: true, outputPath: 'C:/Exports/private/main-image-800.jpg' } },
  { toolName: 'createTextLayer[headline]', result: { success: true, layerId: 9 } }
];

function buildContext(options = {}) {
  const manualReview = options.manualReview;
  const draft = buildMainImageAgentDraftPlan({
    ...baseInput,
    subjectBounds: options.noSubject ? null : baseInput.subjectBounds,
    sizePlans: options.noSizePlan ? [] : [sizePlan],
    manualReview
  });
  const candidatePreflight = buildMainImageCandidatePreflightPlan({
    userText: baseInput.userText,
    currentDocument: baseInput.currentDocument,
    projectAssets: baseInput.projectAssets,
    selectedAsset: baseInput.selectedAsset,
    enableVisionPreflight: false,
    hasAnalyzer: true
  });
  const visionPlan = buildMainImageVisionPreflightPlan({
    enabled: false,
    selectedAssetPath: baseInput.selectedAsset.path,
    selectedAssetName: baseInput.selectedAsset.name,
    hasAnalyzer: true
  });
  const visionPreflight = buildMainImageVisionPreflightResult({ plan: visionPlan });
  const executionAlignment = buildMainImageExecutionAlignment({
    agentDraft: draft,
    toolResults: options.noExport ? toolResults.filter((item) => !String(item.toolName).startsWith('quickExport')) : toolResults,
    sizePlans: options.noSizePlan ? [] : [sizePlan]
  });
  const screenshotQa = options.noScreenshotQa ? null : buildMainImageScreenshotQa({
    sizePlans: options.noSizePlan ? [] : [sizePlan],
    toolResults: options.noExport ? toolResults.filter((item) => !String(item.toolName).startsWith('quickExport')) : toolResults,
    visualVerification: draft.visualVerification,
    executionAlignment,
    pixelProbe: options.pixelProbe,
    manualReview
  });
  const fileProbes = options.fileProbes || [{
    path: 'C:/Exports/private/main-image-800.jpg',
    status: 'ok',
    exists: true,
    isFile: true,
    byteLength: 1200,
    format: 'jpeg',
    dimensions: { width: 800, height: 800 },
    sha256: 'abc123',
    rawImagesRedacted: true
  }];
  const screenshotProbeReadiness = screenshotQa && !options.noReadiness
    ? buildMainImageScreenshotProbeReadiness({
      screenshotQa,
      sizePlans: options.noSizePlan ? [] : [sizePlan],
      fileProbes,
      referenceImagePath: options.referenceImagePath
    })
    : null;
  return { draft, candidatePreflight, visionPreflight, executionAlignment, screenshotQa, screenshotProbeReadiness };
}

function toReportInput(context) {
  return {
    agentDraft: context.draft,
    candidatePreflight: context.candidatePreflight,
    visionPreflight: context.visionPreflight,
    executionAlignment: context.executionAlignment,
    screenshotQa: context.screenshotQa,
    screenshotProbeReadiness: context.screenshotProbeReadiness
  };
}

const cases = [];
function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

record('needs-context-when-agent-draft-is-not-ready', () => {
  const context = buildContext({ noSubject: true, noSizePlan: true, noScreenshotQa: true });
  const report = buildMainImageQaReport({
    ...toReportInput(context),
    executionAlignment: null,
    screenshotQa: null,
    screenshotProbeReadiness: null
  });
  assert(report.stage === 'needs_context', `expected needs_context, got ${report.stage}`);
  assert(report.qualityClaim.allowed === false, 'quality claim must be false');
  return { stage: report.stage, nextActions: report.nextActions };
});

record('needs-result-image-when-no-screenshot-context-exists', () => {
  const context = buildContext({ noScreenshotQa: true });
  const report = buildMainImageQaReport({
    ...toReportInput(context),
    screenshotQa: null,
    screenshotProbeReadiness: null
  });
  assert(report.stage === 'needs_result_image', `expected needs_result_image, got ${report.stage}`);
  assert(report.resultImageSummary.resultImageCount === 0, 'result image count should be 0');
  return { stage: report.stage };
});

record('needs-probe-target-when-result-files-exist-without-reference', () => {
  const context = buildContext({ pixelProbe: null, referenceImagePath: '' });
  const report = buildMainImageQaReport(toReportInput(context));
  assert(report.stage === 'needs_probe_target', `expected needs_probe_target, got ${report.stage}`);
  assert(report.resultImageSummary.fileProbeCount === 1, 'file probe count should be 1');
  assert(report.resultImageSummary.resultImageNames.includes('main-image-800.jpg'), 'basename should be present');
  assert(!JSON.stringify(report).includes('C:/Exports/private'), 'full output path should not be exposed');
  return { stage: report.stage, resultImageNames: report.resultImageSummary.resultImageNames };
});

record('needs-manual-review-when-pixel-probe-is-ok', () => {
  const context = buildContext({
    referenceImagePath: 'C:/References/private/reference.jpg',
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      mae: 7.2,
      highDeltaRatio: 0.03,
      darkJaccard: 0.86,
      rawImagesRedacted: true,
      summary: 'coarse luma probe ok',
      boundary: 'diagnostic only, not aesthetic acceptance'
    }
  });
  const report = buildMainImageQaReport(toReportInput(context));
  assert(report.stage === 'needs_manual_review', `expected needs_manual_review, got ${report.stage}`);
  assert(report.qualityClaim.allowed === false, 'pixelProbe ok without manual review must not allow quality claim');
  assert(report.qualityClaim.blockers.some((item) => item.includes('人工')), 'manual blocker missing');
  return { stage: report.stage, blockers: report.qualityClaim.blockers.length };
});

record('passes-only-with-approved-manual-review-and-passed-readiness', () => {
  const context = buildContext({
    referenceImagePath: 'C:/References/private/reference.jpg',
    manualReview: { decision: 'approved', score: 0.9, reviewer: 'smoke' },
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      mae: 6.1,
      rmse: 8.2,
      highDeltaRatio: 0.02,
      darkJaccard: 0.89,
      softDarkJaccard: 0.91,
      rawImagesRedacted: true,
      summary: 'coarse luma probe ok',
      boundary: 'diagnostic only, not aesthetic acceptance'
    }
  });
  const report = buildMainImageQaReport(toReportInput(context));
  assert(report.stage === 'passed', `expected passed, got ${report.stage}`);
  assert(report.status === 'passed', `expected status passed, got ${report.status}`);
  assert(report.qualityClaim.allowed === true, 'quality claim should be allowed only in full passed path');
  return { stage: report.stage, qualityClaim: report.qualityClaim.allowed };
});

record('blocks-raw-image-leak-from-pixel-probe', () => {
  const context = buildContext({
    referenceImagePath: 'C:/References/private/reference.jpg',
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      rawImagesRedacted: false,
      boundary: 'diagnostic only'
    }
  });
  const report = buildMainImageQaReport(toReportInput(context));
  assert(report.stage === 'blocked', `expected blocked, got ${report.stage}`);
  assert(report.status === 'failed', `expected failed, got ${report.status}`);
  assert(report.blockers.some((item) => item.includes('rawImagesRedacted')), 'raw image blocker missing');
  return { stage: report.stage, blockers: report.blockers };
});

record('executor-and-maintenance-wiring-is-present', () => {
  const executor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assertIncludes(executor, 'buildMainImageQaReport', 'executor missing QA report builder');
  assertIncludes(executor, 'mainImageQaReport', 'executor missing QA report data');
  assert(pkg.scripts['smoke:main-image:qa-report'], 'package script missing QA report smoke');
  assertIncludes(pkg.scripts['maintenance:preflight'], 'smoke:main-image:qa-report', 'preflight missing QA report smoke');
  return { wired: true };
});

record('source-and-output-have-no-mojibake-or-raw-image-leak', () => {
  const files = [
    'src/shared/main-image-qa-report.ts',
    'src/renderer/services/skill-executors/main-image.executor.ts'
  ];
  for (const file of files) {
    assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
  }
  const report = buildMainImageQaReport(toReportInput(buildContext({ referenceImagePath: '', pixelProbe: null })));
  assertNoMojibake(JSON.stringify(report, null, 2), 'qa report output');
  assertNoRawImageLeak(report, 'qa report output');
  assert(report.redaction.rawImagesRedacted === true, 'redaction boundary missing');
  assert(report.redaction.pathsRedacted === true, 'path redaction boundary missing');
  return { stage: report.stage, sections: report.sections.length };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-qa-report-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-qa-report-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image QA Report Smoke',
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
