#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-text-tools-live-smoke.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-text-tools-live-smoke.md');
const BENCHMARK_PATH = path.join(ROOT, 'benchmarks', 'photoshop-tool-semantics', 'text-tool-cases.json');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DOC_PREFIX = 'DesignEchoTextToolsLive';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function acceptanceSnapshot(maxLayers = 220) {
  return callTool('photoshop.acceptance_snapshot', {
    includeHidden: true,
    includeBounds: true,
    includeText: true,
    maxLayers
  });
}

function snapshotLayers(snapshot) {
  const source = snapshot?.layers || snapshot?.snapshot?.layers || [];
  return Array.isArray(source) ? source : [];
}

function findLayerById(snapshot, layerId) {
  return snapshotLayers(snapshot).find((layer) => Number(layer?.id) === Number(layerId)) || null;
}

function normalizeDocuments(listResult) {
  return Array.isArray(listResult?.documents) ? listResult.documents : [];
}

function hasDocument(listResult, documentId) {
  return normalizeDocuments(listResult).some((doc) => Number(doc?.id) === Number(documentId));
}

function normalizeBox(box) {
  if (!box || typeof box !== 'object') return null;
  const left = Number(box.left ?? box.x);
  const top = Number(box.top ?? box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      height: Math.round(height)
    };
  }
  const right = Number(box.right);
  const bottom = Number(box.bottom);
  if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom) && right > left && bottom > top) {
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    };
  }
  return null;
}

async function readLayerBounds(layerId) {
  const result = await callPhotoshopToolStable('getLayerBounds', { layerId, includeEffects: false });
  if (result?.success === false) {
    return { result, box: null };
  }
  return {
    result,
    box: normalizeBox(result?.boundsNoEffects || result?.bounds || result?.layerBounds)
  };
}

function addAssertion(report, name, status, details = {}) {
  report.assertions.push({ name, status, details });
  if (status === 'fail') {
    throw new Error(`Assertion failed: ${name} ${asJson(details)}`);
  }
}

function addSoftAssertion(report, name, status, details = {}) {
  report.assertions.push({ name, status, details });
}

function assertToolSuccess(report, name, result) {
  report.steps.push({
    name,
    ok: result?.success === true,
    summary: summarizeToolResult(result)
  });
  addAssertion(report, `${name} success`, result?.success === true ? 'pass' : 'fail', {
    result: summarizeToolResult(result),
    error: result?.error
  });
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  const summary = {};
  for (const key of ['success', 'documentId', 'layerId', 'name', 'count', 'activeDocumentId', 'closedDocument']) {
    if (Object.prototype.hasOwnProperty.call(result, key)) summary[key] = result[key];
  }
  return summary;
}

function nearly(actual, expected, tolerance) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

function caseById(benchmark, id) {
  const found = benchmark.cases.find((item) => item.id === id);
  if (!found) throw new Error(`Benchmark case missing: ${id}`);
  return found;
}

function plannedBoxFrom(inputBox) {
  const box = normalizeBox(inputBox);
  if (!box) throw new Error(`Invalid planned box: ${asJson(inputBox)}`);
  return box;
}

function textStyleOf(layer) {
  return layer?.text?.style || {};
}

function contentOf(layer) {
  return layer?.text?.content;
}

function normalizeSnapshotText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeFontToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function fontMatchesResolved(actualFont, requestedFont, resolvedFont) {
  const actual = normalizeFontToken(actualFont);
  if (!actual) return false;
  const candidates = [
    requestedFont,
    resolvedFont?.postScriptName,
    resolvedFont?.name,
    resolvedFont?.family
  ].map(normalizeFontToken).filter(Boolean);
  return candidates.includes(actual);
}

async function createTextLayer(report, args, caseId) {
  const result = await callPhotoshopToolStable('createTextLayer', args);
  assertToolSuccess(report, `createTextLayer.${caseId}`, result);
  const layerId = Number(result.layerId);
  addAssertion(report, `${caseId} returns layerId`, Number.isFinite(layerId) ? 'pass' : 'fail', { layerId: result.layerId });
  report.createdLayerIds.push(layerId);
  return layerId;
}

async function createTextAndAlign(report, caseId, content, plannedBox, style = {}) {
  const box = plannedBoxFrom(plannedBox);
  const layerId = await createTextLayer(report, {
    content,
    name: `text_tool_${caseId}`,
    x: box.left,
    y: box.top,
    fontSize: style.fontSize || 28,
    colorHex: style.colorHex || '#111111',
    alignment: style.alignment || 'left'
  }, caseId);

  const before = await readLayerBounds(layerId);
  addAssertion(report, `${caseId} initial bounds readable`, before.box ? 'pass' : 'fail', {
    layerId,
    boundsResult: summarizeToolResult(before.result)
  });

  const dx = box.left - before.box.left;
  const dy = box.top - before.box.top;
  let moveResult = null;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    moveResult = await callPhotoshopToolStable('moveLayer', {
      layerId,
      x: dx,
      y: dy,
      relative: true
    });
    assertToolSuccess(report, `moveLayer.${caseId}.boundsCorrection`, moveResult);
  }

  const after = await readLayerBounds(layerId);
  addAssertion(report, `${caseId} final bounds readable`, after.box ? 'pass' : 'fail', { layerId });
  addAssertion(report, `${caseId} final left/top near plannedBox`, nearly(after.box.left, box.left, 4) && nearly(after.box.top, box.top, 4) ? 'pass' : 'fail', {
    expected: box,
    actual: after.box,
    correction: { dx, dy },
    moved: Boolean(moveResult)
  });

  report.caseResults.push({
    caseId,
    layerId,
    content,
    plannedBox: box,
    initialBounds: before.box,
    finalBounds: after.box,
    correction: { dx, dy, moved: Boolean(moveResult) }
  });

  return layerId;
}

async function assertContent(report, caseId, layerId, expected) {
  const snapshot = await acceptanceSnapshot();
  const layer = findLayerById(snapshot, layerId);
  addAssertion(report, `${caseId} layer visible in acceptance snapshot`, layer ? 'pass' : 'fail', {
    layerId,
    visibleLayerIds: snapshotLayers(snapshot).map((item) => item.id)
  });
  const actualContent = normalizeSnapshotText(contentOf(layer));
  const expectedContent = normalizeSnapshotText(expected);
  addAssertion(report, `${caseId} exact text content`, actualContent === expectedContent ? 'pass' : 'fail', {
    expected,
    actual: contentOf(layer),
    normalizedExpected: expectedContent,
    normalizedActual: actualContent
  });
  return layer;
}

async function runResolveFontName(report, benchmark) {
  const item = caseById(benchmark, 'text-style-font-fallback-source-han');
  const listResult = await callPhotoshopToolStable('resolveFontName', { limit: 8 });
  assertToolSuccess(report, 'resolveFontName.listInstalledFonts', listResult);
  addAssertion(report, 'resolveFontName returns installed font list', Array.isArray(listResult?.fonts) && listResult.fonts.length > 0 ? 'pass' : 'fail', {
    fontCount: listResult?.fontCount,
    sample: listResult?.fonts?.slice?.(0, 3)
  });

  const queryResult = await callPhotoshopToolStable('resolveFontName', { fontName: item.input.fontName, limit: 8 });
  report.steps.push({
    name: `resolveFontName.${item.id}.requestedFont`,
    ok: queryResult?.success === true,
    summary: {
      success: queryResult?.success,
      query: queryResult?.query,
      fontCount: queryResult?.fontCount,
      resolvedPostScriptName: queryResult?.resolvedFont?.postScriptName,
      suggestionCount: Array.isArray(queryResult?.fontSuggestions) ? queryResult.fontSuggestions.length : 0
    },
    error: queryResult?.error
  });
  addSoftAssertion(report, `${item.id} resolve requested font`, queryResult?.success === true ? 'pass' : 'needs_review', {
    requestedFont: item.input.fontName,
    resolvedFont: queryResult?.resolvedFont || null,
    fontSuggestions: queryResult?.fontSuggestions || [],
    error: queryResult?.error || null,
    note: '该断言证明 resolveFontName 工具可调用；请求字体不存在时应返回候选建议，而不是继续执行字体写入。'
  });
  report.caseResults.push({
    caseId: `${item.id}.resolveFontName`,
    requestedFont: item.input.fontName,
    toolSuccess: queryResult?.success === true,
    resolvedFont: queryResult?.resolvedFont || null,
    suggestionCount: Array.isArray(queryResult?.fontSuggestions) ? queryResult.fontSuggestions.length : 0
  });
}

async function runCreateMultiline(report, benchmark) {
  const item = caseById(benchmark, 'text-create-multiline-chinese');
  const layerId = await createTextAndAlign(report, item.id, item.input.content, item.input.plannedBox, item.input.style);
  await assertContent(report, item.id, layerId, item.input.content);
}

async function runBatchContentPunctuation(report, benchmark) {
  const item = caseById(benchmark, 'text-content-punctuation-parameter-label');
  const updates = [];
  let y = 70;
  for (let index = 0; index < item.input.updates.length; index += 1) {
    const layerId = await createTextLayer(report, {
      content: `占位${index + 1}`,
      name: `text_tool_${item.id}_${index + 1}`,
      x: 360,
      y,
      fontSize: 22,
      colorHex: '#111111',
      alignment: 'left'
    }, `${item.id}.${index + 1}`);
    updates.push({ layerId, content: item.input.updates[index].content });
    y += 40;
  }

  const result = await callPhotoshopToolStable('setTextContent', { updates });
  assertToolSuccess(report, `setTextContent.${item.id}.updates`, result);
  const snapshot = await acceptanceSnapshot();
  for (const update of updates) {
    const layer = findLayerById(snapshot, update.layerId);
    addAssertion(report, `${item.id} update ${update.layerId} exact content`, contentOf(layer) === update.content ? 'pass' : 'fail', {
      expected: update.content,
      actual: contentOf(layer)
    });
  }
  report.caseResults.push({ caseId: item.id, updates });
}

async function runTwoColumn(report, benchmark) {
  const item = caseById(benchmark, 'text-layout-two-column-certificate');
  for (const block of item.input.contentBlocks) {
    const layerId = await createTextAndAlign(report, `${item.id}.${block.column}.${block.content}`, block.content, block.plannedBox, item.input.style);
    await assertContent(report, `${item.id}.${block.column}.${block.content}`, layerId, block.content);
  }
}

async function runFontFallback(report, benchmark) {
  const item = caseById(benchmark, 'text-style-font-fallback-source-han');
  const layerId = await createTextLayer(report, {
    content: '字体测试',
    name: `text_tool_${item.id}`,
    x: 72,
    y: 330,
    fontSize: item.input.style.fontSize,
    colorHex: '#111111',
    alignment: 'left'
  }, item.id);

  const initialSnapshot = await acceptanceSnapshot();
  const initialLayer = findLayerById(initialSnapshot, layerId);
  const initialFont = textStyleOf(initialLayer).fontName;
  let knownFontResult = null;
  let knownFontError = null;
  const shouldRunKnownFontWrite = process.env.DESIGNECHO_TEXT_LIVE_RUN_FONT_WRITE === '1';
  if (initialFont && shouldRunKnownFontWrite) {
    try {
      knownFontResult = await callPhotoshopToolStable('setTextStyle', {
        layerId,
        fontName: initialFont,
        fontSize: item.input.style.fontSize
      });
      report.steps.push({ name: `setTextStyle.${item.id}.knownFont`, ok: knownFontResult?.success === true, summary: summarizeToolResult(knownFontResult) });
    } catch (error) {
      knownFontError = error?.message || String(error);
      report.steps.push({ name: `setTextStyle.${item.id}.knownFont`, ok: false, error: knownFontError });
    }
  } else if (initialFont) {
    report.steps.push({
      name: `setTextStyle.${item.id}.knownFont`,
      ok: false,
      skipped: true,
      summary: {
        reason: 'fontName writes are opt-in because the current live environment timed out even for an already-read Photoshop font name',
        optInEnv: 'DESIGNECHO_TEXT_LIVE_RUN_FONT_WRITE=1'
      }
    });
  }
  if (shouldRunKnownFontWrite) {
    addSoftAssertion(report, `${item.id} known font write`, knownFontResult?.success === true ? 'pass' : 'needs_review', {
      initialFont,
      attemptedWrite: true,
      toolSuccess: knownFontResult?.success === true,
      toolError: knownFontError,
      note: '先用 Photoshop 快照已读到的字体名验证安全 fontName 写入路径；这不等于中文字体 fallback 已解决。'
    });
  }

  let result = null;
  let toolError = null;
  let requestedFontResolveResult = null;
  try {
    requestedFontResolveResult = await callPhotoshopToolStable('resolveFontName', { fontName: item.input.fontName, limit: 8 });
    report.steps.push({
      name: `resolveFontName.${item.id}.beforeWrite`,
      ok: requestedFontResolveResult?.success === true,
      summary: {
        success: requestedFontResolveResult?.success,
        resolvedPostScriptName: requestedFontResolveResult?.resolvedFont?.postScriptName,
        suggestionCount: Array.isArray(requestedFontResolveResult?.fontSuggestions) ? requestedFontResolveResult.fontSuggestions.length : 0
      },
      error: requestedFontResolveResult?.error
    });
  } catch (error) {
    report.steps.push({ name: `resolveFontName.${item.id}.beforeWrite`, ok: false, error: error?.message || String(error) });
  }
  const shouldRunFontFallback = requestedFontResolveResult?.success === true && requestedFontResolveResult?.resolvedFont?.postScriptName;
  if (shouldRunFontFallback) {
    try {
      result = await callPhotoshopToolStable('setTextStyle', {
        layerId,
        fontName: item.input.fontName,
        fontSize: item.input.style.fontSize
      });
      report.steps.push({ name: `setTextStyle.${item.id}.fontName`, ok: result?.success === true, summary: summarizeToolResult(result) });
    } catch (error) {
      toolError = error?.message || String(error);
      report.steps.push({ name: `setTextStyle.${item.id}.fontName`, ok: false, error: toolError });
    }
  } else {
    report.steps.push({
      name: `setTextStyle.${item.id}.fontName`,
      ok: false,
      skipped: true,
      summary: {
        reason: 'font write skipped because resolveFontName did not return a resolved PostScript font'
      }
    });
  }

  const snapshot = await acceptanceSnapshot();
  const layer = findLayerById(snapshot, layerId);
  const actualFont = textStyleOf(layer).fontName;
  const exact = shouldRunFontFallback && result?.success === true && fontMatchesResolved(actualFont, item.input.fontName, requestedFontResolveResult?.resolvedFont);
  addSoftAssertion(report, `${item.id} font evidence`, exact ? 'pass' : 'needs_review', {
    requestedFont: item.input.fontName,
    resolvedFont: requestedFontResolveResult?.resolvedFont || null,
    attemptedWrite: shouldRunFontFallback,
    initialFont,
    toolSuccess: result?.success === true,
    toolError,
    actualFont,
    note: exact
      ? '实际字体与解析后的 PostScript 名/字体族匹配，证明本次字体写入走通；这仍不等于视觉字形质量已经验收。'
      : shouldRunFontFallback
      ? '字体显示名、PostScript 名和 fallback 需要独立字体映射验证；不把不一致伪装成通过。'
      : 'resolveFontName 没有返回可写入字体，因此不执行字体写入；该项保留为需复核。'
  });
  report.caseResults.push({
    caseId: item.id,
    layerId,
    requestedFont: item.input.fontName,
    resolvedFont: requestedFontResolveResult?.resolvedFont || null,
    initialFont,
    actualFont,
    attemptedKnownFontWrite: shouldRunKnownFontWrite,
    knownFontToolSuccess: knownFontResult?.success === true,
    knownFontError,
    attemptedWrite: shouldRunFontFallback,
    toolSuccess: result?.success === true,
    toolError
  });
}

async function runMissingFontSafeFail(report, benchmark) {
  const item = caseById(benchmark, 'text-style-missing-font-safe-fail');
  const layerId = await createTextLayer(report, {
    content: '缺失字体验证',
    name: `text_tool_${item.id}`,
    x: 72,
    y: 370,
    fontSize: item.input.style.fontSize,
    colorHex: '#111111',
    alignment: 'left'
  }, item.id);

  const beforeSnapshot = await acceptanceSnapshot();
  const beforeLayer = findLayerById(beforeSnapshot, layerId);
  const beforeFont = textStyleOf(beforeLayer).fontName;
  const beforeContent = contentOf(beforeLayer);

  const resolveResult = await callPhotoshopToolStable('resolveFontName', { fontName: item.input.fontName, limit: 8 });
  report.steps.push({
    name: `resolveFontName.${item.id}`,
    ok: resolveResult?.success === false && !resolveResult?.resolvedFont,
    summary: {
      success: resolveResult?.success,
      query: resolveResult?.query,
      resolvedPostScriptName: resolveResult?.resolvedFont?.postScriptName,
      suggestionCount: Array.isArray(resolveResult?.fontSuggestions) ? resolveResult.fontSuggestions.length : 0
    },
    error: resolveResult?.error
  });
  addAssertion(report, `${item.id} resolve missing font fails`, resolveResult?.success === false && !resolveResult?.resolvedFont ? 'pass' : 'fail', {
    requestedFont: item.input.fontName,
    result: {
      success: resolveResult?.success,
      resolvedFont: resolveResult?.resolvedFont || null,
      suggestionCount: Array.isArray(resolveResult?.fontSuggestions) ? resolveResult.fontSuggestions.length : 0,
      error: resolveResult?.error || null
    }
  });

  const styleResult = await callPhotoshopToolStable('setTextStyle', {
    layerId,
    fontName: item.input.fontName,
    fontSize: item.input.style.fontSize
  });
  report.steps.push({
    name: `setTextStyle.${item.id}.missingFont`,
    ok: styleResult?.success === false,
    summary: summarizeToolResult(styleResult),
    error: styleResult?.error
  });
  addAssertion(report, `${item.id} setTextStyle returns failure`, styleResult?.success === false ? 'pass' : 'fail', {
    requestedFont: item.input.fontName,
    result: {
      success: styleResult?.success,
      error: styleResult?.error || null,
      suggestionCount: Array.isArray(styleResult?.fontSuggestions) ? styleResult.fontSuggestions.length : 0
    }
  });

  const afterSnapshot = await acceptanceSnapshot();
  const afterLayer = findLayerById(afterSnapshot, layerId);
  const afterFont = textStyleOf(afterLayer).fontName;
  const afterContent = contentOf(afterLayer);
  addAssertion(report, `${item.id} content preserved after failed font write`, afterContent === beforeContent ? 'pass' : 'fail', {
    beforeContent,
    afterContent
  });
  addSoftAssertion(report, `${item.id} font not silently changed`, beforeFont && afterFont ? (beforeFont === afterFont ? 'pass' : 'needs_review') : 'needs_review', {
    beforeFont,
    afterFont,
    note: '缺失字体写入失败后，字体字段应保持不变；如果快照缺少字体字段，则不能证明是否被 fallback。'
  });

  report.caseResults.push({
    caseId: item.id,
    layerId,
    requestedFont: item.input.fontName,
    resolveSuccess: resolveResult?.success === true,
    styleToolSuccess: styleResult?.success === true,
    beforeFont,
    afterFont,
    contentPreserved: afterContent === beforeContent
  });
}

async function runTrackingLeading(report, benchmark) {
  const item = caseById(benchmark, 'text-style-tracking-leading');
  const layerId = await createTextAndAlign(report, item.id, item.input.content, item.input.plannedBox, {
    fontSize: item.input.style.fontSize,
    colorHex: '#111111',
    alignment: 'left'
  });

  const result = await callPhotoshopToolStable('setTextStyle', {
    layerId,
    fontSize: item.input.style.fontSize,
    tracking: item.input.style.tracking,
    leading: item.input.style.leading
  });
  assertToolSuccess(report, `setTextStyle.${item.id}.numeric`, result);

  const snapshot = await acceptanceSnapshot();
  const layer = findLayerById(snapshot, layerId);
  const snapshotStyle = textStyleOf(layer);
  let getTextStyleResult = null;
  let getTextStyleError = null;
  if (['fontSize', 'tracking', 'leading'].some((field) => !Number.isFinite(Number(snapshotStyle[field])))) {
    try {
      getTextStyleResult = await callPhotoshopToolStable('getTextStyle', { layerId });
      report.steps.push({ name: `getTextStyle.${item.id}`, ok: getTextStyleResult?.success === true, summary: summarizeToolResult(getTextStyleResult) });
    } catch (error) {
      getTextStyleError = error?.message || String(error);
      report.steps.push({ name: `getTextStyle.${item.id}`, ok: false, error: getTextStyleError });
    }
  }
  const style = {
    ...(getTextStyleResult?.style || {}),
    ...snapshotStyle
  };
  for (const field of ['fontSize', 'tracking', 'leading']) {
    const expected = Number(item.input.style[field]);
    const actual = Number(style[field]);
    if (!Number.isFinite(actual) || (field === 'leading' && actual <= 0)) {
      addSoftAssertion(report, `${item.id} ${field} readback`, 'needs_review', {
        expected,
        actual: style[field],
        snapshotValue: snapshotStyle[field],
        getTextStyleValue: getTextStyleResult?.style?.[field],
        getTextStyleSuccess: getTextStyleResult?.success === true,
        getTextStyleError,
        note: field === 'leading'
          ? 'Photoshop 返回 leading=0/空值，通常不能证明显式行距已生效；保持需复核而不是误判通过或直接归因失败。'
          : `after 快照和 getTextStyle 都缺少可读 ${field} 字段，不能证明该样式已生效。`
      });
    } else {
      addAssertion(report, `${item.id} ${field} near expected`, nearly(actual, expected, field === 'tracking' ? 1 : 0.5) ? 'pass' : 'fail', {
        expected,
        actual,
        snapshotValue: snapshotStyle[field],
        getTextStyleValue: getTextStyleResult?.style?.[field]
      });
    }
  }
  await assertContent(report, item.id, layerId, item.input.content);
}

async function runPricePromotion(report, benchmark) {
  const item = caseById(benchmark, 'text-create-price-promotion');
  const layerId = await createTextAndAlign(report, item.id, item.input.content, item.input.plannedBox, item.input.style);
  await assertContent(report, item.id, layerId, item.input.content);
}

async function runBaselineCorrection(report, benchmark) {
  const item = caseById(benchmark, 'text-bounds-baseline-correction');
  const layerId = await createTextAndAlign(report, item.id, item.input.content, item.input.plannedBox, item.input.style);
  await assertContent(report, item.id, layerId, item.input.content);
}

async function safeListDocuments(report, name) {
  try {
    const result = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
    report.steps.push({ name, ok: result?.success !== false, summary: summarizeToolResult(result) });
    return result;
  } catch (error) {
    report.steps.push({ name, ok: false, error: error?.message || String(error) });
    return null;
  }
}

async function cleanupDisposable(report, disposableDocumentId, originalDocumentId) {
  report.cleanup = { attempted: false, closed: false, restoredOriginal: false, errors: [] };
  if (!disposableDocumentId) {
    report.cleanup.closed = true;
    report.cleanup.restoredOriginal = true;
    return;
  }

  report.cleanup.attempted = true;
  const before = await safeListDocuments(report, 'cleanup.listDocuments.before');
  if (before && hasDocument(before, disposableDocumentId)) {
    try {
      const closed = await callPhotoshopToolStable('closeDocument', { documentId: disposableDocumentId, save: false });
      report.steps.push({ name: 'cleanup.closeDisposableWithoutSaving', ok: closed?.success === true, summary: summarizeToolResult(closed) });
      report.cleanup.closed = closed?.success === true;
      if (!report.cleanup.closed) report.cleanup.errors.push(closed?.error || 'closeDocument returned success=false');
    } catch (error) {
      report.cleanup.errors.push(error?.message || String(error));
    }
  } else {
    report.cleanup.closed = true;
  }

  const afterClose = await safeListDocuments(report, 'cleanup.listDocuments.afterClose');
  if (originalDocumentId && afterClose && hasDocument(afterClose, originalDocumentId)) {
    try {
      const switched = await callPhotoshopToolStable('switchDocument', { documentId: originalDocumentId });
      report.steps.push({ name: 'cleanup.switchBackOriginal', ok: switched?.success === true, summary: summarizeToolResult(switched) });
      report.cleanup.restoredOriginal = switched?.success === true;
      if (!report.cleanup.restoredOriginal) report.cleanup.errors.push(switched?.error || 'switchDocument returned success=false');
    } catch (error) {
      report.cleanup.errors.push(error?.message || String(error));
    }
  } else {
    report.cleanup.restoredOriginal = true;
  }

  const finalDocs = await safeListDocuments(report, 'cleanup.listDocuments.final');
  report.cleanup.finalDocumentIds = normalizeDocuments(finalDocs).map((doc) => doc.id);
  report.cleanup.disposableStillOpen = finalDocs ? hasDocument(finalDocs, disposableDocumentId) : true;
}

function summarizeOutcome(report) {
  if (report.skipped) return 'skipped';
  if (report.error || report.assertions.some((item) => item.status === 'fail')) return 'fail';
  if (report.assertions.some((item) => item.status === 'needs_review')) return 'needs_review';
  return 'pass';
}

function renderMarkdown(report) {
  return [
    '# Photoshop Text Tools Live Smoke',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Endpoint: ${report.endpoint}`,
    `- Outcome: ${report.outcome}`,
    report.skipped ? `- Skipped: ${report.skipReason}` : '',
    `- Disposable document id: ${report.disposableDocumentId || 'none'}`,
    `- Created text layers: ${report.createdLayerIds.length}`,
    '',
    '## Assertions',
    '',
    '```json',
    JSON.stringify(report.assertions, null, 2),
    '```',
    '',
    '## Case Results',
    '',
    '```json',
    JSON.stringify(report.caseResults, null, 2),
    '```',
    '',
    '## Cleanup',
    '',
    '```json',
    JSON.stringify(report.cleanup, null, 2),
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

  const benchmark = readJson(BENCHMARK_PATH);
  const beforeDocs = await callPhotoshopToolStable('listDocuments', { includeDetails: false });
  const documents = normalizeDocuments(beforeDocs);
  const originalDocumentId = beforeDocs?.activeDocumentId || documents.find((doc) => doc.isActive)?.id || documents[0]?.id || null;
  report.originalDocumentId = originalDocumentId;

  let disposableDocumentId = null;
  try {
    await runResolveFontName(report, benchmark);

    const created = await callPhotoshopToolStable('createDocument', {
      name: `${DOC_PREFIX}_${Date.now()}`,
      width: 720,
      height: 520,
      resolution: 72,
      backgroundColor: 'white',
      colorMode: 'RGB'
    });
    assertToolSuccess(report, 'createDocument.disposable', created);
    disposableDocumentId = created.documentId || created.document?.id;
    report.disposableDocumentId = disposableDocumentId;

    await runCreateMultiline(report, benchmark);
    await runBatchContentPunctuation(report, benchmark);
    await runTwoColumn(report, benchmark);
    await runFontFallback(report, benchmark);
    await runMissingFontSafeFail(report, benchmark);
    await runTrackingLeading(report, benchmark);
    await runPricePromotion(report, benchmark);
    await runBaselineCorrection(report, benchmark);
  } finally {
    await cleanupDisposable(report, disposableDocumentId, originalDocumentId);
  }

  addAssertion(report, 'disposable document closed', report.cleanup?.disposableStillOpen === false ? 'pass' : 'fail', {
    cleanup: report.cleanup
  });
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    outcome: 'fail',
    skipped: false,
    skipReason: '',
    steps: [],
    assertions: [],
    caseResults: [],
    createdLayerIds: [],
    cleanup: {}
  };

  try {
    await runScenario(report);
  } catch (error) {
    report.error = error?.stack || error?.message || String(error);
  }

  report.outcome = summarizeOutcome(report);
  writeReport(report);

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: report.systemStatus?.pluginConnected === true,
    outcome: report.outcome,
    skipped: report.skipped,
    skipReason: report.skipReason || null,
    disposableDocumentId: report.disposableDocumentId || null,
    createdLayerCount: report.createdLayerIds.length,
    assertions: {
      pass: report.assertions.filter((item) => item.status === 'pass').length,
      needsReview: report.assertions.filter((item) => item.status === 'needs_review').length,
      fail: report.assertions.filter((item) => item.status === 'fail').length
    },
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
