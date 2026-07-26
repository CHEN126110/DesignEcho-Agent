#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const toolFiles = [
  path.join(root, 'src', 'tools', 'layout', 'align-layers.ts'),
  path.join(root, 'src', 'tools', 'layout', 'distribute-layers.ts'),
  path.join(root, 'src', 'tools', 'layout', 'select-layer.ts'),
  path.join(root, 'src', 'tools', 'layout', 'focus-layer.ts')
];

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function findBareBatchPlayOptions(source) {
  return source.match(/action\.batchPlay\(\[[\s\S]*?\],\s*\{\s*\}\s*\)/g) || [];
}

function main() {
  const checks = [];

  for (const filePath of toolFiles) {
    const source = readSource(filePath);
    const label = path.relative(root, filePath).replaceAll(path.sep, '/');

    assert(
      source.includes('createToolFailureResult'),
      `${label} should return normalized tool failures`
    );
    assert(
      !source.includes('error instanceof Error ? error.message'),
      `${label} should not expose raw Error.message as the whole tool error`
    );
    assert(
      findBareBatchPlayOptions(source).length === 0,
      `${label} should not use bare batchPlay option objects for Photoshop write/select operations`
    );
    assert(
      !source.includes("modalBehavior: 'fail'"),
      `${label} should not use modalBehavior fail inside executeAsModal because Photoshop is already in a modal scope`
    );
    assert(
      source.includes('synchronousExecution: true'),
      `${label} should use synchronous batchPlay execution inside executeAsModal`
    );
    assert(
      source.includes("dialogOptions: 'dontDisplay'"),
      `${label} should suppress Photoshop action dialogs at the descriptor level`
    );

    checks.push(`${label} uses executeAsModal-safe no-dialog batchPlay and normalized failures`);
  }

  console.log(JSON.stringify({ success: true, checks }, null, 2));
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
