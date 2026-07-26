#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const settings = read('src/renderer/components/SettingsModal.tsx');
const preferencesPanel = read('src/renderer/components/UserPreferencesPanel.tsx');
const knowledgeLibrary = read('src/renderer/components/KnowledgeLibraryPage.tsx');
const memoryService = read('src/renderer/services/memory.service.ts');

const settingsTabConfig = settings.match(/const SETTINGS_TABS:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1] || '';
assert(!settingsTabConfig.includes("id: 'preferences'"), 'Visible Settings tabs must not expose the migrated preferences entry');
assert(knowledgeLibrary.includes('<UserPreferencesPanel />'), 'Knowledge Library must own the user preferences section');
assert(preferencesPanel.includes('用户偏好'), 'Preferences panel must use user-facing Chinese title');
assert(preferencesPanel.includes('getMemoryService().listPreferenceItems()'), 'Preferences panel must read preference items through MemoryService');
assert(preferencesPanel.includes('getMemoryService().setPreferenceEnabled'), 'Preferences panel must toggle preferences through MemoryService');
assert(preferencesPanel.includes('getMemoryService().archivePreference'), 'Preferences panel must archive preferences through MemoryService');
assert(preferencesPanel.includes('getMemoryService().subscribe'), 'Preferences panel must stay synchronized with MemoryService changes');
assert(preferencesPanel.includes('function openCreate('), 'Preferences panel must expose a create preference handler');
assert(preferencesPanel.includes('function openEdit('), 'Preferences panel must expose an edit preference handler');
assert(preferencesPanel.includes('function saveDraft('), 'Preferences panel must expose a save preference draft handler');
assert(preferencesPanel.includes('function exportPreferences('), 'Preferences panel must expose an export preference handler');
assert(preferencesPanel.includes('function importPreferences('), 'Preferences panel must expose an import preference handler');
assert(preferencesPanel.includes("if (scopeType === 'project') scopeId = currentProject?.id || ''"), 'Project preferences must bind to the current project identity instead of a typed display name');
assert(preferencesPanel.includes("readOnly={draft.scopeType === 'project'}"), 'Project identity must not be manually overwritten');
assert(!preferencesPanel.includes("placeholder={preferenceDraft.scopeType === 'project' ? '例如 C-1160'"), 'Project preference UI must not ask users to type a project display code as the scope id');
assert(preferencesPanel.includes('getMemoryService().upsertExplicitPreference'), 'Create preference UI must save through MemoryService.upsertExplicitPreference');
assert(preferencesPanel.includes('getMemoryService().updatePreferenceItem'), 'Edit preference UI must update through MemoryService.updatePreferenceItem');
assert(preferencesPanel.includes('getMemoryService().exportPreferences'), 'Export preference UI must call MemoryService.exportPreferences');
assert(preferencesPanel.includes('getMemoryService().importPreferences'), 'Import preference UI must call MemoryService.importPreferences');
[
  '作用域',
  '用户级',
  '项目级',
  '品牌级',
  '会话级',
  '确认并启用',
  '导出',
  '导入'
].forEach((text) => {
  assert(preferencesPanel.includes(text), `Preferences panel must render ${text}`);
});
assert(!preferencesPanel.includes("localStorage.removeItem('designecho-memory'"), 'Preferences panel must not directly remove the memory localStorage key');
assert(!preferencesPanel.includes('window.location.reload()'), 'Preference controls must not force reload');
assert(!preferencesPanel.includes('置信度'), 'Preferences UI must not mention confidence');

[
  'listPreferenceItems',
  'upsertExplicitPreference',
  'updatePreferenceItem',
  'setPreferenceEnabled',
  'archivePreference',
  'clearInferredPreferences',
  'clearPreferences',
  'exportPreferences',
  'importPreferences'
].forEach((name) => {
  assert(memoryService.includes(`${name}(`), `MemoryService must implement ${name}`);
});

console.log(JSON.stringify({
  success: true,
  checks: [
    'visible Settings tabs no longer expose user preferences',
    'Knowledge Library supports manual create/edit/import/export preference workflows',
    'preference controls call MemoryService instead of localStorage deletion',
    'UI avoids confidence wording',
    'service contract methods are present'
  ]
}, null, 2));
