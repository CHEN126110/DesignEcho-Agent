#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');

function runNode(script, args) {
  return execFileSync(process.execPath, [path.join(agentRoot, 'scripts', script), ...args], {
    cwd: agentRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const neutralPlan = JSON.parse(runNode('plan-reference-replication-capture.cjs', [
    '--id', 'rr-002-neutral-quality-card-text-layout',
    '--json'
  ]));
  assert(neutralPlan.success === true, 'neutral capture plan should be buildable');
  assert(neutralPlan.referenceImage.exists === true, 'neutral reference image should exist');
  assert(neutralPlan.plannedResult.benchmarkRelativePath === 'results/rr-002-neutral-quality-card-text-layout-result.png', 'neutral result path should be stable');
  assert(neutralPlan.scenario.sourceKind === 'synthetic-fixture', 'neutral case should remain synthetic fixture');
  assert(neutralPlan.scenario.realReferenceSource === false, 'synthetic fixture must not be treated as real source');
  assert(neutralPlan.liveRunBoundary.canClaimDesignQualityAfterRecording === false, 'synthetic fixture must not become quality-claim evidence');
  assert(neutralPlan.commands.recordResultAfterScreenshot.includes('benchmark:reference-replication:record-result'), 'plan should include record-result command');
  assert(neutralPlan.commands.recordResultAfterScreenshot.includes('--manual-verified'), 'record command should require manual verification');
  assert(neutralPlan.commands.recordResultAfterScreenshot.includes('--score-overall'), 'record command should include score placeholders');

  const fexPlan = JSON.parse(runNode('plan-reference-replication-capture.cjs', [
    '--id', 'rr-001-fex-certificate-text-layout',
    '--json'
  ]));
  assert(fexPlan.scenario.temporaryFex === true, 'FEX case should be marked temporary');
  assert(fexPlan.scenario.realReferenceSource === false, 'FEX must not be treated as real source');
  assert(fexPlan.liveRunBoundary.canClaimDesignQualityAfterRecording === false, 'FEX must not become quality-claim evidence');
  assert(fexPlan.warnings.some((item) => item.includes('FEX')), 'FEX plan should warn about temporary benchmark boundary');

  console.log(JSON.stringify({
    success: true,
    checkedCases: [neutralPlan.caseId, fexPlan.caseId],
    neutralPlannedResult: neutralPlan.plannedResult.benchmarkRelativePath,
    neutralCanClaimQuality: neutralPlan.liveRunBoundary.canClaimDesignQualityAfterRecording,
    fexCanClaimQuality: fexPlan.liveRunBoundary.canClaimDesignQualityAfterRecording
  }, null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
