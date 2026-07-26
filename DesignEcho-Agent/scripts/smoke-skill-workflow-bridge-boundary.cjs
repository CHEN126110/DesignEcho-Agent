'use strict';

/**
 * smoke: skill workflow bridge boundary
 *
 * Legacy registered skills may still be exposed to the current renderer Agent
 * as callable workflow bridges. They must not be presented as ordinary atomic
 * tools or as hardcoded direct-answer shortcuts.
 */

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

const repoRoot = path.resolve(__dirname, '..');
const skillToolsPath = path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts');
const autonomousExecutorPath = path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts');

const skillToolsSource = fs.readFileSync(skillToolsPath, 'utf8');
const autonomousExecutorSource = fs.readFileSync(autonomousExecutorPath, 'utf8');

const {
  buildSkillToolSchemas,
  buildSkillWorkflowBridgeObservation,
  isSkillWorkflowBridgeToolName
} = require(skillToolsPath);

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('smoke: skill-workflow-bridge-boundary');

check('skill wrapper descriptions use workflow bridge language, not skill-as-tool wording', () => {
  const schemas = buildSkillToolSchemas();
  assert.ok(schemas.length > 0, 'expected at least one user-facing workflow bridge schema');
  for (const schema of schemas) {
    assert.ok(
      schema.description.startsWith('【工作流桥接】'),
      `schema ${schema.name} should start with workflow bridge label: ${schema.description}`
    );
    assert.ok(
      schema.description.includes('不是原子 Photoshop 工具'),
      `schema ${schema.name} should state it is not an atomic Photoshop tool`
    );
    assert.ok(
      !schema.description.includes('【技能·多步工作流】'),
      `schema ${schema.name} must not use old skill-as-tool label`
    );
  }
});

check('autonomous prompt does not instruct the model that skills are ordinary tools', () => {
  assert.ok(!autonomousExecutorSource.includes('Tools whose description starts with 【技能·多步工作流】'));
  assert.ok(!autonomousExecutorSource.includes('技能以工具形式暴露'));
  assert.ok(autonomousExecutorSource.includes('complete registered workflow'));
  assert.ok(autonomousExecutorSource.includes('workflow action'));
});

check('workflow bridge names remain detectable without treating arbitrary tools as skills', () => {
  assert.strictEqual(isSkillWorkflowBridgeToolName('sku-batch'), true);
  assert.strictEqual(isSkillWorkflowBridgeToolName('getDocumentInfo'), false);
  assert.strictEqual(isSkillWorkflowBridgeToolName('photoshop.read.getDocumentSummary'), false);
});

check('workflow bridge result carries ReAct observation instead of a terminal hardcoded answer', () => {
  const result = {
    success: false,
    message: '当前条件不足。',
    data: {
      status: 'blocked_before_workflow'
    }
  };
  const observation = buildSkillWorkflowBridgeObservation('sku-batch', result);

  assert.strictEqual(observation.version, 'agent-react-observation/v0');
  assert.strictEqual(observation.kind, 'skill');
  assert.strictEqual(observation.actionId, 'skill:sku-batch');
  assert.strictEqual(observation.nextAction, 'decide_next');
  assert.ok(observation.summary);
  assert.ok(!JSON.stringify(observation).includes('我可以协助这些设计工作'));
});

check('source documents the bridge as a legacy compatibility layer', () => {
  assert.ok(skillToolsSource.includes('legacy workflow bridge'));
  assert.ok(skillToolsSource.includes('Skill 不是 Tool'));
});
