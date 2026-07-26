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
  buildSearxngSearchUrl,
  buildSearxngConnectorStatus,
  normalizeSearxngResults,
  isSearxngKnowledgeBoundaryOk
} = require('../src/shared/searxng-design-knowledge.ts');

const {
  DesignKnowledgeSearchService
} = require('../src/main/services/design-knowledge-search-service.ts');

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
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
  assert(found.length === 0, `${label} contains mojibake tokens ${found.join(', ')}`, value);
}

async function run() {
  const disabled = buildSearxngConnectorStatus({ enabled: false });
  assert(disabled.status === 'disabled', 'disabled connector should not search', disabled);
  assert(isSearxngKnowledgeBoundaryOk(disabled), 'disabled boundary should be safe', disabled);

  const missingEndpoint = buildSearxngConnectorStatus({ enabled: true });
  assert(missingEndpoint.status === 'missing_endpoint', 'enabled connector requires endpoint', missingEndpoint);
  assert(missingEndpoint.boundaries.doesNotManageDocker === true, 'connector must not manage Docker', missingEndpoint);

  const url = buildSearxngSearchUrl(
    { enabled: true, endpoint: 'http://127.0.0.1:8080/' },
    { query: '电商详情页 网格排版', limit: 20 }
  );
  assert(url === 'http://127.0.0.1:8080/search?q=%E7%94%B5%E5%95%86%E8%AF%A6%E6%83%85%E9%A1%B5+%E7%BD%91%E6%A0%BC%E6%8E%92%E7%89%88&format=json&language=zh-CN&safesearch=1&pageno=1',
    'search URL should be deterministic and clamped', { url });

  const normalized = normalizeSearxngResults(
    { query: '袜子详情页 版式参考', intents: ['reference'], sourceTypes: ['web_page'], limit: 2 },
    {
      results: [
        {
          title: '袜子详情页排版参考',
          url: 'https://example.com/socks-detail',
          content: '包含产品卖点、材质展示和场景模块的详情页结构。'
        },
        {
          title: '无效结果',
          url: 'javascript:alert(1)',
          content: '不应进入知识结果。'
        },
        {
          title: '第二个参考',
          url: 'https://example.com/second',
          content: ''
        }
      ]
    },
    { fetchedAt: '2026-05-18T00:00:00.000Z' }
  );

  assert(normalized.length === 2, 'normalizer should drop unsafe URLs and keep valid results', normalized);
  assert(normalized[0].sourceType === 'web_page', 'SearXNG result should enter canonical web_page source type', normalized[0]);
  assert(normalized[0].allowedUses.includes('prompt_context'), 'SearXNG result should be prompt context only', normalized[0]);
  assert(!normalized[0].allowedUses.includes('direct_photoshop_action'), 'SearXNG result must not become Photoshop action', normalized[0]);
  assert(normalized[0].tags.includes('searxng'), 'SearXNG result should keep provider tag', normalized[0]);
  assert(normalized[0].updatedAt === '2026-05-18T00:00:00.000Z', 'SearXNG result should carry fetchedAt evidence', normalized[0]);
  assertNoMojibake(normalized, 'normalized SearXNG response');

  let fetchCalls = 0;
  const fakeFetch = async (requestUrl) => {
    fetchCalls += 1;
    assert(String(requestUrl).includes('/search?'), 'service should call SearXNG search endpoint', { requestUrl });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: '网格排版基础',
            url: 'https://example.com/grid',
            content: '用于理解网格、留白和对齐的网页摘要。'
          }
        ]
      })
    };
  };

  const service = await DesignKnowledgeSearchService.search(
    {
      query: '网格排版',
      intents: ['reference'],
      sourceTypes: ['web_page'],
      limit: 5
    },
    {
      searxng: {
        enabled: true,
        endpoint: 'http://127.0.0.1:8080',
        fetchedAt: new Date().toISOString()
      },
      fetchImpl: fakeFetch
    }
  );

  assert(fetchCalls === 1, 'enabled connector with endpoint should call injected fetch once', { fetchCalls });
  assert(service.results.some((item) => item.tags.includes('searxng')), 'service should merge SearXNG results', service);
  assert(service.providerSummary.externalSearch === 1, 'provider summary should count SearXNG external search results', service.providerSummary);
  assert(service.providerSummary.webPage === 1, 'provider summary should count web_page results', service.providerSummary);
  assert(service.warnings.every((line) => !line.includes('direct Photoshop')), 'warnings should not offer direct Photoshop execution', service.warnings);
  assertNoMojibake(service, 'SearXNG service response');

  const unavailable = await DesignKnowledgeSearchService.search(
    {
      query: '网格排版',
      intents: ['reference'],
      sourceTypes: ['web_page'],
      limit: 5
    },
    {
      searxng: {
        enabled: true,
        endpoint: 'http://127.0.0.1:8080',
        fetchedAt: '2026-05-18T00:00:00.000Z'
      },
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({})
      })
    }
  );

  assert(unavailable.results.length === 0, 'failed SearXNG should not fabricate external results', unavailable);
  assert(unavailable.warnings.some((line) => line.includes('SearXNG')), 'failed SearXNG should produce explicit warning', unavailable.warnings);

  const healthy = await DesignKnowledgeSearchService.probeSearxngHealth(
    {
      enabled: true,
      endpoint: 'http://127.0.0.1:8080',
      fetchedAt: '2026-05-18T00:00:00.000Z'
    },
    {
      fetchImpl: async (requestUrl) => ({
        ok: String(requestUrl).includes('/search?'),
        status: 200,
        json: async () => ({ results: [] })
      })
    }
  );

  assert(healthy.status === 'ok', 'health probe should report ok for successful SearXNG JSON response', healthy);
  assert(healthy.boundaries.doesNotRunPhotoshop === true, 'health probe must not touch Photoshop', healthy);

  return {
    success: true,
    checks: [
      'SearXNG connector stays disabled unless explicitly enabled',
      'SearXNG endpoint is required and Docker lifecycle is not managed',
      'SearXNG search URL is deterministic and bounded',
      'SearXNG results normalize into DesignKnowledgeResult web_page evidence',
      'SearXNG results cannot become direct Photoshop actions',
      'DesignKnowledgeSearchService can merge SearXNG results through injected fetch',
      'SearXNG failures warn without fabricating knowledge results',
      'SearXNG health probe checks endpoint readiness without Photoshop side effects'
    ]
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
