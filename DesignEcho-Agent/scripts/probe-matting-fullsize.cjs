const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const sharp = require('sharp');
const { MattingService } = require('../src/main/services/matting-service.ts');
const {
  BinaryMessageType,
  createBinaryImageData
} = require('../src/shared/binary-protocol.ts');

function requiredPath(value, label) {
  const resolved = value ? path.resolve(value) : '';
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`${label}不存在：${resolved || '(empty)'}`);
  }
  return resolved;
}

async function main() {
  const sourcePath = requiredPath(process.argv[2], '测试图片');
  const modelsDir = requiredPath(process.argv[3], '模型目录');
  const sourceMetadata = await sharp(sourcePath).metadata();
  const targetWidth = Math.max(1, Math.round(Number(process.argv[4]) || sourceMetadata.width || 0));
  const targetHeight = Math.max(1, Math.round(Number(process.argv[5]) || sourceMetadata.height || 0));
  const exportMaxEdge = Math.max(64, Math.round(Number(process.argv[6]) || 1024));
  const exported = await sharp(sourcePath)
    .resize(exportMaxEdge, exportMaxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  const imageInput = createBinaryImageData(
    BinaryMessageType.JPEG,
    exported.data,
    exported.info.width,
    exported.info.height
  );
  const service = new MattingService({ modelsDir, gpuMode: 'auto' });
  const startedAt = Date.now();

  try {
    const result = await service.removeBackground(imageInput, {
      quality: 'balanced',
      returnMask: true,
      binaryMaskOutput: true,
      originalWidth: targetWidth,
      originalHeight: targetHeight,
      edgeRefine: 'hair'
    });
    const wallMs = Date.now() - startedAt;
    assert.strictEqual(result.success, true, result.error || 'matting failed');
    assert(result.maskBuffer, 'binary mask output is missing');
    assert.strictEqual(result.maskWidth, targetWidth);
    assert.strictEqual(result.maskHeight, targetHeight);
    assert.strictEqual(result.maskBuffer.length, targetWidth * targetHeight);

    let min = 255;
    let max = 0;
    let soft = 0;
    const stride = Math.max(1, Math.floor(result.maskBuffer.length / 100000));
    for (let index = 0; index < result.maskBuffer.length; index += stride) {
      const value = result.maskBuffer[index];
      min = Math.min(min, value);
      max = Math.max(max, value);
      if (value > 0 && value < 255) soft += 1;
    }

    console.log(JSON.stringify({
      success: true,
      source: {
        width: sourceMetadata.width,
        height: sourceMetadata.height,
        exportWidth: exported.info.width,
        exportHeight: exported.info.height
      },
      output: {
        width: result.maskWidth,
        height: result.maskHeight,
        bytes: result.maskBuffer.length,
        sampledMin: min,
        sampledMax: max,
        sampledSoftAlpha: soft
      },
      processingTimeMs: result.processingTime,
      wallMs,
      usedModel: result.usedModel
    }, null, 2));
  } finally {
    await service.shutdown();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined
  }, null, 2));
  process.exit(1);
});
