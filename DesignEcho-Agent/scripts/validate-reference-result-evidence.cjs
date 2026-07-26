#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  normalizeReferenceSourceKind,
  isRealReferenceSourceKind,
  isTemporaryFexReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    let value = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;
    if (value === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }
    options[key] = value === undefined ? true : value;
  }
  return options;
}

function fail(message) {
  throw new Error(`[reference-replication:validate-evidence] ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveInputPath(raw, baseDir = process.cwd()) {
  if (!raw) return '';
  return path.isAbsolute(String(raw)) ? path.resolve(String(raw)) : path.resolve(baseDir, String(raw));
}

function assertInsideDirectory(rootDir, targetPath, label) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} escapes benchmark directory`);
  }
}

function resolveBenchmarkRelativePath(benchmarkDir, relativePath, label) {
  const raw = String(relativePath || '').trim();
  if (!raw) fail(`${label} is empty`);
  if (path.isAbsolute(raw)) fail(`${label} must be benchmark-relative`);
  const resolved = path.resolve(benchmarkDir, raw);
  assertInsideDirectory(benchmarkDir, resolved, label);
  return resolved;
}

function loadManifestCase(benchmarkDir, caseId) {
  const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`missing manifest: ${manifestPath}`);
  const manifest = readJson(manifestPath);
  const manifestItem = (manifest.cases || []).find((item) => String(item?.id || '').trim() === caseId);
  if (!manifestItem) fail(`case not found in manifest: ${caseId}`);
  const casePath = resolveBenchmarkRelativePath(benchmarkDir, manifestItem.file || `cases/${caseId}.json`, 'manifest case file');
  if (!fs.existsSync(casePath)) fail(`case file missing: ${manifestItem.file}`);
  const caseJson = readJson(casePath);
  if (String(caseJson.id || '').trim() !== caseId) fail(`case id mismatch in ${manifestItem.file}`);
  return { manifestItem, caseJson, casePath };
}

function isTemporaryFexCase(caseJson) {
  return /fex/i.test(`${caseJson?.id || ''} ${caseJson?.name || ''} ${caseJson?.referenceImage?.path || ''}`);
}

function validateEvidence(report, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const benchmarkDir = options.benchmarkDir
    ? path.resolve(process.cwd(), String(options.benchmarkDir))
    : path.join(repoRoot, 'benchmarks', 'reference-replication');

  const errors = [];
  const warnings = [];
  const caseId = String(report?.caseId || '').trim();
  if (!caseId) errors.push('missing caseId');
  if (report?.success !== true) errors.push('evidence success must be true');
  if (report?.manualReviewRequired !== true) errors.push('manualReviewRequired must remain true');
  if (!report?.pixelProbe || typeof report.pixelProbe !== 'object') errors.push('missing pixelProbe object');
  if (report?.pixelProbe?.rawImagesRedacted !== true) errors.push('pixelProbe.rawImagesRedacted must be true');
  if (!['ok', 'watch', 'unverified'].includes(String(report?.pixelProbe?.status || ''))) {
    errors.push(`unexpected pixelProbe.status: ${report?.pixelProbe?.status}`);
  }
  if (!/(diagnostic|not a high-fidelity|not high-fidelity|not aesthetic)/i.test(String(report?.pixelProbe?.boundary || ''))) {
    errors.push('pixelProbe.boundary must describe diagnostic-only or non-high-fidelity scope');
  }
  if (!String(report?.commands?.recordResultAfterManualReview || '').includes('benchmark:reference-replication:record-result')) {
    errors.push('missing record-result command');
  }

  let caseJson = null;
  if (caseId) {
    try {
      ({ caseJson } = loadManifestCase(benchmarkDir, caseId));
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  if (caseJson) {
    const expectedReference = String(caseJson?.referenceImage?.path || '').trim();
    const actualReference = String(report?.referenceImage?.relativePath || '').trim();
    if (expectedReference && actualReference && expectedReference !== actualReference) {
      errors.push(`reference image mismatch: expected ${expectedReference}, got ${actualReference}`);
    }
    const sourceKind = normalizeReferenceSourceKind(caseJson?.scenario?.source?.providedBy);
    const temporaryFex = isTemporaryFexReferenceSourceKind(sourceKind) || isTemporaryFexCase(caseJson);
    const expectedCandidate = isRealReferenceSourceKind(sourceKind) && !temporaryFex;
    if (Boolean(report?.qualityClaimCandidateAfterManualReview) !== expectedCandidate) {
      errors.push(`qualityClaimCandidateAfterManualReview must be ${expectedCandidate} for sourceKind=${sourceKind}`);
    }
  }

  const resultScreenshot = resolveInputPath(report?.resultScreenshot?.absolutePath || '');
  if (!resultScreenshot) {
    errors.push('missing resultScreenshot.absolutePath');
  } else if (!fs.existsSync(resultScreenshot)) {
    errors.push(`result screenshot file missing: ${resultScreenshot}`);
  }

  const normalizedSnapshot = resolveInputPath(report?.resultScreenshot?.normalizedSnapshotPath || '');
  if (!normalizedSnapshot) {
    warnings.push('missing normalizedSnapshotPath');
  } else if (!fs.existsSync(normalizedSnapshot)) {
    warnings.push(`normalized snapshot file missing: ${normalizedSnapshot}`);
  }

  return {
    ok: errors.length === 0,
    caseId,
    benchmarkDir: toPosixPath(benchmarkDir),
    pixelProbeStatus: report?.pixelProbe?.status || '',
    manualReviewRequired: Boolean(report?.manualReviewRequired),
    qualityClaimCandidateAfterManualReview: Boolean(report?.qualityClaimCandidateAfterManualReview),
    errors,
    warnings
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidencePath = resolveInputPath(options['evidence-json'] || '');
  if (!evidencePath) fail('--evidence-json is required');
  if (!fs.existsSync(evidencePath)) fail(`evidence json not found: ${evidencePath}`);
  const report = readJson(evidencePath);
  const result = validateEvidence(report, {
    benchmarkDir: options['benchmark-dir']
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  validateEvidence
};
