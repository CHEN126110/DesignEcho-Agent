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
  buildRuntimeDesignBriefDigest,
  resolveRuntimeDesignBriefInputs,
  validateRuntimeDesignBriefDeclaration
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  SKU_BATCH_MANIFEST
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'sku-batch.manifest.ts'));
const {
  MAIN_IMAGE_MANIFEST
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'main-image.manifest.ts'));
const {
  DETAIL_PAGE_MANIFEST
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'detail-page.manifest.ts'));
const {
  buildRuntimeStagePlan
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const {
  Agent
} = require(path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  executeSkillTool
} = require(path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts'));
const {
  registerSkillExecutor
} = require(path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'registry.ts'));

const allowedContextRefs = ['context:user_goal', 'context:skill_manifest', 'context:opening_observation'];

function resolvedInputsForManifest(manifest) {
  return resolveRuntimeDesignBriefInputs({
    inputSources: manifest.input_sources,
    availableSources: manifest.required_inputs.map((inputKey) => ({
      sourceKind: manifest.input_sources[inputKey][0],
      inputKeys: [inputKey]
    }))
  });
}

function briefArguments(manifest = SKU_BATCH_MANIFEST) {
  const resolvedInputs = resolvedInputsForManifest(manifest);
  return {
    taskGoal: `依据已确认输入完成 ${manifest.display_name}，并保留可编辑结果。`,
    deliverables: manifest.delivery_outputs.slice(0, 3),
    outputRequirements: ['写入后读取导出结果或画面观察'],
    constraints: ['不把素材观察当作商品参数确认'],
    inputCoverage: manifest.required_inputs.map((inputKey) => ({
        inputKey,
        status: 'provided',
        contextRefs: [resolvedInputs.find((item) => item.inputKey === inputKey).contextRef]
      })),
    contextRefs: ['context:user_goal', 'context:skill_manifest', ...resolvedInputs.map((item) => item.contextRef)]
  };
}

const skuResolvedInputs = resolvedInputsForManifest(SKU_BATCH_MANIFEST);
const validated = validateRuntimeDesignBriefDeclaration({
  value: briefArguments(SKU_BATCH_MANIFEST),
  requiredInputKeys: SKU_BATCH_MANIFEST.required_inputs,
  optionalInputKeys: SKU_BATCH_MANIFEST.optional_inputs,
  allowedContextRefs,
  inputSources: SKU_BATCH_MANIFEST.input_sources,
  resolvedInputs: skuResolvedInputs
});
assert.strictEqual(validated.ok, true, JSON.stringify(validated.issues));
assert.strictEqual(validated.declaration.readiness, 'ready');
const briefDigest = buildRuntimeDesignBriefDigest({
  declaration: validated.declaration,
  requiredInputKeys: SKU_BATCH_MANIFEST.required_inputs
});

async function verifyAgentRuntimeContextHandoff() {
  const externalCalls = [];
  const stagePlan = buildRuntimeStagePlan(SKU_BATCH_MANIFEST);
  const agent = new Agent(
    {
      systemPrompt: 'R1 Skill consumer handoff smoke.',
      tools: [{
        name: 'sku-batch',
        description: 'SKU workflow bridge.',
        inputSchema: { type: 'object', properties: {} }
      }],
      modelId: 'test-model',
      maxIterations: 1,
      runtimeStagePlan: stagePlan,
      runtimeSessionIdentity: createRuntimeSessionIdentityForPlan(stagePlan, 'brief-skill-consumer'),
      callbacks: {}
    },
    async () => ({ content: 'unused', toolCalls: [] }),
    async (toolName, _args, runtimeContext) => {
      externalCalls.push({ toolName, runtimeContext });
      if (toolName === 'getAnnotatedSnapshot') return { success: true, elements: [] };
      if (toolName === 'sku-batch') return { success: true, data: { status: 'fixture' } };
      throw new Error(`Unexpected Tool: ${toolName}`);
    }
  );
  agent.runtimeDesignBriefDeclaration = validated.declaration;
  const result = await agent.executeToolWithFailureBreaker('sku-batch', {});
  const skuCall = externalCalls.find((entry) => entry.toolName === 'sku-batch');
  assert(skuCall, JSON.stringify(externalCalls, null, 2));
  assert.strictEqual(skuCall.runtimeContext.runtimeDesignBriefDeclaration.readiness, 'ready');
  assert.strictEqual(skuCall.runtimeContext.runtimeDesignBriefDigest.version, 'runtime-design-brief-digest/v0');
  assert.deepStrictEqual(
    skuCall.runtimeContext.runtimeDesignBriefRequiredInputKeys,
    SKU_BATCH_MANIFEST.required_inputs
  );
  assert.strictEqual(result.success, true);
  return { externalCalls: externalCalls.map((entry) => entry.toolName) };
}

function buildSkillContext(scenario) {
  return {
    userInput: '生成电商设计',
    isPluginConnected: true,
    projectContext: {
      projectPath: 'D:/fixture',
      assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
      visualSamplingPlan: {
        planVersion: 'project-visual-sampling/v0',
        mode: 'bounded-metadata-plan',
        scenario,
        maxCandidates: 2,
        selectedCandidates: [],
        skippedCandidateCount: 0,
        cacheSummary: { hit: 2, miss: 0, stale: 0, shouldAnalyze: 0 },
        warnings: [],
        limitations: [],
        sourceRecords: []
      },
      visualInsightCache: {
        summary: { totalEntries: 2, entriesWithInsight: 2, entriesWithRawPayloadRemoved: 0 }
      }
    }
  };
}

async function verifySkillRunnerHandoff() {
  const cases = [
    { skillId: 'main-image-design', manifest: MAIN_IMAGE_MANIFEST, scenario: 'main-image' },
    { skillId: 'detail-page-design', manifest: DETAIL_PAGE_MANIFEST, scenario: 'detail-page' },
    { skillId: 'sku-batch', manifest: SKU_BATCH_MANIFEST, scenario: 'sku' }
  ];
  const summaries = [];
  for (const item of cases) {
    let received;
    registerSkillExecutor({
      skillId: item.skillId,
      async execute(input) {
        received = input;
        return {
          success: true,
          message: 'fixture',
          data: {
            briefReadiness: input.runtimeDesignBriefDeclaration?.readiness,
            briefDigestVersion: input.runtimeDesignBriefDigest?.version,
            requiredInputKeys: input.runtimeDesignBriefRequiredInputKeys
          }
        };
      }
    });
    const validation = validateRuntimeDesignBriefDeclaration({
      value: briefArguments(item.manifest),
      requiredInputKeys: item.manifest.required_inputs,
      optionalInputKeys: item.manifest.optional_inputs,
      allowedContextRefs,
      inputSources: item.manifest.input_sources,
      resolvedInputs: resolvedInputsForManifest(item.manifest)
    });
    assert.strictEqual(validation.ok, true, JSON.stringify(validation.issues));
    const digest = buildRuntimeDesignBriefDigest({
      declaration: validation.declaration,
      requiredInputKeys: item.manifest.required_inputs
    });
    const result = await executeSkillTool(item.skillId, {}, {
      context: buildSkillContext(item.scenario),
      runtimeDesignBriefDeclaration: validation.declaration,
      runtimeDesignBriefDigest: digest,
      runtimeDesignBriefRequiredInputKeys: item.manifest.required_inputs
    });
    assert(received, JSON.stringify(result, null, 2));
    assert.strictEqual(received.runtimeDesignBriefDeclaration.readiness, 'ready');
    assert.strictEqual(received.runtimeDesignBriefDigest.version, 'runtime-design-brief-digest/v0');
    assert.deepStrictEqual(received.runtimeDesignBriefRequiredInputKeys, item.manifest.required_inputs);
    assert.strictEqual(result.data.briefReadiness, 'ready');
    assert.strictEqual(result.data.briefDigestVersion, 'runtime-design-brief-digest/v0');
    assert(result.data.agentReActObservation, JSON.stringify(result, null, 2));
    summaries.push({
      skillId: item.skillId,
      briefReadiness: result.data.briefReadiness,
      briefDigestVersion: result.data.briefDigestVersion,
      requiredInputKeys: result.data.requiredInputKeys
    });
  }
  return summaries;
}

function verifySourceBoundaries() {
  const activeSources = [
    'src/renderer/services/agent-runtime/agent.ts',
    'src/renderer/services/skill-executors/autonomous-agent.executor.ts',
    'src/renderer/services/skill-executors/skill-tools.ts',
    'src/renderer/services/skill-executors/sku-batch.executor.ts',
    'src/shared/project-design-understanding-summary.ts',
    'src/shared/project-product-understanding.ts'
  ].map((relativePath) => ({
    relativePath,
    source: fs.readFileSync(path.join(root, relativePath), 'utf8')
  }));
  const joined = activeSources.map((entry) => entry.source).join('\n');
  assert(!joined.includes('ecommerce-product-design-brief'));
  assert(!joined.includes('buildEcommerceProductDesignBrief'));
  assert(!joined.includes('EcommerceProductDesignBrief'));
  const skuSource = activeSources.find((entry) => entry.relativePath.endsWith('sku-batch.executor.ts')).source;
  assert(skuSource.includes('projectProductUnderstanding'));
  assert(skuSource.includes('runtimeDesignBriefDigest'));
  return activeSources.map((entry) => entry.relativePath);
}

Promise.all([
  verifyAgentRuntimeContextHandoff(),
  verifySkillRunnerHandoff()
]).then(([agentHandoff, skillRunnerHandoff]) => {
  console.log(JSON.stringify({
    success: true,
    agentHandoff,
    skillRunnerHandoff,
    inspectedSources: verifySourceBoundaries(),
    boundary: 'R1 context is passed by Harness to the selected Skill; product observations remain separate and no legacy category Brief survives in active source'
  }, null, 2));
}).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
