#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const root = path.resolve(__dirname, '..');
const {
  OPERATING_CONTEXT_RUNTIME_ITEM_ID,
  buildOperatingContextPromptSection,
  buildOperatingContextRuntimeItem,
  buildOperatingContextSnapshot,
  compileOperatingContextPrompt,
  OPERATING_CONTEXT_SNAPSHOT_VERSION,
  resolveOperatingPhotoshopConnection,
  resolveOperatingPhotoshopDocumentPresence,
  validateOperatingContextSnapshot
} = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'operating-context-snapshot.ts'
));
const {
  AGENT_OPERATING_PROFILE
} = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'agent-operating-profile.ts'
));
const {
  compileRuntimeContext
} = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-context-compiler.ts'
));
const {
  governDesignKnowledgeResult
} = require(path.join(root, 'src', 'shared', 'design-knowledge-governance.ts'));
const {
  createKnowledgeSelectionReference
} = require(path.join(root, 'src', 'shared', 'knowledge-selection-context.ts'));

global.window = { designEcho: {} };
const {
  capturePhotoshopRequestContext,
  normalizePhotoshopDocumentInfo,
  getProjectContext
} = require(path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'context.ts'
));
const toolExecutor = require(path.join(
  root,
  'src',
  'renderer',
  'services',
  'tool-executor.service.ts'
));
const {
  classifyActionableIntent
} = require(path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'task-classifier.ts'
));
const {
  useAppStore
} = require(path.join(root, 'src', 'renderer', 'stores', 'app.store.ts'));
const contextSource = fs.readFileSync(path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'context.ts'
), 'utf8');
assert(!contextSource.includes('state?.selectedProjectImagePath'));
assert(contextSource.includes('options.selectedProjectImagePath'));
const chatPanelSource = fs.readFileSync(path.join(
  root,
  'src',
  'renderer',
  'components',
  'ChatPanel.tsx'
), 'utf8');
const projectCaptureIndex = chatPanelSource.indexOf('const projectContext = await getProjectContext({');
const photoshopCaptureIndex = chatPanelSource.indexOf('const photoshopRequestContext = await capturePhotoshopRequestContext({ signal })');
assert(projectCaptureIndex >= 0 && photoshopCaptureIndex > projectCaptureIndex);
assert(chatPanelSource.includes('isPluginConnected: resolveOperatingPhotoshopConnection(operatingContextSnapshot)'));
assert(chatPanelSource.includes('selectedWorkflowNodeId: submissionWorkflowContext?.selectedNode?.nodeId'));
assert(chatPanelSource.includes('knowledgeReferences: submissionKnowledgeReferences'));
assert(chatPanelSource.includes('resolveOperatingPhotoshopConnection'));
const conversationalSource = fs.readFileSync(path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'conversational.ts'
), 'utf8');
assert(!conversationalSource.includes('GENERAL_CAPABILITY_PROMPT_FACTS'));
assert(conversationalSource.includes('getEnabledUserFacingSkillsForConversation'));
assert(conversationalSource.includes('buildOperatingContextRuntimeItem(context.operatingContextSnapshot)'));
const classifierSource = fs.readFileSync(path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'task-classifier.ts'
), 'utf8');
const engineSource = fs.readFileSync(path.join(
  root,
  'src',
  'renderer',
  'services',
  'design-agent',
  'engine.ts'
), 'utf8');
assert(classifierSource.includes('buildOperatingContextRuntimeItem(context.operatingContextSnapshot)'));
assert(classifierSource.includes('compileRuntimeContext({ items })'));
assert((engineSource.match(/compileOperatingContextPrompt\(context\.operatingContextSnapshot\)/g) || []).length >= 2);

const capturedAt = '2026-07-16T10:00:02.000Z';
const selectedKnowledgeResult = governDesignKnowledgeResult({
  id: 'knowledge-layout-rule-v2',
  title: '信息层级原则',
  intent: 'rule',
  sourceType: 'manual_rule',
  summary: '标题、卖点和辅助信息应形成清晰阅读顺序。',
  sourceNotes: ['用户批准的设计方法。'],
  tags: ['layout'],
  allowedUses: ['prompt_context', 'user_reference'],
  sourceLevel: 'curated_rule',
  sourceRank: 90
}, {
  provenance: 'bundled_curated',
  sourceRevision: 'layout-rule-v2',
  retrievedAt: capturedAt
});
const selectedKnowledge = createKnowledgeSelectionReference(selectedKnowledgeResult, capturedAt, {
  useRole: 'layout',
  insights: {
    whatLooksGood: ['主体占比六成显得稳'],
    whyItWorks: ['留白给商品呼吸感'],
    reusableHeuristics: ['标题保持两级以内']
  }
});
assert.strictEqual(selectedKnowledge.ok, true);
const currentSnapshot = buildOperatingContextSnapshot({
  snapshotId: 'operating:smoke-current',
  correlationId: 'agent-run-smoke-current',
  capturedAt,
  workspace: {
    source: 'smoke-workbench',
    observedAt: '2026-07-16T10:00:01.000Z',
    revision: 'workspace:project-1222:workflow-r7',
    activePage: 'workflow',
    project: {
      projectId: 'C-1222',
      projectName: '袜子详情页',
      projectPath: 'C:\\Projects\\C-1222  Launch'
    },
    workflow: {
      documentId: 'workflow-draft-1',
      lifecycle: 'ephemeral_draft',
      revision: 'workflow-r7',
      selectedNode: {
        nodeId: 'copy-node-2',
        kind: 'model',
        title: '文案撰写',
        subtitle: '第二屏卖点文案',
        typeLabel: 'MODEL'
      }
    },
    knowledgeReferences: [selectedKnowledge.reference]
  },
  photoshop: {
    source: 'photoshop.getDocumentInfo',
    observedAt: '2026-07-16T10:00:01.500Z',
    revision: 'photoshop:88:layer-410',
    validForMs: 5000,
    connection: 'connected',
    documentState: 'present',
    document: {
      documentId: 88,
      name: 'C-1222.psd',
      width: 1920,
      height: 12000,
      layerCount: 57
    },
    activeLayer: {
      layerId: 410,
      name: '第二屏文案'
    }
  }
});

assert.strictEqual(currentSnapshot.version, OPERATING_CONTEXT_SNAPSHOT_VERSION);
assert.strictEqual(currentSnapshot.agent.profileId, 'designecho.primary-design-agent');
assert.strictEqual(currentSnapshot.workspace.workflow.selectedNode.nodeId, 'copy-node-2');
assert.strictEqual(currentSnapshot.workspace.knowledgeReferences[0].sourceRevision, 'layout-rule-v2');
assert.strictEqual(currentSnapshot.workspace.knowledgeReferences[0].useRole, 'layout');
assert(currentSnapshot.workspace.knowledgeReferences[0].insightsExcerpt.startsWith('可复用启发：'));
assert.strictEqual(currentSnapshot.workspace.project.projectPath, 'C:\\Projects\\C-1222  Launch');
assert.strictEqual(currentSnapshot.photoshop.document.documentId, 88);
assert.strictEqual(currentSnapshot.photoshop.activeLayer.layerId, 410);
assert.strictEqual(currentSnapshot.photoshop.observation.freshness, 'current');
assert.strictEqual(currentSnapshot.capability, undefined);
assert.strictEqual(currentSnapshot.boundaries.includesCapabilityState, false);
assert.strictEqual(currentSnapshot.boundaries.grantsPermission, false);
assert.strictEqual(currentSnapshot.boundaries.replacesLivePreflight, false);
assert.deepStrictEqual(validateOperatingContextSnapshot(currentSnapshot), {
  ok: true,
  issues: []
});

for (const frozenValue of [
  currentSnapshot,
  currentSnapshot.agent,
  currentSnapshot.agent.boundaries,
  currentSnapshot.workspace,
  currentSnapshot.workspace.workflow,
  currentSnapshot.workspace.workflow.selectedNode,
  currentSnapshot.workspace.knowledgeReferences,
  currentSnapshot.workspace.knowledgeReferences[0],
  currentSnapshot.photoshop,
  currentSnapshot.photoshop.document,
  currentSnapshot.photoshop.activeLayer,
  currentSnapshot.boundaries
]) {
  assert.strictEqual(Object.isFrozen(frozenValue), true, 'snapshot values must be recursively immutable');
}
assert.strictEqual(
  Object.isFrozen(AGENT_OPERATING_PROFILE),
  false,
  'freezing one request snapshot must not mutate the shared profile definition'
);
assert.throws(() => {
  currentSnapshot.workspace.activePage = 'assets';
}, TypeError);
assert.strictEqual(currentSnapshot.workspace.activePage, 'workflow');

const prompt = buildOperatingContextPromptSection(currentSnapshot);
assert(prompt.includes('nodeId=copy-node-2'));
assert(prompt.includes('subtitle=第二屏卖点文案'));
assert(prompt.includes('typeLabel=MODEL'));
assert(prompt.includes('source=smoke-workbench'));
assert(prompt.includes('用户明确加入本次任务的知识参考'));
assert(prompt.includes('revision=layout-rule-v2'));
assert(prompt.includes('用途=版式参考'));
assert(prompt.includes('用途边界：只约束构图与信息层级'));
assert(prompt.includes('已复核洞察：可复用启发：标题保持两级以内'));
assert(prompt.includes('不授予 Photoshop 权限'));
assert(prompt.includes('documentId=88'));
assert(prompt.includes('layerId=410'));
assert(prompt.includes('本快照不授予执行权限'));
assert(prompt.includes('写操作必须通过实时 execution preflight'));
assert(prompt.includes('本快照不包含能力可见性、Tool 可用性或执行授权'));

const compiled = compileRuntimeContext({
  stage: 'R3',
  items: [buildOperatingContextRuntimeItem(currentSnapshot)]
});
assert.deepStrictEqual(compiled.includedItemIds, [OPERATING_CONTEXT_RUNTIME_ITEM_ID]);
assert.strictEqual(compiled.issues.length, 0);
assert.strictEqual(compileOperatingContextPrompt(currentSnapshot), compiled.prompt);

const assetSnapshot = buildOperatingContextSnapshot({
  snapshotId: 'operating:smoke-asset',
  correlationId: 'agent-run-smoke-asset',
  capturedAt,
  workspace: {
    source: 'smoke-workbench',
    observedAt: capturedAt,
    revision: 'workspace:asset-selection',
    activePage: 'assets',
    selectedAsset: {
      path: 'C:\\Projects\\C-1222  Launch\\hero  final.png',
      name: 'hero.png'
    },
    knowledgeReferences: [selectedKnowledge.reference],
    workflow: {
      documentId: 'workflow-draft-1',
      lifecycle: 'ephemeral_draft',
      revision: 'workflow-r7'
    }
  },
  photoshop: {
    source: 'main.websocket-status',
    observedAt: capturedAt,
    revision: 'photoshop:disconnected',
    connection: 'disconnected',
    documentState: 'unknown'
  }
});
assert.strictEqual(assetSnapshot.workspace.workflow.documentId, 'workflow-draft-1');
assert.strictEqual(assetSnapshot.workspace.workflow.selectedNode, undefined);
assert.strictEqual(assetSnapshot.workspace.selectedAsset.path, 'C:\\Projects\\C-1222  Launch\\hero  final.png');
assert.strictEqual(assetSnapshot.workspace.knowledgeReferences.length, 1);
assert(!assetSnapshot.issues.includes('multiple_primary_selections'), 'Knowledge references may coexist with one primary asset selection');
assert.deepStrictEqual(validateOperatingContextSnapshot(assetSnapshot), { ok: true, issues: [] });
const assetPrompt = buildOperatingContextPromptSection(assetSnapshot);
assert(assetPrompt.includes('path=C:\\Projects\\C-1222  Launch\\hero  final.png'));
assert(assetPrompt.includes('revision=layout-rule-v2'));
assert(assetPrompt.includes('提交时没有选中工作流节点'));

const normalizedDocument = normalizePhotoshopDocumentInfo({
  success: true,
  observedAt: '2026-07-16T10:00:01.250Z',
  document: {
    id: 88,
    name: 'C-1222.psd',
    width: 1920,
    height: 12000,
    layerCount: 57,
    activeLayerId: 410,
    activeLayerName: '第二屏文案'
  }
}, '2026-07-16T10:00:09.000Z');
assert.strictEqual(normalizedDocument.hasDocument, true);
assert.strictEqual(normalizedDocument.documentId, 88);
assert.strictEqual(normalizedDocument.activeLayerId, 410);
assert.strictEqual(normalizedDocument.observedAt, '2026-07-16T10:00:01.250Z');
assert.strictEqual(
  normalizePhotoshopDocumentInfo({ success: true, document: { name: 'missing-id.psd' } }),
  undefined,
  'a malformed success without a stable document id must remain unknown'
);
assert.strictEqual(
  normalizePhotoshopDocumentInfo({ success: false, error: 'bridge timeout' }),
  undefined
);
assert.strictEqual(
  normalizePhotoshopDocumentInfo({
    success: false,
    observedAt: '2026-07-16T10:00:01.500Z',
    documentState: 'absent',
    errorCode: 'no_active_document',
    error: 'localized host message'
  }).hasDocument,
  false
);
assert.strictEqual(
  normalizePhotoshopDocumentInfo({ success: false, error: '没有打开的文档' }),
  undefined,
  'localized error text alone must not become a document-state contract'
);

const ambiguousSelectionSnapshot = buildOperatingContextSnapshot({
  snapshotId: 'operating:smoke-ambiguous-selection',
  correlationId: 'agent-run-smoke-ambiguous-selection',
  capturedAt,
  workspace: {
    observedAt: capturedAt,
    revision: 'workspace:ambiguous-selection',
    selectedAsset: { path: 'C:\\Projects\\asset.png' },
    workflow: {
      documentId: 'workflow-draft-2',
      lifecycle: 'ephemeral_draft',
      revision: 'workflow-r8',
      selectedNode: {
        nodeId: 'node-8',
        kind: 'model',
        title: '文案撰写'
      }
    }
  },
  photoshop: {
    observedAt: capturedAt,
    revision: 'photoshop:disconnected',
    connection: 'disconnected',
    documentState: 'unknown'
  }
});
assert(ambiguousSelectionSnapshot.issues.includes('multiple_primary_selections'));
assert.throws(
  () => buildOperatingContextRuntimeItem(ambiguousSelectionSnapshot),
  /operating_context_ambiguous_primary_selection/,
  'an ambiguous primary selection must not enter any model prompt'
);

const staleSnapshot = buildOperatingContextSnapshot({
  snapshotId: 'operating:smoke-stale',
  correlationId: 'agent-run-smoke-stale',
  capturedAt,
  workspace: {
    observedAt: capturedAt,
    revision: 'workspace:stale-case'
  },
  photoshop: {
    observedAt: '2026-07-16T09:59:50.000Z',
    revision: 'photoshop:stale-case',
    validForMs: 1000,
    connection: 'connected',
    documentState: 'present',
    document: { documentId: 91 }
  }
});
assert.strictEqual(staleSnapshot.photoshop.observation.freshness, 'stale');
assert(staleSnapshot.issues.includes('photoshop_observation_stale'));
const stalePrompt = buildOperatingContextPromptSection(staleSnapshot);
assert(stalePrompt.includes('已过期的提交时 Photoshop 文档基线'));
assert(stalePrompt.includes('不是当前环境事实'));
assert(!stalePrompt.includes('当前 Photoshop 文档:'));

const contradictorySnapshot = buildOperatingContextSnapshot({
  snapshotId: 'operating:smoke-contradiction',
  correlationId: 'agent-run-smoke-contradiction',
  capturedAt,
  workspace: {
    observedAt: capturedAt,
    revision: 'workspace:contradiction'
  },
  photoshop: {
    observedAt: capturedAt,
    revision: 'photoshop:contradiction',
    connection: 'disconnected',
    documentState: 'present',
    document: { documentId: 93 }
  }
});
assert(contradictorySnapshot.issues.includes('disconnected_photoshop_has_document'));
assert.strictEqual(contradictorySnapshot.photoshop.documentState, 'unknown');
assert.strictEqual(contradictorySnapshot.photoshop.document, undefined);
assert(!buildOperatingContextPromptSection(contradictorySnapshot).includes('documentId=93'));
assert.strictEqual(resolveOperatingPhotoshopConnection(contradictorySnapshot), false);
assert.strictEqual(resolveOperatingPhotoshopDocumentPresence(contradictorySnapshot), undefined);

const missingIdentitySnapshot = buildOperatingContextSnapshot({
  snapshotId: 'operating:smoke-missing-identity',
  correlationId: 'agent-run-smoke-missing-identity',
  capturedAt,
  workspace: {
    observedAt: capturedAt,
    revision: 'workspace:missing-identity'
  },
  photoshop: {
    observedAt: capturedAt,
    revision: 'photoshop:missing-identity',
    connection: 'connected',
    documentState: 'present',
    activeLayer: { layerId: 72 }
  }
});
assert(missingIdentitySnapshot.issues.includes('photoshop_document_identity_missing'));
assert(missingIdentitySnapshot.issues.includes('active_layer_without_document'));
assert.strictEqual(missingIdentitySnapshot.photoshop.documentState, 'unknown');
assert.strictEqual(missingIdentitySnapshot.photoshop.document, undefined);
assert.strictEqual(missingIdentitySnapshot.photoshop.activeLayer, undefined);
assert(!buildOperatingContextPromptSection(missingIdentitySnapshot).includes('layerId=72'));

async function verifyProjectCaptureIdentity() {
  const originalState = useAppStore.getState();
  const projectA = {
    id: 'project-a',
    name: 'Project A',
    path: 'C:\\Projects\\project-a',
    createdAt: 1,
    lastOpenedAt: 1,
    folders: {}
  };
  const projectB = {
    ...projectA,
    id: 'project-b',
    name: 'Project B',
    path: 'C:\\Projects\\project-b'
  };

  useAppStore.setState({
    currentProject: null,
    ecommerceStructure: null
  });
  assert.strictEqual(
    await getProjectContext({ expectedProjectPresent: false }),
    undefined
  );
  await assert.rejects(
    () => getProjectContext({ expectedProjectPresent: true }),
    /project_context_submission_identity_mismatch/
  );

  useAppStore.setState({ currentProject: projectA });
  await assert.rejects(
    () => getProjectContext({ expectedProjectPresent: false }),
    /project_context_submission_identity_mismatch/
  );
  await assert.rejects(
    () => getProjectContext({
      expectedProjectPresent: true,
      expectedProjectId: 'project-b',
      expectedProjectPath: projectB.path
    }),
    /project_context_submission_identity_mismatch/
  );

  let releaseRuntimeSnapshot;
  const pendingRuntimeSnapshot = new Promise((resolve) => {
    releaseRuntimeSnapshot = resolve;
  });
  global.window.designEcho.buildProjectContextSnapshot = () => pendingRuntimeSnapshot;
  const capturePromise = getProjectContext({
    expectedProjectPresent: true,
    expectedProjectId: projectA.id,
    expectedProjectPath: projectA.path
  });
  useAppStore.setState({ currentProject: projectB });
  releaseRuntimeSnapshot({ success: false });
  await assert.rejects(
    () => capturePromise,
    /project_context_changed_during_capture/
  );

  useAppStore.setState({
    currentProject: originalState.currentProject,
    ecommerceStructure: originalState.ecommerceStructure
  });
}

async function verifyPhotoshopRequestCapture() {
  const originalExecuteToolCall = toolExecutor.executeToolCall;
  const originalConnectionStatus = global.window.designEcho.getConnectionStatus;
  const originalPluginConnected = useAppStore.getState().isPluginConnected;
  const controller = new AbortController();
  let receivedSignal;

  try {
    // Store 故意保持 false；请求事实必须服从主进程实时状态，而不是 UI 缓存。
    useAppStore.setState({ isPluginConnected: false });
    global.window.designEcho.getConnectionStatus = async () => ({ connected: true });
    toolExecutor.executeToolCall = async (_toolName, _params, options) => {
      receivedSignal = options?.signal;
      return {
        success: true,
        observedAt: '2026-07-16T10:00:03.000Z',
        document: {
          id: 99,
          name: 'live.psd',
          width: 1000,
          height: 1000,
          layerCount: 2,
          activeLayerId: 7,
          activeLayerName: 'Live layer'
        }
      };
    };
    const connected = await capturePhotoshopRequestContext({ signal: controller.signal });
    assert.strictEqual(connected.connection, 'connected');
    assert.strictEqual(connected.documentState, 'present');
    assert.strictEqual(connected.context.documentId, 99);
    assert.strictEqual(connected.context.activeLayerId, 7);
    assert.strictEqual(connected.observedAt, '2026-07-16T10:00:03.000Z');
    assert.strictEqual(receivedSignal, controller.signal);

    // Store 故意保持 true；主进程明确断开时不得伪造 getDocumentInfo 来源或文档状态。
    useAppStore.setState({ isPluginConnected: true });
    global.window.designEcho.getConnectionStatus = async () => ({ connected: false });
    const disconnected = await capturePhotoshopRequestContext({ signal: controller.signal });
    assert.strictEqual(disconnected.connection, 'disconnected');
    assert.strictEqual(disconnected.documentState, 'unknown');
    assert.strictEqual(disconnected.context, undefined);
    assert.strictEqual(disconnected.source, 'main.websocket-status');
  } finally {
    toolExecutor.executeToolCall = originalExecuteToolCall;
    if (originalConnectionStatus) {
      global.window.designEcho.getConnectionStatus = originalConnectionStatus;
    } else {
      delete global.window.designEcho.getConnectionStatus;
    }
    useAppStore.setState({ isPluginConnected: originalPluginConnected });
  }
}

async function verifyRouterConsumesOperatingSnapshot() {
  const capturedSystemPrompts = [];
  const callModel = async (messages) => {
    capturedSystemPrompts.push(String(messages?.[0]?.content || ''));
    return {
      text: JSON.stringify({
        route: 'direct_response',
        skillId: null,
        mode: null,
        skillParams: null,
        taskTypeId: null,
        intentSummary: '验证请求上下文',
        directResponse: '已理解。',
        clarificationQuestion: null,
        executionApproach: null
      })
    };
  };
  const baseContext = {
    userInput: '改这里',
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: normalizedDocument,
    projectContext: {
      projectId: 'C-1222',
      projectPath: 'C:\\Projects\\C-1222  Launch',
      projectImageCount: 1
    }
  };

  await classifyActionableIntent({
    ...baseContext,
    operatingContextSnapshot: currentSnapshot
  }, callModel);
  await classifyActionableIntent({
    ...baseContext,
    operatingContextSnapshot: assetSnapshot
  }, callModel);

  assert.strictEqual(capturedSystemPrompts.length, 2);
  assert(capturedSystemPrompts[0].includes('designecho.primary-design-agent'));
  assert(capturedSystemPrompts[0].includes('nodeId=copy-node-2'));
  assert(capturedSystemPrompts[0].includes('source=smoke-workbench'));
  assert(capturedSystemPrompts[1].includes('path=C:\\Projects\\C-1222  Launch\\hero  final.png'));
}

async function main() {
  await verifyProjectCaptureIdentity();
  await verifyPhotoshopRequestCapture();
  await verifyRouterConsumesOperatingSnapshot();
  console.log(JSON.stringify({
    success: true,
    current: {
      snapshotId: currentSnapshot.snapshotId,
      workflowNodeId: currentSnapshot.workspace.workflow.selectedNode.nodeId,
      documentId: currentSnapshot.photoshop.document.documentId,
      layerId: currentSnapshot.photoshop.activeLayer.layerId,
      frozen: Object.isFrozen(currentSnapshot)
    },
    staleIssues: staleSnapshot.issues,
    contradictionIssues: contradictorySnapshot.issues,
    missingIdentityIssues: missingIdentitySnapshot.issues,
    compiledItemIds: compiled.includedItemIds,
    projectCaptureIdentity: 'verified',
    photoshopRequestCapture: 'verified',
    routerOperatingContext: 'verified'
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
