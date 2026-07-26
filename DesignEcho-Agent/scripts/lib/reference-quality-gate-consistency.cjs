const fs = require('fs');
const path = require('path');

const QUALITY_GATE_CONSISTENCY_POLICY = 'canonical-quality-gate-blocker-consistency';
const QUALITY_GATE_CONSISTENCY_SMOKE = 'smoke:reference:quality-gate-consistency';
const QUALITY_GATE_CONSISTENCY_SCRIPT = 'scripts/smoke-reference-quality-gate-consistency.cjs';
const CHECKED_REFERENCE_QUALITY_GATE_REPORTS = [
  'readiness',
  'pipeline',
  'status',
  'cockpit',
  'architecture'
];

function readPackageJson(agentRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(agentRoot, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function readSmokeScript(agentRoot) {
  try {
    return fs.readFileSync(path.join(agentRoot, QUALITY_GATE_CONSISTENCY_SCRIPT), 'utf8');
  } catch {
    return '';
  }
}

function buildReferenceQualityGateConsistency(agentRoot, packageJson = readPackageJson(agentRoot)) {
  const scripts = packageJson.scripts || {};
  const smokeScript = readSmokeScript(agentRoot);
  const reportChecks = {};

  for (const reportName of CHECKED_REFERENCE_QUALITY_GATE_REPORTS) {
    const key = `checks${reportName[0].toUpperCase()}${reportName.slice(1)}`;
    reportChecks[key] = smokeScript.includes(reportName);
  }

  return {
    smokeAvailable: Boolean(scripts[QUALITY_GATE_CONSISTENCY_SMOKE]),
    smokeInPreflight: String(scripts['maintenance:preflight'] || '').includes(QUALITY_GATE_CONSISTENCY_SMOKE),
    ...reportChecks,
    checkedReports: [...CHECKED_REFERENCE_QUALITY_GATE_REPORTS],
    policy: QUALITY_GATE_CONSISTENCY_POLICY
  };
}

module.exports = {
  CHECKED_REFERENCE_QUALITY_GATE_REPORTS,
  QUALITY_GATE_CONSISTENCY_POLICY,
  QUALITY_GATE_CONSISTENCY_SCRIPT,
  QUALITY_GATE_CONSISTENCY_SMOKE,
  buildReferenceQualityGateConsistency
};
