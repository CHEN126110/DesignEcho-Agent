#!/usr/bin/env node

const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const CASE = require('../benchmarks/reference-replication/cases/rr-002-neutral-quality-card-text-layout.json');
const IMAGE_PATH = path.join(ROOT, 'benchmarks/reference-replication', CASE.referenceImage.path);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isDarkPixel(data, info, x, y) {
  const index = (y * info.width + x) * info.channels;
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = info.channels >= 4 ? data[index + 3] : 255;
  return a > 128 && r < 80 && g < 80 && b < 80;
}

function findDarkBounds(data, info, box, padding = 8) {
  const left0 = Math.max(0, Math.floor(box.x - padding));
  const top0 = Math.max(0, Math.floor(box.y - padding));
  const right0 = Math.min(info.width - 1, Math.ceil(box.x + box.width + padding));
  const bottom0 = Math.min(info.height - 1, Math.ceil(box.y + box.height + padding));
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let count = 0;

  for (let y = top0; y <= bottom0; y += 1) {
    for (let x = left0; x <= right0; x += 1) {
      if (!isDarkPixel(data, info, x, y)) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      count += 1;
    }
  }

  if (count === 0) return null;
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
    count
  };
}

function withinEnvelope(target, actual) {
  const leftTolerance = Math.max(4, target.width * 0.025);
  const topTolerance = Math.max(4, target.height * 0.18);
  const rightTolerance = Math.max(6, target.width * 0.04);
  const bottomTolerance = Math.max(6, target.height * 0.3);
  return actual.x >= target.x - leftTolerance
    && actual.y >= target.y - topTolerance
    && actual.x + actual.width <= target.x + target.width + rightTolerance
    && actual.y + actual.height <= target.y + target.height + bottomTolerance;
}

async function run() {
  assert(CASE?.id === 'rr-002-neutral-quality-card-text-layout', 'Unexpected benchmark case id.');
  assert(CASE?.scenario?.source?.providedBy === 'synthetic-fixture', 'Neutral text bounds smoke is only for the synthetic fixture.');
  assert(Array.isArray(CASE.expectedElements), 'Case must expose expectedElements.');

  const { data, info } = await sharp(IMAGE_PATH)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert(info.width === CASE.scenario.canvas.width, `Image width mismatch: ${info.width}`);
  assert(info.height === CASE.scenario.canvas.height, `Image height mismatch: ${info.height}`);

  const reports = CASE.expectedElements.map((element) => {
    assert(element.kind === 'text', `Neutral case should only contain text elements, got ${element.kind}`);
    const darkBounds = findDarkBounds(data, info, element.expectedBox);
    assert(darkBounds, `No dark pixels found for ${element.id}`);
    assert(withinEnvelope(element.expectedBox, darkBounds), `Dark pixel bounds for ${element.id} should fit inside expected text envelope.`);
    return {
      id: element.id,
      target: element.expectedBox,
      darkBounds,
      widthRatio: Number((darkBounds.width / element.expectedBox.width).toFixed(3)),
      heightRatio: Number((darkBounds.height / element.expectedBox.height).toFixed(3))
    };
  });

  const envelopeLikeCount = reports.filter((item) => item.widthRatio <= 0.94 || item.heightRatio <= 0.9).length;
  assert(envelopeLikeCount >= 3, 'Expected at least three text boxes to behave as envelopes rather than exact glyph bounds.');

  return {
    success: true,
    caseId: CASE.id,
    image: CASE.referenceImage.path,
    checkedElements: reports.length,
    envelopeLikeCount,
    boundary: [
      'This smoke validates the neutral fixture text-envelope assumption.',
      'It does not validate Photoshop output, font fidelity, pixel similarity, or aesthetic quality.',
      'A passing result means expectedBox may be a layout envelope, not an exact glyph bound.'
    ],
    samples: reports.slice(0, 3)
  };
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
