#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_CASE_ID = 'rr-002-neutral-quality-card-text-layout';
const DEFAULT_BENCHMARK_DIR = path.join('benchmarks', 'reference-replication');
const DEFAULT_LIVE_REPORT = path.join('tmp', 'acceptance', 'agent-live-photoshop-acceptance.json');

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

function fail(step, message) {
  throw new Error(`[reference-live-result-evidence:${step}] ${message}`);
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveInputPath(raw, baseDir = process.cwd()) {
  if (!raw) return '';
  return path.isAbsolute(String(raw)) ? path.resolve(String(raw)) : path.resolve(baseDir, String(raw));
}

function readJson(filePath, step) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(step, `${filePath}: ${error?.message || String(error)}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function runNodeScript(scriptPath, args, step) {
  try {
    return execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const details = [error.stdout || '', error.stderr || '', error.message || String(error)]
      .join('\n')
      .trim();
    fail(step, details || `command failed: ${scriptPath}`);
  }
}

function isSensitiveLiveReportKey(key) {
  return /(?:base64|dataurl|data_url|raw|payload|bytes|buffer|blob|imageData|canvasSnapshot|screenshotBase64)/i.test(key);
}

function sanitizeLiveValue(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return '[redacted-data-url]';
    if (value.length > 500) return `${value.slice(0, 500)}...`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLiveValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveLiveReportKey(key)) continue;
      result[key] = sanitizeLiveValue(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

function summarizeCase(item) {
  const summary = {};
  for (const key of [
    'id',
    'name',
    'success',
    'skipped',
    'mode',
    'status',
    'error',
    'resultScreenshot',
    'capturedResultScreenshot',
    'report',
    'assertions',
    'liveAssertions'
  ]) {
    if (Object.prototype.hasOwnProperty.call(item || {}, key) && !isSensitiveLiveReportKey(key)) {
      summary[key] = sanitizeLiveValue(item[key]);
    }
  }
  return summary;
}

function summarizeLiveReport(liveReport, liveReportPath) {
  const cases = Array.isArray(liveReport?.cases) ? liveReport.cases : [];
  return {
    path: toPosixPath(liveReportPath),
    success: Boolean(liveReport?.success),
    skipped: Boolean(liveReport?.skipped),
    mode: String(liveReport?.mode || ''),
    report: sanitizeLiveValue(liveReport?.report || liveReport?.reportPath || ''),
    resultScreenshot: sanitizeLiveValue(liveReport?.resultScreenshot || ''),
    capturedResultScreenshot: sanitizeLiveValue(liveReport?.capturedResultScreenshot || null),
    cases: cases.map(summarizeCase),
    liveAssertions: sanitizeLiveValue(liveReport?.liveAssertions || liveReport?.assertions || {})
  };
}

function resolveResultScreenshot(options, liveReport) {
  const explicit = String(options['result-screenshot'] || '').trim();
  const fromLiveReport = String(liveReport?.resultScreenshot || '').trim();
  const fromCapturedResultScreenshot = String(
    liveReport?.capturedResultScreenshot?.absolutePath
    || liveReport?.capturedResultScreenshot?.path
    || ''
  ).trim();
  const matchingCase = Array.isArray(liveReport?.cases)
    ? liveReport.cases.find((item) => String(item?.id || '') === String(options.id || DEFAULT_CASE_ID)) || {}
    : {};
  const fromMatchingCase = String(matchingCase?.resultScreenshot || '').trim();
  const fromMatchingCaseCaptured = String(
    matchingCase?.capturedResultScreenshot?.absolutePath
    || matchingCase?.capturedResultScreenshot?.path
    || ''
  ).trim();
  const raw = explicit
    || fromLiveReport
    || fromCapturedResultScreenshot
    || fromMatchingCase
    || fromMatchingCaseCaptured;
  if (!raw) {
    fail(
      'result screenshot missing',
      'result screenshot missing: pass --result-screenshot or include resultScreenshot/capturedResultScreenshot in the live report'
    );
  }
  const resolved = resolveInputPath(raw, process.cwd());
  if (!fs.existsSync(resolved)) {
    fail('result screenshot missing', `result screenshot missing: ${resolved}`);
  }
  return resolved;
}

function parseJsonOutput(output, step) {
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(step, `failed to parse JSON output: ${error?.message || String(error)}\n${output}`);
  }
}

function renderMarkdown(summary) {
  return [
    '# Reference Live Result Evidence Adapter',
    '',
    `- success: ${summary.success}`,
    `- caseId: ${summary.caseId}`,
    `- liveReportSuccess: ${summary.liveReportSummary.success}`,
    `- validationOk: ${summary.validation.ok}`,
    `- manualReviewRequired: ${summary.manualReviewRequired}`,
    '',
    '## Reference Evidence',
    '',
    `- json: ${summary.referenceEvidence.json}`,
    `- md: ${summary.referenceEvidence.md}`,
    `- pixelProbeStatus: ${summary.referenceEvidence.pixelProbeStatus}`,
    '',
    '## Boundaries',
    '',
    ...summary.boundaries.map((item) => `- ${item}`),
    '',
    '## Record Command After Manual Review',
    '',
    '```bash',
    summary.commands.recordResultAfterManualReview,
    '```',
    ''
  ].join('\n');
}

async function buildAdapterSummary() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const caseId = String(options.id || DEFAULT_CASE_ID).trim();
  const benchmarkDir = resolveInputPath(options['benchmark-dir'] || DEFAULT_BENCHMARK_DIR, repoRoot);
  const liveReportPath = resolveInputPath(options['live-report'] || DEFAULT_LIVE_REPORT, repoRoot);
  if (!fs.existsSync(liveReportPath)) {
    fail('live report missing', `live report missing: ${liveReportPath}`);
  }

  const liveReport = readJson(liveReportPath, 'live report missing');
  const resultScreenshotPath = resolveResultScreenshot({ ...options, id: caseId }, liveReport);
  const liveReportSummary = summarizeLiveReport(liveReport, liveReportPath);
  const outputJson = options['output-json']
    ? resolveInputPath(options['output-json'], process.cwd())
    : path.join(repoRoot, 'tmp', `${caseId}-live-result-evidence-adapter.json`);
  const outputMd = options['output-md']
    ? resolveInputPath(options['output-md'], process.cwd())
    : path.join(repoRoot, 'tmp', `${caseId}-live-result-evidence-adapter.md`);
  const evidenceJson = path.join(repoRoot, 'tmp', `${caseId}-reference-live-result-evidence.json`);
  const evidenceMd = path.join(repoRoot, 'tmp', `${caseId}-reference-live-result-evidence.md`);
  const reviewer = String(options.reviewer || '').trim();

  const evaluateArgs = [
    '--benchmark-dir', benchmarkDir,
    '--id', caseId,
    '--result-screenshot', resultScreenshotPath,
    '--output-json', evidenceJson,
    '--output-md', evidenceMd
  ];
  if (reviewer) evaluateArgs.push('--reviewer', reviewer);

  const evaluateOutput = runNodeScript(
    path.join(repoRoot, 'scripts', 'evaluate-reference-replication-result.cjs'),
    evaluateArgs,
    'evaluate failed'
  );
  const evaluateSummary = parseJsonOutput(evaluateOutput, 'evaluate failed');

  const validationOutput = runNodeScript(
    path.join(repoRoot, 'scripts', 'validate-reference-result-evidence.cjs'),
    ['--benchmark-dir', benchmarkDir, '--evidence-json', evidenceJson],
    'validation failed'
  );
  const validation = parseJsonOutput(validationOutput, 'validation failed');
  if (!validation.ok) {
    fail('validation failed', JSON.stringify(validation, null, 2));
  }

  const evidenceReport = readJson(evidenceJson, 'evaluate failed');
  const summary = {
    success: true,
    generatedAt: new Date().toISOString(),
    caseId,
    liveReportSummary,
    referenceEvidence: {
      json: toPosixPath(evidenceJson),
      md: toPosixPath(evidenceMd),
      pixelProbeStatus: evidenceReport?.pixelProbe?.status || evaluateSummary.pixelProbeStatus || '',
      manualReviewRequired: Boolean(evidenceReport?.manualReviewRequired),
      qualityClaimCandidateAfterManualReview: Boolean(evidenceReport?.qualityClaimCandidateAfterManualReview)
    },
    validation,
    manualReviewRequired: true,
    commands: {
      recordResultAfterManualReview: evidenceReport?.commands?.recordResultAfterManualReview || evaluateSummary.recordCommand || ''
    },
    boundaries: [
      'Live report success is not reference quality acceptance and must not be treated as a design-quality claim.',
      'Pixel probe is diagnostic evidence only; it is not high-fidelity or aesthetic acceptance.',
      'Manual review is still required before recording scores or manualVerified.',
      'This adapter is read-only for benchmark case JSON and only emits a record-result command.',
      'Raw image data, base64 strings, data URLs, and live raw payloads are excluded from the live report summary.'
    ]
  };

  writeJson(outputJson, summary);
  writeText(outputMd, renderMarkdown(summary));
  return {
    ...summary,
    outputs: {
      json: toPosixPath(outputJson),
      md: toPosixPath(outputMd)
    }
  };
}

buildAdapterSummary()
  .then((summary) => {
    console.log(JSON.stringify({
      success: summary.success,
      caseId: summary.caseId,
      validationOk: summary.validation.ok,
      manualReviewRequired: summary.manualReviewRequired,
      referenceEvidence: summary.referenceEvidence,
      outputs: summary.outputs
    }, null, 2));
  })
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
