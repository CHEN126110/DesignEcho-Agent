#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const ROOT = path.resolve(__dirname, '..');

const {
  BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS,
  buildBusinessSkillExecutionPreflightGate
} = require('../src/shared/business-skill-execution-preflight-gate.ts');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  assert(fs.existsSync(filePath), `${relativePath} is missing`);
  return fs.readFileSync(filePath, 'utf8');
}

function readPackageJson() {
  return JSON.parse(read('package.json'));
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('raw-image-payload'), `${label} must not keep raw image payload`, value);
  assert(!serialized.includes('base64-image-payload'), `${label} must not keep base64 image payload`, value);
}

function buildFullImplementationInputs() {
  return {
    designStandards: true,
    knowledgeRecipeSource: true,
    visualObservationPlan: true,
    photoshopToolPlan: true,
    qaAcceptancePlan: true,
    performanceBudget: true
  };
}

function assertSkillCoverage() {
  assert(
    BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS.join(',') === 'main-image-design,detail-page-design,sku-batch',
    'execution preflight gate must cover the three business design skills only',
    BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS
  );
}

function assertStrategyChangesAreBlockedWithoutCheckpoint(skillId) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'business_strategy',
    userCheckpointConfirmed: false,
    implementationInputs: {
      fexBenchmarkOnly: true,
      rawImage: 'raw-image-payload',
      imageData: 'base64-image-payload'
    },
    contextState: {}
  });

  assert(gate.status === 'blocked', `${skillId} strategy changes should block without user checkpoint`, gate);
  assert(gate.canChangeBusinessStrategy === false, `${skillId} must not allow strategy changes`, gate);
  assert(gate.blockers.includes('user_checkpoint_required'), `${skillId} should require user checkpoint`, gate);
  assert(
    gate.blockers.includes('required_business_skill_inputs_missing'),
    `${skillId} should require implementation inputs`,
    gate
  );
  assert(
    gate.warnings.includes('fex_benchmark_does_not_establish_business_strategy_readiness'),
    `${skillId} should not accept FEX as strategy readiness`,
    gate
  );
  assert(!Object.hasOwn(gate, 'claimBoundary'), `${skillId} must not expose a proof-style claim boundary`, gate);
  assert(!Object.hasOwn(gate, 'acceptanceControlPlane'), `${skillId} must not expose dev acceptance state`, gate);
  assertNoRawPayload(gate, `${skillId} blocked gate`);
}

function assertInfraOnlyIsAllowedWithoutStrategyPermission(skillId) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'infra_check',
    userCheckpointConfirmed: false,
    implementationInputs: {
      toolOnlyPanelFeature: true
    },
    contextState: {}
  });

  assert(gate.status === 'ready_for_infra_only', `${skillId} infra check should be allowed`, gate);
  assert(gate.canChangeBusinessStrategy === false, `${skillId} infra gate must not allow strategy changes`, gate);
  assert(
    gate.allowedActions.includes('attach_readonly_context'),
    `${skillId} infra gate should allow readonly context attachment`,
    gate
  );
  assert(
    gate.warnings.includes('tool_only_panel_feature_does_not_establish_agent_skill_strategy_readiness'),
    `${skillId} should preserve panel tool vs Agent skill boundary`,
    gate
  );
}

function assertStrategyReadyRequiresAllInputs(skillId) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'business_strategy',
    userCheckpointConfirmed: true,
    implementationInputs: buildFullImplementationInputs(),
    contextState: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: true,
      hasTemplateResult: true
    }
  });

  assert(gate.status === 'ready_for_strategy_design', `${skillId} strategy should be ready with full inputs`, gate);
  assert(gate.canChangeBusinessStrategy === true, `${skillId} should allow strategy only when fully ready`, gate);
  assert(
    gate.requiredInputs.length === 0,
    `${skillId} should not require more inputs when fully ready`,
    gate
  );
  assert(!Object.hasOwn(gate, 'acceptanceControlPlane'), `${skillId} must keep dev acceptance out of production preflight`, gate);
}

function assertExistingExecutionRequiresContext(skillId) {
  const missingContext = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'execute_existing',
    userCheckpointConfirmed: false,
    implementationInputs: {},
    contextState: {
      hasProjectContext: true
    }
  });

  assert(missingContext.status === 'needs_context', `${skillId} existing execution should require context`, missingContext);
  assert(
    missingContext.requiredInputs.includes('asset_index_required'),
    `${skillId} should require asset index before existing execution`,
    missingContext
  );
  assert(
    missingContext.requiredInputs.includes('visual_understanding_required'),
    `${skillId} should require visual understanding before existing execution`,
    missingContext
  );

  const ready = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'execute_existing',
    userCheckpointConfirmed: false,
    implementationInputs: {},
    contextState: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: true,
      hasTemplateResult: true
    }
  });

  assert(ready.status === 'ready_for_existing_execution', `${skillId} existing execution should be ready with context`, ready);
  assert(!Object.hasOwn(ready, 'claimBoundary'), `${skillId} must not expose a proof-style claim boundary`, ready);
}

function assertProductionPreflightHasNoAcceptanceControlPlane() {
  const source = read('src/shared/business-skill-execution-preflight-gate.ts');
  assert(!source.includes('agent-acceptance-control-plane'), 'production preflight must not import dev acceptance control plane');
  assert(!source.includes('acceptanceControlPlane'), 'production preflight must not expose acceptanceControlPlane');
  assert(!source.includes('acceptance_mode_not_available'), 'production preflight must not use dev acceptance blockers');
  assert(!source.includes('claimBoundary'), 'production preflight must not expose proof-style claim boundaries');
}

function assertPackageRegistration() {
  const packageJson = readPackageJson();
  const scripts = packageJson.scripts || {};
  assert(
    scripts['smoke:business-skill:execution-preflight-gate'] ===
      'node scripts/smoke-business-skill-execution-preflight-gate.cjs',
    'package.json should expose smoke:business-skill:execution-preflight-gate'
  );
  assert(
    String(scripts['maintenance:preflight'] || '').includes('smoke:business-skill:execution-preflight-gate'),
    'maintenance:preflight should include smoke:business-skill:execution-preflight-gate'
  );
}

function run() {
  assertSkillCoverage();

  for (const skillId of BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS) {
    assertStrategyChangesAreBlockedWithoutCheckpoint(skillId);
    assertInfraOnlyIsAllowedWithoutStrategyPermission(skillId);
    assertStrategyReadyRequiresAllInputs(skillId);
    assertExistingExecutionRequiresContext(skillId);
  }

  assertProductionPreflightHasNoAcceptanceControlPlane();

  assertPackageRegistration();

  return {
    success: true,
    checkedSkills: BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
