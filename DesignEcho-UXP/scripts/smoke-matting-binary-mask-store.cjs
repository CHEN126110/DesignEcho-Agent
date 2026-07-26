const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'src', 'core', 'binary-mask-store.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  },
  fileName: sourcePath
}).outputText;

const BinaryMessageType = { PNG: 2, RAW_MASK: 3 };
const moduleRecord = { exports: {} };
const sandbox = {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require: (name) => {
    if (name === './binary-protocol') return { BinaryMessageType };
    throw new Error(`unexpected module: ${name}`);
  },
  Uint8Array,
  Map,
  Promise,
  Error,
  Math,
  Number,
  Date,
  setTimeout,
  clearTimeout
};
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const { BinaryMaskStore } = moduleRecord.exports;

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const store = new BinaryMaskStore(20);
  const sourceBytes = new Uint8Array([1, 2, 3, 4]);
  store.receive(100, 2, 2, sourceBytes, BinaryMessageType.RAW_MASK);
  sourceBytes[0] = 99;
  assert.deepStrictEqual({ ...store.getStats() }, { cachedCount: 1, pendingCount: 0, cachedBytes: 4 });
  const cached = await store.waitFor(100, 20);
  assert.deepStrictEqual(Array.from(cached.data), [1, 2, 3, 4], 'the Store must own one stable copy');
  assert.deepStrictEqual({ ...store.getStats() }, { cachedCount: 0, pendingCount: 0, cachedBytes: 0 });

  await assert.rejects(() => store.waitFor(100, 5), /超时/, 'a mask must be consumed at most once');

  const pendingPromise = store.waitFor(101, 50);
  assert.strictEqual(store.getStats().pendingCount, 1);
  store.receive(101, 2, 2, new Uint8Array([5, 6, 7, 8]), BinaryMessageType.RAW_MASK);
  const pending = await pendingPromise;
  assert.deepStrictEqual(Array.from(pending.data), [5, 6, 7, 8]);
  assert.deepStrictEqual({ ...store.getStats() }, { cachedCount: 0, pendingCount: 0, cachedBytes: 0 });

  store.receive(102, 2, 2, new Uint8Array([9, 10, 11, 12]), BinaryMessageType.RAW_MASK);
  await delay(35);
  assert.deepStrictEqual({ ...store.getStats() }, { cachedCount: 0, pendingCount: 0, cachedBytes: 0 }, 'TTL must release unconsumed masks');

  const cancelled = store.waitFor(103, 100);
  store.clear('connection closed');
  await assert.rejects(() => cancelled, /connection closed/);

  const indexSource = fs.readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8');
  const toolSource = fs.readFileSync(path.join(ROOT, 'src', 'tools', 'image', 'remove-background.ts'), 'utf8');
  assert(indexSource.includes('getMattingBinaryMaskStore().receive('));
  assert(!indexSource.includes('MultiMattingToolClass.receiveBinaryMask'));
  assert(!toolSource.includes('private static receivedBinaryMasks'));

  console.log(JSON.stringify({
    success: true,
    checks: [
      'one stable copy is cached',
      'take-once consumption releases the entry',
      'JSON-first delivery resolves without a second cache',
      'TTL releases unconsumed entries',
      'disconnect cleanup rejects pending waits',
      'the WebSocket callback writes to one shared Store'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined
  }, null, 2));
  process.exit(1);
});
