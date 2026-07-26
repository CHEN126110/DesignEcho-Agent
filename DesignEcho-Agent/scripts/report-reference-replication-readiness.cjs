#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  isRealReferenceSourceKind,
  isBlockedReferenceSourceKind,
  normalizeReferenceSourceKind,
  isSyntheticFixtureReferenceSourceKind,
  isTemporaryFexReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');
const {
  buildReferenceQualityGateConsistency
} = require('./lib/reference-quality-gate-consistency.cjs');
const { validateEvidence } = require('./validate-reference-result-evidence.cjs');

const SCORE_KEYS = ['structure', 'placement', 'textHierarchy', 'editability', 'overall'];

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveBenchmarkPath(benchmarkDir, relativePath) {
  const rawPath = String(relativePath || '').trim();
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return null;
  const resolved = path.resolve(benchmarkDir, rawPath);
  const relative = path.relative(benchmarkDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function existsBenchmarkPath(benchmarkDir, relativePath) {
  const resolved = resolveBenchmarkPath(benchmarkDir, relativePath);
  return Boolean(resolved && fs.existsSync(resolved));
}

function isCompleteScore(score) {
  if (!score || typeof score !== 'object') return false;
  return SCORE_KEYS.every((key) => {
    const value = score[key];
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  });
}

function getSourceKind(caseJson) {
  return normalizeReferenceSourceKind(caseJson?.scenario?.source?.providedBy);
}

function getCaseCategory(caseJson) {
  return String(caseJson?.scenario?.category || 'unknown').trim() || 'unknown';
}

function isTemporaryFexCase(caseJson) {
  const id = String(caseJson?.id || '');
  const name = String(caseJson?.name || '');
  const reference = String(caseJson?.referenceImage?.path || '');
  return /fex/i.test(id) || /FEX/i.test(name) || /fex/i.test(reference);
}

function defaultEvidencePath(repoRoot, caseId) {
  return path.join(repoRoot, 'tmp', `${caseId}-result-evidence.json`);
}

function validateResultEvidenceReport(repoRoot, benchmarkDir, caseId) {
  const evidencePath = defaultEvidencePath(repoRoot, caseId);
  if (!fs.existsSync(evidencePath)) {
    return {
      exists: false,
      valid: false,
      path: evidencePath,
      errors: ['missing result evidence report'],
      warnings: []
    };
  }
  try {
    const report = readJson(evidencePath);
    const validation = validateEvidence(report, { benchmarkDir });
    return {
      exists: true,
      valid: validation.ok === true,
      path: evidencePath,
      errors: validation.errors || [],
      warnings: validation.warnings || []
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      path: evidencePath,
      errors: [error?.message || String(error)],
      warnings: []
    };
  }
}

function classifyReadiness(evidence) {
  if (!evidence.referenceImageExists) return 'missing_reference';
  if (!evidence.expectedElementsReady) return 'missing_expected_elements';
  if (!evidence.resultScreenshotExists) return 'reference_only';
  if (!evidence.resultEvidenceReportValid) return 'needs_result_evidence';
  if (!evidence.buildVerified) return 'output_without_build_verification';
  if (!evidence.manualVerified || !evidence.scoresComplete) return 'needs_manual_review';
  if (evidence.canClaimDesignQuality) return 'reviewed_real_quality_candidate';
  return 'reviewed_but_not_quality_claim';
}

function buildCaseReport(repoRootValue, benchmarkDir, manifestItem) {
  const id = String(manifestItem?.id || '').trim();
  const file = String(manifestItem?.file || `cases/${id}.json`).trim();
  const casePath = resolveBenchmarkPath(benchmarkDir, file);
  if (!casePath || !fs.existsSync(casePath)) {
    return {
      id,
      file,
      readable: false,
      readiness: 'missing_case_file',
      canClaimDesignQuality: false,
      blockers: [`case file missing: ${file}`],
      warnings: []
    };
  }

  const caseJson = readJson(casePath);
  const sourceKind = getSourceKind(caseJson);
  const category = getCaseCategory(caseJson);
  const referenceImagePath = String(caseJson?.referenceImage?.path || '').trim();
  const resultScreenshotPath = String(caseJson?.outputs?.resultScreenshot || '').trim();
  const expectedElementCount = Array.isArray(caseJson?.expectedElements) ? caseJson.expectedElements.length : 0;
  const requiredEvidence = Array.isArray(caseJson?.acceptance?.requiredEvidence)
    ? caseJson.acceptance.requiredEvidence.map(String)
    : [];
  const resultEvidenceReport = validateResultEvidenceReport(repoRootValue, benchmarkDir, caseJson.id || id);

  const evidence = {
    referenceImageExists: existsBenchmarkPath(benchmarkDir, referenceImagePath),
    expectedElementsReady: expectedElementCount > 0,
    resultScreenshotExists: existsBenchmarkPath(benchmarkDir, resultScreenshotPath),
    buildVerified: Boolean(caseJson?.verification?.buildVerified),
    manualVerified: Boolean(caseJson?.verification?.manualVerified),
    reviewedAt: String(caseJson?.verification?.reviewedAt || '').trim(),
    scoresComplete: isCompleteScore(caseJson?.score),
    resultEvidenceReportPath: resultEvidenceReport.path,
    resultEvidenceReportExists: resultEvidenceReport.exists,
    resultEvidenceReportValid: resultEvidenceReport.valid,
    resultEvidenceReportErrors: resultEvidenceReport.errors,
    resultEvidenceReportWarnings: resultEvidenceReport.warnings,
    requiredEvidence,
    requiredEvidenceComplete: requiredEvidence.every((item) => {
      if (item === 'editable-text-layers') return expectedElementCount > 0;
      if (item === 'bounds-qa') return expectedElementCount > 0;
      if (item === 'screenshot-pixel-probe') return Boolean(resultScreenshotPath) && resultEvidenceReport.valid;
      if (item === 'manual-review') return Boolean(caseJson?.verification?.manualVerified);
      return false;
    })
  };

  const temporaryFex = isTemporaryFexReferenceSourceKind(sourceKind) || isTemporaryFexCase(caseJson);
  const syntheticFixture = isSyntheticFixtureReferenceSourceKind(sourceKind);
  const realReferenceSource = isRealReferenceSourceKind(sourceKind);
  const canClaimDesignQuality = Boolean(
    evidence.referenceImageExists
    && evidence.resultScreenshotExists
    && evidence.buildVerified
    && evidence.manualVerified
    && evidence.scoresComplete
    && evidence.requiredEvidenceComplete
    && realReferenceSource
    && !temporaryFex
    && !syntheticFixture
    && Number(caseJson?.score?.overall) >= 0.8
  );
  evidence.canClaimDesignQuality = canClaimDesignQuality;

  const blockers = [];
  const warnings = [];
  if (!evidence.referenceImageExists) blockers.push('missing reference image');
  if (!evidence.expectedElementsReady) blockers.push('missing expectedElements');
  if (!evidence.resultScreenshotExists) blockers.push('missing result screenshot');
  if (evidence.resultScreenshotExists && !evidence.resultEvidenceReportExists) blockers.push('missing result evidence report');
  if (evidence.resultEvidenceReportExists && !evidence.resultEvidenceReportValid) blockers.push('invalid result evidence report');
  if (requiredEvidence.includes('manual-review') && !evidence.manualVerified) blockers.push('missing manual review');
  if (!evidence.scoresComplete) blockers.push('missing complete score');
  if (!realReferenceSource) blockers.push(`source kind cannot support design-quality claim: ${sourceKind}`);
  if (temporaryFex) warnings.push('temporary FEX benchmark only; not a product capability');
  if (syntheticFixture) warnings.push('synthetic fixture only; not real commercial design evidence');
  if (isBlockedReferenceSourceKind(sourceKind) && !syntheticFixture) warnings.push(`blocked benchmark source kind: ${sourceKind}`);
  if (!isBlockedReferenceSourceKind(sourceKind) && !realReferenceSource) warnings.push(`custom source kind requires explicit policy review before quality claims: ${sourceKind}`);
  if (requiredEvidence.includes('screenshot-pixel-probe')) warnings.push('pixel probe is diagnostic, not aesthetic acceptance');
  if (!canClaimDesignQuality) warnings.push('not eligible for design-quality claim');

  return {
    id: caseJson.id || id,
    name: caseJson.name || manifestItem?.name || id,
    file,
    readable: true,
    status: caseJson.status || manifestItem?.status || 'unknown',
    category,
    sourceKind,
    realReferenceSource,
    temporaryFex,
    syntheticFixture,
    expectedElementCount,
    referenceImagePath,
    resultScreenshotPath,
    evidence,
    readiness: classifyReadiness(evidence),
    canClaimDesignQuality,
    blockers,
    warnings
  };
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function buildQualityClaimGateSummary(counts, sourceCounts) {
  const blockers = [];
  const warnings = [];
  const explicitRealSourceCases = Object.entries(sourceCounts || {})
    .filter(([sourceKind]) => isRealReferenceSourceKind(sourceKind))
    .reduce((sum, [, count]) => sum + normalizeNumber(count), 0);
  if (normalizeNumber(counts.designQualityEligible) < 1) blockers.push('design quality eligible cases 0 < required 1');
  if (explicitRealSourceCases < 1) blockers.push(`explicit real-source cases ${explicitRealSourceCases} < required 1`);
  if (normalizeNumber(counts.withResultScreenshot) < 1) blockers.push('no real result screenshot evidence recorded');
  if (normalizeNumber(counts.validResultEvidenceReport) < 1) blockers.push('no valid result evidence report recorded');
  if (normalizeNumber(counts.buildVerified) < 1) blockers.push('no build/execution verification recorded');
  if (normalizeNumber(counts.manualVerified) < 1) blockers.push('no manual review recorded');
  if (normalizeNumber(counts.scoreComplete) < 1) blockers.push('no complete 0..1 score set recorded');
  if (normalizeNumber(sourceCounts['synthetic-fixture']) > 0) warnings.push('synthetic fixture cases are present and excluded from quality claims');
  if (normalizeNumber(counts.temporaryFex) > 0) warnings.push('temporary FEX benchmark is present and excluded from quality claims');
  return {
    available: true,
    allowedToClaim: blockers.length === 0,
    blockerCount: blockers.length,
    hasExplicitRealSourceBlocker: blockers.some((item) => item.includes('explicit real-source cases')),
    hasResultScreenshotBlocker: blockers.includes('no real result screenshot evidence recorded'),
    hasValidEvidenceReportBlocker: blockers.includes('no valid result evidence report recorded'),
    hasBuildVerificationBlocker: blockers.includes('no build/execution verification recorded'),
    hasManualReviewBlocker: blockers.includes('no manual review recorded'),
    hasCompleteScoreBlocker: blockers.includes('no complete 0..1 score set recorded'),
    blockers,
    warnings,
    evidenceSummary: {
      ...counts,
      explicitRealSourceCases
    }
  };
}

function buildReport() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const benchmarkDirArg = getArgValue(process.argv.slice(2), '--benchmark-dir');
  const benchmarkDir = benchmarkDirArg
    ? path.resolve(process.cwd(), benchmarkDirArg)
    : path.join(agentRoot, 'benchmarks/reference-replication');
  const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');
  const manifest = readJson(manifestPath);
  const manifestCases = Array.isArray(manifest.cases) ? manifest.cases : [];
  const cases = manifestCases.map((item) => buildCaseReport(agentRoot, benchmarkDir, item));

  const counts = {
    total: cases.length,
    readable: cases.filter((item) => item.readable).length,
    temporaryFex: cases.filter((item) => item.temporaryFex).length,
    syntheticFixture: cases.filter((item) => item.syntheticFixture).length,
    withReferenceImage: cases.filter((item) => item.evidence?.referenceImageExists).length,
    withExpectedElements: cases.filter((item) => item.evidence?.expectedElementsReady).length,
    withResultScreenshot: cases.filter((item) => item.evidence?.resultScreenshotExists).length,
    withResultEvidenceReport: cases.filter((item) => item.evidence?.resultEvidenceReportExists).length,
    validResultEvidenceReport: cases.filter((item) => item.evidence?.resultEvidenceReportValid).length,
    buildVerified: cases.filter((item) => item.evidence?.buildVerified).length,
    manualVerified: cases.filter((item) => item.evidence?.manualVerified).length,
    scoreComplete: cases.filter((item) => item.evidence?.scoresComplete).length,
    designQualityEligible: cases.filter((item) => item.canClaimDesignQuality).length
  };

  const readinessCounts = {};
  const categoryCounts = {};
  const sourceCounts = {};
  for (const item of cases) {
    increment(readinessCounts, item.readiness || 'unknown');
    increment(categoryCounts, item.category || 'unknown');
    increment(sourceCounts, item.sourceKind || 'unknown');
  }

  const suiteReadyForQualityClaim = counts.designQualityEligible > 0;
  const qualityClaimGate = buildQualityClaimGateSummary(counts, sourceCounts);
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    benchmark: 'benchmarks/reference-replication',
    suite: manifest.suite || 'reference-replication',
    suiteReadyForQualityClaim,
    policy: {
      claimBoundary: 'Only explicitly real-source, non-synthetic, non-FEX cases with real result screenshot, build verification, manual review, complete scores, complete required evidence and overall score >= 0.8 can support design-quality claims.',
      sourceBoundary: 'Only explicitly real reference source kinds can support design-quality claims. unknown/user/custom/synthetic/FEX sources are excluded until reviewed and reclassified.',
      syntheticBoundary: 'Synthetic fixtures prove input coverage only, not real commercial design quality.',
      pixelProbeBoundary: 'Screenshot pixel probe is diagnostic evidence only, not aesthetic acceptance.'
    },
    counts,
    readinessCounts,
    categoryCounts,
    sourceCounts,
    qualityClaimGate,
    qualityGateConsistency: buildReferenceQualityGateConsistency(agentRoot),
    cases
  };
}

function printText(report) {
  console.log('Reference Replication 证据就绪度');
  console.log(`suite: ${report.suite}`);
  console.log(`qualityClaimReady: ${report.suiteReadyForQualityClaim}`);
  console.log(`cases: ${report.counts.total}`);
  console.log(`- reference images: ${report.counts.withReferenceImage}/${report.counts.total}`);
  console.log(`- result screenshots: ${report.counts.withResultScreenshot}/${report.counts.total}`);
  console.log(`- valid result evidence reports: ${report.counts.validResultEvidenceReport}/${report.counts.total}`);
  console.log(`- manual reviewed: ${report.counts.manualVerified}/${report.counts.total}`);
  console.log(`- design quality eligible: ${report.counts.designQualityEligible}/${report.counts.total}`);
  console.log(`- quality gate blockers: ${report.qualityClaimGate.blockerCount}`);
  console.log(`- quality gate consistency smoke: ${report.qualityGateConsistency.smokeAvailable}`);
  console.log('');
  console.log('readiness:');
  for (const [key, value] of Object.entries(report.readinessCounts).sort()) {
    console.log(`- ${key}: ${value}`);
  }
  console.log('');
  console.log('cases:');
  for (const item of report.cases) {
    console.log(`- ${item.id}: ${item.readiness}; qualityClaim=${item.canClaimDesignQuality}; blockers=${item.blockers.length ? item.blockers.join(', ') : 'none'}`);
  }
  console.log('');
  console.log(`boundary: ${report.policy.claimBoundary}`);
}

function main() {
  const json = process.argv.includes('--json');
  const report = buildReport();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
