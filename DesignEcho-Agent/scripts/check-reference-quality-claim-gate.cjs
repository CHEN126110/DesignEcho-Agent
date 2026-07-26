#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

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

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function buildGate({ readiness, pipeline, minEligibleCases }) {
  const counts = readiness.counts || {};
  const cases = readiness.cases || [];
  const eligibleCases = cases.filter((item) => item.canClaimDesignQuality);
  const realReferenceSourceCases = cases.filter((item) => item.realReferenceSource);
  const hasRealEligibleCase = eligibleCases.length >= minEligibleCases;
  const blockers = [];
  const warnings = [];

  if (normalizeNumber(counts.designQualityEligible) < minEligibleCases) {
    blockers.push(`design quality eligible cases ${normalizeNumber(counts.designQualityEligible)} < required ${minEligibleCases}`);
  }
  if (realReferenceSourceCases.length < minEligibleCases) {
    blockers.push(`explicit real-source cases ${realReferenceSourceCases.length} < required ${minEligibleCases}`);
  }
  if (normalizeNumber(counts.withResultScreenshot) < minEligibleCases) {
    blockers.push('no real result screenshot evidence recorded');
  }
  if (normalizeNumber(counts.validResultEvidenceReport) < minEligibleCases) {
    blockers.push('no valid result evidence report recorded');
  }
  if (normalizeNumber(counts.buildVerified) < minEligibleCases) {
    blockers.push('no build/execution verification recorded');
  }
  if (normalizeNumber(counts.manualVerified) < minEligibleCases) {
    blockers.push('no manual review recorded');
  }
  if (normalizeNumber(counts.scoreComplete) < minEligibleCases) {
    blockers.push('no complete 0..1 score set recorded');
  }

  const sourceCounts = readiness.sourceCounts || {};
  if (normalizeNumber(sourceCounts['synthetic-fixture']) > 0) {
    warnings.push('synthetic fixture cases are present and excluded from quality claims');
  }
  if (normalizeNumber(counts.temporaryFex) > 0) {
    warnings.push('temporary FEX benchmark is present and excluded from quality claims');
  }
  if (pipeline?.qualityClaimCandidates !== undefined && Number(pipeline.qualityClaimCandidates) !== eligibleCases.length) {
    warnings.push('readiness and evidence pipeline quality candidate counts differ; inspect benchmark state');
  }

  const allowedToClaim = blockers.length === 0 && hasRealEligibleCase;
  return {
    allowedToClaim,
    minEligibleCases,
    eligibleCases: eligibleCases.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      overall: item.score?.overall ?? item.evidence?.score?.overall ?? null
    })),
    blockers,
    warnings,
    evidenceSummary: {
      total: normalizeNumber(counts.total),
      explicitRealSourceCases: realReferenceSourceCases.length,
      designQualityEligible: normalizeNumber(counts.designQualityEligible),
      withResultScreenshot: normalizeNumber(counts.withResultScreenshot),
      validResultEvidenceReport: normalizeNumber(counts.validResultEvidenceReport),
      buildVerified: normalizeNumber(counts.buildVerified),
      manualVerified: normalizeNumber(counts.manualVerified),
      scoreComplete: normalizeNumber(counts.scoreComplete),
      temporaryFex: normalizeNumber(counts.temporaryFex),
      syntheticFixture: normalizeNumber(counts.syntheticFixture),
      sourceCounts: readiness.sourceCounts || {},
      pipelineStages: pipeline?.stageCounts || {},
      pipelineQualityClaimCandidates: pipeline?.qualityClaimCandidates ?? null
    },
    boundary: {
      claimAllowedOnlyWhen: [
        'explicitly real reference source kind',
        'non-synthetic and non-FEX benchmark case',
        'real result screenshot exists',
        'valid result evidence report exists',
        'build/execution verification is recorded',
        'manual review is recorded',
        'all five 0..1 scores are complete',
        'overall score is at least 0.8',
        'required evidence includes editable layers, bounds QA, screenshot pixel probe and manual review'
      ],
      pixelProbeIsDiagnosticOnly: true,
      gateDoesNotRunPhotoshop: true,
      gateDoesNotMutateBenchmark: true
    }
  };
}

function buildReport(options) {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const minEligibleCases = Math.max(1, Number.parseInt(String(options['min-eligible-cases'] || '1'), 10) || 1);
  const benchmarkDir = options['benchmark-dir'] ? path.resolve(process.cwd(), String(options['benchmark-dir'])) : '';
  const benchmarkArgs = benchmarkDir ? ['--benchmark-dir', benchmarkDir] : [];
  const readiness = JSON.parse(run('node', ['scripts/report-reference-replication-readiness.cjs', '--json', ...benchmarkArgs], agentRoot));
  const pipeline = JSON.parse(run('node', ['scripts/report-reference-evidence-pipeline.cjs', '--json', ...benchmarkArgs], agentRoot));
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    benchmarkDir: benchmarkDir || 'benchmarks/reference-replication',
    gate: buildGate({ readiness, pipeline, minEligibleCases }),
    policy: {
      readOnly: true,
      doesNotRunPhotoshop: true,
      doesNotCallModel: true,
      doesNotMutateCases: true
    }
  };
}

function printText(report) {
  const gate = report.gate;
  console.log('Reference Replication Quality Claim Gate');
  console.log(`allowedToClaim: ${gate.allowedToClaim}`);
  console.log(`eligibleCases: ${gate.eligibleCases.length}/${gate.minEligibleCases}`);
  console.log('');
  console.log('evidence summary:');
  for (const [key, value] of Object.entries(gate.evidenceSummary)) {
    console.log(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }
  if (gate.blockers.length > 0) {
    console.log('');
    console.log('blockers:');
    gate.blockers.forEach((item) => console.log(`- ${item}`));
  }
  if (gate.warnings.length > 0) {
    console.log('');
    console.log('warnings:');
    gate.warnings.forEach((item) => console.log(`- ${item}`));
  }
  console.log('');
  console.log('boundary: screenshot pixel probe is diagnostic only; this gate does not run Photoshop or mutate benchmark cases.');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/check-reference-quality-claim-gate.cjs [--json] [--require-ready] [--min-eligible-cases 1] [--benchmark-dir <path>]');
    return;
  }
  const report = buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
  if (options['require-ready'] && !report.gate.allowedToClaim) {
    process.exitCode = 2;
  }
}

main();
