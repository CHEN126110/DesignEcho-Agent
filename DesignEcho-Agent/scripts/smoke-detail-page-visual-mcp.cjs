/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const reportJsonPath = path.join(__dirname, '..', 'tmp', 'detail-page-visual-mcp-smoke.json');
const reportMdPath = path.join(__dirname, '..', 'tmp', 'detail-page-visual-mcp-smoke.md');

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
    '# Detail Page Visual MCP Smoke',
    '',
    `- Endpoint: ${endpoint}`,
    `- Time: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- inspectVisualModules: ${report.inspectVisualModules.success ? 'pass' : 'fail'}`,
    `- inspectScreenBoundaries: ${report.inspectScreenBoundaries.success ? 'pass' : 'fail'}`,
    `- auditSegmentationMerge: ${report.auditSegmentationMerge.success ? 'pass' : 'fail'}`,
    `- captureVisualContextBundle: ${report.captureVisualContextBundle.success ? 'pass' : 'fail'}`,
    `- visualModulesResource: ${report.visualModulesResource.success ? 'pass' : 'fail'}`,
    `- screenBoundariesResource: ${report.screenBoundariesResource.success ? 'pass' : 'fail'}`,
    `- segmentationMergeResource: ${report.segmentationMergeResource.success ? 'pass' : 'fail'}`,
    `- visualContextBundleResource: ${report.visualContextBundleResource.success ? 'pass' : 'fail'}`,
    `- visualSegmentationPrompt: ${report.visualSegmentationPrompt.success ? 'pass' : 'fail'}`,
    '',
    '## inspect_visual_modules',
    '',
    '```json',
    JSON.stringify(report.inspectVisualModules.payload, null, 2),
    '```',
    '',
    '## inspect_screen_boundaries',
    '',
    '```json',
    JSON.stringify(report.inspectScreenBoundaries.payload, null, 2),
    '```',
    '',
    '## audit_segmentation_merge',
    '',
    '```json',
    JSON.stringify(report.auditSegmentationMerge.payload, null, 2),
    '```'
  ];

  fs.writeFileSync(reportMdPath, lines.join('\n'), 'utf8');
}

async function main() {
  const report = {
    skipped: false,
    skipReason: '',
    inspectVisualModules: { success: false, payload: null },
    inspectScreenBoundaries: { success: false, payload: null },
    auditSegmentationMerge: { success: false, payload: null },
    captureVisualContextBundle: { success: false, payload: null },
    visualModulesResource: { success: false },
    screenBoundariesResource: { success: false },
    segmentationMergeResource: { success: false },
    visualContextBundleResource: { success: false },
    visualSegmentationPrompt: { success: false }
  };

  const systemStatus = await callTool('system.status', {});
  if (systemStatus?.pluginConnected !== true) {
    report.skipped = true;
    report.skipReason = 'Photoshop UXP plugin is not connected';
    writeReport(report);
    console.log(`[smoke-detail-page-visual-mcp] skipped: ${report.skipReason}`);
    return;
  }

  const inspectVisualModules = await callTool('detail.inspect_visual_modules', {});
  report.inspectVisualModules = { success: inspectVisualModules?.success === true, payload: inspectVisualModules };

  const inspectScreenBoundaries = await callTool('detail.inspect_screen_boundaries', {});
  report.inspectScreenBoundaries = { success: inspectScreenBoundaries?.success === true, payload: inspectScreenBoundaries };

  const auditSegmentationMerge = await callTool('detail.audit_segmentation_merge', {});
  report.auditSegmentationMerge = { success: auditSegmentationMerge?.success === true, payload: auditSegmentationMerge };

  const captureVisualContextBundle = await callTool('detail.capture_visual_context_bundle', {});
  report.captureVisualContextBundle = { success: captureVisualContextBundle?.success === true, payload: captureVisualContextBundle };

  const visualModulesResource = await readResource('designecho://detail/visual-modules');
  report.visualModulesResource.success = visualModulesResource?.success === true;

  const screenBoundariesResource = await readResource('designecho://detail/screen-boundaries');
  report.screenBoundariesResource.success = screenBoundariesResource?.success === true;

  const segmentationMergeResource = await readResource('designecho://detail/segmentation-merge');
  report.segmentationMergeResource.success = segmentationMergeResource?.success === true;

  const visualContextBundleResource = await readResource('designecho://detail/visual-context-bundle');
  report.visualContextBundleResource.success = visualContextBundleResource?.success === true;

  const visualSegmentationPrompt = await getPrompt('detail-page-visual-segmentation-audit', {});
  report.visualSegmentationPrompt.success = Array.isArray(visualSegmentationPrompt?.messages) && visualSegmentationPrompt.messages.length > 0;

  writeReport(report);

  console.log(`[smoke-detail-page-visual-mcp] report: ${reportJsonPath}`);
  console.log(`[inspectVisualModules] modules=${inspectVisualModules?.summary?.visualModuleCount || 0} screens=${inspectVisualModules?.summary?.screenCount || 0}`);
  console.log(`[inspectScreenBoundaries] parsed=${inspectScreenBoundaries?.summary?.parsedScreenCount || 0} visual=${inspectScreenBoundaries?.summary?.visualScreenCount || 0} merge=${inspectScreenBoundaries?.summary?.mergeStatus || 'unknown'}`);
  console.log(`[auditSegmentationMerge] status=${auditSegmentationMerge?.audit?.status || 'unknown'} lowOverlap=${auditSegmentationMerge?.audit?.summary?.lowOverlapScreenCount || 0} unmatchedVisual=${auditSegmentationMerge?.audit?.summary?.unmatchedVisualScreenCount || 0}`);
  console.log('PASS: detail-page visual MCP smoke test');
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
