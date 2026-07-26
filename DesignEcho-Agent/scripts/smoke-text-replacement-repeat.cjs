/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'text-replacement-repeat-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'text-replacement-repeat-smoke.md');
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
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.content) && typeof parsed.content[0]?.text === 'string') {
      try {
        return JSON.parse(parsed.content[0].text);
      } catch {
        return parsed;
      }
    }
    return parsed;
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

function getHeight(bounds) {
  if (!bounds) return null;
  if (typeof bounds.height === 'number') return bounds.height;
  if (typeof bounds.top === 'number' && typeof bounds.bottom === 'number') {
    return Math.max(0, bounds.bottom - bounds.top);
  }
  return null;
}

function getWidth(bounds) {
  if (!bounds) return null;
  if (typeof bounds.width === 'number') return bounds.width;
  if (typeof bounds.left === 'number' && typeof bounds.right === 'number') {
    return Math.max(0, bounds.right - bounds.left);
  }
  return null;
}

function ratio(current, baseline) {
  if (!baseline || !current) return null;
  return current / baseline;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Text Replacement Repeat Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Overall outcome: ${report.summary?.outcome || 'unknown'}`);
  lines.push('');
  lines.push('## Setup');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.setup, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Replacements');
  lines.push('');
  for (const step of report.steps || []) {
    lines.push(`### ${step.name}`);
    lines.push('');
    lines.push(`- Candidate: ${step.candidate}`);
    lines.push(`- Outcome: ${step.outcome}`);
    if (step.note) lines.push(`- Note: ${step.note}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(step, null, 2));
    lines.push('```');
    lines.push('');
  }
  if (report.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(report.summary, null, 2));
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
  const docName = `MCP-Text-Replace-Smoke-${stamp}`;
  const originalText = '经典格调复古简袜';
  const candidates = [
    '轻盈复古格纹简袜',
    '经典格调复古中筒',
    '舒适复古格子中筒'
  ];

  const setup = {};
  let createdDoc = null;
  let createdText = null;
  let transformResult = null;
  let initialAudit = null;
  const steps = [];

  try {
    createdDoc = await callTool('photoshop.tools.call', {
      name: 'createDocument',
      arguments: {
        width: 1600,
        height: 900,
        name: docName,
        backgroundColor: 'white'
      }
    });
    if (createdDoc?.success !== true || typeof createdDoc?.documentId !== 'number') {
      throw new Error(`createDocument failed: ${asJson(createdDoc)}`);
    }
    setup.createDocument = createdDoc;

    createdText = await callTool('photoshop.tools.call', {
      name: 'createTextLayer',
      arguments: {
        content: originalText,
        x: 220,
        y: 260,
        fontSize: 180,
        alignment: 'left',
        name: 'Text Replacement Smoke Layer'
      }
    });
    if (createdText?.success !== true || typeof createdText?.layerId !== 'number') {
      throw new Error(`createTextLayer failed: ${asJson(createdText)}`);
    }
    setup.createTextLayer = createdText;

    transformResult = await callTool('photoshop.tools.call', {
      name: 'transformLayer',
      arguments: {
        layerId: createdText.layerId,
        scaleUniform: 55
      }
    });
    setup.transformLayer = transformResult;

    initialAudit = await callTool('text.audit_replacement', {
      layerId: createdText.layerId,
      baselineContent: originalText,
      proposedContent: candidates[0]
    });
    if (initialAudit?.success !== true) {
      throw new Error(`initial audit failed: ${asJson(initialAudit)}`);
    }
    setup.initialAudit = initialAudit;

    const baselineHeight = getHeight(initialAudit.bounds);
    const baselineWidth = getWidth(initialAudit.bounds);
    const baselineFontSize = initialAudit.style?.fontSize ?? null;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const applyResult = await callTool('photoshop.tools.call', {
        name: 'setTextContent',
        arguments: {
          layerId: createdText.layerId,
          content: candidate,
          baselineContent: originalText
        }
      });

      const auditResult = await callTool('text.audit_replacement', {
        layerId: createdText.layerId,
        baselineContent: originalText,
        proposedContent: candidate
      });

      const currentHeight = getHeight(auditResult?.bounds);
      const currentWidth = getWidth(auditResult?.bounds);
      const currentFontSize = auditResult?.style?.fontSize ?? null;
      const heightRatio = ratio(currentHeight, baselineHeight);
      const widthRatio = ratio(currentWidth, baselineWidth);
      const fontSizeRatio = ratio(currentFontSize, baselineFontSize);
      const heightStable = heightRatio === null || (heightRatio >= 0.9 && heightRatio <= 1.1);
      const fontSizeStable = fontSizeRatio === null || (fontSizeRatio >= 0.98 && fontSizeRatio <= 1.02);

      steps.push({
        name: `apply-${index + 1}`,
        candidate,
        outcome: applyResult?.success === true && auditResult?.success === true && heightStable && fontSizeStable ? 'pass' : 'fail',
        note: !heightStable
          ? `Height drift detected: ratio=${heightRatio}`
          : (!fontSizeStable ? `Font size drift detected: ratio=${fontSizeRatio}` : ''),
        applyResult,
        auditResult,
        drift: {
          baselineHeight,
          currentHeight,
          heightRatio,
          baselineWidth,
          currentWidth,
          widthRatio,
          baselineFontSize,
          currentFontSize,
          fontSizeRatio
        }
      });
    }

    const failed = steps.filter(step => step.outcome !== 'pass');
    const report = {
      generatedAt: new Date().toISOString(),
      endpoint,
      systemStatus,
      setup,
      steps,
      summary: {
        outcome: failed.length === 0 ? 'pass' : 'fail',
        failedSteps: failed.map(step => step.name)
      }
    };

    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    fs.writeFileSync(MD_OUT, renderMarkdown(report));

    console.log(`Wrote ${JSON_OUT}`);
    console.log(`Wrote ${MD_OUT}`);
    console.log(JSON.stringify(report.summary, null, 2));

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    const documentId = createdDoc?.documentId || createdDoc?.document?.id;
    if (documentId) {
      const cleanup = await callTool('photoshop.tools.call', {
        name: 'closeDocument',
        arguments: { documentId, save: false }
      }).catch(error => ({ success: false, error: error?.message || String(error) }));

      const existing = fs.existsSync(JSON_OUT)
        ? JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'))
        : {
            generatedAt: new Date().toISOString(),
            endpoint,
            systemStatus,
            setup,
            steps,
            summary: { outcome: 'error' }
          };
      existing.cleanup = cleanup;
      fs.writeFileSync(JSON_OUT, JSON.stringify(existing, null, 2));
      fs.writeFileSync(MD_OUT, renderMarkdown(existing));
    }
  }
}

main().catch(error => {
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    error: error?.message || String(error)
  };
  ensureDir(TMP_DIR);
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));
  console.error(error);
  process.exit(1);
});
