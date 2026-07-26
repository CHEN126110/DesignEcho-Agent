#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function runSmoke(relativePath) {
  const scriptPath = path.join(ROOT, relativePath);
  assert(fs.existsSync(scriptPath), `missing observation loop smoke dependency: ${relativePath}`);

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe'
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`observation loop dependency failed: ${relativePath}`);
  }

  return {
    script: relativePath,
    stdout: result.stdout.trim()
  };
}

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert(
  packageJson.scripts?.['smoke:agent:observation-loop'] === 'node scripts/smoke-agent-observation-loop.cjs',
  'package.json should expose the observation loop smoke'
);

const checks = [
  runSmoke('scripts/smoke-agent-design-observation-protocol.cjs'),
  runSmoke('scripts/smoke-agent-react-observation-contract.cjs'),
  runSmoke('scripts/smoke-agent-observation-channels.cjs')
];

console.log(JSON.stringify({
  success: true,
  checks: [
    'design observation protocol is available',
    'action results return to Agent decision as ReAct observations',
    'thinking, tool, activity and diagnostic channels stay separated'
  ],
  dependencies: checks.map((check) => check.script)
}, null, 2));
