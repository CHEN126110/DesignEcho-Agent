'use strict';

/**
 * smoke: v5 tool capability bridge
 *
 * Skill manifest tools are namespaced capability declarations. The legacy
 * renderer Agent still exposes executable tool schema names such as
 * getDocumentInfo/renderLayout. This bridge must make that difference explicit
 * without putting skill IDs into tool lists or pretending the legacy tools have
 * already been renamed.
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const { getManifestByTaskType, listSkillManifests } = require(path.join(RT, 'skill-runtime.ts'));
const {
  buildLegacyToolCapabilityBridge,
  summarizeLegacyToolCapabilityBridge
} = require(path.join(RT, 'tool-capability-bridge.ts'));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('smoke: v5-tool-capability-bridge');

const detailManifest = getManifestByTaskType('ecommerce.detail_page.v1');
const legacyToolNames = [
  'createInteractiveCard',
  'declareDesignIntent',
  'delegateToAgent',
  'runDesignTeamPipeline',
  'listProjectResources',
  'searchProjectResources',
  'getDesignProjectState',
  'updateDesignProjectState',
  'getDesignPrinciples',
  'getMainImageDesignFramework',
  'getDetailPageDesignFramework',
  'analyzePsdDesignSource',
  'measureReferenceComposition',
  'renderLayout',
  'searchEagleReferences',
  'analyzeEagleReference',
  'searchDesignKnowledge',
  'getDocumentInfo',
  'getDocumentSnapshot',
  'getLayerHierarchy',
  'findLayers',
  'getAllTextLayers',
  'getLayerProperties',
  'getClippingMaskInfo',
  'getAllClippingMasks',
  'getTextContent',
  'getTextStyle',
  'getSmartObjectInfo',
  'getSmartObjectLayers',
  'getCanvasSnapshot',
  'getAcceptanceSnapshot',
  'getAnnotatedSnapshot',
  'listDocuments',
  'switchDocument',
  'getLayerBounds',
  'parseDetailPageTemplate',
  'detectLayerIssues',
  'fixLayerIssues',
  'matchDetailPageContent',
  'fillDetailPage',
  'createDocument',
  'createRectangle',
  'createEllipse',
  'createGroup',
  'moveLayerToGroup',
  'createClippingMask',
  'convertToSmartObject',
  'editSmartObjectContents',
  'closeDocument',
  'placeImage',
  'transformLayer',
  'createTextLayer',
  'setTextContent',
  'setTextStyle',
  'saveDocument',
  'exportDetailPageSlices',
  'quickExport'
];

check('every registered manifest seed maps against the eligible runtime catalog', () => {
  for (const manifest of listSkillManifests()) {
    const bridge = buildLegacyToolCapabilityBridge({
      manifest,
      executableToolNames: legacyToolNames
    });
    assert.deepStrictEqual(
      bridge.unmappedCapabilities,
      [],
      `${manifest.skill_id}: ${JSON.stringify(bridge.unmappedCapabilities)}`
    );
    assert.ok(bridge.executableTools.length > 0, manifest.skill_id);
  }
});

check('detail-page capability declarations map to explicit legacy executable tools', () => {
  const bridge = buildLegacyToolCapabilityBridge({
    manifest: detailManifest,
    executableToolNames: legacyToolNames
  });

  assert.strictEqual(bridge.version, 'legacy-tool-capability-bridge/v0');
  assert.strictEqual(bridge.skillId, 'ecommerce.detail_page');
  assert.strictEqual(bridge.taskType, 'ecommerce.detail_page.v1');
  assert.deepStrictEqual(bridge.unmappedCapabilities, []);
  assert.ok(bridge.mappedCapabilities.includes('photoshop.read.getDocumentSummary'));
  assert.ok(bridge.executableTools.includes('getDocumentInfo'));
  assert.ok(bridge.entries.some((entry) =>
    entry.capability === 'preview.renderStoryboard'
    && entry.executableTools.includes('renderLayout')
  ));
  assert.ok(bridge.entries.some((entry) =>
    entry.capability === 'photoshop.read.inspectDetailPageTemplate'
    && entry.executableTools.includes('parseDetailPageTemplate')
  ));
  assert.ok(bridge.entries.some((entry) =>
    entry.capability === 'photoshop.apply.fillDetailPageTemplate'
    && entry.executableTools.includes('fillDetailPage')
  ));
});

check('bridge keeps Skill, capability, and executable tool names separated', () => {
  const bridge = buildLegacyToolCapabilityBridge({
    manifest: detailManifest,
    executableToolNames: legacyToolNames
  });

  for (const entry of bridge.entries) {
    assert.ok(entry.capability.includes('.'), `capability should be namespaced: ${entry.capability}`);
    assert.notStrictEqual(entry.capability, detailManifest.skill_id);
    assert.notStrictEqual(entry.capability, detailManifest.task_type);
    for (const toolName of entry.executableTools) {
      assert.ok(!toolName.startsWith('skill.'), `legacy executable tool must not be a skill id: ${toolName}`);
      assert.notStrictEqual(toolName, detailManifest.skill_id);
      assert.notStrictEqual(toolName, detailManifest.task_type);
    }
  }
});

check('missing legacy executable tool is explicit and does not mutate manifest tools', () => {
  const bridge = buildLegacyToolCapabilityBridge({
    manifest: detailManifest,
    executableToolNames: legacyToolNames.filter((name) => name !== 'exportDetailPageSlices' && name !== 'quickExport')
  });

  assert.ok(bridge.unmappedCapabilities.includes('delivery.exportSlices'), JSON.stringify(bridge, null, 2));
  assert.ok(detailManifest.available_tools.includes('delivery.exportSlices'));
  assert.ok(!detailManifest.available_tools.includes('exportDetailPageSlices'));
});

check('summary is compact model context, not a user-facing hardcoded answer', () => {
  const bridge = buildLegacyToolCapabilityBridge({
    manifest: detailManifest,
    executableToolNames: legacyToolNames
  });
  const summary = summarizeLegacyToolCapabilityBridge(bridge);

  assert.ok(summary.includes('legacy-tool-capability-bridge/v0'), summary);
  const documentSummaryLine = summary.split('\n').find((line) => line.startsWith('photoshop.read.getDocumentSummary ->')) || '';
  assert.ok(documentSummaryLine.includes('getDocumentInfo'), summary);
  assert.ok(!summary.includes('我可以协助这些设计工作'), summary);
  assert.ok(!summary.includes('已完成'), summary);
});
