/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-effects.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-effects.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const EFFECT_TOOLS = [
  'addDropShadow',
  'addGlow',
  'addGradientOverlay',
  'addStroke',
  'clearLayerEffects',
  'setLayerFill'
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
  lines.push('# Photoshop MCP Manual-Risky Effects Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Active document: ${report.diagnose?.state?.documentInfo?.name || 'none'}`);
  lines.push(`- Active layer kind: ${report.activeLayer?.kind || 'none'}`);
  lines.push(`- Active layer locked: ${report.activeLayer?.locked === true ? 'yes' : 'no'}`);
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

async function batchCall(calls) {
  return callTool('photoshop.tools.batch_call', {
    calls,
    continueOnError: true,
    allowWrites: true,
    allowRisky: true,
    delayMs: 120
  });
}

function hasPreflightFailure(result) {
  return Array.isArray(result?.results) && result.results[0]?.stage === 'preflight';
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
  const selectedLayers = Array.isArray(state.selectedLayers) ? state.selectedLayers : [];
  const activeLayer = selectedLayers[0] || null;
  const activeKind = String(activeLayer?.kind || '').toLowerCase();
  const hasActiveLayer = !!activeLayer;
  const isShapeLike = activeKind.includes('shape') || activeKind.includes('solid') || activeKind.includes('fill');

  const policy = await callTool('photoshop.batch_policy', { names: EFFECT_TOOLS });
  const scenarios = [];

  if (!hasActiveLayer) {
    const missingTarget = await batchCall([
      { name: 'addDropShadow', arguments: {} }
    ]);
    scenarios.push({
      name: 'missing-target',
      expected: 'Preflight should reject effect call when no active layer is available',
      outcome: hasPreflightFailure(missingTarget) ? 'pass' : 'fail',
      payload: missingTarget
    });
  } else {
    const invalidStroke = await batchCall([
      { name: 'addStroke', arguments: { size: 0 } }
    ]);
    scenarios.push({
      name: 'invalid-stroke-size',
      expected: 'Preflight should reject stroke size <= 0',
      outcome: hasPreflightFailure(invalidStroke) ? 'pass' : 'fail',
      payload: invalidStroke
    });

    const invalidShadowOpacity = await batchCall([
      { name: 'addDropShadow', arguments: { opacity: 150 } }
    ]);
    scenarios.push({
      name: 'invalid-shadow-opacity',
      expected: 'Preflight should reject drop shadow opacity outside 0-100',
      outcome: hasPreflightFailure(invalidShadowOpacity) ? 'pass' : 'fail',
      payload: invalidShadowOpacity
    });

    const missingGradientColors = await batchCall([
      { name: 'addGradientOverlay', arguments: {} }
    ]);
    scenarios.push({
      name: 'missing-gradient-colors',
      expected: 'Preflight should reject gradient overlay without startColor/endColor',
      outcome: hasPreflightFailure(missingGradientColors) ? 'pass' : 'fail',
      payload: missingGradientColors
    });

    const invalidFillPayload = await batchCall([
      { name: 'setLayerFill', arguments: { color: { r: 12, g: 34 } } }
    ]);
    scenarios.push({
      name: 'invalid-fill-payload',
      expected: 'Preflight should reject incomplete RGB payload',
      outcome: hasPreflightFailure(invalidFillPayload) ? 'pass' : 'fail',
      payload: invalidFillPayload
    });

    if (!isShapeLike) {
      const unsupportedFillTarget = await batchCall([
        { name: 'setLayerFill', arguments: { color: { r: 12, g: 34, b: 56 } } }
      ]);
      scenarios.push({
        name: 'unsupported-fill-target',
        expected: 'Preflight should reject setLayerFill on non-shape active layers',
        outcome: hasPreflightFailure(unsupportedFillTarget) ? 'pass' : 'fail',
        payload: unsupportedFillTarget,
        notes: `Active layer kind: ${activeKind || 'unknown'}`
      });
    } else {
      scenarios.push({
        name: 'unsupported-fill-target',
        expected: 'Skipped because current active layer looks fill-capable',
        outcome: 'skip',
        payload: { activeKind }
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    systemStatus,
    diagnose,
    activeLayer,
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
