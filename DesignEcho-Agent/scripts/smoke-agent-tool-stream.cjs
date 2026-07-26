#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assertContains(source, expected, message) {
  assert(source.includes(expected), message);
}

const contract = read('src/shared/agent-tool-stream.ts');
const modelService = read('src/main/services/model-service.ts');
const streamHandlers = read('src/main/ipc-handlers/stream-handlers.ts');
const preload = read('src/main/preload.ts');
const rendererStream = read('src/renderer/services/agent-tool-stream.service.ts');
const agentTypes = read('src/renderer/services/agent-runtime/types.ts');
const agent = read('src/renderer/services/agent-runtime/agent.ts');
const autonomousExecutor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');

assertContains(contract, "type: 'thinking_delta'", 'contract must expose provider thinking deltas');
assertContains(contract, "type: 'tool_call_delta'", 'contract must expose tool call deltas');
assertContains(contract, "type: 'tool_call_ready'", 'contract must expose completed tool calls');
assertContains(contract, "streamMode?: 'stream' | 'fallback'", 'contract must mark stream versus fallback mode');

assertContains(modelService, 'chatWithToolsStream(', 'ModelService must expose chatWithToolsStream');
assertContains(modelService, 'runChatWithToolsStream(', 'ModelService must separate stream orchestration from IPC');
assertContains(modelService, 'consumeToolCallDeltas(', 'ModelService must aggregate provider tool_call deltas');
assertContains(modelService, 'delta.tool_calls', 'ModelService must read OpenAI-compatible tool call deltas');
assertContains(modelService, 'streamMode', 'stream responses must carry streamMode');
assertContains(modelService, "'fallback'", 'unsupported providers must be explicit fallback');

assertContains(streamHandlers, "ipcMain.handle('stream:chatWithTools'", 'main IPC must expose stream:chatWithTools');
assertContains(streamHandlers, 'releaseActiveStream(requestId, owner)', 'terminal stream events must release only their own request');
assertContains(streamHandlers, 'takeActiveStream(requestId)', 'abort and cleanup must take ownership before aborting');
assertContains(streamHandlers, '不能并发复用', 'duplicate active request ids must be rejected');
assert.strictEqual(
  (streamHandlers.match(/activeStreams\.delete\(requestId\)/g) || []).length,
  1,
  'active stream deletion must be centralized in the identity-checked release helper'
);
assertContains(preload, 'chatWithToolsStream:', 'preload must expose chatWithToolsStream');
assertContains(rendererStream, 'streamChatWithToolsAsync', 'renderer must provide Promise wrapper for tool stream');
assertContains(rendererStream, 'onThinkingDelta', 'renderer service must forward thinking deltas');
assertContains(rendererStream, 'onToolCallDelta', 'renderer service must forward tool deltas');

assertContains(agentTypes, 'CallModelStreamFn', 'Agent runtime must type stream model calls');
assertContains(agent, 'requestModelWithOptionalStream', 'Agent must prefer the stream model path when available');
assert(
  autonomousExecutor.includes('callModelStream: callModelStreamViaIPC')
    || autonomousExecutor.includes('callModelStream: createCallModelStreamViaIPC('),
  'autonomous agent must pass the request-scoped stream model function'
);
assertContains(autonomousExecutor, 'const callModelViaIPC: CallModelFn', 'autonomous agent must keep non-stream model fallback function');
assertContains(autonomousExecutor, 'designEcho.chatWithTools(', 'non-stream chatWithTools fallback must remain available');
assertContains(
  autonomousExecutor,
  'withDesignKnowledgeNativeTools(modelId, options, requestWebSearchIntent)',
  'non-stream fallback must preserve design knowledge and request-scoped web-search native tools'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'shared tool stream contract exists',
    'main ModelService exposes streaming tool model path with fallback',
    'IPC and preload expose stream:chatWithTools with request ownership guards',
    'renderer service forwards real thinking/tool deltas',
    'autonomous Agent uses stream path while preserving chatWithTools fallback'
  ]
}, null, 2));
