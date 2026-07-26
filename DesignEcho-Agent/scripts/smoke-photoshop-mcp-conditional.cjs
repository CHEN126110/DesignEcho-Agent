/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-conditional-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-conditional-smoke.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const PREFERRED_CONDITIONAL_READ_TOOLS = [
  'getAllTextLayers',
  'getLayerHierarchy',
  'getTemplateStructure',
  'detectLayerIssues',
  'analyzeLayout',
  'getAllClippingMasks',
  'getElementMapping'
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

function toolNamesFromRuntime(payload) {
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  return tools.map((tool) => String(tool?.name || '')).filter(Boolean);
}

function pickConditionalTools(runtimeNames, policy) {
  const available = new Set(runtimeNames);
  const conditional = new Set(
    (Array.isArray(policy?.policies) ? policy.policies : [])
      .filter((item) => item?.autoSmoke === 'conditional' && item?.kind === 'read')
      .map((item) => String(item.name))
  );

  return PREFERRED_CONDITIONAL_READ_TOOLS
    .filter((name) => available.has(name) && conditional.has(name))
    .slice(0, 3);
}

async function batchCall(calls) {
  return callTool('photoshop.tools.batch_call', {
    calls,
    continueOnError: true,
    allowWrites: false,
    allowRisky: false,
    delayMs: 150
  });
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Conditional Read Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Active document: ${report.diagnose?.state?.documentInfo?.name || 'none'}`);
  lines.push(`- Selected tools: ${report.selectedTools.length ? report.selectedTools.join(', ') : 'none'}`);
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.policy, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Batch Result');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.batchResult, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  ensureDir(TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  if (!systemStatus?.pluginConnected) {
    throw new Error('Photoshop UXP plugin is not connected');
  }

  const runtimeTools = await callTool('photoshop.tools.list', {});
  const runtimeNames = toolNamesFromRuntime(runtimeTools);
  const policy = await callTool('photoshop.batch_policy', { names: runtimeNames });
  const selectedTools = pickConditionalTools(runtimeNames, policy);
  const diagnose = await callTool('photoshop.tools.call', {
    name: 'diagnoseState',
    arguments: { verbose: false }
  });

  let batchResult = null;
  let outcome = 'skip';
  let notes = '';

  if (!selectedTools.length) {
    notes = 'No runtime conditional read tools were available from the preferred smoke set.';
  } else if (diagnose?.state?.hasDocument !== true) {
    notes = 'No active Photoshop document; conditional document-scope reads were not executed.';
  } else {
    batchResult = await batchCall(selectedTools.map((name) => ({ name, arguments: {} })));
    outcome = batchResult?.success ? 'pass' : 'fail';
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    systemStatus,
    runtimeToolCount: runtimeNames.length,
    selectedTools,
    diagnose,
    policy,
    batchResult,
    outcome,
    notes
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: systemStatus?.pluginConnected === true,
    selectedTools,
    outcome,
    notes
  }, null, 2));

  if (outcome === 'fail') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
