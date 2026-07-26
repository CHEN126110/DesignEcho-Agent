#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  buildImagePlacementPlan
} = require(path.join(repoRoot, 'src', 'shared', 'design-image-placement-core.ts'));
const {
  buildControlledPhotoshopImagePlacementBenchmarkReport,
  buildControlledPhotoshopImagePlacementPlan,
  buildControlledPhotoshopImagePlacementToolCallPlan,
  executeControlledPhotoshopImagePlacementToolCallPlan
} = require(path.join(repoRoot, 'src', 'shared', 'photoshop-controlled-image-placement-execution.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoArbitraryExecutionPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    'batchPlayDescriptor',
    '_obj',
    'executeAsModal',
    'eval(',
    'Function(',
    'javascript:',
    '__operationPlan'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not expose arbitrary script, raw batchPlay payloads or hidden fields: ${found.join(', ')}`, value);
}

function buildPlacementPlan(overrides = {}) {
  return buildImagePlacementPlan({
    source: {
      width: 1600,
      height: 1200,
      path: 'C:/DesignEchoAssets/sock-hero.png',
      assetId: 'asset-sock-hero',
      role: 'product',
      subjectBox: { x: 220, y: 180, width: 1180, height: 760 }
    },
    target: {
      box: { x: 96, y: 120, width: 560, height: 460 },
      safeBox: { x: 72, y: 96, width: 608, height: 508 },
      slotId: 'hero-slot',
      slotRole: 'hero'
    },
    canvas: { width: 800, height: 800 },
    designType: 'generic',
    assetRole: 'product',
    intent: 'hero',
    executionTool: 'placeImage',
    ...overrides
  });
}

function buildTargets() {
  const readyPlan = buildPlacementPlan();
  const metadataOnlyPlan = buildPlacementPlan({
    source: {
      width: 1400,
      height: 1000,
      path: 'C:/DesignEchoAssets/sock-detail.jpg',
      assetId: 'asset-sock-detail',
      role: 'detail'
    },
    assetRole: 'detail',
    intent: 'supporting'
  });
  return {
    readyPlan,
    metadataOnlyPlan,
    targets: [
      {
        id: 'hero-product',
        label: '主视觉产品',
        sourcePath: 'C:/DesignEchoAssets/sock-hero.png',
        imageFormat: 'png',
        layerName: 'hero_product_image',
        targetGroupId: 801,
        placementPlan: readyPlan
      },
      {
        id: 'detail-texture',
        label: '细节纹理',
        sourcePath: 'C:/DesignEchoAssets/sock-detail.jpg',
        imageFormat: 'jpg',
        layerName: 'detail_texture_image',
        placementPlan: metadataOnlyPlan
      }
    ]
  };
}

function createFakePlacementAdapter(options = {}) {
  const calls = [];
  const layerIdsByPlacementId = new Map();
  const actualBoundsByPlacementId = {};
  let nextLayerId = 9000;

  function readExpectedBox(call) {
    const expected = options.expectedByPlacementId?.[call.placementId];
    return expected ? { ...expected } : null;
  }

  return {
    calls,
    layerIdsByPlacementId,
    actualBoundsByPlacementId,
    async runToolCall(call) {
      calls.push(call);
      if (options.failCallId === call.id || options.failTool === call.tool) {
        return { success: false, error: `fake failure for ${call.id}` };
      }
      if (options.throwCallId === call.id || options.throwTool === call.tool) {
        throw new Error(`fake transport failure for ${call.id}`);
      }
      if (call.tool === 'placeImage') {
        const layerId = nextLayerId++;
        layerIdsByPlacementId.set(call.placementId, layerId);
        const placedBounds = options.placedBoundsByPlacementId?.[call.placementId];
        return {
          success: true,
          layerId,
          data: placedBounds ? { layerId, bounds: placedBounds } : { layerId }
        };
      }
      if (call.tool === 'moveLayer') {
        const expectedBox = readExpectedBox(call);
        const actualBox = options.actualBoundsByPlacementId?.[call.placementId]
          || expectedBox
          || { x: Number(call.params.x) || 0, y: Number(call.params.y) || 0, width: 100, height: 100 };
        actualBoundsByPlacementId[call.placementId] = actualBox;
      }
      return { success: true, layerId: Number(call.params.layerId) || undefined, data: { params: call.params } };
    },
    readPlacementActualBounds: options.noReadback
      ? undefined
      : async () => {
        if (options.throwReadback) throw new Error('fake actualBounds readback failed');
        return options.readbackBoundsByPlacementId || actualBoundsByPlacementId;
      }
  };
}

function expectedByPlacementIdFromPlan(plan) {
  const output = {};
  for (const placement of plan.verificationPlan.expectedPlacements) {
    output[placement.placementId] = placement.destinationBox;
  }
  return output;
}

async function run() {
  const { readyPlan, metadataOnlyPlan, targets } = buildTargets();
  assert(readyPlan.status === 'ready', 'fixture ready plan should be ready', readyPlan);
  assert(metadataOnlyPlan.status === 'needs_review', 'metadata-only plan should stay needs_review', metadataOnlyPlan);

  const dryRun = buildControlledPhotoshopImagePlacementPlan({
    kind: 'image-slot-placement',
    userIntent: '把项目图片按计划置入设计槽位',
    targets
  });
  assert(dryRun.status === 'ready_dry_run', 'valid placement targets should produce a dry-run plan', dryRun);
  assert(dryRun.noPhotoshopWrites === true, 'image placement dry-run must not write Photoshop', dryRun);
  assert(dryRun.mustNotExecutePhotoshop === true, 'image placement dry-run helper must not execute Photoshop', dryRun);
  assert(dryRun.operations.length === 2, 'dry-run should record one operation per target', dryRun);
  assert(dryRun.operations[0].targetGroupId === 801, 'targetGroupId should be preserved for grouped placement', dryRun.operations[0]);
  assert(dryRun.operations.some((operation) => operation.sourcePlanStatus === 'needs_review'), 'metadata-only source plan should remain visible', dryRun.operations);
  assertNoArbitraryExecutionPayload(dryRun, 'controlled image placement dry-run');

  const sourcePlans = {
    'hero-product': readyPlan,
    'detail-texture': metadataOnlyPlan
  };
  const toolCallPlan = buildControlledPhotoshopImagePlacementToolCallPlan(dryRun, sourcePlans);
  assert(toolCallPlan.status === 'ready_tool_call_plan', 'ready dry-run should compile into a tool-call plan', toolCallPlan);
  assert(toolCallPlan.requiresExplicitLiveExecution === true, 'tool-call plan must require explicit approval', toolCallPlan);
  assert(toolCallPlan.noPhotoshopWrites === true, 'tool-call plan builder must not write Photoshop', toolCallPlan);
  assert(toolCallPlan.toolCalls.length === 7, 'tool-call plan should include place/group/transform/move operations', toolCallPlan.toolCalls);
  assert(toolCallPlan.toolCalls[0].tool === 'placeImage', 'first call should place image', toolCallPlan.toolCalls[0]);
  assert(toolCallPlan.toolCalls.some((call) => call.tool === 'moveLayerToGroup'), 'grouped target should include moveLayerToGroup', toolCallPlan.toolCalls);
  assert(toolCallPlan.verificationPlan.expectedPlacements.length === 2, 'verification plan should keep expected placements', toolCallPlan.verificationPlan);
  assertNoArbitraryExecutionPayload(toolCallPlan, 'controlled image placement tool-call plan');

  const benchmarkEstimate = buildControlledPhotoshopImagePlacementBenchmarkReport(dryRun, toolCallPlan);
  assert(benchmarkEstimate.status === 'ready_estimate', 'benchmark should expose a ready estimate before execution', benchmarkEstimate);
  assert(
    benchmarkEstimate.canClaimRuntimeSpeedup === false
      && benchmarkEstimate.canClaimTokenReduction === false
      && benchmarkEstimate.canClaimDesignQuality === false,
    'benchmark must not claim runtime speedup, token reduction or design quality',
    benchmarkEstimate
  );

  const blockedAdapter = createFakePlacementAdapter();
  const blockedExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(toolCallPlan, blockedAdapter);
  assert(blockedExecution.status === 'blocked_explicit_live_approval_required', 'execution must require explicit approval', blockedExecution);
  assert(blockedAdapter.calls.length === 0, 'blocked execution must not call adapter tools', blockedAdapter.calls);

  const expectedByPlacementId = expectedByPlacementIdFromPlan(toolCallPlan);
  const verifiedAdapter = createFakePlacementAdapter({ expectedByPlacementId });
  const verifiedExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(toolCallPlan, verifiedAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(verifiedExecution.status === 'completed_bounds_needs_review', 'metadata-only placement should keep final result in needs_review', verifiedExecution);
  assert(verifiedExecution.executedToolCount === 7, 'verified execution should attempt every planned tool call', verifiedExecution);
  assert(
    verifiedExecution.verificationReport.placements.some((placement) => placement.verification.status === 'needs_review'),
    'metadata-only placement should be visible in verification report',
    verifiedExecution.verificationReport
  );

  const singleReadyDryRun = buildControlledPhotoshopImagePlacementPlan({
    kind: 'image-slot-placement',
    targets: [targets[0]]
  });
  const singleReadyToolPlan = buildControlledPhotoshopImagePlacementToolCallPlan(singleReadyDryRun, {
    'hero-product': readyPlan
  });
  const singleExpected = expectedByPlacementIdFromPlan(singleReadyToolPlan);
  const singleVerified = await executeControlledPhotoshopImagePlacementToolCallPlan(
    singleReadyToolPlan,
    createFakePlacementAdapter({ expectedByPlacementId: singleExpected }),
    { liveExecutionApproved: true, executionTarget: 'fake-adapter' }
  );
  assert(singleVerified.status === 'completed_bounds_verified', 'subject-bounds placement with exact actualBounds should verify', singleVerified);

  const runtimeExpectedBox = singleExpected['hero-product'];
  const runtimePlacedBounds = {
    x: runtimeExpectedBox.x,
    y: runtimeExpectedBox.y,
    width: runtimeExpectedBox.width * 2,
    height: runtimeExpectedBox.height * 2
  };
  const runtimeScaleAdapter = createFakePlacementAdapter({
    expectedByPlacementId: singleExpected,
    placedBoundsByPlacementId: {
      'hero-product': runtimePlacedBounds
    }
  });
  const runtimeScaleExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
    singleReadyToolPlan,
    runtimeScaleAdapter,
    { liveExecutionApproved: true, executionTarget: 'fake-adapter' }
  );
  const runtimeTransformCall = runtimeScaleAdapter.calls.find((call) => call.tool === 'transformLayer');
  assert(runtimeScaleExecution.status === 'completed_bounds_verified', 'runtime scale adjustment should still verify exact bounds', runtimeScaleExecution);
  assert(runtimeTransformCall.params.scaleUniform === 50, 'transform scale should be corrected from placeImage actual bounds when available', runtimeTransformCall);

  const failedToolExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
    toolCallPlan,
    createFakePlacementAdapter({ failTool: 'transformLayer', expectedByPlacementId }),
    { liveExecutionApproved: true, executionTarget: 'fake-adapter' }
  );
  assert(failedToolExecution.status === 'failed_tool_call', 'tool failure should stop controlled execution', failedToolExecution);

  const thrownToolExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
    toolCallPlan,
    createFakePlacementAdapter({ throwTool: 'moveLayer', expectedByPlacementId }),
    { liveExecutionApproved: true, executionTarget: 'fake-adapter' }
  );
  assert(thrownToolExecution.status === 'failed_tool_call', 'adapter exceptions should become failed_tool_call', thrownToolExecution);

  const missingReadbackExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
    toolCallPlan,
    createFakePlacementAdapter({ noReadback: true, expectedByPlacementId }),
    { liveExecutionApproved: true, executionTarget: 'fake-adapter' }
  );
  assert(missingReadbackExecution.status === 'completed_needs_verification', 'missing actualBounds readback should require review', missingReadbackExecution);

  const readbackFailedExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
    toolCallPlan,
    createFakePlacementAdapter({ throwReadback: true, expectedByPlacementId }),
    { liveExecutionApproved: true, executionTarget: 'fake-adapter' }
  );
  assert(readbackFailedExecution.status === 'failed_verification_readback', 'readback exceptions should be structured', readbackFailedExecution);

  const deviatedBounds = {
    'hero-product': {
      ...expectedByPlacementId['hero-product'],
      x: expectedByPlacementId['hero-product'].x + 32
    },
    'detail-texture': expectedByPlacementId['detail-texture']
  };
  const deviatedExecution = await executeControlledPhotoshopImagePlacementToolCallPlan(
    toolCallPlan,
    createFakePlacementAdapter({ expectedByPlacementId, actualBoundsByPlacementId: deviatedBounds }),
    { liveExecutionApproved: true, executionTarget: 'fake-adapter' }
  );
  assert(deviatedExecution.status === 'completed_verification_failed', 'large actualBounds deviation should fail verification', deviatedExecution);

  const blockedPlan = buildImagePlacementPlan({
    source: {
      width: 1600,
      height: 1200,
      path: 'C:/DesignEchoAssets/no-subject.png',
      assetId: 'asset-no-subject',
      role: 'product'
    },
    target: {
      box: { x: 0, y: 0, width: 400, height: 400 }
    },
    requireSubjectBounds: true,
    executionTool: 'placeImage'
  });

  const blockedCases = [
    {
      name: 'empty targets',
      expected: 'blocked_empty_targets',
      input: { kind: 'image-slot-placement', targets: [] }
    },
    {
      name: 'duplicate placement id',
      expected: 'blocked_duplicate_placement_id',
      input: { kind: 'image-slot-placement', targets: [targets[0], { ...targets[0] }] }
    },
    {
      name: 'unsafe relative source path',
      expected: 'blocked_unsafe_source_path',
      input: { kind: 'image-slot-placement', targets: [{ ...targets[0], sourcePath: '../assets/a.png' }] }
    },
    {
      name: 'blocked placement plan',
      expected: 'blocked_placement_plan_not_ready',
      input: { kind: 'image-slot-placement', targets: [{ ...targets[0], placementPlan: blockedPlan }] }
    },
    {
      name: 'invalid image format',
      expected: 'blocked_invalid_targets',
      input: { kind: 'image-slot-placement', targets: [{ ...targets[0], sourcePath: 'C:/DesignEchoAssets/file.txt', imageFormat: 'txt' }] }
    },
    {
      name: 'forbidden script payload',
      expected: 'blocked_forbidden_arbitrary_script',
      input: { kind: 'image-slot-placement', targets, forbiddenArbitraryScript: 'app.batchPlay(...)' }
    }
  ];

  for (const blockedCase of blockedCases) {
    const plan = buildControlledPhotoshopImagePlacementPlan(blockedCase.input);
    assert(plan.status === blockedCase.expected, `blocked case should return ${blockedCase.expected}: ${blockedCase.name}`, plan);
    const blockedToolPlan = buildControlledPhotoshopImagePlacementToolCallPlan(plan);
    assert(blockedToolPlan.status === 'blocked_plan_not_ready', `blocked case should not compile tool calls: ${blockedCase.name}`, blockedToolPlan);
    assertNoArbitraryExecutionPayload(plan, `blocked image placement plan: ${blockedCase.name}`);
  }

  const sampledBenchmark = buildControlledPhotoshopImagePlacementBenchmarkReport(dryRun, toolCallPlan, verifiedExecution);
  assert(sampledBenchmark.status === 'execution_sampled', 'benchmark should mark execution_sampled after an execution result', sampledBenchmark);
  assert(sampledBenchmark.canClaimDesignQuality === false && sampledBenchmark.canClaimRuntimeSpeedup === false, 'sampled benchmark remains no-overclaim', sampledBenchmark);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'image placement dry-run compiles safe source paths and ImagePlacementPlan destination boxes',
      'tool-call plan uses only placeImage, optional moveLayerToGroup, transformLayer and moveLayer',
      'execution requires explicit approval before any adapter call',
      'fake adapter execution resolves runtime layer ids and verifies actualBounds',
      'metadata-only placement remains needs_review even when geometry matches',
      'tool failures, thrown adapter errors, missing readback, readback failure and bounds deviation stay structured',
      'unsafe paths, duplicate ids, blocked placement plans, invalid formats and arbitrary script payloads are blocked',
      'benchmark remains no-overclaim and cannot claim runtime speedup, token reduction or design quality'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
