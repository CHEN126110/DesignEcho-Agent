#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const page = read('src/renderer/components/KnowledgeLibraryPage.tsx');
const pageStyles = read('src/renderer/components/KnowledgeLibraryPage.css');
const learningCenter = read('src/renderer/components/KnowledgeLearningCenter.tsx');
const preferencesPanel = read('src/renderer/components/UserPreferencesPanel.tsx');
const sourcePanel = read('src/renderer/components/KnowledgeSourceManagementPanel.tsx');
const libraryService = read('src/renderer/services/knowledge-library.service.ts');
const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
const settings = read('src/renderer/components/SettingsModal.tsx');

for (const label of ['知识资产', '复核中心']) {
  assert(page.includes(`label: '${label}'`), `Knowledge Library must expose ${label}`);
}
for (const migratedLabel of ['学习复核', '用户偏好', '来源管理']) {
  assert(!page.includes(`label: '${migratedLabel}'`), `Knowledge Library must no longer host ${migratedLabel}`);
}
assert(page.includes('KnowledgeLearningCenter'), 'Review center must keep rendering the learning review surface');
assert(!page.includes('UserPreferencesPanel') && !page.includes('KnowledgeSourceManagementPanel'), 'Preferences and sources must have a single home in Settings');
assert(page.includes('KNOWLEDGE_REFERENCE_USE_ROLES') && page.includes('knowledge-role-picker'), 'Adding a reference must ask for a use role first');
assert(page.includes('knowledge-reference-role'), 'Reference tray must show the declared use role');

assert(page.includes('createDesignMemoryRevision'), 'Managed knowledge must support immutable revision creation');
assert(page.includes('setDesignMemoryLifecycle'), 'Managed knowledge must use the lifecycle owner for disable and restore');
assert(page.includes('disableDesignKnowledgeResult'), 'External and Eagle results must use version-scoped dispositions');
assert(page.includes('restoreDesignKnowledgeDisposition'), 'External and Eagle dispositions must be recoverable');
assert(page.includes('此操作可恢复；该版本将立即停止进入 Agent'), 'Removal confirmation must explain recoverability and Agent impact');
assert(page.includes('旧版会保留为审计记录'), 'Revision UI must preserve old versions for audit');
assert(page.includes('<dt>版本</dt>') && page.includes('<dt>使用</dt>'), 'Knowledge cards must expose revision and usage metadata');
assert(page.includes('onAddReference') && page.includes('selectedReferences'), 'Knowledge cards must bind governed references to the current task');
assert(page.includes('当前是元数据候选，不代表 Agent 已看过原图'), 'Eagle metadata must not be presented as visual understanding');
assert(page.includes('视觉理解') && page.includes('recordDesignLearningMemoryReview'), 'Explicit Eagle visual analysis must enter the existing human review queue');
assert(page.includes('预览图片') && page.includes('clearEaglePreview'), 'Eagle preview must be explicit and releasable');

assert(learningCenter.includes('DesignLearningRuntimeSettingsPanel'));
assert(learningCenter.includes('DesignLearningReviewSettingsPanel'));
assert(preferencesPanel.includes('getMemoryService().subscribe'));
assert(sourcePanel.includes('probeDesignKnowledgeEagleReadonly'));
assert(sourcePanel.includes('DesignEcho 不写标签、不移动文件，也不删除 Eagle 条目'));
assert(sourcePanel.includes('只读候选；视觉结论仍需单独分析'));

assert(libraryService.includes('searchEagleReadonlyKnowledge'));
assert(libraryService.includes('getEagleReferencePreview'));
assert(libraryService.includes("purpose: 'knowledge_library_ui'"), 'UI-only Eagle preview must carry the fail-closed purpose');
assert(libraryService.includes('analyzeEagleReference'));
assert(!page.includes('visualCase: {'), 'Ephemeral Eagle preview data must not be copied into a learning candidate');
for (const prohibitedEagleMutation of [
  'deleteEagle',
  'removeEagle',
  'moveEagle',
  'writeEagle',
  'updateEagleTags',
  'createEagleFolder'
]) {
  assert(!libraryService.includes(prohibitedEagleMutation), `Knowledge Library must not expose Eagle mutation ${prohibitedEagleMutation}`);
  assert(!sourcePanel.includes(prohibitedEagleMutation), `Source management must not expose Eagle mutation ${prohibitedEagleMutation}`);
}

const settingsTabConfig = settings.match(/const SETTINGS_TABS:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1] || '';
for (const retiredTab of ['knowledge', 'learning', 'preferences']) {
  assert(!settingsTabConfig.includes(`id: '${retiredTab}'`), `Settings must not visibly duplicate ${retiredTab}`);
}
for (const migratedTab of ['knowledge-sources', 'user-preferences']) {
  assert(settingsTabConfig.includes(`id: '${migratedTab}'`), `Settings must visibly host migrated ${migratedTab}`);
}
assert(settings.includes('<KnowledgeSourceManagementPanel />'), 'Settings must render the migrated source management panel');
assert(settings.includes('<UserPreferencesPanel />'), 'Settings must render the migrated preferences panel');

assert(workbench.includes("import('./KnowledgeLibraryPage')"));
assert(workbench.includes('selectedReferences={knowledgeReferences}'));
assert(workbench.includes('knowledgeReferences={knowledgeReferences}'));
assert(pageStyles.includes('.knowledge-library-page'));
assert(pageStyles.includes('.knowledge-library-nav'));
assert(pageStyles.includes('.knowledge-card'));
assert(pageStyles.includes(':focus-visible'));

console.log(JSON.stringify({
  success: true,
  checks: [
    'Knowledge Library owns assets and the review center; preferences and sources live in Settings',
    'adding a reference declares a use role before binding to the task',
    'managed knowledge supports revisions, recoverable disable and audit history',
    'cards expose version, usage and task-reference controls',
    'Eagle remains readonly; preview is ephemeral and visual analysis enters human review by item ID',
    'Settings hosts migrated panels under new ids without reviving retired hidden tabs',
    'Workbench keeps knowledge references on the single ChatPanel request path'
  ]
}, null, 2));
