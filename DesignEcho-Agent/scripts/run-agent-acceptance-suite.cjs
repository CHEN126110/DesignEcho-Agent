#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  buildAgentAcceptanceExecutionSuitePlan,
  formatAgentAcceptanceExecutionSuiteMarkdown
} = require('../src/shared/agent-acceptance-execution-suite.ts');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'acceptance');
const PLAN_JSON = path.join(OUT_DIR, 'agent-acceptance-suite-plan.json');
const PLAN_MD = path.join(OUT_DIR, 'agent-acceptance-suite-plan.md');
const RUN_JSON = path.join(OUT_DIR, 'agent-acceptance-suite-run.json');
const RUN_MD = path.join(OUT_DIR, 'agent-acceptance-suite-run.md');

const SAFE_RUN_SCRIPTS = new Set([
  'smoke:agent:acceptance',
  'smoke:agent:acceptance:desktop'
]);

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    json: args.includes('--json'),
    runDefaultSafe: args.includes('--run-default-safe'),
    selection: readSelection(args)
  };
}

function readSelection(args) {
  const index = args.indexOf('--selection');
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--selection requires a value');
  }
  return value;
}

function buildOptInFlagsFromEnv() {
  return {
    DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE: process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE,
    DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API: process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API,
    DESIGNECHO_LIVE_AGENT_ACCEPTANCE: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE,
    DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER,
    DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT
  };
}

function buildRuntimeFromEnv() {
  return {
    agentDesktopBuilt: fs.existsSync(path.join(ROOT, 'dist', 'main', 'main', 'index.js'))
      && fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html')),
    uxpPluginConnected: process.env.DESIGNECHO_ACCEPTANCE_UXP_CONNECTED === '1',
    photoshopBridgeReady: process.env.DESIGNECHO_ACCEPTANCE_PHOTOSHOP_BRIDGE_READY === '1',
    disposableDocumentAllowed: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT === '1'
  };
}

function writePlan(plan) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PLAN_JSON, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  fs.writeFileSync(PLAN_MD, formatAgentAcceptanceExecutionSuiteMarkdown(plan), 'utf8');
}

function runSafeCommands(plan) {
  const results = [];
  for (const command of plan.selectedCommands) {
    if (!SAFE_RUN_SCRIPTS.has(command.npmScript)) {
      throw new Error(`Refusing to run non-default-safe script: ${command.npmScript}`);
    }

    const startedAt = new Date().toISOString();
    try {
      const output = runNpmScript(command.npmScript);
      results.push({
        mode: command.mode,
        npmScript: command.npmScript,
        command: command.command,
        status: 'passed',
        startedAt,
        finishedAt: new Date().toISOString(),
        outputTail: tail(output)
      });
    } catch (error) {
      results.push({
        mode: command.mode,
        npmScript: command.npmScript,
        command: command.command,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        outputTail: tail(error.stdout || ''),
        errorTail: tail(error.stderr || error.message || String(error))
      });
      break;
    }
  }
  return results;
}

function runNpmScript(scriptName) {
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', 'run', scriptName], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  return execFileSync('npm', ['run', scriptName], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function writeRunReport(plan, results) {
  const report = {
    version: 'agent-acceptance-execution-suite-run/v0',
    generatedAt: new Date().toISOString(),
    selection: plan.selection,
    success: results.every((item) => item.status === 'passed'),
    resultCount: results.length,
    results,
    boundaries: [
      'Only default-safe acceptance scripts can be executed by this runner.',
      'The runner refuses real provider and live Photoshop scripts.',
      'A passed run proves only acceptance infrastructure health, not design quality.'
    ]
  };
  fs.writeFileSync(RUN_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(RUN_MD, formatRunReportMarkdown(report), 'utf8');
  return report;
}

function formatRunReportMarkdown(report) {
  const lines = [
    '# Agent Acceptance Suite Run',
    '',
    `- version: ${report.version}`,
    `- generatedAt: ${report.generatedAt}`,
    `- selection: ${report.selection}`,
    `- success: ${report.success}`,
    `- resultCount: ${report.resultCount}`,
    '',
    '## Results',
    ''
  ];

  for (const result of report.results) {
    lines.push(`### ${result.mode}`);
    lines.push(`- npmScript: ${result.npmScript}`);
    lines.push(`- status: ${result.status}`);
    lines.push(`- startedAt: ${result.startedAt}`);
    lines.push(`- finishedAt: ${result.finishedAt}`);
    lines.push('');
  }

  lines.push('## Boundaries');
  for (const boundary of report.boundaries) {
    lines.push(`- ${boundary}`);
  }
  return `${lines.join('\n')}\n`;
}

function tail(value) {
  const text = String(value || '');
  return text.split(/\r?\n/).filter(Boolean).slice(-20).join('\n');
}

function main() {
  const args = parseArgs();
  const plan = buildAgentAcceptanceExecutionSuitePlan({
    selection: args.selection,
    optInFlags: buildOptInFlagsFromEnv(),
    runtime: buildRuntimeFromEnv()
  });
  writePlan(plan);

  if (args.runDefaultSafe) {
    const results = runSafeCommands(plan);
    const report = writeRunReport(plan, results);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatRunReportMarkdown(report));
    }
    if (!report.success) process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(formatAgentAcceptanceExecutionSuiteMarkdown(plan));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
