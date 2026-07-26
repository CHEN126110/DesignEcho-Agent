#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  detectConversationTaskType,
  resolveConversationTaskTypeForModelPurpose,
  getModelPriorityForConversationTask,
  getModelRecoveryPriorityForConversationTask,
  isVisionCapableModelId,
  isToolCapableModelId
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'model-selection.ts'));
const {
  DEFAULT_MODEL_PREFERENCES,
  normalizeModelPreferences,
  resolvePrimaryModelForPreferences,
  resolveVisualModelForPreferences
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts'));
const {
  clearDynamicModels,
  setDynamicModels
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'dynamic-model-registry.ts'));

const repoRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  path.join(repoRoot, 'src', 'shared', 'model-selection.ts'),
  path.join(repoRoot, 'src', 'renderer', 'hooks', 'useChatActions.ts'),
  path.join(repoRoot, 'src', 'renderer', 'components', 'ChatPanel.tsx')
];

const forbiddenFragments = [
  0x9352,
  0x93C2,
  0x7459,
  0x93B6,
  0x95AB,
  0x923F,
  0x93C8,
  0xFFFD
].map((codePoint) => String.fromCodePoint(codePoint));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function noMojibakeInModelSelectionSources() {
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const fragment of forbiddenFragments) {
      assert(!content.includes(fragment), `${path.relative(repoRoot, file)} contains mojibake fragment: ${fragment}`);
    }
  }
}

function assertChatPanelProviderFailureRouting() {
  const chatPanel = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'components', 'ChatPanel.tsx'), 'utf8');
  assert(
    chatPanel.includes('getModelRecoveryPriorityForConversationTask') &&
      chatPanel.includes('getLiveRecoveryPriorityForTask'),
    'ChatPanel callModel must keep a recovery model queue mechanism for provider failure cases'
  );
  // 自动降级关闭时「只使用用户设置的模型」：recovery 队列必须受 autoFallback 门控，
  // 不再无条件并入（否则会静默尝试用户没在能力槽配过的 configured-cloud-backups，如 gptsapi）。
  assert(
    chatPanel.includes('const autoFallbackEnabled = latestModelPreferences?.autoFallback === true') &&
      /autoFallbackEnabled\s*\?\s*getLiveRecoveryPriorityForTask\([^)]*\)\s*:\s*\[\]/.test(chatPanel) &&
      chatPanel.includes('...getRecoveryForTaskWhenAllowed'),
    'ChatPanel must gate the recovery queue behind autoFallback: recovery models are only merged when autoFallback is enabled, and only user-configured models are tried when it is disabled'
  );
  assert(
    chatPanel.includes('function extractModelCallFailureMessage') &&
      chatPanel.includes('function looksLikeProviderFailureText') &&
      chatPanel.includes('success === false') &&
      chatPanel.includes('payload.error'),
    'ChatPanel must classify explicit provider failure responses before accepting model text'
  );
  assert(
    chatPanel.includes('const streamedFailure = extractModelCallFailureMessage') &&
      chatPanel.includes('const fallbackFailure = extractModelCallFailureMessage') &&
      chatPanel.includes('const responseFailure = extractModelCallFailureMessage'),
    'ChatPanel must run provider failure classification on stream, fallback, and direct model responses'
  );
  assert(
    /if \(fallbackFailure\) \{[\s\S]*recordModelFailure\(modelId, fallbackFailure\);[\s\S]*continue;[\s\S]*\}/.test(chatPanel) &&
      /if \(responseFailure\) \{[\s\S]*recordModelFailure\(modelId, responseFailure\);[\s\S]*continue;[\s\S]*\}/.test(chatPanel),
    'ChatPanel must continue to the next model when a provider failure response is returned as text'
  );
  assert(
    /text\.length > 1200/.test(chatPanel),
    'Provider failure text classifier must be bounded so normal long model replies are not treated as provider failures'
  );
}

function run() {
  assert(
    DEFAULT_MODEL_PREFERENCES.autoFallback === false,
    'default model preferences must keep automatic cross-provider fallback disabled'
  );

  const cases = [
    {
      input: '\u5e2e\u6211\u770b\u8fd9\u5f20\u53c2\u8003\u56fe\u5e76\u590d\u523b\u7248\u5f0f',
      hasImage: false,
      expected: 'visual'
    },
    {
      input: '\u5e2e\u6211\u751f\u6210\u4e09\u7248\u6807\u9898\u6587\u6848',
      hasImage: false,
      expected: 'copywriting'
    },
    {
      input: '\u5e2e\u6211\u628a\u8be6\u60c5\u9875\u6587\u6863\u4fdd\u5b58\u5230\u9879\u76ee\u7684PSD\u4e2d',
      hasImage: false,
      expected: 'logic'
    },
    {
      input: '\u4f60\u662f\u4ec0\u4e48\u6a21\u578b',
      hasImage: false,
      expected: 'general'
    },
    {
      input: '\u968f\u4fbf\u95ee\u5019\u4f46\u9644\u5e26\u56fe\u7247',
      hasImage: true,
      expected: 'visual'
    }
  ];

  for (const item of cases) {
    const actual = detectConversationTaskType(item.input, item.hasImage);
    assert(actual === item.expected, `${item.input} expected ${item.expected}, got ${actual}`);
  }

  assert(
    resolveConversationTaskTypeForModelPurpose({
      userInput: '请基于当前项目 E:\\DesignEchoDemo\\C-1194 的素材从零创建一个电商袜子详情页文档。请先读取项目素材并自己判断卖点和排版方向。',
      hasImage: false,
      purpose: 'agent_task_public_plan'
    }) === 'logic',
    'public plan generation must use the logic/planning model bucket, even for project-image design briefs'
  );
  assert(
    resolveConversationTaskTypeForModelPurpose({
      userInput: '继续处理刚才的详情页',
      hasImage: false,
      purpose: 'resume_planning'
    }) === 'logic',
    'resume planning must use the logic/planning model bucket'
  );
  assert(
    resolveConversationTaskTypeForModelPurpose({
      userInput: '帮我看这张参考图并复刻版式',
      hasImage: true,
      purpose: 'direct_response'
    }) === 'visual',
    'normal direct replies with images must still use the visual model bucket'
  );

  // ===== 两角色模型：主 Agent + 视觉专家 =====
  // 默认配置复用同一个全模态模型；用户可以把主模型换成高速纯文本模型，同时保留独立视觉模型。
  const visualPriority = getModelPriorityForConversationTask(
    DEFAULT_MODEL_PREFERENCES,
    'visual',
    { requireVision: true }
  );
  assert(
    JSON.stringify(visualPriority) === JSON.stringify(['xiaomi-mimo-v2.5']),
    'default visual task must use the configured visualModel'
  );

  const composedModelPreference = {
    ...DEFAULT_MODEL_PREFERENCES,
    mode: 'cloud',
    autoFallback: true,
    primaryModel: 'deepseek-v4-pro',
    visualModel: 'xiaomi-mimo-v2.5',
    preferredCloudModels: {
      layoutAnalysis: 'ollama-cloud-qwen3-next-80b',
      textOptimize: 'xiaomi-mimo-v2.5',
      visualAnalyze: 'google-gemini-3-flash'
    }
  };
  const syntheticProviderKey = (provider) => ['sk', `${provider}-valid-for-routing`].join('-');
  const singleModelApiKeys = {
    xiaomi: 'invalid-but-present',
    openrouter: syntheticProviderKey('or'),
    google: 'AIza-valid-for-routing',
    deepseek: syntheticProviderKey('deepseek'),
    gptsapi: syntheticProviderKey('gptsapi'),
    ollamaApiKey: 'ollama-valid-for-routing'
  };
  const composedModelByTask = {};
  for (const taskType of ['visual', 'logic', 'copywriting', 'general']) {
    const priority = getModelPriorityForConversationTask(
      composedModelPreference,
      taskType,
      { requireVision: taskType === 'visual', apiKeys: singleModelApiKeys }
    );
    composedModelByTask[taskType] = priority;
    const expectedModel = taskType === 'visual' ? 'xiaomi-mimo-v2.5' : 'deepseek-v4-pro';
    assert(
      JSON.stringify(priority) === JSON.stringify([expectedModel]),
      `${taskType} task must resolve to its configured main/visual role model`
    );
  }

  // 能力标记必须保持准确，且错误地把纯文本模型填入视觉角色时必须诚实筛空。
  assert(
    isVisionCapableModelId('deepseek-v4-pro') === false,
    'deepseek-v4-pro must stay marked text-only so upper layers arrange visual evidence differently'
  );
  assert(
    isVisionCapableModelId('xiaomi-mimo-v2.5') === true,
    'xiaomi-mimo-v2.5 must stay marked as vision-capable'
  );
  assert(
    isToolCapableModelId('deepseek-v4-pro') === true && isToolCapableModelId('gptsapi-gpt-5.4-pro') === false,
    'tool-capability marks must stay accurate for the single primaryModel to be reasoned about by upper layers'
  );
  const invalidVisualPreference = {
    ...composedModelPreference,
    visualModel: 'deepseek-v4-pro'
  };
  assert(
    getModelPriorityForConversationTask(invalidVisualPreference, 'visual', { requireVision: true }).length === 0,
    'text-only visualModel must fail closed instead of receiving images it cannot read'
  );

  // 即使旧配置或外部调用显式选择了图片生成模型，运行时也必须再次拒绝。
  const dynamicImageModel = {
    id: 'gptsapi-gpt-image-1',
    name: 'GPT Image 1',
    source: 'cloud',
    provider: 'gptsapi',
    requiredApiKey: 'gptsapi',
    apiModelId: 'gpt-image-1',
    roles: ['image-generation'],
    capabilities: ['image-generation'],
    usageKind: 'image-generation',
    usageConfidence: 'inferred',
    supportsVision: false,
    supportsToolUse: false,
    supportsStreaming: false,
    maxTokens: 8192
  };
  setDynamicModels([dynamicImageModel]);
  const invalidImageGeneratorPreference = {
    ...composedModelPreference,
    primaryModel: dynamicImageModel.id,
    visualModel: dynamicImageModel.id
  };
  assert(
    getModelPriorityForConversationTask(invalidImageGeneratorPreference, 'logic').length === 0
      && getModelPriorityForConversationTask(invalidImageGeneratorPreference, 'visual', { requireVision: true }).length === 0,
    'image-generation models must fail closed in both primary and visual conversation roles'
  );
  clearDynamicModels();

  // 普通选择仍保持单一主模型；显式 recovery 才展开已配置、能力兼容的备用候选。
  const primaryRecovery = getModelRecoveryPriorityForConversationTask(
    composedModelPreference,
    'logic',
    { apiKeys: singleModelApiKeys }
  );
  assert(
    primaryRecovery[0] === 'deepseek-v4-pro',
    'logic recovery must keep the configured primaryModel first'
  );
  assert(
    primaryRecovery.length > 1,
    `logic recovery must expose real backup candidates when fallback is enabled: ${JSON.stringify(primaryRecovery)}`
  );
  assert(
    primaryRecovery.includes('openrouter-claude-3.5-sonnet')
      && primaryRecovery.includes('google-gemini-3-flash'),
    `logic recovery must include configured role-compatible providers: ${JSON.stringify(primaryRecovery)}`
  );
  assert(
    new Set(primaryRecovery).size === primaryRecovery.length,
    `logic recovery must not contain duplicate model ids: ${JSON.stringify(primaryRecovery)}`
  );

  const visualRecovery = getModelRecoveryPriorityForConversationTask(
    composedModelPreference,
    'visual',
    { requireVision: true, apiKeys: singleModelApiKeys }
  );
  assert(
    visualRecovery[0] === 'xiaomi-mimo-v2.5'
      && visualRecovery.length > 1
      && visualRecovery.every(isVisionCapableModelId),
    `visual recovery must keep the visual role first and exclude text-only models: ${JSON.stringify(visualRecovery)}`
  );
  assert(
    !visualRecovery.includes('deepseek-v4-pro'),
    `visual recovery must not route images to the text-only primary model: ${JSON.stringify(visualRecovery)}`
  );

  const xiaomiOnlyRecovery = getModelRecoveryPriorityForConversationTask(
    composedModelPreference,
    'logic',
    { apiKeys: { xiaomi: 'invalid-but-present' } }
  );
  assert(
    !xiaomiOnlyRecovery.some((modelId) => (
      modelId.startsWith('openrouter-')
        || modelId.startsWith('google-')
        || modelId.startsWith('gptsapi-')
        || modelId.startsWith('ollama-cloud-')
    )),
    `recovery must not advertise backup providers without configured API keys: ${JSON.stringify(xiaomiOnlyRecovery)}`
  );

  // 迁移：老配置缺两个新角色字段时，保留旧主模型迁移口径并初始化独立视觉模型。
  const staleWithoutPrimary = {
    mode: 'cloud',
    autoFallback: true,
    preferredLocalModels: {
      layoutAnalysis: 'local-deepseek-coder-v2-16b',
      textOptimize: 'local-qwen2.5-14b',
      visualAnalyze: 'local-llava-7b'
    },
    preferredCloudModels: {
      layoutAnalysis: 'deepseek-v4-pro',
      textOptimize: 'gptsapi-gpt-5.4-pro',
      visualAnalyze: 'google-gemini-3-flash'
    },
    thinking: { enabled: true }
  };
  const staleMigratedPrimary = resolvePrimaryModelForPreferences({
    primaryModel: undefined,
    mode: 'cloud',
    preferredLocalModels: staleWithoutPrimary.preferredLocalModels,
    preferredCloudModels: staleWithoutPrimary.preferredCloudModels
  });
  assert(
    staleMigratedPrimary === 'google-gemini-3-flash',
    'stale cloud preference without primaryModel must migrate the primary model from the visual slot'
  );
  const staleMigratedVisual = resolveVisualModelForPreferences({
    visualModel: undefined,
    primaryModel: staleMigratedPrimary,
    mode: 'cloud',
    preferredLocalModels: staleWithoutPrimary.preferredLocalModels,
    preferredCloudModels: staleWithoutPrimary.preferredCloudModels
  });
  assert(
    staleMigratedVisual === 'google-gemini-3-flash',
    'stale preference must initialize visualModel from the vision-capable migrated primary model'
  );
  const normalizedComposed = normalizeModelPreferences({
    ...staleWithoutPrimary,
    primaryModel: 'deepseek-v4-pro'
  });
  assert(
    normalizedComposed.primaryModel === 'deepseek-v4-pro'
      && normalizedComposed.visualModel === 'google-gemini-3-flash',
    'text-only primary model migration must preserve the old visual slot as independent visualModel'
  );
  const staleLogicPriority = getModelPriorityForConversationTask(
    staleWithoutPrimary,
    'logic',
    { apiKeys: singleModelApiKeys }
  );
  assert(
    JSON.stringify(staleLogicPriority) === JSON.stringify(['google-gemini-3-flash']),
    'migrated stale preference must resolve every task (even logic) to the single migrated primaryModel, not the logic slot'
  );

  noMojibakeInModelSelectionSources();
  assertChatPanelProviderFailureRouting();

  const report = {
    success: true,
    cases: cases.map((item) => ({
      expected: item.expected,
      actual: detectConversationTaskType(item.input, item.hasImage)
    })),
    publicPlanTaskType: resolveConversationTaskTypeForModelPurpose({
      userInput: '请基于当前项目 E:\\DesignEchoDemo\\C-1194 的素材从零创建一个电商袜子详情页文档。',
      hasImage: false,
      purpose: 'agent_task_public_plan'
    }),
    visualPriority,
    composedModelByTask,
    primaryRecovery,
    visualRecovery,
    xiaomiOnlyRecovery,
    staleMigratedPrimary,
    staleMigratedVisual,
    staleLogicPriority
  };
  const outPath = path.join(repoRoot, 'tmp', 'model-selection-routing-smoke.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[smoke-model-selection-routing] ok -> ${outPath}`);
}

run();
