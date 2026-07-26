#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentUserVisibleState,
  getInternalAgentStatusPublicMessage,
  getAgentToolDecisionNextActionPublicText
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-user-visible-state.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentTaskPlanningContract
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-planning-contract.ts'));
const {
  buildAgentToolDecisionContract,
  formatAgentToolDecisionContractBlocker
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-decision-contract.ts'));
const {
  sanitizeUserVisibleDiagnosticText,
  sanitizeUserVisibleAgentText,
  cleanAssistantFailureErrorText
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'chat-response-cleaner.ts'));
const {
  buildConversationalUnavailableMessage
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'conversational-unavailable-message.ts'));
const {
  uiStatusReplyOrigin
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'assistant-reply-origin.ts'));
const {
  convertLegacyMessage
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'message', 'parser.ts'));

const INTERNAL_TOKEN_PATTERN = /\b(?:direct_response|clarification_needed|ready_direct_response|blocked_needs_clarification|ready_read_only_plan|ready_for_tool_execution|ready_for_controlled_execution_plan|ready_for_model_planning|tool_call_failed|needs_model_design_decision|model_replan_without_tools|model_replan_with_allowed_tools|respect_system_boundary|blocked_[a-z0-9_:-]+)\b/i;
const INTERNAL_WORD_PATTERN = /工具决策契约|AgentTaskPlan|contract|诊断信息供排查|工具任务|工具处理流程|准备执行工具|按真实工具|处理步骤|图层编号|模型总结|执行状态/i;
const FORMULAIC_STATUS_COPY_PATTERN = /先和你确认想法|这是对话或规划讨论|先回应你的问题|需要先补充或确认目标、处理对象和交付结果|目标、动作或交付结果还不够明确|先向用户确认要处理的对象、想达到的效果和交付结果|准备开始设计处理|先做设计计划|先看一下当前画面|先定设计方向|先检查执行条件|自然语言/i;

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function assertPublic(value, label) {
  const text = typeof value === 'string' ? value : stringify(value);
  assert(!INTERNAL_TOKEN_PATTERN.test(text), `${label} exposes internal token: ${text}`);
  assert(!INTERNAL_WORD_PATTERN.test(text), `${label} exposes internal wording: ${text}`);
  assert(!FORMULAIC_STATUS_COPY_PATTERN.test(text), `${label} uses formulaic workflow copy: ${text}`);
  assert(!text.includes(String.fromCodePoint(0xfffd)), `${label} contains replacement character`);
}

function planningFor(userInput, routeOptions = {}) {
  const context = {
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      activeLayerName: '图层 1',
      layerCount: 8
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/C-1163',
      projectImageCount: 6
    }
  };
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput,
    hasDocument: true,
    photoshopConnected: true
  });
  const lifecycle = buildAgentRequestLifecycle({
    userInput,
    context,
    ...routeOptions
  });
  return buildAgentTaskPlanningContract({
    userInput,
    intentControlPlane,
    lifecycle,
    context,
    skillId: routeOptions.skillId,
    mode: routeOptions.mode
  });
}

function collectCases() {
  const chatPanelSource = require('fs').readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx'),
    'utf8'
  );
  assert(
    chatPanelSource.includes("'tool_execution'") && chatPanelSource.includes("'direct_tools'"),
    'ChatPanel test bridge must expose direct tool user-visible states'
  );

  const direct = buildAgentUserVisibleState({
    route: 'direct_response',
    planningStatus: 'ready_direct_response',
    requestKind: 'chat_only'
  });
  assert.strictEqual(direct.version, 'agent-user-visible-state/v0');
  assert.strictEqual(direct.category, 'conversation');
  assert.strictEqual(direct.canStartTools, false);
  assert.strictEqual(direct.userActionRequired, false);
  assert(!/直接回答你的问题|这类问题直接回答/.test(stringify(direct)), stringify(direct));
  assertPublic(direct, 'direct user-visible state');

  const clarification = buildAgentUserVisibleState({
    route: 'clarification_needed',
    planningStatus: 'blocked_needs_clarification',
    requestKind: 'clarify'
  });
  assert.strictEqual(clarification.category, 'clarification');
  assert.strictEqual(clarification.canStartTools, false);
  assert.strictEqual(clarification.userActionRequired, true);
  assert(clarification.title.includes('补充') || clarification.summary.includes('信息不足'), stringify(clarification));
  assert(!/先问清|需要先问清|问清一个会影响结果/.test(stringify(clarification)), stringify(clarification));
  assertPublic(clarification, 'clarification user-visible state');

  const readOnly = buildAgentUserVisibleState({
    route: 'skill_execution',
    planningStatus: 'ready_read_only_plan',
    requestKind: 'read_only_inspect'
  });
  assert.strictEqual(readOnly.category, 'read_only');
  assert.strictEqual(readOnly.toolUse, 'read_only');
  assert.strictEqual(readOnly.canStartTools, true);
  assert(readOnly.title.includes('读取') || readOnly.summary.includes('只读取'), stringify(readOnly));
  assert(readOnly.summary.includes('不改变当前画面'), stringify(readOnly));
  assert(!/先看一下当前画面|先查看项目、文档或图层信息|读取完成后展示判断结果/.test(stringify(readOnly)), stringify(readOnly));
  assertPublic(readOnly, 'read-only user-visible state');

  const controlled = buildAgentUserVisibleState({
    route: 'skill_execution',
    planningStatus: 'ready_for_controlled_execution_plan',
    requestKind: 'execute_skill'
  });
  assert.strictEqual(controlled.category, 'controlled_execution');
  assert.strictEqual(controlled.toolUse, 'controlled_write_after_gate');
  assert.strictEqual(controlled.canStartTools, true);
  assert(
    controlled.title.includes('检查') || controlled.summary.includes('检查'),
    `controlled execution should present preflight status before claiming processing started: ${stringify(controlled)}`
  );
  assert(
    !/先检查执行条件|再开始处理|条件满足后再按当前设计任务继续/.test(stringify(controlled)),
    `controlled execution state should avoid mechanical execution-condition copy: ${stringify(controlled)}`
  );
  assert(
    !/按方案处理|按目标、素材和结果检查点推进|处理完成后检查画面/.test(stringify(controlled)),
    `controlled execution state should not look like the task is already running before preflight passes: ${stringify(controlled)}`
  );
  assertPublic(controlled, 'controlled execution user-visible state');

  const controlledAutonomous = buildAgentUserVisibleState({
    route: 'skill_execution',
    planningStatus: 'ready_for_controlled_execution_plan',
    requestKind: 'autonomous_execution'
  });
  assert.strictEqual(controlledAutonomous.category, 'controlled_execution');
  assert.strictEqual(controlledAutonomous.toolUse, 'controlled_write_after_gate');
  assert.strictEqual(controlledAutonomous.canStartTools, true);
  assert(!/整理设计方向|设计方案|公开计划/.test(stringify(controlledAutonomous)), stringify(controlledAutonomous));
  assertPublic(controlledAutonomous, 'controlled autonomous user-visible state');

  const planning = buildAgentUserVisibleState({
    route: 'autonomous_agent',
    planningStatus: 'ready_for_model_planning',
    requestKind: 'autonomous_execution'
  });
  assert.strictEqual(planning.category, 'planning');
  assert.strictEqual(planning.canStartTools, false);
  assert.strictEqual(planning.userActionRequired, false);
  assert(planning.title.includes('设计方向') || planning.nextStep.includes('设计方案'), stringify(planning));
  assert(!/先定设计方向|开放式设计要先|先形成可执行的设计方案/.test(stringify(planning)), stringify(planning));
  assertPublic(planning, 'model planning user-visible state');

  const toolExecution = buildAgentUserVisibleState({
    route: 'autonomous_agent',
    planningStatus: 'ready_for_tool_execution',
    requestKind: 'autonomous_execution'
  });
  assert.strictEqual(toolExecution.category, 'tool_execution');
  assert.strictEqual(toolExecution.toolUse, 'direct_tools');
  assert.strictEqual(toolExecution.canStartTools, true);
  assert.strictEqual(toolExecution.userActionRequired, false);
  assert(toolExecution.title.includes('画面') || toolExecution.summary.includes('Photoshop 处理'), stringify(toolExecution));
  assert(!/工具/.test(stringify(toolExecution)), stringify(toolExecution));
  assert(!/整理设计方向|设计方案|规划处理方案/.test(stringify(toolExecution)), stringify(toolExecution));
  assertPublic(toolExecution, 'tool execution user-visible state');

  const runtimeBlockedCases = [
    ['blocked_missing_photoshop_connection', '连接 Photoshop'],
    ['blocked_missing_document', '打开要处理的 Photoshop 文档'],
    ['blocked_missing_sku_source_file', 'SKU PSD/PSB']
  ];
  for (const [planningStatus, expectedText] of runtimeBlockedCases) {
    const runtimeBlocked = buildAgentUserVisibleState({
      route: 'skill_execution',
      planningStatus,
      requestKind: 'execute_skill'
    });
    assert.strictEqual(runtimeBlocked.category, 'blocked', `${planningStatus} must override execute_skill requestKind`);
    assert.strictEqual(runtimeBlocked.toolUse, 'blocked', `${planningStatus} must block tools`);
    assert.strictEqual(runtimeBlocked.canStartTools, false, `${planningStatus} must not allow tools`);
    assert.strictEqual(runtimeBlocked.userActionRequired, true, `${planningStatus} must require user recovery action`);
    assert(runtimeBlocked.summary.includes(expectedText), `${planningStatus} public state should include ${expectedText}: ${stringify(runtimeBlocked)}`);
    assertPublic(runtimeBlocked, `runtime blocked user-visible state for ${planningStatus}`);
  }

  const directPlan = planningFor('你可以做什么？', {
    routeSource: 'intent_control_plane',
    route: 'direct_response',
    reason: '能力询问'
  });
  assert.strictEqual(directPlan.userVisibleState.category, 'conversation');
  assertPublic(directPlan.userVisibleState, 'planning direct userVisibleState');

  const clarificationPlan = planningFor('帮我处理一下', {
    routeSource: 'intent_control_plane',
    route: 'autonomous_agent',
    reason: '交给模型先理解目标并形成公开计划'
  });
  assert.strictEqual(clarificationPlan.userVisibleState.category, 'planning');
  assert.strictEqual(clarificationPlan.executionPlan.canExecuteTools, false);
  assertPublic(clarificationPlan.userVisibleState, 'planning autonomous gate userVisibleState');

  const simpleToolPlan = planningFor('请直接操作 Photoshop：创建一个临时文档，再创建图层组、矩形图层和文字图层，最后读取图层结构并反馈实际工具结果。', {
    routeSource: 'intent_control_plane',
    route: 'autonomous_agent',
    skillId: 'autonomous-agent',
    reason: '明确小型工具任务进入 Agent 工具循环。'
  });
  assert.strictEqual(simpleToolPlan.status, 'ready_for_tool_execution', stringify(simpleToolPlan));
  assert.strictEqual(simpleToolPlan.userVisibleState.category, 'tool_execution');
  assert.strictEqual(simpleToolPlan.executionPlan.mode, 'tool_execution');
  assert.strictEqual(simpleToolPlan.executionPlan.canExecuteTools, true);
  assert.strictEqual(simpleToolPlan.executionPlan.requiresUserApproval, false);
  assert(!/整理设计方向|设计方案|公开计划/.test(stringify(simpleToolPlan.userVisibleState)), stringify(simpleToolPlan.userVisibleState));
  assertPublic(simpleToolPlan.userVisibleState, 'simple tool task planning userVisibleState');

  const documentToolPlan = planningFor('请把当前 Photoshop 文档导出为 PNG，并读回导出结果。', {
    routeSource: 'deterministic_route',
    route: 'skill_execution',
    skillId: 'document-management',
    mode: 'save',
    reason: '确定性文档导出操作。'
  });
  assert.strictEqual(documentToolPlan.status, 'ready_for_tool_execution', stringify(documentToolPlan));
  assert.strictEqual(documentToolPlan.userVisibleState.category, 'tool_execution');
  assert.strictEqual(documentToolPlan.userVisibleState.toolUse, 'direct_tools');
  assert.strictEqual(documentToolPlan.executionPlan.mode, 'tool_execution');
  assert.strictEqual(documentToolPlan.executionPlan.canExecuteTools, true);
  assert.strictEqual(documentToolPlan.executionPlan.requiresUserApproval, false);
  assert(
    documentToolPlan.executionPlan.steps.some((step) => step.action === 'executeDirectOperationSkill' && step.skillId === 'document-management'),
    stringify(documentToolPlan.executionPlan.steps)
  );
  assert(!/整理设计方向|设计方案|公开计划/.test(stringify(documentToolPlan.userVisibleState)), stringify(documentToolPlan.userVisibleState));
  assertPublic(documentToolPlan.userVisibleState, 'document operation planning userVisibleState');

  const toolContract = buildAgentToolDecisionContract({
    userInput: '你可以做什么？',
    intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: '你可以做什么？' }),
    assistantContent: '我会先查看当前文档。',
    toolCalls: [{ name: 'getDocumentInfo', arguments: {} }],
    runtime: {
      availableTools: ['getDocumentInfo'],
      photoshopConnected: true,
      hasDocument: true
    }
  });
  assert.strictEqual(toolContract.status, 'blocked');
  const formattedBlocker = formatAgentToolDecisionContractBlocker(toolContract);
  assert(formattedBlocker.includes('本轮不会改动') || formattedBlocker.includes('本轮不会改动画面'), formattedBlocker);
  assert(formattedBlocker.includes('回答') || formattedBlocker.includes('说明'), formattedBlocker);
  assertPublic(formattedBlocker, 'tool decision formatted blocker');

  const nextActionText = getAgentToolDecisionNextActionPublicText('model_replan_without_tools');
  assert(nextActionText.includes('判断') || nextActionText.includes('说明'), nextActionText);
  assertPublic(nextActionText, 'next action public text');

  const silentRouteStatuses = [
    'direct_response',
    'ready_direct_response',
    'clarification_needed',
    'blocked_needs_clarification'
  ];
  for (const status of silentRouteStatuses) {
    const mapped = getInternalAgentStatusPublicMessage(status);
    assert.strictEqual(mapped, undefined, `${status} is an internal route status and must not have fixed public copy`);

    const cleaned = sanitizeUserVisibleDiagnosticText(status);
    assert.strictEqual(cleaned, '', `${status} cleaner should suppress standalone internal route status, got ${cleaned}`);
  }

  const statusMappings = [
    ['needs_model_design_decision', '画面重点'],
    ['blocked_missing_photoshop_connection', '连接 Photoshop'],
    ['blocked_missing_document', '打开要处理的 Photoshop 文档'],
    ['blocked_missing_sku_source_file', 'SKU PSD/PSB'],
    ['photoshop_not_connected', '连接 Photoshop'],
    ['photoshop_document_required', '打开要处理的 Photoshop 文档'],
    ['SKU document not found', 'SKU PSD/PSB'],
    ['tool_call_failed:blocked_missing_readback_targets', '处理没有完成'],
    ['blocked_missing_readback_targets', '本轮不会改动画面']
  ];
  for (const [status, expectedText] of statusMappings) {
    const mapped = getInternalAgentStatusPublicMessage(status);
    assert(mapped && mapped.includes(expectedText), `${status} should map to ${expectedText}, got ${mapped}`);
    assertPublic(mapped, `public mapping for ${status}`);

    const cleaned = sanitizeUserVisibleDiagnosticText(status);
    assert(cleaned.includes(expectedText), `${status} cleaner should use public mapping, got ${cleaned}`);
    assertPublic(cleaned, `cleaned diagnostic for ${status}`);
  }

  const failure = cleanAssistantFailureErrorText('needs_model_design_decision');
  assert(failure.includes('画面重点'), failure);
  assertPublic(failure, 'clean failure text');

  const cleanedTechnicalReply = sanitizeUserVisibleAgentText('工具调用完成，layerId 为 12，模型总结未完成，处理步骤 2 次，执行状态：成功。');
  assert(!/工具调用|layerId|图层编号|模型总结|处理步骤|执行状态/.test(cleanedTechnicalReply), cleanedTechnicalReply);
  assert(cleanedTechnicalReply.includes('对应图层') || cleanedTechnicalReply.includes('画面处理'), cleanedTechnicalReply);
  assertPublic(cleanedTechnicalReply, 'cleaned technical assistant reply');

  const unavailableCopy = buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
  const unavailablePlan = {
    status: 'ready_for_model_planning',
    userVisibleState: buildAgentUserVisibleState({
      route: 'autonomous_agent',
      planningStatus: 'ready_for_model_planning',
      requestKind: 'autonomous_execution'
    })
  };
  const parsedUnavailable = convertLegacyMessage({
    id: 'model-unavailable-message',
    role: 'assistant',
    content: '⚠️ **状态**\n\n暂时没有拿到可靠回复，所以不会贸然改动画面。可以稍后再试，或者在设置里切换可用的回复服务。',
    timestamp: Date.now(),
    assistantReplyOrigin: uiStatusReplyOrigin('conversational:unavailable'),
    conversationalModelFailure: { kind: 'unknown', attempts: [] },
    agentTaskPlan: unavailablePlan,
    executionSummary: {
      status: 'failed',
      stopReason: 'empty_final_response',
      toolCallCount: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      acceptanceVerified: 0,
      acceptanceFailed: 0,
      acceptanceNeedsReview: 0,
      noDocumentChangeRisks: 0,
      summaryText: unavailableCopy,
      blockers: [],
      warnings: [],
      lastError: 'Conversational reply unavailable'
    },
    thinkingSteps: []
  });
  const parsedUnavailableText = JSON.stringify(parsedUnavailable.blocks);
  assert(
    !parsedUnavailable.blocks.some((block) => block.type === 'card'),
    `conversational-unavailable messages should render as compact plain text, not status/result cards: ${parsedUnavailableText}`
  );
  assert(
    parsedUnavailable.blocks.some((block) => block.type === 'text' && String(block.content || '').includes(unavailableCopy)),
    `conversational-unavailable message should keep one neutral plain-text notice: ${parsedUnavailableText}`
  );
  assert(
    !parsedUnavailableText.includes('状态') && !parsedUnavailableText.includes('处理结果'),
    `conversational-unavailable message should not expose status-card titles: ${parsedUnavailableText}`
  );

  return {
    direct,
    clarification,
    readOnly,
    controlled,
    planning,
    toolExecution,
    formattedBlocker,
    statusMappings: statusMappings.map(([status]) => ({
      status,
      publicMessage: getInternalAgentStatusPublicMessage(status)
    }))
  };
}

const details = collectCases();
console.log(JSON.stringify({
  success: true,
  checks: [
    'internal route and planning statuses have shared user-visible state',
    'planning contracts expose userVisibleState without raw internal status codes',
    'tool decision blockers explain the next user-visible action without contract wording',
    'chat response cleaner uses the shared public status mapping',
    'known and future blocked/tool failure statuses do not leak raw codes',
    'state cards use design-assistant copy instead of developer workflow labels'
  ],
  details
}, null, 2));
