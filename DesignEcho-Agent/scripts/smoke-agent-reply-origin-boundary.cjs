#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const guardedFiles = [
  'src/renderer/components/ChatPanel.tsx',
  'src/renderer/components/message/parser.ts',
  'src/renderer/services/agent-orchestration/conversational.ts',
  'src/renderer/services/agent-orchestration/clarification-followup.ts',
  'src/renderer/services/design-agent/engine.ts',
  'src/shared/agent-intent-control-plane.ts',
  'src/shared/chat-response-cleaner.ts',
  'src/shared/conversational-unavailable-message.ts',
  'src/shared/agent-user-visible-state.ts'
];

const sanitizerAllowlistFiles = new Set([
  'src/shared/chat-response-cleaner.ts'
]);

const uiStateAllowlistFiles = new Set([
  'src/shared/agent-user-visible-state.ts'
]);

const forbiddenMarkers = [
  {
    label: 'internal route direct_response',
    pattern: /\bdirect_response\b/i,
    allowUiState: true,
    allowSanitizer: true
  },
  {
    label: 'internal route clarification_needed',
    pattern: /\bclarification_needed\b/i,
    allowUiState: true,
    allowSanitizer: true
  },
  {
    label: 'raw conversational unavailable sentinel',
    pattern: /\bConversational reply unavailable\b/i,
    allowUiState: true,
    allowSanitizer: true
  },
  {
    label: 'old capability menu opening',
    pattern: /我可以协助这些设计工作/u,
    allowUiState: false,
    allowSanitizer: true
  },
  {
    label: 'fixed SKU capability answer',
    pattern: /会做。SKU\s*主要包括组合图、规格备注和自选备注。?/iu,
    allowUiState: false,
    allowSanitizer: true
  },
  {
    label: 'fixed main-image capability answer',
    pattern: /会做。主图方向主要包括点击图、转化图和白底图。?/u,
    allowUiState: false,
    allowSanitizer: true
  },
  {
    label: 'fixed detail-page capability answer',
    pattern: /会做。详情页主要包括长图结构、内容模块和图文排版。?/u,
    allowUiState: false,
    allowSanitizer: true
  },
  {
    label: 'fixed clarification long template',
    pattern: /需要先明确要处理的目标、具体动作和交付结果，然后我才能继续。请补充：要处理哪个图层或画面、想达到什么效果、是否允许修改当前文档。/u,
    allowUiState: false,
    allowSanitizer: false
  },
  {
    label: 'old clarification target-action-delivery template',
    pattern: /需要先补充或确认目标、处理对象和交付结果/u,
    allowUiState: false,
    allowSanitizer: true
  }
];

function isGuardOrInstructionLine(line) {
  return [
    /containsDeveloperDiagnosticText/,
    /looksLikeFailedConversationalAssistantMessage/,
    /INTERNAL_STATUS_ONLY_PATTERN/,
    /explicitStatusMatch/,
    /purpose\s*:/,
    /route\s*:/,
    /\bdecision\.route\b/,
    /\?\.route/,
    /\?\.purpose/,
    /purpose\s*===\s*'direct_response'/,
    /purpose\s*===\s*'direct_response_repair'/,
    /buildConversationalModel(?:Error|Rejected)Attempt/,
    /isDirectResponseCall/,
    /error\??\s*:/,
    /\?\s*'clarification_needed'/,
    /:\s*'direct_response'/,
    /requestKind !== 'chat_only'/,
    /route !== 'direct_response'/,
    /不要输出/,
    /不要套用/,
    /不是回复模板/,
    /不是固定能力菜单/,
    /fixed/i,
    /forbidden/i,
    /\.test\(/,
    /\.includes\(/
  ].some((pattern) => pattern.test(line));
}

function isAllowedOccurrence(file, line, marker) {
  if (marker.allowSanitizer && sanitizerAllowlistFiles.has(file)) return true;
  if (marker.allowUiState && uiStateAllowlistFiles.has(file)) return true;
  if (isGuardOrInstructionLine(line)) return true;
  return false;
}

function findForbiddenOccurrences() {
  const failures = [];

  for (const file of guardedFiles) {
    const source = read(file);
    const lines = source.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const marker of forbiddenMarkers) {
        if (!marker.pattern.test(line)) continue;
        if (isAllowedOccurrence(file, line, marker)) continue;
        failures.push({
          file,
          line: index + 1,
          marker: marker.label,
          text: line.trim()
        });
      }
    });
  }

  return failures;
}

function assertDefaultVisibleReplyPathUsesCleaner() {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const messageParser = read('src/renderer/components/message/parser.ts');
  const conversational = read('src/renderer/services/agent-orchestration/conversational.ts');
  const cleaner = read('src/shared/chat-response-cleaner.ts');
  const unavailableMessage = read('src/shared/conversational-unavailable-message.ts');
  const replyOrigin = read('src/shared/assistant-reply-origin.ts');
  const fakeModel = read('src/main/testing/chat-test-fake-model.ts');
  const chatUiFakeFixture = read('src/main/testing/fixtures/chat-ui-electron-bridge-text.fixture.json');
  const designAgentEngine = read('src/renderer/services/design-agent/engine.ts');
  const skillExecutors = read('src/renderer/services/skill-executors/registry.ts');
  const appStore = read('src/renderer/stores/app.store.ts');
  const conversationalUnavailable = read('src/shared/conversational-unavailable-message.ts');
  const routing = read('src/renderer/services/agent-orchestration/routing.ts');
  const orchestrationTypes = read('src/renderer/services/agent-orchestration/types.ts');
  const legacyAgentTypes = read('src/renderer/types/agent.types.ts');
  const skuConfiguredExecutionPlan = read('src/shared/sku-configured-execution-plan.ts');
  const mainImageExecutor = read('src/renderer/services/skill-executors/main-image.executor.ts');
  const findEditElementExecutor = read('src/renderer/services/skill-executors/find-edit-element.executor.ts');
  const designReferenceSearchExecutor = read('src/renderer/services/skill-executors/design-reference-search.executor.ts');
  const agentPanelBridgeExecutor = read('src/renderer/services/skill-executors/agent-panel-bridge.executor.ts');
  const agentUserVisibleState = read('src/shared/agent-user-visible-state.ts');
  const businessSkillVisualObservationFeedback = read('src/shared/business-skill-visual-observation-feedback.ts');
  const designPreflightBlockedFunction = (
    designAgentEngine.match(/function buildDesignPreflightBlockedMessage[\s\S]*?\n}/) || ['']
  )[0];
  const skillUnavailableFunction = (
    designAgentEngine.match(/function buildSkillUnavailableResult[\s\S]*?\n}/) || ['']
  )[0];

  assert(
    chatPanel.includes('cleanResponseContent(content)')
      && chatPanel.includes('updateStreamedAssistantContent')
      && chatPanel.includes('finalizeStreamedAssistantMessage'),
    'ChatPanel default assistant message path should clean streamed and final assistant content before user-visible rendering.'
  );

  assert(
    messageParser.includes('sanitizeUserVisibleAssistantBodyText')
      && messageParser.includes('sanitizeUserVisibleDiagnosticText')
      && messageParser.includes("requestKind !== 'chat_only'")
      && messageParser.includes("route !== 'direct_response'")
      && messageParser.includes('assistantReplyOrigin')
      && messageParser.includes("userVisibleKind === 'tool_summary'")
      && messageParser.includes("userVisibleKind === 'blocker_notice'")
      && messageParser.includes("'origin-notice-content'")
      && messageParser.includes("type: 'text'")
      && !messageParser.includes("title: '处理摘要'")
      && !messageParser.includes("title: '需要确认'"),
    'Message parser should sanitize assistant bodies/diagnostics, avoid persistent thinking blocks for chat-only direct replies, and render tool_summary/blocker origins as natural text rather than titled cards.'
  );

  assert(
    !messageParser.includes("title: '状态'")
      && !messageParser.includes("blockType: 'status-notice-content'")
      && !messageParser.includes("|| assistantReplyOrigin.userVisibleKind === 'status_notice'"),
    'UI status notices should not render as a large titled status card in normal chat.'
  );

  assert(
    conversational.includes('looksLikeCannedCapabilityMenu')
      && conversational.includes('looksLikeFormulaicCapabilityExplainer')
      && conversational.includes('sanitizeUserVisibleAssistantBodyText')
      && conversational.includes('extractConversationalReplyFromModelText')
      && conversational.includes('deferVisibleStream: isCapabilityConversationQuestion'),
    'Conversational reply generation should reject canned capability replies and defer capability streaming until repair passes.'
  );

  assert(
    !conversational.includes('buildConversationalProviderFailureReply')
      && !conversational.includes('buildCapabilityProviderFailureReply')
      && !/catch\s*\([^)]*\)\s*{\s*return\s+buildConversationalUnavailableMessage/s.test(conversational),
    'Conversational provider failures must return null for engine-level ui_status handling, not fixed assistant speech.'
  );

  assert(
    cleaner.includes('looksLikeCannedCapabilityMenu')
      && cleaner.includes('looksLikeFormulaicCapabilityExplainer')
      && cleaner.includes('looksLikeCapabilityExecutionPromise')
      && cleaner.includes('looksLikeInternalPromptInstructionLeak')
      && cleaner.includes('INTERNAL_STATUS_ONLY_PATTERN')
      && cleaner.includes('Conversational reply unavailable'),
    'Chat response cleaner should keep explicit forbidden-sample and internal-status cleanup coverage.'
  );

  assert(
    unavailableMessage.includes('没有拿到模型回复')
      && !unavailableMessage.includes('现在没能生成有效回复')
      && !unavailableMessage.includes('没有收到模型回复')
      && !unavailableMessage.includes('不会贸然改动画面')
      && !unavailableMessage.includes('改动画面')
      && !unavailableMessage.includes('Photoshop')
      && !unavailableMessage.includes('我这边暂时没拿到可靠回复')
      && !unavailableMessage.includes('Conversational reply unavailable')
      && !unavailableMessage.includes('direct_response')
      && !unavailableMessage.includes('clarification_needed'),
    'Shared conversational unavailable copy should be low-friction user-facing text, not raw internal route/status tokens or Photoshop-specific wording.'
  );

  assert(
    replyOrigin.includes('testFixtureReplyOrigin')
      && replyOrigin.includes("origin: 'test_fixture'")
      && replyOrigin.includes("userVisibleKind: 'test_fixture'"),
    'Assistant reply origin contract should have an explicit test_fixture origin for fake provider text.'
  );

  assert(
    replyOrigin.includes('normalizeAssistantReplyOriginForDisplay')
      && replyOrigin.includes("origin.origin === 'unknown'")
      && replyOrigin.includes("userVisibleKind === 'assistant_speech'")
      && messageParser.includes('normalizeAssistantReplyOriginForDisplay')
      && messageParser.includes('const assistantReplyOrigin = normalizeAssistantReplyOriginForDisplay(message.assistantReplyOrigin)'),
    'Message rendering should normalize missing/unknown/invalid assistant origins before deciding whether content is assistant speech or status notice.'
  );

  assert(
    replyOrigin.includes('localConversationSummaryOrigin')
      && replyOrigin.includes('local summaries are UI status only')
      && !/function localConversationSummaryOrigin[\s\S]*?userVisibleKind:\s*'assistant_speech'/.test(replyOrigin)
      && !/isAssistantSpeechOrigin[\s\S]*?local_conversation_summary/.test(replyOrigin),
    'Local task summary and continuation fallbacks must not be classified as assistant speech.'
  );

  assert(
    appStore.includes('normalizeAssistantReplyOriginForPersistence')
      && appStore.includes("uiStatusReplyOrigin('store:assistant-message:missing-origin')")
      && (
        /function sanitizeMessageForPersistence[\s\S]*assistantReplyOrigin:\s*normalizeAssistantReplyOriginForPersistence\(message\)/.test(appStore)
        || /function sanitizeMessageForPersistence[\s\S]*const assistantReplyOrigin\s*=\s*normalizeAssistantReplyOriginForPersistence\(message\)[\s\S]*assistantReplyOrigin,/.test(appStore)
      ),
    'Persisted assistant messages without explicit origin must be downgraded to ui_status so unknown local text cannot masquerade as model-authored assistant speech.'
  );

  assert(
    chatPanel.includes('normalizeAssistantReplyOriginForRuntime')
      && chatPanel.includes('designechoChatTestFakeModel')
      && chatPanel.includes('testFixtureReplyOrigin')
      && chatPanel.includes('chat-test-fake-model:'),
    'ChatPanel should mark fake-model conversational text as test_fixture instead of production model-authored speech.'
  );

  assert(
    chatPanel.includes('looksLikeChatTestFakeModelText')
      && chatPanel.includes('contentForOriginCheck')
      && /normalizeAssistantReplyOriginForRuntime\([\s\S]*?contentForOriginCheck/.test(chatPanel),
    'ChatPanel should detect fake-model response markers in message content, not only the renderer URL test flag.'
  );

  assert(
    fakeModel.includes('DESIGNECHO_CHAT_TEST_FAKE_MODEL_FIXTURE')
      && fakeModel.includes("'chat-ui-electron-bridge'")
      && fakeModel.includes('buildNeutralChatTestFakeModelText')
      && fakeModel.includes('buildChatUiElectronBridgeFixtureText')
      && fakeModel.includes('测试 fixture 已收到请求'),
    'Fake model should default to a neutral test fixture and keep product-looking sample replies inside an explicit fixture suite.'
  );

  assert(
    fakeModel.includes('markChatUiElectronBridgeFixtureText')
      && fakeModel.includes('chat-ui-electron-bridge-text.fixture.json')
      && chatUiFakeFixture.includes('测试样本：')
      && chatUiFakeFixture.includes('未调用真实模型或 Photoshop')
      && !fakeModel.includes('我的理解是你想做 SKU 相关产出')
      && !fakeModel.includes('我是 DesignEcho 当前接入的对话模型')
      && !fakeModel.includes('详情页分屏是为了')
      && /function buildChatUiElectronBridgeFixtureText[\s\S]*markChatUiElectronBridgeFixtureText\(/.test(fakeModel),
    'Named chat-ui fake fixture should load product-looking sample replies from a visible test fixture file, not inline real-looking assistant speech in production test logic.'
  );

  const deterministicNoticeSources = {
    'main-image.executor.ts': mainImageExecutor,
    'find-edit-element.executor.ts': findEditElementExecutor,
    'chat-response-cleaner.ts': cleaner,
    'agent-user-visible-state.ts': agentUserVisibleState,
    'business-skill-visual-observation-feedback.ts': businessSkillVisualObservationFeedback
  };
  const deterministicNoticeFirstPerson = Object.entries(deterministicNoticeSources).flatMap(([file, source]) => {
    const lines = source.split(/\r?\n/);
    return lines
      .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
      .filter(({ text }) => /我没有(?:继续)?改动画面|我不想盲改|看完后给你|这次先不改动文档|我不会替你|我还没有/u.test(text));
  });

  assert(
    deterministicNoticeFirstPerson.length === 0,
    'Deterministic status/blocker notices should use neutral state wording instead of first-person assistant speech.',
    deterministicNoticeFirstPerson
  );

  assert(
    designPreflightBlockedFunction.includes('getInternalAgentStatusPublicMessage(preflight.status)')
      && !/Photoshop\s*写入/u.test(designPreflightBlockedFunction)
      && !/模型或人工/u.test(designPreflightBlockedFunction)
      && !/设计决策/u.test(designPreflightBlockedFunction),
    'Design preflight blocker source should reuse public status text instead of implementation-facing fixed assistant copy.'
  );

  assert(
    skillUnavailableFunction.includes("getInternalAgentStatusPublicMessage('skill executor not found')")
      && skillUnavailableFunction.includes("getInternalAgentStatusPublicMessage('skill disabled')")
      && !/处理器来完成这个请求/u.test(skillUnavailableFunction)
      && !/当前已在设置中关闭/u.test(skillUnavailableFunction),
    'Skill unavailable engine fallback should reuse public status text instead of implementation-facing fixed assistant copy.'
  );

  assert(
    skillExecutors.includes('buildSkillUnavailableStatusMessage')
      && skillExecutors.includes("getInternalAgentStatusPublicMessage('skill executor not found')")
      && !/当前没有可用的处理能力/u.test(skillExecutors)
      && !/执行器当前不可用/u.test(skillExecutors)
      && !/执行能力失败：/u.test(skillExecutors),
    'Skill executor registry should not return implementation-facing fixed assistant copy for missing executors or exceptions.'
  );

  assert(
    !conversationalUnavailable.includes('不能把能力范围说准')
      && !routing.includes('抠图能力当前暂不从 Agent 对话端执行')
      && !skuConfiguredExecutionPlan.includes('可以直接告诉我具体颜色组合')
      && !skuConfiguredExecutionPlan.includes('我会按你的组合执行')
      && !mainImageExecutor.includes('如果要真实导出，我会按受控流程执行'),
    'High-risk local fallback/status paths must not contain fixed first-person assistant promises.'
  );

  assert(
    !designReferenceSearchExecutor.includes('请根据用户需求介绍这些设计参考。')
      && !agentPanelBridgeExecutor.includes('已生成一条内部调试任务。')
      && !agentPanelBridgeExecutor.includes('不建议把这条消息当作普通用户回复。'),
    'Tool/executor result messages must not contain prompt instructions or internal debug natural-language replies.'
  );

  assert(
    chatPanel.includes('const addLocalAssistantMessage = useCallback')
      && chatPanel.includes('const addAssistantMessageWithOrigin = useCallback')
      && chatPanel.includes('const updateAssistantMessageWithOrigin = useCallback')
      && chatPanel.includes('const updateLocalAssistantMessage = useCallback')
      && chatPanel.includes('const addLocalStatusMessage = useCallback')
      && chatPanel.includes('const addLocalToolSummaryMessage = useCallback')
      && chatPanel.includes('const addLocalBlockerMessage = useCallback')
      && chatPanel.includes('toolSummaryReplyOrigin')
      && chatPanel.includes('deterministicBlockerReplyOrigin')
      && chatPanel.includes('uiStatusReplyOrigin')
      && chatPanel.includes('modelAuthoredReplyOrigin'),
    'ChatPanel local assistant UI paths should use explicit origin helpers instead of relying on store missing-origin fallback.'
  );

  const addAssistantWithOriginBlock = (
    chatPanel.match(/const addAssistantMessageWithOrigin = useCallback\([\s\S]*?\}, \[addMessage\]\);/) || ['']
  )[0];
  const chatPanelWithoutAssistantOriginHelper = addAssistantWithOriginBlock
    ? chatPanel.replace(addAssistantWithOriginBlock, '')
    : chatPanel;
  assert(
    addAssistantWithOriginBlock.includes("role: 'assistant'")
      && addAssistantWithOriginBlock.includes('normalizeAssistantReplyOriginForRuntime')
      && !chatPanelWithoutAssistantOriginHelper.includes("role: 'assistant'"),
    'ChatPanel should create assistant messages only through addAssistantMessageWithOrigin so every assistant message has an explicit origin.'
  );

  const updateAssistantWithOriginBlock = (
    chatPanel.match(/const updateAssistantMessageWithOrigin = useCallback\([\s\S]*?\}, \[updateMessage[^\]]*\]\);/) || ['']
  )[0];
  const finalizeStreamedAssistantBlock = (
    chatPanel.match(/const finalizeStreamedAssistantMessage = \([\s\S]*?return true;\s*};/) || ['']
  )[0];
  assert(
    chatPanel.includes("type AssistantMessageUpdateWithOriginInput = Omit<UpdateMessageInput, 'role' | 'assistantReplyOrigin'>")
      && updateAssistantWithOriginBlock.includes('normalizeAssistantReplyOriginForRuntime')
      && finalizeStreamedAssistantBlock.includes('updateAssistantMessageWithOrigin')
      && !finalizeStreamedAssistantBlock.includes('assistantReplyOrigin: normalizeAssistantReplyOriginForRuntime'),
    'ChatPanel should update streamed assistant messages through updateAssistantMessageWithOrigin and should not accept role/origin in update payloads.'
  );

  assert(
    !messageParser.includes('export function createTextMessage(')
      && !messageParser.includes('export function createSuccessMessage(')
      && !messageParser.includes('export function createErrorMessage(')
      && !messageParser.includes('export function createImageMessage('),
    'Message parser must not export quick assistant message constructors that bypass assistantReplyOrigin.'
  );

  assert(
    chatPanel.includes("addLocalBlockerMessage('⚠️ 请先连接 Photoshop 插件', 'text-optimize:photoshop-disconnected')")
      && chatPanel.includes("addLocalStatusMessage('🧹 对话历史已清空。', 'slash-command:clear')")
      && chatPanel.includes("addLocalStatusMessage(\n                        '内部诊断报告已写入开发日志，聊天区不展示底层记录。'"),
    'High-frequency ChatPanel local status and blocker messages should route through typed local helper functions without dumping debug logs into chat.'
  );

  assert(
    !designAgentEngine.includes("modelAuthoredReplyOrigin('router-direct-response:router-field'")
      && !designAgentEngine.includes("uiStatusReplyOrigin('router-direct-response:router-field')")
      && !designAgentEngine.includes("uiStatusReplyOrigin('router-clarification:router-field')")
      && designAgentEngine.includes("modelAuthoredReplyOrigin('model-router:direct-response')")
      && designAgentEngine.includes("modelAuthoredReplyOrigin('model-router:clarification')")
      && designAgentEngine.includes("modelRepairedReplyOrigin('model-router:direct-response')")
      && designAgentEngine.includes("modelRepairedReplyOrigin('model-router:clarification')"),
    'Router directResponse and clarificationQuestion fields must not be rendered directly; final assistant speech must come from conversational model-authored or repaired replies.'
  );

  assert(
    !designAgentEngine.includes("options?.assistantReplyOrigin || modelAuthoredReplyOrigin('conversational')")
      && designAgentEngine.includes("options?.assistantReplyOrigin || uiStatusReplyOrigin('conversational:missing-origin')"),
    'buildConversationalAgentResult must not default missing origins to model-authored assistant speech.'
  );

  assert(
    orchestrationTypes.includes('export type AgentUserVisibleNoticeKind')
      && orchestrationTypes.includes('export interface AgentUserVisibleNotice')
      && orchestrationTypes.includes('userVisibleNotice?: AgentUserVisibleNotice;')
      && legacyAgentTypes.includes('export type AgentUserVisibleNoticeKind')
      && legacyAgentTypes.includes('export interface AgentUserVisibleNotice')
      && legacyAgentTypes.includes('userVisibleNotice?: AgentUserVisibleNotice;'),
    'AgentResult should expose a typed userVisibleNotice field so status/tool/blocker output is not forced through natural assistant message text.'
  );

  assert(
    chatPanel.includes('function resolveAgentResultVisibleMessage')
      && chatPanel.includes('const resultUserVisibleNotice')
      && /\(result as any\)\??\.userVisibleNotice/.test(chatPanel)
      && /\(result as any\)\??\.data\??\.userVisibleNotice/.test(chatPanel)
      && chatPanel.includes('noticeOrigin'),
    'ChatPanel should resolve user-visible output from typed AgentResult.userVisibleNotice/data.userVisibleNotice before falling back to AgentResult.message.'
  );

  assert(
    designAgentEngine.includes('function withAgentUserVisibleNotice')
      && designAgentEngine.includes("kind: 'status_notice'")
      && designAgentEngine.includes("kind: 'blocker_notice'")
      && designAgentEngine.includes('userVisibleNotice: notice'),
    'DesignAgentEngine status and blocker paths should attach typed userVisibleNotice metadata at the source, not only rely on renderer origin fallback.'
  );

  assert(
    designAgentEngine.includes('function shouldTreatSkillResultAsToolSummary')
      && designAgentEngine.includes("status === 'needs_review'")
      && designAgentEngine.includes('successfulToolCalls > 0')
      && designAgentEngine.includes('resolveSkillResultReplyOrigin(input.result, input.skillId)'),
    'Skill results with successful tool calls but needs_review status should remain tool_result_summary instead of being downgraded to blocker_notice.'
  );

  assert(
    conversational.includes('normalizeConversationalReplyCandidate')
      && conversational.includes('sanitizeUserVisibleAssistantBodyText')
      && conversational.includes('containsInternalRouteToken')
      && conversational.includes('looksLikeGenericPhotoshopClarification')
      && conversational.includes('options?.intentClarification && looksLikeGenericPhotoshopClarification'),
    'Router directResponse/clarification field text should pass through conversational candidate cleaning before it can become user-visible assistant speech.'
  );

  assert(
    !chatPanel.includes('agent-stream:pending')
      && !chatPanel.includes('ensureStreamedAssistantMessage')
      && chatPanel.includes('if (!visibleContent.trim()) return;')
      && chatPanel.includes("modelAuthoredReplyOrigin('agent-stream:visible-content')"),
    'ChatPanel must not create empty pending assistant speech; only cleaned visible provider stream content may create model-authored speech.'
  );

  assert(
    !chatPanel.includes('const updateStreamedAssistantContent = (content: string, isThinking = true)')
      && chatPanel.includes("source: 'provider-visible-token-stream'")
      && chatPanel.includes("if (streamSource.source !== 'provider-visible-token-stream' || !streamSource.modelId) return")
      && !chatPanel.includes('updateStreamedAssistantContent(fullContent, true)'),
    'ChatPanel streamed assistant speech must come from the provider visible token stream path, not generic local status/executor callbacks.'
  );

  const textOptimizeSuccessBlock = (
    chatPanel.match(/addLocalToolSummaryMessage\('✨ 优化建议如下：'[\s\S]*?\);/) || ['']
  )[0];
  assert(
    textOptimizeSuccessBlock.includes("'legacy-task:text-optimize'"),
    'ChatPanel text optimization output is a local task result and must not be marked as model-authored assistant speech.'
  );

  const directAssistantAdditionsWithoutOrigin = [];
  const directAssistantAddPattern = /addMessage\(\s*{\s*role:\s*'assistant'([\s\S]*?)\}\s*\)/g;
  let directAssistantAddMatch;
  while ((directAssistantAddMatch = directAssistantAddPattern.exec(chatPanel))) {
    const block = directAssistantAddMatch[0];
    if (block.includes('assistantReplyOrigin:')) continue;
    directAssistantAdditionsWithoutOrigin.push({
      index: directAssistantAddMatch.index,
      preview: block.slice(0, 160)
    });
  }
  assert(
    directAssistantAdditionsWithoutOrigin.length === 0,
    'ChatPanel must not add assistant messages without explicit assistantReplyOrigin; local UI text may be status/tool/blocker, not assistant speech.',
    directAssistantAdditionsWithoutOrigin.slice(0, 12)
  );
}

function assertBusinessSkillToolResultsAreModelMediated() {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const designAgentEngine = read('src/renderer/services/design-agent/engine.ts');
  const diagnosticRecord = read('src/shared/agent-diagnostic-record.ts');
  const chatTestBridge = read('src/renderer/testing/chat-panel-test-bridge.ts');
  const policyPath = path.join(ROOT, 'src/shared/agent-user-reply-mediation-policy.ts');
  assert(
    fs.existsSync(policyPath),
    'Business/design skill result replies must be governed by a shared mediation policy instead of ad-hoc UI/tool summaries.'
  );

  const {
    requiresModelMediatedUserReply,
    buildModelMediatedSkillReplyMessages
  } = require(policyPath);

  assert(
    requiresModelMediatedUserReply({ skillId: 'project-image-analysis', success: true, userVisibleKind: 'tool_summary' }),
    'project-image-analysis success must be model-mediated before user-facing reply.'
  );
  assert(
    requiresModelMediatedUserReply({ skillId: 'sku-batch', success: true, userVisibleKind: 'tool_summary' }),
    'SKU success must be model-mediated before user-facing reply.'
  );
  assert(
    requiresModelMediatedUserReply({ skillId: 'main-image-design', success: true, userVisibleKind: 'tool_summary' }),
    'main-image success must be model-mediated before user-facing reply.'
  );
  assert(
    requiresModelMediatedUserReply({ skillId: 'detail-page-design', success: true, userVisibleKind: 'tool_summary' }),
    'detail-page success must be model-mediated before user-facing reply.'
  );
  assert(
    !requiresModelMediatedUserReply({ skillId: 'document-management', success: true, userVisibleKind: 'tool_summary' }),
    'mechanical document-management success may remain a tool summary.'
  );
  assert(
    !requiresModelMediatedUserReply({ skillId: 'sku-batch', success: false, userVisibleKind: 'blocker_notice' }),
    'failures/blockers should stay status/blocker notices instead of asking a model to soften them.'
  );

  const messages = buildModelMediatedSkillReplyMessages({
    userInput: '当前是什么项目？',
    skillId: 'project-image-analysis',
    skillResultMessage: '已读取当前项目资源索引：38 个图片/素材，10 个文件夹，3 类资源。',
    resultData: {
      summary: '袜子项目，图片包含圆点袜、SKU 色卡、成品参考。'
    }
  });
  const joined = JSON.stringify(messages);
  assert(joined.includes('主 Agent'), 'model mediation prompt should make the model speak as the Agent, not as a tool.');
  assert(joined.includes('工具结果'), 'model mediation prompt should pass actual tool results to the model.');
  assert(joined.includes('不要把工具日志逐条复述'), 'model mediation prompt should prevent script-log style replies.');
  assert(
    chatPanel.includes('supportsModelMediatedUserReply = true'),
    'Production ChatPanel callModel must explicitly declare support for model-mediated skill result replies.'
  );
  assert(
    designAgentEngine.includes("purpose: 'skill_result_user_reply'")
      && designAgentEngine.includes('supportsModelMediatedUserReply'),
    'DesignAgentEngine must call the model with skill_result_user_reply only when the model caller declares support.'
  );
  assert(
    designAgentEngine.includes('function extractModelVisibleText')
      && designAgentEngine.includes("typeof response === 'string'")
      && designAgentEngine.includes('modelResponse'),
    'Model-mediated skill replies must normalize raw string model responses as visible text instead of only reading response.text.'
  );
  assert(
    designAgentEngine.includes('modelMediatedUserReplyUnavailable')
      && designAgentEngine.includes('rawResponseShape')
      && designAgentEngine.includes('empty_model_text'),
    'Model-mediated skill reply fallback must preserve an internal diagnostic record so real-window failures identify the broken boundary instead of showing a generic unavailable state.'
  );
  assert(
    diagnosticRecord.includes('modelMediatedUserReplyUnavailable'),
    'Agent diagnostic record must keep model-mediated reply fallback reasons instead of dropping them at the ChatPanel boundary.'
  );
  assert(
    chatPanel.includes('agentDiagnosticRecordKeys')
      && chatPanel.includes('modelMediatedUserReplyUnavailable'),
    'ChatPanel test snapshots must expose safe diagnostic summaries for model-mediated reply failures.'
  );
  assert(
    chatTestBridge.includes('agentDiagnosticRecordKeys')
      && chatTestBridge.includes('modelMediatedUserReplyUnavailable'),
    'ChatPanel test bridge types must include safe diagnostic summaries for model-mediated reply failures.'
  );

  const projectInventoryShortcutMatch = designAgentEngine.match(
    /项目资源清单是 metadata-only 只读请求[\s\S]{0,1400}?return executeSkillWithDesignPreflight\(context, \{([\s\S]{0,900}?)\}\);/
  );
  assert(
    projectInventoryShortcutMatch && projectInventoryShortcutMatch[1].includes('callModel'),
    'Project inventory read-only shortcut must forward callModel so tool results can be turned into a model-authored user reply.'
  );
}

function main() {
  assertBusinessSkillToolResultsAreModelMediated();
  assertDefaultVisibleReplyPathUsesCleaner();

  const forbiddenOccurrences = findForbiddenOccurrences();
  assert(
    forbiddenOccurrences.length === 0,
    'Default user-visible assistant reply origins must not expose internal routes, stale canned capability answers, raw unavailable sentinels, or fixed clarification templates.',
    forbiddenOccurrences
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'default assistant message path routes through response cleaning before visible rendering',
      'message parser sanitizes assistant bodies and diagnostics',
      'message parser keeps tool_summary/blocker origin metadata while rendering natural text',
      'ui_status notices stay low-friction instead of becoming titled status cards',
      'conversational path rejects canned capability replies and failed sentinel history',
      'conversational provider failure path returns null for ui_status handling',
      'cleaner keeps forbidden-sample coverage for stale capability/status replies',
      'raw internal routes and fixed templates only appear in allowed sanitizer/UI-state contexts',
      'message rendering normalizes missing/unknown/invalid assistant origins before display',
      'fake provider conversational text is marked as test_fixture in the ChatPanel runtime',
      'empty provider stream fragments cannot create pending assistant speech',
      'fake provider defaults to neutral fixture text unless a named fixture suite is selected',
      'product-looking fake provider samples live in a named fixture suite',
      'design preflight blockers reuse public status text instead of implementation-facing fixed assistant copy',
      'high-risk local fallback/status paths do not contain fixed first-person assistant promises'
    ]
  }, null, 2));
}

main();
