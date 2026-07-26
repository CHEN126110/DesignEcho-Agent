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
  normalizeExternalDesignKnowledgeResults,
  searchLocalDesignKnowledge
} = require('../src/shared/design-knowledge-search.ts');

const {
  DesignKnowledgeSearchService
} = require('../src/main/services/design-knowledge-search-service.ts');

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x6748,
    0x8930,
    0x7487,
    0x951B,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  suspiciousTokens.push('?{');
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens ${found.join(', ')}: ${text}`);
}

function assertNoConfidence(value, label) {
  const text = JSON.stringify(value);
  assert(!text.includes('"confidence"'), `${label} must not expose confidence fields: ${text}`);
}

async function run() {
  const local = searchLocalDesignKnowledge({
    query: '投影 shadow',
    intents: ['recipe'],
    limit: 5
  });

  const shadow = local.results.find((item) => item.id === 'local-recipe:shadow');
  assertNoMojibake(local, 'local recipe response');
  assert(shadow, `expected shadow recipe result: ${JSON.stringify(local)}`);
  assert(shadow.sourceType === 'local_recipe', `expected local_recipe source: ${JSON.stringify(shadow)}`);
  assert(shadow.allowedUses.includes('recipe_hint'), `expected recipe_hint allowed use: ${JSON.stringify(shadow)}`);
  assert(!shadow.allowedUses.includes('direct_photoshop_action'), `knowledge result must not be a direct Photoshop action: ${JSON.stringify(shadow)}`);
  assert(shadow.sourceNotes.some((line) => line.includes('边界')), `expected boundary source note: ${JSON.stringify(shadow)}`);
  assert(shadow.sourceLevel === 'curated_recipe', `local recipe should explain its source level: ${JSON.stringify(shadow)}`);
  assertNoConfidence(shadow, 'local recipe result');

  const service = await DesignKnowledgeSearchService.search({
    query: '描边 stroke',
    intents: ['recipe'],
    sourceTypes: ['local_recipe'],
    limit: 3
  });

  assert(service.results.some((item) => item.id === 'local-recipe:stroke'), `service should return stroke recipe: ${JSON.stringify(service)}`);
  assertNoMojibake(service, 'service response');
  assertNoConfidence(service, 'service response');
  assert(service.providerSummary.localRecipe >= 1, `provider summary should count local recipes: ${JSON.stringify(service)}`);

  const governedService = await DesignKnowledgeSearchService.search(
    {
      query: '海报趋势',
      sourceTypes: ['mimo_web_search'],
      limit: 5
    },
    {
      xiaomiWebSearch: async () => ({
        available: true,
        content: '综合设计结论',
        citations: [{ title: '来源 A', url: 'https://example.com/a' }]
      })
    }
  );
  assert(
    governedService.results.length === 1
      && governedService.results[0].id.startsWith('mimo-web-search:summary:'),
    `service should expose only planning-usable knowledge: ${JSON.stringify(governedService)}`
  );
  assert(
    governedService.knowledgeUsageSnapshot.counts.total === 2
      && governedService.knowledgeUsageSnapshot.counts.usable === 1
      && governedService.knowledgeUsageSnapshot.counts.blocked === 1,
    `usage snapshot should retain blocked-result accounting: ${JSON.stringify(governedService.knowledgeUsageSnapshot)}`
  );

  const crossCategoryMarketInsight = searchLocalDesignKnowledge({
    query: '护肤品 痛点',
    intents: ['market_insight'],
    sourceTypes: ['manual_rule'],
    limit: 30
  });
  assert(
    crossCategoryMarketInsight.results.every((item) => !item.tags.includes('socks')),
    `non-socks queries must not receive socks market knowledge: ${JSON.stringify(crossCategoryMarketInsight)}`
  );
  assert(
    crossCategoryMarketInsight.warnings.some((warning) => warning.includes('仅覆盖袜子类目')),
    `cross-category fail-closed should be explicit: ${JSON.stringify(crossCategoryMarketInsight.warnings)}`
  );

  const socksMarketInsight = searchLocalDesignKnowledge({
    query: '袜子 起毛球 痛点',
    intents: ['market_insight'],
    sourceTypes: ['manual_rule'],
    limit: 10
  });
  assert(
    socksMarketInsight.results.some((item) => item.tags.includes('socks')),
    `explicit socks query should still reach the socks corpus: ${JSON.stringify(socksMarketInsight)}`
  );

  const ipcHandlerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ipc-handlers', 'design-knowledge-handlers.ts'),
    'utf8'
  );
  assert(
    ipcHandlerSource.includes('normalized.xiaomiWebSearch.enabled && modelService'),
    'IPC knowledge search must not inject Xiaomi provider while the setting is disabled'
  );
  assert(
    ipcHandlerSource.includes('maxKeyword: normalized.xiaomiWebSearch.maxKeyword')
      && ipcHandlerSource.includes('limit: normalized.xiaomiWebSearch.limit')
      && ipcHandlerSource.includes('forceSearch: normalized.xiaomiWebSearch.forceSearch')
      && ipcHandlerSource.includes('userLocation: normalized.xiaomiWebSearch.userLocation'),
    'IPC knowledge search should forward bounded Xiaomi settings'
  );
  assert(
    /success:\s*true,[\s\S]{0,80}\.\.\.result/.test(ipcHandlerSource),
    'IPC knowledge search should return the canonical service response without dropping governance fields'
  );

  const mcpHostSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'services', 'mcp-host-service.ts'),
    'utf8'
  );
  assert(
    mcpHostSource.includes('settings.xiaomiWebSearch.enabled && modelService'),
    'MCP knowledge search must obey the same Xiaomi enablement setting as the desktop IPC path'
  );
  assert(
    mcpHostSource.includes('maxKeyword: settings.xiaomiWebSearch.maxKeyword')
      && mcpHostSource.includes('limit: settings.xiaomiWebSearch.limit')
      && mcpHostSource.includes('forceSearch: settings.xiaomiWebSearch.forceSearch')
      && mcpHostSource.includes('userLocation: settings.xiaomiWebSearch.userLocation'),
    'MCP knowledge search should forward the same bounded Xiaomi settings'
  );
  assert(
    /resultCount:\s*result\.results\.length,[\s\S]{0,80}\.\.\.result/.test(mcpHostSource),
    'MCP knowledge search should preserve the canonical governance response'
  );

  const executorSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'),
    'utf8'
  );
  assert(
    executorSource.includes("'designKnowledge:search',")
      && executorSource.includes('useAppStore.getState().designKnowledgeSettings'),
    'renderer search tool should pass the current knowledge settings across IPC'
  );

  const rendererTypesSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'types.d.ts'),
    'utf8'
  );
  for (const field of ['providerSummary?', 'knowledgeUsageSnapshot?', 'designAgentOs?']) {
    assert(rendererTypesSource.includes(field), `renderer search type should expose ${field}`);
  }

  const domainRule = searchLocalDesignKnowledge({
    query: '详情页',
    intents: ['rule'],
    sourceTypes: ['manual_rule'],
    limit: 5
  });
  const detailPage = domainRule.results.find((item) => item.id === 'manual-rule:detail-page');
  assertNoMojibake(domainRule, 'manual rule response');
  assert(detailPage, `expected detail-page manual rule result: ${JSON.stringify(domainRule)}`);
  assert(detailPage.sourceType === 'manual_rule', `expected manual_rule source: ${JSON.stringify(detailPage)}`);
  assert(detailPage.allowedUses.includes('prompt_context'), `expected prompt_context allowed use: ${JSON.stringify(detailPage)}`);
  assert(!detailPage.allowedUses.includes('direct_photoshop_action'), `manual rule must not be a direct Photoshop action: ${JSON.stringify(detailPage)}`);
  assert(detailPage.sourceLevel === 'curated_rule', `manual rule should explain its source level: ${JSON.stringify(detailPage)}`);
  assert(domainRule.providerSummary.manualRule >= 1, `provider summary should count manual rules: ${JSON.stringify(domainRule)}`);

  const noMatch = searchLocalDesignKnowledge({
    query: '不存在的外部网页搜索结果',
    intents: ['trend'],
    limit: 3
  });

  assert(noMatch.results.length === 0, `trend search should not fake local recipe results: ${JSON.stringify(noMatch)}`);
  assertNoMojibake(noMatch, 'no-match response');
  assert(noMatch.warnings.length > 0, `no-match response should explain current MVP boundary: ${JSON.stringify(noMatch)}`);

  const copywriting = searchLocalDesignKnowledge({
    query: '图片配文 文案 广告感',
    intents: ['copywriting'],
    sourceTypes: ['manual_rule'],
    limit: 3
  });
  const copywritingFramework = copywriting.results.find((item) => item.id === 'manual-rule:copywriting-framework');
  assert(copywritingFramework, `expected copywriting framework result: ${JSON.stringify(copywriting)}`);
  assert(copywritingFramework.summary.includes('图片真实信息'), `copywriting framework should include visual-grounded formula: ${JSON.stringify(copywritingFramework)}`);
  assert(!copywritingFramework.allowedUses.includes('direct_photoshop_action'), `copywriting framework must not be a direct Photoshop action: ${JSON.stringify(copywritingFramework)}`);
  assert(copywritingFramework.sourceLevel === 'curated_rule', `copywriting framework should explain its source level: ${JSON.stringify(copywritingFramework)}`);
  assertNoMojibake(copywriting, 'copywriting framework response');
  assertNoConfidence(copywriting, 'copywriting framework response');

  const external = normalizeExternalDesignKnowledgeResults(
    {
      query: '电商海报参考',
      intents: ['reference'],
      sourceTypes: ['web_page'],
      limit: 2
    },
    [
      {
        title: '参考页面 A',
        intent: 'reference',
        sourceType: 'web_page',
        summary: '用于提取版式方向的外部参考摘要。',
        sourceNotes: ['来自页面正文摘要，不是 Photoshop 操作。'],
        allowedUses: ['prompt_context', 'direct_photoshop_action'],
        sourceLevel: 'external_snippet',
        sourceRank: 4,
        sourceUrl: 'https://example.com/reference'
      }
    ]
  );

  assert(external.length === 1, `expected normalized external result: ${JSON.stringify(external)}`);
  assert(external[0].sourceType === 'web_page', `expected web_page source: ${JSON.stringify(external[0])}`);
  assert(external[0].sourceLevel === 'external_snippet', `external result should carry source level: ${JSON.stringify(external[0])}`);
  assert(external[0].sourceRank === 4, `external result should preserve source rank instead of confidence: ${JSON.stringify(external[0])}`);
  assert(external[0].allowedUses.includes('prompt_context'), `external result should keep prompt_context: ${JSON.stringify(external[0])}`);
  assert(!external[0].allowedUses.includes('direct_photoshop_action'), `external result must drop direct action use: ${JSON.stringify(external[0])}`);
  assertNoMojibake(external, 'external normalized response');
  assertNoConfidence(external, 'external normalized response');

  return {
    success: true,
    localResultCount: local.results.length,
    serviceResultCount: service.results.length,
    domainRuleResultCount: domainRule.results.length,
    copywritingResultCount: copywriting.results.length,
    governedServiceResultCount: governedService.results.length,
    socksMarketInsightResultCount: socksMarketInsight.results.length,
    noMatchWarnings: noMatch.warnings,
    externalResultCount: external.length
  };
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
