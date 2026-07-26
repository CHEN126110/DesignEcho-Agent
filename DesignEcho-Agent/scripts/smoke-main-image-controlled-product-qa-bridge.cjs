#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  buildMainImageControlledProductQaBridge
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-controlled-product-qa-bridge.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertIncludes(value, needle, message) {
  assert(String(value || '').includes(needle), message || `Expected ${JSON.stringify(value)} to include ${needle}`);
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    'C:/DesignEcho/',
    'C:\\DesignEcho\\'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} leaked raw payload or absolute path markers: ${found.join(', ')}`, value);
}

function makeCompletedRunner(overrides = {}) {
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
    operationResults: [
      {
        requestId: 'op-1',
        sourceRequestId: 'source-1',
        tool: 'createDocument',
        phase: 'setup',
        success: true,
        summary: 'created disposable document',
        actualResult: {
          documentId: 'doc-1',
          preview: 'data:image/png;base64,raw-image-payload'
        },
        readbackResults: []
      },
      {
        requestId: 'op-2',
        sourceRequestId: 'source-2',
        tool: 'exportGroup',
        phase: 'export',
        success: true,
        summary: 'exported result group',
        actualResult: {
          outputPath: 'C:/DesignEcho/Exports/main-image-click-800.png',
          rawImageData: 'base64-image-payload'
        },
        readbackResults: [
          {
            toolName: 'getLayerHierarchy',
            success: true,
            summary: 'layer hierarchy ok',
            data: {
              exportedPath: 'C:/DesignEcho/Exports/main-image-click-800.png',
              imageData: 'raw-image-payload'
            }
          }
        ]
      }
    ],
    finalAcceptanceSnapshot: {
      toolName: 'getAcceptanceSnapshot',
      success: true,
      summary: 'snapshot captured',
      data: {
        activeDocumentName: 'main-image-click.psd',
        outputPath: 'C:/DesignEcho/Exports/main-image-click-800.png',
        thumbnail: 'data:image/png;base64,raw-image-payload'
      }
    },
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
    },
    ...overrides
  };
}

function okFileProbe() {
  return {
    path: 'C:/DesignEcho/Exports/main-image-click-800.png',
    status: 'ok',
    exists: true,
    isFile: true,
    byteLength: 4096,
    format: 'png',
    dimensions: { width: 800, height: 800 },
    sha256: 'abc123',
    rawImagesRedacted: true,
    rawPreview: 'data:image/png;base64,raw-image-payload'
  };
}

function okPixelProbe() {
  return {
    mode: 'pixel-probe',
    status: 'ok',
    mae: 0.8,
    rmse: 1.2,
    highDeltaRatio: 0.01,
    rawImagesRedacted: true,
    summary: 'pixel probe ok for C:/DesignEcho/Exports/main-image-click-800.png',
    rawPreview: 'data:image/png;base64,raw-image-payload'
  };
}

function approvedReview() {
  return {
    decision: 'approved',
    score: 0.96,
    reviewer: 'smoke',
    notes: ['manual approved after pixel probe', 'C:/DesignEcho/Exports/main-image-click-800.png raw-image-payload']
  };
}

function run() {
  const runnerOnly = buildMainImageControlledProductQaBridge({
    runner: makeCompletedRunner()
  });
  assert(runnerOnly.stage === 'needs_result_file_probe', 'runner-only bridge should require result file probe', runnerOnly);
  assert(runnerOnly.screenshotQaStage === 'needs_pixel_probe', 'explicit result image context should enter screenshot QA', runnerOnly);
  assert(runnerOnly.screenshotProbeReadinessStage === 'needs_result_file_probe', 'readiness should require file probe before pixel probe', runnerOnly);
  assert(runnerOnly.resultImageSummary.resultImageCount === 1, 'runner result image should be discovered', runnerOnly.resultImageSummary);
  assert(runnerOnly.resultImageSummary.resultImageNames.includes('main-image-click-800.png'), 'bridge should expose only basename result image context', runnerOnly.resultImageSummary);
  assert(runnerOnly.qualityClaim.allowed === false, 'bridge must never allow quality claim by itself', runnerOnly.qualityClaim);
  assertNoRawPayload(runnerOnly, 'runner-only controlled product QA bridge');

  const fileProbedWithoutReference = buildMainImageControlledProductQaBridge({
    runner: makeCompletedRunner(),
    resultFileProbes: [okFileProbe()]
  });
  assert(fileProbedWithoutReference.stage === 'needs_probe_target', 'file-probed bridge without reference should require probe target', fileProbedWithoutReference);
  assert(fileProbedWithoutReference.screenshotProbeReadinessStage === 'needs_probe_target', 'readiness should expose missing probe target', fileProbedWithoutReference);
  assert(fileProbedWithoutReference.resultFileProbeSummary.okFileProbeCount === 1, 'ok file probe should be summarized', fileProbedWithoutReference.resultFileProbeSummary);
  assert(fileProbedWithoutReference.resultFileProbeSummary.probeTargetMode === 'result-file-only', 'probe target mode should be result-file-only without leaking paths', fileProbedWithoutReference.resultFileProbeSummary);
  assertNoRawPayload(fileProbedWithoutReference, 'file-probed controlled product QA bridge');

  const readyForPixel = buildMainImageControlledProductQaBridge({
    runner: makeCompletedRunner(),
    resultFileProbes: [okFileProbe()],
    referenceImagePath: 'C:/DesignEcho/References/main-image-reference.png'
  });
  assert(readyForPixel.stage === 'needs_pixel_probe', 'reference-backed bridge should require pixel probe next', readyForPixel);
  assert(readyForPixel.screenshotQaStage === 'needs_pixel_probe', 'screenshot QA should still require pixel probe', readyForPixel);
  assert(readyForPixel.screenshotProbeReadinessStage === 'ready_for_pixel_probe', 'readiness should be ready for pixel probe', readyForPixel);
  assert(readyForPixel.resultFileProbeSummary.probeTargetMode === 'reference-image', 'reference target should be summarized without raw path', readyForPixel.resultFileProbeSummary);
  assertNoRawPayload(readyForPixel, 'ready-for-pixel controlled product QA bridge');

  const pixelWithoutManual = buildMainImageControlledProductQaBridge({
    runner: makeCompletedRunner(),
    resultFileProbes: [okFileProbe()],
    referenceImagePath: 'C:/DesignEcho/References/main-image-reference.png',
    pixelProbe: okPixelProbe()
  });
  assert(pixelWithoutManual.stage === 'needs_manual_review', 'pixel ok bridge should require manual review', pixelWithoutManual);
  assert(pixelWithoutManual.screenshotQaStage === 'needs_manual_review', 'screenshot QA should require manual review', pixelWithoutManual);
  assert(pixelWithoutManual.screenshotProbeReadinessStage === 'needs_manual_review', 'readiness should mirror manual review need', pixelWithoutManual);
  assertNoRawPayload(pixelWithoutManual, 'pixel-without-manual controlled product QA bridge');

  const completeBridge = buildMainImageControlledProductQaBridge({
    runner: makeCompletedRunner(),
    resultFileProbes: [okFileProbe()],
    referenceImagePath: 'C:/DesignEcho/References/main-image-reference.png',
    pixelProbe: okPixelProbe(),
    manualReview: approvedReview()
  });
  assert(completeBridge.stage === 'passed', 'complete context bridge should pass context stage', completeBridge);
  assert(completeBridge.screenshotQaStage === 'passed', 'screenshot QA should pass with image, pixel and manual context', completeBridge);
  assert(completeBridge.screenshotProbeReadinessStage === 'passed', 'probe readiness should pass when screenshot QA passes', completeBridge);
  assert(completeBridge.qualityClaim.allowed === false, 'passed bridge must still not replace final mainImageQaReport quality claim', completeBridge.qualityClaim);
  assertNoRawPayload(completeBridge, 'complete controlled product QA bridge');

  const blockedBridge = buildMainImageControlledProductQaBridge({
    runner: makeCompletedRunner({ status: 'blocked', blockers: ['export failed'] })
  });
  assert(blockedBridge.stage === 'blocked', 'blocked runner should block bridge', blockedBridge);
  assert(blockedBridge.status === 'failed', 'blocked bridge status should be failed', blockedBridge);
  assertNoRawPayload(blockedBridge, 'blocked controlled product QA bridge');

  const executorSource = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
  const screenshotQaSource = fs.readFileSync(path.join(repoRoot, 'src/shared/main-image-screenshot-qa.ts'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assertIncludes(screenshotQaSource, 'resultImageRecord?', 'screenshot QA must accept explicit result image context instead of fake quickExport tool results');
  assertIncludes(executorSource, 'buildMainImageControlledProductQaBundle', 'executor must build controlled product QA bridge context');
  assertIncludes(executorSource, 'mainImageControlledProductQaBridge', 'executor must expose controlled product QA bridge data');
  assert(packageJson.scripts['smoke:main-image:controlled-product-qa-bridge'], 'package script missing controlled product QA bridge smoke');
  assertIncludes(packageJson.scripts['maintenance:preflight'], 'smoke:main-image:controlled-product-qa-bridge', 'maintenance preflight missing controlled product QA bridge smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'controlled live runner result paths enter screenshot QA via explicit result image context',
      'controlled live runner result paths enter screenshot probe readiness without fake quickExport tool results',
      'bridge stages require file probe, probe target, pixel probe and manual review in order',
      'bridge output redacts raw/base64 payloads and absolute paths',
      'bridge does not replace final mainImageQaReport quality claim'
    ]
  }, null, 2));
}

run();
