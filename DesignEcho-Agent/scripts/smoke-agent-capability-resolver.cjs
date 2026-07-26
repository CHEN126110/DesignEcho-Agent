'use strict';

/**
 * smoke: Agent Capability Resolver
 *
 * Guards the real runtime inventory and per-run schema activation contract:
 * manifests seed capabilities, compact discovery can expand them, and Policy
 * remains separate from model-visible schema loading.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, 'src', 'shared', 'agent-runtime-v5');
const rendererRuntimeRoot = path.join(root, 'src', 'renderer', 'services', 'agent-runtime');
const executorRoot = path.join(root, 'src', 'renderer', 'services', 'skill-executors');

const { getManifestByTaskType, listSkillManifests } = require(path.join(runtimeRoot, 'skill-runtime.ts'));
const {
  createAgentCapabilitySession,
  REQUEST_AGENT_CAPABILITIES_TOOL_NAME
} = require(path.join(rendererRuntimeRoot, 'capability-session.ts'));
const {
  buildRuntimeCapabilityInventory,
  MAX_ON_DEMAND_CAPABILITY_REQUESTS
} = require(path.join(runtimeRoot, 'capability-resolver.ts'));
const { Agent } = require(path.join(rendererRuntimeRoot, 'agent.ts'));
const {
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  getDefaultAgentTools
} = require(path.join(rendererRuntimeRoot, 'tool-schemas.ts'));
const { classifyAgentToolExecution } = require(path.join(root, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const { buildAgentToolDecisionContract } = require(path.join(root, 'src', 'shared', 'agent-tool-decision-contract.ts'));
const { buildAgentIntentControlPlaneDecision } = require(path.join(root, 'src', 'shared', 'agent-intent-control-plane.ts'));
const { buildAgentTaskPlanningContract } = require(path.join(root, 'src', 'shared', 'agent-task-planning-contract.ts'));
const { buildSkillToolSchemas } = require(path.join(executorRoot, 'skill-tools.ts'));
const { resolveAutonomousCapabilityRuntime } = require(path.join(executorRoot, 'autonomous-agent.executor.ts'));
const {
  buildAutonomousRuntimeDecisionForAgentChoice,
  buildAutonomousSkillParams
} = require(path.join(root, 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const { classifyActionableIntent } = require(path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'task-classifier.ts'
));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function schemaSize(tools) {
  return JSON.stringify(tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))).length;
}

function unique(values) {
  return Array.from(new Set(values));
}

const atomicTools = getDefaultAgentTools();
const workflowBridgeTools = buildSkillToolSchemas();
const candidateTools = [
  ...atomicTools,
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  ...workflowBridgeTools
];
const workflowBridgeNames = workflowBridgeTools.map((tool) => tool.name);
const candidateNames = candidateTools.map((tool) => tool.name);

console.log('smoke: agent-capability-resolver');

check('runtime candidate catalog is the existing eligible Tool and Skill surface', () => {
  assert.strictEqual(candidateNames.length, unique(candidateNames).length, 'candidate names must be unique');
  assert.ok(atomicTools.length >= 140, `unexpected atomic catalog: ${atomicTools.length}`);
  assert.ok(workflowBridgeTools.length >= 10, `unexpected workflow bridge catalog: ${workflowBridgeTools.length}`);
  assert.ok(candidateNames.includes('getCanvasSnapshot'));
  assert.ok(candidateNames.includes('main-image-design'));
  assert.ok(!candidateNames.includes('smartLayout'), 'RAW-only unsafe tool must not enter eligible inventory');
});

check('all manifests satisfy the updated Skill manifest schema', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'skill-runtime-manifest.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  for (const manifest of listSkillManifests()) {
    assert.ok(validate(manifest), `${manifest.skill_id}: ${JSON.stringify(validate.errors, null, 2)}`);
  }
  const genericManifest = getManifestByTaskType('design.generic.v1');
  assert.strictEqual(validate({ ...genericManifest, primary_method_tool_ref: 'not-a-tool-ref' }), false);
});

check('generic manifest gets a reduced initial set plus compact on-demand discovery', () => {
  const manifest = getManifestByTaskType('design.generic.v1');
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest
  });
  const resolution = session.getResolution();
  const activeNames = session.activeTools.map((tool) => tool.name);
  const fullSize = schemaSize(candidateTools);
  const activeSize = schemaSize(session.activeTools);

  assert.strictEqual(resolution.status, 'resolved', JSON.stringify(resolution.issues, null, 2));
  assert.strictEqual(resolution.selectionMode, 'manifest_seeded');
  assert.strictEqual(resolution.manifestRef.skillId, 'design.general');
  assert.ok(resolution.metrics.schemaReductionApplied);
  assert.ok(activeSize < fullSize * 0.25, `${activeSize} !< ${fullSize} * 0.25`);
  assert.ok(activeNames.includes(REQUEST_AGENT_CAPABILITIES_TOOL_NAME));
  assert.ok(!activeNames.includes('getCanvasSnapshot'), 'visual snapshot should load only when the next step needs it');
  assert.ok(activeNames.includes('getDesignProjectState'));
  assert.ok(!activeNames.includes('createInteractiveCard'), 'ownerless generic confirmation must not stop an autonomous run');
  assert.ok(!resolution.onDemandCapabilityIds.includes('agent.interaction.requestConfirmation'));
  assert.ok(resolution.deniedCapabilityIds.includes('agent.interaction.requestConfirmation'));
  assert.ok(resolution.deniedToolNames.includes('createInteractiveCard'));
  const ownerlessCardBypass = session.requestCapabilities(['agent.interaction.requestConfirmation']);
  assert.strictEqual(ownerlessCardBypass.status, 'rejected');
  assert.ok(ownerlessCardBypass.issues.some((issue) => issue.code === 'requested_capability_forbidden'));
  assert.ok(!activeNames.includes('getAnnotatedSnapshot'), 'visual observation should load only when the next step needs it');
  assert.ok(!activeNames.includes('analyzeAssetContent'), 'asset curation should load only when source choice is unresolved');
  assert.ok(!activeNames.includes('fitLayerSubjectToRegion'), 'composition optimization should load only for a spatial adjustment');
  assert.ok(!activeNames.includes('renderLayout'), 'layout production should not be a universal initial action');
  assert.ok(!activeNames.includes('saveDocument'), 'delivery should load only when delivery is requested');
  assert.ok(!activeNames.includes('layer-management'), 'unselected workflow bridge must stay compact');
  assert.ok(resolution.references.knowledgeRefs.includes('tool:getDesignPrinciples'));
  assert.ok(resolution.references.evaluationRefs.includes('design-quality-verdict/v0'));
});

check('asset curation and composition actions stay independently reachable on demand', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('design.generic.v1')
  });
  const initialNames = session.activeTools.map((tool) => tool.name);
  assert.ok(!initialNames.includes('analyzeAssetContent'));
  assert.ok(!initialNames.includes('recommendAssets'));
  assert.ok(!initialNames.includes('fitLayerSubjectToRegion'));

  const assetActivation = session.requestCapabilities([
    'project.read.analyzeAssetContent',
    'project.read.recommendAssets'
  ]);
  assert.strictEqual(assetActivation.status, 'activated', JSON.stringify(assetActivation, null, 2));
  assert.ok(session.activeTools.some((tool) => tool.name === 'analyzeAssetContent'));
  assert.ok(session.activeTools.some((tool) => tool.name === 'recommendAssets'));
  assert.ok(!session.activeTools.some((tool) => tool.name === 'fitLayerSubjectToRegion'));

  const compositionActivation = session.requestCapabilities([
    'photoshop.write.fitLayerSubjectToRegion'
  ]);
  assert.strictEqual(compositionActivation.status, 'activated', JSON.stringify(compositionActivation, null, 2));
  assert.ok(session.activeTools.some((tool) => tool.name === 'fitLayerSubjectToRegion'));
});

check('every eligible candidate remains discoverable with existing semantic metadata', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('design.generic.v1')
  });
  const providedNames = unique(session.inventory.flatMap((entry) => entry.providerToolNames));
  assert.deepStrictEqual(
    candidateNames.filter((name) => !providedNames.includes(name)),
    [],
    'no eligible Tool or Skill may silently disappear from inventory'
  );
  const semanticEntries = session.inventory.filter((entry) => entry.source === 'tool_semantics');
  assert.strictEqual(
    session.inventory.filter((entry) => entry.source === 'legacy_unclassified_tool').length,
    0,
    'current eligible catalog must not call already-reviewed Tool semantics unclassified'
  );
  assert.ok(semanticEntries.length > 0, 'reviewed Tool semantics must remain present in the inventory');
  for (const entry of semanticEntries) {
    assert.ok(entry.capabilityId.includes('.'), entry.capabilityId);
    assert.ok(entry.semanticMetadata, entry.capabilityId);
    assert.ok(entry.semanticMetadata.capabilityKind !== 'unknown', entry.capabilityId);
    assert.ok(entry.semanticMetadata.userIntentBoundary, entry.capabilityId);
    assert.ok(entry.semanticMetadata.verifyWith.length > 0, entry.capabilityId);
  }
  assert.ok(session.inventory.some((entry) => (
    entry.capabilityId === 'photoshop.write.fitLayerSubjectToRegion'
    && entry.semanticMetadata?.capabilityKind === 'photoshop_write'
  )));
  assert.ok(session.inventory.some((entry) => entry.capabilityId === 'skill.layer-management'));
});

check('genuinely unknown future Tool stays explicit and discoverable through legacy fallback', () => {
  const inventory = buildRuntimeCapabilityInventory({
    executableToolNames: ['futureUnknownTool']
  });
  assert.deepStrictEqual(inventory, [{
    capabilityId: 'legacy.tool.futureUnknownTool',
    kind: 'tool',
    providerToolNames: ['futureUnknownTool'],
    source: 'legacy_unclassified_tool'
  }]);
});

check('broad discovery exposes user-facing Skill bridges directly instead of hiding them behind bare ids', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames
  });
  const resolution = session.getResolution();
  assert.strictEqual(resolution.selectionMode, 'broad_discovery');
  assert.ok(
    resolution.selectedCapabilityIds.includes('skill.sku-batch'),
    `sku-batch bridge must be visible without a manifest: ${JSON.stringify(resolution.selectedCapabilityIds)}`
  );
  assert.ok(resolution.selectedCapabilityIds.includes('skill.main-image-design'));
  assert.ok(
    !resolution.onDemandCapabilityIds.includes('skill.sku-batch'),
    'a directly visible Skill must not stay on-demand'
  );
  const activeNames = session.activeTools.map((tool) => tool.name);
  assert.ok(activeNames.includes('sku-batch'), `sku-batch schema must be in the initial model-visible set: ${activeNames}`);
  assert.ok(activeNames.includes('main-image-design'));
  assert.ok(
    activeNames.includes(REQUEST_AGENT_CAPABILITIES_TOOL_NAME),
    'write tools remain discoverable through the on-demand loader'
  );
});

check('broad discovery prompt section carries a readable on-demand capability catalog', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames
  });
  const prompt = session.buildPromptSection();
  assert.ok(prompt.includes('On-demand capability catalog'), `catalog header missing: ${prompt}`);
  assert.ok(
    /photoshop\.sandbox\.writeText — \S/.test(prompt),
    `on-demand ids must carry a one-line description, not a bare id: ${prompt}`
  );
});

check('Planner can activate a Tool and a Skill schema for the next ReAct round', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('design.generic.v1')
  });
  const activeToolsReference = session.activeTools;
  const semanticEntry = session.inventory.find((entry) => (
    entry.source === 'tool_semantics'
    && !session.getResolution().selectedCapabilityIds.includes(entry.capabilityId)
  ));
  assert.ok(semanticEntry, 'expected at least one on-demand semantic Tool capability');
  assert.ok(session.getResolution().onDemandCapabilityIds.includes('skill.layer-management'));

  const activation = session.requestCapabilities([
    semanticEntry.capabilityId,
    'skill.layer-management'
  ]);

  assert.strictEqual(activation.status, 'activated', JSON.stringify(activation, null, 2));
  assert.strictEqual(session.activeTools, activeToolsReference, 'active Tool array must update in place');
  assert.ok(activation.activatedToolNames.includes(semanticEntry.providerToolNames[0]));
  assert.ok(activation.activatedToolNames.includes('layer-management'));
  assert.ok(session.activeTools.some((tool) => tool.name === 'layer-management'));
});

check('requesting an already active capability is a non-persistent no-op diagnosis', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('ecommerce.sku_color_card.v1')
  });
  const before = session.getResolution();
  assert.ok(before.selectedCapabilityIds.includes('skill.sku-color-card'));

  const activation = session.requestCapabilities(['skill.sku-color-card']);
  const after = session.getResolution();
  assert.strictEqual(activation.status, 'rejected');
  assert.deepStrictEqual(activation.activatedCapabilityIds, []);
  assert.ok(activation.issues.some((issue) => (
    issue.code === 'requested_capability_already_active'
  )));
  assert.strictEqual(after.status, 'resolved');
  assert.ok(!after.unavailableCapabilityIds.includes('skill.sku-color-card'));
  assert.ok(!after.issues.some((issue) => (
    issue.code === 'requested_capability_already_active'
  )));
  assert.ok(session.activeTools.some((tool) => tool.name === 'sku-color-card'));
});

check('capability request schema disappears when the inventory has nothing left to load', () => {
  const session = createAgentCapabilitySession({
    candidateTools: [{
      name: 'getDocumentInfo',
      description: 'read document',
      inputSchema: { type: 'object', properties: {} }
    }]
  });
  assert.deepStrictEqual(session.getResolution().onDemandCapabilityIds, []);
  assert.ok(session.activeTools.some((tool) => tool.name === 'getDocumentInfo'));
  assert.ok(!session.activeTools.some((tool) => (
    tool.name === REQUEST_AGENT_CAPABILITIES_TOOL_NAME
  )));
});

check('manifest forbidden capability wins over on-demand requests', () => {
  const baseManifest = getManifestByTaskType('design.generic.v1');
  const deniedCapabilityId = 'photoshop.write.deleteLayer';
  const manifest = {
    ...baseManifest,
    forbidden_tools: [...baseManifest.forbidden_tools, deniedCapabilityId]
  };
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest
  });
  const activation = session.requestCapabilities([deniedCapabilityId]);

  assert.strictEqual(activation.status, 'rejected');
  assert.ok(activation.issues.some((issue) => issue.code === 'requested_capability_forbidden'));
  assert.ok(!session.activeTools.some((tool) => tool.name === 'deleteLayer'));
});

check('forbidden capability closes over shared legacy provider tools', () => {
  const baseManifest = getManifestByTaskType('design.generic.v1');
  const manifest = {
    ...baseManifest,
    forbidden_tools: [
      ...baseManifest.forbidden_tools,
      'photoshop.sandbox.createScreenGroup',
      'delivery.exportSlices'
    ]
  };
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest
  });
  const resolution = session.getResolution();

  assert.ok(resolution.deniedToolNames.includes('renderLayout'));
  assert.ok(resolution.deniedToolNames.includes('quickExport'));
  assert.ok(!session.activeTools.some((tool) => tool.name === 'renderLayout'));
  assert.ok(!session.activeTools.some((tool) => tool.name === 'quickExport'));
  assert.ok(!resolution.onDemandCapabilityIds.includes('preview.renderStoryboard'));
  const bypassAttempt = session.requestCapabilities(['preview.renderStoryboard']);
  assert.strictEqual(bypassAttempt.status, 'rejected');
  assert.ok(bypassAttempt.issues.some((issue) => issue.code === 'requested_capability_forbidden'));
});

check('server-side budget rejects one-round full-catalog expansion', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('design.generic.v1')
  });
  const beforeNames = session.activeTools.map((tool) => tool.name);
  const requestTool = session.activeTools.find((tool) => tool.name === REQUEST_AGENT_CAPABILITIES_TOOL_NAME);
  const capabilityIdsSchema = requestTool.inputSchema.properties.capabilityIds;
  assert.strictEqual(capabilityIdsSchema.maxItems, MAX_ON_DEMAND_CAPABILITY_REQUESTS);

  const activation = session.requestCapabilities(
    session.getResolution().onDemandCapabilityIds.slice(0, MAX_ON_DEMAND_CAPABILITY_REQUESTS + 1)
  );
  assert.strictEqual(activation.status, 'rejected');
  assert.ok(activation.issues.some((issue) => issue.code === 'requested_capability_limit_exceeded'));
  assert.deepStrictEqual(session.activeTools.map((tool) => tool.name), beforeNames);
});

check('unknown tasks stay broad-discovery and never inherit a business manifest', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    requestedTaskType: 'design.unknown.v1'
  });
  const resolution = session.getResolution();

  assert.strictEqual(resolution.status, 'broad_discovery');
  assert.strictEqual(resolution.manifestRef, undefined);
  assert.ok(resolution.issues.some((issue) => issue.code === 'structured_manifest_unresolved'));
  assert.ok(resolution.metrics.schemaReductionApplied);
  assert.ok(session.activeTools.some((tool) => tool.name === REQUEST_AGENT_CAPABILITIES_TOOL_NAME));
  assert.ok(!session.activeTools.some((tool) => tool.name === 'createInteractiveCard'));
  assert.ok(!resolution.onDemandCapabilityIds.includes('agent.interaction.requestConfirmation'));
});

check('selected business manifest exposes only its own workflow bridge initially', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('ecommerce.main_image.v1')
  });
  const activeNames = session.activeTools.map((tool) => tool.name);

  assert.ok(activeNames.includes('main-image-design'));
  assert.ok(!activeNames.includes('detail-page-design'));
  assert.ok(!activeNames.includes('sku-batch'));
  assert.ok(schemaSize(session.activeTools) < schemaSize(candidateTools) * 0.65);
});

check('autonomous Agent cannot own generic confirmation while the manifest leaf Skill remains available', () => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('ecommerce.sku_batch.v1')
  });
  const resolution = session.getResolution();
  const activeNames = session.activeTools.map((tool) => tool.name);

  assert.strictEqual(resolution.status, 'resolved', JSON.stringify(resolution.issues, null, 2));
  assert.ok(activeNames.includes('sku-batch'), 'SKU manifest must expose its executable leaf Skill bridge');
  assert.ok(!activeNames.includes('createInteractiveCard'), 'generic confirmation must not compete with the leaf Skill');
  assert.ok(!activeNames.includes('getAnnotatedSnapshot'), 'vision-disabled SKU must not expose annotated snapshots');
  assert.ok(!activeNames.includes('getCanvasSnapshot'), 'vision-disabled SKU must not expose canvas snapshots');
  assert.ok(!resolution.onDemandCapabilityIds.includes('agent.interaction.requestConfirmation'));
  assert.ok(resolution.deniedCapabilityIds.includes('agent.interaction.requestConfirmation'));
  assert.ok(resolution.deniedToolNames.includes('createInteractiveCard'));

  const bypassAttempt = session.requestCapabilities(['agent.interaction.requestConfirmation']);
  assert.strictEqual(bypassAttempt.status, 'rejected');
  assert.ok(bypassAttempt.issues.some((issue) => issue.code === 'requested_capability_forbidden'));
  assert.ok(!session.activeTools.some((tool) => tool.name === 'createInteractiveCard'));
});

check('capability request is context state, not Photoshop write or task observation', () => {
  assert.strictEqual(
    classifyAgentToolExecution(REQUEST_AGENT_CAPABILITIES_TOOL_NAME, {}),
    'stateful_context'
  );

  const contract = buildAgentToolDecisionContract({
    userInput: '请读取并分析项目素材',
    intentControlPlane: buildAgentIntentControlPlaneDecision({
      userInput: '请读取并分析项目素材',
      hasDocument: false,
      photoshopConnected: false
    }),
    assistantContent: '我需要先装载项目分析能力。',
    toolCalls: [{
      name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
      arguments: { capabilityIds: ['project.read.analyzeAssetContent'] }
    }],
    runtime: {
      availableTools: [REQUEST_AGENT_CAPABILITIES_TOOL_NAME],
      photoshopConnected: false,
      hasDocument: false
    }
  });
  assert.strictEqual(contract.status, 'ready', JSON.stringify(contract, null, 2));
});

check('knowledge-search intent can reach the Harness capability loader without Photoshop', () => {
  const userInput = '找一些极简袜子主图设计参考';
  const contract = buildAgentToolDecisionContract({
    userInput,
    intentControlPlane: buildAgentIntentControlPlaneDecision({
      userInput,
      hasDocument: false,
      photoshopConnected: false
    }),
    assistantContent: '我需要先装载参考检索能力。',
    toolCalls: [{
      name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
      arguments: { capabilityIds: ['skill.design-reference-search'] }
    }],
    runtime: {
      availableTools: [REQUEST_AGENT_CAPABILITIES_TOOL_NAME],
      photoshopConnected: false,
      hasDocument: false
    }
  });
  assert.strictEqual(contract.intentToolScope, 'knowledge_search', JSON.stringify(contract, null, 2));
  assert.strictEqual(contract.status, 'ready', JSON.stringify(contract, null, 2));
});

check('production params keep text-derived Skill hints out of Capability manifest selection', () => {
  for (const [userTask, expectedLegacyHint] of [
    ['请从零设计一张袜子主图', 'main-image-design'],
    ['请做SKU批量图', 'sku-batch'],
    ['请从零设计一张商品详情页', undefined],
    ['请从零设计一张夏日促销海报', undefined]
  ]) {
    const params = buildAutonomousSkillParams(
      { userInput: userTask },
      undefined,
      buildAgentIntentControlPlaneDecision({ userInput: userTask })
    );
    if (expectedLegacyHint) {
      assert.strictEqual(params.skillId, expectedLegacyHint, userTask);
    }
    assert.strictEqual(params.declaredSkillId, undefined, userTask);
    const runtime = resolveAutonomousCapabilityRuntime(params, { userInput: userTask });
    assert.strictEqual(runtime.runtimeContractBundle, undefined, userTask);
    assert.strictEqual(runtime.capabilitySession.getResolution().manifestRef, undefined, userTask);
    assert.strictEqual(runtime.capabilitySession.getResolution().selectionMode, 'broad_discovery', userTask);
  }

  const plannerSelectedParams = buildAutonomousSkillParams(
    { userInput: '请设计商品主视觉' },
    { skillId: 'main-image-design', skillParams: {}, route: 'autonomous_agent' },
    buildAgentIntentControlPlaneDecision({ userInput: '请设计商品主视觉' })
  );
  assert.strictEqual(plannerSelectedParams.declaredSkillId, 'main-image-design');
  assert.strictEqual(
    resolveAutonomousCapabilityRuntime(plannerSelectedParams).runtimeContractBundle.manifest.skill_id,
    'ecommerce.main_image'
  );
});

async function runStructuredGenericTaskTypeR0Check() {
  const userInput = '请从零设计一张夏日活动海报，强调轻盈和清爽氛围';
  const context = {
    userInput,
    isPluginConnected: false,
    photoshopContext: { hasDocument: false },
    projectContext: {
      projectImageCount: 0,
      projectImageFolders: [],
      sampleImagePaths: []
    },
    conversationHistory: []
  };
  let classifierPrompt = '';
  const decision = await classifyActionableIntent(context, async (messages) => {
    classifierPrompt = String(messages[0]?.content || '');
    return {
      text: JSON.stringify({
        route: 'autonomous_agent',
        skillId: null,
        mode: 'execute',
        skillParams: {},
        taskTypeId: 'design.generic.v1',
        intentSummary: '从零设计一张夏日活动海报',
        executionApproach: 'public_plan'
      })
    };
  });

  assert.ok(classifierPrompt.includes('design.generic.v1'), 'R0 router must receive the declarable generic task type');
  assert.strictEqual(decision.taskTypeId, 'design.generic.v1');
  const params = buildAutonomousSkillParams(
    context,
    decision,
    buildAgentIntentControlPlaneDecision({ userInput })
  );
  assert.strictEqual(params.declaredTaskType, 'design.generic.v1');
  const runtime = resolveAutonomousCapabilityRuntime(params, context);
  assert.strictEqual(runtime.runtimeContractBundle.manifest.skill_id, 'design.general');
  assert.strictEqual(runtime.runtimeContractBundle.stagePlan.taskType, 'design.generic.v1');
  assert.strictEqual(runtime.capabilitySession.getResolution().selectionMode, 'manifest_seeded');

  const invalidDecision = await classifyActionableIntent(context, async () => ({
    text: JSON.stringify({
      route: 'autonomous_agent',
      skillId: null,
      mode: 'execute',
      skillParams: {},
      taskTypeId: 'design.unknown.v1',
      intentSummary: '尝试声明未知设计类型',
      executionApproach: 'direct_loop'
    })
  }));
  assert.strictEqual(invalidDecision.taskTypeId, undefined, 'unknown task types must not reach Runtime');

  const conflictingParams = buildAutonomousSkillParams(
    context,
    {
      route: 'autonomous_agent',
      skillId: 'main-image-design',
      skillParams: {},
      taskTypeId: 'design.generic.v1'
    },
    buildAgentIntentControlPlaneDecision({ userInput })
  );
  assert.strictEqual(
    conflictingParams.declaredTaskType,
    undefined,
    'generic task type must not override an explicitly selected Skill'
  );
  console.log('  ✓ R0 structured generic task type seeds the general-design runtime before the Agent loop');
}

async function runAgentIntegrationChecks() {
  const futureTool = {
    name: 'futureUnitTool',
    description: 'A future unit tool used only after capability activation.',
    inputSchema: { type: 'object', properties: {} }
  };
  const session = createAgentCapabilitySession({ candidateTools: [futureTool] });
  const task = '请从零设计一张夏日促销海报';
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: task,
    photoshopConnected: false,
    hasDocument: false
  });
  const modelToolSnapshots = [];
  const activationStatuses = [];
  let modelCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Test capability-loading agent.',
      tools: session.activeTools,
      modelId: 'test-model',
      maxIterations: 4,
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: false,
        hasDocument: false,
        hasImageInput: false
      },
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      modelToolSnapshots.push(tools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        return {
          content: '我需要先装载完成下一步所需的能力。',
          toolCalls: [{
            id: 'capability-request-1',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: {
              capabilityIds: [
                'legacy.tool.futureUnitTool',
                'legacy.tool.unknownOne',
                'legacy.tool.unknownTwo',
                'legacy.tool.unknownThree'
              ]
            }
          }]
        };
      }
      if (modelCallCount === 2) {
        return {
          content: '上一批过大，我只装载当前下一步需要的能力。',
          toolCalls: [{
            id: 'capability-request-2',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: { capabilityIds: ['legacy.tool.futureUnitTool'] }
          }]
        };
      }
      return { content: '设计已经完成。', toolCalls: [] };
    },
    async (toolName, params) => {
      if (toolName !== REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
        return { success: false, error: `unexpected tool ${toolName}` };
      }
      const activation = session.requestCapabilities(params.capabilityIds || []);
      activationStatuses.push(activation.status);
      return {
        success: activation.status !== 'rejected',
        data: {
          ...activation,
          countsAsObservation: false,
          countsAsTaskProgress: false
        }
      };
    }
  );

  const result = await agent.run(task);
  assert.ok(modelToolSnapshots.length >= 3, JSON.stringify(modelToolSnapshots));
  assert.ok(!modelToolSnapshots[0].includes('futureUnitTool'), JSON.stringify(modelToolSnapshots[0]));
  assert.ok(!modelToolSnapshots[1].includes('futureUnitTool'), JSON.stringify(modelToolSnapshots[1]));
  assert.ok(modelToolSnapshots[2].includes('futureUnitTool'), JSON.stringify(modelToolSnapshots[2]));
  assert.deepStrictEqual(activationStatuses, ['rejected', 'activated']);
  assert.strictEqual(result.success, false, JSON.stringify(result.executionSummary, null, 2));
  assert.notStrictEqual(result.executionSummary.status, 'completed');
  assert.strictEqual(result.executionSummary.successfulToolCalls, 0);
  const capabilityControlCalls = result.toolCallLog
    .filter((entry) => entry.name === REQUEST_AGENT_CAPABILITIES_TOOL_NAME)
    .map((entry) => entry.name);
  assert.deepStrictEqual(capabilityControlCalls, [
    REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
    REQUEST_AGENT_CAPABILITIES_TOOL_NAME
  ]);
  const nonControlCalls = result.toolCallLog
    .filter((entry) => entry.name !== REQUEST_AGENT_CAPABILITIES_TOOL_NAME)
    .map((entry) => entry.name);
  assert.ok(
    nonControlCalls.every((name) => name === 'getDocumentInfo'),
    `capability control may only be accompanied by the Runtime document observation: ${JSON.stringify(nonControlCalls)}`
  );
  assert.strictEqual(result.executionSummary.successfulMutationCalls, 0);
  console.log('  ✓ real Agent loads the schema next round but failed/recovered capability control cannot complete the task');
}

async function runGenericAtomicDesignWithoutSkillCheck() {
  const task = '在当前文档新增标题“夏日清风”，放在画面上方中央';
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('design.generic.v1')
  });
  const writeTextCapability = session.inventory.find((entry) => (
    entry.providerToolNames.includes('createTextLayer')
  ));
  assert.ok(writeTextCapability, 'generic Runtime must expose text writing through capability discovery');
  assert.ok(!session.activeTools.some((tool) => tool.name === 'createTextLayer'));

  const directIntentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: task,
    photoshopConnected: true,
    hasDocument: true
  });
  assert.strictEqual(
    directIntentControlPlane.requestKind,
    'autonomous_execution',
    'an explicit atomic Photoshop write must enter the autonomous Agent path directly'
  );
  assert.strictEqual(
    directIntentControlPlane.toolScope,
    'write_photoshop',
    'an explicit title creation request must not preserve the retired read-only false negative'
  );
  const modelDecision = {
    route: 'autonomous_agent',
    mode: 'execute',
    taskTypeId: 'design.generic.v1',
    skillId: undefined
  };
  const intentControlPlane = buildAutonomousRuntimeDecisionForAgentChoice(
    directIntentControlPlane,
    'R0 structured generic design execution declaration.',
    modelDecision
  );
  assert.strictEqual(intentControlPlane.toolScope, 'write_photoshop');
  assert.strictEqual(intentControlPlane.requestKind, 'autonomous_execution');

  const readonlyIntentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: '查看当前文档的标题在哪个图层',
    photoshopConnected: true,
    hasDocument: true
  });
  assert.strictEqual(readonlyIntentControlPlane.toolScope, 'read_only');
  assert.strictEqual(
    buildAutonomousRuntimeDecisionForAgentChoice(
      readonlyIntentControlPlane,
      'Inspect must stay readonly.',
      { ...modelDecision, mode: 'inspect' }
    ).toolScope,
    'read_only',
    'structured inspect must not gain write scope'
  );
  assert.strictEqual(
    buildAutonomousRuntimeDecisionForAgentChoice(
      readonlyIntentControlPlane,
      'Unknown task type must stay readonly.',
      { ...modelDecision, taskTypeId: 'design.unknown.v1' }
    ).toolScope,
    'read_only',
    'an unknown structured task type must not gain write scope'
  );
  const candidateOnlyIntent = buildAgentIntentControlPlaneDecision({
    userInput: '找一些夏日海报设计参考',
    photoshopConnected: true,
    hasDocument: true
  });
  assert.strictEqual(
    buildAutonomousRuntimeDecisionForAgentChoice(
      candidateOnlyIntent,
      'Candidate-only knowledge intent must not gain write scope.',
      modelDecision
    ).toolScope,
    candidateOnlyIntent.toolScope,
    'candidate-only knowledge intent must preserve its original scope'
  );
  const agentTaskPlan = buildAgentTaskPlanningContract({
    userInput: task,
    intentControlPlane,
    route: 'autonomous_agent'
  });
  assert.strictEqual(agentTaskPlan.executionPlan.mode, 'tool_execution');

  let modelCallCount = 0;
  const executedToolNames = [];
  const agent = new Agent(
    {
      systemPrompt: 'Test generic atomic design without a dedicated business Skill.',
      tools: session.activeTools,
      modelId: 'test-model',
      maxIterations: 6,
      agentTaskPlan,
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: true,
        hasDocument: true,
        hasImageInput: false
      },
      callbacks: {}
    },
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          content: '先装载当前这一步所需的文字写入能力。',
          toolCalls: [{
            id: 'generic-load-write-text',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: { capabilityIds: [writeTextCapability.capabilityId] }
          }]
        };
      }
      if (modelCallCount === 2) {
        return {
          content: '先读取当前文档和图层结构，避免在未知状态下盲写。',
          toolCalls: [{
            id: 'generic-read-before-write',
            name: 'getDocumentInfo',
            arguments: {}
          }]
        };
      }
      if (modelCallCount === 3) {
        return {
          content: '文档状态已确认，现在按当前文档坐标新增标题。',
          toolCalls: [{
            id: 'generic-create-title',
            name: 'createTextLayer',
            arguments: {
              content: '夏日清风',
              name: '标题-夏日清风',
              x: 750,
              y: 180,
              fontSize: 72,
              colorHex: '#FFFFFF',
              alignment: 'center'
            }
          }]
        };
      }
      if (modelCallCount === 4) {
        return {
          content: '写入完成，装载下一步画面复核所需的视觉读取能力。',
          toolCalls: [{
            id: 'generic-load-visual-readback',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: { capabilityIds: ['photoshop.read.getVisualSnapshot'] }
          }]
        };
      }
      if (modelCallCount === 5) {
        return {
          content: '读取写入后的图层结构和画面，核对标题是否真实写入。',
          toolCalls: [
            { id: 'generic-read-layers', name: 'getLayerHierarchy', arguments: {} },
            { id: 'generic-read-canvas', name: 'getCanvasSnapshot', arguments: {} }
          ]
        };
      }
      return { content: '标题已经写入，但当前是模拟画面结果，仍需查看真实画面后确认。', toolCalls: [] };
    },
    async (toolName, params) => {
      executedToolNames.push(toolName);
      if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
        const activation = session.requestCapabilities(params.capabilityIds || []);
        return {
          success: activation.status === 'activated',
          data: {
            ...activation,
            countsAsObservation: false,
            countsAsTaskProgress: false
          }
        };
      }
      if (toolName === 'createTextLayer') {
        return {
          success: true,
          data: { layerId: 101, layerName: '标题-夏日清风' },
          acceptance: {
            enabled: true,
            verified: false,
            assertionStatus: 'needs_review',
            noDocumentChangeRisk: true
          }
        };
      }
      if (toolName === 'getDocumentInfo') {
        return {
          success: true,
          observedAt: '2026-07-16T00:00:00.000Z',
          documentState: 'present',
          document: { id: 1, name: 'generic-poster.psd', width: 1500, height: 1500, layerCount: 2 }
        };
      }
      if (toolName === 'getLayerHierarchy') {
        return {
          success: true,
          data: { layers: [{ id: 101, name: '标题-夏日清风', kind: 'text' }] }
        };
      }
      if (toolName === 'getCanvasSnapshot') {
        return { success: true, data: { width: 1500, height: 1500, fixture: true } };
      }
      return { success: false, error: `unexpected tool ${toolName}` };
    }
  );

  const result = await agent.run(task);
  assert.ok(executedToolNames.includes('createTextLayer'), JSON.stringify({
    executedToolNames,
    toolCallLog: result.toolCallLog,
    executionSummary: result.executionSummary
  }, null, 2));
  assert.ok(executedToolNames.includes('getLayerHierarchy'), JSON.stringify(executedToolNames));
  assert.ok(executedToolNames.includes('getCanvasSnapshot'), JSON.stringify(executedToolNames));
  assert.ok(
    executedToolNames.every((name) => !workflowBridgeNames.includes(name)),
    `generic path must not call a business Skill: ${JSON.stringify(executedToolNames)}`
  );
  assert.strictEqual(result.executionSummary.successfulMutationCalls, 1);
  assert.strictEqual(result.executionSummary.status, 'needs_review');
  assert.strictEqual(result.success, false, 'a simulated Photoshop result must not complete a real design task');
  console.log('  ✓ generic Agent can load atomic design capability, write and read back without a business Skill, while a simulated result remains needs_review');
}

async function runPerIterationCapabilityBudgetCheck() {
  const futureTools = Array.from({ length: 6 }, (_value, index) => ({
    name: `futureRoundTool${index + 1}`,
    description: `Future round tool ${index + 1}`,
    inputSchema: { type: 'object', properties: {} }
  }));
  const session = createAgentCapabilitySession({ candidateTools: futureTools });
  const task = '请从零设计一张夏日促销海报';
  const modelToolSnapshots = [];
  let modelCallCount = 0;
  let capabilityExecutorCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Test per-iteration capability budget.',
      tools: session.activeTools,
      modelId: 'test-model',
      maxIterations: 4,
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({ userInput: task }),
        photoshopConnected: false,
        hasDocument: false,
        hasImageInput: false
      },
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      modelToolSnapshots.push(tools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        return {
          content: '我按两批装载六项能力。',
          toolCalls: [
            {
              id: 'round-request-1',
              name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
              arguments: {
                capabilityIds: [
                  'legacy.tool.futureRoundTool1',
                  'legacy.tool.futureRoundTool2',
                  'legacy.tool.futureRoundTool3'
                ]
              }
            },
            {
              id: 'round-request-2',
              name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
              arguments: {
                capabilityIds: [
                  'legacy.tool.futureRoundTool4',
                  'legacy.tool.futureRoundTool5',
                  'legacy.tool.futureRoundTool6'
                ]
              }
            }
          ]
        };
      }
      return { content: '设计已经完成。', toolCalls: [] };
    },
    async (toolName, params) => {
      assert.strictEqual(toolName, REQUEST_AGENT_CAPABILITIES_TOOL_NAME);
      capabilityExecutorCallCount += 1;
      const activation = session.requestCapabilities(params.capabilityIds || []);
      return { success: activation.status !== 'rejected', data: activation };
    }
  );

  const result = await agent.run(task);
  assert.ok(modelToolSnapshots.length >= 2, JSON.stringify(modelToolSnapshots));
  for (const name of ['futureRoundTool1', 'futureRoundTool2', 'futureRoundTool3']) {
    assert.ok(modelToolSnapshots[1].includes(name), JSON.stringify(modelToolSnapshots[1]));
  }
  for (const name of ['futureRoundTool4', 'futureRoundTool5', 'futureRoundTool6']) {
    assert.ok(!modelToolSnapshots[1].includes(name), JSON.stringify(modelToolSnapshots[1]));
  }
  assert.strictEqual(capabilityExecutorCallCount, 1, 'second control call in the same model iteration must not reach the session');
  assert.strictEqual(result.toolCallLog[1].result.code, 'capability_request_round_budget_exceeded');
  assert.strictEqual(result.success, false, JSON.stringify(result.executionSummary, null, 2));
  assert.strictEqual(result.executionSummary.successfulToolCalls, 0);
  console.log('  ✓ one model iteration cannot bypass the three-capability budget with multiple control calls');
}

async function runHarnessControlCompletionCheck() {
  const task = '请从零设计一张夏日促销海报';
  let modelCallCount = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Test Harness control accounting.',
      tools: [{
        name: 'declareDesignIntent',
        description: 'Declare structured design intent without executing the design.',
        inputSchema: {
          type: 'object',
          properties: { taskType: { type: 'string' } },
          required: ['taskType']
        }
      }],
      modelId: 'test-model',
      maxIterations: 4,
      toolDecisionContext: {
        intentControlPlane: buildAgentIntentControlPlaneDecision({
          userInput: task,
          photoshopConnected: true,
          hasDocument: false
        }),
        photoshopConnected: true,
        hasDocument: false,
        hasImageInput: false
      },
      callbacks: {}
    },
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          content: '我先声明本轮设计任务类型。',
          toolCalls: [{
            id: 'declare-intent-1',
            name: 'declareDesignIntent',
            arguments: { taskType: 'design.generic.v1' }
          }]
        };
      }
      return { content: '设计已经完成。', toolCalls: [] };
    },
    async () => ({ success: true, data: { shadowDeclaredDesignTaskTypeId: 'design.generic.v1' } })
  );

  const result = await agent.run(task);
  assert.strictEqual(
    result.toolCallLog.filter((entry) => entry.name === 'declareDesignIntent').length,
    1
  );
  const nonControlCalls = result.toolCallLog
    .filter((entry) => entry.name !== 'declareDesignIntent')
    .map((entry) => entry.name);
  assert.ok(
    nonControlCalls.every((name) => name === 'getDocumentInfo'),
    `intent declaration may only be accompanied by the Runtime document observation: ${JSON.stringify(nonControlCalls)}`
  );
  assert.strictEqual(result.executionSummary.successfulToolCalls, 0);
  assert.strictEqual(result.success, false, JSON.stringify(result.executionSummary, null, 2));
  assert.notStrictEqual(result.executionSummary.status, 'completed');
  console.log('  ✓ declareDesignIntent is Harness control and cannot complete a design task by itself');
}

runStructuredGenericTaskTypeR0Check()
  .then(runAgentIntegrationChecks)
  .then(runGenericAtomicDesignWithoutSkillCheck)
  .then(runPerIterationCapabilityBudgetCheck)
  .then(runHarnessControlCompletionCheck)
  .then(() => {
  const genericSession = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    manifest: getManifestByTaskType('design.generic.v1')
  });
  console.log(JSON.stringify({
    success: true,
    candidateCount: candidateTools.length,
    candidateSchemaChars: schemaSize(candidateTools),
    genericInitialCount: genericSession.activeTools.length,
    genericInitialSchemaChars: schemaSize(genericSession.activeTools)
  }, null, 2));
  }).catch((error) => {
  console.error(error);
  process.exit(1);
});
