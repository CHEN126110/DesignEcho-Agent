#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function assertNoNestedModalBehavior(relativePath, source) {
  const forbidden = /modalBehavior\s*:\s*['"](?:execute|fail)['"]/;
  assert(
    !forbidden.test(source),
    `${relativePath} must not pass modalBehavior execute/fail inside executeAsModal scopes`
  );
}

function assertBatchPlayNoDialog(relativePath, source) {
  const batchPlayCount = countMatches(source, /action\.batchPlay\s*\(/g);
  const synchronousCount = countMatches(source, /synchronousExecution\s*:\s*true/g);
  const noDialogCount = countMatches(source, /_options\s*:\s*\{\s*dialogOptions\s*:\s*['"]dontDisplay['"]\s*\}/g);

  assert(batchPlayCount > 0, `${relativePath} should contain audited batchPlay writes`);
  assert(
    synchronousCount >= batchPlayCount,
    `${relativePath} batchPlay writes should be synchronous`,
    { batchPlayCount, synchronousCount }
  );
  assert(
    noDialogCount >= batchPlayCount,
    `${relativePath} batchPlay descriptors should suppress Photoshop native dialogs`,
    { batchPlayCount, noDialogCount }
  );
}

function assertStructuredFailure(relativePath, source) {
  assert(
    source.includes('createToolFailureResult'),
    `${relativePath} should use the shared structured failure envelope`
  );
  assert(
    source.includes('toolName: this.name'),
    `${relativePath} failure envelopes should report the concrete tool name`
  );
  assert(
    !/success\s*:\s*false/.test(source),
    `${relativePath} should not return ad-hoc success=false failures for write errors`
  );
}

function assertNestedTargetResolution(relativePath, source) {
  assert(
    source.includes('function findLayerById') && source.includes('function resolveLayer'),
    `${relativePath} should resolve target layers through shared nested traversal helpers`
  );
  assert(
    source.includes('const nested = findLayerById(layer, id);'),
    `${relativePath} findLayerById should traverse nested groups, not only top-level layers`
  );
}

function main() {
  const files = [
    'src/tools/layer/layer-properties.ts',
    'src/tools/layer/layer-effects.ts'
  ];

  for (const file of files) {
    const source = readSource(file);
    assert(source.includes('executeAsModal'), `${file} should execute Photoshop writes inside executeAsModal`);
    assertStructuredFailure(file, source);
    assertNestedTargetResolution(file, source);
    assertNoNestedModalBehavior(file, source);
    assertBatchPlayNoDialog(file, source);
  }

  console.log(JSON.stringify({
    success: true,
    checks: [
      'layer property/effect tools keep structured failure envelopes',
      'layer property/effect tools resolve nested target layers',
      'layer property/effect batchPlay writes are synchronous',
      'layer property/effect batchPlay descriptors suppress Photoshop dialogs',
      'layer property/effect tools do not use nested modalBehavior execute/fail'
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
