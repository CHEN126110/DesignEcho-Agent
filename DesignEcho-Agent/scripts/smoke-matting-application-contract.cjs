const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const sharp = require('sharp');
const {
  assertRawMaskGeometry,
  resolveMattingEdgeRefineMode,
  resolveMattingOutputGeometry
} = require('../src/shared/matting-application-contract.ts');

async function runNativeResizeProbe() {
  const sourceWidth = 683;
  const sourceHeight = 1024;
  const targetWidth = 4480;
  const targetHeight = 6720;
  const source = Buffer.alloc(sourceWidth * sourceHeight);

  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const normalizedX = x / Math.max(1, sourceWidth - 1);
      const diagonalFiber = Math.abs(normalizedX - y / Math.max(1, sourceHeight - 1)) < 0.003;
      source[y * sourceWidth + x] = diagonalFiber
        ? 150
        : Math.max(0, Math.min(255, Math.round((normalizedX - 0.25) * 510)));
    }
  }

  const startedAt = Date.now();
  const resized = await sharp(source, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 1 }
  })
    .resize(targetWidth, targetHeight, { kernel: 'cubic' })
    .grayscale()
    .raw()
    .toBuffer();
  const durationMs = Date.now() - startedAt;

  assert.strictEqual(resized.length, targetWidth * targetHeight, 'native resize must return an exact raw mask');
  let softAlphaSamples = 0;
  const stride = Math.max(1, Math.floor(resized.length / 50000));
  for (let index = 0; index < resized.length; index += stride) {
    if (resized[index] > 0 && resized[index] < 255) softAlphaSamples += 1;
  }
  assert(softAlphaSamples > 0, 'native cubic resize must preserve intermediate alpha values');
  assert(durationMs < 5000, `native 30MP mask resize exceeded the 5s regression budget: ${durationMs}ms`);

  return { durationMs, outputBytes: resized.length, softAlphaSamples };
}

async function main() {
  const geometry = resolveMattingOutputGeometry(4480, 6720);
  assert.deepStrictEqual(geometry, {
    width: 4480,
    height: 6720,
    pixelCount: 30105600
  });
  assert.throws(
    () => resolveMattingOutputGeometry(20000, 20000),
    /安全输出上限/,
    'oversized masks must fail before UXP compatibility resize'
  );
  assert.strictEqual(resolveMattingEdgeRefineMode({ enableHairRefine: true }), 'hair');
  assert.strictEqual(resolveMattingEdgeRefineMode({ enableFabricRefine: true }), 'hair');
  assert.strictEqual(resolveMattingEdgeRefineMode({ refineEdges: false }, 'standard'), 'none');
  assert.strictEqual(resolveMattingEdgeRefineMode({}, 'product-hard'), 'product-hard');
  assert.doesNotThrow(() => assertRawMaskGeometry(30105600, 4480, 6720));
  assert.throws(() => assertRawMaskGeometry(1024, 64, 64), /数据不完整/);

  const handlerSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'main', 'uxp-handlers', 'visual-handlers.ts'),
    'utf8'
  );
  const serviceSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'main', 'services', 'matting-service.ts'),
    'utf8'
  );
  assert(!handlerSource.includes('MATTING_INLINE_TARGET_MAX_PIXELS'));
  assert(!handlerSource.includes('Skip full-size mask geometry sync'));
  assert(handlerSource.includes('binaryImageStore.delete(Number(exportResult.binaryRequestId))'));
  assert(handlerSource.includes("resolveMattingEdgeRefineMode(params, 'product-hard')"));
  assert(!handlerSource.includes("edgeRefine: 'product-hard'"));
  assert(serviceSource.includes('skipped-post-resize-cleanup'));
  assert(!serviceSource.includes('maskBuffer: shouldReturnBinaryMask ? Buffer.from(finalMaskBuffer)'));

  const nativeResize = await runNativeResizeProbe();
  console.log(JSON.stringify({
    success: true,
    geometry,
    nativeResize,
    checks: [
      '30.11MP output geometry is retained',
      'oversized output fails before UXP',
      'hair and fabric flags select the soft-alpha profile',
      'RAW mask byte length is exact',
      'legacy Agent binary cache is consumed',
      'Sharp cubic 30MP resize preserves soft alpha within budget'
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
