/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-acceptance-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-acceptance-live-smoke.md');
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
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
    });
  } catch (error) {
    throw new Error(`${method} could not reach MCP endpoint ${endpoint}: ${error?.message || String(error)}`);
  }
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

function extractSnapshot(payload) {
  if (payload && typeof payload === 'object' && payload.snapshot) {
    return payload.snapshot;
  }
  return payload;
}

function summarizeSnapshot(payload) {
  const snapshot = extractSnapshot(payload);
  return {
    success: payload?.success !== false,
    hasDocument: snapshot?.hasDocument === true,
    documentName: snapshot?.documentName || snapshot?.document?.name || null,
    totalLayers: snapshot?.summary?.totalLayers ?? null,
    selectedLayerIds: Array.isArray(snapshot?.selectedLayerIds) ? snapshot.selectedLayerIds : [],
    warningCount: Array.isArray(snapshot?.warnings) ? snapshot.warnings.length : 0
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop Acceptance Live Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Direct snapshot success: ${report.directSnapshotSummary.success ? 'yes' : 'no'}`);
  lines.push(`- Tool snapshot success: ${report.toolSnapshotSummary.success ? 'yes' : 'no'}`);
  lines.push(`- Active document: ${report.directSnapshotSummary.documentName || report.toolSnapshotSummary.documentName || 'none'}`);
  lines.push(`- Total layers: ${report.directSnapshotSummary.totalLayers ?? report.toolSnapshotSummary.totalLayers ?? 'unknown'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({
    outcome: report.outcome,
    directSnapshotSummary: report.directSnapshotSummary,
    toolSnapshotSummary: report.toolSnapshotSummary,
    notes: report.notes
  }, null, 2));
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

  const snapshotArgs = {
    includeHidden: true,
    includeBounds: true,
    includeText: true,
    maxLayers: 120
  };

  const directSnapshot = await callTool('photoshop.acceptance_snapshot', snapshotArgs);
  const toolSnapshot = await callTool('photoshop.tools.call', {
    name: 'getAcceptanceSnapshot',
    arguments: snapshotArgs
  });

  const directSnapshotSummary = summarizeSnapshot(directSnapshot);
  const toolSnapshotSummary = summarizeSnapshot(toolSnapshot);
  const directShapeOk = typeof directSnapshotSummary.hasDocument === 'boolean';
  const toolShapeOk = typeof toolSnapshotSummary.hasDocument === 'boolean';
  const outcome = directSnapshotSummary.success && toolSnapshotSummary.success && directShapeOk && toolShapeOk
    ? 'pass'
    : 'fail';
  const notes = [];
  if (!directSnapshotSummary.hasDocument || !toolSnapshotSummary.hasDocument) {
    notes.push('Snapshot tool is reachable, but no active Photoshop document was reported.');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    systemStatus,
    directSnapshotSummary,
    toolSnapshotSummary,
    outcome,
    notes
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: systemStatus?.pluginConnected === true,
    outcome,
    directSnapshotSummary,
    toolSnapshotSummary,
    notes
  }, null, 2));

  if (outcome !== 'pass') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
