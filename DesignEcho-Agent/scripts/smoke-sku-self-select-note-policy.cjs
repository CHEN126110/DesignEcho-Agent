#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  decideSkuSelfSelectNoteGeneration
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'sku-self-select-note-policy.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const singleDefault = decideSkuSelfSelectNoteGeneration({
    comboSize: 1,
    notesRequested: true,
    onlyNotes: false
  });
  assert(singleDefault.shouldGenerate === false, '1 pair should skip self-select note in default SKU generation');
  assert(singleDefault.reason === 'single-pair-covered-by-sku', '1 pair skip reason must be explicit');

  const singleOnlyNotes = decideSkuSelfSelectNoteGeneration({
    comboSize: 1,
    notesRequested: false,
    onlyNotes: true
  });
  assert(singleOnlyNotes.shouldGenerate === false, '1 pair should skip self-select note even in only-notes mode');

  const doubleDefault = decideSkuSelfSelectNoteGeneration({
    comboSize: 2,
    notesRequested: true,
    onlyNotes: false
  });
  assert(doubleDefault.shouldGenerate === true, '2 pair should still generate self-select note when requested');

  const doubleOnlyNotes = decideSkuSelfSelectNoteGeneration({
    comboSize: 2,
    notesRequested: false,
    onlyNotes: true
  });
  assert(doubleOnlyNotes.shouldGenerate === true, '2 pair should generate self-select note in only-notes mode');
  assert(doubleOnlyNotes.reason === 'requested', '2 pair only-notes generation should be treated as requested');

  const doubleDisabled = decideSkuSelfSelectNoteGeneration({
    comboSize: 2,
    notesRequested: false,
    onlyNotes: false
  });
  assert(doubleDisabled.shouldGenerate === false, '2 pair should not generate self-select note when notes are disabled');
  assert(doubleDisabled.reason === 'not-requested', 'disabled notes should report not-requested reason');
  assert(!/按用户要求/.test(doubleDisabled.message), 'disabled notes message must not claim user-requested generation');

  console.log(JSON.stringify({
    success: true,
    cases: {
      singleDefault,
      singleOnlyNotes,
      doubleDefault,
      doubleOnlyNotes,
      doubleDisabled
    },
    boundary: [
      '1双自选备注必须跳过，因为 1双 SKU 已经覆盖全部颜色。',
      '2双及以上仍按用户开关生成自选备注。'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
