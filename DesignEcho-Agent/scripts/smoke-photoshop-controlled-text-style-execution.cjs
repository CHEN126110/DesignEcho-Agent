const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildControlledPhotoshopTextStyleBatchPlan,
  buildControlledPhotoshopTextStyleToolCallPlan,
  executeControlledPhotoshopTextStyleToolCallPlan,
  buildControlledPhotoshopTextStyleBenchmarkReport
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'photoshop-controlled-text-style-execution.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

function assertCase(name, passed, details) {
  record(name, passed, details);
}

function sampleTargets() {
  return [
    {
      layerId: 101,
      layerName: '标题',
      kind: 'text',
      style: { fontName: '原字体', fontSize: 42, tracking: 0, leading: 48 }
    },
    {
      layerId: 102,
      layerName: '副标题',
      kind: 'text',
      style: { fontName: '原字体', fontSize: 24, tracking: 0, leading: 30 }
    }
  ];
}

async function main() {
  const plan = buildControlledPhotoshopTextStyleBatchPlan({
    kind: 'text-style-batch',
    userIntent: '把选中文本改成思源黑体，字号 28，字距 20',
    targets: sampleTargets(),
    style: {
      fontName: '思源黑体',
      acceptedFontNames: ['Source Han Sans SC'],
      fontSize: 28,
      tracking: 20,
      leading: 34
    }
  });

  assertCase(
    'ready-dry-run-has-no-photoshop-writes',
    plan.status === 'ready_dry_run'
      && plan.noPhotoshopWrites === true
      && plan.mustNotExecutePhotoshop === true
      && plan.allowsArbitraryScript === false
      && plan.allowsArbitraryBatchPlay === false
      && plan.operations.length === 2
      && plan.operations.every((operation) => operation.tool === 'setTextStyle'),
    plan
  );

  const noTargetsPlan = buildControlledPhotoshopTextStyleBatchPlan({
    kind: 'text-style-batch',
    targets: [],
    style: { fontName: '思源黑体' }
  });
  assertCase('blocks-empty-targets', noTargetsPlan.status === 'blocked_insufficient_targets', noTargetsPlan);

  const noChangesPlan = buildControlledPhotoshopTextStyleBatchPlan({
    kind: 'text-style-batch',
    targets: sampleTargets(),
    style: {}
  });
  assertCase('blocks-no-style-changes', noChangesPlan.status === 'blocked_no_style_changes', noChangesPlan);

  const invalidStylePlan = buildControlledPhotoshopTextStyleBatchPlan({
    kind: 'text-style-batch',
    targets: sampleTargets(),
    style: { fontSize: 0, tracking: 1200, leading: -1 }
  });
  assertCase('blocks-invalid-style-values', invalidStylePlan.status === 'blocked_invalid_style', invalidStylePlan);

  const lockedPlan = buildControlledPhotoshopTextStyleBatchPlan({
    kind: 'text-style-batch',
    targets: [{ ...sampleTargets()[0], locked: true }],
    style: { fontName: '思源黑体' }
  });
  assertCase('blocks-locked-targets', lockedPlan.status === 'blocked_locked_targets', lockedPlan);

  const invalidTargetsPlan = buildControlledPhotoshopTextStyleBatchPlan({
    kind: 'text-style-batch',
    targets: [
      { layerId: Number.NaN, layerName: '非法目标' },
      { layerId: 101, layerName: '重复 A' },
      { layerId: 101, layerName: '重复 B' }
    ],
    style: { fontName: '思源黑体' }
  });
  assertCase('blocks-invalid-or-duplicate-targets', invalidTargetsPlan.status === 'blocked_invalid_targets', invalidTargetsPlan);

  const forbiddenPlan = buildControlledPhotoshopTextStyleBatchPlan({
    kind: 'text-style-batch',
    targets: sampleTargets(),
    style: { fontName: '思源黑体' },
    forbiddenArbitraryScript: 'app.activeDocument.activeLayer.textItem.font = "x"'
  });
  assertCase('blocks-arbitrary-script', forbiddenPlan.status === 'blocked_forbidden_arbitrary_script', forbiddenPlan);

  const toolCallPlan = buildControlledPhotoshopTextStyleToolCallPlan(plan);
  assertCase(
    'compiles-to-whitelisted-tool-plan',
    toolCallPlan.status === 'ready_tool_call_plan'
      && toolCallPlan.requiresExplicitLiveExecution === true
      && toolCallPlan.noPhotoshopWrites === true
      && toolCallPlan.toolCalls.length === 2
      && toolCallPlan.toolCalls.every((call) => call.tool === 'setTextStyle')
      && toolCallPlan.verificationPlan.requiredTools.includes('getAllTextLayers'),
    toolCallPlan
  );

  let blockedAdapterCalled = false;
  const blockedExecution = await executeControlledPhotoshopTextStyleToolCallPlan(toolCallPlan, {
    async runToolCall() {
      blockedAdapterCalled = true;
      return { success: true };
    }
  }, { executionTarget: 'fake-adapter' });
  assertCase(
    'execution-requires-explicit-approval',
    blockedExecution.status === 'blocked_explicit_live_approval_required' && blockedAdapterCalled === false,
    blockedExecution
  );

  const verifiedExecution = await executeControlledPhotoshopTextStyleToolCallPlan(toolCallPlan, {
    async runToolCall(call) {
      return { success: true, data: { layerId: call.params.layerId } };
    },
    async readTargetTextStyles() {
      return sampleTargets().map((target) => ({
        layerId: target.layerId,
        layerName: target.layerName,
        style: {
          fontName: target.layerId === 101 ? '思源黑体' : 'Source Han Sans SC',
          fontSize: 28.4,
          tracking: 20.5,
          leading: 34.4
        }
      }));
    }
  }, { liveExecutionApproved: true, executionTarget: 'fake-adapter' });
  assertCase('execution-verifies-readback', verifiedExecution.status === 'completed_verified', verifiedExecution);

  const mismatchExecution = await executeControlledPhotoshopTextStyleToolCallPlan(toolCallPlan, {
    async runToolCall() {
      return { success: true };
    },
    async readTargetTextStyles() {
      return sampleTargets().map((target) => ({
        layerId: target.layerId,
        style: { fontName: '原字体', fontSize: 18, tracking: 0, leading: 24 }
      }));
    }
  }, { liveExecutionApproved: true, executionTarget: 'fake-adapter' });
  assertCase(
    'execution-reports-verification-mismatch',
    mismatchExecution.status === 'completed_verification_failed'
      && mismatchExecution.verificationReport.mismatches.length > 0,
    mismatchExecution
  );

  const failedToolExecution = await executeControlledPhotoshopTextStyleToolCallPlan(toolCallPlan, {
    async runToolCall() {
      throw new Error('setTextStyle exploded');
    }
  }, { liveExecutionApproved: true, executionTarget: 'fake-adapter' });
  assertCase('execution-reports-tool-failure', failedToolExecution.status === 'failed_tool_call', failedToolExecution);

  const needsVerificationExecution = await executeControlledPhotoshopTextStyleToolCallPlan(toolCallPlan, {
    async runToolCall() {
      return { success: true };
    }
  }, { liveExecutionApproved: true, executionTarget: 'fake-adapter' });
  assertCase('execution-needs-verification-without-readback', needsVerificationExecution.status === 'completed_needs_verification', needsVerificationExecution);

  const failedReadbackExecution = await executeControlledPhotoshopTextStyleToolCallPlan(toolCallPlan, {
    async runToolCall() {
      return { success: true };
    },
    async readTargetTextStyles() {
      throw new Error('readback failed');
    }
  }, { liveExecutionApproved: true, executionTarget: 'fake-adapter' });
  assertCase('execution-reports-readback-failure', failedReadbackExecution.status === 'failed_verification_readback', failedReadbackExecution);

  const benchmark = buildControlledPhotoshopTextStyleBenchmarkReport(plan, toolCallPlan, verifiedExecution);
  assertCase(
    'benchmark-does-not-overclaim',
    benchmark.canClaimRuntimeSpeedup === false
      && benchmark.canClaimTokenReduction === false
      && benchmark.canClaimDesignQuality === false
      && benchmark.canClaimDesignComplete === false
      && benchmark.plannedPhotoshopWriteOperationCount === 2,
    benchmark
  );
}

main().catch((error) => {
  record('unexpected-exception', false, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  });
}).finally(() => {
  const failed = cases.filter((item) => item.status !== 'pass');
  const report = {
    generatedAt: new Date().toISOString(),
    success: failed.length === 0,
    cases
  };

  const jsonPath = path.join(tmpDir, 'photoshop-controlled-text-style-execution-smoke.json');
  const mdPath = path.join(tmpDir, 'photoshop-controlled-text-style-execution-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Photoshop Controlled Text Style Execution Smoke',
      '',
      `success: ${report.success}`,
      '',
      ...cases.map((item) => `- ${item.name}: ${item.status}`)
    ].join('\n'),
    'utf8'
  );

  console.log(JSON.stringify({
    success: report.success,
    cases: cases.map(({ name, status }) => ({ name, status })),
    report: { json: jsonPath, md: mdPath }
  }, null, 2));

  process.exit(report.success ? 0 : 1);
});
