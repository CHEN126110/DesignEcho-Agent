'use strict';

/**
 * Business result → Evaluation verification adapter smoke。
 *
 * 纯 fixture，不调用模型、不执行 Tool、不连接 Photoshop。重点守护：版本契约、
 * Profile/Skill source scope、mutation freshness，以及 Tool success 绝不等于质量通过。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const adapterModule = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-result-adapters.ts'));
const profileModule = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-profiles.ts'));
const qualityModule = require(path.join(root, 'src', 'shared', 'design-quality-assertion.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

const {
  adaptDesignEvaluationRecordsFromToolResults
} = adapterModule;
const {
  DETAIL_PAGE_EVALUATION_PROFILE_ID,
  DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
  MAIN_IMAGE_EVALUATION_PROFILE_ID,
  SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
  SKU_BATCH_EVALUATION_PROFILE_ID,
  getDesignEvaluationProfileById,
  getDesignEvaluationProfileVlmAssertions
} = profileModule;
const { DESIGN_ASSERTIONS } = qualityModule;

const FIXTURE_HISTORY_REF = { documentId: 42, historyStateId: 7001 };
const FIXTURE_SNAPSHOT_BASE64 = 'A'.repeat(600);

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function profile(profileId) {
  const value = getDesignEvaluationProfileById(profileId);
  assert.ok(value, profileId);
  return value;
}

function byKey(result) {
  return new Map(result.records.map((record) => [record.key, record]));
}

function mainImageQaData(options = {}) {
  const status = options.status || 'passed';
  const stage = options.stage || (status === 'failed' ? 'blocked' : 'passed');
  return {
    mainImageQaReport: {
      reportVersion: 'main-image-qa-report/v0',
      status,
      stage,
      qualityClaim: { allowed: options.allowed !== false },
      redaction: { rawImagesRedacted: true, pathsRedacted: true }
    }
  };
}

function detailPageData(options = {}) {
  const incompleteContent = options.incompleteContent === true;
  return {
    detailPageAgentResultSummary: {
      summaryVersion: 'detail-page-agent-result-summary/v0',
      status: options.summaryStatus || 'completed'
    },
    stats: {
      screensProcessed: 2,
      screensSuccess: options.failedScreen ? 1 : 2,
      screensFailed: options.failedScreen ? 1 : 0
    },
    screenPlans: [
      {
        screenId: 1,
        mainMessage: incompleteContent ? '待模型结合商品事实决定' : '轻薄透气的核心利益点',
        requiresModelDecision: incompleteContent
      },
      {
        screenId: 2,
        mainMessage: '材质结构与细节说明',
        requiresModelDecision: false
      }
    ],
    placementAudit: {
      success: true,
      warnings: options.placementRisk ? ['screen 2 offset'] : [],
      riskyScreenIds: options.placementRisk ? [2] : []
    },
    livePlacementDiagnostics: {
      placementCount: 2,
      unmatchedPlaceholderCount: 0
    },
    detailPageContentVerification: {
      version: 'detail-page-content-verification/v0',
      status: incompleteContent ? 'failed' : 'needs_review',
      summary: { screenCount: 2 },
      verificationPassed: false,
      boundaries: { claimsDesignQuality: false }
    }
  };
}

function skuData(options = {}) {
  const withMetrics = options.withMetrics !== false;
  const decision = options.decision || 'approved';
  const readbackStatus = options.readbackStatus || 'ready_for_review';
  let bindingStatus = 'awaiting_human_review';
  if (decision === 'approved') bindingStatus = 'fresh_review_approved';
  if (decision === 'rejected') bindingStatus = 'fresh_review_rejected';
  const probes = [1, 2].map((index) => ({
    success: true,
    fileName: `sku-${index}.png`,
    rawImagesRedacted: true,
    ...(withMetrics ? { visualMetrics: { rawImagesRedacted: true } } : {})
  }));
  return {
    skuDeliverySummary: {
      version: 'sku-delivery-summary/v0',
      status: options.deliveryStatus || 'completed',
      totalCombos: 2,
      noteCount: 1,
      warningCount: options.deliveryStatus === 'partial' ? 1 : 0
    },
    skuExecutionManifest: [
      { status: 'ready', comboCount: 2, plannedActions: ['combo', 'self-select-note'], blockers: [] }
    ],
    skuExportReadback: {
      version: 'sku-export-readback/v0',
      status: readbackStatus,
      expectedExportCount: 2,
      okFileProbeCount: 2,
      failedFileProbeCount: 0,
      missingFileProbeCount: 0,
      dimensionMismatchCount: 0,
      visualMetricBlockerCount: 0,
      fileProbes: probes
    },
    skuVisualReviewIntake: {
      version: 'sku-visual-review-intake/v0',
      status: decision === 'none' ? 'ready_for_human_review' : 'human_review_recorded',
      blockers: [],
      humanReview: decision === 'none' ? undefined : { decision }
    },
    skuHumanReviewBinding: {
      version: 'sku-human-review-binding/v0',
      status: bindingStatus,
      canSatisfyHumanReviewCheck: decision === 'approved',
      freshness: {
        checked: true,
        subjectMatched: decision !== 'none',
        projectMatched: decision !== 'none',
        recordIntegrityVerified: decision !== 'none'
      }
    }
  };
}

function assertionResult(assertion) {
  return {
    id: assertion.id,
    dimension: assertion.dimension,
    status: 'pass',
    score: 1,
    confidence: 1,
    method: assertion.method,
    severity: assertion.severity,
    owner: assertion.owner,
    rationale: `fixture:${assertion.id}:pass`,
    expectedFix: assertion.expectedFix
  };
}

console.log('smoke: design-evaluation-result-adapters');

check('Tool success without a versioned business contract never becomes a passed verification record', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(MAIN_IMAGE_EVALUATION_PROFILE_ID),
    toolResults: [{ name: 'main-image-design', result: { success: true, data: { status: 'completed' } } }],
    lastMutationIndex: 0
  });
  assert.deepStrictEqual(result.records, []);
  assert.deepStrictEqual(result.issueCodes, ['source_contract_invalid']);
  assert.strictEqual(result.boundaries.trustsToolSuccessAsQualityPass, false);
});

check('wrong Skill source cannot spoof another Profile verification contract', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(MAIN_IMAGE_EVALUATION_PROFILE_ID),
    toolResults: [{ name: 'detail-page-design', result: { success: true, data: mainImageQaData() } }]
  });
  assert.deepStrictEqual(result.records, []);
  assert.deepStrictEqual(result.issueCodes, ['source_not_found']);
});

check('main-image QA maps pass, review and explicit failure without a second verdict', () => {
  const selectedProfile = profile(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  const passed = adaptDesignEvaluationRecordsFromToolResults({
    profile: selectedProfile,
    toolResults: [{ name: 'main-image-design', result: { success: true, data: mainImageQaData() } }],
    lastMutationIndex: 0
  });
  assert.strictEqual(byKey(passed).get('main_image_qa_report').status, 'passed');
  const review = adaptDesignEvaluationRecordsFromToolResults({
    profile: selectedProfile,
    toolResults: [{ name: 'main-image-design', result: { success: true, data: mainImageQaData({ allowed: false }) } }]
  });
  assert.strictEqual(byKey(review).get('main_image_qa_report').status, 'needs_review');
  const failed = adaptDesignEvaluationRecordsFromToolResults({
    profile: selectedProfile,
    toolResults: [{ name: 'main-image-design', result: { success: false, data: mainImageQaData({ status: 'failed' }) } }]
  });
  assert.strictEqual(byKey(failed).get('main_image_qa_report').status, 'failed');
  assert.ok(failed.issueCodes.includes('explicit_failure_observed'));
  assert.strictEqual(failed.boundaries.finalVerdictOwnedByAdapter, false);
});

check('records before a later Photoshop mutation are downgraded to needs_review', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(MAIN_IMAGE_EVALUATION_PROFILE_ID),
    toolResults: [
      { name: 'main-image-design', result: { success: true, data: mainImageQaData() } },
      { name: 'setTextContent', result: { success: true } }
    ],
    lastMutationIndex: 1
  });
  assert.strictEqual(byKey(result).get('main_image_qa_report').status, 'needs_review');
  assert.ok(result.issueCodes.includes('source_stale_after_mutation'));
  assert.strictEqual(result.boundaries.staleRecordsCanPass, false);
});

check('detail-page coverage and placement can pass while fact linkage stays review-only', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(DETAIL_PAGE_EVALUATION_PROFILE_ID),
    toolResults: [{ name: 'detail-page-design', result: { success: true, data: detailPageData() } }],
    lastMutationIndex: 0
  });
  const records = byKey(result);
  assert.strictEqual(records.get('detail_page_screen_coverage').status, 'passed');
  assert.strictEqual(records.get('detail_page_placement_audit').status, 'passed');
  assert.strictEqual(records.get('detail_page_content_verification').status, 'needs_review');
  assert.ok(result.issueCodes.includes('quality_review_required'));
});

check('detail-page failed screen, placement risk and unfinished content remain explicit failures', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(DETAIL_PAGE_EVALUATION_PROFILE_ID),
    toolResults: [{
      name: 'detail-page-design',
      result: { success: true, data: detailPageData({ failedScreen: true, placementRisk: true, incompleteContent: true }) }
    }]
  });
  for (const record of result.records) assert.strictEqual(record.status, 'failed', record.key);
  assert.ok(result.issueCodes.includes('explicit_failure_observed'));
});

check('detail-page scoped edit reuses only the placement result from the business bridge', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID),
    toolResults: [{ name: 'detail-page-design', result: { success: true, data: detailPageData() } }],
    lastMutationIndex: 0
  });
  assert.deepStrictEqual(result.records.map((record) => record.key), ['detail_page_placement_audit']);
  assert.strictEqual(result.records[0].status, 'passed');
});

check('SKU variant/readback plus approved human review map four distinct verification keys', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(SKU_BATCH_EVALUATION_PROFILE_ID),
    toolResults: [{ name: 'sku-batch', result: { success: true, data: skuData() } }],
    lastMutationIndex: 0
  });
  const records = byKey(result);
  assert.strictEqual(records.get('sku_variant_coverage').status, 'passed');
  assert.strictEqual(records.get('sku_export_readback').status, 'passed');
  assert.strictEqual(records.get('sku_product_truth').status, 'passed');
  assert.strictEqual(records.get('sku_visual_consistency').status, 'passed');
  assert.strictEqual(records.get('sku_product_truth').source, 'human_review');
});

check('SKU missing visual metrics or human decision cannot default to pass', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(SKU_BATCH_EVALUATION_PROFILE_ID),
    toolResults: [{ name: 'sku-batch', result: { success: true, data: skuData({ withMetrics: false, decision: 'none' }) } }]
  });
  const records = byKey(result);
  assert.strictEqual(records.get('sku_variant_coverage').status, 'passed');
  assert.strictEqual(records.get('sku_export_readback').status, 'needs_review');
  assert.strictEqual(records.get('sku_product_truth').status, 'needs_review');
  assert.strictEqual(records.get('sku_visual_consistency').status, 'needs_review');
});

check('SKU color-card execution report proves structure but keeps visual consistency pending', () => {
  const result = adaptDesignEvaluationRecordsFromToolResults({
    profile: profile(SKU_COLOR_CARD_EVALUATION_PROFILE_ID),
    toolResults: [{
      name: 'sku-color-card',
      result: {
        success: true,
        data: {
          report: {
            version: 'sku-color-card-execution-report/v1',
            status: 'structure_ready',
            checks: {
              sourceCoverage: 'passed',
              smartObjectEditability: 'passed',
              clippingStructure: 'passed',
              finalStructureReadback: 'passed',
              labelTextFit: 'passed',
              visualComposition: 'needs_review'
            }
          }
        }
      }
    }]
  });
  const records = byKey(result);
  assert.strictEqual(records.get('sku_color_card_final_structure').status, 'passed');
  assert.strictEqual(records.get('sku_color_card_source_coverage').status, 'passed');
  assert.strictEqual(records.get('sku_color_card_smart_object_editability').status, 'passed');
  assert.strictEqual(records.get('sku_color_card_clipping_structure').status, 'passed');
  assert.strictEqual(records.get('sku_color_card_label_text_fit').status, 'passed');
  assert.strictEqual(records.get('sku_color_card_visual_consistency').status, 'needs_review');
  assert.ok(result.issueCodes.includes('quality_review_required'));
});

check('real Agent summary consumes fresh main-image QA adapter records', () => {
  const selectedProfile = profile(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  const agent = new Agent(
    {
      systemPrompt: 'verification adapter smoke',
      tools: [],
      modelId: 'test-model',
      maxIterations: 1,
      taskCompletionContext: { skillId: 'main-image-design', intentMode: 'creative_design' },
      evaluationProfile: selectedProfile,
      callbacks: {}
    },
    async () => { throw new Error('model must not be called'); },
    async () => { throw new Error('Tool must not be executed'); }
  );
  agent.currentTask = '设计一张主图';
  agent.toolCallLog = [
    { name: 'createDocument', arguments: {}, result: { success: true, document: { id: 42, name: 'adapter-fixture.psd' } } },
    { name: 'renderLayout', arguments: {}, result: { success: true, documentId: 42, subjectLayerIds: [2] } },
    { name: 'main-image-design', arguments: {}, result: { success: true, data: mainImageQaData() } },
    {
      name: 'getDocumentInfo',
      arguments: {},
      result: {
        success: true,
        document: { id: 42, name: 'adapter-fixture.psd', width: 1000, height: 1000 },
        historyStateRef: FIXTURE_HISTORY_REF
      }
    },
    {
      name: 'getLayerHierarchy',
      arguments: {},
      result: {
        success: true,
        historyStateRef: FIXTURE_HISTORY_REF,
        flatList: [
          { id: 1, kind: 'background', visible: true, bounds: { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }, fillColor: { r: 230, g: 240, b: 250 } },
          { id: 2, kind: 'smartObject', visible: true, bounds: { left: 200, top: 100, right: 800, bottom: 700, width: 600, height: 600 } },
          { id: 3, kind: 'shape', visible: true, bounds: { left: 100, top: 750, right: 900, bottom: 950, width: 800, height: 200 } },
          { id: 4, kind: 'text', visible: true, bounds: { left: 200, top: 780, right: 800, bottom: 850, width: 600, height: 70 } },
          { id: 5, kind: 'text', visible: true, bounds: { left: 300, top: 870, right: 700, bottom: 910, width: 400, height: 40 } }
        ]
      }
    },
    {
      name: 'getAllTextLayers',
      arguments: {},
      result: {
        success: true,
        historyStateRef: FIXTURE_HISTORY_REF,
        layers: [
          { id: 4, style: { fontSize: 48, textAlign: 'center' } },
          { id: 5, style: { fontSize: 24, textAlign: 'center' } }
        ]
      }
    },
    { name: 'quickExport', arguments: {}, result: { success: true, outputPath: 'C:/tmp/main-image.png' } },
    {
      name: 'getCanvasSnapshot',
      arguments: {},
      result: {
        success: true,
        snapshot: { base64: FIXTURE_SNAPSHOT_BASE64, width: 1000, height: 1000, format: 'jpeg' },
        documentInfo: { id: 42, name: 'adapter-fixture.psd', width: 1000, height: 1000 },
        historyStateRef: FIXTURE_HISTORY_REF
      }
    },
    {
      name: 'getDocumentInfo',
      arguments: {},
      result: {
        success: true,
        document: { id: 42, name: 'adapter-fixture.psd', width: 1000, height: 1000 },
        historyStateRef: FIXTURE_HISTORY_REF
      },
      origin: 'harness_quality_verification',
      qualityVerificationPhase: 'final_summary'
    }
  ];
  const sharedById = new Map(DESIGN_ASSERTIONS.map((assertion) => [assertion.id, assertion]));
  const vlmResults = getDesignEvaluationProfileVlmAssertions(selectedProfile)
    .map((assertion) => assertionResult(sharedById.get(assertion.id) || assertion));
  const summary = agent.buildExecutionSummary('final_response', 1, vlmResults);
  assert.strictEqual(summary.designEvaluationProfileDigest.profileId, MAIN_IMAGE_EVALUATION_PROFILE_ID);
  assert.strictEqual(summary.designEvaluationProfileDigest.missingRequiredCheckCount, 0);
  assert.ok(summary.designVerdict);
});

console.log(JSON.stringify({
  success: true,
  profiles: [
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    SKU_BATCH_EVALUATION_PROFILE_ID
  ],
  boundaries: {
    callsModel: false,
    executesTools: false,
    trustsToolSuccess: false,
    staleRecordsCanPass: false,
    ownsFinalVerdict: false
  }
}, null, 2));
