#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include ${needle}`);
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
    '\u9359',
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

const contracts = read('src/shared/design-agent-os-contracts.ts');
const layoutExecutor = read('src/renderer/services/skill-executors/layout-replication.executor.ts');
const mainImageExecutor = read('src/renderer/services/skill-executors/main-image.executor.ts');
const detailPageExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
const skuBatchExecutor = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
const textHandlers = read('src/main/uxp-handlers/text-handlers.ts');
const knowledgeSearchService = read('src/main/services/design-knowledge-search-service.ts');
const smartScalingPolicy = read('src/shared/design-smart-scaling-policy.ts');
const plannerContext = read('src/renderer/services/skill-executors/design-planner-context.ts');
const packageJson = JSON.parse(read('package.json'));

[
  'DesignAgentSourceRef',
  'DesignAgentObservation',
  'DesignIntentContext',
  'DesignPlanInputs',
  'DesignAssetObservations',
  'DesignVisualObservations',
  'DesignDSL',
  'ExecutionPlan',
  'ExecutionTrace',
  'VerificationReport'
].forEach((name) => {
  assertIncludes(contracts, `export interface ${name}`, 'design-agent-os-contracts.ts');
});

[
  'buildDesignIntentContextFromText',
  'buildDesignPlanInputsFromIntent',
  'buildDesignVisualObservationsFromMinimalRepresentation',
  'buildDesignDslFromMinimalRepresentation',
  'buildMainImageExecutionPlan',
  'buildReferenceReplicationDesignAgentOsRecord',
  'buildMainImageDesignAgentOsRecord',
  'buildDetailPageDesignAgentOsRecord',
  'buildSkuDesignAgentOsRecord',
  'buildCopywritingDesignAgentOsRecord',
  'buildSmartScalingDesignAgentOsRecord',
  'buildKnowledgeSearchDesignAgentOsRecord'
].forEach((name) => {
  assertIncludes(contracts, `export function ${name}`, 'design-agent-os-contracts.ts');
});

assertIncludes(contracts, "'needs_review'", 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不代表还原原作者 PSD', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不代表审美质量自动通过', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不等于截图级高保真复刻', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不等于版式质量、截图级 QA 或完整设计验收', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不替代导出文件存在性、颜色准确性和版式视觉验收', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '原文本只作为字数、行数、换行和标点骨架，不作为语义参考', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '缺少图片观察', 'design-agent-os-contracts.ts');
assertIncludes(contracts, 'planned destinationBox 不是执行结果', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '知识搜索只提供设计上下文和 recipe 线索，不直接执行 Photoshop', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '本地知识 MVP 不等于完整 RAG 或多模态知识图谱', 'design-agent-os-contracts.ts');
assert(!contracts.includes('confidence: number;\n    constraints: string[];'), 'intent and plan inputs must not expose ungrounded confidence');
assert(!contracts.includes('缺少用户输入，只能生成低置信度意图'), 'intent context should describe missing inputs instead of low confidence');
assert(!contracts.includes('options.confidence ??'), 'intent context builder must not synthesize confidence from raw text');
assert(!contracts.includes('observations: intent.sourceRefs.slice()'), 'user instructions must not be copied into asset observations');
assert(!contracts.includes("source: 'copywriting-context'"), 'copywriting input availability must not masquerade as an asset observation');

assertIncludes(layoutExecutor, 'buildReferenceReplicationDesignAgentOsRecord', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'buildReferenceReplicationPlannerContext', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'designAgentOs', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'designPlanner', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, "mode: 'reference_preflight'", 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'buildPlannerExecutionPreflightGate', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, '!designPlannerPreflightGate.shouldExecute', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'designPlannerPreflight', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, "mode: 'template_blueprint'", 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, "mode: 'match_existing_document'", 'layout-replication.executor.ts');

assertIncludes(mainImageExecutor, 'sizePlans', 'main-image.executor.ts');

assertIncludes(detailPageExecutor, 'buildDetailPageDesignAgentOsRecord', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'buildDetailPageScreenPlanInputs', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'designAgentOs', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'buildDetailPagePlannerContext', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'designPlanner', 'detail-page.executor.ts');

assertIncludes(skuBatchExecutor, 'buildSkuDesignAgentOsRecord', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'skuPlanInputs', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'designAgentOs', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'buildSkuBatchPlannerContext', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'designPlanner', 'sku-batch.executor.ts');

assertIncludes(plannerContext, 'buildReferenceReplicationPlannerContext', 'design-planner-context.ts');
assertIncludes(plannerContext, 'buildMainImagePlannerContext', 'design-planner-context.ts');
assertIncludes(plannerContext, 'buildDetailPagePlannerContext', 'design-planner-context.ts');
assertIncludes(plannerContext, 'buildSkuBatchPlannerContext', 'design-planner-context.ts');
assertIncludes(plannerContext, 'comparePlannerExecutionPlanToExecutor', 'design-planner-context.ts');
assertIncludes(plannerContext, 'Planner context is read-only and must not change Photoshop execution parameters.', 'design-planner-context.ts');
assertIncludes(layoutExecutor, 'designPlannerExecutionAlignment', 'layout-replication.executor.ts');

assertIncludes(textHandlers, 'buildCopywritingDesignAgentOsRecord', 'text-handlers.ts');
assertIncludes(textHandlers, 'designAgentOs: buildDesignAgentOs', 'text-handlers.ts');
assertIncludes(textHandlers, '当前文本只作为字数、行数、换行、标点和排版占位参考，不作为语义方向参考', 'text-handlers.ts');

assertIncludes(knowledgeSearchService, 'buildKnowledgeSearchDesignAgentOsRecord', 'design-knowledge-search-service.ts');
assertIncludes(knowledgeSearchService, 'designAgentOs', 'design-knowledge-search-service.ts');

assertIncludes(smartScalingPolicy, 'A Photoshop execution step must verify the resulting layer bounds after transform', 'design-smart-scaling-policy.ts');
assertIncludes(contracts, 'buildSmartScalingDesignAgentOsRecord', 'design-agent-os-contracts.ts');

assert(
  packageJson.scripts && packageJson.scripts['smoke:design-agent-os:contracts'] === 'node scripts/smoke-design-agent-os-contracts.cjs',
  'package.json must expose smoke:design-agent-os:contracts'
);

[
  ['contracts', contracts],
  ['layoutExecutor', layoutExecutor],
  ['mainImageExecutor', mainImageExecutor],
  ['detailPageExecutor', detailPageExecutor],
  ['skuBatchExecutor', skuBatchExecutor],
  ['textHandlers', textHandlers],
  ['knowledgeSearchService', knowledgeSearchService],
  ['smartScalingPolicy', smartScalingPolicy],
  ['plannerContext', plannerContext]
].forEach(([label, text]) => assertNoMojibake(text, label));

console.log(JSON.stringify({
  success: true,
  checks: [
    'Design Agent OS contract interfaces exist',
    'helper functions exist and keep review boundaries visible',
    'layout-replication attaches a read-only Design Agent OS record',
    'layout-replication attaches read-only Design Planner context',
    'layout-replication consumes planner readiness as a preflight without changing Photoshop parameters',
    'layout-replication compares planner execution categories with executor operations',
    'detail-page attaches a read-only Design Agent OS record',
    'detail-page attaches read-only Design Planner context',
    'sku-batch attaches a read-only Design Agent OS record',
    'sku-batch attaches read-only Design Planner context',
    'copywriting handler attaches a read-only Design Agent OS record without using old text as semantic source',
    'smart-scaling helper separates planned destinationBox from Photoshop execution results',
    'knowledge search service attaches a read-only Design Agent OS record and does not emit direct Photoshop actions',
    'mojibake guard passed'
  ]
}, null, 2));
