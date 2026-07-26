const fs = require('fs');
const path = require('path');
const {
  DEFAULT_REFERENCE_BENCHMARK_CATEGORY,
  isReferenceBenchmarkCategorySlug
} = require('./lib/reference-benchmark-categories.cjs');
const {
  VALID_REFERENCE_SOURCE_KINDS,
  isValidReferenceSourceKind,
  normalizeReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');

const cwd = process.cwd();
const defaults = {
  benchmarksDir: path.join(cwd, 'benchmarks', 'reference-replication'),
  casesDir: path.join(cwd, 'benchmarks', 'reference-replication', 'cases'),
  assetsDir: path.join(cwd, 'benchmarks', 'reference-replication', 'assets'),
  resultsDir: path.join(cwd, 'benchmarks', 'reference-replication', 'results'),
  templatePath: path.join(cwd, 'benchmarks', 'reference-replication', 'case-template.json'),
  manifestPath: path.join(cwd, 'benchmarks', 'reference-replication', 'cases.manifest.json'),
};

function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

function usage() {
  return [
    'Usage:',
    '  node scripts/create-reference-replication-case.cjs --id rr-002 --name "Case name" [options]',
    '',
    'Required:',
    '  --id <case-id>                  Case id used for the file name',
    '  --source-kind <kind>            Explicit reference source kind',
    '',
    'Options:',
    '  --name <text>                   Human-readable case name',
    '  --status <text>                 Case status written into the case JSON (default: pending)',
    '  --reference-image <path>        Reference image path stored in the case JSON',
    '  --copy-reference-image          Copy --reference-image into benchmark assets and store a benchmark-relative path',
    '  --reference-asset-name <name>    File name to use when copying the reference image',
    '  --reference-description <text>  Reference image description',
    `  --category <text>               Scenario category slug (default: ${DEFAULT_REFERENCE_BENCHMARK_CATEGORY})`,
    '  --source-captured-at <text>     Source capture date or timestamp',
    '  --source-boundary <text>        Source boundary note',
    '  --scenario-notes <text>         Scenario notes',
    '  --vision-model <text>           Vision model name',
    '  --logic-model <text>            Logic model name',
    '  --document-name <text>          Output document name',
    '  --result-screenshot <path>      Output screenshot path',
    '  --copy-result-screenshot        Copy --result-screenshot into benchmark results and store a benchmark-relative path',
    '  --result-screenshot-name <name> File name to use when copying the result screenshot',
    '  --notes <text>                  Output notes',
    '  --build-verified                Mark build verification as true',
    '  --manual-verified               Mark manual verification as true',
    '  --reviewed-at <iso-string>      Manual review timestamp',
    '  --reviewer <text>               Manual reviewer name',
    '  --register                      Add the case to the manifest (default)',
    '  --no-register                   Write the case file only; benchmark validation will fail until it is registered',
    '  --dry-run                       Print planned changes without writing files',
    '  --overwrite                     Overwrite an existing case file',
    '  --template <path>               Template JSON path (default: benchmarks/reference-replication/case-template.json)',
    '  --cases-dir <path>              Output cases directory',
    '  --assets-dir <path>             Benchmark assets directory',
    '  --results-dir <path>            Benchmark results screenshot directory',
    '  --manifest <path>               Manifest JSON path',
    '  --benchmarks-dir <path>         Benchmark root directory',
    '  --help                          Show this message',
  ].join('\n');
}

function fail(message) {
  console.error(`[reference-replication:create-case] ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    let value = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;

    if (value === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }

    if (value === undefined) {
      options[key] = true;
    } else {
      options[key] = value;
    }
  }
  return options;
}

function parseBooleanOption(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') {
    return true;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return Boolean(value);
}

function resolvePathValue(value, baseDir) {
  if (!value) {
    return '';
  }
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function normalizeCaseId(value) {
  return String(value || '').trim();
}

function validateCaseId(caseId) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(caseId);
}

function resolveInputs(options) {
  const benchmarksDir = resolvePathValue(options['benchmarks-dir'], cwd) || defaults.benchmarksDir;
  return {
    benchmarksDir,
    casesDir: resolvePathValue(options['cases-dir'], benchmarksDir) || path.join(benchmarksDir, 'cases'),
    assetsDir: resolvePathValue(options['assets-dir'], benchmarksDir) || path.join(benchmarksDir, 'assets'),
    resultsDir: resolvePathValue(options['results-dir'], benchmarksDir) || path.join(benchmarksDir, 'results'),
    templatePath: resolvePathValue(options.template, benchmarksDir) || path.join(benchmarksDir, 'case-template.json'),
    manifestPath: resolvePathValue(options.manifest, benchmarksDir) || path.join(benchmarksDir, 'cases.manifest.json'),
  };
}

function assertInsideDirectory(rootDir, targetPath, label) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes target directory`);
  }
}

function makeReferenceAssetName(caseId, sourcePath, requestedName) {
  if (requestedName !== undefined && String(requestedName).trim()) {
    const name = path.basename(String(requestedName).trim());
    if (name !== String(requestedName).trim()) {
      throw new Error('--reference-asset-name must be a file name, not a path');
    }
    return name;
  }

  const ext = path.extname(sourcePath).toLowerCase();
  if (!ext) {
    throw new Error('reference image must have a file extension when --copy-reference-image is used');
  }
  return `${caseId}${ext}`;
}

function makeResultScreenshotName(caseId, sourcePath, requestedName) {
  if (requestedName !== undefined && String(requestedName).trim()) {
    const name = path.basename(String(requestedName).trim());
    if (name !== String(requestedName).trim()) {
      throw new Error('--result-screenshot-name must be a file name, not a path');
    }
    return name;
  }

  const ext = path.extname(sourcePath).toLowerCase();
  if (!ext) {
    throw new Error('result screenshot must have a file extension when --copy-result-screenshot is used');
  }
  return `${caseId}-result${ext}`;
}

function planReferenceImagePath(options, resolved, caseId, overwrite) {
  const referenceImage = String(options['reference-image'] || '').trim();
  const copyReferenceImage = parseBooleanOption(options['copy-reference-image'], false);
  if (!copyReferenceImage) {
    return {
      copyReferenceImage: false,
      sourcePath: '',
      destinationPath: '',
      referenceImagePath: referenceImage
    };
  }

  if (!referenceImage) {
    throw new Error('--copy-reference-image requires --reference-image');
  }

  const sourcePath = resolvePathValue(referenceImage, cwd);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`reference image not found: ${sourcePath}`);
  }
  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`reference image is not a file: ${sourcePath}`);
  }

  const assetName = makeReferenceAssetName(caseId, sourcePath, options['reference-asset-name']);
  const destinationPath = path.resolve(resolved.assetsDir, assetName);
  assertInsideDirectory(resolved.assetsDir, destinationPath, 'reference asset path');
  if (fs.existsSync(destinationPath) && !overwrite) {
    throw new Error(`reference asset already exists: ${destinationPath}`);
  }

  return {
    copyReferenceImage: true,
    sourcePath,
    destinationPath,
    referenceImagePath: toPosixPath(path.relative(resolved.benchmarksDir, destinationPath))
  };
}

function planResultScreenshotPath(options, resolved, caseId, overwrite) {
  const resultScreenshot = String(options['result-screenshot'] || '').trim();
  const copyResultScreenshot = parseBooleanOption(options['copy-result-screenshot'], false);
  if (!copyResultScreenshot) {
    return {
      copyResultScreenshot: false,
      sourcePath: '',
      destinationPath: '',
      resultScreenshotPath: resultScreenshot
    };
  }

  if (!resultScreenshot) {
    throw new Error('--copy-result-screenshot requires --result-screenshot');
  }

  const sourcePath = resolvePathValue(resultScreenshot, cwd);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`result screenshot not found: ${sourcePath}`);
  }
  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`result screenshot is not a file: ${sourcePath}`);
  }

  const resultName = makeResultScreenshotName(caseId, sourcePath, options['result-screenshot-name']);
  const destinationPath = path.resolve(resolved.resultsDir, resultName);
  assertInsideDirectory(resolved.resultsDir, destinationPath, 'result screenshot path');
  if (fs.existsSync(destinationPath) && !overwrite) {
    throw new Error(`result screenshot already exists: ${destinationPath}`);
  }

  return {
    copyResultScreenshot: true,
    sourcePath,
    destinationPath,
    resultScreenshotPath: toPosixPath(path.relative(resolved.benchmarksDir, destinationPath))
  };
}

function cloneTemplate(template, overrides) {
  const cloned = JSON.parse(JSON.stringify(template));

  cloned.id = overrides.id;
  if (overrides.name !== undefined) cloned.name = overrides.name;
  if (overrides.status !== undefined) cloned.status = overrides.status;

  if (cloned.referenceImage && typeof cloned.referenceImage === 'object') {
    if (overrides.referenceImagePath !== undefined) cloned.referenceImage.path = overrides.referenceImagePath;
    if (overrides.referenceImageDescription !== undefined) cloned.referenceImage.description = overrides.referenceImageDescription;
  }

  if (cloned.scenario && typeof cloned.scenario === 'object') {
    if (overrides.category !== undefined) cloned.scenario.category = overrides.category;
    if (!cloned.scenario.source || typeof cloned.scenario.source !== 'object') {
      cloned.scenario.source = {};
    }
    if (overrides.sourceKind !== undefined) cloned.scenario.source.providedBy = overrides.sourceKind;
    if (overrides.sourceCapturedAt !== undefined) cloned.scenario.source.capturedAt = overrides.sourceCapturedAt;
    if (overrides.sourceBoundary !== undefined) cloned.scenario.source.boundary = overrides.sourceBoundary;
    if (overrides.scenarioNotes !== undefined) cloned.scenario.notes = overrides.scenarioNotes;
  }

  if (cloned.execution && typeof cloned.execution === 'object') {
    if (overrides.visionModel !== undefined) cloned.execution.visionModel = overrides.visionModel;
    if (overrides.logicModel !== undefined) cloned.execution.logicModel = overrides.logicModel;
    if (overrides.autoCreateDocument !== undefined) cloned.execution.autoCreateDocument = overrides.autoCreateDocument;
    if (overrides.templateApply !== undefined) cloned.execution.templateApply = overrides.templateApply;
  }

  if (cloned.outputs && typeof cloned.outputs === 'object') {
    if (overrides.documentName !== undefined) cloned.outputs.documentName = overrides.documentName;
    if (overrides.resultScreenshot !== undefined) cloned.outputs.resultScreenshot = overrides.resultScreenshot;
    if (overrides.outputNotes !== undefined) cloned.outputs.notes = overrides.outputNotes;
  }

  if (cloned.verification && typeof cloned.verification === 'object') {
    if (overrides.buildVerified !== undefined) cloned.verification.buildVerified = overrides.buildVerified;
    if (overrides.manualVerified !== undefined) cloned.verification.manualVerified = overrides.manualVerified;
    if (overrides.reviewedAt !== undefined) cloned.verification.reviewedAt = overrides.reviewedAt;
    if (overrides.reviewer !== undefined) cloned.verification.reviewer = overrides.reviewer;
  }

  return cloned;
}

function updateManifest(manifestPath, caseId, caseName, caseStatus) {
  const manifest = readJson(manifestPath);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest is not a valid object');
  }
  if (!Array.isArray(manifest.cases)) {
    manifest.cases = [];
  }

  const existingIndex = manifest.cases.findIndex((item) => String(item?.id || '').trim() === caseId);
  const entry = {
    id: caseId,
    name: caseName,
    status: caseStatus,
    file: toPosixPath(path.posix.join('cases', `${caseId}.json`)),
  };

  if (existingIndex >= 0) {
    manifest.cases[existingIndex] = { ...manifest.cases[existingIndex], ...entry };
  } else {
    manifest.cases.push(entry);
  }

  writeJson(manifestPath, manifest);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const resolved = resolveInputs(options);
  const caseId = normalizeCaseId(options.id);
  if (!caseId) {
    fail('missing required argument: --id');
    process.exit(1);
  }
  if (!validateCaseId(caseId)) {
    fail('invalid case id: use letters, numbers, dot, underscore, or hyphen only');
    process.exit(1);
  }

  const caseName = String(options.name || '').trim() || `Case ${caseId}`;
  const caseStatus = String(options.status || 'pending').trim() || 'pending';
  const category = String(options.category || DEFAULT_REFERENCE_BENCHMARK_CATEGORY).trim() || DEFAULT_REFERENCE_BENCHMARK_CATEGORY;
  if (!isReferenceBenchmarkCategorySlug(category)) {
    fail('invalid category: use a stable lowercase slug such as poster-layout, ecommerce-detail, or main-image');
    process.exit(1);
  }
  const sourceKind = normalizeReferenceSourceKind(options['source-kind']);
  if (options['source-kind'] === undefined) {
    fail(`missing required argument: --source-kind. Use one of: ${Array.from(VALID_REFERENCE_SOURCE_KINDS).join(', ')}`);
    process.exit(1);
  }
  if (!isValidReferenceSourceKind(sourceKind)) {
    fail(`invalid source kind: ${sourceKind}. Use one of: ${Array.from(VALID_REFERENCE_SOURCE_KINDS).join(', ')}`);
    process.exit(1);
  }
  const overwrite = parseBooleanOption(options.overwrite, false);
  const register = options['no-register'] === undefined
    ? parseBooleanOption(options.register, true)
    : false;
  const dryRun = parseBooleanOption(options['dry-run'], false);
  let referenceImagePlan;
  let resultScreenshotPlan;

  if (!fs.existsSync(resolved.benchmarksDir)) {
    fail(`missing benchmark directory: ${resolved.benchmarksDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(resolved.templatePath)) {
    fail(`missing template JSON: ${resolved.templatePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(resolved.manifestPath)) {
    fail(`missing manifest: ${resolved.manifestPath}`);
    process.exit(1);
  }

  try {
    referenceImagePlan = planReferenceImagePath(options, resolved, caseId, overwrite);
    resultScreenshotPlan = planResultScreenshotPath(options, resolved, caseId, overwrite);
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
    process.exit(1);
  }

  const template = readJson(resolved.templatePath);
  const nextCase = cloneTemplate(template, {
    id: caseId,
    name: caseName,
    status: caseStatus,
    referenceImagePath: referenceImagePlan.referenceImagePath,
    referenceImageDescription: String(options['reference-description'] || '').trim(),
    category,
    sourceKind,
    sourceCapturedAt: String(options['source-captured-at'] || '').trim(),
    sourceBoundary: String(options['source-boundary'] || '').trim(),
    scenarioNotes: String(options['scenario-notes'] || '').trim(),
    visionModel: String(options['vision-model'] || '').trim(),
    logicModel: String(options['logic-model'] || '').trim(),
    autoCreateDocument: options['auto-create-document'] === undefined ? undefined : parseBooleanOption(options['auto-create-document']),
    templateApply: options['template-apply'] === undefined ? undefined : parseBooleanOption(options['template-apply']),
    documentName: String(options['document-name'] || '').trim(),
    resultScreenshot: resultScreenshotPlan.resultScreenshotPath,
    outputNotes: String(options.notes || '').trim(),
    buildVerified: options['build-verified'] === undefined ? undefined : parseBooleanOption(options['build-verified']),
    manualVerified: options['manual-verified'] === undefined ? undefined : parseBooleanOption(options['manual-verified']),
    reviewedAt: String(options['reviewed-at'] || '').trim(),
    reviewer: String(options.reviewer || '').trim(),
  });

  ensureDir(resolved.casesDir);
  const casePath = path.join(resolved.casesDir, `${caseId}.json`);
  if (!dryRun && fs.existsSync(casePath) && !overwrite) {
    fail(`case file already exists: ${casePath}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(JSON.stringify({
      action: 'dry-run',
      casePath,
      register,
      manifestPath: resolved.manifestPath,
      referenceImageCopy: referenceImagePlan.copyReferenceImage
        ? {
            sourcePath: referenceImagePlan.sourcePath,
            destinationPath: referenceImagePlan.destinationPath,
            referenceImagePath: referenceImagePlan.referenceImagePath,
          }
        : null,
      resultScreenshotCopy: resultScreenshotPlan.copyResultScreenshot
        ? {
            sourcePath: resultScreenshotPlan.sourcePath,
            destinationPath: resultScreenshotPlan.destinationPath,
            resultScreenshotPath: resultScreenshotPlan.resultScreenshotPath,
          }
        : null,
      case: nextCase,
    }, null, 2));
    return;
  }

  if (referenceImagePlan.copyReferenceImage) {
    ensureDir(resolved.assetsDir);
    fs.copyFileSync(referenceImagePlan.sourcePath, referenceImagePlan.destinationPath);
  }
  if (resultScreenshotPlan.copyResultScreenshot) {
    ensureDir(resolved.resultsDir);
    fs.copyFileSync(resultScreenshotPlan.sourcePath, resultScreenshotPlan.destinationPath);
  }

  writeJson(casePath, nextCase);

  if (register) {
    updateManifest(resolved.manifestPath, caseId, caseName, caseStatus);
  }

  console.log(`[reference-replication:create-case] created case: ${casePath}`);
  if (register) {
    console.log(`[reference-replication:create-case] registered in manifest: ${resolved.manifestPath}`);
  }
}

try {
  main();
} catch (error) {
  fail(error && error.message ? error.message : String(error));
  process.exit(1);
}
