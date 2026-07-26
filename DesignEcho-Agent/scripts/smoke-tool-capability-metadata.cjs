'use strict';

/**
 * Tool Capability metadata smoke.
 *
 * Guards the current eligible runtime surface against false
 * legacy_unclassified debt while preserving an explicit fallback for future
 * Tools that have not yet entered the shared semantics source.
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, 'src', 'shared', 'agent-runtime-v5');
const agentRuntimeRoot = path.join(root, 'src', 'renderer', 'services', 'agent-runtime');
const executorRoot = path.join(root, 'src', 'renderer', 'services', 'skill-executors');

const {
  buildRuntimeCapabilityInventory
} = require(path.join(runtimeRoot, 'capability-resolver.ts'));
const {
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  getDefaultAgentTools
} = require(path.join(agentRuntimeRoot, 'tool-schemas.ts'));
const {
  buildSkillToolSchemas
} = require(path.join(executorRoot, 'skill-tools.ts'));
const {
  getPhotoshopToolSkillSemantics
} = require(path.join(root, 'src', 'shared', 'photoshop-tool-skill.ts'));

function unique(values) {
  return Array.from(new Set(values));
}

function findProviderEntry(inventory, toolName) {
  return inventory.find((entry) => (
    entry.providerToolNames.includes(toolName)
  ));
}

function assertSemanticEntry(inventory, expected) {
  const entry = findProviderEntry(inventory, expected.toolName);
  const semantics = getPhotoshopToolSkillSemantics(expected.toolName, {});
  assert.ok(entry, `missing Tool provider inventory entry: ${expected.toolName}`);
  assert.ok(semantics, `missing Tool semantic source entry: ${expected.toolName}`);
  assert.strictEqual(semantics.capabilityId, expected.capabilityId);
  assert.strictEqual(semantics.capabilityKind, expected.capabilityKind);
  assert.strictEqual(semantics.sideEffect, expected.sideEffect);
  assert.strictEqual(
    semantics.requiresPhotoshopConnection,
    expected.requiresPhotoshopConnection
  );
  assert.strictEqual(semantics.requiresOpenDocument, expected.requiresOpenDocument);
  assert.ok(semantics.userIntentBoundary, expected.toolName);
  assert.ok(semantics.verifyWith.length > 0, expected.toolName);
}

const workflowBridgeTools = buildSkillToolSchemas();
const candidateTools = [
  ...getDefaultAgentTools(),
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  ...workflowBridgeTools
];
const candidateNames = candidateTools.map((tool) => tool.name);
const inventory = buildRuntimeCapabilityInventory({
  executableToolNames: candidateNames,
  workflowBridgeNames: workflowBridgeTools.map((tool) => tool.name)
});
const providedNames = unique(inventory.flatMap((entry) => entry.providerToolNames));
const semanticEntries = inventory.filter((entry) => entry.source === 'tool_semantics');
const unclassifiedEntries = inventory.filter((entry) => entry.source === 'legacy_unclassified_tool');

assert.deepStrictEqual(
  candidateNames.filter((name) => !providedNames.includes(name)),
  [],
  'every eligible Tool and Skill must remain discoverable'
);
assert.strictEqual(
  unclassifiedEntries.length,
  0,
  `current reviewed catalog must not be falsely unclassified: ${JSON.stringify(unclassifiedEntries)}`
);
assert.ok(semanticEntries.length > 0, 'reviewed Tool semantic metadata must remain present');

for (const entry of semanticEntries) {
  assert.ok(entry.semanticMetadata, entry.capabilityId);
  assert.notStrictEqual(entry.semanticMetadata.capabilityKind, 'unknown', entry.capabilityId);
  assert.ok(entry.semanticMetadata.userIntentBoundary, entry.capabilityId);
  assert.ok(entry.semanticMetadata.verifyWith.length > 0, entry.capabilityId);
}

for (const expected of [
  {
    toolName: 'fitLayerSubjectToRegion',
    capabilityId: 'photoshop.write.fitLayerSubjectToRegion',
    capabilityKind: 'photoshop_write',
    sideEffect: 'photoshop_write',
    requiresPhotoshopConnection: true,
    requiresOpenDocument: true
  },
  {
    toolName: 'analyzeAssetContent',
    capabilityId: 'project.read.analyzeAssetContent',
    capabilityKind: 'read_only_observation',
    sideEffect: 'project_read',
    requiresPhotoshopConnection: false,
    requiresOpenDocument: false
  },
  {
    toolName: 'describeImage',
    capabilityId: 'observation.read.describeImage',
    capabilityKind: 'read_only_observation',
    sideEffect: 'none',
    requiresPhotoshopConnection: false,
    requiresOpenDocument: false
  },
  {
    toolName: 'fetchWebPageDesignContent',
    capabilityId: 'knowledge.search.fetchWebPageDesignContent',
    capabilityKind: 'knowledge_search',
    sideEffect: 'external_request',
    requiresPhotoshopConnection: false,
    requiresOpenDocument: false
  },
  {
    toolName: 'exportMainImageDocuments',
    capabilityId: 'delivery.export.exportMainImageDocuments',
    capabilityKind: 'save_export',
    sideEffect: 'file_export',
    requiresPhotoshopConnection: true,
    requiresOpenDocument: true
  },
  {
    toolName: 'generateImage',
    capabilityId: 'external.generate.generateImage',
    capabilityKind: 'external_generation',
    sideEffect: 'external_request',
    requiresPhotoshopConnection: false,
    requiresOpenDocument: false
  },
  {
    toolName: 'closeDocument',
    capabilityId: 'photoshop.state.closeDocument',
    capabilityKind: 'stateful_context',
    sideEffect: 'photoshop_state',
    requiresPhotoshopConnection: true,
    requiresOpenDocument: false
  },
  {
    toolName: 'navigateBrowserTab',
    capabilityId: 'context.state.navigateBrowserTab',
    capabilityKind: 'stateful_context',
    sideEffect: 'photoshop_state',
    requiresPhotoshopConnection: false,
    requiresOpenDocument: false
  }
]) {
  assertSemanticEntry(inventory, expected);
}

const futureInventory = buildRuntimeCapabilityInventory({
  executableToolNames: ['futureUnreviewedTool']
});
assert.deepStrictEqual(futureInventory, [{
  capabilityId: 'legacy.tool.futureUnreviewedTool',
  kind: 'tool',
  providerToolNames: ['futureUnreviewedTool'],
  source: 'legacy_unclassified_tool'
}]);

console.log(JSON.stringify({
  success: true,
  candidateToolCount: candidateNames.length,
  inventoryCapabilityCount: inventory.length,
  semanticToolCount: semanticEntries.length,
  currentUnclassifiedCount: unclassifiedEntries.length,
  futureUnknownFallbackCount: futureInventory.length
}, null, 2));
