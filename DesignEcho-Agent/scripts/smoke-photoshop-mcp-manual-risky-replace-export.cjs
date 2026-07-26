/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-replace-export.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-replace-export.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function asJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${asJson(payload.error)}`);
  }
  return payload.result;
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(name, args = {}) {
  return parseToolResult(await rpc('tools/call', { name, arguments: args }));
}

async function batchCall(calls) {
  return callTool('photoshop.tools.batch_call', {
    calls,
    continueOnError: true,
    allowWrites: true,
    allowRisky: true,
    delayMs: 200
  });
}

function hasPreflightFailure(result) {
  return Array.isArray(result?.results) && result.results[0]?.stage === 'preflight';
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Replace/Export Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Active document: ${report.diagnose?.state?.documentInfo?.name || 'none'}`);
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.policy, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.name}`);
    lines.push('');
    lines.push(`- Expected: ${scenario.expected}`);
    lines.push(`- Outcome: ${scenario.outcome}`);
    if (scenario.notes) {
      lines.push(`- Notes: ${scenario.notes}`);
    }
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(scenario.payload, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  ensureDir(TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  if (!systemStatus?.pluginConnected) {
    throw new Error('Photoshop UXP plugin is not connected');
  }

  const diagnose = await callTool('photoshop.tools.call', {
    name: 'diagnoseState',
    arguments: { verbose: false }
  });
  const hasDocument = diagnose?.state?.hasDocument === true;

  const policy = await callTool('photoshop.batch_policy', {
    names: ['replaceImagePlaceholder', 'batchExport']
  });

  const scenarios = [];

  const missingPlaceholderTarget = await batchCall([
    { name: 'replaceImagePlaceholder', arguments: { imagePath: 'C:\\invalid\\placeholder.png' } }
  ]);
  scenarios.push({
    name: 'replace-image-missing-target',
    expected: 'Preflight should reject replaceImagePlaceholder without a target layer',
    outcome: hasPreflightFailure(missingPlaceholderTarget) ? 'pass' : 'fail',
    payload: missingPlaceholderTarget
  });

  const missingReplacementImage = await batchCall([
    { name: 'replaceImagePlaceholder', arguments: { targetLayerId: 1 } }
  ]);
  scenarios.push({
    name: 'replace-image-missing-image',
    expected: 'Preflight should reject replaceImagePlaceholder without an image payload',
    outcome: hasPreflightFailure(missingReplacementImage) ? 'pass' : 'fail',
    payload: missingReplacementImage
  });

  const missingOutputDirectory = await batchCall([
    { name: 'batchExport', arguments: { presets: [{ width: 100, height: 100, suffix: '_main' }] } }
  ]);
  scenarios.push({
    name: 'batch-export-missing-output-directory',
    expected: 'Preflight should reject batchExport without outputDirectory',
    outcome: hasPreflightFailure(missingOutputDirectory) ? 'pass' : 'fail',
    payload: missingOutputDirectory
  });

  const invalidPresetGeometry = await batchCall([
    { name: 'batchExport', arguments: { outputDirectory: path.join(TMP_DIR, 'dummy-export'), presets: [{ width: 0, height: 0, suffix: '_bad' }] } }
  ]);
  scenarios.push({
    name: 'batch-export-invalid-preset-geometry',
    expected: 'Preflight should reject presets that define neither width nor height',
    outcome: hasPreflightFailure(invalidPresetGeometry) ? 'pass' : 'fail',
    payload: invalidPresetGeometry
  });

  const invalidPresetSuffix = await batchCall([
    { name: 'batchExport', arguments: { outputDirectory: path.join(TMP_DIR, 'dummy-export'), presets: [{ width: 100, height: 0, suffix: '' }] } }
  ]);
  scenarios.push({
    name: 'batch-export-invalid-preset-suffix',
    expected: 'Preflight should reject presets without a suffix',
    outcome: hasPreflightFailure(invalidPresetSuffix) ? 'pass' : 'fail',
    payload: invalidPresetSuffix
  });

  if (!hasDocument) {
    const missingDocumentBatchExport = await batchCall([
      { name: 'batchExport', arguments: { outputDirectory: path.join(TMP_DIR, 'dummy-export'), presets: [{ width: 100, height: 100, suffix: '_main' }] } }
    ]);
    scenarios.push({
      name: 'batch-export-missing-document',
      expected: 'Preflight should reject batchExport when there is no active document',
      outcome: hasPreflightFailure(missingDocumentBatchExport) ? 'pass' : 'fail',
      payload: missingDocumentBatchExport
    });
  } else {
    scenarios.push({
      name: 'batch-export-missing-document',
      expected: 'Skip because an active document is already open',
      outcome: 'skip',
      payload: { hasDocument }
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    systemStatus,
    diagnose,
    policy,
    scenarios
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: systemStatus?.pluginConnected === true,
    scenarios: scenarios.map(item => ({ name: item.name, outcome: item.outcome }))
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
