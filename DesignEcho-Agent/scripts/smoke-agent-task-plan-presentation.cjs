#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const {
  buildAgentTaskPlanPresentation,
  decideAgentTaskPlanPresentationUpdate,
  shouldAcceptAgentTaskPlanPresentationUpdate
} = require(path.join(ROOT, 'src', 'shared', 'agent-task-plan-presentation.ts'));
const {
  convertLegacyMessage
} = require(path.join(ROOT, 'src', 'renderer', 'components', 'message', 'parser.ts'));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function createTaskPlan() {
  return {
    designBrief: {
      goal: '把当前详情页文案改为突出透气，并复核写入结果'
    }
  };
}

function createDeclaration() {
  const steps = [
    {
      stepId: 'observe-copy',
      kind: 'observe',
      goal: '读取并确认目标文案',
      dependsOn: []
    },
    {
      stepId: 'write-copy',
      kind: 'mutate',
      goal: '写入突出透气的新文案',
      dependsOn: ['observe-copy']
    },
    {
      stepId: 'deliver-copy',
      kind: 'deliver',
      goal: '交付并说明修改结果',
      dependsOn: ['write-copy']
    }
  ];
  return {
    version: 'runtime-action-plan-declaration/v0',
    readiness: 'ready',
    payload: {
      planGoal: '修改并复核文案',
      steps
    }
  };
}

function createRuntimeSessionDigest(generation = 1, runId = 'run-1') {
  return {
    version: 'runtime-session-digest/v0',
    sessionId: 'runtime-task-1',
    runId,
    generation
  };
}

function createRuntimeUpdate() {
  return {
    version: 'runtime-action-plan-reconciliation/v0',
    steps: [
      {
        stepId: 'observe-copy',
        kind: 'observe',
        status: 'completed'
      },
      {
        stepId: 'write-copy',
        kind: 'mutate',
        status: 'in_progress'
      },
      {
        stepId: 'deliver-copy',
        kind: 'deliver',
        status: 'ready'
      }
    ],
    metrics: { observationCount: 2 }
  };
}

function createRuntimeTaskSnapshot(overrides = {}) {
  return {
    version: 'runtime-task-snapshot/v0',
    identity: {
      sessionId: 'runtime-task-1',
      runId: 'run-1',
      generation: 1
    },
    goal: {
      text: '把当前详情页文案改为突出透气，并复核写入结果',
      source: 'request_task_plan'
    },
    actionPlan: {
      readiness: 'ready',
      goal: '修改并复核文案',
      presentationRevision: 7,
      presentationRevisionHash: build().identity.revisionHash,
      reconciliationStatus: 'in_progress',
      steps: [
        {
          stepId: 'observe-copy',
          kind: 'observe',
          goal: '读取并确认目标文案',
          status: 'completed'
        },
        {
          stepId: 'write-copy',
          kind: 'mutate',
          goal: '写入突出透气的新文案',
          status: 'in_progress'
        },
        {
          stepId: 'deliver-copy',
          kind: 'deliver',
          goal: '交付并说明修改结果',
          status: 'ready'
        }
      ]
    },
    ...overrides
  };
}

function build(input = {}) {
  return buildAgentTaskPlanPresentation({
    taskPlan: createTaskPlan(),
    declaration: createDeclaration(),
    runtimeSessionDigest: createRuntimeSessionDigest(),
    runtimeStageTrace: {
      events: [{ stage: 'R4', source: 'action_plan_declaration', sequence: 7 }]
    },
    conversationId: 'conversation-1',
    projectId: 'project-1',
    ...input
  });
}

check('runtime result is converted once into generic step status', () => {
  const pending = build();
  assert.deepStrictEqual(pending.steps.map((step) => step.status), [
    'pending',
    'pending',
    'pending'
  ]);

  const reconciled = build({ reconciliation: createRuntimeUpdate() });
  assert.deepStrictEqual(reconciled.steps.map((step) => step.status), [
    'completed',
    'running',
    'pending'
  ]);
  assert.strictEqual(
    reconciled.steps.find((step) => step.id === 'deliver-copy').status,
    'pending',
    'a step without a matching runtime outcome must remain pending'
  );
});

check('runtime task snapshot is the preferred source and remains compatible with the legacy projection', () => {
  const legacy = build({ reconciliation: createRuntimeUpdate() });
  const snapshot = build({ runtimeTaskSnapshot: createRuntimeTaskSnapshot() });
  assert.deepStrictEqual(snapshot, legacy);

  const v1Snapshot = build({
    runtimeTaskSnapshot: createRuntimeTaskSnapshot({
      version: 'runtime-task-snapshot/v1',
      artifactRefs: [{
        artifactId: 'artifact-preview-1',
        artifactType: 'preview_scene',
        contentHash: `sha256-jcs-v1:${'a'.repeat(64)}`
      }],
      sources: {
        artifactRepository: 'artifact-repository-read-projection/v0'
      },
      boundaries: {
        artifactRefsOnly: true,
        artifactRepositoryConnected: true
      }
    })
  });
  assert.deepStrictEqual(v1Snapshot, legacy);
  assert(!JSON.stringify(v1Snapshot).includes('artifact-preview-1'));
  assert(!JSON.stringify(v1Snapshot).includes('contentHash'));

  const preferred = build({
    taskPlan: { designBrief: { goal: '旧目标不得覆盖快照' } },
    runtimeSessionDigest: createRuntimeSessionDigest(9, 'legacy-run'),
    runtimeTaskSnapshot: createRuntimeTaskSnapshot({
      identity: {
        sessionId: 'snapshot-session',
        runId: 'snapshot-run',
        generation: 3
      },
      goal: {
        text: '快照目标',
        source: 'request_task_plan'
      },
      actionPlan: {
        ...createRuntimeTaskSnapshot().actionPlan,
        presentationRevision: 11,
        presentationRevisionHash: 'r4-snapshot',
        steps: [{
          stepId: 'snapshot-step',
          kind: 'verify',
          goal: '使用快照步骤',
          status: 'failed'
        }]
      }
    })
  });
  assert.strictEqual(preferred.identity.sessionId, 'snapshot-session');
  assert.strictEqual(preferred.identity.runId, 'snapshot-run');
  assert.strictEqual(preferred.identity.generation, 3);
  assert.strictEqual(preferred.identity.revision, 11);
  assert.strictEqual(preferred.identity.revisionHash, 'r4-snapshot');
  assert.strictEqual(preferred.goal, '快照目标');
  assert.deepStrictEqual(preferred.steps, [{
    id: 'snapshot-step',
    kind: 'verify',
    label: '使用快照步骤',
    status: 'failed'
  }]);

  const presentButUnprojectable = build({
    runtimeTaskSnapshot: {
      version: 'runtime-task-snapshot/v0',
      identity: {
        sessionId: 'snapshot-session',
        runId: 'snapshot-run',
        generation: 3
      },
      goal: {
        text: '存在但不可投影的快照',
        source: 'request_task_plan'
      }
    }
  });
  assert.strictEqual(
    presentButUnprojectable,
    undefined,
    'a present snapshot must never fall back to potentially stale legacy plan inputs'
  );
  assert.strictEqual(
    build({ runtimeTaskSnapshot: null }),
    undefined,
    'a rejected snapshot reader result must not resurrect legacy plan inputs'
  );
});

check('persisted presentation contains only identity, goal and generic step states', () => {
  const presentation = build({ reconciliation: createRuntimeUpdate() });
  const serialized = JSON.stringify(presentation).toLowerCase();
  assert.deepStrictEqual(Object.keys(presentation).sort(), ['goal', 'identity', 'steps', 'version']);
  assert.deepStrictEqual(Object.keys(presentation.identity).sort(), [
    'conversationId',
    'generation',
    'projectId',
    'revision',
    'revisionHash',
    'runId',
    'sessionId'
  ]);
  assert.deepStrictEqual(Object.keys(presentation.steps[0]).sort(), ['id', 'kind', 'label', 'status']);
  for (const forbidden of [
    'evidence',
    'quality',
    'taskprogress',
    'boundaries',
    'source',
    'capabilityRefs',
    'completionCriteria',
    'attributions',
    'toolName',
    'executionSummary',
    'artifactRefs',
    'contentHash'
  ]) {
    assert(!serialized.includes(forbidden.toLowerCase()), `presentation must not persist ${forbidden}`);
  }
});

check('session, generation and plan revision guard updates while status can advance', () => {
  const current = build();
  const lateGeneration = build({
    runtimeSessionDigest: createRuntimeSessionDigest(0, 'run-0')
  });
  assert.strictEqual(
    decideAgentTaskPlanPresentationUpdate({ current, next: lateGeneration }),
    'reject_invalid_next'
  );

  const currentGenerationTwo = build({
    runtimeSessionDigest: createRuntimeSessionDigest(2, 'run-2'),
    reconciliation: createRuntimeUpdate()
  });
  assert.strictEqual(
    decideAgentTaskPlanPresentationUpdate({ current: currentGenerationTwo, next: current }),
    'reject_late_generation'
  );

  const lateRevision = build({
    runtimeStageTrace: {
      events: [{ stage: 'R4', source: 'action_plan_declaration', sequence: 6 }]
    }
  });
  assert.strictEqual(
    decideAgentTaskPlanPresentationUpdate({ current, next: lateRevision }),
    'reject_late_revision'
  );

  const nextStatus = build({ reconciliation: createRuntimeUpdate() });
  assert.strictEqual(
    decideAgentTaskPlanPresentationUpdate({ current, next: nextStatus }),
    'accept_status_update'
  );
  assert.strictEqual(
    shouldAcceptAgentTaskPlanPresentationUpdate({ current, next: nextStatus }),
    true
  );

  const wrongScope = build({ projectId: 'project-2' });
  assert.strictEqual(
    decideAgentTaskPlanPresentationUpdate({ current, next: wrongScope }),
    'reject_scope_mismatch'
  );
});

check('history remains compatible and non-completed task results keep their authority', () => {
  const completedSummary = {
    status: 'completed',
    stopReason: 'final_response',
    successfulToolCalls: 1,
    failedToolCalls: 0,
    acceptanceVerified: 1,
    acceptanceFailed: 0,
    acceptanceNeedsReview: 0,
    summaryText: '已完成'
  };
  const legacy = convertLegacyMessage({
    id: 'legacy-message',
    role: 'assistant',
    content: '完成说明',
    timestamp: 1,
    executionSummary: completedSummary
  });
  assert(legacy.blocks.some((block) => block.type === 'card'));
  assert(!legacy.blocks.some((block) => block.type === 'task_plan'));

  const presentation = build({ reconciliation: createRuntimeUpdate() });
  const unifiedCompleted = convertLegacyMessage({
    id: 'unified-completed',
    role: 'assistant',
    content: '完成说明',
    timestamp: 2,
    executionSummary: completedSummary,
    agentTaskPlanPresentation: presentation
  });
  assert.strictEqual(
    unifiedCompleted.blocks.filter((block) => block.type === 'task_plan').length,
    1
  );
  assert(!unifiedCompleted.blocks.some((block) => block.type === 'card'));

  const unifiedFailed = convertLegacyMessage({
    id: 'unified-failed',
    role: 'assistant',
    content: '失败说明',
    timestamp: 3,
    executionSummary: {
      ...completedSummary,
      status: 'failed',
      successfulToolCalls: 0,
      failedToolCalls: 1,
      summaryText: '未完成'
    },
    agentTaskPlanPresentation: presentation
  });
  assert(unifiedFailed.blocks.some((block) => block.type === 'task_plan'));
  assert(unifiedFailed.blocks.some((block) => block.type === 'card'));
});

check('one TaskPlanBlock serves live updates and history while authoritative HITL remains visible', () => {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const parser = read('src/renderer/components/message/parser.ts');
  const renderer = read('src/renderer/components/message/MessageRenderer.tsx');
  const component = read('src/renderer/components/message/blocks/TaskPlanBlock.tsx');
  const store = read('src/renderer/stores/app.store.ts');
  const orchestrationTypes = read('src/renderer/services/agent-orchestration/types.ts');
  const executor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
  const runtimeTypes = read('src/renderer/services/agent-runtime/types.ts');
  const runtimeAgent = read('src/renderer/services/agent-runtime/agent.ts');
  const runRecord = read('src/shared/agent-run-record.ts');

  assert(chatPanel.includes('onTaskPlanPresentation: (presentation) =>'));
  assert(chatPanel.includes('streamedAssistantMessageId'));
  assert(chatPanel.includes('{ agentTaskPlanPresentation: presentation }'));
  assert(chatPanel.includes('buildAgentTaskPlanPresentation({'));
  assert(chatPanel.includes('readRuntimeTaskSnapshot(runtimeResultData.runtimeTaskSnapshot)'));
  assert(chatPanel.includes('hasRuntimeTaskSnapshot ? { runtimeTaskSnapshot: runtimeTaskSnapshot || null } : {}'));
  assert(chatPanel.includes("finalizeAgentRunStopped(runId, 'agent-run:cancelled-result', {"));
  assert(chatPanel.includes('agentTaskPlanPresentation: resultProjection.agentTaskPlanPresentation'));
  assert(renderer.includes("case 'task_plan':"));
  assert(renderer.includes('<TaskPlanBlock key={block.id} block={block} />'));
  assert(component.includes('data-testid="agent-task-plan"'));
  assert(component.includes("from 'lucide-react'"));
  assert(!component.includes('<svg'));
  assert(parser.includes('hasUnifiedTaskPlanPresentation'));
  assert(parser.includes('hasAuthoritativeNonCompletedResult'));
  assert(parser.includes('hasPublicPlanConfirmationAction'));
  assert(parser.includes('message.agentTaskPlanPresentation'));
  assert(store.includes('shouldAcceptAgentTaskPlanPresentationUpdate'));
  assert(orchestrationTypes.includes('onTaskPlanPresentation?:'));
  assert(executor.includes('onTaskPlanPresentation: callbacks?.onTaskPlanPresentation'));
  assert(executor.includes('runtimeTaskSnapshot ? { runtimeTaskSnapshot } : {}'));
  assert(executor.includes("|| 'workspace:none'"));
  assert(runtimeAgent.includes('data.runtimeTaskSnapshot = runtimeTaskSnapshot'));
  assert(!runtimeTypes.includes('runtimeTaskSnapshot?:'));
  assert(!runRecord.includes('runtimeTaskSnapshot'));
});

console.log('agent task plan presentation smoke passed');
