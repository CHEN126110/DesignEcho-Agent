#!/usr/bin/env node

// 调色 / 调整图层执行守卫：
// 调整图层以 make adjustmentLayer 创建，必须抑制对话框、同步执行、归一化失败，
// 否则命令不可用时会弹出原生「命令'建立'当前不可用」模态框并阻塞 UXP 消息循环。
// 与 smoke-create-shape-execution-guard 同类。

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'layer', 'adjustment-layers.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

const EXPECTED_TOOLS = [
  'addBrightnessContrastAdjustment',
  'addHueSaturationAdjustment',
  'addLevelsAdjustment',
  'addColorBalanceAdjustment',
  'addVibranceAdjustment',
  'addPhotoFilterAdjustment'
];

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');

  for (const tool of EXPECTED_TOOLS) {
    assert(source.includes(`name = '${tool}'`), `adjustment-layers should expose ${tool}`);
  }

  assert(
    source.includes('createToolFailureResult'),
    'adjustment-layers should return normalized tool failures'
  );
  assert(
    !source.includes('error instanceof Error ? error.message'),
    'adjustment-layers should not expose raw Error.message as the whole tool error'
  );
  assert(
    !source.includes("], { commandName: 'DesignEcho:"),
    'adjustment-layers batchPlay calls should not use commandName-only options'
  );
  assert(
    source.includes('synchronousExecution: true'),
    'adjustment-layers batchPlay calls should run synchronously inside executeAsModal'
  );
  assert(
    source.includes("dialogOptions: 'dontDisplay'"),
    'adjustment-layers make descriptors should suppress Photoshop action dialogs'
  );
  assert(
    source.includes('app.activeDocument'),
    'adjustment-layers should guard on an active document before writing'
  );
  // 调整图层是图层类，必须用 _target adjustmentLayer + using（不是文档类的 new:）。
  assert(
    /_ref:\s*'adjustmentLayer'/.test(source) && /_obj:\s*'adjustmentLayer'/.test(source),
    'adjustment-layers should make an adjustmentLayer via _target+using'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      `${EXPECTED_TOOLS.length} adjustment-layer tools exposed`,
      'adjustment-layers use normalized failures',
      'adjustment-layers batchPlay calls are executeAsModal-safe and no-dialog',
      'adjustment-layers guard on an active document'
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
