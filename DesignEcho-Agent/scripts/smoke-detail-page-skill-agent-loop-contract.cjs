'use strict';

/**
 * smoke: detail-page skill should be an Agent instruction contract, not a fixed script
 *
 * The user-facing detail-page capability has two normal paths:
 * - template-first: inspect project/current document, understand the template, then replace content.
 * - fresh design: if no usable template is found, continue through the observed design loop from scratch.
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const { getSkillById } = require(path.join(root, 'src', 'shared', 'skills', 'skill-declarations.ts'));
const { getManifestByTaskType } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'skill-runtime.ts'));
const {
  buildLegacyToolCapabilityBridge
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'tool-capability-bridge.ts'));
const {
  buildReActReflexionLoopContract,
  validateManifestToolSkillBoundary
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'reflexion-contract.ts'));

function includesAny(values, pattern) {
  return values.some((value) => pattern.test(String(value || '')));
}

function joined(values) {
  return values.map((value) => String(value || '')).join('\n');
}

function check(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('smoke: detail-page-skill-agent-loop-contract');

check('detail-page skill describes project-level Agent work, not template-only execution', () => {
  const skill = getSkillById('detail-page-design');
  assert.ok(skill, 'detail-page-design skill should exist');

  const text = [
    skill.description,
    joined(skill.whenToUse),
    joined(skill.whenNotToUse || []),
    joined(skill.routing?.decisionGuidance || []),
    joined(skill.routing?.preconditions || [])
  ].join('\n');

  assert.ok(/项目级|项目/.test(text), text);
  assert.ok(/说明|instruction/.test(text), text);
  assert.ok(/循环|继续推进|继续处理/.test(text), text);
  assert.ok(/读回结果|观察项目证据|截图复核|结果复核/.test(text), text);
  assert.ok(/模板优先|优先.*模板|先.*模板/.test(text), text);
  assert.ok(/没有模板|无模板|找不到.*模板/.test(text), text);
  assert.ok(/从零设计|纯设计|fresh design/.test(text), text);
  assert.ok(/套版/.test(text), text);
  assert.ok(/原文字数|字符数|不改变字体|不改字体/.test(text), text);
  assert.ok(/剪切蒙版|缩放|裁切/.test(text), text);
});

check('generic detail-page requests are allowed to enter the skill contract', () => {
  const skill = getSkillById('detail-page-design');
  const whenToUse = joined(skill.whenToUse);
  const whenNotToUse = joined(skill.whenNotToUse || []);
  const guidance = joined(skill.routing?.decisionGuidance || []);

  assert.ok(/只说.*详情页|做详情页/.test(whenToUse + '\n' + guidance));
  assert.ok(/先.*项目|摸索项目|读取项目/.test(whenToUse + '\n' + guidance));
  assert.ok(!/from scratch/.test(whenNotToUse), whenNotToUse);
  assert.ok(!/从零.*不要调用本 skill/.test(whenNotToUse + '\n' + guidance), whenNotToUse + '\n' + guidance);
});

check('runtime manifest exposes both template and fresh-design capabilities', () => {
  const manifest = getManifestByTaskType('ecommerce.detail_page.v1');
  assert.ok(manifest, 'detail-page manifest should exist');

  const boundary = validateManifestToolSkillBoundary(manifest);
  assert.strictEqual(boundary.valid, true, JSON.stringify(boundary.violations, null, 2));

  for (const capability of [
    'project.listResources',
    'project.searchResources',
    'photoshop.read.inspectDetailPageTemplate',
    'photoshop.apply.fillDetailPageTemplate',
    'photoshop.sandbox.createScreenGroup',
    'photoshop.sandbox.placeImage',
    'photoshop.sandbox.writeText',
    'preview.renderStoryboard',
    'delivery.exportSlices'
  ]) {
    assert.ok(manifest.available_tools.includes(capability), `missing capability: ${capability}`);
  }

  assert.ok(includesAny(manifest.exit_criteria, /R5|review|Quality Gate|复核/), manifest.exit_criteria.join('\n'));
});

check('template capabilities map to legacy executable tools explicitly', () => {
  const manifest = getManifestByTaskType('ecommerce.detail_page.v1');
  const bridge = buildLegacyToolCapabilityBridge({
    manifest,
    executableToolNames: [
      'listProjectResources',
      'searchProjectResources',
      'searchEagleReferences',
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
      'renderLayout',
      'createDocument',
      'placeImage',
      'transformLayer',
      'createTextLayer',
      'setTextContent',
      'setTextStyle',
      'saveDocument',
      'exportDetailPageSlices'
    ]
  });

  assert.deepStrictEqual(bridge.unmappedCapabilities, [], JSON.stringify(bridge, null, 2));
  assert.ok(bridge.entries.some((entry) =>
    entry.capability === 'photoshop.read.inspectDetailPageTemplate'
    && entry.executableTools.includes('parseDetailPageTemplate')
  ));
  assert.ok(bridge.entries.some((entry) =>
    entry.capability === 'photoshop.apply.fillDetailPageTemplate'
    && entry.executableTools.includes('fillDetailPage')
  ));
});

check('runtime contract keeps R5 failure as Reflexion re-entry', () => {
  const manifest = getManifestByTaskType('ecommerce.detail_page.v1');
  const contract = buildReActReflexionLoopContract(manifest);

  assert.deepStrictEqual(
    contract.reactLoop.phases.map((phase) => phase.phase),
    ['reason', 'act', 'observe', 'evaluate']
  );
  assert.strictEqual(contract.qualityGate.owner, 'R5');
  assert.strictEqual(contract.qualityGate.failTarget, 'reflexion');
  assert.strictEqual(contract.reflexion.onQualityGateFailure.reenterLoop, 'react');
});

console.log('\n✅ detail-page-skill-agent-loop-contract smoke 全部通过');
