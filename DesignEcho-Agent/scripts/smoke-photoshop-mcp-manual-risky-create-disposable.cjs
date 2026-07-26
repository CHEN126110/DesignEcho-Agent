/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-create-disposable.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-create-disposable.md');
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
  return parseToolResult(await rpc('tools/call', {
    name,
    arguments: args
  }));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Create Disposable Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Disposable document: ${report.disposableDocument?.name || 'n/a'}`);
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

function isSuccessResult(payload, expectedEntityType) {
  return payload?.success === true && payload?.entityType === expectedEntityType;
}

async function main() {
  ensureDir(TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  if (!systemStatus?.pluginConnected) {
    throw new Error('Photoshop UXP plugin is not connected');
  }

  const stamp = Date.now();
  const docName = `MCP-Create-Smoke-${stamp}`;
  const setup = {};
  let createdDoc = null;
  let createdRectangle = null;
  let createdEllipse = null;
  let createdText = null;
  let createdGroup = null;

  try {
    createdDoc = await callTool('photoshop.tools.call', {
      name: 'createDocument',
      arguments: {
        width: 400,
        height: 300,
        name: docName,
        backgroundColor: 'white'
      }
    });
    setup.createDocument = createdDoc;
    const disposableDocument = createdDoc?.document || createdDoc;
    if (!isSuccessResult(createdDoc, 'document') || typeof createdDoc?.documentId !== 'number') {
      throw new Error(`createDocument failed contract check: ${asJson(createdDoc)}`);
    }

    createdRectangle = await callTool('photoshop.tools.call', {
      name: 'createRectangle',
      arguments: {
        x: 30,
        y: 40,
        width: 120,
        height: 90,
        fillColorHex: '#8899AA',
        name: 'Create Smoke Rectangle'
      }
    });
    setup.createRectangle = createdRectangle;
    if (!isSuccessResult(createdRectangle, 'shape') || typeof createdRectangle?.layerId !== 'number') {
      throw new Error(`createRectangle failed contract check: ${asJson(createdRectangle)}`);
    }

    createdEllipse = await callTool('photoshop.tools.call', {
      name: 'createEllipse',
      arguments: {
        x: 240,
        y: 90,
        width: 100,
        height: 80,
        fillColorHex: '#D8B8B8',
        name: 'Create Smoke Ellipse'
      }
    });
    setup.createEllipse = createdEllipse;
    if (!isSuccessResult(createdEllipse, 'shape') || typeof createdEllipse?.layerId !== 'number') {
      throw new Error(`createEllipse failed contract check: ${asJson(createdEllipse)}`);
    }

    createdText = await callTool('photoshop.tools.call', {
      name: 'createTextLayer',
      arguments: {
        content: 'MCP Create Smoke',
        x: 60,
        y: 180,
        fontSize: 24,
        alignment: 'left',
        name: 'Create Smoke Text'
      }
    });
    setup.createTextLayer = createdText;
    if (!isSuccessResult(createdText, 'text') || typeof createdText?.layerId !== 'number') {
      throw new Error(`createTextLayer failed contract check: ${asJson(createdText)}`);
    }

    createdGroup = await callTool('photoshop.tools.call', {
      name: 'createGroup',
      arguments: {
        groupName: 'Create Smoke Group',
        layerIds: [createdRectangle.layerId, createdEllipse.layerId, createdText.layerId]
      }
    });
    setup.createGroup = createdGroup;
    if (!isSuccessResult(createdGroup, 'group') || typeof createdGroup?.layerId !== 'number') {
      throw new Error(`createGroup failed contract check: ${asJson(createdGroup)}`);
    }

    const scenarios = [
      {
        name: 'create-document-contract',
        expected: 'createDocument should return the normalized document contract',
        outcome: 'pass',
        payload: createdDoc
      },
      {
        name: 'create-rectangle-contract',
        expected: 'createRectangle should return the normalized shape contract',
        outcome: 'pass',
        payload: createdRectangle
      },
      {
        name: 'create-ellipse-contract',
        expected: 'createEllipse should return the normalized shape contract',
        outcome: 'pass',
        payload: createdEllipse
      },
      {
        name: 'create-text-layer-contract',
        expected: 'createTextLayer should return the normalized text contract',
        outcome: 'pass',
        payload: createdText
      },
      {
        name: 'create-group-contract',
        expected: 'createGroup should return the normalized group contract and support explicit layerIds',
        outcome: 'pass',
        payload: createdGroup
      }
    ];

    const report = {
      generatedAt: new Date().toISOString(),
      endpoint,
      systemStatus,
      disposableDocument,
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
    if (disposableDocument?.documentId || disposableDocument?.id || createdDoc?.documentId) {
      const documentId = createdDoc?.documentId || disposableDocument?.id;
      const cleanup = await callTool('photoshop.tools.call', {
        name: 'closeDocument',
        arguments: { documentId, save: false }
      }).catch(error => ({ success: false, error: error?.message || String(error) }));
      try {
        const existing = fs.existsSync(JSON_OUT)
          ? JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'))
          : {
              generatedAt: new Date().toISOString(),
              endpoint,
              systemStatus,
              disposableDocument,
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
