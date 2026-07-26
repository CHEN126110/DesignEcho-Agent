#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const SCORE_ARGS = {
  structure: 'score-structure',
  placement: 'score-placement',
  textHierarchy: 'score-text-hierarchy',
  editability: 'score-editability',
  overall: 'score-overall'
};

function usage() {
  return [
    'Usage:',
    '  node scripts/record-reference-replication-result.cjs --id <case-id> --result-screenshot <path> [options]',
    '',
    'Options:',
    '  --benchmark-dir <path>          Benchmark root (default: benchmarks/reference-replication)',
    '  --id <case-id>                  Existing case id to update',
    '  --result-screenshot <path>      Result screenshot path to record',
    '  --copy-result-screenshot        Copy screenshot into benchmark results/ and store a relative path',
    '  --result-screenshot-name <name> File name to use when copying the result screenshot',
    '  --document-name <text>          Output PSD/document name',
    '  --notes <text>                  Output notes',
    '  --status <text>                 Optional status for case and manifest item',
    '  --build-verified                Mark build verification as true',
    '  --manual-verified               Mark manual verification as true; requires complete 0..1 scores',
    '  --reviewed-at <iso-string>      Manual review timestamp; defaults to now when --manual-verified is used',
    '  --reviewer <text>               Manual reviewer name',
    '  --score-structure <0..1>',
    '  --score-placement <0..1>',
    '  --score-text-hierarchy <0..1>',
    '  --score-editability <0..1>',
    '  --score-overall <0..1>',
    '  --dry-run                       Print planned case JSON without writing',
    '  --overwrite                     Allow overwriting copied result screenshot',
    '  --help                          Show this message'
  ].join('\n');
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

function parseBooleanOption(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') return true;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(value);
}

function fail(message) {
  throw new Error(`[reference-replication:record-result] ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

function resolveInputPath(value, baseDir = cwd) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function assertInsideDirectory(rootDir, targetPath, label) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} escapes target directory`);
  }
}

function resolveBenchmarkRelativePath(benchmarkDir, relativePath, label) {
  const rawPath = String(relativePath || '').trim();
  if (!rawPath) return '';
  if (path.isAbsolute(rawPath)) {
    fail(`${label} must be benchmark-relative unless --copy-result-screenshot is used`);
  }
  const resolved = path.resolve(benchmarkDir, rawPath);
  assertInsideDirectory(benchmarkDir, resolved, label);
  return resolved;
}

function makeResultScreenshotName(caseId, sourcePath, requestedName) {
  if (requestedName !== undefined && String(requestedName).trim()) {
    const name = path.basename(String(requestedName).trim());
    if (name !== String(requestedName).trim()) {
      fail('--result-screenshot-name must be a file name, not a path');
    }
    return name;
  }
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ext) {
    fail('result screenshot must have a file extension when --copy-result-screenshot is used');
  }
  return `${caseId}-result${ext}`;
}

function parseScore(value, label) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail(`${label} must be a number from 0 to 1`);
  }
  return parsed;
}

function collectScores(options) {
  const scores = {};
  for (const [key, argName] of Object.entries(SCORE_ARGS)) {
    const parsed = parseScore(options[argName], `--${argName}`);
    if (parsed !== undefined) {
      scores[key] = parsed;
    }
  }
  return scores;
}

function hasCompleteScores(score) {
  return Object.keys(SCORE_ARGS).every((key) => {
    const value = score?.[key];
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  });
}

function planResultScreenshot(options, benchmarkDir, caseId) {
  const rawScreenshot = String(options['result-screenshot'] || '').trim();
  const copyResult = parseBooleanOption(options['copy-result-screenshot'], false);
  if (!rawScreenshot) return null;

  if (!copyResult) {
    const resolved = resolveBenchmarkRelativePath(benchmarkDir, rawScreenshot, 'outputs.resultScreenshot');
    if (!fs.existsSync(resolved)) {
      fail(`result screenshot does not exist inside benchmark directory: ${rawScreenshot}`);
    }
    return {
      copy: false,
      sourcePath: resolved,
      destinationPath: '',
      resultScreenshotPath: toPosixPath(rawScreenshot)
    };
  }

  const sourcePath = resolveInputPath(rawScreenshot);
  if (!fs.existsSync(sourcePath)) {
    fail(`result screenshot not found: ${sourcePath}`);
  }
  if (!fs.statSync(sourcePath).isFile()) {
    fail(`result screenshot is not a file: ${sourcePath}`);
  }
  const resultsDir = path.join(benchmarkDir, 'results');
  const resultName = makeResultScreenshotName(caseId, sourcePath, options['result-screenshot-name']);
  const destinationPath = path.resolve(resultsDir, resultName);
  assertInsideDirectory(resultsDir, destinationPath, 'result screenshot destination');
  if (fs.existsSync(destinationPath) && !parseBooleanOption(options.overwrite, false)) {
    fail(`result screenshot already exists: ${destinationPath}`);
  }
  return {
    copy: true,
    sourcePath,
    destinationPath,
    resultScreenshotPath: toPosixPath(path.relative(benchmarkDir, destinationPath))
  };
}

function findManifestCase(manifest, id) {
  if (!Array.isArray(manifest.cases)) {
    fail('manifest.cases must be an array');
  }
  return manifest.cases.find((item) => String(item?.id || '').trim() === id);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const caseId = String(options.id || '').trim();
  if (!caseId) fail('--id is required');

  const benchmarkDir = resolveInputPath(options['benchmark-dir'], cwd)
    || path.join(cwd, 'benchmarks', 'reference-replication');
  const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`missing manifest: ${manifestPath}`);
  const manifest = readJson(manifestPath);
  const manifestItem = findManifestCase(manifest, caseId);
  if (!manifestItem) fail(`case not found in manifest: ${caseId}`);

  const caseRelativePath = String(manifestItem.file || `cases/${caseId}.json`).trim();
  const casePath = path.resolve(benchmarkDir, caseRelativePath);
  assertInsideDirectory(benchmarkDir, casePath, 'case file');
  if (!fs.existsSync(casePath)) fail(`case file missing: ${caseRelativePath}`);

  const caseJson = readJson(casePath);
  if (String(caseJson.id || '').trim() !== caseId) {
    fail(`case id mismatch: expected ${caseId}, got ${caseJson.id}`);
  }

  const screenshotPlan = planResultScreenshot(options, benchmarkDir, caseId);
  const scorePatch = collectScores(options);
  const manualVerified = parseBooleanOption(options['manual-verified'], false);
  const buildVerified = parseBooleanOption(options['build-verified'], false);
  const dryRun = parseBooleanOption(options['dry-run'], false);

  const nextCase = JSON.parse(JSON.stringify(caseJson));
  if (options.status !== undefined) {
    nextCase.status = String(options.status).trim();
    manifestItem.status = nextCase.status;
  }
  if (options['document-name'] !== undefined) {
    nextCase.outputs = nextCase.outputs || {};
    nextCase.outputs.documentName = String(options['document-name']).trim();
  }
  if (options.notes !== undefined) {
    nextCase.outputs = nextCase.outputs || {};
    nextCase.outputs.notes = String(options.notes).trim();
  }
  if (screenshotPlan) {
    nextCase.outputs = nextCase.outputs || {};
    nextCase.outputs.resultScreenshot = screenshotPlan.resultScreenshotPath;
  }

  nextCase.score = nextCase.score || {};
  for (const [key, value] of Object.entries(scorePatch)) {
    nextCase.score[key] = value;
  }

  nextCase.verification = nextCase.verification || {};
  if (buildVerified) {
    nextCase.verification.buildVerified = true;
  }
  if (manualVerified) {
    if (!hasCompleteScores(nextCase.score)) {
      fail('--manual-verified requires all five scores: structure, placement, text-hierarchy, editability, overall');
    }
    if (!String(nextCase.outputs?.resultScreenshot || '').trim()) {
      fail('--manual-verified requires a result screenshot');
    }
    nextCase.verification.manualVerified = true;
    nextCase.verification.reviewedAt = String(options['reviewed-at'] || '').trim() || new Date().toISOString();
  }
  if (options.reviewer !== undefined) {
    nextCase.verification.reviewer = String(options.reviewer).trim();
  }

  const planned = {
    caseId,
    caseFile: toPosixPath(path.relative(benchmarkDir, casePath)),
    copyResultScreenshot: Boolean(screenshotPlan?.copy),
    resultScreenshotPath: nextCase.outputs?.resultScreenshot || '',
    buildVerified: Boolean(nextCase.verification?.buildVerified),
    manualVerified: Boolean(nextCase.verification?.manualVerified),
    scoresComplete: hasCompleteScores(nextCase.score),
    dryRun,
    caseJson: nextCase
  };

  if (dryRun) {
    console.log(JSON.stringify(planned, null, 2));
    return;
  }

  if (screenshotPlan?.copy) {
    fs.mkdirSync(path.dirname(screenshotPlan.destinationPath), { recursive: true });
    fs.copyFileSync(screenshotPlan.sourcePath, screenshotPlan.destinationPath);
  }
  writeJson(casePath, nextCase);
  if (options.status !== undefined) {
    writeJson(manifestPath, manifest);
  }

  console.log(JSON.stringify(planned, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
