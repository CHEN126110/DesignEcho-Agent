#!/usr/bin/env node

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

const fs = require('fs');
const path = require('path');
const { buildBusinessSkillExecutionIntake } = require('../src/shared/business-skill-execution-intake.ts');
const { buildBusinessSkillVisualContextPreparation } = require('../src/shared/business-skill-visual-context-preparation.ts');

const root = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function run() {
  const preparation = buildBusinessSkillVisualContextPreparation({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false,
    requiresVisualObservation: true
  });
  const intake = buildBusinessSkillExecutionIntake({
    skillId: 'sku-batch',
    stage: 'before_executor',
    visualContextPreparation: preparation
  });

  assert(intake.decision === 'observation_incomplete', 'intake should summarize incomplete observation context', intake);
  assert(intake.requiredInputs.includes('visual_understanding'), 'intake should preserve missing inputs', intake);
  assert(intake.recommendedActions.includes('continue_with_skill_input_validation'), 'intake should delegate actual inputs to the Skill', intake);
  assert(!Object.prototype.hasOwnProperty.call(intake, 'canRunBusinessExecutor'), 'intake must not authorize the executor', intake);
  assert(!Object.prototype.hasOwnProperty.call(intake, 'shouldBlockBeforeExecutor'), 'intake must not block the executor', intake);
  assert(!Object.prototype.hasOwnProperty.call(intake, 'shouldRunPreExecutionRefresh'), 'intake must not create a second refresh control plane', intake);
  assert(!Object.prototype.hasOwnProperty.call(intake, 'blockers'), 'intake must not aggregate blockers', intake);
  assert(!Object.prototype.hasOwnProperty.call(intake, 'sourceRecords'), 'intake must not fabricate a list of its own component names as sources', intake);
  assert(intake.observations.every((item) => !Object.prototype.hasOwnProperty.call(item, 'status')), 'intake observations must have no verdict', intake);

  const refreshIntake = buildBusinessSkillExecutionIntake({
    skillId: 'sku-batch',
    stage: 'after_executor',
    visualContextPreparation: preparation,
    visualContextPreparationRun: {
      attempted: true,
      status: 'failed',
      warnings: ['fixture refresh failure'],
      observations: [{ source: 'fixture-refresh', summary: 'refresh failed' }]
    }
  });
  assert(refreshIntake.decision === 'refresh_recorded', 'refresh activity should be recorded as context', refreshIntake);
  assert(refreshIntake.warnings.includes('fixture refresh failure'), 'refresh warning should be retained', refreshIntake);
  assert(!Object.prototype.hasOwnProperty.call(refreshIntake, 'sourceRecords'), 'refresh intake must keep actual observations instead of self-source records', refreshIntake);
  assert(!JSON.stringify(refreshIntake).includes('blocked_by_strict_visual_observation'), 'removed strict decision must not reappear', refreshIntake);

  const source = read('src/shared/business-skill-execution-intake.ts');
  assert(!source.includes('BusinessSkillVisualObservationControlDecision'), 'intake must not depend on deleted control decision');
  assert(!source.includes('canRunBusinessExecutor'), 'intake source must not expose executor permission');
  assert(!source.includes('shouldBlockBeforeExecutor'), 'intake source must not expose blocking decision');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'execution intake is a context summary rather than an authorization layer',
      'missing observation becomes missing input plus recommendation',
      'refresh failures are recorded without blockers or permission fields',
      'observation records contain no verdict'
    ]
  }, null, 2));
}

run();
