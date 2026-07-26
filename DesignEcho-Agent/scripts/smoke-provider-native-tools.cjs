#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadSharedModule(relativePath) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled.outputText, `${filename}.js`);
  return loaded.exports;
}

const nativeTools = loadSharedModule('src/shared/provider-native-tools.ts');
const {
  buildProviderNativeToolPlan,
  normalizeProviderNativeToolCitations,
  isProviderNativeToolPlanBoundaryOk
} = nativeTools;

assert(typeof buildProviderNativeToolPlan === 'function', 'provider-native tool plan builder should be exported');
assert(typeof normalizeProviderNativeToolCitations === 'function', 'citation normalizer should be exported');
assert(typeof isProviderNativeToolPlanBoundaryOk === 'function', 'boundary helper should be exported');

const enabledXiaomi = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2.5-pro',
  requestedTools: [
    {
      type: 'web_search',
      enabled: true,
      forceSearch: true,
      maxKeyword: 3,
      limit: 5,
      userLocation: {
        type: 'approximate',
        country: 'China',
        region: 'Hubei',
        city: 'Wuhan'
      }
    }
  ]
});
assert(enabledXiaomi.status === 'ready', 'supported xiaomi model should prepare native web_search', enabledXiaomi);
assert(enabledXiaomi.nativeTools.length === 1, 'ready xiaomi plan should contain one native tool', enabledXiaomi);
assert(enabledXiaomi.nativeTools[0].type === 'web_search', 'native tool must preserve provider-native type', enabledXiaomi);
assert(enabledXiaomi.nativeTools[0].force_search === true, 'native tool should use force_search field from official example', enabledXiaomi);
assert(
  enabledXiaomi.nativeTools[0].user_location?.type === 'approximate' &&
    enabledXiaomi.nativeTools[0].user_location?.country === 'China' &&
    enabledXiaomi.nativeTools[0].user_location?.region === 'Hubei' &&
    enabledXiaomi.nativeTools[0].user_location?.city === 'Wuhan',
  'native tool should emit official structured user_location object',
  enabledXiaomi
);
assert(!JSON.stringify(enabledXiaomi.nativeTools).includes('function'), 'native web_search must not be converted into function tool schema', enabledXiaomi);
assert(isProviderNativeToolPlanBoundaryOk(enabledXiaomi) === true, 'enabled xiaomi plan should satisfy boundary checks', enabledXiaomi);

const legacyLocationText = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2.5-pro',
  requestedTools: [
    {
      type: 'web_search',
      enabled: true,
      userLocation: 'China, Hubei, Wuhan'
    }
  ]
});
assert(
  legacyLocationText.nativeTools[0].user_location?.country === 'China' &&
    legacyLocationText.nativeTools[0].user_location?.region === 'Hubei' &&
    legacyLocationText.nativeTools[0].user_location?.city === 'Wuhan',
  'legacy location text should be normalized into official user_location object',
  legacyLocationText
);

const disabledSetting = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2.5-pro',
  requestedTools: [{ type: 'web_search', enabled: false }]
});
assert(disabledSetting.status === 'disabled', 'disabled setting should not prepare native tools', disabledSetting);
assert(disabledSetting.nativeTools.length === 0, 'disabled setting should return no native tools', disabledSetting);

const unsupportedProvider = buildProviderNativeToolPlan({
  provider: 'openai',
  modelId: 'gpt-5.4',
  requestedTools: [{ type: 'web_search', enabled: true }]
});
assert(unsupportedProvider.status === 'unsupported_provider', 'non-xiaomi provider should not receive xiaomi web_search', unsupportedProvider);
assert(unsupportedProvider.nativeTools.length === 0, 'unsupported provider should return no native tools', unsupportedProvider);

const unsupportedModel = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-unknown',
  requestedTools: [{ type: 'web_search', enabled: true }]
});
assert(unsupportedModel.status === 'unsupported_model', 'unsupported xiaomi model should not receive web_search', unsupportedModel);
assert(unsupportedModel.warnings.some((warning) => warning.includes('not in official MiMo Web Search support list')), 'unsupported model should explain official support boundary', unsupportedModel);

const retiredModel = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2-pro',
  requestedTools: [{ type: 'web_search', enabled: true }]
});
assert(retiredModel.status === 'unsupported_model', 'retired Xiaomi MiMo V2 model should not receive web_search', retiredModel);

const clamped = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2.5',
  requestedTools: [{ type: 'web_search', enabled: true, maxKeyword: 99, limit: 100 }]
});
assert(clamped.nativeTools[0].max_keyword === 5, 'max_keyword should be clamped to safe upper bound', clamped);
assert(clamped.nativeTools[0].limit === 10, 'limit should be clamped to safe upper bound', clamped);

const flashModel = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2-flash',
  requestedTools: [{ type: 'web_search', enabled: true }]
});
assert(flashModel.status === 'ready', 'official Xiaomi MiMo V2 Flash should support web_search', flashModel);

const citations = normalizeProviderNativeToolCitations([
  {
    type: 'url_citation',
    url_citation: {
      url: 'https://example.com/design',
      title: 'Design Reference',
      summary: 'A design reference summary',
      site_name: 'Example',
      publish_time: '2026-06-02T00:00:00+08:00',
      logo_url: 'https://example.com/favicon.ico'
    }
  },
  {
    type: 'url_citation',
    url: 'https://example.com/flat',
    title: 'Flat Citation'
  },
  {
    type: 'ignored',
    url: 'https://example.com/ignored'
  }
], {
  provider: 'xiaomi',
  fetchedAt: '2026-05-18T00:00:00.000Z'
});
assert(citations.length === 2, 'only url_citation annotations should become citations', citations);
assert(citations[0].provider === 'xiaomi', 'citations should keep provider', citations);
assert(citations[0].summary === 'A design reference summary', 'citations should preserve official summary metadata', citations);
assert(citations[0].siteName === 'Example', 'citations should preserve official site_name metadata', citations);
assert(citations[0].publishTime === '2026-06-02T00:00:00+08:00', 'citations should preserve official publish_time metadata', citations);
assert(citations[0].logoUrl === 'https://example.com/favicon.ico', 'citations should preserve official logo_url metadata', citations);
assert(citations.every((citation) => citation.fetchedAt === '2026-05-18T00:00:00.000Z'), 'citations should keep fetchedAt', citations);

const adapterTypes = read('src/main/services/provider-adapters/types.ts');
assert(adapterTypes.includes('ProviderNativeToolRequest'), 'provider adapter types should expose native tool request hook');
assert(adapterTypes.includes('ProviderNativeToolCitation'), 'provider adapter response should expose citation hook');
assert(adapterTypes.includes('ProviderNativeToolUsage'), 'provider adapter response should expose native tool usage hook');

const architectureReport = read('scripts/report-agent-architecture.cjs');
const cockpitReport = read('scripts/report-project-cockpit.cjs');
assert(architectureReport.includes('providerNativeToolsContractAvailable'), 'architecture report should expose provider-native tool contract');
assert(cockpitReport.includes('providerNativeToolsContractAvailable'), 'cockpit report should expose provider-native tool contract');

console.log(JSON.stringify({
  success: true,
  checks: [
    'provider-native tool contract exists',
    'xiaomi web_search is gated by provider and model support',
    'web_search remains provider-native and is not converted to function tools',
    'native search options are clamped',
    'url_citation annotations normalize into citations',
    'adapter types expose future native tool and citation hooks',
    'maintenance reports expose provider-native tool contract'
  ]
}, null, 2));
