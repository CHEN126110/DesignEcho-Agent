#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const fs = require('fs');
const repoRoot = path.resolve(__dirname, '..');

const memoryServiceModule = require('../src/renderer/services/memory.service.ts');
const MemoryService = memoryServiceModule.default;
const { getMemoryService } = memoryServiceModule;
const {
  createDesignLearningRuntimeOrchestratorApi,
  runDesignLearningRuntimeOrchestrator
} = require('../src/renderer/services/design-learning-runtime-orchestrator.service.ts');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createLocalStorageMock() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    dump() {
      return Object.fromEntries(data.entries());
    }
  };
}

function assertNoUnsafePayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    'data:image',
    'raw-image-payload',
    'base64-image-payload',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"',
    '"pixels"',
    '"confidence"',
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payloads, score markers or local paths: ${found.join(', ')}`, value);
}

async function run() {
  global.localStorage = createLocalStorageMock();

  const memoryService = new MemoryService();
  const singletonMemoryService = getMemoryService();
  const originalListPersistedDesignMemoryItems = singletonMemoryService.listPersistedDesignMemoryItems;
  let singletonListCalls = 0;
  singletonMemoryService.listPersistedDesignMemoryItems = function listPersistedDesignMemoryItems(options) {
    singletonListCalls += 1;
    return originalListPersistedDesignMemoryItems.call(this, options);
  };
  const defaultMemoryRun = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'app_start',
    now: '2026-06-01T07:55:00.000Z',
    cadence: 'daily',
    preferredTopics: ['默认单例边界'],
    maxReferences: 1
  });
  singletonMemoryService.listPersistedDesignMemoryItems = originalListPersistedDesignMemoryItems;
  assert(
    defaultMemoryRun.boundaries.appStartDoesNotAutoRunByDefault === true,
    'production default should preserve the app-start no-heavy-learning boundary',
    defaultMemoryRun
  );
  assert(singletonListCalls > 0, 'production default should reuse getMemoryService singleton');

  const calls = [];
  const api = {
    searchEagleReadonlyKnowledge: async (query) => {
      calls.push(`eagle:${query.query}:${query.limit}`);
      return {
        version: 'eagle-readonly-knowledge/v0',
        status: 'ok',
        query: query.query,
        results: [{
          id: 'eagle:sock-reference-card',
          title: '袜子 SKU 色卡参考',
          intent: 'reference',
          sourceType: 'eagle_library',
          summary: 'Eagle 只读素材参考。',
          sourceNotes: ['Eagle readonly item'],
          tags: ['socks', 'sku', 'reference'],
          allowedUses: ['prompt_context', 'user_reference'],
          sourceLevel: 'local_case',
          sourceRank: 80,
          sourceUrl: 'eagle://item/sock-reference-card'
        }],
        providerSummary: { eagleLibrary: 1 },
        warnings: [],
        boundaries: {
          readonly: true,
          doesNotWriteEagle: true,
          doesNotRunPhotoshop: true,
          doesNotReturnRawImages: true,
          allowedTools: ['item_query']
        }
      };
    },
    analyzeAssetContent: async (imagePath) => {
      calls.push(`analyze:${imagePath}`);
      assert(imagePath === '%USERPROFILE%\\Desktop\\sock-card.jpg', 'default analyzer should use the real local project image path before redaction', imagePath);
      return {
        success: true,
        analysis: {
          description: '五色袜子整齐排列',
          category: 'product_main',
          mainSubject: '袜子色卡',
          colors: ['#ffffff', '#d8d8d8', '#111111'],
          style: 'clean ecommerce',
          suggestedPlacement: 'SKU 色卡参考',
          suggestedEffects: ['drop_shadow', 'color_tuning']
        }
      };
    }
  };

  const previousWindow = global.window;
  const runtimeBridgeCalls = [];
  global.window = {
    designEcho: {
      analyzeDesignReference: async (payload) => {
        runtimeBridgeCalls.push(payload);
        return {
          referenceId: payload.reference?.referenceId || 'runtime-bridge-reference',
          analysisSource: 'runtime-window-bridge',
          summary: `runtime bridge analyzed ${payload.referenceTitle}`,
          strengths: [
            { aspect: 'composition', observation: '主体排列清楚。', reason: '统一节奏利于比较。', suitableFor: ['SKU 色卡'] },
            { aspect: 'lighting', observation: '光影保持一致。', reason: '一致投影能减少页面噪音。', suitableFor: ['白底图'] }
          ],
          suitableScenarios: ['SKU 色卡'],
          avoidWhen: ['商品形态差异过大时不要强行套用。'],
          reusableHeuristics: ['统一主体基线后再调整局部差异。']
        };
      }
    }
  };
  const runtimeBridgeApi = createDesignLearningRuntimeOrchestratorApi();
  assert(typeof runtimeBridgeApi.analyzeDesignReference === 'function', 'runtime window bridge should expose analyzeDesignReference');
  const runtimeBridgeResult = await runtimeBridgeApi.analyzeDesignReference({
    reference: {
      referenceId: 'runtime-window-reference',
      title: '运行时桥接参考图',
      sourceType: 'manual_reference',
      tags: ['sku', 'reference'],
      source: 'project_cases'
    },
    imagePath: '%USERPROFILE%\\Desktop\\runtime-bridge.jpg',
    plan: {
      version: 'design-learning-daily-research-plan/v0',
      status: 'ready_for_runtime',
      date: '2026-06-01',
      cadence: 'daily',
      topics: ['袜子 SKU 色卡'],
      sourceAvailability: { eagleReadonly: true, webSearch: false, projectCases: true, visualAnalysis: true },
      maxReferences: 1,
      steps: [],
      blockers: [],
      warnings: [],
      limitations: [],
      boundaries: {
        readonly: true,
        doesNotExecuteSearch: true,
        doesNotCallProvider: true,
        noPhotoshopWrites: true,
        doesNotWriteEagle: true,
        doesNotPersistMemory: true,
        doesNotReturnRawImages: true,
        doesNotClaimDesignQuality: true
      }
    }
  });
  global.window = previousWindow;
  assert(runtimeBridgeResult?.analysisSource === 'runtime-window-bridge', 'runtime bridge result should come from window.designEcho adapter', runtimeBridgeResult);
  assert(runtimeBridgeCalls[0]?.referenceTitle === '运行时桥接参考图', 'runtime bridge should map reference title for preload IPC', runtimeBridgeCalls);
  assert(runtimeBridgeCalls[0]?.topics?.includes('袜子 SKU 色卡'), 'runtime bridge should map learning topics for preload IPC', runtimeBridgeCalls);

  const appStart = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'app_start',
    now: '2026-06-01T08:00:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子 SKU 色卡'],
    maxReferences: 2,
    api,
    memoryService,
    projectImagePaths: ['%USERPROFILE%\\Desktop\\sock-card.jpg']
  });
  assert(appStart.status === 'ready_waiting_manual_start', 'app start should not run heavy learning by default', appStart);
  assert(calls.length === 0, 'app start should not search Eagle or analyze images by default', calls);

  const manual = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'manual',
    executeRuntime: true,
    now: '2026-06-01T08:05:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子 SKU 色卡'],
    knowledgeGaps: ['袜子光影统一'],
    maxReferences: 2,
    api,
    memoryService,
    projectImagePaths: ['%USERPROFILE%\\Desktop\\sock-card.jpg'],
    scope: { type: 'user', id: 'default' }
  });

  assert(manual.orchestratorVersion === 'design-learning-runtime-orchestrator-service/v0', 'orchestrator should expose stable version', manual);
  assert(manual.status === 'runtime_completed_review_queued', 'manual orchestrator run should queue review memory', manual);
  assert(calls.some((item) => item.startsWith('eagle:')), 'manual run should call Eagle readonly provider', calls);
  assert(calls.includes('analyze:%USERPROFILE%\\Desktop\\sock-card.jpg'), 'manual run should call visual analyzer for project image', calls);
  assert(manual.reviewPersistence.queuedCount >= 1, 'orchestrator should queue memory candidates', manual.reviewPersistence);
  assert(manual.reviewPersistence.persistedNeedsReviewCount >= 1, 'orchestrator should persist needs-review memory only', manual.reviewPersistence);
  assert(manual.boundaries.doesNotWriteEagle === true, 'orchestrator must preserve no Eagle write boundary', manual.boundaries);
  assert(manual.boundaries.doesNotWritePhotoshop === true, 'orchestrator must preserve no Photoshop write boundary', manual.boundaries);
  assert(manual.boundaries.persistsNeedsReviewMemoryOnly === true, 'orchestrator should only persist review queue candidates', manual.boundaries);
  assert(manual.boundaries.doesNotPromoteMemoryWithoutReview === true, 'orchestrator must not promote memory without review', manual.boundaries);

  const pendingMemory = memoryService.listPersistedDesignMemoryItems({ status: 'needs_review' });
  assert(pendingMemory.length >= 1, 'queued learning candidates should be persisted as needs_review', pendingMemory);
  const activeKnowledge = memoryService.getDesignKnowledgeResults({
    query: '袜子 SKU 色卡',
    intents: ['reference'],
    sourceTypes: ['local_case'],
    limit: 5
  });
  assert(activeKnowledge.length === 0, 'needs-review learning candidates must not enter active knowledge search', activeKnowledge);
  assertNoUnsafePayload({
    appStart,
    manual,
    pendingMemory,
    localStorage: global.localStorage.dump()
  }, 'orchestrator result and pending memory');

  const missingAnalyzerCalls = [];
  const missingAnalyzer = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'manual',
    executeRuntime: true,
    now: '2026-06-01T08:10:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子 SKU 色卡'],
    maxReferences: 1,
    api: {
      searchEagleReadonlyKnowledge: async () => {
        missingAnalyzerCalls.push('eagle');
        throw new Error('Eagle must not be called when visual adapter is unavailable');
      }
    },
    memoryService: new MemoryService()
  });
  assert(missingAnalyzer.status === 'blocked_before_runtime', 'missing visual adapter should block before runtime', missingAnalyzer);
  assert(missingAnalyzerCalls.length === 0, 'blocked orchestrator should not call providers', missingAnalyzerCalls);

  const eagleOnlyCalls = [];
  const eagleOnlyMemoryService = new MemoryService();
  const eagleByItemId = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'manual',
    executeRuntime: true,
    now: '2026-06-01T08:18:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子 SKU 色卡'],
    maxReferences: 1,
    scope: { type: 'session', id: 'eagle-by-item-id' },
    api: {
      searchEagleReadonlyKnowledge: async () => ({
        version: 'eagle-readonly-knowledge/v0',
        status: 'ok',
        query: '袜子 SKU 色卡',
        results: [{
          id: 'eagle:sock-reference-by-id',
          title: 'Eagle 袜子视觉参考',
          intent: 'reference',
          sourceType: 'eagle_library',
          summary: 'Eagle 只读素材参考。',
          sourceNotes: [
            'Eagle item id: sock-reference-by-id',
            'Image dimensions: 1600x1000',
            'Extension: jpg',
            'Tags: socks, sku, color-card'
          ],
          tags: ['eagle', 'readonly', 'socks', 'sku', 'color-card'],
          allowedUses: ['prompt_context', 'user_reference'],
          sourceLevel: 'local_case',
          sourceRank: 80,
          sourceUrl: 'eagle://item/sock-reference-by-id'
        }],
        providerSummary: { eagleLibrary: 1 },
        warnings: [],
        boundaries: { readonly: true }
      }),
      analyzeEagleReferenceById: async ({ itemId, topics }) => {
        eagleOnlyCalls.push(`analyze-eagle-id:${itemId}:${topics.join('|')}`);
        assert(itemId === 'sock-reference-by-id', 'Eagle visual analyzer should receive the stable item ID', itemId);
        return {
          success: true,
          observation: {
            analysisSource: 'eagle-main-process-vision',
            productCategory: 'socks',
            designType: 'sku-color-card',
            summary: '五色袜子统一基线排列，白底干净，阴影方向一致。',
            strengths: [
              { aspect: 'composition', observation: '袜口基线统一。', reason: '降低颜色比较成本。', suitableFor: ['SKU 色卡'] },
              { aspect: 'lighting', observation: '接触阴影方向一致。', reason: '保留真实体积并减少噪音。', suitableFor: ['白底图'] }
            ],
            suitableScenarios: ['袜子 SKU 色卡'],
            avoidWhen: ['款式轮廓差异很大时不要强行统一。'],
            reusableHeuristics: ['统一袜口基线', '保持主体尺度接近', '统一接触阴影方向'],
            reviewStatus: 'needs_human_review',
            sourceNotes: ['source=eagle_item_id_visual_analysis'],
            limitations: ['必须人工复核后才能成为长期知识。']
          }
        };
      }
    },
    memoryService: eagleOnlyMemoryService
  });
  assert(eagleByItemId.status === 'runtime_completed_review_queued', 'Eagle references should resolve and analyze by item ID before entering review', eagleByItemId);
  assert(eagleOnlyCalls.some((item) => item.startsWith('analyze-eagle-id:sock-reference-by-id:')), 'Eagle analyzer should receive an item ID instead of a private path', eagleOnlyCalls);
  assert(eagleByItemId.reviewPersistence.queuedCount >= 1, 'Eagle item analysis should queue needs-review memory', eagleByItemId.reviewPersistence);
  assertNoUnsafePayload(eagleByItemId, 'Eagle-by-item-id orchestrator result');

  const dedicatedAnalyzerCalls = [];
  const dedicatedAnalyzerMemoryService = new MemoryService();
  const dedicatedAnalyzer = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'manual',
    executeRuntime: true,
    now: '2026-06-01T08:25:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子 SKU 色卡排版'],
    maxReferences: 1,
    scope: { type: 'session', id: 'dedicated-design-reference-analyzer' },
    api: {
      analyzeDesignReference: async ({ reference, imagePath, plan }) => {
        dedicatedAnalyzerCalls.push(`design:${reference.referenceId}:${imagePath}:${plan.topics.join('|')}`);
        assert(imagePath === '%USERPROFILE%\\Desktop\\sku-reference-good.jpg', 'dedicated design analyzer should receive the private local image path', imagePath);
        return {
          referenceId: reference.referenceId,
          analysisSource: 'dedicated-design-reference-model',
          productCategory: 'socks',
          designType: 'sku-color-card',
          summary: '五色袜子色卡通过统一基线、相近主体尺度和轻阴影建立了稳定的商品比较关系。',
          strengths: [
            {
              aspect: 'composition',
              observation: '袜身顶部、脚尖落点和文字标签形成清晰节奏，用户可以横向比较颜色。',
              reason: '统一尺度减少视觉噪音，让注意力集中在颜色差异和材质纹理上。',
              suitableFor: ['SKU 色卡', '颜色组合展示']
            },
            {
              aspect: 'light-and-detail',
              observation: '阴影方向一致但不过重，袜口和脚尖纹理仍然保留。',
              reason: '轻阴影提供落地感，同时不会让白底图变脏或压低浅色袜子的层次。',
              suitableFor: ['白底 SKU', '精修色卡']
            }
          ],
          suitableScenarios: ['袜子 SKU 色卡', '五色组合展示'],
          avoidWhen: ['花边罗口或异形袜口需要保留真实轮廓，不能强行拉成同一种形态。'],
          reusableHeuristics: [
            '先统一主体视觉高度和基线，再微调脚尖落点形成一致节奏。',
            '浅色袜子保留更轻的投影，深色袜子保留更多纹理高光。',
            '颜色标签与主体中心线对齐，编号只做扫描辅助。'
          ],
          reviewStatus: 'reviewed_approved',
          sourceNotes: [
            'source image: %USERPROFILE%\\Desktop\\sku-reference-good.jpg',
            '"confidence"=0.92',
            '置信度仅供模型内部调试'
          ],
          limitations: ['需要结合当前素材形态复核，不能强行统一花边罗口。']
        };
      },
      analyzeAssetContent: async () => {
        dedicatedAnalyzerCalls.push('fallback-analyzeAssetContent');
        throw new Error('dedicated design analyzer should not fall back to generic image analysis');
      }
    },
    memoryService: dedicatedAnalyzerMemoryService,
    projectImagePaths: ['%USERPROFILE%\\Desktop\\sku-reference-good.jpg']
  });
  assert(dedicatedAnalyzer.status === 'runtime_completed_review_queued', 'dedicated design analyzer should complete into review queue', dedicatedAnalyzer);
  assert(
    dedicatedAnalyzer.runtimeResult?.observations?.[0]?.reviewStatus === 'needs_human_review',
    'dedicated model analysis must not self-approve learning memory',
    dedicatedAnalyzer.runtimeResult?.observations
  );
  assert(
    dedicatedAnalyzerCalls.some((item) => item.includes('design:project-image:'))
      && !dedicatedAnalyzerCalls.includes('fallback-analyzeAssetContent'),
    'dedicated design analyzer should be preferred over generic analyzeAssetContent',
    dedicatedAnalyzerCalls
  );
  const dedicatedPendingMemory = dedicatedAnalyzerMemoryService.listPersistedDesignMemoryItems({ scope: { type: 'session', id: 'dedicated-design-reference-analyzer' } });
  assert(dedicatedPendingMemory.length >= 1, 'dedicated analyzer should persist needs-review memory candidates', dedicatedPendingMemory);
  assert(
    dedicatedPendingMemory.every((item) => item.status === 'needs_review'),
    'dedicated analyzer memory must remain needs_review even when the model returns reviewed_approved',
    dedicatedPendingMemory
  );
  assert(
    dedicatedAnalyzerMemoryService.getDesignKnowledgeResults({
      query: '袜子 SKU 色卡',
      intents: ['reference'],
      sourceTypes: ['local_case'],
      limit: 5
    }).length === 0,
    'dedicated analyzer memory must not enter active knowledge before review',
    dedicatedPendingMemory
  );
  const dedicatedSummary = JSON.stringify(dedicatedPendingMemory);
  assert(dedicatedSummary.includes('为什么有效'), 'dedicated analyzer memory should preserve why-it-works content', dedicatedPendingMemory);
  assert(dedicatedSummary.includes('适用'), 'dedicated analyzer memory should preserve suitable scenario content', dedicatedPendingMemory);
  assert(dedicatedSummary.includes('SKU 色卡'), 'dedicated analyzer memory should preserve design scenario tags', dedicatedPendingMemory);
  assertNoUnsafePayload(dedicatedAnalyzer, 'dedicated analyzer orchestrator result');
  assertNoUnsafePayload(dedicatedPendingMemory, 'dedicated analyzer persisted memory');

  const shallowAnalyzerCalls = [];
  const shallowAnalyzerMemoryService = new MemoryService();
  const shallowAnalyzer = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'manual',
    executeRuntime: true,
    now: '2026-06-01T08:30:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子 SKU 色卡排版'],
    maxReferences: 1,
    scope: { type: 'session', id: 'shallow-design-reference-analyzer' },
    api: {
      analyzeDesignReference: async ({ imagePath }) => {
        shallowAnalyzerCalls.push(`design:${imagePath}`);
        return {
          referenceId: 'too-shallow',
          analysisSource: 'dedicated-design-reference-model',
          summary: '这张图很好看。',
          strengths: [{
            aspect: 'generic',
            observation: '画面干净。',
            reason: '看起来舒服。',
            suitableFor: ['参考']
          }],
          suitableScenarios: [],
          reusableHeuristics: []
        };
      },
      analyzeAssetContent: async () => {
        shallowAnalyzerCalls.push('fallback-analyzeAssetContent');
        throw new Error('shallow dedicated result must not be masked by generic fallback');
      }
    },
    memoryService: shallowAnalyzerMemoryService,
    projectImagePaths: ['%USERPROFILE%\\Desktop\\sku-reference-shallow.jpg']
  });
  assert(shallowAnalyzer.status === 'runtime_blocked', 'too-shallow design analysis should block instead of fabricating learning', shallowAnalyzer);
  assert(shallowAnalyzer.blockers.includes('reference_design_analysis_required'), 'shallow analysis should explain missing reference design analysis', shallowAnalyzer.blockers);
  assert(
    shallowAnalyzerCalls.length === 1
      && shallowAnalyzerCalls[0] === 'design:%USERPROFILE%\\Desktop\\sku-reference-shallow.jpg',
    'shallow dedicated analysis should not fall back to generic analyzer',
    shallowAnalyzerCalls
  );
  assert(shallowAnalyzer.reviewPersistence.queuedCount === 0, 'shallow analyzer must not queue memory candidates', shallowAnalyzer.reviewPersistence);
  assert(shallowAnalyzerMemoryService.listPersistedDesignMemoryItems({ scope: { type: 'session', id: 'shallow-design-reference-analyzer' } }).length === 0, 'shallow analyzer must not persist fake learning memory');
  assertNoUnsafePayload(shallowAnalyzer, 'shallow analyzer orchestrator result');

  const eagleNoPathCalls = [];
  const eagleOnly = await runDesignLearningRuntimeOrchestrator({
    triggerSource: 'manual',
    executeRuntime: true,
    now: '2026-06-01T08:20:00.000Z',
    cadence: 'daily',
    preferredTopics: ['袜子 SKU 色卡'],
    maxReferences: 1,
    scope: { type: 'session', id: 'eagle-only-boundary' },
    api: {
      searchEagleReadonlyKnowledge: async () => {
        eagleNoPathCalls.push('eagle');
        return {
          version: 'eagle-readonly-knowledge/v0',
          status: 'ok',
          query: '袜子 SKU 色卡',
          results: [{
            id: 'eagle:sock-reference-only',
            title: 'Eagle 只读袜子参考',
            intent: 'reference',
            sourceType: 'eagle_library',
            summary: '只有 Eagle 元数据，没有本地文件引用。',
            sourceNotes: [
              'Eagle item id: sock-reference-only',
              'Image dimensions: 1600x1000',
              'Extension: jpg',
              'Tags: socks, sku, reference'
            ],
            tags: ['socks', 'sku', 'reference'],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceLevel: 'local_case',
            sourceRank: 80,
            sourceUrl: 'eagle://item/sock-reference-only'
          }],
          warnings: [],
          boundaries: { readonly: true }
        };
      },
      analyzeAssetContent: async (imagePath) => {
        eagleNoPathCalls.push(`analyze:${imagePath}`);
        return {
          success: true,
          analysis: { description: 'Eagle-only references should not be analyzed without a resolvable local image path.' }
        };
      }
    },
    memoryService: eagleOnlyMemoryService
  });
  assert(eagleOnly.status === 'runtime_blocked', 'Eagle-only references without a main-process item analyzer should block instead of fabricating learning', eagleOnly);
  assert(eagleOnly.blockers.includes('reference_design_analysis_required'), 'Eagle-only blocked run should explain missing design analysis', eagleOnly.blockers);
  assert(eagleNoPathCalls.length === 1 && eagleNoPathCalls[0] === 'eagle', 'Eagle-only blocked run should not call a path-based analyzer', eagleNoPathCalls);
  assert(eagleOnly.reviewPersistence.queuedCount === 0, 'Eagle-only blocked run must not queue memory candidates', eagleOnly.reviewPersistence);
  assert(eagleOnlyMemoryService.listPersistedDesignMemoryItems({ scope: { type: 'session', id: 'eagle-only-boundary' } }).length === 0, 'Eagle-only blocked run must not persist fake learning memory');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:runtime-orchestrator'], 'package script should expose runtime orchestrator smoke');
  const orchestratorSource = read('src/renderer/services/design-learning-runtime-orchestrator.service.ts');
  assert(
    orchestratorSource.includes('input.memoryService || getMemoryService()'),
    'production default should resolve the existing MemoryService singleton'
  );
  assert(
    !orchestratorSource.includes('new MemoryService('),
    'production orchestrator must not create an independent MemoryService owner'
  );
  assert(
    !orchestratorSource.includes('getEagleReferencePreview'),
    'UI-only Eagle previews must never enter learning observations or persisted memory candidates'
  );
  assert(
    orchestratorSource.includes("runtimeInvoke('designKnowledge:analyzeEagleReference', request)"),
    'Eagle learning must resolve and analyze a single item inside the main process'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'app_start prepares learning trigger without calling Eagle or visual analysis',
      'production default reuses the existing MemoryService singleton while tests may inject an explicit instance',
      'manual orchestrator run connects Eagle readonly provider, project image analysis and runtime trigger service',
      'runtime window bridge maps analyzeDesignReference preload inputs into the orchestrator adapter',
      'dedicated design reference analyzer is preferred over generic visual analysis when available',
      'dedicated model analysis cannot self-approve learning memory before review',
      'too-shallow dedicated design analysis blocks without falling back to fabricated generic learning',
      'Eagle references require main-process item-ID visual analysis and never expose private paths to Renderer',
      'MemoryService persists generated learning only as needs_review review queue items',
      'needs_review learning does not enter active design knowledge search',
      'orchestrator preserves no Eagle write and no Photoshop write boundaries',
      'unsafe payloads, local paths and score markers are redacted from result and persisted memory'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
