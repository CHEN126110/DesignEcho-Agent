/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'scene-selected-element-context-disposable.json');
const MD_OUT = path.join(TMP_DIR, 'scene-selected-element-context-disposable.md');
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

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Scene Selected Element Context Disposable Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Disposable document: ${report.disposableDocument?.name || 'n/a'}`);
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.name}`);
    lines.push('');
    lines.push(`- Expected: ${scenario.expected}`);
    lines.push(`- Outcome: ${scenario.outcome}`);
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

function isUsableContext(payload) {
  return payload?.success === true
    && payload?.context?.selectedElement?.layerId > 0
    && payload?.context?.document?.id > 0;
}

async function main() {
  ensureDir(TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  if (!systemStatus?.pluginConnected) {
    throw new Error('Photoshop UXP plugin is not connected');
  }

  const documentList = await callTool('photoshop.tools.call', {
    name: 'listDocuments',
    arguments: {}
  });
  const openDocuments = Array.isArray(documentList?.documents) ? documentList.documents : [];
  if (openDocuments.length === 0) {
    const skippedReport = {
      generatedAt: new Date().toISOString(),
      endpoint,
      systemStatus,
      skipped: true,
      skipReason: 'No existing Photoshop document is open; skipping disposable smoke to avoid leaving a temporary last document open.'
    };
    fs.writeFileSync(JSON_OUT, JSON.stringify(skippedReport, null, 2));
    fs.writeFileSync(MD_OUT, `# Scene Selected Element Context Disposable Smoke\n\n- Skipped: ${skippedReport.skipReason}\n`);
    console.log(`[smoke-scene-selected-element-context-disposable] skipped: ${skippedReport.skipReason}`);
    return;
  }

  const stamp = Date.now();
  const docName = `Scene-Context-Smoke-${stamp}`;
  let createdDoc = null;
  let createdRectangle = null;
  let createdText = null;

  try {
    createdDoc = await callTool('photoshop.tools.call', {
      name: 'createDocument',
      arguments: {
        width: 400,
        height: 240,
        name: docName,
        backgroundColor: 'white'
      }
    });
    if (createdDoc?.success !== true || typeof createdDoc?.documentId !== 'number') {
      throw new Error(`createDocument failed: ${asJson(createdDoc)}`);
    }

    createdRectangle = await callTool('photoshop.tools.call', {
      name: 'createRectangle',
      arguments: {
        x: 30,
        y: 30,
        width: 160,
        height: 90,
        name: 'Scene Smoke Rectangle',
        fillColorHex: '#88AADD'
      }
    });
    if (createdRectangle?.success !== true || typeof createdRectangle?.layerId !== 'number') {
      throw new Error(`createRectangle failed: ${asJson(createdRectangle)}`);
    }

    createdText = await callTool('photoshop.tools.call', {
      name: 'createTextLayer',
      arguments: {
        content: 'Scene Context Smoke',
        x: 60,
        y: 160,
        name: 'Scene Smoke Text',
        fontSize: 24
      }
    });
    if (createdText?.success !== true || typeof createdText?.layerId !== 'number') {
      throw new Error(`createTextLayer failed: ${asJson(createdText)}`);
    }

    await callTool('photoshop.tools.call', {
      name: 'selectLayer',
      arguments: { layerId: createdText.layerId }
    });
    const textContext = await callTool('scene.get_selected_element_context', {
      includeText: true,
      includeDetailContext: false
    });

    await callTool('photoshop.tools.call', {
      name: 'selectLayer',
      arguments: { layerId: createdRectangle.layerId }
    });
    const shapeContext = await callTool('scene.get_selected_element_context', {
      includeText: true,
      includeDetailContext: false
    });

    const scenarios = [
      {
        name: 'selected-text-layer-context',
        expected: 'Selected text layer context should include text content and hierarchy metadata.',
        outcome: isUsableContext(textContext) && textContext?.context?.text?.content === 'Scene Context Smoke' ? 'pass' : 'fail',
        payload: textContext
      },
      {
        name: 'selected-shape-layer-context',
        expected: 'Selected shape layer context should include identity, bounds, and relations without text payload.',
        outcome: isUsableContext(shapeContext) && shapeContext?.context?.selectedElement?.kind === 'shape' ? 'pass' : 'fail',
        payload: shapeContext
      }
    ];

    const report = {
      generatedAt: new Date().toISOString(),
      endpoint,
      systemStatus,
      disposableDocument: createdDoc?.document || createdDoc,
      scenarios
    };

    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    fs.writeFileSync(MD_OUT, renderMarkdown(report));

    console.log(`Wrote ${JSON_OUT}`);
    console.log(`Wrote ${MD_OUT}`);
    console.log(JSON.stringify({
      connected: systemStatus?.pluginConnected === true,
      scenarios: scenarios.map((item) => ({ name: item.name, outcome: item.outcome }))
    }, null, 2));
  } finally {
    if (createdDoc?.documentId) {
      const cleanup = await callTool('photoshop.tools.call', {
        name: 'closeDocument',
        arguments: { documentId: createdDoc.documentId, save: false }
      }).catch(error => ({ success: false, error: error?.message || String(error) }));
      try {
        const existing = fs.existsSync(JSON_OUT)
          ? JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'))
          : {
              generatedAt: new Date().toISOString(),
              endpoint,
              systemStatus,
              disposableDocument: createdDoc?.document || createdDoc,
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
