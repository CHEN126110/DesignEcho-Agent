/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-effects-disposable.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-effects-disposable.md');
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

async function batchCall(calls) {
  return callTool('photoshop.tools.batch_call', {
    calls,
    continueOnError: true,
    allowWrites: true,
    allowRisky: true,
    delayMs: 450
  });
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Effects Disposable Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Disposable document: ${report.disposableDocument?.name || 'n/a'}`);
  lines.push(`- Disposable layer id: ${report.disposableLayer?.layerId || 'n/a'}`);
  lines.push('');
  lines.push('## Setup');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.setup, null, 2));
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
  if (report.cleanup) {
    lines.push('## Cleanup');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(report.cleanup, null, 2));
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

  const stamp = Date.now();
  const docName = `MCP-Effects-Smoke-${stamp}`;
  const setup = {};
  let createdDoc = null;
  let createdLayer = null;
  let cleanup = null;

  try {
    createdDoc = await callTool('photoshop.tools.call', {
      name: 'createDocument',
      arguments: {
        width: 320,
        height: 320,
        name: docName,
        backgroundColor: 'white'
      }
    });
    setup.createDocument = createdDoc;
    const disposableDocument = createdDoc?.document || createdDoc;
    if (!createdDoc?.success || typeof disposableDocument?.id !== 'number') {
      throw new Error(`createDocument failed: ${asJson(createdDoc)}`);
    }

    createdLayer = await callTool('photoshop.tools.call', {
      name: 'createRectangle',
      arguments: {
        x: 40,
        y: 40,
        width: 180,
        height: 140,
        fillColorHex: '#8899AA',
        name: 'MCP Effects Shape'
      }
    });
    setup.createRectangle = createdLayer;
    if (!createdLayer?.success || typeof createdLayer.layerId !== 'number') {
      throw new Error(`createRectangle failed: ${asJson(createdLayer)}`);
    }

    const layerId = createdLayer.layerId;
    const scenarios = [];

    const validStroke = await batchCall([
      { name: 'addStroke', arguments: { layerId, size: 4, position: 'center', opacity: 100, color: { r: 255, g: 0, b: 0 } } }
    ]);
    scenarios.push({
      name: 'valid-stroke',
      expected: 'addStroke should execute successfully on disposable shape layer',
      outcome: validStroke?.success ? 'pass' : 'fail',
      payload: validStroke
    });

    const validShadow = await batchCall([
      { name: 'addDropShadow', arguments: { layerId, opacity: 60, angle: 120, distance: 6, spread: 0, size: 8, color: { r: 0, g: 0, b: 0 } } }
    ]);
    scenarios.push({
      name: 'valid-drop-shadow',
      expected: 'addDropShadow should execute successfully on disposable shape layer',
      outcome: validShadow?.success ? 'pass' : 'fail',
      payload: validShadow
    });

    const validGlow = await batchCall([
      { name: 'addGlow', arguments: { layerId, opacity: 55, size: 7, spread: 0, color: { r: 255, g: 255, b: 255 } } }
    ]);
    scenarios.push({
      name: 'valid-glow',
      expected: 'addGlow should execute successfully on disposable shape layer',
      outcome: validGlow?.success ? 'pass' : 'fail',
      payload: validGlow
    });

    const validGradient = await batchCall([
      { name: 'addGradientOverlay', arguments: { layerId, startColor: { r: 255, g: 255, b: 255 }, endColor: { r: 180, g: 200, b: 220 }, angle: 90, opacity: 100 } }
    ]);
    scenarios.push({
      name: 'valid-gradient-overlay',
      expected: 'addGradientOverlay should execute successfully on disposable shape layer',
      outcome: validGradient?.success ? 'pass' : 'fail',
      payload: validGradient
    });

    const validFill = await batchCall([
      { name: 'setLayerFill', arguments: { layerId, color: { r: 34, g: 88, b: 144 } } }
    ]);
    scenarios.push({
      name: 'valid-set-layer-fill',
      expected: 'setLayerFill should execute successfully on disposable shape layer',
      outcome: validFill?.success ? 'pass' : 'fail',
      payload: validFill
    });

    const clearEffects = await batchCall([
      { name: 'clearLayerEffects', arguments: { layerId } }
    ]);
    scenarios.push({
      name: 'clear-layer-effects',
      expected: 'clearLayerEffects should execute successfully on disposable shape layer',
      outcome: clearEffects?.success ? 'pass' : 'fail',
      payload: clearEffects
    });

    const report = {
      generatedAt: new Date().toISOString(),
      endpoint,
      systemStatus,
      disposableDocument,
      disposableLayer: createdLayer,
      setup,
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
  } finally {
    const disposableDocument = createdDoc?.document || createdDoc;
    if (disposableDocument?.id) {
      cleanup = await callTool('photoshop.tools.call', {
        name: 'closeDocument',
        arguments: { documentId: disposableDocument.id, save: false }
      }).catch(error => ({ success: false, error: error?.message || String(error) }));
      try {
        const existing = fs.existsSync(JSON_OUT)
          ? JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'))
          : {
              generatedAt: new Date().toISOString(),
              endpoint,
              systemStatus,
              disposableDocument,
              disposableLayer: createdLayer,
              setup,
              scenarios: []
            };
        existing.cleanup = cleanup;
        fs.writeFileSync(JSON_OUT, JSON.stringify(existing, null, 2));
        fs.writeFileSync(MD_OUT, renderMarkdown(existing));
      } catch {
        // cleanup reporting is best effort only
      }
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
