#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { validateEvidence } = require('./validate-reference-result-evidence.cjs');
const {
  normalizeReferenceSourceKind,
  isRealReferenceSourceKind,
  isBlockedReferenceSourceKind,
  isValidReferenceSourceKind,
  isTemporaryFexReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');
const {
  buildReferenceQualityGateConsistency
} = require('./lib/reference-quality-gate-consistency.cjs');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function renderCommandPart(part) {
  const value = String(part);
  if (value === 'npm' || value === 'run' || value === '--' || value.startsWith('--') || value.startsWith('benchmark:') || value.startsWith('maintenance:')) {
    return value;
  }
  return quote(value);
}

function command(parts) {
  return parts.map(renderCommandPart).join(' ');
}

function assertInsideDirectory(rootDir, targetPath, label) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes benchmark directory`);
  }
}

function resolveBenchmarkRelativePath(benchmarkDir, relativePath, label) {
  const raw = String(relativePath || '').trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) throw new Error(`${label} must be benchmark-relative`);
  const resolved = path.resolve(benchmarkDir, raw);
  assertInsideDirectory(benchmarkDir, resolved, label);
  return resolved;
}

function hasCompleteScores(score) {
  return ['structure', 'placement', 'textHierarchy', 'editability', 'overall'].every((key) => {
    const value = score?.[key];
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  });
}

function isTemporaryFexCase(caseJson) {
  return /fex/i.test(`${caseJson?.id || ''} ${caseJson?.name || ''} ${caseJson?.referenceImage?.path || ''}`);
}

function scoreOverall(caseJson) {
  const value = Number(caseJson?.score?.overall);
  return Number.isFinite(value) ? value : null;
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function defaultEvidencePath(repoRoot, caseId) {
  return path.join(repoRoot, 'tmp', `${caseId}-result-evidence.json`);
}

function buildCommands(caseId, resultPath, evidencePath) {
  const captureLive = command([
    'npm', 'run', 'benchmark:reference-replication:capture-live', '--',
    '--id', caseId
  ]);
  const capturePlan = command([
    'npm', 'run', 'maintenance:reference-capture-plan', '--',
    '--id', caseId
  ]);
  const evaluateResult = resultPath
    ? command([
      'npm', 'run', 'benchmark:reference-replication:evaluate-result', '--',
      '--id', caseId,
      '--result-screenshot', resultPath
    ])
    : '';
  const validateEvidence = evidencePath
    ? command([
      'npm', 'run', 'benchmark:reference-replication:validate-evidence', '--',
      '--evidence-json', evidencePath
    ])
    : '';
  const recordResult = resultPath
    ? command([
      'npm', 'run', 'benchmark:reference-replication:record-result', '--',
      '--id', caseId,
      '--result-screenshot', resultPath,
      '--copy-result-screenshot',
      '--build-verified',
      '--manual-verified',
      '--reviewer', '<reviewer>',
      '--score-structure', '<0..1>',
      '--score-placement', '<0..1>',
      '--score-text-hierarchy', '<0..1>',
      '--score-editability', '<0..1>',
      '--score-overall', '<0..1>'
    ])
    : '';
  return {
    capturePlan,
    captureLive,
    evaluateResult,
    validateEvidence,
    recordResult
  };
}

function analyzeCase({ repoRoot, benchmarkDir, manifestItem }) {
  const caseId = String(manifestItem?.id || '').trim();
  const casePath = resolveBenchmarkRelativePath(benchmarkDir, manifestItem?.file || `cases/${caseId}.json`, 'manifest case file');
  const item = {
    caseId,
    caseName: manifestItem?.name || caseId,
    caseFile: casePath ? toPosixPath(path.relative(benchmarkDir, casePath)) : '',
    readable: false,
    stage: 'invalid_case',
    nextAction: 'fix_case_file',
    qualityClaimCandidate: false,
    blockers: [],
    warnings: [],
    commands: {}
  };

  if (!casePath || !fs.existsSync(casePath)) {
    item.blockers.push('case file missing');
    return item;
  }

  let caseJson;
  try {
    caseJson = readJson(casePath);
  } catch (error) {
    item.blockers.push(`case json parse failed: ${error?.message || String(error)}`);
    return item;
  }
  item.readable = true;
  item.caseName = caseJson.name || item.caseName;
  const sourceKind = normalizeReferenceSourceKind(caseJson?.scenario?.source?.providedBy);
  const temporaryFex = isTemporaryFexReferenceSourceKind(sourceKind) || isTemporaryFexCase(caseJson);
  const realReferenceSource = isRealReferenceSourceKind(sourceKind) && !temporaryFex;
  const blockedSourceKind = isBlockedReferenceSourceKind(sourceKind);
  const validSourceKind = isValidReferenceSourceKind(sourceKind);
  item.scenario = {
    category: String(caseJson?.scenario?.category || ''),
    sourceKind,
    temporaryFex,
    realReferenceSource,
    blockedSourceKind,
    validSourceKind
  };
  item.sourceEligibleForQualityClaim = realReferenceSource;
  item.qualityClaimCandidate = false;

  const referencePath = resolveBenchmarkRelativePath(benchmarkDir, caseJson?.referenceImage?.path, 'referenceImage.path');
  item.referenceImage = {
    relativePath: String(caseJson?.referenceImage?.path || ''),
    exists: Boolean(referencePath && fs.existsSync(referencePath))
  };
  if (!item.referenceImage.exists) {
    item.stage = 'missing_reference_image';
    item.nextAction = 'restore_or_attach_reference_image';
    item.blockers.push('reference image missing');
    return item;
  }

  const resultPath = resolveBenchmarkRelativePath(benchmarkDir, caseJson?.outputs?.resultScreenshot, 'outputs.resultScreenshot');
  item.resultScreenshot = {
    relativePath: String(caseJson?.outputs?.resultScreenshot || ''),
    absolutePath: resultPath ? toPosixPath(resultPath) : '',
    exists: Boolean(resultPath && fs.existsSync(resultPath))
  };

  const evidencePath = defaultEvidencePath(repoRoot, caseId);
  let evidenceValidation = {
    valid: false,
    errors: [],
    warnings: []
  };
  if (fs.existsSync(evidencePath)) {
    try {
      evidenceValidation = validateEvidence(readJson(evidencePath), { benchmarkDir });
    } catch (error) {
      evidenceValidation = {
        valid: false,
        errors: [error?.message || String(error)],
        warnings: []
      };
    }
  }
  item.evidenceReport = {
    absolutePath: toPosixPath(evidencePath),
    exists: fs.existsSync(evidencePath),
    valid: evidenceValidation.valid === true || evidenceValidation.ok === true,
    errors: evidenceValidation.errors || [],
    warnings: evidenceValidation.warnings || []
  };
  item.verification = {
    buildVerified: caseJson?.verification?.buildVerified === true,
    manualVerified: caseJson?.verification?.manualVerified === true,
    completeScores: hasCompleteScores(caseJson?.score),
    overallScore: scoreOverall(caseJson)
  };
  item.commands = buildCommands(caseId, item.resultScreenshot.absolutePath || '', item.evidenceReport.absolutePath);

  if (!item.resultScreenshot.exists) {
    item.stage = 'awaiting_result_screenshot';
    item.nextAction = 'capture_disposable_live_result';
    item.blockers.push('missing result screenshot');
    if (temporaryFex) item.warnings.push('FEX is a temporary benchmark only');
    if (!realReferenceSource) item.warnings.push(`source kind cannot support real commercial design quality: ${sourceKind}`);
    if (!validSourceKind) item.warnings.push(`unrecognized source kind requires policy review: ${sourceKind}`);
    return item;
  }

  if (!item.evidenceReport.exists) {
    item.stage = 'awaiting_result_evidence';
    item.nextAction = 'run_evaluate_result';
    item.blockers.push('missing result evidence report');
    return item;
  }

  if (!item.evidenceReport.valid) {
    item.stage = 'invalid_result_evidence';
    item.nextAction = 'rerun_evaluate_result';
    item.blockers.push('invalid result evidence report');
    item.blockers.push(...item.evidenceReport.errors);
    return item;
  }

  if (caseJson?.verification?.buildVerified !== true) {
    item.stage = 'awaiting_build_verification';
    item.nextAction = 'record_build_verification_after_review';
    item.blockers.push('build verification not recorded');
    return item;
  }

  if (caseJson?.verification?.manualVerified !== true || !hasCompleteScores(caseJson?.score)) {
    item.stage = 'awaiting_manual_review';
    item.nextAction = 'complete_manual_scores_and_record_result';
    if (caseJson?.verification?.manualVerified !== true) item.blockers.push('manual review not recorded');
    if (!hasCompleteScores(caseJson?.score)) item.blockers.push('complete scores missing');
    return item;
  }

  const overall = scoreOverall(caseJson);
  if (!item.sourceEligibleForQualityClaim) {
    item.stage = 'reviewed_but_not_quality_claim_candidate';
    item.nextAction = 'use_as_mechanism_evidence_only';
    item.warnings.push('case source cannot support real design-quality claims');
    return item;
  }

  if (overall !== null && overall >= 0.8) {
    item.stage = 'reviewed_quality_candidate';
    item.nextAction = 'use_as_candidate_evidence_with_boundaries';
    item.qualityClaimCandidate = true;
    return item;
  }

  item.stage = 'reviewed_below_quality_threshold';
  item.nextAction = 'analyze_failures_before_claiming_quality';
  item.blockers.push('overall score below quality threshold');
  return item;
}

function buildQualityClaimGate(cases) {
  const counts = {
    total: cases.length,
    explicitRealSourceCases: cases.filter((item) => item.scenario?.realReferenceSource).length,
    designQualityEligible: cases.filter((item) => item.qualityClaimCandidate === true).length,
    withResultScreenshot: cases.filter((item) => item.resultScreenshot?.exists === true).length,
    validResultEvidenceReport: cases.filter((item) => item.evidenceReport?.valid === true).length,
    buildVerified: cases.filter((item) => item.verification?.buildVerified === true).length,
    manualVerified: cases.filter((item) => item.verification?.manualVerified === true).length,
    scoreComplete: cases.filter((item) => item.verification?.completeScores === true).length,
    temporaryFex: cases.filter((item) => item.scenario?.temporaryFex === true).length,
    syntheticFixture: cases.filter((item) => item.scenario?.sourceKind === 'synthetic-fixture').length
  };
  const blockers = [];
  const warnings = [];
  if (normalizeNumber(counts.designQualityEligible) < 1) blockers.push('design quality eligible cases 0 < required 1');
  if (normalizeNumber(counts.explicitRealSourceCases) < 1) blockers.push(`explicit real-source cases ${counts.explicitRealSourceCases} < required 1`);
  if (normalizeNumber(counts.withResultScreenshot) < 1) blockers.push('no real result screenshot evidence recorded');
  if (normalizeNumber(counts.validResultEvidenceReport) < 1) blockers.push('no valid result evidence report recorded');
  if (normalizeNumber(counts.buildVerified) < 1) blockers.push('no build/execution verification recorded');
  if (normalizeNumber(counts.manualVerified) < 1) blockers.push('no manual review recorded');
  if (normalizeNumber(counts.scoreComplete) < 1) blockers.push('no complete 0..1 score set recorded');
  if (normalizeNumber(counts.syntheticFixture) > 0) warnings.push('synthetic fixture cases are present and excluded from quality claims');
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
    evidenceSummary: counts
  };
}

function buildReport() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const benchmarkDir = options['benchmark-dir']
    ? path.resolve(process.cwd(), String(options['benchmark-dir']))
    : path.join(repoRoot, 'benchmarks', 'reference-replication');
  const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`missing manifest: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const cases = (manifest.cases || []).map((manifestItem) => analyzeCase({
    repoRoot,
    benchmarkDir,
    manifestItem
  }));
  const qualityClaimGate = buildQualityClaimGate(cases);
  const stageCounts = cases.reduce((acc, item) => {
    acc[item.stage] = (acc[item.stage] || 0) + 1;
    return acc;
  }, {});
  const report = {
    success: cases.every((item) => item.readable),
    generatedAt: new Date().toISOString(),
    benchmarkDir: toPosixPath(benchmarkDir),
    total: cases.length,
    stageCounts,
    qualityClaimCandidates: cases.filter((item) => item.stage === 'reviewed_quality_candidate').length,
    qualityClaimGate,
    qualityGateConsistency: buildReferenceQualityGateConsistency(repoRoot),
    cases,
    policy: {
      reportOnly: true,
      doesNotRunPhotoshop: true,
      doesNotMutateCases: true,
      pixelProbeIsDiagnosticOnly: true
    }
  };
  return report;
}

function printText(report) {
  console.log('Reference Replication 证据流水线');
  console.log(`cases: ${report.total}`);
  console.log(`quality candidates: ${report.qualityClaimCandidates}`);
  console.log(`quality gate allowed: ${report.qualityClaimGate.allowedToClaim}`);
  console.log(`quality gate blockers: ${report.qualityClaimGate.blockerCount}`);
  console.log(`quality gate consistency smoke: ${report.qualityGateConsistency.smokeAvailable}`);
  console.log('stages:');
  for (const [stage, count] of Object.entries(report.stageCounts)) {
    console.log(`- ${stage}: ${count}`);
  }
  console.log('');
  for (const item of report.cases) {
    console.log(`- ${item.caseId}: ${item.stage}; next=${item.nextAction}`);
    if (item.blockers.length > 0) console.log(`  blockers: ${item.blockers.join('; ')}`);
    if (item.commands?.captureLive && item.stage === 'awaiting_result_screenshot') {
      console.log(`  command: ${item.commands.captureLive}`);
    } else if (item.commands?.evaluateResult && item.stage === 'awaiting_result_evidence') {
      console.log(`  command: ${item.commands.evaluateResult}`);
    } else if (item.commands?.recordResult && item.stage === 'awaiting_manual_review') {
      console.log(`  command: ${item.commands.recordResult}`);
    }
  }
}

try {
  const report = buildReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
  if (!report.success) process.exit(1);
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
