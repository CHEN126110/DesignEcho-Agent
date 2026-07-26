#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const recorderPath = path.join(agentRoot, 'scripts', 'record-reference-replication-result.cjs');
const readinessPath = path.join(agentRoot, 'scripts', 'report-reference-replication-readiness.cjs');
const validatorPath = path.join(agentRoot, 'scripts', 'validate-reference-replication-benchmarks.cjs');
const sourceManifestPath = path.join(agentRoot, 'benchmarks', 'reference-replication', 'cases.manifest.json');
const sourceTemplatePath = path.join(agentRoot, 'benchmarks', 'reference-replication', 'case-template.json');
const sourceCasePath = path.join(agentRoot, 'benchmarks', 'reference-replication', 'cases', 'rr-002-neutral-quality-card-text-layout.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runNode(scriptPath, args, cwd = agentRoot) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function runNodeResult(scriptPath, args, cwd = agentRoot) {
  try {
    return { ok: true, output: runNode(scriptPath, args, cwd) };
  } catch (error) {
    return {
      ok: false,
      output: [error.stdout || '', error.stderr || '', error.message || String(error)].join('\n')
    };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createSuite(tempRoot, sourceKind = 'user-supplied-real-reference', caseId = 'rr-real-commercial-proof') {
  const suiteDir = path.join(tempRoot, caseId);
  const casesDir = path.join(suiteDir, 'cases');
  const assetsDir = path.join(suiteDir, 'assets');
  fs.mkdirSync(casesDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const manifest = readJson(sourceManifestPath);
  const template = readJson(sourceTemplatePath);
  const caseJson = readJson(sourceCasePath);
  caseJson.id = caseId;
  caseJson.name = 'Real commercial proof fixture';
  caseJson.status = 'reference_captured';
  caseJson.referenceImage.path = `assets/${caseId}.png`;
  caseJson.scenario.source = {
    providedBy: sourceKind,
    capturedAt: '2026-05-12',
    boundary: sourceKind === 'unknown'
      ? 'Hermetic smoke fixture proving unknown sources cannot support quality claims.'
      : 'Hermetic smoke fixture representing a non-synthetic real-reference path.'
  };
  caseJson.outputs.resultScreenshot = '';
  caseJson.verification.buildVerified = false;
  caseJson.verification.manualVerified = false;
  caseJson.verification.reviewedAt = '';
  caseJson.verification.reviewer = '';
  for (const key of Object.keys(caseJson.score)) {
    caseJson.score[key] = null;
  }

  manifest.cases = [{
      id: caseJson.id,
    name: caseJson.name,
    status: caseJson.status,
    file: `cases/${caseJson.id}.json`
  }];

  fs.writeFileSync(path.join(assetsDir, `${caseId}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeJson(path.join(suiteDir, 'cases.manifest.json'), manifest);
  writeJson(path.join(suiteDir, 'case-template.json'), template);
  writeJson(path.join(casesDir, `${caseJson.id}.json`), caseJson);
  return { suiteDir, caseId: caseJson.id };
}

function readReadiness(suiteDir) {
  return JSON.parse(runNode(readinessPath, ['--benchmark-dir', suiteDir, '--json']));
}

function writeEvidenceReport({ caseId, referencePath, resultPath, qualityClaimCandidateAfterManualReview }) {
  writeJson(path.join(agentRoot, 'tmp', `${caseId}-result-evidence.json`), {
    success: true,
    caseId,
    referenceImage: {
      relativePath: referencePath
    },
    resultScreenshot: {
      absolutePath: resultPath,
      normalizedSnapshotPath: path.join(agentRoot, 'tmp', `${caseId}-normalized.png`)
    },
    manualReviewRequired: true,
    qualityClaimCandidateAfterManualReview,
    commands: {
      recordResultAfterManualReview: `npm run benchmark:reference-replication:record-result -- --id ${caseId}`
    },
    pixelProbe: {
      status: 'ok',
      rawImagesRedacted: true,
      boundary: 'Pixel probe is diagnostic evidence only, not high-fidelity aesthetic acceptance.'
    }
  });
}

try {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-reference-record-result-'));
  try {
    const { suiteDir, caseId } = createSuite(tempRoot);
    const before = readReadiness(suiteDir);
    assert(before.suiteReadyForQualityClaim === false, 'suite should not be quality-ready before recording a result');
    assert(before.readinessCounts.reference_only === 1, 'initial case should be reference_only');

    const resultSource = path.join(tempRoot, 'result.png');
    fs.writeFileSync(resultSource, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const dryRunOutput = JSON.parse(runNode(recorderPath, [
      '--benchmark-dir', suiteDir,
      '--id', caseId,
      '--result-screenshot', resultSource,
      '--copy-result-screenshot',
      '--score-structure', '0.9',
      '--score-placement', '0.88',
      '--score-text-hierarchy', '0.86',
      '--score-editability', '0.92',
      '--score-overall', '0.89',
      '--build-verified',
      '--manual-verified',
      '--reviewer', 'smoke',
      '--dry-run'
    ]));
    assert(dryRunOutput.dryRun === true, 'dry-run should report dryRun=true');
    assert(!fs.existsSync(path.join(suiteDir, 'results', `${caseId}-result.png`)), 'dry-run must not copy result screenshot');

    const missingScores = runNodeResult(recorderPath, [
      '--benchmark-dir', suiteDir,
      '--id', caseId,
      '--result-screenshot', resultSource,
      '--copy-result-screenshot',
      '--manual-verified'
    ]);
    assert(!missingScores.ok, 'manual verification without complete scores should fail');
    assert(missingScores.output.includes('requires all five scores'), 'missing-score failure should explain score requirement');

    const recordOutput = JSON.parse(runNode(recorderPath, [
      '--benchmark-dir', suiteDir,
      '--id', caseId,
      '--result-screenshot', resultSource,
      '--copy-result-screenshot',
      '--score-structure', '0.9',
      '--score-placement', '0.88',
      '--score-text-hierarchy', '0.86',
      '--score-editability', '0.92',
      '--score-overall', '0.89',
      '--build-verified',
      '--manual-verified',
      '--reviewer', 'smoke',
      '--status', 'reviewed'
    ]));
    assert(recordOutput.copyResultScreenshot === true, 'record should copy result screenshot');
    assert(recordOutput.scoresComplete === true, 'record should complete scores');
    assert(recordOutput.manualVerified === true, 'record should mark manual verification');

    const updatedCase = readJson(path.join(suiteDir, 'cases', `${caseId}.json`));
    const manifest = readJson(path.join(suiteDir, 'cases.manifest.json'));
    assert(updatedCase.outputs.resultScreenshot === `results/${caseId}-result.png`, 'result screenshot should be benchmark-relative');
    assert(updatedCase.verification.buildVerified === true, 'build verification should be true');
    assert(updatedCase.verification.manualVerified === true, 'manual verification should be true');
    assert(updatedCase.verification.reviewer === 'smoke', 'reviewer should be recorded');
    assert(updatedCase.status === 'reviewed', 'case status should be updated');
    assert(manifest.cases[0].status === 'reviewed', 'manifest status should match case status');
    assert(fs.existsSync(path.join(suiteDir, updatedCase.outputs.resultScreenshot)), 'copied result screenshot should exist');

    const validatorOutput = runNodeResult(validatorPath, ['--benchmark-dir', suiteDir]);
    assert(validatorOutput.ok, `updated suite should pass benchmark validator:\n${validatorOutput.output}`);
    writeEvidenceReport({
      caseId,
      referencePath: updatedCase.referenceImage.path,
      resultPath: path.join(suiteDir, updatedCase.outputs.resultScreenshot),
      qualityClaimCandidateAfterManualReview: true
    });

    const after = readReadiness(suiteDir);
    assert(after.suiteReadyForQualityClaim === true, 'real non-synthetic reviewed case should become quality-claim candidate');
    assert(after.counts.designQualityEligible === 1, 'one case should be quality eligible');
    assert(after.readinessCounts.reviewed_real_quality_candidate === 1, 'readiness should classify reviewed candidate');

    const unknown = createSuite(tempRoot, 'unknown', 'rr-unknown-source-proof');
    const unknownResultSource = path.join(tempRoot, 'unknown-result.png');
    fs.writeFileSync(unknownResultSource, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    runNode(recorderPath, [
      '--benchmark-dir', unknown.suiteDir,
      '--id', unknown.caseId,
      '--result-screenshot', unknownResultSource,
      '--copy-result-screenshot',
      '--score-structure', '0.95',
      '--score-placement', '0.95',
      '--score-text-hierarchy', '0.95',
      '--score-editability', '0.95',
      '--score-overall', '0.95',
      '--build-verified',
      '--manual-verified',
      '--reviewer', 'smoke',
      '--status', 'reviewed'
    ]);
    const unknownCase = readJson(path.join(unknown.suiteDir, 'cases', `${unknown.caseId}.json`));
    writeEvidenceReport({
      caseId: unknown.caseId,
      referencePath: unknownCase.referenceImage.path,
      resultPath: path.join(unknown.suiteDir, unknownCase.outputs.resultScreenshot),
      qualityClaimCandidateAfterManualReview: false
    });
    const unknownAfter = readReadiness(unknown.suiteDir);
    assert(unknownAfter.suiteReadyForQualityClaim === false, 'unknown source must not become quality-claim ready even with high scores');
    assert(unknownAfter.counts.designQualityEligible === 0, 'unknown source should produce zero quality-eligible cases');
    assert(
      unknownAfter.cases[0].blockers.some((item) => item.includes('source kind cannot support')),
      'unknown source should explain the source-kind blocker'
    );

    console.log(JSON.stringify({
      success: true,
      caseId,
      before: before.readinessCounts,
      after: after.readinessCounts,
      designQualityEligible: after.counts.designQualityEligible,
      unknownSourceDesignQualityEligible: unknownAfter.counts.designQualityEligible
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
