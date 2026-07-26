#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  buildToolAcceptanceVerification: buildToolAcceptanceEvidence,
  getToolAcceptanceCapturePolicy,
  shouldCollectAcceptanceVerification: shouldCollectAcceptanceEvidence
} = require('../src/shared/acceptance/tool-acceptance.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function layer(id, bounds, content = '标题', fontName = 'SourceHanSansCN-Regular', kind = id === 1 ? 'text' : 'pixel', name, visible = true, style = {}) {
  const isText = kind === 'text';
  const layerName = name || (id === 1 ? '标题' : `图层 ${id}`);
  return {
    id,
    name: layerName,
    kind,
    visible,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    depth: 0,
    index: id - 1,
    parentId: null,
    parentName: null,
    path: layerName,
    selected: false,
    bounds,
    text: isText ? { content, length: content.length, style: { fontName, fontSize: 32, ...style } } : undefined
  };
}

let nextHistoryStateId = 1000;

function snapshot(layers, document = { id: 1, name: '验收.psd', width: 800, height: 1200, mode: 'RGB' }, selectedLayerIds = []) {
  return {
    success: true,
    hasDocument: !!document,
    document: document || undefined,
    historyStateRef: document
      ? { documentId: document.id, historyStateId: nextHistoryStateId++ }
      : undefined,
    selectedLayerIds,
    layers,
    summary: {
      totalLayers: layers.length,
      selectedLayers: selectedLayerIds.length,
      hiddenLayers: 0,
      lockedLayers: 0,
      textLayers: layers.filter((item) => item.kind === 'text').length,
      groupLayers: 0,
      smartObjectLayers: 0,
      shapeLayers: 0,
      pixelLayers: layers.filter((item) => item.kind === 'pixel').length,
      truncated: false
    },
    warnings: []
  };
}

function run() {
  assert(shouldCollectAcceptanceEvidence('getDocumentInfo') === false, 'read tool should not collect acceptance evidence');
  assert(shouldCollectAcceptanceEvidence('getAcceptanceSnapshot') === false, 'acceptance tool must not recursively collect evidence');
  assert(shouldCollectAcceptanceEvidence('setTextStyle') === true, 'text style write should collect evidence');
  assert(shouldCollectAcceptanceEvidence('placeImage') === true, 'placeImage should collect evidence');
  assert(shouldCollectAcceptanceEvidence('skuLayout', { action: 'listLayerSets' }) === false, 'skuLayout read action should not collect evidence');
  assert(shouldCollectAcceptanceEvidence('skuLayout', { action: 'execute' }) === true, 'skuLayout execute should collect evidence');
  assert(shouldCollectAcceptanceEvidence('setTextStyle', { acceptance: false }) === false, 'explicit acceptance=false should disable evidence collection');

  const textPolicy = getToolAcceptanceCapturePolicy('setTextStyle');
  const imagePolicy = getToolAcceptanceCapturePolicy('placeImage');
  const bulkPolicy = getToolAcceptanceCapturePolicy('skuLayout', { action: 'execute' });
  const deepPolicy = getToolAcceptanceCapturePolicy('placeImage', { acceptanceMode: 'deep' });

  assert(textPolicy.collect === true && textPolicy.includeText === true, `text policy should keep text evidence: ${JSON.stringify(textPolicy)}`);
  assert(imagePolicy.collect === true && imagePolicy.includeText === false, `image policy should avoid text scan by default: ${JSON.stringify(imagePolicy)}`);
  assert(bulkPolicy.collect === true && bulkPolicy.maxLayers > imagePolicy.maxLayers, `bulk policy should allow wider layer budget: ${JSON.stringify(bulkPolicy)}`);
  assert(deepPolicy.collect === true && deepPolicy.includeText === true && deepPolicy.maxLayers > imagePolicy.maxLayers, `deep policy should expand evidence: ${JSON.stringify(deepPolicy)}`);

  // 验收分级（2026-07-07 系统改造③）：轻量结构写只需层级+bounds diff，砍层数与超时——
  // 单步 reorderLayer 扛 16s 全套验收是真机 110 步病例的时间大头
  const lightPolicy = getToolAcceptanceCapturePolicy('reorderLayer');
  assert(lightPolicy.mode === 'light' && lightPolicy.includeText === false && lightPolicy.includeBounds === true,
    `structure mutation should use light acceptance: ${JSON.stringify(lightPolicy)}`);
  assert(lightPolicy.maxLayers < imagePolicy.maxLayers && lightPolicy.timeoutMs < imagePolicy.timeoutMs,
    `light budget must be smaller than standard: ${JSON.stringify({ light: lightPolicy.maxLayers, std: imagePolicy.maxLayers })}`);
  for (const lightTool of ['renameLayer', 'moveLayerToGroup', 'groupLayers', 'createClippingMask', 'releaseClippingMask']) {
    assert(getToolAcceptanceCapturePolicy(lightTool).mode === 'light', `${lightTool} should be light acceptance`);
  }
  const lightDeep = getToolAcceptanceCapturePolicy('reorderLayer', { acceptanceMode: 'deep' });
  assert(lightDeep.mode === 'deep' && lightDeep.includeText === true, `explicit deep must override light: ${JSON.stringify(lightDeep)}`);
  assert(getToolAcceptanceCapturePolicy('placeImage').mode === 'standard', 'pixel mutation must stay standard acceptance');
  assert(getToolAcceptanceCapturePolicy('setTextContent').mode !== 'light', 'text mutation must keep text evidence (not light)');

  const before = snapshot([
    layer(1, { left: 10, top: 10, right: 210, bottom: 70, width: 200, height: 60 }, '旧标题')
  ]);
  const after = snapshot([
    layer(1, { left: 12, top: 10, right: 232, bottom: 78, width: 220, height: 68 }, '新标题', 'SourceHanSansCN-Bold')
  ]);

  const changed = buildToolAcceptanceEvidence({
    toolName: 'setTextStyle',
    params: { fontName: 'SourceHanSansCN-Bold', layerId: 1 },
    result: { success: true },
    before: { snapshot: before },
    after: { snapshot: after }
  });
  assert(changed.status === 'collected', `changed evidence should be collected: ${JSON.stringify(changed)}`);
  assert(changed.verified === true, `changed evidence should be verified: ${JSON.stringify(changed)}`);
  assert(changed.diff.summary.textChanged === 1, `text change expected: ${JSON.stringify(changed)}`);
  assert(changed.diff.summary.geometryChanged === 1, `geometry change expected: ${JSON.stringify(changed)}`);
  assert(changed.summaryText && changed.summaryText.includes('写后检查'), `changed verification should include user summary: ${JSON.stringify(changed)}`);
  assert(changed.debugText && changed.debugText.includes('status=collected'), `changed evidence should include debug summary: ${JSON.stringify(changed)}`);
  assert(changed.assertionStatus === 'passed', `font assertion should pass when target font matches: ${JSON.stringify(changed)}`);
  assert(changed.summaryText.includes('任务断言通过'), `summary should include passed assertion: ${JSON.stringify(changed)}`);

  const unchanged = buildToolAcceptanceEvidence({
    toolName: 'setTextStyle',
    params: { fontName: 'SourceHanSansCN-Bold', layerId: 1 },
    result: { success: true },
    before: { snapshot: before },
    after: { snapshot: before }
  });
  assert(unchanged.noDocumentChangeRisk === true, `unchanged write should be flagged: ${JSON.stringify(unchanged)}`);
  assert(unchanged.verified === false, `unchanged write should not be verified: ${JSON.stringify(unchanged)}`);
  assert(unchanged.summaryText.includes('验收警告'), `unchanged write should expose warning summary: ${JSON.stringify(unchanged)}`);
  assert(unchanged.assertionStatus === 'failed', `explicit font target mismatch should fail assertion: ${JSON.stringify(unchanged)}`);
  assert(unchanged.summaryText.includes('任务断言失败'), `summary should include failed assertion: ${JSON.stringify(unchanged)}`);

  const inferredScopeMismatch = buildToolAcceptanceEvidence({
    toolName: 'setTextStyle',
    params: { fontName: 'SourceHanSansCN-Bold' },
    result: { success: true },
    before: { snapshot: before },
    after: { snapshot: before }
  });
  assert(inferredScopeMismatch.assertionStatus === 'needs_review', `implicit target scope should require review instead of failing: ${JSON.stringify(inferredScopeMismatch)}`);
  assert(inferredScopeMismatch.summaryText.includes('任务断言需复核'), `summary should include review assertion: ${JSON.stringify(inferredScopeMismatch)}`);

  const textChanged = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: { layerId: 1, content: '新标题' },
    result: { success: true },
    before: { snapshot: before },
    after: { snapshot: after }
  });
  assert(textChanged.assertionStatus === 'passed', `text content assertion should pass: ${JSON.stringify(textChanged)}`);
  assert(textChanged.summaryText.includes('任务断言通过'), `text content summary should include passed assertion: ${JSON.stringify(textChanged)}`);

  const failedToolResult = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: { layerId: 1, content: '新标题' },
    result: { success: false, error: 'mock write failed' },
    before: { snapshot: before },
    after: { snapshot: after }
  });
  assert(failedToolResult.toolSucceeded === false, `failed tool result should record toolSucceeded=false: ${JSON.stringify(failedToolResult)}`);
  assert(failedToolResult.verified === false, `failed tool result must not be verified: ${JSON.stringify(failedToolResult)}`);
  assert(failedToolResult.summaryText.includes('工具返回失败'), `failed tool summary should not claim success: ${JSON.stringify(failedToolResult)}`);
  assert(failedToolResult.summaryText.includes('任务断言仅供诊断'), `failed tool should not claim passed task assertion: ${JSON.stringify(failedToolResult)}`);

  const textUnchanged = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: { layerId: 1, content: '目标标题' },
    result: { success: true },
    before: { snapshot: before },
    after: { snapshot: before }
  });
  assert(textUnchanged.assertionStatus === 'failed', `explicit text content mismatch should fail: ${JSON.stringify(textUnchanged)}`);
  assert(textUnchanged.verified === false, `failed text assertion should mark write unverified: ${JSON.stringify(textUnchanged)}`);
  assert(textUnchanged.summaryText.includes('任务断言失败'), `text content summary should include failed assertion: ${JSON.stringify(textUnchanged)}`);

  const missingTextTarget = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: { layerId: 999, content: '目标标题' },
    result: { success: true },
    before: { snapshot: before },
    after: { snapshot: before }
  });
  assert(missingTextTarget.assertionStatus === 'failed', `missing explicit text target should fail: ${JSON.stringify(missingTextTarget)}`);
  assert(missingTextTarget.verified === false, `missing explicit text target should not be verified: ${JSON.stringify(missingTextTarget)}`);
  assert(missingTextTarget.summaryText.includes('显式目标文本图层不存在'), `missing target summary should be explicit: ${JSON.stringify(missingTextTarget)}`);

  const missingFontTarget = buildToolAcceptanceEvidence({
    toolName: 'setTextStyle',
    params: { layerId: 999, fontName: 'SourceHanSansCN-Bold' },
    result: { success: true },
    before: { snapshot: before },
    after: { snapshot: before }
  });
  assert(missingFontTarget.assertionStatus === 'failed', `missing explicit font target should fail: ${JSON.stringify(missingFontTarget)}`);
  assert(missingFontTarget.summaryText.includes('显式目标文本图层不存在'), `missing font target summary should be explicit: ${JSON.stringify(missingFontTarget)}`);

  const styleBefore = snapshot([
    layer(1, { left: 10, top: 10, right: 210, bottom: 70, width: 200, height: 60 }, '多行说明\n第二行', 'SourceHanSansCN-Regular', 'text', '正文', true, { fontSize: 24, tracking: 0, leading: 28 })
  ]);
  const styleAfter = snapshot([
    layer(1, { left: 10, top: 10, right: 230, bottom: 82, width: 220, height: 72 }, '多行说明\n第二行', 'SourceHanSansCN-Regular', 'text', '正文', true, { fontSize: 28, tracking: 40, leading: 36 })
  ]);
  const styleNumeric = buildToolAcceptanceEvidence({
    toolName: 'setTextStyle',
    params: { layerId: 1, fontSize: 28, tracking: 40, leading: 36 },
    result: { success: true },
    before: { snapshot: styleBefore },
    after: { snapshot: styleAfter }
  });
  assert(styleNumeric.assertionStatus === 'passed', `numeric text style assertions should pass: ${JSON.stringify(styleNumeric)}`);
  assert(styleNumeric.assertions.length === 3, `numeric text style should emit one assertion per numeric field: ${JSON.stringify(styleNumeric)}`);

  const styleWrongAfter = snapshot([
    layer(1, { left: 10, top: 10, right: 230, bottom: 82, width: 220, height: 72 }, '多行说明\n第二行', 'SourceHanSansCN-Regular', 'text', '正文', true, { fontSize: 20, tracking: 40, leading: 36 })
  ]);
  const styleWrongSize = buildToolAcceptanceEvidence({
    toolName: 'setTextStyle',
    params: { layerId: 1, fontSize: 28, tracking: 40, leading: 36 },
    result: { success: true },
    before: { snapshot: styleBefore },
    after: { snapshot: styleWrongAfter }
  });
  assert(styleWrongSize.assertionStatus === 'failed', `wrong text fontSize should fail: ${JSON.stringify(styleWrongSize)}`);
  assert(styleWrongSize.summaryText.includes('文字字号验收失败'), `wrong text fontSize summary should be explicit: ${JSON.stringify(styleWrongSize)}`);

  const styleMissingTrackingAfter = snapshot([
    layer(1, { left: 10, top: 10, right: 230, bottom: 82, width: 220, height: 72 }, '多行说明\n第二行', 'SourceHanSansCN-Regular', 'text', '正文', true, { fontSize: 28, leading: 36 })
  ]);
  delete styleMissingTrackingAfter.layers[0].text.style.tracking;
  const styleMissingTracking = buildToolAcceptanceEvidence({
    toolName: 'setTextStyle',
    params: { layerId: 1, tracking: 40 },
    result: { success: true },
    before: { snapshot: styleBefore },
    after: { snapshot: styleMissingTrackingAfter }
  });
  assert(styleMissingTracking.assertionStatus === 'needs_review', `missing tracking readback should require review: ${JSON.stringify(styleMissingTracking)}`);
  assert(styleMissingTracking.summaryText.includes('缺少可读 tracking 字段'), `missing tracking summary should be explicit: ${JSON.stringify(styleMissingTracking)}`);

  const multiTextBefore = snapshot([
    layer(1, { left: 10, top: 10, right: 210, bottom: 70, width: 200, height: 60 }, '旧标题'),
    layer(2, { left: 10, top: 90, right: 260, bottom: 130, width: 250, height: 40 }, '旧副标题', 'SourceHanSansCN-Regular', 'text')
  ]);
  const multiTextAfter = snapshot([
    layer(1, { left: 10, top: 10, right: 210, bottom: 70, width: 200, height: 60 }, '主标题'),
    layer(2, { left: 10, top: 90, right: 260, bottom: 130, width: 250, height: 40 }, '副标题', 'SourceHanSansCN-Regular', 'text')
  ]);
  const multiTextChanged = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: {
      updates: [
        { layerId: 1, content: '主标题' },
        { layerId: 2, content: '副标题' }
      ]
    },
    result: { success: true },
    before: { snapshot: multiTextBefore },
    after: { snapshot: multiTextAfter }
  });
  assert(multiTextChanged.assertionStatus === 'passed', `batch text content assertion should pass: ${JSON.stringify(multiTextChanged)}`);

  const partialMissingBatch = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: {
      updates: [
        { layerId: 1, content: '主标题' },
        { layerId: 999, content: '缺失标题' }
      ]
    },
    result: { success: true },
    before: { snapshot: multiTextBefore },
    after: { snapshot: multiTextAfter }
  });
  assert(partialMissingBatch.assertionStatus === 'failed', `batch missing explicit text target should fail: ${JSON.stringify(partialMissingBatch)}`);
  assert(partialMissingBatch.summaryText.includes('任务断言失败'), `batch missing target summary should include failed assertion: ${JSON.stringify(partialMissingBatch)}`);

  const multilineBefore = snapshot([
    layer(1, { left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100 }, '旧标题')
  ]);
  const multilineAfter = snapshot([
    layer(1, { left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100 }, '第一行\n第二行')
  ]);
  const multilineTextChanged = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: { layerId: 1, content: '第一行\r第二行' },
    result: { success: true },
    before: { snapshot: multilineBefore },
    after: { snapshot: multilineAfter }
  });
  assert(multilineTextChanged.assertionStatus === 'passed', `CR newline should normalize to LF: ${JSON.stringify(multilineTextChanged)}`);

  const inferredTextMismatch = buildToolAcceptanceEvidence({
    toolName: 'setTextContent',
    params: { content: '统一标题' },
    result: { success: true },
    before: { snapshot: multiTextBefore },
    after: { snapshot: multiTextBefore }
  });
  assert(inferredTextMismatch.assertionStatus === 'needs_review', `implicit text content target mismatch should require review: ${JSON.stringify(inferredTextMismatch)}`);
  assert(inferredTextMismatch.summaryText.includes('任务断言需复核'), `implicit text content summary should include review assertion: ${JSON.stringify(inferredTextMismatch)}`);

  const closeBefore = snapshot([
    layer(1, { left: 10, top: 10, right: 210, bottom: 70, width: 200, height: 60 }, '旧标题')
  ], { id: 1, name: '待关闭.psd', width: 800, height: 1200, mode: 'RGB' });
  const closeAfter = snapshot([
    layer(3, { left: 10, top: 10, right: 210, bottom: 70, width: 200, height: 60 }, '其他文档标题')
  ], { id: 2, name: '保留文档.psd', width: 800, height: 1200, mode: 'RGB' });
  const closeActiveDocument = buildToolAcceptanceEvidence({
    toolName: 'closeDocument',
    params: { save: false },
    result: { success: true, closedDocument: '待关闭.psd' },
    before: { snapshot: closeBefore },
    after: { snapshot: closeAfter }
  });
  assert(closeActiveDocument.assertionStatus === 'passed', `active document close should pass: ${JSON.stringify(closeActiveDocument)}`);
  assert(closeActiveDocument.verified === true, `active document close should be verified by active document change: ${JSON.stringify(closeActiveDocument)}`);
  assert(closeActiveDocument.summaryText.includes('任务断言通过'), `close summary should include passed assertion: ${JSON.stringify(closeActiveDocument)}`);

  const closeSameDocument = buildToolAcceptanceEvidence({
    toolName: 'closeDocument',
    params: { save: false },
    result: { success: true, closedDocument: '待关闭.psd' },
    before: { snapshot: closeBefore },
    after: { snapshot: closeBefore }
  });
  assert(closeSameDocument.assertionStatus === 'failed', `same active document after close should fail: ${JSON.stringify(closeSameDocument)}`);
  assert(closeSameDocument.verified === false, `failed close assertion should not verify task: ${JSON.stringify(closeSameDocument)}`);

  const closeNonActiveDocument = buildToolAcceptanceEvidence({
    toolName: 'closeDocument',
    params: { documentId: 999, save: false },
    result: { success: true, closedDocument: '其他.psd' },
    before: { snapshot: closeBefore },
    after: { snapshot: closeBefore }
  });
  assert(closeNonActiveDocument.assertionStatus === 'needs_review', `non-active document close should require review: ${JSON.stringify(closeNonActiveDocument)}`);
  assert(closeNonActiveDocument.verified === false, `non-active document close should not be verified from active snapshot only: ${JSON.stringify(closeNonActiveDocument)}`);
  assert(closeNonActiveDocument.summaryText.includes('任务断言需复核'), `non-active close summary should include review assertion: ${JSON.stringify(closeNonActiveDocument)}`);

  const moveBefore = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '移动前')
  ]);
  const moveAfter = snapshot([
    layer(1, { left: 100, top: 200, right: 200, bottom: 260, width: 100, height: 60 }, '移动后')
  ]);
  const moveAbsolute = buildToolAcceptanceEvidence({
    toolName: 'moveLayer',
    params: { layerId: 1, x: 100, y: 200 },
    result: { success: true, layerId: 1 },
    before: { snapshot: moveBefore },
    after: { snapshot: moveAfter }
  });
  assert(moveAbsolute.assertionStatus === 'passed', `absolute move should pass: ${JSON.stringify(moveAbsolute)}`);
  assert(moveAbsolute.verified === true, `absolute move should be verified: ${JSON.stringify(moveAbsolute)}`);

  const moveRelativeAfter = snapshot([
    layer(1, { left: 25, top: 15, right: 125, bottom: 75, width: 100, height: 60 }, '移动后')
  ]);
  const moveRelative = buildToolAcceptanceEvidence({
    toolName: 'moveLayer',
    params: { layerId: 1, x: 15, y: -5, relative: true },
    result: { success: true, layerId: 1 },
    before: { snapshot: moveBefore },
    after: { snapshot: moveRelativeAfter }
  });
  assert(moveRelative.assertionStatus === 'passed', `relative move should pass: ${JSON.stringify(moveRelative)}`);

  const moveWrongPosition = buildToolAcceptanceEvidence({
    toolName: 'moveLayer',
    params: { layerId: 1, x: 100, y: 200 },
    result: { success: true, layerId: 1 },
    before: { snapshot: moveBefore },
    after: { snapshot: moveRelativeAfter }
  });
  assert(moveWrongPosition.assertionStatus === 'failed', `wrong move position should fail: ${JSON.stringify(moveWrongPosition)}`);
  assert(moveWrongPosition.verified === false, `wrong move position should not verify task: ${JSON.stringify(moveWrongPosition)}`);

  const moveSelectedBefore = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '移动前')
  ], { id: 1, name: '验收.psd', width: 800, height: 1200, mode: 'RGB' }, [1]);
  const moveSelected = buildToolAcceptanceEvidence({
    toolName: 'moveLayer',
    params: { x: 100, y: 200 },
    result: { success: true, layerId: 1 },
    before: { snapshot: moveSelectedBefore },
    after: { snapshot: moveAfter }
  });
  assert(moveSelected.assertionStatus === 'passed', `single selected layer move should pass: ${JSON.stringify(moveSelected)}`);

  const moveMultiSelectedBefore = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '移动前'),
    layer(2, { left: 50, top: 60, right: 150, bottom: 120, width: 100, height: 60 }, '移动前2', 'SourceHanSansCN-Regular', 'text')
  ], { id: 1, name: '验收.psd', width: 800, height: 1200, mode: 'RGB' }, [1, 2]);
  const moveMultiSelected = buildToolAcceptanceEvidence({
    toolName: 'moveLayer',
    params: { x: 100, y: 200 },
    result: { success: true, layerId: 1 },
    before: { snapshot: moveMultiSelectedBefore },
    after: {
      snapshot: snapshot([
        layer(1, { left: 100, top: 200, right: 200, bottom: 260, width: 100, height: 60 }, '移动后'),
        layer(2, { left: 50, top: 60, right: 150, bottom: 120, width: 100, height: 60 }, '移动前2', 'SourceHanSansCN-Regular', 'text')
      ])
    }
  });
  assert(moveMultiSelected.assertionStatus === 'needs_review', `multi-selected move should require review: ${JSON.stringify(moveMultiSelected)}`);
  assert(moveMultiSelected.verified === false, `multi-selected move should not verify task: ${JSON.stringify(moveMultiSelected)}`);

  const placeBefore = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题')
  ]);
  const placeAfter = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题'),
    layer(3, { left: 50, top: 80, right: 250, bottom: 280, width: 200, height: 200 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '产品图')
  ]);
  const placeImage = buildToolAcceptanceEvidence({
    toolName: 'placeImage',
    params: { x: 50, y: 80, name: '产品图' },
    result: { success: true, data: { layerId: 3 } },
    before: { snapshot: placeBefore },
    after: { snapshot: placeAfter }
  });
  assert(placeImage.assertionStatus === 'passed', `placeImage should pass when returned layer exists and position matches: ${JSON.stringify(placeImage)}`);
  assert(placeImage.verified === true, `placeImage should be verified with added layer evidence: ${JSON.stringify(placeImage)}`);

  const placeMissingLayer = buildToolAcceptanceEvidence({
    toolName: 'placeImage',
    params: { x: 50, y: 80 },
    result: { success: true, data: { layerId: 999 } },
    before: { snapshot: placeBefore },
    after: { snapshot: placeAfter }
  });
  assert(placeMissingLayer.assertionStatus === 'failed', `placeImage missing returned layer should fail: ${JSON.stringify(placeMissingLayer)}`);
  assert(placeMissingLayer.verified === false, `placeImage missing returned layer should not verify task: ${JSON.stringify(placeMissingLayer)}`);

  const placeWrongPosition = buildToolAcceptanceEvidence({
    toolName: 'placeImage',
    params: { x: 10, y: 20 },
    result: { success: true, data: { layerId: 3 } },
    before: { snapshot: placeBefore },
    after: { snapshot: placeAfter }
  });
  assert(placeWrongPosition.assertionStatus === 'failed', `placeImage wrong position should fail: ${JSON.stringify(placeWrongPosition)}`);
  assert(placeWrongPosition.verified === false, `placeImage wrong position should not verify task: ${JSON.stringify(placeWrongPosition)}`);

  const placeAmbiguous = buildToolAcceptanceEvidence({
    toolName: 'placeImage',
    params: {},
    result: { success: true, data: {} },
    before: { snapshot: placeBefore },
    after: {
      snapshot: snapshot([
        layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题'),
        layer(3, { left: 50, top: 80, right: 250, bottom: 280, width: 200, height: 200 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '产品图'),
        layer(4, { left: 300, top: 80, right: 500, bottom: 280, width: 200, height: 200 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '背景图')
      ])
    }
  });
  assert(placeAmbiguous.assertionStatus === 'needs_review', `placeImage ambiguous added layers should require review: ${JSON.stringify(placeAmbiguous)}`);
  assert(placeAmbiguous.verified === false, `placeImage ambiguous added layers should not verify task: ${JSON.stringify(placeAmbiguous)}`);

  const placeholderBounds = { left: 100, top: 120, right: 340, bottom: 420, width: 240, height: 300 };
  const replaceBefore = snapshot([
    layer(5, placeholderBounds, '标题', 'SourceHanSansCN-Regular', 'pixel', '[IMG:hero]')
  ]);
  const replaceAfter = snapshot([
    layer(6, placeholderBounds, '标题', 'SourceHanSansCN-Regular', 'pixel', '[IMG:hero]')
  ]);
  const replacePlaceholder = buildToolAcceptanceEvidence({
    toolName: 'replaceImagePlaceholder',
    params: { placeholderLayerId: 5, placementTransform: { destinationBox: { x: 100, y: 120, width: 240, height: 300 } } },
    result: {
      success: true,
      layerId: 6,
      targetLayerId: 5,
      placementAudit: {
        status: 'ok',
        plannedBounds: placeholderBounds,
        actualBounds: placeholderBounds,
        deviation: { left: 0, top: 0, width: 0, height: 0, maxAbs: 0 },
        notes: []
      }
    },
    before: { snapshot: replaceBefore },
    after: { snapshot: replaceAfter }
  });
  assert(replacePlaceholder.assertionStatus === 'passed', `replaceImagePlaceholder should pass when replacement layer and bounds match: ${JSON.stringify(replacePlaceholder)}`);
  assert(replacePlaceholder.verified === true, `replaceImagePlaceholder should be verified when bounds match: ${JSON.stringify(replacePlaceholder)}`);

  const replaceWatchAfter = snapshot([
    layer(6, { left: 105, top: 120, right: 345, bottom: 420, width: 240, height: 300 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '[IMG:hero]')
  ]);
  const replaceWatch = buildToolAcceptanceEvidence({
    toolName: 'replaceImagePlaceholder',
    params: { placeholderLayerId: 5, placementTransform: { destinationBox: { x: 100, y: 120, width: 240, height: 300 } } },
    result: {
      success: true,
      layerId: 6,
      targetLayerId: 5,
      placementAudit: {
        status: 'watch',
        plannedBounds: placeholderBounds,
        actualBounds: { left: 105, top: 120, right: 345, bottom: 420, width: 240, height: 300 },
        deviation: { left: 5, top: 0, width: 0, height: 0, maxAbs: 5 },
        notes: ['actual bounds deviate from planned bounds by 5.0px']
      }
    },
    before: { snapshot: replaceBefore },
    after: { snapshot: replaceWatchAfter }
  });
  assert(replaceWatch.assertionStatus === 'needs_review', `replaceImagePlaceholder watch placement should require review: ${JSON.stringify(replaceWatch)}`);
  assert(replaceWatch.verified === false, `replaceImagePlaceholder watch placement should not verify task: ${JSON.stringify(replaceWatch)}`);

  const replaceMismatchAfter = snapshot([
    layer(6, { left: 140, top: 120, right: 380, bottom: 420, width: 240, height: 300 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '[IMG:hero]')
  ]);
  const replaceMismatch = buildToolAcceptanceEvidence({
    toolName: 'replaceImagePlaceholder',
    params: { placeholderLayerId: 5, placementTransform: { destinationBox: { x: 100, y: 120, width: 240, height: 300 } } },
    result: {
      success: true,
      layerId: 6,
      targetLayerId: 5,
      placementAudit: {
        status: 'ok',
        plannedBounds: placeholderBounds,
        actualBounds: placeholderBounds,
        deviation: { left: 0, top: 0, width: 0, height: 0, maxAbs: 0 },
        notes: []
      }
    },
    before: { snapshot: replaceBefore },
    after: { snapshot: replaceMismatchAfter }
  });
  assert(replaceMismatch.assertionStatus === 'failed', `replaceImagePlaceholder snapshot bounds mismatch should fail even if audit says ok: ${JSON.stringify(replaceMismatch)}`);
  assert(replaceMismatch.verified === false, `replaceImagePlaceholder mismatch should not verify task: ${JSON.stringify(replaceMismatch)}`);

  const replaceTargetStillExists = buildToolAcceptanceEvidence({
    toolName: 'replaceImagePlaceholder',
    params: { placeholderLayerId: 5 },
    result: {
      success: true,
      layerId: 6,
      targetLayerId: 5,
      placementAudit: {
        status: 'ok',
        plannedBounds: placeholderBounds,
        actualBounds: placeholderBounds,
        deviation: { left: 0, top: 0, width: 0, height: 0, maxAbs: 0 },
        notes: []
      }
    },
    before: { snapshot: replaceBefore },
    after: {
      snapshot: snapshot([
        layer(5, placeholderBounds, '标题', 'SourceHanSansCN-Regular', 'pixel', '[IMG:hero]'),
        layer(6, placeholderBounds, '标题', 'SourceHanSansCN-Regular', 'pixel', '[IMG:hero]')
      ])
    }
  });
  assert(replaceTargetStillExists.assertionStatus === 'failed', `replaceImagePlaceholder should fail when old target still exists: ${JSON.stringify(replaceTargetStillExists)}`);
  assert(replaceTargetStillExists.verified === false, `replaceImagePlaceholder target-still-exists should not verify task: ${JSON.stringify(replaceTargetStillExists)}`);

  const replaceContentBefore = snapshot([
    layer(7, { left: 30, top: 40, right: 130, bottom: 140, width: 100, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '袜子原图')
  ]);
  const replaceContentAfter = snapshot([
    layer(7, { left: 30, top: 40, right: 130, bottom: 140, width: 100, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '袜子原图', false),
    layer(8, { left: 30, top: 40, right: 130, bottom: 140, width: 100, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '袜子原图_warped')
  ]);
  const replaceLayerContent = buildToolAcceptanceEvidence({
    toolName: 'replaceLayerContent',
    params: { layerId: 7, bounds: { left: 30, top: 40, width: 100, height: 100 } },
    result: { success: true, data: { originalLayerId: 7, newLayerId: 8, width: 100, height: 100 } },
    before: { snapshot: replaceContentBefore },
    after: { snapshot: replaceContentAfter }
  });
  assert(replaceLayerContent.assertionStatus === 'passed', `replaceLayerContent should pass when new layer exists, original hidden, and bounds match: ${JSON.stringify(replaceLayerContent)}`);
  assert(replaceLayerContent.verified === true, `replaceLayerContent should be verified with structure and bounds evidence: ${JSON.stringify(replaceLayerContent)}`);

  const replaceLayerContentVisibleOriginal = buildToolAcceptanceEvidence({
    toolName: 'replaceLayerContent',
    params: { layerId: 7, bounds: { left: 30, top: 40, width: 100, height: 100 } },
    result: { success: true, data: { originalLayerId: 7, newLayerId: 8, width: 100, height: 100 } },
    before: { snapshot: replaceContentBefore },
    after: {
      snapshot: snapshot([
        layer(7, { left: 30, top: 40, right: 130, bottom: 140, width: 100, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '袜子原图'),
        layer(8, { left: 30, top: 40, right: 130, bottom: 140, width: 100, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '袜子原图_warped')
      ])
    }
  });
  assert(replaceLayerContentVisibleOriginal.assertionStatus === 'failed', `replaceLayerContent should fail when original layer remains visible: ${JSON.stringify(replaceLayerContentVisibleOriginal)}`);
  assert(replaceLayerContentVisibleOriginal.verified === false, `replaceLayerContent visible original should not verify task: ${JSON.stringify(replaceLayerContentVisibleOriginal)}`);

  const replaceLayerContentWrongBounds = buildToolAcceptanceEvidence({
    toolName: 'replaceLayerContent',
    params: { layerId: 7, bounds: { left: 30, top: 40, width: 100, height: 100 } },
    result: { success: true, data: { originalLayerId: 7, newLayerId: 8, width: 100, height: 100 } },
    before: { snapshot: replaceContentBefore },
    after: {
      snapshot: snapshot([
        layer(7, { left: 30, top: 40, right: 130, bottom: 140, width: 100, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '袜子原图', false),
        layer(8, { left: 60, top: 40, right: 160, bottom: 140, width: 100, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '袜子原图_warped')
      ])
    }
  });
  assert(replaceLayerContentWrongBounds.assertionStatus === 'failed', `replaceLayerContent should fail when replacement bounds deviate too much: ${JSON.stringify(replaceLayerContentWrongBounds)}`);
  assert(replaceLayerContentWrongBounds.verified === false, `replaceLayerContent wrong bounds should not verify task: ${JSON.stringify(replaceLayerContentWrongBounds)}`);

  const createBefore = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题')
  ]);
  const createTextAfter = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题'),
    layer(9, { left: 100, top: 120, right: 260, bottom: 170, width: 160, height: 50 }, '新品上市', 'SourceHanSansCN-Regular', 'text', '标题文案', true, { tracking: 30, leading: 38 })
  ]);
  const createTextLayer = buildToolAcceptanceEvidence({
    toolName: 'createTextLayer',
    params: { content: '新品上市', name: '标题文案', x: 100, y: 120, fontSize: 32, tracking: 30, leading: 38 },
    result: { success: true, layerId: 9, layerName: '标题文案', content: '新品上市' },
    before: { snapshot: createBefore },
    after: { snapshot: createTextAfter }
  });
  assert(createTextLayer.assertionStatus === 'passed', `createTextLayer should pass with added text layer and matching content: ${JSON.stringify(createTextLayer)}`);
  assert(createTextLayer.verified === true, `createTextLayer should be verified: ${JSON.stringify(createTextLayer)}`);

  const createTextMissingLayer = buildToolAcceptanceEvidence({
    toolName: 'createTextLayer',
    params: { content: '新品上市', x: 100, y: 120 },
    result: { success: true, layerId: 999, layerName: '标题文案', content: '新品上市' },
    before: { snapshot: createBefore },
    after: { snapshot: createTextAfter }
  });
  assert(createTextMissingLayer.assertionStatus === 'failed', `createTextLayer missing returned layer should fail: ${JSON.stringify(createTextMissingLayer)}`);
  assert(createTextMissingLayer.verified === false, `createTextLayer missing layer should not verify task: ${JSON.stringify(createTextMissingLayer)}`);

  const createTextWrongSizeAfter = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题'),
    layer(9, { left: 100, top: 120, right: 260, bottom: 170, width: 160, height: 50 }, '新品上市', 'SourceHanSansCN-Regular', 'text', '标题文案')
  ]);
  createTextWrongSizeAfter.layers[1].text.style.fontSize = 20;
  const createTextWrongFontSize = buildToolAcceptanceEvidence({
    toolName: 'createTextLayer',
    params: { content: '新品上市', name: '标题文案', x: 100, y: 120, fontSize: 32 },
    result: { success: true, layerId: 9, layerName: '标题文案', content: '新品上市' },
    before: { snapshot: createBefore },
    after: { snapshot: createTextWrongSizeAfter }
  });
  assert(createTextWrongFontSize.assertionStatus === 'failed', `createTextLayer wrong fontSize should fail: ${JSON.stringify(createTextWrongFontSize)}`);
  assert(createTextWrongFontSize.verified === false, `createTextLayer wrong fontSize should not verify task: ${JSON.stringify(createTextWrongFontSize)}`);

  const rectangleAfter = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题'),
    layer(10, { left: 40, top: 60, right: 240, bottom: 160, width: 200, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'solidColor', '信息卡片')
  ]);
  const createRectangle = buildToolAcceptanceEvidence({
    toolName: 'createRectangle',
    params: { name: '信息卡片', x: 40, y: 60, width: 200, height: 100 },
    result: { success: true, layerId: 10, layerName: '信息卡片', shapeType: 'rectangle' },
    before: { snapshot: createBefore },
    after: { snapshot: rectangleAfter }
  });
  assert(createRectangle.assertionStatus === 'passed', `createRectangle should pass with added shape and matching bounds: ${JSON.stringify(createRectangle)}`);
  assert(createRectangle.verified === true, `createRectangle should be verified: ${JSON.stringify(createRectangle)}`);

  const rectangleWrongBounds = buildToolAcceptanceEvidence({
    toolName: 'createRectangle',
    params: { name: '信息卡片', x: 40, y: 60, width: 200, height: 100 },
    result: { success: true, layerId: 10, layerName: '信息卡片', shapeType: 'rectangle' },
    before: { snapshot: createBefore },
    after: {
      snapshot: snapshot([
        layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题'),
        layer(10, { left: 70, top: 60, right: 270, bottom: 160, width: 200, height: 100 }, '标题', 'SourceHanSansCN-Regular', 'solidColor', '信息卡片')
      ])
    }
  });
  assert(rectangleWrongBounds.assertionStatus === 'failed', `createRectangle wrong bounds should fail: ${JSON.stringify(rectangleWrongBounds)}`);
  assert(rectangleWrongBounds.verified === false, `createRectangle wrong bounds should not verify task: ${JSON.stringify(rectangleWrongBounds)}`);

  const ellipseAfter = snapshot([
    layer(1, { left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }, '旧标题'),
    layer(11, { left: 150, top: 270, right: 250, bottom: 330, width: 100, height: 60 }, '标题', 'SourceHanSansCN-Regular', 'solidColor', '圆形徽章')
  ]);
  const createEllipse = buildToolAcceptanceEvidence({
    toolName: 'createEllipse',
    params: { name: '圆形徽章', x: 200, y: 300, width: 100, height: 60 },
    result: { success: true, layerId: 11, layerName: '圆形徽章', shapeType: 'ellipse' },
    before: { snapshot: createBefore },
    after: { snapshot: ellipseAfter }
  });
  assert(createEllipse.assertionStatus === 'passed', `createEllipse should pass with center-based expected bounds: ${JSON.stringify(createEllipse)}`);
  assert(createEllipse.verified === true, `createEllipse should be verified: ${JSON.stringify(createEllipse)}`);

  const fillPlan = {
    screenId: 2,
    screenName: '详情首屏',
    copies: [{ layerId: 30, layerName: '标题', content: '新品详情' }],
    images: [{ layerId: 31, layerName: '产品图', imagePath: 'C:/tmp/product.png' }]
  };
  const fillBefore = snapshot([
    layer(30, { left: 10, top: 20, right: 210, bottom: 70, width: 200, height: 50 }, '旧标题', 'SourceHanSansCN-Regular', 'text', '标题'),
    layer(31, { left: 100, top: 120, right: 340, bottom: 420, width: 240, height: 300 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '产品图')
  ]);
  const fillAfter = snapshot([
    layer(30, { left: 10, top: 20, right: 210, bottom: 70, width: 200, height: 50 }, '新品详情', 'SourceHanSansCN-Regular', 'text', '标题'),
    layer(32, { left: 100, top: 120, right: 340, bottom: 420, width: 240, height: 300 }, '标题', 'SourceHanSansCN-Regular', 'pixel', '产品图')
  ]);
  const fillResult = {
    success: true,
    screenId: 2,
    screenName: '详情首屏',
    copiesFilled: 1,
    imagesFilled: 1,
    placements: [{
      placeholderLayerId: 31,
      placeholderLayerName: '产品图',
      actualLayerId: 32,
      actualLayerName: '产品图',
      actualBounds: { left: 100, top: 120, right: 340, bottom: 420, width: 240, height: 300 },
      targetBounds: { left: 100, top: 120, right: 340, bottom: 420, width: 240, height: 300 },
      isClipped: false,
      fillMode: 'cover',
      subjectAlign: 'center',
      placementAudit: {
        status: 'ok',
        plannedBounds: { left: 100, top: 120, right: 340, bottom: 420, width: 240, height: 300 },
        deviation: { left: 0, top: 0, width: 0, height: 0, maxAbs: 0 },
        notes: []
      }
    }],
    placementAuditSummary: { total: 1, ok: 1, watch: 0, mismatch: 0, unverified: 0 },
    errors: []
  };
  const fillDetailPage = buildToolAcceptanceEvidence({
    toolName: 'fillDetailPage',
    params: { plan: fillPlan },
    result: fillResult,
    before: { snapshot: fillBefore },
    after: { snapshot: fillAfter }
  });
  assert(fillDetailPage.assertionStatus === 'passed', `fillDetailPage should pass with matching placements: ${JSON.stringify(fillDetailPage)}`);
  assert(fillDetailPage.verified === true, `fillDetailPage should be verified with placement evidence: ${JSON.stringify(fillDetailPage)}`);

  const fillMissingActualLayer = buildToolAcceptanceEvidence({
    toolName: 'fillDetailPage',
    params: { plan: fillPlan },
    result: fillResult,
    before: { snapshot: fillBefore },
    after: {
      snapshot: snapshot([
        layer(30, { left: 10, top: 20, right: 210, bottom: 70, width: 200, height: 50 }, '新品详情', 'SourceHanSansCN-Regular', 'text', '标题')
      ])
    }
  });
  assert(fillMissingActualLayer.assertionStatus === 'failed', `fillDetailPage should fail when actualLayerId is absent: ${JSON.stringify(fillMissingActualLayer)}`);
  assert(fillMissingActualLayer.verified === false, `fillDetailPage missing actual layer should not verify task: ${JSON.stringify(fillMissingActualLayer)}`);

  const fillWatchResult = {
    ...fillResult,
    placements: [{
      ...fillResult.placements[0],
      placementAudit: {
        status: 'watch',
        plannedBounds: { left: 100, top: 120, right: 340, bottom: 420, width: 240, height: 300 },
        deviation: { left: 5, top: 0, width: 0, height: 0, maxAbs: 5 },
        notes: ['actual bounds deviate from planned bounds by 5.0px']
      }
    }],
    placementAuditSummary: { total: 1, ok: 0, watch: 1, mismatch: 0, unverified: 0 }
  };
  const fillWatch = buildToolAcceptanceEvidence({
    toolName: 'fillDetailPage',
    params: { plan: fillPlan },
    result: fillWatchResult,
    before: { snapshot: fillBefore },
    after: { snapshot: fillAfter }
  });
  assert(fillWatch.assertionStatus === 'needs_review', `fillDetailPage watch audit should require review: ${JSON.stringify(fillWatch)}`);
  assert(fillWatch.verified === false, `fillDetailPage watch audit should not verify task: ${JSON.stringify(fillWatch)}`);

  const fillWithErrors = buildToolAcceptanceEvidence({
    toolName: 'fillDetailPage',
    params: { plan: fillPlan },
    result: { ...fillResult, success: false, errors: ['image failed [产品图]: Cannot access file'] },
    before: { snapshot: fillBefore },
    after: { snapshot: fillBefore }
  });
  assert(fillWithErrors.assertionStatus === 'failed', `fillDetailPage result errors should fail: ${JSON.stringify(fillWithErrors)}`);
  assert(fillWithErrors.verified === false, `fillDetailPage result errors should not verify task: ${JSON.stringify(fillWithErrors)}`);

  const failedSnapshot = buildToolAcceptanceEvidence({
    toolName: 'moveLayer',
    result: { success: true },
    before: { error: 'Tool not found: getAcceptanceSnapshot' },
    after: { snapshot: after }
  });
  assert(failedSnapshot.status === 'snapshot_failed', `snapshot failure should be explicit: ${JSON.stringify(failedSnapshot)}`);
  assert(failedSnapshot.verified === false, `snapshot failure should not be verified: ${JSON.stringify(failedSnapshot)}`);
  assert(failedSnapshot.summaryText.includes('未能采集完整'), `snapshot failure should explain missing evidence: ${JSON.stringify(failedSnapshot)}`);

  return {
    success: true,
    policies: {
      textPolicy,
      imagePolicy,
      bulkPolicy,
      deepPolicy
    },
    changed,
    unchanged,
    textChanged,
    failedToolResult,
    textUnchanged,
    missingTextTarget,
    missingFontTarget,
    styleNumeric,
    styleWrongSize,
    styleMissingTracking,
    multiTextChanged,
    partialMissingBatch,
    multilineTextChanged,
    inferredTextMismatch,
    closeActiveDocument,
    closeSameDocument,
    closeNonActiveDocument,
    moveAbsolute,
    moveRelative,
    moveWrongPosition,
    moveSelected,
    moveMultiSelected,
    placeImage,
    placeMissingLayer,
    placeWrongPosition,
    placeAmbiguous,
    replacePlaceholder,
    replaceWatch,
    replaceMismatch,
    replaceTargetStillExists,
    replaceLayerContent,
    replaceLayerContentVisibleOriginal,
    replaceLayerContentWrongBounds,
    createTextLayer,
    createTextMissingLayer,
    createTextWrongFontSize,
    createRectangle,
    rectangleWrongBounds,
    createEllipse,
    fillDetailPage,
    fillMissingActualLayer,
    fillWatch,
    fillWithErrors,
    failedSnapshot
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
