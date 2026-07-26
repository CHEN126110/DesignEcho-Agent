#!/usr/bin/env node

require('ts-node/register/transpile-only');

const assert = require('assert');
const { checkToolDependencies } = require('../src/shared/config/tool-dependencies.ts');

function assertValid(toolName, params, message) {
  const result = checkToolDependencies(toolName, [], params);
  assert.strictEqual(result.valid, true, `${message}: ${JSON.stringify(result)}`);
}

function assertBlocked(toolName, params, message) {
  const result = checkToolDependencies(toolName, [], params);
  assert.strictEqual(result.valid, false, `${message}: ${JSON.stringify(result)}`);
  assert(result.missingDependencies.includes('selectLayer'), `${message}: selectLayer should remain required`);
}

assertValid('groupLayers', { layerIds: [101] }, 'explicit layerIds should satisfy groupLayers target dependency');
assertValid('moveLayer', { layerId: 101, x: 4, y: 8, relative: true }, 'explicit layerId should satisfy moveLayer target dependency');
assertValid('reorderLayer', { layerId: 101, action: 'top' }, 'explicit layerId should satisfy reorderLayer target dependency');
assertValid('reorderLayer', { action: 'top', useCurrentSelection: true }, 'current selection should satisfy reorderLayer target dependency');
assertValid('renameLayer', { layerId: 101, newName: '文案_1' }, 'explicit layerId should satisfy renameLayer target dependency');
assertValid('deleteLayer', { layerId: 101 }, 'explicit layerId should satisfy deleteLayer target dependency');
assertValid('setTextStyle', { layerId: 101, fontSize: 24 }, 'explicit layerId should satisfy setTextStyle target dependency');
assertValid('setTextContent', { updates: [{ layerId: 101, content: '测试' }] }, 'batch text updates should satisfy setTextContent target dependency');
assertValid('getTextContent', { layerIds: [101, 102] }, 'explicit layerIds should satisfy getTextContent target dependency');
assertValid('createClippingMask', { layerId: 101 }, 'explicit layerId should satisfy createClippingMask target dependency');

assertBlocked('groupLayers', { groupName: '文案' }, 'groupLayers without layerIds still needs selected layers');
assertBlocked('moveLayer', { x: 4, y: 8 }, 'moveLayer without layerId still needs selected layer');
assertBlocked('reorderLayer', { action: 'top' }, 'reorderLayer without layerId still needs selected layer');
assertBlocked('setTextStyle', { fontSize: 24 }, 'setTextStyle without layerId still needs selected text layer');
assertBlocked('createClippingMask', {}, 'createClippingMask without layerId still needs selected layer');
assertBlocked('alignLayers', { layerIds: [101, 102], alignment: 'left' }, 'unsupported param targeting should not bypass dependencies');

console.log('[smoke-tool-dependencies-param-targets] pass');
