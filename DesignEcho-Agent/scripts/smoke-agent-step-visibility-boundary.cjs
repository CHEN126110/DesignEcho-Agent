const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  isVisibleAgentProcessEvent,
  isVisibleAgentStepEvent
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-visible-feedback.ts'));
const {
  emitSkillStep
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'skill-step-events.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function makeStep(overrides) {
  return {
    kind: 'verification',
    title: 'SKU 颜色图层读取完成',
    status: 'success',
    ...overrides
  };
}

function assertSkillStepDefaultsToAgentAudience() {
  const events = [];
  emitSkillStep(
    { onStep: (event) => events.push(event) },
    makeStep({})
  );

  assert(events.length === 1, 'emitSkillStep should forward one event.', events);
  assert(events[0].source === 'skill_executor', 'skill executor steps should record their source.', events[0]);
  assert(events[0].audience === 'agent', 'skill executor steps should default to Agent-only audience.', events[0]);

  const explicitUserEvents = [];
  emitSkillStep(
    { onStep: (event) => explicitUserEvents.push(event) },
    makeStep({ source: 'model', audience: 'user' })
  );

  assert(explicitUserEvents[0].source === 'model', 'explicit step source should be preserved.', explicitUserEvents[0]);
  assert(explicitUserEvents[0].audience === 'user', 'explicit user audience should be preserved.', explicitUserEvents[0]);
}

function assertUserVisibilityBoundary() {
  assert(
    !isVisibleAgentProcessEvent(makeStep({ source: 'skill_executor', audience: 'agent' })),
    'Skill/script verification output must not render as a user-facing Agent decision.'
  );
  assert(
    !isVisibleAgentProcessEvent(makeStep({ source: 'agent_runtime', audience: 'agent' })),
    'Runtime diagnostic output must not render as a user-facing Agent decision by default.'
  );
  assert(
    !isVisibleAgentProcessEvent(makeStep({})),
    'Untagged process output must stay hidden until it is explicitly marked user-facing.'
  );
  assert(
    isVisibleAgentProcessEvent(makeStep({ source: 'model' })),
    'Model-authored process output may render as user-facing Agent expression.'
  );
  assert(
    !isVisibleAgentProcessEvent(makeStep({ source: 'skill_executor', audience: 'user' })),
    'Skill/script output must not become user-facing Agent judgment even when it is mis-tagged as user audience.'
  );
  assert(
    !isVisibleAgentProcessEvent(makeStep({ audience: 'user' })),
    'User audience alone must not bypass the source boundary.'
  );
  assert(
    !isVisibleAgentProcessEvent(makeStep({ source: 'agent_runtime', audience: 'user' })),
    'Runtime user audience must still require an explicit user_process visibility marker.'
  );
  assert(
    isVisibleAgentProcessEvent(makeStep({ source: 'agent_runtime', audience: 'user', visibility: 'user_process' })),
    'Explicit runtime user_process events may render as user-facing observation or verification.'
  );
  assert(
    isVisibleAgentProcessEvent(makeStep({ source: 'model', audience: 'user' })),
    'Model-authored user-audience process output may render.'
  );

  assert(
    !isVisibleAgentStepEvent({
      kind: 'tool_started',
      title: '开始处理：置入图片',
      status: 'running',
      toolName: 'placeImage',
      source: 'skill_executor',
      audience: 'agent'
    }),
    'Skill/script tool events must not render as user-facing execution steps.'
  );
  assert(
    !isVisibleAgentStepEvent({
      kind: 'tool_started',
      title: '开始处理：置入图片',
      status: 'running',
      toolName: 'placeImage',
      audience: 'user'
    }),
    'User audience alone must not expose tool execution events.'
  );
  assert(
    isVisibleAgentStepEvent({
      kind: 'tool_started',
      title: '开始处理：置入图片',
      status: 'running',
      toolName: 'placeImage',
      source: 'model',
      audience: 'user'
    }),
    'Model-authored user-audience tool events may render.'
  );
}

assertSkillStepDefaultsToAgentAudience();
assertUserVisibilityBoundary();

console.log('[smoke-agent-step-visibility-boundary] passed');
