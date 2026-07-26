#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.cwd();
const tmpDir = path.join(root, 'tmp', 'reference-real-case-intake-smoke');
fs.mkdirSync(tmpDir, { recursive: true });

const referenceImage = path.join(tmpDir, 'real-reference.png');
fs.writeFileSync(referenceImage, Buffer.from('not-a-decoded-image-required-for-intake'));
const syntheticNamedImage = path.join(tmpDir, 'synthetic-reference.png');
fs.writeFileSync(syntheticNamedImage, Buffer.from('synthetic-name-should-be-blocked'));

function run(args, expectSuccess = true) {
  try {
    const output = execFileSync('node', ['scripts/plan-reference-real-case-intake.cjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (!expectSuccess) {
      throw new Error(`Expected command to fail, but it passed: ${args.join(' ')}`);
    }
    return { ok: true, output, json: JSON.parse(output) };
  } catch (error) {
    if (expectSuccess) {
      throw error;
    }
    return {
      ok: false,
      output: `${error.stdout || ''}${error.stderr || ''}`,
      status: error.status
    };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const valid = run([
  '--json',
  '--id', 'rr-smoke-real-commercial-reference',
  '--name', '真实商业参考图 intake smoke',
  '--category', 'poster-layout',
  '--reference-image', referenceImage,
  '--source-kind', 'real-commercial-reference',
  '--reference-description', 'Smoke reference image for intake planning only'
]).json;

assert(valid.success === true, 'valid real case intake should pass');
assert(valid.policy.readOnly === true, 'intake planner must be read-only');
assert(valid.policy.doesNotWriteCaseJson === true, 'intake planner must not write case JSON');
assert(valid.policy.doesNotRunPhotoshop === true, 'intake planner must not run Photoshop');
assert(valid.qualityBoundary.notDesignQualityEvidenceYet === true, 'intake must not be quality evidence');
assert(valid.qualityBoundary.requiredBeforeQualityClaim.includes('manual review'), 'manual review boundary is required');
assert(valid.qualityBoundary.requiredBeforeQualityClaim.includes('valid result evidence report'), 'valid result evidence report boundary is required');
assert(valid.qualityBoundary.requiredBeforeQualityClaim.includes('diagnostic screenshot pixel probe'), 'diagnostic pixel probe boundary is required');
assert(valid.expectedEvidence.resultScreenshot.absolutePath.endsWith('rr-smoke-real-commercial-reference-result.png'), 'expected result screenshot path is required');
assert(valid.expectedEvidence.resultEvidenceJson.absolutePath.endsWith('rr-smoke-real-commercial-reference-result-evidence.json'), 'expected evidence json path is required');
assert(valid.expectedEvidence.normalizedSnapshot.diagnosticOnly === true, 'normalized snapshot must be diagnostic only');
assert(valid.qualityEvidenceRequirements.validResultEvidenceReportRequired === true, 'valid evidence report must be required');
assert(valid.qualityEvidenceRequirements.cannotClaimFromIntakeOnly === true, 'intake alone must never claim quality');
assert(valid.commands.dryRunCreateCase.includes('--dry-run'), 'dry-run create command is required');
assert(valid.commands.createCase.includes('benchmark:reference-replication:create-case'), 'create-case command is required');
assert(valid.commands.createCase.includes('--copy-reference-image'), 'reference image copy command is required');
assert(valid.commands.createCase.includes('--source-kind'), 'create-case command must persist source kind structurally');
assert(valid.commands.createCase.includes('real-commercial-reference'), 'create-case command must include the real source kind');
assert(valid.commands.capturePlan.includes('maintenance:reference-capture-plan'), 'capture plan command is required');
assert(valid.commands.evaluateResult.includes('benchmark:reference-replication:evaluate-result'), 'evaluate result command is required');
assert(valid.commands.evaluateResult.includes('--output-json'), 'evaluate command must produce a result evidence json');
assert(valid.commands.validateEvidence.includes('benchmark:reference-replication:validate-evidence'), 'validate evidence command is required');
assert(valid.commands.recordExistingBenchmarkResultAfterManualReview.includes('benchmark:reference-replication:record-result'), 'record existing result command is required');
assert(valid.commands.recordExistingBenchmarkResultAfterManualReview.includes('--manual-verified'), 'record command must keep manual review explicit');
assert(valid.commands.recordExternalResultAfterManualReviewTemplate.includes('--copy-result-screenshot'), 'external result template must copy the screenshot into benchmark results');
assert(valid.commands.qualityGateAfterRecording.includes('maintenance:reference-quality-gate'), 'quality gate command is required');
assert(valid.workflow.includes('run validateEvidence and fix evidence blockers before recording the case'), 'workflow must validate evidence before recording');

const blockedSynthetic = run([
  '--json',
  '--id', 'rr-smoke-synthetic',
  '--name', 'Synthetic should be blocked',
  '--category', 'poster-layout',
  '--reference-image', referenceImage,
  '--source-kind', 'synthetic-fixture'
], false);

assert(blockedSynthetic.status !== 0, 'synthetic source kind should fail');
assert(blockedSynthetic.output.includes('synthetic-fixture'), 'synthetic failure should explain source kind');

const missingImage = run([
  '--json',
  '--id', 'rr-smoke-missing',
  '--name', 'Missing image should be blocked',
  '--category', 'poster-layout',
  '--reference-image', path.join(tmpDir, 'missing.png')
], false);

assert(missingImage.status !== 0, 'missing reference image should fail');
assert(missingImage.output.includes('reference image does not exist'), 'missing image failure should explain the blocker');

const blockedByName = run([
  '--json',
  '--id', 'rr-smoke-synthetic-name',
  '--name', 'Synthetic name should be blocked',
  '--category', 'poster-layout',
  '--reference-image', syntheticNamedImage,
  '--source-kind', 'real-commercial-reference'
], false);

assert(blockedByName.status !== 0, 'synthetic-looking reference image names should fail');
assert(blockedByName.output.includes('reference image name indicates'), 'synthetic-looking file name failure should explain the blocker');

const expectedCasePath = path.join(root, 'benchmarks', 'reference-replication', 'cases', 'rr-smoke-real-commercial-reference.json');
assert(!fs.existsSync(expectedCasePath), 'intake planner must not create a benchmark case file');

console.log(JSON.stringify({
  success: true,
  checks: [
    'real non-synthetic reference intake produces dry-run/create commands',
    'real intake output includes result screenshot and result evidence report plan',
    'real intake workflow validates evidence before recording manual scores',
    'intake output is read-only and not design-quality evidence',
    'synthetic fixture source kind is blocked',
    'missing reference image is blocked',
    'synthetic or fixture-looking image names are blocked',
    'no case JSON is written'
  ]
}, null, 2));
