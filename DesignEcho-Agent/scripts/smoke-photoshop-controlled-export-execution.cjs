#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  buildControlledPhotoshopExportBatchPlan,
  buildControlledPhotoshopExportToolCallPlan,
  executeControlledPhotoshopExportToolCallPlan,
  buildControlledPhotoshopExportBenchmarkReport
} = require(path.join(repoRoot, 'src', 'shared', 'photoshop-controlled-export-execution.ts'));

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

function buildTargets() {
  return [
    {
      id: 'click-1x1',
      label: '点击图 1:1',
      groupPath: ['点击图', '1-1'],
      outputPath: 'C:/DesignEchoExports/click-1x1.png',
      format: 'png',
      targetWidth: 800,
      targetHeight: 800
    },
    {
      id: 'conversion-3x4',
      label: '转化图 3:4',
      groupPath: ['转化图', '3-4'],
      outputPath: 'C:/DesignEchoExports/conversion-3x4.png',
      format: 'png',
      maxSize: 1600
    },
    {
      id: 'layer-direct',
      label: '单图层导出',
      layerId: 442,
      outputPath: 'D:/DesignEchoExports/layer-direct.png',
      format: 'png'
    }
  ];
}

function createFakeExportAdapter(options = {}) {
  const calls = [];
  const exportedPaths = [];
  return {
    calls,
    exportedPaths,
    runToolCall: async (call) => {
      calls.push(call);
      if (options.failOutputPath && call.params.outputPath === options.failOutputPath) {
        return { success: false, error: `fake export failure for ${call.params.outputPath}` };
      }
      if (options.throwOutputPath && call.params.outputPath === options.throwOutputPath) {
        throw new Error(`fake export transport failure for ${call.params.outputPath}`);
      }
      exportedPaths.push(call.params.outputPath);
      return { success: true, data: { outputPath: call.params.outputPath } };
    },
    readExportedOutputPaths: options.noReadback
      ? undefined
      : async () => {
        if (options.throwReadback) throw new Error('fake filesystem readback failed');
        return options.readbackPaths || [...exportedPaths];
      }
  };
}

async function run() {
  const readyPlan = buildControlledPhotoshopExportBatchPlan({
    kind: 'group-export-batch',
    userIntent: '批量导出点击图和转化图',
    targets: buildTargets()
  });
  assert(readyPlan.status === 'ready_dry_run', 'valid export targets should produce a dry-run plan', readyPlan);
  assert(readyPlan.noPhotoshopWrites === true, 'export dry-run must not write Photoshop', readyPlan);
  assert(readyPlan.mustNotExecutePhotoshop === true, 'export dry-run helper must not execute Photoshop', readyPlan);
  assert(readyPlan.allowedTools.join(',') === 'exportGroup', 'controlled export plan should only allow exportGroup', readyPlan.allowedTools);
  assert(readyPlan.operations.length === 3, 'dry-run should record one export operation per target', readyPlan);
  assert(
    readyPlan.operations.every((operation) => operation.tool === 'exportGroup' && operation.format === 'png' && operation.actualResult === null),
    'dry-run export operations must be exportGroup PNG previews without actual results',
    readyPlan.operations
  );
  assert(
    readyPlan.efficiencyEstimate.baselineModelToolDecisions === 3
      && readyPlan.efficiencyEstimate.controlledPlanModelDecisions === 1
      && readyPlan.efficiencyEstimate.estimatedModelRoundTripReduction === 2,
    'efficiency estimate should describe model round-trip reduction without claiming runtime speedup',
    readyPlan.efficiencyEstimate
  );
  assertNoArbitraryExecutionPayload(readyPlan, 'ready controlled export plan');

  const toolCallPlan = buildControlledPhotoshopExportToolCallPlan(readyPlan);
  assert(toolCallPlan.status === 'ready_tool_call_plan', 'ready export dry-run should compile into a tool-call plan', toolCallPlan);
  assert(toolCallPlan.requiresExplicitLiveExecution === true, 'export tool-call plan must require explicit live execution opt-in', toolCallPlan);
  assert(toolCallPlan.noPhotoshopWrites === true, 'export tool-call plan builder must not write Photoshop', toolCallPlan);
  assert(toolCallPlan.toolCalls.length === 3, 'tool-call plan should include one exportGroup call per target', toolCallPlan);
  assert(
    toolCallPlan.toolCalls.every((call) => call.tool === 'exportGroup' && call.params.format === 'png'),
    'tool-call plan should use only white-listed exportGroup PNG calls',
    toolCallPlan.toolCalls
  );
  assert(
    toolCallPlan.verificationPlan.requiredTools.includes('filesystem-exists')
      && toolCallPlan.verificationPlan.expectedOutputPaths.length === 3,
    'tool-call plan should require exported file existence verification',
    toolCallPlan.verificationPlan
  );
  assertNoArbitraryExecutionPayload(toolCallPlan, 'controlled export tool-call plan');

  const estimateBenchmark = buildControlledPhotoshopExportBenchmarkReport(readyPlan, toolCallPlan);
  assert(estimateBenchmark.status === 'ready_estimate', 'export benchmark should expose a ready estimate before execution', estimateBenchmark);
  assert(
    estimateBenchmark.estimatedReduction.modelDecisionRoundTrips === 2
      && estimateBenchmark.estimatedReduction.photoshopWriteOperationCount === 0
      && estimateBenchmark.canClaimRuntimeSpeedup === false
      && estimateBenchmark.canClaimTokenReduction === false,
    'export benchmark must not claim Photoshop write reduction, runtime speedup or token reduction from one estimate',
    estimateBenchmark
  );

  const blockedAdapter = createFakeExportAdapter();
  const blockedExecution = await executeControlledPhotoshopExportToolCallPlan(toolCallPlan, blockedAdapter);
  assert(blockedExecution.status === 'blocked_explicit_live_approval_required', 'controlled export execution must require explicit approval', blockedExecution);
  assert(blockedAdapter.calls.length === 0, 'blocked export execution must not call adapter tools', blockedAdapter.calls);

  const verifiedAdapter = createFakeExportAdapter();
  const verifiedExecution = await executeControlledPhotoshopExportToolCallPlan(toolCallPlan, verifiedAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(verifiedExecution.status === 'completed_verified', 'fake export adapter execution should verify expected output paths', verifiedExecution);
  assert(verifiedExecution.executedToolCount === 3, 'verified export execution should attempt every planned tool call', verifiedExecution);
  assert(verifiedExecution.verificationReport.missingOutputPaths.length === 0, 'verified export execution should not report missing files', verifiedExecution.verificationReport);

  const missingReadbackExecution = await executeControlledPhotoshopExportToolCallPlan(toolCallPlan, createFakeExportAdapter({ noReadback: true }), {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(missingReadbackExecution.status === 'completed_needs_verification', 'missing exported-file readback should require review', missingReadbackExecution);

  const failingAdapter = createFakeExportAdapter({ failOutputPath: 'C:/DesignEchoExports/conversion-3x4.png' });
  const failedExecution = await executeControlledPhotoshopExportToolCallPlan(toolCallPlan, failingAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(failedExecution.status === 'failed_tool_call', 'controlled export execution should stop on first failed exportGroup call', failedExecution);
  assert(failedExecution.executedToolCount === 2, 'failed export execution should report attempted calls up to the failure', failedExecution);

  const throwingAdapter = createFakeExportAdapter({ throwOutputPath: 'C:/DesignEchoExports/conversion-3x4.png' });
  const thrownExecution = await executeControlledPhotoshopExportToolCallPlan(toolCallPlan, throwingAdapter, {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(thrownExecution.status === 'failed_tool_call', 'adapter exceptions should become failed_tool_call results', thrownExecution);

  const readbackFailedExecution = await executeControlledPhotoshopExportToolCallPlan(toolCallPlan, createFakeExportAdapter({ throwReadback: true }), {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(readbackFailedExecution.status === 'failed_verification_readback', 'readback exceptions should become failed_verification_readback', readbackFailedExecution);

  const mismatchExecution = await executeControlledPhotoshopExportToolCallPlan(toolCallPlan, createFakeExportAdapter({
    readbackPaths: ['C:/DesignEchoExports/click-1x1.png']
  }), {
    liveExecutionApproved: true,
    executionTarget: 'fake-adapter'
  });
  assert(mismatchExecution.status === 'completed_verification_failed', 'missing export files should fail verification', mismatchExecution);
  assert(mismatchExecution.verificationReport.missingOutputPaths.length === 2, 'verification failure should list missing output paths', mismatchExecution.verificationReport);

  const sampledBenchmark = buildControlledPhotoshopExportBenchmarkReport(readyPlan, toolCallPlan, verifiedExecution);
  assert(sampledBenchmark.status === 'execution_sampled', 'benchmark should mark execution_sampled after an execution result', sampledBenchmark);
  assert(sampledBenchmark.canClaimRuntimeSpeedup === false && sampledBenchmark.canClaimDesignQuality === false, 'sampled export benchmark still cannot claim runtime or design quality', sampledBenchmark);

  const blockedCases = [
    {
      name: 'empty targets',
      expected: 'blocked_empty_targets',
      input: { kind: 'group-export-batch', targets: [] }
    },
    {
      name: 'unsupported format',
      expected: 'blocked_unsupported_format',
      input: { kind: 'group-export-batch', targets: [{ groupPath: ['A'], outputPath: 'C:/out/a.jpg', format: 'jpg' }] }
    },
    {
      name: 'invalid selector none',
      expected: 'blocked_invalid_targets',
      input: { kind: 'group-export-batch', targets: [{ outputPath: 'C:/out/a.png', format: 'png' }] }
    },
    {
      name: 'invalid selector both',
      expected: 'blocked_invalid_targets',
      input: { kind: 'group-export-batch', targets: [{ groupPath: ['A'], layerId: 1, outputPath: 'C:/out/a.png', format: 'png' }] }
    },
    {
      name: 'unsafe relative path',
      expected: 'blocked_unsafe_output_path',
      input: { kind: 'group-export-batch', targets: [{ groupPath: ['A'], outputPath: '../out/a.png', format: 'png' }] }
    },
    {
      name: 'duplicate output path',
      expected: 'blocked_duplicate_output_path',
      input: { kind: 'group-export-batch', targets: [
        { groupPath: ['A'], outputPath: 'C:/out/a.png', format: 'png' },
        { groupPath: ['B'], outputPath: 'C:/out/a.png', format: 'png' }
      ] }
    },
    {
      name: 'forbidden script payload',
      expected: 'blocked_forbidden_arbitrary_script',
      input: { kind: 'group-export-batch', targets: buildTargets(), forbiddenArbitraryScript: 'app.batchPlay(...)' }
    }
  ];

  for (const blockedCase of blockedCases) {
    const plan = buildControlledPhotoshopExportBatchPlan(blockedCase.input);
    assert(plan.status === blockedCase.expected, `blocked case should return ${blockedCase.expected}: ${blockedCase.name}`, plan);
    const blockedToolPlan = buildControlledPhotoshopExportToolCallPlan(plan);
    assert(blockedToolPlan.status === 'blocked_plan_not_ready', `blocked case should not compile tool calls: ${blockedCase.name}`, blockedToolPlan);
    assertNoArbitraryExecutionPayload(plan, `blocked export plan: ${blockedCase.name}`);
  }

  console.log(JSON.stringify({
    success: true,
    checks: [
      'export dry-run compiles only safe PNG exportGroup operations',
      'tool-call plan requires explicit live approval and exported-file verification',
      'fake adapter execution verifies expected output paths',
      'tool failure, thrown adapter errors, missing readback, readback failure and missing files stay structured',
      'unsafe paths, duplicate outputs, invalid selectors, unsupported formats and arbitrary script payloads are blocked',
      'benchmark remains no-overclaim and cannot claim runtime speedup, token reduction or design quality'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
