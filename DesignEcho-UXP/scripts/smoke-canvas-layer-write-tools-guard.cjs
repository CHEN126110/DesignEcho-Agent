#!/usr/bin/env node

// 画布几何 / 高斯模糊 / 图层蒙版工具执行守卫：
// 这 6 个写工具必须抑制对话框、同步执行、归一化失败、读回验证（蒙版），
// 否则命令不可用时可能弹出原生模态框阻塞 UXP 消息循环，或假报成功。
// 与 smoke-adjustment-layers-execution-guard 同类。

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const canvasSourcePath = path.join(root, 'src', 'tools', 'canvas', 'canvas-crop-resize.ts');
const layerSourcePath = path.join(root, 'src', 'tools', 'layer', 'blur-and-mask.ts');
const registrySourcePath = path.join(root, 'src', 'tools', 'registry.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

const CANVAS_TOOLS = ['cropDocument', 'resizeCanvas', 'resizeImage'];
const LAYER_TOOLS = ['gaussianBlurLayer', 'createLayerMask', 'deleteLayerMask'];

function main() {
  const canvasSource = fs.readFileSync(canvasSourcePath, 'utf8');
  const layerSource = fs.readFileSync(layerSourcePath, 'utf8');
  const registrySource = fs.readFileSync(registrySourcePath, 'utf8');

  for (const tool of [...CANVAS_TOOLS, ...LAYER_TOOLS]) {
    assert(
      CANVAS_TOOLS.includes(tool)
        ? canvasSource.includes(`name = '${tool}'`)
        : layerSource.includes(`name = '${tool}'`),
      `tool source should expose ${tool}`
    );
    assert(
      registrySource.includes(`new ${tool.charAt(0).toUpperCase()}${tool.slice(1)}Tool()`),
      `registry should register ${tool}`
    );
  }

  for (const [label, source] of [['canvas-crop-resize', canvasSource], ['blur-and-mask', layerSource]]) {
    assert(
      source.includes('createToolFailureResult'),
      `${label} should return normalized tool failures`
    );
    assert(
      source.includes('core.executeAsModal'),
      `${label} writes should run inside executeAsModal`
    );
    assert(
      source.includes("dialogOptions: 'dontDisplay'"),
      `${label} batchPlay calls should suppress Photoshop action dialogs`
    );
    assert(
      source.includes('app.activeDocument'),
      `${label} should guard on an active document before writing`
    );
  }

  assert(
    canvasSource.includes('synchronousExecution: true'),
    'canvas geometry batchPlay calls should run synchronously inside executeAsModal'
  );
  assert(
    layerSource.includes('synchronousExecution: true'),
    'blur/mask batchPlay calls should run synchronously inside executeAsModal'
  );

  // 蒙版写操作必须读回验证，不允许只凭命令返回就宣称成功
  assert(
    layerSource.includes('userMaskEnabled'),
    'layer mask tools should verify the mask state via userMaskEnabled readback'
  );
  assert(
    layerSource.includes('读回验证未看到蒙版') || layerSource.includes('读回验证蒙版仍存在'),
    'layer mask tools should fail honestly when readback contradicts the write'
  );

  // 裁切矩形为空必须 fail closed，不允许交给原生行为
  assert(
    canvasSource.includes('裁切矩形为空'),
    'cropDocument should reject empty crop rectangles before calling batchPlay'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'all six write tools are exposed by their source files and registered',
      'writes run inside executeAsModal with dialogs suppressed and normalized failures',
      'layer mask writes are verified through userMaskEnabled readback',
      'cropDocument rejects empty rectangles fail-closed'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ success: false, error: error.message, details: error.details }, null, 2));
  process.exit(1);
}
