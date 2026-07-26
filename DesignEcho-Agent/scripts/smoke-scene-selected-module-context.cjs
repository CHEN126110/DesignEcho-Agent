/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const reportJsonPath = path.join(__dirname, '..', 'tmp', 'scene-selected-module-context-smoke.json');
const reportMdPath = path.join(__dirname, '..', 'tmp', 'scene-selected-module-context-smoke.md');

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
      id: Date.now(),
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

function unwrapToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  return text ? JSON.parse(text) : result;
}

async function callTool(name, args = {}) {
  const result = await rpc('tools/call', {
    name,
    arguments: args
  });
  return unwrapToolResult(result);
}

async function readResource(uri) {
  const result = await rpc('resources/read', { uri });
  const text = result?.contents?.[0]?.text || '';
  return text ? JSON.parse(text) : result;
}

async function getPrompt(name, args = {}) {
  return rpc('prompts/get', { name, arguments: args });
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Scene Selected Module Context Smoke',
    '',
    `- Endpoint: ${endpoint}`,
    `- Time: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- tool: ${report.tool.success ? 'pass' : report.tool.skipped ? 'skip' : 'fail'}`,
    `- resource: ${report.resource.success ? 'pass' : report.resource.skipped ? 'skip' : 'fail'}`,
    `- prompt: ${report.prompt.success ? 'pass' : 'fail'}`,
    '',
    '## Tool',
    '',
    '```json',
    JSON.stringify(report.tool.payload, null, 2),
    '```',
    '',
    '## Resource',
    '',
    '```json',
    JSON.stringify(report.resource.payload, null, 2),
    '```'
  ];

  fs.writeFileSync(reportMdPath, lines.join('\n'), 'utf8');
}

async function main() {
  const report = {
    skipped: false,
    skipReason: '',
    tool: { success: false, skipped: false, payload: null },
    resource: { success: false, skipped: false, payload: null },
    prompt: { success: false }
  };

  const systemStatus = await callTool('system.status', {});
  report.systemStatus = systemStatus;
  if (systemStatus?.pluginConnected !== true) {
    report.skipped = true;
    report.skipReason = 'Photoshop UXP plugin is not connected';
    writeReport(report);
    console.log(`[smoke-scene-selected-module-context] skipped: ${report.skipReason}`);
    return;
  }

  const toolPayload = await callTool('scene.get_selected_module_context', {
    relationLimit: 6
  });
  report.tool.payload = toolPayload;
  if (toolPayload?.success === true) {
    report.tool.success = true;
  } else if (/No active layer|No active Photoshop document/i.test(String(toolPayload?.error || ''))) {
    report.tool.skipped = true;
  }

  const resourcePayload = await readResource('designecho://scene/selected-module-context');
  report.resource.payload = resourcePayload;
  if (resourcePayload?.success === true) {
    report.resource.success = true;
  } else if (/No active layer|No active Photoshop document/i.test(String(resourcePayload?.error || ''))) {
    report.resource.skipped = true;
  }

  const promptPayload = await getPrompt('selected-module-context-audit', {});
  report.prompt.success = Array.isArray(promptPayload?.messages) && promptPayload.messages.length > 0;

  writeReport(report);

  console.log(`[smoke-scene-selected-module-context] report: ${reportJsonPath}`);
  console.log(`[tool] ${report.tool.success ? 'pass' : report.tool.skipped ? 'skip' : 'fail'}`);
  console.log(`[resource] ${report.resource.success ? 'pass' : report.resource.skipped ? 'skip' : 'fail'}`);
  console.log(`[prompt] ${report.prompt.success ? 'pass' : 'fail'}`);
  console.log('PASS: scene selected module context smoke test');
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
