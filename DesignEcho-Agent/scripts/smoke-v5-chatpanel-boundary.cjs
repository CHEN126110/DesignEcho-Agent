'use strict';

/**
 * smoke: v5 ChatPanel boundary
 *
 * ChatPanel is a UI shell. It may render cards and dispatch card actions, but it
 * must not own the v5 design workflow, call the planner model directly, or
 * return R1 planning text before the request enters the Agent/ReAct runtime.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const chatPanelPath = path.join(repoRoot, 'src', 'renderer', 'components', 'ChatPanel.tsx');
const enginePath = path.join(repoRoot, 'src', 'renderer', 'services', 'design-agent', 'engine.ts');

const chatPanel = fs.readFileSync(chatPanelPath, 'utf8');
const engine = fs.readFileSync(enginePath, 'utf8');

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('smoke: v5-chatpanel-boundary');

check('ChatPanel does not import v5 workflow orchestration or planner-model APIs', () => {
  const forbidden = [
    'resolveDesignTaskTypeSpec',
    'getDesignTaskTypeSpec',
    'buildDesignTaskTypePromptSection',
    'buildProjectDesignUnderstandingSummary',
    'getManifestByTaskType',
    'decideDetailPagePlanning',
    'getPlannerModelCaller',
    'setPlannerModelCaller',
    'invokeAndCollect',
    'ModelStreamEvent'
  ];

  for (const token of forbidden) {
    assert.ok(!chatPanel.includes(token), `ChatPanel must not own ${token}`);
  }
});

check('ChatPanel has no direct v5 design workflow branch before unified Agent execution', () => {
  const forbidden = [
    'v5ActiveDesignRef',
    'v5DesignSpec',
    'v5DesignManifest',
    'v5 设计工作流：代码控制渲染通路',
    '完全绕开 engine.run',
    'v5SystemPrompt',
    'v5:r1-stream',
    'v5:visual-observation-gate',
    'v5:no-model',
    'v5:r1-error',
    '设计思考失败'
  ];

  for (const token of forbidden) {
    assert.ok(!chatPanel.includes(token), `ChatPanel still contains direct v5 workflow token: ${token}`);
  }

  assert.ok(
    chatPanel.includes('processWithUnifiedAgent(agentContext'),
    'ChatPanel should continue to enter the unified Agent runtime.'
  );
});

check('ChatPanel may keep visual observation card actions as UI-only dispatch', () => {
  assert.ok(
    chatPanel.includes('submitVisualObservationCardAction'),
    'UI card action controller may remain in ChatPanel.'
  );
  assert.ok(
    chatPanel.includes("case 'submitVisualObservationCard'"),
    'Visual observation card submit action should still be handled by the UI action dispatcher.'
  );
});

check('DesignAgentEngine no longer documents v5 as moved out to ChatPanel', () => {
  assert.ok(
    !engine.includes('v5 设计工作流（R1 真自检）已上移到 ChatPanel'),
    'Engine must not treat ChatPanel as the v5 workflow owner.'
  );
  assert.ok(
    !engine.includes('完全绕开本 engine.run'),
    'Engine comments must not document a bypass around the Agent runtime.'
  );
});

console.log('\n✅ v5-chatpanel-boundary smoke 全部通过');
