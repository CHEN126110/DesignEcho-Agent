'use strict';

/**
 * smoke: v5 runtime contract bundle
 *
 * The autonomous Agent must resolve design Skill work through v5 manifests and
 * ReAct/Reflexion contracts, not through a detail-page-only branch or direct
 * script execution. Legacy skill ids are manifest-owned aliases. Natural task
 * text is deliberately not accepted by this deterministic resolver.
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const { listSkillManifests } = require(path.join(RT, 'skill-runtime.ts'));
const {
  buildRuntimeContractBundleForAgentTask,
  resolveSkillRuntimeManifestForAgentTask
} = require(path.join(RT, 'runtime-contract-bundle.ts'));

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

const legacyExecutableToolNames = [
  'listProjectResources',
  'searchProjectResources',
  'renderLayout',
  'searchEagleReferences',
  'analyzeEagleReference',
  'searchDesignKnowledge',
  'getDocumentInfo',
  'getLayerHierarchy',
  'getCanvasSnapshot',
  'getAcceptanceSnapshot',
  'getLayerBounds',
  'parseDetailPageTemplate',
  'detectLayerIssues',
  'fixLayerIssues',
  'matchDetailPageContent',
  'fillDetailPage',
  'createDocument',
  'createGroup',
  'createRectangle',
  'placeImage',
  'moveLayerToGroup',
  'createClippingMask',
  'convertToSmartObject',
  'editSmartObjectContents',
  'getSmartObjectInfo',
  'closeDocument',
  'switchDocument',
  'transformLayer',
  'setTextContent',
  'setTextStyle',
  'createTextLayer',
  'exportGroup',
  'exportDetailPageSlices',
  'quickExport',
  'saveDocument'
];

console.log('smoke: v5-runtime-contract-bundle');

check('registry covers core business skills without exposing legacy skill ids as tools', () => {
  const manifests = listSkillManifests();
  const skillIds = manifests.map((manifest) => manifest.skill_id);

  assert.ok(skillIds.includes('ecommerce.detail_page'), skillIds);
  assert.ok(skillIds.includes('ecommerce.main_image'), skillIds);
  assert.ok(skillIds.includes('ecommerce.sku_color_card'), skillIds);
  assert.ok(skillIds.includes('ecommerce.sku_batch'), skillIds);
  assert.ok(skillIds.includes('design.general'), skillIds);
  assert.ok(skillIds.includes('design.reference_replication'), skillIds);

  for (const manifest of manifests) {
    assert.ok(!manifest.available_tools.includes(manifest.skill_id), `${manifest.skill_id} leaked into available_tools`);
    assert.ok(!manifest.available_tools.includes(manifest.task_type), `${manifest.task_type} leaked into available_tools`);
    assert.ok(!manifest.available_tools.includes('main-image-design'), `${manifest.skill_id} leaked legacy main-image skill id`);
    assert.ok(!manifest.available_tools.includes('detail-page-design'), `${manifest.skill_id} leaked legacy detail-page skill id`);
    assert.ok(!manifest.available_tools.includes('sku-color-card'), `${manifest.skill_id} leaked legacy color-card skill id`);
    assert.ok(!manifest.available_tools.includes('sku-batch'), `${manifest.skill_id} leaked legacy sku skill id`);
    assert.ok(!manifest.available_tools.includes('layout-replication'), `${manifest.skill_id} leaked legacy replication skill id`);
  }
});

check('legacy skill ids resolve to v5 manifests before building runtime contracts', () => {
  const cases = [
    ['detail-page-design', 'ecommerce.detail_page'],
    ['main-image-design', 'ecommerce.main_image'],
    ['sku-color-card', 'ecommerce.sku_color_card'],
    ['sku-batch', 'ecommerce.sku_batch'],
    ['layout-replication', 'design.reference_replication']
  ];

  for (const [legacySkillId, expectedSkillId] of cases) {
    const manifest = resolveSkillRuntimeManifestForAgentTask({ skillId: legacySkillId });
    assert.ok(manifest, `missing manifest for ${legacySkillId}`);
    assert.strictEqual(manifest.skill_id, expectedSkillId);
  }
});

check('runtime bundle consumes the shared identity resolver and rejects artifact conflicts', () => {
  const sameIdentity = resolveSkillRuntimeManifestForAgentTask({
    skillId: 'detail-page-design',
    taskType: 'ecommerce.detail_page.v1'
  });
  const methodWorkflow = resolveSkillRuntimeManifestForAgentTask({
    skillId: 'layout-replication',
    taskType: 'ecommerce.detail_page.v1'
  });
  const conflict = resolveSkillRuntimeManifestForAgentTask({
    skillId: 'main-image-design',
    taskType: 'ecommerce.detail_page.v1'
  });
  assert.strictEqual(sameIdentity?.skill_id, 'ecommerce.detail_page');
  assert.strictEqual(methodWorkflow?.skill_id, 'ecommerce.detail_page');
  assert.strictEqual(methodWorkflow?.task_type, 'ecommerce.detail_page.v1');
  assert.ok(methodWorkflow?.available_tools.includes('photoshop.sandbox.createDocument'));
  assert.strictEqual(conflict, undefined);
});

check('artifact runtime contract owns stages, work modes, delivery and evaluation while method overlays capabilities', () => {
  const manifests = listSkillManifests();
  const detailManifest = manifests.find((manifest) => manifest.skill_id === 'ecommerce.detail_page');
  const replicationManifest = manifests.find((manifest) => manifest.skill_id === 'design.reference_replication');
  assert.ok(detailManifest);
  assert.ok(replicationManifest);

  const bundle = buildRuntimeContractBundleForAgentTask({
    skillId: 'layout-replication',
    taskType: 'ecommerce.detail_page.v1',
    workMode: 'edit_existing',
    executableToolNames: legacyExecutableToolNames
  });
  assert.ok(bundle);
  assert.strictEqual(bundle.manifest.skill_id, detailManifest.skill_id);
  assert.strictEqual(bundle.manifest.task_type, detailManifest.task_type);
  assert.strictEqual(bundle.artifactManifest?.skill_id, detailManifest.skill_id);
  assert.deepStrictEqual(
    bundle.methodManifests.map((manifest) => manifest.skill_id),
    [replicationManifest.skill_id]
  );

  // Artifact is the business-contract owner. Method inputs must not become R1/edit requirements.
  assert.deepStrictEqual(bundle.manifest.required_inputs, detailManifest.required_inputs);
  assert.deepStrictEqual(bundle.manifest.optional_inputs, detailManifest.optional_inputs);
  assert.deepStrictEqual(bundle.manifest.work_mode_contracts, detailManifest.work_mode_contracts);
  assert.deepStrictEqual(bundle.stagePlan.workModeContracts, detailManifest.work_mode_contracts);
  assert.strictEqual(bundle.stagePlan.expectedWorkMode, 'edit_existing');
  assert.deepStrictEqual(
    bundle.stagePlan.workModeContracts.edit_existing.required_inputs,
    ['existing_document', 'target_scope', 'requested_change']
  );
  assert.ok(!bundle.stagePlan.workModeContracts.edit_existing.required_inputs.includes('reference_image'));
  assert.deepStrictEqual(bundle.manifest.runtime_stages, detailManifest.runtime_stages);
  assert.deepStrictEqual(bundle.manifest.delivery_outputs, detailManifest.delivery_outputs);
  assert.deepStrictEqual(bundle.manifest.exit_criteria, detailManifest.exit_criteria);
  assert.deepStrictEqual(bundle.manifest.reference_policy, detailManifest.reference_policy);
  assert.deepStrictEqual(bundle.manifest.performance_profile, detailManifest.performance_profile);
  assert.strictEqual(bundle.manifest.review_rubric_ref, detailManifest.review_rubric_ref);
  assert.strictEqual(bundle.evaluationProfile?.profileId, 'rubrics/detail-page-scoped-edit.v1');
  assert.strictEqual(bundle.evaluationProfile?.skillId, detailManifest.skill_id);
  assert.strictEqual(bundle.evaluationProfile?.taskType, detailManifest.task_type);

  // Method inputs, source references and observations remain explicit while capabilities reach the live loop/bridge.
  assert.ok(bundle.methodOverlay);
  assert.deepStrictEqual(bundle.methodOverlay.manifestRefs, [
    `${replicationManifest.skill_id}@${replicationManifest.version}`
  ]);
  assert.ok(bundle.methodOverlay.requiredInputs.includes('reference_image'));
  assert.ok(bundle.methodOverlay.requiredObservations.includes('visual_observation'));
  assert.ok(bundle.methodOverlay.sourceRefs.some((ref) => ref.startsWith('knowledge:')));
  assert.ok(bundle.methodOverlay.knowledgeRefs.every((ref) => bundle.manifest.knowledge_refs.includes(ref)));
  assert.ok(bundle.manifest.required_model_profiles.includes('vision.reference'));
  assert.ok(bundle.manifest.available_tools.includes('photoshop.sandbox.createDocument'));
  assert.ok(bundle.runtimeLoopContract.reactLoop.toolBoundary.availableTools.includes('photoshop.sandbox.createDocument'));
  assert.ok(bundle.toolCapabilityBridge.mappedCapabilities.includes('photoshop.sandbox.createDocument'));
  assert.ok(bundle.toolCapabilityBridge.executableTools.includes('createDocument'));
});

check('structured work mode is strict and cannot silently fall back to another contract', () => {
  assert.strictEqual(buildRuntimeContractBundleForAgentTask({
    skillId: 'detail-page-design',
    taskType: 'ecommerce.detail_page.v1',
    workMode: 'bogus',
    executableToolNames: legacyExecutableToolNames
  }), undefined);
  assert.strictEqual(buildRuntimeContractBundleForAgentTask({
    skillId: 'main-image-design',
    taskType: 'ecommerce.main_image.v1',
    workMode: 'edit_existing',
    executableToolNames: legacyExecutableToolNames
  }), undefined);
});

check('generic design resolves only from its structured task type', () => {
  const manifest = resolveSkillRuntimeManifestForAgentTask({ taskType: 'design.generic.v1' });
  assert.ok(manifest);
  assert.strictEqual(manifest.skill_id, 'design.general');
  assert.deepStrictEqual(manifest.legacy_skill_ids, []);
  assert.ok(manifest.knowledge_refs.includes('tool:getDesignPrinciples'));
  assert.ok(manifest.memory_refs.includes('design-project-state/v0'));
  assert.ok(manifest.evaluation_refs.includes('design-quality-verdict/v0'));
  assert.ok(manifest.policy_refs.includes('agent-tool-decision-contract/v0'));
});

check('core business skills build ReAct/Reflexion bundles with explicit legacy tool bridges', () => {
  const cases = [
    ['detail-page-design', 'ecommerce.detail_page.v1'],
    ['main-image-design', 'ecommerce.main_image.v1'],
    ['sku-color-card', 'ecommerce.sku_color_card.v1'],
    ['sku-batch', 'ecommerce.sku_batch.v1'],
    ['layout-replication', 'design.reference_replication.v1']
  ];

  for (const [legacySkillId, expectedTaskType] of cases) {
    const bundle = buildRuntimeContractBundleForAgentTask({
      skillId: legacySkillId,
      executableToolNames: legacyExecutableToolNames
    });

    assert.ok(bundle, `missing bundle for ${legacySkillId}`);
    assert.strictEqual(bundle.version, 'runtime-contract-bundle/v0');
    assert.strictEqual(bundle.manifest.task_type, expectedTaskType);
    assert.strictEqual(bundle.stagePlan.version, 'runtime-stage-plan/v0');
    assert.strictEqual(bundle.stagePlan.skillId, bundle.manifest.skill_id);
    assert.deepStrictEqual(bundle.stagePlan.deliveryOutputs, bundle.manifest.delivery_outputs || []);
    assert.strictEqual(bundle.stagePlan.steps.length, bundle.manifest.runtime_stages.length);
    assert.ok(bundle.stagePlan.steps[0].objective.includes('选择 Skill'), JSON.stringify(bundle.stagePlan.steps[0], null, 2));
    assert.ok(bundle.stagePlan.steps[0].requiredOutcomes.includes('stage_plan_created'), JSON.stringify(bundle.stagePlan.steps[0], null, 2));
    assert.ok(bundle.stagePlan.steps.some((step) => step.stage === 'R5' && step.failureTarget === 'reflexion'));
    assert.strictEqual(bundle.runtimeLoopContract.version, 'react-reflexion-loop/v0');
    assert.strictEqual(bundle.runtimeLoopContract.r0.skillId, bundle.manifest.skill_id);
    assert.strictEqual(bundle.runtimeLoopContract.reactLoop.toolBoundary.availableToolsAreInitialSeeds, true);
    assert.strictEqual(bundle.runtimeLoopContract.reactLoop.toolBoundary.onDemandExpansionAllowed, true);
    assert.strictEqual(bundle.stagePlan.onDemandCapabilityExpansionAllowed, true);
    assert.strictEqual(bundle.toolCapabilityBridge.skillId, bundle.manifest.skill_id);
    assert.ok(bundle.toolCapabilityBridge.executableTools.length > 0, JSON.stringify(bundle.toolCapabilityBridge, null, 2));
    assert.ok(!bundle.toolCapabilityBridge.executableTools.includes(legacySkillId), `legacy skill id became tool: ${legacySkillId}`);
  }
});

check('task text never acts as a hidden category resolver', () => {
  const taskTextOnly = buildRuntimeContractBundleForAgentTask({
    taskText: '从零创建商品详情页',
    executableToolNames: legacyExecutableToolNames
  });
  assert.strictEqual(taskTextOnly, undefined);

  const explicitUnknown = buildRuntimeContractBundleForAgentTask({
    taskType: 'design.unknown.v1',
    skillId: 'main-image-design',
    taskText: '帮我做主图',
    executableToolNames: legacyExecutableToolNames
  });
  assert.strictEqual(explicitUnknown, undefined, 'explicit unknown task type must not downgrade to a similar category');

  const artifactConflict = buildRuntimeContractBundleForAgentTask({
    skillId: 'main-image-design',
    taskType: 'ecommerce.detail_page.v1',
    executableToolNames: legacyExecutableToolNames
  });
  assert.strictEqual(artifactConflict, undefined, 'two artifact owners must fail closed');
});
