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
  buildMainImageVisualUnderstanding,
  buildMainImageVisualUnderstandingContract,
  buildMainImageVisualVerification,
  buildMainImageScreenshotObservationFromSizePlans,
  evaluateMainImageVisualContext
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-visual-loop.ts'));
const {
  selectMainImageAssetCandidate
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-asset-selection.ts'));
const {
  buildMainImageAgentDraftPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-agent-draft-plan.ts'));

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
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function assertNoUnsupportedConfidence(text, label) {
  assert(!text.includes('confidence'), `${label} should not expose unsupported confidence`);
  assert(!text.includes('置信'), `${label} should not expose unsupported confidence wording`);
}

const cases = [];

function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

const selectedAsset = selectMainImageAssetCandidate({
  userText: '用项目里的袜子图片做主图',
  projectAssets: [{
    path: 'C:/project/assets/商品袜子01.jpg',
    name: '商品袜子01.jpg',
    width: 1200,
    height: 1200,
    role: 'selected-project-image',
    source: 'selected-project-image'
  }]
});

const sizePlans = [{
  sizeKey: '800',
  targetSize: { width: 800, height: 800 },
  subjectSize: { width: 620, height: 720 },
  scale: 0.72,
  targetX: 130,
  targetY: 90,
  decisionReason: '主图 guideline scale 72%',
  smartLayoutPlanned: true,
  quickExportPlanned: false
}];

const subjectBounds = { left: 120, top: 100, right: 740, bottom: 820, width: 620, height: 720 };

record('metadata-only-needs-vision-not-visual-claim', () => {
  const visual = buildMainImageVisualUnderstanding({
    assetSelection: selectedAsset,
    subjectBounds,
    sizePlans
  });
  assert(visual.readiness === 'needs_vision', `unexpected readiness ${visual.readiness}`);
  assert(visual.source === 'metadata-only', `unexpected source ${visual.source}`);
  assert(visual.productIdentity.label === 'unknown', 'metadata-only must not invent product identity');
  assert(visual.warnings.some((item) => item.includes('没有与所选素材关联')), 'missing vision warning');
  assert(visual.limitations.some((item) => item.includes('metadata-only')), 'missing metadata-only boundary');
  return {
    source: visual.source,
    readiness: visual.readiness,
    product: visual.productIdentity.label
  };
});

record('visual-context-requires-asset-binding-and-usable-fields', () => {
  const selected = selectedAsset.selectedAsset;
  const mismatch = evaluateMainImageVisualContext({
    source: 'vision-model',
    assetRef: { path: 'C:/project/assets/other.jpg' },
    productType: '堆堆袜',
    subjectSummary: '其他素材的分析结果'
  }, selected);
  assert(mismatch.readiness === 'asset_mismatch', `unexpected mismatch status ${mismatch.readiness}`);

  const insufficient = evaluateMainImageVisualContext({
    source: 'vision-model',
    assetRef: { path: 'C:/project/assets/商品袜子01.jpg' },
    productType: 'unknown',
    styleHints: ['clean']
  }, selected);
  assert(insufficient.readiness === 'insufficient', `unexpected insufficient status ${insufficient.readiness}`);
  assert(insufficient.usableFields.length === 1, 'one usable field must not be enough for visual context readiness');
  return { mismatch: mismatch.readiness, insufficient: insufficient.readiness };
});

record('vision-signal-becomes-reviewable-understanding', () => {
  const visual = buildMainImageVisualUnderstanding({
    assetSelection: selectedAsset,
    subjectBounds,
    sizePlans,
    visionSignal: {
      source: 'vision-model',
      assetRef: { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '浅色袜子主体，横向展示。',
      backgroundSummary: '干净浅色背景。',
      sourceNotes: ['provider returned structured product summary']
    }
  });
  assert(visual.readiness === 'ready', `unexpected readiness ${visual.readiness}`);
  assert(visual.source === 'vision-model', `unexpected source ${visual.source}`);
  assert(visual.productIdentity.label === '堆堆袜', 'vision product label should be preserved');
  assert(visual.productIdentity.source === 'vision-model', 'visual source should be explicit');
  assert(visual.mainImageFit.status === 'candidate', `unexpected fit ${visual.mainImageFit.status}`);
  assert(visual.mainImageFit.sourceLevel === 'visual-and-bounds', `unexpected source level ${visual.mainImageFit.sourceLevel}`);
  assertNoUnsupportedConfidence(JSON.stringify(visual), 'visual understanding');
  return {
    source: visual.source,
    readiness: visual.readiness,
    product: visual.productIdentity.label,
    fit: visual.mainImageFit.status,
    sourceLevel: visual.mainImageFit.sourceLevel
  };
});

record('visual-contract-maps-to-design-agent-os-shape', () => {
  const contract = buildMainImageVisualUnderstandingContract({
    assetSelection: selectedAsset,
    subjectBounds,
    sizePlans,
    visionSignal: {
      source: 'vision-model',
      assetRef: { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '袜子主体',
      backgroundSummary: '浅色背景'
    }
  });
  assert(contract.layoutType === 'main-image-visual-loop', 'contract layoutType mismatch');
  assert(contract.canvas.width === 800 && contract.canvas.height === 800, 'contract canvas should come from size plan');
  assert(contract.roleCounts['hero-subject'] === 1, 'contract should expose subject role');
  assert(contract.limitations.some((item) => item.includes('截图')), 'contract must keep screenshot boundary');
  return {
    canvas: contract.canvas,
    roles: contract.primaryRoles
  };
});

record('missing-screenshot-blocks-design-quality-claim', () => {
  const verification = buildMainImageVisualVerification({
    assetSelection: selectedAsset,
    subjectBounds,
    sizePlans,
    visionSignal: {
      source: 'vision-model',
      assetRef: { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '袜子主体',
      backgroundSummary: '浅色背景'
    }
  });
  assert(verification.stage === 'needs_screenshot', `unexpected stage ${verification.stage}`);
  assert(verification.status === 'not_run', `unexpected status ${verification.status}`);
  assert(verification.verificationReport.status !== 'passed', 'missing screenshot must not pass');
  assert(verification.warnings.some((item) => item.includes('缺少结果截图')), 'missing screenshot warning absent');
  return {
    stage: verification.stage,
    status: verification.status,
    summary: verification.verificationReport.summary
  };
});

record('screenshot-without-manual-review-still-needs-review', () => {
  const verification = buildMainImageVisualVerification({
    assetSelection: selectedAsset,
    subjectBounds,
    sizePlans,
    visionSignal: {
      source: 'vision-model',
      assetRef: { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '袜子主体',
      backgroundSummary: '浅色背景'
    },
    screenshotObservation: {
      source: 'quickExport',
      hasImage: true,
      resultPath: 'C:/project/exports/main-image-800.png',
      redacted: true
    }
  });
  assert(verification.stage === 'needs_manual_review', `unexpected stage ${verification.stage}`);
  assert(verification.status === 'needs_review', `unexpected status ${verification.status}`);
  assert(verification.verificationReport.scope === 'screenshot', 'screenshot context should set screenshot scope');
  return {
    stage: verification.stage,
    status: verification.status
  };
});

record('quick-export-output-path-becomes-screenshot-context', () => {
  const exportedPlans = [{
    ...sizePlans[0],
    quickExportPlanned: true,
    quickExportOutputPath: 'C:/project/exports/main-image-800.png'
  }];
  const screenshot = buildMainImageScreenshotObservationFromSizePlans(exportedPlans);
  assert(screenshot && screenshot.hasImage === true, 'quick export path should become screenshot context');
  assert(screenshot.resultPath.endsWith('main-image-800.png'), 'quick export path should be preserved');
  const plan = buildMainImageAgentDraftPlan({
    userText: '帮我用项目袜子图做主图',
    projectAssets: [{
      path: 'C:/project/assets/商品袜子01.jpg',
      name: '商品袜子01.jpg',
      width: 1200,
      height: 1200,
      role: 'selected-project-image',
      source: 'selected-project-image'
    }],
    subjectBounds,
    sizePlans: exportedPlans,
    copyCandidates: ['轻薄透气，春夏出行更自在'],
    visionSignal: {
      source: 'vision-model',
      assetRef: { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '袜子主体',
      backgroundSummary: '浅色背景'
    },
    toolNames: ['getDocumentInfo', 'getSubjectBounds', 'smartLayout[800]', 'quickExport[800]']
  });
  assert(plan.visualVerification.stage === 'needs_manual_review', `unexpected stage ${plan.visualVerification.stage}`);
  assert(plan.visualVerification.status === 'needs_review', `unexpected status ${plan.visualVerification.status}`);
  return {
    resultPath: screenshot.resultPath,
    stage: plan.visualVerification.stage
  };
});

record('approved-screenshot-is-the-only-passed-path', () => {
  const verification = buildMainImageVisualVerification({
    assetSelection: selectedAsset,
    subjectBounds,
    sizePlans,
    visionSignal: {
      source: 'vision-model',
      assetRef: { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '袜子主体',
      backgroundSummary: '浅色背景'
    },
    screenshotObservation: {
      source: 'quickExport',
      hasImage: true,
      resultPath: 'C:/project/exports/main-image-800.png',
      redacted: true
    },
    manualReview: {
      decision: 'approved',
      score: 82,
      reviewer: 'smoke'
    }
  });
  assert(verification.stage === 'passed', `unexpected stage ${verification.stage}`);
  assert(verification.status === 'passed', `unexpected status ${verification.status}`);
  assert(verification.verificationReport.status === 'passed', 'approved screenshot should pass');
  return {
    stage: verification.stage,
    status: verification.status
  };
});

record('agent-draft-exposes-visual-loop-without-changing-execution', () => {
  const plan = buildMainImageAgentDraftPlan({
    userText: '帮我用项目袜子图做主图',
    projectAssets: [{
      path: 'C:/project/assets/商品袜子01.jpg',
      name: '商品袜子01.jpg',
      width: 1200,
      height: 1200,
      role: 'selected-project-image',
      source: 'selected-project-image'
    }],
    subjectBounds,
    sizePlans,
    copyCandidates: ['轻薄透气，春夏出行更自在'],
    toolNames: ['getDocumentInfo', 'getSubjectBounds', 'smartLayout[800]']
  });
  assert(plan.assetVisualUnderstanding.readiness === 'needs_vision', 'draft should expose needs_vision before model vision');
  assert(plan.visualVerification.stage === 'needs_screenshot', 'draft should expose screenshot blocker');
  assert(plan.executionPlan.steps.some((step) => step.operation === 'verifyDesignResult'), 'execution plan should remain intact');
  const text = JSON.stringify(plan, null, 2);
  assertIncludes(text, '不能声明主图设计质量通过', 'draft should preserve no-overclaim boundary');
  return {
    readiness: plan.readiness,
    visualReadiness: plan.assetVisualUnderstanding.readiness,
    visualStage: plan.visualVerification.stage
  };
});

record('source-and-output-have-no-mojibake', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'shared', 'main-image-visual-loop.ts'), 'utf8');
  const output = JSON.stringify(buildMainImageVisualUnderstanding({
    assetSelection: selectedAsset,
    subjectBounds,
    sizePlans
  }), null, 2);
  assertNoMojibake(source, 'main-image-visual-loop.ts');
  assertNoMojibake(output, 'main-image-visual-loop output');
  assertNoUnsupportedConfidence(source, 'main-image-visual-loop.ts');
  assertNoUnsupportedConfidence(output, 'main-image-visual-loop output');
  return {
    sourceLength: source.length,
    outputLength: output.length
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-visual-loop-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-visual-loop-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image Visual Loop Smoke',
  '',
  `success: ${report.success}`,
  '',
  ...cases.map((item) => `- ${item.name}: ${item.status}`)
].join('\n'), 'utf8');

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status, error }) => ({ name, status, error })),
  report: { json: jsonPath, md: mdPath }
}, null, 2));

process.exit(report.success ? 0 : 1);
