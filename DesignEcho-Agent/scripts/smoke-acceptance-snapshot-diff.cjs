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
  diffAcceptanceSnapshots
} = require('../src/shared/acceptance/photoshop-acceptance.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeLayer(overrides) {
  return {
    id: 1,
    name: '标题',
    kind: 'text',
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    depth: 0,
    index: 0,
    parentId: null,
    parentName: null,
    path: '标题',
    selected: false,
    bounds: { left: 10, top: 20, right: 210, bottom: 80, width: 200, height: 60 },
    text: { content: '旧标题', length: 3, style: { fontName: 'SourceHanSansCN-Regular', fontSize: 32 } },
    ...overrides
  };
}

function makeSnapshot(layers, historyStateId) {
  return {
    success: true,
    hasDocument: true,
    document: { id: 100, name: '验收测试.psd', width: 800, height: 1200, mode: 'RGB' },
    historyStateRef: { documentId: 100, historyStateId },
    layers,
    selectedLayerIds: [],
    summary: {
      totalLayers: layers.length,
      selectedLayers: 0,
      hiddenLayers: 0,
      lockedLayers: 0,
      textLayers: layers.filter((layer) => layer.kind === 'text').length,
      groupLayers: 0,
      smartObjectLayers: 0,
      shapeLayers: 0,
      pixelLayers: layers.filter((layer) => layer.kind === 'pixel').length,
      truncated: false
    }
  };
}

function run() {
  const before = makeSnapshot([
    makeLayer({ id: 1 }),
    makeLayer({ id: 2, name: '产品图', kind: 'pixel', path: '产品图', text: undefined })
  ], 701);

  const after = makeSnapshot([
    makeLayer({
      id: 1,
      text: { content: '新标题', length: 3, style: { fontName: 'SourceHanSansCN-Bold', fontSize: 36 } },
      bounds: { left: 20, top: 24, right: 240, bottom: 92, width: 220, height: 68 }
    }),
    makeLayer({ id: 3, name: '按钮', kind: 'shape', path: '按钮', text: undefined })
  ], 702);

  const diff = diffAcceptanceSnapshots(before, after);
  assert(diff.comparable === true, `diff should be comparable: ${JSON.stringify(diff)}`);
  assert(diff.addedLayerIds.includes(3), `added layer should be detected: ${JSON.stringify(diff)}`);
  assert(diff.removedLayerIds.includes(2), `removed layer should be detected: ${JSON.stringify(diff)}`);
  assert(diff.summary.textChanged === 1, `text change should be detected: ${JSON.stringify(diff)}`);
  assert(diff.summary.geometryChanged === 1, `geometry change should be detected: ${JSON.stringify(diff)}`);
  assert(diff.summary.styleChanged === 1, `style change should be detected: ${JSON.stringify(diff)}`);

  const noDocument = diffAcceptanceSnapshots({ success: true, hasDocument: false }, after);
  assert(noDocument.comparable === false, `missing document should block comparability: ${JSON.stringify(noDocument)}`);
  assert(noDocument.issues.some((issue) => issue.includes('no active document')), `missing document issue expected: ${JSON.stringify(noDocument)}`);

  const missingRef = diffAcceptanceSnapshots(
    { ...before, historyStateRef: undefined },
    after
  );
  assert(missingRef.comparable === false, `missing Host ref should fail closed: ${JSON.stringify(missingRef)}`);

  const crossDocument = diffAcceptanceSnapshots(
    before,
    {
      ...after,
      document: { ...after.document, id: 200 },
      historyStateRef: { documentId: 200, historyStateId: 702 }
    }
  );
  assert(crossDocument.comparable === false, `cross-document snapshots should not be compared: ${JSON.stringify(crossDocument)}`);

  const contradictory = diffAcceptanceSnapshots(
    before,
    { ...after, historyStateRef: before.historyStateRef }
  );
  assert(contradictory.comparable === false, `same Host ref with structural changes should fail closed: ${JSON.stringify(contradictory)}`);

  return { success: true, diff, noDocument, missingRef, crossDocument, contradictory };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
