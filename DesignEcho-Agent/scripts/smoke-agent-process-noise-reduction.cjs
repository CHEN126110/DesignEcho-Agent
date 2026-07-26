// 验证 Agent 过程视图的减噪边界：
// 内部流程播报（model_request/model_response/task_started/tool_planned）不作为用户可见步骤——
// 它们会和「工具执行行」及模型思考正文重复，淹没真正有价值的内容（用户反馈「层级太乱」）。
// 但模型真实输出（source='model'）、工具事件、观察/验证仍必须可见。
// 这是 smoke-chat-ui-execution-chain 可见性契约的行为级守护。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  isVisibleAgentProcessEvent,
  isVisibleAgentStepEvent,
  isVisiblePonderingStep
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-visible-feedback.ts'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runtimeProcessEvent(kind, extra) {
  return {
    kind,
    title: '过程事件',
    detail: '细节',
    status: 'success',
    source: 'agent_runtime',
    audience: 'user',
    visibility: 'user_process',
    ...extra
  };
}

// 1) 内部流程播报：即使显式标成 user/user_process，也不可见（减噪核心）。
for (const kind of ['model_request', 'model_response', 'task_started', 'tool_planned']) {
  assert(
    !isVisibleAgentProcessEvent(runtimeProcessEvent(kind)),
    `${kind} 属于内部流程播报，不应作为用户可见过程步骤`
  );
}

// 2) 观察结果 / 验证 / 警告 / 收尾：仍可见（这些对用户有信息价值）。
for (const kind of ['observation', 'verification', 'warning', 'finalizing']) {
  assert(
    isVisibleAgentProcessEvent(runtimeProcessEvent(kind)),
    `${kind} 应作为用户可见过程步骤`
  );
}

// 3) model_response 作为「过程步骤」一律不可见（含 source=model）——既有可见性契约要求。
//    模型真实表达走 thinking 片段 / 流式正文 / 正式消息渠道，不靠流程播报 step 重复。
assert(
  !isVisibleAgentProcessEvent({
    kind: 'model_response',
    title: '准备执行',
    status: 'success',
    source: 'model'
  }),
  'model_response 流程播报不应作为可见过程步骤'
);

// 4) 模型真实思考片段（type='thinking'）走独立的 pondering 渠道，不被流程减噪误伤。
assert(
  isVisiblePonderingStep({
    type: 'thinking',
    content: '先创建文档，再建图层组，然后放置矩形和文字图层。'
  }),
  '模型思考片段（type=thinking）应保持可见，不能被流程减噪误伤'
);

// 5) 工具执行事件仍可见（用户需要看到「在做什么」）。
assert(
  isVisibleAgentStepEvent(runtimeProcessEvent('tool_started', { toolName: 'createDocument' })),
  'tool_started 工具执行事件应可见'
);
assert(
  isVisibleAgentStepEvent(runtimeProcessEvent('tool_completed', { toolName: 'createDocument' })),
  'tool_completed 工具执行事件应可见'
);

console.log('[smoke-agent-process-noise-reduction] passed');
