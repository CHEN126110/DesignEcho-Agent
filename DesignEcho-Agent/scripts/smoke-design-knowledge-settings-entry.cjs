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

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const {
  DEFAULT_DESIGN_KNOWLEDGE_SETTINGS,
  buildDesignKnowledgeSettingsSummary,
  normalizeDesignKnowledgeSettings,
  toSearxngConnectorConfig
} = require('../src/shared/design-knowledge-settings.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} should include ${needle}`);
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
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
  assert(found.length === 0, `${label} contains mojibake tokens ${found.join(', ')}`, { text });
}

async function run() {
  const normalized = normalizeDesignKnowledgeSettings({
    searxng: {
      enabled: true,
      endpoint: 'http://127.0.0.1:8080/',
      language: 'zh-CN',
      safeSearch: 9,
      timeoutMs: -1
    }
  });
  assert(normalized.searxng.enabled === true, 'normalizer should preserve explicit enablement');
  assert(normalized.searxng.endpoint === 'http://127.0.0.1:8080', 'normalizer should canonicalize endpoint', normalized);
  assert(normalized.searxng.safeSearch === 1, 'normalizer should clamp safeSearch', normalized);
  assert(normalized.searxng.timeoutMs === DEFAULT_DESIGN_KNOWLEDGE_SETTINGS.searxng.timeoutMs, 'normalizer should clamp timeout', normalized);
  assert(toSearxngConnectorConfig(normalized).endpoint === 'http://127.0.0.1:8080', 'settings should map to SearXNG connector config');
  assert(buildDesignKnowledgeSettingsSummary(normalized).status === 'ready', 'summary should expose ready status for enabled endpoint');
  assertNoMojibake(normalized, 'normalized design knowledge settings');

  const settingsModal = read('src/renderer/components/SettingsModal.tsx');
  const settingsTabConfig = settingsModal.match(/const SETTINGS_TABS:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1] || '';
  assert(!settingsTabConfig.includes("id: 'knowledge'"), 'Visible Settings tabs should not expose the migrated knowledge entry');

  const knowledgeLibrary = read('src/renderer/components/KnowledgeLibraryPage.tsx');
  const sourcePanel = read('src/renderer/components/KnowledgeSourceManagementPanel.tsx');
  assertIncludes(knowledgeLibrary, '<KnowledgeSourceManagementPanel />', 'Knowledge Library source-management section');
  assertIncludes(sourcePanel, 'probeDesignKnowledgeSearxng', 'Knowledge source health test bridge');
  assertIncludes(sourcePanel, 'SearXNG endpoint', 'Knowledge source endpoint field');
  assertIncludes(sourcePanel, 'Eagle 素材库', 'Knowledge Library Eagle readonly source');
  assertIncludes(sourcePanel, 'probeDesignKnowledgeEagleReadonly', 'Knowledge Library Eagle readonly probe');
  assertIncludes(sourcePanel, 'DesignEcho 不写标签、不移动文件，也不删除 Eagle 条目', 'Eagle non-mutating boundary');

  const store = read('src/renderer/stores/app.store.ts');
  assertIncludes(store, 'DesignKnowledgeRuntimeSettings', 'app store settings type');
  assertIncludes(store, 'designKnowledgeSettings', 'app store persisted design knowledge settings');
  assertIncludes(store, 'setDesignKnowledgeSettings', 'app store design knowledge setter');
  assertIncludes(store, 'normalizeDesignKnowledgeSettings', 'app store normalizer');

  const preload = read('src/main/preload.ts');
  assertIncludes(preload, 'probeDesignKnowledgeSearxng', 'preload bridge');
  assertIncludes(preload, 'designKnowledge:probeSearxngHealth', 'preload IPC channel');

  const rendererTypes = read('src/renderer/types.d.ts');
  assertIncludes(rendererTypes, 'probeDesignKnowledgeSearxng', 'renderer API type');

  const ipcIndex = read('src/main/ipc-handlers/index.ts');
  assertIncludes(ipcIndex, 'registerDesignKnowledgeHandlers', 'IPC registration');

  const ipcHandler = read('src/main/ipc-handlers/design-knowledge-handlers.ts');
  assertIncludes(ipcHandler, 'designKnowledge:probeSearxngHealth', 'design knowledge IPC handler');
  assertIncludes(ipcHandler, 'DesignKnowledgeSearchService.probeSearxngHealth', 'design knowledge service probe');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-knowledge:settings-entry'], 'package script should expose smoke:design-knowledge:settings-entry');
  assert(
    packageJson.scripts['maintenance:preflight'].includes('smoke:design-knowledge:settings-entry'),
    'maintenance preflight should include design knowledge settings smoke'
  );

  const plan = read('docs/ecommerce-socks-design-skill-plan.md');
  assertIncludes(plan, 'ecommerce-socks-design', 'parent ecommerce socks skill plan');
  assertIncludes(plan, 'main-image', 'main image subskill plan');
  assertIncludes(plan, 'detail-page', 'detail page subskill plan');
  assertIncludes(plan, 'sku', 'sku subskill plan');
  assertIncludes(plan, '当前不改三个子 skill 的业务执行逻辑', 'business execution boundary');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'design knowledge settings normalize into SearXNG connector config',
      'visible Settings tabs no longer expose knowledge management',
      'Knowledge Library exposes Web and Eagle readonly knowledge sources plus health tests',
      'preload and IPC expose readonly SearXNG health probe',
      'app store persists design knowledge runtime settings',
      'Eagle source copy explicitly prohibits writes, moves and deletes',
      'ecommerce socks parent skill plan records main-image/detail-page/sku as subskills without changing business execution'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
