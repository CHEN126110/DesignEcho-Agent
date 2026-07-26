const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  createPublicPlanPhotoshopAdapter
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'public-plan-photoshop-adapter.ts'));
const {
  runAgentTaskPublicPlanControlledRunnerAsync
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-controlled-runner.ts'));
const {
  buildAgentTaskPublicPlanExecutionRequest
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-execution-request.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function makeReadyRequest() {
  return buildAgentTaskPublicPlanExecutionRequest({
    agentTaskPlan: {
      version: 'agent-task-planning-contract/v0',
      status: 'ready_for_model_planning',
      requestKind: 'autonomous_execution',
      allowedToolScope: 'write_photoshop',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      executionPlan: {
        requiresUserApproval: true
      }
    },
    publicPlan: {
      status: 'ready',
      canExecuteTools: false,
      message: '公开计划：创建标题并移动图层。',
      proposedWriteTools: ['createTextLayer', 'moveLayer'],
      writeToolAllowlist: ['createTextLayer', 'moveLayer'],
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
      executionPlanSummary: '创建标题并移动图层。'
    },
    allowedWriteTools: ['createTextLayer', 'moveLayer'],
    runtimeOperationRequests: [
      {
        operationId: 'op-title',
        toolName: 'createTextLayer',
        params: { content: '轻盈透气', x: 160, y: 180, fontSize: 48 },
        paramsSummary: '创建标题文字',
        readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
      },
      {
        operationId: 'op-move-title',
        toolName: 'moveLayer',
        params: { layerId: 501, x: 20, y: 0, relative: true },
        paramsSummary: '移动标题图层',
        readbackTargets: ['layer_properties']
      }
    ],
    userConfirmed: true,
    enableControlledExecutionRequest: true
  });
}

async function run() {
  const blockedMissingApproval = createPublicPlanPhotoshopAdapter({
    executeTool: async () => ({ success: true }),
    executionScope: 'disposable-document'
  });
  assert(
    blockedMissingApproval.status === 'blocked_requires_explicit_live_approval'
      && blockedMissingApproval.adapter === null
      && blockedMissingApproval.canWritePhotoshop === false,
    'adapter must require explicit live adapter approval',
    blockedMissingApproval
  );

  const blockedScope = createPublicPlanPhotoshopAdapter({
    executeTool: async () => ({ success: true }),
    approvedLiveAdapterRun: true,
    executionScope: 'explicit-project-document'
  });
  assert(
    blockedScope.status === 'blocked_non_disposable_scope'
      && blockedScope.adapter === null,
    'adapter must only allow disposable-document scope',
    blockedScope
  );

  const toolCalls = [];
  const ready = createPublicPlanPhotoshopAdapter({
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document',
    executeTool: async (toolName, params) => {
      toolCalls.push({ toolName, params });
      if (toolName === 'createTextLayer') return { success: true, layerId: 501, toolName };
      if (toolName === 'moveLayer') return { success: true, moved: true, toolName };
      if (toolName === 'getLayerHierarchy') return { success: true, hierarchy: [{ id: 501, name: '轻盈透气' }] };
      if (toolName === 'getAllTextLayers') return { success: true, layers: [{ id: 501, contents: '轻盈透气' }] };
      if (toolName === 'getAcceptanceSnapshot') return { success: true, layers: [{ id: 501, bounds: [160, 180, 360, 238] }] };
      if (toolName === 'getLayerProperties') return { success: true, layerId: params.layerId, bounds: [180, 180, 380, 238] };
      return { success: false, error: `unexpected tool ${toolName}` };
    }
  });
  assert(
    ready.status === 'ready_for_guarded_live_adapter'
      && ready.adapter
      && ready.canWritePhotoshop === true
      && ready.canClaimDesignComplete === false
      && ready.canClaimOutputQuality === false,
    'adapter should be ready only with explicit approval and disposable scope',
    ready
  );

  const runResult = await runAgentTaskPublicPlanControlledRunnerAsync({
    request: makeReadyRequest(),
    executionTarget: 'live-photoshop',
    allowPhotoshopWrites: true,
    liveExecutionScope: 'disposable-document',
    adapter: ready.adapter
  });
  assert(runResult.status === 'completed_live_adapter_verified', 'async runner should complete through guarded adapter', runResult);
  assert(runResult.mustNotClaimTaskCompletion === true, 'adapter run must not claim task completion', runResult);
  assert(
    toolCalls.map((call) => call.toolName).join(',') === 'createTextLayer,getLayerHierarchy,getAllTextLayers,getAcceptanceSnapshot,moveLayer,getLayerProperties',
    'adapter should execute writes and mapped readbacks in order',
    toolCalls
  );
  assert(
    toolCalls[4].params.layerId === 501,
    'layer_properties readback should prefer operation layerId',
    toolCalls
  );

  const saveToolCalls = [];
  const saveReady = createPublicPlanPhotoshopAdapter({
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document',
    projectPath: 'E:\\DesignEchoDemo\\C-1194',
    executeTool: async (toolName, params) => {
      saveToolCalls.push({ toolName, params });
      return { success: true, savedPath: params.path, format: params.format };
    }
  });
  assert(saveReady.adapter, 'save adapter should be ready with project path', saveReady);
  const saveResult = await saveReady.adapter.runWriteOperation({
    operationId: 'save-detail-page',
    toolName: 'saveDocument',
    params: { format: 'png', projectSubdir: '详情页', quality: 12 },
    paramsSummary: '保存到详情页目录',
    readbackTargets: []
  });
  assert(saveResult.success === true, 'save operation should run after adapter resolves projectSubdir', saveResult);
  assert(
    saveToolCalls[0]?.toolName === 'quickExport'
      && saveToolCalls[0]?.params?.format === 'png'
      && saveToolCalls[0]?.params?.outputPath === 'E:\\DesignEchoDemo\\C-1194\\详情页'
      && typeof saveToolCalls[0]?.params?.suffix === 'string'
      && saveToolCalls[0].params.suffix.includes('详情页')
      && !saveToolCalls[0].params.suffix.includes('detail-page-')
      && !('projectSubdir' in saveToolCalls[0].params),
    'adapter should map detail-page image saveDocument projectSubdir requests to a Chinese role-named silent quickExport path before calling Photoshop',
    saveToolCalls
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'explicit approval required',
      'non-disposable scope blocked',
      'executeToolCall-style adapter maps write operations',
      'readback targets map to existing Photoshop read tools',
      'detail-page projectSubdir saves use Chinese role names instead of English timestamp defaults',
      'controlled runner awaits adapter and preserves no-quality-claim boundary'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
