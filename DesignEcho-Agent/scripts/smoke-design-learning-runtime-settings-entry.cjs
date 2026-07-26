#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoUnsafeText(text, label) {
  const forbidden = [
    'data:image',
    'raw-image-payload',
    'base64-image-payload',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"',
    '"pixels"',
    '"confidence"',
    'confidence=',
    '置信',
    'C:\\Users\\',
    'D:\\Eagle\\library'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} must not expose unsafe payloads, score markers or local paths: ${found.join(', ')}`);
}

function run() {
  const panelPath = 'src/renderer/components/DesignLearningRuntimeSettingsPanel.tsx';
  assert(exists(panelPath), 'Design learning runtime settings panel should exist');

  const panel = read(panelPath);
  const settings = read('src/renderer/components/SettingsModal.tsx');
  const learningCenter = read('src/renderer/components/KnowledgeLearningCenter.tsx');
  const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');

  assert(panel.includes('createDesignLearningRuntimeEntryController'), 'runtime settings panel must use the existing runtime entry controller');
  assert(panel.includes('.runManual('), 'runtime settings panel must expose explicit manual learning run');
  assert(panel.includes('useAppStore'), 'runtime settings panel should read current project context from app store');
  assert(panel.includes('手动学习'), 'runtime settings panel must use user-facing Chinese copy');
  assert(panel.includes('onClick={handleRunManualLearning}'), 'manual learning must be triggered by an explicit button click');
  assert(!panel.includes('.prepareOnAppStart('), 'runtime settings panel must not prepare app-start runtime');
  assert(!panel.includes('useEffect('), 'runtime settings panel must not auto-run when opened');
  assert(!panel.includes('window.designEcho'), 'runtime settings panel must not call desktop, Eagle, provider or Photoshop APIs directly');
  assert(!panel.includes('localStorage.'), 'runtime settings panel must not directly access localStorage');
  assertNoUnsafeText(panel, 'runtime settings panel source');

  const settingsTabConfig = settings.match(/const SETTINGS_TABS:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1] || '';
  assert(!settingsTabConfig.includes("id: 'learning'"), 'Visible Settings tabs must not expose the migrated learning entry');
  assert(learningCenter.includes('<DesignLearningRuntimeSettingsPanel'), 'Knowledge Learning Center must mount runtime learning controls');
  assert(learningCenter.indexOf('<DesignLearningRuntimeSettingsPanel') < learningCenter.indexOf('<DesignLearningReviewSettingsPanel'), 'manual learning controls should appear before review queue');

  assert(!workbench.includes('DesignLearningRuntimeSettingsPanel'), 'Workbench should not embed manual learning controls in the default chat surface');
  assert(!workbench.includes('createDesignLearningRuntimeEntryController'), 'Workbench should not run design learning runtime from the default chat surface');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-learning:runtime-settings-entry'], 'package script should expose runtime settings entry smoke');
  assert(packageJson.scripts['maintenance:preflight'].includes('smoke:design-learning:runtime-settings-entry'), 'maintenance preflight should include runtime settings entry smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assert(boundaries.includes('smoke:design-learning:runtime-settings-entry'), 'change boundary validation should include runtime settings smoke');
  assert(boundaries.includes('DesignLearningRuntimeSettingsPanel'), 'change boundary matcher should include runtime settings panel');

  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');
  assert(hygiene.includes('smoke-design-learning-runtime-settings-entry.cjs'), 'maintenance hygiene should check runtime settings smoke');
  assert(hygiene.includes('DesignEcho-Agent/src/renderer/components/DesignLearningRuntimeSettingsPanel.tsx'), 'maintenance hygiene should track runtime settings panel');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'Knowledge Learning Center exposes the manual design-learning runtime entry',
      'visible Settings tabs no longer expose learning management',
      'manual learning run uses runtime entry controller instead of direct provider or Photoshop APIs',
      'manual learning requires explicit button click and does not auto-run on settings open',
      'Workbench default chat surface does not embed learning runtime controls',
      'runtime settings panel avoids raw payloads, local paths and confidence markers',
      'package, preflight, change-boundary and maintenance hygiene wiring are present'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
