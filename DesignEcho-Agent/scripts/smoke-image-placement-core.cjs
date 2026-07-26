#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const path = require('path');

const {
  buildImagePlacementPlan,
  formatImagePlacementCorePolicyForPlanner,
  verifyImagePlacement
} = require('../src/shared/design-image-placement-core.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x7487,
    0x951B,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens ${found.join(', ')}: ${text}`);
}

function buildBaseInput(overrides = {}) {
  return {
    source: {
      width: 1600,
      height: 1200,
      path: 'C:/project/raw/product-01.jpg',
      assetId: 'asset-product-01',
      role: 'product',
      subjectBox: { x: 240, y: 160, width: 1120, height: 820 }
    },
    target: {
      box: { x: 80, y: 120, width: 640, height: 520 },
      safeBox: { x: 60, y: 100, width: 680, height: 560 },
      screenId: 'screen-hero',
      slotId: 'hero-image',
      slotRole: 'hero'
    },
    canvas: { width: 800, height: 1200 },
    designType: 'detail-page',
    assetRole: 'product',
    intent: 'hero',
    executionTool: 'replaceImagePlaceholder',
    ...overrides
  };
}

function run() {
  const readyPlan = buildImagePlacementPlan(buildBaseInput());
  assert(readyPlan.version === 'image-placement-core/v0', `unexpected version: ${readyPlan.version}`);
  assert(readyPlan.status === 'ready', `subject-bounds placement should be ready: ${JSON.stringify(readyPlan)}`);
  assert(readyPlan.inputDetail === 'subject-bounds', `expected subject-bounds input detail: ${JSON.stringify(readyPlan)}`);
  assert(readyPlan.execution.tool === 'replaceImagePlaceholder', `tool should be preserved: ${JSON.stringify(readyPlan.execution)}`);
  assert(readyPlan.execution.operation === 'replace-placeholder-and-transform', `operation should match tool: ${JSON.stringify(readyPlan.execution)}`);
  assert(readyPlan.execution.requiredReadback.includes('actualBounds'), 'actualBounds readback is required');
  assert(readyPlan.limitations.some((item) => item.includes('不是 Photoshop 执行结果')), 'plan must not claim execution');

  const fillDetailPagePlan = buildImagePlacementPlan(buildBaseInput({
    executionTool: 'fillDetailPage'
  }));
  assert(
    fillDetailPagePlan.execution.operation === 'replace-placeholder-and-transform',
    `fillDetailPage should replace placeholder and transform: ${JSON.stringify(fillDetailPagePlan.execution)}`
  );

  const transformLayerPlan = buildImagePlacementPlan(buildBaseInput({
    executionTool: 'transformLayer'
  }));
  assert(
    transformLayerPlan.execution.operation === 'transform-existing-layer',
    `transformLayer should transform existing layer: ${JSON.stringify(transformLayerPlan.execution)}`
  );

  const placeImagePlan = buildImagePlacementPlan(buildBaseInput({
    executionTool: 'placeImage'
  }));
  assert(
    placeImagePlan.execution.operation === 'place-and-transform',
    `placeImage should place and transform: ${JSON.stringify(placeImagePlan.execution)}`
  );

  const missingSubjectPlan = buildImagePlacementPlan(buildBaseInput({
    source: {
      width: 1600,
      height: 1200,
      path: 'C:/project/raw/product-02.jpg',
      assetId: 'asset-product-02',
      role: 'product'
    }
  }));
  assert(missingSubjectPlan.status === 'needs_review', `missing subjectBox should downgrade: ${JSON.stringify(missingSubjectPlan)}`);
  assert(missingSubjectPlan.inputDetail === 'metadata', `missing subjectBox should leave metadata-only input: ${JSON.stringify(missingSubjectPlan)}`);
  assert(missingSubjectPlan.warnings.some((item) => item.includes('缺少 subjectBox')), `missing subject warning expected: ${JSON.stringify(missingSubjectPlan.warnings)}`);

  const blockedPlan = buildImagePlacementPlan(buildBaseInput({
    requireSubjectBounds: true,
    source: {
      width: 1600,
      height: 1200,
      path: 'C:/project/raw/product-03.jpg',
      assetId: 'asset-product-03',
      role: 'product'
    }
  }));
  assert(blockedPlan.status === 'blocked', `requireSubjectBounds should block without subjectBox: ${JSON.stringify(blockedPlan)}`);
  assert(blockedPlan.blockers.some((item) => item.includes('subjectBox')), `subjectBox blocker expected: ${JSON.stringify(blockedPlan.blockers)}`);

  const exactVerification = verifyImagePlacement({
    plan: readyPlan,
    actualBounds: readyPlan.execution.destinationBox,
    clippingApplied: true
  });
  assert(exactVerification.status === 'passed', `exact actualBounds should pass: ${JSON.stringify(exactVerification)}`);
  assert(exactVerification.passedChecks.some((item) => item.includes('actualBounds')), `actualBounds check expected: ${JSON.stringify(exactVerification)}`);

  const missingReadback = verifyImagePlacement({ plan: readyPlan });
  assert(missingReadback.status === 'needs_review', `missing actualBounds must not pass: ${JSON.stringify(missingReadback)}`);
  assert(missingReadback.warnings.some((item) => item.includes('缺少执行后 actualBounds')), `missing readback warning expected: ${JSON.stringify(missingReadback.warnings)}`);

  const screenshotFailed = verifyImagePlacement({
    plan: readyPlan,
    actualBounds: readyPlan.execution.destinationBox,
    clippingApplied: true,
    screenshotReview: {
      available: true,
      reviewStatus: 'failed',
      reason: 'fixture screenshot review failed'
    }
  });
  assert(screenshotFailed.status === 'failed', `failed screenshot review must fail: ${JSON.stringify(screenshotFailed)}`);

  const deviatedVerification = verifyImagePlacement({
    plan: readyPlan,
    actualBounds: {
      x: readyPlan.execution.destinationBox.x + 24,
      y: readyPlan.execution.destinationBox.y,
      width: readyPlan.execution.destinationBox.width,
      height: readyPlan.execution.destinationBox.height
    }
  });
  assert(deviatedVerification.status === 'failed', `large bounds deviation should fail: ${JSON.stringify(deviatedVerification)}`);

  const policy = formatImagePlacementCorePolicyForPlanner();
  assert(policy.some((item) => item.includes('Never treat planned destinationBox')), `policy should warn about planned destinationBox: ${JSON.stringify(policy)}`);

  [
    'src/renderer/services/skill-executors/main-image.executor.ts',
    'src/renderer/services/skill-executors/detail-page.executor.ts',
    'src/renderer/services/skill-executors/sku-batch.executor.ts'
  ].forEach((relativePath) => {
    const filePath = path.join(__dirname, '..', relativePath);
    if (!fs.existsSync(filePath)) return;
    const source = fs.readFileSync(filePath, 'utf8');
    assert(!source.includes('design-image-placement-core'), `${relativePath} must not directly import Image Placement Core in MVP`);
  });

  [
    ['readyPlan', readyPlan],
    ['fillDetailPagePlan', fillDetailPagePlan],
    ['transformLayerPlan', transformLayerPlan],
    ['placeImagePlan', placeImagePlan],
    ['missingSubjectPlan', missingSubjectPlan],
    ['blockedPlan', blockedPlan],
    ['exactVerification', exactVerification],
    ['missingReadback', missingReadback],
    ['screenshotFailed', screenshotFailed],
    ['deviatedVerification', deviatedVerification],
    ['policy', policy]
  ].forEach(([label, value]) => assertNoMojibake(value, label));

  console.log(JSON.stringify({
    success: true,
    checks: [
      'subject bounds produce a ready image placement plan',
      'metadata-only image placement downgrades to needs_review',
      'requireSubjectBounds blocks unsafe placement planning',
      'planned destinationBox is not treated as Photoshop execution evidence',
      'execution tool names map to explicit operation categories',
      'actualBounds readback can pass exact geometry verification',
      'missing actualBounds cannot pass verification',
      'failed screenshot evidence overrides close bounds',
      'large post-transform deviation fails verification',
      'business skill executors are not directly wired to the MVP core',
      'policy text avoids mojibake'
    ]
  }, null, 2));
}

run();
