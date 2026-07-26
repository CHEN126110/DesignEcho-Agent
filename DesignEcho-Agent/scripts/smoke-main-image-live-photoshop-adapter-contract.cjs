#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageLivePhotoshopAdapterContract
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-photoshop-adapter-contract.ts'));
const {
  buildMainImageLiveExecutorCheckpoint
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-executor-checkpoint.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must redact raw image-like payloads: ${found.join(', ')}`, value);
}

const registeredTools = [
  'createDocument',
  'createGroup',
  'moveLayerToGroup',
  'placeImage',
  'transformLayer',
  'moveLayer',
  'exportGroup',
  'getDocumentInfo',
  'getLayerHierarchy',
  'getLayerProperties',
  'getAcceptanceSnapshot'
];

const selectedAsset = {
  id: 'asset-1',
  name: 'white-slouch-socks-01.jpg',
  path: 'C:/project/assets/white-slouch-socks-01.jpg',
  role: 'project-image',
  width: 1600,
  height: 1600
};

const sizePlans = [
  {
    sizeKey: 'tmall-1x1-main-image',
    targetSize: { width: 1440, height: 1440 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 420,
    decisionReason: '1:1 square main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  },
  {
    sizeKey: 'tmall-3x4-main-image',
    targetSize: { width: 1440, height: 1920 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 680,
    decisionReason: '3:4 vertical main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  },
  {
    sizeKey: 'tmall-1200-main-image',
    targetSize: { width: 1440, height: 2560 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 920,
    decisionReason: '1200 folder 9:16 long vertical main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  }
];

function buildReadyCheckpoint() {
  const strategy = buildMainImageStrategyInputs({
    userText: 'raw-image-payload 看项目图片理解袜子款式，制作点击图和转化图 data:image/png;base64,abc',
    imageType: 'click',
    selectedAsset,
    projectAssets: [selectedAsset],
    subjectBounds: { left: 250, top: 360, right: 1330, bottom: 980, width: 1080, height: 620 },
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: [
      'createDocument',
      'createGroup',
      'moveLayerToGroup',
      'placeImage',
      'transformLayer',
      'moveLayer',
      'exportGroup',
      'getDocumentInfo',
      'getLayerHierarchy',
      'getLayerProperties',
      'getAcceptanceSnapshot',
      'quickExport'
    ],
    allowPendingRatioExecution: true,
    visionSignal: {
      source: 'vision-model',
      assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
      productType: '堆堆袜',
      subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图 raw-image-payload',
      backgroundSummary: '浅色背景，模特脚部局部露出',
      confidence: 0.82,
      sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
    },
    userCheckpointApproved: true
  });

  return buildMainImageLiveExecutorCheckpoint({
    requestPackage: strategy.liveExecutorRequestPackage,
    approvedLiveExecution: true,
    executionScope: 'disposable-document',
    photoshopConnection: {
      connected: true,
      documentWriteAvailable: true,
      source: 'smoke',
      currentDocumentId: 'disposable-doc',
      activeDocumentName: 'smoke-live-main-image.psd'
    }
  });
}

function makeMinimalCheckpoint() {
  return {
    version: 'main-image-live-executor-checkpoint/v0',
    skillId: 'main-image-design',
    scene: 'ecommerce-socks',
    status: 'ready_for_live_executor_run',
    canStartLiveExecutor: true,
    noPhotoshopWrites: true,
    mustNotExecutePhotoshop: true,
    operationRequests: [
      {
        id: 'live-request-001-create-doc',
        sourceDryRunId: 'dry-run-001-create-doc',
        requestId: '001-create-doc',
        tool: 'createDocument',
        phase: 'document',
        documentName: 'smoke-doc',
        payloadPreview: {
          documentName: 'smoke-doc',
          canvasSize: { width: 800, height: 800 }
        },
        requiredReadback: ['documentInfo'],
        requiredPostRunReadbackTools: ['getDocumentInfo'],
        sourceContextIds: ['smoke'],
        dispatchBoundary: 'smoke',
        actualResult: null
      },
      {
        id: 'live-request-002-group',
        sourceDryRunId: 'dry-run-002-group',
        requestId: '002-group',
        tool: 'createGroup',
        phase: 'group',
        groupPath: ['点击图'],
        payloadPreview: {
          groupPath: ['点击图']
        },
        requiredReadback: ['documentInfo'],
        requiredPostRunReadbackTools: ['getLayerHierarchy'],
        sourceContextIds: ['smoke'],
        dispatchBoundary: 'smoke',
        actualResult: null
      },
      {
        id: 'live-request-003-place',
        sourceDryRunId: 'dry-run-003-place',
        requestId: '003-place',
        tool: 'placeImage',
        phase: 'asset',
        groupPath: ['点击图'],
        payloadPreview: {
          groupPath: ['点击图'],
          asset: {
            name: 'white-sock.jpg',
            path: 'C:/project/assets/white-sock.jpg'
          }
        },
        requiredReadback: ['documentInfo'],
        requiredPostRunReadbackTools: ['getLayerHierarchy'],
        sourceContextIds: ['smoke'],
        dispatchBoundary: 'smoke',
        actualResult: null
      },
      {
        id: 'live-request-004-transform',
        sourceDryRunId: 'dry-run-004-transform',
        requestId: '004-transform',
        tool: 'transformLayer',
        phase: 'transform',
        groupPath: ['点击图'],
        payloadPreview: {
          scalePercent: 82
        },
        requiredReadback: ['actualBounds'],
        requiredPostRunReadbackTools: ['getLayerProperties'],
        sourceContextIds: ['smoke'],
        dispatchBoundary: 'smoke',
        actualResult: null
      }
    ],
    operationCount: 4,
    readbackTools: ['getDocumentInfo', 'getLayerHierarchy', 'getLayerProperties', 'getAcceptanceSnapshot'],
    readbackRequirements: ['documentInfo', 'actualBounds'],
    runGuard: {
      executionScope: 'disposable-document',
      maxOperationCount: 20,
      requireReadbackAfterEveryOperation: true,
      requireFinalAcceptanceSnapshot: true,
      requireManualReviewBeforeQualityClaim: true
    },
    blockers: [],
    warnings: [],
    limitations: [],
    sourceNotes: [],
    verificationReport: {
      reportId: 'smoke',
      scenario: 'main-image',
      status: 'passed',
      scope: 'task',
      summary: 'smoke',
      checks: [],
      blockers: [],
      warnings: [],
      limitations: [],
      sourceNotes: []
    }
  };
}

function makeDestinationBoxCheckpoint() {
  const checkpoint = makeMinimalCheckpoint();
  return {
    ...checkpoint,
    operationRequests: checkpoint.operationRequests.map((operation) => {
      if (operation.tool !== 'transformLayer') return operation;
      return {
        ...operation,
        payloadPreview: {
          ...operation.payloadPreview,
          scalePercent: 82,
          destinationBox: {
            left: 120,
            top: 240,
            right: 620,
            bottom: 640,
            width: 500,
            height: 400
          }
        }
      };
    })
  };
}

function run() {
  const missing = buildMainImageLivePhotoshopAdapterContract({
    availableToolNames: registeredTools
  });
  assert(missing.status === 'blocked_missing_checkpoint', 'missing checkpoint should block', missing);

  const realLikeCheckpoint = buildReadyCheckpoint();
  assert(realLikeCheckpoint.status === 'ready_for_live_executor_run', 'fixture checkpoint should be ready', realLikeCheckpoint);

  const realLike = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: realLikeCheckpoint,
    availableToolNames: registeredTools
  });
  assert(realLike.status === 'ready_for_disposable_photoshop_adapter', 'current real-like main image plan should map to registered adapter tools', realLike);
  assert(!realLike.blockers.some((item) => item.includes('exportGroup_has_no_registered_photoshop_tool')), 'exportGroup gap should be closed by the registered exportGroup tool', realLike.blockers);
  assert(realLike.requiredToolNames.includes('exportGroup'), 'group export should require exportGroup support', realLike.requiredToolNames);
  assert(realLike.requiredToolNames.includes('moveLayer'), 'destinationBox transform should require moveLayer support', realLike.requiredToolNames);
  assert(
    realLike.mappings.some((item) => (
      item.sourceTool === 'transformLayer'
      && item.mappedToolNames.includes('transformLayer')
      && item.mappedToolNames.includes('moveLayer')
    )),
    'destinationBox transform should map to transformLayer + moveLayer',
    realLike.mappings
  );
  assert(
    !realLike.blockers.some((item) => item.includes('destinationBox_requires_moveLayer_or_smartLayout_operation_after_transform')),
    'destinationBox should no longer be blocked when moveLayer is available',
    realLike.blockers
  );
  assert(!realLike.blockers.some((item) => item.includes('nested_group_requires_parent_path_or_select_parent_support')), 'nested group should be mapped through moveLayerToGroup', realLike.blockers);
  assert(realLike.requiredToolNames.includes('moveLayerToGroup'), 'nested createGroup mapping should require moveLayerToGroup', realLike.requiredToolNames);
  assert(realLike.canWritePhotoshop === false, 'adapter contract must not execute Photoshop', realLike);
  assert(realLike.canClaimOutputQuality === false, 'adapter contract must not claim output quality', realLike);
  assertNoRawPayload(realLike, 'real-like adapter contract');

  const missingMoveToGroup = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: realLikeCheckpoint,
    availableToolNames: registeredTools.filter((tool) => tool !== 'moveLayerToGroup')
  });
  assert(
    missingMoveToGroup.status === 'blocked_missing_required_tool',
    'nested createGroup mapping should block if moveLayerToGroup is missing',
    missingMoveToGroup
  );

  const missingExportGroup = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: realLikeCheckpoint,
    availableToolNames: registeredTools.filter((tool) => tool !== 'exportGroup')
  });
  assert(
    missingExportGroup.status === 'blocked_missing_required_tool',
    'group export should block if exportGroup is missing',
    missingExportGroup
  );
  assert(
    missingExportGroup.missingToolNames.includes('exportGroup'),
    'missing exportGroup should be listed',
    missingExportGroup.missingToolNames
  );
  assert(
    missingMoveToGroup.missingToolNames.includes('moveLayerToGroup'),
    'missing moveLayerToGroup should be listed',
    missingMoveToGroup.missingToolNames
  );

  const missingTool = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: makeMinimalCheckpoint(),
    availableToolNames: registeredTools.filter((tool) => tool !== 'placeImage')
  });
  assert(missingTool.status === 'blocked_missing_required_tool', 'missing required tool should block before adapter creation', missingTool);
  assert(missingTool.missingToolNames.includes('placeImage'), 'missing placeImage should be listed', missingTool);

  const ready = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: makeMinimalCheckpoint(),
    availableToolNames: registeredTools
  });
  assert(ready.status === 'ready_for_disposable_photoshop_adapter', 'minimal supported operations should be adapter-ready', ready);
  assert(ready.canCreateAdapter === true, 'ready contract should allow adapter creation', ready);
  assert(ready.mappedOperationCount === ready.requestedOperationCount, 'all minimal operations should map', ready);
  assert(ready.canWritePhotoshop === false, 'contract still must not write Photoshop', ready);
  assert(ready.verificationReport.status === 'passed', 'ready contract verification should pass', ready);

  const destinationReady = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: makeDestinationBoxCheckpoint(),
    availableToolNames: registeredTools
  });
  assert(destinationReady.status === 'ready_for_disposable_photoshop_adapter', 'destinationBox placement should be adapter-ready when moveLayer exists', destinationReady);
  const destinationTransform = destinationReady.mappings.find((item) => item.sourceTool === 'transformLayer');
  assert(destinationTransform?.mappedToolNames.includes('moveLayer'), 'destinationBox mapping should include moveLayer', destinationTransform);
  assert(JSON.stringify(destinationTransform?.paramsPreview || {}).includes('operationSequence'), 'destinationBox mapping should expose executable operation sequence', destinationTransform);

  const destinationMissingMove = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: makeDestinationBoxCheckpoint(),
    availableToolNames: registeredTools.filter((tool) => tool !== 'moveLayer')
  });
  assert(destinationMissingMove.status === 'blocked_missing_required_tool', 'destinationBox placement should block if moveLayer is missing', destinationMissingMove);
  assert(destinationMissingMove.missingToolNames.includes('moveLayer'), 'missing moveLayer should be listed', destinationMissingMove.missingToolNames);

  const activeScope = buildMainImageLivePhotoshopAdapterContract({
    checkpoint: {
      ...makeMinimalCheckpoint(),
      runGuard: {
        ...makeMinimalCheckpoint().runGuard,
        executionScope: 'active-document'
      }
    },
    availableToolNames: registeredTools
  });
  assert(activeScope.status === 'blocked_non_disposable_scope', 'active document scope should block adapter contract', activeScope);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'adapter contract blocks without checkpoint',
      'adapter contract maps current real-like main image Photoshop operations',
      'exportGroup maps groupPath to a file export tool',
      'destinationBox maps to transformLayer plus moveLayer before real execution',
      'nested group creation maps through moveLayerToGroup before real execution',
      'missing required Photoshop tools block adapter creation',
      'minimal supported disposable operation set can become adapter-ready',
      'adapter contract never writes Photoshop or claims output quality'
    ]
  }, null, 2));
}

run();
