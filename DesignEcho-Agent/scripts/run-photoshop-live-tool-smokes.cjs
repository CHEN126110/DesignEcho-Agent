/* eslint-disable no-console */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const REPORT_JSON = path.join(TMP_DIR, 'photoshop-live-tool-smokes-serial.json');
const REPORT_MD = path.join(TMP_DIR, 'photoshop-live-tool-smokes-serial.md');
const DEFAULT_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_PHOTOSHOP_LIVE_TOOL_SMOKE_TIMEOUT_MS,
  120_000
);
const OUTPUT_TAIL_LIMIT = 4_000;

const LIVE_TOOL_SMOKES = [
  {
    id: 'bridge-health',
    script: 'maintenance:photoshop-bridge-health:check:runtime',
    touchesLivePhotoshop: true,
    writesPhotoshop: false,
    timeoutMs: 30_000
  },
  {
    id: 'agent-tool-matrix',
    script: 'smoke:photoshop-mcp:agent-matrix',
    touchesLivePhotoshop: false,
    writesPhotoshop: false
  },
  {
    id: 'mcp-batches',
    script: 'smoke:photoshop-mcp:batches',
    touchesLivePhotoshop: true,
    writesPhotoshop: false,
    timeoutMs: 60_000
  },
  {
    id: 'acceptance-snapshot',
    script: 'smoke:photoshop-acceptance:live',
    touchesLivePhotoshop: true,
    writesPhotoshop: false,
    timeoutMs: 60_000
  },
  {
    id: 'mcp-create-disposable',
    script: 'smoke:photoshop-mcp:manual-risky-create:disposable',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'mcp-effects-disposable',
    script: 'smoke:photoshop-mcp:manual-risky-effects:disposable',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'mcp-image-read-disposable',
    script: 'smoke:photoshop-mcp:manual-risky-image-read:disposable',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'mcp-replace-export-disposable',
    script: 'smoke:photoshop-mcp:manual-risky-replace-export:disposable',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'mcp-smart-object-disposable',
    script: 'smoke:photoshop-mcp:manual-risky-smart-object:disposable',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'mcp-smart-object-replace-contents-disposable',
    script: 'smoke:photoshop-mcp:manual-risky-smart-object:disposable:replace-contents',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'layer-writes-live',
    script: 'smoke:photoshop-layer-writes:live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'simple-ops-live',
    script: 'smoke:photoshop-simple-ops:live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'text-tools-live',
    script: 'smoke:photoshop-text-tools:live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true,
    timeoutMs: 180_000
  },
  {
    id: 'text-font-replace-live',
    script: 'smoke:photoshop-text-font-replace:live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true,
    timeoutMs: 180_000
  },
  {
    id: 'save-export-live',
    script: 'smoke:photoshop-save-export:live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true,
    timeoutMs: 180_000
  },
  {
    id: 'controlled-script-execution-live',
    script: 'smoke:photoshop:controlled-script-execution-live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'controlled-export-execution-live',
    script: 'smoke:photoshop:controlled-export-execution-live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'controlled-image-placement-execution-live',
    script: 'smoke:photoshop:controlled-image-placement-execution-live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'rasterize-popup-guard-live',
    script: 'smoke:photoshop:rasterize-popup-guard-live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true
  },
  {
    id: 'acceptance-write-live',
    script: 'smoke:photoshop-acceptance:write-live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true,
    timeoutMs: 120_000,
    env: {
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE: '1',
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER: '1',
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT: '1'
    }
  },
  {
    id: 'main-image-live-tool-adapter-disposable',
    script: 'smoke:main-image:live-tool-adapter-disposable',
    touchesLivePhotoshop: true,
    writesPhotoshop: true,
    timeoutMs: 180_000,
    env: {
      DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_ACCEPTANCE: '1',
      DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_DISPOSABLE_DOCUMENT: '1'
    }
  },
  {
    id: 'smart-scaling-actual-bounds-live',
    script: 'smoke:smart-scaling:actual-bounds-live',
    touchesLivePhotoshop: true,
    writesPhotoshop: true,
    timeoutMs: 180_000
  }
];

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  const ids = LIVE_TOOL_SMOKES.map((task) => task.id);
  const uniqueIds = new Set(ids);
  const writeTasks = LIVE_TOOL_SMOKES.filter((task) => task.writesPhotoshop);

  assert(ids.length === uniqueIds.size, 'live Photoshop tool smoke ids must be unique.');
  assert(LIVE_TOOL_SMOKES[0].id === 'bridge-health', 'bridge health must run first.');
  assert(ids.includes('mcp-image-read-disposable'), 'runner must include heavy image-read disposable smoke.');
  assert(ids.includes('mcp-smart-object-replace-contents-disposable'), 'runner must include smart-object replace-contents smoke.');
  assert(ids.includes('simple-ops-live'), 'runner must include simple operations live smoke.');
  assert(ids.includes('layer-writes-live'), 'runner must include layer writes live smoke.');
  assert(ids.includes('text-tools-live'), 'runner must include text tools live smoke.');
  assert(ids.includes('save-export-live'), 'runner must include save/export live smoke.');
  assert(ids.includes('controlled-image-placement-execution-live'), 'runner must include controlled image placement live smoke.');
  assert(ids.includes('acceptance-write-live'), 'runner must include disposable acceptance write live smoke.');
  assert(writeTasks.length >= 12, 'runner must cover a broad set of disposable/live Photoshop write smokes.');
  assert(
    LIVE_TOOL_SMOKES.every((task) => typeof task.script === 'string' && task.script.length > 0),
    'every live Photoshop tool smoke must point at an npm script.'
  );
  assert(
    LIVE_TOOL_SMOKES.every((task) => task.timeoutMs === undefined || task.timeoutMs > 0),
    'task timeouts must be positive when provided.'
  );
  assert(
    LIVE_TOOL_SMOKES.filter((task) => task.writesPhotoshop).every((task) => task.touchesLivePhotoshop),
    'write smokes must also be marked as touching live Photoshop.'
  );

  console.log(JSON.stringify({
    success: true,
    taskCount: LIVE_TOOL_SMOKES.length,
    writeTaskCount: writeTasks.length,
    checks: [
      'explicit manifest exists',
      'bridge health runs first',
      'all live Photoshop tool writes are represented as individual serial tasks',
      'runner self-test does not touch Photoshop'
    ]
  }, null, 2));
}

function selectTasks() {
  const only = getArgValue('--only', null);
  if (!only) return LIVE_TOOL_SMOKES;
  const wanted = new Set(only.split(',').map((item) => item.trim()).filter(Boolean));
  return LIVE_TOOL_SMOKES.filter((task) => wanted.has(task.id) || wanted.has(task.script));
}

function tail(value, maxLength = OUTPUT_TAIL_LIMIT) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function formatTask(task) {
  return `npm run ${task.script}`;
}

function runTask(task) {
  const startedAt = Date.now();
  const timeoutMs = task.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', task.script], {
      cwd: ROOT,
      env: task.env ? { ...process.env, ...task.env } : process.env,
      shell: process.platform === 'win32',
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        ...task,
        success: false,
        exitCode: null,
        timedOut,
        durationMs: Date.now() - startedAt,
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
        exitCode: code,
        timedOut,
        durationMs: Date.now() - startedAt,
        error: timedOut ? `Task timed out after ${timeoutMs}ms.` : null,
        stdout: tail(stdout),
        stderr: tail(stderr)
      });
    });
  });
}

function renderFailure(result) {
  const lines = [
    `- ${result.id}`,
    `  command: ${formatTask(result)}`,
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

function sanitizeResult(result) {
  return {
    id: result.id,
    script: result.script,
    touchesLivePhotoshop: result.touchesLivePhotoshop,
    writesPhotoshop: result.writesPhotoshop,
    timeoutMs: result.timeoutMs || DEFAULT_TIMEOUT_MS,
    envKeys: result.env ? Object.keys(result.env).sort() : [],
    success: result.success,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    error: result.error || null,
    stdoutTail: result.success ? '' : result.stdout,
    stderrTail: result.success ? '' : result.stderr
  };
}

function buildReport(results, status, plannedTasks = LIVE_TOOL_SMOKES) {
  const completed = results.map(sanitizeResult);
  return {
    generatedAt: new Date().toISOString(),
    status,
    success: status === 'passed',
    serial: true,
    taskCount: plannedTasks.length,
    completedTaskCount: completed.length,
    writeTaskCount: completed.filter((task) => task.writesPhotoshop).length,
    failedTaskCount: completed.filter((task) => task.success === false).length,
    durationMs: completed.reduce((total, task) => total + (task.durationMs || 0), 0),
    tasks: completed,
    pendingTasks: plannedTasks.slice(completed.length).map((task, index) => ({
      order: completed.length + index + 1,
      id: task.id,
      script: task.script,
      touchesLivePhotoshop: task.touchesLivePhotoshop,
      writesPhotoshop: task.writesPhotoshop
    })),
    boundaries: [
      'This report proves scripted Photoshop tool smoke execution only; it does not claim open-ended design quality.',
      'Live Photoshop write smokes are serialized because Photoshop activeDocument is shared mutable host state.',
      'Each disposable smoke is responsible for closing its own temporary Photoshop document without saving.'
    ],
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Photoshop Live Tool Smokes',
    '',
    `- status: ${report.status}`,
    `- success: ${report.success}`,
    `- serial: ${report.serial}`,
    `- completedTaskCount: ${report.completedTaskCount}/${report.taskCount}`,
    `- writeTaskCount: ${report.writeTaskCount}`,
    `- failedTaskCount: ${report.failedTaskCount}`,
    `- durationMs: ${report.durationMs}`,
    '',
    '## Tool Smoke Results',
    '',
    '| order | id | script | writes Photoshop | status | durationMs |',
    '| ---: | --- | --- | --- | --- | ---: |'
  ];

  report.tasks.forEach((task, index) => {
    lines.push(`| ${index + 1} | ${task.id} | \`${task.script}\` | ${task.writesPhotoshop ? 'yes' : 'no'} | ${task.success ? 'pass' : 'fail'} | ${task.durationMs || 0} |`);
  });

  if (report.pendingTasks.length > 0) {
    lines.push('', '## Pending Tasks', '');
    for (const task of report.pendingTasks) {
      lines.push(`- ${task.order}. ${task.id} (\`${task.script}\`)`);
    }
  }

  const failed = report.tasks.filter((task) => task.success === false);
  if (failed.length > 0) {
    lines.push('', '## Failures', '');
    for (const task of failed) {
      lines.push(`### ${task.id}`, '');
      if (task.error) lines.push(`- error: ${task.error}`);
      if (task.stderrTail) {
        lines.push('', '```text');
        lines.push(task.stderrTail);
        lines.push('```');
      }
      if (task.stdoutTail) {
        lines.push('', '```text');
        lines.push(task.stdoutTail);
        lines.push('```');
      }
    }
  }

  lines.push('', '## Boundaries', '');
  for (const boundary of report.boundaries) {
    lines.push(`- ${boundary}`);
  }

  return `${lines.join('\n')}\n`;
}

function writeReport(results, status, plannedTasks = LIVE_TOOL_SMOKES) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const report = buildReport(results, status, plannedTasks);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');
  return report;
}

async function main() {
  if (hasArg('--self-test')) {
    runSelfTest();
    return;
  }

  const tasks = selectTasks();
  if (tasks.length === 0) {
    throw new Error('No live Photoshop tool smoke tasks matched the requested filter.');
  }

  if (hasArg('--list')) {
    console.log(JSON.stringify({
      success: true,
      taskCount: tasks.length,
      serial: true,
      tasks: tasks.map((task, index) => ({
        order: index + 1,
        id: task.id,
        script: task.script,
        timeoutMs: task.timeoutMs || DEFAULT_TIMEOUT_MS,
        touchesLivePhotoshop: task.touchesLivePhotoshop,
        writesPhotoshop: task.writesPhotoshop,
        envKeys: task.env ? Object.keys(task.env).sort() : []
      }))
    }, null, 2));
    return;
  }

  console.log(`[photoshop-live-tools] tasks=${tasks.length} serial=true`);
  const results = [];
  for (const task of tasks) {
    console.log(`[photoshop-live-tools:start] ${task.id}`);
    const result = await runTask(task);
    results.push(result);
    console.log(`[photoshop-live-tools:${result.success ? 'pass' : 'fail'}] ${task.id} ${result.durationMs}ms`);
    if (!result.success) {
      const report = writeReport(results, 'failed', tasks);
      console.error('[photoshop-live-tools] failed task:');
      console.error(renderFailure(result));
      console.error(`[photoshop-live-tools] report: ${report.report.json}`);
      process.exit(1);
    }
  }

  const report = writeReport(results, 'passed', tasks);
  console.log(JSON.stringify({
    success: true,
    taskCount: results.length,
    writeTaskCount: results.filter((item) => item.writesPhotoshop).length,
    durationMs: results.reduce((total, item) => total + item.durationMs, 0),
    report: report.report
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
