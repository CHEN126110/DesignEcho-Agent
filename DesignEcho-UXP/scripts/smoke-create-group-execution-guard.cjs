#!/usr/bin/env node

// create-group 执行守卫：防止 make layerSection 弹出原生
// "命令'建立'当前不可用" 模态框（该模态框会阻塞 UXP 插件消息循环，
// 进而让上层 readiness 检查超时、误报 Photoshop 不可用）。
// 与 smoke-create-shape-execution-guard / smoke-reorder-layer-execution-guard 同类。

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'layout', 'create-group.ts');

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
    source.includes('createToolFailureResult'),
    'create-group should return normalized tool failures'
  );
  assert(
    !source.includes('error instanceof Error ? error.message'),
    'create-group should not expose raw Error.message as the whole tool error'
  );
  assert(
    !source.includes("], { commandName: 'DesignEcho:"),
    'create-group batchPlay calls should not use commandName-only options (commandName belongs to executeAsModal, not batchPlay)'
  );
  assert(
    source.includes('synchronousExecution: true'),
    'create-group batchPlay calls should run synchronously inside executeAsModal'
  );

  // 每个 make/set 描述符都必须抑制对话框，否则命令不可用时会弹出原生模态框。
  const makeCount = (source.match(/_obj:\s*'make'/g) || []).length;
  const dialogCount = (source.match(/dialogOptions:\s*'dontDisplay'/g) || []).length;
  assert(
    makeCount > 0,
    'create-group should contain at least one make descriptor'
  );
  assert(
    dialogCount >= makeCount,
    'every create-group make descriptor should set dialogOptions dontDisplay',
    { makeCount, dialogCount }
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'create-group uses normalized failures',
      'create-group batchPlay calls are executeAsModal-safe and no-dialog',
      `dialogOptions dontDisplay covers all ${makeCount} make descriptor(s)`
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
