/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-replace-export-disposable.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-replace-export-disposable.md');
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

async function createFixtureImage(filePath) {
  await sharp({
    create: {
      width: 96,
      height: 72,
      channels: 3,
      background: { r: 78, g: 150, b: 255 }
    }
  })
    .png()
    .toFile(filePath);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Replace/Export Disposable Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Disposable document: ${report.disposableDocument?.name || 'n/a'}`);
  lines.push(`- Fixture image: ${report.fixtureImage || 'n/a'}`);
  lines.push(`- Export directory: ${report.exportDirectory || 'n/a'}`);
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
  const fixtureImagePath = path.join(TMP_DIR, `mcp-placeholder-fixture-${stamp}.png`);
  const exportDirectory = path.join(TMP_DIR, `mcp-batch-export-${stamp}`);
  fs.mkdirSync(exportDirectory, { recursive: true });
  await createFixtureImage(fixtureImagePath);

  const setup = {};
  let createdDoc = null;
  let placeholderLayer = null;
  let replaceResult = null;
  let exportResult = null;
  let cleanup = null;

  try {
    createdDoc = await callTool('photoshop.tools.call', {
      name: 'createDocument',
      arguments: {
        width: 320,
        height: 240,
        name: `MCP-Replace-Export-Smoke-${stamp}`,
        backgroundColor: 'white'
      }
    });
    setup.createDocument = createdDoc;
    if (!isSuccessResult(createdDoc, 'document') || typeof createdDoc?.documentId !== 'number') {
      throw new Error(`createDocument failed contract check: ${asJson(createdDoc)}`);
    }

    placeholderLayer = await callTool('photoshop.tools.call', {
      name: 'createRectangle',
      arguments: {
        x: 40,
        y: 40,
        width: 160,
        height: 120,
        fillColorHex: '#CCCCCC',
        name: 'Replace Export Placeholder'
      }
    });
    setup.createRectangle = placeholderLayer;
    if (!isSuccessResult(placeholderLayer, 'shape') || typeof placeholderLayer?.layerId !== 'number') {
      throw new Error(`createRectangle failed contract check: ${asJson(placeholderLayer)}`);
    }

    replaceResult = await callTool('photoshop.tools.call', {
      name: 'replaceImagePlaceholder',
      arguments: {
        targetLayerId: placeholderLayer.layerId,
        imagePath: fixtureImagePath,
        fit: 'cover',
        align: 'center'
      }
    });
    setup.replaceImagePlaceholder = replaceResult;
    if (!isSuccessResult(replaceResult, 'image-placeholder-replacement') || typeof replaceResult?.layerId !== 'number') {
      throw new Error(`replaceImagePlaceholder failed contract check: ${asJson(replaceResult)}`);
    }

    exportResult = await callTool('photoshop.tools.call', {
      name: 'batchExport',
      arguments: {
        outputDirectory: exportDirectory,
        format: 'png',
        presets: [
          { width: 200, height: 150, suffix: '_main' },
          { width: 120, height: 0, suffix: '_detail' }
        ]
      }
    });
    setup.batchExport = exportResult;
    if (!isSuccessResult(exportResult, 'export-batch') || exportResult?.exportedCount !== 2 || !Array.isArray(exportResult?.exportedFiles)) {
      throw new Error(`batchExport failed contract check: ${asJson(exportResult)}`);
    }

    const missingFiles = exportResult.exportedFiles.filter(item => !fs.existsSync(item.filePath));
    if (missingFiles.length > 0) {
      throw new Error(`batchExport reported files that do not exist: ${asJson(missingFiles)}`);
    }

    const scenarios = [
      {
        name: 'replace-image-placeholder-contract',
        expected: 'replaceImagePlaceholder should accept targetLayerId and imagePath and return the normalized replacement contract',
        outcome: 'pass',
        payload: replaceResult
      },
      {
        name: 'batch-export-contract',
        expected: 'batchExport should export files silently to outputDirectory and return the normalized batch contract',
        outcome: 'pass',
        payload: exportResult
      }
    ];

    const report = {
      generatedAt: new Date().toISOString(),
      endpoint,
      systemStatus,
      disposableDocument: createdDoc,
      fixtureImage: fixtureImagePath,
      exportDirectory,
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
    try {
      if (createdDoc?.documentId) {
        cleanup = await callTool('photoshop.tools.call', {
          name: 'closeDocument',
          arguments: { documentId: createdDoc.documentId, save: false }
        });
      }
    } catch (error) {
      cleanup = { success: false, error: error?.message || String(error) };
    }

    try {
      if (fs.existsSync(fixtureImagePath)) {
        fs.rmSync(fixtureImagePath, { force: true });
      }
      if (fs.existsSync(exportDirectory)) {
        fs.rmSync(exportDirectory, { recursive: true, force: true });
      }
    } catch {
      // best effort only
    }

    try {
      const existing = fs.existsSync(JSON_OUT)
        ? JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'))
        : {
            generatedAt: new Date().toISOString(),
            endpoint,
            systemStatus,
            disposableDocument: createdDoc,
            fixtureImage: fixtureImagePath,
            exportDirectory,
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

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
