'use strict';

/**
 * smoke: v5 Reflexion boundary
 *
 * Guards the governance goal:
 * - blocked / structure-only design planning must not be a terminal hardcoded answer;
 *   it must carry an explicit Reflexion contract: observe -> critique -> revise.
 * - skill manifests declare task capability; available_tools / tool_namespaces remain
 *   tool capability names, not skill IDs or ad-hoc script loops.
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
require(path.join(RT, 'manifests', 'detail-page.structure-preset.ts'));

const { decideDetailPagePlanning } = require(path.join(RT, 'detail-page-planning-gate.ts'));
const { getManifestByTaskType } = require(path.join(RT, 'skill-runtime.ts'));
const {
  buildReActReflexionLoopContract,
  buildReflexionHandoffFromReviewReport,
  validateManifestToolSkillBoundary
} = require(path.join(RT, 'reflexion-contract.ts'));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function baseContext() {
  return {
    projectId: 'project-reflexion',
    conversationId: 'conversation-reflexion',
    taskType: 'ecommerce.detail_page.v1',
    sourceRevision: 0
  };
}

console.log('smoke: v5-reflexion-boundary');

check('blocked visual-observation gate carries Reflexion contract before any user-visible card', () => {
  const decision = decideDetailPagePlanning({
    gate: {
      hasAssetMetadata: true,
      hasFilenames: true
    },
    context: baseContext(),
    visualBootstrapReady: false
  });

  assert.strictEqual(decision.planningMode, 'blocked');
  assert.ok(decision.card, 'blocked decision should still provide a recovery card');
  assert.ok(decision.reflexion, 'blocked decision must carry Reflexion contract');
  assert.strictEqual(decision.reflexion.status, 'required');
  assert.strictEqual(decision.reflexion.trigger, 'visual_observation_blocked');
  assert.strictEqual(decision.reflexion.userVisiblePolicy, 'agent_mediated_before_card');
  assert.deepStrictEqual(
    decision.reflexion.phases.map((phase) => phase.phase),
    ['observe', 'critique', 'revise']
  );
  assert.ok(
    decision.reflexion.phases.some((phase) => /文件名|元数据|视觉观察/.test(phase.summary)),
    'Reflexion must explain why filenames/metadata are insufficient'
  );
});

check('structure-only fallback carries Reflexion contract and remains non-executable', () => {
  const decision = decideDetailPagePlanning({
    gate: {
      fallbackMode: 'structure_only',
      hasFilenames: true
    },
    context: baseContext(),
    visualBootstrapReady: false
  });

  assert.strictEqual(decision.planningMode, 'structure_only');
  assert.ok(decision.card, 'structure-only decision should provide skeleton card');
  assert.ok(decision.reflexion, 'structure-only decision must carry Reflexion contract');
  assert.strictEqual(decision.reflexion.status, 'required');
  assert.strictEqual(decision.reflexion.trigger, 'structure_only_fallback');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decision.reflexion, 'executionAllowed'), false);
  assert.ok(
    decision.reflexion.phases.some((phase) => /不能落地|不允许写入|只允许结构/.test(phase.summary)),
    'Reflexion must state the fallback cannot execute Photoshop writes'
  );
});

check('detail-page manifest keeps skills and tools separated', () => {
  const manifest = getManifestByTaskType('ecommerce.detail_page.v1');
  assert.ok(manifest, 'detail-page manifest should exist');
  const result = validateManifestToolSkillBoundary(manifest);
  assert.strictEqual(result.valid, true, JSON.stringify(result.violations, null, 2));
});

check('runtime loop contract keeps R0 skill choice, ReAct loop, R5 gate, and Reflexion re-entry explicit', () => {
  const manifest = getManifestByTaskType('ecommerce.detail_page.v1');
  const contract = buildReActReflexionLoopContract(manifest);

  assert.strictEqual(contract.version, 'react-reflexion-loop/v0');
  assert.strictEqual(contract.r0.skillId, manifest.skill_id);
  assert.deepStrictEqual(
    contract.reactLoop.phases.map((phase) => phase.phase),
    ['reason', 'act', 'observe', 'evaluate']
  );
  assert.strictEqual(contract.qualityGate.owner, 'R5');
  assert.strictEqual(contract.reflexion.onQualityGateFailure.reenterLoop, 'react');
  assert.ok(
    contract.reactLoop.toolBoundary.availableTools.every((toolName) => toolName.includes('.')),
    'ReAct loop should use namespaced tools, not skill IDs'
  );
});

check('failed R5 review becomes Reflexion handoff constraints for the next ReAct round', () => {
  const handoff = buildReflexionHandoffFromReviewReport({
    meta: {
      artifactId: 'review-1',
      artifactType: 'review_report',
      schemaVersion: 'review-report/v0',
      workflowRunId: 'wf-1',
      projectId: 'project-reflexion',
      createdAt: '2026-06-25T00:00:00.000Z',
      owner: 'R5'
    },
    payload: {
      subjectRef: { artifactId: 'preview-1', artifactType: 'preview_scene' },
      planRef: { artifactId: 'plan-1', artifactType: 'detail_page_plan' },
      strategyRef: { artifactId: 'strategy-1', artifactType: 'creative_strategy' },
      rubricVersion: 'rubric-test',
      dimensions: [],
      issues: [
        {
          issueId: 'issue-layout-1',
          severity: 'blocker',
          owner: 'R4',
          targetArtifactId: 'plan-1',
          targetPath: '/screens/0',
          description: '首屏主次层级不清晰。',
          expectedFix: '重新调整首屏信息层级。',
          checkRefs: ['snapshot-1']
        }
      ],
      overallScore: 42,
      gateStatus: 'failed',
      requiredFixes: ['重新调整首屏信息层级'],
      suggestedFixes: [],
      rollbackTarget: { runtimeUnit: 'R4', reason: '布局规划需要返工' },
      qualityPassed: false
    }
  });

  assert.strictEqual(handoff.status, 'reflexion_required');
  assert.strictEqual(handoff.reenterLoop, 'react');
  assert.strictEqual(handoff.targetStage, 'R4');
  assert.ok(handoff.failureAnalysis.some((item) => item.includes('首屏主次层级不清晰')));
  assert.ok(handoff.nextRoundConstraints.some((item) => item.includes('重新调整首屏信息层级')));
});

console.log(`\n✅ v5-reflexion-boundary smoke 全部通过（${passed} 项）`);
