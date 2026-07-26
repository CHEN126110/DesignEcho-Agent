#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  normalizeReferenceSourceKind,
  isRealReferenceSourceKind,
  isBlockedReferenceSourceKind,
  isValidReferenceSourceKind,
  isTemporaryFexReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');

const DEFAULT_CASE_ID = 'rr-002-neutral-quality-card-text-layout';

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
  return String(value).replace(/\\/g, '/');
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function renderCommandPart(part) {
  const value = String(part);
  if (value === 'npm' || value === 'run' || value === '--' || value.startsWith('--') || value.startsWith('benchmark:')) {
    return value;
  }
  return quote(value);
}

function resolveBenchmarkPath(benchmarkDir, relativePath, label) {
  const raw = String(relativePath || '').trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) {
    throw new Error(`${label} must be benchmark-relative`);
  }
  const resolved = path.resolve(benchmarkDir, raw);
  const relative = path.relative(benchmarkDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes benchmark directory`);
  }
  return resolved;
}

function getArgValue(options, key, fallback = '') {
  const value = options[key];
  return value === undefined || value === true ? fallback : String(value);
}

function isTemporaryFexCase(caseJson) {
  const id = String(caseJson?.id || '');
  const name = String(caseJson?.name || '');
  const reference = String(caseJson?.referenceImage?.path || '');
  return /fex/i.test(id) || /FEX/i.test(name) || /fex/i.test(reference);
}

function buildScoreArgs(options) {
  const scoreDefaults = {
    'score-structure': getArgValue(options, 'score-structure', '<0..1>'),
    'score-placement': getArgValue(options, 'score-placement', '<0..1>'),
    'score-text-hierarchy': getArgValue(options, 'score-text-hierarchy', '<0..1>'),
    'score-editability': getArgValue(options, 'score-editability', '<0..1>'),
    'score-overall': getArgValue(options, 'score-overall', '<0..1>')
  };

  return Object.entries(scoreDefaults)
    .flatMap(([key, value]) => [`--${key}`, value]);
}

function buildPlan() {
  const options = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const benchmarkDir = options['benchmark-dir']
    ? path.resolve(process.cwd(), String(options['benchmark-dir']))
    : path.join(agentRoot, 'benchmarks/reference-replication');
  const caseId = getArgValue(options, 'id', DEFAULT_CASE_ID);
  const manifest = readJson(path.join(benchmarkDir, 'cases.manifest.json'));
  const manifestItem = (manifest.cases || []).find((item) => String(item?.id || '').trim() === caseId);
  if (!manifestItem) {
    throw new Error(`case not found in manifest: ${caseId}`);
  }

  const casePath = resolveBenchmarkPath(benchmarkDir, manifestItem.file || `cases/${caseId}.json`, 'manifest case file');
  if (!casePath || !fs.existsSync(casePath)) {
    throw new Error(`case file missing: ${manifestItem.file}`);
  }
  const caseJson = readJson(casePath);
  const referencePath = resolveBenchmarkPath(benchmarkDir, caseJson?.referenceImage?.path, 'referenceImage.path');
  const existingResult = String(caseJson?.outputs?.resultScreenshot || '').trim();
  const resultName = getArgValue(options, 'result-name', `${caseId}-result.png`);
  if (path.basename(resultName) !== resultName) {
    throw new Error('--result-name must be a file name, not a path');
  }
  const resultPath = path.join(benchmarkDir, 'results', resultName);
  const reviewer = getArgValue(options, 'reviewer', '<reviewer>');
  const sourceKind = normalizeReferenceSourceKind(caseJson?.scenario?.source?.providedBy);
  const temporaryFex = isTemporaryFexReferenceSourceKind(sourceKind) || isTemporaryFexCase(caseJson);
  const realReferenceSource = isRealReferenceSourceKind(sourceKind) && !temporaryFex;
  const blockedSourceKind = isBlockedReferenceSourceKind(sourceKind);
  const validSourceKind = isValidReferenceSourceKind(sourceKind);

  const blockers = [];
  const warnings = [];
  if (!referencePath || !fs.existsSync(referencePath)) blockers.push('reference image missing');
  if (existingResult) warnings.push(`case already has outputs.resultScreenshot=${existingResult}`);
  if (temporaryFex) warnings.push('FEX is temporary benchmark only and cannot become quality-claim evidence');
  if (blockedSourceKind && !temporaryFex) warnings.push(`source kind cannot support real commercial design quality: ${sourceKind}`);
  if (!validSourceKind) warnings.push(`unrecognized source kind requires policy review before quality claims: ${sourceKind}`);
  if (!realReferenceSource) warnings.push('case can validate mechanism only until an explicit real reference source is recorded');

  const recordArgs = [
    'npm', 'run', 'benchmark:reference-replication:record-result', '--',
    '--id', caseId,
    '--result-screenshot', resultPath,
    '--copy-result-screenshot',
    '--build-verified',
    '--manual-verified',
    '--reviewer', reviewer,
    ...buildScoreArgs(options)
  ];

  return {
    success: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    caseId,
    caseName: caseJson.name || manifestItem.name || caseId,
    benchmarkDir: toPosixPath(benchmarkDir),
    caseFile: toPosixPath(path.relative(benchmarkDir, casePath)),
    referenceImage: {
      relativePath: String(caseJson?.referenceImage?.path || ''),
      absolutePath: referencePath ? toPosixPath(referencePath) : '',
      exists: Boolean(referencePath && fs.existsSync(referencePath))
    },
    plannedResult: {
      absolutePath: toPosixPath(resultPath),
      benchmarkRelativePath: toPosixPath(path.relative(benchmarkDir, resultPath)),
      existsAlready: fs.existsSync(resultPath)
    },
    scenario: {
      category: String(caseJson?.scenario?.category || ''),
      sourceKind,
      temporaryFex,
      realReferenceSource,
      blockedSourceKind,
      validSourceKind
    },
    liveRunBoundary: {
      shouldUseDisposableDocument: true,
      shouldNotSaveUserDocuments: true,
      shouldCaptureScreenshotBeforeRecording: true,
      canClaimDesignQualityAfterRecording: realReferenceSource
    },
    commands: {
      recordResultAfterScreenshot: recordArgs.map(renderCommandPart).join(' '),
      readinessAfterRecording: 'npm run maintenance:reference-readiness',
      validateAfterRecording: 'npm run maintenance:validate'
    },
    blockers,
    warnings
  };
}

function printText(plan) {
  console.log('Reference Replication 采集计划');
  console.log(`case: ${plan.caseId}`);
  console.log(`reference: ${plan.referenceImage.relativePath} (${plan.referenceImage.exists ? 'exists' : 'missing'})`);
  console.log(`planned result: ${plan.plannedResult.benchmarkRelativePath}`);
  console.log(`quality claim after recording: ${plan.liveRunBoundary.canClaimDesignQualityAfterRecording}`);
  if (plan.blockers.length > 0) {
    console.log('blockers:');
    for (const item of plan.blockers) console.log(`- ${item}`);
  }
  if (plan.warnings.length > 0) {
    console.log('warnings:');
    for (const item of plan.warnings) console.log(`- ${item}`);
  }
  console.log('record command:');
  console.log(plan.commands.recordResultAfterScreenshot);
}

function main() {
  const json = process.argv.includes('--json');
  const plan = buildPlan();
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printText(plan);
  }
  if (!plan.success) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
