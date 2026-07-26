#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function fileIncludes(root, relativePath, needle) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').includes(needle);
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function hasScript(packageJson, scriptName) {
  return Boolean(packageJson.scripts?.[scriptName]);
}

function buildReport() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const uxpRoot = path.join(root, 'DesignEcho-UXP');
  const packageJson = readJson(agentRoot, 'package.json');

  const core = {
    helperAvailable: exists(agentRoot, 'src/shared/design-image-placement-core.ts'),
    docAvailable: exists(agentRoot, 'docs/image-placement-core-mvp.md'),
    smokeAvailable: hasScript(packageJson, 'smoke:image-placement:core'),
    smokeInPreflight: packageJson.scripts?.['maintenance:preflight']?.includes('smoke:image-placement:core') === true,
    wrapsSmartScalingPolicy: fileIncludes(agentRoot, 'src/shared/design-image-placement-core.ts', 'computeSmartScalingDecision'),
    separatesPlanFromActualBounds: fileIncludes(agentRoot, 'src/shared/design-image-placement-core.ts', 'planned destinationBox 不能当成 actualBounds'),
    screenshotFailureCanFailPlacement: fileIncludes(agentRoot, 'scripts/smoke-image-placement-core.cjs', 'failed screenshot review must fail')
  };

  const uxpEvidence = {
    subjectBoundsToolAvailable: exists(uxpRoot, 'src/tools/image/get-subject-bounds.ts'),
    subjectBoundsUsesAlphaOrSelectionEvidence: fileIncludes(uxpRoot, 'src/tools/image/get-subject-bounds.ts', 'alpha')
      || fileIncludes(uxpRoot, 'src/tools/image/get-subject-bounds.ts', 'subject'),
    placeImagePrimitiveAvailable: exists(uxpRoot, 'src/tools/image/place-image.ts'),
    transformLayerPrimitiveAvailable: exists(uxpRoot, 'src/tools/layer/transform-layer.ts'),
    detailPageFillerHasPlacementAudit: fileIncludes(uxpRoot, 'src/tools/layout/detail-page-filler.ts', 'placementAuditSummary'),
    templateToolHasPlacementAudit: fileIncludes(uxpRoot, 'src/tools/layout/template-tool.ts', 'placementAudit'),
    screenSnapshotAvailable: exists(uxpRoot, 'src/tools/canvas/screen-snapshot.ts')
  };

  const businessBoundaries = {
    mainImageNotDirectlyWired: !fileIncludes(agentRoot, 'src/renderer/services/skill-executors/main-image.executor.ts', 'design-image-placement-core'),
    detailPageNotDirectlyWired: !fileIncludes(agentRoot, 'src/renderer/services/skill-executors/detail-page.executor.ts', 'design-image-placement-core'),
    skuNotDirectlyWired: !fileIncludes(agentRoot, 'src/renderer/services/skill-executors/sku-batch.executor.ts', 'design-image-placement-core'),
    governanceDocAvailable: exists(agentRoot, 'docs/business-skill-design-governance.md'),
    governanceRequiresCheckpoint: fileIncludes(
      agentRoot,
      'docs/business-skill-design-governance.md',
      'Do not change these three skills without the user checkpoint'
    )
  };

  const blockers = [];
  if (!core.helperAvailable || !core.smokeAvailable) {
    blockers.push('Image Placement Core helper or smoke is missing.');
  }
  if (!core.separatesPlanFromActualBounds) {
    blockers.push('Core does not clearly separate planned destinationBox from Photoshop actualBounds.');
  }
  if (!uxpEvidence.subjectBoundsToolAvailable) {
    blockers.push('UXP subject bounds evidence provider is missing.');
  }
  if (!uxpEvidence.placeImagePrimitiveAvailable || !uxpEvidence.transformLayerPrimitiveAvailable) {
    blockers.push('UXP placement or transform primitive is missing.');
  }
  if (!businessBoundaries.governanceRequiresCheckpoint) {
    blockers.push('Business skill user checkpoint governance is missing.');
  }

  const warnings = [
    'No live disposable Photoshop placement case is recorded in this readiness report.',
    'No business skill executor consumes Image Placement Core yet; this is intentional until user checkpoint.',
    'Bounds verification is geometric evidence only and cannot prove crop aesthetics or full design quality.'
  ];

  const adapterReadiness = blockers.length === 0
    ? 'ready_for_read_only_adapter'
    : 'blocked';

  return {
    success: true,
    version: 'image-placement-readiness/v0',
    adapterReadiness,
    core,
    uxpEvidence,
    businessBoundaries,
    blockers,
    warnings,
    nextGates: [
      'Build a read-only adapter that maps existing placement evidence to ImagePlacementPlan without changing executor behavior.',
      'Run disposable live Photoshop placement cases before business wiring.',
      'Ask the user before wiring main-image-design, detail-page-design or sku-batch to this core.'
    ],
    qualityClaimAllowed: false
  };
}

function printText(report) {
  const lines = [];
  lines.push('Image Placement Core Readiness');
  lines.push(`adapterReadiness: ${report.adapterReadiness}`);
  lines.push(`qualityClaimAllowed: ${report.qualityClaimAllowed}`);
  lines.push('');
  lines.push('blockers:');
  if (report.blockers.length === 0) {
    lines.push('- none');
  } else {
    report.blockers.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push('');
  lines.push('warnings:');
  report.warnings.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('nextGates:');
  report.nextGates.forEach((item) => lines.push(`- ${item}`));
  return lines.join('\n');
}

function main() {
  const report = buildReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(printText(report));
}

main();
