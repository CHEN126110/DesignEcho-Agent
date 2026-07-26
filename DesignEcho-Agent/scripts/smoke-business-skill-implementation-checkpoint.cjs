#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  BUSINESS_DESIGN_SKILL_IDS,
  buildBusinessSkillImplementationCheckpoint
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'business-skill-implementation-checkpoint.ts'));

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relativePath} is missing`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertBlocked(checkpoint, message) {
  assert(checkpoint.status === 'blocked_needs_user_checkpoint', message, checkpoint);
  assert(checkpoint.canChangeBusinessStrategy === false, `${message}: strategy flag must be false`, checkpoint);
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('raw-image-payload'), `${label} must not keep raw image payload`, value);
  assert(!serialized.includes('base64-image-payload'), `${label} must not keep base64 image payload`, value);
}

const packageJson = JSON.parse(read('package.json'));

assert(
  Array.isArray(BUSINESS_DESIGN_SKILL_IDS),
  'BUSINESS_DESIGN_SKILL_IDS must be exported'
);
assert(
  BUSINESS_DESIGN_SKILL_IDS.join(',') === 'main-image-design,detail-page-design,sku-batch',
  'business skill checkpoint must cover only the three user-approved business skills',
  BUSINESS_DESIGN_SKILL_IDS
);

for (const skillId of BUSINESS_DESIGN_SKILL_IDS) {
  const blocked = buildBusinessSkillImplementationCheckpoint({
    skillId,
    intendedChange: 'business-strategy',
    userCheckpointConfirmed: false,
    evidence: {
      fexBenchmarkOnly: true,
      rawImage: 'raw-image-payload',
      imageData: 'base64-image-payload'
    }
  });

  assertBlocked(blocked, `${skillId} should block strategy changes by default`);
  assert(blocked.missingEvidence.length > 0, `${skillId} should report missing evidence`, blocked);
  assert(
    blocked.blockers.includes('user_checkpoint_required'),
    `${skillId} should require the user checkpoint`,
    blocked
  );
  assert(
    blocked.warnings.includes('fex_benchmark_is_not_business_strategy_evidence'),
    `${skillId} should not accept FEX as business strategy evidence`,
    blocked
  );
  assertNoRawPayload(blocked, `${skillId} blocked checkpoint`);

  const infraOnly = buildBusinessSkillImplementationCheckpoint({
    skillId,
    intendedChange: 'infra-only',
    userCheckpointConfirmed: false,
    evidence: {
      toolOnlyPanelFeature: true
    }
  });

  assert(
    infraOnly.status === 'ready_for_infra_only',
    `${skillId} infra-only changes should be allowed without strategy permission`,
    infraOnly
  );
  assert(
    infraOnly.canChangeBusinessStrategy === false,
    `${skillId} infra-only checkpoint must not allow business strategy changes`,
    infraOnly
  );
  assert(
    infraOnly.warnings.includes('tool_only_panel_feature_is_not_agent_skill_strategy_evidence'),
    `${skillId} should preserve UXP panel tool vs Agent skill boundary`,
    infraOnly
  );

  const ready = buildBusinessSkillImplementationCheckpoint({
    skillId,
    intendedChange: 'business-strategy',
    userCheckpointConfirmed: true,
    evidence: {
      designStandards: true,
      knowledgeRecipeSource: true,
      visualEvidencePlan: true,
      photoshopToolPlan: true,
      qaAcceptancePlan: true,
      performanceBudget: true
    }
  });

  assert(
    ready.status === 'ready_for_business_strategy',
    `${skillId} should be ready only after checkpoint and required evidence`,
    ready
  );
  assert(
    ready.canChangeBusinessStrategy === true,
    `${skillId} should allow strategy changes only in ready status`,
    ready
  );
  assert(ready.missingEvidence.length === 0, `${skillId} should not miss evidence in ready state`, ready);
  assert(
    ready.requiredQaEvidence.includes('photoshop_output_acceptance'),
    `${skillId} must require Photoshop output acceptance evidence`,
    ready
  );
}

assert(
  packageJson.scripts?.['smoke:business-skill:implementation-checkpoint'] ===
    'node scripts/smoke-business-skill-implementation-checkpoint.cjs',
  'package.json must register smoke:business-skill:implementation-checkpoint'
);
assert(
  String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:implementation-checkpoint'),
  'maintenance:preflight must include smoke:business-skill:implementation-checkpoint'
);

console.log(JSON.stringify({
  status: 'ok',
  checkedSkills: BUSINESS_DESIGN_SKILL_IDS,
  checks: [
    'business strategy changes block by default',
    'user checkpoint and required evidence are required',
    'FEX benchmark does not count as business strategy evidence',
    'UXP panel-only tools do not count as Agent skill strategy evidence',
    'raw image payload-like fields are not retained'
  ]
}, null, 2));
