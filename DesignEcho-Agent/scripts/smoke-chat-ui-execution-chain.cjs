#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sourceSection(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert(start >= 0, `Missing source section start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(end >= 0, `Missing source section end: ${endNeedle}`);
  return source.slice(start, end);
}

function loadParserExports() {
  const filename = path.join(ROOT, 'src/renderer/components/message/parser.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React
    },
    fileName: filename
  });

  const parserModule = new Module(filename, module);
  parserModule.filename = filename;
  parserModule.paths = Module._nodeModulePaths(path.dirname(filename));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../ThinkingProcess' || request === '../../services/tool-display-info') {
      const names = {
        getDocumentInfo: '读取文档信息',
        renderLayout: '排版画面',
        describeImage: '理解图片'
      };
      return {
        getToolDisplayInfo: (toolName) => ({
          name: names[toolName] || toolName,
          icon: 'T',
          description: toolName
        })
      };
    }
    if (request === '../../../shared/chat-response-cleaner') {
      return require(path.join(ROOT, 'src/shared/chat-response-cleaner.ts'));
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    parserModule._compile(compiled.outputText, `${filename}.js`);
  } finally {
    Module._load = originalLoad;
  }

  return parserModule.exports;
}

function loadAgentVisibleFeedbackExports() {
  const filename = path.join(ROOT, 'src/renderer/services/agent-visible-feedback.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  const serviceModule = new Module(filename, module);
  serviceModule.filename = filename;
  serviceModule.paths = Module._nodeModulePaths(path.dirname(filename));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './tool-display-info') {
      return {
        getToolDisplayInfo: (toolName) => ({
          name: toolName,
          icon: 'T',
          description: toolName
        })
      };
    }
    if (request === './design-teams') {
      return { getDesignTeammateDefinition: () => null };
    }
    if (request === '../../shared/skills/skill-declarations') {
      return { getSkillById: () => null };
    }
    if (request === '../../shared/agent-observation-channels') {
      return {
        canObservationEnterThinkingSteps: () => false,
        canObservationRenderAsToolCall: () => true,
        classifyAgentObservationChannel: () => ({ channel: 'tool_call', canRenderInToolPanel: true })
      };
    }
    if (request === '../../shared/chat-response-cleaner') {
      return require(path.join(ROOT, 'src/shared/chat-response-cleaner.ts'));
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    serviceModule._compile(compiled.outputText, `${filename}.js`);
  } finally {
    Module._load = originalLoad;
  }

  return serviceModule.exports;
}

function collectVisibleStrings(value, output = [], keyPath = '') {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVisibleStrings(item, output, keyPath);
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['result', 'toolResult', 'params', 'payload'].includes(key)) {
        continue;
      }
      collectVisibleStrings(child, output, keyPath ? `${keyPath}.${key}` : key);
    }
  }
  return output;
}

function assertChatPanelRoute() {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const app = read('src/renderer/App.tsx');
  const thinkingProcess = read('src/renderer/components/ThinkingProcess.tsx');
  const thinkingProcessCss = read('src/renderer/components/ThinkingProcess.css');
  const visibleFeedback = read('src/renderer/services/agent-visible-feedback.ts');
  const mainProcess = read('src/main/index.ts');
  const preload = read('src/main/preload.ts');
  const debugBridgeService = read('src/main/services/debug-bridge-service.ts');
  const testBridge = read('src/renderer/testing/chat-panel-test-bridge.ts');
  const skillExecutors = read('src/renderer/services/skill-executors/registry.ts');
  const skillStepEvents = read('src/renderer/services/skill-executors/skill-step-events.ts');
  const documentManagementExecutor = read('src/renderer/services/skill-executors/document-management.executor.ts');
  const textFontReplaceExecutor = read('src/renderer/services/skill-executors/text-font-replace.executor.ts');
  const layoutReplicationExecutor = read('src/renderer/services/skill-executors/layout-replication.executor.ts');
  const detailPageExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
  const skuBatchExecutor = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
  const mainImageExecutor = read('src/renderer/services/skill-executors/main-image.executor.ts');
  const matteProductExecutor = read('src/renderer/services/skill-executors/matte-product.executor.ts');
  const templateSaveExecutor = read('src/renderer/services/skill-executors/template-save.executor.ts');
  const projectImageAnalysisExecutor = read('src/renderer/services/skill-executors/project-image-analysis.executor.ts');
  const designReferenceSearchExecutor = read('src/renderer/services/skill-executors/design-reference-search.executor.ts');
  const visualAnalysisExecutor = read('src/renderer/services/skill-executors/visual-analysis.executor.ts');
  const findEditElementExecutor = read('src/renderer/services/skill-executors/find-edit-element.executor.ts');
  const smartLayoutExecutor = read('src/renderer/services/skill-executors/smart-layout.executor.ts');
  const toolExecutor = read('src/renderer/services/tool-executor.service.ts');
  const conversational = read('src/renderer/services/agent-orchestration/conversational.ts');
const streamingPolicy = read('src/renderer/services/agent-orchestration/streaming-policy.ts');
const streamChatService = read('src/renderer/services/stream-chat.service.ts');
  const chatResponseCleaner = read('src/shared/chat-response-cleaner.ts');
  const toolResultBlock = read('src/renderer/components/message/blocks/ToolResultBlock.tsx');
  const thinkingBlockComponent = read('src/renderer/components/message/blocks/ThinkingBlock.tsx');
  const messageRenderer = read('src/renderer/components/message/MessageRenderer.tsx');
  const messageRendererCss = read('src/renderer/components/message/MessageRenderer.css');
  const messageTypes = read('src/renderer/components/message/types.ts');
  const messageParser = read('src/renderer/components/message/parser.ts');
  const thinkingStepPresentation = read('src/renderer/components/message/thinkingStepPresentation.ts');
  const appStore = read('src/renderer/stores/app.store.ts');
  const skuDeliverySummary = read('src/shared/sku-delivery-summary.ts');
  const designAgentEngine = read('src/renderer/services/design-agent/engine.ts');
  const agentRuntime = read('src/renderer/services/agent-runtime/agent.ts');
  const autonomousAgentExecutor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
  const quickCommandSection = sourceSection(chatPanel, 'const tryQuickCommand', 'const handleUnifiedAgent');
  const unifiedAgentSection = sourceSection(chatPanel, 'const handleUnifiedAgent', 'const handleDesktopDebug');
  const answerStreamSettlementSection = sourceSection(chatPanel, 'const settleLiveThinkingBeforeAnswerStream', 'const updateStreamedAssistantContent');
  const streamingUpdateSection = sourceSection(chatPanel, 'const updateStreamedAssistantContent', 'const updateStreamedVisibleReasoning');
  const streamedVisibleReasoningSection = sourceSection(chatPanel, 'const updateStreamedVisibleReasoning', 'const finalizeStreamedAssistantMessage');
  const desktopDebugSection = sourceSection(chatPanel, 'const handleDesktopDebug', 'const handleCommand');

  assert(
    !chatPanel.includes("from './ExecutionStatus'") &&
      !chatPanel.includes('EXECUTION_TEMPLATES') &&
      !chatPanel.includes('showExecution') &&
      !chatPanel.includes('executionSteps') &&
      !fs.existsSync(path.join(ROOT, 'src/renderer/components/ExecutionStatus.tsx')) &&
      !fs.existsSync(path.join(ROOT, 'src/renderer/hooks/useExecution.ts')),
    'ChatPanel must not use legacy hard-coded execution templates or the old AI execution status panel'
  );
  assert(
    /\.multimodal-message\s*\{[\s\S]*width:\s*100%;[\s\S]*align-self:\s*stretch;[\s\S]*min-inline-size:\s*0;/.test(messageRendererCss)
      && /\.message-body\s*\{[\s\S]*flex:\s*1 1 calc\(100% - 60px\);[\s\S]*width:\s*calc\(100% - 60px\);[\s\S]*min-width:\s*0;/.test(messageRendererCss)
      && /\.multimodal-message\.user \.message-body\s*\{[\s\S]*flex:\s*0 1 min\(70%, calc\(100% - 60px\)\);[\s\S]*width:\s*auto;/.test(messageRendererCss)
      && /\.message-blocks-wrapper\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(messageRendererCss)
      && /\.message-blocks\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(messageRendererCss)
      && /\.message-block\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;[\s\S]*box-sizing:\s*border-box;/.test(messageRendererCss)
      && /\.text-block\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/.test(messageRendererCss)
      && /\.detail-value\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;/.test(messageRendererCss)
      && /\.card-content\s*\{[\s\S]*overflow-wrap:\s*anywhere;/.test(messageRendererCss),
    'MessageRenderer must constrain and wrap long SKU/status text instead of allowing horizontal overflow'
  );
  assert(
    /\.multimodal-message\.assistant \.message-body\s*\{[\s\S]*min-width:\s*min\(320px, calc\(100% - 60px\)\);[\s\S]*min-inline-size:\s*min\(320px, calc\(100% - 60px\)\);/.test(messageRendererCss)
      && /\.multimodal-message\.assistant \.message-blocks\s*\{[\s\S]*align-items:\s*stretch;[\s\S]*width:\s*100%;[\s\S]*inline-size:\s*100%;/.test(messageRendererCss)
      && /\.multimodal-message\.assistant \.message-block\s*\{[\s\S]*width:\s*100%;[\s\S]*inline-size:\s*100%;/.test(messageRendererCss),
    'Assistant message blocks must keep a practical full-width column so waiting/status copy cannot collapse into vertical single-character text'
  );
  assert(
    /\.collapsible-block\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(messageRendererCss)
      && /\.collapsible-content\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;[\s\S]*overflow-wrap:\s*anywhere;/.test(messageRendererCss)
      && /\.action-buttons\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*min-width:\s*0;/.test(messageRendererCss)
      && /\.action-btn \.btn-label\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;/.test(messageRendererCss)
      && /\.artifact-title\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;/.test(messageRendererCss)
      && /\.file-info\s*\{[\s\S]*min-width:\s*0;/.test(messageRendererCss),
    'Expanded collapsible/tool/action/file/artifact content must not stretch the chat viewport'
  );
  assert(
    /contain:\s*inline-size;/.test(messageRendererCss)
      && /\.message-block\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(messageRendererCss)
      && /\.code-content\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;[\s\S]*overscroll-behavior-inline:\s*contain;/.test(messageRendererCss)
      && /\.table-block\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;[\s\S]*overscroll-behavior-inline:\s*contain;/.test(messageRendererCss)
      && /\.table-block table\s*\{[\s\S]*table-layout:\s*fixed;/.test(messageRendererCss)
      && /\.collapsible-content > \.message-block\s*\{[\s\S]*width:\s*100%;[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(messageRendererCss),
    'Expanded message internals must use logical width containment so code, tables and nested collapsible blocks cannot expand the parent chat width'
  );
  assert(
    !sourceSection(messageRendererCss, '.message-block {', '/* ============================================\n   文本块').includes('contain: inline-size'),
    'Generic message-block must not use inline-size containment because ordinary user text bubbles can collapse to single-character width'
  );
  assert(
    /\.thinking-steps\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(messageRendererCss)
      && /\.thinking-step\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(messageRendererCss)
      && /\.thinking-summary\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-width:\s*0;/.test(messageRendererCss)
      && /\.expand-toggle\s*\{[\s\S]*flex:\s*0 0 auto;/.test(messageRendererCss)
      && /\.thinking-step \.step-text\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;/.test(messageRendererCss),
    'Expanded persisted thinking steps must wrap inside the message width instead of stretching the chat viewport'
  );
  assert(
    /\.text-block\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;[\s\S]*box-sizing:\s*border-box;/.test(messageRendererCss)
      && /\.thinking-block\s*\{[\s\S]*width:\s*100%;[\s\S]*inline-size:\s*100%;[\s\S]*overflow-x:\s*hidden;/.test(messageRendererCss)
      && /\.thinking-steps\s*\{[\s\S]*inline-size:\s*100%;[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;[\s\S]*overflow-x:\s*hidden;/.test(messageRendererCss)
      && /\.thinking-step \.step-text\s*\{[\s\S]*flex:\s*1 1 0;[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(messageRendererCss)
      && /\.card-content\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(messageRendererCss),
    'MessageRenderer text/card/thinking blocks must own their logical width so long SKU summaries wrap instead of widening the chat column'
  );
  const persistedThinkingHasSemanticClasses = messageRendererCss.includes('.thinking-step--thought')
    && messageRendererCss.includes('.thinking-step--action')
    && messageRendererCss.includes('.thinking-step--reasoning')
    && messageRendererCss.includes('.thinking-step--decision')
    && messageRendererCss.includes('.thinking-step--observation')
    && messageRendererCss.includes('.thinking-step--agent')
    && messageRendererCss.includes('.step-role-marker')
    && messageRendererCss.includes('.step-action-marker');
  const liveThinkingHasLegacySemanticMarkers = thinkingProcessCss.includes('.pondering-step--thought')
    && thinkingProcessCss.includes('.pondering-step--action')
    && thinkingProcessCss.includes('.pondering-step--reasoning')
    && thinkingProcessCss.includes('.pondering-step--decision')
    && thinkingProcessCss.includes('.pondering-step--observation')
    && thinkingProcessCss.includes('.pondering-step--agent')
    && thinkingProcessCss.includes('.step-role-marker')
    && thinkingProcessCss.includes('.step-action-marker');
  const liveThinkingHasTimelineNodes = thinkingProcessCss.includes('.is-thought')
    && thinkingProcessCss.includes('.is-action')
    && thinkingProcessCss.includes('.step-node')
    && thinkingProcessCss.includes('.pondering-step--reasoning')
    && thinkingProcessCss.includes('.pondering-step--decision')
    && thinkingProcessCss.includes('.pondering-step--observation')
    && thinkingProcessCss.includes('.pondering-step--agent');
  assert(
    persistedThinkingHasSemanticClasses && (liveThinkingHasLegacySemanticMarkers || liveThinkingHasTimelineNodes),
    'Thinking UI must render a natural timeline with distinct reasoning, decision, observation, agent-note and action styles, not a uniform debug-log list'
  );
  assert(
    thinkingStepPresentation.includes('export type ThinkingStepDisplayRole')
      && thinkingStepPresentation.includes("'reasoning'")
      && thinkingStepPresentation.includes("'decision'")
      && thinkingStepPresentation.includes("'observation'")
      && thinkingStepPresentation.includes("'agent'")
      && thinkingStepPresentation.includes("'action'")
      && thinkingStepPresentation.includes('resolveThinkingStepDisplayRole')
      && thinkingStepPresentation.includes('resolveThinkingStepRoleLabel')
      && messageTypes.includes('displayRole?: ThinkingStepDisplayRole')
      && messageTypes.includes('roleLabel?: string')
      && messageParser.includes('resolveThinkingStepDisplayRole')
      && messageParser.includes('displayRole,')
      && thinkingBlockComponent.includes('thinking-step--${displayRole}')
      && thinkingBlockComponent.includes('step-role-marker')
      && thinkingProcess.includes('pondering-step--${displayRole}')
      && (thinkingProcess.includes('step-role-marker') || thinkingProcess.includes('aria-label={semanticLabel}')),
    'Thinking step presentation roles must be shared by persisted and live process renderers instead of inferred by ad-hoc CSS only'
  );
  assert(
    messageParser.includes('function normalizeHistoricalThinkingSteps')
      && messageParser.includes('convertThinkingSteps(thinkingSteps, message.id, message.isThinking === true)')
      && messageParser.includes('const visibleTimelineSteps = timelineSteps.filter(isVisibleTimelineStep)')
      && messageParser.includes('resolveThinkingBlockTitle(visibleTimelineSteps, isStreaming)')
      && messageParser.includes("if (hasProcessStep && hasToolStep) return '判断与处理';")
      && messageParser.includes("if (hasToolStep) return '处理';")
      && /function resolveThinkingBlockTitle\(steps:[\s\S]{0,120}isStreaming = false[\s\S]{0,500}return '思考';/.test(messageParser),
    'Persisted completed messages must normalize stale running/pending thinking states so they do not show an active thinking title after completion'
  );
  assert(
    messageRenderer.includes('getMessageRendererBlockSignature')
      && messageRenderer.includes('getMessageRendererMessageSignature')
      && !/prevMsg\.blocks\.every\(\(b,\s*i\)\s*=>\s*b\.id\s*===\s*nextMsg\.blocks\[i\]\?\.id\)/.test(messageRenderer),
    'MessageRenderer memo comparator must include block content/status/result signatures so streaming text updates re-render even when block ids stay stable'
  );
  assert(
    !messageRenderer.includes('className="message-model"')
      && !messageRenderer.includes('className="message-duration"')
      && !messageRenderer.includes('formattedDuration'),
    'MessageRenderer must not expose model name or timing metadata in the normal chat message footer'
  );
  assert(
    /\.thinking-simple\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(thinkingProcessCss)
      && /\.live-activity-placeholder \.pondering-title\s*\{[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;/.test(thinkingProcessCss)
      && /\.pondering-step\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(thinkingProcessCss)
      && /(?:\.pondering-step \.step-text|\.step-text)\s*\{[\s\S]*min-width:\s*0;[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;/.test(thinkingProcessCss),
    'Expanded live thinking steps must wrap inside the message width instead of stretching the chat viewport'
  );
  assert(
    /\.thinking-simple\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;[\s\S]*overflow-x:\s*hidden;/.test(thinkingProcessCss)
      && /\.thinking-simple\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*width:\s*100%;[\s\S]*inline-size:\s*100%;/.test(thinkingProcessCss)
      && /\.live-activity-placeholder\s*\{[\s\S]*width:\s*100%;[\s\S]*inline-size:\s*100%;[\s\S]*flex:\s*1 1 auto;/.test(thinkingProcessCss)
      && /\.pondering-step\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(thinkingProcessCss)
      && /(?:\.pondering-step \.step-text|\.step-text)\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(thinkingProcessCss)
      && !sourceSection(thinkingProcessCss, '.thinking-simple {', '.live-activity-placeholder').includes('contain: inline-size'),
    'Live thinking panels must have logical width constraints without inline-size containment collapsing the live activity column'
  );
  assert(
    /\.chat-panel\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/.test(chatPanel)
      && /\.message-wrapper\.message \.message-content\s*\{[\s\S]*min-width:\s*0;/.test(chatPanel)
      && /\.message-content\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;/.test(chatPanel)
      && /\.message-text\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/.test(chatPanel)
      && /\.detail-value\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;/.test(chatPanel)
      && /\.file-name\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;/.test(chatPanel),
    'ChatPanel legacy message/result styles must wrap or truncate long SKU output inside the viewport'
  );
  assert(
    /\.chat-panel\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(chatPanel)
      && /\.messages-container\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(chatPanel)
      && /\.message-wrapper\s*\{[\s\S]*width:\s*100%;[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(chatPanel)
      && /\.message-wrapper\.message \.message-content\s*\{[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*calc\(100% - 60px\);/.test(chatPanel)
      && /\.message\s*\{[\s\S]*width:\s*100%;[\s\S]*align-self:\s*stretch;[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;/.test(chatPanel)
      && /\.message-content\s*\{[\s\S]*flex:\s*1 1 0;[\s\S]*width:\s*calc\(100% - 48px\);[\s\S]*max-inline-size:\s*min\(70%, calc\(100% - 48px\)\);/.test(chatPanel)
      && /\.message\.live-agent-message \.message-content\s*\{[\s\S]*flex:\s*1 0 calc\(100% - 48px\);[\s\S]*width:\s*calc\(100% - 48px\);[\s\S]*max-inline-size:\s*calc\(100% - 48px\);/.test(chatPanel),
    'ChatPanel outer containers must prevent legacy and multimodal message content from widening the viewport'
  );
  assert(
    chatPanel.includes('activeAgentRunIdRef')
      && chatPanel.includes('cancelledAgentRunIdsRef')
      && chatPanel.includes('markActiveAgentRunStopped')
      && unifiedAgentSection.includes('const canApplyRunUpdate = () =>')
      && unifiedAgentSection.includes('const throwIfRunStopped = () =>')
      && unifiedAgentSection.includes('if (!canApplyRunUpdate()) return;')
      && unifiedAgentSection.includes('throwIfRunStopped();')
      && unifiedAgentSection.includes('activeAgentRunIdRef.current === runId')
      && sourceSection(chatPanel, 'className="send-button stop-button"', 'title="停止生成"').includes('markActiveAgentRunStopped();'),
    'ChatPanel must gate all async Agent UI updates by active run id so cancelled or stale runs cannot append old results'
  );
  assert(
    skillExecutors.includes('function isSkillExecutionCancelled')
      && skillExecutors.includes('function buildCancelledSkillResult')
      && skillExecutors.includes('if (isSkillExecutionCancelled(executeParams))')
      && skillExecutors.includes('if (isSkillExecutionCancelled(executeParamsForBusiness))')
      && skillExecutors.includes('const executorResult = await executor.execute(executeParamsForBusiness);')
      && skillExecutors.indexOf('if (isSkillExecutionCancelled(executeParamsForBusiness))') > skillExecutors.indexOf('const executorResult = await executor.execute(executeParamsForBusiness);'),
    'Skill executor lifecycle must stop before/after slow executors and return a cancelled result instead of completing stale work'
  );
  assert(
    /async execute\(\{\s*params,\s*callbacks,\s*signal,\s*context\s*\}: SkillExecuteParams\)/.test(projectImageAnalysisExecutor)
      && projectImageAnalysisExecutor.includes('const isCancelled = () => Boolean(signal?.aborted);')
      && projectImageAnalysisExecutor.includes('if (isCancelled()) return buildCancelledResult();')
      && projectImageAnalysisExecutor.includes('if (isCancelled()) break;')
      && projectImageAnalysisExecutor.indexOf('if (isCancelled()) break;') < projectImageAnalysisExecutor.indexOf('await (window as any).designEcho.analyzeAssetContent(image.path)')
      && projectImageAnalysisExecutor.includes('if (isCancelled()) return buildCancelledResult(analyses.length);'),
    'Project image analysis executor must honor AbortSignal before sampling, between image reads, and before returning summaries'
  );
  assert(
    skuDeliverySummary.includes('buildSkuDeliverySummary') &&
      skuDeliverySummary.includes('compactText') &&
      skuDeliverySummary.includes('detailText') &&
      !/confidence|置信/.test(skuDeliverySummary),
    'SKU delivery results must be summarized by a shared compact/detailed structure without confidence fields'
  );
  assert(
    messageParser.includes('buildSkuDeliverySummaryBlocks') &&
      messageParser.includes('skuDeliverySummaryHash') &&
      messageParser.includes('SKU 交付状态') &&
      messageParser.includes('SKU 明细'),
    'Message parser must render SKU delivery summary as compact status plus collapsible details'
  );
  assert(
    chatPanel.includes('skuDeliverySummary = (result as any).data?.skuDeliverySummary') &&
      chatPanel.includes('skuDeliverySummary: options?.skuDeliverySummary') &&
      appStore.includes('skuDeliverySummary?: SkuDeliverySummary'),
    'ChatPanel and app store must preserve SKU delivery summary metadata on assistant messages'
  );
  assert(
    chatPanel.includes('const quickResult = await tryQuickCommand(userInput);') &&
      chatPanel.includes('await handleUnifiedAgent(userInput, imageToSend || undefined') &&
      chatPanel.includes('publicPlanConfirmationSourceMessageId'),
    'ChatPanel must route non-quick user input into handleUnifiedAgent'
  );
  assert(
    app.includes("params.get('designechoChatTestProjectPath')") &&
      !app.includes('if (currentProject) return;') &&
      app.includes('useAppStore.getState().currentProject') &&
      app.includes('hydratedProject?.path === projectPath') &&
      app.includes('onFinishHydration') &&
      app.includes('commitProjectSession({') &&
      app.includes('projectScanned.current = null;'),
    'Chat test project query must override hydrated user-state projects through the single project-session owner and reset the project scan gate'
  );
  assert(
    !/关闭|关掉|文档|字体|详情页|主图/.test(quickCommandSection),
    'tryQuickCommand must not hard-code normal design/document requests'
  );
  assert(
    unifiedAgentSection.includes('processWithUnifiedAgent(agentContext') &&
      unifiedAgentSection.includes('const stateForConversation = useAppStore.getState()') &&
      unifiedAgentSection.includes('const runConversation = runConversationId') &&
      unifiedAgentSection.includes('const latestMessages = runConversation?.messages') &&
      unifiedAgentSection.includes('runConversationId === stateForConversation.currentConversationId') &&
      unifiedAgentSection.includes('conversationHistory: latestMessages') &&
      unifiedAgentSection.includes('.filter(shouldIncludeMessageInAgentConversationHistory)') &&
      unifiedAgentSection.includes('.map(m => ({') &&
      unifiedAgentSection.includes('id: m.id') &&
      unifiedAgentSection.includes('photoshopContext') &&
      unifiedAgentSection.includes('attachedImages'),
    'handleUnifiedAgent must build the real Agent context from the latest store messages, including message ids used by public-plan confirmation'
  );
  assert(
    unifiedAgentSection.includes('const submissionWorkflowContext = toOperatingWorkflowContext(workflowSelectionContext)') &&
      unifiedAgentSection.includes('const operatingContextSnapshot = buildOperatingContextSnapshot({') &&
      unifiedAgentSection.includes('expectedProjectPresent: Boolean(submissionProject)') &&
      unifiedAgentSection.includes('expectedProjectId: submissionProjectId || undefined') &&
      unifiedAgentSection.includes('expectedProjectPath: submissionProjectPath || undefined') &&
      unifiedAgentSection.includes('workflow: submissionWorkflowContext') &&
      unifiedAgentSection.includes('operatingContextSnapshot,'),
    'handleUnifiedAgent must freeze workflow, project and Photoshop observations into the same request-scoped operating context'
  );
  assert(
    unifiedAgentSection.includes('agentTaskPublicPlanExecutionRequest') &&
      unifiedAgentSection.includes('agentTaskPublicPlanApprovalRecord') &&
      unifiedAgentSection.includes('agentTaskPublicPlanControlledRun') &&
      unifiedAgentSection.includes('agentTaskPublicPlan: m.agentTaskPublicPlan') &&
      unifiedAgentSection.includes('agentTaskPublicPlanExecutionRequest: m.agentTaskPublicPlanExecutionRequest'),
    'ChatPanel must preserve public plan request, approval record, and controlled run through conversation history'
  );
  assert(
    unifiedAgentSection.includes('agentTaskPublicPlanControlledRun: m.agentTaskPublicPlanControlledRun') &&
      unifiedAgentSection.includes('agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun') &&
      unifiedAgentSection.includes('data?.agentTaskPublicPlanControlledRun'),
    'ChatPanel must persist public plan controlled runner output into assistant messages'
  );
  assert(
    chatPanel.includes('createPublicPlanPhotoshopAdapter') &&
      chatPanel.includes('buildRuntimePublicPlanLiveAdapterApproval') &&
      testBridge.includes('publicPlanDisposableLiveAdapter?: boolean') &&
      chatPanel.includes('publicPlanConfirmationSourceMessageId: options?.publicPlanConfirmationSourceMessageId') &&
      chatPanel.includes('publicPlanDisposableLiveAdapter: options?.publicPlanDisposableLiveAdapter'),
    'ChatPanel test bridge must be able to inject a runtime-only disposable public-plan adapter without changing the normal confirm action'
  );
  assert(
    chatPanel.includes('publicPlanPrivateOperationRequestsRef') &&
      unifiedAgentSection.includes('runtimeOperationRequests: runOptions?.publicPlanConfirmationSourceMessageId') &&
      unifiedAgentSection.includes('publicPlanPrivateOperationRequestsRef.current[runOptions.publicPlanConfirmationSourceMessageId]') &&
      chatPanel.includes('extractRuntimeOperationRequestsFromPublicPlanExecutionRequest') &&
      chatPanel.includes('stripRuntimeParamsFromPublicPlanExecutionRequest') &&
      chatPanel.includes('stripRuntimeParamsFromPublicPlanControlledRun') &&
      chatPanel.includes('buildPublicPlanMessagePayload') &&
      chatPanel.includes('cachePrivatePublicPlanOperationRequests(messageId') &&
      chatPanel.includes('cachePrivatePublicPlanOperationRequests(streamedAssistantMessageId'),
    'ChatPanel must keep public-plan runtime params in a private ref while stripping them from assistant message payloads'
  );
  assert(
    appStore.includes('sanitizeMessageForPersistence') &&
      appStore.includes('stripRuntimeParamsFromPublicPlanExecutionRequest') &&
      appStore.includes('stripRuntimeParamsFromPublicPlanControlledRun') &&
      appStore.includes('sanitizeConversationsForPersistence(conversations)') &&
      appStore.includes('const safeMessage = sanitizeMessageForPersistence(message)') &&
      (appStore.includes('const safeUpdates = sanitizeMessageForPersistence(updates)')
        || appStore.includes('sanitizeMessageForPersistence({ ...m, ...updates })')
        || appStore.includes('sanitizeMessageForPersistence({ ...m, ...guardedUpdates })')),
    'App store persistence must strip public-plan runtime params from messages and saved conversations as a safety net'
  );
  assert(
    unifiedAgentSection.includes('executionSummary') &&
      unifiedAgentSection.includes('readAgentExecutionSummaryFromResult(result)'),
    'ChatPanel must preserve Agent executionSummary into assistant messages'
  );
  assert(
    unifiedAgentSection.includes('onToolComplete') &&
      unifiedAgentSection.includes('toolResult: toolResult') &&
      unifiedAgentSection.includes('thinkingSteps: stepsToSave'),
    'ChatPanel must preserve completed tool results into message thinking steps'
  );
  assert(
    unifiedAgentSection.includes('hasVisibleProcessSteps') &&
      unifiedAgentSection.includes('普通聊天不保存固定系统日志') &&
      !unifiedAgentSection.includes('生成对话回复') &&
      !unifiedAgentSection.includes('hasToolExecution || hasThinkingContent'),
    'ChatPanel must not persist hard-coded ordinary-chat or skill telemetry as model thinking'
  );
  assert(
    chatPanel.includes('isVisibleAgentProcessEvent(event)') &&
      chatPanel.includes('formatAgentProcessEventContent(event)') &&
      chatPanel.includes('getVisibleAgentProcessStepType(event)') &&
      !chatPanel.includes('mapAgentStepType'),
    'ChatPanel must map public Agent process events into visible process steps without reviving legacy telemetry mapping'
  );
  assert(
    !visibleFeedback.includes('LIVE_AGENT_WAITING_TITLE') &&
      !visibleFeedback.includes('LIVE_AGENT_WAITING_TEXT') &&
      !visibleFeedback.includes('\u7b49\u5f85\u54cd\u5e94') &&
      !visibleFeedback.includes('\u6b63\u5728\u51c6\u5907') &&
      !visibleFeedback.includes('\u8bf7\u6c42\u5df2\u53d1\u9001') &&
      visibleFeedback.includes('isVisibleAgentStepEvent') &&
      visibleFeedback.includes("'tool_started'") &&
      visibleFeedback.includes("'tool_completed'") &&
      visibleFeedback.includes('buildVisibleAgentActivityFromStepEvent') &&
      visibleFeedback.includes('isVisibleAgentProcessEvent') &&
      visibleFeedback.includes("'observation'") &&
      visibleFeedback.includes("'verification'") &&
      visibleFeedback.includes('showAsThinking: false') &&
      visibleFeedback.includes('canClaimModelReasoning: false') &&
      !visibleFeedback.includes("'model_request'") &&
      !visibleFeedback.includes("'model_response'"),
    'Visible feedback contract must expose tool events, public process events and agent identity without waiting placeholder or fake thinking'
  );
  assert(
    !thinkingProcess.includes('isActive?: boolean') &&
      !thinkingProcess.includes('LIVE_AGENT_WAITING_TITLE') &&
      !thinkingProcess.includes('LIVE_AGENT_WAITING_TEXT') &&
      !thinkingProcess.includes('thinking-waiting') &&
      !thinkingProcess.includes('pondering-waiting-text') &&
      !thinkingProcess.includes('\u7b49\u5f85\u54cd\u5e94') &&
      !thinkingProcess.includes('\u6b63\u5728\u51c6\u5907') &&
      !thinkingProcess.includes('\u8bf7\u6c42\u5df2\u53d1\u9001') &&
      thinkingProcess.includes('const VISIBLE_STEP_TYPES') &&
      thinkingProcess.includes("'thinking'") &&
      thinkingProcess.includes("'status'") &&
      thinkingProcess.includes("'decision'") &&
      thinkingProcess.includes("'analyzing'") &&
      thinkingProcess.includes("'tool_call'") &&
      thinkingProcess.includes("'tool_result'") &&
      thinkingProcess.includes('resolveThinkingPanelTitle(validSteps)') &&
      thinkingProcess.includes('renderStepPanel(resolveThinkingPanelTitle(validSteps), validSteps)') &&
      thinkingProcess.includes('isActionStep(step)') &&
      (thinkingProcess.includes('step-action-marker') || thinkingProcess.includes('aria-label={semanticLabel}')) &&
      !thinkingProcess.includes("renderStepPanel('\u6267\u884c\u8fdb\u5ea6'"),
    'ThinkingProcess must render public process events and tool calls, with no fake waiting/progress placeholder'
  );
  assert(
    chatPanel.includes("from '../services/agent-visible-feedback'") &&
      chatPanel.includes('formatAgentToolEventContent(event)') &&
      chatPanel.includes('formatAgentProcessEventContent(event)') &&
      chatPanel.includes('isVisibleAgentStepEvent(event)') &&
      chatPanel.includes('isVisibleAgentProcessEvent(event)') &&
      chatPanel.includes("setLiveActivity(buildVisibleAgentActivityFromRunPhase('context_loading'))") &&
      chatPanel.indexOf("setLiveActivity(buildVisibleAgentActivityFromRunPhase('context_loading'))") <
        chatPanel.indexOf('const projectContext = await getProjectContext({') &&
      chatPanel.includes("setLiveActivity(current => buildVisibleAgentActivityFromRunPhase('agent_processing', current))") &&
      chatPanel.indexOf("setLiveActivity(current => buildVisibleAgentActivityFromRunPhase('agent_processing', current))") <
        chatPanel.indexOf('const result = await processWithUnifiedAgent(agentContext, {') &&
      chatPanel.includes('const [liveActivity, setLiveActivity]') &&
      chatPanel.includes('data-testid="live-agent-activity"') &&
      chatPanel.includes('buildVisibleAgentActivityFromStepEvent(event)') &&
      chatPanel.includes('buildVisibleAgentActivityFromProgress(message, current)') &&
      !chatPanel.includes('ensureStreamedAssistantMessage') &&
      !chatPanel.includes('agent-stream:pending') &&
      chatPanel.includes('if (!visibleContent.trim()) return;') &&
      chatPanel.includes('content: visibleContent') &&
      chatPanel.includes('{activity.detail || activity.agentLabel}') &&
      !chatPanel.includes('{activity.title}') &&
      chatPanel.includes('live-agent-message') &&
      !chatPanel.includes('agent-activity-label') &&
      !chatPanel.includes('LIVE_ACTIVITY_THINKING_TITLE') &&
      chatPanel.includes('thinkingSteps.some(isVisiblePonderingStep) || liveActivity') &&
      chatPanel.includes('isVisiblePonderingStep(newStep)') &&
      chatPanel.includes('<LiveActivityIndicator activity={liveActivity} />') &&
      !chatPanel.includes('isActive={isLoading}'),
    'ChatPanel must keep a factual run phase visible until real model/tool evidence takes over, without empty pending assistant messages'
  );
  assert(
    toolResultBlock.includes('sanitizeUserVisibleDiagnosticText') &&
      toolResultBlock.includes('const cleaned = sanitizeUserVisibleDiagnosticText(value)'),
    'ToolResultBlock raw string values must pass through the shared user-visible diagnostic cleaner'
  );
  assert(
    toolResultBlock.includes('const safeErrorText = sanitizeUserVisibleDiagnosticText(block.error)') &&
      toolResultBlock.includes('const safeDetailLabel') &&
      toolResultBlock.includes('const safeDetailValue'),
    'ToolResultBlock must sanitize direct error/detail labels and values at render time, including code/link details'
  );
  assert(
    !toolResultBlock.includes('<code>{detail.value}</code>') &&
      !toolResultBlock.includes('href={String(detail.value)}') &&
      !toolResultBlock.includes('{detail.value}\n                                            </a>'),
    'ToolResultBlock must not render raw code/link detail values or hrefs'
  );
  assert(
    agentRuntime.includes('requestInitialVisibleReasoningIfNeeded') &&
      agentRuntime.includes('short user-visible reasoning summary in Chinese') &&
      agentRuntime.includes('const requireUserVisiblePreActionRationale = this.shouldRequireUserVisiblePreActionRationaleForToolCalls(response.toolCalls)') &&
      agentRuntime.includes('if (requireUserVisiblePreActionRationale)') &&
      agentRuntime.includes("this.emitVisibleReasoning(response.content, { source: 'model_visible_reasoning' });") &&
      agentRuntime.includes('if (!response.toolCalls?.length && modelThinking)') &&
      agentRuntime.includes("source: 'provider_thinking_delta'") &&
      agentRuntime.includes('isProviderThinking && this.config.thinkingEnabled !== true') &&
      agentRuntime.includes('? finalizeUserVisibleThinkingText(rawText, { requireSentenceBoundary: true })') &&
      !agentRuntime.includes("onContentDelta: (fullContent) => {\n                modelContent = fullContent;") &&
      autonomousAgentExecutor.includes('开始实际处理前，只用一句设计语言说明') &&
      autonomousAgentExecutor.includes('不要列能力、工具、门禁或技术步骤') &&
      autonomousAgentExecutor.includes('provider-visible reasoning_content'),
    'Tool-calling Agent must keep public planning separate while forwarding sanitized provider thinking only when the user enabled Thinking'
  );
  assert(
    unifiedAgentSection.includes('mergeVisibleThinking') &&
      unifiedAgentSection.includes('mergeVisibleThinking(currentStep?.content') &&
      unifiedAgentSection.includes('isProviderThinkingSnapshot') &&
      unifiedAgentSection.includes('? visibleThinking') &&
      !unifiedAgentSection.includes('接收用户请求。纯文本请求'),
    'ChatPanel must merge public summaries while replacing provider Thinking snapshots without hard-coded fake steps'
  );
  assert(
    unifiedAgentSection.includes('cleanResponseContent') &&
      chatPanel.includes('sanitizeUserVisibleAgentText') &&
      chatPanel.includes('sanitizeUserVisibleAssistantBodyText') &&
      chatPanel.includes('formatUserVisibleFailureContent') &&
      chatResponseCleaner.includes('directResponse') &&
      chatResponseCleaner.includes('clarificationQuestion') &&
      chatResponseCleaner.includes('tool_call') &&
      chatResponseCleaner.includes('sanitizeUserVisibleAgentText') &&
      chatResponseCleaner.includes('sanitizeUserVisibleAssistantBodyText') &&
      chatResponseCleaner.includes('sanitizeUserVisibleDiagnosticText'),
    'ChatPanel must clean structured model wrapper JSON and user-visible diagnostic text before showing assistant replies'
  );
  const legacyUserVisibleErrorTemplates = [
    'content: `❌ 应用失败：${error instanceof Error ? error.message : \'未知错误\'}`',
    'content: `❌ 应用文案失败：${error.message}`',
    'content: `❌ 优化失败：${error instanceof Error ? error.message : \'未知错误\'}`',
    'content: `❌ 图片生成失败: ${result.error || \'未知错误\'}`',
    'content: `❌ 图片生成出错: ${error.message || \'未知错误\'}`',
    'content: `❌ 分析失败：${error instanceof Error ? error.message : \'未知错误\'}`',
    'content: `❌ 截图失败：${captureResult?.error || \'接口不可用\'}`',
    'content: `❌ 截图失败：${error?.message || \'未知错误\'}`',
    'content: `❌ 处理失败：${error instanceof Error ? error.message : \'未知错误\'}`',
    'results.push(`❌ ${name}: ${result.error || \'失败\'}`)',
    'results.push(`❌ ${name}: ${error.message}`)',
    'content: `❌ 测试过程中发生错误：${error.message}`',
    'content: `❌ 桌面端联调失败：${error?.message || \'未知错误\'}`',
    'content: `❌ 获取文档列表失败：${result.error}`',
    'content: `❌ 获取文档列表时出错：${e.message}`'
  ];
  for (const template of legacyUserVisibleErrorTemplates) {
    assert(
      !chatPanel.includes(template),
      `ChatPanel user-visible error path must use the shared diagnostic cleaner instead of raw error text: ${template}`
    );
  }
  assert(
    streamingUpdateSection.includes('sanitizeUserVisibleAssistantBodyText(content)') &&
      !streamingUpdateSection.includes('content,'),
    'ChatPanel must sanitize streamed assistant intermediate content before updating visible message content'
  );
  assert(
    answerStreamSettlementSection.includes("step.type === 'thinking' && step.status === 'running'")
      && answerStreamSettlementSection.includes("updateStep(step.id, { status: 'success' })")
      && answerStreamSettlementSection.includes('setShowThinking(false)')
      && streamingUpdateSection.indexOf('if (!visibleContent.trim()) return;')
        < streamingUpdateSection.indexOf('settleLiveThinkingBeforeAnswerStream();')
      && streamingUpdateSection.indexOf('settleLiveThinkingBeforeAnswerStream();')
        < streamingUpdateSection.indexOf('streamedAssistantMessageId = addRunAssistantMessage({')
      && streamedVisibleReasoningSection.indexOf('if (hasVisibleStreamedAssistantContent) return;')
        < streamedVisibleReasoningSection.indexOf('sanitizeUserVisibleThinkingText(content)')
      && /onThinking:\s*\(thinking, meta\)\s*=>\s*\{\s*if \(!canApplyRunUpdate\(\)\) return;\s*if \(hasVisibleStreamedAssistantContent\) return;/.test(unifiedAgentSection),
    'First visible answer token must irreversibly settle live Thinking before the assistant bubble starts streaming'
  );
  assert(
    unifiedAgentSection.includes('const deferVisibleStream = options?.deferVisibleStream === true') &&
      unifiedAgentSection.includes('} else if (!deferVisibleStream) {') &&
      conversational.includes('deferVisibleStream: isCapabilityConversationQuestion(context.userInput)') &&
      conversational.includes('|| Boolean(planOnlyBoundaryInstruction)'),
    'Capability chat should buffer provider token streams until conversational gates accept the final reply'
  );
  assert(
    streamedVisibleReasoningSection.includes('sanitizeUserVisibleThinkingText(content)') &&
      streamedVisibleReasoningSection.includes('if (!visibleText) return;') &&
      !streamedVisibleReasoningSection.includes("String(content || '').trim()"),
    'ChatPanel must sanitize streamed visible reasoning before adding it as thinking text'
  );
  assert(
    chatPanel.includes('sanitizeTestSnapshotPreview(message.content)') &&
      (chatPanel.includes('sanitizeTestSnapshotPreview((step as any).content)')
        || chatPanel.includes('sanitizeTestSnapshotPreview(step?.content)')) &&
      chatPanel.includes('sanitizeTestSnapshotToken((message.executionSummary as any)?.status)'),
    'ChatPanel test bridge snapshots must sanitize content and thinking previews while preserving machine-readable execution status tokens'
  );
  assert(
    chatPanel.includes('function readAgentExecutionSummaryFromResult(result: unknown)') &&
      chatPanel.includes('const direct = (result as any)?.executionSummary') &&
      chatPanel.includes('const nested = (result as any)?.data?.executionSummary') &&
      chatPanel.includes('normalizeAgentExecutionSummaryStatus') &&
      chatPanel.includes('STRUCTURED_AGENT_EXECUTION_STATUSES') &&
      chatPanel.includes("status: 'needs_review'") &&
      chatPanel.includes('const executionSummary = readAgentExecutionSummaryFromResult(result);'),
    'ChatPanel must read Agent executionSummary from direct or nested result data and normalize non-structured status text before persisting messages'
  );
  assert(
    visibleFeedback.includes('const safeDetail = detail') &&
      visibleFeedback.includes('sanitizeUserVisibleDiagnosticText(String(detail).trim())') &&
      visibleFeedback.includes('detail: safeDetail || undefined'),
    'Visible live activity details must pass through the shared diagnostic cleaner'
  );
  assert(
    !desktopDebugSection.includes('tool_call(') &&
      !desktopDebugSection.includes('工具调用路径') &&
      desktopDebugSection.includes('详细诊断已写入开发日志'),
    'desktop-debug user-visible output must keep technical routing details out of chat and leave them in logs'
  );
  assert(
    chatPanel.includes("case 'confirmPublicPlan'") &&
      chatPanel.includes("text: '确认计划'") &&
      !chatPanel.includes("text: '确认执行公开计划'") &&
      chatPanel.includes('publicPlanConfirmationSourceMessageId: sourceMessageId') &&
      chatPanel.includes('publicPlanDisposableLiveAdapter: shouldUseDisposableLiveAdapter'),
    'ChatPanel must expose a one-click design-plan confirmation action through the normal send path using user-facing wording'
  );
  const confirmPublicPlanSection = sourceSection(chatPanel, "case 'confirmPublicPlan':", 'default:');
  assert(
    !confirmPublicPlanSection.includes('executeToolCall(') &&
      !confirmPublicPlanSection.includes('sendToPlugin(') &&
      !confirmPublicPlanSection.includes('window.designEcho'),
    'public plan confirmation action must not bypass the controlled runner with direct Photoshop/tool calls'
  );
  assert(
    !confirmPublicPlanSection.includes('allowPhotoshopWrites') &&
      !confirmPublicPlanSection.includes('live-photoshop') &&
      !confirmPublicPlanSection.includes('executionTarget') &&
      !confirmPublicPlanSection.includes('liveExecutionScope') &&
      !confirmPublicPlanSection.includes('explicitProjectWriteApproval') &&
      !confirmPublicPlanSection.includes('approvedLiveExecution') &&
      !confirmPublicPlanSection.includes('approvedLiveAdapterRun') &&
      !confirmPublicPlanSection.includes('adapter:'),
    'public plan confirmation action must not grant live Photoshop execution; live handoff belongs to the controlled runner gate'
  );
  const publicPlanApprovalSection = sourceSection(chatPanel, 'const hasExplicitPublicPlanConfirmation = hasExplicitGeneratedPublicPlanApproval', '// 构建 Agent 上下文');
  assert(
    publicPlanApprovalSection.includes('sourceMessageId: runOptions?.publicPlanConfirmationSourceMessageId') &&
      publicPlanApprovalSection.includes('sourceRequestStatus: sourcePublicPlanRequest?.status') &&
      publicPlanApprovalSection.includes('const agentTaskPublicPlanApproval = hasExplicitPublicPlanConfirmation') &&
      publicPlanApprovalSection.includes('runtimeOperationRequests: runOptions?.publicPlanConfirmationSourceMessageId') &&
      publicPlanApprovalSection.includes('publicPlanPrivateOperationRequestsRef.current[runOptions.publicPlanConfirmationSourceMessageId]') &&
      !publicPlanApprovalSection.includes('approveGeneratedPublicPlan: true') &&
      !publicPlanApprovalSection.includes('executionTarget') &&
      !publicPlanApprovalSection.includes('allowPhotoshopWrites') &&
      !publicPlanApprovalSection.includes('liveExecutionScope') &&
      !publicPlanApprovalSection.includes('explicitProjectWriteApproval') &&
      !publicPlanApprovalSection.includes('approvedLiveExecution') &&
      !publicPlanApprovalSection.includes('approvedLiveAdapterRun') &&
      !publicPlanApprovalSection.includes('adapter:'),
    'ChatPanel public-plan approval object must restore only private runtime operation params and must not grant live execution'
  );
  assert(
    read('src/renderer/components/message/parser.ts').includes('buildPublicPlanExecutionRequestCard') &&
      read('src/renderer/components/message/parser.ts').includes('buildPublicPlanControlledRunCard') &&
      read('src/renderer/components/message/parser.ts').includes("action: 'confirmPublicPlan'"),
    'message parser must render public plan execution request and controlled run as compact cards'
  );
  assert(
    testBridge.includes('hasPublicPlanControlledRun') &&
      testBridge.includes('publicPlanControlledRunStatus'),
    'ChatPanel test bridge must expose public plan controlled runner status for acceptance'
  );
  assert(
    chatPanel.includes('publicPlanControlledRunBlockers') &&
      chatPanel.includes('publicPlanControlledRunOperationResults') &&
      chatPanel.includes('summarizePublicPlanControlledRunOperationResults'),
    'ChatPanel test bridge must expose public plan controlled runner blocker and operation result summaries for root-cause diagnosis'
  );
  assert(
    chatPanel.includes("import { streamChatAsync } from '../services/stream-chat.service'") &&
      chatPanel.includes("import { canUsePlainTextProviderStream } from '../services/agent-orchestration/streaming-policy'") &&
      unifiedAgentSection.includes('canUsePlainTextProviderStream') &&
      unifiedAgentSection.includes('streamChatAsync(') &&
      unifiedAgentSection.includes('onThinkingProgress') &&
      unifiedAgentSection.includes('streamedContentFromCall') &&
      unifiedAgentSection.includes('流式调用失败，尝试非流式补救') &&
      unifiedAgentSection.includes('流式为空或失败，非流式补救成功') &&
      unifiedAgentSection.includes('finalizeStreamedAssistantMessage') &&
      !unifiedAgentSection.includes('updateLastMessage('),
    'ChatPanel must use provider token streaming for streamable ordinary chat, fall back to non-streaming on empty/failed stream responses, and must not fake streaming with local typing'
  );
  const hasControlledVisibleReasoningPreview =
    designAgentEngine.includes('requestInitialVisibleIntentPreview') &&
    designAgentEngine.includes('shouldRequestInitialVisibleIntentPreview') &&
    designAgentEngine.includes('evaluateSimpleDeterministicRouteBoundary') &&
    designAgentEngine.includes("purpose: 'visible_reasoning'") &&
    designAgentEngine.includes('不要暴露私有链式思维') &&
    unifiedAgentSection.includes("options?.purpose === 'visible_reasoning'") &&
    unifiedAgentSection.includes("isRouterCall || isVisibleReasoningCall") &&
    unifiedAgentSection.includes('shouldUseAttachedImages && !isRouterCall && !isVisibleReasoningCall') &&
    unifiedAgentSection.includes('const streamHasAttachedImage = isVisibleReasoningCall ? false : shouldUseAttachedImages;') &&
    unifiedAgentSection.includes('updateStreamedVisibleReasoning(fullContent)') &&
    unifiedAgentSection.includes('if (streamOptions.thinkingEnabled !== true) return;') &&
    unifiedAgentSection.includes('updateStreamedVisibleReasoning(fullThinking)');
  const hasRemovedVisibleReasoningPreview =
    !designAgentEngine.includes('requestInitialVisibleIntentPreview') &&
    !designAgentEngine.includes('shouldRequestInitialVisibleIntentPreview') &&
    !designAgentEngine.includes("purpose: 'visible_reasoning'") &&
    designAgentEngine.includes('evaluateSimpleDeterministicRouteBoundary');
  assert(
    hasControlledVisibleReasoningPreview || hasRemovedVisibleReasoningPreview,
    'Controlled public planning must stay separate from opt-in provider thinking rendered through the sanitized Thinking panel'
  );
  assert(
    streamingPolicy.includes("options?.purpose !== 'direct_response'") &&
      streamingPolicy.includes("options?.purpose !== 'direct_response_repair'") &&
      streamingPolicy.includes("options?.purpose !== 'visible_reasoning'") &&
      streamingPolicy.includes('context.hasAttachedImage') &&
      streamingPolicy.includes('context.hasToolCalling') &&
      streamingPolicy.includes("typeof message.content === 'string'"),
    'Provider stream policy must explicitly allow direct plain-text responses, repair responses and visible reasoning, then block multimodal/tool-calling paths'
  );
  assert(
      conversational.includes('const shouldStreamDirectResponse = !isCapabilityConversationQuestion(context.userInput)') &&
      conversational.includes('stream: shouldStreamDirectResponse') &&
      conversational.includes("purpose: 'direct_response'") &&
      conversational.includes('maxTokens: planOnlyBoundaryInstruction ? 1200 : 900'),
    'Conversational model replies must stream ordinary direct replies but keep capability answers buffered until quality gates pass'
  );
  assert(
    unifiedAgentSection.includes("const isDirectResponseCall = options?.purpose === 'direct_response'") &&
      unifiedAgentSection.includes("const isDirectResponseLikeCall = isDirectResponseCall || options?.purpose === 'direct_response_repair'") &&
      unifiedAgentSection.includes('if (isVisibleReasoningCall) {') &&
      unifiedAgentSection.includes('thinking: isDirectResponseLikeCall || isVisibleReasoningCall ? undefined : response?.thinking') &&
      unifiedAgentSection.includes('thinking: isDirectResponseLikeCall || isVisibleReasoningCall ? undefined : fallbackResponse?.thinking') &&
      chatPanel.includes("lifecycle?.decision?.route === 'direct_response'"),
    'Direct conversational replies must keep provider thinking out of the assistant body and final payload; opt-in live thinking uses the separate Thinking panel'
  );
  assert(
    streamChatService.includes('onThinkingProgress?:') &&
      streamChatService.includes('const { onProgress, onThinkingProgress, ...streamOptions } = options || {};') &&
      streamChatService.includes('streamOptions') &&
      streamChatService.includes('function refreshStreamInactivityTimeout(): void') &&
      /onContent:\s*\(content\)\s*=>\s*\{\s*if \(!content\) return;[\s\S]{0,180}refreshStreamInactivityTimeout\(\)/.test(streamChatService) &&
      /if \(normalized\.deltaText\)\s*\{\s*refreshStreamInactivityTimeout\(\)/.test(streamChatService),
    'streamChatAsync must strip renderer callbacks before IPC and refresh its inactivity timeout only on real content or Thinking progress'
  );
  assert(
    skillStepEvents.includes('executeObservedSkillTool') &&
      skillStepEvents.includes("kind: 'tool_started'") &&
      skillStepEvents.includes("kind: 'tool_completed'") &&
      documentManagementExecutor.includes('executeObservedSkillTool(callbacks') &&
      documentManagementExecutor.includes('准备关闭文档') &&
      documentManagementExecutor.includes('保存结果已返回') &&
      textFontReplaceExecutor.includes('准备批量字体替换') &&
      textFontReplaceExecutor.includes('字体替换复核完成'),
    'document-management and text-font-replace must emit domain-specific observable skill steps without fake thinking'
  );
  assert(
    layoutReplicationExecutor.includes('准备参考图复刻') &&
      layoutReplicationExecutor.includes('调用视觉模型解析参考图') &&
      layoutReplicationExecutor.includes('模板蓝图已生成') &&
      layoutReplicationExecutor.includes('图层匹配计划已生成') &&
      layoutReplicationExecutor.includes('图层匹配结果已汇总') &&
      layoutReplicationExecutor.includes('emitSkillStep(callbacks'),
    'layout-replication must emit factual domain steps for parse, blueprint, apply/match, QA, and finalization phases'
  );
  assert(
    detailPageExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      detailPageExecutor.includes('准备执行详情页技能') &&
      detailPageExecutor.includes('详情页模板解析完成') &&
      detailPageExecutor.includes('详情页填充计划已生成') &&
      detailPageExecutor.includes('开始按屏执行详情页填充') &&
      detailPageExecutor.includes('详情页结果复核完成') &&
      detailPageExecutor.includes('详情页执行结果已汇总') &&
      detailPageExecutor.includes('executeObservedSkillTool(callbacks'),
    'detail-page executor must emit factual domain steps and observed Photoshop tool events without fake thinking'
  );
  assert(
    skuBatchExecutor.includes("import { emitSkillStep } from './skill-step-events'") &&
      skuBatchExecutor.includes('准备整理 SKU 色卡素材') &&
      skuBatchExecutor.includes('准备处理 SKU 任务') &&
      skuBatchExecutor.includes('SKU 色卡素材准备信息读取完成') &&
      skuBatchExecutor.includes('SKU 准备信息读取完成') &&
      skuBatchExecutor.includes('SKU 颜色图层读取完成') &&
      skuBatchExecutor.includes('SKU 任务参数解析完成') &&
      skuBatchExecutor.includes('SKU 执行计划已确认') &&
      skuBatchExecutor.includes('SKU 批量生成结果已汇总'),
    'sku-batch executor must emit factual high-level domain steps without changing SKU business logic'
  );
  assert(
    mainImageExecutor.includes("import { emitSkillStep } from './skill-step-events'") &&
      mainImageExecutor.includes('准备执行主图设计') &&
      mainImageExecutor.includes('主图素材与尺寸方案已确认') &&
      mainImageExecutor.includes('主图执行环境已确认') &&
      mainImageExecutor.includes('开始执行主图 Photoshop 生产') &&
      mainImageExecutor.includes('主图执行与验收结果已汇总'),
    'main-image controlled executor must emit factual steps for preparation, execution readiness, Photoshop work, and final verification'
  );
  assert(
    matteProductExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      matteProductExecutor.includes('准备抠图参数') &&
      matteProductExecutor.includes('正在调用 Photoshop 抠图工具') &&
      matteProductExecutor.includes('抠图结果已返回') &&
      matteProductExecutor.includes('抠图未完成') &&
      matteProductExecutor.includes('executeObservedSkillTool('),
    'matte-product executor must emit factual domain steps and observed Photoshop tool events without changing matting behavior'
  );
  assert(
    templateSaveExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      templateSaveExecutor.includes('确定模板保存上下文') &&
      templateSaveExecutor.includes('识别模板类型') &&
      templateSaveExecutor.includes('写入模板库') &&
      templateSaveExecutor.includes('模板已保存') &&
      templateSaveExecutor.includes('模板保存失败'),
    'template-save executor must emit factual domain steps for document lookup, type inference, library write, and failure diagnosis'
  );
  assert(
    projectImageAnalysisExecutor.includes("import { emitSkillStep } from './skill-step-events'") &&
      projectImageAnalysisExecutor.includes('读取项目图片上下文') &&
      projectImageAnalysisExecutor.includes('选择分析样本') &&
      projectImageAnalysisExecutor.includes('分析图片样本') &&
      projectImageAnalysisExecutor.includes('汇总图片分析结果') &&
      projectImageAnalysisExecutor.includes('项目图片分析完成') &&
      projectImageAnalysisExecutor.includes('项目图片分析未完成'),
    'project-image-analysis executor must emit factual domain steps for context, sample selection, image analysis, summary, and failure diagnosis'
  );
  assert(
    designReferenceSearchExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      designReferenceSearchExecutor.includes('准备设计参考检索') &&
      designReferenceSearchExecutor.includes('设计参考检索完成') &&
      designReferenceSearchExecutor.includes('网页设计内容已获取') &&
      designReferenceSearchExecutor.includes('设计参考检索模式不支持'),
    'design-reference-search executor must emit factual domain steps for search, URL fetch, and unsupported mode diagnosis'
  );
  assert(
    visualAnalysisExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      visualAnalysisExecutor.includes('准备视觉分析') &&
      visualAnalysisExecutor.includes('调用视觉模型分析画布') &&
      visualAnalysisExecutor.includes('画布视觉分析完成') &&
      visualAnalysisExecutor.includes('视觉分析报告已生成') &&
      visualAnalysisExecutor.includes('视觉分析执行异常'),
    'visual-analysis executor must emit factual domain steps for snapshot acquisition, vision model analysis, report generation, and exceptions'
  );
  assert(
    findEditElementExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      findEditElementExecutor.includes('准备定位画布元素') &&
      findEditElementExecutor.includes('候选图层已排序') &&
      findEditElementExecutor.includes('缺少目标元素描述') &&
      findEditElementExecutor.includes('元素定位与操作完成') &&
      findEditElementExecutor.includes('executeObservedSkillTool(callbacks'),
    'find-and-edit-element executor must emit factual domain steps for element mapping, candidate ranking, selection, action execution, and confirmation needs'
  );
  assert(
    smartLayoutExecutor.includes("import { emitSkillStep, executeObservedSkillTool } from './skill-step-events'") &&
      smartLayoutExecutor.includes('准备智能布局参数') &&
      smartLayoutExecutor.includes('调用 Photoshop 智能布局工具') &&
      smartLayoutExecutor.includes('智能布局结果已返回') &&
      smartLayoutExecutor.includes('智能布局未完成'),
    'smart-layout executor must emit factual domain steps for parameter preparation, smartLayout tool call, and result diagnosis'
  );
  assert(
    toolExecutor.includes("b.role === 'selling-point'") &&
      toolExecutor.includes("name: `${b.id}-底块`") &&
      toolExecutor.includes("name: `${b.id}-文字`") &&
      toolExecutor.includes('fitLayoutTextToWidth(') &&
      toolExecutor.includes('wrapTextForEstimatedWidth('),
    'renderLayout must render selling-point modules as editable text over a simple color block and fit long copy inside the layout block'
  );
  assert(
    toolExecutor.includes('redirectedFrom: toolName') &&
      (toolExecutor.includes("sendToPlugin(") || toolExecutor.includes('sendToPluginWithCancellation(')) &&
      toolExecutor.includes("'quickExport',") &&
      toolExecutor.includes("toolName === 'saveDocument' && (requestedFormat === 'png' || requestedFormat === 'jpg')"),
    'saveDocument(projectSubdir + png/jpg) must use the silent quickExport path instead of Photoshop Save As'
  );
  assert(
    chatPanel.includes('data-testid="chat-input"') &&
      chatPanel.includes('data-testid="chat-send"') &&
      chatPanel.includes('data-testid="chat-messages"'),
    'ChatPanel must expose stable test selectors for controlled UI automation'
  );
  assert(
    skillExecutors.includes('开始能力：') &&
      skillExecutors.includes('能力完成') &&
      skillExecutors.includes('summarizeSkillResult') &&
      skillExecutors.includes('toolCallId: skillStepId'),
    'executeSkillWithExecutor must emit factual skill start/completion step events for deterministic skills'
  );
  assert(
    chatPanel.includes('installChatPanelTestBridge') &&
      chatPanel.includes('submit: async (text: string') &&
      chatPanel.includes('getSnapshot: buildChatTestSnapshot') &&
      chatPanel.includes('waitForIdle: waitForChatIdle'),
    'ChatPanel must install a minimal controlled test bridge when explicitly enabled'
  );
  assert(
    debugBridgeService.includes("pathname === '/chat/submit'") &&
      debugBridgeService.includes('onChatSubmit') &&
      mainProcess.includes('onChatSubmit: submitChatToCurrentWindow') &&
      mainProcess.includes("mainWindow!.webContents.send('debug-bridge:chat-submit'") &&
      preload.includes('onDebugBridgeChatSubmit') &&
      preload.includes("ipcRenderer.on('debug-bridge:chat-submit'") &&
      chatPanel.includes('window.designEcho?.onDebugBridgeChatSubmit') &&
      chatPanel.includes('return waitForChatIdle(timeoutMs)'),
    'Debug Bridge must be able to submit a prompt to the current running ChatPanel without Computer Use'
  );
  assert(
    testBridge.includes('publicPlanRawStatus?: string') &&
      chatPanel.includes('const publicPlanExecutionRequest = (message as any).agentTaskPublicPlanExecutionRequest') &&
      chatPanel.includes('publicPlanRawStatus: sanitizeTestSnapshotToken(publicPlanExecutionRequest?.status)') &&
      chatPanel.includes('publicPlanProposedWriteTools') &&
      chatPanel.includes('publicPlanOperationCount'),
    'ChatPanel test bridge snapshots must expose raw public-plan diagnostics for UI execution debugging'
  );
  assert(
    chatPanel.includes('const sendPromise = handleSend({') &&
      chatPanel.includes('return waitForChatIdle(options?.timeoutMs)') &&
      !chatPanel.includes('await handleSend({'),
    'ChatPanel test bridge submit must let waitForChatIdle own the timeout instead of awaiting handleSend first'
  );
  assert(
    testBridge.includes('__DESIGNECHO_CHAT_TEST_BRIDGE__') &&
      testBridge.includes('designechoChatTestBridge') &&
      testBridge.includes('isChatPanelTestBridgeEnabled') &&
      testBridge.includes('installChatPanelTestBridge') &&
      testBridge.includes('delete (window as any)[CHAT_TEST_BRIDGE_KEY]'),
    'ChatPanel test bridge must live in a dedicated gated renderer testing module'
  );
  assert(
    mainProcess.includes('DESIGNECHO_CHAT_TEST_BRIDGE') &&
      mainProcess.includes("designechoChatTestBridge: '1'") &&
      mainProcess.includes('rendererQuery ? { query: rendererQuery } : undefined'),
    'ChatPanel test bridge must be gated by an explicit main-process environment flag'
  );
}

function assertMessageParserRendering() {
  const { convertLegacyMessage } = loadParserExports();
  assert(typeof convertLegacyMessage === 'function', 'convertLegacyMessage export is unavailable');
  const {
    formatAgentToolEventContent,
    buildVisibleAgentActivityFromProgress,
    buildVisibleAgentActivityFromRunPhase,
    buildVisibleAgentActivityFromStepEvent
  } = loadAgentVisibleFeedbackExports();
  assert(typeof formatAgentToolEventContent === 'function', 'formatAgentToolEventContent export is unavailable');
  assert(typeof buildVisibleAgentActivityFromProgress === 'function', 'buildVisibleAgentActivityFromProgress export is unavailable');
  assert(typeof buildVisibleAgentActivityFromRunPhase === 'function', 'buildVisibleAgentActivityFromRunPhase export is unavailable');
  assert(typeof buildVisibleAgentActivityFromStepEvent === 'function', 'buildVisibleAgentActivityFromStepEvent export is unavailable');

  const contextLoadingActivity = buildVisibleAgentActivityFromRunPhase('context_loading');
  assert(
    contextLoadingActivity.source === 'run_phase' &&
      contextLoadingActivity.showAsThinking === false &&
      contextLoadingActivity.isProviderThinking === false &&
      contextLoadingActivity.canClaimModelReasoning === false,
    'initial request activity must be a factual Harness phase, not provider or model thinking'
  );

  const acceptanceSummary = '验收证据：检测到文本内容变化，任务断言通过。';
  const debugOnlyText = 'DEBUG_ONLY_SHOULD_NOT_RENDER';
  const rawMarker = 'SECRET_RAW_DIFF_SHOULD_NOT_RENDER';
  const executionSummaryText = '处理状态：需复核。处理步骤 1 次，1 项已处理，0 项未完成，1 项需要复核。';
  const visibleExecutionSummaryText = '处理状态：需复核。处理 1 次，1 项已处理，0 项未完成，1 项需要复核。';
  const executionBlockerText = '达到最大迭代次数，任务未能确认完成。';
  const executionWarningText = '工具返回成功但未检测到文档变化，需要复核。';
  const visibleExecutionWarningText = '处理返回成功但未检测到文档变化，需要复核。';
  const legacyMessage = {
    id: 'msg-chat-ui-smoke',
    role: 'assistant',
    content: '已完成文字修改。',
    timestamp: 1777259000000,
    executionSummary: {
      status: 'needs_review',
      stopReason: 'final_response',
      iterations: 2,
      toolCallCount: 1,
      successfulToolCalls: 1,
      failedToolCalls: 0,
      acceptanceVerified: 0,
      acceptanceFailed: 0,
      acceptanceNeedsReview: 1,
      noDocumentChangeRisks: 1,
      lastToolName: 'setTextContent',
      blockers: [executionBlockerText],
      warnings: [executionWarningText],
      summaryText: executionSummaryText
    },
    thinkingSteps: [
      {
        id: 'thinking-1',
        type: 'thinking',
        content: '根据用户请求，先确认当前文档和目标文本图层，再执行修改。',
        status: 'success',
        timestamp: 1777259000001,
        duration: 10
      },
      {
        id: 'reading-1',
        type: 'reading',
        content: '读取当前文档图层结构，确认可编辑文本范围。',
        status: 'success',
        timestamp: 1777259000001,
        duration: 12
      },
      {
        id: 'decision-1',
        type: 'decision',
        content: '判断目标文本层明确，可以进入文字替换。',
        status: 'success',
        timestamp: 1777259000001,
        duration: 13
      },
      {
        id: 'status-1',
        type: 'status',
        content: '设计助手说明：本轮只修改文字，不改动画面结构。',
        status: 'success',
        timestamp: 1777259000001,
        duration: 14
      },
      {
        id: 'tool-1',
        type: 'tool_call',
        content: '执行 setTextContent',
        toolName: 'setTextContent',
        status: 'success',
        timestamp: 1777259000002,
        duration: 25,
        toolResult: {
          success: true,
          layerId: 2,
          previousContent: '旧文案',
          newContent: '新文案',
          acceptance: {
            summaryText: acceptanceSummary,
            debugText: debugOnlyText,
            diff: {
              changedLayers: [{ id: 2, marker: rawMarker }]
            }
          }
        }
      },
      {
        id: 'tool-result-1',
        type: 'tool_result',
        content: '工具完成',
        toolName: 'setTextContent',
        status: 'success',
        timestamp: 1777259000003,
        duration: 25,
        toolResult: {
          success: true,
          layerId: 2,
          acceptance: {
            summaryText: acceptanceSummary,
            debugText: debugOnlyText,
            diff: {
              raw: rawMarker
            }
          }
        }
      }
    ]
  };

  const converted = convertLegacyMessage(legacyMessage);
  const visibleText = collectVisibleStrings(converted).join('\n');
  const thinkingBlocks = converted.blocks.filter((block) => block.type === 'thinking');
  const thinkingBlock = converted.blocks.find((block) => block.type === 'thinking');
  const toolResultBlock = converted.blocks.find((block) => block.type === 'tool_result');
  const executionSummaryBlock = converted.blocks.find((block) =>
    block.type === 'card' && block.title === '处理结果：需复核'
  );

  assert(thinkingBlock, 'Converted message should include thinking block');
  assert(
    thinkingBlocks.length === 1 && thinkingBlock.title === '判断与处理',
    'Mixed public process and tool steps must render as one chronological 判断与处理 block instead of split thinking/action groups'
  );
  const timelineLabels = thinkingBlock.steps.map((step) => String(step.label || ''));
  assert(
    timelineLabels.findIndex((label) => label.includes('先确认当前文档')) >= 0
      && timelineLabels.findIndex((label) => label.includes('先确认当前文档')) < timelineLabels.findIndex((label) => label.includes('setTextContent')),
    'The combined process block must preserve original think-then-act order'
  );
  assert(
    thinkingBlock.steps.some((step) => step.displayRole === 'reasoning' && step.roleLabel === '思考')
      && thinkingBlock.steps.some((step) => step.displayRole === 'observation' && step.roleLabel === '读取')
      && thinkingBlock.steps.some((step) => step.displayRole === 'decision' && step.roleLabel === '判断')
      && thinkingBlock.steps.some((step) => step.displayRole === 'agent' && step.roleLabel === '说明')
      && thinkingBlock.steps.some((step) => step.displayRole === 'action' && step.actionLabel === '已处理'),
    'Converted thinking timeline must preserve semantic display roles for reasoning, observation, decision, agent notes and actions'
  );
  assert(toolResultBlock, 'Converted message should include tool result block for legacy tool_result steps');
  assert(executionSummaryBlock, 'Converted message should include execution summary report card');
  assert(
    visibleText.includes(visibleExecutionSummaryText),
    'Visible message representation should include execution summary text'
  );
  assert(
    visibleText.includes(executionBlockerText),
    'Visible message representation should include execution summary blocker text'
  );
  assert(
    visibleText.includes(visibleExecutionWarningText),
    'Visible message representation should include execution summary warning text'
  );
  assert(
    executionSummaryBlock.content.includes(executionBlockerText) &&
      executionSummaryBlock.content.includes(visibleExecutionWarningText),
    'Execution summary card content must expose blockers and warnings, not only counts'
  );
  assert(
    visibleText.includes(acceptanceSummary),
    'Visible message representation should include acceptance summary text'
  );
  assert(
    !visibleText.includes(rawMarker),
    'Visible message representation must not expose raw acceptance diff payload'
  );
  assert(
    !visibleText.includes(debugOnlyText),
    'Visible message representation must not expose acceptance debugText'
  );
  assert(
    Array.isArray(toolResultBlock.details) &&
      toolResultBlock.details.some((detail) => detail.label === '验收' && detail.value === acceptanceSummary),
    'Tool result details should show acceptance summary as a readable detail'
  );
  assert(
    !toolResultBlock.details.some((detail) => String(detail.value).includes(rawMarker)),
    'Tool result details must skip raw acceptance payload'
  );

  const failedToolActionMessage = {
    id: 'msg-failed-tool-public-actions',
    role: 'assistant',
    content: '工具执行失败。',
    timestamp: 1777259000050,
    thinkingSteps: [
      {
        id: 'unsafe-tool',
        type: 'tool_result',
        content: '工具失败，可重试。',
        toolName: 'main-image-design',
        toolParams: {
          safeText: 'keep-me',
          approvedLiveExecution: true,
          approvedLiveAdapterRun: true,
          executionTarget: 'live-photoshop',
          allowPhotoshopWrites: true,
          adapter: { runWriteOperation: 'must-not-leak' },
          nested: {
            liveExecutionScope: 'explicit-project-document',
            explicitProjectWriteApproval: true
          }
        },
        status: 'error',
        timestamp: 1777259000051
      }
    ]
  };
  const failedToolActionConverted = convertLegacyMessage(failedToolActionMessage);
  const failedToolActions = failedToolActionConverted.blocks
    .flatMap((block) => Array.isArray(block.actions) ? block.actions : [])
  const retryAction = failedToolActions.find((action) => action.action === 'runTool');
  const failedToolActionJson = JSON.stringify(failedToolActions || []);
  assert(
    !retryAction,
    'Failed tool result must not expose a default retry-tool action in the normal user surface'
  );
  assert(
    !/keep-me|approvedLiveExecution|approvedLiveAdapterRun|executionTarget|live-photoshop|allowPhotoshopWrites|adapter|liveExecutionScope|explicitProjectWriteApproval/.test(failedToolActionJson),
    'Failed tool result actions must not carry toolName/toolParams or private live-write params'
  );

  const privateParamMarker = 'PRIVATE_RUNTIME_PARAM_SHOULD_NOT_RENDER';
  const publicPlanMessage = {
    id: 'msg-public-plan-private-params',
    role: 'assistant',
    content: '处理计划待确认。',
    timestamp: 1777259000060,
    agentTaskPublicPlanExecutionRequest: {
      version: 'agent-task-public-plan-execution-request/v0',
      status: 'blocked_pending_user_confirmation',
      requestId: 'request-with-private-params',
      writesPerformed: false,
      rawPayloadRedacted: true,
      shouldRunPhotoshop: false,
      mustNotRunWriteTools: true,
      mustNotClaimTaskCompletion: true,
      requiresExplicitUserConfirmation: true,
      requiresWriteToolAllowlist: true,
      requiresReadbackTargets: true,
      requiresControlledRunner: true,
      requiresReadbackAfterEachWrite: true,
      userConfirmed: false,
      canStartControlledRunner: false,
      proposedWriteTools: ['createTextLayer'],
      allowedWriteTools: ['createTextLayer'],
      approvedWriteTools: [],
      blockedWriteTools: [],
      readbackTargets: ['acceptance_snapshot'],
      publicPlanSummary: '我会先用深色首屏承接袜子主题，再用标题和卖点模块建立购买理由。',
      executionPlanSummary: '先创建 790 宽临时画布，再铺背景、标题和卖点色块，最后看画面是否清楚。',
      operationRequests: [{
        operationId: 'op-private',
        toolName: 'createTextLayer',
        params: {
          text: privateParamMarker,
          allowPhotoshopWrites: true,
          executionTarget: 'live-photoshop',
          liveExecutionScope: 'disposable-document',
          explicitProjectWriteApproval: true,
          approvedLiveExecution: true,
          approvedLiveAdapterRun: true,
          adapter: 'must-not-render'
        },
        paramsSummary: '创建标题文字。',
        readbackTargets: ['acceptance_snapshot']
      }],
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      explicitProjectWriteApproval: true,
      adapter: 'must-not-render',
      blockers: [],
      warnings: []
    },
    agentTaskPublicPlanControlledRun: {
      version: 'agent-task-public-plan-controlled-runner/v0',
      status: 'completed_dry_run',
      executionTarget: 'dry-run',
      liveExecutionScope: 'not_applicable',
      explicitProjectWriteApproval: false,
      requiresLiveExecutionScope: false,
      requiresExplicitProjectWriteApproval: false,
      fakeAdapterOnly: false,
      executionState: 'dry_run',
      verificationStatus: 'not_run',
      writesPerformed: false,
      rawPayloadRedacted: true,
      shouldRunPhotoshop: false,
      mustNotRunWriteTools: true,
      mustNotClaimTaskCompletion: true,
      plannedWriteTools: ['createTextLayer'],
      executedWriteTools: [],
      readbackTargets: ['acceptance_snapshot'],
      publicPlanSummary: '我会先用深色首屏承接袜子主题，再用标题和卖点模块建立购买理由。',
      executionPlanSummary: '先创建 790 宽临时画布，再铺背景、标题和卖点色块，最后看画面是否清楚。',
      operationRequests: [{
        operationId: 'op-private',
        toolName: 'createTextLayer',
        params: { text: privateParamMarker },
        paramsSummary: '创建标题文字。',
        readbackTargets: ['acceptance_snapshot']
      }],
      operationResults: [],
      readbackResults: [],
      dryRun: true,
      blockers: [],
      warnings: []
    }
  };
  const publicPlanConverted = convertLegacyMessage(publicPlanMessage);
  const publicPlanVisibleJson = JSON.stringify(publicPlanConverted);
  const publicPlanConfirmAction = publicPlanConverted.blocks
    .flatMap((block) => Array.isArray(block.actions) ? block.actions : [])
    .find((action) => action.action === 'confirmPublicPlan');
  assert(publicPlanConfirmAction, 'Public plan request should expose confirm action');
  assert(
    publicPlanConfirmAction.params?.sourceMessageId === 'msg-public-plan-private-params'
      && publicPlanConfirmAction.params?.requestId === 'request-with-private-params'
      && Object.keys(publicPlanConfirmAction.params).length === 2,
    'Public plan confirm action should only carry sourceMessageId and requestId'
  );
  assert(
    !/PRIVATE_RUNTIME_PARAM_SHOULD_NOT_RENDER|allowPhotoshopWrites|executionTarget|live-photoshop|adapter|liveExecutionScope|explicitProjectWriteApproval|approvedLiveExecution|approvedLiveAdapterRun/.test(publicPlanVisibleJson),
    'Public plan cards/actions must not render private runtime params or live/project approval fields'
  );
  assert(
    !/createTextLayer|acceptance_snapshot|plannedWriteTools|proposedWriteTools|readbackTargets|executionTarget/.test(publicPlanVisibleJson),
    'Public plan cards must not render raw tool names, raw readback targets, or internal execution fields'
  );
  assert(
    !/公开计划|处理请求|受控|读回|工具执行|流程检查/.test(publicPlanVisibleJson)
      && /处理计划|画面/.test(publicPlanVisibleJson)
      && !/设计方案待确认/.test(publicPlanVisibleJson),
    'Public plan cards must describe a user-facing handling plan without mislabeling every plan as a design proposal'
  );
  assert(
    /深色首屏承接袜子主题|先创建 790 宽临时画布/.test(publicPlanVisibleJson),
    'Public plan cards should expose the Agent design judgment and execution idea instead of only fixed status copy'
  );

  const publicPlanObservationDiffMessage = {
    id: 'msg-public-plan-observation-diff',
    role: 'assistant',
    content: '我复核后发现画面和计划不一致。',
    timestamp: 1777259000061,
    thinkingSteps: [
      {
        id: 'prepare-visible-public-plan',
        type: 'analyzing',
        content: '准备按方案处理：先创建当前阶段草稿，完成后再看真实结果。',
        status: 'success',
        timestamp: 1777259000061
      },
      {
        id: 'review-visible-public-plan',
        type: 'decision',
        content: '复核真实画面：最终观察缺少 2 段计划文案：弹力贴合、耐磨不易滑。 下一步应先修正这处差异。',
        status: 'error',
        timestamp: 1777259000062
      }
    ],
    agentTaskPublicPlanControlledRun: {
      version: 'agent-task-public-plan-controlled-runner/v0',
      status: 'failed_readback',
      executionTarget: 'live-photoshop',
      liveExecutionScope: 'disposable-document',
      explicitProjectWriteApproval: false,
      requiresLiveExecutionScope: true,
      requiresExplicitProjectWriteApproval: false,
      fakeAdapterOnly: false,
      executionState: 'failed',
      verificationStatus: 'failed',
      writesPerformed: true,
      rawPayloadRedacted: true,
      shouldRunPhotoshop: true,
      mustNotRunWriteTools: false,
      mustNotClaimTaskCompletion: true,
      plannedWriteTools: ['createDocument', 'renderLayout'],
      executedWriteTools: ['createDocument', 'renderLayout'],
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
      publicPlanSummary: '创建深色袜子详情页草稿，标题和三个卖点要真实出现在画面里。',
      executionPlanSummary: '先创建当前阶段草稿，完成后再看真实结果。',
      operationRequests: [],
      operationResults: [],
      readbackResults: [],
      observationDiff: {
        version: 'agent-task-public-plan-observation-diff/v0',
        status: 'mismatch',
        expectedVisibleCopy: ['舒适透气运动袜', '吸汗速干', '弹力贴合', '耐磨不易滑'],
        observedVisibleCopy: ['舒适透气运动袜', '吸汗速干'],
        missingVisibleCopy: ['弹力贴合', '耐磨不易滑'],
        nextAction: 'repair_missing_visible_copy',
        userVisibleSummary: '最终观察缺少 2 段计划文案：弹力贴合、耐磨不易滑。'
      },
      dryRun: false,
      blockers: ['最终观察缺少计划中的可见文案「弹力贴合」，画面可能被用户或后续操作改动。'],
      warnings: []
    }
  };
  const publicPlanObservationDiffConverted = convertLegacyMessage(publicPlanObservationDiffMessage);
  const publicPlanObservationDiffVisible = collectVisibleStrings(publicPlanObservationDiffConverted).join('\n');
  const publicPlanObservationThinkingBlock = publicPlanObservationDiffConverted.blocks.find(
    (block) => block.type === 'thinking'
  );
  assert(
    publicPlanObservationThinkingBlock
      && publicPlanObservationThinkingBlock.title === '思考',
    'Public plan observation diff should render as visible public thinking, not as tool-only execution'
  );
  assert(
    /准备按方案处理|复核真实画面|弹力贴合|耐磨不易滑|复核发现/.test(publicPlanObservationDiffVisible),
    'Public plan observation diff must be visible as Agent judgment, observation and next-action evidence'
  );
  assert(
    !/observationDiff|agent-task-public-plan-observation-diff|failed_readback|layer_hierarchy|acceptance_snapshot/.test(publicPlanObservationDiffVisible),
    'Public plan observation diff UI must not expose internal contract names or raw readback targets'
  );

  const userVisibleStateMessage = {
    id: 'msg-agent-state-public',
    role: 'assistant',
    content: '我先只读查看项目资源，再给你结论。',
    timestamp: 1777258999500,
    agentTaskPlan: {
      version: 'agent-task-planning-contract/v0',
      status: 'ready_read_only_plan',
      requestKind: 'read_only_inspect',
      route: 'skill_execution',
      userVisibleState: {
        version: 'agent-user-visible-state/v0',
        category: 'read_only',
        title: '只读检查',
        summary: '只读取项目、文档或图层信息，不写入 Photoshop 文档。',
        nextStep: '读取上下文后给出用户可读结论。',
        toolUse: 'read_only',
        canStartTools: true,
        userActionRequired: false
      }
    }
  };
  const userVisibleStateConverted = convertLegacyMessage(userVisibleStateMessage);
  const userVisibleStateCard = userVisibleStateConverted.blocks.find((block) => block.type === 'card' && block.title === '只读检查');
  const userVisibleStateVisible = collectVisibleStrings(userVisibleStateConverted).join('\n');
  assert(!userVisibleStateCard, 'Non-action userVisibleState metadata should not render as a separate status card in normal chat');
  assert(
    userVisibleStateVisible.includes('我先只读查看项目资源，再给你结论。') &&
      !userVisibleStateVisible.includes('只读取项目、文档或图层信息') &&
      !userVisibleStateVisible.includes('读取上下文后给出用户可读结论'),
    'Non-action userVisibleState metadata should stay out of the visible chat surface'
  );
  assert(
    !/ready_read_only_plan|read_only_inspect|skill_execution|agent-user-visible-state|agent-task-planning-contract/.test(userVisibleStateVisible),
    'Agent userVisibleState card must not expose internal planning status, route, request kind, or contract versions'
  );
  assert(
    !/方式|先看一下/.test(userVisibleStateVisible),
    `Agent userVisibleState card should not show tool-use detail rows in the normal chat surface: ${userVisibleStateVisible}`
  );

  const actionRequiredStateMessage = {
    id: 'msg-agent-state-action-required',
    role: 'assistant',
    content: '',
    timestamp: 1777258999501,
    agentTaskPlan: {
      userVisibleState: {
        version: 'agent-user-visible-state/v0',
        category: 'blocked',
        title: '需要补充信息',
        summary: '还缺少一个会影响结果的关键信息。',
        nextStep: '补充后再继续。',
        toolUse: 'no_tools',
        canStartTools: false,
        userActionRequired: true
      }
    }
  };
  const actionRequiredStateConverted = convertLegacyMessage(actionRequiredStateMessage);
  assert(
    actionRequiredStateConverted.blocks.some((block) => block.type === 'card' && block.title === '需要补充信息'),
    'User-action-required state should still render a compact card'
  );

  const blockedProjectInventoryMessage = {
    id: 'msg-blocked-project-inventory-single-surface',
    role: 'assistant',
    content: '当前项目里没有可分析的图片资源。',
    timestamp: 1777258999510,
    assistantReplyOrigin: {
      version: 'assistant-reply-origin/v0',
      origin: 'deterministic_blocker',
      userVisibleKind: 'blocker_notice',
      source: 'skill:project-image-analysis:failure'
    },
    agentTaskPlan: {
      version: 'agent-task-planning-contract/v0',
      status: 'ready_read_only_plan',
      requestKind: 'read_only_inspect',
      route: 'skill_execution',
      userVisibleState: {
        version: 'agent-user-visible-state/v0',
        category: 'read_only',
        title: '先看一下当前画面',
        summary: '先查看项目、文档或图层信息，不改变当前画面。',
        nextStep: '读取完成后展示判断结果。',
        toolUse: 'read_only',
        canStartTools: true,
        userActionRequired: false
      }
    }
  };
  const blockedProjectInventoryConverted = convertLegacyMessage(blockedProjectInventoryMessage);
  const blockedProjectInventoryVisible = collectVisibleStrings(blockedProjectInventoryConverted).join('\n');
  assert(
    blockedProjectInventoryConverted.blocks.filter((block) => block.type === 'text' && block.content.includes('当前项目里没有可分析的图片资源')).length === 1,
    'Blocked read-only project inventory should render a single natural blocker text surface'
  );
  assert(
    !/先看一下当前画面|先查看项目、文档或图层信息|读取完成后展示判断结果/.test(blockedProjectInventoryVisible),
    `Blocked read-only project inventory should not show a separate read-only process card: ${blockedProjectInventoryVisible}`
  );

  const completedProjectInventoryMessage = {
    id: 'msg-completed-project-inventory-single-surface',
    role: 'assistant',
    content: '已读取当前项目资源索引：0 个图片/素材，5 个文件夹，0 类资源。',
    timestamp: 1777258999511,
    assistantReplyOrigin: {
      version: 'assistant-reply-origin/v0',
      origin: 'tool_result_summary',
      userVisibleKind: 'tool_summary',
      source: 'skill:project-image-analysis'
    },
    agentTaskPlan: {
      version: 'agent-task-planning-contract/v0',
      status: 'ready_read_only_plan',
      requestKind: 'read_only_inspect',
      route: 'skill_execution',
      userVisibleState: {
        version: 'agent-user-visible-state/v0',
        category: 'read_only',
        title: '先看一下当前画面',
        summary: '先查看项目、文档或图层信息，不改变当前画面。',
        nextStep: '读取完成后展示判断结果。',
        toolUse: 'read_only',
        canStartTools: true,
        userActionRequired: false
      }
    }
  };
  const completedProjectInventoryConverted = convertLegacyMessage(completedProjectInventoryMessage);
  const completedProjectInventoryVisible = collectVisibleStrings(completedProjectInventoryConverted).join('\n');
  assert(
    completedProjectInventoryConverted.blocks.filter((block) => block.type === 'text' && block.content.includes('已读取当前项目资源索引')).length === 1,
    'Completed read-only project inventory should render one compact natural result text'
  );
  assert(
    !/先看一下当前画面|先查看项目、文档或图层信息|读取完成后展示判断结果/.test(completedProjectInventoryVisible),
    `Completed read-only project inventory should not show a separate read-only process card: ${completedProjectInventoryVisible}`
  );

  const skuDeliveryMessage = {
    id: 'msg-sku-delivery-summary',
    role: 'assistant',
    content: 'SKU 已完成：3个规格，15个组合，3个自选备注，已导出18张。\n导出清单已收起，可展开查看。',
    timestamp: 1777259000004,
    skuDeliverySummary: {
      version: 'sku-delivery-summary/v0',
      status: 'completed',
      skuDocName: 'SKU.psb',
      processedSizes: ['2双', '3双', '4双'],
      totalCombos: 15,
      noteCount: 3,
      skippedNoteCount: 0,
      exportCount: 18,
      warningCount: 0,
      comboGroups: [
        {
          size: 2,
          comboCount: 5,
          noteGenerated: true,
          noteSkipped: false,
          previewCombos: ['白色+米色', '奶油黄+薄荷绿'],
          hiddenComboCount: 3
        }
      ],
      exportedFileNames: ['2双白色+米色.jpg', '2双奶油黄+薄荷绿.jpg'],
      warnings: [],
      compactText: 'SKU 已完成：3个规格，15个组合，3个自选备注，已导出18张。\n导出清单已收起，可展开查看。',
      detailText: '2双装（5组）\n1. 白色+米色\n2. 奶油黄+薄荷绿\n另有 3 组已收起\n\n导出文件（2张）\n- 2双白色+米色.jpg\n- 2双奶油黄+薄荷绿.jpg',
      rawPayloadRedacted: true
    }
  };
  const skuDeliveryConverted = convertLegacyMessage(skuDeliveryMessage);
  const skuDeliveryCard = skuDeliveryConverted.blocks.find((block) =>
    block.type === 'card' && block.title === 'SKU 交付状态'
  );
  const skuDeliveryDetails = skuDeliveryConverted.blocks.find((block) =>
    block.type === 'collapsible' && block.title === 'SKU 明细'
  );
  const skuDeliveryVisible = collectVisibleStrings(skuDeliveryConverted).join('\n');
  assert(skuDeliveryCard, 'SKU delivery summary should render a compact status card');
  assert(skuDeliveryDetails, 'SKU delivery summary should render a collapsed detail block');
  assert(skuDeliveryDetails.defaultExpanded === false, 'SKU detail block must stay collapsed by default');
  assert(
    skuDeliveryCard.content.includes('SKU 已完成') &&
      skuDeliveryCard.details.some((detail) => detail.label === '导出' && detail.value === '18张'),
    'SKU status card should expose compact result counts'
  );
  assert(
    skuDeliveryDetails.content.some((block) =>
      block.type === 'text' && block.content.includes('2双白色+米色.jpg')
    ),
    'Collapsed SKU details should retain the full delivery file list'
  );
  assert(
    !/sku-delivery-summary\/v0|rawPayloadRedacted|confidence|置信/.test(skuDeliveryVisible),
    'SKU delivery UI must not expose internal versions, raw payload flags, or confidence language'
  );
  assert(
    skuDeliveryConverted.blocks.filter((block) => block.type === 'text').length === 0,
    'SKU delivery content should not duplicate the compact card as a plain long text block'
  );

  const toolSummaryMessage = {
    id: 'msg-tool-summary-origin',
    role: 'assistant',
    content: '已读取当前项目资源索引：3 个图片/素材，2 个文件夹，2 类资源。',
    timestamp: 1777259000150,
    assistantReplyOrigin: {
      version: 'assistant-reply-origin/v0',
      origin: 'tool_result_summary',
      userVisibleKind: 'tool_summary',
      source: 'skill:project-image-analysis'
    }
  };
  const toolSummaryConverted = convertLegacyMessage(toolSummaryMessage);
  const toolSummaryText = toolSummaryConverted.blocks.find((block) =>
    block.type === 'text' && block.content.includes('已读取当前项目资源索引')
  );
  assert(toolSummaryText, 'Tool summary origin should render assistant content as natural text');
  assert(
    !collectVisibleStrings(toolSummaryConverted).join('\n').includes('project-image-analysis'),
    'Tool summary text should not expose internal skill source in user-visible text'
  );
  assert(
    toolSummaryConverted.blocks.filter((block) => block.type === 'card').length === 0,
    'Tool summary origin should not render a titled system card'
  );

  const blockerNoticeMessage = {
    id: 'msg-blocker-notice-origin',
    role: 'assistant',
    content: '当前项目缺少可用的 SKU PSD/PSB 素材文件；请先补齐项目 SKU 源文件后再执行。',
    timestamp: 1777259000160,
    assistantReplyOrigin: {
      version: 'assistant-reply-origin/v0',
      origin: 'deterministic_blocker',
      userVisibleKind: 'blocker_notice',
      source: 'skill:sku-batch:failure'
    }
  };
  const blockerNoticeConverted = convertLegacyMessage(blockerNoticeMessage);
  const blockerNoticeText = blockerNoticeConverted.blocks.find((block) =>
    block.type === 'text' && block.content.includes('当前项目缺少可用的 SKU PSD/PSB 素材文件')
  );
  assert(blockerNoticeText, 'Deterministic blocker origin should render actionable blocker text naturally');
  assert(
    !collectVisibleStrings(blockerNoticeConverted).join('\n').includes('skill:sku-batch'),
    'Blocker notice text should not expose internal source in user-visible text'
  );
  assert(
    blockerNoticeConverted.blocks.filter((block) => block.type === 'card').length === 0,
    'Deterministic blocker origin should not render a titled system card'
  );

  const blockedSkuPreflightMessage = {
    id: 'msg-blocked-sku-preflight-single-surface',
    role: 'assistant',
    content: '当前还不能读取已打开的设计文档，因此暂时不能继续处理 SKU。\n\nPhotoshop 插件还没有连上。请在 PS 中打开 DesignEcho 插件面板，确认顶部显示已连接后再试。',
    timestamp: 1777259000165,
    assistantReplyOrigin: {
      version: 'assistant-reply-origin/v0',
      origin: 'deterministic_blocker',
      userVisibleKind: 'blocker_notice',
      source: 'skill:sku-batch:failure'
    },
    agentTaskPlan: {
      userVisibleState: {
        version: 'agent-user-visible-state/v0',
        category: 'controlled_execution',
        title: '先检查执行条件',
        summary: '先确认素材、设计文档和连接状态，再开始处理。',
        nextStep: '条件满足后再按 SKU 任务继续。',
        toolUse: 'controlled_write_after_gate',
        canStartTools: true,
        userActionRequired: false
      }
    },
    businessVisualObservationFeedback: {
      version: 'business-skill-visual-evidence-feedback/v0',
      userVisible: true,
      severity: 'blocked',
      title: '还没有找到可用图片',
      summary: '当前还没有适合当前设计步骤的图片。',
      actionHint: '请选择图片或刷新素材。',
      warningItems: ['项目索引未提供当前业务场景的视觉候选。'],
      blockerItems: [],
      preflightStrategy: {
        canProceed: true,
        shouldRefreshProjectContext: false,
        shouldAskUserToSelectImages: true,
        shouldOfferVisualAnalysis: false,
        shouldAvoidSemanticClaims: true
      }
    },
    thinkingSteps: [
      {
        id: 'list-documents-result',
        type: 'tool_result',
        content: '当前还不能读取已打开的设计文档，因此暂时不能继续处理 SKU。',
        toolName: 'listDocuments',
        status: 'error',
        timestamp: 1777259000166,
        toolResult: {
          success: false,
          error: 'Photoshop 插件还没有连上。请在 PS 中打开 DesignEcho 插件面板，确认顶部显示已连接后再试。'
        }
      }
    ]
  };
  const blockedSkuPreflightConverted = convertLegacyMessage(blockedSkuPreflightMessage);
  const blockedSkuVisible = collectVisibleStrings(blockedSkuPreflightConverted).join('\n');
  assert(
    blockedSkuPreflightConverted.blocks.filter((block) => block.type === 'text' && block.content.includes('Photoshop 插件还没有连上')).length === 1,
    'Blocked SKU preflight should render a single natural blocker text surface'
  );
  assert(
    !/当前方式|避免|没看清就下结论|查看文档列表|执行记录|处理完成后检查画面|按方案处理/.test(blockedSkuVisible),
    `Blocked SKU preflight should not render competing status/material/tool-record cards: ${blockedSkuVisible}`
  );

  const statusNoticeMessage = {
    id: 'msg-status-notice-origin',
    role: 'assistant',
    content: '这次先不改动画面；当前只是状态提示。',
    timestamp: 1777259000170,
    assistantReplyOrigin: {
      version: 'assistant-reply-origin/v0',
      origin: 'ui_status',
      userVisibleKind: 'status_notice',
      source: 'conversational:capability:unavailable'
    }
  };
  const statusNoticeConverted = convertLegacyMessage(statusNoticeMessage);
  const statusNoticeText = statusNoticeConverted.blocks.find((block) =>
    block.type === 'text' && block.content.includes('这次先不改动画面')
  );
  assert(statusNoticeText, 'UI status origin should render compact status text naturally');
  assert(
    statusNoticeConverted.blocks.filter((block) => block.type === 'card' && block.title === '状态').length === 0,
    'UI status origin should not render a titled status card'
  );

  const missingOriginStatusMessage = {
    id: 'msg-missing-origin-status-notice',
    role: 'assistant',
    content: '没有收到模型回复。可以重试一次，或在设置里切换一个可用模型。',
    timestamp: 1777259000171
  };
  const missingOriginStatusConverted = convertLegacyMessage(missingOriginStatusMessage);
  assert(
    missingOriginStatusConverted.blocks.filter((block) => block.type === 'card' && block.title === '状态').length === 0,
    'Assistant content without an explicit origin must not render as a titled status card'
  );
  assert(
    !collectVisibleStrings(missingOriginStatusConverted).join('\n').includes('暂时没有拿到可靠回复'),
    'Assistant content without an explicit origin must not surface fixed fallback copy'
  );
  assert(
    !collectVisibleStrings(missingOriginStatusConverted).join('\n').includes('没有收到模型回复'),
    'Assistant content without an explicit origin must not surface old model fallback copy'
  );

  const noThinkingMessage = {
    id: 'msg-no-fake-thinking',
    role: 'assistant',
    content: '工具已经执行。',
    timestamp: 1777259000100,
    thinkingSteps: [
      {
        id: 'empty-thinking',
        type: 'thinking',
        content: '',
        status: 'success',
        timestamp: 1777259000101
      },
      {
        id: 'tool-only',
        type: 'tool_call',
        content: '执行 getDocumentInfo',
        toolName: 'getDocumentInfo',
        status: 'success',
        timestamp: 1777259000102,
        toolResult: {
          success: true,
          documentName: 'test.psd'
        }
      }
    ]
  };
  const noThinkingConverted = convertLegacyMessage(noThinkingMessage);
  const noThinkingBlock = noThinkingConverted.blocks.find((block) => block.type === 'thinking');
  assert(noThinkingBlock, 'Tool-only progress should render as a tool-call block');
  assert(noThinkingBlock.title === '处理', 'Tool-only progress must be titled as processing, not model thinking');
  assert(
    !noThinkingBlock.steps.some((step) => !String(step.label || '').trim()),
    'Empty thinking placeholders must not be rendered as visible steps'
  );
  assert(
    noThinkingBlock.steps.some((step) => step.label === '读取文档信息'),
    'Tool step labels should use user-facing action names'
  );
  assert(
    noThinkingBlock.steps.every((step) => !/getDocumentInfo|renderLayout|describeImage/.test(String(step.label || ''))),
    'Tool step labels must not expose internal tool identifiers'
  );

  const executionLogMessage = {
    id: 'msg-execution-log-process',
    role: 'assistant',
    content: '这是公开过程记录。',
    timestamp: 1777259000200,
    thinkingSteps: [
      {
        id: 'process-1',
        type: 'decision',
        content: '先确认 SKU 候选图是否符合色卡素材要求。',
        status: 'success',
        timestamp: 1777259000201
      },
      {
        id: 'process-2',
        type: 'status',
        content: '正在整理已确认的颜色和商品图。',
        status: 'success',
        timestamp: 1777259000202
      }
    ]
  };
  const executionLogConverted = convertLegacyMessage(executionLogMessage);
  const executionLogBlock = executionLogConverted.blocks.find((block) => block.type === 'thinking');
  assert(
    executionLogBlock && executionLogBlock.title === '思考',
    'Public decision/status process events must render as the visible thinking/process block'
  );
  assert(
    executionLogBlock.steps.some((step) => step.label.includes('SKU 候选图'))
      && executionLogBlock.steps.some((step) => step.label.includes('颜色和商品图')),
    'Visible process block must preserve user-facing intent and observation summaries'
  );

  const internalPlanningThinkingMessage = {
    id: 'msg-internal-planning-thinking',
    role: 'assistant',
    content: '处理中。',
    timestamp: 1777259000250,
    thinkingSteps: [
      {
        id: 'internal-thinking-1',
        type: 'thinking',
        content: '可见计划：使用可用的工具（如createTextLayer、renderLayout）来设计详情页。',
        status: 'success',
        timestamp: 1777259000251
      }
    ]
  };
  const internalPlanningThinkingConverted = convertLegacyMessage(internalPlanningThinkingMessage);
  assert(
    !internalPlanningThinkingConverted.blocks.some((block) => block.type === 'thinking'),
    'Internal tool-planning text must not render as user-visible thinking'
  );

  const realThinkingMessage = {
    id: 'msg-real-thinking',
    role: 'assistant',
    content: '这是带真实 provider thinking 的回复。',
    timestamp: 1777259000300,
    thinkingSteps: [
      {
        id: 'thinking-1',
        type: 'thinking',
        content: 'provider 返回的 reasoning_content 摘要',
        status: 'success',
        timestamp: 1777259000301
      }
    ]
  };
  const realThinkingConverted = convertLegacyMessage(realThinkingMessage);
  const realThinkingBlock = realThinkingConverted.blocks.find((block) => block.type === 'thinking');
  assert(
    realThinkingBlock && realThinkingBlock.title === '思考',
    'Completed provider thinking/reasoning steps should render as 思考, not an active 正在思考 state'
  );

  const runningThinkingMessage = {
    id: 'msg-running-thinking',
    role: 'assistant',
    content: '这是正在流式推理中的回复。',
    timestamp: 1777259000305,
    isThinking: true,
    thinkingSteps: [
      {
        id: 'thinking-running-1',
        type: 'thinking',
        content: '正在整理用户目标和可用素材',
        status: 'running',
        timestamp: 1777259000306
      }
    ]
  };
  const runningThinkingConverted = convertLegacyMessage(runningThinkingMessage);
  const runningThinkingBlock = runningThinkingConverted.blocks.find((block) => block.type === 'thinking');
  assert(
    runningThinkingBlock && runningThinkingBlock.title === '正在思考',
    'Only active provider thinking/reasoning steps should render as 正在思考'
  );

  runningThinkingMessage.thinkingSteps[0].status = 'success';
  runningThinkingMessage.thinkingSteps[0].duration = 258;
  runningThinkingMessage.isThinking = false;
  const completedThinkingConverted = convertLegacyMessage(runningThinkingMessage);
  const completedThinkingBlock = completedThinkingConverted.blocks.find((block) => block.type === 'thinking');
  assert(
    completedThinkingBlock && completedThinkingBlock.title === '思考',
    'Thinking conversion cache must notice running->success status changes on the same message object'
  );

  const unsafeDiagnosticMessage = {
    id: 'msg-unsafe-diagnostics',
    role: 'assistant',
    content: '工具执行失败。',
    timestamp: 1777259000400,
    executionSummary: {
      status: 'failed',
      stopReason: 'tool_preflight_blocked',
      iterations: 1,
      toolCallCount: 1,
      successfulToolCalls: 0,
      failedToolCalls: 1,
      acceptanceVerified: 0,
      acceptanceFailed: 0,
      acceptanceNeedsReview: 0,
      noDocumentChangeRisks: 0,
      lastToolName: 'skuLayout',
      lastError: 'blocked_missing_readback_targets',
      blockers: ['agent_tool_decision_contract_blocked'],
      warnings: ['最后错误: C:\\DesignEcho\\private\\SKU.psb'],
      summaryText: 'tool_call_failed:blocked_missing_readback_targets C:\\DesignEcho\\private\\SKU.psb'
    },
    businessVisualObservationFeedback: {
      userVisible: true,
      severity: 'blocked',
      title: 'blocked_missing_readback_targets',
      summary: 'tool_call_failed:blocked_missing_readback_targets C:\\DesignEcho\\private\\SKU.psb',
      actionHint: '<tool_call><function=skuLayout></function></tool_call>',
      blockerItems: ['tool_call_failed:blocked_missing_readback_targets'],
      warningItems: ['C:\\DesignEcho\\private\\warning.psb'],
      preflightStrategy: {
        mode: 'blocked_missing_readback_targets',
        canProceed: false,
        shouldRefreshProjectContext: false,
        shouldAskUserToSelectImages: false,
        shouldOfferVisualAnalysis: false,
        shouldAvoidSemanticClaims: true
      }
    },
    thinkingSteps: [
      {
        id: 'unsafe-result',
        type: 'tool_result',
        content: 'tool_call_failed:blocked_missing_readback_targets',
        toolName: 'skuLayout',
        status: 'error',
        timestamp: 1777259000401,
        toolResult: {
          success: false,
          error: 'blocked_missing_readback_targets',
          message: 'Skill executor not found',
          path: 'C:\\DesignEcho\\private\\SKU.psb',
          acceptance: {
            summaryText: '<tool_call>blocked_missing_readback_targets</tool_call> C:\\DesignEcho\\private\\acceptance.psb'
          }
        }
      }
    ]
  };
  const unsafeDiagnosticConverted = convertLegacyMessage(unsafeDiagnosticMessage);
  const unsafeDiagnosticVisible = collectVisibleStrings(unsafeDiagnosticConverted).join('\n');
  assert(
    !/blocked_missing_readback_targets|agent_tool_decision_contract_blocked|tool_call_failed|Skill executor not found|C:\\UXP/.test(unsafeDiagnosticVisible),
    'Execution summary cards and tool result details must not expose internal status codes, raw tool failures, or local paths'
  );
  assert(
    (unsafeDiagnosticVisible.includes('当前条件还不完整') || unsafeDiagnosticVisible.includes('处理没有完成')) &&
      unsafeDiagnosticVisible.includes('[local-path-redacted]'),
    'Unsafe diagnostic text should be mapped to safe copy and local path redaction'
  );
  const uxpBridgeFailureMessage = {
    id: 'msg-uxp-bridge-failure',
    role: 'assistant',
    content: '无法获取 Photoshop 文档列表',
    timestamp: 1777259000450,
    thinkingSteps: [
      {
        id: 'uxp-bridge-tool-result',
        type: 'tool_result',
        content: "执行 skuLayout 失败：Error invoking remote method 'ws:send': Error: UXP 插件未连接",
        toolName: 'skuLayout',
        status: 'error',
        timestamp: 1777259000451,
        toolResult: {
          success: false,
          error: "Error invoking remote method 'ws:send': Error: UXP 插件未连接",
          message: "工具错误：Error invoking remote method 'ws:send'"
        }
      }
    ]
  };
  const uxpBridgeFailureConverted = convertLegacyMessage(uxpBridgeFailureMessage);
  const uxpBridgeFailureVisible = collectVisibleStrings(uxpBridgeFailureConverted).join('\n');
  assert(
    !/Error invoking|ws:send|工具错误|remote method/.test(uxpBridgeFailureVisible),
    'Tool result conversion must not expose raw Electron/UXP bridge errors'
  );
  assert(
    /Photoshop|插件|面板|PS/.test(uxpBridgeFailureVisible) &&
      /打开|连接|再试/.test(uxpBridgeFailureVisible),
    'Tool result conversion should show a recoverable Photoshop plugin connection hint'
  );

  const unsafePublicPlanMessage = {
    id: 'msg-unsafe-public-plan',
    role: 'assistant',
    content: '设计方案暂时还不能执行。',
    timestamp: 1777259000500,
    agentTaskPublicPlanExecutionRequest: {
      version: 'agent-task-public-plan-execution-request/v0',
      requestId: 'req-unsafe',
      status: 'blocked_missing_readback_targets',
      proposedWriteTools: ['createTextLayer'],
      readbackTargets: []
    },
    agentTaskPublicPlanControlledRun: {
      version: 'agent-task-public-plan-controlled-runner/v0',
      requestId: 'run-unsafe',
      status: 'blocked_readback_adapter_required',
      executionTarget: 'live-photoshop',
      plannedWriteTools: ['createTextLayer'],
      executedWriteTools: [],
      readbackTargets: [],
      blockers: ['tool_call_failed:blocked_missing_readback_targets C:\\DesignEcho\\private\\SKU.psb']
    }
  };
  const unsafePublicPlanConverted = convertLegacyMessage(unsafePublicPlanMessage);
  const unsafePublicPlanVisible = collectVisibleStrings(unsafePublicPlanConverted).join('\n');
  assert(
    !/blocked_missing_readback_targets|blocked_readback_adapter_required|tool_call_failed|createTextLayer|plannedWriteTools|proposedWriteTools|readbackTargets|C:\\UXP/.test(unsafePublicPlanVisible),
    'Public plan request and controlled-run cards must not expose internal statuses, tool names, raw tool failures, or local paths'
  );
  assert(
    !/公开计划|处理请求|受控|读回|工具执行/.test(unsafePublicPlanVisible),
    'Public plan blocker cards must not expose internal public-plan/control-run terminology'
  );

  const unsafeToolEventContent = formatAgentToolEventContent({
    kind: 'tool_completed',
    status: 'error',
    toolName: 'skuLayout',
    detail: 'tool_call_failed:blocked_missing_readback_targets C:\\DesignEcho\\private\\SKU.psb'
  });
  assert(
    !/blocked_missing_readback_targets|tool_call_failed|C:\\UXP/.test(unsafeToolEventContent),
    'Visible agent tool events must sanitize internal status codes and local paths'
  );

  const unsafeLiveActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    status: 'running',
    title: '开始子 Agent：审查',
    toolName: 'delegateToAgent:visual-designer',
    detail: '子 Agent role: visual-designer tool_call_failed:blocked_missing_readback_targets C:\\DesignEcho\\private\\SKU.psb <tool_call>'
  });
  const unsafeLiveActivityVisible = collectVisibleStrings(unsafeLiveActivity).join('\n');
  assert(
    !/blocked_missing_readback_targets|tool_call_failed|<tool_call>|C:\\UXP/.test(unsafeLiveActivityVisible),
    'Visible sub-agent live activity must sanitize internal status codes, tool XML and local paths'
  );

  const unsafePersistedMessage = {
    id: 'msg-unsafe-persisted',
    role: 'assistant',
    content: 'direct_response <tool_call>blocked_missing_readback_targets</tool_call> Conversational reply unavailable C:\\DesignEcho\\private\\SKU.psb',
    timestamp: 1777259000600
  };
  const unsafePersistedConverted = convertLegacyMessage(unsafePersistedMessage);
  const unsafePersistedVisible = collectVisibleStrings(unsafePersistedConverted).join('\n');
  assert(
    !/direct_response|blocked_missing_readback_targets|<tool_call>|Conversational reply unavailable|C:\\UXP/.test(unsafePersistedVisible),
    'Persisted assistant message content must be sanitized during legacy conversion before TextBlock rendering'
  );
}

function main() {
  assertChatPanelRoute();
  assertMessageParserRendering();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'ChatPanel sends non-quick user input through the unified Agent path',
      'quick commands remain limited to exact undo/redo/save style commands',
      'ChatPanel preserves tool completion results in thinking steps',
      'ChatPanel exposes gated test selectors and a minimal test bridge only through an explicit env/query gate',
      'message parser renders acceptance summary without raw acceptance diff/debug payload',
      'message parser renders executionSummary as a task report card',
      'message parser keeps executionSummary blockers and warnings visible in the task report card',
      'message parser sanitizes executionSummary and tool result diagnostics before rendering',
      'message parser filters empty thinking placeholders so tool-only progress is shown as 执行, not fake thinking',
      'message parser labels active public thinking/process steps as 正在思考 or 思考 and keeps tool actions in 执行',
      'legacy hard-coded execution templates and AI execution status panel are removed from ChatPanel',
      'initial request activity prevents the waiting interval from rendering as blank without claiming provider thinking',
      'skill executor registry emits factual start/completion step events for deterministic skills',
      'ordinary chat requests use provider token streaming with empty-stream fallback and without local fake typing',
      'provider stream policy blocks multimodal and tool-calling paths until they are separately designed',
      'streamChatAsync keeps renderer callbacks out of IPC provider options',
      'document-management and text-font-replace emit domain-specific observable skill steps',
      'layout-replication emits factual domain steps across parse blueprint apply match QA and finalization phases',
      'detail-page emits factual domain steps across parse plan fill audit and finalization phases',
      'sku-batch emits factual high-level domain steps without changing SKU business logic',
      'main-image emits factual domain steps across document subject size processing and finalization phases',
      'matte-product emits factual domain steps for parameter preparation, removeBackground tool call, and result diagnosis',
      'template-save emits factual domain steps for document lookup, template type inference, library write, and save diagnosis',
      'project-image-analysis emits factual domain steps for context, sample selection, per-image analysis, summary, and diagnosis',
      'design-reference-search emits factual domain steps for search and URL-fetch reference gathering',
      'visual-analysis emits factual domain steps for snapshot acquisition, vision model analysis, and report generation',
      'find-and-edit-element emits factual domain steps for element mapping, candidate ranking, selection, and edit execution',
      'smart-layout emits factual domain steps for parameter preparation, Photoshop tool call, and layout result diagnosis'
    ],
    caveat: 'This smoke validates the renderer message chain and the gated ChatPanel test bridge in code. It does not click the already-running Electron window yet.'
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
