const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'src', 'core', 'matting-mask-geometry.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  },
  fileName: sourcePath
}).outputText;
const moduleRecord = { exports: {} };
const sandbox = {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require: () => { throw new Error('unexpected require'); },
  Uint8Array,
  Error,
  Math,
  Number
};
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const {
  resizeGrayscaleMaskBilinear,
  resolveMattingMaskApplyPlan
} = moduleRecord.exports;

function main() {
  assert.deepStrictEqual(
    { ...resolveMattingMaskApplyPlan(4480, 6720, 4480, 6720) },
    { mode: 'exact', targetWidth: 4480, targetHeight: 6720 }
  );
  assert.deepStrictEqual(
    { ...resolveMattingMaskApplyPlan(683, 1024, 4480, 6720) },
    { mode: 'reject-large-mismatch', targetWidth: 4480, targetHeight: 6720 },
    '30MP mismatch must never enter a UXP resize loop'
  );
  assert.deepStrictEqual(
    { ...resolveMattingMaskApplyPlan(128, 128, 512, 512) },
    { mode: 'compat-bilinear', targetWidth: 512, targetHeight: 512 }
  );

  const softRamp = resizeGrayscaleMaskBilinear(
    new Uint8Array([0, 255]),
    2,
    1,
    16,
    1
  );
  assert.strictEqual(softRamp.length, 16);
  assert.strictEqual(softRamp[0], 0);
  assert.strictEqual(softRamp[15], 255);
  assert(softRamp.some((value) => value > 0 && value < 255), 'compat resize must preserve soft alpha');
  for (let index = 1; index < softRamp.length; index++) {
    assert(softRamp[index] >= softRamp[index - 1], 'soft alpha ramp must remain monotonic');
  }
  assert.throws(
    () => resizeGrayscaleMaskBilinear(new Uint8Array([1]), 2, 2, 4, 4),
    /长度不匹配/
  );

  const applySource = fs.readFileSync(
    path.join(ROOT, 'src', 'tools', 'image', 'remove-background.ts'),
    'utf8'
  );
  assert(applySource.includes("applyPlan.mode === 'reject-large-mismatch'"));
  assert(applySource.includes('MASK_DIMENSION_MISMATCH'));
  assert(applySource.includes('finally {'));
  assert(applySource.includes('imageObj.dispose()'), 'multi-mask ImageData must also be released');
  assert(!applySource.includes('resizeMaskLanczos'));
  assert(!applySource.includes('cleanupResizedMaskEdges'));

  console.log(JSON.stringify({
    success: true,
    checks: [
      'exact 30MP masks use the direct Photoshop path',
      'large mismatches fail before UXP resize',
      'small legacy masks retain bounded bilinear compatibility',
      'soft alpha stays monotonic',
      'the old JS Lanczos and hardening passes are absent',
      'single and multi-mask Photoshop ImageData are disposed in finally'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined
  }, null, 2));
  process.exit(1);
}
