#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  buildMainImageAcceptanceRecord
} = require(path.join(repoRoot, 'src/shared/main-image-acceptance-record.ts'));
const { buildMainImageAgentDraftPlan } = require(path.join(repoRoot, 'src/shared/main-image-agent-draft-plan.ts'));
const { buildMainImageScreenshotQa } = require(path.join(repoRoot, 'src/shared/main-image-screenshot-qa.ts'));
const { buildMainImageScreenshotProbeReadiness } = require(path.join(repoRoot, 'src/shared/main-image-screenshot-probe-readiness.ts'));
const { buildMainImageQaReport } = require(path.join(repoRoot, 'src/shared/main-image-qa-report.ts'));
const {
  buildMainImageControlledProductQaBridge
} = require(path.join(repoRoot, 'src/shared/main-image-controlled-product-qa-bridge.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertIncludes(value, needle, message) {
  assert(String(value || '').includes(needle), message || `Expected ${JSON.stringify(value)} to include ${needle}`);
}

function assertNoRawOrPathLeak(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    'C:/DesignEcho/',
    'C:\\DesignEcho\\',
    'C:/Exports/',
    'C:\\Exports\\',
    'C:/References/',
    'C:\\References\\'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} leaked raw payload or absolute path markers: ${found.join(', ')}`, value);
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

function approvedManualReview(overrides = {}) {
  return {
    decision: 'approved',
    score: 0.92,
    reviewer: 'smoke-reviewer',
    notes: [
      '人工确认构图、主体可见性和文案层级可接受。',
      '原始路径 C:/DesignEcho/Exports/main-image-800.jpg 和 raw-image-payload 不应泄漏。'
    ],
    ...overrides
  };
}

function okPixelProbe() {
  return {
    mode: 'pixel-probe',
    status: 'ok',
    mae: 6.1,
    rmse: 8.2,
    highDeltaRatio: 0.02,
    darkJaccard: 0.89,
    softDarkJaccard: 0.91,
    rawImagesRedacted: true,
    summary: 'coarse luma probe ok for C:/DesignEcho/Exports/main-image-800.jpg',
    boundary: 'diagnostic only, not aesthetic acceptance'
  };
}

function okFileProbe() {
  return {
    path: 'C:/DesignEcho/Exports/main-image-800.jpg',
    status: 'ok',
    exists: true,
    isFile: true,
    byteLength: 4096,
    format: 'jpg',
    dimensions: { width: 800, height: 800 },
    sha256: 'abc123',
    rawImagesRedacted: true
  };
}

function buildDraft() {
  return buildMainImageAgentDraftPlan({
    userText: '帮我做一张袜子主图草案',
    imageType: 'click',
    currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
    projectAssets: [{ name: 'white-sock.jpg', path: 'C:/Assets/private/white-sock.jpg', role: 'selected-project-image', width: 1000, height: 1000 }],
    selectedAsset: { name: 'white-sock.jpg', path: 'C:/Assets/private/white-sock.jpg', role: 'selected-project-image', width: 1000, height: 1000 },
    subjectBounds: { left: 180, top: 160, right: 800, bottom: 880, width: 620, height: 720 },
    sizePlans: [sizePlan],
    outputDir: 'C:/Exports/private',
    copyCandidates: ['轻薄透气，春夏出行更自在'],
    visionSignal: {
      source: 'vision-model',
      assetRef: { path: 'C:/Assets/private/white-sock.jpg', name: 'white-sock.jpg' },
      productType: '堆堆袜',
      subjectSummary: '白色条纹堆堆袜主体',
      backgroundSummary: '浅色背景'
    }
  });
}

function buildQaReport(options = {}) {
  const manualReview = options.manualReview;
  const screenshotQa = buildMainImageScreenshotQa({
    sizePlans: [sizePlan],
    resultImageRecord: {
      plannedExportCount: 1,
      successfulExportCount: 1,
      resultPaths: ['C:/DesignEcho/Exports/main-image-800.jpg'],
      missingOutputPathCount: 0,
      sources: ['smoke']
    },
    pixelProbe: options.pixelProbe,
    manualReview
  });
  const readiness = buildMainImageScreenshotProbeReadiness({
    screenshotQa,
    sizePlans: [sizePlan],
    fileProbes: options.fileProbes || [okFileProbe()],
    referenceImagePath: options.referenceImagePath || 'C:/References/private/reference.jpg'
  });
  return buildMainImageQaReport({
    agentDraft: buildDraft(),
    screenshotQa,
    screenshotProbeReadiness: readiness
  });
}

function makeCompletedRunner() {
  return {
    version: 'main-image-live-executor-runner/v0',
    skillId: 'main-image-design',
    scene: 'ecommerce-socks',
    status: 'completed_requires_review',
    executionScope: 'disposable-document',
    executedWithAdapter: true,
    mayWritePhotoshop: true,
    operationCount: 2,
    executedOperationCount: 2,
    successfulOperationCount: 2,
    failedOperationCount: 0,
    failedReadbackCount: 0,
    operationResults: [{
      requestId: 'op-1',
      sourceRequestId: 'source-1',
      tool: 'exportGroup',
      phase: 'export',
      success: true,
      summary: 'exported C:/DesignEcho/Exports/main-image-800.jpg',
      actualResult: {
        outputPath: 'C:/DesignEcho/Exports/main-image-800.jpg',
        preview: 'data:image/png;base64,raw-image-payload'
      },
      readbackResults: []
    }],
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    requiresManualReviewBeforeQualityClaim: true,
    blockers: [],
    warnings: [],
    limitations: [],
    sourceNotes: [],
    verificationReport: {
      reportId: 'main-image-live-executor-runner',
      scenario: 'main-image',
      status: 'needs_review',
      scope: 'task',
      summary: 'runner complete',
      checks: [],
      blockers: [],
      warnings: [],
      limitations: [],
      sourceNotes: []
    }
  };
}

function buildBridge(manualReview = approvedManualReview()) {
  return buildMainImageControlledProductQaBridge({
    runner: makeCompletedRunner(),
    sizePlans: [sizePlan],
    resultFileProbes: [okFileProbe()],
    referenceImagePath: 'C:/References/private/reference.jpg',
    pixelProbe: okPixelProbe(),
    manualReview
  });
}

const cases = [];
function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

record('requires-qa-report-before-recording', () => {
  const output = buildMainImageAcceptanceRecord({
    caseId: 'smoke-no-qa',
    manualReview: approvedManualReview()
  });
  assert(output.stage === 'needs_qa_report', `expected needs_qa_report, got ${output.stage}`);
  assert(output.canClaimOutputQuality === false, 'record without qa report must not allow quality claim');
  assert(output.blockers.some((item) => item.includes('mainImageQaReport')), 'missing qa report blocker');
  assertNoRawOrPathLeak(output, 'no-qa acceptance record');
  return { stage: output.stage };
});

record('does-not-upgrade-incomplete-qa-report', () => {
  const qaReport = buildQaReport({ pixelProbe: null, manualReview: null, referenceImagePath: '' });
  const output = buildMainImageAcceptanceRecord({
    caseId: 'smoke-incomplete',
    qaReport,
    resultImagePaths: ['C:/DesignEcho/Exports/main-image-800.jpg'],
    referenceImagePath: 'C:/References/private/reference.jpg',
    manualReview: approvedManualReview()
  });
  assert(output.stage === 'needs_quality_checks', `expected needs_quality_checks, got ${output.stage}`);
  assert(output.canClaimOutputQuality === false, 'incomplete qa report must not be upgraded by manual review');
  assert(output.qualityClaim.allowed === false, 'quality claim must mirror qa report gate');
  assertNoRawOrPathLeak(output, 'incomplete acceptance record');
  return { stage: output.stage, qaStage: output.sourceSummary.qaStage };
});

record('requires-valid-acceptance-review-after-qa-claim', () => {
  const qaReport = buildQaReport({
    pixelProbe: okPixelProbe(),
    manualReview: approvedManualReview()
  });
  const missingReviewer = buildMainImageAcceptanceRecord({
    caseId: 'smoke-invalid-review',
    qaReport,
    controlledProductQaBridge: buildBridge(),
    manualReview: approvedManualReview({ reviewer: '' })
  });
  assert(missingReviewer.stage === 'blocked_invalid_review', `expected blocked_invalid_review, got ${missingReviewer.stage}`);
  assert(missingReviewer.canClaimOutputQuality === false, 'invalid review must block quality claim');
  assert(missingReviewer.blockers.some((item) => item.includes('reviewer')), 'reviewer blocker missing');

  const invalidScore = buildMainImageAcceptanceRecord({
    caseId: 'smoke-invalid-score',
    qaReport,
    controlledProductQaBridge: buildBridge(),
    manualReview: approvedManualReview({ score: 1.5 })
  });
  assert(invalidScore.stage === 'blocked_invalid_review', `expected blocked_invalid_review, got ${invalidScore.stage}`);
  assert(invalidScore.blockers.some((item) => item.includes('score')), 'score blocker missing');
  assertNoRawOrPathLeak(invalidScore, 'invalid-score acceptance record');
  return { missingReviewer: missingReviewer.stage, invalidScore: invalidScore.stage };
});

record('records-only-when-qa-report-and-review-are-both-approved', () => {
  const manualReview = approvedManualReview();
  const qaReport = buildQaReport({
    pixelProbe: okPixelProbe(),
    manualReview
  });
  const output = buildMainImageAcceptanceRecord({
    caseId: 'smoke-approved',
    source: 'product-disposable-live',
    qaReport,
    controlledProductQaBridge: buildBridge(manualReview),
    resultFileProbes: [okFileProbe()],
    resultImagePaths: ['C:/DesignEcho/Exports/main-image-800.jpg'],
    referenceImagePath: 'C:/References/private/reference.jpg',
    manualReview,
    replayCommand: 'npm run smoke:main-image:acceptance-record -- --result C:/DesignEcho/Exports/main-image-800.jpg'
  });
  assert(output.stage === 'recorded', `expected recorded, got ${output.stage}`);
  assert(output.status === 'passed', `expected passed, got ${output.status}`);
  assert(output.qualityClaim.allowed === true, 'accepted record should allow output quality claim');
  assert(output.canClaimOutputQuality === true, 'accepted record can claim output quality');
  assert(output.canClaimDesignComplete === false, 'single main-image acceptance must not claim whole project complete');
  assert(output.sourceSummary.resultImageNames.includes('main-image-800.jpg'), 'basename result image missing');
  assert(output.replay.suggestedCommand.includes('[redacted-path]') || !output.replay.suggestedCommand.includes('C:/DesignEcho/'), 'replay command should redact paths');
  assertNoRawOrPathLeak(output, 'accepted main image acceptance record');
  return { stage: output.stage, qualityClaim: output.qualityClaim.allowed };
});

record('source-and-wiring-have-no-mojibake', () => {
  const files = [
    'src/shared/main-image-acceptance-record.ts',
    'src/renderer/services/skill-executors/main-image.executor.ts',
    'package.json'
  ];
  for (const file of files) {
    assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert(pkg.scripts['smoke:main-image:acceptance-record'], 'package script missing acceptance record smoke');
  assertIncludes(pkg.scripts['maintenance:preflight'], 'smoke:main-image:acceptance-record', 'maintenance preflight missing acceptance record smoke');
  return { wired: true };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const tmpDir = path.join(repoRoot, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const jsonPath = path.join(tmpDir, 'main-image-acceptance-record-smoke.json');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status, error }) => ({ name, status, error })),
  report: { json: jsonPath }
}, null, 2));

process.exit(report.success ? 0 : 1);
