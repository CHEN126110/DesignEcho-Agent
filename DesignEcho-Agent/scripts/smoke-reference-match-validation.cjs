#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    jsx: 'react-jsx',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  validateLayoutMatchAction
} = require('../src/renderer/services/skill-executors/layout-replication-match.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const context = {
    targetDoc: { width: 800, height: 1200 },
    currentElements: [
      { id: 101, name: '标题', type: 'text', bounds: { left: 20, top: 20, width: 300, height: 80 } },
      { id: 202, name: '产品图', type: 'pixel', bounds: { left: 120, top: 220, width: 480, height: 620 } }
    ]
  };

  const validMove = validateLayoutMatchAction({
    targetLayerId: 202,
    action: { tool: 'moveLayer', params: { x: 16, y: -8, relative: true } }
  }, context);

  const invalidLayer = validateLayoutMatchAction({
    targetLayerId: 999,
    action: { tool: 'moveLayer', params: { x: 16, y: -8, relative: true } }
  }, context);

  const unsafeNoTarget = validateLayoutMatchAction({
    action: { tool: 'setTextStyle', params: { fontSize: 42, color: '#111111' } }
  }, context);

  const unsafeOutOfBounds = validateLayoutMatchAction({
    action: { tool: 'createRectangle', params: { x: 2000, y: 100, width: 300, height: 120 } }
  }, context);

  const unsafeOpacity = validateLayoutMatchAction({
    targetLayerId: 101,
    action: { tool: 'setLayerOpacity', params: { opacity: 180 } }
  }, context);

  const validCreateText = validateLayoutMatchAction({
    action: { tool: 'createTextLayer', params: { content: '卖点标题', x: 80, y: 160, fontSize: 36 } }
  }, context);

  const validStroke = validateLayoutMatchAction({
    targetLayerId: 202,
    action: { tool: 'addStroke', params: { color: { r: 212, g: 175, b: 55 }, size: 4, position: 'inside', opacity: 100 } }
  }, context);

  const validDropShadow = validateLayoutMatchAction({
    targetLayerId: 202,
    action: { tool: 'addDropShadow', params: { color: { r: 0, g: 0, b: 0 }, opacity: 28, angle: 120, distance: 5, spread: 0, size: 12 } }
  }, context);

  const invalidDropShadow = validateLayoutMatchAction({
    targetLayerId: 202,
    action: { tool: 'addDropShadow', params: { color: '#000000', opacity: 128 } }
  }, context);

  const invalidStrokeColor = validateLayoutMatchAction({
    targetLayerId: 202,
    action: { tool: 'addStroke', params: { color: '#D4AF37', size: 4 } }
  }, context);

  assert(validMove.valid === true && validMove.targetLayerId === 202, `valid move should pass: ${JSON.stringify(validMove)}`);
  assert(invalidLayer.valid === false && /999/.test(invalidLayer.reason || ''), `invalid layer should fail: ${JSON.stringify(invalidLayer)}`);
  assert(unsafeNoTarget.valid === false && /缺少目标图层/.test(unsafeNoTarget.reason || ''), `no-target style action should fail: ${JSON.stringify(unsafeNoTarget)}`);
  assert(unsafeOutOfBounds.valid === false && /超出/.test(unsafeOutOfBounds.reason || ''), `out-of-bounds rectangle should fail: ${JSON.stringify(unsafeOutOfBounds)}`);
  assert(unsafeOpacity.valid === false && /0-100/.test(unsafeOpacity.reason || ''), `unsafe opacity should fail: ${JSON.stringify(unsafeOpacity)}`);
  assert(validCreateText.valid === true, `valid create text should pass: ${JSON.stringify(validCreateText)}`);
  assert(validStroke.valid === true && validStroke.toolName === 'addStroke', `valid stroke should pass: ${JSON.stringify(validStroke)}`);
  assert(validDropShadow.valid === true && validDropShadow.toolName === 'addDropShadow', `valid drop shadow should pass: ${JSON.stringify(validDropShadow)}`);
  assert(invalidDropShadow.valid === false && /RGB color|0-100/.test(invalidDropShadow.reason || ''), `invalid drop shadow should fail: ${JSON.stringify(invalidDropShadow)}`);
  assert(invalidStrokeColor.valid === false && /RGB color/.test(invalidStrokeColor.reason || ''), `invalid stroke color should fail: ${JSON.stringify(invalidStrokeColor)}`);

  return {
    success: true,
    cases: {
      validMove,
      invalidLayer,
      unsafeNoTarget,
      unsafeOutOfBounds,
      unsafeOpacity,
      validCreateText,
      validStroke,
      validDropShadow,
      invalidDropShadow,
      invalidStrokeColor
    }
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
