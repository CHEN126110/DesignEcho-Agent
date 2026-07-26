const fs = require('fs');
const sharp = require('sharp');

function decodeSnapshotBase64(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const base64 = raw.includes(',') ? raw.split(',').pop() : raw;
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

function toPositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.round(numeric));
}

function roundMetric(value, digits) {
  if (!Number.isFinite(value)) return undefined;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

async function readLumaRaw(input, width, height, options = {}) {
  let image = sharp(input)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .grayscale();
  const blurSigma = Number(options.blurSigma || 0);
  if (Number.isFinite(blurSigma) && blurSigma > 0) {
    image = image.blur(blurSigma);
  }
  return image.raw().toBuffer();
}

function compareLumaRaw(referenceRaw, snapshotRaw, options = {}) {
  const threshold = Number(options.darkThreshold ?? 180);
  let absoluteError = 0;
  let squaredError = 0;
  let highDeltaPixels = 0;
  let referenceDark = 0;
  let snapshotDark = 0;
  let darkIntersection = 0;
  let darkUnion = 0;

  const pixelCount = Math.min(referenceRaw.length, snapshotRaw.length);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const refLuma = referenceRaw[pixel];
    const snapLuma = snapshotRaw[pixel];
    const delta = Math.abs(refLuma - snapLuma);
    absoluteError += delta;
    squaredError += delta * delta;
    if (delta > 32) highDeltaPixels += 1;
    const refIsDark = refLuma < threshold;
    const snapIsDark = snapLuma < threshold;
    if (refIsDark) referenceDark += 1;
    if (snapIsDark) snapshotDark += 1;
    if (refIsDark && snapIsDark) darkIntersection += 1;
    if (refIsDark || snapIsDark) darkUnion += 1;
  }

  return {
    pixelCount,
    mae: pixelCount > 0 ? absoluteError / pixelCount : Number.POSITIVE_INFINITY,
    rmse: pixelCount > 0 ? Math.sqrt(squaredError / pixelCount) : Number.POSITIVE_INFINITY,
    highDeltaRatio: pixelCount > 0 ? highDeltaPixels / pixelCount : 1,
    referenceDark,
    snapshotDark,
    darkJaccard: darkUnion > 0 ? darkIntersection / darkUnion : 1
  };
}

async function compareSnapshotToReference(options) {
  const snapshotBuffer = decodeSnapshotBase64(options?.snapshotBase64);
  if (!snapshotBuffer || snapshotBuffer.length === 0) {
    return {
      status: 'unverified',
      mode: 'pixel-probe',
      reason: 'getCanvasSnapshot returned no decodable image data',
      rawImagesRedacted: true
    };
  }

  const referencePath = String(options?.referencePath || '');
  if (!referencePath || !fs.existsSync(referencePath)) {
    return {
      status: 'unverified',
      mode: 'pixel-probe',
      reason: `missing reference asset: ${referencePath || '<empty>'}`,
      rawImagesRedacted: true
    };
  }

  const width = toPositiveInt(options?.targetSize?.width, 460);
  const height = toPositiveInt(options?.targetSize?.height, 460);
  const thresholds = {
    maxMae: Number(options?.thresholds?.maxMae ?? 18),
    maxHighDeltaRatio: Number(options?.thresholds?.maxHighDeltaRatio ?? 0.18),
    minDarkJaccard: Number(options?.thresholds?.minDarkJaccard ?? 0.62),
    minSoftDarkJaccard: Number(options?.thresholds?.minSoftDarkJaccard ?? options?.thresholds?.minDarkJaccard ?? 0.62)
  };
  const softMask = {
    blurSigma: Number(options?.thresholds?.softMaskBlurSigma ?? 1.5),
    darkThreshold: Number(options?.thresholds?.softMaskDarkThreshold ?? 180)
  };

  const snapshotPng = await sharp(snapshotBuffer)
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();

  if (options?.snapshotOut) {
    fs.writeFileSync(options.snapshotOut, snapshotPng);
  }

  const referenceRaw = await readLumaRaw(referencePath, width, height);
  const snapshotRaw = await readLumaRaw(snapshotPng, width, height);
  const hardMetrics = compareLumaRaw(referenceRaw, snapshotRaw);

  const softReferenceRaw = await readLumaRaw(referencePath, width, height, { blurSigma: softMask.blurSigma });
  const softSnapshotRaw = await readLumaRaw(snapshotPng, width, height, { blurSigma: softMask.blurSigma });
  const softMetrics = compareLumaRaw(softReferenceRaw, softSnapshotRaw, { darkThreshold: softMask.darkThreshold });

  const darkShapeMatches = hardMetrics.darkJaccard >= thresholds.minDarkJaccard
    || softMetrics.darkJaccard >= thresholds.minSoftDarkJaccard;
  const status = hardMetrics.mae <= thresholds.maxMae
    && hardMetrics.highDeltaRatio <= thresholds.maxHighDeltaRatio
    && darkShapeMatches
    ? 'ok'
    : 'watch';

  return {
    status,
    mode: 'pixel-probe',
    width,
    height,
    mae: roundMetric(hardMetrics.mae, 3),
    rmse: roundMetric(hardMetrics.rmse, 3),
    highDeltaRatio: roundMetric(hardMetrics.highDeltaRatio, 4),
    darkJaccard: roundMetric(hardMetrics.darkJaccard, 4),
    softDarkJaccard: roundMetric(softMetrics.darkJaccard, 4),
    softMaskBlurSigma: roundMetric(softMask.blurSigma, 2),
    softMaskDarkThreshold: roundMetric(softMask.darkThreshold, 0),
    referenceDarkPixels: hardMetrics.referenceDark,
    snapshotDarkPixels: hardMetrics.snapshotDark,
    snapshotPath: options?.snapshotOut,
    boundary: 'Pixel probe only. It checks coarse screenshot similarity and antialias-tolerant dark-shape overlap; it is not a high-fidelity design acceptance score.',
    rawImagesRedacted: true
  };
}

module.exports = {
  compareSnapshotToReference,
  decodeSnapshotBase64
};
