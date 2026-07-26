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
  buildMainImageVisionPreflightResult,
  buildMainImageVisionPreflightPlan,
  isMainImageVisionPreflightEnabled,
  mapMainImageAssetAnalysisToVisionSignal
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-vision-preflight.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(value, needle, message) {
  assert(String(value || '').includes(needle), message || `Expected ${JSON.stringify(value)} to include ${needle}`);
}

function assertNoMojibake(text, label) {
  const signals = [
    0x9359,
    0x7487,
    0x93c2,
    0x7f01,
    0xfffd,
    0x20ac
  ].map((codePoint) => String.fromCodePoint(codePoint));
  for (const signal of signals) {
    assert(!String(text).includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function assertNoUnsupportedConfidence(text, label) {
  assert(!String(text).includes('confidence'), `${label} should not expose unsupported confidence`);
  assert(!String(text).includes('置信'), `${label} should not expose unsupported confidence wording`);
}

const cases = [];
function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

record('disabled-does-not-call-vision-model', () => {
  const plan = buildMainImageVisionPreflightPlan({
    enabled: false,
    selectedAssetPath: 'C:/project/images/sock.jpg',
    hasAnalyzer: true
  });
  assert(plan.status === 'disabled', 'disabled plan should stay disabled');
  assert(plan.shouldCallAnalyzer === false, 'disabled plan must not call analyzer');
  assertIncludes(plan.reason, '未显式启用', 'disabled reason should be explicit');
  return { status: plan.status, shouldCallAnalyzer: plan.shouldCallAnalyzer };
});

record('string-auto-enables-preflight', () => {
  assert(isMainImageVisionPreflightEnabled('auto') === true, 'auto should enable preflight');
  assert(isMainImageVisionPreflightEnabled('false') === false, 'false string should not enable preflight');
  return { auto: true };
});

record('enabled-without-asset-is-skipped-not-faked', () => {
  const plan = buildMainImageVisionPreflightPlan({ enabled: true, selectedAssetPath: '', hasAnalyzer: true });
  assert(plan.status === 'skipped_no_asset', 'missing asset should skip');
  assert(plan.shouldCallAnalyzer === false, 'missing asset must not call analyzer');
  assert(plan.warnings.some((item) => item.includes('缺少 selectedProjectImagePath')), 'missing warning absent');
  return { status: plan.status, warnings: plan.warnings };
});

record('enabled-without-analyzer-is-blocked-not-faked', () => {
  const plan = buildMainImageVisionPreflightPlan({
    enabled: true,
    selectedAssetPath: 'C:/project/images/sock.jpg',
    hasAnalyzer: false
  });
  assert(plan.status === 'blocked_no_analyzer', 'missing analyzer should block');
  assert(plan.shouldCallAnalyzer === false, 'missing analyzer must not call');
  return { status: plan.status, reason: plan.reason };
});

record('successful-analysis-maps-to-vision-signal', () => {
  const signal = mapMainImageAssetAnalysisToVisionSignal({
    success: true,
    analysis: {
      description: '浅色堆堆袜脚模图',
      category: 'product_main',
      mainSubject: '堆堆袜',
      colors: ['#F2F0E8', '#C6B9A4'],
      style: '清爽自然',
      suggestedPlacement: 'hero image',
      suggestedEffects: ['direct_use', 'color_tuning']
    }
  }, { path: 'C:/project/images/sock.jpg', name: 'sock.jpg' });
  assert(signal, 'signal should exist');
  assert(signal.source === 'vision-model', 'source mismatch');
  assert(signal.assetRef.path === 'C:/project/images/sock.jpg', 'asset binding mismatch');
  assert(signal.productType === '堆堆袜', 'product type mismatch');
  assert(signal.sourceNotes.some((item) => item.includes('mainSubject=堆堆袜')), 'source notes missing subject');
  assertNoUnsupportedConfidence(JSON.stringify(signal), 'vision signal');
  return { productType: signal.productType, sourceNoteCount: signal.sourceNotes.length };
});

record('failed-analysis-does-not-create-vision-signal', () => {
  const plan = buildMainImageVisionPreflightPlan({
    enabled: true,
    selectedAssetPath: 'C:/project/images/sock.jpg',
    hasAnalyzer: true
  });
  const result = buildMainImageVisionPreflightResult({
    plan,
    result: { success: false, error: 'quota exceeded' }
  });
  assert(result.resultStatus === 'failed', 'failed result should be failed');
  assert(!result.visionSignal, 'failed result must not create signal');
  assertIncludes(result.error, 'quota exceeded', 'error should be preserved');
  return { resultStatus: result.resultStatus, error: result.error };
});

record('executor-and-skill-declaration-are-wired', () => {
  const executor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
  const plannerContext = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/design-planner-context.ts'), 'utf8');
  const declarations = fs.readFileSync(path.join(repoRoot, 'src/shared/skills/skill-declarations.ts'), 'utf8');
  assertIncludes(executor, 'analyzeAssetContent[main-image-controlled-product]', 'executor missing controlled visual analysis tool record');
  assertIncludes(executor, 'mainImageVisionPreflight', 'executor missing data exposure');
  assertIncludes(plannerContext, 'visionSignal: input.visionSignal', 'planner context does not pass visionSignal');
  assertIncludes(declarations, 'enableVisionPreflight', 'main image skill missing explicit param');
  return { wired: true };
});

record('source-and-output-have-no-mojibake', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/shared/main-image-vision-preflight.ts'), 'utf8');
  const result = buildMainImageVisionPreflightResult({
    plan: buildMainImageVisionPreflightPlan({
      enabled: 'auto',
      selectedAssetPath: 'C:/project/images/sock.jpg',
      hasAnalyzer: true
    }),
    result: {
      success: true,
      analysis: {
        description: '浅色堆堆袜脚模图',
        category: 'product_main',
        mainSubject: '堆堆袜',
        colors: ['#F2F0E8'],
        style: '清爽自然'
      }
    }
  });
  assertNoMojibake(source, 'main-image-vision-preflight.ts');
  assertNoMojibake(JSON.stringify(result, null, 2), 'preflight result');
  assertNoUnsupportedConfidence(source, 'main-image-vision-preflight.ts');
  assertNoUnsupportedConfidence(JSON.stringify(result, null, 2), 'preflight result');
  return { sourceLength: source.length, status: result.status };
});

const report = {
  generatedAt: new Date().toISOString(),
  success: cases.every((item) => item.status === 'pass'),
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-vision-preflight-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-vision-preflight-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(mdPath, [
  '# Main Image Vision Preflight Smoke',
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
