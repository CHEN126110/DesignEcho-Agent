#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const AGENT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CASE_ID = 'rr-002-neutral-quality-card-text-layout';
const DEFAULT_BENCHMARK_DIR = path.join(AGENT_ROOT, 'benchmarks', 'reference-replication');
const DEFAULT_LIVE_REPORT = path.join(AGENT_ROOT, 'tmp', 'chat-ui-reference-replication-live-smoke.json');
const DEFAULT_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_REFERENCE_LIVE_PIPELINE_TIMEOUT_MS,
  300_000
);
const OUTPUT_TAIL_LIMIT = 8_000;
const FLAGS = {
  liveUi: 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI',
  realPhotoshop: 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP',
  takeover: 'DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER'
};
const SCORE_ARGS = {
  structure: 'score-structure',
  placement: 'score-placement',
  textHierarchy: 'score-text-hierarchy',
  editability: 'score-editability',
  overall: 'score-overall'
};

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
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

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') return true;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(value);
}

function parseScore(value, label) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be a number from 0 to 1.`);
  }
  return parsed;
}

function collectScores(options) {
  const scores = {};
  for (const [key, argName] of Object.entries(SCORE_ARGS)) {
    const parsed = parseScore(options[argName], `--${argName}`);
    if (parsed !== undefined) scores[key] = parsed;
  }
  return scores;
}

function hasCompleteScores(scores) {
  return Object.keys(SCORE_ARGS).every((key) => Number.isFinite(Number(scores[key])));
}

function resolveInputPath(raw, baseDir = AGENT_ROOT) {
  if (!raw) return '';
  return path.isAbsolute(String(raw)) ? path.resolve(String(raw)) : path.resolve(baseDir, String(raw));
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function tail(value, maxLength = OUTPUT_TAIL_LIMIT) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function makeNodeTask(script, args = []) {
  return {
    command: process.execPath,
    args: [path.join('scripts', script), ...args],
    shell: false
  };
}

function runTask(stepId, task, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const env = options.env || process.env;

  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, {
      cwd: AGENT_ROOT,
      env,
      windowsHide: true,
      shell: task.shell === true
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (options.verbose) process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (options.verbose) process.stderr.write(text);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        id: stepId,
        success: false,
        command: [task.command, ...task.args].join(' '),
        durationMs: Date.now() - startedAt,
        timedOut,
        exitCode: null,
        stdout: tail(stdout),
        stderr: tail(stderr),
        error: error.message
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        id: stepId,
        success: code === 0 && !timedOut,
        command: [task.command, ...task.args].join(' '),
        durationMs: Date.now() - startedAt,
        timedOut,
        exitCode: code,
        stdout: tail(stdout),
        stderr: tail(stderr),
        error: timedOut ? `Task timed out after ${timeoutMs}ms.` : null
      });
    });
  });
}

function parseJsonOutput(output, stepId) {
  try {
    return JSON.parse(String(output || '').trim());
  } catch (error) {
    throw new Error(`[${stepId}] failed to parse JSON output: ${error.message}`);
  }
}

function defaultResultScreenshot(caseId, benchmarkDir) {
  return path.join(benchmarkDir, 'results', `${caseId}-result.png`);
}

function buildCaptureEnv() {
  return {
    ...process.env,
    [FLAGS.liveUi]: '1',
    [FLAGS.realPhotoshop]: '1',
    [FLAGS.takeover]: '1'
  };
}

function buildConfig(options) {
  const caseId = String(options.id || DEFAULT_CASE_ID).trim();
  if (!caseId) throw new Error('--id cannot be empty.');
  const benchmarkDir = resolveInputPath(options['benchmark-dir'] || DEFAULT_BENCHMARK_DIR, AGENT_ROOT);
  const resultScreenshot = resolveInputPath(
    options['result-screenshot'] || defaultResultScreenshot(caseId, benchmarkDir),
    AGENT_ROOT
  );
  const liveReport = resolveInputPath(options['live-report'] || DEFAULT_LIVE_REPORT, AGENT_ROOT);
  const outputJson = resolveInputPath(
    options['output-json'] || path.join(AGENT_ROOT, 'tmp', `${caseId}-reference-live-evidence-pipeline.json`),
    AGENT_ROOT
  );
  const outputMd = resolveInputPath(
    options['output-md'] || path.join(AGENT_ROOT, 'tmp', `${caseId}-reference-live-evidence-pipeline.md`),
    AGENT_ROOT
  );
  const evidenceJson = path.join(AGENT_ROOT, 'tmp', `${caseId}-reference-live-result-evidence.json`);
  const adapterJson = path.join(AGENT_ROOT, 'tmp', `${caseId}-live-result-evidence-adapter.json`);
  const scores = collectScores(options);

  return {
    caseId,
    benchmarkDir,
    resultScreenshot,
    liveReport,
    outputJson,
    outputMd,
    evidenceJson,
    adapterJson,
    reviewer: String(options.reviewer || '').trim(),
    notes: String(options.notes || '').trim(),
    documentName: String(options['document-name'] || '').trim(),
    status: String(options.status || '').trim(),
    scores,
    live: parseBoolean(options.live, false),
    realPhotoshop: parseBoolean(options['real-photoshop'], false),
    takeover: parseBoolean(options.takeover, false),
    overwrite: parseBoolean(options.overwrite, false),
    preflightOnly: parseBoolean(options['preflight-only'], false),
    skipCapture: parseBoolean(options['skip-capture'], false),
    record: parseBoolean(options.record, false),
    recordDryRun: parseBoolean(options['record-dry-run'], false),
    verbose: parseBoolean(options.verbose, false)
  };
}

function assertRecordAllowed(config) {
  if (!config.record && !config.recordDryRun) return;
  if (!config.reviewer) {
    throw new Error('--record/--record-dry-run requires --reviewer.');
  }
  if (!hasCompleteScores(config.scores)) {
    throw new Error(
      '--record/--record-dry-run requires all five scores: --score-structure, --score-placement, --score-text-hierarchy, --score-editability, --score-overall.'
    );
  }
}

function buildRecordArgs(config, dryRun) {
  const args = [
    '--id', config.caseId,
    '--benchmark-dir', config.benchmarkDir,
    '--result-screenshot', config.resultScreenshot,
    '--copy-result-screenshot',
    '--build-verified',
    '--manual-verified',
    '--reviewer', config.reviewer,
    '--score-structure', String(config.scores.structure),
    '--score-placement', String(config.scores.placement),
    '--score-text-hierarchy', String(config.scores.textHierarchy),
    '--score-editability', String(config.scores.editability),
    '--score-overall', String(config.scores.overall)
  ];
  if (config.overwrite) args.push('--overwrite');
  if (dryRun) args.push('--dry-run');
  if (config.notes) args.push('--notes', config.notes);
  if (config.documentName) args.push('--document-name', config.documentName);
  if (config.status) args.push('--status', config.status);
  return args;
}

async function runRequiredStep(report, stepId, task, options = {}) {
  console.log(`[reference-live-pipeline:start] ${stepId}`);
  const result = await runTask(stepId, task, {
    env: options.env,
    timeoutMs: options.timeoutMs,
    verbose: options.verbose
  });
  report.steps.push(result);
  console.log(`[reference-live-pipeline:${result.success ? 'pass' : 'fail'}] ${stepId} ${result.durationMs}ms`);
  if (!result.success) {
    throw new Error(`[${stepId}] command failed\n${result.stderr || result.stdout || result.error || ''}`);
  }
  return result;
}

function renderMarkdown(report) {
  return [
    '# Reference Live Evidence Pipeline',
    '',
    `- success: ${report.success}`,
    `- skipped: ${Boolean(report.skipped)}`,
    `- caseId: ${report.caseId}`,
    `- mode: ${report.mode}`,
    report.error ? `- error: ${report.error}` : '',
    '',
    '## Outputs',
    '',
    `- liveReport: ${report.paths.liveReport}`,
    `- resultScreenshot: ${report.paths.resultScreenshot}`,
    `- adapterJson: ${report.paths.adapterJson}`,
    `- evidenceJson: ${report.paths.evidenceJson}`,
    '',
    '## Steps',
    '',
    ...report.steps.map((step) => `- ${step.id}: ${step.success ? 'pass' : 'fail'} (${step.durationMs}ms)`),
    '',
    '## Boundaries',
    '',
    ...report.boundaries.map((item) => `- ${item}`),
    ''
  ].filter(Boolean).join('\n');
}

function finish(report, exitCode = 0) {
  writeJson(report.paths.outputJsonAbsolute, report);
  writeText(report.paths.outputMdAbsolute, renderMarkdown(report));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = exitCode;
}

function makeInitialReport(config) {
  return {
    success: false,
    skipped: false,
    generatedAt: new Date().toISOString(),
    caseId: config.caseId,
    mode: config.skipCapture ? 'existing-live-report' : 'guarded-live-capture',
    liveRequested: config.live,
    realPhotoshopRequested: config.realPhotoshop,
    takeoverRequested: config.takeover,
    recordRequested: config.record,
    recordDryRunRequested: config.recordDryRun,
    paths: {
      benchmarkDir: toPosixPath(config.benchmarkDir),
      liveReport: toPosixPath(config.liveReport),
      resultScreenshot: toPosixPath(config.resultScreenshot),
      adapterJson: toPosixPath(config.adapterJson),
      evidenceJson: toPosixPath(config.evidenceJson),
      outputJson: toPosixPath(config.outputJson),
      outputMd: toPosixPath(config.outputMd),
      outputJsonAbsolute: config.outputJson,
      outputMdAbsolute: config.outputMd
    },
    steps: [],
    readiness: null,
    adapter: null,
    validation: null,
    recordDryRun: null,
    recordResult: null,
    boundaries: [
      'Default mode does not call a model, touch Photoshop, or write benchmark case JSON.',
      'Real capture requires --live --real-photoshop --takeover and the underlying capture guard must pass.',
      'Adapter and validation are read-only for benchmark cases.',
      'Recording benchmark results requires explicit --record, --reviewer, and all manual scores.',
      'Manual scores remain human review evidence; this pipeline does not turn live execution into an automatic quality claim.'
    ]
  };
}

async function runReadiness(config, report, env) {
  const args = [
    '--id', config.caseId,
    '--benchmark-dir', config.benchmarkDir,
    '--result-screenshot', config.resultScreenshot,
    '--json'
  ];
  if (config.overwrite) args.push('--overwrite');
  const result = await runRequiredStep(
    report,
    'preflight:reference-live-readiness',
    makeNodeTask('report-reference-live-capture-readiness.cjs', args),
    { env, verbose: config.verbose, timeoutMs: 30_000 }
  );
  report.readiness = parseJsonOutput(result.stdout, 'preflight:reference-live-readiness');
  return report.readiness;
}

async function runAdapterAndValidate(config, report) {
  const adapterArgs = [
    '--id', config.caseId,
    '--benchmark-dir', config.benchmarkDir,
    '--live-report', config.liveReport,
    '--result-screenshot', config.resultScreenshot
  ];
  if (config.reviewer) adapterArgs.push('--reviewer', config.reviewer);

  const adapterResult = await runRequiredStep(
    report,
    'evidence:adapt-live-result',
    makeNodeTask('adapt-reference-live-result-evidence.cjs', adapterArgs),
    { verbose: config.verbose }
  );
  report.adapter = parseJsonOutput(adapterResult.stdout, 'evidence:adapt-live-result');

  const validationResult = await runRequiredStep(
    report,
    'evidence:validate',
    makeNodeTask('validate-reference-result-evidence.cjs', [
      '--benchmark-dir', config.benchmarkDir,
      '--evidence-json', config.evidenceJson
    ]),
    { verbose: config.verbose, timeoutMs: 60_000 }
  );
  report.validation = parseJsonOutput(validationResult.stdout, 'evidence:validate');
  if (!report.validation.ok) {
    throw new Error(`[evidence:validate] validation returned ok=false: ${JSON.stringify(report.validation, null, 2)}`);
  }
}

async function runRecord(config, report) {
  if (!config.record && !config.recordDryRun) return;
  const dryRunResult = await runRequiredStep(
    report,
    'record:dry-run',
    makeNodeTask('record-reference-replication-result.cjs', buildRecordArgs(config, true)),
    { verbose: config.verbose, timeoutMs: 60_000 }
  );
  report.recordDryRun = parseJsonOutput(dryRunResult.stdout, 'record:dry-run');

  if (!config.record) return;
  const recordResult = await runRequiredStep(
    report,
    'record:write-case',
    makeNodeTask('record-reference-replication-result.cjs', buildRecordArgs(config, false)),
    { verbose: config.verbose, timeoutMs: 60_000 }
  );
  report.recordResult = parseJsonOutput(recordResult.stdout, 'record:write-case');
}

function runSelfTest() {
  const defaultConfig = buildConfig({});
  if (defaultConfig.live || defaultConfig.realPhotoshop || defaultConfig.takeover) {
    throw new Error('default config must not request live model or Photoshop.');
  }
  const liveConfig = buildConfig({ live: true, 'real-photoshop': true, takeover: true });
  const liveEnv = buildCaptureEnv(liveConfig);
  for (const flag of Object.values(FLAGS)) {
    if (liveEnv[flag] !== '1') throw new Error(`${flag} must be set for live capture env.`);
  }
  const skipConfig = buildConfig({ 'skip-capture': true, 'live-report': 'tmp/live.json', 'result-screenshot': 'tmp/result.png' });
  if (!skipConfig.skipCapture || skipConfig.live) throw new Error('skip-capture must not imply live capture.');
  let recordRejected = false;
  try {
    assertRecordAllowed(buildConfig({ record: true, reviewer: 'tester' }));
  } catch {
    recordRejected = true;
  }
  if (!recordRejected) throw new Error('record must require complete manual scores.');
  assertRecordAllowed(buildConfig({
    'record-dry-run': true,
    reviewer: 'tester',
    'score-structure': '0.8',
    'score-placement': '0.8',
    'score-text-hierarchy': '0.8',
    'score-editability': '0.8',
    'score-overall': '0.8'
  }));
  console.log(JSON.stringify({
    success: true,
    checks: [
      'default pipeline is guarded and does not touch live systems',
      'live capture env requires all three explicit opt-ins',
      'skip-capture can consume existing live artifacts without live opt-in',
      'record paths require reviewer and complete manual scores'
    ]
  }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options['self-test']) {
    runSelfTest();
    return;
  }

  const config = buildConfig(options);
  assertRecordAllowed(config);
  const report = makeInitialReport(config);

  try {
    if (config.skipCapture) {
      if (!fs.existsSync(config.liveReport)) {
        throw new Error(`--skip-capture requires existing --live-report: ${config.liveReport}`);
      }
      if (!fs.existsSync(config.resultScreenshot)) {
        throw new Error(`--skip-capture requires existing --result-screenshot: ${config.resultScreenshot}`);
      }
      await runAdapterAndValidate(config, report);
      await runRecord(config, report);
      report.success = true;
      finish(report, 0);
      return;
    }

    const captureEnv = config.live && config.realPhotoshop && config.takeover
      ? buildCaptureEnv(config)
      : process.env;
    const readiness = await runReadiness(config, report, captureEnv);
    if (config.preflightOnly) {
      report.success = true;
      report.skipped = true;
      report.mode = 'preflight-only';
      finish(report, 0);
      return;
    }

    if (!config.live) {
      report.success = true;
      report.skipped = true;
      report.mode = 'guarded-default';
      report.reason = '--live is required before calling the real model or Photoshop.';
      finish(report, 0);
      return;
    }
    if (!config.realPhotoshop || !config.takeover) {
      throw new Error('--live execution requires both --real-photoshop and --takeover.');
    }
    if (readiness.readyForLiveCapture !== true) {
      throw new Error(`live capture preflight blocked execution: ${(readiness.blockers || []).join('; ')}`);
    }

    await runRequiredStep(
      report,
      'capture:live-reference-replication',
      makeNodeTask('smoke-chat-ui-reference-replication-live.cjs', [
        '--id', config.caseId,
        '--capture-result',
        '--result-screenshot', config.resultScreenshot,
        ...(config.overwrite ? ['--overwrite'] : [])
      ]),
      { env: captureEnv, verbose: config.verbose, timeoutMs: DEFAULT_TIMEOUT_MS }
    );

    if (!fs.existsSync(config.liveReport)) {
      throw new Error(`capture step did not write expected live report: ${config.liveReport}`);
    }
    if (!fs.existsSync(config.resultScreenshot)) {
      throw new Error(`capture step did not write expected result screenshot: ${config.resultScreenshot}`);
    }

    await runAdapterAndValidate(config, report);
    await runRecord(config, report);
    report.success = true;
    finish(report, 0);
  } catch (error) {
    report.success = false;
    report.error = error?.stack || error?.message || String(error);
    finish(report, 1);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
