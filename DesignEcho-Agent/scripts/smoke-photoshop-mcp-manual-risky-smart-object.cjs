/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-smart-object.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-smart-object.md');
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

async function callToolExpectingError(name, args = {}) {
  try {
    const payload = await callTool(name, args);
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

function outcomeFromExpectedError(result, expectedPatterns = []) {
  if (result.ok) {
    return {
      outcome: 'fail',
      payload: result.payload,
      notes: 'Expected host preflight to reject this call, but the tool call returned successfully.'
    };
  }

  const normalizedError = String(result.error || '');
  const matched = expectedPatterns.some(pattern => normalizedError.includes(pattern));
  return {
    outcome: matched ? 'pass' : 'fail',
    payload: { error: normalizedError },
    notes: matched
      ? 'Host rejected the invalid call before Photoshop execution.'
      : 'Host returned an unexpected error payload.'
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Smart Object Preflight Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
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

  const diagnose = await callTool('photoshop.tools.call', { name: 'diagnoseState', arguments: {} });
  const policy = await callTool('photoshop.batch_policy', { toolNames: ['getSmartObjectInfo', 'getSmartObjectLayers'] });
  const scenarios = [];

  const invalidInfo = await callToolExpectingError('photoshop.tools.batch_call', {
    calls: [{ name: 'getSmartObjectInfo', arguments: { layerId: 0 } }]
  });
  const invalidInfoResult = outcomeFromExpectedError(invalidInfo, [
    'getSmartObjectInfo layerId must be greater than 0',
    'layerId must be greater than 0'
  ]);
  scenarios.push({
    name: 'invalid-smart-object-layer-id-info',
    expected: 'Preflight should reject getSmartObjectInfo when layerId is not greater than 0',
    outcome: invalidInfoResult.outcome,
    notes: invalidInfoResult.notes,
    payload: invalidInfoResult.payload
  });

  const invalidLayers = await callToolExpectingError('photoshop.tools.batch_call', {
    calls: [{ name: 'getSmartObjectLayers', arguments: { layerId: 0 } }]
  });
  const invalidLayersResult = outcomeFromExpectedError(invalidLayers, [
    'getSmartObjectLayers layerId must be greater than 0',
    'layerId must be greater than 0'
  ]);
  scenarios.push({
    name: 'invalid-smart-object-layer-id-layers',
    expected: 'Preflight should reject getSmartObjectLayers when layerId is not greater than 0',
    outcome: invalidLayersResult.outcome,
    notes: invalidLayersResult.notes,
    payload: invalidLayersResult.payload
  });

  const invalidAutoOpen = await callToolExpectingError('photoshop.tools.batch_call', {
    calls: [{ name: 'getSmartObjectLayers', arguments: { autoOpen: 'yes' } }]
  });
  const invalidAutoOpenResult = outcomeFromExpectedError(invalidAutoOpen, [
    'getSmartObjectLayers autoOpen must be a boolean',
    'autoOpen must be boolean'
  ]);
  scenarios.push({
    name: 'invalid-smart-object-auto-open',
    expected: 'Preflight should reject getSmartObjectLayers when autoOpen is not boolean',
    outcome: invalidAutoOpenResult.outcome,
    notes: invalidAutoOpenResult.notes,
    payload: invalidAutoOpenResult.payload
  });

  const activeLayerKind = String(diagnose?.state?.selectedLayers?.[0]?.kind || '').toLowerCase();
  if (diagnose?.state?.hasDocument && activeLayerKind && !activeLayerKind.includes('smart')) {
    const missingSmartContext = await callToolExpectingError('photoshop.tools.batch_call', {
      calls: [{ name: 'getSmartObjectInfo', arguments: {} }]
    });
    const missingSmartContextResult = outcomeFromExpectedError(missingSmartContext, [
      'This Smart Object tool needs an active Smart Object layer or explicit layerId',
      'active Smart Object layer or explicit layerId'
    ]);
    scenarios.push({
      name: 'missing-smart-object-context',
      expected: 'Preflight should reject getSmartObjectInfo when the active layer is not a Smart Object and no layerId is provided',
      outcome: missingSmartContextResult.outcome,
      notes: missingSmartContextResult.notes,
      payload: missingSmartContextResult.payload
    });
  } else {
    scenarios.push({
      name: 'missing-smart-object-context',
      expected: 'Preflight should reject non-Smart-Object active layers',
      outcome: 'skip',
      notes: 'Skipped because the current Photoshop state already has a Smart Object selected or no document is open.',
      payload: { diagnose }
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
