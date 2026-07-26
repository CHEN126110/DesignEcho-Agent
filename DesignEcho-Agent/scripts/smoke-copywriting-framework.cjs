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

const {
  buildCopywritingContextChecklist,
  COPYWRITING_SCORE_CRITERIA,
  COPYWRITING_SAFETY_RULES,
  COPYWRITING_TEMPLATES,
  formatCopywritingFrameworkForPrompt
} = require('../src/shared/design-copywriting-framework.ts');

const {
  searchLocalDesignKnowledge
} = require('../src/shared/design-knowledge-search.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoMojibake(text, label) {
  const suspiciousTokens = [0x93B4, 0x93C9, 0x6748, 0x8930, 0x7487, 0x951B, 0xFFFD]
    .map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => String(text).includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

const missing = buildCopywritingContextChecklist({
  hasImage: false,
  hasTargetAudience: false,
  hasAudienceInterest: false,
  hasVisualAnchors: false,
  hasProductFacts: false,
  hasUserScene: false,
  hasProductProblem: false
});

assert(missing.ready === false, `missing context should not be ready: ${JSON.stringify(missing)}`);
assert(missing.missing.some((item) => item.includes('目标人群')), `target audience gap expected: ${JSON.stringify(missing)}`);
assert(missing.missing.some((item) => item.includes('人群兴趣')), `audience interest gap expected: ${JSON.stringify(missing)}`);
assert(missing.missing.some((item) => item.includes('视觉锚点')), `visual anchor gap expected: ${JSON.stringify(missing)}`);
assert(missing.missing.some((item) => item.includes('产品事实')), `product fact gap expected: ${JSON.stringify(missing)}`);
assert(missing.rules.some((item) => item.includes('不能编造')), `anti-hallucination rule expected: ${JSON.stringify(missing)}`);

const ready = buildCopywritingContextChecklist({
  hasImage: true,
  hasTargetAudience: true,
  hasAudienceInterest: true,
  hasVisualAnchors: true,
  hasProductFacts: true,
  hasUserScene: true,
  hasProductProblem: true
});

assert(ready.ready === true, `complete context should be ready: ${JSON.stringify(ready)}`);
assert(COPYWRITING_TEMPLATES.length === 5, 'expected five reusable copywriting templates');
assert(COPYWRITING_SCORE_CRITERIA.reduce((sum, item) => sum + item.points, 0) === 100, 'copywriting score should total 100');
assert(COPYWRITING_SAFETY_RULES.some((item) => item.id === 'body-food'), 'body-food safety rule expected');

const prompt = formatCopywritingFrameworkForPrompt();
for (const token of ['人群设定', '兴趣方向', 'P-I-S-B-F-C', '视觉承接型', '场景共鸣型', '负面', '低于 70 分应重写']) {
  assert(prompt.includes(token), `framework prompt missing ${token}`);
}
assertNoMojibake(prompt, 'framework prompt');

const knowledge = searchLocalDesignKnowledge({
  query: '帮我根据图片写低广告感文案',
  intents: ['copywriting'],
  sourceTypes: ['manual_rule'],
  limit: 3
});

const framework = knowledge.results.find((item) => item.id === 'manual-rule:copywriting-framework');
assert(framework, `copywriting framework knowledge result expected: ${JSON.stringify(knowledge)}`);
assert(framework.summary.includes('图片真实信息'), `copywriting knowledge should include core formula: ${JSON.stringify(framework)}`);
assert(framework.allowedUses.includes('prompt_context'), `copywriting knowledge should be prompt context: ${JSON.stringify(framework)}`);
assert(!framework.allowedUses.includes('direct_photoshop_action'), `copywriting knowledge must not be direct action: ${JSON.stringify(framework)}`);
assertNoMojibake(JSON.stringify(knowledge), 'copywriting knowledge');

console.log(JSON.stringify({
  success: true,
  templates: COPYWRITING_TEMPLATES.map((item) => item.id),
  missingContextCount: missing.missing.length,
  scoreTotal: COPYWRITING_SCORE_CRITERIA.reduce((sum, item) => sum + item.points, 0),
  knowledgeResultCount: knowledge.results.length
}, null, 2));
