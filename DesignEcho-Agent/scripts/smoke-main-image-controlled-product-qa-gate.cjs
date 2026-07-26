#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  buildMainImageControlledProductQaGate
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-controlled-product-qa-gate.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    'C:/DesignEcho/Exports/',
    'C:\\DesignEcho\\Exports\\'
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

function run() {
  const completedGate = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner()
  });
  assert(completedGate.stage === 'needs_result_file_probe', 'completed runner with result image should require file probe before pixel probe', completedGate);
  assert(completedGate.status === 'needs_review', 'completed gate should be needs_review', completedGate);
  assert(completedGate.resultImageSummary.resultImageCount === 1, 'result image should be discovered from export/readback/final snapshot context', completedGate.resultImageSummary);
  assert(completedGate.resultFileProbeSummary.fileProbeCount === 0, 'runner-only gate should expose missing file probe summary', completedGate.resultFileProbeSummary);
  assert(
    completedGate.resultImageSummary.resultImageNames.includes('main-image-click-800.png'),
    'result image names should contain only basename context',
    completedGate.resultImageSummary
  );
  assert(completedGate.qualityClaim.allowed === false, 'controlled product gate must not claim quality from runner alone', completedGate.qualityClaim);
  assert(completedGate.requiresManualReviewBeforeQualityClaim === true, 'manual review must remain required', completedGate);
  assert(completedGate.redaction.rawImagesRedacted === true, 'raw image payloads must be redacted', completedGate.redaction);
  assert(completedGate.redaction.pathsRedacted === true, 'absolute paths must be redacted to basenames', completedGate.redaction);
  assertNoRawPayload(completedGate, 'completed controlled product QA gate');

  const reviewedWithoutPixel = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner(),
    resultFileProbes: [{
      path: 'C:/DesignEcho/Exports/main-image-click-800.png',
      status: 'ok',
      exists: true,
      isFile: true,
      byteLength: 4096,
      format: 'png',
      dimensions: { width: 800, height: 800 },
      rawImagesRedacted: true
    }],
    referenceImagePath: 'C:/DesignEcho/References/main-image-reference.png',
    manualReview: {
      decision: 'approved',
      score: 0.96,
      reviewer: 'smoke',
      notes: ['manual review approved but pixel probe is still required']
    }
  });
  assert(reviewedWithoutPixel.stage === 'needs_pixel_probe', 'manual approval alone must not skip pixel probe', reviewedWithoutPixel);
  assert(reviewedWithoutPixel.resultFileProbeSummary.okFileProbeCount === 1, 'ok result file probe should be counted', reviewedWithoutPixel.resultFileProbeSummary);
  assert(reviewedWithoutPixel.resultFileProbeSummary.probeTargetMode === 'reference-image', 'reference path should be summarized as a probe target without leaking path', reviewedWithoutPixel.resultFileProbeSummary);
  assert(reviewedWithoutPixel.qualityClaim.allowed === false, 'manual approval without pixel probe must not allow quality claim', reviewedWithoutPixel.qualityClaim);
  assertNoRawPayload(reviewedWithoutPixel, 'reviewed controlled product QA gate');

  const fileProbedWithoutReference = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner(),
    resultFileProbes: [{
      path: 'C:/DesignEcho/Exports/main-image-click-800.png',
      status: 'ok',
      exists: true,
      isFile: true,
      dimensions: { width: 800, height: 800 },
      rawImagesRedacted: true
    }]
  });
  assert(fileProbedWithoutReference.stage === 'needs_probe_target', 'ok result file without reference or pixel probe should require probe target', fileProbedWithoutReference);
  assert(fileProbedWithoutReference.qualityClaim.allowed === false, 'missing probe target must not allow quality claim', fileProbedWithoutReference.qualityClaim);
  assertNoRawPayload(fileProbedWithoutReference, 'file-probed controlled product QA gate');

  const pixelWithoutManual = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner(),
    resultFileProbes: [{
      path: 'C:/DesignEcho/Exports/main-image-click-800.png',
      status: 'ok',
      exists: true,
      isFile: true,
      dimensions: { width: 800, height: 800 },
      rawImagesRedacted: true
    }],
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      mae: 0.8,
      rmse: 1.2,
      highDeltaRatio: 0.01,
      rawImagesRedacted: true
    }
  });
  assert(pixelWithoutManual.stage === 'needs_manual_review', 'pixel probe without manual approval should require manual review', pixelWithoutManual);
  assert(pixelWithoutManual.qualityClaim.allowed === false, 'pixel probe without manual approval must not allow quality claim', pixelWithoutManual.qualityClaim);

  const completeGate = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner(),
    resultFileProbes: [{
      path: 'C:/DesignEcho/Exports/main-image-click-800.png',
      status: 'ok',
      exists: true,
      isFile: true,
      byteLength: 4096,
      format: 'png',
      dimensions: { width: 800, height: 800 },
      sha256: 'abc123',
      rawImagesRedacted: true,
      imageData: 'base64-image-payload'
    }],
    referenceImagePath: 'C:/DesignEcho/References/main-image-reference.png',
    pixelProbe: {
      mode: 'pixel-probe',
      status: 'ok',
      mae: 0.8,
      rmse: 1.2,
      highDeltaRatio: 0.01,
      rawImagesRedacted: true,
      summary: 'pixel probe ok for C:/DesignEcho/Exports/main-image-click-800.png',
      rawPreview: 'data:image/png;base64,raw-image-payload'
    },
    manualReview: {
      decision: 'approved',
      score: 0.96,
      reviewer: 'smoke',
      notes: ['manual approved after pixel probe', 'raw-image-payload C:/DesignEcho/Exports/main-image-click-800.png'],
      imageData: 'base64-image-payload'
    }
  });
  assert(completeGate.stage === 'passed', 'complete controlled gate can mark context gate passed', completeGate);
  assert(completeGate.resultFileProbeSummary.resultFileNames.includes('main-image-click-800.png'), 'file probe summary should expose only basename', completeGate.resultFileProbeSummary);
  assert(completeGate.qualityClaim.allowed === false, 'even a passed controlled gate must not bypass final mainImageQaReport quality claim', completeGate.qualityClaim);
  assertNoRawPayload(completeGate, 'complete controlled product QA gate');

  const badFileProbeGate = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner(),
    resultFileProbes: [{
      path: 'C:/DesignEcho/Exports/main-image-click-800.png',
      status: 'decode_failed',
      exists: true,
      isFile: true,
      error: 'decode failed for C:/DesignEcho/Exports/main-image-click-800.png raw-image-payload',
      rawImagesRedacted: true
    }],
    referenceImagePath: 'C:/DesignEcho/References/main-image-reference.png'
  });
  assert(badFileProbeGate.stage === 'blocked', 'failed result file probe should block controlled gate', badFileProbeGate);
  assert(badFileProbeGate.resultFileProbeSummary.failedFileProbeCount === 1, 'failed file probe should be counted', badFileProbeGate.resultFileProbeSummary);
  assertNoRawPayload(badFileProbeGate, 'bad file-probe controlled product QA gate');

  const missingExportGate = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner({
      operationResults: [],
      finalAcceptanceSnapshot: {
        toolName: 'getAcceptanceSnapshot',
        success: true,
        summary: 'snapshot captured',
        data: { activeDocumentName: 'main-image-click.psd' }
      }
    })
  });
  assert(missingExportGate.stage === 'needs_result_image', 'completed runner without output path should require result image context', missingExportGate);
  assert(missingExportGate.qualityClaim.allowed === false, 'missing result image must block quality claim', missingExportGate.qualityClaim);

  const failedGate = buildMainImageControlledProductQaGate({
    runner: makeCompletedRunner({
      status: 'failed_operation',
      failedOperationCount: 1,
      blockers: ['operation_failed=exportGroup']
    })
  });
  assert(failedGate.stage === 'blocked', 'failed runner should block QA gate', failedGate);
  assert(failedGate.status === 'failed', 'failed runner should produce failed gate status', failedGate);
  assert(failedGate.blockers.includes('operation_failed=exportGroup'), 'failed runner blockers should be carried into gate', failedGate.blockers);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'controlled product QA gate derives result-image context from live runner output',
      'controlled product QA gate requires ok result file probes before pixel probing',
      'controlled product QA gate distinguishes missing probe target from missing pixel probe',
      'controlled product QA gate redacts raw image payload markers and absolute paths',
      'quality claim remains blocked without result image, pixel probe, and manual approved context',
      'failed runner state blocks the QA gate with runner blockers'
    ]
  }, null, 2));
}

run();
