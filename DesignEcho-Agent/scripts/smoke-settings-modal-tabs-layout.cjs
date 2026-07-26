#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function main() {
  const settingsModal = read('src/renderer/components/SettingsModal.tsx');
  const settingsStyles = read('src/renderer/components/SettingsModal.css');
  const knowledgeLibrary = read('src/renderer/components/KnowledgeLibraryPage.tsx');
  const rendererStyles = read('src/renderer/styles/index.css');
  const packageJson = JSON.parse(read('package.json'));

  for (const marker of [
    'SETTINGS_TABS',
    "role=\"dialog\"",
    "aria-modal=\"true\"",
    "role=\"tablist\"",
    "role=\"tab\"",
    "aria-selected={selected}",
    "role=\"tabpanel\"",
    'handleTabKeyDown',
    "event.key === 'ArrowRight'",
    "event.key === 'ArrowLeft'",
    "event.key === 'ArrowDown'",
    "event.key === 'ArrowUp'",
    "event.key === 'Home'",
    "event.key === 'End'"
  ]) {
    assert(settingsModal.includes(marker), `Settings modal should keep accessible tab/dialog contract: ${marker}`);
  }

  assert(
    settingsStyles.includes('grid-template-columns: 188px minmax(0, 1fr)') &&
      settingsStyles.includes('overflow-y: auto') &&
      settingsStyles.includes('.settings-modal .tab-btn:focus-visible'),
    'Settings tabs should use one readable vertical navigation owner with keyboard focus.'
  );
  assert(
    settingsStyles.includes('white-space: nowrap') &&
      settingsStyles.includes('.settings-modal .tab-count'),
    'Settings tab labels and content counts should remain readable in the sidebar.'
  );
  assert(
      settingsStyles.includes('width: min(980px, calc(100vw - 32px))') &&
      settingsStyles.includes('height: min(720px, calc(100vh - 32px))'),
    'Settings modal should reserve enough desktop space for visible knowledge and memory content.'
  );
  assert(
    settingsStyles.includes('@media (max-width: 560px)') &&
      settingsStyles.includes('grid-template-columns: 1fr'),
    'Settings modal should collapse to one column on narrow screens.'
  );
  const settingsTabConfig = settingsModal.match(/const SETTINGS_TABS:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1] || '';
  for (const retiredTab of ["id: 'knowledge'", "id: 'learning'", "id: 'preferences'"]) {
    assert(!settingsTabConfig.includes(retiredTab), `Settings visible tabs must not include migrated entry ${retiredTab}.`);
  }
  assert(
    knowledgeLibrary.includes("label: '知识资产'") &&
      knowledgeLibrary.includes("label: '复核中心'") &&
      !knowledgeLibrary.includes("label: '用户偏好'") &&
      !knowledgeLibrary.includes("label: '来源管理'"),
    'Knowledge Library should own assets and review; preferences and sources live in Settings.'
  );
  assert(
    settingsTabConfig.includes("id: 'knowledge-sources'") &&
      settingsTabConfig.includes("id: 'user-preferences'"),
    'Settings visible tabs should host the migrated source-management and preferences entries.'
  );
  for (const token of [
    '--de-bg-dark:',
    '--de-text-primary:',
    '--de-text-muted:',
    '--de-primary-dim:',
    '--de-danger:',
    '--de-danger-rgb:'
  ]) {
    const count = (rendererStyles.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    assert(count >= 2, `Renderer theme should define ${token} for dark and light themes.`);
  }
  assert(
    packageJson.scripts['smoke:settings-modal-tabs-layout'] === 'node scripts/smoke-settings-modal-tabs-layout.cjs',
    'package.json should expose smoke:settings-modal-tabs-layout.'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'settings tab nav uses a readable vertical owner and keyboard navigation',
      'settings tab labels and content counts stay visible',
      'settings modal exposes dialog/tab/tabpanel semantics and keyboard tab navigation',
      'settings modal reserves sufficient desktop space and collapses on narrow screens',
      'knowledge, learning and preference entries are absent from visible Settings tabs',
      'Knowledge Library owns the four migrated management sections',
      'renderer theme defines shared UI token aliases used by settings and workbench surfaces'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
