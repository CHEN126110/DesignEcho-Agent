'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  buildRuntimeResumeContextAnchor,
  buildRuntimeResumeFreshnessProbeRequest,
  evaluateRuntimeActionPlanResumeFreshness
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-resume-freshness.ts'));
const { buildAgentRunRecord, validateAgentRunRecordForPersist } = require(
  path.join(root, 'src', 'shared', 'agent-run-record.ts')
);
const { buildRunRecordResumeBrief } = require(path.join(root, 'src', 'shared', 'agent-run-resume.ts'));

const projectState = {
  schemaVersion: 'design-project-state/v0',
  projectId: 'project-1',
  taskType: 'design.generic.v1',
  canvasSize: { width: 800, height: 800, preset: 'square' },
  productionTasks: [
    { title: '调整层级', status: 'done' },
    { title: '读回复核', status: 'pending' }
  ],
  versionHistory: [{ version: 'v1', reason: '初版', timestamp: '2026-07-12T00:00:00.000Z' }],
  updatedAt: '2026-07-12T00:00:00.000Z'
};

function hierarchyResult(opacity = 80) {
  return {
    success: true,
    documentName: '不应进入指纹.psd',
    totalLayers: 2,
    flatList: [
      {
        id: 7,
        name: '产品图层',
        kind: 'smartObject',
        visible: true,
        locked: false,
        opacity,
        blendMode: 'normal',
        parentId: null,
        index: 0,
        depth: 0,
        path: '产品图层',
        pathIds: [7]
      },
      {
        id: 8,
        name: '标题图层',
        kind: 'text',
        visible: true,
        locked: false,
        opacity: 100,
        blendMode: 'normal',
        parentId: null,
        index: 1,
        depth: 0,
        path: '标题图层',
        pathIds: [8]
      }
    ]
  };
}

function buildFinalLog(opacity = 80) {
  return [
    {
      name: 'getAnnotatedSnapshot',
      arguments: {},
      result: {
        success: true,
        imageData: `data:image/png;base64,${'A'.repeat(300)}`,
        documentSize: { width: 800, height: 800 },
        layers: [{ id: 7, name: '旧产品', kind: 'smartObject', visible: true, bounds: { left: 0, top: 0, right: 10, bottom: 10 } }]
      }
    },
    {
      name: 'setLayerOpacity',
      arguments: { layerId: 7, opacity },
      result: { success: true, layerName: '产品图层' }
    },
    {
      name: 'getLayerHierarchy',
      arguments: { includeHidden: true, flatList: true },
      result: hierarchyResult(opacity)
    }
  ];
}

const previousAnchor = buildRuntimeResumeContextAnchor({
  toolCallLog: buildFinalLog(),
  projectState
});
assert.strictEqual(previousAnchor.version, 'runtime-resume-context-anchor/v0');
assert.strictEqual(previousAnchor.document.source, 'layer_hierarchy');
assert.strictEqual(previousAnchor.document.fidelity, 'structure');
assert.strictEqual(previousAnchor.document.observedAfterLastMutation, true);
assert.strictEqual(previousAnchor.projectState.productionTaskCount, 2);
const serializedAnchor = JSON.stringify(previousAnchor);
assert(!serializedAnchor.includes('产品图层'));
assert(!serializedAnchor.includes('不应进入指纹'));
assert(!serializedAnchor.includes('data:image'));
assert(!serializedAnchor.includes('layerId'));
assert(!serializedAnchor.includes('flatList'));

const updatedProjectState = {
  ...projectState,
  updatedAt: '2026-07-12T00:02:00.000Z',
  productionTasks: [
    ...projectState.productionTasks,
    { id: 'task-3', status: 'in_progress', title: '不应进入指纹明文' }
  ]
};
const postUpdateAnchor = buildRuntimeResumeContextAnchor({
  toolCallLog: [
    ...buildFinalLog(),
    {
      name: 'updateDesignProjectState',
      arguments: { set: { productionTasks: updatedProjectState.productionTasks } },
      result: { success: true, projectPath: 'C:\\private\\project', state: updatedProjectState }
    }
  ],
  projectState
});
const expectedUpdatedProjectAnchor = buildRuntimeResumeContextAnchor({
  projectState: updatedProjectState
});
assert.strictEqual(
  postUpdateAnchor.projectState.fingerprint,
  expectedUpdatedProjectAnchor.projectState.fingerprint,
  'successful project-state updates in the current run must supersede the opening state fingerprint'
);
assert.strictEqual(postUpdateAnchor.projectState.productionTaskCount, 3);
assert(!JSON.stringify(postUpdateAnchor).includes('不应进入指纹明文'));

const noPostWriteRead = buildRuntimeResumeContextAnchor({
  toolCallLog: buildFinalLog().slice(0, 2),
  projectState
});
assert.strictEqual(noPostWriteRead.document, undefined,
  'pre-write opening observation must not become the final context anchor');

const subtreeAfterWrite = buildRuntimeResumeContextAnchor({
  toolCallLog: [
    buildFinalLog()[1],
    {
      name: 'getLayerHierarchy',
      arguments: { rootLayerId: 99, flatList: true },
      result: hierarchyResult()
    }
  ],
  projectState
});
assert.strictEqual(subtreeAfterWrite.document, undefined,
  'partial subtree observation must not impersonate a full-document structure anchor');

const summaryAnchor = buildRuntimeResumeContextAnchor({
  toolCallLog: [
    buildFinalLog()[1],
    {
      name: 'getDocumentInfo',
      arguments: {},
      result: { success: true, document: { id: 1, width: 800, height: 800, layerCount: 2, resolution: 72, colorMode: 'RGB' } }
    }
  ],
  projectState
});
assert.strictEqual(summaryAnchor.document.fidelity, 'summary');

const annotatedAnchor = buildRuntimeResumeContextAnchor({
  toolCallLog: [
    buildFinalLog()[1],
    {
      name: 'getAnnotatedSnapshot',
      arguments: { includeHidden: false, layerFilter: 'visual' },
      result: {
        success: true,
        imageData: 'omitted',
        documentSize: { width: 800, height: 800 },
        layers: [{ id: 7, name: '产品图层', kind: 'smartObject', visible: true, bounds: { left: 10, top: 20, right: 410, bottom: 620, width: 400, height: 600 } }]
      }
    }
  ],
  projectState
});
assert.strictEqual(annotatedAnchor.document.fidelity, 'visual_structure');

const currentAnchor = buildRuntimeResumeContextAnchor({
  toolCallLog: [{
    name: 'getLayerHierarchy',
    arguments: { includeHidden: true, includeBounds: false, flatList: true },
    result: hierarchyResult(80)
  }],
  projectState
});
const verified = evaluateRuntimeActionPlanResumeFreshness({
  sourceRunId: 'run-1',
  previousAnchor,
  currentAnchor,
  completedStepIds: ['compose-layout'],
  completedStepDescriptors: [{
    stepId: 'compose-layout',
    kind: 'compose_dsl',
    capabilityRefs: ['design.general'],
    observedOutcomes: ['design_dsl']
  }],
  resumeStepIds: ['verify-change'],
  probeSucceeded: true
});
assert.strictEqual(verified.status, 'verified');
assert.strictEqual(verified.documentMatch, 'matched');
assert.strictEqual(verified.projectStateMatch, 'matched');
assert.deepStrictEqual(verified.verifiedCompletedStepIds, ['compose-layout']);
assert.strictEqual(verified.verifiedCompletedSteps[0].kind, 'compose_dsl');
assert.deepStrictEqual(verified.verifiedResumeStepIds, ['verify-change']);
assert.strictEqual(verified.boundaries.autoSkipsSteps, false);
assert.strictEqual(verified.boundaries.schedulerAuthority, false);

const changedDocumentAnchor = buildRuntimeResumeContextAnchor({
  toolCallLog: [{
    name: 'getLayerHierarchy',
    arguments: { includeHidden: true, flatList: true },
    result: hierarchyResult(50)
  }],
  projectState
});
const documentMismatch = evaluateRuntimeActionPlanResumeFreshness({
  sourceRunId: 'run-1',
  previousAnchor,
  currentAnchor: changedDocumentAnchor,
  completedStepIds: ['compose-layout'],
  resumeStepIds: ['verify-change'],
  probeSucceeded: true
});
assert.strictEqual(documentMismatch.status, 'mismatch');
assert.strictEqual(documentMismatch.documentMatch, 'mismatched');
assert.deepStrictEqual(documentMismatch.invalidatedCompletedStepIds, ['compose-layout']);
assert.deepStrictEqual(documentMismatch.invalidatedResumeStepIds, ['verify-change']);

const changedProjectAnchor = buildRuntimeResumeContextAnchor({
  toolCallLog: [{
    name: 'getLayerHierarchy',
    arguments: { includeHidden: true, flatList: true },
    result: hierarchyResult(80)
  }],
  projectState: { ...projectState, updatedAt: '2026-07-12T00:05:00.000Z' }
});
const projectMismatch = evaluateRuntimeActionPlanResumeFreshness({
  sourceRunId: 'run-1',
  previousAnchor,
  currentAnchor: changedProjectAnchor,
  resumeStepIds: ['verify-change'],
  probeSucceeded: true
});
assert.strictEqual(projectMismatch.status, 'mismatch');
assert.strictEqual(projectMismatch.projectStateMatch, 'mismatched');

const summaryOnly = evaluateRuntimeActionPlanResumeFreshness({
  sourceRunId: 'run-summary',
  previousAnchor: summaryAnchor,
  currentAnchor: summaryAnchor,
  resumeStepIds: ['verify-change'],
  probeSucceeded: true
});
assert.strictEqual(summaryOnly.status, 'insufficient_context');
assert.strictEqual(summaryOnly.documentMatch, 'insufficient');

const missingProject = evaluateRuntimeActionPlanResumeFreshness({
  sourceRunId: 'run-1',
  previousAnchor,
  currentAnchor: buildRuntimeResumeContextAnchor({
    toolCallLog: [{ name: 'getLayerHierarchy', arguments: { includeHidden: true }, result: hierarchyResult(80) }]
  }),
  resumeStepIds: ['verify-change'],
  probeSucceeded: true
});
assert.strictEqual(missingProject.status, 'insufficient_context');
assert.strictEqual(missingProject.projectStateMatch, 'missing');

const probeFailed = evaluateRuntimeActionPlanResumeFreshness({
  sourceRunId: 'run-1',
  previousAnchor,
  currentAnchor: undefined,
  resumeStepIds: ['verify-change'],
  probeSucceeded: false
});
assert.strictEqual(probeFailed.status, 'probe_failed');
assert.deepStrictEqual(probeFailed.verifiedResumeStepIds, []);

const hierarchyProbe = buildRuntimeResumeFreshnessProbeRequest(previousAnchor);
assert.deepStrictEqual(hierarchyProbe, {
  source: 'layer_hierarchy',
  toolName: 'getLayerHierarchy',
  arguments: { includeHidden: true, includeBounds: false, flatList: true },
  boundaries: { readOnly: true, executesWrites: false, blocksTaskOnFailure: false }
});
assert.strictEqual(buildRuntimeResumeFreshnessProbeRequest(undefined), undefined);

const reconciliationDigest = {
  version: 'runtime-action-plan-reconciliation-digest/v0',
  status: 'needs_recovery',
  planReadiness: 'ready',
  stepCount: 3,
  completedStepIds: ['compose-layout'],
  completedStepDescriptors: [{
    stepId: 'compose-layout',
    kind: 'compose_dsl',
    capabilityRefs: ['design.general'],
    observedOutcomes: ['design_dsl']
  }],
  failedStepIds: ['apply-change'],
  recoveredStepIds: [],
  resumeStepIds: ['apply-change'],
  observationCount: 1,
  droppedObservationCount: 0,
  ambiguousObservationCount: 0,
  dependencyBlockedObservationCount: 0,
  unmatchedObservationCount: 0,
  repeatAfterSatisfactionCount: 0,
  issueCount: 0,
  boundaries: {
    digestOnly: true,
    shadowOnly: true,
    resumeAdvisoryOnly: true,
    executesTools: false,
    changesTaskResult: false,
    countsAsQualityPass: false
  }
};
const record = buildAgentRunRecord({
  now: '2026-07-12T00:10:00.000Z',
  goal: '继续未完成设计',
  projectPath: 'C:\\private\\project',
  projectState,
  result: {
    success: false,
    iterations: 4,
    stopReason: 'max_iterations',
    toolCallLog: buildFinalLog(),
    executionSummary: {
      status: 'failed',
      blockers: ['需要继续'],
      warnings: [],
      runtimeActionPlanReconciliationDigest: reconciliationDigest
    }
  }
});
assert(record.contextAnchor?.document);
assert.strictEqual(record.boundaries.contextAnchorDigestOnly, true);
assert.strictEqual(validateAgentRunRecordForPersist(record).ok, true);
assert(!JSON.stringify(record.contextAnchor).includes('产品图层'));
assert(!JSON.stringify(record.contextAnchor).includes('flatList'));
const poisonedDescriptorRecord = JSON.parse(JSON.stringify(record));
poisonedDescriptorRecord.actionPlanReconciliation.completedStepDescriptors[0].goal = '不应进入长期摘要';
assert.strictEqual(validateAgentRunRecordForPersist(poisonedDescriptorRecord).ok, false);

const uncheckedBrief = buildRunRecordResumeBrief({
  records: [record],
  nowMs: Date.parse('2026-07-12T00:20:00.000Z')
});
assert.strictEqual(uncheckedBrief.applicable, true);
assert(uncheckedBrief.freshnessCandidate);
assert.deepStrictEqual(uncheckedBrief.freshnessCandidate.completedStepIds, ['compose-layout']);
assert.strictEqual(uncheckedBrief.freshnessCandidate.completedStepDescriptors[0].kind, 'compose_dsl');
assert.deepStrictEqual(uncheckedBrief.freshnessCandidate.resumeStepIds, ['apply-change']);
assert(uncheckedBrief.brief.includes('未通过本轮新鲜度核验（not_checked）'));
assert(uncheckedBrief.brief.includes('不得依据旧节点跳过动作'));
assert(!uncheckedBrief.brief.includes('可在核实当前目标相关后从这些步骤继续'));

const verifiedBrief = buildRunRecordResumeBrief({
  records: [record],
  nowMs: Date.parse('2026-07-12T00:20:00.000Z'),
  freshness: { ...verified, sourceRunId: record.runId, verifiedResumeStepIds: ['apply-change'] }
});
assert(verifiedBrief.brief.includes('已通过本轮新鲜度核验'));
assert(verifiedBrief.brief.includes('可在核实当前目标相关后从这些步骤继续：apply-change'));

const mismatchBrief = buildRunRecordResumeBrief({
  records: [record],
  nowMs: Date.parse('2026-07-12T00:20:00.000Z'),
  freshness: { ...documentMismatch, sourceRunId: record.runId }
});
assert(mismatchBrief.brief.includes('未通过本轮新鲜度核验（mismatch）'));
assert(!mismatchBrief.brief.includes('可在核实当前目标相关后从这些步骤继续'));

const persistedFreshnessRecord = buildAgentRunRecord({
  now: '2026-07-12T00:21:00.000Z',
  goal: '继续未完成设计',
  projectState,
  resumeFreshness: { ...verified, sourceRunId: record.runId },
  result: { success: false, iterations: 1, toolCallLog: [] }
});
assert.strictEqual(persistedFreshnessRecord.resumeFreshness.status, 'verified');
assert.strictEqual(persistedFreshnessRecord.boundaries.resumeFreshnessDigestOnly, true);
const poisonedFreshnessRecord = JSON.parse(JSON.stringify(persistedFreshnessRecord));
poisonedFreshnessRecord.resumeFreshness.verifiedCompletedSteps[0].toolName = 'setLayerOpacity';
assert.strictEqual(validateAgentRunRecordForPersist(poisonedFreshnessRecord).ok, false);
assert.strictEqual(validateAgentRunRecordForPersist(persistedFreshnessRecord).ok, true);

const poisonedAnchor = {
  ...record,
  contextAnchor: {
    ...record.contextAnchor,
    layers: [{ name: '泄漏图层' }]
  }
};
assert.strictEqual(validateAgentRunRecordForPersist(poisonedAnchor).ok, false);

const moduleSource = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-resume-freshness.ts'),
  'utf8'
);
const executorSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
  'utf8'
);
assert(!/taskText|详情页|主图|SKU|detailPage|mainImage|sku-batch/i.test(moduleSource));
assert(!moduleSource.includes('executeTool('));
assert(executorSource.includes('buildRuntimeResumeFreshnessProbeRequest(candidate.contextAnchor)'));
assert(executorSource.includes("classifyAgentToolExecution(probe.toolName, probe.arguments) === 'read_only_observation'"));
assert(moduleSource.includes('blocksTaskOnFailure: false'));
assert(executorSource.includes("probeResult = { success: false, error:"));

console.log(JSON.stringify({
  success: true,
  anchors: {
    strongSource: previousAnchor.document.source,
    strongFidelity: previousAnchor.document.fidelity,
    summaryFidelity: summaryAnchor.document.fidelity,
    noPostWriteRead: noPostWriteRead.document === undefined,
    subtreeRejected: subtreeAfterWrite.document === undefined
  },
  verdicts: {
    verified: verified.status,
    documentMismatch: documentMismatch.status,
    projectMismatch: projectMismatch.status,
    summaryOnly: summaryOnly.status,
    missingProject: missingProject.status,
    probeFailed: probeFailed.status
  },
  briefBoundary: {
    uncheckedInvalidatesSkipAdvice: uncheckedBrief.brief.includes('不得依据旧节点跳过动作'),
    verifiedExposesResumeAdvice: verifiedBrief.brief.includes('apply-change'),
    mismatchInvalidatesSkipAdvice: mismatchBrief.brief.includes('mismatch')
  },
  persistence: {
    contextAnchorDigestOnly: record.boundaries.contextAnchorDigestOnly,
    resumeFreshnessDigestOnly: persistedFreshnessRecord.boundaries.resumeFreshnessDigestOnly,
    poisonedAnchorRejected: validateAgentRunRecordForPersist(poisonedAnchor).ok === false
  },
  boundary: 'readonly freshness observation only; no task-relatedness inference, write, block, auto-skip, recovery, scheduling or quality authority'
}, null, 2));
