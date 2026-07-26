const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const repoRoot = path.resolve(__dirname, '..');
const {
  inferDetailScreenPlans
} = require(path.join(repoRoot, 'src', 'shared', 'detail-page-screen-plan.ts'));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoMojibake(text, label) {
  const suspiciousTokens = [
    0x93b4,
    0x93c9,
    0x951b,
    0x95c8,
    0xfffd
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

const heuristicPlans = inferDetailScreenPlans([{
  id: 1,
  name: '首屏主视觉',
  type: 'C_HERO',
  order: 0,
  copyPlaceholders: [{}],
  imagePlaceholders: [{}]
}], {
  screenAssessments: [{
    screenId: 1,
    mode: 'healthy',
    metrics: {
      imageAreaRatio: 0.42,
      copyAreaRatio: 0.16
    }
  }]
});

assert(heuristicPlans.length === 1, 'heuristic case should produce one plan', heuristicPlans);
assert(heuristicPlans[0].screenRole === 'hero', 'structure may still expose a screen-role candidate', heuristicPlans[0]);
assert(heuristicPlans[0].decisionSource === 'heuristic', 'screen role without agent decision must be marked as heuristic', heuristicPlans[0]);
assert(heuristicPlans[0].requiresModelDecision === true, 'heuristic screen plan must require model decision', heuristicPlans[0]);
assert(heuristicPlans[0].mainMessage.includes('待模型 Agent'), 'heuristic plan must not bake a final main message', heuristicPlans[0]);
assert(!heuristicPlans[0].supportingPoints.includes('主标题要短'), 'heuristic plan must not bake role-specific supporting copy', heuristicPlans[0]);
assert(
  heuristicPlans[0].risks.some((item) => item.includes('模型 Agent')),
  'heuristic plan should surface missing model decision as a risk',
  heuristicPlans[0]
);

const agentPlans = inferDetailScreenPlans([{
  id: 2,
  name: '功能细节',
  type: 'J_DETAIL',
  order: 1,
  copyPlaceholders: [{}],
  imagePlaceholders: [{}]
}], undefined, {
  agentDecisions: [{
    screenId: 2,
    screenRole: 'feature_detail',
    mainMessage: '用袜口细节呈现舒适不勒脚。',
    supportingPoints: ['镜头聚焦袜口纹理', '文案解释穿着痛点'],
    copyStrategy: 'supporting_copy',
    imageStrategy: 'detail',
    visualPriority: 'balanced',
    rationale: ['产品素材里有近景纹理图']
  }]
});

assert(agentPlans[0].decisionSource === 'agent', 'agent decision should be marked as agent source', agentPlans[0]);
assert(agentPlans[0].requiresModelDecision === false, 'agent decision should satisfy model decision requirement', agentPlans[0]);
assert(agentPlans[0].mainMessage === '用袜口细节呈现舒适不勒脚。', 'agent main message should pass through', agentPlans[0]);
assert(agentPlans[0].supportingPoints[0] === '镜头聚焦袜口纹理', 'agent supporting point should pass through', agentPlans[0]);
assert(agentPlans[0].copyStrategy === 'supporting_copy', 'agent copy strategy should pass through', agentPlans[0]);
assert(agentPlans[0].imageStrategy === 'detail', 'agent image strategy should pass through', agentPlans[0]);

const mcpHost = read('src/main/services/mcp-host-service.ts');
const ranker = read('src/renderer/services/skill-executors/detail-page-asset-ranker.ts');
const detailSkill = read('src/renderer/services/design-skills/detail-page-design.skill.ts');
const detailExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
const screenPlan = read('src/shared/detail-page-screen-plan.ts');
const documentRole = read('src/shared/design-document-role.ts');

assert(!mcpHost.includes('lowConfidenceScreens'), 'MCP detail validation should not expose lowConfidenceScreens');
assert(!mcpHost.includes('lowConfidenceScreenCount'), 'MCP detail validation should not expose lowConfidenceScreenCount');
assert(mcpHost.includes('missingModelDecisionScreens'), 'MCP detail validation should expose missing model-decision gaps');
assert(ranker.includes('Decision boundary: template and filename rules are candidate signals only'), 'detail copy prompt should state model decision boundary');
assert(ranker.includes('screenPlan.requiresModelDecision'), 'detail asset ranking should branch on model decision requirement');
assert(detailSkill.includes('待模型决策'), 'detail user-facing screen plan line should surface pending model decision');
assert(documentRole.includes('inferDesignDocumentRoleFromName'), 'shared document role classifier should exist');
assert(detailExecutor.includes('isKnownNonDetailPageRole(currentDocumentRole)'), 'detail executor should check current document role before parsing');
assert(detailExecutor.includes("callTool('listDocuments'"), 'detail executor should look for an opened detail-page document with the supported listDocuments tool before failing');
assert(!detailExecutor.includes("callTool('listOpenDocuments'"), 'detail executor must not call the unsupported listOpenDocuments tool');
assert(detailExecutor.includes("callTool('switchDocument'"), 'detail executor should switch to an opened detail-page document when available');
assert(detailExecutor.includes('detail_page_document_role_mismatch'), 'detail executor should stop detail work on SKU/main-image documents when no detail document is open');
assert(
  detailExecutor.indexOf('isKnownNonDetailPageRole(currentDocumentRole)') < detailExecutor.indexOf("callTool('parseDetailPageTemplate'"),
  'document role decision must run before parseDetailPageTemplate'
);

[
  ['mcp-host-service.ts', mcpHost],
  ['detail-page-asset-ranker.ts', ranker],
  ['detail-page-design.skill.ts', detailSkill],
  ['detail-page.executor.ts', detailExecutor],
  ['design-document-role.ts', documentRole],
  ['detail-page-screen-plan.ts', screenPlan]
].forEach(([label, text]) => assertNoMojibake(text, label));

console.log(JSON.stringify({
  success: true,
  checks: [
    'heuristic detail screen plans are marked as pending model Agent decision',
    'agent decisions can provide screen role, main message, copy strategy and image strategy',
    'detail-page executor refuses SKU/main-image documents before parsing',
    'detail-page executor can switch to an already-opened detail-page document',
    'detail asset ranking treats heuristic rules as candidate signals',
    'MCP validation reports missing model-decision gaps instead of low confidence'
  ]
}, null, 2));
