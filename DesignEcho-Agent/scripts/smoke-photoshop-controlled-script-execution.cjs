#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  buildControlledPhotoshopLayerLightnessSortPlan,
  buildControlledPhotoshopLayerLightnessSortToolCallPlan,
  buildControlledPhotoshopScriptBenchmarkReport,
  executeControlledPhotoshopToolCallPlan
} = require(path.join(repoRoot, 'src', 'shared', 'photoshop-controlled-script-execution.ts'));

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
    'javascript:'
  ];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not expose arbitrary script or raw batchPlay payloads: ${found.join(', ')}`, value);
}

function assertLiveSmartObjectSmokeHasRuntimeGuard() {
  const fs = require('fs');
  const liveSmokePath = path.join(repoRoot, 'scripts', 'smoke-photoshop-mcp-manual-risky-smart-object-disposable.cjs');
  const source = fs.readFileSync(liveSmokePath, 'utf8');
  const requiredSnippets = [
    'function assertRasterizeRuntimeSchema',
    'destructiveRasterizeConfirmed',
    'Stale Photoshop UXP runtime',
    'assertRasterizeRuntimeSchema(runtimeTools, report);'
  ];
  const missing = requiredSnippets.filter((snippet) => !source.includes(snippet));
  assert(
    missing.length === 0,
    'live smart-object smoke must preflight runtime schema before calling rasterizeSmartObject',
    { liveSmokePath, missing }
  );

  const guardCallIndex = source.indexOf('assertRasterizeRuntimeSchema(runtimeTools, report);');
  const firstWriteIndex = source.indexOf("createdDoc = await runPhotoshopStep('createDocument'");
  assert(
    guardCallIndex > 0 && firstWriteIndex > 0 && guardCallIndex < firstWriteIndex,
    'runtime schema guard must run before the first live Photoshop document write',
    { liveSmokePath, guardCallIndex, firstWriteIndex }
  );
}

function assertLiveSmartObjectSmokeReplacementFixtureIsValid() {
  const fs = require('fs');
  const liveSmokePath = path.join(repoRoot, 'scripts', 'smoke-photoshop-mcp-manual-risky-smart-object-disposable.cjs');
  const source = fs.readFileSync(liveSmokePath, 'utf8');
  const match = source.match(/const REPLACEMENT_PNG_BASE64 = '([^']+)'/);
  assert(match, 'live smart-object smoke should keep the replacement PNG fixture explicit', { liveSmokePath });

  const bytes = Buffer.from(match[1], 'base64');
  assert(
    bytes.length > 12 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    'replacement PNG fixture must have a valid PNG signature',
    { byteLength: bytes.length }
  );

  let offset = 8;
  let hasIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const nextOffset = offset + 8 + length + 4;
    assert(nextOffset <= bytes.length, 'replacement PNG fixture must not contain truncated chunks', {
      offset,
      length,
      type,
      byteLength: bytes.length
    });
    if (type === 'IEND') {
      hasIend = true;
      assert(length === 0, 'replacement PNG fixture IEND chunk must have zero length', { length });
      assert(nextOffset === bytes.length, 'replacement PNG fixture must not have trailing bytes after IEND', {
        nextOffset,
        byteLength: bytes.length
      });
      break;
    }
    offset = nextOffset;
  }
  assert(hasIend, 'replacement PNG fixture must include a valid IEND chunk', { byteLength: bytes.length });
  assert(
    source.includes('assertValidReplacementPng(bytes);'),
    'live smart-object smoke should validate the replacement fixture before writing it to disk',
    { liveSmokePath }
  );
}

function buildColorLayers(overrides = {}) {
  return [
    { layerId: 101, layerName: 'black sock', colorHex: '#111111' },
    { layerId: 102, layerName: 'milk white sock', colorHex: '#F2EFE7' },
    { layerId: 103, layerName: 'middle gray sock', colorHex: '#7F7F7F' },
    { layerId: 104, layerName: 'light gray sock', colorHex: '#D7D7D7' }
  ].map((layer) => ({ ...layer, ...overrides[layer.layerId] }));
}

function createFakeLayerOrderAdapter(options = {}) {
  const order = [...(options.initialOrder || [101, 102, 103, 104])];
  const calls = [];
  return {
    calls,
    runToolCall: async (call) => {
      calls.push(call);
      if (options.failLayerId && call.params.layerId === options.failLayerId) {
        return { success: false, error: `fake failure for layer ${call.params.layerId}` };
      }
      const currentIndex = order.indexOf(call.params.layerId);
      if (currentIndex < 0) {
        return { success: false, error: `layer not found ${call.params.layerId}` };
      }
      order.splice(currentIndex, 1);
      order.unshift(call.params.layerId);
      return { success: true, data: { order: [...order] } };
    },
    readTargetTopToBottomLayerIds: async () => options.readbackOrder || [...order]
  };
}

async function run() {
  assertLiveSmartObjectSmokeHasRuntimeGuard();
  assertLiveSmartObjectSmokeReplacementFixtureIsValid();

  const ready = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    direction: 'dark-to-light',
    userIntent: '把图层按颜色从深到浅，从上到下调整顺序',
    layers: buildColorLayers()
  });
  assert(ready.status === 'ready_dry_run', 'valid solid-color layers should produce a dry-run plan', ready);
  assert(ready.noPhotoshopWrites === true, 'controlled script dry-run must not write Photoshop', ready);
  assert(ready.mustNotExecutePhotoshop === true, 'dry-run helper must not execute Photoshop', ready);
  assert(ready.allowsArbitraryScript === false, 'arbitrary script execution must stay disabled', ready);
  assert(ready.allowsArbitraryBatchPlay === false, 'arbitrary batchPlay execution must stay disabled', ready);
  assert(ready.canClaimDesignQuality === false, 'controlled execution cannot claim design quality', ready);
  assert(ready.operations.length === 4, 'dry-run should record one white-listed reorder operation per target layer', ready);
  assert(
    JSON.stringify(ready.sortedLayerIds) === JSON.stringify([101, 103, 104, 102]),
    'dark-to-light order should follow computed lightness',
    ready
  );
  assert(
    ready.operations.every((operation) => operation.tool === 'reorderLayer' && operation.actualResult === null),
    'dry-run operations must be reorderLayer previews without actual results',
    ready.operations
  );
  assert(
    ready.efficiencyEstimate.baselineModelToolDecisions === 4
      && ready.efficiencyEstimate.controlledPlanModelDecisions === 1
      && ready.efficiencyEstimate.estimatedModelRoundTripReduction === 3,
    'efficiency estimate should describe model round-trip reduction without claiming runtime speedup',
    ready.efficiencyEstimate
  );
  assertNoArbitraryExecutionPayload(ready, 'ready controlled script plan');

  const toolCallPlan = buildControlledPhotoshopLayerLightnessSortToolCallPlan(ready);
  assert(toolCallPlan.status === 'ready_tool_call_plan', 'ready dry-run plan should compile into a tool-call plan', toolCallPlan);
  assert(toolCallPlan.requiresExplicitLiveExecution === true, 'tool-call plan must require explicit live execution opt-in', toolCallPlan);
  assert(toolCallPlan.noPhotoshopWrites === true, 'tool-call plan builder must not write Photoshop', toolCallPlan);
  assert(toolCallPlan.toolCalls.length === 4, 'tool-call plan should include one reorderLayer call per target layer', toolCallPlan);
  assert(
    toolCallPlan.toolCalls.every((call) => call.tool === 'reorderLayer' && call.params.action === 'top'),
    'tool-call plan should use only the white-listed reorderLayer top action',
    toolCallPlan.toolCalls
  );
  assert(
    JSON.stringify(toolCallPlan.toolCalls.map((call) => call.params.layerId)) === JSON.stringify([102, 104, 103, 101]),
    'front-sequence execution should move desired bottom-to-top layers to top',
    toolCallPlan.toolCalls
  );
  assert(
    toolCallPlan.verificationPlan.requiredTools.includes('getLayerHierarchy')
      && toolCallPlan.verificationPlan.expectedTopToBottomLayerIds.join(',') === '101,103,104,102',
    'tool-call plan should require a post-run hierarchy readback with expected top-to-bottom order',
    toolCallPlan.verificationPlan
  );
  assertNoArbitraryExecutionPayload(toolCallPlan, 'controlled script tool-call plan');

  const estimateBenchmark = buildControlledPhotoshopScriptBenchmarkReport(ready, toolCallPlan);
  assert(
    estimateBenchmark.status === 'ready_estimate',
    'benchmark should expose a ready estimate before live execution',
    estimateBenchmark
  );
  assert(
    estimateBenchmark.baseline.modelDecisionRoundTrips === 4
      && estimateBenchmark.controlled.modelDecisionRoundTrips === 1
      && estimateBenchmark.estimatedReduction.modelDecisionRoundTrips === 3,
    'benchmark should estimate model decision round-trip reduction without claiming runtime speedup',
    estimateBenchmark
  );
  assert(
    estimateBenchmark.estimatedReduction.photoshopWriteOperationCount === 0
      && estimateBenchmark.canClaimRuntimeSpeedup === false
      && estimateBenchmark.canClaimTokenReduction === false,
    'benchmark must not claim Photoshop write reduction, runtime speedup or token reduction from one estimate',
    estimateBenchmark
  );
  assertNoArbitraryExecutionPayload(estimateBenchmark, 'controlled script benchmark estimate');

  const blockedExecutionAdapter = createFakeLayerOrderAdapter();
  const blockedExecution = await executeControlledPhotoshopToolCallPlan(toolCallPlan, blockedExecutionAdapter);
  assert(
    blockedExecution.status === 'blocked_explicit_live_approval_required',
    'controlled execution must require explicit approval before adapter calls',
    blockedExecution
  );
  assert(blockedExecutionAdapter.calls.length === 0, 'blocked execution must not call adapter tools', blockedExecutionAdapter.calls);

  const verifiedAdapter = createFakeLayerOrderAdapter();
  const verifiedExecution = await executeControlledPhotoshopToolCallPlan(toolCallPlan, verifiedAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(verifiedExecution.status === 'completed_verified', 'fake adapter execution should verify expected layer order', verifiedExecution);
  assert(verifiedExecution.executedToolCount === 4, 'verified execution should attempt every planned tool call', verifiedExecution);
  assert(
    verifiedExecution.verificationReport.expectedTopToBottomLayerIds.join(',') === '101,103,104,102'
      && verifiedExecution.verificationReport.actualTopToBottomLayerIds.join(',') === '101,103,104,102',
    'verification report should compare expected and actual top-to-bottom target layer IDs',
    verifiedExecution.verificationReport
  );

  const failingAdapter = createFakeLayerOrderAdapter({ failLayerId: 104 });
  const failedExecution = await executeControlledPhotoshopToolCallPlan(toolCallPlan, failingAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(failedExecution.status === 'failed_tool_call', 'controlled execution should stop on first failed tool call', failedExecution);
  assert(failedExecution.executedToolCount === 2, 'failed execution should report attempted calls up to the failure', failedExecution);

  const throwingAdapter = {
    calls: [],
    runToolCall: async (call) => {
      throwingAdapter.calls.push(call);
      if (call.params.layerId === 104) throw new Error('adapter transport interrupted');
      return { success: true };
    },
    readTargetTopToBottomLayerIds: async () => [101, 103, 104, 102]
  };
  const thrownExecution = await executeControlledPhotoshopToolCallPlan(toolCallPlan, throwingAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(
    thrownExecution.status === 'failed_tool_call'
      && thrownExecution.executedToolCount === 2
      && String(thrownExecution.toolResults[1]?.error || '').includes('adapter transport interrupted'),
    'controlled execution should convert adapter exceptions into structured failed_tool_call results',
    thrownExecution
  );

  const mismatchAdapter = createFakeLayerOrderAdapter({ readbackOrder: [102, 104, 103, 101] });
  const mismatchExecution = await executeControlledPhotoshopToolCallPlan(toolCallPlan, mismatchAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(
    mismatchExecution.status === 'completed_verification_failed',
    'controlled execution should fail verification when readback order differs',
    mismatchExecution
  );
  assertNoArbitraryExecutionPayload(verifiedExecution, 'controlled script fake execution result');

  const noReadbackAdapter = {
    runToolCall: async () => ({ success: true })
  };
  const noReadbackExecution = await executeControlledPhotoshopToolCallPlan(toolCallPlan, noReadbackAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(
    noReadbackExecution.status === 'completed_needs_verification',
    'controlled execution without hierarchy readback must not be marked verified',
    noReadbackExecution
  );

  const throwingReadbackAdapter = createFakeLayerOrderAdapter();
  throwingReadbackAdapter.readTargetTopToBottomLayerIds = async () => {
    throw new Error('hierarchy readback timed out');
  };
  const readbackFailure = await executeControlledPhotoshopToolCallPlan(toolCallPlan, throwingReadbackAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(
    readbackFailure.status === 'failed_verification_readback'
      && readbackFailure.blockers.includes('post_run_hierarchy_readback_failed'),
    'controlled execution should classify hierarchy readback exceptions instead of throwing',
    readbackFailure
  );

  const sampledBenchmark = buildControlledPhotoshopScriptBenchmarkReport(ready, toolCallPlan, verifiedExecution, {
    planningMs: 1,
    executionMs: 4,
    verificationMs: 1,
    totalMs: 6,
    sampleCount: 1
  });
  assert(
    sampledBenchmark.status === 'execution_sampled'
      && sampledBenchmark.executionStatus === 'completed_verified'
      && sampledBenchmark.measurement.totalMs === 6
      && sampledBenchmark.canClaimRuntimeSpeedup === false,
    'sampled benchmark should carry measurement records without claiming runtime speedup',
    sampledBenchmark
  );
  assertNoArbitraryExecutionPayload(sampledBenchmark, 'controlled script benchmark sampled report');

  const lightToDark = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    direction: 'light-to-dark',
    layers: buildColorLayers()
  });
  assert(
    JSON.stringify(lightToDark.sortedLayerIds) === JSON.stringify([102, 104, 103, 101]),
    'light-to-dark order should reverse computed lightness',
    lightToDark
  );

  const tooFew = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    layers: [{ layerId: 1, layerName: 'only one', colorHex: '#FFFFFF' }]
  });
  assert(tooFew.status === 'blocked_insufficient_targets', 'single target should block sorting', tooFew);

  const unknownColor = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    layers: buildColorLayers({ 103: { colorHex: null } })
  });
  assert(unknownColor.status === 'blocked_unreadable_color', 'unknown color should block lightness sorting', unknownColor);
  assert(unknownColor.skippedLayerIds.includes(103), 'unknown-color blocker should identify skipped layer', unknownColor);

  const locked = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    layers: buildColorLayers({ 102: { locked: true } })
  });
  assert(locked.status === 'blocked_locked_targets', 'locked target should block batch reorder', locked);
  assert(locked.skippedLayerIds.includes(102), 'locked target blocker should identify skipped layer', locked);

  const forbiddenScript = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    layers: buildColorLayers(),
    forbiddenArbitraryScript: 'app.activeDocument.activeLayer.remove()'
  });
  assert(
    forbiddenScript.status === 'blocked_forbidden_arbitrary_script',
    'arbitrary script payload must be rejected before planning',
    forbiddenScript
  );

  const forbiddenDescriptor = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    layers: buildColorLayers(),
    forbiddenBatchPlayDescriptors: [{ _obj: 'move' }]
  });
  assert(
    forbiddenDescriptor.status === 'blocked_forbidden_arbitrary_script',
    'raw batchPlay descriptor payload must be rejected before planning',
    forbiddenDescriptor
  );

  const mixedParents = buildControlledPhotoshopLayerLightnessSortPlan({
    kind: 'layer-lightness-sort',
    layers: buildColorLayers({
      101: { parentPath: ['颜色组 A'] },
      102: { parentPath: ['颜色组 A'] },
      103: { parentPath: ['颜色组 B'] },
      104: { parentPath: ['颜色组 A'] }
    })
  });
  const mixedParentToolPlan = buildControlledPhotoshopLayerLightnessSortToolCallPlan(mixedParents);
  assert(
    mixedParentToolPlan.status === 'blocked_mixed_parent_paths',
    'tool-call plan should block multi-parent reorder because reorderLayer relative order is same-parent only',
    mixedParentToolPlan
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'controlled layer-lightness sort emits a dry-run reorderLayer plan',
      'dry-run plan never writes Photoshop and never exposes arbitrary script or raw batchPlay',
      'dark-to-light and light-to-dark orders are deterministic',
      'insufficient targets, unreadable color and locked targets block execution',
      'arbitrary JS and raw batchPlay descriptor payloads are rejected',
      'ready dry-run plan compiles to an explicit-opt-in reorderLayer tool-call plan',
      'tool-call plan blocks mixed parent paths before any Photoshop write',
      'controlled execution requires explicit approval before adapter calls',
      'controlled execution stops on tool failure and verifies post-run layer order',
      'controlled execution classifies adapter throws, missing readback and readback throws',
      'benchmark report estimates model-decision reduction without claiming runtime or token wins',
      'efficiency estimate is limited to model round-trip reduction and does not claim design quality',
      'live smart-object smoke stops on stale UXP runtime schema before rasterizeSmartObject',
      'live smart-object smoke replacement PNG fixture is valid before replace-contents runs'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
