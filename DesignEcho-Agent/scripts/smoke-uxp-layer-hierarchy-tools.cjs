#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const uxpRoot = path.join(repoRoot, 'DesignEcho-UXP');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function readText(relativePath) {
  return fs.readFileSync(path.join(uxpRoot, relativePath), 'utf8');
}

function run() {
  const toolPath = path.join(uxpRoot, 'src/tools/layout/move-layer-to-group.ts');
  assert(fs.existsSync(toolPath), 'moveLayerToGroup UXP tool file must exist', { toolPath });

  const toolSource = readText('src/tools/layout/move-layer-to-group.ts');
  const registrySource = readText('src/tools/registry.ts');

  assert(toolSource.includes("name = 'moveLayerToGroup'"), 'tool must expose moveLayerToGroup name');
  assert(toolSource.includes('ElementPlacement?.PLACEINSIDE'), 'tool must use Photoshop PLACEINSIDE semantics');
  assert(toolSource.includes('Cannot move a layer or group into itself or its descendant'), 'tool must block self/descendant moves');
  assert(toolSource.includes('targetGroupId'), 'tool schema must require targetGroupId');
  assert(registrySource.includes("import { MoveLayerToGroupTool } from './layout/move-layer-to-group';"), 'registry must import MoveLayerToGroupTool');
  assert(registrySource.includes('new MoveLayerToGroupTool()'), 'registry must register MoveLayerToGroupTool');

  console.log('smoke-uxp-layer-hierarchy-tools passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
