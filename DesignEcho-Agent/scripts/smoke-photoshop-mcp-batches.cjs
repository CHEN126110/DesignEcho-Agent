/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-batch-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-batch-smoke.md');
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
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now() + Math.random(),
      method,
      params
    })
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
  return parseToolResult(await rpc('tools/call', {
    name,
    arguments: args
  }));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Batch Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
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

  const selectedLayers = Array.isArray(diagnose?.state?.selectedLayers) ? diagnose.state.selectedLayers : [];
  const activeKind = String(selectedLayers[0]?.kind || '').toLowerCase();

  const scenarios = [];

  const policy = await callTool('photoshop.batch_policy', {
    names: ['getDocumentInfo', 'diagnoseState', 'getSelectionMask', 'setTextContent']
  });
  scenarios.push({
    name: 'policy',
    expected: 'Return batch policy with execution lanes',
    outcome: policy?.success ? 'pass' : 'fail',
    payload: policy
  });

  const safeBatch = await callTool('photoshop.tools.batch_call', {
    calls: [
      { name: 'listDocuments', arguments: { includeDetails: false } },
      { name: 'diagnoseState', arguments: { verbose: false } }
    ],
    continueOnError: false,
    allowWrites: false,
    allowRisky: false,
    delayMs: 50
  });
  scenarios.push({
    name: 'safe-read-batch',
    expected: 'Two safe read tools should execute successfully',
    outcome: safeBatch?.success ? 'pass' : 'fail',
    payload: safeBatch
  });

  if (diagnose?.state?.hasSelection) {
    scenarios.push({
      name: 'selection-preflight',
      expected: 'Selection missing-state preflight only runs when no active selection exists',
      outcome: 'skip',
      payload: { hasSelection: true },
      notes: 'Active selection exists; skipping missing-selection preflight probe.'
    });
  } else {
    const selectionBatch = await callTool('photoshop.tools.batch_call', {
      calls: [{ name: 'getSelectionMask', arguments: {} }],
      continueOnError: true,
      allowWrites: false,
      allowRisky: true,
      delayMs: 50
    });
    const selectionResult = selectionBatch?.results?.[0];
    const selectionOutcome = selectionResult?.stage === 'preflight' ? 'pass' : 'fail';
    scenarios.push({
      name: 'selection-preflight',
      expected: 'Selection tool should fail in preflight when no selection exists',
      outcome: selectionOutcome,
      payload: selectionBatch
    });
  }

  if (!activeKind.includes('text')) {
    const textBatch = await callTool('photoshop.tools.batch_call', {
      calls: [{ name: 'setTextContent', arguments: { content: 'MCP preflight probe' } }],
      continueOnError: true,
      allowWrites: true,
      allowRisky: false,
      delayMs: 50
    });
    const textOutcome = textBatch?.results?.[0]?.stage === 'preflight' ? 'pass' : 'fail';
    scenarios.push({
      name: 'text-preflight',
      expected: 'Text tool should fail in preflight when no active text layer is selected',
      outcome: textOutcome,
      payload: textBatch
    });
  } else {
    scenarios.push({
      name: 'text-preflight',
      expected: 'Skipped because active layer is already a text layer',
      outcome: 'skip',
      payload: { activeKind }
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    systemStatus,
    diagnose,
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
