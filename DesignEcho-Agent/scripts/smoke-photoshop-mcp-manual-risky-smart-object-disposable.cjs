/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-smart-object-disposable.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-smart-object-disposable.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DEFAULT_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_SMART_OBJECT_SMOKE_TIMEOUT_MS,
  12_000
);
const REPLACEMENT_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGMIXZX2HxkzkC4AAAc/JkH3uBWdAAAAAElFTkSuQmCC';
const REPLACE_CONTENTS_FLAG = 'DESIGNECHO_LIVE_SMART_OBJECT_REPLACE_CONTENTS';
const REQUIRED_PHOTOSHOP_TOOLS = [
  'createDocument',
  'createRectangle',
  'convertToSmartObject',
  'getSmartObjectInfo',
  'duplicateSmartObject',
  'rasterizeSmartObject',
  'closeDocument'
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

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

async function rpc(method, params = {}, options = {}) {
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${method} timed out after ${requestTimeoutMs}ms at ${endpoint}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
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
  return parseToolResult(await rpc('tools/call', {
    name,
    arguments: args
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callPhotoshopTool(name, args = {}) {
  return callTool('photoshop.tools.call', {
    name,
    arguments: args
  });
}

function isModalStatePayload(payload) {
  const category = payload?.errorDetails?.category;
  const message = payload?.error || payload?.message || payload?.errorDetails?.message || '';
  return category === 'modal_state'
    || /host is in a modal state|modal|模态状态|正在处理其他命令/i.test(String(message));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 250;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args);
      if (!isModalStatePayload(result) || attempt >= attempts) {
        if (result && typeof result === 'object') {
          result.__smokeAttempts = attempt;
        }
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isModalStatePayload(error) || attempt >= attempts) {
        throw error;
      }
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopTool(name, args);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Smart Object Disposable Smoke');
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
  if (Array.isArray(report.progress) && report.progress.length > 0) {
    lines.push('## Progress');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(report.progress, null, 2));
    lines.push('```');
    lines.push('');
  }
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

function isStructuredFailure(payload, toolName) {
  return payload?.success === false
    && payload?.errorDetails?.handledBy === 'tool-error-normalizer/v1'
    && payload?.errorDetails?.toolName === toolName;
}

function writeReplacementPng(filePath) {
  const bytes = Buffer.from(REPLACEMENT_PNG_BASE64, 'base64');
  assertValidReplacementPng(bytes);
  fs.writeFileSync(filePath, bytes);
}

function assertValidReplacementPng(bytes) {
  const signature = '89504e470d0a1a0a';
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('replacement PNG fixture has an invalid PNG signature');
  }

  let offset = 8;
  let hasIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const nextOffset = offset + 8 + length + 4;
    if (nextOffset > bytes.length) {
      throw new Error(`replacement PNG fixture has a truncated ${type || 'chunk'} chunk`);
    }
    if (type === 'IEND') {
      hasIend = true;
      if (length !== 0) {
        throw new Error('replacement PNG fixture has an invalid IEND length');
      }
      if (nextOffset !== bytes.length) {
        throw new Error('replacement PNG fixture has trailing bytes after IEND');
      }
      break;
    }
    offset = nextOffset;
  }

  if (!hasIend) {
    throw new Error('replacement PNG fixture is missing IEND');
  }
}

function writeReport(report) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));
}

function isReplaceContentsArmed() {
  return process.argv.includes('--replace-contents')
    || process.env[REPLACE_CONTENTS_FLAG] === '1';
}

function isRasterizeConfirmed() {
  return process.argv.includes('--rasterize-confirmed')
    || process.env.DESIGNECHO_CONFIRM_SMART_OBJECT_RASTERIZE === '1';
}

function getToolInputProperties(tool) {
  const inputSchema = tool?.inputSchema || tool?.parameters || tool?.schema?.inputSchema || tool?.schema?.parameters || {};
  return inputSchema?.properties || {};
}

function assertRasterizeRuntimeSchema(runtimeTools, report) {
  const tools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
  const rasterizeTool = tools.find((tool) => tool?.name === 'rasterizeSmartObject');
  const guard = {
    name: 'rasterizeSmartObject-runtime-schema',
    checkedAt: new Date().toISOString(),
    status: 'running'
  };

  function fail(reason, details = {}) {
    const failedGuard = {
      ...guard,
      ...details,
      status: 'failed',
      reason
    };
    report.runtimeGuards = [...(report.runtimeGuards || []), failedGuard];
    report.setup['preflight.rasterizeRuntimeSchema'] = failedGuard;
    writeReport(report);
    throw new Error(
      `Stale Photoshop UXP runtime: ${reason}. Reload the DesignEcho UXP plugin before running this live smart-object smoke.`
    );
  }

  if (!rasterizeTool) {
    fail('rasterizeSmartObject is missing from photoshop.tools.list', {
      availableToolCount: tools.length
    });
  }

  const properties = getToolInputProperties(rasterizeTool);
  const confirmationProperty = properties.destructiveRasterizeConfirmed;
  if (!confirmationProperty) {
    fail('rasterizeSmartObject schema lacks destructiveRasterizeConfirmed', {
      toolName: rasterizeTool.name,
      propertyNames: Object.keys(properties)
    });
  }

  if (confirmationProperty.type && confirmationProperty.type !== 'boolean') {
    fail('destructiveRasterizeConfirmed is not declared as a boolean', {
      toolName: rasterizeTool.name,
      destructiveRasterizeConfirmed: confirmationProperty
    });
  }

  const passedGuard = {
    ...guard,
    status: 'passed',
    toolName: rasterizeTool.name,
    propertyNames: Object.keys(properties)
  };
  report.runtimeGuards = [...(report.runtimeGuards || []), passedGuard];
  report.setup['preflight.rasterizeRuntimeSchema'] = passedGuard;
  writeReport(report);
}

async function main() {
  ensureDir(TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  if (!systemStatus?.pluginConnected) {
    throw new Error('Photoshop UXP plugin is not connected');
  }

  const stamp = Date.now();
  const docName = `MCP-SmartObject-Smoke-${stamp}`;
  const setup = {};
  const scenarios = [];
  let createdDoc = null;
  let createdRectangle = null;
  let replaceContentRectangle = null;
  let convertedSmartObject = null;
  const replacementPngPath = path.join(TMP_DIR, `smart-object-replacement-${stamp}.png`);
  const replaceContentsArmed = isReplaceContentsArmed();
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    systemStatus,
    replaceContentsArmed,
    disposableDocument: null,
    setup,
    progress: [],
    scenarios
  };
  writeReport(report);

  async function runMcpToolStep(key, toolName, args = {}) {
    const step = {
      key,
      toolName,
      status: 'running',
      startedAt: new Date().toISOString()
    };
    report.progress.push(step);
    writeReport(report);

    try {
      const result = await callTool(toolName, args);
      setup[key] = result;
      step.status = 'completed';
      step.completedAt = new Date().toISOString();
      step.summary = {
        toolCount: Array.isArray(result?.tools) ? result.tools.length : undefined,
        pluginConnected: result?.pluginConnected
      };
      writeReport(report);
      return result;
    } catch (error) {
      step.status = 'failed';
      step.completedAt = new Date().toISOString();
      step.error = error?.message || String(error);
      writeReport(report);
      throw error;
    }
  }

  async function runPhotoshopStep(key, toolName, args, options = {}) {
    const step = {
      key,
      toolName,
      status: 'running',
      startedAt: new Date().toISOString()
    };
    report.progress.push(step);
    writeReport(report);

    try {
      const result = await callPhotoshopToolStable(toolName, args, options);
      setup[key] = result;
      step.status = 'completed';
      step.completedAt = new Date().toISOString();
      step.success = result?.success !== false;
      step.summary = {
        success: result?.success,
        entityType: result?.entityType,
        layerId: result?.layerId,
        documentId: result?.documentId,
        error: result?.error,
        errorCategory: result?.errorDetails?.category
      };
      writeReport(report);
      return result;
    } catch (error) {
      step.status = 'failed';
      step.completedAt = new Date().toISOString();
      step.error = error?.message || String(error);
      writeReport(report);
      throw error;
    }
  }

  try {
    const runtimeTools = await runMcpToolStep('preflight.photoshopToolsList', 'photoshop.tools.list', {});
    const runtimeToolNames = Array.isArray(runtimeTools?.tools)
      ? runtimeTools.tools.map((tool) => String(tool?.name || '')).filter(Boolean)
      : [];
    const missingTools = REQUIRED_PHOTOSHOP_TOOLS.filter((toolName) => !runtimeToolNames.includes(toolName));
    if (missingTools.length > 0) {
      throw new Error(`Photoshop runtime missing required smart-object smoke tools: ${missingTools.join(', ')}`);
    }
    assertRasterizeRuntimeSchema(runtimeTools, report);

    if (replaceContentsArmed) {
      writeReplacementPng(replacementPngPath);
    }

    createdDoc = await runPhotoshopStep('createDocument', 'createDocument', {
      width: 320,
      height: 240,
      name: docName,
      backgroundColor: 'white'
    });
    report.disposableDocument = createdDoc;
    if (!isSuccessResult(createdDoc, 'document') || typeof createdDoc?.documentId !== 'number') {
      throw new Error(`createDocument failed contract check: ${asJson(createdDoc)}`);
    }

    createdRectangle = await runPhotoshopStep('createRectangle', 'createRectangle', {
      x: 60,
      y: 50,
      width: 140,
      height: 100,
      fillColorHex: '#7FA3D8',
      name: 'Smart Object Smoke Rectangle'
    });
    if (!isSuccessResult(createdRectangle, 'shape') || typeof createdRectangle?.layerId !== 'number') {
      throw new Error(`createRectangle failed contract check: ${asJson(createdRectangle)}`);
    }

    if (replaceContentsArmed) {
      replaceContentRectangle = await runPhotoshopStep('replaceContentRectangle', 'createRectangle', {
        x: 210,
        y: 50,
        width: 64,
        height: 64,
        fillColorHex: '#55AA66',
        name: 'Replace Content Smoke Rectangle'
      });
      if (!isSuccessResult(replaceContentRectangle, 'shape') || typeof replaceContentRectangle?.layerId !== 'number') {
        throw new Error(`replace content rectangle failed contract check: ${asJson(replaceContentRectangle)}`);
      }
    }

    convertedSmartObject = await runPhotoshopStep('convertToSmartObject', 'convertToSmartObject', {
      layerIds: [createdRectangle.layerId],
      name: 'Smart Object Smoke'
    });
    if (!isSuccessResult(convertedSmartObject, 'smart-object') || typeof convertedSmartObject?.layerId !== 'number') {
      throw new Error(`convertToSmartObject failed contract check: ${asJson(convertedSmartObject)}`);
    }

    const smartInfo = await runPhotoshopStep('getSmartObjectInfo', 'getSmartObjectInfo', {
      layerId: convertedSmartObject.layerId
    });
    if (!isSuccessResult(smartInfo, 'smart-object') || smartInfo?.isSmartObject !== true) {
      throw new Error(`getSmartObjectInfo failed contract check: ${asJson(smartInfo)}`);
    }

    const smartLayers = await runPhotoshopStep('getSmartObjectLayers', 'getSmartObjectLayers', {
      layerId: convertedSmartObject.layerId,
      autoOpen: false
    });
    if (!isSuccessResult(smartLayers, 'smart-object-layers') || smartLayers?.autoOpen !== false || !Array.isArray(smartLayers?.internalLayers)) {
      throw new Error(`getSmartObjectLayers failed contract check: ${asJson(smartLayers)}`);
    }

    const duplicatedSmartObject = await runPhotoshopStep('duplicateSmartObject', 'duplicateSmartObject', {
      layerId: convertedSmartObject.layerId,
      name: 'Smart Object Smoke Duplicate'
    });
    if (!isSuccessResult(duplicatedSmartObject, 'smart-object') || duplicatedSmartObject?.isSmartObject !== true) {
      throw new Error(`duplicateSmartObject failed contract check: ${asJson(duplicatedSmartObject)}`);
    }

    const rasterizeConfirmed = isRasterizeConfirmed();
    const rasterizedSmartObject = await runPhotoshopStep('rasterizeSmartObject', 'rasterizeSmartObject', {
      layerId: duplicatedSmartObject.layerId,
      destructiveRasterizeConfirmed: rasterizeConfirmed
    });
    if (rasterizeConfirmed) {
      if (!isSuccessResult(rasterizedSmartObject, 'layer') || typeof rasterizedSmartObject?.layerId !== 'number') {
        throw new Error(`rasterizeSmartObject confirmed path failed contract check: ${asJson(rasterizedSmartObject)}`);
      }
    } else if (!isStructuredFailure(rasterizedSmartObject, 'rasterizeSmartObject')) {
      throw new Error(`rasterizeSmartObject default path should return structured failure before Photoshop rasterize: ${asJson(rasterizedSmartObject)}`);
    }

    const invalidSmartObjectInfo = rasterizeConfirmed
      ? await runPhotoshopStep('invalidSmartObjectInfo', 'getSmartObjectInfo', {
        layerId: rasterizedSmartObject.layerId
      })
      : null;
    if (rasterizeConfirmed && !isStructuredFailure(invalidSmartObjectInfo, 'getSmartObjectInfo')) {
      throw new Error(`getSmartObjectInfo invalid layer should return structured failure: ${asJson(invalidSmartObjectInfo)}`);
    }

    let replacedSmartObject = null;
    let replacedLayerContent = null;
    if (replaceContentsArmed) {
      replacedSmartObject = await runPhotoshopStep('replaceSmartObjectContents', 'replaceSmartObjectContents', {
        layerId: convertedSmartObject.layerId,
        filePath: replacementPngPath
      });
      if (!isSuccessResult(replacedSmartObject, 'smart-object') || replacedSmartObject?.isSmartObject !== true) {
        throw new Error(`replaceSmartObjectContents failed contract check: ${asJson(replacedSmartObject)}`);
      }

      replacedLayerContent = await runPhotoshopStep('replaceLayerContent', 'replaceLayerContent', {
        layerId: replaceContentRectangle.layerId,
        imageBase64: `data:image/png;base64,${REPLACEMENT_PNG_BASE64}`,
        bounds: {
          left: 210,
          top: 50,
          width: 64,
          height: 64
        }
      });
      if (replacedLayerContent?.success !== true || typeof replacedLayerContent?.data?.newLayerId !== 'number') {
        throw new Error(`replaceLayerContent failed contract check: ${asJson(replacedLayerContent)}`);
      }
    }

    scenarios.push(
      {
        name: 'convert-to-smart-object-contract',
        expected: 'convertToSmartObject should return the normalized smart-object contract',
        outcome: 'pass',
        payload: convertedSmartObject
      },
      {
        name: 'get-smart-object-info-contract',
        expected: 'getSmartObjectInfo should return normalized Smart Object metadata for an explicit layerId',
        outcome: 'pass',
        payload: smartInfo
      },
      {
        name: 'get-smart-object-layers-guidance-contract',
        expected: 'getSmartObjectLayers with autoOpen=false should return guidance without opening another document',
        outcome: 'pass',
        payload: smartLayers
      },
      {
        name: 'duplicate-smart-object-contract',
        expected: 'duplicateSmartObject should duplicate an explicit Smart Object into another Smart Object layer',
        outcome: 'pass',
        payload: duplicatedSmartObject
      },
      {
        name: 'rasterize-smart-object-contract',
        expected: rasterizeConfirmed
          ? 'rasterizeSmartObject should rasterize only after explicit destructive confirmation'
          : 'rasterizeSmartObject should refuse default destructive rasterize before calling Photoshop',
        outcome: 'pass',
        payload: rasterizedSmartObject
      }
    );
    if (rasterizeConfirmed) {
      scenarios.push({
        name: 'smart-object-structured-failure-contract',
        expected: 'getSmartObjectInfo should return tool-error-normalizer evidence for a non-Smart-Object layer',
        outcome: 'pass',
        payload: invalidSmartObjectInfo
      });
    }
    if (replaceContentsArmed) {
      scenarios.push(
        {
          name: 'replace-smart-object-contents-contract',
          expected: 'replaceSmartObjectContents should replace an explicit Smart Object with a local PNG and keep Smart Object metadata',
          outcome: 'pass',
          payload: replacedSmartObject
        },
        {
          name: 'replace-layer-content-contract',
          expected: 'replaceLayerContent should preflight and place a safe PNG replacement into the disposable document',
          outcome: 'pass',
          payload: replacedLayerContent
        }
      );
    } else {
      scenarios.push(
        {
          name: 'replace-smart-object-contents-contract',
          expected: `Skipped by default. Re-run with --replace-contents or ${REPLACE_CONTENTS_FLAG}=1 after UXP reload to validate replacement writes.`,
          outcome: 'skipped',
          payload: { replaceContentsArmed: false }
        },
        {
          name: 'replace-layer-content-contract',
          expected: `Skipped by default. Re-run with --replace-contents or ${REPLACE_CONTENTS_FLAG}=1 after UXP reload to validate replacement writes.`,
          outcome: 'skipped',
          payload: { replaceContentsArmed: false }
        }
      );
    }

    writeReport(report);

    console.log(`Wrote ${JSON_OUT}`);
    console.log(`Wrote ${MD_OUT}`);
    console.log(JSON.stringify({
      connected: systemStatus?.pluginConnected === true,
      scenarios: scenarios.map(item => ({ name: item.name, outcome: item.outcome }))
    }, null, 2));
  } finally {
    if (createdDoc?.documentId) {
      const cleanup = await runPhotoshopStep('cleanup.closeDocument', 'closeDocument', {
        documentId: createdDoc.documentId,
        save: false
      }).catch(error => ({ success: false, error: error?.message || String(error) }));
      try {
        report.cleanup = cleanup;
        writeReport(report);
      } catch {
        // best effort only
      }
    }
    if (fs.existsSync(replacementPngPath)) {
      fs.rmSync(replacementPngPath, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
