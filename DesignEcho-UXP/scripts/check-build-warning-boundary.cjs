const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const runtimePath = path.join(distDir, 'runtime.js');
const legacyIndexPath = path.join(distDir, 'index.js');
const maxRuntimeBytes = 700 * 1024;
const maxLegacyIndexBytes = 4096;

function stripAnsi(text) {
    return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function fail(message) {
    console.error(`[uxp-build-warning-boundary] FAIL: ${message}`);
    process.exit(1);
}

const commandIndex = process.argv.indexOf('--');
const command = commandIndex >= 0
    ? process.argv.slice(commandIndex + 1)
    : ['npm', 'run', 'build'];

if (command.length === 0) {
    fail('missing build command after --.');
}

const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32'
});

const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

if (result.status !== 0) {
    fail(`build command exited with ${result.status}.`);
}

const warningPatterns = [
    /Browserslist:.*caniuse-lite.*outdated/i,
    /caniuse-lite is outdated/i,
    /Please run:\s*npx\s+update-browserslist-db/i,
    /\[[^\]]*\bbig\b[^\]]*\]/i,
    /asset size limit/i,
    /entrypoint size limit/i,
    /performance recommendations/i
];

for (const pattern of warningPatterns) {
    if (pattern.test(output)) {
        fail(`build output matched warning pattern ${pattern}.`);
    }
}

if (!fs.existsSync(runtimePath)) {
    fail('dist/runtime.js was not emitted.');
}

if (!fs.existsSync(legacyIndexPath)) {
    fail('dist/index.js compatibility shim was not emitted.');
}

const runtimeBytes = fs.statSync(runtimePath).size;
const legacyIndexBytes = fs.statSync(legacyIndexPath).size;

if (runtimeBytes > maxRuntimeBytes) {
    fail(`dist/runtime.js is ${runtimeBytes} bytes, above ${maxRuntimeBytes} byte budget.`);
}

if (legacyIndexBytes > maxLegacyIndexBytes) {
    fail(`dist/index.js should stay a small compatibility shim, got ${legacyIndexBytes} bytes.`);
}

const legacyIndex = fs.readFileSync(legacyIndexPath, 'utf8');
if (!/require\(['"]\.\/runtime\.js['"]\)/.test(legacyIndex)) {
    fail('dist/index.js does not proxy to ./runtime.js.');
}

console.log(`[uxp-build-warning-boundary] PASS: runtime.js ${runtimeBytes} bytes, index.js ${legacyIndexBytes} bytes, no Browserslist or large asset warning markers.`);
