#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'src/renderer/services/agent-orchestration/streaming-policy.ts');
const CHAT_PANEL_PATH = path.join(ROOT, 'src/renderer/components/ChatPanel.tsx');
const STREAM_ADAPTER_PATH = path.join(ROOT, 'src/main/services/stream-adapter.ts');
const MODEL_SERVICE_PATH = path.join(ROOT, 'src/main/services/model-service.ts');

const policy = fs.readFileSync(POLICY_PATH, 'utf8');
const chatPanel = fs.readFileSync(CHAT_PANEL_PATH, 'utf8');
const streamAdapter = fs.readFileSync(STREAM_ADAPTER_PATH, 'utf8');
const modelService = fs.readFileSync(MODEL_SERVICE_PATH, 'utf8');

function assertContains(source, expected, message) {
  assert(source.includes(expected), message);
}

assertContains(
  policy,
  "options?.purpose !== 'direct_response'",
  'provider stream policy must allow buffered ordinary direct responses'
);
assertContains(
  policy,
  "options?.purpose !== 'direct_response_repair'",
  'provider stream policy must allow buffered direct-response repair calls'
);
assertContains(
  policy,
  "options?.purpose !== 'visible_reasoning'",
  'provider stream policy must allow controlled visible reasoning previews'
);
assertContains(
  policy,
  "context.hasAttachedImage",
  'provider stream policy must block attached-image or multimodal requests'
);
assertContains(
  policy,
  "context.hasToolCalling",
  'provider stream policy must block tool-calling requests'
);
assertContains(
  policy,
  "typeof message.content === 'string'",
  'provider stream policy must block structured multimodal content'
);
assertContains(
  chatPanel,
  "import { canUsePlainTextProviderStream } from '../services/agent-orchestration/streaming-policy';",
  'ChatPanel must use the shared provider stream policy instead of inline conditions'
);
assertContains(
  chatPanel,
  'const streamHasAttachedImage = isVisibleReasoningCall ? false : shouldUseAttachedImages;',
  'ChatPanel must keep visible reasoning text-only even when the user attached images'
);
assertContains(
  chatPanel,
  'hasAttachedImage: streamHasAttachedImage',
  'ChatPanel must pass effective attachment context into provider stream policy'
);
assertContains(
  chatPanel,
  'hasToolCalling: false',
  'ChatPanel must pass tool-calling context into provider stream policy'
);
assertContains(
  streamAdapter,
  'resolveStreamThinkingRequestParams(model, options)',
  'Xiaomi MiMo stream requests must route Thinking through model config and user preference'
);
assertContains(
  streamAdapter,
  'max_completion_tokens: maxTokens',
  'Xiaomi MiMo stream requests must use official max_completion_tokens field'
);
assertContains(
  modelService,
  'normalizeProviderStreamStopReason',
  'Tool streaming must preserve provider finish reasons instead of always claiming end_turn'
);
assertContains(
  modelService,
  "providerFinishReason === 'length'",
  'A token-limited tool stream must be treated as truncated before any partial tool call can execute'
);
assert(
  !chatPanel.includes('const canUseProviderStream ='),
  'ChatPanel must not reintroduce an inline canUseProviderStream policy'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'provider stream policy allows direct_response, direct_response_repair and visible_reasoning purposes',
    'provider stream policy blocks attached images and structured content',
    'provider stream policy blocks tool-calling requests',
    'ChatPanel keeps visible reasoning text-only before applying attachment stream guards',
    'ChatPanel uses the shared provider stream policy and has no inline duplicate',
    'Xiaomi MiMo provider streams route Thinking through model config and use max_completion_tokens',
    'provider finish reasons preserve max-token truncation for bounded recovery'
  ]
}, null, 2));
