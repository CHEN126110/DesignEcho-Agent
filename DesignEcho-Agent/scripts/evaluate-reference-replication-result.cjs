#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { compareSnapshotToReference } = require('./lib/reference-screenshot-pixel-probe.cjs');
const {
  normalizeReferenceSourceKind,
  isRealReferenceSourceKind,
  isBlockedReferenceSourceKind,
  isValidReferenceSourceKind,
  isTemporaryFexReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');

const DEFAULT_CASE_ID = 'rr-002-neutral-quality-card-text-layout';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    let value = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;
    if (value === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }
    options[key] = value === undefined ? true : value;
  }
  return options;
}

function fail(message) {
  throw new Error(`[reference-replication:evaluate-result] ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function assertInsideDirectory(rootDir, targetPath, label) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} escapes benchmark directory`);
  }
}

function resolveInsideBenchmark(benchmarkDir, relativePath, label) {
  const raw = String(relativePath || '').trim();
  if (!raw) fail(`${label} is empty`);
  if (path.isAbsolute(raw)) fail(`${label} must be benchmark-relative`);
  const resolved = path.resolve(benchmarkDir, raw);
  assertInsideDirectory(benchmarkDir, resolved, label);
  return resolved;
}

function resolveInputPath(raw, baseDir) {
  if (!raw) return '';
  return path.isAbsolute(String(raw)) ? path.resolve(String(raw)) : path.resolve(baseDir, String(raw));
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function renderCommandPart(part) {
  const value = String(part);
  if (value === 'npm' || value === 'run' || value === '--' || value.startsWith('--') || value.startsWith('benchmark:')) {
    return value;
  }
  return quote(value);
}

function loadCase(benchmarkDir, caseId) {
  const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`missing manifest: ${manifestPath}`);
  const manifest = readJson(manifestPath);
  const manifestItem = (manifest.cases || []).find((item) => String(item?.id || '').trim() === caseId);
  if (!manifestItem) fail(`case not found in manifest: ${caseId}`);
  const casePath = resolveInsideBenchmark(benchmarkDir, manifestItem.file || `cases/${caseId}.json`, 'manifest case file');
  if (!fs.existsSync(casePath)) fail(`case file missing: ${manifestItem.file}`);
  const caseJson = readJson(casePath);
  if (String(caseJson.id || '').trim() !== caseId) fail(`case id mismatch in ${manifestItem.file}`);
  return { manifestItem, caseJson, casePath };
}

function resolveResultScreenshot(options, benchmarkDir, caseJson) {
  const explicit = String(options['result-screenshot'] || '').trim();
  if (explicit) {
    const resolved = resolveInputPath(explicit, process.cwd());
    if (!fs.existsSync(resolved)) fail(`result screenshot not found: ${resolved}`);
    return resolved;
  }

  const existing = String(caseJson?.outputs?.resultScreenshot || '').trim();
  if (!existing) fail('missing --result-screenshot and case outputs.resultScreenshot is empty');
  const resolved = resolveInsideBenchmark(benchmarkDir, existing, 'outputs.resultScreenshot');
  if (!fs.existsSync(resolved)) fail(`case result screenshot does not exist: ${existing}`);
  return resolved;
}

function thresholdsFromCase(caseJson) {
  return caseJson?.acceptance?.screenshotPixelProbe?.thresholds || {};
}

function targetSizeFromCase(caseJson) {
  return caseJson?.acceptance?.screenshotPixelProbe?.targetSize
    || caseJson?.scenario?.canvas
    || { width: 600, height: 420 };
}

function buildRecordCommand(caseId, screenshotPath, options = {}) {
  const reviewer = options.reviewer || '<reviewer>';
  const parts = [
    'npm', 'run', 'benchmark:reference-replication:record-result', '--',
    '--id', caseId,
    '--result-screenshot', screenshotPath,
    '--copy-result-screenshot',
    '--build-verified',
    '--manual-verified',
    '--reviewer', reviewer,
    '--score-structure', '<0..1>',
    '--score-placement', '<0..1>',
    '--score-text-hierarchy', '<0..1>',
    '--score-editability', '<0..1>',
    '--score-overall', '<0..1>'
  ];
  return parts.map(renderCommandPart).join(' ');
}

function renderScorecard(report) {
  return [
    '# Reference Replication Manual Scorecard',
    '',
    `- caseId: ${report.caseId}`,
    `- caseName: ${report.caseName}`,
    `- referenceImage: ${report.referenceImage.relativePath}`,
    `- resultScreenshot: ${report.resultScreenshot.absolutePath}`,
    `- pixelProbeStatus: ${report.pixelProbe.status}`,
    '',
    'Scores use 0..1. Do not mark manualVerified until all scores are filled by a human reviewer.',
    '',
    '| item | score | notes |',
    '| --- | ---: | --- |',
    '| structure |  |  |',
    '| placement |  |  |',
    '| textHierarchy |  |  |',
    '| editability |  |  |',
    '| overall |  |  |',
    '',
    '## Pixel Probe',
    '',
    `- mae: ${report.pixelProbe.mae ?? 'n/a'}`,
    `- highDeltaRatio: ${report.pixelProbe.highDeltaRatio ?? 'n/a'}`,
    `- darkJaccard: ${report.pixelProbe.darkJaccard ?? 'n/a'}`,
    `- softDarkJaccard: ${report.pixelProbe.softDarkJaccard ?? 'n/a'}`,
    '',
    '## Boundaries',
    '',
    '- Pixel probe is diagnostic only; it is not aesthetic acceptance.',
    '- Synthetic and FEX cases cannot support real commercial design-quality claims.',
    '- Only explicit real reference source kinds can become design-quality claim candidates.',
    '- This report does not modify benchmark case JSON.',
    '',
    '## Record Command After Manual Review',
    '',
    '```bash',
    report.commands.recordResultAfterManualReview,
    '```',
    ''
  ].join('\n');
}

function renderMarkdown(report) {
  return [
    '# Reference Replication Result Evidence',
    '',
    `- success: ${report.success}`,
    `- caseId: ${report.caseId}`,
    `- caseName: ${report.caseName}`,
    `- resultScreenshot: ${report.resultScreenshot.absolutePath}`,
    `- pixelProbeStatus: ${report.pixelProbe.status}`,
    `- manualReviewRequired: ${report.manualReviewRequired}`,
    `- qualityClaimCandidateAfterManualReview: ${report.qualityClaimCandidateAfterManualReview}`,
    '',
    '## Pixel Probe',
    '',
    '```json',
    JSON.stringify(report.pixelProbe, null, 2),
    '```',
    '',
    '## Scorecard',
    '',
    renderScorecard(report)
  ].join('\n');
}

async function buildReport() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const benchmarkDir = options['benchmark-dir']
    ? path.resolve(process.cwd(), String(options['benchmark-dir']))
    : path.join(repoRoot, 'benchmarks', 'reference-replication');
  const caseId = String(options.id || DEFAULT_CASE_ID).trim();
  const { caseJson, casePath } = loadCase(benchmarkDir, caseId);
  const referencePath = resolveInsideBenchmark(benchmarkDir, caseJson?.referenceImage?.path, 'referenceImage.path');
  if (!fs.existsSync(referencePath)) fail(`reference image missing: ${caseJson?.referenceImage?.path}`);
  const resultScreenshotPath = resolveResultScreenshot(options, benchmarkDir, caseJson);
  const snapshotBase64 = fs.readFileSync(resultScreenshotPath).toString('base64');
  const evidenceDir = path.join(repoRoot, 'tmp');
  const snapshotOut = options['normalized-snapshot-out']
    ? resolveInputPath(options['normalized-snapshot-out'], process.cwd())
    : path.join(evidenceDir, `${caseId}-evaluated-snapshot.png`);
  const pixelProbe = await compareSnapshotToReference({
    snapshotBase64,
    referencePath,
    targetSize: targetSizeFromCase(caseJson),
    thresholds: thresholdsFromCase(caseJson),
    snapshotOut
  });

  const sourceKind = normalizeReferenceSourceKind(caseJson?.scenario?.source?.providedBy);
  const temporaryFex = isTemporaryFexReferenceSourceKind(sourceKind)
    || /fex/i.test(`${caseId} ${caseJson?.name || ''} ${caseJson?.referenceImage?.path || ''}`);
  const realReferenceSource = isRealReferenceSourceKind(sourceKind) && !temporaryFex;
  const blockedSourceKind = isBlockedReferenceSourceKind(sourceKind);
  const validSourceKind = isValidReferenceSourceKind(sourceKind);
  const report = {
    success: true,
    generatedAt: new Date().toISOString(),
    caseId,
    caseName: caseJson.name || caseId,
    benchmarkDir: toPosixPath(benchmarkDir),
    caseFile: toPosixPath(path.relative(benchmarkDir, casePath)),
    referenceImage: {
      relativePath: String(caseJson?.referenceImage?.path || ''),
      absolutePath: toPosixPath(referencePath)
    },
    resultScreenshot: {
      absolutePath: toPosixPath(resultScreenshotPath),
      benchmarkRelativePath: toPosixPath(path.relative(benchmarkDir, resultScreenshotPath)),
      normalizedSnapshotPath: toPosixPath(snapshotOut)
    },
    scenario: {
      category: String(caseJson?.scenario?.category || ''),
      sourceKind,
      temporaryFex,
      realReferenceSource,
      blockedSourceKind,
      validSourceKind
    },
    pixelProbe,
    manualReviewRequired: true,
    qualityClaimCandidateAfterManualReview: realReferenceSource,
    commands: {
      recordResultAfterManualReview: buildRecordCommand(caseId, resultScreenshotPath, options),
      readinessAfterRecording: 'npm run maintenance:reference-readiness',
      validateAfterRecording: 'npm run maintenance:validate'
    },
    boundaries: [
      'This report does not modify benchmark case JSON.',
      'Pixel probe is diagnostic evidence only, not high-fidelity or aesthetic acceptance.',
      'Manual review and complete 0..1 scores are still required before recording manualVerified.',
      'Only explicit real reference source kinds can become design-quality claim candidates.'
    ]
  };

  const jsonOut = options['output-json']
    ? resolveInputPath(options['output-json'], process.cwd())
    : path.join(evidenceDir, `${caseId}-result-evidence.json`);
  const mdOut = options['output-md']
    ? resolveInputPath(options['output-md'], process.cwd())
    : path.join(evidenceDir, `${caseId}-result-evidence.md`);
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdOut, renderMarkdown(report), 'utf8');
  return {
    ...report,
    outputs: {
      json: toPosixPath(jsonOut),
      md: toPosixPath(mdOut)
    }
  };
}

buildReport()
  .then((report) => {
    console.log(JSON.stringify({
      success: report.success,
      caseId: report.caseId,
      pixelProbeStatus: report.pixelProbe.status,
      manualReviewRequired: report.manualReviewRequired,
      qualityClaimCandidateAfterManualReview: report.qualityClaimCandidateAfterManualReview,
      outputs: report.outputs,
      recordCommand: report.commands.recordResultAfterManualReview
    }, null, 2));
  })
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
