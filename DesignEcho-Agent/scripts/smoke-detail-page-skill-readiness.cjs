const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildDetailPageSkillReadiness
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'detail-page-skill-readiness.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function buildTemplate(overrides = {}) {
  return {
    parseSuccess: true,
    screenCount: 11,
    readinessMode: 'recover-then-fill',
    issueCount: 3,
    crossScreenRiskCount: 1,
    copyPlaceholderCount: 24,
    imagePlaceholderCount: 11,
    ...overrides
  };
}

function buildProject(overrides = {}) {
  return {
    projectPathKnown: true,
    assetImageCount: 88,
    visualCandidateCount: 8,
    selectedCandidateCount: 6,
    visualInsightCount: 6,
    shouldAnalyzeCount: 0,
    ...overrides
  };
}

const inspectOnly = buildDetailPageSkillReadiness({
  mode: 'inspect',
  template: buildTemplate(),
  project: buildProject({ projectPathKnown: false, assetImageCount: 0, visualCandidateCount: 0, visualInsightCount: 0 })
});
assert(inspectOnly.status === 'inspect_only', 'inspect mode should not require project visual evidence', inspectOnly);
assert(inspectOnly.canInspect === true, 'inspect mode should allow template inspection', inspectOnly);
assert(inspectOnly.canExecute === false, 'inspect mode should not claim executable design readiness', inspectOnly);

const missingTemplate = buildDetailPageSkillReadiness({
  mode: 'execute',
  template: buildTemplate({ parseSuccess: false, screenCount: 0 }),
  project: buildProject()
});
assert(missingTemplate.status === 'blocked', 'missing template parse should block execution readiness', missingTemplate);
assert(missingTemplate.blockers.some((item) => item.includes('parseDetailPageTemplate')), 'missing template should mention parseDetailPageTemplate', missingTemplate);

const missingVisualObservation = buildDetailPageSkillReadiness({
  mode: 'execute',
  template: buildTemplate(),
  project: buildProject({ visualInsightCount: 0, shouldAnalyzeCount: 6 })
});
assert(missingVisualObservation.status === 'needs_context', 'missing visual insight should request context instead of claiming ready', missingVisualObservation);
assert(missingVisualObservation.requiredNextChecks.includes('VisualInsightCache or visual model analysis'), 'missing visual insight should request a visual observation', missingVisualObservation);
assert(missingVisualObservation.canExecute === false, 'missing visual insight should not claim safe execution readiness', missingVisualObservation);

const ready = buildDetailPageSkillReadiness({
  mode: 'execute',
  template: buildTemplate({ readinessMode: 'auto-fill', issueCount: 0, crossScreenRiskCount: 0 }),
  project: buildProject(),
  imagePlacementCoreAvailable: true,
  verificationToolsAvailable: true
});
assert(ready.status === 'ready', 'full template and visual context should be ready', ready);
assert(ready.canExecute === true, 'ready case should allow execution readiness', ready);

const serialized = JSON.stringify([inspectOnly, missingTemplate, missingVisualObservation, ready]);
assert(!serialized.includes('FEX'), 'readiness contract must not bake benchmark fixtures into the product path');
assert(!serialized.includes('rawImage') && !serialized.includes('base64'), 'readiness contract must not expose raw images');

console.log(JSON.stringify({
  success: true,
  cases: [
    inspectOnly.status,
    missingTemplate.status,
    missingVisualObservation.status,
    ready.status
  ]
}, null, 2));
