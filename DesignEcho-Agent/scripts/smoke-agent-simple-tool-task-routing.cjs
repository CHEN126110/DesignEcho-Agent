#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  DesignAgentEngine
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  checkToolDependencies
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'tool-dependencies.ts'));
const {
  getDefaultAgentTools
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));

const SIMPLE_TOOL_PROMPT = '请在 Photoshop 中真实执行一个小型工具调用验证：先创建一个新的临时文档，名称包含 Agent真实工具调用验证；然后创建一个名为 Agent真实调用验证组 的图层组，在里面创建一个矩形图层和一个文字图层；最后读取图层层级，向我反馈实际调用过的工具、每个工具是否成功、创建出的 layerId 或 groupId。不要只解释计划，如果工具失败请直接说明失败原因。';
const READ_ONLY_TOOL_PROMPT = '请直接操作 Photoshop：先列出当前打开的文档，切换到文档 id 7334，然后读取图层结构，并告诉我是否看到了基础工具链验证组和中文文字层。不要只创建调试任务，也不要只给设计方案。';
const NO_PUBLIC_PLAN_TOOL_PROMPT = [
  '这是一次 Photoshop 小工具真实调用验证，不需要长篇规划说明，也不要只解释计划。',
  '请直接创建一个临时文档，名称为 AgentLayerEffectsTransformTimeoutBoundary，尺寸 720x420。',
  '在文档中创建一个名为 EffectBaseCard 的橙色矩形图层，添加投影和描边。',
  '最后读取图层层级，导出 PNG 到：C:/DesignEcho/DesignEcho-Agent/tmp/agent-real-layer-effects-transform-timeout-boundary.png',
  '导出后关闭这个临时文档且不要保存 PSD。',
  '最终请反馈真实调用过的 Photoshop 工具名称、每个关键步骤是否成功、导出路径以及是否需要人工复核。'
].join('\n');
const SCOPED_SIMPLE_TOOL_PROMPT = [
  '这是一次 Photoshop 证据读取验收，请直接完成当前小步骤。',
  '这个小步骤只建立临时画面，不需要长篇说明。',
  '先看一眼已打开文档，再创建临时文档。',
  '请创建一个 720x480 的临时文档，名称必须是 AgentScopedSimpleToolIntent。',
  '创建矩形形状图层、文字图层和图层组，最后读回图层层级。'
].join('\n');
const ENGLISH_LAYER_EFFECTS_TOOL_PROMPT = [
  'Create a new Photoshop document named AgentClearEffectsSmoke, size 640x420.',
  'Create one rectangle layer named ClearEffectsCard.',
  'Add a real Photoshop drop shadow to that same rectangle layer.',
  'Add a real Photoshop stroke to that same rectangle layer.',
  'Then directly call clearLayerEffects on that same rectangle layer to remove the layer effects.',
  'Export exactly to C:/DesignEcho/DesignEcho-Agent/tmp/agent-real-clear-layer-effects-smoke.png as PNG, then close the document without saving PSD.',
  'This is a simple tool execution task. Do not generate or ask me to confirm a public design plan.'
].join(' ');

function createEngineContext(userInput) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      activeLayerName: '背景',
      layerCount: 1
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 0,
      projectImageFolders: [],
      sampleImagePaths: []
    }
  };
}

async function run() {
  const fs = require('fs');
  const toolExecutorSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'),
    'utf8'
  );
  const toolSchemasSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'),
    'utf8'
  );
  const toolDependenciesSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'tool-dependencies.ts'),
    'utf8'
  );
  const chatPanelSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx'),
    'utf8'
  );
  const streamChatSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'stream-chat.service.ts'),
    'utf8'
  );
  const preloadSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'main', 'preload.ts'),
    'utf8'
  );
  const streamHandlersSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'main', 'ipc-handlers', 'stream-handlers.ts'),
    'utf8'
  );
  const agentTypesSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'types.ts'),
    'utf8'
  );
  const agentRuntimeSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
    'utf8'
  );
  const autonomousExecutorSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  assert(
    toolExecutorSource.includes('isExplicitRasterFilePath') &&
      toolExecutorSource.includes("toolName === 'quickExport'") &&
      toolExecutorSource.includes("redirectedTo: 'saveDocument'") &&
      toolExecutorSource.includes("redirectedFrom: 'quickExport'"),
    'quickExport with a complete PNG/JPEG path must be redirected to saveDocument(path) to avoid creating a same-named directory'
  );
  const normalizeNoDialogSaveFormatBody = toolExecutorSource.match(/function normalizeNoDialogSaveFormat[\s\S]*?\n}/)?.[0] || '';
  assert(
    normalizeNoDialogSaveFormatBody.includes('extensionMatch') &&
      normalizeNoDialogSaveFormatBody.includes("extensionMatch?.[1]") &&
      normalizeNoDialogSaveFormatBody.includes("if (format === 'png') return 'png'") &&
      normalizeNoDialogSaveFormatBody.includes("if (format === 'jpg' || format === 'jpeg') return 'jpg'"),
    'quickExport with outputPath "file.png" must infer saveDocument format from the path extension instead of falling back to PSD when format is omitted'
  );
  assert(
    toolSchemasSource.includes('complete PNG/JPEG file path') &&
      toolSchemasSource.includes('Do not remove the file extension') &&
      !toolSchemasSource.includes('not a file path'),
    'quickExport schema must allow complete raster file paths and must not tell the Agent to strip the user-provided file name'
  );
  assert(
    /name:\s*'clearLayerEffects'/.test(toolSchemasSource) &&
      toolSchemasSource.includes('Clear all Photoshop layer effects') &&
      /'clearLayerEffects'/.test(toolSchemasSource),
    'Agent tool schema must expose clearLayerEffects so the model does not delete/recreate layers to clear effects'
  );
  const defaultAgentToolNames = new Set(getDefaultAgentTools().map((tool) => tool.name));
  const adjustmentToolNames = [
    'addBrightnessContrastAdjustment',
    'addHueSaturationAdjustment',
    'addLevelsAdjustment',
    'addColorBalanceAdjustment',
    'addVibranceAdjustment',
    'addPhotoFilterAdjustment'
  ];
  const missingAdjustmentTools = adjustmentToolNames.filter((name) => !defaultAgentToolNames.has(name));
  assert.deepStrictEqual(
    missingAdjustmentTools,
    [],
    `default autonomous-agent tools must expose adjustment-layer tools: ${missingAdjustmentTools.join(', ')}`
  );
  const visualEffectToolNames = ['addGlow', 'addGradientOverlay', 'setLayerFill'];
  const missingVisualEffectTools = visualEffectToolNames.filter((name) => !defaultAgentToolNames.has(name));
  assert.deepStrictEqual(
    missingVisualEffectTools,
    [],
    `default autonomous-agent tools must expose layer visual effect tools: ${missingVisualEffectTools.join(', ')}`
  );
  const lowRiskEvidenceToolNames = ['diagnoseState', 'getTextStyle'];
  const missingEvidenceTools = lowRiskEvidenceToolNames.filter((name) => !defaultAgentToolNames.has(name));
  assert.deepStrictEqual(
    missingEvidenceTools,
    [],
    `default autonomous-agent tools must expose low-risk evidence tools: ${missingEvidenceTools.join(', ')}`
  );
  const commonLayerOperationToolNames = [
    'createEllipse',
    'createClippingMask',
    'releaseClippingMask',
    'batchRenameLayers'
  ];
  const missingLayerOperationTools = commonLayerOperationToolNames.filter((name) => !defaultAgentToolNames.has(name));
  assert.deepStrictEqual(
    missingLayerOperationTools,
    [],
    `default autonomous-agent tools must expose common layer operation tools: ${missingLayerOperationTools.join(', ')}`
  );
  const smartObjectSafeToolNames = [
    'convertToSmartObject',
    'getSmartObjectInfo',
    'getSmartObjectLayers',
    'duplicateSmartObject'
  ];
  const missingSmartObjectTools = smartObjectSafeToolNames.filter((name) => !defaultAgentToolNames.has(name));
  assert.deepStrictEqual(
    missingSmartObjectTools,
    [],
    `default autonomous-agent tools must expose safe smart-object tools: ${missingSmartObjectTools.join(', ')}`
  );
  const lowRiskLayoutToolNames = ['alignToReference'];
  const missingLayoutTools = lowRiskLayoutToolNames.filter((name) => !defaultAgentToolNames.has(name));
  assert.deepStrictEqual(
    missingLayoutTools,
    [],
    `default autonomous-agent tools must expose explicit-target layout tools: ${missingLayoutTools.join(', ')}`
  );
  assert(
    !defaultAgentToolNames.has('smartLayout'),
    'smartLayout must stay out of the default autonomous-agent toolbox until its write actions are split or guarded; it can auto-select groups and silently continue after ungroup warnings'
  );
  assert(
    /name:\s*'getTextStyle'[\s\S]*?layerId:\s*\{\s*type:\s*'number'\s*\}/.test(toolSchemasSource) &&
      /case\s+'getTextStyle':\s*return hasFiniteLayerId\(record\.layerId\);/.test(toolDependenciesSource),
    'getTextStyle must expose layerId and dependency checks must allow getTextStyle({ layerId }) without a prior selectLayer failure'
  );
  assert(
    /name:\s*'alignToReference'[\s\S]*?layerId:\s*\{\s*type:\s*'number'[\s\S]*?scalePercent:\s*\{\s*type:\s*'number'[\s\S]*?targetCenterX:\s*\{\s*type:\s*'number'[\s\S]*?targetCenterY:\s*\{\s*type:\s*'number'[\s\S]*?subjectOffsetX:\s*\{\s*type:\s*'number'[\s\S]*?subjectOffsetY:\s*\{\s*type:\s*'number'/.test(toolSchemasSource),
    'alignToReference must expose its explicit geometry contract'
  );
  assert.strictEqual(
    checkToolDependencies('alignToReference', [], { layerId: 123, scalePercent: 100, targetCenterX: 320, targetCenterY: 240, subjectOffsetX: 0, subjectOffsetY: 0 }).valid,
    true,
    'alignToReference dependency checks must allow alignToReference({ layerId }) without a prior selectLayer failure'
  );
  assert.strictEqual(
    checkToolDependencies('alignToReference', [], { scalePercent: 100, targetCenterX: 320, targetCenterY: 240, subjectOffsetX: 0, subjectOffsetY: 0 }).valid,
    false,
    'alignToReference dependency checks must still require selectLayer when no layerId is provided'
  );
  assert(
    chatPanelSource.includes('function readAgentExecutionSummaryFromResult(result: unknown)') &&
      chatPanelSource.includes('const direct = (result as any)?.executionSummary') &&
      chatPanelSource.includes('const nested = (result as any)?.data?.executionSummary') &&
      chatPanelSource.includes('normalizeAgentExecutionSummaryStatus') &&
      chatPanelSource.includes('STRUCTURED_AGENT_EXECUTION_STATUSES') &&
      chatPanelSource.includes("status: 'needs_review'") &&
      chatPanelSource.includes('const executionSummary = readAgentExecutionSummaryFromResult(result);') &&
      chatPanelSource.includes('executionStatus: sanitizeTestSnapshotToken((message.executionSummary as any)?.status)'),
    'ChatPanel must preserve structured Agent executionSummary feedback and normalize non-structured status text before persisting messages'
  );
  assert(
    chatPanelSource.includes('timeoutMs: modelTimeoutMs') &&
      streamChatSource.includes('timeoutMs?: number') &&
      streamChatSource.includes('Stream chat timeout after') &&
      streamChatSource.includes('void handle.abort().catch(() => undefined)') &&
      preloadSource.includes('timeoutMs?: number') &&
      streamHandlersSource.includes('timeoutMs?: number'),
    'Agent model-visible reasoning streams must inherit the model timeout budget and abort instead of leaving ChatPanel loading forever'
  );
  // 2026-07-03 更新过期钉桩：非流式 chatWithTools 的超时预算从"executor 兜底默认
  // (DEFAULT_AGENT_MODEL_TIMEOUT_MS)"改为在 agent.ts 每个调用点直接强制
  // (timeoutMs: AGENT_MODEL_REQUEST_TIMEOUT_MS)——单一来源、更强不变量。能力未变（仍有超时+
  // 强制收尾兜底回落真实工具证据），此处钉桩改指现行架构真实符号。
  assert(
    agentTypesSource.includes('timeoutMs?: number') &&
      agentRuntimeSource.includes('const AGENT_MODEL_REQUEST_TIMEOUT_MS') &&
      agentRuntimeSource.includes('timeoutMs: AGENT_MODEL_REQUEST_TIMEOUT_MS') &&
      agentRuntimeSource.includes('AGENT_FINAL_SUMMARY_TIMEOUT_MS') &&
      agentRuntimeSource.includes('buildForcedFinalResponseFallbackResult') &&
      agentRuntimeSource.includes('agent_final_summary_timeout_or_error') &&
      agentRuntimeSource.includes('timeoutMs: AGENT_FINAL_SUMMARY_TIMEOUT_MS'),
    'Agent non-stream chatWithTools calls must have a timeout (AGENT_MODEL_REQUEST_TIMEOUT_MS at each call site) and forced final summary must fall back to real tool evidence instead of leaving ChatPanel loading forever'
  );

  const decision = buildAgentIntentControlPlaneDecision({
    userInput: SIMPLE_TOOL_PROMPT,
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(
    decision.requestKind,
    'autonomous_execution',
    `simple Photoshop tool task should enter autonomous execution: ${JSON.stringify(decision)}`
  );
  assert(
    decision.matchedSignals.includes('basic_photoshop_write_task'),
    `simple Photoshop tool task should carry the basic tool signal: ${JSON.stringify(decision)}`
  );
  const noPublicPlanDecision = buildAgentIntentControlPlaneDecision({
    userInput: NO_PUBLIC_PLAN_TOOL_PROMPT,
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(
    noPublicPlanDecision.requestKind,
    'autonomous_execution',
    `explicit "no public design plan" Photoshop tool task should not be misread as plan_only: ${JSON.stringify(noPublicPlanDecision)}`
  );
  assert(
    noPublicPlanDecision.matchedSignals.includes('basic_photoshop_write_task'),
    `explicit "no public design plan" Photoshop tool task should still carry the basic tool signal: ${JSON.stringify(noPublicPlanDecision)}`
  );
  const scopedSimpleDecision = buildAgentIntentControlPlaneDecision({
    userInput: SCOPED_SIMPLE_TOOL_PROMPT,
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(
    scopedSimpleDecision.requestKind,
    'autonomous_execution',
    `scoped simple Photoshop tool task should not be misread as conversation-only: ${JSON.stringify(scopedSimpleDecision)}`
  );
  assert(
    scopedSimpleDecision.matchedSignals.includes('basic_photoshop_write_task'),
    `scoped simple Photoshop tool task should carry the basic tool signal: ${JSON.stringify(scopedSimpleDecision)}`
  );
  const englishLayerEffectsDecision = buildAgentIntentControlPlaneDecision({
    userInput: ENGLISH_LAYER_EFFECTS_TOOL_PROMPT,
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(
    englishLayerEffectsDecision.requestKind,
    'autonomous_execution',
    `English layer effects Photoshop task should enter autonomous execution instead of document-management: ${JSON.stringify(englishLayerEffectsDecision)}`
  );
  assert(
    englishLayerEffectsDecision.matchedSignals.includes('basic_photoshop_write_task'),
    `English layer effects Photoshop task should carry the basic tool signal: ${JSON.stringify(englishLayerEffectsDecision)}`
  );

  const engine = new DesignAgentEngine();
  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];
  let publicPlanCalls = 0;
  const modelPurposes = [];

  skillExecutors.getSkillExecutor = (skillId) => ({
    id: skillId,
    execute: async () => ({ success: true, message: `executed:${skillId}` })
  });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return {
      success: true,
      message: '已通过 autonomous-agent 执行小型 Photoshop 工具序列。',
      toolResults: [
        { toolName: 'createDocument', result: { success: true, documentId: 101 } },
        { toolName: 'createGroup', result: { success: true, groupId: 201 } },
        { toolName: 'createRectangle', result: { success: true, layerId: 301 } },
        { toolName: 'createTextLayer', result: { success: true, layerId: 401 } },
        { toolName: 'getLayerHierarchy', result: { success: true, layers: [] } }
      ]
    };
  };

  try {
    const result = await engine.run(createEngineContext(SIMPLE_TOOL_PROMPT), {
      callModel: async (_messages, options = {}) => {
        modelPurposes.push(options.purpose || 'unknown');
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会直接执行这个小型 Photoshop 工具序列，并在完成后读回图层层级。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              intentSummary: '执行小型 Photoshop 工具调用验证。',
              skillParams: {}
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
          return {
            text: JSON.stringify({
              message: '我会先整理一个设计方案，确认后再处理。',
              proposedWriteTools: ['createDocument', 'createGroup', 'createRectangle', 'createTextLayer'],
              readbackTargets: ['layer_hierarchy'],
              requiresUserConfirmation: true,
              executionPlanSummary: '创建临时文档、图层组、矩形和文字。',
              operationRequests: [
                {
                  operationId: 'create-document',
                  toolName: 'createDocument',
                  params: { name: 'Agent真实工具调用验证', width: 800, height: 600 },
                  readbackTargets: ['document_info']
                }
              ]
            })
          };
        }
        return { text: '{}' };
      }
    });

    assert.strictEqual(
      publicPlanCalls,
      0,
      `simple Photoshop tool task must not request a public design plan: ${JSON.stringify({ publicPlanCalls, modelPurposes, result })}`
    );
    assert(
      executed.some((item) => item.skillId === 'autonomous-agent'),
      `simple Photoshop tool task should execute autonomous-agent directly: ${JSON.stringify({ executed, result })}`
    );
    assert.strictEqual(result?.success, true, `expected successful autonomous-agent result: ${JSON.stringify(result)}`);
    assert.strictEqual(
      result?.data?.agentTaskPlan?.status,
      'ready_for_tool_execution',
      `simple Photoshop tool task should be represented as tool execution, not public plan planning: ${JSON.stringify(result?.data?.agentTaskPlan)}`
    );
    assert.strictEqual(
      result?.data?.agentTaskPlan?.userVisibleState?.category,
      'tool_execution',
      `simple Photoshop tool task user-visible state should not be design planning: ${JSON.stringify(result?.data?.agentTaskPlan?.userVisibleState)}`
    );

    executed.length = 0;
    publicPlanCalls = 0;
    modelPurposes.length = 0;
    const noPublicPlanResult = await engine.run(createEngineContext(NO_PUBLIC_PLAN_TOOL_PROMPT), {
      callModel: async (_messages, options = {}) => {
        modelPurposes.push(options.purpose || 'unknown');
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会直接执行这个小型 Photoshop 工具序列，并在完成后读回图层层级。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              intentSummary: '这是小工具验证，但 router 误判为直接回复。',
              directResponse: '我会按步骤执行。'
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
          return { text: '{}' };
        }
        return { text: '{}' };
      }
    });
    assert.strictEqual(
      publicPlanCalls,
      0,
      `explicit no-public-plan tool task must not request a public design plan: ${JSON.stringify({ publicPlanCalls, modelPurposes, executed, noPublicPlanResult })}`
    );
    assert(
      executed.some((item) => item.skillId === 'autonomous-agent'),
      `explicit no-public-plan tool task must bypass router direct_response and execute autonomous-agent: ${JSON.stringify({ executed, noPublicPlanResult })}`
    );
    assert.strictEqual(noPublicPlanResult?.success, true, `expected successful no-public-plan tool-backed result: ${JSON.stringify(noPublicPlanResult)}`);

    executed.length = 0;
    publicPlanCalls = 0;
    modelPurposes.length = 0;
    const englishLayerEffectsResult = await engine.run(createEngineContext(ENGLISH_LAYER_EFFECTS_TOOL_PROMPT), {
      callModel: async (_messages, options = {}) => {
        modelPurposes.push(options.purpose || 'unknown');
        if (options.purpose === 'visible_reasoning') {
          return { text: 'I will run the Photoshop layer effects tool sequence directly and verify the result.' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              intentSummary: 'The router incorrectly tries to answer directly.',
              directResponse: 'I will do it.'
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
          return { text: '{}' };
        }
        return { text: '{}' };
      }
    });
    assert.strictEqual(
      publicPlanCalls,
      0,
      `English layer effects tool task must not request a public design plan: ${JSON.stringify({ publicPlanCalls, modelPurposes, executed, englishLayerEffectsResult })}`
    );
    assert(
      executed.some((item) => item.skillId === 'autonomous-agent'),
      `English layer effects tool task must bypass document-management and execute autonomous-agent: ${JSON.stringify({ executed, englishLayerEffectsResult })}`
    );
    assert(
      !executed.some((item) => item.skillId === 'document-management'),
      `English multi-step layer effects task must not be swallowed by document-management: ${JSON.stringify({ executed, englishLayerEffectsResult })}`
    );
    assert.strictEqual(englishLayerEffectsResult?.success, true, `expected successful English layer effects tool-backed result: ${JSON.stringify(englishLayerEffectsResult)}`);

    executed.length = 0;
    publicPlanCalls = 0;
    modelPurposes.length = 0;
    const readOnlyResult = await engine.run(createEngineContext(READ_ONLY_TOOL_PROMPT), {
      callModel: async (_messages, options = {}) => {
        modelPurposes.push(options.purpose || 'unknown');
        if (options.purpose === 'visible_reasoning') {
          return { text: '我会读取当前 Photoshop 文档列表并切换目标文档，再读取图层结构。' };
        }
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              directResponse: '我会先整理一个检查方案，确认后再处理。'
            })
          };
        }
        if (options.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
          return {
            text: JSON.stringify({
              message: '我会先整理一个设计方案，确认后再处理。',
              proposedWriteTools: [],
              readbackTargets: ['layer_hierarchy'],
              requiresUserConfirmation: true,
              executionPlanSummary: '读取文档和图层结构。'
            })
          };
        }
        return { text: '{}' };
      }
    });

    assert.strictEqual(
      publicPlanCalls,
      0,
      `read-only Photoshop tool task must not request a public design plan: ${JSON.stringify({ publicPlanCalls, modelPurposes, executed, readOnlyResult })}`
    );
    assert(
      executed.length > 0,
      `read-only Photoshop tool task should execute a tool-backed route instead of plan-only response: ${JSON.stringify({ executed, readOnlyResult })}`
    );
    assert.strictEqual(readOnlyResult?.success, true, `expected successful read-only tool-backed result: ${JSON.stringify(readOnlyResult)}`);
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  console.log(JSON.stringify({
    success: true,
    checks: [
      'simple Photoshop tool task is detected as basic_photoshop_write_task',
      'no-public-plan Photoshop tool task remains autonomous execution',
      'simple Photoshop tool task bypasses public design plan generation',
      'simple Photoshop tool task enters autonomous-agent runtime directly',
      'router direct_response cannot swallow explicit no-public-plan Photoshop tool task',
      'English layer effects tool task bypasses document-management and enters autonomous-agent',
      'quickExport schema preserves user-provided PNG/JPEG file paths',
      'clearLayerEffects is exposed as an Agent-callable Photoshop tool',
      'adjustment-layer tools are exposed in the default autonomous-agent toolbox',
      'layer visual effect tools are exposed in the default autonomous-agent toolbox',
      'low-risk evidence tools are exposed in the default autonomous-agent toolbox',
      'common layer operation tools are exposed in the default autonomous-agent toolbox',
      'safe smart-object tools are exposed in the default autonomous-agent toolbox',
      'explicit-target layout tools are exposed in the default autonomous-agent toolbox',
      'auto-layout write engine stays out of the default autonomous-agent toolbox until split or guarded',
      'getTextStyle layerId path bypasses selectLayer dependency failure',
      'alignToReference layerId path bypasses selectLayer dependency failure',
      'read-only Photoshop tool task bypasses public design plan generation',
      'Agent tool feedback preserves structured executionSummary status',
      'Agent visible reasoning stream calls carry timeout and abort protection',
      'Agent non-stream final summaries have timeout and tool-evidence fallback'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
