#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const validatorPath = path.join(agentRoot, 'scripts', 'validate-reference-replication-benchmarks.cjs');
const creatorPath = path.join(agentRoot, 'scripts', 'create-reference-replication-case.cjs');
const sourceManifestPath = path.join(agentRoot, 'benchmarks', 'reference-replication', 'cases.manifest.json');
const sourceTemplatePath = path.join(agentRoot, 'benchmarks', 'reference-replication', 'case-template.json');
const sourceCasePath = path.join(agentRoot, 'benchmarks', 'reference-replication', 'cases', 'rr-001-fex-certificate-text-layout.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runValidator(benchmarkDir) {
  try {
    const stdout = execFileSync(process.execPath, [validatorPath, '--benchmark-dir', benchmarkDir], {
      cwd: agentRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return {
      ok: false,
      output: [
        error.stdout || '',
        error.stderr || '',
        error.message || String(error)
      ].join('\n')
    };
  }
}

function runCreator(args) {
  try {
    const stdout = execFileSync(process.execPath, [creatorPath, ...args], {
      cwd: agentRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return {
      ok: false,
      output: [
        error.stdout || '',
        error.stderr || '',
        error.message || String(error)
      ].join('\n')
    };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectFailure(result, expectedText, label) {
  assert(!result.ok, `${label} should fail`);
  assert(
    result.output.includes(expectedText),
    `${label} should include "${expectedText}", got:\n${result.output}`
  );
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-reference-benchmark-'));

function createSuite(name, mutate) {
  const suiteDir = path.join(tempRoot, name);
  const casesDir = path.join(suiteDir, 'cases');
  fs.mkdirSync(casesDir, { recursive: true });

  const manifest = readJson(sourceManifestPath);
  const template = readJson(sourceTemplatePath);
  const caseJson = readJson(sourceCasePath);
  manifest.cases = [{
    id: caseJson.id,
    name: caseJson.name,
    status: caseJson.status,
    file: `cases/${caseJson.id}.json`
  }];

  // Keep the smoke hermetic: validation shape matters here, not local image files.
  caseJson.referenceImage.path = '';
  caseJson.outputs.resultScreenshot = '';
  caseJson.verification.manualVerified = false;
  caseJson.verification.reviewedAt = '';

  if (mutate) {
    mutate({ manifest, caseJson, suiteDir, casesDir });
  }

  writeJson(path.join(suiteDir, 'cases.manifest.json'), manifest);
  writeJson(path.join(suiteDir, 'case-template.json'), template);
  writeJson(path.join(casesDir, 'rr-001-fex-certificate-text-layout.json'), caseJson);
  return suiteDir;
}

try {
  const validSuite = createSuite('valid');
  const valid = runValidator(validSuite);
  assert(valid.ok, `valid suite should pass:\n${valid.output}`);

  const missingCategorySuite = createSuite('missing-category', ({ caseJson }) => {
    delete caseJson.scenario.category;
  });
  expectFailure(
    runValidator(missingCategorySuite),
    'missing scenario.category',
    'missing category suite'
  );

  const missingSourceSuite = createSuite('missing-source', ({ caseJson }) => {
    delete caseJson.scenario.source;
  });
  expectFailure(
    runValidator(missingSourceSuite),
    'missing scenario.source object',
    'missing source suite'
  );

  const missingProvidedBySuite = createSuite('missing-source-provided-by', ({ caseJson }) => {
    caseJson.scenario.source = {};
  });
  expectFailure(
    runValidator(missingProvidedBySuite),
    'missing scenario.source.providedBy',
    'missing source providedBy suite'
  );

  const ambiguousSourceSuite = createSuite('ambiguous-source-user', ({ caseJson }) => {
    caseJson.scenario.source.providedBy = 'user';
  });
  expectFailure(
    runValidator(ambiguousSourceSuite),
    'scenario.source.providedBy must be one of',
    'ambiguous source user suite'
  );

  const orphanSuite = createSuite('orphan-case', ({ casesDir, caseJson }) => {
    const orphanCase = { ...caseJson, id: 'rr-orphan-case' };
    writeJson(path.join(casesDir, 'rr-orphan-case.json'), orphanCase);
  });
  expectFailure(
    runValidator(orphanSuite),
    'unregistered case file must be added to cases.manifest.json',
    'orphan case suite'
  );

  const missingScreenshotSuite = createSuite('missing-result-screenshot', ({ caseJson }) => {
    caseJson.outputs.resultScreenshot = 'results/missing-result.png';
  });
  expectFailure(
    runValidator(missingScreenshotSuite),
    'result screenshot missing',
    'missing result screenshot suite'
  );

  const creatorSuite = createSuite('creator-default-register');
  const createResult = runCreator([
    '--benchmarks-dir', creatorSuite,
    '--id', 'rr-002-poster-layout',
    '--name', 'Poster layout case',
    '--category', 'poster-layout',
    '--source-kind', 'synthetic-fixture'
  ]);
  assert(createResult.ok, `creator should write and register by default:\n${createResult.output}`);
  const creatorManifest = readJson(path.join(creatorSuite, 'cases.manifest.json'));
  const creatorCase = readJson(path.join(creatorSuite, 'cases', 'rr-002-poster-layout.json'));
  assert(
    creatorManifest.cases.some((item) => item.id === 'rr-002-poster-layout'),
    'creator should register new case in manifest by default'
  );
  assert(creatorCase.scenario.category === 'poster-layout', 'creator should preserve category slug');
  assert(creatorCase.scenario.source.providedBy === 'synthetic-fixture', 'creator should persist explicit benchmark source kind');
  assert(runValidator(creatorSuite).ok, 'creator output should pass benchmark validator');

  const missingSourceKindCreatorSuite = createSuite('creator-missing-source-kind');
  expectFailure(
    runCreator([
      '--benchmarks-dir', missingSourceKindCreatorSuite,
      '--id', 'rr-002-missing-source-kind',
      '--name', 'Missing source kind case',
      '--category', 'poster-layout'
    ]),
    'missing required argument: --source-kind',
    'creator missing source kind'
  );

  const sourceKindSuite = createSuite('creator-source-kind');
  const sourceKindResult = runCreator([
    '--benchmarks-dir', sourceKindSuite,
    '--id', 'rr-006-source-kind',
    '--name', 'Source kind case',
    '--category', 'poster-layout',
    '--source-kind', 'real-commercial-reference',
    '--source-captured-at', '2026-05-12',
    '--source-boundary', 'Smoke source boundary'
  ]);
  assert(sourceKindResult.ok, `creator should persist source kind:\n${sourceKindResult.output}`);
  const sourceKindCase = readJson(path.join(sourceKindSuite, 'cases', 'rr-006-source-kind.json'));
  assert(sourceKindCase.scenario.source.providedBy === 'real-commercial-reference', 'creator should persist explicit source kind');
  assert(sourceKindCase.scenario.source.capturedAt === '2026-05-12', 'creator should persist source capturedAt');
  assert(sourceKindCase.scenario.source.boundary === 'Smoke source boundary', 'creator should persist source boundary');
  assert(runValidator(sourceKindSuite).ok, 'creator output with explicit source kind should pass benchmark validator');

  const copySourcePath = path.join(tempRoot, 'source-reference.jpg');
  fs.writeFileSync(copySourcePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const copySuite = createSuite('creator-copy-reference');
  const copyResult = runCreator([
    '--benchmarks-dir', copySuite,
    '--id', 'rr-004-copy-reference',
    '--name', 'Copy reference case',
    '--category', 'poster-layout',
    '--source-kind', 'synthetic-fixture',
    '--reference-image', copySourcePath,
    '--copy-reference-image'
  ]);
  assert(copyResult.ok, `creator should copy reference image when requested:\n${copyResult.output}`);
  const copiedCase = readJson(path.join(copySuite, 'cases', 'rr-004-copy-reference.json'));
  const copiedAssetPath = path.join(copySuite, copiedCase.referenceImage.path);
  assert(copiedCase.referenceImage.path === 'assets/rr-004-copy-reference.jpg', 'copied reference path should be benchmark-relative');
  assert(fs.existsSync(copiedAssetPath), 'copied reference asset should exist');
  assert(runValidator(copySuite).ok, 'creator output with copied reference asset should pass benchmark validator');

  const resultSourcePath = path.join(tempRoot, 'source-result.png');
  fs.writeFileSync(resultSourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const resultSuite = createSuite('creator-copy-result-screenshot');
  const resultCopy = runCreator([
    '--benchmarks-dir', resultSuite,
    '--id', 'rr-005-copy-result',
    '--name', 'Copy result screenshot case',
    '--category', 'poster-layout',
    '--source-kind', 'synthetic-fixture',
    '--result-screenshot', resultSourcePath,
    '--copy-result-screenshot'
  ]);
  assert(resultCopy.ok, `creator should copy result screenshot when requested:\n${resultCopy.output}`);
  const resultCase = readJson(path.join(resultSuite, 'cases', 'rr-005-copy-result.json'));
  const resultAssetPath = path.join(resultSuite, resultCase.outputs.resultScreenshot);
  assert(resultCase.outputs.resultScreenshot === 'results/rr-005-copy-result-result.png', 'copied result screenshot path should be benchmark-relative');
  assert(fs.existsSync(resultAssetPath), 'copied result screenshot should exist');
  assert(runValidator(resultSuite).ok, 'creator output with copied result screenshot should pass benchmark validator');

  const invalidCategorySuite = createSuite('creator-invalid-category');
  expectFailure(
    runCreator([
      '--benchmarks-dir', invalidCategorySuite,
      '--id', 'rr-003-invalid-category',
      '--name', 'Invalid category case',
      '--category', 'Poster Layout',
      '--source-kind', 'synthetic-fixture'
    ]),
    'invalid category',
    'invalid creator category'
  );

  console.log('[smoke:reference:benchmark-validator] OK');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
