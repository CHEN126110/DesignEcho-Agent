#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  compareSnapshotToReference,
  decodeSnapshotBase64
} = require('./lib/reference-screenshot-pixel-probe.cjs');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createPngBuffer(color) {
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: color
    }
  }).png().toBuffer();
}

async function main() {
  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const referencePath = path.join(tmpDir, 'pixel-probe-reference.png');
  const snapshotOut = path.join(tmpDir, 'pixel-probe-snapshot.png');
  const reference = await createPngBuffer({ r: 255, g: 255, b: 255 });
  fs.writeFileSync(referencePath, reference);

  const identical = await compareSnapshotToReference({
    snapshotBase64: `data:image/png;base64,${reference.toString('base64')}`,
    referencePath,
    targetSize: { width: 32, height: 32 },
    snapshotOut
  });
  assert(identical.status === 'ok', `Expected identical probe to pass, got ${identical.status}.`);
  assert(identical.rawImagesRedacted === true, 'Pixel probe must mark raw images redacted.');
  assert(typeof identical.softDarkJaccard === 'number', 'Pixel probe must report antialias-tolerant soft dark Jaccard.');
  assert(fs.existsSync(snapshotOut), 'Expected probe to write diagnostic snapshot.');

  const black = await createPngBuffer({ r: 0, g: 0, b: 0 });
  const different = await compareSnapshotToReference({
    snapshotBase64: black.toString('base64'),
    referencePath,
    targetSize: { width: 32, height: 32 }
  });
  assert(different.status === 'watch', `Expected different probe to be watch, got ${different.status}.`);
  assert(typeof different.mae === 'number' && different.mae > 200, 'Expected high MAE for black-vs-white probe.');

  const decoded = decodeSnapshotBase64(`data:image/png;base64,${reference.toString('base64')}`);
  assert(Buffer.isBuffer(decoded) && decoded.length === reference.length, 'Expected data URL decoding to preserve bytes.');

  console.log(JSON.stringify({
    success: true,
    identical: {
      status: identical.status,
      mae: identical.mae,
      highDeltaRatio: identical.highDeltaRatio,
      darkJaccard: identical.darkJaccard,
      softDarkJaccard: identical.softDarkJaccard,
      rawImagesRedacted: identical.rawImagesRedacted
    },
    different: {
      status: different.status,
      mae: different.mae,
      highDeltaRatio: different.highDeltaRatio,
      darkJaccard: different.darkJaccard,
      softDarkJaccard: different.softDarkJaccard,
      rawImagesRedacted: different.rawImagesRedacted
    },
    snapshotOut
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
