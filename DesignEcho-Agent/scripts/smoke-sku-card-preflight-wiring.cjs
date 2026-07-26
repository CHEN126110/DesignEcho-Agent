#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const executorPath = path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const source = fs.readFileSync(executorPath, 'utf8');
const colorCardExecutorPath = path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'sku-color-card.executor.ts');
const colorCardSource = fs.readFileSync(colorCardExecutorPath, 'utf8');
const defaultsPath = path.join(ROOT, 'src', 'shared', 'skill-param-defaults.ts');
const defaultsSource = fs.readFileSync(defaultsPath, 'utf8');
const templatePlanPath = path.join(ROOT, 'src', 'shared', 'sku-card-template-preparation-plan.ts');
const templatePlanSource = fs.readFileSync(templatePlanPath, 'utf8');
const declarationsPath = path.join(ROOT, 'src', 'shared', 'skills', 'skill-declarations.ts');
const declarationsSource = fs.readFileSync(declarationsPath, 'utf8');
const skillToolsPath = path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts');
const skillToolsSource = fs.readFileSync(skillToolsPath, 'utf8');
const enginePath = path.join(ROOT, 'src', 'renderer', 'services', 'design-agent', 'engine.ts');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  source.includes('sku-card-asset-candidates'),
  'sku-batch executor should import the SKU card asset candidate helper'
);
assert(
  source.includes('skuCardAssetCandidateReport'),
  'sku-batch executor should expose skuCardAssetCandidateReport in result data'
);
assert(
  source.includes('buildSkuCardAssetCandidateReport'),
  'sku-batch executor should build SKU card asset candidates from project context'
);
assert(
  source.includes('sku-card-source-preparation-plan')
    && source.includes('buildSkuCardSourcePreparationPlan'),
  'sku-batch executor should use the controlled SKU card source preparation plan'
);
assert(
  source.includes('sku-card-template-preparation-plan')
    && source.includes('buildSkuCardTemplatePreparationPlan'),
  'sku-batch executor should use the controlled SKU card template preparation plan'
);
assert(
  source.includes('isCardStyleTemplateCandidate')
    && source.includes('missingCardTemplateCandidate'),
  'sku-batch executor should prepare and prefer card-style templates instead of reusing basic placeholder templates forever'
);
// 钉桩更新（治理2026-07-02）：占位模板产物命名改为明示「通用占位」（非设计稿），
// 后缀保留「卡片模板v4」段，修订号解析（/卡片模板v(\d+)/）与打分口径不变。
assert(
  source.includes('scoreSkuCardTemplateRevision')
    && source.includes('CURRENT_GENERATED_CARD_TEMPLATE_REVISION = 4')
    && templatePlanSource.includes("CARD_TEMPLATE_SUFFIX = '通用占位卡片模板v4'")
    && templatePlanSource.includes('卡片模板v4'),
  'sku-batch executor should prefer the newest generated card template revision when old card templates remain in the project, and generated placeholder templates must be named as generic placeholders'
);
assert(
  source.indexOf('const projectResult = await tryOpenProjectTemplate(size, false)') >= 0 &&
    source.indexOf('const projectResult = await tryOpenProjectTemplate(size, false)') < source.indexOf('open-${sizeKeyword}-template-primary'),
  'combo template resolution should use scored project candidates before fuzzy openProjectFile fallback'
);
assert(
  source.indexOf('const noteProjectResult = await tryOpenProjectTemplate(size, true)') >= 0 &&
    source.indexOf('const noteProjectResult = await tryOpenProjectTemplate(size, true)') < source.indexOf('open-${size}note-template-primary'),
  'note template resolution should use scored project candidates before fuzzy openProjectFile fallback'
);
assert(
  source.includes('allowSkuCardSourcePreparation')
    && source.includes('buildSkuCardVisualConfirmationPlan')
    && source.includes('runProjectVisualInsightCacheFill')
    && source.includes('runSkuCardVisualConfirmationBeforeSourcePreparation')
    && source.includes('preferExistingSkuSourceForCardPreparation')
    && source.includes('executeSkuCardSourcePreparationPlan'),
  'sku-batch executor should visually confirm SKU card candidates before the explicit controlled source preparation stage'
);
assert(
  source.includes('PSD/SKU-card-source.psb')
    && defaultsSource.includes('PSD/SKU-card-source.psb')
    && declarationsSource.includes('PSD/SKU-card-source.psb'),
  'card-style SKU source preparation should default to a non-destructive source document path'
);
assert(
  colorCardSource.includes('const data = result?.data')
    && colorCardSource.includes("readPositiveId(imageResult, ['layerId', 'placedLayerId', 'createdLayerId'])"),
  'sku-color-card executor should read placeImage layer ids from the UXP data contract'
);
assert(
  source.includes('const requestedComboSizes = normalizeSkuSizeList(params.comboSizes)')
    && !source.includes('explicitComboSizesFromUserInput'),
  'sku-batch executor should consume sizes bound at the skill boundary instead of parsing user text again'
);
assert(
  source.includes('const effectiveRequestedTargetSizes = requestedComboSizes')
    && !source.includes('modelPlan?.targetSizes'),
  'sku-batch executor should keep one structured owner for requested target sizes'
);
assert(
  source.includes('requestedSizesCoveredByConfiguredPlan')
    && source.includes('!requestedSizesCoveredByConfiguredPlan'),
  'sku-batch executor should not let partial CSV configuration shrink explicit requested SKU sizes'
);
assert(
  source.includes('inferredSize !== null && inferredSize !== options.size'),
  'sku-batch executor must not choose a template whose filename declares a different SKU size'
);
assert(
  source.includes("runSkill('sku-color-card'")
    && !source.includes("executeToolCall('placeImage'")
    && colorCardSource.includes("callTool('placeImage'"),
  'sku-batch should delegate color-card construction to its single owning skill instead of duplicating Photoshop writes'
);
const sourceVerifyIndex = colorCardSource.indexOf("callTool('getDocumentInfo', {}, 'verify-main-document')");
const sourceSaveAfterVerifyIndex = colorCardSource.indexOf("callTool('saveDocument'", sourceVerifyIndex);
assert(
  sourceVerifyIndex >= 0
    && sourceSaveAfterVerifyIndex > sourceVerifyIndex,
  'sku-color-card should read back the final document before saving'
);
assert(
  !source.includes('&& projectSkuTemplates.length === 0'),
  'SKU card template preparation should run for missing requested sizes even when partial project templates exist'
);
assert(
  source.includes('allowSkuCardTemplatePreparation')
    && source.includes('executeSkuCardTemplatePreparationPlan'),
  'sku-batch executor should only prepare SKU card templates through an explicit controlled stage'
);
assert(
  source.includes('requireSkuCardTemplateDesignConfirmation')
    && source.includes('pending_sku_card_template_design_confirmation')
    && source.includes('buildSkuCardTemplateDesignConfirmationCard'),
  'sku-batch executor should pause missing card-template creation for editable design confirmation before running placeholder-template writes'
);
assert(
  /const notePlaceholderCount[\s\S]{0,260}validColors\.length[\s\S]{0,120}params\.skuTemplateNotePlaceholderCount/.test(source),
  'SKU self-select note template preparation should prefer actual available color count over default placeholder count'
);
assert(
  source.includes('estimateSkuSourceCardAspectRatio')
    && source.includes('readLayerSetBoundsRatio')
    && /sourceCardAspectRatio\s*=\s*estimateSkuSourceCardAspectRatio\(layersResult,\s*validColors\)/.test(source)
    && /buildSkuCardTemplatePreparationPlan\(\{[\s\S]{0,260}sourceCardAspectRatio/.test(source),
  'SKU card template preparation should use observed SKU source layer bounds to plan placeholder aspect ratio.'
);
assert(
  templatePlanSource.includes('sourceCardAspectRatio?: number | null')
    && templatePlanSource.includes('fitSlotToAspect')
    && templatePlanSource.includes('visible: false')
    && templatePlanSource.includes('slots: slots.map'),
  'SKU card template plan should emit hidden explicit placeholder slots based on source card aspect ratio.'
);
assert(
  declarationsSource.includes('skuSourcePreparationMode')
    && declarationsSource.includes('card-source-from-project-images')
    && declarationsSource.includes('allowSkuCardSourcePreparation')
    && declarationsSource.includes('runSkuCardVisualConfirmationBeforeSourcePreparation')
    && declarationsSource.includes("'switchDocument'")
    && declarationsSource.includes("'getDocumentInfo'"),
  'sku-batch declaration should expose card-source preparation and visual-confirmation conditions instead of hiding them in code'
);
assert(
  declarationsSource.includes('skuTemplatePreparationMode')
    && declarationsSource.includes('card-placeholder-templates')
    && declarationsSource.includes('allowSkuCardTemplatePreparation')
    && declarationsSource.includes('requireSkuCardTemplateDesignConfirmation')
    && declarationsSource.includes("'createRectangle'")
    && declarationsSource.includes("'createTextLayer'"),
  'sku-batch declaration should expose card-template preparation conditions instead of hiding them in code'
);
assert(
  defaultsSource.includes('shouldEnableSkuCardSourcePreparation')
    && defaultsSource.includes('runSkuCardVisualConfirmationBeforeSourcePreparation')
    && defaultsSource.includes('runBusinessVisualObservationRefreshBeforeExecution'),
  'skill defaults should infer SKU card source preparation and bounded visual refresh from user intent'
);
assert(
  defaultsSource.includes('shouldEnableSkuCardTemplatePreparation')
    && defaultsSource.includes('skuTemplatePreparationMode')
    && defaultsSource.includes('shouldRequireSkuCardTemplateDesignConfirmation'),
  'skill defaults should infer SKU card template preparation and design confirmation from card-style SKU user intent'
);
assert(
  skillToolsSource.includes('applySharedSkillParamDefaults')
    && skillToolsSource.includes('options.context?.userInput'),
  'autonomous Agent skill-tool calls must bind shared skill defaults from the original user request before executing sku-batch'
);
assert(
  /prepareAgentDesignExecutionPreflight[\s\S]{0,1400}applySharedSkillParamDefaults/.test(engineSource)
    && /userInput:\s*context\.userInput/.test(engineSource),
  'deterministic and model-routed skill execution must bind shared skill defaults from the original user request before design preflight'
);
assert(
  packageJson.scripts?.['smoke:sku:card-source-preparation-plan'] === 'node scripts/smoke-sku-card-source-preparation-plan.cjs',
  'package.json should expose the SKU card source preparation smoke'
);
assert(
  packageJson.scripts?.['smoke:sku:card-template-preparation-plan'] === 'node scripts/smoke-sku-card-template-preparation-plan.cjs',
  'package.json should expose the SKU card template preparation smoke'
);
assert(
  packageJson.scripts?.['smoke:sku:card-template-design-gate'] === 'node scripts/smoke-sku-card-template-design-gate.cjs',
  'package.json should expose the SKU card template design gate smoke'
);
assert(
  !/E:\\\\WERKE\\\\C-1194/.test(source),
  'sku-batch executor must not hardcode the C-1194 exam project path'
);
assert(
  !/C-1137|DesignEchoDemo/.test(source),
  'sku-batch executor must not hardcode the reference project path'
);

console.log(JSON.stringify({ ok: true }, null, 2));
