const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'src', 'tools', 'canvas', 'snapshot-encoding.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  },
  fileName: sourcePath
}).outputText;

const createdBuffers = [];
let normalizedDisposeCount = 0;
let encodedResult = { base64: 'encoded-jpeg' };

const photoshop = {
  imaging: {
    createImageDataFromBuffer: async (buffer, options) => {
      createdBuffers.push({ buffer: Array.from(buffer), options });
      return {
        dispose: () => {
          normalizedDisposeCount += 1;
        }
      };
    },
    encodeImageData: async () => encodedResult
  }
};

const moduleRecord = { exports: {} };
const sandbox = {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require: (name) => {
    if (name === 'photoshop') return photoshop;
    throw new Error(`unexpected module: ${name}`);
  },
  Uint8Array,
  Uint16Array,
  Float32Array,
  ArrayBuffer,
  JSON,
  Error,
  Math,
  Number,
  String,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64')
};
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const { encodePhotoshopImageDataAsJpeg } = moduleRecord.exports;

async function run() {
  const sixteenBitImageData = {
    width: 2,
    height: 1,
    components: 4,
    componentSize: 16,
    getData: async () => new Uint16Array([
      32768, 0, 0, 0,
      0, 32768, 0, 32768
    ])
  };
  const sixteenBitResult = await encodePhotoshopImageDataAsJpeg(sixteenBitImageData, 2, 1);
  assert.strictEqual(sixteenBitResult.base64, 'encoded-jpeg');
  assert.strictEqual(sixteenBitResult.format, 'jpeg');
  assert.deepStrictEqual(createdBuffers[0].buffer, [255, 255, 255, 0, 255, 0]);
  assert.strictEqual(createdBuffers[0].options.components, 3);
  assert.strictEqual(normalizedDisposeCount, 1);

  encodedResult = new Uint8Array([65]);
  const floatImageData = {
    width: 1,
    height: 1,
    components: 3,
    componentSize: 32,
    getData: async () => new Float32Array([1.2, -0.2, 0.5])
  };
  const floatResult = await encodePhotoshopImageDataAsJpeg(floatImageData, 1, 1);
  assert.strictEqual(floatResult.base64, 'QQ==');
  assert.deepStrictEqual(createdBuffers[1].buffer, [255, 0, 128]);
  assert.strictEqual(normalizedDisposeCount, 2);

  encodedResult = 'gray-alpha-jpeg';
  const grayAlphaImageData = {
    width: 1,
    height: 1,
    components: 2,
    componentSize: 8,
    getData: async () => new Uint8Array([64, 128])
  };
  const grayAlphaResult = await encodePhotoshopImageDataAsJpeg(grayAlphaImageData, 1, 1);
  assert.strictEqual(grayAlphaResult.base64, 'gray-alpha-jpeg');
  assert.deepStrictEqual(createdBuffers[2].buffer, [159, 159, 159]);
  assert.strictEqual(normalizedDisposeCount, 3);

  encodedResult = { base64: '' };
  await assert.rejects(
    () => encodePhotoshopImageDataAsJpeg(floatImageData, 1, 1),
    /编码结果为空/
  );
  assert.strictEqual(normalizedDisposeCount, 4);

  await assert.rejects(
    () => encodePhotoshopImageDataAsJpeg({
      width: 2,
      height: 1,
      components: 4,
      componentSize: 8,
      getData: async () => new Uint8Array([255, 0, 0])
    }, 2, 1),
    /像素数据不完整/
  );

  const canvasSource = fs.readFileSync(
    path.join(ROOT, 'src', 'tools', 'canvas', 'visual-analysis.ts'),
    'utf8'
  );
  const annotatedSource = fs.readFileSync(
    path.join(ROOT, 'src', 'tools', 'canvas', 'get-annotated-snapshot.ts'),
    'utf8'
  );
  const documentSource = fs.readFileSync(
    path.join(ROOT, 'src', 'tools', 'canvas', 'get-document-snapshot.ts'),
    'utf8'
  );
  const documentInfoSource = fs.readFileSync(
    path.join(ROOT, 'src', 'tools', 'canvas', 'get-document-info.ts'),
    'utf8'
  );
  const layerHierarchySource = fs.readFileSync(
    path.join(ROOT, 'src', 'tools', 'layout', 'get-layer-hierarchy.ts'),
    'utf8'
  );
  const textLayersSource = fs.readFileSync(
    path.join(ROOT, 'src', 'tools', 'layout', 'get-all-text-layers.ts'),
    'utf8'
  );
  const stableObservationSource = fs.readFileSync(
    path.join(ROOT, 'src', 'core', 'photoshop-document-observation.ts'),
    'utf8'
  );
  assert(!canvasSource.includes('getFallbackSnapshot'), 'getCanvasSnapshot must not keep the empty fallback path');
  assert(!canvasSource.includes("return '';"), 'getCanvasSnapshot must not return an empty snapshot as success');
  assert(canvasSource.includes('timeOut: 5'), 'getCanvasSnapshot should wait for short modal contention');
  assert(canvasSource.includes('id: Number(doc.id)'), 'getCanvasSnapshot must bind visual readback to the active document id');
  assert(documentSource.includes('id: Number(doc.id)'), 'getDocumentSnapshot must bind visual readback to the active document id');
  assert(annotatedSource.includes('encodePhotoshopImageDataAsJpeg'), 'annotated snapshots must use the same safe encoder');
  assert(annotatedSource.includes('timeOut: 5'), 'annotated snapshots should wait for short modal contention');
  for (const snapshotSource of [canvasSource, annotatedSource, documentSource]) {
    assert(snapshotSource.includes("colorSpace: 'RGB'"), 'snapshots must request RGB pixels before encoding');
    assert(snapshotSource.includes('componentSize: 8'), 'snapshots must request 8-bit pixels before encoding');
    assert(snapshotSource.includes('applyAlpha: true'), 'snapshots must composite alpha on white before encoding');
  }
  for (const snapshotSource of [canvasSource, documentSource]) {
    assert(snapshotSource.includes('observeActiveDocumentAtHistoryState({'),
      'final visual snapshots must use the centralized stable Host observation interval');
    assert(snapshotSource.includes('historyStateRef: observation.historyStateRef'),
      'final visual snapshots must return the exact captured Host revision');
    assert(snapshotSource.indexOf('observeActiveDocumentAtHistoryState({') < snapshotSource.indexOf('imaging.getPixels({'),
      'document dimensions, pixels and metadata must be captured inside one stable observation callback');
  }
  for (const structuralSource of [documentInfoSource, layerHierarchySource, textLayersSource]) {
    assert(structuralSource.includes('observeActiveDocumentAtHistoryState({'),
      'quality structure reads must use the centralized stable Host observation interval');
    assert(structuralSource.includes('historyStateRef: observation.historyStateRef'),
      'quality structure reads must expose their exact Host revision');
  }
  assert(stableObservationSource.includes('core.executeAsModal(async () =>'),
    'stable Host observation must prevent Tool reads and writes from interleaving');
  assert(stableObservationSource.includes('const historyBefore = readActiveHistoryStateRef(document)'),
    'stable Host observation must capture revision before the reader');
  assert(stableObservationSource.includes('const value = await reader(document, historyBefore)'),
    'all document-derived payload fields must be read inside the protected interval');
  assert(stableObservationSource.includes('const historyAfter = readActiveHistoryStateRef(activeDocument)'),
    'stable Host observation must capture revision after the reader');
  assert(stableObservationSource.includes('!sameHistoryStateRef(historyBefore, historyAfter)'),
    'stable Host observation must reject ABA-visible revision differences');

  const historyRefPath = path.join(ROOT, 'src', 'core', 'photoshop-history-state-ref.ts');
  const historyRefSource = fs.readFileSync(historyRefPath, 'utf8');
  const historyRefCompiled = ts.transpileModule(historyRefSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: historyRefPath
  }).outputText;
  const historyRefModule = { exports: {} };
  vm.runInNewContext(historyRefCompiled, {
    module: historyRefModule,
    exports: historyRefModule.exports,
    Number,
    Boolean
  }, { filename: historyRefPath });
  const { readActiveHistoryStateRef, sameHistoryStateRef } = historyRefModule.exports;
  const h1 = readActiveHistoryStateRef({ id: 101, activeHistoryState: { id: 1001 } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h1)), { documentId: 101, historyStateId: 1001 });
  assert.strictEqual(sameHistoryStateRef(h1, { documentId: 101, historyStateId: 1001 }), true);
  assert.strictEqual(sameHistoryStateRef(h1, { documentId: 101, historyStateId: 1002 }), false);
  assert.strictEqual(sameHistoryStateRef(h1, { documentId: 202, historyStateId: 1001 }), false);
  assert.strictEqual(readActiveHistoryStateRef({ id: 101, activeHistoryState: {} }), undefined,
    'missing Host history ids must remain unavailable rather than being guessed');

  console.log('canvas snapshot encoding smoke passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
