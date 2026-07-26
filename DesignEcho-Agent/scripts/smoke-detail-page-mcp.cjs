/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const reportJsonPath = path.join(__dirname, '..', 'tmp', 'detail-page-mcp-smoke.json');
const reportMdPath = path.join(__dirname, '..', 'tmp', 'detail-page-mcp-smoke.md');

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

function isPhotoshopBridgeTimeout(error) {
  return /MCP request timeout: tools\/call/i.test(String(error?.message || error || ''));
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
    '# Detail Page MCP Smoke',
    '',
    `- Endpoint: ${endpoint}`,
    `- Time: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- validateTemplateGraph: ${report.validateTemplateGraph.success ? 'pass' : 'fail'}`,
    `- inspectLivePlacements: ${report.inspectLivePlacements.success ? 'pass' : 'fail'}`,
    `- auditCopyLayout: ${report.auditCopyLayout.success ? 'pass' : 'fail'}`,
    `- templateGraphResource: ${report.templateGraphResource.success ? 'pass' : 'fail'}`,
    `- validationResource: ${report.validationResource.success ? 'pass' : 'fail'}`,
    `- livePlacementsResource: ${report.livePlacementsResource.success ? 'pass' : 'fail'}`,
    `- copyLayoutResource: ${report.copyLayoutResource.success ? 'pass' : 'fail'}`,
    `- designAuditPrompt: ${report.designAuditPrompt.success ? 'pass' : 'fail'}`,
    `- livePlacementPrompt: ${report.livePlacementPrompt.success ? 'pass' : 'fail'}`,
    `- copyLayoutPrompt: ${report.copyLayoutPrompt.success ? 'pass' : 'fail'}`,
    '',
    '## validate_template_graph',
    '',
    '```json',
    JSON.stringify(report.validateTemplateGraph.payload, null, 2),
    '```',
    '',
    '## inspect_live_placements',
    '',
    '```json',
    JSON.stringify(report.inspectLivePlacements.payload, null, 2),
    '```',
    '',
    '## audit_copy_layout',
    '',
    '```json',
    JSON.stringify(report.auditCopyLayout.payload, null, 2),
    '```'
  ];

  fs.writeFileSync(reportMdPath, lines.join('\n'), 'utf8');
}

async function main() {
  const report = {
    skipped: false,
    skipReason: '',
    validateTemplateGraph: { success: false, payload: null },
    inspectLivePlacements: { success: false, payload: null },
    auditCopyLayout: { success: false, payload: null },
    templateGraphResource: { success: false },
    validationResource: { success: false },
    livePlacementsResource: { success: false },
    copyLayoutResource: { success: false },
    designAuditPrompt: { success: false },
    livePlacementPrompt: { success: false },
    copyLayoutPrompt: { success: false }
  };

  const systemStatus = await callTool('system.status', {});
  if (systemStatus?.pluginConnected !== true) {
    report.skipped = true;
    report.skipReason = 'Photoshop UXP plugin is not connected';
    writeReport(report);
    console.log(`[smoke-detail-page-mcp] skipped: ${report.skipReason}`);
    return;
  }

  let validateTemplateGraph;
  let inspectLivePlacements;
  let auditCopyLayout;
  try {
    validateTemplateGraph = await callTool('detail.validate_template_graph', {});
    report.validateTemplateGraph = { success: validateTemplateGraph?.success === true, payload: validateTemplateGraph };

    inspectLivePlacements = await callTool('detail.inspect_live_placements', {});
    report.inspectLivePlacements = { success: inspectLivePlacements?.success === true, payload: inspectLivePlacements };

    auditCopyLayout = await callTool('detail.audit_copy_layout', {});
    report.auditCopyLayout = { success: auditCopyLayout?.success === true, payload: auditCopyLayout };
  } catch (error) {
    if (!isPhotoshopBridgeTimeout(error)) throw error;
    report.skipped = true;
    report.skipReason = 'Photoshop bridge is connected but not responding to detail-page tool calls';
    writeReport(report);
    console.log(`[smoke-detail-page-mcp] skipped: ${report.skipReason}`);
    return;
  }

  const templateGraphResource = await readResource('designecho://detail/template-graph');
  report.templateGraphResource.success = templateGraphResource?.success === true;

  const validationResource = await readResource('designecho://detail/template-validation');
  report.validationResource.success = validationResource?.success === true;

  const livePlacementsResource = await readResource('designecho://detail/live-placements');
  report.livePlacementsResource.success = livePlacementsResource?.success === true;

  const copyLayoutResource = await readResource('designecho://detail/copy-layout-audit');
  report.copyLayoutResource.success = copyLayoutResource?.success === true;

  const designAuditPrompt = await getPrompt('detail-page-design-audit', {});
  report.designAuditPrompt.success = Array.isArray(designAuditPrompt?.messages) && designAuditPrompt.messages.length > 0;

  const livePlacementPrompt = await getPrompt('detail-page-live-placement-audit', {});
  report.livePlacementPrompt.success = Array.isArray(livePlacementPrompt?.messages) && livePlacementPrompt.messages.length > 0;

  const copyLayoutPrompt = await getPrompt('detail-page-copy-layout-audit', {});
  report.copyLayoutPrompt.success = Array.isArray(copyLayoutPrompt?.messages) && copyLayoutPrompt.messages.length > 0;

  writeReport(report);

  console.log(`[smoke-detail-page-mcp] report: ${reportJsonPath}`);
  console.log(`[validateTemplateGraph] status=${validateTemplateGraph.status} screens=${validateTemplateGraph?.summary?.screenCount || 0} issues=${validateTemplateGraph?.summary?.issueCount || 0}`);
  console.log(`[inspectLivePlacements] placements=${inspectLivePlacements?.placementCount || 0} unmatched=${inspectLivePlacements?.unmatchedPlaceholders?.length || 0} risky=${inspectLivePlacements?.audit?.summary?.riskyPlacementCount || 0}`);
  console.log(`[auditCopyLayout] placeholders=${auditCopyLayout?.summary?.copyPlaceholderCount || 0} risky=${auditCopyLayout?.summary?.riskyCopyCount || 0} watch=${auditCopyLayout?.summary?.watchCopyCount || 0}`);
  console.log('PASS: detail-page MCP smoke test');
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
