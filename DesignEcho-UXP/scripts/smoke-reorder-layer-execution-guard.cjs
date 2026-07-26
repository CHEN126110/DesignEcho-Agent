#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'layout', 'reorder-layer.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const helperStart = source.indexOf('async function selectLayerById');
  assert(helperStart >= 0, 'reorder-layer should keep a shared selectLayerById helper');
  const helperEnd = source.indexOf('function getElementPlacement', helperStart);
  const helperBody = source.slice(helperStart, helperEnd > helperStart ? helperEnd : undefined);

  assert(
    !helperBody.includes("modalBehavior: 'fail'"),
    'reorder-layer selectLayerById should not use modalBehavior fail inside executeAsModal'
  );
  assert(
    helperBody.includes('synchronousExecution: true'),
    'reorder-layer selectLayerById should use synchronous batchPlay execution'
  );
  assert(
    source.includes('createToolFailureResult'),
    'reorder-layer tools should return normalized tool failures'
  );
  assert(
    !source.includes('error instanceof Error ? error.message'),
    'reorder-layer tools should not expose raw Error.message as the whole tool error'
  );
  assert(
    source.includes('export class ReorderLayerTool'),
    'ReorderLayerTool should exist'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'reorder-layer target selection is executeAsModal-safe',
      'reorder-layer keeps failures inside normalized tool failure path'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
