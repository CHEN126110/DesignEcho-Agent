#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'layer', 'transform-layer.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert(
    source.includes('export class TransformLayerTool'),
    'TransformLayerTool should exist'
  );
  assert(
    !source.includes('忽略选择错误，继续尝试变换'),
    'TransformLayerTool must not continue after target-layer selection fails'
  );
  assert(
    !source.includes('图层选择警告'),
    'TransformLayerTool must not downgrade target-layer selection failure to a warning'
  );
  assert(
    source.includes('createToolFailureResult'),
    'TransformLayerTool should return normalized tool failure payloads'
  );
  assert(
    !source.includes("modalBehavior: 'fail'"),
    'TransformLayerTool must not pass modalBehavior fail inside executeAsModal scopes'
  );
  assert(
    source.includes('synchronousExecution: true'),
    'TransformLayerTool batchPlay calls should use synchronous execution inside executeAsModal'
  );
  assert(
    source.includes("dialogOptions: 'dontDisplay'"),
    'TransformLayerTool batchPlay descriptors should suppress Photoshop native dialogs'
  );
  assert(
    !source.includes("error.message || '变换失败'"),
    'TransformLayerTool must not collapse structured Photoshop errors into raw error.message'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'TransformLayerTool stops when target-layer selection fails',
      'TransformLayerTool does not downgrade selection failure to a warning',
      'TransformLayerTool uses normalized tool failure payloads',
      'TransformLayerTool avoids modalBehavior fail inside executeAsModal',
      'TransformLayerTool suppresses native Photoshop dialogs on descriptors'
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
