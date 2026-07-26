#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  isFullSurfaceVisualJudgeObservationEntry,
  selectLatestDesignVisualJudgeObservation
} = require('../src/shared/design-visual-judge-observation.ts');
const {
  buildPhotoshopHistoryTransition
} = require('../src/shared/photoshop-history-state-ref.ts');

function operation(name, args = {}, result = { success: true }) {
  return { name, arguments: args, result };
}

function targetResult(documentId, extra = {}) {
  return {
    success: true,
    documentInfo: { id: documentId, name: `doc-${documentId}` },
    ...extra
  };
}

function selectedIndex(entries) {
  return selectLatestDesignVisualJudgeObservation(entries)?.entryIndex ?? null;
}

const fullCanvasA = operation('getCanvasSnapshot', {}, targetResult(101, {
  snapshot: { base64: 'a'.repeat(800), format: 'jpeg' }
}));
const fullCanvasB = operation('getCanvasSnapshot', {}, targetResult(202, {
  snapshot: { base64: 'b'.repeat(800), format: 'jpeg' }
}));

assert.strictEqual(selectedIndex([fullCanvasA]), 0,
  '画布未修改时应保持兼容：最近完整画布可用于 Judge');

assert.strictEqual(selectedIndex([
  fullCanvasA,
  operation('createTextLayer', {}, targetResult(101)),
  operation('getLayerHierarchy', {}, targetResult(101, { hierarchy: [] }))
]), null, '修改前旧图不能因修改后的结构读而冒充新画面');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  operation('getCanvasSnapshot', { region: { x: 0, y: 0, width: 300, height: 300 } }, targetResult(101, {
    region: { x: 0, y: 0, width: 300, height: 300 },
    snapshot: { base64: 'r'.repeat(800), format: 'jpeg' }
  }))
]), null, '区域截图不能冒充最终完整画布评价');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA
]), 1, '最后修改后的同文档完整画布应被选中');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasB
]), null, '其他文档的完整画布不能评价本次修改');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('moveLayer', {}, targetResult(101))
]), null, '选中观察之后再次修改会使旧观察失效');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('moveLayer', {}, { success: false, error: 'fixture failure' })
]), 1, '失败的写操作没有改变画布，不应作废已有新鲜观察');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('moveLayer', {}, {
    success: false,
    error: 'tool failed after mutating Photoshop',
    photoshopHistoryTransition: buildPhotoshopHistoryTransition(
      { historyStateRef: { documentId: 101, historyStateId: 1 } },
      { historyStateRef: { documentId: 101, historyStateId: 2 } }
    )
  })
]), null, '失败但 Host before/after 已变化的写操作必须作废旧画面观察');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('moveLayer', {}, {
    success: false,
    toolActionCompleted: true,
    error: 'acceptance failed after the action completed'
  })
]), null, '失败结果明确声明动作已执行时必须保守作废旧画面观察');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('getCanvasSnapshot', {}, { success: false, error: 'fixture failure' })
]), 1, '失败的快照应被跳过，不能遮挡更早的新鲜完整画布');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('saveDocument', {}, targetResult(101))
]), 1, 'save/export 不改变像素，不应要求重复截图');

assert.strictEqual(selectedIndex([
  operation('getDocumentInfo', {}, { success: true, document: { id: 101, name: 'doc-101' } }),
  operation('createTextLayer', {}, { success: true }),
  operation('getDocumentSnapshot', {}, {
    success: true,
    imageData: 'd'.repeat(800),
    format: 'jpeg'
  })
]), 2, '缺少显式 id 的文档截图应继承同一有序日志中的活动文档目标');

assert.strictEqual(selectedIndex([
  operation('getDocumentInfo', {}, { success: true, document: { id: 101, name: 'doc-101' } }),
  operation('createTextLayer', {}, { success: true }),
  operation('getLayerHierarchy', {}, {
    success: true,
    documentName: 'doc-101',
    hierarchy: []
  }),
  operation('getDocumentSnapshot', {}, {
    success: true,
    imageData: 'd'.repeat(800),
    format: 'jpeg'
  })
]), 3, '普通读回中的弱 documentName 不应覆盖已知文档目标身份');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, { success: true }),
  fullCanvasA
]), null, '最后修改的文档目标未知时必须 fail closed');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('switchDocument', { documentId: 202 }, { success: true, document: { id: 202, name: 'doc-202' } }),
  fullCanvasB
]), null, '最终活动文档已切换时不能回退评价先前文档的旧观察');

assert.strictEqual(selectedIndex([
  fullCanvasA,
  operation('openTemplate', { psdPath: 'B.psd' }, {
    success: true,
    data: { documentName: 'doc-202', documentId: 202, activeDocumentId: 202 }
  })
]), null, 'openTemplate 切换活动文档后不能继续选择此前文档截图');

assert.strictEqual(selectedIndex([
  fullCanvasA,
  operation('getSmartObjectLayers', { layerId: 9, autoOpen: true }, {
    success: true,
    documentId: 101,
    internalDocumentId: 303,
    internalDocumentName: 'smart-object.psb'
  })
]), null, 'autoOpen 智能对象内容文档后不能继续选择源文档截图');

assert.strictEqual(selectedIndex([
  fullCanvasA,
  operation('delegateToAgent', { role: 'executor', task: '移动图层' }, { success: true })
]), null, '可写 executor 委派必须按画布修改使委派前截图失效');

assert.strictEqual(selectedIndex([
  fullCanvasA,
  operation('delegateToAgent', { role: 'critic', task: '只读评审' }, { success: true })
]), 0, '只读 critic 委派不应伪造 Photoshop 修改');

assert.strictEqual(selectedIndex([
  operation('createTextLayer', {}, targetResult(101)),
  fullCanvasA,
  operation('closeDocument', { documentId: 101 }, { success: true, closedDocument: 'doc-101' })
]), null, '关闭文档后活动目标未知，关闭前观察不能继续用于最终 Judge');

assert.strictEqual(selectedIndex([
  operation('getDocumentInfo', {}, { success: true, document: { id: 101, name: 'doc-101' } }),
  operation('createTextLayer', {}, { success: true }),
  operation('switchDocument', { documentName: 'unknown-target' }, { success: true }),
  operation('getDocumentSnapshot', {}, {
    success: true,
    imageData: 'd'.repeat(800),
    format: 'jpeg'
  })
]), null, '无法解析目标的文档切换必须清空继承，不能把后续无 id 截图错绑旧文档');

assert.strictEqual(selectedIndex([
  fullCanvasA,
  operation('undo', {}, targetResult(101))
]), null, 'undo 改变画布版本，撤销前截图必须失效');

assert.strictEqual(selectedIndex([
  operation('undo', {}, targetResult(101)),
  fullCanvasA
]), 1, 'undo 之后的新完整画布可以用于 Judge');

for (const name of [
  'getAcceptanceSnapshot',
  'getAnnotatedSnapshot',
  'generateImage',
  'getAssetPreview'
]) {
  assert.strictEqual(isFullSurfaceVisualJudgeObservationEntry(operation(name)), false,
    `${name} 不能作为最终完整画布视觉观察`);
}

assert.strictEqual(isFullSurfaceVisualJudgeObservationEntry(operation(
  'getCanvasSnapshot',
  {},
  targetResult(101, { region: { x: 0, y: 0, width: 100, height: 100 } })
)), false, '结果声明 region 时即使参数缺失也必须按区域图拒绝');

console.log('[smoke-design-visual-judge-observation] passed');
