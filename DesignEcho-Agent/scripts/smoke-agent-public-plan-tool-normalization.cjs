#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

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

function baseAgentTaskPlan() {
  return {
    version: 'agent-task-planning-contract/v0',
    status: 'ready_for_model_planning',
    requestKind: 'autonomous_execution',
    allowedToolScope: 'write_photoshop',
    route: 'autonomous_agent',
    skillId: 'autonomous-agent',
    executionPlan: {
      canExecuteTools: false,
      requiresUserApproval: true,
      verificationTargets: []
    },
    requiredInputs: []
  };
}

function run() {
  const aliasedRequest = buildAgentTaskPublicPlanExecutionRequest({
    agentTaskPlan: baseAgentTaskPlan(),
    publicPlan: {
      status: 'ready',
      canExecuteTools: false,
      message: '计划创建临时文档、图层组、矩形和文字，等待确认后执行。',
      proposedWriteTools: [
        'createDocument',
        'createLayerGroup',
        'createRectangleLayer',
        'createTextLayer'
      ],
      readbackTargets: ['layer_hierarchy'],
      executionPlanSummary: '新建临时文档并创建图层组、矩形图层和文字图层。'
    },
    runtimeOperationRequests: [
      {
        operationId: 'op-document',
        toolName: 'createDocument',
        params: {
          name: 'Agent真实工具调用验证',
          width: 800,
          height: 600,
          backgroundColor: 'transparent'
        },
        paramsSummary: '创建临时文档',
        readbackTargets: ['document_info']
      },
      {
        operationId: 'op-group',
        toolName: 'createLayerGroup',
        params: { name: 'Agent真实调用验证组' },
        paramsSummary: '创建图层组',
        readbackTargets: ['layer_hierarchy']
      },
      {
        operationId: 'op-rectangle',
        toolName: 'createRectangleLayer',
        params: {
          name: 'Agent真实调用验证矩形',
          x: 120,
          y: 150,
          width: 260,
          height: 160,
          color: '#2F80ED'
        },
        paramsSummary: '创建矩形图层',
        readbackTargets: ['layer_hierarchy']
      },
      {
        operationId: 'op-text',
        toolName: 'createTextLayer',
        params: {
          name: 'Agent真实调用验证文字',
          content: 'Agent真实调用验证',
          x: 140,
          y: 230,
          fontSize: 32
        },
        paramsSummary: '创建文字图层',
        readbackTargets: ['layer_hierarchy']
      }
    ],
    userConfirmed: false,
    requestId: 'public-plan-tool-normalization-smoke'
  });

  assert(
    aliasedRequest.status === 'blocked_pending_user_confirmation',
    'known model-authored Photoshop tool aliases should normalize before allowlist checks',
    aliasedRequest
  );
  assert(
    aliasedRequest.blockedWriteTools.length === 0,
    'known aliases must not remain in blockedWriteTools',
    aliasedRequest
  );
  assert(
    aliasedRequest.proposedWriteTools.includes('createGroup')
      && aliasedRequest.proposedWriteTools.includes('createRectangle')
      && !aliasedRequest.proposedWriteTools.includes('createLayerGroup')
      && !aliasedRequest.proposedWriteTools.includes('createRectangleLayer'),
    'public request should expose canonical Photoshop runtime tool names',
    aliasedRequest
  );
  assert(
    aliasedRequest.operationRequests.some((operation) => operation.toolName === 'createGroup')
      && aliasedRequest.operationRequests.some((operation) => operation.toolName === 'createRectangle'),
    'runtime operation drafts should normalize known tool aliases too',
    aliasedRequest.operationRequests
  );
  assert(
    aliasedRequest.warnings.some((warning) =>
      warning.includes('createLayerGroup') && warning.includes('createGroup')
    ),
    'alias normalization must be visible in warnings instead of silently rewriting the plan',
    aliasedRequest.warnings
  );

  const missingReadbackRequest = buildAgentTaskPublicPlanExecutionRequest({
    agentTaskPlan: baseAgentTaskPlan(),
    publicPlan: {
      status: 'ready',
      canExecuteTools: false,
      message: '计划创建一个图层组，等待确认后执行。',
      proposedWriteTools: ['createLayerGroup'],
      readbackTargets: [],
      executionPlanSummary: '创建图层组并读回图层结构。'
    },
    runtimeOperationRequests: [
      {
        operationId: 'op-group',
        toolName: 'createLayerGroup',
        params: { name: 'Agent真实调用验证组' },
        paramsSummary: '创建图层组',
        readbackTargets: ['layer_hierarchy']
      }
    ],
    userConfirmed: false,
    requestId: 'public-plan-tool-normalization-readback-smoke'
  });

  assert(
    missingReadbackRequest.status === 'blocked_pending_user_confirmation',
    'top-level missing readback targets should merge operation-level readback targets instead of becoming unconfirmable',
    missingReadbackRequest
  );
  assert(
    missingReadbackRequest.readbackTargets.includes('layer_hierarchy'),
    'request-level readback targets should include operation-level layer_hierarchy',
    missingReadbackRequest
  );
  assert(
    missingReadbackRequest.operationRequests.every((operation) =>
      operation.readbackTargets.includes('layer_hierarchy')
    ),
    'operation drafts should inherit default readback targets',
    missingReadbackRequest.operationRequests
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'known public-plan tool aliases normalize before allowlist checks',
      'normalized aliases are reported in warnings',
      'operation requests use canonical Photoshop runtime tool names',
      'operation-level readback targets are promoted when the top-level plan omits them'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
}
