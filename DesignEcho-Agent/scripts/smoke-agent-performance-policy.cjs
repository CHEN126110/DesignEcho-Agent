#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');

const {
  buildAgentAcceptanceCaptureBudget,
  buildAgentContextWindowBudget,
  buildAgentPerformancePolicy,
  buildAgentProviderTokenBudget,
  buildAgentResourceCacheBudget,
  buildAutonomousAgentRuntimeBudget,
  buildDesignTeamRuntimeBudget
} = require('../src/shared/agent-performance-policy.ts');
const {
  buildProjectVisualSamplingBudget
} = require('../src/shared/project-visual-sampling.ts');
const {
  buildAgentRequestLifecycle
} = require('../src/shared/agent-request-lifecycle.ts');
const {
  planDesignTask
} = require('../src/shared/design-planner.ts');
const {
  OpenAIAdapter
} = require('../src/main/services/provider-adapters/openai-adapter.ts');
const {
  AnthropicAdapter
} = require('../src/main/services/provider-adapters/anthropic-adapter.ts');
const {
  GeminiAdapter
} = require('../src/main/services/provider-adapters/gemini-adapter.ts');
const {
  OllamaAdapter
} = require('../src/main/services/provider-adapters/ollama-adapter.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const signals = [String.fromCodePoint(0x9359), String.fromCodePoint(0x7487), '\ufffd'];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function buildFixtureMessages() {
  return [{ role: 'user', content: 'hello' }];
}

function buildFixtureTools() {
  return [];
}

function buildToolFixture() {
  return [{
    name: 'getDocumentInfo',
    description: 'Read current Photoshop document metadata.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }];
}

function run() {
  const chat = buildAgentPerformancePolicy({
    userText: '你好，你是什么模型？',
    scenario: 'unknown',
    action: 'chat',
    requiresPhotoshop: false
  });
  assert(chat.taskClass === 'chat', `chat task class expected: ${JSON.stringify(chat)}`);
  assert(chat.budget.maxToolCalls === 0, `chat should not reserve tool calls: ${JSON.stringify(chat.budget)}`);
  assert(chat.controls.allowFullResolutionImageRead === false, 'chat must not allow full resolution image read');

  const layerOrder = buildAgentPerformancePolicy({
    userText: '把图层颜色从浅到深，从上到下排序',
    skillId: 'layer-management',
    scenario: 'general-design',
    action: 'edit',
    requiresPhotoshop: true
  });
  assert(layerOrder.taskClass === 'layer-management', `layer task class expected: ${JSON.stringify(layerOrder)}`);
  assert(layerOrder.budget.maxModelCalls === 6, `simple layer operation should allow read-write-readback rounds: ${JSON.stringify(layerOrder.budget)}`);
  assert(layerOrder.budget.softTimeBudgetMs === 240000, `simple layer operation should not starve before first write: ${JSON.stringify(layerOrder.budget)}`);
  assert(layerOrder.budget.maxVisionCandidates === 0, `simple layer operation should not use vision candidates: ${JSON.stringify(layerOrder.budget)}`);
  assert(layerOrder.verificationTier === 'bounds', `layer operation should require bounds verification: ${JSON.stringify(layerOrder)}`);

  const detail = buildAgentPerformancePolicy({
    userText: '帮我从项目素材里做一个详情页',
    skillId: 'detail-page-design',
    scenario: 'detail-page',
    action: 'create',
    requiresPhotoshop: true,
    projectImageCount: 118,
    visualSamplingCandidateCount: 12
  });
  assert(detail.taskClass === 'skill-workflow', `Skill workflow class expected: ${JSON.stringify(detail)}`);
  assert(detail.profileSource.owner === 'skill-manifest', `detail-page policy should be owned by its manifest: ${JSON.stringify(detail.profileSource)}`);
  assert(detail.profileSource.ref.startsWith('ecommerce.detail_page@'), `detail-page manifest ref expected: ${JSON.stringify(detail.profileSource)}`);
  assert(detail.budget.maxToolCalls === 140, `detail-page budget should come from manifest: ${JSON.stringify(detail.budget)}`);
  assert(detail.budget.maxVisionCandidates <= 6, `detail-page vision candidates should be capped: ${JSON.stringify(detail.budget)}`);
  assert(detail.controls.allowBulkProjectScan === false, 'bulk project scan must be disabled');
  assert(detail.controls.requireContextSnapshotBeforeExecution === true, 'business design tasks should require ContextSnapshot');
  assert(detail.warnings.some((item) => item.includes('项目图片数量')), `large project warning expected: ${JSON.stringify(detail.warnings)}`);

  const detailCopyEditWithoutMode = buildAgentPerformancePolicy({
    userText: '帮我改第三屏文案',
    taskType: 'ecommerce.detail_page.v1',
    scenario: 'copywriting',
    action: 'edit',
    requiresPhotoshop: true
  });
  assert(detailCopyEditWithoutMode.taskClass === 'skill-workflow', `selected business manifest must outrank local text-edit signals: ${JSON.stringify(detailCopyEditWithoutMode)}`);
  assert(detailCopyEditWithoutMode.budget.maxToolCalls === 140, `text alone must not infer the scoped-edit mode: ${JSON.stringify(detailCopyEditWithoutMode.budget)}`);

  const detailCopyEdit = buildAgentPerformancePolicy({
    userText: '帮我改第三屏文案',
    taskType: 'ecommerce.detail_page.v1',
    workMode: 'edit_existing',
    scenario: 'copywriting',
    action: 'edit',
    requiresPhotoshop: true
  });
  assert(detailCopyEdit.budget.maxModelCalls === 16, `detail edit model budget should come from its work-mode profile: ${JSON.stringify(detailCopyEdit.budget)}`);
  assert(detailCopyEdit.budget.maxToolCalls === 30, `detail edit tool budget should stay scoped: ${JSON.stringify(detailCopyEdit.budget)}`);
  assert(detailCopyEdit.budget.softTimeBudgetMs === 360000, `detail edit time budget should stay scoped but not starve a slow model: ${JSON.stringify(detailCopyEdit.budget)}`);
  assert(detailCopyEdit.profileSource.ref.includes('#edit_existing'), `detail edit profile source should name the work mode: ${JSON.stringify(detailCopyEdit.profileSource)}`);

  const detailCopyEditWithInvalidMode = buildAgentPerformancePolicy({
    userText: '帮我改第三屏文案',
    taskType: 'ecommerce.detail_page.v1',
    workMode: 'bogus',
    scenario: 'copywriting',
    action: 'edit',
    requiresPhotoshop: true
  });
  assert(detailCopyEditWithInvalidMode.budget.maxToolCalls === 140, `invalid work mode must fall back to the manifest top profile instead of selecting a mode: ${JSON.stringify(detailCopyEditWithInvalidMode.budget)}`);
  assert(!detailCopyEditWithInvalidMode.profileSource.ref.includes('#bogus'), `invalid work mode must never mint a profile source identity: ${JSON.stringify(detailCopyEditWithInvalidMode.profileSource)}`);

  const composedReferenceDetail = buildAgentPerformancePolicy({
    userText: '参考这张图制作详情页',
    skillId: 'layout-replication',
    taskType: 'ecommerce.detail_page.v1',
    workMode: 'edit_existing',
    scenario: 'detail-page',
    action: 'edit',
    requiresPhotoshop: true
  });
  assert(composedReferenceDetail.taskClass === 'skill-workflow', `artifact + method should remain one Skill workflow budget: ${JSON.stringify(composedReferenceDetail)}`);
  assert(composedReferenceDetail.profileSource.ref.includes('ecommerce.detail_page@') && composedReferenceDetail.profileSource.ref.includes('#edit_existing'), `composed profile should include the artifact work-mode owner: ${JSON.stringify(composedReferenceDetail.profileSource)}`);
  assert(composedReferenceDetail.profileSource.ref.includes('design.reference_replication@'), `composed profile should include method owner: ${JSON.stringify(composedReferenceDetail.profileSource)}`);
  const composedMethodProfileRef = composedReferenceDetail.profileSource.ref
    .split('+')
    .find((item) => item.startsWith('design.reference_replication@'));
  assert(composedMethodProfileRef && !composedMethodProfileRef.includes('#'), `work mode must qualify only the artifact profile, never the method top profile: ${JSON.stringify(composedReferenceDetail.profileSource)}`);
  assert(composedReferenceDetail.budget.maxModelCalls === 24, `composed budget should merge the artifact mode profile with the method top profile: ${JSON.stringify(composedReferenceDetail.budget)}`);
  assert(composedReferenceDetail.budget.maxToolCalls === 100, `composed tool budget should use the stronger of artifact mode and method top profiles: ${JSON.stringify(composedReferenceDetail.budget)}`);
  assert(composedReferenceDetail.budget.maxIterations === 55, `composed iteration budget should use the stronger method profile: ${JSON.stringify(composedReferenceDetail.budget)}`);
  assert(composedReferenceDetail.budget.maxVisionCandidates === 4, `composed vision-candidate budget should use the stronger method profile: ${JSON.stringify(composedReferenceDetail.budget)}`);
  assert(composedReferenceDetail.budget.softTimeBudgetMs === 600000, `composed time budget should use the stronger method profile: ${JSON.stringify(composedReferenceDetail.budget)}`);
  assert(composedReferenceDetail.verificationTier === 'screenshot', `composed verification tier should retain the method requirement: ${JSON.stringify(composedReferenceDetail)}`);

  const conflictingIdentity = buildAgentPerformancePolicy({
    skillId: 'main-image-design',
    taskType: 'ecommerce.detail_page.v1',
    scenario: 'unknown',
    action: 'create',
    requiresPhotoshop: true
  });
  assert(conflictingIdentity.profileSource.owner === 'agent-core', `conflicting identities must not pick either business profile: ${JSON.stringify(conflictingIdentity.profileSource)}`);
  assert(conflictingIdentity.profileSource.ref === 'manifest-identity:conflict', `conflict source should be explicit: ${JSON.stringify(conflictingIdentity.profileSource)}`);
  assert(conflictingIdentity.warnings.some((item) => item.includes('身份冲突')), `conflicting identity warning expected: ${JSON.stringify(conflictingIdentity.warnings)}`);

  const mainImage = buildAgentPerformancePolicy({
    skillId: 'main-image-design',
    scenario: 'unknown',
    action: 'create',
    requiresPhotoshop: true
  });
  assert(mainImage.taskClass === 'skill-workflow', `main-image should use generic Skill workflow class: ${JSON.stringify(mainImage)}`);
  assert(mainImage.profileSource.ref.startsWith('ecommerce.main_image@'), `main-image manifest profile expected: ${JSON.stringify(mainImage.profileSource)}`);
  assert(mainImage.budget.maxToolCalls === 60, `main-image budget should come from manifest: ${JSON.stringify(mainImage.budget)}`);

  const skuBatch = buildAgentPerformancePolicy({
    skillId: 'sku-batch',
    scenario: 'unknown',
    action: 'create',
    requiresPhotoshop: true
  });
  assert(skuBatch.taskClass === 'skill-workflow', `SKU should use generic Skill workflow class: ${JSON.stringify(skuBatch)}`);
  assert(skuBatch.profileSource.ref.startsWith('ecommerce.sku_batch@'), `SKU manifest profile expected: ${JSON.stringify(skuBatch.profileSource)}`);
  assert(skuBatch.controls.allowVisionModel === false, `SKU batch vision policy should come from manifest: ${JSON.stringify(skuBatch.controls)}`);

  const scenarioWithoutSkill = buildAgentPerformancePolicy({
    scenario: 'detail-page',
    action: 'create',
    requiresPhotoshop: true
  });
  assert(scenarioWithoutSkill.profileSource.owner === 'agent-core', `scenario label alone must not select a business profile: ${JSON.stringify(scenarioWithoutSkill.profileSource)}`);
  assert(scenarioWithoutSkill.budget.maxToolCalls === 120, `scenario label alone must use the generic workflow fallback: ${JSON.stringify(scenarioWithoutSkill.budget)}`);

  const projectInventoryPolicy = buildAgentPerformancePolicy({
    userText: '你可以帮我看看这个项目都有什么',
    skillId: 'project-image-analysis',
    mode: 'inventory',
    skillParams: {
      analysisMode: 'inventory',
      sampleSize: 0,
      focus: 'inventory'
    },
    requiresPhotoshop: true,
    projectImageCount: 42,
    visualSamplingCandidateCount: 9
  });
  assert(projectInventoryPolicy.taskClass === 'project-inventory', `project inventory should use metadata-only class: ${JSON.stringify(projectInventoryPolicy)}`);
  assert(projectInventoryPolicy.budget.maxVisionCandidates === 0, `project inventory must not reserve visual candidates: ${JSON.stringify(projectInventoryPolicy.budget)}`);
  assert(projectInventoryPolicy.controls.preferMetadataOnly === true, `project inventory should prefer metadata-only path: ${JSON.stringify(projectInventoryPolicy.controls)}`);
  assert(projectInventoryPolicy.costProfile.imageProcessingClass === 'metadata-only', `project inventory should be metadata-only: ${JSON.stringify(projectInventoryPolicy.costProfile)}`);

  const projectContentPolicy = buildAgentPerformancePolicy({
    userText: '你能看看这些图片是什么并总结一下内容吗',
    skillId: 'project-image-analysis',
    mode: 'content',
    skillParams: {
      analysisMode: 'content',
      sampleSize: 4,
      focus: 'content'
    },
    requiresPhotoshop: true,
    projectImageCount: 42,
    visualSamplingCandidateCount: 9
  });
  assert(projectContentPolicy.taskClass === 'project-analysis', `project content analysis should use bounded vision class: ${JSON.stringify(projectContentPolicy)}`);
  assert(projectContentPolicy.budget.maxVisionCandidates === 4, `project content analysis should cap visual candidates: ${JSON.stringify(projectContentPolicy.budget)}`);
  assert(projectContentPolicy.controls.allowVisionModel === true, `project content analysis should allow bounded vision: ${JSON.stringify(projectContentPolicy.controls)}`);

  const inventoryLifecycle = buildAgentRequestLifecycle({
    userInput: '你可以帮我看看这个项目都有什么',
    context: {
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: 'fixture.psd',
        layerCount: 8
      },
      projectContext: {
        projectPath: 'C:/fixture/project',
        projectImageCount: 42,
        contextSnapshot: { snapshotVersion: 'fixture' },
        contextSnapshotSource: 'runtime-project-service',
        visualSamplingCandidateCount: 9
      }
    },
    routeSource: 'deterministic_route',
    route: 'skill_execution',
    skillId: 'project-image-analysis',
    mode: 'inventory',
    skillParams: {
      analysisMode: 'inventory',
      sampleSize: 0,
      focus: 'inventory'
    },
    reason: 'fixture'
  });
  assert(inventoryLifecycle.performancePolicy.taskClass === 'project-inventory', `lifecycle should expose project-inventory policy: ${JSON.stringify(inventoryLifecycle.performancePolicy)}`);
  assert(inventoryLifecycle.resourceDecision.path === 'metadata-only', `lifecycle should expose metadata-only resource decision: ${JSON.stringify(inventoryLifecycle.resourceDecision)}`);
  assert(inventoryLifecycle.resourceDecision.maxVisualAnalyses === 0, `inventory lifecycle must block visual analysis budget: ${JSON.stringify(inventoryLifecycle.resourceDecision)}`);

  const defaultRuntimeBudget = buildAutonomousAgentRuntimeBudget();
  assert(defaultRuntimeBudget.maxIterations === 25, `legacy autonomous-agent default should stay 25: ${JSON.stringify(defaultRuntimeBudget)}`);
  assert(defaultRuntimeBudget.source === 'legacy-autonomous-agent-default', `legacy source expected: ${JSON.stringify(defaultRuntimeBudget)}`);

  const explicitRuntimeBudget = buildAutonomousAgentRuntimeBudget({ requestedMaxIterations: 7 });
  assert(explicitRuntimeBudget.maxIterations === 7, `explicit runtime budget should be preserved: ${JSON.stringify(explicitRuntimeBudget)}`);
  assert(explicitRuntimeBudget.source === 'explicit-user-parameter', `explicit source expected: ${JSON.stringify(explicitRuntimeBudget)}`);

  const sceneTeamBudget = buildDesignTeamRuntimeBudget({ role: 'scene-analyst' });
  assert(sceneTeamBudget.maxIterations === 8, `scene-analyst default should stay 8: ${JSON.stringify(sceneTeamBudget)}`);
  assert(sceneTeamBudget.source === 'teammate-role-default', `scene default source expected: ${JSON.stringify(sceneTeamBudget)}`);

  const executorTeamBudget = buildDesignTeamRuntimeBudget({ role: 'executor' });
  assert(executorTeamBudget.maxIterations === 12, `executor default should stay 12: ${JSON.stringify(executorTeamBudget)}`);

  const explicitTeamBudget = buildDesignTeamRuntimeBudget({ role: 'critic', requestedMaxIterations: 5 });
  assert(explicitTeamBudget.maxIterations === 5, `explicit design-team budget should be preserved: ${JSON.stringify(explicitTeamBudget)}`);

  const invalidTeamBudget = buildDesignTeamRuntimeBudget({ role: 'critic', requestedMaxIterations: 0 });
  assert(invalidTeamBudget.maxIterations === 8, `invalid explicit design-team budget should fall back to role default: ${JSON.stringify(invalidTeamBudget)}`);

  const defaultContextBudget = buildAgentContextWindowBudget();
  assert(defaultContextBudget.maxTokens === 100000, `context maxTokens should stay 100000: ${JSON.stringify(defaultContextBudget)}`);
  assert(defaultContextBudget.keepRecentRounds === 6, `context keepRecentRounds should stay 6: ${JSON.stringify(defaultContextBudget)}`);

  const explicitContextBudget = buildAgentContextWindowBudget({
    requestedMaxTokens: 12000,
    requestedKeepRecentRounds: 4
  });
  assert(explicitContextBudget.maxTokens === 12000, `explicit context maxTokens should be preserved: ${JSON.stringify(explicitContextBudget)}`);
  assert(explicitContextBudget.keepRecentRounds === 4, `explicit context keepRecentRounds should be preserved: ${JSON.stringify(explicitContextBudget)}`);

  const defaultResourceCacheBudget = buildAgentResourceCacheBudget();
  assert(defaultResourceCacheBudget.resourceScanCacheTtlMs === 30000, `resource scan cache TTL should stay 30000: ${JSON.stringify(defaultResourceCacheBudget)}`);
  assert(defaultResourceCacheBudget.psdPreviewCacheTtlMs === 300000, `PSD preview cache TTL should stay 300000: ${JSON.stringify(defaultResourceCacheBudget)}`);

  const defaultProviderBudget = buildAgentProviderTokenBudget();
  assert(defaultProviderBudget.maxTokens === 4096, `provider default maxTokens should stay 4096: ${JSON.stringify(defaultProviderBudget)}`);
  assert(defaultProviderBudget.source === 'legacy-provider-default', `provider default source expected: ${JSON.stringify(defaultProviderBudget)}`);

  const explicitProviderBudget = buildAgentProviderTokenBudget({ requestedMaxTokens: 1234 });
  assert(explicitProviderBudget.maxTokens === 1234, `explicit provider maxTokens should be preserved: ${JSON.stringify(explicitProviderBudget)}`);
  assert(explicitProviderBudget.source === 'explicit-user-parameter', `explicit provider source expected: ${JSON.stringify(explicitProviderBudget)}`);

  const zeroProviderBudget = buildAgentProviderTokenBudget({ requestedMaxTokens: 0 });
  assert(zeroProviderBudget.maxTokens === 4096, `zero provider maxTokens should preserve legacy fallback: ${JSON.stringify(zeroProviderBudget)}`);

  const customLegacyProviderBudget = buildAgentProviderTokenBudget({ legacyDefaultMaxTokens: 8192 });
  assert(customLegacyProviderBudget.maxTokens === 8192, `custom legacy provider fallback should be preserved: ${JSON.stringify(customLegacyProviderBudget)}`);

  const fixtureMessages = buildFixtureMessages();
  const fixtureTools = buildFixtureTools();
  const promptBasedOllamaNoTools = new OllamaAdapter('unknown-model').formatMessages(fixtureMessages, fixtureTools);
  const promptBasedOllamaWithTools = new OllamaAdapter('unknown-model').formatMessages(fixtureMessages, buildToolFixture());
  assert(new OpenAIAdapter().formatMessages(fixtureMessages, fixtureTools).max_tokens === 4096, 'OpenAI adapter default max_tokens should stay 4096');
  assert(new OpenAIAdapter().formatMessages(fixtureMessages, fixtureTools, { maxTokens: 321 }).max_tokens === 321, 'OpenAI adapter explicit max_tokens should be preserved');
  assert(new AnthropicAdapter().formatMessages(fixtureMessages, fixtureTools).max_tokens === 4096, 'Anthropic adapter default max_tokens should stay 4096');
  assert(new GeminiAdapter().formatMessages(fixtureMessages, fixtureTools).generationConfig.maxOutputTokens === 4096, 'Gemini adapter default maxOutputTokens should stay 4096');
  assert(new OllamaAdapter('qwen2.5').formatMessages(fixtureMessages, fixtureTools).options.num_predict === 4096, 'Ollama native default num_predict should stay 4096');
  assert(promptBasedOllamaNoTools.options.num_predict === 4096, 'Ollama prompt fallback default num_predict should stay 4096');
  assert(!JSON.stringify(promptBasedOllamaNoTools.messages).includes('<tool_call>'), 'Ollama prompt fallback must not inject XML tool prompt when no tools are available');
  assert(JSON.stringify(promptBasedOllamaWithTools.messages).includes('<tool_call>'), 'Ollama prompt fallback must keep XML tool prompt when tools are available');

  const modelServiceSource = fs.readFileSync('src/main/services/model-service.ts', 'utf8');
  const streamAdapterSource = fs.readFileSync('src/main/services/stream-adapter.ts', 'utf8');
  const agentRuntimeSource = fs.readFileSync('src/renderer/services/agent-runtime/agent.ts', 'utf8');
  const contextManagerSource = fs.readFileSync('src/renderer/services/agent-runtime/context-manager.ts', 'utf8');
  const resourceManagerSource = fs.readFileSync('src/main/services/resource-manager-service.ts', 'utf8');
  assert(modelServiceSource.includes('buildAgentProviderTokenBudget'), 'ModelService should import provider token budget helper');
  assert(streamAdapterSource.includes('buildAgentProviderTokenBudget'), 'stream-adapter should import provider token budget helper');
  assert(!/options\?\.maxTokens\s*\|\|\s*4096/.test(modelServiceSource), 'ModelService should not keep direct maxTokens || 4096 fallbacks');
  assert(!/options\?\.maxTokens\s*\|\|\s*4096/.test(streamAdapterSource), 'stream-adapter should not keep direct maxTokens || 4096 fallbacks');
  assert(contextManagerSource.includes('buildAgentContextWindowBudget'), 'ContextManager should import context window budget helper');
  assert(!/maxTokens:\s*100000/.test(agentRuntimeSource), 'Agent runtime should not pass direct ContextManager maxTokens=100000');
  assert(resourceManagerSource.includes('buildAgentResourceCacheBudget'), 'ResourceManager should import resource cache budget helper');
  assert(!/cacheExpiry:\s*number\s*=\s*30000/.test(resourceManagerSource), 'ResourceManager should not keep direct resource scan cache TTL');
  assert(!/psdCacheExpiry:\s*number\s*=\s*300000/.test(resourceManagerSource), 'ResourceManager should not keep direct PSD cache TTL');

  const standardAcceptanceBudget = buildAgentAcceptanceCaptureBudget();
  assert(standardAcceptanceBudget.maxLayers === 350, `standard acceptance maxLayers should stay 350: ${JSON.stringify(standardAcceptanceBudget)}`);
  assert(standardAcceptanceBudget.timeoutMs === 12000, `standard acceptance timeout should stay 12000: ${JSON.stringify(standardAcceptanceBudget)}`);
  assert(standardAcceptanceBudget.maxChangedLayers === 50, `acceptance diff changed layer limit should stay 50: ${JSON.stringify(standardAcceptanceBudget)}`);

  const bulkAcceptanceBudget = buildAgentAcceptanceCaptureBudget({ bulk: true });
  assert(bulkAcceptanceBudget.maxLayers === 700, `bulk acceptance maxLayers should stay 700: ${JSON.stringify(bulkAcceptanceBudget)}`);
  assert(bulkAcceptanceBudget.timeoutMs === 22000, `bulk acceptance timeout should stay 22000: ${JSON.stringify(bulkAcceptanceBudget)}`);

  const deepAcceptanceBudget = buildAgentAcceptanceCaptureBudget({ deep: true, bulk: true });
  assert(deepAcceptanceBudget.maxLayers === 1000, `deep acceptance maxLayers should stay 1000: ${JSON.stringify(deepAcceptanceBudget)}`);
  assert(deepAcceptanceBudget.timeoutMs === 30000, `deep acceptance timeout should stay 30000: ${JSON.stringify(deepAcceptanceBudget)}`);
  assert(deepAcceptanceBudget.mode === 'deep', `deep acceptance should take priority over bulk: ${JSON.stringify(deepAcceptanceBudget)}`);

  const mainImageVisualBudget = buildProjectVisualSamplingBudget({ scenario: 'main-image' });
  assert(mainImageVisualBudget.maxCandidates === 4, `main image visual default should stay 4: ${JSON.stringify(mainImageVisualBudget)}`);
  assert(mainImageVisualBudget.hardCap === 8, `visual sampling hard cap should stay 8: ${JSON.stringify(mainImageVisualBudget)}`);

  const detailVisualBudget = buildProjectVisualSamplingBudget({ scenario: 'detail-page' });
  assert(detailVisualBudget.maxCandidates === 6, `detail-page visual default should stay 6: ${JSON.stringify(detailVisualBudget)}`);

  const referenceVisualBudget = buildProjectVisualSamplingBudget({ scenario: 'reference-replication' });
  assert(referenceVisualBudget.maxCandidates === 2, `reference visual default should stay 2: ${JSON.stringify(referenceVisualBudget)}`);

  const cappedVisualBudget = buildProjectVisualSamplingBudget({ scenario: 'detail-page', requestedMaxCandidates: 99 });
  assert(cappedVisualBudget.maxCandidates === 8, `requested visual candidates should stay capped at 8: ${JSON.stringify(cappedVisualBudget)}`);

  const referencePlanner = planDesignTask({
    userText: '照着参考图复刻一个海报',
    attachments: [{ kind: 'reference-image', name: 'poster.png', width: 800, height: 800 }],
    currentDocument: { id: 1, name: 'poster.psd', width: 800, height: 800 },
    projectContext: {
      assets: [{ name: 'asset.jpg', path: 'C:/fixture/asset.jpg' }],
      visualSamplingPlan: {
        planVersion: 'project-visual-sampling/v0',
        scenario: 'reference-replication',
        mode: 'bounded-metadata-plan',
        maxCandidates: 4,
        selectedCandidates: [
          {
            assetId: 'a1',
            path: 'C:/fixture/asset.jpg',
            relativePath: 'asset.jpg',
            name: 'asset.jpg',
            role: 'source',
            score: 1,
            reasons: ['fixture'],
            cacheStatus: 'miss',
            shouldAnalyze: true,
            requiredObservations: [],
            selectionNotes: []
          }
        ],
        cacheSummary: { hit: 0, miss: 1, stale: 0, shouldAnalyze: 1 },
        warnings: [],
        limitations: ['fixture plan'],
        sourceRecords: []
      }
    }
  });
  assert(referencePlanner.performancePolicy, `planner should expose performancePolicy: ${JSON.stringify(referencePlanner)}`);
  assert(referencePlanner.selectedContext.performancePolicy, `selectedContext should summarize policy: ${JSON.stringify(referencePlanner.selectedContext)}`);
  assert(referencePlanner.performancePolicy.controls.allowFullResolutionImageRead === false, 'planner policy should not allow full resolution image read');
  assert(referencePlanner.limits.some((item) => item.includes('性能策略')), `planner limits should include performance boundary: ${JSON.stringify(referencePlanner.limits)}`);

  assertNoMojibake({ chat, layerOrder, detail, referencePlanner }, 'agent performance policy');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'chat keeps zero Photoshop tool budget',
      'simple layer operation keeps low model and zero vision budget',
      'detail-page caps visual candidates and requires ContextSnapshot',
      'selected Skill manifest outranks local text-edit signals',
      'artifact and method manifests compose while conflicting artifact identities stay fail-closed',
      'project inventory stays metadata-only and forbids visual analysis',
      'project content analysis stays bounded-vision with capped candidates',
      'request lifecycle exposes performance policy and resource decision',
      'autonomous-agent legacy runtime maxIterations is centralized without behavior change',
      'design-team role runtime budgets are centralized without changing legacy limits',
      'context window budgets are centralized without changing legacy limits',
      'resource cache budgets are centralized without changing legacy limits',
      'provider adapter max token defaults are centralized without changing legacy limits',
      'model-service and stream-adapter token defaults are centralized without changing legacy limits',
      'acceptance capture budgets are centralized without changing legacy limits',
      'visual sampling candidate budgets are centralized without changing legacy limits',
      'planner exposes read-only performancePolicy without changing execution steps',
      'policy forbids bulk project scans and full resolution image reads by default'
    ]
  }, null, 2));
}

run();
