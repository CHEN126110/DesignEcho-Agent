#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildEagleAssetCandidatesPanel
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-asset-candidates-panel.ts'));
const {
  buildEagleCandidateVisualHandoff
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-candidate-visual-handoff.ts'));
const {
  buildEagleCandidateVisualInsightRequest
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-candidate-visual-insight-request.ts'));
const {
  normalizeEagleReadonlyKnowledgeResults
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-readonly-knowledge.ts'));
const {
  buildEagleVisualCaseIndexFromReadonlyKnowledge
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-visual-case-index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoForbiddenPayload(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const forbidden of [
    'confidence',
    '置信',
    'data:image',
    'rawImage',
    'base64',
    'C:\\tmp',
    'D:\\Eagle',
    'filePath',
    'thumbnailPath',
    'direct_photoshop_action',
    'shouldRunAnalyzerNow":true',
    'shouldWriteCacheNow":true'
  ]) {
    assert(!text.includes(forbidden), `${label} must not expose forbidden marker: ${forbidden}`);
  }
}

function sampleReadonlyKnowledge() {
  return normalizeEagleReadonlyKnowledgeResults(
    {
      query: 'socks sku card clean shadow',
      limit: 4
    },
    [
      {
        id: 'eagle-asset-1',
        name: 'five-color-socks-card.jpg',
        ext: 'jpg',
        tags: ['socks', 'sku-card', 'clean-shadow', 'white-bg'],
        folders: ['SKU references', '袜子案例'],
        width: 1600,
        height: 1000,
        annotation: 'Five socks arranged with consistent form and soft shadow.',
        filePath: 'D:\\Eagle\\library\\five-color-socks-card.jpg',
        thumbnailPath: 'D:\\Eagle\\library\\.thumb\\five-color-socks-card.jpg',
        imageBase64: 'data:image/png;base64,should-not-leak'
      }
    ],
    {
      nowIso: '2026-05-28T00:00:00.000Z',
      sourceTool: 'item_query'
    }
  );
}

const readonlyKnowledge = sampleReadonlyKnowledge();
const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
  requestedBy: 'smoke-eagle-candidate-visual-insight-request',
  generatedAt: '2026-05-28T00:00:00.000Z'
});
const panel = buildEagleAssetCandidatesPanel({
  query: 'socks sku card clean shadow',
  readonlyKnowledge,
  visualCaseIndex,
  generatedAt: '2026-05-28T00:01:00.000Z'
});
const selectedCandidate = panel.candidates[0];
const handoff = buildEagleCandidateVisualHandoff({
  panel,
  selectedCandidateId: selectedCandidate.candidateId,
  requestedBy: 'smoke-eagle-candidate-visual-insight-request',
  generatedAt: '2026-05-28T00:02:00.000Z'
});

const blockedByAssetRef = buildEagleCandidateVisualInsightRequest({
  handoff,
  requestedBy: 'smoke-eagle-candidate-visual-insight-request',
  generatedAt: '2026-05-28T00:03:00.000Z'
});
assert(blockedByAssetRef.version === 'eagle-candidate-visual-insight-request/v0', 'request should expose stable version', blockedByAssetRef);
assert(blockedByAssetRef.status === 'blocked_missing_project_asset_ref', 'ready Eagle handoff should still require a project asset ref', blockedByAssetRef);
assert(blockedByAssetRef.selectedCandidate?.candidateId === selectedCandidate.candidateId, 'blocked request should keep safe selected candidate snapshot', blockedByAssetRef);
assert(blockedByAssetRef.sideEffects.shouldRunAnalyzerNow === false, 'blocked request must not run analyzer', blockedByAssetRef);
assert(blockedByAssetRef.sideEffects.shouldWriteCacheNow === false, 'blocked request must not write cache', blockedByAssetRef);
assert(blockedByAssetRef.canRunEagle === false, 'request must not run Eagle', blockedByAssetRef);
assert(blockedByAssetRef.canRunAgentRuntime === false, 'request must not run Agent runtime', blockedByAssetRef);
assert(blockedByAssetRef.canRunPhotoshop === false, 'request must not run Photoshop', blockedByAssetRef);
assert(blockedByAssetRef.canClaimVisualAnalysisComplete === false, 'request must not claim visual analysis complete', blockedByAssetRef);
assert(blockedByAssetRef.canClaimDesignQuality === false, 'request must not claim design quality', blockedByAssetRef);
assert(blockedByAssetRef.requiredRuntimeContext.includes('project_asset_ref_required'), 'blocked request should say which runtime context is missing', blockedByAssetRef);

const readyRequest = buildEagleCandidateVisualInsightRequest({
  handoff,
  requestedBy: 'smoke-eagle-candidate-visual-insight-request',
  generatedAt: '2026-05-28T00:04:00.000Z',
  projectPath: 'D:/project/C-1151',
  projectAssetRef: {
    assetId: 'project-asset-1',
    projectRelativePath: '新建文件夹/five-color-socks-card.jpg',
    role: 'raw-product-still',
    source: 'project-asset-index'
  },
  cacheFillEnabled: true,
  runtimeCanAnalyze: true,
  runtimeCanWriteCache: true,
  maxCandidates: 1
});
assert(readyRequest.status === 'ready_for_visual_insight_fill_plan', 'safe project asset ref should create a fill-plan request', readyRequest);
assert(readyRequest.projectAssetRef?.projectRelativePath === '新建文件夹/five-color-socks-card.jpg', 'request should preserve project-relative path', readyRequest);
assert(readyRequest.visualSamplingPlan?.selectedCandidates.length === 1, 'request should build one bounded visual sampling candidate', readyRequest);
assert(readyRequest.visualSamplingPlan?.selectedCandidates[0].path === '新建文件夹/five-color-socks-card.jpg', 'sampling plan must use project-relative path only', readyRequest);
assert(readyRequest.visualSamplingPlan?.selectedCandidates[0].role === 'raw-product-still', 'sampling plan should preserve resolved project asset role', readyRequest);
assert(readyRequest.fillPlan?.status === 'ready', 'explicitly enabled fill plan should be ready when runtime can analyze and write', readyRequest);
assert(readyRequest.fillPlan?.shouldCallAnalyzer === true, 'fill plan preview should expose the separate runner readiness', readyRequest);
assert(readyRequest.sideEffects.shouldRunAnalyzerNow === false, 'request builder itself must not run analyzer', readyRequest);
assert(readyRequest.sideEffects.shouldWriteCacheNow === false, 'request builder itself must not write cache', readyRequest);
assert(readyRequest.sideEffects.shouldCallPhotoshopNow === false, 'request builder itself must not call Photoshop', readyRequest);
assert(readyRequest.requestedObservations.includes('subject_regions'), 'request should carry subject-region observation requirement', readyRequest);
assert(readyRequest.requestedObservations.includes('actual_bounds'), 'request should carry actual-bounds observation requirement', readyRequest);
assert(readyRequest.requiredChecks.includes('screenshot_review'), 'request should carry screenshot review requirement', readyRequest);
assert(!JSON.stringify(readyRequest).includes('"evidence"'), 'request must not expose a generic evidence field', readyRequest);
assert(readyRequest.requiredReview.includes('visual_analysis_required'), 'request should keep visual-analysis review requirement', readyRequest);
assert(readyRequest.requiredReview.includes('human_review_required'), 'request should keep human-review requirement', readyRequest);

const blockedHandoff = buildEagleCandidateVisualHandoff({
  panel,
  selectedCandidateId: '',
  requestedBy: 'smoke-eagle-candidate-visual-insight-request',
  generatedAt: '2026-05-28T00:05:00.000Z'
});
const blockedRequest = buildEagleCandidateVisualInsightRequest({
  handoff: blockedHandoff,
  projectAssetRef: {
    assetId: 'project-asset-1',
    projectRelativePath: '新建文件夹/five-color-socks-card.jpg',
    role: 'raw-product-still',
    source: 'project-asset-index'
  },
  requestedBy: 'smoke-eagle-candidate-visual-insight-request',
  generatedAt: '2026-05-28T00:06:00.000Z'
});
assert(blockedRequest.status === 'blocked_handoff_not_ready', 'blocked Eagle handoff must not become a visual insight request', blockedRequest);
assert(blockedRequest.visualSamplingPlan === undefined, 'blocked handoff must not fabricate visual sampling plan', blockedRequest);
assert(blockedRequest.fillPlan === undefined, 'blocked handoff must not fabricate fill plan', blockedRequest);

assertNoForbiddenPayload({ blockedByAssetRef, readyRequest, blockedRequest }, 'Eagle candidate visual insight request');

console.log(JSON.stringify({
  success: true,
  checks: [
    'ready Eagle candidate handoff still requires an explicit project asset ref',
    'project asset ref creates a bounded visual insight fill-plan request without executing it',
    'blocked handoff cannot fabricate visual sampling or fill plans',
    'request payload strips Eagle local paths, raw image payloads, confidence markers and Photoshop actions'
  ]
}, null, 2));
