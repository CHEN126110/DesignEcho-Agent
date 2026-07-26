#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function fail(message) {
  console.error(`[build-warning-boundary] FAIL: ${message}`);
  process.exit(1);
}

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, 'package.json');
const viteConfigPath = path.join(repoRoot, 'vite.config.mts');
const skillExecutorIndexPath = path.join(
  repoRoot,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'index.ts'
);
const autonomousExecutorPath = path.join(
  repoRoot,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'autonomous-agent.executor.ts'
);
const designTeamCoordinatorPath = path.join(
  repoRoot,
  'src',
  'renderer',
  'services',
  'design-teams',
  'coordinator.ts'
);

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const browserslist = Array.isArray(packageJson.browserslist)
  ? packageJson.browserslist
  : [];

if (!browserslist.includes('Chrome >= 120')) {
  fail('package.json browserslist must keep the Electron renderer target explicit: Chrome >= 120.');
}

const viteConfig = fs.readFileSync(viteConfigPath, 'utf8');
if (/\bchunkSizeWarningLimit\s*:/.test(viteConfig)) {
  fail('vite.config.mts must not hide large chunks with chunkSizeWarningLimit; split code instead.');
}

const skillExecutorIndex = fs.readFileSync(skillExecutorIndexPath, 'utf8');
if (/^import\s+\{\s*autonomousAgentExecutor\s*\}\s+from\s+['"]\.\/autonomous-agent\.executor['"];?$/m.test(skillExecutorIndex)) {
  fail('skill executor registry must not statically import the autonomous Agent executor.');
}
if (!/await\s+import\(['"]\.\/autonomous-agent\.executor['"]\)/.test(skillExecutorIndex)) {
  fail('skill executor registry must keep the autonomous Agent executor on demand.');
}

for (const [label, filePath] of [
  ['autonomous Agent executor', autonomousExecutorPath],
  ['design team coordinator', designTeamCoordinatorPath]
]) {
  const source = fs.readFileSync(filePath, 'utf8');
  if (/^import\s+\{[^\n}]*\bAgent\b[^\n}]*\}\s+from\s+['"][^'"]*agent-runtime(?:\/agent)?['"];?$/m.test(source)) {
    fail(`${label} must not statically import the Agent core.`);
  }
  if (!/await\s+import\(['"][^'"]*agent-runtime\/agent['"]\)/.test(source)) {
    fail(`${label} must load the Agent core on demand.`);
  }
}

const argv = process.argv.slice(2);
const separatorIndex = argv.indexOf('--');
const command = separatorIndex >= 0
  ? argv.slice(separatorIndex + 1).join(' ')
  : (argv.length > 0 ? argv.join(' ') : 'npm run build');

if (!command.trim()) {
  fail('missing build command after --.');
}

const result = spawnSync(command, {
  cwd: repoRoot,
  shell: true,
  encoding: 'utf8',
  env: {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1'
  }
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

const forbiddenPatterns = [
  /Browserslist:.*caniuse-lite.*outdated/i,
  /caniuse-lite is outdated/i,
  /Please run:\s*npx\s+update-browserslist-db/i,
  /Some chunks are larger than/i,
  /Use dynamic import\(\) to code-split/i,
  /chunk size limit/i,
  /is dynamically imported by .* but also statically imported by/i,
  /Circular chunk:/i
];

const hits = forbiddenPatterns
  .filter((pattern) => pattern.test(output))
  .map((pattern) => pattern.toString());

if (hits.length > 0) {
  fail(`build output contains warning markers: ${hits.join(', ')}`);
}

const jsChunkMatches = [...output.matchAll(/assets\/([^\s]+\.js)\s+([\d.]+)\s+kB/g)];
const largestChunk = jsChunkMatches.reduce((largest, match) => {
  const sizeKb = Number(match[2]);
  if (!Number.isFinite(sizeKb)) return largest;
  if (!largest || sizeKb > largest.sizeKb) {
    return { name: match[1], sizeKb };
  }
  return largest;
}, null);

const chunkSummary = largestChunk
  ? `; max js chunk ${largestChunk.name} ${largestChunk.sizeKb.toFixed(2)} kB`
  : '';

console.log(`[build-warning-boundary] PASS: no Browserslist outdated or Vite large chunk warning${chunkSummary}.`);
