const fs = require('fs');
const path = require('path');
const {
  isReferenceBenchmarkCategorySlug
} = require('./lib/reference-benchmark-categories.cjs');
const {
  VALID_REFERENCE_SOURCE_KINDS,
  isValidReferenceSourceKind,
  normalizeReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');

const root = process.cwd();

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

const benchmarkDirArg = getArgValue(process.argv.slice(2), '--benchmark-dir');
const benchmarkDir = benchmarkDirArg
  ? path.resolve(root, benchmarkDirArg)
  : path.join(root, 'benchmarks', 'reference-replication');
const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');

function fail(message) {
  console.error(`[benchmark:reference-replication] ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveBenchmarkPath(relativePath, caseId, fieldName) {
  const rawPath = String(relativePath || '').trim();
  if (!rawPath) return '';
  if (path.isAbsolute(rawPath)) {
    fail(`case ${caseId} ${fieldName} must be benchmark-relative, not absolute`);
    return '';
  }

  const resolvedPath = path.resolve(benchmarkDir, rawPath);
  const relativeToBenchmark = path.relative(benchmarkDir, resolvedPath);
  if (relativeToBenchmark.startsWith('..') || path.isAbsolute(relativeToBenchmark)) {
    fail(`case ${caseId} ${fieldName} escapes benchmark directory`);
    return '';
  }
  return resolvedPath;
}

function isFiniteNonNegativeNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

if (!fs.existsSync(benchmarkDir)) {
  fail(`missing benchmark directory: ${benchmarkDir}`);
  process.exit();
}

if (!fs.existsSync(manifestPath)) {
  fail(`missing manifest: ${manifestPath}`);
  process.exit();
}

const manifest = readJson(manifestPath);
if (!manifest || typeof manifest !== 'object') {
  fail('manifest is not a valid object');
  process.exit();
}

if (String(manifest.suite || '').trim() !== 'reference-replication') {
  fail('manifest.suite must be reference-replication');
}

if (!Number.isFinite(Number(manifest.version)) || Number(manifest.version) < 1) {
  fail('manifest.version must be a positive number');
}

if (!Array.isArray(manifest.cases)) {
  fail('manifest.cases must be an array');
  process.exit();
}

function isScoreValue(value) {
  return value === null || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1);
}

function normalizeBenchmarkRelativePath(filePath) {
  return path.relative(benchmarkDir, filePath).replace(/\\/g, '/');
}

function listCaseJsonFiles() {
  const caseDirectory = String(manifest.caseDirectory || 'cases').trim() || 'cases';
  const caseDir = path.resolve(benchmarkDir, caseDirectory);
  const relativeCaseDir = path.relative(benchmarkDir, caseDir);
  if (relativeCaseDir.startsWith('..') || path.isAbsolute(relativeCaseDir)) {
    fail('manifest.caseDirectory escapes benchmark directory');
    return [];
  }
  if (!fs.existsSync(caseDir)) {
    fail(`missing benchmark case directory: ${caseDir}`);
    return [];
  }
  return fs.readdirSync(caseDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => normalizeBenchmarkRelativePath(path.join(caseDir, name)))
    .sort();
}

function validateCaseShape(caseJson, id) {
  if (String(caseJson?.id || '').trim() !== id) {
    fail(`case ${id} id mismatch`);
  }

  if (!caseJson?.referenceImage || typeof caseJson.referenceImage !== 'object') {
    fail(`case ${id} missing referenceImage object`);
  }
  if (!caseJson?.scenario || typeof caseJson.scenario !== 'object') {
    fail(`case ${id} missing scenario object`);
  } else {
    const category = String(caseJson.scenario.category || '').trim();
    if (!category) {
      fail(`case ${id} missing scenario.category`);
    } else if (!isReferenceBenchmarkCategorySlug(category)) {
      fail(`case ${id} scenario.category must be a stable lowercase slug`);
    }
    if (!caseJson.scenario.source || typeof caseJson.scenario.source !== 'object') {
      fail(`case ${id} missing scenario.source object`);
    } else if (!String(caseJson.scenario.source.providedBy || '').trim()) {
      fail(`case ${id} missing scenario.source.providedBy`);
    } else {
      const sourceKind = normalizeReferenceSourceKind(caseJson.scenario.source.providedBy);
      if (!isValidReferenceSourceKind(sourceKind)) {
        fail(`case ${id} scenario.source.providedBy must be one of: ${Array.from(VALID_REFERENCE_SOURCE_KINDS).join(', ')}`);
      }
    }
  }
  if (!caseJson?.execution || typeof caseJson.execution !== 'object') {
    fail(`case ${id} missing execution object`);
  }
  if (!caseJson?.outputs || typeof caseJson.outputs !== 'object') {
    fail(`case ${id} missing outputs object`);
  }
  if (!caseJson?.score || typeof caseJson.score !== 'object') {
    fail(`case ${id} missing score object`);
    return;
  }

  for (const scoreKey of ['structure', 'placement', 'textHierarchy', 'editability', 'overall']) {
    if (!Object.prototype.hasOwnProperty.call(caseJson.score, scoreKey)) {
      fail(`case ${id} missing score.${scoreKey}`);
      continue;
    }
    if (!isScoreValue(caseJson.score[scoreKey])) {
      fail(`case ${id} score.${scoreKey} must be null or a number from 0 to 1`);
    }
  }
}

function validateReferenceAsset(caseJson, id) {
  const referencePath = String(caseJson?.referenceImage?.path || '').trim();
  if (!referencePath) return;

  const resolvedPath = resolveBenchmarkPath(referencePath, id, 'referenceImage.path');
  if (resolvedPath && !fs.existsSync(resolvedPath)) {
    fail(`case ${id} reference image missing: ${referencePath}`);
  }
}

function validateOutputAssets(caseJson, id) {
  const screenshotPath = String(caseJson?.outputs?.resultScreenshot || '').trim();
  if (!screenshotPath) return;

  const resolvedPath = resolveBenchmarkPath(screenshotPath, id, 'outputs.resultScreenshot');
  if (resolvedPath && !fs.existsSync(resolvedPath)) {
    fail(`case ${id} result screenshot missing: ${screenshotPath}`);
  }
}

function validateExpectedElements(caseJson, id) {
  if (caseJson.expectedElements === undefined) return;
  if (!Array.isArray(caseJson.expectedElements)) {
    fail(`case ${id} expectedElements must be an array when provided`);
    return;
  }
  if (caseJson.expectedElements.length === 0) {
    fail(`case ${id} expectedElements must not be empty when provided`);
    return;
  }

  const elementIds = new Set();
  for (const [index, element] of caseJson.expectedElements.entries()) {
    const elementId = String(element?.id || '').trim();
    if (!elementId) {
      fail(`case ${id} expectedElements[${index}] missing id`);
    } else if (elementIds.has(elementId)) {
      fail(`case ${id} duplicate expected element id: ${elementId}`);
    } else {
      elementIds.add(elementId);
    }

    if (!String(element?.kind || '').trim()) {
      fail(`case ${id} expectedElements[${index}] missing kind`);
    }

    if (element?.kind === 'text' && !String(element?.content || '').trim()) {
      fail(`case ${id} expectedElements[${index}] text element missing content`);
    }

    const box = element?.expectedBox;
    if (!box || typeof box !== 'object') {
      fail(`case ${id} expectedElements[${index}] missing expectedBox`);
      continue;
    }
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!isFiniteNonNegativeNumber(box[key])) {
        fail(`case ${id} expectedElements[${index}].expectedBox.${key} must be a non-negative number`);
      }
    }
    if (Number(box.width) <= 0 || Number(box.height) <= 0) {
      fail(`case ${id} expectedElements[${index}] expectedBox width/height must be greater than 0`);
    }
  }
}

function validateAcceptanceCriteria(caseJson, id) {
  if (caseJson.acceptanceCriteria === undefined) return;
  if (!Array.isArray(caseJson.acceptanceCriteria) || caseJson.acceptanceCriteria.length === 0) {
    fail(`case ${id} acceptanceCriteria must be a non-empty array when provided`);
    return;
  }
  for (const [index, item] of caseJson.acceptanceCriteria.entries()) {
    if (!String(item || '').trim()) {
      fail(`case ${id} acceptanceCriteria[${index}] must be a non-empty string`);
    }
  }
}

function validateAcceptanceContract(caseJson, id) {
  if (!caseJson?.acceptance || typeof caseJson.acceptance !== 'object') {
    fail(`case ${id} missing acceptance object`);
    return;
  }

  const allowedEvidence = new Set([
    'editable-text-layers',
    'bounds-qa',
    'screenshot-pixel-probe',
    'manual-review'
  ]);
  const requiredEvidence = caseJson.acceptance.requiredEvidence;
  if (!Array.isArray(requiredEvidence) || requiredEvidence.length === 0) {
    fail(`case ${id} acceptance.requiredEvidence must be a non-empty array`);
  } else {
    for (const evidence of requiredEvidence) {
      if (!allowedEvidence.has(evidence)) {
        fail(`case ${id} acceptance.requiredEvidence contains unsupported value: ${evidence}`);
      }
    }
  }

  if (caseJson.acceptance.mustRemainEditable !== true) {
    fail(`case ${id} acceptance.mustRemainEditable must be true`);
  }

  const boundsQa = caseJson.acceptance.boundsQa;
  if (requiredEvidence?.includes?.('bounds-qa')) {
    if (!boundsQa || typeof boundsQa !== 'object') {
      fail(`case ${id} acceptance.boundsQa is required when bounds-qa evidence is required`);
    } else {
      if (!isFiniteNonNegativeNumber(boundsQa.minOkRatio) || Number(boundsQa.minOkRatio) > 1) {
        fail(`case ${id} acceptance.boundsQa.minOkRatio must be a number from 0 to 1`);
      }
      if (!isFiniteNonNegativeNumber(boundsQa.maxMismatch)) {
        fail(`case ${id} acceptance.boundsQa.maxMismatch must be a non-negative number`);
      }
      if (!isFiniteNonNegativeNumber(boundsQa.maxUnverified)) {
        fail(`case ${id} acceptance.boundsQa.maxUnverified must be a non-negative number`);
      }
    }
  }

  const pixelProbe = caseJson.acceptance.screenshotPixelProbe;
  if (requiredEvidence?.includes?.('screenshot-pixel-probe')) {
    if (!pixelProbe || typeof pixelProbe !== 'object') {
      fail(`case ${id} acceptance.screenshotPixelProbe is required when screenshot-pixel-probe evidence is required`);
    } else {
      if (pixelProbe.enabled !== true) {
        fail(`case ${id} acceptance.screenshotPixelProbe.enabled must be true`);
      }
      if (pixelProbe.rawImagesRedacted !== true) {
        fail(`case ${id} acceptance.screenshotPixelProbe.rawImagesRedacted must be true`);
      }
      const targetSize = pixelProbe.targetSize;
      if (!targetSize || typeof targetSize !== 'object') {
        fail(`case ${id} acceptance.screenshotPixelProbe.targetSize is required`);
      } else {
        for (const key of ['width', 'height']) {
          if (!isFiniteNonNegativeNumber(targetSize[key]) || Number(targetSize[key]) <= 0) {
            fail(`case ${id} acceptance.screenshotPixelProbe.targetSize.${key} must be greater than 0`);
          }
        }
      }
      const thresholds = pixelProbe.thresholds;
      if (!thresholds || typeof thresholds !== 'object') {
        fail(`case ${id} acceptance.screenshotPixelProbe.thresholds is required`);
      } else {
        for (const key of ['maxMae', 'maxHighDeltaRatio', 'minDarkJaccard']) {
          if (!isFiniteNonNegativeNumber(thresholds[key])) {
            fail(`case ${id} acceptance.screenshotPixelProbe.thresholds.${key} must be a non-negative number`);
          }
        }
      }
      if (!String(pixelProbe.boundary || '').trim()) {
        fail(`case ${id} acceptance.screenshotPixelProbe.boundary must describe the pixel-probe limitation`);
      }
    }
  }
}

const caseIds = new Set();
const manifestCaseFiles = new Set();
for (const item of manifest.cases) {
  const id = String(item?.id || '').trim();
  if (!id) {
    fail('case entry missing id');
    continue;
  }
  if (caseIds.has(id)) {
    fail(`duplicate case id: ${id}`);
    continue;
  }
  caseIds.add(id);

  const declaredFile = String(item?.file || '').trim();
  const caseFile = declaredFile
    ? path.resolve(benchmarkDir, declaredFile)
    : path.join(benchmarkDir, 'cases', `${id}.json`);
  const relativeCasePath = path.relative(path.resolve(benchmarkDir), caseFile);
  if (relativeCasePath.startsWith('..') || path.isAbsolute(relativeCasePath)) {
    fail(`case ${id} file escapes benchmark directory`);
    continue;
  }
  manifestCaseFiles.add(relativeCasePath.replace(/\\/g, '/'));
  if (!fs.existsSync(caseFile)) {
    fail(`case file missing for id ${id}: ${caseFile}`);
    continue;
  }

  const caseJson = readJson(caseFile);
  validateCaseShape(caseJson, id);
  validateReferenceAsset(caseJson, id);
  validateOutputAssets(caseJson, id);
  validateExpectedElements(caseJson, id);
  validateAcceptanceCriteria(caseJson, id);
  validateAcceptanceContract(caseJson, id);

  const status = String(caseJson?.status || '').trim();
  if (!status) {
    fail(`case ${id} missing status`);
  }
  if (String(item?.status || '').trim() && String(item.status).trim() !== status) {
    fail(`case ${id} manifest status does not match case status`);
  }

  const manualVerified = Boolean(caseJson?.verification?.manualVerified);
  const referencePath = String(caseJson?.referenceImage?.path || '').trim();
  const screenshotPath = String(caseJson?.outputs?.resultScreenshot || '').trim();

  if (manualVerified && !referencePath) {
    fail(`case ${id} is manualVerified but missing referenceImage.path`);
  }
  if (manualVerified && !screenshotPath) {
    fail(`case ${id} is manualVerified but missing outputs.resultScreenshot`);
  }
  if (manualVerified && !String(caseJson?.verification?.reviewedAt || '').trim()) {
    fail(`case ${id} is manualVerified but missing verification.reviewedAt`);
  }
}

for (const caseFile of listCaseJsonFiles()) {
  if (!manifestCaseFiles.has(caseFile)) {
    fail(`unregistered case file must be added to cases.manifest.json: ${caseFile}`);
  }
}

if (process.exitCode !== 1) {
  console.log('[benchmark:reference-replication] OK');
}
