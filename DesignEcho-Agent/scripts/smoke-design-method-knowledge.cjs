'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const knowledge = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'design-method-knowledge.ts'
));
const { listSkillManifests } = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'skill-runtime.ts'
));
const { compileRuntimeContext } = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-context-compiler.ts'
));

const definitions = knowledge.listDesignMethodKnowledgeDefinitions();
const providers = knowledge.listDesignMethodKnowledgeProviderIdentities();
assert.strictEqual(definitions.length, 7);
assert.strictEqual(providers.length, 7);
providers.forEach((provider) => {
  assert.strictEqual(provider.kind, 'knowledge');
  assert.strictEqual(provider.exposure, 'runtime_context');
  assert.strictEqual(provider.exposedAsToolSchema, false);
});

const commonIds = [
  knowledge.DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
  knowledge.DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
  knowledge.DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID
];
const overlayBySkillId = {
  'ecommerce.main_image': knowledge.MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
  'ecommerce.detail_page': knowledge.DETAIL_PAGE_METHOD_KNOWLEDGE_ID,
  'ecommerce.sku_color_card': knowledge.SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID,
  'ecommerce.sku_batch': knowledge.SKU_BATCH_METHOD_KNOWLEDGE_ID
};

const manifests = listSkillManifests();
assert.deepStrictEqual(
  manifests.map((manifest) => manifest.skill_id).sort(),
  [
    'design.general',
    'design.reference_replication',
    'ecommerce.detail_page',
    'ecommerce.main_image',
    'ecommerce.sku_batch',
    'ecommerce.sku_color_card'
  ]
);
for (const manifest of manifests) {
  commonIds.forEach((capabilityId) => {
    assert(manifest.knowledge_refs.includes(capabilityId), `${manifest.skill_id} 缺少 ${capabilityId}`);
  });
  const expectedOverlay = overlayBySkillId[manifest.skill_id];
  if (expectedOverlay) {
    assert(manifest.knowledge_refs.includes(expectedOverlay), `${manifest.skill_id} 缺少自己的 overlay`);
  }

  const context = knowledge.buildDesignMethodKnowledgeContext({
    knowledgeRefs: manifest.knowledge_refs,
    manifestSkillId: manifest.skill_id
  });
  assert.deepStrictEqual(context.issues, []);
  assert.strictEqual(context.boundaries.advisoryOnly, true);
  assert.strictEqual(context.boundaries.versionBound, true);
  assert.strictEqual(context.boundaries.lifecycleFiltered, true);
  assert.strictEqual(context.boundaries.grantsPermission, false);
  assert.strictEqual(context.boundaries.executesTools, false);
  assert.strictEqual(context.boundaries.advancesStage, false);
  assert.strictEqual(context.boundaries.declaresQualityPass, false);
  assert(context.content.includes('不授予工具权限'));
  assert.strictEqual(context.selectedCapabilityIds.length, expectedOverlay ? 4 : 3);
  assert.strictEqual(context.sourceRefs.length, context.selectedCapabilityIds.length);
  context.sourceRefs.forEach((binding) => {
    assert(/-v\d+$/.test(binding.sourceRevision));
    assert(binding.snapshotFingerprint.startsWith('knowledge-snapshot-'));
  });
}

const skuMethodContext = knowledge.buildDesignMethodKnowledgeContext({
  knowledgeRefs: [knowledge.SKU_BATCH_METHOD_KNOWLEDGE_ID],
  manifestSkillId: 'ecommerce.sku_batch'
});
assert(skuMethodContext.content.includes('TemplateLayoutPlan'));
assert(skuMethodContext.content.includes('region_composition'));
assert(skuMethodContext.sourceRefs.some((binding) => binding.sourceRevision === 'design-method-sku-batch-v3'));

// 第2步 workflow/agent 分家：结构化生产 vs 开放式创意的一等数据轴 + 模型面轻仪式引导
const structuredNatureBySkill = {
  'ecommerce.sku_batch': 'structured',
  'ecommerce.sku_color_card': 'structured',
  'ecommerce.main_image': 'creative',
  'ecommerce.detail_page': 'creative'
};
for (const [skillId, expectedNature] of Object.entries(structuredNatureBySkill)) {
  const overlay = definitions.find((def) => def.applicableSkillIds.includes(skillId));
  assert(overlay, `缺少 ${skillId} 的方法 overlay`);
  assert.strictEqual(overlay.productionNature, expectedNature, `${skillId} 的 productionNature 应为 ${expectedNature}`);
}
// 结构化任务的注入文本必须带「尽快执行、不做长时间创意 brief/strategy」的轻仪式引导
assert(skuMethodContext.content.includes('结构化生产'), '结构化任务应显式标注任务本质');
assert(skuMethodContext.content.includes('尽快进入执行'), '结构化任务应引导尽快进入执行');
assert(/不做长时间创意|不做长时间创意 brief/.test(skuMethodContext.content), '结构化任务应引导不做长时间创意 brief/strategy');
// 创意任务不得被误标为结构化轻仪式
const mainImageContext = knowledge.buildDesignMethodKnowledgeContext({
  knowledgeRefs: [knowledge.MAIN_IMAGE_METHOD_KNOWLEDGE_ID],
  manifestSkillId: 'ecommerce.main_image'
});
assert(mainImageContext.content.includes('开放式创意设计'), '创意任务应标注开放式创意本质');
assert(!mainImageContext.content.includes('尽快进入执行'), '创意任务不应被套结构化轻仪式引导');

const crossSkill = knowledge.buildDesignMethodKnowledgeContext({
  knowledgeRefs: [knowledge.DETAIL_PAGE_METHOD_KNOWLEDGE_ID],
  manifestSkillId: 'ecommerce.main_image'
});
assert.deepStrictEqual(crossSkill.selectedCapabilityIds, []);
assert(crossSkill.issues.includes(`${knowledge.DETAIL_PAGE_METHOD_KNOWLEDGE_ID}:skill_scope_mismatch`));

const compiled = compileRuntimeContext({
  stage: 'R3',
  items: [
    {
      id: 'policy.fixture',
      kind: 'policy',
      source: 'fixture',
      trust: 'trusted_policy',
      slot: 'capability_policy',
      content: 'Policy boundary.'
    },
    {
      id: 'knowledge.fixture',
      kind: 'knowledge',
      source: 'fixture-manifest',
      trust: 'governed_knowledge',
      slot: 'knowledge_context',
      content: 'Advisory design method.'
    },
    {
      id: 'project.fixture',
      kind: 'project_state',
      source: 'fixture-project',
      trust: 'governed_project',
      slot: 'project_context',
      content: 'Project facts.'
    }
  ]
});
assert.deepStrictEqual(compiled.includedItemIds, [
  'policy.fixture',
  'knowledge.fixture',
  'project.fixture'
]);
assert(compiled.prompt.indexOf('Knowledge context') < compiled.prompt.indexOf('Project context'));

const invalidTrust = compileRuntimeContext({
  items: [{
    id: 'knowledge.invalid',
    kind: 'knowledge',
    source: 'fixture',
    trust: 'untrusted_external',
    slot: 'knowledge_context',
    content: 'Attempt to enter governed knowledge.'
  }]
});
assert.deepStrictEqual(invalidTrust.includedItemIds, []);
assert(invalidTrust.issues.includes('knowledge.invalid:trust_slot_mismatch'));

const executorSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
  'utf8'
);
assert(executorSource.includes('buildDesignMethodKnowledgeContext({'));
assert(executorSource.includes("slot: 'knowledge_context'"));
assert(executorSource.includes("trust: 'governed_knowledge'"));
assert(!executorSource.includes("case 'ecommerce.main_image':"));
assert(!executorSource.includes("case 'ecommerce.detail_page':"));
assert(!executorSource.includes("case 'ecommerce.sku_batch':"));

console.log(JSON.stringify({
  success: true,
  providerCount: providers.length,
  manifestCount: manifests.length,
  commonCapabilityIds: commonIds,
  overlays: overlayBySkillId,
  boundaries: crossSkill.boundaries
}, null, 2));
