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
  analyzeInpaintingMask,
  assertInpaintingMaskHasEditablePixels,
  clampSoftenedMaskToSelection
} = require('../src/main/services/inpainting-mask-protection.ts');
const { InpaintingService } = require('../src/main/services/inpainting-service.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const width = 15;
  const height = 15;
  const sourceMask = Buffer.alloc(width * height, 0);
  for (let y = 5; y < 10; y++) {
    for (let x = 5; x < 10; x++) {
      sourceMask[(y * width) + x] = 255;
    }
  }
  sourceMask[(7 * width) + 5] = 96;

  const stats = analyzeInpaintingMask(sourceMask);
  assert(stats.pixelCount === width * height, 'mask statistics should retain the full pixel count');
  assert(stats.editablePixelCount === 25, `expected 25 editable pixels, got ${stats.editablePixelCount}`);
  assert(stats.opaquePixelCount === 24, `expected 24 opaque pixels, got ${stats.opaquePixelCount}`);

  const simulatedBlur = Buffer.alloc(width * height, 180);
  const clamped = clampSoftenedMaskToSelection(sourceMask, simulatedBlur);
  for (let index = 0; index < sourceMask.length; index++) {
    assert(clamped[index] <= sourceMask[index], `protected mask expanded at pixel ${index}`);
    if (sourceMask[index] === 0) {
      assert(clamped[index] === 0, `outside-selection pixel ${index} must remain transparent`);
    }
  }
  assert(clamped[(7 * width) + 5] === 96, 'existing antialiased selection coverage must not be increased');

  let emptyMaskRejected = false;
  try {
    assertInpaintingMaskHasEditablePixels(Buffer.alloc(16, 0));
  } catch (error) {
    emptyMaskRejected = String(error && error.message).includes('蒙版为空');
  }
  assert(emptyMaskRejected, 'empty masks should be rejected before provider execution');

  const service = new InpaintingService();
  const protectedMask = await service.buildCompositeMask(sourceMask, width, height, 'modify');
  for (let index = 0; index < sourceMask.length; index++) {
    assert(protectedMask[index] <= sourceMask[index], `runtime feather expanded at pixel ${index}`);
  }

  const generatedRgba = Buffer.alloc(width * height * 4, 220);
  const transparentOverlay = await service.composeTransparentOutput(
    generatedRgba,
    sourceMask,
    width,
    height,
    'modify',
    { softenMask: true }
  );
  for (let index = 0; index < sourceMask.length; index++) {
    const alpha = transparentOverlay[(index * 4) + 3];
    assert(alpha <= sourceMask[index], `output alpha escaped the selection at pixel ${index}`);
  }

  let mismatchedCompositeRejected = false;
  try {
    await service.composeTransparentOutput(Buffer.alloc(8), Buffer.alloc(1), 2, 2, 'modify');
  } catch (error) {
    mismatchedCompositeRejected = String(error && error.message).includes('合成尺寸不一致');
  }
  assert(mismatchedCompositeRejected, 'mismatched RGBA and mask dimensions should fail closed');

  const smallMask = Buffer.from([
    0, 255,
    0, 0
  ]);
  const resizedMask = await service.resizeRawChannel(smallMask, 2, 2, 4, 4, 1);
  assert(resizedMask.length === 16, `single-channel resize returned ${resizedMask.length} bytes instead of 16`);
  assert([...new Set(resizedMask)].every((value) => value === 0 || value === 255), 'mask resize must not create interpolation spill');

  const croppedMask = await service.cropRawChannel(sourceMask, width, height, 5, 5, 5, 5, 1);
  assert(croppedMask.length === 25, `single-channel crop returned ${croppedMask.length} bytes instead of 25`);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'empty selections are rejected before model execution',
      'softened alpha never exceeds the captured Photoshop selection',
      'outside-selection output pixels remain fully transparent',
      'mismatched composite buffers fail closed',
      'selection resizing uses nearest-neighbor coverage',
      'mask blur, crop, and resize remain single-channel'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exit(1);
});
