'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const { createRuntimeSessionIdentityForPlan } = require('./runtime-session-smoke-fixture.cjs');
const {
  DECLARE_DESIGN_BRIEF_TOOL_NAME,
  buildDeclareDesignBriefToolSchema,
  buildRuntimeDesignBriefDigest,
  resolveRuntimeDesignBriefInputs,
  validateRuntimeDesignBriefDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  buildRuntimeStagePlan,
  resolveRuntimeStagePlanEffectiveContract
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { MAIN_IMAGE_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'main-image.manifest.ts'));
const { DETAIL_PAGE_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'detail-page.manifest.ts'));
const { SKU_BATCH_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'sku-batch.manifest.ts'));
const { REFERENCE_REPLICATION_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'reference-replication.manifest.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));
const {
  DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-evaluation-profiles.ts'));
const { Agent } = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

const allowedContextRefs = [
  'context:user_goal',
  'context:skill_manifest',
  'context:attached_images',
  'context:readback'
];

function resolvedInputsForKeys(manifest, inputKeys, sourceKindOverrides = {}) {
  return resolveRuntimeDesignBriefInputs({
    inputSources: manifest.input_sources,
    availableSources: inputKeys.map((inputKey) => ({
      sourceKind: sourceKindOverrides[inputKey] || manifest.input_sources[inputKey][0],
      inputKeys: [inputKey]
    }))
  });
}

function validBriefForManifest(manifest, overrides = {}, requiredInputKeys = manifest.required_inputs) {
  const resolvedInputs = resolvedInputsForKeys(manifest, requiredInputKeys);
  return {
    taskGoal: `完成 ${manifest.display_name}，并保持结果可编辑、可复核。`,
    deliverables: [...manifest.delivery_outputs],
    targetAudience: '需要快速理解商品信息并完成选择的目标用户。',
    channel: '电商商品展示',
    outputRequirements: ['结果必须可编辑', '写入后必须读取结构或视觉观察'],
    constraints: ['不得编造商品事实', '不得以工具成功替代设计质量通过'],
    inputCoverage: requiredInputKeys.map((inputKey) => ({
      inputKey,
      status: 'provided',
      contextRefs: [resolvedInputs.find((item) => item.inputKey === inputKey).contextRef]
    })),
    contextRefs: ['context:user_goal', 'context:skill_manifest', ...resolvedInputs.map((item) => item.contextRef)],
    ...overrides
  };
}

function briefForResolvedInputs(manifest, requiredInputKeys, resolvedInputs, overrides = {}) {
  return {
    ...validBriefForManifest(manifest, {}, requiredInputKeys),
    inputCoverage: requiredInputKeys.map((inputKey) => ({
      inputKey,
      status: 'provided',
      contextRefs: [resolvedInputs.find((item) => item.inputKey === inputKey).contextRef]
    })),
    contextRefs: ['context:user_goal', 'context:skill_manifest', ...resolvedInputs.map((item) => item.contextRef)],
    ...overrides
  };
}

assert.deepStrictEqual(SKU_BATCH_MANIFEST.required_inputs, ['goal']);
assert.deepStrictEqual(SKU_BATCH_MANIFEST.input_sources.goal, ['user_goal']);
assert(SKU_BATCH_MANIFEST.optional_inputs.includes('sku_source'));
assert(SKU_BATCH_MANIFEST.optional_inputs.includes('combination_rules'));

for (const manifest of [MAIN_IMAGE_MANIFEST, REFERENCE_REPLICATION_MANIFEST, DETAIL_PAGE_MANIFEST, SKU_BATCH_MANIFEST]) {
  const plan = buildRuntimeStagePlan(manifest);
  const resolvedInputs = resolvedInputsForKeys(manifest, plan.requiredInputs);
  assert.deepStrictEqual(plan.requiredInputs, manifest.required_inputs);
  assert((manifest.optional_inputs || []).every((inputKey) => plan.optionalInputs.includes(inputKey)));
  const schema = buildDeclareDesignBriefToolSchema({
    requiredInputKeys: plan.requiredInputs,
    optionalInputKeys: plan.optionalInputs,
    allowedContextRefs,
    inputSources: plan.inputSources,
    resolvedInputs
  });
  assert.strictEqual(schema.name, DECLARE_DESIGN_BRIEF_TOOL_NAME);
  assert(manifest.required_inputs.every((inputKey) => schema.inputSchema.properties.inputCoverage.items.properties.inputKey.enum.includes(inputKey)));
  assert((manifest.optional_inputs || []).every((inputKey) => schema.inputSchema.properties.inputCoverage.items.properties.inputKey.enum.includes(inputKey)));
  const coverageContextRefEnum = schema.inputSchema.properties.inputCoverage.items.properties.contextRefs.items.enum || [];
  assert(
    resolvedInputs.every((item) => coverageContextRefEnum.includes(item.contextRef)),
    `${manifest.skill_id}: exact resolved input refs must be available to inputCoverage`
  );
  assert(
    allowedContextRefs.every((ref) => !coverageContextRefEnum.includes(ref)),
    `${manifest.skill_id}: general context refs must not be exposed as inputCoverage bindings`
  );
  assert(schema.description.includes(manifest.required_inputs.join(', ')));
  const validation = validateRuntimeDesignBriefDeclaration({
    value: validBriefForManifest(manifest),
    requiredInputKeys: plan.requiredInputs,
    optionalInputKeys: plan.optionalInputs,
    allowedContextRefs,
    inputSources: plan.inputSources,
    resolvedInputs
  });
  assert.strictEqual(validation.ok, true, `${manifest.skill_id}: ${JSON.stringify(validation.issues)}`);
  assert.strictEqual(validation.readiness, 'ready');
  assert.strictEqual(validation.declaration.boundaries.manifestInputsAreSourceOfTruth, true);
  assert.strictEqual(validation.declaration.boundaries.categoryNeutral, true);
  assert.strictEqual(validation.declaration.boundaries.executesTools, false);
  assert.strictEqual(validation.declaration.boundaries.grantsPermission, false);
  assert.strictEqual(validation.declaration.boundaries.autoActivatesCapabilities, false);
  assert.strictEqual(validation.declaration.boundaries.countsAsTaskProgress, false);
  assert.strictEqual(validation.declaration.boundaries.countsAsQualityPass, false);
  const digest = buildRuntimeDesignBriefDigest({
    declaration: validation.declaration,
    requiredInputKeys: plan.requiredInputs
  });
  assert.strictEqual(digest.requiredInputCount, manifest.required_inputs.length);
  assert.strictEqual(digest.providedRequiredInputCount, manifest.required_inputs.length);
  assert.deepStrictEqual(digest.missingRequiredInputKeys, []);
  assert.strictEqual(digest.boundaries.digestOnly, true);
  assert.strictEqual(digest.boundaries.grantsPermission, false);
}

const detailModePlan = buildRuntimeStagePlan(DETAIL_PAGE_MANIFEST);
const detailEditContract = resolveRuntimeStagePlanEffectiveContract(detailModePlan, 'edit_existing');
const detailCreateContract = resolveRuntimeStagePlanEffectiveContract(detailModePlan, 'create_new');
const detailEditResolvedInputs = resolvedInputsForKeys(
  DETAIL_PAGE_MANIFEST,
  detailEditContract.requiredInputs,
  {
    existing_document: 'photoshop_document',
    target_scope: 'photoshop_target',
    requested_change: 'user_goal'
  }
);
assert.strictEqual(detailEditContract.source, 'work-mode-contract');
assert(detailEditContract.requiredInputs.includes('existing_document'));
assert(detailEditContract.requiredInputs.includes('target_scope'));
assert(detailEditContract.requiredInputs.includes('requested_change'));
assert(!detailEditContract.requiredInputs.includes('product'));
assert(!detailEditContract.exitCriteria.some((item) => item.includes('storyboard 已生成且经用户确认')));
assert(detailEditContract.deliveryOutputs.includes('change_verification_report'));
assert(detailCreateContract.requiredInputs.includes('product'));
assert(detailCreateContract.requiredInputs.includes('asset_source'));
assert(detailCreateContract.exitCriteria.some((item) => item.includes('storyboard 已生成')));
const detailWorkModeInputContracts = Object.fromEntries(
  Object.entries(detailModePlan.workModeContracts).map(([workMode, contract]) => [workMode, {
    requiredInputKeys: contract.required_inputs,
    optionalInputKeys: contract.optional_inputs
  }])
);
const detailWorkModeBriefSchema = buildDeclareDesignBriefToolSchema({
  requiredInputKeys: detailModePlan.requiredInputs,
  optionalInputKeys: detailModePlan.optionalInputs,
  allowedContextRefs,
  inputSources: detailModePlan.inputSources,
  resolvedInputs: detailEditResolvedInputs,
  workModeRequired: true,
  workModeInputContracts: detailWorkModeInputContracts
});
assert.strictEqual(detailWorkModeBriefSchema.inputSchema.properties.inputCoverage.minItems, 0);
assert(detailWorkModeBriefSchema.inputSchema.properties.inputCoverage.items.properties.inputKey.enum.includes('existing_document'));
assert(detailWorkModeBriefSchema.inputSchema.properties.inputCoverage.items.properties.inputKey.enum.includes('requested_change'));
assert(detailWorkModeBriefSchema.description.includes('edit_existing: required=[existing_document, target_scope, requested_change]'));
assert(detailWorkModeBriefSchema.description.includes('complete replacement contract'));
const detailExpectedEditPlan = buildRuntimeStagePlan(DETAIL_PAGE_MANIFEST, 'edit_existing');
const detailExpectedEditSchema = buildDeclareDesignBriefToolSchema({
  requiredInputKeys: detailExpectedEditPlan.requiredInputs,
  optionalInputKeys: detailExpectedEditPlan.optionalInputs,
  allowedContextRefs,
  inputSources: detailExpectedEditPlan.inputSources,
  resolvedInputs: detailEditResolvedInputs,
  workModeRequired: true,
  expectedWorkMode: detailExpectedEditPlan.expectedWorkMode,
  workModeInputContracts: detailWorkModeInputContracts
});
assert.deepStrictEqual(detailExpectedEditSchema.inputSchema.properties.workMode.enum, ['edit_existing']);
assert.strictEqual(
  resolveRuntimeStagePlanEffectiveContract(detailExpectedEditPlan, 'create_new').workMode,
  'edit_existing'
);
const mismatchedWorkMode = validateRuntimeDesignBriefDeclaration({
  value: {
    ...validBriefForManifest(
      DETAIL_PAGE_MANIFEST,
      {},
      detailEditContract.requiredInputs
    ),
    workMode: 'create_new'
  },
  requiredInputKeys: detailEditContract.requiredInputs,
  optionalInputKeys: detailEditContract.optionalInputs,
  allowedContextRefs,
  inputSources: detailExpectedEditPlan.inputSources,
  resolvedInputs: detailEditResolvedInputs,
  workModeRequired: true,
  expectedWorkMode: 'edit_existing'
});
assert.strictEqual(mismatchedWorkMode.ok, false);
assert(mismatchedWorkMode.issues.some((issue) => issue.code === 'work_mode_identity_mismatch'));

const generalPlan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
const generalResolvedInputs = resolvedInputsForKeys(GENERAL_DESIGN_MANIFEST, generalPlan.requiredInputs);
const unresolvedGeneralSchema = buildDeclareDesignBriefToolSchema({
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: []
});
assert.strictEqual(
  unresolvedGeneralSchema.inputSchema.properties.inputCoverage.items.properties.contextRefs.maxItems,
  0,
  'inputCoverage must not accept arbitrary refs when Harness has not resolved an exact input source'
);
const needsInput = validateRuntimeDesignBriefDeclaration({
  value: validBriefForManifest(GENERAL_DESIGN_MANIFEST, {
    inputCoverage: [{
      inputKey: 'goal',
      status: 'missing',
      contextRefs: []
    }]
  }),
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: generalResolvedInputs
});
assert.strictEqual(needsInput.ok, true);
assert.strictEqual(needsInput.readiness, 'needs_input');

const assumedInput = validateRuntimeDesignBriefDeclaration({
  value: validBriefForManifest(GENERAL_DESIGN_MANIFEST, {
    inputCoverage: [{
      inputKey: 'goal',
      status: 'assumed',
      contextRefs: []
    }]
  }),
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: generalResolvedInputs
});
assert.strictEqual(assumedInput.ok, true);
assert.strictEqual(assumedInput.readiness, 'needs_input');

const missingCoverage = validateRuntimeDesignBriefDeclaration({
  value: validBriefForManifest(GENERAL_DESIGN_MANIFEST, { inputCoverage: [] }),
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: generalResolvedInputs
});
assert.strictEqual(missingCoverage.ok, false);
assert(missingCoverage.issues.some((issue) => issue.code === 'required_input_coverage_missing'));

const unknownInput = validateRuntimeDesignBriefDeclaration({
  value: validBriefForManifest(GENERAL_DESIGN_MANIFEST, {
    inputCoverage: [{
      inputKey: 'fixed_category_template',
      status: 'provided',
      contextRefs: ['context:user_goal']
    }]
  }),
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: generalResolvedInputs
});
assert.strictEqual(unknownInput.ok, false);
assert(unknownInput.issues.some((issue) => issue.code === 'input_key_not_in_manifest'));

const unavailableContext = validateRuntimeDesignBriefDeclaration({
  value: validBriefForManifest(GENERAL_DESIGN_MANIFEST, {
    inputCoverage: [{
      inputKey: 'goal',
      status: 'provided',
      contextRefs: ['context:not_available']
    }],
    contextRefs: ['context:not_available']
  }),
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: generalResolvedInputs
});
assert.strictEqual(unavailableContext.ok, false);
assert(unavailableContext.issues.some((issue) => issue.code === 'context_ref_not_available'));

const sensitive = validateRuntimeDesignBriefDeclaration({
  value: validBriefForManifest(GENERAL_DESIGN_MANIFEST, { taskGoal: '读取 C:\\private\\secret.psd 完成设计' }),
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: generalResolvedInputs
});
assert.strictEqual(sensitive.ok, false);
assert(sensitive.issues.some((issue) => issue.code === 'sensitive_payload_forbidden'));

const implementationLeak = validateRuntimeDesignBriefDeclaration({
  value: validBriefForManifest(GENERAL_DESIGN_MANIFEST, { constraints: ['调用 moveLayer 工具执行 Photoshop 命令'] }),
  requiredInputKeys: generalPlan.requiredInputs,
  optionalInputKeys: generalPlan.optionalInputs,
  allowedContextRefs,
  inputSources: generalPlan.inputSources,
  resolvedInputs: generalResolvedInputs
});
assert.strictEqual(implementationLeak.ok, false);
assert(implementationLeak.issues.some((issue) => issue.code === 'implementation_detail_forbidden'));

const typedInputCases = [
  {
    label: 'main-image',
    manifest: MAIN_IMAGE_MANIFEST,
    plan: buildRuntimeStagePlan(MAIN_IMAGE_MANIFEST),
    requiredInputKeys: MAIN_IMAGE_MANIFEST.required_inputs,
    optionalInputKeys: MAIN_IMAGE_MANIFEST.optional_inputs,
    resolvedInputs: resolvedInputsForKeys(MAIN_IMAGE_MANIFEST, MAIN_IMAGE_MANIFEST.required_inputs)
  },
  {
    label: 'reference-replication',
    manifest: REFERENCE_REPLICATION_MANIFEST,
    plan: buildRuntimeStagePlan(REFERENCE_REPLICATION_MANIFEST),
    requiredInputKeys: REFERENCE_REPLICATION_MANIFEST.required_inputs,
    optionalInputKeys: REFERENCE_REPLICATION_MANIFEST.optional_inputs,
    resolvedInputs: resolvedInputsForKeys(REFERENCE_REPLICATION_MANIFEST, REFERENCE_REPLICATION_MANIFEST.required_inputs)
  },
  {
    label: 'sku-batch',
    manifest: SKU_BATCH_MANIFEST,
    plan: buildRuntimeStagePlan(SKU_BATCH_MANIFEST),
    requiredInputKeys: SKU_BATCH_MANIFEST.required_inputs,
    optionalInputKeys: SKU_BATCH_MANIFEST.optional_inputs,
    resolvedInputs: resolvedInputsForKeys(SKU_BATCH_MANIFEST, SKU_BATCH_MANIFEST.required_inputs)
  },
  {
    label: 'detail-page-edit',
    manifest: DETAIL_PAGE_MANIFEST,
    plan: detailExpectedEditPlan,
    requiredInputKeys: detailEditContract.requiredInputs,
    optionalInputKeys: detailEditContract.optionalInputs,
    resolvedInputs: detailEditResolvedInputs,
    workMode: 'edit_existing'
  }
];
for (const item of typedInputCases) {
  const realBrief = briefForResolvedInputs(
    item.manifest,
    item.requiredInputKeys,
    item.resolvedInputs,
    item.workMode ? { workMode: item.workMode } : {}
  );
  const realValidation = validateRuntimeDesignBriefDeclaration({
    value: realBrief,
    requiredInputKeys: item.requiredInputKeys,
    optionalInputKeys: item.optionalInputKeys,
    allowedContextRefs,
    inputSources: item.plan.inputSources,
    resolvedInputs: item.resolvedInputs,
    workModeRequired: Boolean(item.workMode),
    ...(item.workMode ? { expectedWorkMode: item.workMode } : {})
  });
  assert.strictEqual(realValidation.ok, true, `${item.label}: ${JSON.stringify(realValidation.issues)}`);
  assert.strictEqual(realValidation.readiness, 'ready', item.label);
  const forgedValidation = validateRuntimeDesignBriefDeclaration({
    value: {
      ...realBrief,
      inputCoverage: item.requiredInputKeys.map((inputKey) => ({
        inputKey,
        status: 'provided',
        contextRefs: ['context:user_goal']
      })),
      contextRefs: ['context:user_goal', 'context:skill_manifest']
    },
    requiredInputKeys: item.requiredInputKeys,
    optionalInputKeys: item.optionalInputKeys,
    allowedContextRefs,
    inputSources: item.plan.inputSources,
    resolvedInputs: item.resolvedInputs,
    workModeRequired: Boolean(item.workMode),
    ...(item.workMode ? { expectedWorkMode: item.workMode } : {})
  });
  assert.strictEqual(forgedValidation.ok, false, `${item.label} accepted a general context ref`);
  assert(forgedValidation.issues.some((issue) => issue.code === 'input_ref_not_resolved_for_key'));
}

const source = fs.readFileSync(
  path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'),
  'utf8'
);
assert(!/detailPage|mainImage|sku_batch|袜子|服装/.test(source));
assert(!source.includes('taskText'));
assert(!source.includes('executeTool('));

async function runAgentIntegration() {
  const task = '请基于当前目标建立设计简报，后续策略和执行等 Brief 就绪后再继续';
  let modelCallCount = 0;
  const externalToolCalls = [];
  const tools = [{
    name: 'setLayerOpacity',
    description: 'Set layer opacity.',
    inputSchema: {
      type: 'object',
      properties: {
        layerId: { type: 'number' },
        opacity: { type: 'number' }
      }
    }
  }];
  const gateAgent = new Agent(
    {
      systemPrompt: 'R1 Design Brief gate smoke.',
      tools,
      modelId: 'test-model',
      maxIterations: 2,
      runtimeStagePlan: generalPlan,
      runtimeDesignBriefAvailableInputSources: [{ sourceKind: 'user_goal' }],
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(generalPlan, 'brief-gate'),
      callbacks: {}
    },
    async () => ({ content: 'unused', toolCalls: [] }),
    async (toolName) => {
      externalToolCalls.push(toolName);
      return { success: true, layerId: 7, opacity: 80 };
    }
  );
  const blockedWrite = await gateAgent.executeToolWithFailureBreaker('setLayerOpacity', { layerId: 7, opacity: 80 });
  assert.strictEqual(blockedWrite.blockedByRuntimeDesignBrief, true);
  assert.deepStrictEqual(externalToolCalls, []);
  const inputCollectionResult = await gateAgent.executeToolWithFailureBreaker('createInteractiveCard', {
    title: '补充设计输入',
    fields: []
  });
  assert.strictEqual(inputCollectionResult.success, true);
  assert.deepStrictEqual(externalToolCalls, ['createInteractiveCard']);
  const invalidBriefResult = await gateAgent.executeToolWithFailureBreaker(
    DECLARE_DESIGN_BRIEF_TOOL_NAME,
    validBriefForManifest(GENERAL_DESIGN_MANIFEST, {
      inputCoverage: [{ inputKey: 'goal', status: 'provided', contextRefs: ['context:user_goal'] }]
    })
  );
  assert.strictEqual(invalidBriefResult.success, false);
  assert.strictEqual(invalidBriefResult.code, 'runtime_design_brief_declaration_invalid');
  assert(
    invalidBriefResult.error.includes('input_ref_not_resolved_for_key') &&
      invalidBriefResult.error.includes('inputCoverage[0].contextRefs[0]'),
    'invalid Design Brief results must expose a bounded code/path summary instead of an empty error'
  );
  const briefResult = await gateAgent.executeToolWithFailureBreaker(
    DECLARE_DESIGN_BRIEF_TOOL_NAME,
    validBriefForManifest(GENERAL_DESIGN_MANIFEST)
  );
  assert.strictEqual(briefResult.success, true);
  assert.strictEqual(briefResult.readiness, 'ready');
  const allowedWrite = await gateAgent.executeToolWithFailureBreaker('setLayerOpacity', { layerId: 7, opacity: 80 });
  assert.strictEqual(allowedWrite.success, true);
  assert.deepStrictEqual(externalToolCalls, ['createInteractiveCard', 'setLayerOpacity']);

  const detailEditExecutionContexts = [];
  const detailEditAgent = new Agent(
    {
      systemPrompt: 'Detail edit work-mode contract smoke.',
      tools: [],
      modelId: 'test-model',
      maxIterations: 1,
      runtimeStagePlan: detailExpectedEditPlan,
      runtimeDesignBriefAvailableInputSources: [
        { sourceKind: 'user_goal' },
        { sourceKind: 'photoshop_target' }
      ],
      toolDecisionContext: { hasDocument: true },
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(detailExpectedEditPlan, 'detail-edit-brief'),
      callbacks: {}
    },
    async () => ({ content: 'unused', toolCalls: [] }),
    async (_toolName, _arguments, context) => {
      detailEditExecutionContexts.push(context);
      return { success: true, documentId: 17, documentName: 'detail-page.psd' };
    }
  );
  const detailEditBrief = briefForResolvedInputs(
    DETAIL_PAGE_MANIFEST,
    detailEditContract.requiredInputs,
    detailEditResolvedInputs,
    {
    workMode: 'edit_existing',
    taskGoal: '修改第三屏文案并保持其他图层不变',
    deliverables: [...detailEditContract.deliveryOutputs],
    outputRequirements: ['保留可编辑文字', '修改后读取目标文字与画面观察'],
    constraints: ['不修改第三屏以外的图层']
    }
  );
  const detailEditBriefResult = await detailEditAgent.executeToolWithFailureBreaker(
    DECLARE_DESIGN_BRIEF_TOOL_NAME,
    detailEditBrief
  );
  assert.strictEqual(detailEditBriefResult.success, true, JSON.stringify(detailEditBriefResult));
  assert.strictEqual(detailEditBriefResult.readiness, 'ready');
  assert.strictEqual(detailEditBriefResult.briefDigest.requiredInputCount, 3);
  assert.deepStrictEqual(detailEditBriefResult.briefDigest.missingRequiredInputKeys, []);
  assert.strictEqual(
    detailEditAgent.resolveRuntimeEvaluationProfile().profileId,
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
  );
  assert.strictEqual(detailEditAgent.requiresReferenceContextResolution(), false);
  assert(detailEditAgent.buildRuntimeR2Outcomes().includes('reference_context_resolved'));
  const detailEditReadResult = await detailEditAgent.executeToolWithFailureBreaker('getDocumentInfo', {});
  assert.strictEqual(detailEditReadResult.success, true);
  assert.strictEqual(detailEditExecutionContexts.length, 1);
  assert.deepStrictEqual(
    detailEditExecutionContexts[0].runtimeDesignBriefRequiredInputKeys,
    detailEditContract.requiredInputs
  );
  assert.strictEqual(detailEditExecutionContexts[0].runtimeDesignBriefDigest.requiredInputCount, 3);
  assert.deepStrictEqual(detailEditExecutionContexts[0].runtimeDesignBriefDigest.missingRequiredInputKeys, []);
  assert(!detailEditExecutionContexts[0].runtimeDesignBriefRequiredInputKeys.includes('goal'));

  const detailNeedsInputAgent = new Agent(
    {
      systemPrompt: 'Detail edit missing-input blocker smoke.',
      tools,
      modelId: 'test-model',
      maxIterations: 1,
      runtimeStagePlan: detailExpectedEditPlan,
      runtimeDesignBriefAvailableInputSources: [
        { sourceKind: 'user_goal' },
        { sourceKind: 'photoshop_target' }
      ],
      toolDecisionContext: { hasDocument: true },
      callbacks: {}
    },
    async () => ({ content: 'unused', toolCalls: [] }),
    async () => ({ success: true })
  );
  const detailNeedsInputBriefResult = await detailNeedsInputAgent.executeToolWithFailureBreaker(
    DECLARE_DESIGN_BRIEF_TOOL_NAME,
    {
      ...detailEditBrief,
      inputCoverage: detailEditContract.requiredInputs.map((inputKey) => ({
        inputKey,
        status: 'missing',
        contextRefs: []
      }))
    }
  );
  assert.strictEqual(detailNeedsInputBriefResult.success, true);
  assert.strictEqual(detailNeedsInputBriefResult.readiness, 'needs_input');
  const detailEditBlocker = await detailNeedsInputAgent.executeToolWithFailureBreaker(
    'setLayerOpacity',
    { layerId: 7, opacity: 80 }
  );
  assert.strictEqual(detailEditBlocker.blockedByRuntimeDesignBrief, true);
  assert.deepStrictEqual(detailEditBlocker.missingRequiredInputs, detailEditContract.requiredInputs);
  assert(!detailEditBlocker.missingRequiredInputs.includes('goal'));

  let detailEditModelCallCount = 0;
  const detailEditRunAgent = new Agent(
    {
      systemPrompt: 'Detail edit final digest smoke.',
      tools,
      modelId: 'test-model',
      maxIterations: 2,
      runtimeStagePlan: detailExpectedEditPlan,
      runtimeDesignBriefAvailableInputSources: [{ sourceKind: 'photoshop_target' }],
      toolDecisionContext: { hasDocument: true },
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(detailExpectedEditPlan, 'detail-edit-final-digest'),
      callbacks: {}
    },
    async () => {
      detailEditModelCallCount += 1;
      if (detailEditModelCallCount === 1) {
        return {
          content: '声明现有详情页文案修改简报。',
          toolCalls: [{
            id: 'declare-detail-edit-brief',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: detailEditBrief
          }]
        };
      }
      return { content: 'Design Brief 已记录，等待后续观察与执行。', toolCalls: [] };
    },
    async (toolName) => {
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '3-产品信息/icon' }] };
      }
      return { success: true };
    }
  );
  const detailEditRunResult = await detailEditRunAgent.run('修改第三屏文案，其他图层保持不变');
  assert.strictEqual(detailEditRunResult.executionSummary.runtimeDesignBriefDigest.requiredInputCount, 3);
  assert.deepStrictEqual(
    detailEditRunResult.executionSummary.runtimeDesignBriefDigest.missingRequiredInputKeys,
    []
  );
  assert(!detailEditRunResult.executionSummary.runtimeDesignBriefDigest.missingRequiredInputKeys.includes('goal'));

  const loopExternalToolCalls = [];
  const agent = new Agent(
    {
      systemPrompt: 'R1 Design Brief integration smoke.',
      tools,
      modelId: 'test-model',
      maxIterations: 3,
      runtimeStagePlan: generalPlan,
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(generalPlan, 'brief-integration'),
      callbacks: {}
    },
    async (_modelId, _messages, tools) => {
      modelCallCount += 1;
      const hasBrief = tools.some((tool) => tool.name === DECLARE_DESIGN_BRIEF_TOOL_NAME);
      const hasStrategy = tools.some((tool) => tool.name === 'declareDesignStrategy');
      if (modelCallCount === 1) {
        assert.strictEqual(hasBrief, true);
        assert.strictEqual(hasStrategy, false);
        return {
          content: '先声明当前设计简报。',
          toolCalls: [{
            id: 'declare-brief',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: validBriefForManifest(GENERAL_DESIGN_MANIFEST)
          }]
        };
      }
      if (modelCallCount === 2) {
        assert.strictEqual(hasBrief, false);
        assert.strictEqual(hasStrategy, true);
        return { content: 'Design Brief 已记录，后续策略与执行仍需继续。', toolCalls: [] };
      }
      return { content: '结束。', toolCalls: [] };
    },
    async (toolName) => {
      loopExternalToolCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '目标图层' }] };
      }
      throw new Error(`Harness control leaked to external executor: ${toolName}`);
    }
  );
  const result = await agent.run(task);
  assert.deepStrictEqual(loopExternalToolCalls, ['getAnnotatedSnapshot']);
  assert(result.toolCallLog.some((entry) => entry.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
  assert(result.data.runtimeDesignBriefDeclaration);
  assert(result.executionSummary.runtimeDesignBriefDigest);
  assert.strictEqual(result.executionSummary.runtimeDesignBriefDigest.readiness, 'ready');
  const r1 = result.executionSummary.runtimeStageState.stages.find((stage) => stage.stage === 'R1');
  assert.strictEqual(r1.status, 'passed');
  assert.deepStrictEqual(r1.observedOutcomes.sort(), ['blocking_inputs_identified', 'required_inputs_checked']);

  let stalledR1ModelCallCount = 0;
  const stalledR1ExternalToolCalls = [];
  const stalledR1VisibleToolNames = [];
  const stalledR1Steps = [];
  const stalledR1Agent = new Agent(
    {
      systemPrompt: 'R1 repeated-read convergence smoke.',
      tools: [
        {
          name: 'getDocumentInfo',
          description: 'Read the current Photoshop document.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'getLayerHierarchy',
          description: 'Read the current Photoshop layer hierarchy.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'requestAgentCapabilities',
          description: 'Load optional capabilities.',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      modelId: 'test-model',
      maxIterations: 4,
      runtimeStagePlan: generalPlan,
      runtimeDesignBriefAvailableInputSources: [{ sourceKind: 'user_goal' }],
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(generalPlan, 'brief-r1-read-stall'),
      callbacks: {
        onStep: (step) => stalledR1Steps.push(step)
      }
    },
    async (_modelId, _messages, visibleTools) => {
      stalledR1ModelCallCount += 1;
      const visibleToolNames = visibleTools.map((tool) => tool.name);
      stalledR1VisibleToolNames.push(visibleToolNames);
      assert(
        !visibleToolNames.includes('requestAgentCapabilities'),
        `R1 must not advertise capability loading before the action-plan stage: ${JSON.stringify(visibleToolNames)}`
      );
      if (stalledR1ModelCallCount === 1) {
        assert(visibleToolNames.includes('getDocumentInfo'));
        return {
          content: '先读取当前文档。',
          toolCalls: [{ id: 'r1-read-document', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      if (stalledR1ModelCallCount === 2) {
        assert(visibleToolNames.includes('getLayerHierarchy'));
        return {
          content: '继续读取当前图层结构。',
          toolCalls: [{ id: 'r1-read-hierarchy', name: 'getLayerHierarchy', arguments: {} }]
        };
      }
      if (stalledR1ModelCallCount === 3) {
        assert.deepStrictEqual(
          visibleToolNames,
          [DECLARE_DESIGN_BRIEF_TOOL_NAME],
          'after two R1 read rounds, the next model call must expose only declareDesignBrief'
        );
        return {
          content: '已有上下文足够形成设计简报。',
          toolCalls: [{
            id: 'r1-declare-after-read-stall',
            name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
            arguments: validBriefForManifest(GENERAL_DESIGN_MANIFEST)
          }]
        };
      }
      return { content: '设计简报已完成，后续阶段仍需继续。', toolCalls: [] };
    },
    async (toolName) => {
      stalledR1ExternalToolCalls.push(toolName);
      if (toolName === 'getAnnotatedSnapshot') {
        return { success: true, elements: [{ id: 7, name: '当前文案', type: 'textLayer' }] };
      }
      if (toolName === 'getDocumentInfo') {
        return { success: true, documentId: 17, document: { id: 17, name: 'detail-page.psd' } };
      }
      if (toolName === 'getLayerHierarchy') {
        return { success: true, layers: [{ id: 7, name: '当前文案', type: 'textLayer' }] };
      }
      throw new Error(`Harness control leaked to external executor: ${toolName}`);
    }
  );
  const stalledR1Result = await stalledR1Agent.run('读取当前详情页上下文后建立设计简报，再继续完成文案修改');
  const stalledR1State = stalledR1Result.executionSummary.runtimeStageState.stages.find((stage) => stage.stage === 'R1');
  assert.strictEqual(stalledR1State.status, 'passed');
  assert(stalledR1Result.toolCallLog.some((entry) => entry.name === DECLARE_DESIGN_BRIEF_TOOL_NAME));
  assert.deepStrictEqual(
    stalledR1ExternalToolCalls,
    ['getAnnotatedSnapshot', 'getDocumentInfo', 'getLayerHierarchy']
  );
  assert(
    stalledR1Steps.some((step) => step.issue === 'runtime_stage_progress_recovery'),
    `R1 read drift must emit a convergence step: ${JSON.stringify(stalledR1Steps)}`
  );
  assert.notStrictEqual(stalledR1Result.executionSummary.runtimeStageState.currentStage, 'R5');
  return {
    gateExternalToolCalls: externalToolCalls,
    loopExternalToolCalls,
    r1Status: r1.status,
    briefReadiness: result.executionSummary.runtimeDesignBriefDigest.readiness,
    detailEditBriefReadiness: detailEditBriefResult.readiness,
    detailEditRequiredInputCount: detailEditBriefResult.briefDigest.requiredInputCount,
    detailEditContextRequiredInputKeys: detailEditExecutionContexts[0].runtimeDesignBriefRequiredInputKeys,
    detailEditBlockerMissingRequiredInputs: detailEditBlocker.missingRequiredInputs,
    detailEditFinalDigestRequiredInputCount: detailEditRunResult.executionSummary.runtimeDesignBriefDigest.requiredInputCount,
    stalledR1ModelCallCount,
    stalledR1VisibleToolNames,
    stalledR1ExternalToolCalls,
    stalledR1Status: stalledR1State.status,
    executionStatus: result.executionSummary.status
  };
}

runAgentIntegration().then((agentIntegration) => {
  console.log(JSON.stringify({
    success: true,
    manifests: [
      MAIN_IMAGE_MANIFEST.skill_id,
      REFERENCE_REPLICATION_MANIFEST.skill_id,
      DETAIL_PAGE_MANIFEST.skill_id,
      SKU_BATCH_MANIFEST.skill_id
    ],
    invalidCases: {
      missingCoverage: missingCoverage.issues.map((issue) => issue.code),
      unknownInput: unknownInput.issues.map((issue) => issue.code),
      unavailableContext: unavailableContext.issues.map((issue) => issue.code),
      sensitive: sensitive.issues.map((issue) => issue.code),
      implementationLeak: implementationLeak.issues.map((issue) => issue.code)
    },
    agentIntegration,
    boundary: 'model-authored R1 brief; manifest-bound Harness validation; readonly context remains available; no execution or quality authority'
  }, null, 2));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
