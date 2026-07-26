#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadSharedModule(relativePath) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled.outputText, `${filename}.js`);
  return loaded.exports;
}

const policy = loadSharedModule('src/shared/agent-observation-channels.ts');
const {
  classifyAgentObservationChannel,
  canObservationEnterThinkingSteps,
  canObservationRenderAsToolCall,
  isAgentObservationChannelBoundaryOk
} = policy;

const providerThinking = classifyAgentObservationChannel({
  source: 'provider_thinking_delta',
  content: '我需要先确认当前文档和图层。'
});
assert(providerThinking.channel === 'thinking', 'provider thinking should enter thinking channel', providerThinking);
assert(providerThinking.isProviderThinking === true, 'provider thinking should keep provider flag', providerThinking);
assert(canObservationEnterThinkingSteps(providerThinking) === true, 'provider thinking can enter thinkingSteps', providerThinking);
assert(isAgentObservationChannelBoundaryOk(providerThinking) === true, 'provider thinking boundary should pass', providerThinking);

const modelVisibleReasoning = classifyAgentObservationChannel({
  source: 'model_visible_reasoning',
  content: '我会先读取图层结构，再判断是否需要工具。'
});
assert(modelVisibleReasoning.channel === 'thinking', 'model visible reasoning should use thinking UI channel', modelVisibleReasoning);
assert(modelVisibleReasoning.isProviderThinking === false, 'model visible reasoning is not provider thinking', modelVisibleReasoning);
assert(modelVisibleReasoning.canClaimModelReasoning === false, 'model visible reasoning must not claim private reasoning', modelVisibleReasoning);
assert(canObservationEnterThinkingSteps(modelVisibleReasoning) === true, 'model visible reasoning can enter thinkingSteps as public text', modelVisibleReasoning);

const toolCall = classifyAgentObservationChannel({
  source: 'tool_call_started',
  content: '执行 getDocumentInfo',
  toolName: 'getDocumentInfo'
});
assert(toolCall.channel === 'tool_call', 'tool call should enter tool channel', toolCall);
assert(canObservationRenderAsToolCall(toolCall) === true, 'tool call should render as tool event', toolCall);
assert(canObservationEnterThinkingSteps(toolCall) === false, 'tool call should not enter thinking panel as reasoning', toolCall);

const activity = classifyAgentObservationChannel({
  source: 'visible_activity',
  content: '当前执行：SKU Batch'
});
assert(activity.channel === 'activity', 'visible activity should enter activity channel', activity);
assert(activity.userVisible === true, 'visible activity remains user visible', activity);
assert(canObservationEnterThinkingSteps(activity) === false, 'visible activity must not persist as thinking', activity);

const lifecycle = classifyAgentObservationChannel({
  source: 'execution_lifecycle_snapshot',
  content: 'executing_tools'
});
assert(lifecycle.channel === 'activity', 'execution lifecycle snapshot should be activity evidence', lifecycle);
assert(lifecycle.canPersistToThinkingSteps === false, 'execution lifecycle must not be persisted as model thinking', lifecycle);
assert(lifecycle.canPersistToThinkingSteps === false, 'execution lifecycle must not persist to thinkingSteps', lifecycle);

const hiddenDiagnostic = classifyAgentObservationChannel({
  source: 'acceptance_diagnostic',
  content: 'agentExecutionLifecycleSnapshot'
});
assert(hiddenDiagnostic.channel === 'hidden_diagnostic', 'acceptance diagnostics must remain hidden', hiddenDiagnostic);
assert(hiddenDiagnostic.userVisible === false, 'acceptance diagnostics are not user visible', hiddenDiagnostic);
assert(hiddenDiagnostic.canPersistToThinkingSteps === false, 'acceptance diagnostics must not persist to thinkingSteps', hiddenDiagnostic);

const localPlaceholder = classifyAgentObservationChannel({
  source: 'local_placeholder',
  content: '等待响应'
});
assert(localPlaceholder.channel === 'blocked', 'local placeholder should be blocked', localPlaceholder);
assert(localPlaceholder.userVisible === false, 'blocked placeholder is not user visible', localPlaceholder);
assert(canObservationEnterThinkingSteps(localPlaceholder) === false, 'blocked placeholder must not enter thinkingSteps', localPlaceholder);

const chatPanel = read('src/renderer/components/ChatPanel.tsx');
const agentRuntime = read('src/renderer/services/agent-runtime/agent.ts');
const agentTypes = read('src/renderer/services/agent-runtime/types.ts');
const visibleFeedback = read('src/renderer/services/agent-visible-feedback.ts');
const architectureReport = read('scripts/report-agent-architecture.cjs');
const cockpitReport = read('scripts/report-project-cockpit.cjs');

assert(chatPanel.includes('classifyAgentObservationChannel'), 'ChatPanel should classify thinking observations before rendering');
assert(chatPanel.includes('canObservationEnterThinkingSteps'), 'ChatPanel should gate thinkingSteps through observation policy');
assert(agentRuntime.includes('AgentThinkingEventMeta'), 'Agent runtime should type thinking observation metadata');
assert(agentRuntime.includes("source: 'provider_thinking_delta'"), 'Agent runtime should mark provider thinking deltas');
assert(agentRuntime.includes("source: 'model_visible_reasoning'"), 'Agent runtime should mark public visible reasoning separately');
assert(visibleFeedback.includes('classifyAgentObservationChannel'), 'visible feedback should share the same observation policy');
assert(architectureReport.includes('agentObservationChannelPolicyAvailable'), 'architecture report should expose observation channel policy');
assert(cockpitReport.includes('agentObservationChannelPolicyAvailable'), 'cockpit report should expose observation channel policy');

console.log(JSON.stringify({
  success: true,
  checks: [
    'provider thinking is the only provider-reasoning channel',
    'model visible reasoning is public text, not private chain-of-thought',
    'tool calls, activity and diagnostics stay out of reasoning',
    'local waiting placeholders are blocked',
    'ChatPanel and runtime are wired to the shared observation policy',
    'maintenance reports expose the observation channel policy'
  ]
}, null, 2));
