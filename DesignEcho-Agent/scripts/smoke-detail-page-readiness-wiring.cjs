const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const executor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
const packageJson = JSON.parse(read('package.json'));

assert(
  executor.includes("from '../../../shared/detail-page-skill-readiness'"),
  'detail-page executor should import the shared readiness contract'
);

assert(
  executor.includes('buildDetailPageSkillReadinessContext'),
  'detail-page executor should map existing evidence into readiness data'
);

assert(
  executor.includes('detailPageSkillReadiness'),
  'detail-page executor should expose detailPageSkillReadiness in result data'
);

assert(
  executor.includes('visualInsightCache?.summary.entriesWithInsight'),
  'detail-page readiness should use VisualInsightCache summary when present'
);

assert(
  executor.includes('visualSamplingPlan?.cacheSummary.shouldAnalyze'),
  'detail-page readiness should expose pending visual analysis count'
);

assert(
  !executor.includes('if (!detailPageSkillReadiness.canExecute'),
  'readiness wiring must stay non-invasive and must not block existing detail-page execution'
);

assert(
  !executor.includes('fillDetailPage\', { plan: {') && !executor.includes('detailPageSkillReadiness, plan'),
  'readiness evidence must not be passed into fillDetailPage write params'
);

assert(
  packageJson.scripts?.['smoke:detail-page:readiness-wiring'] === 'node scripts/smoke-detail-page-readiness-wiring.cjs',
  'package script should expose smoke:detail-page:readiness-wiring'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'detail-page executor imports readiness contract',
    'executor maps existing template/project evidence into readiness data',
    'readiness evidence is exposed in result data',
    'wiring remains non-invasive and does not alter fillDetailPage params'
  ]
}, null, 2));
