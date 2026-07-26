#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImagePhotoshopToolCapabilityMatrix
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-photoshop-tool-capability-matrix.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function run() {
  const currentTools = [
    'transformLayer',
    'moveLayer',
    'getLayerProperties',
    'createGroup',
    'moveLayerToGroup',
    'exportGroup'
  ];
  const matrix = buildMainImagePhotoshopToolCapabilityMatrix({
    availableToolNames: currentTools
  });

  assert(matrix.noPhotoshopWrites === true, 'capability matrix must be no-write', matrix);
  assert(matrix.canClaimOutputQuality === false, 'capability matrix must not claim output quality', matrix);
  assert(
    matrix.supportedCapabilityIds.includes('transform-move-positioning'),
    'transform + move positioning should be supported with current tool set',
    matrix
  );
  assert(
    matrix.supportedCapabilityIds.includes('nested-group-authoring'),
    'nested group authoring should be supported when createGroup + moveLayerToGroup are available',
    matrix
  );
  assert(
    matrix.supportedCapabilityIds.includes('group-scoped-export'),
    'group-scoped export should be supported when exportGroup is available',
    matrix
  );
  assert(
    !matrix.blockers.some((item) => item.includes('nested-group-authoring')),
    'nested group authoring should not be blocked when moveLayerToGroup is available',
    matrix
  );
  assert(
    !matrix.blockers.some((item) => item.includes('group-scoped-export')),
    'group export should not be blocked when exportGroup is available',
    matrix.blockers
  );
  assert(
    !matrix.blockers.some((item) => item.includes('transform-move-positioning')),
    'positioning should not be blocked when transformLayer + moveLayer are available',
    matrix.blockers
  );

  const noMove = buildMainImagePhotoshopToolCapabilityMatrix({
    availableToolNames: currentTools.filter((toolName) => toolName !== 'moveLayer')
  });
  assert(
    noMove.blockedCapabilityIds.includes('transform-move-positioning'),
    'positioning should block when moveLayer is missing',
    noMove
  );
  assert(
    noMove.blockers.some((item) => item.includes('missing_tools=moveLayer')),
    'missing moveLayer should be explicit',
    noMove.blockers
  );

  const noMoveToGroup = buildMainImagePhotoshopToolCapabilityMatrix({
    availableToolNames: currentTools.filter((toolName) => toolName !== 'moveLayerToGroup')
  });
  assert(
    noMoveToGroup.blockedCapabilityIds.includes('nested-group-authoring'),
    'nested group authoring should block without moveLayerToGroup',
    noMoveToGroup
  );
  assert(
    noMoveToGroup.blockers.some((item) => item.includes('missing_tools=moveLayerToGroup')),
    'missing moveLayerToGroup should be explicit',
    noMoveToGroup.blockers
  );

  const noExportGroup = buildMainImagePhotoshopToolCapabilityMatrix({
    availableToolNames: currentTools.filter((toolName) => toolName !== 'exportGroup')
  });
  assert(
    noExportGroup.blockedCapabilityIds.includes('group-scoped-export'),
    'group-scoped export should block without exportGroup',
    noExportGroup
  );
  assert(
    noExportGroup.blockers.some((item) => item.includes('missing_tools=exportGroup')),
    'missing exportGroup should be explicit',
    noExportGroup.blockers
  );

  console.log('smoke-main-image-photoshop-tool-capability-matrix passed');
}

run();
