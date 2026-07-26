#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) return '';
  return source.slice(start, end);
}

const modelsConfig = read('src/shared/config/models.config.ts');
const settingsModal = read('src/renderer/components/SettingsModal.tsx');
const appStore = read('src/renderer/stores/app.store.ts');
const chatPanel = read('src/renderer/components/ChatPanel.tsx');
const thinkingModeControl = read('src/renderer/components/ThinkingModeControl.tsx');
const agentRuntime = read('src/renderer/services/agent-runtime/agent.ts');
const autonomousAgentExecutor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
const streamChatService = read('src/renderer/services/stream-chat.service.ts');
const agentToolStreamService = read('src/renderer/services/agent-tool-stream.service.ts');
const modelService = read('src/main/services/model-service.ts');
const streamAdapter = read('src/main/services/stream-adapter.ts');
const streamTextNormalizer = read('src/shared/stream-text-normalizer.ts');
const preload = read('src/main/preload.ts');
const rendererTypes = read('src/renderer/types.d.ts');

assert(
  modelsConfig.includes('export interface ModelThinkingPreference'),
  'Model config must define a model thinking preference contract.'
);
assert(
  modelsConfig.includes('isModelThinkingSupported') && modelsConfig.includes('isModelThinkingUserControllable') && modelsConfig.includes('normalizeModelThinkingPreference'),
  'Model config must expose thinking support, runtime-controllable and preference normalization helpers.'
);
assert(
  !modelsConfig.includes("model?.provider !== 'xiaomi'"),
  'Thinking controllability must not be hardcoded by provider name; model capability and runtime request params are the source of truth.'
);
assert(
  modelsConfig.includes('thinking: {') && modelsConfig.includes('enabled: true'),
  'Default model preferences must include an enabled thinking preference for supported models.'
);

assert(
  !settingsModal.includes('renderThinkingPreferenceControl') && !settingsModal.includes('model-thinking-control'),
  'SettingsModal must not render a Thinking control; Thinking belongs in the chat composer.'
);
assert(
  chatPanel.includes('resolveComposerThinkingModelIds') && chatPanel.includes('isModelThinkingUserControllable'),
  'ChatPanel must derive composer Thinking visibility from runtime-controllable model capability.'
);
assert(
  chatPanel.includes('<ThinkingModeControl')
    && thinkingModeControl.includes('data-testid="chat-thinking-toggle"')
    && thinkingModeControl.includes('thinking-mode-control-button'),
  'ChatPanel must render the user-facing Thinking control inside the chat input area.'
);
assert(
  /canShowThinkingModeToggle[\s\S]{0,800}<ThinkingModeControl/.test(chatPanel),
  'Composer Thinking control must be guarded by model capability, not rendered unconditionally.'
);
assert(
  chatPanel.includes('setModelPreferences({ thinking: { enabled: !currentThinking.enabled } })'),
  'Composer Thinking control must update the persisted model thinking preference.'
);

assert(
  appStore.includes('normalizeModelPreferences') && /version:\s*\d+/.test(appStore),
  'App store must normalize persisted model preferences and keep an explicit storage version.'
);
assert(
  preload.includes('thinking?: { enabled?: boolean }') && rendererTypes.includes('thinking?: { enabled?: boolean }'),
  'Preload and renderer API types must allow persisting the Thinking preference.'
);

assert(
  chatPanel.includes('resolveModelThinkingEnabledForCall') && chatPanel.includes('thinkingEnabled: resolveModelThinkingEnabledForCall'),
  'ChatPanel must pass the user Thinking preference into real model requests.'
);
assert(
  streamChatService.includes('thinkingEnabled?: boolean'),
  'Stream chat options must carry the Thinking preference.'
);
assert(
  !agentRuntime.includes('onThinkingDelta: () => {}')
    && agentRuntime.includes("source: 'provider_thinking_delta'"),
  'Agent Runtime must forward provider thinking deltas to the user-visible reasoning channel.'
);
assert(
  /onThinkingProgress:\s*\(fullThinking\)[\s\S]{0,600}updateStreamedVisibleReasoning\(fullThinking\)/.test(chatPanel),
  'Plain streamed model calls must render provider thinking in the existing Thinking panel.'
);
const answerSettlementSection = sourceSection(
  chatPanel,
  'const settleLiveThinkingBeforeAnswerStream',
  'const updateStreamedAssistantContent'
);
const assistantStreamSection = sourceSection(
  chatPanel,
  'const updateStreamedAssistantContent',
  'const updateStreamedVisibleReasoning'
);
const visibleReasoningSection = sourceSection(
  chatPanel,
  'const updateStreamedVisibleReasoning',
  'const finalizeStreamedAssistantMessage'
);
assert(
  answerSettlementSection.includes('if (hasVisibleStreamedAssistantContent) return;')
    && answerSettlementSection.includes('hasVisibleStreamedAssistantContent = true;')
    && answerSettlementSection.includes("step.type === 'thinking' && step.status === 'running'")
    && answerSettlementSection.includes("updateStep(step.id, { status: 'success' })")
    && answerSettlementSection.includes('setShowThinking(false)')
    && assistantStreamSection.indexOf('if (!visibleContent.trim()) return;')
      < assistantStreamSection.indexOf('settleLiveThinkingBeforeAnswerStream();')
    && assistantStreamSection.indexOf('settleLiveThinkingBeforeAnswerStream();')
      < assistantStreamSection.indexOf('streamedAssistantMessageId = addRunAssistantMessage({')
    && visibleReasoningSection.indexOf('if (hasVisibleStreamedAssistantContent) return;')
      < visibleReasoningSection.indexOf('sanitizeUserVisibleThinkingText(content)')
    && /onThinking:\s*\(thinking, meta\)\s*=>\s*\{\s*if \(!canApplyRunUpdate\(\)\) return;\s*if \(hasVisibleStreamedAssistantContent\) return;/.test(chatPanel),
  'First visible answer content must settle live Thinking before rendering, and late reasoning callbacks must not regress the run to Thinking.'
);
assert(
  streamChatService.includes('function refreshStreamInactivityTimeout(): void')
    && /onContent:\s*\(content\)\s*=>\s*\{[\s\S]{0,180}refreshStreamInactivityTimeout\(\)/.test(streamChatService)
    && /if \(normalized\.deltaText\)\s*\{\s*refreshStreamInactivityTimeout\(\)/.test(streamChatService),
  'Plain provider streaming must use an inactivity timeout that refreshes on visible content or Thinking progress.'
);
assert(
  streamTextNormalizer.includes('normalizeStreamTextChunk')
    && modelService.includes('normalizeStreamTextChunk(thinking, delta.reasoning_content)')
    && streamAdapter.includes('normalizeStreamTextChunk(fullThinking, delta.reasoning_content)')
    && streamChatService.includes('normalizeStreamTextChunk(fullThinking, thinking)')
    && agentToolStreamService.includes('normalizeStreamTextChunk(fullThinking, delta)'),
  'All provider Thinking stream boundaries must share one cumulative-snapshot/delta normalizer.'
);
assert(
  agentRuntime.includes('? finalizeUserVisibleThinkingText(rawText, { requireSentenceBoundary: true })')
    && chatPanel.includes("meta?.source === 'provider_thinking_delta'")
    && chatPanel.includes('isProviderThinkingSnapshot')
    && /content:\s*isProviderThinkingSnapshot\s*\?\s*visibleThinking/.test(chatPanel),
  'Provider Thinking must publish complete sentences and replace its current snapshot instead of appending the full prefix again.'
);
assert(
  autonomousAgentExecutor.includes('从视觉层级、构图、产品真实性、排版、色彩、可读性和转化目标出发思考与表达')
    && autonomousAgentExecutor.includes('provider-visible reasoning_content')
    && autonomousAgentExecutor.includes('Simplified Chinese')
    && autonomousAgentExecutor.includes('Do not narrate Harness'),
  'Autonomous Agent prompt must frame visible reasoning as concise Chinese design judgment instead of runtime debugging.'
);
assert(
  chatPanel.includes('finalizeUserVisibleThinkingText')
    && !chatPanel.includes("`${currentText}\\n\\n${nextText}`.slice(0, 1800)"),
  'Thinking persistence must settle complete text without arbitrary character slicing.'
);
assert(
  agentRuntime.includes("audience: isHarnessControl ? 'debug' : 'user'")
    && agentRuntime.includes('response.toolCalls.filter((call) => !isAgentHarnessControlTool(call.name))'),
  'Harness control calls must remain in debug telemetry and stay out of designer-facing result summaries.'
);
assert(
  modelService.includes('resolveThinkingRequestParams') && modelService.includes('options?.thinkingEnabled === false'),
  'ModelService must remove thinking request params when the user disables Thinking.'
);
assert(
  modelService.includes("thinking: { type: 'disabled' }"),
  'Existing tool-chain non-thinking safety boundary must remain in place.'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'model thinking capability is the source of truth',
    'settings UI does not expose the chat Thinking control',
    'chat composer only renders Thinking control for supported controllable models',
    'user preference is persisted and sent to model requests',
    'provider thinking deltas reach the visible Thinking panel',
    'first visible answer token irreversibly closes live Thinking',
    'plain provider streams time out only after inactivity',
    'cumulative provider snapshots normalize once and replace the current visible Thinking snapshot',
    'visible thinking uses Chinese designer-facing language and complete-text settlement',
    'Harness control calls stay out of designer-facing process output',
    'disabled Thinking suppresses request params',
    'tool-chain thinking safety boundary remains intact'
  ]
}, null, 2));
