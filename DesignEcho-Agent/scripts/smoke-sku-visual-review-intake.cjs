#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const agentRoot = path.resolve(__dirname, '..');
const sharedPath = path.join(agentRoot, 'src', 'shared', 'sku-visual-review-intake.ts');
const executorPath = path.join(agentRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const packagePath = path.join(agentRoot, 'package.json');

const {
  buildSkuVisualReviewIntake
} = require(sharedPath);
const {
  buildSkuColorCardRetouchStrategy
} = require(path.join(agentRoot, 'src', 'shared', 'sku-color-card-retouch-strategy.ts'));
const {
  buildSkuColorCardImageProbeReview
} = require(path.join(agentRoot, 'src', 'shared', 'sku-color-card-image-probes.ts'));

function assertNoPrivatePayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'confidence',
    '置信',
    'raw-image-payload',
    'base64-image-payload',
    'data:image/',
    'C:\\project\\private',
    'D:\\DesignEchoDemo'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} leaked private payload markers: ${found.join(', ')}`);
}

const configuredPlan = {
  schema: 'sku-configured-execution-plan/v0',
  status: 'ready_configured_execution_plan',
  configFileName: '6色 2-3-4.csv',
  comboExecutionCount: 2,
  noteExecutionCount: 1,
  sizes: [
    {
      size: 2,
      comboRows: [{ colorNames: ['白色', '浅灰'] }, { colorNames: ['白色', '黑色'] }],
      noteRows: [{ colorNames: ['白色', '浅灰', '黑色'] }]
    }
  ],
  blockers: [],
  warnings: []
};

const executionManifest = [
  {
    size: 2,
    comboCount: 2,
    plannedActions: ['combo', 'self-select-note'],
    status: 'ready',
    blockers: []
  }
];

const autoLayoutDecisions = [
  {
    schema: 'sku-auto-layout-executor-policy/v0',
    action: 'execute',
    enabled: true,
    source: 'template_has_no_reliable_placeholders',
    reason: '模板证据显示没有可靠 SKU 占位符，启用无占位符自动排版。',
    boundaries: {
      writesPhotoshop: false,
      claimsDesignQuality: false,
      scorelessPolicy: true
    }
  },
  {
    schema: 'sku-auto-layout-executor-policy/v0',
    action: 'arrangeDynamic',
    enabled: true,
    source: 'template_has_no_reliable_placeholders',
    reason: '自选备注模板没有可靠 SKU 占位符，启用无占位符自动排版。',
    boundaries: {
      writesPhotoshop: false,
      claimsDesignQuality: false,
      scorelessPolicy: true
    }
  }
];

const readyReadback = {
  version: 'sku-export-readback/v0',
  status: 'ready_for_review',
  expectedExportCount: 3,
  fileProbeCount: 3,
  okFileProbeCount: 3,
  failedFileProbeCount: 0,
  missingFileProbeCount: 0,
  dimensionMismatchCount: 0,
  resultFileNames: ['1白色+浅灰.jpg', '2白色+黑色.jpg', '2双自选备注.jpg'],
  fileProbes: [
    { fileName: '1白色+浅灰.jpg', success: true, status: 'ok', rawImagesRedacted: true },
    { fileName: '2白色+黑色.jpg', success: true, status: 'ok', rawImagesRedacted: true },
    { fileName: '2双自选备注.jpg', success: true, status: 'ok', rawImagesRedacted: true }
  ],
  blockers: [],
  warnings: [],
  boundaries: {
    readonly: true,
    rawImagesRedacted: true,
    doesNotClaimDesignQuality: true,
    doesNotRunPhotoshop: true
  }
};

for (const [index, probe] of readyReadback.fileProbes.entries()) {
  probe.visualMetrics = {
    sampleSize: { width: 256, height: 256 },
    nonWhitePixelRatio: 0.28 + index * 0.01,
    nonWhiteBounds: {
      x: 0.32 + index * 0.005,
      y: 0.2,
      width: 80,
      height: 150,
      centerX: 0.48 + index * 0.005,
      centerY: 0.54,
      widthRatio: 0.31 + index * 0.005,
      heightRatio: 0.58
    },
    edgeOccupancy: { top: 0.01, right: 0.02, bottom: 0.03, left: 0.02 },
    averageLuma: 185 + index * 4,
    lumaStdDev: 34,
    darkPixelRatio: 0.04,
    highlightPixelRatio: 0.08,
    shadowLikePixelRatio: 0.22 + index * 0.01,
    textureContrastScore: 8 - index * 0.2,
    rawImagesRedacted: true
  };
}

const colorCardRetouchStrategy = buildSkuColorCardRetouchStrategy({
  userText: '需要 SKU 色卡形态统一、光影自然、阴影正片叠底复核，花边罗口不能失真',
  colorCount: 5,
  comboSizes: [2, 3, 4],
  sourceHints: ['SKU.psb', '阴影组B.png']
});
const colorCardImageProbeReview = buildSkuColorCardImageProbeReview({
  exportReadback: readyReadback,
  colorCardRetouchStrategy
});

const readyIntake = buildSkuVisualReviewIntake({
  configuredPlan,
  executionManifest,
  exportReadback: readyReadback,
  colorCardRetouchStrategy,
  colorCardImageProbeReview,
  autoLayoutDecisions,
  autoLayoutQaDiagnostics: [],
  generatedAt: '2026-05-28T10:00:00.000Z'
});

assert.strictEqual(readyIntake.version, 'sku-visual-review-intake/v0');
assert.strictEqual(readyIntake.status, 'ready_for_human_review');
assert.strictEqual(readyIntake.summary.comboExecutionCount, 2);
assert.strictEqual(readyIntake.summary.noteExecutionCount, 1);
assert.strictEqual(readyIntake.summary.expectedExportCount, 3);
assert.strictEqual(readyIntake.summary.okFileProbeCount, 3);
assert.strictEqual(readyIntake.summary.retouchStrategyStatus, 'ready_for_strategy_review');
assert(readyIntake.summary.retouchRequirementCount >= 4, 'retouch strategy requirements should be summarized');
assert.strictEqual(readyIntake.summary.imageProbeReviewStatus, 'ready_for_review');
assert.strictEqual(readyIntake.summary.imageProbeMetricCount, 3);
assert.strictEqual(readyIntake.summary.autoLayoutDecisionCount, 2);
assert.strictEqual(readyIntake.summary.autoLayoutNoPlaceholderDecisionCount, 2);
assert.strictEqual(readyIntake.summary.autoLayoutQaDiagnosticCount, 0);
assert(readyIntake.reviewSource, 'ready intake should expose a human-review source');
assert(readyIntake.retouchReview, 'ready intake should expose color-card retouch review targets');
assert(readyIntake.autoLayoutReview, 'ready intake should expose no-placeholder auto-layout visual review targets');
assert(readyIntake.imageProbeReview, 'ready intake should expose readonly image probe review');
assert.strictEqual(readyIntake.retouchReview.strategyVersion, 'sku-color-card-retouch-strategy/v0');
assert.strictEqual(readyIntake.retouchReview.required, true);
assert.strictEqual(readyIntake.autoLayoutReview.version, 'sku-auto-layout-visual-review/v0');
assert.strictEqual(readyIntake.autoLayoutReview.status, 'ready_for_visual_review');
assert.strictEqual(readyIntake.autoLayoutReview.noPlaceholderRequired, true);
assert.strictEqual(readyIntake.autoLayoutReview.comboDecisionCount, 1);
assert.strictEqual(readyIntake.autoLayoutReview.noteDecisionCount, 1);
assert.strictEqual(readyIntake.reviewSource.kind, 'sku_visual_review');
assert.strictEqual(readyIntake.canPrepareHumanReview, true);
assert.strictEqual(readyIntake.canClaimDesignQuality, false);
assert.strictEqual(readyIntake.qualityClaim.allowed, false);
assert(readyIntake.requirements.some((item) => item.includes('颜色数量')), 'review requirements should include color/count consistency');
assert(readyIntake.requirements.some((item) => item.includes('自选备注')), 'review requirements should include self-select note review');
assert(readyIntake.requirements.some((item) => item.includes('光影') || item.includes('形态')), 'review requirements should include visual quality review');
assert(readyIntake.requirements.some((item) => item.includes('无占位符自动排版') && item.includes('实际边界')), 'review requirements should include no-placeholder actual-bounds review');
assert(readyIntake.requirements.some((item) => item.includes('模板文字') && item.includes('Logo')), 'review requirements should include template obstacle/overlap review');
assert(readyIntake.requirements.some((item) => item.includes('自选备注') && item.includes('清晰可读')), 'review requirements should include self-select note layout readability');
assert(readyIntake.requirements.some((item) => item.includes('罗口') && item.includes('保真')), 'review requirements should include cuff preservation');
assert(readyIntake.requirements.some((item) => item.includes('正片叠底') || item.includes('阴影层')), 'review requirements should include multiply/shadow-layer review');
assert(readyIntake.retouchReview.shapeChecks.some((item) => item.includes('袜口')), 'retouch review should include shape checks');
assert(readyIntake.retouchReview.lightChecks.some((item) => item.includes('中性灰') || item.includes('白点')), 'retouch review should include lighting checks');
assert(readyIntake.retouchReview.shadowChecks.some((item) => item.includes('正片叠底') || item.includes('阴影')), 'retouch review should include shadow checks');
assert(readyIntake.retouchReview.boundaries.some((item) => item.includes('不执行 Photoshop')), 'retouch review should keep no-Photoshop boundary');
assert(readyIntake.requirements.some((item) => item.includes('轮廓探针')), 'review requirements should include contour probe review');
assert(readyIntake.requirements.some((item) => item.includes('纹理探针')), 'review requirements should include texture probe review');
assertNoPrivatePayload(readyIntake, 'ready visual review intake');

const blockedReadbackIntake = buildSkuVisualReviewIntake({
  configuredPlan,
  executionManifest,
  exportReadback: {
    ...readyReadback,
    status: 'blocked',
    failedFileProbeCount: 1,
    blockers: ['导出文件尺寸不符合预期 1 个：C:\\project\\private\\bad.jpg']
  },
  colorCardRetouchStrategy,
  colorCardImageProbeReview
});
assert.strictEqual(blockedReadbackIntake.status, 'blocked_export_readback');
assert(blockedReadbackIntake.blockers.some((item) => item.includes('导出读回')), 'blocked readback should explain the blocking layer');
assertNoPrivatePayload(blockedReadbackIntake, 'blocked visual review intake');

const blockedAutoLayoutIntake = buildSkuVisualReviewIntake({
  configuredPlan,
  executionManifest,
  exportReadback: readyReadback,
  colorCardRetouchStrategy,
  colorCardImageProbeReview,
  autoLayoutDecisions,
  autoLayoutQaDiagnostics: [
    '2双批次 1/1 自动排版执行后校验: SKU 图层 "白色" 与 "浅灰" 执行后互相重叠或间距不足。',
    '2双自选备注批次 1/1 自动排版执行后校验: SKU 图层 "黑色" 执行后遮挡模板元素 "价格角标"。',
    '2双自选备注批次 1/1 自动排版执行后校验: Photoshop 实际边界需要复核。'
  ]
});
assert.strictEqual(blockedAutoLayoutIntake.status, 'blocked_auto_layout_qa');
assert.strictEqual(blockedAutoLayoutIntake.statusLabel, '自动排版校验未通过');
assert.strictEqual(blockedAutoLayoutIntake.canPrepareHumanReview, false);
assert.strictEqual(blockedAutoLayoutIntake.summary.autoLayoutQaDiagnosticCount, 3);
assert.strictEqual(blockedAutoLayoutIntake.summary.autoLayoutQaBlockerCount, 2);
assert.strictEqual(blockedAutoLayoutIntake.summary.autoLayoutQaWarningCount, 1);
assert.strictEqual(blockedAutoLayoutIntake.autoLayoutReview.status, 'blocked_actual_bounds_qa');
assert(blockedAutoLayoutIntake.blockers.some((item) => item.includes('自动排版实际边界校验未通过')), 'blocked auto-layout should explain the blocking layer');
assert(blockedAutoLayoutIntake.blockers.some((item) => item.includes('互相重叠') || item.includes('遮挡模板元素')), 'blocked auto-layout should include geometry blocker');
assert(blockedAutoLayoutIntake.warnings.some((item) => item.includes('实际边界需要复核')), 'non-blocking QA diagnostics should remain warnings');
assertNoPrivatePayload(blockedAutoLayoutIntake, 'blocked auto-layout visual review intake');

const approvedIntake = buildSkuVisualReviewIntake({
  configuredPlan,
  executionManifest,
  exportReadback: readyReadback,
  colorCardRetouchStrategy,
  colorCardImageProbeReview,
  autoLayoutDecisions,
  humanReview: {
    decision: 'approved',
    reviewer: 'designer-a',
    score: 0.92,
    notes: '形态统一，光影自然；来自 D:\\DesignEchoDemo\\C-1163\\private.jpg'
  }
});
assert.strictEqual(approvedIntake.status, 'human_review_recorded');
assert.strictEqual(approvedIntake.humanReview?.decision, 'approved');
assert.strictEqual(approvedIntake.humanReview?.score, 0.92);
assert.strictEqual(approvedIntake.canPrepareHumanReview, false);
assert.strictEqual(approvedIntake.canClaimDesignQuality, false);
assert.strictEqual(approvedIntake.qualityClaim.allowed, false);
assert(approvedIntake.qualityClaim.reason.includes('最终业务验收'), 'approved review must not be upgraded into final quality claim');
assertNoPrivatePayload(approvedIntake, 'approved visual review intake');

const missingReadbackIntake = buildSkuVisualReviewIntake({
  configuredPlan,
  executionManifest,
  colorCardRetouchStrategy
});
assert.strictEqual(missingReadbackIntake.status, 'blocked_missing_export_readback');
assert(missingReadbackIntake.blockers.some((item) => item.includes('skuExportReadback')), 'missing readback should name the missing evidence');

const executorSource = fs.readFileSync(executorPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
assert(executorSource.includes('buildSkuVisualReviewIntake'), 'SKU executor should build sku visual review intake after export readback');
assert(executorSource.includes('skuVisualReviewIntake'), 'SKU result data should expose skuVisualReviewIntake');
assert(
  /buildSkuVisualReviewIntake\([\s\S]{0,500}colorCardRetouchStrategy:\s*designPlanner\.skuColorCardRetouchStrategy/.test(executorSource),
  'SKU executor should pass skuColorCardRetouchStrategy into visual review intake'
);
assert(
  /buildSkuVisualReviewIntake\([\s\S]{0,800}autoLayoutDecisions:\s*skuAutoLayoutDecisions/.test(executorSource),
  'SKU executor should pass no-placeholder auto-layout decisions into visual review intake'
);
assert(
  /buildSkuVisualReviewIntake\([\s\S]{0,900}autoLayoutQaDiagnostics:\s*skuAutoLayoutQaDiagnostics/.test(executorSource),
  'SKU executor should pass post-execution autoLayoutQa diagnostics into visual review intake'
);
assert(executorSource.includes('buildSkuColorCardImageProbeReview'), 'SKU executor should build readonly SKU color card image probe review');
assert(executorSource.includes('skuColorCardImageProbeReview'), 'SKU executor should expose skuColorCardImageProbeReview result data');
assert(packageJson.scripts['smoke:sku:visual-review-intake'], 'package.json should expose smoke:sku:visual-review-intake');
assert(
  packageJson.scripts['maintenance:preflight'].includes('smoke:sku:visual-review-intake'),
  'maintenance preflight should include SKU visual review intake smoke'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'SKU visual review intake converts configured execution and export readback into a human-review-ready source',
    'SKU visual review intake blocks missing or failed export readback instead of claiming design quality',
    'approved human review is recorded as review input but still not a final design-quality claim',
    'SKU color-card retouch strategy becomes explicit shape, lighting, shadow and cuff-preservation review targets',
    'SKU no-placeholder auto-layout decisions and post-execution QA diagnostics become explicit visual review targets',
    'SKU visual review intake blocks failed actual-bounds/overlap/obstacle QA before human-review preparation',
    'SKU visual review intake redacts paths/raw payload markers and exposes no confidence fields',
    'SKU executor exposes skuVisualReviewIntake result data and package maintenance runs the smoke'
  ]
}, null, 2));
