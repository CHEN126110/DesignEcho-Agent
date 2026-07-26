#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const agentRoot = path.resolve(__dirname, '..');
const policyPath = path.join(agentRoot, 'src', 'shared', 'sku-auto-layout-executor-policy.ts');
const executorPath = path.join(agentRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const toolExecutorPath = path.join(agentRoot, 'src', 'renderer', 'services', 'tool-executor.service.ts');
const intentParamsPath = path.join(agentRoot, 'src', 'shared', 'skill-param-defaults.ts');
const packagePath = path.join(agentRoot, 'package.json');

const {
  buildSkuAutoLayoutExecutorPolicy,
  buildSkuTemplateLayoutPreflight
} = require(policyPath);
const {
  applySharedSkillParamDefaults
} = require(intentParamsPath);

const publicParams = applySharedSkillParamDefaults({
  skillId: 'sku-batch',
  userInput: '帮我做SKU',
  params: {}
});

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(publicParams, 'autoLayoutWithoutPlaceholders'),
  false,
  '普通 SKU public intent params must not expose low-level autoLayoutWithoutPlaceholders.'
);

const defaultDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU',
  params: {},
  action: 'execute',
  templateDoc: { name: '2双装.psd' }
});
assert.strictEqual(defaultDecision.enabled, false, 'default SKU must keep placeholder mode until template layer preflight proves no reliable placeholders.');
assert.strictEqual(defaultDecision.source, 'default_placeholder_until_preflight');

const reliablePreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装.psd',
    width: 800,
    height: 800,
    layers: [
      { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
      { id: 2, name: 'SKU占位符1', visible: true, bounds: { left: 80, top: 180, right: 330, bottom: 620 } },
      { id: 3, name: 'SKU占位符2', visible: true, bounds: { left: 380, top: 180, right: 630, bottom: 620 } }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(reliablePreflight.skuPlaceholderReliability, 'reliable');
assert.strictEqual(reliablePreflight.hasReliableSkuPlaceholders, true);
assert.strictEqual(reliablePreflight.placeholderCount, 2);

const orderedGroupPreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装-顺序占位.tif',
    width: 800,
    height: 800,
    layers: [
      { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
      {
        id: 2,
        name: '占位',
        kind: 'group',
        visible: true,
        bounds: { left: 80, top: 180, right: 720, bottom: 620 },
        layers: [
          { id: 3, name: '1', kind: 'group', visible: true, bounds: { left: 80, top: 180, right: 330, bottom: 620 } },
          { id: 4, name: '2', kind: 'group', visible: true, bounds: { left: 380, top: 180, right: 630, bottom: 620 } }
        ]
      }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(
  orderedGroupPreflight.skuPlaceholderReliability,
  'reliable',
  '6.3 ordered placeholder groups inside a 占位 container should be treated as reliable placeholders.'
);
assert.strictEqual(orderedGroupPreflight.hasReliableSkuPlaceholders, true);
assert.strictEqual(orderedGroupPreflight.placeholderCount, 2);

const orderedContainerArtLayerPreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装-顺序占位-普通图层.tif',
    width: 800,
    height: 800,
    layers: [
      {
        id: 2,
        name: '占位',
        kind: 'group',
        visible: true,
        bounds: { left: 80, top: 180, right: 720, bottom: 620 },
        layers: [
          { id: 3, name: '1', kind: 'shape', visible: true, bounds: { left: 80, top: 180, right: 330, bottom: 620 } },
          { id: 4, name: '2', kind: 'shape', visible: true, bounds: { left: 380, top: 180, right: 630, bottom: 620 } }
        ]
      }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(
  orderedContainerArtLayerPreflight.skuPlaceholderReliability,
  'reliable',
  '6.3 ordered placeholder containers should accept legacy rectangle/shape placeholder layers as reliable slots.'
);
assert.strictEqual(orderedContainerArtLayerPreflight.hasReliableSkuPlaceholders, true);
assert.strictEqual(orderedContainerArtLayerPreflight.placeholderCount, 2);

const legacyReliablePreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装-旧模板.psd',
    width: 800,
    height: 800,
    layers: [
      { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
      { id: 2, name: '矩形 1', kind: 'shape', visible: true, bounds: { left: 80, top: 180, right: 330, bottom: 620 } },
      { id: 3, name: '矩形 2', kind: 'shape', visible: true, bounds: { left: 380, top: 180, right: 630, bottom: 620 } },
      { id: 4, name: '标题文案', kind: 'text', visible: true, bounds: { left: 120, top: 60, right: 680, bottom: 120 } }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(
  legacyReliablePreflight.skuPlaceholderReliability,
  'legacy_reliable',
  'legacy top-level rectangle placeholders should be recognized without requiring users to rename old templates.'
);
assert.strictEqual(legacyReliablePreflight.hasReliableSkuPlaceholders, true);
assert.strictEqual(legacyReliablePreflight.placeholderCount, 2);

const singleLegacyRegionPreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '5双装-旧模板-单区域.psd',
    width: 800,
    height: 800,
    layers: [
      { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
      { id: 2, name: '矩形 1', kind: 'shape', visible: true, bounds: { left: 80, top: 170, right: 720, bottom: 650 } },
      { id: 3, name: '标题文案', kind: 'text', visible: true, bounds: { left: 120, top: 60, right: 680, bottom: 120 } }
    ]
  },
  expectedItemCount: 5
});
assert.strictEqual(
  singleLegacyRegionPreflight.skuPlaceholderReliability,
  'legacy_reliable',
  'one large legacy rectangle region should remain reliable because the old placeholder layout can place multiple colors in one region.'
);
assert.strictEqual(singleLegacyRegionPreflight.hasReliableSkuPlaceholders, true);
assert.strictEqual(singleLegacyRegionPreflight.placeholderCount, 1);

const hiddenReferenceRegionPreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装-C1163.tif',
    width: 1000,
    height: 1000,
    layers: [
      { id: 1, name: '形状参考', kind: 'solidColor', visible: false, bounds: { left: 186, top: 0, right: 814, bottom: 579 } },
      {
        id: 2,
        name: '组 1',
        visible: true,
        kind: 'group',
        layers: [
          { id: 3, name: '标题文案', kind: 'text', visible: true, bounds: { left: 130, top: 854, right: 431, bottom: 904 } },
          { id: 4, name: '图层 1', kind: 'pixel', visible: true, bounds: { left: 0, top: 0, right: 1000, bottom: 1000 } }
        ]
      }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(
  hiddenReferenceRegionPreflight.skuPlaceholderReliability,
  'legacy_reliable',
  'hidden C-1163 reference shape should be treated as a legacy SKU placement region.'
);
assert.strictEqual(hiddenReferenceRegionPreflight.hasReliableSkuPlaceholders, true);
assert.strictEqual(hiddenReferenceRegionPreflight.placeholderCount, 1);

const filledReferenceItemGroupPreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装-C1197.tif',
    width: 1500,
    height: 1500,
    layers: [
      {
        id: 1,
        name: '爱心波浪',
        kind: 'group',
        visible: true,
        bounds: { left: 151, top: 157, right: 877, bottom: 989 },
        layers: [
          { id: 2, name: '爱心波浪', kind: 'text', visible: true, bounds: { left: 462, top: 934, right: 673, bottom: 985 } },
          { id: 3, name: '阴影', kind: 'smartObject', visible: true, bounds: { left: 273, top: 278, right: 754, bottom: 858 } },
          { id: 4, name: '阴影组B', kind: 'smartObject', visible: true, bounds: { left: 151, top: 157, right: 877, bottom: 989 } }
        ]
      },
      {
        id: 5,
        name: '花边蝴蝶结',
        kind: 'group',
        visible: true,
        bounds: { left: 550, top: 157, right: 1275, bottom: 989 },
        layers: [
          { id: 6, name: '花边蝴蝶结', kind: 'text', visible: true, bounds: { left: 862, top: 935, right: 1125, bottom: 985 } },
          { id: 7, name: '阴影', kind: 'smartObject', visible: true, bounds: { left: 671, top: 255, right: 1153, bottom: 858 } },
          { id: 8, name: '阴影组B', kind: 'smartObject', visible: true, bounds: { left: 550, top: 157, right: 1275, bottom: 989 } }
        ]
      },
      { id: 9, name: '组 1', kind: 'smartObject', visible: true, bounds: { left: 0, top: 0, right: 1500, bottom: 1500 } }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(
  filledReferenceItemGroupPreflight.skuPlaceholderReliability,
  'legacy_reliable',
  'C-1197 filled reference item groups should be treated as legacy SKU slots instead of blocking execution.'
);
assert.strictEqual(filledReferenceItemGroupPreflight.hasReliableSkuPlaceholders, true);
assert.strictEqual(filledReferenceItemGroupPreflight.placeholderCount, 2);

const noPlaceholderPreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装.psd',
    width: 800,
    height: 800,
    layers: [
      { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
      { id: 2, name: '标题文案', visible: true, bounds: { left: 80, top: 50, right: 720, bottom: 120 } },
      {
        id: 3,
        name: '角标组',
        visible: true,
        kind: 'group',
        layers: [
          { id: 4, name: '优惠角标', visible: true, bounds: { left: 640, top: 640, right: 760, bottom: 760 } }
        ]
      }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(noPlaceholderPreflight.skuPlaceholderReliability, 'none');
assert.strictEqual(noPlaceholderPreflight.hasReliableSkuPlaceholders, false);
assert(noPlaceholderPreflight.obstacleCount >= 2, 'preflight should keep foreground template elements as observed obstacles.');

const unknownPreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: { name: '2双装.psd' },
  expectedItemCount: 2
});
assert.strictEqual(unknownPreflight.skuPlaceholderReliability, 'unknown');
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(unknownPreflight, 'hasReliableSkuPlaceholders'),
  false,
  'unknown preflight must not masquerade as an inspected no-placeholder result.'
);

const reliablePlaceholderDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU',
  params: {},
  action: 'execute',
  templateDoc: {
    name: '2双装.psd',
    ...reliablePreflight
  }
});
assert.strictEqual(reliablePlaceholderDecision.enabled, false, 'reliable template placeholders should keep the original placeholder layout path.');
assert.strictEqual(reliablePlaceholderDecision.source, 'template_has_reliable_placeholders');

const orderedGroupDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做 SKU',
  params: {},
  action: 'execute',
  templateDoc: {
    name: '2双装-顺序占位.tif',
    ...orderedGroupPreflight
  }
});
assert.strictEqual(orderedGroupDecision.enabled, false, '6.3 ordered placeholder templates must not enter no-placeholder auto layout.');
assert.strictEqual(orderedGroupDecision.source, 'template_has_reliable_placeholders');

const legacyPlaceholderDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU',
  params: {},
  action: 'execute',
  templateDoc: {
    name: '2双装-旧模板.psd',
    ...legacyReliablePreflight
  }
});
assert.strictEqual(legacyPlaceholderDecision.enabled, false, 'a reliable legacy placeholder inspection should keep old templates on the placeholder layout path.');
assert.strictEqual(legacyPlaceholderDecision.source, 'template_has_reliable_placeholders');

const singleLegacyRegionDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做5双SKU',
  params: {},
  action: 'execute',
  templateDoc: {
    name: '5双装-旧模板-单区域.psd',
    ...singleLegacyRegionPreflight
  }
});
assert.strictEqual(singleLegacyRegionDecision.enabled, false, 'one usable legacy placeholder region should not be forced into no-placeholder planner mode.');
assert.strictEqual(singleLegacyRegionDecision.source, 'template_has_reliable_placeholders');

const decorativeShapePreflight = buildSkuTemplateLayoutPreflight({
  templateDoc: {
    name: '2双装-无占位符装饰模板.psd',
    width: 800,
    height: 800,
    layers: [
      { id: 1, name: '背景', visible: true, isBackgroundLayer: true, bounds: { left: 0, top: 0, right: 800, bottom: 800 } },
      { id: 2, name: '标题底板', kind: 'shape', visible: true, bounds: { left: 50, top: 42, right: 750, bottom: 118 } },
      { id: 3, name: 'LOGO角标', kind: 'shape', visible: true, bounds: { left: 650, top: 640, right: 760, bottom: 750 } },
      { id: 4, name: '标题文案', kind: 'text', visible: true, bounds: { left: 120, top: 58, right: 500, bottom: 102 } }
    ]
  },
  expectedItemCount: 2
});
assert.strictEqual(
  decorativeShapePreflight.skuPlaceholderReliability,
  'none',
  'decorative top-level shapes should not be promoted to legacy SKU placeholders.'
);
assert.strictEqual(decorativeShapePreflight.hasReliableSkuPlaceholders, false);
assert.strictEqual(decorativeShapePreflight.placeholderCount, 0);

const decorativeShapeDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU',
  params: {},
  action: 'execute',
  templateDoc: {
    name: '2双装-无占位符装饰模板.psd',
    ...decorativeShapePreflight
  }
});
assert.strictEqual(
  decorativeShapeDecision.enabled,
  false,
  'decorative templates should not make the Agent enter no-placeholder obstacle-avoidance mode in the 6.3 ordered-placeholder SKU skill.'
);
assert.strictEqual(decorativeShapeDecision.source, 'template_has_no_reliable_placeholders');

const userRequestedDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU，模板不用占位符，自动排好不要遮挡文字',
  params: {},
  action: 'execute',
  templateDoc: { name: '2双装.psd' }
});
assert.strictEqual(userRequestedDecision.enabled, false, 'explicit no-placeholder wording must not make the SKU skill use automatic obstacle avoidance in 6.3 mode.');
assert.strictEqual(userRequestedDecision.source, 'user_requested_no_placeholder');

const noteDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做2-3-4的自选备注，模板不用占位符，自动排好不要遮挡文字',
  params: {},
  action: 'arrangeDynamic',
  templateDoc: { name: '2双自选备注.psd' }
});
assert.strictEqual(noteDecision.enabled, false, 'self-select note requests should stay on ordered placeholder replacement instead of no-placeholder auto layout.');

const keepPlaceholderDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做2-3-4的自选备注，不改模板占位符',
  params: {},
  action: 'arrangeDynamic',
  templateDoc: { name: '2双自选备注.psd' }
});
assert.strictEqual(keepPlaceholderDecision.enabled, false, 'phrases like 不改模板占位符 must not be treated as no-placeholder intent.');
assert.strictEqual(keepPlaceholderDecision.source, 'default_placeholder_until_preflight');

const projectPolicyDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU',
  params: {
    skuAutoLayoutMode: 'without-placeholders'
  },
  action: 'execute',
  templateDoc: { name: '2双装.psd' }
});
assert.strictEqual(projectPolicyDecision.enabled, false, 'internal project policy should not override the 6.3 ordered-placeholder SKU layout contract.');
assert.strictEqual(projectPolicyDecision.source, 'project_or_parent_policy');

const explicitDisableDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU，自动排列',
  params: {
    skuAutoLayoutMode: 'placeholder'
  },
  action: 'execute',
  templateDoc: { name: '2双装.psd' }
});
assert.strictEqual(explicitDisableDecision.enabled, false, 'explicit placeholder mode must override ambiguous auto-layout wording.');
assert.strictEqual(explicitDisableDecision.source, 'explicit_placeholder_mode');

const templateInspectionDecision = buildSkuAutoLayoutExecutorPolicy({
  userInput: '帮我做SKU',
  params: {},
  action: 'execute',
  templateDoc: {
    name: '2双装.psd',
    ...noPlaceholderPreflight
  }
});
assert.strictEqual(templateInspectionDecision.enabled, false, 'a no-placeholder inspection should not make the Agent enter automatic obstacle avoidance.');
assert.strictEqual(templateInspectionDecision.source, 'template_has_no_reliable_placeholders');

const serialized = JSON.stringify([
  defaultDecision,
  reliablePlaceholderDecision,
  userRequestedDecision,
  noteDecision,
  keepPlaceholderDecision,
  projectPolicyDecision,
  explicitDisableDecision,
  templateInspectionDecision,
  legacyReliablePreflight,
  legacyPlaceholderDecision,
  singleLegacyRegionPreflight,
  singleLegacyRegionDecision,
  decorativeShapePreflight,
  decorativeShapeDecision,
  reliablePreflight,
  noPlaceholderPreflight,
  unknownPreflight
]);
assert(!/confidence|置信/i.test(serialized), 'SKU auto layout policy must not expose confidence fields.');
assert(!/data:image|base64|rawImage/i.test(serialized), 'SKU auto layout policy must not expose raw image payloads.');

const executorSource = fs.readFileSync(executorPath, 'utf8');
assert(
  executorSource.includes('buildSkuAutoLayoutExecutorPolicy'),
  'sku-batch executor must use the shared no-placeholder auto layout policy.'
);
assert(
  /const comboAutoLayoutDecision = buildSkuAutoLayoutExecutorPolicy\(/.test(executorSource),
  'combo skuLayout calls must compute a no-placeholder auto layout decision.'
);
assert(
  executorSource.includes('buildSkuTemplateLayoutPreflightFromRuntimeInspection'),
  'sku-batch executor must convert UXP runtime template inspection into the shared preflight contract.'
);
assert(
  /action:\s*['"]inspectTemplateLayout['"]/.test(executorSource),
  'sku-batch executor must use skuLayout inspectTemplateLayout as the template preflight authority.'
);
assert(
  !/safeToolCall\(\s*['"]getLayerHierarchy['"]/.test(executorSource),
  'sku-batch executor must not keep getLayerHierarchy as the main template recognition path.'
);
assert(
  /autoLayoutWithoutPlaceholders:\s*comboAutoLayoutDecision\.enabled/.test(executorSource),
  'combo skuLayout tool params must pass autoLayoutWithoutPlaceholders from the policy decision.'
);
assert(
  /const noteAutoLayoutDecision = buildSkuAutoLayoutExecutorPolicy\(/.test(executorSource),
  'self-select note skuLayout calls must compute a no-placeholder auto layout decision.'
);
assert(
  /autoLayoutWithoutPlaceholders:\s*noteAutoLayoutDecision\.enabled/.test(executorSource),
  'self-select note skuLayout tool params must pass autoLayoutWithoutPlaceholders from the policy decision.'
);
assert(
  executorSource.includes('skuAutoLayoutDecisions'),
  'SKU result data should expose sanitized auto layout decisions for review and diagnostics.'
);
assert(
  executorSource.includes('ensureSkuNoPlaceholderRuntimeReady'),
  'sku-batch executor must preflight UXP runtime capabilities before any no-placeholder Photoshop write.'
);
assert(
  executorSource.includes('sku-no-placeholder-auto-layout/v2') &&
    executorSource.includes('returnsActualSubjectBoundsQa'),
  'sku-batch executor must require the current no-placeholder runtime revision and actual subject-bounds QA support.'
);
assert(
  /action:\s*['"]getCapabilities['"]/.test(executorSource),
  'sku-batch executor must use a read-only skuLayout getCapabilities call for no-placeholder runtime checks.'
);
assert(
  executorSource.includes('sku-recursive-color-layer-groups/v1') &&
    executorSource.includes('supportsRecursiveSkuColorGroups') &&
    executorSource.includes('blocked_stale_uxp_runtime_missing_recursive_sku_color_groups'),
  'sku-batch executor must detect stale UXP runtimes that cannot recursively resolve nested SKU color groups.'
);
assert(
  executorSource.includes('sku-combo-export-naming/v1') &&
    executorSource.includes('supportsSkuComboExportNaming') &&
    executorSource.includes('keepsExecutionOrderOutOfFileName') &&
    executorSource.includes('sku-runtime-preflight') &&
    executorSource.includes('blocked_stale_uxp_runtime_missing_sku_execution_contract'),
  'sku-batch executor must detect stale UXP runtimes that still prefix internal execution order into SKU export filenames.'
);
assert(
  /supportsRecursiveSkuColorGroups\(skuLayoutCapabilitiesResult\)/.test(executorSource) &&
    /layersResult\?\.data\?\.recursive\s*===\s*true/.test(executorSource),
  'SKU color-group failures must distinguish stale non-recursive UXP runtime from a real missing-color-group source document.'
);
assert(
  /if\s*\(\s*comboAutoLayoutDecision\.enabled\s*\)[\s\S]{0,900}ensureSkuNoPlaceholderRuntimeReady/.test(executorSource),
  'combo no-placeholder skuLayout writes must be gated by runtime capability preflight.'
);
assert(
  /if\s*\(\s*noteAutoLayoutDecision\.enabled\s*\)[\s\S]{0,900}ensureSkuNoPlaceholderRuntimeReady/.test(executorSource),
  'self-select note no-placeholder skuLayout writes must be gated by runtime capability preflight.'
);
assert(
  /ensureSkuNoPlaceholderRuntimeReady[\s\S]{0,1600}autoLayoutWithoutPlaceholders:\s*comboAutoLayoutDecision\.enabled/.test(executorSource),
  'combo runtime capability preflight must happen before passing autoLayoutWithoutPlaceholders into skuLayout.'
);
assert(
  executorSource.includes('collectSkuAutoLayoutQaDiagnostics'),
  'sku-batch executor should collect post-execution autoLayoutQa diagnostics from UXP results.'
);
assert(
  executorSource.includes('collectSkuLayoutFailureDiagnostics'),
  'sku-batch executor should collect UXP skuLayout failure diagnostics from data.errors and planner blockers.'
);
assert(
  executorSource.includes('formatSkuAutoLayoutSummaryDiagnostic') &&
    executorSource.includes('high_item_count_needs_more_canvas_area') &&
    executorSource.includes('free_regions_are_fragmented') &&
    executorSource.includes('template_obstacles_consume_safe_area'),
  'sku-batch executor should translate structured planner summaries into user-facing failure diagnostics.'
);
assert(
  /collectSkuLayoutFailureDiagnostics\(executeResult/.test(executorSource),
  'combo skuLayout failures should feed structured UXP errors into Agent warnings.'
);
assert(
  /collectSkuLayoutFailureDiagnostics\(noteResult/.test(executorSource),
  'self-select note skuLayout failures should feed structured UXP errors into Agent warnings.'
);
assert(
  /collectSkuAutoLayoutQaDiagnostics\(executeResult/.test(executorSource),
  'combo skuLayout result should feed post-execution autoLayoutQa diagnostics into Agent warnings.'
);
assert(
  /collectSkuAutoLayoutQaDiagnostics\(noteResult/.test(executorSource),
  'self-select note skuLayout result should feed post-execution autoLayoutQa diagnostics into Agent warnings.'
);
assert(
  executorSource.includes('skuAutoLayoutQaDiagnostics'),
  'SKU result data should expose sanitized post-execution geometry QA diagnostics.'
);

const toolExecutorSource = fs.readFileSync(toolExecutorPath, 'utf8');
assert(
  toolExecutorSource.includes('sku-no-placeholder-auto-layout/v2') &&
    toolExecutorSource.includes('returnsActualSubjectBoundsQa') &&
    toolExecutorSource.includes('sku-recursive-color-layer-groups/v1') &&
    toolExecutorSource.includes('sku-combo-export-naming/v1'),
  'chat test fake skuLayout capabilities should match the current SKU runtime contracts.'
);

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
assert(packageJson.scripts['smoke:sku:auto-layout-executor-policy'], 'package.json should expose smoke:sku:auto-layout-executor-policy');
assert(
  String(packageJson.scripts['maintenance:preflight'] || '').includes('smoke:sku:auto-layout-executor-policy'),
  'maintenance:preflight should include smoke:sku:auto-layout-executor-policy'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'SKU no-placeholder policy stays out of public intent params',
    'SKU defaults to placeholder layout until layer preflight proves no reliable placeholders',
    'a reliable placeholder inspection keeps the original template layout path',
    'legacy unnamed rectangle placeholders keep old templates on the placeholder path',
    'single large legacy placeholder regions can carry multiple colors without switching to no-placeholder',
    'decorative top-level shapes are not misclassified as legacy SKU placeholders',
    'explicit user and project no-placeholder wording no longer enables obstacle-avoidance auto layout',
    'ambiguous keep-placeholder wording is not treated as no-placeholder intent',
    'explicit placeholder mode disables no-placeholder auto layout',
    'a template no-placeholder inspection no longer enables obstacle-avoidance auto layout',
    'template preflight exposes reliable/none/unknown states without confidence fields',
    'combo and self-select note skuLayout calls pass policy decisions',
    'SKU runtime preflight blocks stale export naming contracts',
    'combo and self-select note failures preserve UXP data.errors and planner blockers',
    'policy decisions expose no confidence or raw image payloads'
  ]
}, null, 2));
