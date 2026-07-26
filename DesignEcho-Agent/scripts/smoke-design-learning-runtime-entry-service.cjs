#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const fs = require('fs');
const repoRoot = path.resolve(__dirname, '..');
const {
  collectDesignLearningProjectImagePaths,
  createDesignLearningRuntimeEntryController
} = require('../src/renderer/services/design-learning-runtime-entry.service.ts');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createProjectState() {
  return {
    currentProject: {
      id: 'C-1166',
      name: 'C-1166',
      path: '%USERPROFILE%\\Desktop\\C-1166',
      createdAt: 0,
      lastOpenedAt: 0,
      folders: {
        assets: '%USERPROFILE%\\Desktop\\C-1166\\素材',
        psd: '%USERPROFILE%\\Desktop\\C-1166\\PSD',
        output: '%USERPROFILE%\\Desktop\\C-1166\\输出'
      }
    },
    ecommerceStructure: {
      projectPath: '%USERPROFILE%\\Desktop\\C-1166',
      projectName: 'C-1166',
      summary: {
        totalImages: 5,
        totalFolders: 3,
        byFolderType: { source: 1, detail: 1, sku: 1 },
        byImageType: { product: 2, detail: 1, scene: 1, psd: 1 }
      },
      folders: [{
        name: '素材',
        path: '%USERPROFILE%\\Desktop\\C-1166\\素材',
        relativePath: '素材',
        type: 'source',
        depth: 0,
        imageCount: 3,
        totalImageCount: 4,
        images: [
          {
            name: '白色袜子.jpg',
            path: '%USERPROFILE%\\Desktop\\C-1166\\素材\\白色袜子.jpg',
            relativePath: '素材\\白色袜子.jpg',
            size: 100,
            ext: '.jpg',
            type: 'product',
            parentFolder: '素材',
            folderType: 'source'
          },
          {
            name: '详情细节.png',
            path: '%USERPROFILE%\\Desktop\\C-1166\\素材\\详情细节.png',
            relativePath: '素材\\详情细节.png',
            size: 100,
            ext: '.png',
            type: 'detail',
            parentFolder: '素材',
            folderType: 'source'
          },
          {
            name: '模板.psb',
            path: '%USERPROFILE%\\Desktop\\C-1166\\素材\\模板.psb',
            relativePath: '素材\\模板.psb',
            size: 100,
            ext: '.psb',
            type: 'psd',
            parentFolder: '素材',
            folderType: 'source'
          }
        ],
        children: [{
          name: '场景',
          path: '%USERPROFILE%\\Desktop\\C-1166\\素材\\场景',
          relativePath: '素材\\场景',
          type: 'source',
          depth: 1,
          imageCount: 1,
          totalImageCount: 1,
          images: [{
            name: '生活场景.webp',
            path: '%USERPROFILE%\\Desktop\\C-1166\\素材\\场景\\生活场景.webp',
            relativePath: '素材\\场景\\生活场景.webp',
            size: 100,
            ext: '.webp',
            type: 'scene',
            parentFolder: '场景',
            folderType: 'source'
          }],
          children: []
        }]
      }]
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
  const appState = createProjectState();
  const collected = collectDesignLearningProjectImagePaths(appState.ecommerceStructure, { limit: 4 });
  assert(collected.length === 3, 'project image collector should include raster product/detail/scene images only', collected);
  assert(collected[0].endsWith('白色袜子.jpg'), 'project image collector should prioritize product images', collected);
  assert(!collected.some((item) => item.endsWith('.psb')), 'project image collector should not pass PSD/PSB documents to visual analyzer', collected);

  const calls = [];
  const memoryService = { marker: 'singleton-memory-service' };
  const controller = createDesignLearningRuntimeEntryController({
    memoryService,
    runOrchestrator: async (input) => {
      calls.push(input);
      return {
        version: 'design-learning-runtime-trigger-service/v0',
        orchestratorVersion: 'design-learning-runtime-orchestrator-service/v0',
        status: input.triggerSource === 'manual'
          ? 'runtime_completed_review_queued'
          : 'ready_waiting_manual_start',
        generatedAt: input.now,
        triggerSource: input.triggerSource,
        canRunRuntime: input.executeRuntime === true,
        trigger: { status: 'ready_for_runtime_runner' },
        schedule: {
          version: 'design-learning-cadence-scheduler/v0',
          status: 'due',
          due: true,
          topics: input.preferredTopics,
          maxReferences: input.maxReferences
        },
        reviewQueueResult: input.triggerSource === 'manual' ? { queuedCount: 2 } : undefined,
        reviewPersistence: {
          enabled: true,
          queuedCount: input.triggerSource === 'manual' ? 2 : 0,
          persistedNeedsReviewCount: input.triggerSource === 'manual' ? 2 : 0
        },
        adapters: {
          eagleReadonlyProvider: true,
          projectImageProvider: true,
          visualAnalysisAdapter: true,
          memoryReviewQueue: true
        },
        blockers: [],
        warnings: [],
        boundaries: {
          doesNotWritePhotoshop: true,
          doesNotWriteEagle: true,
          appStartDoesNotAutoRunByDefault: true,
          doesNotPromoteMemoryWithoutReview: true
        }
      };
    }
  });

  const prepared = await controller.prepareOnAppStart({
    ...appState,
    now: '2026-06-01T09:00:00.000Z',
    cadence: 'daily'
  });
  assert(prepared.version === 'design-learning-runtime-entry/v0', 'entry result should expose stable version', prepared);
  assert(prepared.status === 'prepared_waiting_manual_start', 'app start should only prepare learning runtime', prepared);
  assert(calls.length === 1, 'first app_start should call orchestrator once', calls);
  assert(calls[0].triggerSource === 'app_start', 'app_start should call orchestrator with app_start source', calls[0]);
  assert(calls[0].executeRuntime === false, 'app_start should never execute runtime by default', calls[0]);
  assert(calls[0].autoRunOnAppStart === false, 'app_start should explicitly disable autorun', calls[0]);
  assert(calls[0].memoryService === memoryService, 'entry should reuse injected MemoryService singleton', calls[0]);
  assert(Array.isArray(calls[0].projectImagePaths) && calls[0].projectImagePaths.length === 3, 'entry should pass selected project image paths internally', calls[0]);
  assert(calls[0].scope.type === 'project' && calls[0].scope.id === 'C-1166', 'entry should scope learning memory to current project', calls[0].scope);
  assert(prepared.projectImages.selectedCount === 3, 'entry result should expose image counts without raw paths', prepared.projectImages);
  assert(prepared.boundaries.appStartNeverExecutesRuntime === true, 'entry should preserve app-start no-heavy-run boundary', prepared.boundaries);
  assertNoUnsafePayload(prepared, 'app start entry result');

  const duplicate = await controller.prepareOnAppStart({
    ...appState,
    now: '2026-06-01T09:01:00.000Z',
    cadence: 'daily'
  });
  assert(duplicate.status === 'skipped_duplicate_app_start', 'duplicate app_start should not rerun orchestrator for same project structure', duplicate);
  assert(calls.length === 1, 'duplicate app_start should not call orchestrator again', calls);
  assertNoUnsafePayload(duplicate, 'duplicate app start entry result');

  const manual = await controller.runManual({
    ...appState,
    now: '2026-06-01T09:05:00.000Z',
    preferredTopics: ['袜子 SKU 色卡', '光影统一'],
    maxReferences: 5
  });
  assert(manual.status === 'manual_review_queued', 'manual run should queue review candidates', manual);
  assert(manual.reviewQueue.queuedCount === 2, 'manual result should expose queued review count', manual.reviewQueue);
  assert(calls.length === 2, 'manual run should call orchestrator after duplicate app_start skip', calls);
  assert(calls[1].triggerSource === 'manual', 'manual entry should call orchestrator with manual source', calls[1]);
  assert(calls[1].executeRuntime === true, 'manual entry should explicitly execute runtime', calls[1]);
  assert(calls[1].preferredTopics.includes('袜子 SKU 色卡'), 'manual topics should pass through user-specified learning topics', calls[1].preferredTopics);
  assertNoUnsafePayload(manual, 'manual entry result');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:runtime-entry'], 'package script should expose runtime entry smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:runtime-entry'), 'maintenance preflight should include runtime entry smoke');

  const appSource = read('src/renderer/App.tsx');
  assert(appSource.includes('createDesignLearningRuntimeEntryController'), 'App should create the design learning runtime entry controller');
  assert(appSource.includes('.prepareOnAppStart('), 'App should prepare design learning after project context is available');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('smoke:design-learning:runtime-entry'), 'change boundary validation should include runtime entry smoke');
  assert(boundaries.includes('design-learning-runtime-entry'), 'change boundary matcher should include runtime entry source');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-runtime-entry-service.cjs'), 'maintenance hygiene should check runtime entry smoke');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'project image collector selects raster product/detail/scene references and excludes PSD/PSB',
      'app_start entry prepares runtime without executing heavy learning',
      'duplicate app_start does not call orchestrator again',
      'manual entry explicitly executes runtime and queues review candidates',
      'entry reuses a singleton MemoryService dependency',
      'entry result redacts local paths and unsafe payload markers',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
