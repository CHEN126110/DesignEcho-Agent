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
const { buildBusinessSkillVisualContext } = require('../src/shared/business-skill-visual-context.ts');
const { buildBusinessSkillVisualObservationFeedback } = require('../src/shared/business-skill-visual-observation-feedback.ts');

const root = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function run() {
  const missingContext = buildBusinessSkillVisualContext({
    scenario: 'detail-page',
    requiresVisualObservation: true
  });
  const missing = buildBusinessSkillVisualObservationFeedback(missingContext);
  assert(missing.userVisible === true, 'missing project context should offer a user-facing context hint', missing);
  assert(missing.severity === 'warning', 'missing project context is a warning, never an execution block', missing);
  assert(missing.missingInputs.includes('project_context'), 'feedback should expose missing context inputs', missing);
  assert(missing.recommendedActions.includes('refresh_project_context'), 'feedback should recommend context refresh', missing);
  assert(missing.recommendedActions.includes('continue_with_current_context'), 'feedback should preserve the continue option', missing);
  assert(!Object.prototype.hasOwnProperty.call(missing, 'preflightStrategy'), 'feedback must not contain a permission strategy', missing);
  assert(!Object.prototype.hasOwnProperty.call(missing, 'blockerItems'), 'feedback must not contain observation-derived blockers', missing);
  assert(!JSON.stringify(missing).includes('canProceed'), 'feedback must not expose canProceed', missing);

  const readyContext = buildBusinessSkillVisualContext({
    scenario: 'detail-page',
    projectPath: 'D:/demo',
    requiresVisualObservation: false
  });
  const ready = buildBusinessSkillVisualObservationFeedback(readyContext);
  assert(ready.userVisible === false, 'not-required context should stay quiet', ready);
  assert(ready.severity === 'none', 'not-required context should not look like a failure', ready);
  assert(ready.recommendedActions.includes('continue_with_current_context'), 'ready feedback should only recommend normal continuation', ready);

  const parser = read('src/renderer/components/message/parser.ts');
  const cleaner = read('src/shared/chat-response-cleaner.ts');
  assert(parser.includes('feedback.recommendedActions'), 'message parser should consume recommendations');
  assert(parser.includes('feedback.missingInputs'), 'message parser should consume missing inputs');
  assert(!parser.includes('feedback.preflightStrategy'), 'message parser must not read removed permission strategy');
  assert(!parser.includes('feedback.blockerItems'), 'message parser must not render observation blockers');
  assert(cleaner.includes('feedback.recommendedActions'), 'response cleaner should consume recommendations');
  assert(cleaner.includes('feedback.missingInputs'), 'response cleaner should consume missing inputs');
  assert(!cleaner.includes('feedback.preflightStrategy'), 'response cleaner must not infer execution permission from observation');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'feedback exposes missing inputs and recommendations only',
      'feedback has no blocked severity, blocker items, or canProceed strategy',
      'direct UI consumers no longer infer execution authority from observation'
    ]
  }, null, 2));
}

run();
