#!/usr/bin/env node
/* eslint-disable no-console */

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const AGENT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(AGENT_ROOT, '..');
const UXP_ROOT = path.join(WORKSPACE_ROOT, 'DesignEcho-UXP');

const DEFAULT_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_EXECUTION_FAST_LANE_TIMEOUT_MS,
  120_000
);
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(4, os.cpus().length || 2));
const OUTPUT_TAIL_LIMIT = 4_000;

const npmBin = 'npm';

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function hasArg(name) {
  return process.argv.includes(name);
}

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function nodeTask(id, cwd, args, options = {}) {
  return {
    id,
    cwd,
    command: process.execPath,
    args,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    writesPhotoshop: false,
    touchesLivePhotoshop: false,
    reportOnly: false,
    env: options.env || null,
    reason: options.reason || ''
  };
}

function npmTask(id, cwd, script, options = {}) {
  return {
    id,
    cwd,
    command: npmBin,
    args: ['run', script],
    shell: process.platform === 'win32',
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    writesPhotoshop: options.writesPhotoshop === true,
    touchesLivePhotoshop: options.touchesLivePhotoshop === true,
    reportOnly: options.reportOnly === true,
    runAfterLivePreflight: options.runAfterLivePreflight === true,
    env: options.env || null,
    reason: options.reason || ''
  };
}

function buildTasks(options = {}) {
  const includeLivePreflight = options.includeLivePreflight === true || options.includeLiveWrite === true;
  const tasks = [
    nodeTask(
      'agent:syntax:reference-live-evidence-adapter',
      AGENT_ROOT,
      ['--check', path.join('scripts', 'adapt-reference-live-result-evidence.cjs')],
      { reason: 'keeps live result evidence conversion executable' }
    ),
    npmTask(
      'agent:smoke:reference-live-evidence-adapter',
      AGENT_ROOT,
      'smoke:reference:live-result-evidence-adapter',
      { reason: 'checks the fastest bridge from live capture output to evidence input' }
    ),
    npmTask(
      'agent:smoke:execution-lifecycle',
      AGENT_ROOT,
      'smoke:agent:execution-lifecycle',
      { reason: 'keeps the agent execution chain contract alive' }
    ),
    npmTask(
      'agent:smoke:response-knowledge',
      AGENT_ROOT,
      'smoke:agent:response-knowledge',
      { reason: 'checks conversational response knowledge and preference context without Photoshop writes' }
    ),
    npmTask(
      'agent:smoke:preference-feedback',
      AGENT_ROOT,
      'smoke:agent:preference-feedback',
      { reason: 'checks explicit user preference feedback capture without Photoshop writes' }
    ),
    npmTask(
      'agent:smoke:main-image-live-executor-runner',
      AGENT_ROOT,
      'smoke:main-image:live-executor-runner',
      { reason: 'checks executor runner behavior without real Photoshop writes' }
    ),
    npmTask(
      'agent:smoke:main-image-disposable-product-e2e',
      AGENT_ROOT,
      'smoke:main-image:disposable-product-e2e',
      { reason: 'checks strategy-to-runner main-image product path without live Photoshop writes' }
    ),
    npmTask(
      'agent:smoke:main-image-executor-controlled-product-branch',
      AGENT_ROOT,
      'smoke:main-image:executor-controlled-product-branch',
      { reason: 'checks main-image executor chooses strategy-only by default and gates disposable live writes' }
    ),
    npmTask(
      'agent:smoke:main-image-controlled-product-qa-gate',
      AGENT_ROOT,
      'smoke:main-image:controlled-product-qa-gate',
      { reason: 'checks controlled product runner evidence becomes a redacted QA gate without overclaiming quality' }
    ),
    npmTask(
      'agent:smoke:main-image-controlled-product-qa-bridge',
      AGENT_ROOT,
      'smoke:main-image:controlled-product-qa-bridge',
      { reason: 'checks controlled product runner evidence enters canonical screenshot QA and readiness without overclaiming quality' }
    ),
    npmTask(
      'agent:smoke:main-image-acceptance-record',
      AGENT_ROOT,
      'smoke:main-image:acceptance-record',
      { reason: 'checks final main-image QA evidence becomes replayable acceptance records without overclaiming quality' }
    ),
    npmTask(
      'agent:smoke:photoshop-bridge-health-self-test',
      AGENT_ROOT,
      'smoke:photoshop-bridge-health',
      { reason: 'checks bridge-health diagnosis logic without hitting live Photoshop' }
    ),
    npmTask(
      'uxp:smoke:acceptance-snapshot-editability',
      UXP_ROOT,
      'smoke:acceptance-snapshot-editability',
      { reason: 'keeps UXP acceptance readback useful for editable text/layer checks' }
    )
  ];

  if (options.includeBuild) {
    tasks.push(
      npmTask(
        'agent:build:main',
        AGENT_ROOT,
        'build:main',
        { timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 180_000), reason: 'checks main process TypeScript output' }
      ),
      npmTask(
        'agent:build:typecheck-renderer',
        AGENT_ROOT,
        'build:typecheck:renderer',
        { timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 180_000), reason: 'checks renderer TypeScript output' }
      ),
      npmTask(
        'uxp:build',
        UXP_ROOT,
        'build',
        { timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 180_000), reason: 'checks UXP bundle still builds' }
      )
    );
  }

  if (includeLivePreflight) {
    tasks.push(
      npmTask(
        'agent:live-preflight:business-skill-e2e-readiness',
        AGENT_ROOT,
        'maintenance:business-skills-live-e2e:require-live',
        {
          timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 30_000),
          touchesLivePhotoshop: true,
          reason: 'read-only strict evidence gate for main-image, detail-page and SKU system-level live E2E'
        }
      ),
      npmTask(
        'agent:live-preflight:photoshop-bridge-health',
        AGENT_ROOT,
        'maintenance:photoshop-bridge-health:check',
        {
          timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 30_000),
          touchesLivePhotoshop: true,
          reason: 'read-only check for current Photoshop/UXP bridge availability'
        }
      ),
      npmTask(
        'agent:live-preflight:acceptance-snapshot',
        AGENT_ROOT,
        'smoke:photoshop-acceptance:live',
        {
          timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 45_000),
          touchesLivePhotoshop: true,
          reason: 'read-only MCP Host + getAcceptanceSnapshot acceptance snapshot gate'
        }
      )
    );
  }

  if (options.includeReferenceReplication) {
    tasks.push(
      npmTask(
        'agent:reference:layout-replication-completion',
        AGENT_ROOT,
        'smoke:layout-replication:completion',
        { reason: 'checks layout-replication completion and evidence contracts' }
      ),
      npmTask(
        'agent:reference:visual-qa',
        AGENT_ROOT,
        'smoke:reference:visual-qa',
        { reason: 'checks reference visual QA evidence boundaries' }
      ),
      npmTask(
        'agent:reference:live-evidence-pipeline-contract',
        AGENT_ROOT,
        'smoke:reference:live-evidence-pipeline',
        { reason: 'checks reference live evidence pipeline safety gates without live writes' }
      )
    );
  }

  if (options.includeLiveWrite) {
    tasks.push(
      npmTask(
        'agent:live-write:acceptance-disposable',
        AGENT_ROOT,
        'smoke:photoshop-acceptance:write-live',
        {
          timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 90_000),
          touchesLivePhotoshop: true,
          writesPhotoshop: true,
          runAfterLivePreflight: true,
          env: {
            DESIGNECHO_LIVE_AGENT_ACCEPTANCE: '1',
            DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER: '1',
            DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT: '1'
          },
          reason: 'explicit disposable live Photoshop write/readback gate'
        }
      ),
      npmTask(
        'agent:live-write:main-image-tool-adapter-disposable',
        AGENT_ROOT,
        'smoke:main-image:live-tool-adapter-disposable',
        {
          timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 120_000),
          touchesLivePhotoshop: true,
          writesPhotoshop: true,
          runAfterLivePreflight: true,
          env: {
            DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_ACCEPTANCE: '1',
            DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_DISPOSABLE_DOCUMENT: '1'
          },
          reason: 'explicit disposable main-image live tool adapter gate'
        }
      )
    );
  }

  if (options.includeDesktopAcceptance) {
    tasks.push(
      npmTask(
        'agent:desktop-acceptance',
        AGENT_ROOT,
        'smoke:agent:acceptance:desktop',
        {
          timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 180_000),
          reason: 'Electron desktop user-task to Agent/skill/evidence acceptance chain'
        }
      )
    );
  }

  return tasks;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  const defaultTasks = buildTasks();
  const taskIds = defaultTasks.map((task) => task.id);
  const commandText = defaultTasks
    .map((task) => [task.command, ...task.args].join(' '))
    .join('\n');

  assert(taskIds.includes('agent:smoke:execution-lifecycle'), 'fast lane must keep execution lifecycle smoke.');
  assert(taskIds.includes('agent:smoke:response-knowledge'), 'fast lane must keep response knowledge smoke.');
  assert(taskIds.includes('agent:smoke:preference-feedback'), 'fast lane must keep preference feedback smoke.');
  assert(
    taskIds.includes('agent:smoke:reference-live-evidence-adapter'),
    'fast lane must keep live-result evidence adapter smoke.'
  );
  assert(
    taskIds.includes('uxp:smoke:acceptance-snapshot-editability'),
    'fast lane must keep UXP acceptance snapshot editability smoke.'
  );
  assert(
    taskIds.includes('agent:smoke:main-image-disposable-product-e2e'),
    'fast lane must keep main-image disposable product E2E smoke.'
  );
  assert(
    taskIds.includes('agent:smoke:main-image-executor-controlled-product-branch'),
    'fast lane must keep main-image executor controlled product branch smoke.'
  );
  assert(
    taskIds.includes('agent:smoke:main-image-controlled-product-qa-gate'),
    'fast lane must keep main-image controlled product QA gate smoke.'
  );
  assert(
    taskIds.includes('agent:smoke:main-image-controlled-product-qa-bridge'),
    'fast lane must keep main-image controlled product QA bridge smoke.'
  );
  assert(
    taskIds.includes('agent:smoke:main-image-acceptance-record'),
    'fast lane must keep main-image acceptance record smoke.'
  );
  assert(
    !/maintenance:project-cockpit|maintenance:reference-status|report-project-cockpit|report-reference-replication-status/.test(commandText),
    'default fast lane must not be report-centered.'
  );
  assert(
    defaultTasks.every((task) => task.writesPhotoshop === false && task.touchesLivePhotoshop === false),
    'default fast lane must not touch or write live Photoshop.'
  );

  const buildTasksWithBuild = buildTasks({ includeBuild: true });
  assert(
    buildTasksWithBuild.some((task) => task.id === 'uxp:build'),
    'includeBuild must add UXP build.'
  );

  const liveTasks = buildTasks({ includeLivePreflight: true });
  assert(
    liveTasks.some((task) => task.id === 'agent:live-preflight:business-skill-e2e-readiness' && task.touchesLivePhotoshop),
    'includeLivePreflight must add the read-only three-Skill E2E readiness report.'
  );
  assert(
    liveTasks.some((task) => (
      task.id === 'agent:live-preflight:business-skill-e2e-readiness'
      && task.args.includes('maintenance:business-skills-live-e2e:require-live')
    )),
    'includeLivePreflight must fail closed unless all three Skills have complete live E2E evidence.'
  );
  assert(
    liveTasks.some((task) => task.id === 'agent:live-preflight:photoshop-bridge-health' && task.touchesLivePhotoshop),
    'includeLivePreflight must add read-only bridge health preflight.'
  );
  assert(
    liveTasks.some((task) => task.id === 'agent:live-preflight:acceptance-snapshot' && task.touchesLivePhotoshop),
    'includeLivePreflight must add read-only acceptance snapshot preflight.'
  );

  const liveWriteTasks = buildTasks({ includeLiveWrite: true });
  assert(
    liveWriteTasks.some((task) => task.id === 'agent:live-write:acceptance-disposable' && task.writesPhotoshop),
    'includeLiveWrite must add explicit disposable write/readback gate.'
  );
  const acceptanceLiveWriteTask = liveWriteTasks.find((task) => task.id === 'agent:live-write:acceptance-disposable');
  assert(
    acceptanceLiveWriteTask?.env?.DESIGNECHO_LIVE_AGENT_ACCEPTANCE === '1'
      && acceptanceLiveWriteTask?.env?.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER === '1'
      && acceptanceLiveWriteTask?.env?.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT === '1',
    'generic disposable live write task must receive explicit task-level opt-in env.'
  );
  assert(
    liveWriteTasks.some((task) => task.id === 'agent:live-preflight:photoshop-bridge-health'),
    'includeLiveWrite must automatically include bridge health preflight.'
  );
  const mainImageLiveWriteTask = liveWriteTasks.find((task) => task.id === 'agent:live-write:main-image-tool-adapter-disposable');
  assert(
    mainImageLiveWriteTask && mainImageLiveWriteTask.writesPhotoshop,
    'includeLiveWrite must add main-image disposable live tool adapter gate.'
  );
  assert(
    mainImageLiveWriteTask?.env?.DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_ACCEPTANCE === '1'
      && mainImageLiveWriteTask?.env?.DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_DISPOSABLE_DOCUMENT === '1',
    'main-image disposable live adapter task must receive explicit task-level opt-in env.'
  );
  const liveWriteBatches = buildExecutionBatches(liveWriteTasks);
  assert(
    liveWriteBatches.length > 1,
    'includeLiveWrite must execute disposable writes in a later batch after read-only gates.'
  );
  assert(
    liveWriteBatches.slice(1).some((batch) => batch.some((task) => task.id === 'agent:live-write:acceptance-disposable')),
    'disposable live write gate must run after the read-only preflight batch.'
  );
  assert(
    liveWriteBatches.slice(1).some((batch) => batch.some((task) => task.id === 'agent:live-write:main-image-tool-adapter-disposable')),
    'main-image disposable live adapter gate must run after the read-only preflight batch.'
  );
  assert(
    liveWriteBatches.every((batch) => batch.filter((task) => task.writesPhotoshop).length <= 1),
    'live Photoshop write gates must run one at a time to avoid active-document races.'
  );
  const referenceTasks = buildTasks({ includeReferenceReplication: true });
  assert(
    referenceTasks.some((task) => task.id === 'agent:reference:layout-replication-completion'),
    'includeReferenceReplication must add layout-replication completion smoke.'
  );
  assert(
    referenceTasks.some((task) => task.id === 'agent:reference:live-evidence-pipeline-contract'),
    'includeReferenceReplication must add live evidence pipeline contract smoke.'
  );
  const desktopTasks = buildTasks({ includeDesktopAcceptance: true });
  assert(
    desktopTasks.some((task) => task.id === 'agent:desktop-acceptance'),
    'includeDesktopAcceptance must add Electron desktop acceptance.'
  );

  console.log(JSON.stringify({
    success: true,
    defaultTaskCount: defaultTasks.length,
    checks: [
      'default lane focuses execution-chain checks',
      'default lane avoids report-centered commands',
      'default lane does not touch live Photoshop',
      'default lane covers the main-image disposable product path without live writes',
      'default lane covers replayable main-image acceptance records without live writes',
      'optional build, live preflight and disposable live write lanes are explicit'
    ]
  }, null, 2));
}

function formatCommand(task) {
  return [task.command, ...task.args].join(' ');
}

function tail(value, maxLength = OUTPUT_TAIL_LIMIT) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function buildExecutionBatches(tasks) {
  const beforeLiveWrite = tasks.filter((task) => !task.runAfterLivePreflight);
  const afterLivePreflight = tasks.filter((task) => task.runAfterLivePreflight);
  return afterLivePreflight.length > 0
    ? [beforeLiveWrite, ...afterLivePreflight.map((task) => [task])].filter((batch) => batch.length > 0)
    : [beforeLiveWrite];
}

function runTask(task, options = {}) {
  const verbose = options.verbose === true;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, {
      cwd: task.cwd,
      env: task.env ? { ...process.env, ...task.env } : process.env,
      windowsHide: true,
      shell: task.shell === true
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, task.timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (verbose) process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (verbose) process.stderr.write(text);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        ...task,
        success: false,
        durationMs: Date.now() - startedAt,
        timedOut,
        exitCode: null,
        error: error.message,
        stdout: tail(stdout),
        stderr: tail(stderr)
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        ...task,
        success: code === 0 && !timedOut,
        durationMs: Date.now() - startedAt,
        timedOut,
        exitCode: code,
        error: timedOut ? `Task timed out after ${task.timeoutMs}ms.` : null,
        stdout: tail(stdout),
        stderr: tail(stderr)
      });
    });
  });
}

async function runQueue(tasks, options = {}) {
  const concurrency = parsePositiveInteger(options.concurrency, DEFAULT_CONCURRENCY);
  const pending = [...tasks];
  const running = new Set();
  const results = [];

  async function launch(task) {
    console.log(`[fast-lane:start] ${task.id}`);
    const promise = runTask(task, options).then((result) => {
      results.push(result);
      running.delete(promise);
      const status = result.success ? 'pass' : 'fail';
      console.log(`[fast-lane:${status}] ${task.id} ${result.durationMs}ms`);
      return result;
    });
    running.add(promise);
  }

  while (pending.length > 0 || running.size > 0) {
    while (pending.length > 0 && running.size < concurrency) {
      await launch(pending.shift());
    }

    if (running.size > 0) {
      await Promise.race(Array.from(running));
    }
  }

  return results.sort((a, b) => tasks.findIndex((task) => task.id === a.id) - tasks.findIndex((task) => task.id === b.id));
}

function renderFailure(result) {
  const lines = [
    `- ${result.id}`,
    `  command: ${formatCommand(result)}`,
    `  cwd: ${result.cwd}`,
    `  exitCode: ${result.exitCode}`,
    `  timedOut: ${result.timedOut}`
  ];

  if (result.error) lines.push(`  error: ${result.error}`);
  if (result.stderr) lines.push(`  stderrTail:\n${indent(result.stderr.trim())}`);
  if (result.stdout) lines.push(`  stdoutTail:\n${indent(result.stdout.trim())}`);
  return lines.join('\n');
}

function indent(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
}

async function main() {
  if (hasArg('--self-test')) {
    runSelfTest();
    return;
  }

  const tasks = buildTasks({
    includeBuild: hasArg('--include-build'),
    includeLivePreflight: hasArg('--include-live-preflight'),
    includeLiveWrite: hasArg('--include-live-write'),
    includeReferenceReplication: hasArg('--include-reference-replication'),
    includeDesktopAcceptance: hasArg('--include-desktop-acceptance')
  });

  if (hasArg('--list')) {
    console.log(JSON.stringify({
      success: true,
      taskCount: tasks.length,
      tasks: tasks.map((task) => ({
        id: task.id,
        cwd: task.cwd,
        command: formatCommand(task),
        timeoutMs: task.timeoutMs,
        touchesLivePhotoshop: task.touchesLivePhotoshop,
        writesPhotoshop: task.writesPhotoshop,
        taskEnvKeys: task.env ? Object.keys(task.env).sort() : [],
        reason: task.reason
      }))
    }, null, 2));
    return;
  }

  const concurrency = parsePositiveInteger(getArgValue('--concurrency', DEFAULT_CONCURRENCY), DEFAULT_CONCURRENCY);
  const startedAt = Date.now();
  console.log(`[fast-lane] tasks=${tasks.length} concurrency=${concurrency}`);
  const batches = buildExecutionBatches(tasks);
  const results = [];
  for (let index = 0; index < batches.length; index += 1) {
    if (batches.length > 1) {
      console.log(`[fast-lane:batch] ${index + 1}/${batches.length} tasks=${batches[index].length}`);
    }
    const batchResults = await runQueue(batches[index], {
      concurrency,
      verbose: hasArg('--verbose')
    });
    results.push(...batchResults);
    const failedBatchResults = batchResults.filter((result) => !result.success);
    if (failedBatchResults.length > 0) {
      break;
    }
  }
  const failed = results.filter((result) => !result.success);
  const durationMs = Date.now() - startedAt;

  if (failed.length > 0) {
    console.error('');
    console.error('[fast-lane] failed tasks:');
    for (const failure of failed) {
      console.error(renderFailure(failure));
    }
    console.error('');
    console.error(JSON.stringify({
      success: false,
      durationMs,
      passed: results.length - failed.length,
      failed: failed.length,
      failedTaskIds: failed.map((result) => result.id)
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    success: true,
    durationMs,
    passed: results.length,
    failed: 0,
    includedBuild: hasArg('--include-build'),
    includedLivePreflight: hasArg('--include-live-preflight'),
    includedLiveWrite: hasArg('--include-live-write'),
    includedReferenceReplication: hasArg('--include-reference-replication'),
    includedDesktopAcceptance: hasArg('--include-desktop-acceptance')
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
