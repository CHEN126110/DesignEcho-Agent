#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { compareSnapshotToReference } = require('./lib/reference-screenshot-pixel-probe.cjs');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  buildReferenceTextLineLayoutPlan,
  buildReferenceTextLayerCreateRequest,
  estimateReferenceTextTrackingFit,
  resolveReferenceTextFontSize,
  resolveReferenceTextPlacementRole,
  resolveTextBoundsCorrection
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'skill-executors',
  'layout-replication-text-placement.ts'
));

const {
  compareReferenceVisualQaItem,
  buildReferenceReplicationVisualQaReport
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'reference-replication-visual-qa.ts'));

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'reference-fex-text-placement-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'reference-fex-text-placement-live-smoke.md');
const SNAPSHOT_OUT = path.join(TMP_DIR, 'reference-fex-text-placement-live-snapshot.png');
const REFERENCE_ASSET = path.join(ROOT, 'benchmarks/reference-replication/assets/fex-certificate-text-layout.jpg');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DOC_PREFIX = 'DesignEchoFexTextPlacementLive';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

async function callPhotoshopTool(name, args = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHostModalState(value) {
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || '';
  return /host is in a modal state/i.test(String(text));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 5;
  const delayMs = options.delayMs || 250;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callPhotoshopTool(name, args);
      if (!isHostModalState(result) || attempt >= attempts) {
        if (result && typeof result === 'object') {
          result.__smokeAttempts = attempt;
        }
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isHostModalState(error) || attempt >= attempts) {
        throw error;
      }
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callPhotoshopTool(name, args);
}

function normalizeDocuments(listResult) {
  return Array.isArray(listResult?.documents) ? listResult.documents : [];
}

function hasDocument(listResult, documentId) {
  return normalizeDocuments(listResult).some((doc) => Number(doc?.id) === Number(documentId));
}

function toPixelBox(expectedBox) {
  return {
    left: Number(expectedBox.x),
    top: Number(expectedBox.y),
    width: Number(expectedBox.width),
    height: Number(expectedBox.height)
  };
}

function normalizeToolBoundsToPixelBox(bounds) {
  if (!bounds || typeof bounds !== 'object') return undefined;
  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      height: Math.round(height)
    };
  }
  if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom) && right > left && bottom > top) {
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    };
  }
  return undefined;
}

async function readLayerBounds(layerId, options = {}) {
  const attempts = options.attempts || 4;
  let last = { result: null, box: undefined };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await callPhotoshopToolStable('getLayerBounds', { layerId });
    const box = result?.success === false
      ? undefined
      : normalizeToolBoundsToPixelBox(result?.boundsNoEffects || result?.bounds || result?.layerBounds);
    last = { result, box };
    if (box || result?.success === false) {
      return last;
    }
    if (attempt < attempts) {
      await sleep(100 * attempt);
    }
  }
  return last;
}

async function applyTrackingWidthFit({ layerId, targetBox, actualBox, content, fontSize }) {
  const trackingAdjustment = estimateReferenceTextTrackingFit({
    content,
    fontSize,
    targetBox,
    actualBox,
    currentTracking: 0
  });
  if (!trackingAdjustment) {
    return {
      adjusted: false,
      afterBounds: actualBox,
      correction: { dx: 0, dy: 0, shouldMove: false }
    };
  }

  const styleResult = await callPhotoshopToolStable('setTextStyle', {
    layerId,
    fontSize,
    tracking: trackingAdjustment.tracking
  });
  if (styleResult?.success === false) {
    return {
      adjusted: false,
      afterBounds: actualBox,
      correction: { dx: 0, dy: 0, shouldMove: false },
      error: styleResult?.error || 'setTextStyle returned success=false',
      trackingAdjustment
    };
  }

  await sleep(120);
  let after = await readLayerBounds(layerId);
  let correction = resolveTextBoundsCorrection({
    targetBox,
    actualBox: after.box,
    tolerancePx: 2
  });
  let moveResult = null;
  if (correction.shouldMove) {
    moveResult = await callPhotoshopToolStable('moveLayer', {
      layerId,
      x: correction.dx,
      y: correction.dy,
      relative: true
    });
    if (moveResult?.success !== false) {
      after = await readLayerBounds(layerId);
      correction = resolveTextBoundsCorrection({
        targetBox,
        actualBox: after.box,
        tolerancePx: 2
      });
    }
  }

  return {
    adjusted: true,
    afterBounds: after.box || actualBox,
    correction,
    moveResult,
    styleResult,
    trackingAdjustment
  };
}

async function runTextLinePlanLiveProbe(report, canvas) {
  const content = '轻薄堆堆，春夏穿也清爽。自然堆叠的条纹轮廓，让每一步都多一点随性好看。';
  const targetBox = {
    left: Math.round(canvas.width * 0.08),
    top: Math.round(canvas.height * 0.12),
    width: Math.round(canvas.width * 0.84),
    height: Math.round(canvas.height * 0.28)
  };
  const singleLinePlan = buildReferenceTextLineLayoutPlan({
    content,
    box: { ...targetBox, height: 30 },
    canvasHeight: canvas.height,
    role: 'body',
    style: { effects: [] }
  });
  const linePlan = buildReferenceTextLineLayoutPlan({
    content,
    box: targetBox,
    canvasHeight: canvas.height,
    role: 'body',
    style: { effects: [] }
  });
  const createRequest = buildReferenceTextLayerCreateRequest({
    content: linePlan.content,
    box: targetBox,
    fontSize: linePlan.fontSize,
    colorHex: '#111111',
    leading: linePlan.leading,
    alignment: 'left'
  });
  const createText = await callPhotoshopToolStable('createTextLayer', {
    ...createRequest,
    name: 'line_plan_long_body_probe'
  });
  const layerId = Number(createText?.layerId);
  const probe = {
    targetBox,
    originalContent: content,
    linePlan,
    singleLineFontSize: singleLinePlan.fontSize,
    createRequest,
    createSuccess: createText?.success === true,
    layerId: Number.isFinite(layerId) ? layerId : undefined,
    afterBounds: undefined,
    comparison: undefined,
    passed: false,
    issues: []
  };

  if (createText?.success !== true || !Number.isFinite(layerId)) {
    probe.issues.push(createText?.error || 'createTextLayer did not return a valid layerId');
    report.linePlanLiveProbe = probe;
    return probe;
  }

  const before = await readLayerBounds(layerId);
  let correction = resolveTextBoundsCorrection({
    targetBox,
    actualBox: before.box,
    tolerancePx: 2
  });
  if (correction.shouldMove) {
    const moveResult = await callPhotoshopToolStable('moveLayer', {
      layerId,
      x: correction.dx,
      y: correction.dy,
      relative: true
    });
    probe.moveResult = {
      success: moveResult?.success === true,
      error: moveResult?.error
    };
  }
  const after = await readLayerBounds(layerId);
  probe.beforeBounds = before.box;
  probe.afterBounds = after.box;
  probe.comparison = compareReferenceVisualQaItem({
    id: 'line-plan-long-body-probe',
    label: 'long body line plan live probe',
    kind: 'text',
    plannedBox: targetBox,
    actualBox: after.box
  });

  if (!linePlan.insertedLineBreaks || linePlan.lineCount < 2) {
    probe.issues.push('line plan did not insert line breaks for long body copy');
  }
  if (!(linePlan.fontSize > singleLinePlan.fontSize * 1.35)) {
    probe.issues.push(`line plan font size ${linePlan.fontSize} is not materially larger than single-line ${singleLinePlan.fontSize}`);
  }
  if (!linePlan.leading || linePlan.leading < linePlan.fontSize) {
    probe.issues.push('line plan did not provide valid leading for multi-line text');
  }
  if (!after.box) {
    probe.issues.push('Photoshop did not return readable bounds for line plan layer');
  } else if (after.box.width > targetBox.width + 40 || after.box.height > targetBox.height + 40) {
    probe.issues.push(`line plan bounds exceed target tolerance: actual=${asJson(after.box)}, target=${asJson(targetBox)}`);
  }

  probe.passed = probe.issues.length === 0;
  report.linePlanLiveProbe = probe;
  return probe;
}

async function cleanupDisposable(report, disposableDocumentId, originalDocumentId) {
  report.cleanup = { attempted: false, closed: false, restoredOriginal: false, errors: [] };
  if (!disposableDocumentId) {
    report.cleanup.closed = true;
    report.cleanup.restoredOriginal = true;
    return;
  }

  report.cleanup.attempted = true;
  try {
    const before = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    if (hasDocument(before, disposableDocumentId)) {
      const closed = await callPhotoshopToolStable('closeDocument', { documentId: disposableDocumentId, save: false });
      report.cleanup.closed = closed?.success === true;
      if (!report.cleanup.closed) {
        report.cleanup.errors.push(closed?.error || 'closeDocument returned success=false');
      }
    } else {
      report.cleanup.closed = true;
    }
  } catch (error) {
    report.cleanup.errors.push(error?.message || String(error));
  }

  try {
    const afterClose = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    if (originalDocumentId && hasDocument(afterClose, originalDocumentId)) {
      const switched = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
      report.cleanup.restoredOriginal = switched?.success === true;
      if (!report.cleanup.restoredOriginal) {
        report.cleanup.errors.push(switched?.error || 'switchDocument returned success=false');
      }
    } else {
      report.cleanup.restoredOriginal = true;
    }
    const finalDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    report.cleanup.disposableStillOpen = hasDocument(finalDocs, disposableDocumentId);
  } catch (error) {
    report.cleanup.errors.push(error?.message || String(error));
    report.cleanup.disposableStillOpen = true;
  }
}

function renderMarkdown(report) {
  return [
    '# FEX Text Placement Live Smoke',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Endpoint: ${report.endpoint}`,
    `- Outcome: ${report.outcome}`,
    report.skipped ? `- Skipped: ${report.skipReason}` : '',
    `- Document id: ${report.disposableDocumentId || 'none'}`,
    `- Text layers: ${report.textResults?.length || 0}`,
    `- Visual QA: ${report.visualQa?.status || 'none'}`,
    `- Screenshot probe: ${report.screenshotQa?.status || 'none'}`,
    `- Line plan probe: ${report.linePlanLiveProbe?.passed === true ? 'pass' : report.linePlanLiveProbe ? 'needs_review' : 'none'}`,
    '',
    '## Visual QA',
    '',
    '```json',
    JSON.stringify(report.visualQa || null, null, 2),
    '```',
    '',
    '## Screenshot Probe',
    '',
    '```json',
    JSON.stringify(report.screenshotQa || null, null, 2),
    '```',
    '',
    '## Line Plan Probe',
    '',
    '```json',
    JSON.stringify(report.linePlanLiveProbe || null, null, 2),
    '```',
    '',
    '## Text Results',
    '',
    '```json',
    JSON.stringify(report.textResults || [], null, 2),
    '```',
    '',
    '## Cleanup',
    '',
    '```json',
    JSON.stringify(report.cleanup || {}, null, 2),
    '```',
    report.error ? `\n## Error\n\n\`\`\`text\n${report.error}\n\`\`\`\n` : ''
  ].filter(Boolean).join('\n');
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(MD_OUT, renderMarkdown(report), 'utf8');
}

async function runScenario(report) {
  let systemStatus;
  try {
    systemStatus = await callTool('system.status', {});
  } catch (error) {
    report.skipped = true;
    report.skipReason = `MCP endpoint unavailable or system.status failed: ${error?.message || String(error)}`;
    return;
  }
  report.systemStatus = systemStatus;
  if (systemStatus?.pluginConnected !== true) {
    report.skipped = true;
    report.skipReason = 'Photoshop UXP plugin is not connected';
    return;
  }

  const caseJson = readJson(path.join(ROOT, 'benchmarks/reference-replication/cases/rr-001-fex-certificate-text-layout.json'));
  const canvas = caseJson.scenario.canvas;
  const listBefore = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  const originalDocumentId = listBefore?.activeDocumentId || normalizeDocuments(listBefore).find((doc) => doc.isActive)?.id || normalizeDocuments(listBefore)[0]?.id || null;
  report.originalDocumentId = originalDocumentId;

  let disposableDocumentId = null;
  const textLayerIds = [];
  try {
    const createDocument = await callPhotoshopToolStable('createDocument', {
      name: `${DOC_PREFIX}_${Date.now()}`,
      width: canvas.width,
      height: canvas.height,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    });
    if (createDocument?.success !== true) {
      throw new Error(`createDocument failed: ${createDocument?.error || asJson(createDocument)}`);
    }
    disposableDocumentId = createDocument.documentId || createDocument.document?.id;
    report.disposableDocumentId = disposableDocumentId;

    for (const expected of caseJson.expectedElements) {
      const targetBox = toPixelBox(expected.expectedBox);
      const role = resolveReferenceTextPlacementRole({
        content: expected.content,
        name: expected.id,
        style: {
          fontWeight: expected.fontWeight || (expected.role === 'headline' ? 'bold' : 'regular'),
          fontSizeRatio: expected.role === 'headline' ? 40 / canvas.height : 24 / canvas.height,
          effects: []
        }
      });
      const fontSize = resolveReferenceTextFontSize({
        style: {
          fontWeight: expected.fontWeight || (expected.role === 'headline' ? 'bold' : 'regular'),
          fontSizeRatio: expected.role === 'headline' ? 40 / canvas.height : 24 / canvas.height,
          effects: []
        },
        box: targetBox,
        canvasHeight: canvas.height,
        role
      });
      const createRequest = buildReferenceTextLayerCreateRequest({
        content: expected.content,
        box: targetBox,
        fontSize,
        colorHex: '#111111'
      });
      const createText = await callPhotoshopToolStable('createTextLayer', {
        ...createRequest,
        name: `fex_${expected.id}`,
        alignment: 'left'
      });
      if (createText?.success !== true || !Number.isFinite(Number(createText.layerId))) {
        throw new Error(`createTextLayer failed for ${expected.id}: ${createText?.error || asJson(createText)}`);
      }
      const layerId = createText.layerId;
      textLayerIds.push(layerId);

      const before = await readLayerBounds(layerId);
      let correction = resolveTextBoundsCorrection({
        targetBox,
        actualBox: before.box,
        tolerancePx: 1
      });
      const initialCorrection = { ...correction };
      const moveResults = [];
      let after = before;
      while (correction.shouldMove && moveResults.length < 2) {
        const moveResult = await callPhotoshopToolStable('moveLayer', {
          layerId,
          x: correction.dx,
          y: correction.dy,
          relative: true
        });
        moveResults.push(moveResult);
        if (moveResult?.success === false) {
          break;
        }
        after = await readLayerBounds(layerId);
        if (!after.box) {
          break;
        }
        correction = resolveTextBoundsCorrection({
          targetBox,
          actualBox: after.box,
          tolerancePx: 2
        });
      }
      const trackingFit = after.box
        ? await applyTrackingWidthFit({
          layerId,
          targetBox,
          actualBox: after.box,
          content: expected.content,
          fontSize
        })
        : null;
      if (trackingFit?.afterBounds) {
        after = { result: after.result, box: trackingFit.afterBounds };
        correction = trackingFit.correction || correction;
      }
      const comparison = compareReferenceVisualQaItem({
        id: expected.id,
        label: expected.content,
        kind: 'text',
        plannedBox: targetBox,
        actualBox: after.box
      });
      report.textResults.push({
        id: expected.id,
        content: expected.content,
        role,
        fontSize,
        layerId,
        targetBox,
        createRequest,
        beforeBounds: before.box,
        correction: initialCorrection,
        residualCorrection: correction,
        moveAttempts: moveResults.length,
        moveSuccess: moveResults.length > 0 ? moveResults.every((result) => result?.success === true) : null,
        trackingFit,
        afterBounds: after.box,
        comparison
      });
    }

    const group = await callPhotoshopToolStable('groupLayers', {
      layerIds: textLayerIds,
      groupName: 'fex_text_reference_screen'
    });
    report.screenGroupId = group?.group?.id || group?.layerId || null;
    const snapshot = await callPhotoshopToolStable('getCanvasSnapshot', {
      maxSize: Math.max(canvas.width, canvas.height),
      format: 'png',
      quality: 100
    });
    report.snapshotCapture = {
      success: snapshot?.success === true,
      width: snapshot?.snapshot?.width,
      height: snapshot?.snapshot?.height,
      format: snapshot?.snapshot?.format,
      hasBase64: typeof snapshot?.snapshot?.base64 === 'string' && snapshot.snapshot.base64.length > 0,
      error: snapshot?.error
    };
    report.screenshotQa = snapshot?.success === true
      ? await compareSnapshotToReference({
        snapshotBase64: snapshot?.snapshot?.base64,
        referencePath: REFERENCE_ASSET,
        targetSize: canvas,
        snapshotOut: SNAPSHOT_OUT
      })
      : {
        status: 'unverified',
        mode: 'pixel-probe',
        reason: snapshot?.error || 'getCanvasSnapshot returned success=false',
        rawImagesRedacted: true
      };
    report.visualQa = buildReferenceReplicationVisualQaReport({
      comparisons: report.textResults.map((item) => item.comparison),
      snapshotObservation: {
        source: 'getCanvasSnapshot',
        snapshotCount: snapshot?.success === true ? 1 : 0,
        overlayCount: 0,
        notes: snapshot?.success === true ? undefined : [report.screenshotQa.reason],
        pixelProbe: report.screenshotQa
      }
    });
    await runTextLinePlanLiveProbe(report, canvas);
    report.outcome = report.visualQa.status === 'ok' ? 'pass' : 'needs_review';
    if (report.linePlanLiveProbe && report.linePlanLiveProbe.passed !== true) {
      report.outcome = 'needs_review';
    }
  } finally {
    await cleanupDisposable(report, disposableDocumentId, originalDocumentId);
  }
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'fail',
    skipped: false,
    skipReason: '',
    textResults: [],
    cleanup: {}
  };

  try {
    await runScenario(report);
    if (report.skipped) {
      report.outcome = 'skipped';
    }
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  }

  writeReport(report);
  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    skipped: report.skipped,
    skipReason: report.skipReason || null,
    textLayerCount: report.textResults.length,
    visualQaStatus: report.visualQa?.status || null,
    visualQaCounts: report.visualQa?.counts || null,
    screenshotQaStatus: report.screenshotQa?.status || null,
    screenshotQa: report.screenshotQa ? {
      mae: report.screenshotQa.mae,
      rmse: report.screenshotQa.rmse,
      highDeltaRatio: report.screenshotQa.highDeltaRatio,
      darkJaccard: report.screenshotQa.darkJaccard,
      softDarkJaccard: report.screenshotQa.softDarkJaccard,
      snapshotPath: report.screenshotQa.snapshotPath
    } : null,
    linePlanLiveProbe: report.linePlanLiveProbe ? {
      passed: report.linePlanLiveProbe.passed,
      lineCount: report.linePlanLiveProbe.linePlan?.lineCount,
      insertedLineBreaks: report.linePlanLiveProbe.linePlan?.insertedLineBreaks,
      fontSize: report.linePlanLiveProbe.linePlan?.fontSize,
      leading: report.linePlanLiveProbe.linePlan?.leading,
      singleLineFontSize: report.linePlanLiveProbe.singleLineFontSize,
      afterBounds: report.linePlanLiveProbe.afterBounds,
      issues: report.linePlanLiveProbe.issues
    } : null,
    cleanup: report.cleanup,
    error: report.error ? report.error.split('\n')[0] : null
  }, null, 2));

  if (report.outcome === 'fail' || report.outcome === 'skipped') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
