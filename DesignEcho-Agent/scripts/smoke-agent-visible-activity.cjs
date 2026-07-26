#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function compileTsModule(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });
  const compiledModule = new Module(filename, module);
  compiledModule.filename = filename;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(filename));
  compiledModule._compile(compiled.outputText, `${filename}.js`);
  return compiledModule.exports;
}

function loadVisibleFeedbackExports() {
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
    if (request === '../../shared/agent-observation-channels') {
      const policyFilename = path.join(ROOT, 'src/shared/agent-observation-channels.ts');
      const policySource = fs.readFileSync(policyFilename, 'utf8');
      const policyCompiled = ts.transpileModule(policySource, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true
        },
        fileName: policyFilename
      });
      const policyModule = new Module(policyFilename, module);
      policyModule.filename = policyFilename;
      policyModule.paths = Module._nodeModulePaths(path.dirname(policyFilename));
      policyModule._compile(policyCompiled.outputText, `${policyFilename}.js`);
      return policyModule.exports;
    }
    if (request === '../../shared/chat-response-cleaner') {
      return compileTsModule(path.join(ROOT, 'src/shared/chat-response-cleaner.ts'));
    }
    if (request === './conversational-unavailable-message' || request === '../../shared/conversational-unavailable-message') {
      return compileTsModule(path.join(ROOT, 'src/shared/conversational-unavailable-message.ts'));
    }
    if (request === './agent-user-visible-state') {
      return compileTsModule(path.join(ROOT, 'src/shared/agent-user-visible-state.ts'));
    }
    if (request === './tool-display-info') {
      return {
        getToolDisplayInfo: (toolName) => ({
          name: toolName,
          icon: 'T',
          description: toolName
        })
      };
    }
    if (request === '../../shared/skills/skill-declarations') {
      return {
        getSkillById: (skillId) => {
          const skills = {
            'sku-batch': { id: 'sku-batch', name: 'SKU Batch', visibility: 'user-facing' },
            'document-management': { id: 'document-management', name: 'Document Management', visibility: 'user-facing' },
            'autonomous-agent': { id: 'autonomous-agent', name: 'Autonomous Agent', visibility: 'system-only' },
            'business-skill-visual-evidence-gate': { id: 'business-skill-visual-evidence-gate', name: 'Business Skill Visual Evidence Gate', visibility: 'system-only' }
          };
          return skills[skillId];
        }
      };
    }
    if (request === './design-teams') {
      return {
        getDesignTeammateDefinition: (role) => ({
          role,
          displayName: role === 'scene-analyst' ? 'Scene Analyst' : role
        })
      };
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

function assertVisibleActivityContract() {
  const {
    buildVisibleAgentActivityFromProgress,
    buildVisibleAgentActivityFromRunPhase,
    buildVisibleAgentActivityFromStepEvent,
    formatAgentProcessEventContent
  } = loadVisibleFeedbackExports();

  assert(typeof buildVisibleAgentActivityFromStepEvent === 'function', 'step-event visible activity helper is missing');
  assert(typeof buildVisibleAgentActivityFromProgress === 'function', 'progress visible activity helper is missing');
  assert(typeof buildVisibleAgentActivityFromRunPhase === 'function', 'run-phase visible activity helper is missing');

  const contextLoadingActivity = buildVisibleAgentActivityFromRunPhase('context_loading');
  assert(contextLoadingActivity.source === 'run_phase', 'context loading must identify itself as a Harness run phase');
  assert(
    contextLoadingActivity.detail === '正在检查当前项目与 Photoshop 状态。',
    `context loading must describe the real current operation, got: ${contextLoadingActivity.detail}`
  );
  assert(contextLoadingActivity.showAsThinking === false, 'Harness run phase must not become provider thinking');
  assert(contextLoadingActivity.isProviderThinking === false, 'Harness run phase must not claim provider thinking');
  assert(contextLoadingActivity.canClaimModelReasoning === false, 'Harness run phase must not claim model reasoning');
  assert(
    !/正在思考|等待响应|请求已发送|正在准备|稍等/.test(contextLoadingActivity.detail || ''),
    'Harness run phase must not use fake thinking or generic waiting copy'
  );

  const skuActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '开始能力：SKU Batch',
    detail: '能力 ID: sku-batch',
    status: 'running',
    toolName: 'sku-batch',
    toolCallId: 'skill-sku-batch-1'
  });
  assert(skuActivity && skuActivity.agentLabel === 'SKU Batch', 'skill wrapper event must expose SKU Batch activity identity');
  assert(skuActivity.kind === 'skill', `SKU Batch event should be skill activity, got ${skuActivity.kind}`);
  assert(skuActivity.showAsThinking === false, 'skill activity must not become provider thinking');

  const autonomousActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '开始能力：当前请求',
    detail: '能力 ID: autonomous-agent',
    status: 'running',
    toolName: 'autonomous-agent',
    toolCallId: 'skill-autonomous-agent-1'
  });
  assert(autonomousActivity && autonomousActivity.kind === 'autonomous_agent', 'autonomous-agent must expose autonomous activity kind');
  assert(autonomousActivity.agentLabel === '设计助手', `autonomous activity must not expose internal identity, got: ${autonomousActivity && autonomousActivity.agentLabel}`);

  const internalSkillActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '开始能力：Business Skill Visual Evidence Gate',
    detail: '能力 ID: business-skill-visual-evidence-gate',
    status: 'running',
    toolName: 'business-skill-visual-evidence-gate',
    toolCallId: 'skill-business-skill-visual-evidence-gate-1'
  });
  assert(internalSkillActivity && internalSkillActivity.kind === 'skill', 'system-only skill should still update activity state');
  assert(internalSkillActivity.agentLabel === '设计助手', `system-only skill must use a designer-facing label, got: ${internalSkillActivity && internalSkillActivity.agentLabel}`);
  assert(
    !`${internalSkillActivity.agentId}\n${internalSkillActivity.agentLabel}\n${internalSkillActivity.detail || ''}`.includes('business-skill-visual-evidence-gate'),
    'system-only activity must not expose internal skill id in visible payload'
  );

  const toolActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '调用 Photoshop 工具：getDocumentInfo',
    status: 'running',
    toolName: 'getDocumentInfo',
    toolCallId: 'tool-1'
  });
  assert(toolActivity === null, 'plain tool events must stay in tool-call UI, not become agent identity');

  const progressActivity = buildVisibleAgentActivityFromProgress('正在调用视觉模型分析图片。', skuActivity);
  assert(progressActivity?.detail === '正在调用视觉模型分析图片。', 'progress activity must expose the latest real execution summary');
  assert(progressActivity?.agentId === 'sku-batch', 'progress activity must preserve the current visible capability identity');
  assert(progressActivity?.source === 'progress_event', 'progress activity must identify its real event source');
  assert(!Object.prototype.hasOwnProperty.call(progressActivity, 'title'), 'progress activity must not retain the generic 当前执行 title');

  const agentProcessingActivity = buildVisibleAgentActivityFromRunPhase('agent_processing', skuActivity);
  assert(agentProcessingActivity.source === 'run_phase', 'agent processing must identify itself as a Harness run phase');
  assert(agentProcessingActivity.agentId === 'sku-batch', 'run phase transitions must preserve the current visible capability identity');
  assert(agentProcessingActivity.showAsThinking === false, 'agent processing phase must remain separate from provider thinking');

  const engineeringProcessText = formatAgentProcessEventContent({
    kind: 'observation',
    title: '观察执行结果',
    detail: '第9轮：处理：requestAgentCapabilities；结果：成功0项，失败1项。',
    status: 'error',
    audience: 'user',
    visibility: 'user_process'
  });
  assert(
    engineeringProcessText === '当前处理条件还不完整，暂时不能确认画面结果。',
    `runtime diagnostics must become a designer-facing result boundary, got: ${engineeringProcessText}`
  );
  assert(
    !/第\d+轮|requestAgentCapabilities|成功\d+项|失败\d+项/.test(engineeringProcessText),
    'runtime counters and Harness tool identifiers must not enter user-visible process text'
  );
}

function assertChatPanelWiring() {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const css = read('src/renderer/components/ThinkingProcess.css');
  const contextLoadingIndex = chatPanel.indexOf("setLiveActivity(buildVisibleAgentActivityFromRunPhase('context_loading'))");
  const projectContextIndex = chatPanel.indexOf('const projectContext = await getProjectContext({');
  const agentProcessingIndex = chatPanel.indexOf("setLiveActivity(current => buildVisibleAgentActivityFromRunPhase('agent_processing', current))");
  const unifiedAgentIndex = chatPanel.indexOf('const result = await processWithUnifiedAgent(agentContext, {');
  const streamedContentStart = chatPanel.indexOf('const updateStreamedAssistantContent = (');
  const streamedContentEnd = chatPanel.indexOf('const updateStreamedVisibleReasoning = (', streamedContentStart);
  const streamedContentBlock = chatPanel.slice(streamedContentStart, streamedContentEnd);

  assert(contextLoadingIndex >= 0, 'ChatPanel must expose the real context-loading phase when a run starts');
  assert(projectContextIndex > contextLoadingIndex, 'context-loading activity must appear before the first asynchronous project read');
  assert(agentProcessingIndex >= 0, 'ChatPanel must expose the real Agent processing phase');
  assert(unifiedAgentIndex > agentProcessingIndex, 'Agent processing activity must appear before unified Agent execution begins');
  assert(chatPanel.includes('buildVisibleAgentActivityFromStepEvent(event)'), 'ChatPanel must update visible agent identity from skill wrapper events');
  assert(chatPanel.includes('buildVisibleAgentActivityFromProgress(message, current)'), 'ChatPanel must render the latest real progress summary');
  assert(!chatPanel.includes('ensureStreamedAssistantMessage'), 'ChatPanel must not create an empty pending assistant message');
  assert(!chatPanel.includes('agent-stream:pending'), 'ChatPanel must not persist an empty pending stream record');
  assert(streamedContentBlock.includes('if (!visibleContent.trim()) return;'), 'empty cleaned stream fragments must keep the factual run activity visible');
  assert(
    streamedContentBlock.includes('content: visibleContent') &&
      streamedContentBlock.indexOf('content: visibleContent') < streamedContentBlock.indexOf('setLiveActivity(null)'),
    'the first visible stream payload must create its assistant message before replacing run activity'
  );
  assert(chatPanel.includes('{activity.detail || activity.agentLabel}'), 'Live activity must render real progress or capability content directly');
  assert(!chatPanel.includes('{activity.title}'), 'Live activity must not render the generic 当前执行 title');
  assert(!chatPanel.includes('agent-activity-label'), 'Live activity UI must not render internal agent labels');
  assert(!chatPanel.includes('正在确认对话'), 'Live activity UI must not ship the legacy route-confirmation waiting copy');
  assert(chatPanel.includes('live-agent-message'), 'Live activity message must use a dedicated full-width assistant layout class');
  assert(
    /\.message\.live-agent-message \.message-content\s*\{[\s\S]*min-width:\s*min\(320px, calc\(100% - 48px\)\);[\s\S]*min-inline-size:\s*min\(320px, calc\(100% - 48px\)\);/.test(chatPanel),
    'Live activity message content must keep a practical minimum width so fallback labels cannot collapse into vertical text'
  );
  assert(!chatPanel.includes("const LIVE_ACTIVITY_THINKING_TITLE = '正在思考'"), 'ChatPanel must not use 正在思考 as local live placeholder');
  assert(!chatPanel.includes('setLiveActivity({ title: LIVE_ACTIVITY_THINKING_TITLE })'), 'ChatPanel must not set a local fake thinking placeholder');
  assert(!chatPanel.includes('pondering-dots'), 'Live activity must not mimic streaming thinking with animated dots');
  assert(css.includes('.live-activity-placeholder') && css.includes('width: 100%'), 'Live activity panel must fill the available assistant message width');
}

function main() {
  assertVisibleActivityContract();
  assertChatPanelWiring();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'factual Harness run phases cover project loading and Agent startup without claiming model thinking',
      'real capability activity is visible without claiming provider thinking',
      'skill wrapper events update the visible activity identity',
      'system-only activities use designer-facing identity',
      'real progress summaries replace the generic current-execution title',
      'runtime diagnostics are rewritten as designer-facing evidence boundaries',
      'plain Photoshop tool events remain tool-call events',
      'empty cleaned provider fragments cannot create empty assistant messages or erase run activity',
      'ChatPanel replaces capability identity with real progress/model/tool output',
      'live activity hides internal agent labels and fills the available assistant message width'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
