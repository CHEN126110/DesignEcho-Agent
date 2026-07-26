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

const cases = [];

function record(name, fn) {
  try {
    const details = fn();
    cases.push({ name, status: 'pass', details });
  } catch (error) {
    cases.push({
      name,
      status: 'fail',
      error: error && error.message ? error.message : String(error)
    });
  }
}

const readyInput = {
  userText: '帮我做一张袜子主图草案',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  subjectBounds: { left: 180, top: 160, right: 930, bottom: 980, width: 750, height: 820 },
  sizePlans: [{
    sizeKey: '800',
    targetSize: { width: 800, height: 800 },
    subjectSize: { width: 750, height: 820 },
    scale: 0.68,
    targetX: 112,
    targetY: 96,
    decisionReason: '主图 guideline scale 68%',
    layoutCandidateScore: 83,
    layoutCandidateReason: '主体居中且留出标题区',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  }],
  copyCandidates: ['轻薄透气，春夏出行更自在'],
  outputDir: 'C:\\Exports',
  toolNames: ['getDocumentInfo', 'getSubjectBounds', 'smartLayout[800]', 'quickExport[800]'],
  critique: { beforeScore: 70, afterScore: 82, delta: 12 }
};

record('ready-plan-has-agent-control-shape', () => {
  const plan = buildMainImageAgentDraftPlan(readyInput);
  assert(plan.planVersion === 'main-image-agent-draft/v0', 'planVersion mismatch');
  assert(plan.scenario === 'main-image', 'scenario mismatch');
  assert(plan.readiness === 'ready', 'ready input should be ready');
  assert(plan.designDsl.regions.some((region) => region.id === 'hero-subject-slot'), 'missing hero subject slot');
  assert(plan.executionPlan.steps.some((step) => step.operation === 'selectMainImageAsset'), 'missing asset selection step');
  assert(plan.executionPlan.steps.some((step) => step.operation === 'detectSubjectBounds'), 'missing subject detection step');
  assert(plan.executionPlan.steps.some((step) => step.operation === 'verifyDesignResult'), 'missing verification step');
  assert(plan.verificationReport.status === 'needs_review', 'ready plan must still require review');
  assert(plan.assetSelection && plan.assetSelection.preflightGate === 'pass', 'ready plan should include passing asset selection gate');
  assert(plan.assetSelection.selectionMode === 'active-document-fallback', 'ready fixture should use active document fallback asset selection');
  assert(plan.selectedAssetStrategy.mode === 'active-document-layer', 'expected active document asset strategy');
  assert(plan.assetVisualUnderstanding && plan.assetVisualUnderstanding.readiness === 'needs_vision', 'ready fixture should still need real vision context');
  assert(plan.visualVerification && plan.visualVerification.stage === 'needs_screenshot', 'ready fixture should still need screenshot context');
  return {
    readiness: plan.readiness,
    assetGate: plan.assetSelection.preflightGate,
    visualReadiness: plan.assetVisualUnderstanding.readiness,
    visualVerificationStage: plan.visualVerification.stage,
    stepCount: plan.executionPlan.steps.length,
    regionIds: plan.designDsl.regions.map((region) => region.id)
  };
});

record('missing-context-does-not-invent-assets-or-copy', () => {
  const plan = buildMainImageAgentDraftPlan({ userText: '帮我做一张主图' });
  assert(plan.readiness === 'needs_context', 'missing context should need context');
  assert(plan.assetSelection && plan.assetSelection.selectionMode === 'missing', 'missing context should include missing assetSelection');
  assert(plan.assetSelection.preflightGate === 'needs_input', 'missing context should need asset input');
  assert(plan.selectedAssetStrategy.mode === 'missing', 'missing context should not invent asset');
  assert(plan.assetVisualUnderstanding.readiness === 'needs_asset', 'missing context should need asset before vision');
  assert(plan.copyStrategy.needsCopyContext === true, 'missing copy should need context');
  assert(plan.warnings.some((item) => item.includes('缺少当前文档')), 'missing asset warning absent');
  assert(plan.warnings.some((item) => item.includes('不要编造商品卖点')), 'copy warning absent');
  return {
    readiness: plan.readiness,
    assetGate: plan.assetSelection.preflightGate,
    assetMode: plan.selectedAssetStrategy.mode,
    warningCount: plan.warnings.length
  };
});

record('selected-project-image-is-context-not-vision-claim', () => {
  const plan = buildMainImageAgentDraftPlan({
    userText: '帮我用项目里的袜子图做主图',
    projectAssets: [
      { path: 'C:/project/assets/参考图.png', name: '参考图.png', role: 'project-image' },
      { path: 'C:/project/assets/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'selected-project-image', source: 'selected-project-image' }
    ],
    subjectBounds: { left: 80, top: 90, right: 500, bottom: 620, width: 420, height: 530 },
    sizePlans: readyInput.sizePlans,
    copyCandidates: readyInput.copyCandidates
  });
  assert(plan.assetSelection.selectionMode === 'selected-project-image', 'selected project image should be selected');
  assert(plan.selectedAssetStrategy.mode === 'project-asset-candidate', 'selected project image should map to project asset strategy');
  assert(plan.assetSelection.limitations.some((item) => item.includes('不做真实视觉审美判断')), 'asset selection must not claim visual judgement');
  assert(plan.assetVisualUnderstanding.source === 'metadata-only', 'selected project image should remain metadata-only until vision context exists');
  assert(plan.assetVisualUnderstanding.productIdentity.label === 'unknown', 'selected project image must not invent product type');
  assert(plan.verificationReport.status !== 'passed', 'selected project image still needs review');
  return {
    readiness: plan.readiness,
    selectionMode: plan.assetSelection.selectionMode,
    selected: plan.assetSelection.selectedAsset && plan.assetSelection.selectedAsset.name
  };
});

record('blocked-invalid-target-size-stays-safe', () => {
  const plan = buildMainImageAgentDraftPlan({
    userText: '做主图',
    targetSizes: [{ key: 'bad', width: 0, height: 0 }],
    currentDocument: { name: 'active.psd', width: 1000, height: 1000 },
    subjectBounds: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }
  });
  // Invalid explicit target falls back to 800x800, but missing sizePlans keeps it out of executed claims.
  assert(plan.readiness === 'needs_context', 'invalid explicit size should not create an executed claim');
  assert(plan.executionPlan.status === 'planned', 'plan should remain planned');
  assert(plan.verificationReport.status !== 'passed', 'verification must not pass without execution context');
  return {
    readiness: plan.readiness,
    outputSpec: plan.brief.outputSpec,
    verificationStatus: plan.verificationReport.status
  };
});

record('no-overclaim-without-screenshot-or-manual-review', () => {
  const plan = buildMainImageAgentDraftPlan(readyInput);
  const text = JSON.stringify(plan, null, 2);
  assert(plan.verificationReport.status !== 'passed', 'plan should not claim passed design quality');
  assertIncludes(text, '不能声明自动主图设计闭环完成', 'missing no-overclaim limitation');
  assertIncludes(text, '不能声明主图设计质量通过', 'missing visual verification no-overclaim limitation');
  assertIncludes(text, '不是完整自动设计能力完成证明', 'missing capability boundary');
  return {
    verificationStatus: plan.verificationReport.status,
    limitations: plan.limitations
  };
});

record('quick-export-path-shifts-to-manual-review-not-passed', () => {
  const plan = buildMainImageAgentDraftPlan({
    ...readyInput,
    sizePlans: [{
      ...readyInput.sizePlans[0],
      quickExportOutputPath: 'C:/Exports/main-image-800.jpg'
    }],
    visionSignal: {
      source: 'vision-model',
      assetRef: { id: '1', name: 'SKU.psb' },
      productType: '堆堆袜',
      subjectSummary: '袜子主体',
      backgroundSummary: '白底主图',
      confidence: 0.7
    }
  });
  assert(plan.assetVisualUnderstanding.readiness === 'ready', 'vision signal should make visual understanding ready');
  assert(plan.visualVerification.stage === 'needs_manual_review', 'quick export path should still require manual review');
  assert(plan.visualVerification.status === 'needs_review', 'quick export path alone must not pass design quality');
  return {
    visualReadiness: plan.assetVisualUnderstanding.readiness,
    visualStage: plan.visualVerification.stage,
    visualStatus: plan.visualVerification.status
  };
});

record('source-text-has-no-mojibake', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'shared', 'main-image-agent-draft-plan.ts'), 'utf8');
  const reportText = JSON.stringify(buildMainImageAgentDraftPlan(readyInput), null, 2);
  assertNoMojibake(source, 'main-image-agent-draft-plan.ts');
  assertNoMojibake(reportText, 'main-image-agent-draft-plan output');
  return { sourceLength: source.length, outputLength: reportText.length };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-agent-draft-plan-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-agent-draft-plan-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image Agent Draft Plan Smoke',
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
