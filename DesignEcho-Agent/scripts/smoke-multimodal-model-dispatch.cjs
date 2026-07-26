#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const repoRoot = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

const {
  buildMultimodalModelDispatchPlan,
  formatModelDispatchTrace,
  formatPrimaryAgentDispatchPromptSection,
  resolveCapabilitySlotForTaskType,
  resolveTaskTypeForDesignRole
} = require(path.join(repoRoot, 'src', 'shared', 'multimodal-model-dispatch.ts'));

// 两角色组合：text-only 主模型负责规划/工具，独立视觉模型负责读图。
const prefs = {
  mode: 'cloud',
  autoFallback: true,
  primaryModel: 'deepseek-v4-pro',
  visualModel: 'xiaomi-mimo-v2.5',
  preferredLocalModels: {
    layoutAnalysis: '',
    textOptimize: '',
    visualAnalyze: ''
  },
  preferredCloudModels: {
    layoutAnalysis: 'ollama-cloud-qwen3-next-80b',
    textOptimize: 'xiaomi-mimo-v2.5',
    visualAnalyze: 'google-gemini-3-flash'
  }
};

function runPlanAssertions() {
  const primary = buildMultimodalModelDispatchPlan({
    consumer: 'primary-agent',
    taskType: 'logic',
    userTask: '帮我创建详情页文档并检查尺寸',
    prefs,
    mode: 'cloud',
    includeFallback: true,
    requireToolUse: true
  });
  assert(primary.selectedModelId === 'deepseek-v4-pro', 'primary logic task must dispatch the configured primaryModel');
  assert(
    JSON.stringify(primary.candidateModelIds) === JSON.stringify(['deepseek-v4-pro']),
    'primary dispatch must expose only the configured primaryModel as candidate'
  );
  assert(primary.capabilitySlot === 'logic', 'primary logic task should still resolve to logic capability slot');
  assert(primary.contextPolicy.includeFullConversation === false, 'dispatch context must not blindly pass full conversation');
  assert(primary.handoffBoundary.primaryAgentRetainsFinalJudgment === true, 'primary agent must keep final judgment');
  assert(primary.handoffBoundary.expertMayDirectlyExecuteTools === false, 'expert model dispatch must not directly own tool execution');
  assert(!primary.publicReason.includes('能力槽'), 'primary public reason must not expose legacy capability-slot wording');
  const primaryPrompt = formatPrimaryAgentDispatchPromptSection(primary);
  assert(primaryPrompt.includes('模型分工'), 'primary prompt should explain the two-role model composition');
  assert(!primaryPrompt.includes('能力槽'), 'primary prompt must not teach the model legacy capability-slot language');

  const scene = buildMultimodalModelDispatchPlan({
    consumer: 'teammate',
    role: 'scene-analyst',
    userTask: '检查当前图片内容和画面结构',
    prefs,
    mode: 'cloud',
    includeFallback: true,
    requireToolUse: true
  });
  assert(scene.taskType === 'visual', 'scene analyst should still be treated as a visual task');
  assert(scene.capabilitySlot === 'visual', 'scene analyst should still use visual capability slot');
  assert(scene.selectedModelId === 'xiaomi-mimo-v2.5', 'visual dispatch must use the configured visualModel');
  assert(
    JSON.stringify(scene.candidateModelIds) === JSON.stringify(['xiaomi-mimo-v2.5']),
    'visual dispatch candidates must stay inside the visual role'
  );

  const copywriter = buildMultimodalModelDispatchPlan({
    consumer: 'teammate',
    role: 'copywriter',
    userTask: '提炼卖点并写上图文案',
    prefs,
    mode: 'cloud',
    includeFallback: true,
    requireToolUse: true
  });
  assert(copywriter.taskType === 'copywriting', 'copywriter should still be treated as copywriting task');
  assert(copywriter.capabilitySlot === 'copywriting', 'copywriter should still use copywriting capability slot');
  assert(copywriter.selectedModelId === 'deepseek-v4-pro', 'copywriter dispatch must stay on the primaryModel');

  const executor = buildMultimodalModelDispatchPlan({
    consumer: 'teammate',
    role: 'executor',
    userTask: '根据设计计划执行 Photoshop 修改',
    prefs,
    mode: 'cloud',
    includeFallback: true,
    requireToolUse: true
  });
  assert(executor.taskType === 'logic', 'executor should still be treated as logic task');
  assert(executor.selectedModelId === 'deepseek-v4-pro', 'executor dispatch must stay on the primaryModel');

  // 核心不变量：只有视觉角色使用 visualModel，最终规划和执行仍由 primaryModel 承担。
  assert(
    primary.selectedModelId === copywriter.selectedModelId
      && primary.selectedModelId === executor.selectedModelId
      && scene.selectedModelId !== primary.selectedModelId,
    'model dispatch must separate the visual expert from the stable primary agent'
  );

  const invalidVisualOverride = buildMultimodalModelDispatchPlan({
    consumer: 'teammate',
    role: 'scene-analyst',
    prefs,
    explicitModelId: 'deepseek-v4-pro',
    requireVision: true,
    requireToolUse: true
  });
  assert(
    invalidVisualOverride.selectedModelId === 'xiaomi-mimo-v2.5',
    'a text-only explicit override must not displace the configured vision-capable model'
  );

  // taskType / capabilitySlot 映射本身与单模型无关，仍需保持正确。
  assert(resolveCapabilitySlotForTaskType('visual') === 'visual', 'visual task slot mapping failed');
  assert(resolveCapabilitySlotForTaskType('copywriting') === 'copywriting', 'copywriting task slot mapping failed');
  assert(resolveCapabilitySlotForTaskType('general') === 'logic', 'general task should stay on stable logic slot');
  assert(resolveTaskTypeForDesignRole('critic') === 'visual', 'critic should use visual task type');
  assert(resolveTaskTypeForDesignRole('design-strategist') === 'logic', 'design strategist should use logic task type');

  // 迁移：老配置无新角色字段时，仍从旧视觉槽初始化可工作的默认组合。
  const staleWithoutPrimary = {
    mode: prefs.mode,
    autoFallback: prefs.autoFallback,
    preferredLocalModels: prefs.preferredLocalModels,
    preferredCloudModels: prefs.preferredCloudModels
  };
  const migrated = buildMultimodalModelDispatchPlan({
    consumer: 'primary-agent',
    taskType: 'logic',
    userTask: '继续处理详情页',
    prefs: staleWithoutPrimary,
    mode: 'cloud',
    includeFallback: true,
    requireToolUse: true
  });
  assert(
    migrated.selectedModelId === 'google-gemini-3-flash',
    'stale prefs without primaryModel must migrate the primary from the visual slot and dispatch it for every task'
  );

  const trace = formatModelDispatchTrace(scene);
  assert(trace.includes('scene-analyst'), 'dispatch trace should include role');
  assert(trace.includes('视觉'), 'dispatch trace should include human readable capability slot');
  assert(trace.includes('xiaomi-mimo-v2.5'), 'dispatch trace should include selected visual model');
  assert(trace.includes('主 Agent'), 'dispatch trace should mention primary agent boundary');
}

function runSourceWiringAssertions() {
  const typeSource = readProjectFile('src', 'shared', 'types', 'design-team.types.ts');
  assert(typeSource.includes("'model_dispatch_trace'"), 'design team message type must include model_dispatch_trace');

  const workspaceSource = readProjectFile('src', 'renderer', 'services', 'design-teams', 'workspace.ts');
  assert(
    workspaceSource.includes("model_dispatch_trace: '模型调度'"),
    'team workspace digest should label model_dispatch_trace as 模型调度'
  );

  const coordinatorSource = readProjectFile('src', 'renderer', 'services', 'design-teams', 'coordinator.ts');
  assert(
    coordinatorSource.includes('buildMultimodalModelDispatchPlan') &&
      coordinatorSource.includes('formatModelDispatchTrace') &&
      coordinatorSource.includes("outputType: 'model_dispatch_trace'"),
    'design team coordinator must record model dispatch trace before teammate calls'
  );

  const autonomousSource = readProjectFile('src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts');
  assert(
      autonomousSource.includes('buildMultimodalModelDispatchPlan') &&
      autonomousSource.includes('formatPrimaryAgentDispatchPromptSection') &&
      autonomousSource.includes("const primaryTaskType: ConversationTaskType = 'logic'") &&
      autonomousSource.includes('const visualExpertModelId = resolveVisualExpertModelId()') &&
      autonomousSource.includes('visualExpertModelId,') &&
      autonomousSource.includes('resolveAgentModelTransport') &&
      autonomousSource.includes("transport === 'plain_chat'") &&
      autonomousSource.includes('toPlainModelMessages(messages)'),
    'autonomous agent must use shared multimodal model dispatch contract'
  );
  assert(
    autonomousSource.includes("prefs?.primaryModel")
      && autonomousSource.includes("prefs?.visualModel")
      && autonomousSource.includes('isConversationModelConfig(model)')
      && !autonomousSource.includes('【布局分析/主逻辑】能力槽'),
    'autonomous model entry must read the configured main/visual roles directly, reject non-conversation models, and keep legacy slot wording out of user replies'
  );

  const agentSource = readProjectFile('src', 'renderer', 'services', 'agent-runtime', 'agent.ts');
  assert(
    agentSource.includes('attachInitialImageEvidence') &&
      agentSource.includes('VISUAL_EXPERT_INPUT_PROMPT') &&
      agentSource.includes('primaryModelSupportsVision ? images : undefined'),
    'text-only primary agent must delegate initial image perception to the configured visual model'
  );

  const settingsSource = readProjectFile('src', 'renderer', 'components', 'SettingsModal.tsx');
  assert(
    settingsSource.includes('value={localPrefs.primaryModel}') &&
      settingsSource.includes('value={localPrefs.visualModel}') &&
      settingsSource.includes('[localPrefs.primaryModel, localPrefs.visualModel]'),
    'settings must expose both model roles and account for both providers when checking API keys'
  );
  assert(
    settingsSource.includes('isConversationModelConfig')
      && settingsSource.includes('.filter(m => m.conversation)')
      && settingsSource.includes('隔离 ${merged.newNonConversationModelIds.length} 个非对话模型'),
    'settings must exclude image-generation and other non-conversation models from both role selectors'
  );
  const chatPanelSource = readProjectFile('src', 'renderer', 'components', 'ChatPanel.tsx');
  for (const suffix of [' · 可读图', ' · 对话能力待确认', ' · 非对话模型', ' · 能力未确认']) {
    assert(!settingsSource.includes(suffix), `settings model option labels must not append ${suffix}`);
    assert(!chatPanelSource.includes(suffix), `chat model option labels must not append ${suffix}`);
  }
  assert(
    !settingsSource.includes('当前模型不支持工具调用，可用于普通对话，但不能独立执行 Photoshop 任务。'),
    'settings must not render the removed primary-model Tool capability warning'
  );

  const dispatchSource = readProjectFile('src', 'shared', 'multimodal-model-dispatch.ts');
  assert(
    dispatchSource.includes('isConversationModelConfig(model)'),
    'multimodal runtime dispatch must reject non-conversation models even when explicitly configured'
  );
}

runPlanAssertions();
runSourceWiringAssertions();

console.log(JSON.stringify({
    ok: true,
  checked: [
    'primary-visual-role-composition',
    'primary-model-migration',
    'primary-agent-routing',
    'teammate-role-routing',
    'structured-context-policy',
    'handoff-boundary',
    'workspace-dispatch-trace',
    'autonomous-agent-dispatch-contract',
    'vision-only-model-plain-chat-path',
    'initial-image-visual-handoff',
    'settings-model-composition',
    'non-conversation-model-isolation'
  ]
}, null, 2));
