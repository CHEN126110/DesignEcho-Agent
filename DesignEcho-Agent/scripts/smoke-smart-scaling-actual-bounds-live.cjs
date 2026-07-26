#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UXP_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'smart-scaling-actual-bounds-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'smart-scaling-actual-bounds-live-smoke.md');
const ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DOC_PREFIX = 'DesignEchoSmartScalingActualBoundsLive';
const TOLERANCE_PX = 3;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(method, params = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${ENDPOINT}`);
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
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed);
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
  return parseToolResult(await rpc('tools/call', { name, arguments: args }));
}

async function callPhotoshopTool(name, args = {}) {
  return callTool('photoshop.tools.call', { name, arguments: args });
}

function isHostModalState(value) {
  const text = typeof value === 'string'
    ? value
    : value?.error || value?.message || '';
  return /host is in a modal state|modal|模态状态|正在处理其他命令/i.test(String(text));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 300;
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

function disposableDocuments(listResult) {
  return normalizeDocuments(listResult).filter((doc) => String(doc?.name || '').startsWith(DOC_PREFIX));
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of [
    'success',
    'documentId',
    'name',
    'layerId',
    'activeDocumentId',
    'closedDocument',
    'originalSize',
    'newSize',
    'error'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      summary[key] = result[key];
    }
  }
  if (result.data && typeof result.data === 'object') {
    summary.data = {
      layerId: result.data.layerId,
      layerName: result.data.layerName,
      bounds: result.data.bounds,
      reason: result.data.reason,
      error: result.data.error
    };
  }
  if (result.properties && typeof result.properties === 'object') {
    summary.properties = {
      id: result.properties.id,
      name: result.properties.name,
      kind: result.properties.kind,
      bounds: result.properties.bounds
    };
  }
  return summary;
}

function pushStep(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success !== false,
    summary: summarizeResult(result)
  });
}

function pushExpectedFailure(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success === false,
    expectedFailure: true,
    summary: summarizeResult(result)
  });
}

function assertCondition(report, name, passed, details = {}) {
  report.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

function assertToolSuccess(report, name, result) {
  pushStep(report, name, result);
  assertCondition(report, `${name} success`, result?.success === true, {
    result: summarizeResult(result),
    error: result?.error
  });
}

function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const left = finiteNumber(bounds.left);
  const top = finiteNumber(bounds.top);
  const right = finiteNumber(bounds.right);
  const bottom = finiteNumber(bounds.bottom);
  if ([left, top, right, bottom].some((value) => value === null)) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function boundsFromProperties(result) {
  return normalizeBounds(result?.properties?.bounds || result?.data?.bounds || result?.bounds);
}

function compareBounds(plannedBounds, actualBounds) {
  const keys = ['left', 'top', 'right', 'bottom'];
  const deviations = {};
  let maxAbsDeviation = 0;

  for (const key of keys) {
    const deviation = Number(actualBounds[key]) - Number(plannedBounds[key]);
    deviations[key] = deviation;
    maxAbsDeviation = Math.max(maxAbsDeviation, Math.abs(deviation));
  }

  return {
    plannedBounds,
    actualBounds,
    deviations,
    maxAbsDeviation
  };
}

function expectedFailureResult(toolName, result) {
  const error = typeof result?.error === 'string' ? result.error : '';
  const errorDetails = result?.errorDetails || null;
  return {
    toolName,
    success: result?.success === true,
    expectedFailure: result?.success === false,
    hasErrorMessage: error.trim().length > 0,
    error,
    category: errorDetails?.category || errorDetails?.normalized?.category || null,
    popupPrevented: result?.data?.popupPrevented === true || errorDetails?.popupRisk === true,
    result: summarizeResult(result)
  };
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    pushStep(report, name, result);
    return result;
  } catch (error) {
    report.steps.push({ name, ok: false, error: error?.message || String(error) });
    return null;
  }
}

async function cleanupStaleDisposableDocuments(report) {
  const staleCleanup = { attempted: false, closed: [], errors: [] };
  report.staleCleanup = staleCleanup;

  const documentsResult = await safeListDocuments(report, 'staleCleanup.listDocuments.before');
  for (const document of disposableDocuments(documentsResult)) {
    staleCleanup.attempted = true;
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId: document.id,
        save: false
      }, {
        attempts: 8,
        delayMs: 400
      });
      pushStep(report, `staleCleanup.close.${document.id}`, closeResult);
      if (closeResult?.success === true) {
        staleCleanup.closed.push({ id: document.id, name: document.name });
      } else {
        staleCleanup.errors.push(closeResult?.error || `closeDocument failed for ${document.name}`);
      }
    } catch (error) {
      staleCleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: `staleCleanup.close.${document.id}`,
        ok: false,
        error: error?.message || String(error)
      });
    }
  }
}

async function cleanupDisposable(report, disposableDocumentId, originalDocumentId) {
  const cleanup = { attempted: false, closed: false, restoredOriginal: false, errors: [] };
  report.cleanup = cleanup;

  if (!disposableDocumentId) {
    cleanup.closed = true;
    cleanup.restoredOriginal = true;
    return cleanup;
  }

  cleanup.attempted = true;
  const beforeCleanup = await safeListDocuments(report, 'cleanup.listDocuments.before');
  const shouldAttemptClose = !beforeCleanup || hasDocument(beforeCleanup, disposableDocumentId);
  if (shouldAttemptClose) {
    try {
      const closeResult = await callPhotoshopToolStable('closeDocument', {
        documentId: disposableDocumentId,
        save: false
      }, {
        attempts: 8,
        delayMs: 400
      });
      pushStep(report, 'cleanup.closeDisposableWithoutSaving', closeResult);
      cleanup.closed = closeResult?.success === true;
      if (!cleanup.closed) cleanup.errors.push(closeResult?.error || 'closeDocument returned success=false');
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: 'cleanup.closeDisposableWithoutSaving',
        ok: false,
        error: error?.message || String(error)
      });
    }
  } else {
    cleanup.closed = true;
  }

  if (originalDocumentId) {
    try {
      const afterClose = await safeListDocuments(report, 'cleanup.listDocuments.afterClose');
      if (hasDocument(afterClose, originalDocumentId)) {
        const switchResult = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
        pushStep(report, 'cleanup.switchOriginalDocument', switchResult);
        cleanup.restoredOriginal = switchResult?.success === true;
        if (!cleanup.restoredOriginal) cleanup.errors.push(switchResult?.error || 'switchDocument returned success=false');
      } else {
        cleanup.restoredOriginal = true;
      }
    } catch (error) {
      cleanup.errors.push(error?.message || String(error));
      report.steps.push({
        name: 'cleanup.switchOriginalDocument',
        ok: false,
        error: error?.message || String(error)
      });
    }
  } else {
    cleanup.restoredOriginal = true;
  }

  const finalDocs = await safeListDocuments(report, 'cleanup.listDocuments.final');
  cleanup.disposableStillOpen = hasDocument(finalDocs, disposableDocumentId);
  return cleanup;
}

async function runScenario(report) {
  const systemStatus = await callTool('system.status', {});
  report.systemStatus = systemStatus;
  assertCondition(report, 'Photoshop plugin connected', systemStatus?.pluginConnected === true, {
    systemStatus
  });

  await cleanupStaleDisposableDocuments(report);

  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  assertToolSuccess(report, 'listDocuments.before', beforeDocs);
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id;
  report.originalDocumentId = originalDocumentId || null;

  const disposableName = `${DOC_PREFIX}_${Date.now()}`;
  report.disposableDocumentName = disposableName;
  let disposableDocumentId = null;

  try {
    const createDocument = await callPhotoshopToolStable('createDocument', {
      name: disposableName,
      width: 640,
      height: 480,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    }, {
      attempts: 12,
      delayMs: 500
    });
    assertToolSuccess(report, 'createDocument.disposable', createDocument);
    disposableDocumentId = createDocument.documentId || createDocument.document?.id;
    report.disposableDocumentId = disposableDocumentId;
    assertCondition(report, 'disposable document id returned', Number.isFinite(Number(disposableDocumentId)), {
      disposableDocumentId
    });

    const iconPath = path.join(UXP_ROOT, 'icons', 'dark.png');
    const imageData = fs.readFileSync(iconPath).toString('base64');
    const placed = await callPhotoshopToolStable('placeImage', {
      imageData,
      imageFormat: 'png',
      name: 'smart_scaling_actual_bounds_probe',
      center: false,
      x: 64,
      y: 48,
      scale: 100
    });
    assertToolSuccess(report, 'placeImage.probe', placed);
    const layerId = Number(placed?.data?.layerId);
    assertCondition(report, 'placed image layer id returned', Number.isFinite(layerId), {
      result: summarizeResult(placed)
    });

    const initialProperties = await callPhotoshopToolStable('getLayerProperties', { layerId });
    assertToolSuccess(report, 'getLayerProperties.initial', initialProperties);
    const initialBounds = boundsFromProperties(initialProperties);
    assertCondition(report, 'initial bounds are readable', Boolean(initialBounds), {
      result: summarizeResult(initialProperties)
    });

    const scalePercent = 150;
    const expectedScaledWidth = initialBounds.width * scalePercent / 100;
    const expectedScaledHeight = initialBounds.height * scalePercent / 100;
    report.scalePlan = {
      scalePercent,
      initialBounds,
      expectedScaledWidth,
      expectedScaledHeight
    };

    const transform = await callPhotoshopToolStable('transformLayer', {
      layerId,
      scaleUniform: scalePercent
    }, {
      attempts: 8,
      delayMs: 400
    });
    assertToolSuccess(report, 'transformLayer.scale150', transform);

    const afterTransformProperties = await callPhotoshopToolStable('getLayerProperties', { layerId });
    assertToolSuccess(report, 'getLayerProperties.afterTransform', afterTransformProperties);
    const afterTransformBounds = boundsFromProperties(afterTransformProperties);
    assertCondition(report, 'after-transform bounds are readable', Boolean(afterTransformBounds), {
      result: summarizeResult(afterTransformProperties)
    });

    const scaledWidthDeviation = Math.abs(afterTransformBounds.width - expectedScaledWidth);
    const scaledHeightDeviation = Math.abs(afterTransformBounds.height - expectedScaledHeight);
    report.scaleReadback = {
      expectedWidth: expectedScaledWidth,
      expectedHeight: expectedScaledHeight,
      actualWidth: afterTransformBounds.width,
      actualHeight: afterTransformBounds.height,
      widthDeviation: scaledWidthDeviation,
      heightDeviation: scaledHeightDeviation,
      tolerancePx: TOLERANCE_PX
    };
    assertCondition(report, 'scaled width matches planned scale tolerance', scaledWidthDeviation <= TOLERANCE_PX, report.scaleReadback);
    assertCondition(report, 'scaled height matches planned scale tolerance', scaledHeightDeviation <= TOLERANCE_PX, report.scaleReadback);

    const plannedLeft = 220;
    const plannedTop = 140;
    const plannedBounds = {
      left: plannedLeft,
      top: plannedTop,
      right: plannedLeft + expectedScaledWidth,
      bottom: plannedTop + expectedScaledHeight,
      width: expectedScaledWidth,
      height: expectedScaledHeight
    };
    report.plannedBounds = plannedBounds;

    const move = await callPhotoshopToolStable('moveLayer', {
      layerId,
      x: plannedLeft,
      y: plannedTop,
      relative: false
    }, {
      attempts: 8,
      delayMs: 400
    });
    assertToolSuccess(report, 'moveLayer.toPlannedTopLeft', move);

    const finalProperties = await callPhotoshopToolStable('getLayerProperties', { layerId });
    assertToolSuccess(report, 'getLayerProperties.final', finalProperties);
    const actualBounds = boundsFromProperties(finalProperties);
    assertCondition(report, 'actualBounds are readable after move', Boolean(actualBounds), {
      result: summarizeResult(finalProperties)
    });

    const comparison = compareBounds(plannedBounds, actualBounds);
    comparison.tolerancePx = TOLERANCE_PX;
    report.actualBounds = actualBounds;
    report.boundsComparison = comparison;
    report.noDesignQualityClaim = true;

    assertCondition(report, 'actualBounds match plannedBounds tolerance', comparison.maxAbsDeviation <= TOLERANCE_PX, comparison);

    const failurePathResults = [];

    const missingTransformLayer = await callPhotoshopToolStable('transformLayer', {
      layerId: 999999999,
      scaleUniform: 120
    }, {
      attempts: 3,
      delayMs: 200
    });
    pushExpectedFailure(report, 'expectedFailure.transformLayer.missingLayer', missingTransformLayer);
    const missingTransformLayerEvidence = expectedFailureResult('transformLayer', missingTransformLayer);
    failurePathResults.push(missingTransformLayerEvidence);
    assertCondition(report, 'transformLayer missing layer returns structured failure', missingTransformLayerEvidence.expectedFailure && missingTransformLayerEvidence.hasErrorMessage, missingTransformLayerEvidence);

    const missingMoveLayer = await callPhotoshopToolStable('moveLayer', {
      layerId: 999999999,
      x: 0,
      y: 0,
      relative: false
    }, {
      attempts: 3,
      delayMs: 200
    });
    pushExpectedFailure(report, 'expectedFailure.moveLayer.missingLayer', missingMoveLayer);
    const missingMoveLayerEvidence = expectedFailureResult('moveLayer', missingMoveLayer);
    failurePathResults.push(missingMoveLayerEvidence);
    assertCondition(report, 'moveLayer missing layer returns structured failure', missingMoveLayerEvidence.expectedFailure && missingMoveLayerEvidence.hasErrorMessage && missingMoveLayerEvidence.category === 'missing_target', missingMoveLayerEvidence);

    const missingMoveLayerToGroupSource = await callPhotoshopToolStable('moveLayerToGroup', {
      layerId: 999999999,
      targetGroupId: layerId
    }, {
      attempts: 3,
      delayMs: 200
    });
    pushExpectedFailure(report, 'expectedFailure.moveLayerToGroup.missingSourceLayer', missingMoveLayerToGroupSource);
    const missingMoveLayerToGroupSourceEvidence = expectedFailureResult('moveLayerToGroup', missingMoveLayerToGroupSource);
    failurePathResults.push(missingMoveLayerToGroupSourceEvidence);
    assertCondition(report, 'moveLayerToGroup missing source returns structured failure', missingMoveLayerToGroupSourceEvidence.expectedFailure && missingMoveLayerToGroupSourceEvidence.hasErrorMessage && missingMoveLayerToGroupSourceEvidence.category === 'missing_target', missingMoveLayerToGroupSourceEvidence);

    const nonGroupTargetShape = await callPhotoshopToolStable('createRectangle', {
      name: 'expected_failure_non_group_target',
      x: 16,
      y: 16,
      width: 24,
      height: 24,
      fillColorHex: '#222222'
    }, {
      attempts: 6,
      delayMs: 250
    });
    assertToolSuccess(report, 'createRectangle.nonGroupTargetProbe', nonGroupTargetShape);
    const nonGroupTargetId = Number(nonGroupTargetShape?.layerId || nonGroupTargetShape?.data?.layerId);
    assertCondition(report, 'non-group target layer id returned', Number.isFinite(nonGroupTargetId), {
      result: summarizeResult(nonGroupTargetShape)
    });

    const nonGroupMoveLayerToGroup = await callPhotoshopToolStable('moveLayerToGroup', {
      layerId,
      targetGroupId: nonGroupTargetId
    }, {
      attempts: 3,
      delayMs: 200
    });
    pushExpectedFailure(report, 'expectedFailure.moveLayerToGroup.nonGroupTarget', nonGroupMoveLayerToGroup);
    const nonGroupMoveLayerToGroupEvidence = expectedFailureResult('moveLayerToGroup', nonGroupMoveLayerToGroup);
    failurePathResults.push(nonGroupMoveLayerToGroupEvidence);
    assertCondition(report, 'moveLayerToGroup non-group target returns structured failure', nonGroupMoveLayerToGroupEvidence.expectedFailure && nonGroupMoveLayerToGroupEvidence.hasErrorMessage && nonGroupMoveLayerToGroupEvidence.category === 'missing_target', nonGroupMoveLayerToGroupEvidence);

    const corruptImage = await callPhotoshopToolStable('placeImage', {
      imageData: 'not-a-valid-png',
      imageFormat: 'png',
      name: 'expected_failure_corrupt_png',
      center: false
    }, {
      attempts: 3,
      delayMs: 200
    });
    pushExpectedFailure(report, 'expectedFailure.placeImage.corruptImage', corruptImage);
    const corruptImageEvidence = expectedFailureResult('placeImage', corruptImage);
    failurePathResults.push(corruptImageEvidence);
    assertCondition(report, 'placeImage corrupt image returns popup-prevented structured failure', corruptImageEvidence.expectedFailure && corruptImageEvidence.hasErrorMessage && corruptImageEvidence.popupPrevented, corruptImageEvidence);

    report.failurePathResults = failurePathResults;
  } finally {
    await cleanupDisposable(report, disposableDocumentId, originalDocumentId);
  }

  assertCondition(report, 'disposable document closed', report.cleanup?.disposableStillOpen === false, {
    cleanup: report.cleanup
  });
  assertCondition(report, 'original document restored or unavailable', report.cleanup?.restoredOriginal === true, {
    cleanup: report.cleanup
  });
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Smart Scaling Actual Bounds Live Smoke');
  lines.push('');
  lines.push(`- Outcome: ${report.outcome}`);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${ENDPOINT}`);
  lines.push(`- Disposable document: ${report.disposableDocumentName || 'n/a'}`);
  lines.push(`- Tolerance: ${TOLERANCE_PX}px`);
  lines.push(`- No design quality claim: ${report.noDesignQualityClaim === true}`);
  lines.push('');
  lines.push('## Bounds');
  lines.push('');
  lines.push('```json');
  lines.push(asJson({
    scalePlan: report.scalePlan || null,
    scaleReadback: report.scaleReadback || null,
    plannedBounds: report.plannedBounds || null,
    actualBounds: report.actualBounds || null,
    boundsComparison: report.boundsComparison || null,
    failurePathResults: report.failurePathResults || []
  }));
  lines.push('```');
  lines.push('');
  lines.push('## Assertions');
  lines.push('');
  for (const assertion of report.assertions || []) {
    lines.push(`- ${assertion.passed ? 'PASS' : 'FAIL'} ${assertion.name}`);
  }
  if (report.error) {
    lines.push('');
    lines.push('## Error');
    lines.push('');
    lines.push('```text');
    lines.push(report.error);
    lines.push('```');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureDir(TMP_DIR);
  const report = {
    generatedAt: new Date().toISOString(),
    outcome: 'fail',
    steps: [],
    assertions: [],
    cleanup: {},
    noDesignQualityClaim: true
  };

  try {
    await runScenario(report);
    report.outcome = 'pass';
  } catch (error) {
    report.outcome = 'fail';
    report.error = error?.stack || error?.message || String(error);
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    outcome: report.outcome,
    connected: report.systemStatus?.pluginConnected === true,
    plannedBounds: report.plannedBounds || null,
    actualBounds: report.actualBounds || null,
    maxAbsDeviation: report.boundsComparison?.maxAbsDeviation ?? null,
    failurePathResults: report.failurePathResults || [],
    tolerancePx: TOLERANCE_PX,
    noDesignQualityClaim: report.noDesignQualityClaim === true,
    cleanup: report.cleanup
  }, null, 2));

  if (report.outcome !== 'pass') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
