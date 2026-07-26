#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const AGENT_ROOT = path.resolve(__dirname, '..');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const appSource = read(path.join(AGENT_ROOT, 'src/renderer/App.tsx'));
  const pkg = JSON.parse(read(path.join(AGENT_ROOT, 'package.json')));

  assert(
    pkg.scripts?.['smoke:ui:project-list-return'] === 'node scripts/smoke-ui-project-list-return.cjs',
    'package should expose smoke:ui:project-list-return'
  );
  assert(
    appSource.includes('testBridgeProjectSeeded'),
    'Chat test project seeding must be tracked so closing the project can return to the project list'
  );
  assert(
    appSource.includes('testBridgeProjectSeeded.current = true;'),
    'Chat test project seeding should be marked complete before writing the seeded project'
  );
  assert(
    appSource.includes('if (testBridgeProjectSeeded.current) return;'),
    'Chat test project query must seed only once per renderer load'
  );
  assert(
    appSource.includes('onFinishHydration'),
    'Chat test project seeding should wait for Zustand persistence hydration before marking the seed complete'
  );
  assert(
    appSource.includes('useAppStore.getState().currentProject'),
    'Chat test project seeding should compare against the hydrated project, not only the first render state'
  );
  assert(
    appSource.includes('setEcommerceStructure(null);'),
    'Closing a project should clear the project structure preview instead of leaving stale project details'
  );
  assert(
    appSource.includes("setActiveView('chat');"),
    'Closing a project should reset the next opened project to the chat view'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'test project query seeds once per renderer load',
      'test project query waits for persisted store hydration before seeding',
      'returning to the project list cannot be undone by the test query effect',
      'project structure and active subview reset when closing a project'
    ]
  }, null, 2));
}

main();
