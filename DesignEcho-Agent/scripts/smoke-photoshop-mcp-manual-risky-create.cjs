/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-create.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-create.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const CREATE_TOOLS = [
  'createDocument',
  'createRectangle',
  'createEllipse',
  'createTextLayer',
  'createGroup'
];

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
    delayMs: 150
  });
}

function hasPreflightFailure(result) {
  return Array.isArray(result?.results) && result.results[0]?.stage === 'preflight';
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Create Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Active document: ${report.diagnose?.state?.documentInfo?.name || 'none'}`);
  lines.push(`- Active layer count: ${Array.isArray(report.diagnose?.state?.selectedLayers) ? report.diagnose.state.selectedLayers.length : 0}`);
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

  const state = diagnose?.state || {};
  const hasDocument = state.hasDocument === true;
  const selectedLayers = Array.isArray(state.selectedLayers) ? state.selectedLayers : [];
  const hasActiveLayer = selectedLayers.length > 0;

  const policy = await callTool('photoshop.batch_policy', { names: CREATE_TOOLS });
  const scenarios = [];

  const invalidDocumentWidth = await batchCall([
    { name: 'createDocument', arguments: { width: 0, height: 100, name: 'Bad Width' } }
  ]);
  scenarios.push({
    name: 'invalid-document-width',
    expected: 'Preflight should reject createDocument width <= 0',
    outcome: hasPreflightFailure(invalidDocumentWidth) ? 'pass' : 'fail',
    payload: invalidDocumentWidth
  });

  const invalidDocumentResolution = await batchCall([
    { name: 'createDocument', arguments: { width: 100, height: 100, resolution: 0, name: 'Bad Resolution' } }
  ]);
  scenarios.push({
    name: 'invalid-document-resolution',
    expected: 'Preflight should reject createDocument resolution <= 0',
    outcome: hasPreflightFailure(invalidDocumentResolution) ? 'pass' : 'fail',
    payload: invalidDocumentResolution
  });

  if (!hasDocument) {
    const missingDocRectangle = await batchCall([
      { name: 'createRectangle', arguments: { x: 10, y: 10, width: 80, height: 80, name: 'Needs Doc' } }
    ]);
    scenarios.push({
      name: 'missing-document-create-rectangle',
      expected: 'Preflight should reject createRectangle when no document is open',
      outcome: hasPreflightFailure(missingDocRectangle) ? 'pass' : 'fail',
      payload: missingDocRectangle
    });
  } else {
    scenarios.push({
      name: 'missing-document-create-rectangle',
      expected: 'Skip because an active document is already open',
      outcome: 'skip',
      payload: { hasDocument }
    });
  }

  if (hasDocument) {
    const invalidRectangleGeometry = await batchCall([
      { name: 'createRectangle', arguments: { x: 10, y: 10, width: 0, height: 80, name: 'Bad Rectangle' } }
    ]);
    scenarios.push({
      name: 'invalid-rectangle-geometry',
      expected: 'Preflight should reject createRectangle width <= 0',
      outcome: hasPreflightFailure(invalidRectangleGeometry) ? 'pass' : 'fail',
      payload: invalidRectangleGeometry
    });

    const invalidTextParams = await batchCall([
      { name: 'createTextLayer', arguments: { content: '', x: 'bad', y: 12 } }
    ]);
    scenarios.push({
      name: 'invalid-text-params',
      expected: 'Preflight should reject createTextLayer with empty content and invalid x',
      outcome: hasPreflightFailure(invalidTextParams) ? 'pass' : 'fail',
      payload: invalidTextParams
    });

    if (!hasActiveLayer) {
      const noGroupableLayers = await batchCall([
        { name: 'createGroup', arguments: { groupName: 'No Layers Group', fromSelected: true } }
      ]);
      scenarios.push({
        name: 'create-group-no-groupable-layers',
        expected: 'Preflight should reject createGroup when fromSelected=true and there are no selected layers',
        outcome: hasPreflightFailure(noGroupableLayers) ? 'pass' : 'fail',
        payload: noGroupableLayers
      });
    } else {
      scenarios.push({
        name: 'create-group-no-groupable-layers',
        expected: 'Skip because there are already selected layers in the current document',
        outcome: 'skip',
        payload: { selectedLayerCount: selectedLayers.length }
      });
    }
  } else {
    scenarios.push({
      name: 'invalid-rectangle-geometry',
      expected: 'Skip because no document is open',
      outcome: 'skip',
      payload: { hasDocument }
    });
    scenarios.push({
      name: 'invalid-text-params',
      expected: 'Skip because no document is open',
      outcome: 'skip',
      payload: { hasDocument }
    });
    scenarios.push({
      name: 'create-group-no-groupable-layers',
      expected: 'Skip because no document is open',
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
