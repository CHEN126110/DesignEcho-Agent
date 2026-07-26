#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include ${needle}`);
}

function assertNoMojibake(text, label) {
  const suspiciousTokens = [
    0x93b4,
    0x93c9,
    0x951b,
    0x95c8,
    0xfffd
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

function assertOrder(text, before, after, label) {
  const beforeIndex = text.indexOf(before);
  const afterIndex = text.indexOf(after);
  assert(beforeIndex >= 0, `${label} missing ${before}`);
  assert(afterIndex >= 0, `${label} missing ${after}`);
  assert(beforeIndex < afterIndex, `${label} expected ${before} before ${after}`);
}

const helper = read('src/renderer/services/skill-executors/design-planner-context.ts');
const layout = read('src/renderer/services/skill-executors/layout-replication.executor.ts');
const mainImage = read('src/renderer/services/skill-executors/main-image.executor.ts');
const detail = read('src/renderer/services/skill-executors/detail-page.executor.ts');
const detailSkill = read('src/renderer/services/design-skills/detail-page-design.skill.ts');
const sku = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
const designAgentOsContracts = read('src/shared/design-agent-os-contracts.ts');
const packageJson = JSON.parse(read('package.json'));

[
  'buildReferenceReplicationPlannerContext',
  'buildMainImagePlannerContext',
  'buildDetailPagePlannerContext',
  'buildSkuBatchPlannerContext',
  'buildPlannerExecutionPreflightGate',
  'comparePlannerExecutionPlanToExecutor'
].forEach((name) => assertIncludes(helper, `export function ${name}`, 'design-planner-context.ts'));

assertIncludes(helper, 'executionMode: \'plan-only\'', 'design-planner-context.ts');
assertIncludes(helper, 'Planner context is read-only and must not change Photoshop execution parameters.', 'design-planner-context.ts');
assertIncludes(helper, 'missingCategories', 'design-planner-context.ts');
assertIncludes(helper, 'Aligned categories are not a substitute for screenshot, bounds, or manual acceptance.', 'design-planner-context.ts');
assertIncludes(helper, 'buildMainImageAgentDraftPlan', 'design-planner-context.ts');
assertIncludes(helper, 'buildBusinessSkillMemoryContextForSkill', 'design-planner-context.ts');
assertIncludes(helper, 'buildDesignIntelligencePlan', 'design-planner-context.ts');
assertIncludes(helper, 'extractDesignIntelligenceAgentDecision', 'design-planner-context.ts');
assertIncludes(helper, 'designIntelligencePlan', 'design-planner-context.ts');
assertIncludes(helper, 'businessSkillMemoryContext', 'design-planner-context.ts');
assertIncludes(helper, 'mainImageAgentDraft', 'design-planner-context.ts');
assertIncludes(helper, 'businessSkillDesignPlacementIntelligence', 'design-planner-context.ts');
assertIncludes(helper, 'detailPageDesignPlacementIntelligence', 'design-planner-context.ts');
assertIncludes(helper, 'skuDesignPlacementIntelligence', 'design-planner-context.ts');
assertIncludes(helper, 'selected-project-image', 'design-planner-context.ts');
assertIncludes(helper, 'visionSignal: input.visionSignal', 'design-planner-context.ts');
assertIncludes(helper, 'agentDecision: extractDesignIntelligenceAgentDecision(input.params)', 'design-planner-context.ts');
assertIncludes(helper, 'memoryContext: mainImageMemoryContext', 'design-planner-context.ts');
assertIncludes(helper, 'memoryContext: businessSkillMemoryContext', 'design-planner-context.ts');

assertIncludes(read('src/shared/main-image-agent-draft-plan.ts'), 'assetVisualUnderstanding', 'main-image-agent-draft-plan.ts');
assertIncludes(read('src/shared/main-image-agent-draft-plan.ts'), 'visualVerification', 'main-image-agent-draft-plan.ts');
assertIncludes(read('src/shared/main-image-visual-loop.ts'), 'buildMainImageVisualVerification', 'main-image-visual-loop.ts');
assertIncludes(read('src/shared/main-image-vision-preflight.ts'), '未显式启用主图视觉预检', 'main-image-vision-preflight.ts');

assertIncludes(layout, 'designPlannerPreflightGate', 'layout-replication.executor.ts');
assertIncludes(layout, '!designPlannerPreflightGate.shouldExecute', 'layout-replication.executor.ts');
assertOrder(layout, 'mode: \'reference_preflight\'', 'const templateBlueprint = buildReferenceReplicationBlueprint', 'layout-replication.executor.ts');
assertIncludes(layout, 'designPlannerPreflight', 'layout-replication.executor.ts');
assertIncludes(layout, 'designPlannerExecutionAlignment', 'layout-replication.executor.ts');
assertIncludes(layout, 'comparePlannerExecutionPlanToExecutor', 'layout-replication.executor.ts');

assertIncludes(mainImage, 'mainImageVisionPreflight', 'main-image.executor.ts');
assertIncludes(mainImage, 'analyzeAssetContent[main-image-controlled-product]', 'main-image.executor.ts');
assertIncludes(mainImage, 'mainImageScreenshotQa', 'main-image.executor.ts');
assertIncludes(mainImage, 'mainImageScreenshotProbeReadiness', 'main-image.executor.ts');
assertIncludes(mainImage, 'buildMainImageQaReport', 'main-image.executor.ts');
assertIncludes(mainImage, 'mainImageQaReport', 'main-image.executor.ts');
assertIncludes(read('src/shared/main-image-execution-alignment.ts'), '不改变 Photoshop 工具参数', 'main-image-execution-alignment.ts');
assertIncludes(read('src/shared/main-image-screenshot-qa.ts'), '不改变 Photoshop 工具参数', 'main-image-screenshot-qa.ts');
assertIncludes(read('src/shared/main-image-screenshot-probe-readiness.ts'), '不能把主图结果标记为设计质量通过', 'main-image-screenshot-probe-readiness.ts');
assertIncludes(read('src/shared/main-image-qa-report.ts'), '不是模型自动审美评分', 'main-image-qa-report.ts');
assertIncludes(mainImage, 'compareMainImageResultToReference', 'main-image executor should expose optional pixel-probe adapter');
assertIncludes(mainImage, 'compareImageFiles', 'main-image executor should call compareImageFiles only as read-only evidence');
assert(!mainImage.includes("executeToolCall('getCanvasSnapshot'"), 'main-image pixel probe adapter must not add Photoshop snapshot tool calls');

assertIncludes(detail, 'const designPlanner = buildDetailPagePlannerContext', 'detail-page.executor.ts');
assertIncludes(detail, 'designAgentOs,', 'detail-page.executor.ts');
assertIncludes(detail, 'designPlanner', 'detail-page.executor.ts');
assertIncludes(detail, 'businessSkillMemoryContext: designPlanner.businessSkillMemoryContext', 'detail-page.executor.ts');
assertIncludes(detail, 'detailPageDesignPlacementIntelligence: designPlanner.detailPageDesignPlacementIntelligence', 'detail-page.executor.ts');
assertIncludes(detail, 'businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence', 'detail-page.executor.ts');
assertIncludes(detail, 'success: failCount === 0', 'detail-page.executor.ts');
assert(!detail.includes('lowConfidenceScreenCount'), 'detail executor must not use ungrounded confidence as review evidence');
assert(!detail.includes('confidence: typeof plan.confidence'), 'detail screen evidence must not expose confidence');
assert(!detailSkill.includes('置信度'), 'detail user-visible planning summary must not mention confidence');
assert(!designAgentOsContracts.includes('confidence: screen.confidence'), 'detail Agent OS execution params must not expose screen confidence');

assertIncludes(sku, 'const designPlanner = buildSkuBatchPlannerContext', 'sku-batch.executor.ts');
assertIncludes(sku, 'designAgentOs,', 'sku-batch.executor.ts');
assertIncludes(sku, 'designPlanner', 'sku-batch.executor.ts');
assertIncludes(sku, 'skuMemoryContext: designPlanner.businessSkillMemoryContext', 'sku-batch.executor.ts');
assertIncludes(sku, 'businessSkillMemoryContext: designPlanner.businessSkillMemoryContext', 'sku-batch.executor.ts');
assertIncludes(sku, 'skuDesignPlacementIntelligence: designPlanner.skuDesignPlacementIntelligence', 'sku-batch.executor.ts');
assertIncludes(sku, 'businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence', 'sku-batch.executor.ts');
assertIncludes(sku, 'success: processedSizes.length > 0', 'sku-batch.executor.ts');

assert(
  packageJson.scripts && packageJson.scripts['smoke:design-planner:executor-evidence'] === 'node scripts/smoke-design-planner-executor-evidence.cjs',
  'package.json must expose smoke:design-planner:executor-evidence'
);
assert(
  packageJson.scripts && packageJson.scripts['smoke:design-intelligence:plan'] === 'node scripts/smoke-design-intelligence-plan.cjs',
  'package.json must expose smoke:design-intelligence:plan'
);

[
  ['helper', helper],
  ['layout', layout],
  ['mainImage', mainImage],
  ['detail', detail],
  ['sku', sku]
].forEach(([label, text]) => assertNoMojibake(text, label));

console.log(JSON.stringify({
  success: true,
  checks: [
    'planner context helper centralizes four scenario mappings',
    'executor planner context is plan-only and read-only',
    'planner preflight gate stops unsafe execution before representative Photoshop writes',
    'reference replication compares planner executionPlan categories to executor operations',
    'main image controlled path keeps visual analysis and QA checks without changing Photoshop execution parameters',
    'detail/SKU planner context carries designIntelligencePlan with model/manual decisions and memory context',
    'layout replication consumes planner preflight before blueprint construction',
    'detail/SKU attach designPlanner without replacing existing success criteria',
    'detail/SKU expose read-only businessSkillMemoryContext and DesignPlacementIntelligence without turning context into execution parameters',
    'mojibake guard passed'
  ]
}, null, 2));
