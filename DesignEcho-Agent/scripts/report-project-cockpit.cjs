#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES
} = require('./lib/reference-benchmark-categories.cjs');
const {
  buildReferenceQualityGateConsistency
} = require('./lib/reference-quality-gate-consistency.cjs');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe']
  }).trim();
}
function getRepoRoot() {
  return run('git', ['rev-parse', '--show-toplevel']).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseJsonCommand(command, args, cwd) {
  try {
    const output = run(command, args, { cwd });
    return { ok: true, value: JSON.parse(output), error: null };
  } catch (error) {
    return { ok: false, value: null, error: error.message || String(error) };
  }
}

function take(items, limit) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function countArray(items) {
  return Array.isArray(items) ? items.length : 0;
}

function countReferenceBenchmarkCases(agentRoot) {
  const benchmarkDir = path.join(agentRoot, 'benchmarks/reference-replication');
  const manifestPath = path.join(benchmarkDir, 'cases.manifest.json');
  const caseDir = path.join(benchmarkDir, 'cases');
  if (!fs.existsSync(caseDir)) {
    return {
      count: 0,
      files: [],
      categories: [],
      missingRepresentativeCategories: [],
      manifestAvailable: fs.existsSync(manifestPath),
      unlistedCaseFiles: []
    };
  }

  const diskFiles = fs.readdirSync(caseDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  const manifestItems = Array.isArray(manifest?.cases) ? manifest.cases : [];
  const declaredFiles = [];

  for (const item of manifestItems) {
    const declaredFile = String(item?.file || '').trim();
    const id = String(item?.id || '').trim();
    const relativeFile = declaredFile || (id ? `cases/${id}.json` : '');
    if (!relativeFile) continue;
    const resolvedFile = path.resolve(benchmarkDir, relativeFile);
    const relativeToBenchmark = path.relative(benchmarkDir, resolvedFile);
    if (relativeToBenchmark.startsWith('..') || path.isAbsolute(relativeToBenchmark)) continue;
    const basename = path.basename(resolvedFile);
    if (basename.endsWith('.json')) {
      declaredFiles.push(basename);
    }
  }

  const declaredFileSet = new Set(declaredFiles);
  const files = diskFiles.filter((name) => declaredFileSet.has(name));
  const unlistedCaseFiles = diskFiles.filter((name) => !declaredFileSet.has(name));
  const categories = [];
  for (const file of files) {
    try {
      const caseJson = readJson(path.join(caseDir, file));
      const category = String(caseJson?.scenario?.category || '').trim();
      if (category && !categories.includes(category)) {
        categories.push(category);
      }
    } catch {
      // The benchmark validator reports malformed cases; cockpit stays best-effort.
    }
  }
  const missingRepresentativeCategories = REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES.filter((category) => !categories.includes(category));
  return {
    count: files.length,
    files,
    categories: categories.sort(),
    missingRepresentativeCategories,
    manifestAvailable: Boolean(manifest),
    unlistedCaseFiles
  };
}

function evidenceIncludes(projectState, needle) {
  const evidence = [
    ...(projectState.verified?.code || []),
    ...(projectState.verified?.build || []),
    ...(projectState.verified?.manual || [])
  ].join('\n');
  return evidence.includes(needle);
}

function scriptIncludes(packageJson, scriptName, needle) {
  return Boolean(packageJson.scripts?.[scriptName] && packageJson.scripts[scriptName].includes(needle));
}

function fileIncludes(root, relativePath, needle) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').includes(needle);
}

function unifiedSkillExecutorEntrypointIncludes(root, needle) {
  return [
    'src/renderer/services/skill-executors/registry.ts',
    'src/renderer/services/skill-executors/index.ts'
  ].some((relativePath) => fileIncludes(root, relativePath, needle));
}

function normalizeLimit(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 8;
  return Math.min(parsed, 30);
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function buildPhotoshopBridgeHealthStatus(agentRoot, packageJson) {
  return {
    scriptAvailable: fs.existsSync(path.join(agentRoot, 'scripts/check-photoshop-bridge-health.cjs')),
    smokeAvailable: Boolean(packageJson.scripts?.['smoke:photoshop-bridge-health']),
    maintenanceCommandAvailable: Boolean(packageJson.scripts?.['maintenance:photoshop-bridge-health']),
    selfTestInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:photoshop-bridge-health'),
    readOnlyBoundary: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'writesPhotoshop: false'),
    noDocumentCreationBoundary: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'createsDocument: false'),
    noDesignQualityClaimBoundary: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'claimsDesignQuality: false'),
    classifiesBridgeTimeout: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'photoshop_bridge_unresponsive')
  };
}

function buildCockpit(limit) {
  const repoRoot = getRepoRoot();
  const agentRoot = path.join(repoRoot, 'DesignEcho-Agent');
  const projectState = readJson(path.join(agentRoot, 'project-memory/project-state.json'));
  const packageJson = readJson(path.join(agentRoot, 'package.json'));
  const referenceBenchmarkCases = countReferenceBenchmarkCases(agentRoot);
  const hygiene = parseJsonCommand('node', ['scripts/report-repo-hygiene.cjs'], agentRoot);
  const boundaries = parseJsonCommand('node', ['scripts/report-change-boundaries.cjs'], agentRoot);
  const capabilityMap = parseJsonCommand('node', ['scripts/report-agent-capability-map.cjs', '--json'], agentRoot);
  const referenceReadiness = parseJsonCommand('node', ['scripts/report-reference-replication-readiness.cjs', '--json'], agentRoot);
  const referencePipeline = parseJsonCommand('node', ['scripts/report-reference-evidence-pipeline.cjs', '--json'], agentRoot);
  const referenceQualityGate = parseJsonCommand('node', ['scripts/check-reference-quality-claim-gate.cjs', '--json'], agentRoot);
  const referenceStatus = parseJsonCommand('node', ['scripts/report-reference-replication-status.cjs', '--json'], agentRoot);
  const referenceQualityGateBlockers = referenceQualityGate.value?.gate?.blockers || [];
  const photoshopBridgeHealth = buildPhotoshopBridgeHealthStatus(agentRoot, packageJson);

  const hygieneValue = hygiene.value || {};
  const boundaryValue = boundaries.value || {};
  const boundaryGroups = Object.entries(boundaryValue.groups || {})
    .map(([id, group]) => ({
      id,
      title: group.title,
      count: group.count,
      staged: group.staged,
      unstaged: group.unstaged,
      untracked: group.untracked,
      validation: group.validation || []
    }))
    .sort((a, b) => b.count - a.count);

  return {
    repoRoot,
    generatedAt: new Date().toISOString(),
    currentFocus: projectState.currentFocus,
    currentMilestone: projectState.currentMilestone,
    milestoneStatus: projectState.milestoneStatus,
    current: {
      focus: projectState.currentFocus,
      milestone: projectState.currentMilestone,
      milestoneStatus: projectState.milestoneStatus
    },
    evidenceCounts: {
      verifiedCode: countArray(projectState.verified && projectState.verified.code),
      verifiedBuild: countArray(projectState.verified && projectState.verified.build),
      verifiedManual: countArray(projectState.verified && projectState.verified.manual),
      unverified: countArray(projectState.unverified),
      topRisks: countArray(projectState.topRisks),
      nextActions: countArray(projectState.nextActions)
    },
    worktree: {
      pendingChangeCount: hygieneValue.pendingChangeCount ?? boundaryValue.pendingChangeCount ?? null,
      reviewableChangeCount: hygieneValue.reviewableChangeCount ?? null,
      indexCleanup: hygieneValue.indexCleanup ? hygieneValue.indexCleanup.total : null,
      residualCleanup: hygieneValue.residualCleanup ? hygieneValue.residualCleanup.total : null,
      trackedNoise: hygieneValue.trackedNoise || null,
      boundaryReportAvailable: boundaries.ok,
      hygieneReportAvailable: hygiene.ok,
      boundaryReportError: boundaries.error,
      hygieneReportError: hygiene.error
    },
    photoshopBridgeHealth,
    referenceReplication: {
      overlayQa: {
        liveSmokePassed: evidenceIncludes(projectState, 'smoke:reference:overlay-live passed after UXP reload'),
        contractAvailable: Boolean(packageJson.scripts?.['smoke:reference:overlay-contract']),
        visualQaInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:visual-qa'),
        overlayContractInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:overlay-contract'),
        liveSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:overlay-live'),
        liveSmokePolicy: 'manual-live-only'
      },
      completionReport: {
        userReadableReportAvailable: evidenceIncludes(projectState, 'layout-replication final messages now use formatLayoutReplicationUserReport'),
        architectureGateCoversReport: evidenceIncludes(projectState, 'maintenance:agent-architecture now gates referenceReplicationReport'),
        smokeCoversWatchBoundary: evidenceIncludes(projectState, 'smoke:layout-replication:completion verifies pixel-probe watch and no-executable-match reports are readable and do not overclaim high-fidelity completion'),
        reportPolicy: 'diagnostic-not-high-fidelity-acceptance'
      },
      textBoundsSemantics: {
        envelopeRuleInQa: fileIncludes(agentRoot, 'src/shared/reference-replication-visual-qa.ts', 'isContainedTextEnvelope'),
        visualQaSmokeCoversEnvelope: fileIncludes(agentRoot, 'scripts/smoke-reference-visual-qa.cjs', 'text-envelope-watch'),
        neutralPixelBoundsSmokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:neutral-text-pixel-bounds']),
        neutralPixelBoundsInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:neutral-text-pixel-bounds'),
        neutralUiSmokeCoversReviewBoundary: fileIncludes(agentRoot, 'scripts/smoke-chat-ui-reference-replication.cjs', 'neutral text envelope drift stayed review-grade instead of hard-blocked'),
        neutralUiSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:chat-ui:reference-replication:neutral'),
        policy: 'text-envelope-watch-not-high-fidelity-acceptance'
      },
      benchmarks: {
        caseCount: referenceBenchmarkCases.count,
        caseFiles: referenceBenchmarkCases.files,
        manifestAvailable: referenceBenchmarkCases.manifestAvailable,
        unlistedCaseFiles: referenceBenchmarkCases.unlistedCaseFiles,
        categories: referenceBenchmarkCases.categories,
        missingRepresentativeCategories: referenceBenchmarkCases.missingRepresentativeCategories,
        hasSimpleTextLayoutFixtureCase: referenceBenchmarkCases.files.includes('rr-001-fex-certificate-text-layout.json'),
        fixturePolicy: 'temporary-text-layout-validation-only',
        validatorAvailable: Boolean(packageJson.scripts?.['benchmark:reference-replication:validate']),
        validatorInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'benchmark:reference-replication:validate'),
        coveragePolicy: referenceBenchmarkCases.missingRepresentativeCategories.length === 0
          ? 'representative-coverage-started'
          : referenceBenchmarkCases.count >= 2
          ? 'multi-case-started'
          : referenceBenchmarkCases.count === 1
            ? 'single-case-only'
            : 'no-case'
      },
      liveCapture: {
        captureCommandAvailable: Boolean(packageJson.scripts?.['benchmark:reference-replication:capture-live']),
        resultEvidenceCommandAvailable: Boolean(packageJson.scripts?.['benchmark:reference-replication:evaluate-result']),
        evidenceValidatorAvailable: Boolean(packageJson.scripts?.['benchmark:reference-replication:validate-evidence']),
        pipelineReportAvailable: Boolean(packageJson.scripts?.['maintenance:reference-evidence-pipeline']),
        readinessReportAvailable: Boolean(packageJson.scripts?.['maintenance:reference-live-readiness']),
        guardSmokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:live-capture-guard']),
        readinessSmokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:live-readiness']),
        resultEvidenceSmokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:result-evidence']),
        evidenceValidatorSmokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:result-evidence-validator']),
        pipelineSmokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:evidence-pipeline']),
        guardSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:live-capture-guard'),
        readinessSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:live-readiness'),
        resultEvidenceSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:result-evidence'),
        evidenceValidatorSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:result-evidence-validator'),
        pipelineSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:evidence-pipeline'),
        defaultSafeByPolicy: true,
        defaultCaseId: 'rr-002-neutral-quality-card-text-layout',
        liveFlagsRequired: [
          'DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI=1',
          'DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP=1',
          'DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER=1'
        ],
        policy: 'default-guarded-no-model-no-photoshop-no-screenshot'
      },
      realCaseIntake: {
        plannerAvailable: Boolean(packageJson.scripts?.['maintenance:reference-real-case-intake']),
        smokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:real-case-intake']),
        smokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:real-case-intake'),
        evidenceChainInPlanner: fileIncludes(agentRoot, 'scripts/plan-reference-real-case-intake.cjs', 'resultEvidenceJson'),
        expectedScreenshotInPlanner: fileIncludes(agentRoot, 'scripts/plan-reference-real-case-intake.cjs', 'resultScreenshot'),
        validateEvidenceCommandInPlanner: fileIncludes(agentRoot, 'scripts/plan-reference-real-case-intake.cjs', 'validateEvidence'),
        manualRecordCommandInPlanner: fileIncludes(agentRoot, 'scripts/plan-reference-real-case-intake.cjs', 'recordExistingBenchmarkResultAfterManualReview'),
        qualityGateCommandInPlanner: fileIncludes(agentRoot, 'scripts/plan-reference-real-case-intake.cjs', 'qualityGateAfterRecording'),
        policy: 'read-only-non-synthetic-reference-intake-not-quality-evidence'
      },
      qualityClaimGate: referenceQualityGate.ok ? {
        available: true,
        allowedToClaim: Boolean(referenceQualityGate.value?.gate?.allowedToClaim),
        explicitRealSourceCases: referenceQualityGate.value?.gate?.evidenceSummary?.explicitRealSourceCases ?? 0,
        sourceCounts: referenceQualityGate.value?.gate?.evidenceSummary?.sourceCounts || {},
        validResultEvidenceReport: referenceQualityGate.value?.gate?.evidenceSummary?.validResultEvidenceReport ?? 0,
        blockerCount: referenceQualityGateBlockers.length,
        hasExplicitRealSourceBlocker: referenceQualityGateBlockers.some((item) => item.includes('explicit real-source cases')),
        hasResultScreenshotBlocker: referenceQualityGateBlockers.includes('no real result screenshot evidence recorded'),
        hasValidEvidenceReportBlocker: referenceQualityGateBlockers.includes('no valid result evidence report recorded'),
        hasBuildVerificationBlocker: referenceQualityGateBlockers.includes('no build/execution verification recorded'),
        hasManualReviewBlocker: referenceQualityGateBlockers.includes('no manual review recorded'),
        hasCompleteScoreBlocker: referenceQualityGateBlockers.includes('no complete 0..1 score set recorded'),
        blockers: referenceQualityGateBlockers,
        warnings: referenceQualityGate.value?.gate?.warnings || [],
        smokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:quality-claim-gate']),
        smokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:quality-claim-gate'),
        policy: 'must-pass-before-any-reference-replication-design-quality-claim'
      } : {
        available: false,
        error: referenceQualityGate.error
      },
      qualityGateConsistency: buildReferenceQualityGateConsistency(agentRoot, packageJson),
      statusReport: referenceStatus.ok ? {
        available: true,
        designQualityClaimAllowed: Boolean(referenceStatus.value?.conclusion?.designQualityClaimAllowed),
        explicitRealSourceCases: referenceStatus.value?.conclusion?.explicitRealSourceCases ?? 0,
        sourceCounts: referenceStatus.value?.conclusion?.sourceCounts || {},
        nextActionCount: Array.isArray(referenceStatus.value?.nextActions) ? referenceStatus.value.nextActions.length : 0,
        topNextActions: Array.isArray(referenceStatus.value?.nextActions)
          ? referenceStatus.value.nextActions.slice(0, 3).map((item) => ({
            priority: item.priority,
            kind: item.kind,
            title: item.title,
            command: item.command,
            evidenceChain: item.evidenceChain ? {
              cannotClaimFromIntakeOnly: Boolean(item.evidenceChain.cannotClaimFromIntakeOnly),
              requiredOrder: item.evidenceChain.requiredOrder || []
            } : undefined
          }))
          : [],
        smokeAvailable: Boolean(packageJson.scripts?.['smoke:reference:status-report']),
        smokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:reference:status-report'),
        policy: 'read-only-resume-entrypoint'
      } : {
        available: false,
        error: referenceStatus.error
      },
      evidencePipeline: referencePipeline.ok ? {
        available: true,
        stageCounts: referencePipeline.value?.stageCounts || {},
        qualityClaimCandidates: referencePipeline.value?.qualityClaimCandidates ?? 0,
        sourceEligibleForQualityClaimCases: (referencePipeline.value?.cases || []).filter((item) => item.sourceEligibleForQualityClaim).length,
        reportOnly: Boolean(referencePipeline.value?.policy?.reportOnly),
        doesNotRunPhotoshop: Boolean(referencePipeline.value?.policy?.doesNotRunPhotoshop),
        doesNotMutateCases: Boolean(referencePipeline.value?.policy?.doesNotMutateCases)
      } : {
        available: false,
        error: referencePipeline.error
      },
      readiness: referenceReadiness.ok ? {
        available: true,
        suiteReadyForQualityClaim: Boolean(referenceReadiness.value?.suiteReadyForQualityClaim),
        counts: referenceReadiness.value?.counts || {},
        readinessCounts: referenceReadiness.value?.readinessCounts || {},
        sourceCounts: referenceReadiness.value?.sourceCounts || {},
        policy: referenceReadiness.value?.policy || {}
      } : {
        available: false,
        error: referenceReadiness.error
      }
    },
    mainImageAgentDraft: {
      helperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-agent-draft-plan.ts')),
      assetSelectionHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-asset-selection.ts')),
      visualLoopHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-visual-loop.ts')),
      visionPreflightHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-vision-preflight.ts')),
      executionAlignmentHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-execution-alignment.ts')),
      screenshotQaHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-screenshot-qa.ts')),
      screenshotProbeReadinessHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-screenshot-probe-readiness.ts')),
      qaReportHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-qa-report.ts')),
      strategyContractHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-strategy-contract.ts')),
      strategyInputBuilderHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-strategy-input-builder.ts')),
      assetHeroStrategyHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-asset-hero-strategy.ts')),
      projectStyleStrategyHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-project-style-strategy.ts')),
      designStandardsHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-design-standards.ts')),
      designReadinessReportHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-design-readiness-report.ts')),
      liveExecutorRequestHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-live-executor-request.ts')),
      liveExecutorCheckpointHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-live-executor-checkpoint.ts')),
      liveExecutorRunnerHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-live-executor-runner.ts')),
    livePhotoshopAdapterContractHelperAvailable: fs.existsSync(
      path.join(agentRoot, 'src/shared/main-image-live-photoshop-adapter-contract.ts')
    ),
    liveAdapterHandoffHelperAvailable: fs.existsSync(
      path.join(agentRoot, 'src/shared/main-image-live-adapter-handoff.ts')
    ),
    livePhotoshopToolAdapterHelperAvailable: fs.existsSync(
      path.join(agentRoot, 'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts')
    ),
    photoshopToolCapabilityMatrixHelperAvailable: fs.existsSync(
      path.join(agentRoot, 'src/shared/main-image-photoshop-tool-capability-matrix.ts')
    ),
    groupHierarchyContractHelperAvailable: fs.existsSync(
      path.join(agentRoot, 'src/shared/main-image-group-hierarchy-contract.ts')
    ),
      variantPlacementStrategyHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-variant-placement-strategy.ts')),
      productionStructureHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-production-document-structure.ts')),
      productionExecutionPlanHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-production-execution-plan.ts')),
      productionExecutorHandoffHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-production-executor-handoff.ts')),
      productionExecutorBridgeHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-production-executor-bridge.ts')),
      productionExecutorDryRunHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/main-image-production-executor-dry-run.ts')),
      smokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:agent-draft-plan']),
      strategyContractSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:strategy-contract']),
      strategyInputBuilderSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:strategy-input-builder']),
      assetHeroStrategySmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:asset-hero-strategy']),
      projectStyleStrategySmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:project-style-strategy']),
      designStandardsSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:design-standards']),
      designReadinessReportSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:design-readiness']),
      liveExecutorRequestSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:live-executor-request']),
      liveExecutorCheckpointSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:live-executor-checkpoint']),
      liveExecutorRunnerSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:live-executor-runner']),
    livePhotoshopAdapterContractSmokeAvailable: Boolean(
      packageJson.scripts?.['smoke:main-image:live-photoshop-adapter-contract']
    ),
    liveAdapterHandoffSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:live-adapter-handoff']),
    livePhotoshopToolAdapterSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:live-photoshop-tool-adapter']),
    liveToolAdapterDisposableSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:live-tool-adapter-disposable']),
    liveToolAdapterDisposableClassificationSmokeAvailable: Boolean(
      packageJson.scripts?.['smoke:main-image:live-tool-adapter-disposable:classification']
    ),
    photoshopToolCapabilityMatrixSmokeAvailable: Boolean(
      packageJson.scripts?.['smoke:main-image:photoshop-tool-capability-matrix']
    ),
    groupHierarchyContractSmokeAvailable: Boolean(
      packageJson.scripts?.['smoke:main-image:group-hierarchy-contract']
    ),
      variantPlacementStrategySmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:variant-placement-strategy']),
      productionStructureSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:production-structure']),
      productionExecutionPlanSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:production-execution-plan']),
      productionExecutorHandoffSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:production-executor-handoff']),
      productionExecutorBridgeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:production-executor-bridge']),
      productionExecutorDryRunSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:production-executor-dry-run']),
      assetSelectionSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:asset-selection']),
      visualLoopSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:visual-loop']),
      visionPreflightSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:vision-preflight']),
      candidatePreflightSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:candidate-preflight']),
      executionAlignmentSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:execution-alignment']),
      screenshotQaSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:screenshot-qa']),
      screenshotProbeReadinessSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:screenshot-probe-readiness']),
      pixelProbeAdapterSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:pixel-probe-adapter']),
      qaReportSmokeAvailable: Boolean(packageJson.scripts?.['smoke:main-image:qa-report']),
      smokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:agent-draft-plan'),
      strategyContractSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:strategy-contract'),
      strategyInputBuilderSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:strategy-input-builder'),
      assetHeroStrategySmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:asset-hero-strategy'),
      projectStyleStrategySmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:project-style-strategy'),
      designStandardsSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:design-standards'),
      designReadinessReportSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:design-readiness'),
      liveExecutorRequestSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:live-executor-request'),
      liveExecutorCheckpointSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:live-executor-checkpoint'),
      liveExecutorRunnerSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:live-executor-runner'),
    livePhotoshopAdapterContractSmokeInPreflight: scriptIncludes(
      packageJson,
      'maintenance:preflight',
      'smoke:main-image:live-photoshop-adapter-contract'
    ),
    liveAdapterHandoffSmokeInPreflight: scriptIncludes(
      packageJson,
      'maintenance:preflight',
      'smoke:main-image:live-adapter-handoff'
    ),
    livePhotoshopToolAdapterSmokeInPreflight: scriptIncludes(
      packageJson,
      'maintenance:preflight',
      'smoke:main-image:live-photoshop-tool-adapter'
    ),
    liveToolAdapterDisposableSmokeInPreflight: scriptIncludes(
      packageJson,
      'maintenance:preflight',
      'smoke:main-image:live-tool-adapter-disposable'
    ),
    liveToolAdapterDisposableClassificationSmokeInPreflight: scriptIncludes(
      packageJson,
      'maintenance:preflight',
      'smoke:main-image:live-tool-adapter-disposable:classification'
    ),
    photoshopToolCapabilityMatrixSmokeInPreflight: scriptIncludes(
      packageJson,
      'maintenance:preflight',
      'smoke:main-image:photoshop-tool-capability-matrix'
    ),
    groupHierarchyContractSmokeInPreflight: scriptIncludes(
      packageJson,
      'maintenance:preflight',
      'smoke:main-image:group-hierarchy-contract'
    ),
      variantPlacementStrategySmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:variant-placement-strategy'),
      productionStructureSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:production-structure'),
      productionExecutionPlanSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:production-execution-plan'),
      productionExecutorHandoffSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:production-executor-handoff'),
      productionExecutorBridgeSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:production-executor-bridge'),
      productionExecutorDryRunSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:production-executor-dry-run'),
      assetSelectionSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:asset-selection'),
      visualLoopSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:visual-loop'),
      visionPreflightSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:vision-preflight'),
      candidatePreflightSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:candidate-preflight'),
      executionAlignmentSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:execution-alignment'),
      screenshotQaSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:screenshot-qa'),
      screenshotProbeReadinessSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:screenshot-probe-readiness'),
      pixelProbeAdapterSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:pixel-probe-adapter'),
      qaReportSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:main-image:qa-report'),
      plannerEvidenceAttached: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/design-planner-context.ts',
        'buildMainImageAgentDraftPlan'
      ),
      plannerPassesStrategyContract: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/design-planner-context.ts',
        'strategyReviewGate'
      ),
      strategyContractNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-contract.ts',
        'mustNotExecutePhotoshop: true'
      ),
      strategyInputBuilderNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'mustNotExecutePhotoshop: true'
      ),
      assetHeroStrategyNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-asset-hero-strategy.ts',
        'mustNotExecutePhotoshop: true'
      ),
      projectStyleStrategyNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-project-style-strategy.ts',
        'mustNotExecutePhotoshop: true'
      ),
      designStandardsNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-design-standards.ts',
        'mustNotExecutePhotoshop: true'
      ),
      designReadinessReportNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-design-readiness-report.ts',
        'mustNotExecutePhotoshop: true'
      ),
      liveExecutorRequestNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-executor-request.ts',
        'mustNotExecutePhotoshop: true'
      ),
      liveExecutorCheckpointNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-executor-checkpoint.ts',
        'mustNotExecutePhotoshop: true'
      ),
      liveExecutorRunnerRequiresAdapter: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-executor-runner.ts',
        'blocked_missing_tool_adapter'
      ),
      liveExecutorRunnerBlocksNonDisposable: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-executor-runner.ts',
        'blocked_non_disposable_scope'
      ),
      liveExecutorRunnerNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-executor-runner.ts',
        'canClaimOutputQuality: false'
      ),
      livePhotoshopAdapterContractNoWrite: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-photoshop-adapter-contract.ts',
        'canWritePhotoshop: false'
      ),
      livePhotoshopAdapterContractMapsExportGroup: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-photoshop-adapter-contract.ts',
        "if (request.tool === 'exportGroup') return ['exportGroup'];"
      ),
      livePhotoshopAdapterContractMapsDestinationBoxMoveLayer: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-photoshop-adapter-contract.ts',
        "toolName: 'moveLayer'"
      ),
      livePhotoshopAdapterContractMapsNestedGroups: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-photoshop-adapter-contract.ts',
        'moveLayerToGroup'
      ),
      livePhotoshopAdapterContractNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-photoshop-adapter-contract.ts',
        'canClaimOutputQuality: false'
      ),
      liveAdapterHandoffNoWrite: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-adapter-handoff.ts',
        'canWritePhotoshop: false'
      ),
      liveAdapterHandoffNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-adapter-handoff.ts',
        'canClaimOutputQuality: false'
      ),
      liveAdapterHandoffBlocksProduction: fileIncludes(
        agentRoot,
        'src/shared/main-image-live-adapter-handoff.ts',
        'canRunProduction: false'
      ),
      livePhotoshopToolAdapterRequiresApproval: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts',
        'blocked_requires_explicit_live_approval'
      ),
      livePhotoshopToolAdapterBlocksNonDisposable: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts',
        'blocked_non_disposable_scope'
      ),
      livePhotoshopToolAdapterNoProduction: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts',
        'canRunProduction: false'
      ),
      livePhotoshopToolAdapterNoQualityClaim: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts',
        'canClaimOutputQuality: false'
      ),
      liveToolAdapterDisposableDefaultSkipped: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'skipped-guarded-live'
      ),
      liveToolAdapterDisposableRequiresLiveFlag: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_ACCEPTANCE'
      ),
      liveToolAdapterDisposableRequiresDisposableFlag: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'DESIGNECHO_LIVE_MAIN_IMAGE_TOOL_ADAPTER_DISPOSABLE_DOCUMENT'
      ),
      liveToolAdapterDisposablePreprocessesPlaceImageFilePath: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'preprocessPlaceImageParams'
      ),
      liveToolAdapterDisposableHasMcpTimeoutBoundary: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'MCP_REQUEST_TIMEOUT_MS'
      ),
      liveToolAdapterDisposableHasCleanupTimeoutBoundary: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'CLEANUP_REQUEST_TIMEOUT_MS'
      ),
      liveToolAdapterDisposableHasHealthStatus: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'healthStatus'
      ),
      liveToolAdapterDisposableHasRecoveryActions: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-live-tool-adapter-disposable.cjs',
        'recoveryActions'
      ),
      photoshopToolCapabilityMatrixNoWrite: fileIncludes(
        agentRoot,
        'src/shared/main-image-photoshop-tool-capability-matrix.ts',
        'noPhotoshopWrites: true'
      ),
      photoshopToolCapabilityMatrixSupportsNestedGroup: fileIncludes(
        agentRoot,
        'src/shared/main-image-photoshop-tool-capability-matrix.ts',
        'moveLayerToGroup'
      ),
      photoshopToolCapabilityMatrixUsesMoveLayerToGroup: fileIncludes(
        agentRoot,
        'src/shared/main-image-photoshop-tool-capability-matrix.ts',
        'moveLayerToGroup'
      ),
      photoshopToolCapabilityMatrixUsesExportGroup: fileIncludes(
        agentRoot,
        'src/shared/main-image-photoshop-tool-capability-matrix.ts',
        'exportGroup'
      ),
      uxpMoveLayerToGroupToolAvailable: fileIncludes(
        repoRoot,
        'DesignEcho-UXP/src/tools/layout/move-layer-to-group.ts',
        "name = 'moveLayerToGroup'"
      ),
      uxpMoveLayerToGroupRegistered: fileIncludes(
        repoRoot,
        'DesignEcho-UXP/src/tools/registry.ts',
        'new MoveLayerToGroupTool()'
      ),
      uxpExportGroupToolAvailable: fileIncludes(
        repoRoot,
        'DesignEcho-UXP/src/tools/image/export-group.ts',
        "name = 'exportGroup'"
      ),
      uxpExportGroupRegistered: fileIncludes(
        repoRoot,
        'DesignEcho-UXP/src/tools/registry.ts',
        'new ExportGroupTool()'
      ),
      groupHierarchyContractNoWrite: fileIncludes(
        agentRoot,
        'src/shared/main-image-group-hierarchy-contract.ts',
        'noPhotoshopWrites: true'
      ),
      groupHierarchyContractCoversMissingParentSemantics: fileIncludes(
        agentRoot,
        'src/shared/main-image-group-hierarchy-contract.ts',
        'missing_verified_parent_group_child_creation_semantics'
      ),
      groupHierarchyContractCoversMissingMoveToGroup: fileIncludes(
        agentRoot,
        'src/shared/main-image-group-hierarchy-contract.ts',
        'missing_verified_move_to_group_semantics'
      ),
      groupHierarchyContractCoversMissingGroupExport: fileIncludes(
        agentRoot,
        'src/shared/main-image-group-hierarchy-contract.ts',
        'exportGroup'
      ),
      variantPlacementStrategyNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-variant-placement-strategy.ts',
        'mustNotExecutePhotoshop: true'
      ),
      productionStructureNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-production-document-structure.ts',
        'mustNotExecutePhotoshop: true'
      ),
      productionExecutionPlanNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-production-execution-plan.ts',
        'mustNotExecutePhotoshop: true'
      ),
      productionExecutorHandoffNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-production-executor-handoff.ts',
        'mustNotExecutePhotoshop: true'
      ),
      productionExecutorBridgeNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-production-executor-bridge.ts',
        'mustNotExecutePhotoshop: true'
      ),
      productionExecutorDryRunNoExecution: fileIncludes(
        agentRoot,
        'src/shared/main-image-production-executor-dry-run.ts',
        'mustNotExecutePhotoshop: true'
      ),
      strategyInputBuilderUsesAssetHeroStrategy: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageAssetHeroStrategy'
      ),
      strategyInputBuilderUsesProjectStyleStrategy: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageProjectStyleStrategy'
      ),
      strategyInputBuilderUsesDesignStandards: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageDesignStandards'
      ),
      strategyInputBuilderUsesDesignReadinessReport: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageDesignReadinessReport'
      ),
      strategyInputBuilderUsesLiveExecutorRequest: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageLiveExecutorRequestPackage'
      ),
      strategyInputBuilderUsesVariantPlacementStrategy: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageVariantPlacementStrategy'
      ),
      strategyInputBuilderUsesProductionStructure: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageProductionDocumentStructure'
      ),
      strategyInputBuilderUsesProductionExecutionPlan: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageProductionExecutionPlan'
      ),
      strategyInputBuilderUsesProductionExecutorHandoff: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageProductionExecutorHandoff'
      ),
      strategyInputBuilderUsesProductionExecutorBridge: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageProductionExecutorDispatchPlan'
      ),
      strategyInputBuilderUsesProductionExecutorDryRun: fileIncludes(
        agentRoot,
        'src/shared/main-image-strategy-input-builder.ts',
        'buildMainImageProductionExecutorDryRunPreview'
      ),
      draftExposesStrategyContract: fileIncludes(
        agentRoot,
        'src/shared/main-image-agent-draft-plan.ts',
        'mainImageStrategyContract'
      ),
      draftExposesStrategyInputEvidence: fileIncludes(
        agentRoot,
        'src/shared/main-image-agent-draft-plan.ts',
        'mainImageStrategyInputBundle'
      ),
      draftUsesStrategyInputBuilder: fileIncludes(
        agentRoot,
        'src/shared/main-image-agent-draft-plan.ts',
        'buildMainImageStrategyInputs'
      ),
      draftPlanUsesAssetSelection: fileIncludes(
        agentRoot,
        'src/shared/main-image-agent-draft-plan.ts',
        'selectMainImageAssetCandidate'
      ),
      draftPlanUsesVisualLoop: fileIncludes(
        agentRoot,
        'src/shared/main-image-agent-draft-plan.ts',
        'buildMainImageVisualVerification'
      ),
      executorCanRunVisionPreflight: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'analyzeAssetContent[main-image-vision-preflight]'
      ),
      executorExposesCandidatePreflight: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageCandidatePreflight'
      ),
      executorExposesExecutionAlignment: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageExecutionAlignment'
      ),
      executorExposesScreenshotQa: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageScreenshotQa'
      ),
      executorExposesScreenshotProbeReadiness: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageScreenshotProbeReadiness'
      ),
      executorRunsPixelProbeAdapter: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'compareMainImageResultToReference'
      ),
      executorExposesQaReport: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageQaReport'
      ),
      resourceProbeImageFileAvailable: fileIncludes(
        agentRoot,
        'src/main/ipc-handlers/resource-handlers.ts',
        'resource:probeImageFile'
      ),
      resourceCompareImageFilesAvailable: fileIncludes(
        agentRoot,
        'src/main/ipc-handlers/resource-handlers.ts',
        'resource:compareImageFiles'
      ),
      plannerAcceptsVisionSignal: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/design-planner-context.ts',
        'visionSignal: input.visionSignal'
      ),
      executorExposesDraft: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageAgentDraft: designPlanner.mainImageAgentDraft'
      ),
      executorExposesAssetSelection: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageAssetSelection: designPlanner.mainImageAgentDraft.assetSelection'
      ),
      executorExposesVisualLoop: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'mainImageVisualVerification: designPlanner.mainImageAgentDraft.visualVerification'
      ),
      noOverclaimSmoke: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-agent-draft-plan.cjs',
        'no-overclaim-without-screenshot-or-manual-review'
      ),
      qaReportNoOverclaimSmoke: fileIncludes(
        agentRoot,
        'scripts/smoke-main-image-qa-report.cjs',
        'pixelProbe ok without manual review must not allow quality claim'
      ),
      policy: 'agent-first-plan-not-design-quality-claim'
    },
    projectAssetIndex: {
      helperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/project-asset-index.ts')),
      visualSamplingHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/project-visual-sampling.ts')),
      visualInsightCacheHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/project-visual-insight-cache.ts')),
      visualInsightCacheFillHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/project-visual-insight-cache-fill.ts')),
      visualInsightCacheFillRendererAvailable: fileIncludes(
        agentRoot,
        'src/renderer/services/project-visual-insight-cache-fill.ts',
        'runProjectVisualInsightCacheFill'
      ),
      businessVisualContextHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-visual-context.ts')),
      businessVisualObservationFeedbackHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-visual-observation-feedback.ts')),
      businessVisualContextRendererAvailable: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/business-skill-visual-context.ts',
        'buildBusinessVisualContextForSkill'
      ),
      businessVisualObservationFeedbackRendererAvailable: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/business-skill-visual-context.ts',
        'businessVisualObservationFeedback'
      ),
      businessVisualObservationFeedbackUiAvailable: fileIncludes(
        agentRoot,
        'src/renderer/components/message/parser.ts',
        'buildBusinessVisualObservationFeedbackCard'
      ),
      businessVisualContextEntrypointWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'attachBusinessVisualContextToResult'
      ),
      projectAssetIndexSmokeAvailable: Boolean(packageJson.scripts?.['smoke:project-asset-index']),
      visualSamplingSmokeAvailable: Boolean(packageJson.scripts?.['smoke:project-visual-sampling']),
      visualInsightCacheSmokeAvailable: Boolean(packageJson.scripts?.['smoke:project-visual-insight-cache']),
      visualInsightCacheFillSmokeAvailable: Boolean(packageJson.scripts?.['smoke:project-visual-insight-cache-fill']),
      businessVisualContextSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-gate']),
      businessVisualObservationFeedbackSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-feedback']),
      businessVisualObservationFeedbackDesktopSmokeAvailable: Boolean(packageJson.scripts?.['smoke:chat-ui:business-visual-feedback']),
      detailPageSkillReadinessHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/detail-page-skill-readiness.ts')),
      detailPageSkillReadinessSmokeAvailable: Boolean(packageJson.scripts?.['smoke:detail-page:skill-readiness']),
      detailPageSkillReadinessExecutorWired: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/detail-page.executor.ts',
        'detailPageSkillReadiness'
      ),
      detailPageSkillReadinessWiringSmokeAvailable: Boolean(packageJson.scripts?.['smoke:detail-page:readiness-wiring']),
      agentDiagnosticRecordHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-diagnostic-record.ts')),
      agentDiagnosticRecordSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:diagnostic-record']),
      agentAcceptanceDebugCarriesDiagnosticRecord: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-contracts.ts',
        'diagnosticRecord'
      ),
      agentAcceptanceDiagnosticExportHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-acceptance-export.ts')),
      agentAcceptanceDiagnosticExportSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-diagnostic-export']),
      agentAcceptanceDiagnosticExportWiredToChatBridge: fileIncludes(
        agentRoot,
        'src/renderer/components/ChatPanel.tsx',
        'buildAgentAcceptanceDebugExport'
      ),
      agentAcceptanceBusinessSkillVerificationSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-business-skill-evidence']),
      agentAcceptanceBusinessSkillVerificationReportAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-contracts.ts',
        'businessSkillExecutionPlanIntake'
      ),
      agentAcceptanceBusinessSkillVerificationExportAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-export.ts',
        'executionPlanIntakeBoundaryOk'
      ),
      agentIntentDecisionIntakeHelperAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/agent-intent-decision-intake.ts')
      ),
      agentIntentDecisionIntakeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:intent-decision-intake']),
      agentIntentDecisionIntakeSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:intent-decision-intake'
      ),
      agentIntentDecisionIntakeReportAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-contracts.ts',
        'agentIntentDecisionIntake'
      ),
      agentIntentDecisionIntakeExportAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-export.ts',
        'intentDecisionIntakeBoundaryOk'
      ),
      agentIntentDecisionIntakeNoExecutionBoundary: fileIncludes(
        agentRoot,
        'src/shared/agent-intent-decision-intake.ts',
        'mustNotRunPhotoshop: true'
      ),
      agentVisibleActivitySmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:visible-activity']),
      agentVisibleActivitySmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:visible-activity'
      ),
      agentWorkerIdentitySmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:worker-identity']),
      agentWorkerIdentitySmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:worker-identity'
      ),
      agentVisibleActivityHelperAvailable: fileIncludes(
        agentRoot,
        'src/renderer/services/agent-visible-feedback.ts',
        'buildVisibleAgentActivityFromStepEvent'
      ),
      agentWorkerIdentityTeammateBoundary: fileIncludes(
        agentRoot,
        'src/renderer/services/agent-visible-feedback.ts',
        "'teammate'"
      )
        && fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/autonomous-agent.executor.ts',
        'emitTeammateActivityStep'
      ),
      agentAcceptanceRuntimeModeContractAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/agent-acceptance-runtime-mode.ts')
      ),
      agentAcceptanceRuntimeModeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-runtime-mode']),
      agentAcceptanceRuntimeModeSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:acceptance-runtime-mode'
      ),
      agentAcceptanceRuntimeModeProductionBoundary: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-runtime-mode.ts',
        'canExposeTechnicalDiagnosticsToUser: false'
      )
        && fileIncludes(
          agentRoot,
          'src/shared/agent-acceptance-runtime-mode.ts',
          'mustKeepSeparateFromProduction: true'
        ),
      agentAcceptanceRuntimeModeDeveloperBoundary: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-runtime-mode.ts',
        'canRunCodexDrivenAgentAcceptance: true'
      )
        && fileIncludes(
          agentRoot,
          'src/shared/agent-acceptance-runtime-mode.ts',
          'explicit_acceptance_opt_in_required'
        ),
      ecommerceSocksDesignEntrySmokeAvailable: Boolean(packageJson.scripts?.['smoke:ecommerce-socks-design:entry']),
      ecommerceSocksDesignEntrySmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:entry'
      ),
      ecommerceSocksStrategyCheckpointSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:strategy-checkpoint']
      ),
      ecommerceSocksStrategyCheckpointSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:strategy-checkpoint'
      ),
      ecommerceSocksStrategyCheckpointNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-strategy-checkpoint.ts',
        'canClaimDesignComplete: false'
      ),
      ecommerceSocksChildStrategyPacketsSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:child-strategy-packets']
      ),
      ecommerceSocksChildStrategyPacketsSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:child-strategy-packets'
      ),
      ecommerceSocksChildStrategyPacketsNoImplementation: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-child-strategy-packets.ts',
        'canImplementChildStrategyChanges: false'
      ),
      ecommerceSocksChildStrategyReviewGateSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:child-strategy-review-gate']
      ),
      ecommerceSocksChildStrategyReviewGateSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:child-strategy-review-gate'
      ),
      ecommerceSocksChildStrategyReviewGateNoExecution: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-child-strategy-review-gate.ts',
        'mustNotExecuteChildSkills: true'
      ),
      ecommerceSocksChildStrategyHandoffSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:child-strategy-handoff']
      ),
      ecommerceSocksChildStrategyHandoffSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:child-strategy-handoff'
      ),
      ecommerceSocksChildStrategyHandoffNoExecution: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-child-strategy-handoff.ts',
        'mustNotExecuteChildSkills: true'
      ),
      ecommerceSocksChildStrategyConsumptionSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:child-strategy-consumption']
      ),
      ecommerceSocksChildStrategyConsumptionSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:child-strategy-consumption'
      ),
      ecommerceSocksChildStrategyConsumptionNoExecution: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-child-strategy-consumer.ts',
        'canExecuteChildSkill: false'
      ),
      ecommerceSocksDispatchCheckpointSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:dispatch-checkpoint']
      ),
      ecommerceSocksDispatchCheckpointSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:dispatch-checkpoint'
      ),
      ecommerceSocksDispatchLifecycleSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:dispatch-lifecycle']
      ),
      ecommerceSocksDispatchLifecycleSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:dispatch-lifecycle'
      ),
      ecommerceSocksDispatchOrchestrationSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:dispatch-orchestration']
      ),
      ecommerceSocksDispatchOrchestrationSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:dispatch-orchestration'
      ),
      ecommerceSocksDispatchAuthorizationSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:dispatch-authorization']
      ),
      ecommerceSocksDispatchAuthorizationSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:dispatch-authorization'
      ),
      ecommerceSocksChildDispatchRunnerSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:child-dispatch-runner']
      ),
      ecommerceSocksChildDispatchRunnerSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:child-dispatch-runner'
      ),
      ecommerceSocksChildReportAggregationSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:ecommerce-socks-design:child-report-aggregation']
      ),
      ecommerceSocksChildReportAggregationSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:ecommerce-socks-design:child-report-aggregation'
      ),
      ecommerceSocksDesignSkillDeclared: fileIncludes(
        agentRoot,
        'src/shared/skills/skill-declarations.ts',
        "id: 'ecommerce-socks-design'"
      ),
      ecommerceSocksDesignExecutorRegistered: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/index.ts',
        'ecommerceSocksDesignExecutor'
      ),
      ecommerceSocksDesignNoPhotoshopToolsBoundary: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-design.ts',
        'noPhotoshopWrites'
      ),
      ecommerceSocksDispatchNoChildExecutionBoundary: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-design.ts',
        'child_dispatch_checkpoint_not_implemented'
      ),
      ecommerceSocksDispatchLifecycleBoundary: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-design.ts',
        'ecommerce-socks-dispatch-lifecycle/v0'
      ),
      ecommerceSocksDispatchOrchestrationBoundary: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-design.ts',
        'ecommerce-socks-dispatch-orchestration/v0'
      ),
      ecommerceSocksDispatchAuthorizationBoundary: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-design.ts',
        'ecommerce-socks-dispatch-authorization/v0'
      ),
      ecommerceSocksChildDispatchRunnerBoundary: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-design.ts',
        'ecommerce-socks-child-dispatch-run/v0'
      )
        && fileIncludes(
          agentRoot,
          'src/renderer/services/skill-executors/ecommerce-socks-design.executor.ts',
          'ecommerceSocksChildDispatchRun'
        ),
      ecommerceSocksChildReportAggregationBoundary: fileIncludes(
        agentRoot,
        'src/shared/ecommerce-socks-design.ts',
        'ecommerce-socks-child-report-aggregation/v0'
      )
        && fileIncludes(
          agentRoot,
          'src/renderer/services/skill-executors/ecommerce-socks-design.executor.ts',
          'ecommerceSocksChildReportAggregation'
        ),
      agentVisibleActivityNoFakeThinkingBoundary: fileIncludes(
        agentRoot,
        'src/renderer/services/agent-visible-feedback.ts',
        'canClaimModelReasoning: false'
      ),
      agentObservationChannelPolicyAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/agent-observation-channels.ts')
      ),
      agentObservationChannelPolicySmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:observation-channels']),
      agentObservationChannelPolicySmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:observation-channels'
      ),
      agentObservationChannelPolicyWiredToChatPanel: fileIncludes(
        agentRoot,
        'src/renderer/components/ChatPanel.tsx',
        'classifyAgentObservationChannel'
      ),
      agentObservationChannelPolicyWiredToRuntime: fileIncludes(
        agentRoot,
        'src/renderer/services/agent-runtime/agent.ts',
        "source: 'provider_thinking_delta'"
      ),
      agentProviderObservationCapabilitiesAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/agent-provider-observation-capabilities.ts')
      ),
      agentProviderObservationCapabilitiesSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:agent:provider-observation-capabilities']
      ),
      agentProviderObservationCapabilitiesSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:provider-observation-capabilities'
      ),
      agentProviderObservationCapabilitiesNoFakeThinkingBoundary: fileIncludes(
        agentRoot,
        'src/shared/agent-provider-observation-capabilities.ts',
        'doesNotFabricateThinking: true'
      ),
      providerNativeToolsContractAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/provider-native-tools.ts')
      ),
      providerNativeToolsSmokeAvailable: Boolean(packageJson.scripts?.['smoke:provider-native:tools']),
      providerNativeToolsSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:provider-native:tools'
      ),
      providerNativeToolsAdapterTypesAvailable: fileIncludes(
        agentRoot,
        'src/main/services/provider-adapters/types.ts',
        'ProviderNativeToolRequest'
      ),
      providerNativeToolsNoFunctionToolBoundary: fileIncludes(
        agentRoot,
        'src/shared/provider-native-tools.ts',
        'doesNotConvertToFunctionTool: true'
      ),
      searxngDesignKnowledgeConnectorAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/searxng-design-knowledge.ts')
      ),
      searxngDesignKnowledgeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:design-knowledge:searxng']),
      searxngDesignKnowledgeSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:design-knowledge:searxng'
      ),
      searxngDesignKnowledgeServiceWired: fileIncludes(
        agentRoot,
        'src/main/services/design-knowledge-search-service.ts',
        'probeSearxngHealth'
      ),
      searxngDesignKnowledgeNoDockerBoundary: fileIncludes(
        agentRoot,
        'src/shared/searxng-design-knowledge.ts',
        'doesNotManageDocker: true'
      ),
      designKnowledgeSettingsEntryAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/design-knowledge-settings.ts')
      )
        && fileIncludes(agentRoot, 'src/renderer/components/SettingsModal.tsx', "'knowledge'")
        && fileIncludes(agentRoot, 'src/main/ipc-handlers/design-knowledge-handlers.ts', 'designKnowledge:probeSearxngHealth'),
      designKnowledgeSettingsEntrySmokeAvailable: Boolean(packageJson.scripts?.['smoke:design-knowledge:settings-entry']),
      designKnowledgeSettingsEntrySmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:design-knowledge:settings-entry'
      ),
      designKnowledgeRuntimeCapabilityAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/design-knowledge-runtime-capability.ts')
      )
        && fileIncludes(agentRoot, 'src/renderer/components/SettingsModal.tsx', 'buildDesignKnowledgeRuntimeCapabilitySummary'),
      designKnowledgeRuntimeCapabilitySmokeAvailable: Boolean(packageJson.scripts?.['smoke:design-knowledge:runtime-capability']),
      designKnowledgeRuntimeCapabilitySmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:design-knowledge:runtime-capability'
      ),
      xiaomiWebSearchRuntimeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:design-knowledge:xiaomi-web-search-runtime']),
      xiaomiWebSearchRuntimeSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:design-knowledge:xiaomi-web-search-runtime'
      ),
      xiaomiWebSearchRuntimeWiringAvailable: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/autonomous-agent.executor.ts',
        'withDesignKnowledgeNativeTools'
      )
        && fileIncludes(agentRoot, 'src/main/services/model-service.ts', 'nativeTools: options?.nativeTools')
        && fileIncludes(agentRoot, 'src/main/services/provider-adapters/openai-adapter.ts', 'normalizeProviderNativeToolCitations'),
      agentExecutionLifecycleHelperAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/agent-execution-lifecycle.ts')
      ),
      agentExecutionLifecycleSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:execution-lifecycle']),
      agentExecutionLifecycleSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:execution-lifecycle'
      ),
      agentExecutionLifecycleAcceptanceSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:agent:execution-lifecycle-acceptance']
      ),
      agentExecutionLifecycleAcceptanceSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:agent:execution-lifecycle-acceptance'
      ),
      agentExecutionLifecycleAcceptanceReportAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-contracts.ts',
        'agentExecutionLifecycleSnapshot'
      ),
      agentExecutionLifecycleAcceptanceExportAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-export.ts',
        'executionLifecycleBoundaryOk'
      ),
      agentExecutionLifecycleNoFakeThinkingBoundary: fileIncludes(
        agentRoot,
        'src/shared/agent-execution-lifecycle.ts',
        'canClaimModelReasoning: false'
      ),
      livePhotoshopAcceptanceEvidenceIntakeHelperAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/live-photoshop-acceptance-intake.ts')
      ),
      livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:live-photoshop:acceptance-evidence-intake']
      ),
      livePhotoshopAcceptanceEvidenceIntakeSmokeInPreflight: scriptIncludes(
        packageJson,
        'maintenance:preflight',
        'smoke:live-photoshop:acceptance-evidence-intake'
      ),
      livePhotoshopAcceptanceEvidenceIntakeNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/live-photoshop-acceptance-intake.ts',
        'canClaimDesignQuality: false'
      ),
      livePhotoshopAcceptanceEvidenceIntakeNoRunBoundary: fileIncludes(
        agentRoot,
        'src/shared/live-photoshop-acceptance-intake.ts',
        'mustNotRunLivePhotoshop: true'
      ),
      agentAcceptanceTriageHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-acceptance-triage.ts')),
      agentAcceptanceTriageSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-triage']),
      agentAcceptanceTriageWiredToDebugExport: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-export.ts',
        'acceptanceTriage'
      ),
      agentAcceptanceTriageReportHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-acceptance-triage-report.ts')),
      agentAcceptanceTriageReportCommandAvailable: Boolean(packageJson.scripts?.['maintenance:acceptance-triage-report']),
      agentAcceptanceTriageReportSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-triage-report']),
      agentAcceptanceTriageReportWiredToDesktopReport: fileIncludes(
        agentRoot,
        'scripts/acceptance-run-agent-desktop-case.cjs',
        'formatAgentAcceptanceTriageCasesMarkdown'
      ),
      agentAcceptanceControlPlaneHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-acceptance-control-plane.ts')),
      agentAcceptanceControlPlaneSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-control-plane']),
      agentAcceptanceControlPlaneModesCovered: [
        'offline-static',
        'desktop-fake-photoshop',
        'real-provider-fake-photoshop',
        'live-photoshop-preflight',
        'live-photoshop-disposable',
        'live-provider-live-photoshop'
      ].every((modeId) => fileIncludes(agentRoot, 'src/shared/agent-acceptance-control-plane.ts', modeId)),
      agentAcceptanceControlPlaneLiveGuarded: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-control-plane.ts',
        'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT=1'
      ),
      agentAcceptanceVerificationMatrixHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-acceptance-verification-matrix.ts')),
      agentAcceptanceVerificationMatrixSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-verification-matrix']),
      agentAcceptanceVerificationMatrixCommandAvailable: Boolean(packageJson.scripts?.['maintenance:acceptance-verification-matrix']),
      agentAcceptanceVerificationMatrixNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-verification-matrix.ts',
        'qualityClaimAllowed: false'
      ),
      agentAcceptanceExecutionSuiteHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-acceptance-execution-suite.ts')),
      agentAcceptanceExecutionSuiteSmokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:acceptance-execution-suite']),
      agentAcceptanceExecutionSuiteCommandAvailable: Boolean(packageJson.scripts?.['maintenance:acceptance-suite']),
      agentAcceptanceExecutionSuiteRunSafeCommandAvailable: Boolean(packageJson.scripts?.['maintenance:acceptance-suite:run-safe']),
      agentAcceptanceExecutionSuiteDefaultSafeOnly: fileIncludes(
        agentRoot,
        'src/shared/agent-acceptance-execution-suite.ts',
        'offline-static and desktop-fake-photoshop modes'
      ),
      chatPanelExportsDiagnosticRecord: fileIncludes(
        agentRoot,
        'src/renderer/components/ChatPanel.tsx',
        'agentDiagnosticRecord'
      ),
      businessSkillDesignGovernanceDocAvailable: fs.existsSync(path.join(agentRoot, 'docs/business-skill-design-governance.md')),
      businessSkillDesignGovernanceSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:design-governance']),
      businessSkillImplementationCheckpointHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-implementation-checkpoint.ts')),
      businessSkillImplementationCheckpointSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:implementation-checkpoint']),
      businessSkillImplementationCheckpointRequiresUserCheckpoint: fileIncludes(
        agentRoot,
        'src/shared/business-skill-implementation-checkpoint.ts',
        'user_checkpoint_required'
      ),
      businessSkillImplementationCheckpointMentionsThreeSkills: [
        'main-image-design',
        'detail-page-design',
        'sku-batch'
      ].every((skillId) => fileIncludes(agentRoot, 'src/shared/business-skill-implementation-checkpoint.ts', skillId)),
      businessSkillReadinessContractHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-readiness-contract.ts')),
      businessSkillReadinessContractSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:readiness-contract']),
      businessSkillReadinessContractUsesImplementationCheckpoint: fileIncludes(
        agentRoot,
        'src/shared/business-skill-readiness-contract.ts',
        'buildBusinessSkillImplementationCheckpoint'
      ),
      businessSkillReadinessContractRequiresStrategyInputs: [
        'designStandards',
        'knowledgeRecipeSource',
        'assetUnderstanding',
        'imagePlacementPlan',
        'photoshopToolPlan',
        'qaAcceptancePlan',
        'performanceBudget'
      ].every((inputKey) => fileIncludes(agentRoot, 'src/shared/business-skill-readiness-contract.ts', inputKey)),
      businessSkillReadinessContractNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/business-skill-readiness-contract.ts',
        'canClaimDesignQuality: false'
      ),
      businessSkillExecutionPreflightGateHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-execution-preflight-gate.ts')),
      businessSkillExecutionPreflightGateSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:execution-preflight-gate']),
      businessSkillExecutionPreflightGateUsesImplementationCheckpoint: fileIncludes(
        agentRoot,
        'src/shared/business-skill-execution-preflight-gate.ts',
        'buildBusinessSkillImplementationCheckpoint'
      ),
      businessSkillExecutionPreflightGateUsesAcceptanceControlPlane: fileIncludes(
        agentRoot,
        'src/shared/business-skill-execution-preflight-gate.ts',
        'buildAgentAcceptanceControlPlane'
      ),
      businessSkillExecutionPreflightGateMentionsThreeSkills: [
        'main-image-design',
        'detail-page-design',
        'sku-batch'
      ].every((skillId) => fileIncludes(agentRoot, 'src/shared/business-skill-execution-preflight-gate.ts', skillId)),
      businessSkillExecutionPreflightGateNoExecutorChange: fileIncludes(
        agentRoot,
        'src/shared/business-skill-execution-preflight-gate.ts',
        'does_not_change_business_skill_executor_behavior'
      ),
      businessSkillExecutionPreflightWiringSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:execution-preflight-wiring']),
      businessSkillExecutionPreflightEntrypointWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'attachBusinessSkillExecutionPreflightGateToResult'
      ),
      businessSkillExecutionPreflightControlContextOnly: fileIncludes(
        agentRoot,
        'src/shared/business-skill-preflight-planner-context.ts',
        'controlContextOnly: true'
      ),
      businessSkillPreflightPlannerContextHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-preflight-planner-context.ts')),
      businessSkillPreflightPlannerContextSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:preflight-planner-context']),
      businessSkillPreflightPlannerContextWired: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/business-skill-visual-context.ts',
        'businessSkillPreflightPlannerContext'
      ),
      businessSkillPreflightPlannerContextNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/business-skill-preflight-planner-context.ts',
        'canClaimDesignQuality: false'
      ),
      businessSkillVisualObservationRefreshPlanHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-visual-observation-refresh-plan.ts')),
      businessSkillVisualObservationRefreshPlanSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-refresh-plan']),
      businessSkillVisualObservationRefreshPlanWired: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/business-skill-visual-context.ts',
        'businessSkillVisualObservationRefreshPlan'
      ),
      businessSkillVisualObservationRefreshPlanDefaultDisabled: fileIncludes(
        agentRoot,
        'src/shared/business-skill-visual-observation-refresh-plan.ts',
        'Visual observation refresh must be explicitly enabled'
      ),
      businessSkillVisualObservationRefreshRunnerSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-refresh-runner']),
      businessSkillVisualObservationRefreshRunnerWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'await runBusinessSkillVisualObservationRefreshAfterExecution'
      ),
      businessSkillVisualObservationRefreshRunnerPostExecutor: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/business-skill-visual-context.ts',
        '该 runner 只在业务 executor 完成后运行'
      ),
      businessSkillVisualObservationRefreshRuntimeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-refresh-runtime']),
      businessSkillVisualObservationRefreshRuntimeAutoDetects: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/business-skill-visual-context.ts',
        'detectBusinessSkillVisualObservationRefreshRuntime'
      ),
      businessSkillVisualContextPreparationHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-visual-context-preparation.ts')),
      businessSkillVisualContextPreparationSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-pre-execution-gate']),
      businessSkillVisualContextPreparationWired: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/business-skill-visual-context.ts',
        'buildBusinessSkillVisualContextPreparation'
      ),
      businessSkillVisualContextPreparationRunnerWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'runBusinessSkillVisualObservationRefreshBeforeExecution'
      ),
      businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-refresh-executor-wiring']),
      businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint: fileIncludes(
        agentRoot,
        'scripts/smoke-business-skill-visual-evidence-refresh-executor-wiring.cjs',
        "executeSkillWithExecutor('sku-batch'"
      ),
      businessSkillExecutionIntakeHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/business-skill-execution-intake.ts')),
      businessSkillExecutionIntakeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:execution-intake']),
      businessSkillExecutionIntakeWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'buildBusinessSkillExecutionIntakeForSkill'
      ),
      businessSkillExecutionIntakeNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/business-skill-execution-intake.ts',
        'canClaimDesignQuality: false'
      ),
      projectAssetUnderstandingIntakeHelperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/project-asset-understanding-intake.ts')),
      projectAssetUnderstandingIntakeSmokeAvailable: Boolean(packageJson.scripts?.['smoke:project-asset-understanding:intake']),
      projectAssetUnderstandingIntakeWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'attachBusinessSkillProjectAssetUnderstandingIntakeToResult'
      ),
      projectAssetUnderstandingIntakeNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/project-asset-understanding-intake.ts',
        'canClaimDesignQuality: false'
      ),
      businessSkillImagePlacementVerificationIntakeHelperAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/business-skill-image-placement-verification-intake.ts')
      ),
      businessSkillImagePlacementVerificationIntakeSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:business-skill:image-placement-verification-intake']
      ),
      businessSkillImagePlacementVerificationIntakeWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'attachBusinessSkillImagePlacementVerificationIntakeToResult'
      ),
      businessSkillImagePlacementVerificationIntakeNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/business-skill-image-placement-verification-intake.ts',
        'canClaimDesignQuality: false'
      ),
      businessSkillExecutionPlanIntakeHelperAvailable: fs.existsSync(
        path.join(agentRoot, 'src/shared/business-skill-execution-plan-intake.ts')
      ),
      businessSkillExecutionPlanIntakeSmokeAvailable: Boolean(
        packageJson.scripts?.['smoke:business-skill:execution-plan-intake']
      ),
      businessSkillExecutionPlanIntakeWired: unifiedSkillExecutorEntrypointIncludes(
        agentRoot,
        'attachBusinessSkillExecutionPlanIntakeToResult'
      ),
      businessSkillExecutionPlanIntakeNoQualityClaim: fileIncludes(
        agentRoot,
        'src/shared/business-skill-execution-plan-intake.ts',
        'canClaimDesignQuality: false'
      ),
      businessSkillVisualObservationDiagnosticSmokeAvailable: Boolean(packageJson.scripts?.['smoke:business-skill:visual-evidence-diagnostic']),
      businessSkillDesignGovernanceRequiresUserCheckpoint: fileIncludes(
        agentRoot,
        'docs/business-skill-design-governance.md',
        'Do not change these three skills without the user checkpoint'
      ),
      businessSkillDesignGovernanceMentionsThreeSkills: [
        'main-image-design',
        'detail-page-design',
        'sku-batch'
      ].every((skillId) => fileIncludes(agentRoot, 'docs/business-skill-design-governance.md', skillId)),
      contextSnapshotCarriesVisualInsightCache: fileIncludes(
        agentRoot,
        'src/shared/project-asset-index.ts',
        'visualInsightCache?: ProjectVisualInsightCacheReadResult'
      ),
      runtimeReadsVisualInsightCache: fileIncludes(
        agentRoot,
        'src/main/services/project-context-snapshot-service.ts',
        'readVisualInsightCache'
      ),
      runtimeWritesVisualInsightCache: fileIncludes(
        agentRoot,
        'src/main/services/project-context-snapshot-service.ts',
        'writeVisualInsightCache'
      ),
      rendererContextCarriesVisualInsightCache: fileIncludes(
        agentRoot,
        'src/renderer/services/agent-orchestration/context.ts',
        'visualInsightCache: snapshot?.visualInsightCache'
      ),
      plannerConsumesVisualInsightCache: fileIncludes(
        agentRoot,
        'src/shared/design-planner.ts',
        'visualInsightCache?: ProjectVisualInsightCacheReadResult'
      ),
      ipcWriteVisualInsightCacheAvailable: fileIncludes(
        agentRoot,
        'src/main/ipc-handlers/ecommerce-project-handlers.ts',
        'ecommerce:writeVisualInsightCache'
      ),
      preloadWriteVisualInsightCacheAvailable: fileIncludes(
        agentRoot,
        'src/main/preload.ts',
        'writeProjectVisualInsightCache'
      ),
      policy: 'context-evidence-cache-not-design-quality-claim'
    },
    imagePlacementCore: {
      helperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/design-image-placement-core.ts')),
      docAvailable: fs.existsSync(path.join(agentRoot, 'docs/image-placement-core-mvp.md')),
      readinessReportAvailable: fs.existsSync(path.join(agentRoot, 'scripts/report-image-placement-core-readiness.cjs')),
      smokeAvailable: Boolean(packageJson.scripts?.['smoke:image-placement:core']),
      readinessSmokeAvailable: Boolean(packageJson.scripts?.['smoke:image-placement:readiness']),
      smokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:image-placement:core'),
      readinessSmokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:image-placement:readiness'),
      wrapsSmartScalingPolicy: fileIncludes(
        agentRoot,
        'src/shared/design-image-placement-core.ts',
        'computeSmartScalingDecision'
      ),
      requiresActualBoundsReadback: fileIncludes(
        agentRoot,
        'src/shared/design-image-placement-core.ts',
        'planned destinationBox 不能当成 actualBounds'
      ),
      screenshotFailureOverridesBounds: fileIncludes(
        agentRoot,
        'scripts/smoke-image-placement-core.cjs',
        'failed screenshot review must fail'
      ),
      businessSkillsNotDirectlyWired: [
        'src/renderer/services/skill-executors/main-image.executor.ts',
        'src/renderer/services/skill-executors/detail-page.executor.ts',
        'src/renderer/services/skill-executors/sku-batch.executor.ts'
      ].every((relativePath) => !fileIncludes(agentRoot, relativePath, 'design-image-placement-core')),
      policy: 'shared-placement-contract-not-business-skill-output'
    },
    agentPerformancePolicy: {
      helperAvailable: fs.existsSync(path.join(agentRoot, 'src/shared/agent-performance-policy.ts')),
      smokeAvailable: Boolean(packageJson.scripts?.['smoke:agent:performance-policy']),
      smokeInPreflight: scriptIncludes(packageJson, 'maintenance:preflight', 'smoke:agent:performance-policy'),
      plannerBuildsPolicy: fileIncludes(
        agentRoot,
        'src/shared/design-planner.ts',
        'buildAgentPerformancePolicyFromIntent'
      ),
      selectedContextCarriesPolicy: fileIncludes(
        agentRoot,
        'src/shared/design-planner.ts',
        'performancePolicy: performancePolicy'
      ),
      runtimeBudgetHelperAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'buildAutonomousAgentRuntimeBudget'
      ),
      autonomousAgentUsesRuntimeBudget: fileIncludes(
        agentRoot,
        'src/renderer/services/skill-executors/autonomous-agent.executor.ts',
        'buildAutonomousAgentRuntimeBudget'
      ),
      designTeamRuntimeBudgetHelperAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'buildDesignTeamRuntimeBudget'
      ),
      designTeamRegistryUsesRuntimeBudget: fileIncludes(
        agentRoot,
        'src/renderer/services/design-teams/registry.ts',
        'buildDesignTeamRuntimeBudget'
      ),
      designTeamCoordinatorUsesRuntimeBudget: fileIncludes(
        agentRoot,
        'src/renderer/services/design-teams/coordinator.ts',
        'buildDesignTeamRuntimeBudget'
      ),
      smokeCoversDesignTeamBudget: fileIncludes(
        agentRoot,
        'scripts/smoke-agent-performance-policy.cjs',
        'design-team role runtime budgets are centralized'
      ),
      contextWindowBudgetHelperAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'buildAgentContextWindowBudget'
      ),
      contextManagerUsesWindowBudget: fileIncludes(
        agentRoot,
        'src/renderer/services/agent-runtime/context-manager.ts',
        'buildAgentContextWindowBudget'
      ),
      agentRuntimeUsesContextDefault: !fileIncludes(
        agentRoot,
        'src/renderer/services/agent-runtime/agent.ts',
        'maxTokens: 100000'
      ),
      smokeCoversContextWindowBudget: fileIncludes(
        agentRoot,
        'scripts/smoke-agent-performance-policy.cjs',
        'context window budgets are centralized'
      ),
      resourceCacheBudgetHelperAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'buildAgentResourceCacheBudget'
      ),
      resourceManagerUsesCacheBudget: fileIncludes(
        agentRoot,
        'src/main/services/resource-manager-service.ts',
        'buildAgentResourceCacheBudget'
      ),
      smokeCoversResourceCacheBudget: fileIncludes(
        agentRoot,
        'scripts/smoke-agent-performance-policy.cjs',
        'resource cache budgets are centralized'
      ),
      providerTokenBudgetHelperAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'buildAgentProviderTokenBudget'
      ),
      providerAdaptersUseTokenBudget: fileIncludes(
        agentRoot,
        'src/main/services/provider-adapters/openai-adapter.ts',
        'buildAgentProviderTokenBudget'
      ) && fileIncludes(
        agentRoot,
        'src/main/services/provider-adapters/anthropic-adapter.ts',
        'buildAgentProviderTokenBudget'
      ) && fileIncludes(
        agentRoot,
        'src/main/services/provider-adapters/gemini-adapter.ts',
        'buildAgentProviderTokenBudget'
      ) && fileIncludes(
        agentRoot,
        'src/main/services/provider-adapters/ollama-adapter.ts',
        'buildAgentProviderTokenBudget'
      ),
      modelServiceUsesTokenBudget: fileIncludes(
        agentRoot,
        'src/main/services/model-service.ts',
        'buildAgentProviderTokenBudget'
      ) && !fileIncludes(
        agentRoot,
        'src/main/services/model-service.ts',
        'options?.maxTokens || 4096'
      ),
      streamAdapterUsesTokenBudget: fileIncludes(
        agentRoot,
        'src/main/services/stream-adapter.ts',
        'buildAgentProviderTokenBudget'
      ) && !fileIncludes(
        agentRoot,
        'src/main/services/stream-adapter.ts',
        'options?.maxTokens || 4096'
      ),
      smokeCoversProviderTokenBudget: fileIncludes(
        agentRoot,
        'scripts/smoke-agent-performance-policy.cjs',
        'provider adapter max token defaults are centralized'
      ),
      acceptanceCaptureBudgetHelperAvailable: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'buildAgentAcceptanceCaptureBudget'
      ),
      toolAcceptanceUsesCaptureBudget: fileIncludes(
        agentRoot,
        'src/shared/acceptance/tool-acceptance.ts',
        'buildAgentAcceptanceCaptureBudget'
      ),
      smokeCoversAcceptanceBudget: fileIncludes(
        agentRoot,
        'scripts/smoke-agent-performance-policy.cjs',
        'acceptance capture budgets are centralized'
      ),
      visualSamplingBudgetHelperAvailable: fileIncludes(
        agentRoot,
        'src/shared/project-visual-sampling.ts',
        'buildProjectVisualSamplingBudget'
      ),
      projectVisualSamplingUsesBudget: fileIncludes(
        agentRoot,
        'src/shared/project-visual-sampling.ts',
        'buildProjectVisualSamplingBudget'
      ),
      smokeCoversVisualSamplingBudget: fileIncludes(
        agentRoot,
        'scripts/smoke-agent-performance-policy.cjs',
        'visual sampling candidate budgets are centralized'
      ),
      policyForbidsBulkScan: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'allowBulkProjectScan: false'
      ),
      policyForbidsFullResolutionRead: fileIncludes(
        agentRoot,
        'src/shared/agent-performance-policy.ts',
        'allowFullResolutionImageRead: false'
      ),
      policy: 'read-only-budget-evidence-not-runtime-enforcement'
    },
    capabilityMap: capabilityMap.ok ? {
      available: true,
      role: capabilityMap.value?.role || null,
      success: Boolean(capabilityMap.value?.success),
      layerCount: capabilityMap.value?.layerCount ?? null,
      missingScripts: capabilityMap.value?.missingScripts || [],
      missingBoundaryPhrases: capabilityMap.value?.boundaryPhrases?.missing || [],
      crossChecks: capabilityMap.value?.crossChecks || {}
    } : {
      available: false,
      error: capabilityMap.error
    },
    activeBoundaries: take(boundaryGroups, limit),
    unverified: take(projectState.unverified, limit),
    topRisks: take(projectState.topRisks, limit),
    nextActions: take(projectState.nextActions, limit),
    commands: {
      dailyResume: packageJson.scripts['maintenance:project-cockpit']
        ? 'npm run maintenance:project-cockpit'
        : 'node scripts/report-project-cockpit.cjs',
      quickValidation: packageJson.scripts['maintenance:validate:agent-fast']
        ? 'npm run maintenance:validate:agent-fast'
        : 'npm run maintenance:validate',
      fullValidation: 'npm run maintenance:validate',
      localPreflight: 'npm run maintenance:preflight',
      boundaryCheck: 'npm run maintenance:change-boundaries:check',
      boundarySummary: 'npm run maintenance:change-boundaries',
      agentArchitecture: packageJson.scripts['maintenance:agent-architecture']
        ? 'npm run maintenance:agent-architecture'
        : 'node scripts/report-agent-architecture.cjs',
      capabilityMap: packageJson.scripts['maintenance:capability-map']
        ? 'npm run maintenance:capability-map'
        : 'node scripts/report-agent-capability-map.cjs',
      referenceReadiness: packageJson.scripts['maintenance:reference-readiness']
        ? 'npm run maintenance:reference-readiness'
        : 'node scripts/report-reference-replication-readiness.cjs',
      referenceLiveCapture: packageJson.scripts['benchmark:reference-replication:capture-live']
        ? 'npm run benchmark:reference-replication:capture-live'
        : 'node scripts/smoke-chat-ui-reference-replication-live.cjs --id rr-002-neutral-quality-card-text-layout --capture-result',
      referenceResultEvidence: packageJson.scripts['benchmark:reference-replication:evaluate-result']
        ? 'npm run benchmark:reference-replication:evaluate-result -- --result-screenshot <path>'
        : 'node scripts/evaluate-reference-replication-result.cjs --id rr-002-neutral-quality-card-text-layout --result-screenshot <path>',
      referenceEvidencePipeline: packageJson.scripts['maintenance:reference-evidence-pipeline']
        ? 'npm run maintenance:reference-evidence-pipeline'
        : 'node scripts/report-reference-evidence-pipeline.cjs',
      referenceRealCaseIntake: packageJson.scripts['maintenance:reference-real-case-intake']
        ? 'npm run maintenance:reference-real-case-intake -- --id <case-id> --name <name> --category <category> --reference-image <path>'
        : 'node scripts/plan-reference-real-case-intake.cjs --id <case-id> --name <name> --category <category> --reference-image <path>',
      referenceQualityGate: packageJson.scripts['maintenance:reference-quality-gate']
        ? 'npm run maintenance:reference-quality-gate'
        : 'node scripts/check-reference-quality-claim-gate.cjs',
      referenceStatus: packageJson.scripts['maintenance:reference-status']
        ? 'npm run maintenance:reference-status'
        : 'node scripts/report-reference-replication-status.cjs'
    }
  };
}

function formatList(items, formatter) {
  if (!items.length) return ['- none'];
  return items.map((item) => `- ${formatter(item)}`);
}

function formatCockpit(cockpit) {
  const lines = [];
  lines.push('DesignEcho project cockpit');
  lines.push(`repoRoot: ${cockpit.repoRoot}`);
  lines.push(`currentFocus: ${cockpit.current.focus}`);
  lines.push(`currentMilestone: ${cockpit.current.milestone} (${cockpit.current.milestoneStatus})`);
  lines.push('');
  lines.push('evidenceCounts:');
  lines.push(`- verified.code: ${cockpit.evidenceCounts.verifiedCode}`);
  lines.push(`- verified.build: ${cockpit.evidenceCounts.verifiedBuild}`);
  lines.push(`- verified.manual: ${cockpit.evidenceCounts.verifiedManual}`);
  lines.push(`- unverified: ${cockpit.evidenceCounts.unverified}`);
  lines.push(`- topRisks: ${cockpit.evidenceCounts.topRisks}`);
  lines.push(`- nextActions: ${cockpit.evidenceCounts.nextActions}`);
  lines.push('');
  lines.push('worktree:');
  lines.push(`- pendingChangeCount: ${cockpit.worktree.pendingChangeCount ?? 'unknown'}`);
  lines.push(`- reviewableChangeCount: ${cockpit.worktree.reviewableChangeCount ?? 'unknown'}`);
  lines.push(`- indexCleanup: ${cockpit.worktree.indexCleanup ?? 'unknown'}`);
  lines.push(`- residualCleanup: ${cockpit.worktree.residualCleanup ?? 'unknown'}`);
  lines.push('');
  lines.push('referenceReplication.overlayQa:');
  lines.push(`- liveSmokePassed: ${cockpit.referenceReplication.overlayQa.liveSmokePassed}`);
  lines.push(`- contractAvailable: ${cockpit.referenceReplication.overlayQa.contractAvailable}`);
  lines.push(`- visualQaInPreflight: ${cockpit.referenceReplication.overlayQa.visualQaInPreflight}`);
  lines.push(`- overlayContractInPreflight: ${cockpit.referenceReplication.overlayQa.overlayContractInPreflight}`);
  lines.push(`- liveSmokeInPreflight: ${cockpit.referenceReplication.overlayQa.liveSmokeInPreflight}`);
  lines.push(`- liveSmokePolicy: ${cockpit.referenceReplication.overlayQa.liveSmokePolicy}`);
  lines.push('');
  lines.push('referenceReplication.completionReport:');
  lines.push(`- userReadableReportAvailable: ${cockpit.referenceReplication.completionReport.userReadableReportAvailable}`);
  lines.push(`- architectureGateCoversReport: ${cockpit.referenceReplication.completionReport.architectureGateCoversReport}`);
  lines.push(`- smokeCoversWatchBoundary: ${cockpit.referenceReplication.completionReport.smokeCoversWatchBoundary}`);
  lines.push(`- reportPolicy: ${cockpit.referenceReplication.completionReport.reportPolicy}`);
  lines.push('');
  lines.push('referenceReplication.textBoundsSemantics:');
  lines.push(`- envelopeRuleInQa: ${cockpit.referenceReplication.textBoundsSemantics.envelopeRuleInQa}`);
  lines.push(`- visualQaSmokeCoversEnvelope: ${cockpit.referenceReplication.textBoundsSemantics.visualQaSmokeCoversEnvelope}`);
  lines.push(`- neutralPixelBoundsSmokeAvailable: ${cockpit.referenceReplication.textBoundsSemantics.neutralPixelBoundsSmokeAvailable}`);
  lines.push(`- neutralPixelBoundsInPreflight: ${cockpit.referenceReplication.textBoundsSemantics.neutralPixelBoundsInPreflight}`);
  lines.push(`- neutralUiSmokeCoversReviewBoundary: ${cockpit.referenceReplication.textBoundsSemantics.neutralUiSmokeCoversReviewBoundary}`);
  lines.push(`- neutralUiSmokeInPreflight: ${cockpit.referenceReplication.textBoundsSemantics.neutralUiSmokeInPreflight}`);
  lines.push(`- policy: ${cockpit.referenceReplication.textBoundsSemantics.policy}`);
  lines.push('');
  lines.push('referenceReplication.benchmarks:');
  lines.push(`- caseCount: ${cockpit.referenceReplication.benchmarks.caseCount}`);
  lines.push(`- manifestAvailable: ${cockpit.referenceReplication.benchmarks.manifestAvailable}`);
  lines.push(`- hasSimpleTextLayoutFixtureCase: ${cockpit.referenceReplication.benchmarks.hasSimpleTextLayoutFixtureCase}`);
  lines.push(`- fixturePolicy: ${cockpit.referenceReplication.benchmarks.fixturePolicy}`);
  lines.push(`- validatorAvailable: ${cockpit.referenceReplication.benchmarks.validatorAvailable}`);
  lines.push(`- validatorInPreflight: ${cockpit.referenceReplication.benchmarks.validatorInPreflight}`);
  lines.push(`- coveragePolicy: ${cockpit.referenceReplication.benchmarks.coveragePolicy}`);
  lines.push(`- categories: ${cockpit.referenceReplication.benchmarks.categories.length > 0 ? cockpit.referenceReplication.benchmarks.categories.join(', ') : 'none'}`);
  lines.push(`- missingRepresentativeCategories: ${cockpit.referenceReplication.benchmarks.missingRepresentativeCategories.length > 0 ? cockpit.referenceReplication.benchmarks.missingRepresentativeCategories.join(', ') : 'none'}`);
  if (cockpit.referenceReplication.benchmarks.unlistedCaseFiles.length > 0) {
    lines.push(`- unlistedCaseFiles: ${cockpit.referenceReplication.benchmarks.unlistedCaseFiles.join(', ')}`);
  }
  if (cockpit.referenceReplication.benchmarks.caseFiles.length > 0) {
    lines.push(`- caseFiles: ${cockpit.referenceReplication.benchmarks.caseFiles.join(', ')}`);
  }
  lines.push('');
  lines.push('referenceReplication.liveCapture:');
  lines.push(`- captureCommandAvailable: ${cockpit.referenceReplication.liveCapture.captureCommandAvailable}`);
  lines.push(`- resultEvidenceCommandAvailable: ${cockpit.referenceReplication.liveCapture.resultEvidenceCommandAvailable}`);
  lines.push(`- evidenceValidatorAvailable: ${cockpit.referenceReplication.liveCapture.evidenceValidatorAvailable}`);
  lines.push(`- pipelineReportAvailable: ${cockpit.referenceReplication.liveCapture.pipelineReportAvailable}`);
  lines.push(`- readinessReportAvailable: ${cockpit.referenceReplication.liveCapture.readinessReportAvailable}`);
  lines.push(`- guardSmokeAvailable: ${cockpit.referenceReplication.liveCapture.guardSmokeAvailable}`);
  lines.push(`- readinessSmokeAvailable: ${cockpit.referenceReplication.liveCapture.readinessSmokeAvailable}`);
  lines.push(`- resultEvidenceSmokeAvailable: ${cockpit.referenceReplication.liveCapture.resultEvidenceSmokeAvailable}`);
  lines.push(`- evidenceValidatorSmokeAvailable: ${cockpit.referenceReplication.liveCapture.evidenceValidatorSmokeAvailable}`);
  lines.push(`- pipelineSmokeAvailable: ${cockpit.referenceReplication.liveCapture.pipelineSmokeAvailable}`);
  lines.push(`- guardSmokeInPreflight: ${cockpit.referenceReplication.liveCapture.guardSmokeInPreflight}`);
  lines.push(`- readinessSmokeInPreflight: ${cockpit.referenceReplication.liveCapture.readinessSmokeInPreflight}`);
  lines.push(`- resultEvidenceSmokeInPreflight: ${cockpit.referenceReplication.liveCapture.resultEvidenceSmokeInPreflight}`);
  lines.push(`- evidenceValidatorSmokeInPreflight: ${cockpit.referenceReplication.liveCapture.evidenceValidatorSmokeInPreflight}`);
  lines.push(`- pipelineSmokeInPreflight: ${cockpit.referenceReplication.liveCapture.pipelineSmokeInPreflight}`);
  lines.push(`- defaultCaseId: ${cockpit.referenceReplication.liveCapture.defaultCaseId}`);
  lines.push(`- policy: ${cockpit.referenceReplication.liveCapture.policy}`);
  lines.push(`- liveFlagsRequired: ${cockpit.referenceReplication.liveCapture.liveFlagsRequired.join(', ')}`);
  lines.push('');
  lines.push('referenceReplication.realCaseIntake:');
  lines.push(`- plannerAvailable: ${cockpit.referenceReplication.realCaseIntake.plannerAvailable}`);
  lines.push(`- smokeAvailable: ${cockpit.referenceReplication.realCaseIntake.smokeAvailable}`);
  lines.push(`- smokeInPreflight: ${cockpit.referenceReplication.realCaseIntake.smokeInPreflight}`);
  lines.push(`- evidenceChainInPlanner: ${cockpit.referenceReplication.realCaseIntake.evidenceChainInPlanner}`);
  lines.push(`- expectedScreenshotInPlanner: ${cockpit.referenceReplication.realCaseIntake.expectedScreenshotInPlanner}`);
  lines.push(`- validateEvidenceCommandInPlanner: ${cockpit.referenceReplication.realCaseIntake.validateEvidenceCommandInPlanner}`);
  lines.push(`- manualRecordCommandInPlanner: ${cockpit.referenceReplication.realCaseIntake.manualRecordCommandInPlanner}`);
  lines.push(`- qualityGateCommandInPlanner: ${cockpit.referenceReplication.realCaseIntake.qualityGateCommandInPlanner}`);
  lines.push(`- policy: ${cockpit.referenceReplication.realCaseIntake.policy}`);
  lines.push('');
  lines.push('referenceReplication.evidencePipeline:');
  lines.push(`- available: ${cockpit.referenceReplication.evidencePipeline.available}`);
  lines.push(`- qualityClaimCandidates: ${cockpit.referenceReplication.evidencePipeline.qualityClaimCandidates ?? 'unknown'}`);
  lines.push(`- sourceEligibleForQualityClaimCases: ${cockpit.referenceReplication.evidencePipeline.sourceEligibleForQualityClaimCases ?? 'unknown'}`);
  const pipelineStages = cockpit.referenceReplication.evidencePipeline.stageCounts || {};
  lines.push(`- stageCounts: ${Object.keys(pipelineStages).length > 0 ? Object.entries(pipelineStages).map(([key, value]) => `${key}=${value}`).join(', ') : 'none'}`);
  lines.push(`- reportOnly: ${cockpit.referenceReplication.evidencePipeline.reportOnly}`);
  lines.push(`- doesNotRunPhotoshop: ${cockpit.referenceReplication.evidencePipeline.doesNotRunPhotoshop}`);
  lines.push(`- doesNotMutateCases: ${cockpit.referenceReplication.evidencePipeline.doesNotMutateCases}`);
  lines.push('');
  lines.push('referenceReplication.qualityGateConsistency:');
  lines.push(`- smokeAvailable: ${cockpit.referenceReplication.qualityGateConsistency.smokeAvailable}`);
  lines.push(`- smokeInPreflight: ${cockpit.referenceReplication.qualityGateConsistency.smokeInPreflight}`);
  lines.push(`- checksReadiness: ${cockpit.referenceReplication.qualityGateConsistency.checksReadiness}`);
  lines.push(`- checksPipeline: ${cockpit.referenceReplication.qualityGateConsistency.checksPipeline}`);
  lines.push(`- checksStatus: ${cockpit.referenceReplication.qualityGateConsistency.checksStatus}`);
  lines.push(`- checksCockpit: ${cockpit.referenceReplication.qualityGateConsistency.checksCockpit}`);
  lines.push(`- checksArchitecture: ${cockpit.referenceReplication.qualityGateConsistency.checksArchitecture}`);
  lines.push(`- policy: ${cockpit.referenceReplication.qualityGateConsistency.policy}`);
  lines.push('');
  lines.push('referenceReplication.readiness:');
  lines.push(`- available: ${cockpit.referenceReplication.readiness.available}`);
  lines.push(`- suiteReadyForQualityClaim: ${cockpit.referenceReplication.readiness.suiteReadyForQualityClaim}`);
  const readinessCounts = cockpit.referenceReplication.readiness.readinessCounts || {};
  const sourceCounts = cockpit.referenceReplication.readiness.sourceCounts || {};
  lines.push(`- readinessCounts: ${Object.keys(readinessCounts).length > 0 ? Object.entries(readinessCounts).map(([key, value]) => `${key}=${value}`).join(', ') : 'none'}`);
  lines.push(`- sourceCounts: ${Object.keys(sourceCounts).length > 0 ? Object.entries(sourceCounts).map(([key, value]) => `${key}=${value}`).join(', ') : 'none'}`);
  const readinessSummary = cockpit.referenceReplication.readiness.counts || {};
  lines.push(`- resultScreenshots: ${readinessSummary.withResultScreenshot ?? 'unknown'}/${readinessSummary.total ?? 'unknown'}`);
  lines.push(`- manualVerified: ${readinessSummary.manualVerified ?? 'unknown'}/${readinessSummary.total ?? 'unknown'}`);
  lines.push(`- designQualityEligible: ${readinessSummary.designQualityEligible ?? 'unknown'}/${readinessSummary.total ?? 'unknown'}`);
  lines.push('');
  lines.push('photoshopBridgeHealth:');
  lines.push(`- scriptAvailable: ${cockpit.photoshopBridgeHealth.scriptAvailable}`);
  lines.push(`- smokeAvailable: ${cockpit.photoshopBridgeHealth.smokeAvailable}`);
  lines.push(`- maintenanceCommandAvailable: ${cockpit.photoshopBridgeHealth.maintenanceCommandAvailable}`);
  lines.push(`- selfTestInPreflight: ${cockpit.photoshopBridgeHealth.selfTestInPreflight}`);
  lines.push(`- readOnlyBoundary: ${cockpit.photoshopBridgeHealth.readOnlyBoundary}`);
  lines.push(`- noDocumentCreationBoundary: ${cockpit.photoshopBridgeHealth.noDocumentCreationBoundary}`);
  lines.push(`- noDesignQualityClaimBoundary: ${cockpit.photoshopBridgeHealth.noDesignQualityClaimBoundary}`);
  lines.push(`- classifiesBridgeTimeout: ${cockpit.photoshopBridgeHealth.classifiesBridgeTimeout}`);
  lines.push('');
  lines.push('mainImageAgentDraft:');
  lines.push(`- helperAvailable: ${cockpit.mainImageAgentDraft.helperAvailable}`);
  lines.push(`- assetSelectionHelperAvailable: ${cockpit.mainImageAgentDraft.assetSelectionHelperAvailable}`);
  lines.push(`- visualLoopHelperAvailable: ${cockpit.mainImageAgentDraft.visualLoopHelperAvailable}`);
  lines.push(`- visionPreflightHelperAvailable: ${cockpit.mainImageAgentDraft.visionPreflightHelperAvailable}`);
  lines.push(`- executionAlignmentHelperAvailable: ${cockpit.mainImageAgentDraft.executionAlignmentHelperAvailable}`);
  lines.push(`- screenshotQaHelperAvailable: ${cockpit.mainImageAgentDraft.screenshotQaHelperAvailable}`);
  lines.push(`- screenshotProbeReadinessHelperAvailable: ${cockpit.mainImageAgentDraft.screenshotProbeReadinessHelperAvailable}`);
  lines.push(`- qaReportHelperAvailable: ${cockpit.mainImageAgentDraft.qaReportHelperAvailable}`);
  lines.push(`- strategyContractHelperAvailable: ${cockpit.mainImageAgentDraft.strategyContractHelperAvailable}`);
  lines.push(`- strategyInputBuilderHelperAvailable: ${cockpit.mainImageAgentDraft.strategyInputBuilderHelperAvailable}`);
  lines.push(`- assetHeroStrategyHelperAvailable: ${cockpit.mainImageAgentDraft.assetHeroStrategyHelperAvailable}`);
  lines.push(`- projectStyleStrategyHelperAvailable: ${cockpit.mainImageAgentDraft.projectStyleStrategyHelperAvailable}`);
  lines.push(`- designStandardsHelperAvailable: ${cockpit.mainImageAgentDraft.designStandardsHelperAvailable}`);
  lines.push(`- designReadinessReportHelperAvailable: ${cockpit.mainImageAgentDraft.designReadinessReportHelperAvailable}`);
  lines.push(`- liveExecutorRequestHelperAvailable: ${cockpit.mainImageAgentDraft.liveExecutorRequestHelperAvailable}`);
  lines.push(`- liveExecutorCheckpointHelperAvailable: ${cockpit.mainImageAgentDraft.liveExecutorCheckpointHelperAvailable}`);
  lines.push(`- liveExecutorRunnerHelperAvailable: ${cockpit.mainImageAgentDraft.liveExecutorRunnerHelperAvailable}`);
  lines.push(`- livePhotoshopAdapterContractHelperAvailable: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractHelperAvailable}`);
  lines.push(`- liveAdapterHandoffHelperAvailable: ${cockpit.mainImageAgentDraft.liveAdapterHandoffHelperAvailable}`);
  lines.push(`- livePhotoshopToolAdapterHelperAvailable: ${cockpit.mainImageAgentDraft.livePhotoshopToolAdapterHelperAvailable}`);
  lines.push(`- photoshopToolCapabilityMatrixHelperAvailable: ${cockpit.mainImageAgentDraft.photoshopToolCapabilityMatrixHelperAvailable}`);
  lines.push(`- groupHierarchyContractHelperAvailable: ${cockpit.mainImageAgentDraft.groupHierarchyContractHelperAvailable}`);
  lines.push(`- variantPlacementStrategyHelperAvailable: ${cockpit.mainImageAgentDraft.variantPlacementStrategyHelperAvailable}`);
  lines.push(`- productionStructureHelperAvailable: ${cockpit.mainImageAgentDraft.productionStructureHelperAvailable}`);
  lines.push(`- productionExecutionPlanHelperAvailable: ${cockpit.mainImageAgentDraft.productionExecutionPlanHelperAvailable}`);
  lines.push(`- productionExecutorHandoffHelperAvailable: ${cockpit.mainImageAgentDraft.productionExecutorHandoffHelperAvailable}`);
  lines.push(`- productionExecutorBridgeHelperAvailable: ${cockpit.mainImageAgentDraft.productionExecutorBridgeHelperAvailable}`);
  lines.push(`- productionExecutorDryRunHelperAvailable: ${cockpit.mainImageAgentDraft.productionExecutorDryRunHelperAvailable}`);
  lines.push(`- smokeAvailable: ${cockpit.mainImageAgentDraft.smokeAvailable}`);
  lines.push(`- strategyContractSmokeAvailable: ${cockpit.mainImageAgentDraft.strategyContractSmokeAvailable}`);
  lines.push(`- strategyInputBuilderSmokeAvailable: ${cockpit.mainImageAgentDraft.strategyInputBuilderSmokeAvailable}`);
  lines.push(`- assetHeroStrategySmokeAvailable: ${cockpit.mainImageAgentDraft.assetHeroStrategySmokeAvailable}`);
  lines.push(`- projectStyleStrategySmokeAvailable: ${cockpit.mainImageAgentDraft.projectStyleStrategySmokeAvailable}`);
  lines.push(`- designStandardsSmokeAvailable: ${cockpit.mainImageAgentDraft.designStandardsSmokeAvailable}`);
  lines.push(`- designReadinessReportSmokeAvailable: ${cockpit.mainImageAgentDraft.designReadinessReportSmokeAvailable}`);
  lines.push(`- liveExecutorRequestSmokeAvailable: ${cockpit.mainImageAgentDraft.liveExecutorRequestSmokeAvailable}`);
  lines.push(`- liveExecutorCheckpointSmokeAvailable: ${cockpit.mainImageAgentDraft.liveExecutorCheckpointSmokeAvailable}`);
  lines.push(`- liveExecutorRunnerSmokeAvailable: ${cockpit.mainImageAgentDraft.liveExecutorRunnerSmokeAvailable}`);
  lines.push(`- livePhotoshopAdapterContractSmokeAvailable: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractSmokeAvailable}`);
  lines.push(`- liveAdapterHandoffSmokeAvailable: ${cockpit.mainImageAgentDraft.liveAdapterHandoffSmokeAvailable}`);
  lines.push(`- livePhotoshopToolAdapterSmokeAvailable: ${cockpit.mainImageAgentDraft.livePhotoshopToolAdapterSmokeAvailable}`);
  lines.push(`- liveToolAdapterDisposableSmokeAvailable: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableSmokeAvailable}`);
  lines.push(`- liveToolAdapterDisposableClassificationSmokeAvailable: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableClassificationSmokeAvailable}`);
  lines.push(`- photoshopToolCapabilityMatrixSmokeAvailable: ${cockpit.mainImageAgentDraft.photoshopToolCapabilityMatrixSmokeAvailable}`);
  lines.push(`- groupHierarchyContractSmokeAvailable: ${cockpit.mainImageAgentDraft.groupHierarchyContractSmokeAvailable}`);
  lines.push(`- variantPlacementStrategySmokeAvailable: ${cockpit.mainImageAgentDraft.variantPlacementStrategySmokeAvailable}`);
  lines.push(`- productionStructureSmokeAvailable: ${cockpit.mainImageAgentDraft.productionStructureSmokeAvailable}`);
  lines.push(`- productionExecutionPlanSmokeAvailable: ${cockpit.mainImageAgentDraft.productionExecutionPlanSmokeAvailable}`);
  lines.push(`- productionExecutorHandoffSmokeAvailable: ${cockpit.mainImageAgentDraft.productionExecutorHandoffSmokeAvailable}`);
  lines.push(`- productionExecutorBridgeSmokeAvailable: ${cockpit.mainImageAgentDraft.productionExecutorBridgeSmokeAvailable}`);
  lines.push(`- productionExecutorDryRunSmokeAvailable: ${cockpit.mainImageAgentDraft.productionExecutorDryRunSmokeAvailable}`);
  lines.push(`- assetSelectionSmokeAvailable: ${cockpit.mainImageAgentDraft.assetSelectionSmokeAvailable}`);
  lines.push(`- visualLoopSmokeAvailable: ${cockpit.mainImageAgentDraft.visualLoopSmokeAvailable}`);
  lines.push(`- visionPreflightSmokeAvailable: ${cockpit.mainImageAgentDraft.visionPreflightSmokeAvailable}`);
  lines.push(`- candidatePreflightSmokeAvailable: ${cockpit.mainImageAgentDraft.candidatePreflightSmokeAvailable}`);
  lines.push(`- executionAlignmentSmokeAvailable: ${cockpit.mainImageAgentDraft.executionAlignmentSmokeAvailable}`);
  lines.push(`- screenshotQaSmokeAvailable: ${cockpit.mainImageAgentDraft.screenshotQaSmokeAvailable}`);
  lines.push(`- screenshotProbeReadinessSmokeAvailable: ${cockpit.mainImageAgentDraft.screenshotProbeReadinessSmokeAvailable}`);
  lines.push(`- pixelProbeAdapterSmokeAvailable: ${cockpit.mainImageAgentDraft.pixelProbeAdapterSmokeAvailable}`);
  lines.push(`- qaReportSmokeAvailable: ${cockpit.mainImageAgentDraft.qaReportSmokeAvailable}`);
  lines.push(`- smokeInPreflight: ${cockpit.mainImageAgentDraft.smokeInPreflight}`);
  lines.push(`- strategyContractSmokeInPreflight: ${cockpit.mainImageAgentDraft.strategyContractSmokeInPreflight}`);
  lines.push(`- strategyInputBuilderSmokeInPreflight: ${cockpit.mainImageAgentDraft.strategyInputBuilderSmokeInPreflight}`);
  lines.push(`- assetHeroStrategySmokeInPreflight: ${cockpit.mainImageAgentDraft.assetHeroStrategySmokeInPreflight}`);
  lines.push(`- projectStyleStrategySmokeInPreflight: ${cockpit.mainImageAgentDraft.projectStyleStrategySmokeInPreflight}`);
  lines.push(`- designStandardsSmokeInPreflight: ${cockpit.mainImageAgentDraft.designStandardsSmokeInPreflight}`);
  lines.push(`- designReadinessReportSmokeInPreflight: ${cockpit.mainImageAgentDraft.designReadinessReportSmokeInPreflight}`);
  lines.push(`- liveExecutorRequestSmokeInPreflight: ${cockpit.mainImageAgentDraft.liveExecutorRequestSmokeInPreflight}`);
  lines.push(`- liveExecutorCheckpointSmokeInPreflight: ${cockpit.mainImageAgentDraft.liveExecutorCheckpointSmokeInPreflight}`);
  lines.push(`- liveExecutorRunnerSmokeInPreflight: ${cockpit.mainImageAgentDraft.liveExecutorRunnerSmokeInPreflight}`);
  lines.push(`- livePhotoshopAdapterContractSmokeInPreflight: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractSmokeInPreflight}`);
  lines.push(`- liveAdapterHandoffSmokeInPreflight: ${cockpit.mainImageAgentDraft.liveAdapterHandoffSmokeInPreflight}`);
  lines.push(`- livePhotoshopToolAdapterSmokeInPreflight: ${cockpit.mainImageAgentDraft.livePhotoshopToolAdapterSmokeInPreflight}`);
  lines.push(`- liveToolAdapterDisposableSmokeInPreflight: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableSmokeInPreflight}`);
  lines.push(`- liveToolAdapterDisposableClassificationSmokeInPreflight: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableClassificationSmokeInPreflight}`);
  lines.push(`- photoshopToolCapabilityMatrixSmokeInPreflight: ${cockpit.mainImageAgentDraft.photoshopToolCapabilityMatrixSmokeInPreflight}`);
  lines.push(`- groupHierarchyContractSmokeInPreflight: ${cockpit.mainImageAgentDraft.groupHierarchyContractSmokeInPreflight}`);
  lines.push(`- variantPlacementStrategySmokeInPreflight: ${cockpit.mainImageAgentDraft.variantPlacementStrategySmokeInPreflight}`);
  lines.push(`- productionStructureSmokeInPreflight: ${cockpit.mainImageAgentDraft.productionStructureSmokeInPreflight}`);
  lines.push(`- productionExecutionPlanSmokeInPreflight: ${cockpit.mainImageAgentDraft.productionExecutionPlanSmokeInPreflight}`);
  lines.push(`- productionExecutorHandoffSmokeInPreflight: ${cockpit.mainImageAgentDraft.productionExecutorHandoffSmokeInPreflight}`);
  lines.push(`- productionExecutorBridgeSmokeInPreflight: ${cockpit.mainImageAgentDraft.productionExecutorBridgeSmokeInPreflight}`);
  lines.push(`- productionExecutorDryRunSmokeInPreflight: ${cockpit.mainImageAgentDraft.productionExecutorDryRunSmokeInPreflight}`);
  lines.push(`- assetSelectionSmokeInPreflight: ${cockpit.mainImageAgentDraft.assetSelectionSmokeInPreflight}`);
  lines.push(`- visualLoopSmokeInPreflight: ${cockpit.mainImageAgentDraft.visualLoopSmokeInPreflight}`);
  lines.push(`- visionPreflightSmokeInPreflight: ${cockpit.mainImageAgentDraft.visionPreflightSmokeInPreflight}`);
  lines.push(`- candidatePreflightSmokeInPreflight: ${cockpit.mainImageAgentDraft.candidatePreflightSmokeInPreflight}`);
  lines.push(`- executionAlignmentSmokeInPreflight: ${cockpit.mainImageAgentDraft.executionAlignmentSmokeInPreflight}`);
  lines.push(`- screenshotQaSmokeInPreflight: ${cockpit.mainImageAgentDraft.screenshotQaSmokeInPreflight}`);
  lines.push(`- screenshotProbeReadinessSmokeInPreflight: ${cockpit.mainImageAgentDraft.screenshotProbeReadinessSmokeInPreflight}`);
  lines.push(`- pixelProbeAdapterSmokeInPreflight: ${cockpit.mainImageAgentDraft.pixelProbeAdapterSmokeInPreflight}`);
  lines.push(`- qaReportSmokeInPreflight: ${cockpit.mainImageAgentDraft.qaReportSmokeInPreflight}`);
  lines.push(`- plannerEvidenceAttached: ${cockpit.mainImageAgentDraft.plannerEvidenceAttached}`);
  lines.push(`- plannerPassesStrategyContract: ${cockpit.mainImageAgentDraft.plannerPassesStrategyContract}`);
  lines.push(`- strategyContractNoExecution: ${cockpit.mainImageAgentDraft.strategyContractNoExecution}`);
  lines.push(`- strategyInputBuilderNoExecution: ${cockpit.mainImageAgentDraft.strategyInputBuilderNoExecution}`);
  lines.push(`- assetHeroStrategyNoExecution: ${cockpit.mainImageAgentDraft.assetHeroStrategyNoExecution}`);
  lines.push(`- projectStyleStrategyNoExecution: ${cockpit.mainImageAgentDraft.projectStyleStrategyNoExecution}`);
  lines.push(`- designStandardsNoExecution: ${cockpit.mainImageAgentDraft.designStandardsNoExecution}`);
  lines.push(`- designReadinessReportNoExecution: ${cockpit.mainImageAgentDraft.designReadinessReportNoExecution}`);
  lines.push(`- liveExecutorRequestNoExecution: ${cockpit.mainImageAgentDraft.liveExecutorRequestNoExecution}`);
  lines.push(`- liveExecutorCheckpointNoExecution: ${cockpit.mainImageAgentDraft.liveExecutorCheckpointNoExecution}`);
  lines.push(`- liveExecutorRunnerRequiresAdapter: ${cockpit.mainImageAgentDraft.liveExecutorRunnerRequiresAdapter}`);
  lines.push(`- liveExecutorRunnerBlocksNonDisposable: ${cockpit.mainImageAgentDraft.liveExecutorRunnerBlocksNonDisposable}`);
  lines.push(`- liveExecutorRunnerNoQualityClaim: ${cockpit.mainImageAgentDraft.liveExecutorRunnerNoQualityClaim}`);
  lines.push(`- livePhotoshopAdapterContractNoWrite: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractNoWrite}`);
  lines.push(`- livePhotoshopAdapterContractMapsExportGroup: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractMapsExportGroup}`);
  lines.push(`- livePhotoshopAdapterContractMapsDestinationBoxMoveLayer: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractMapsDestinationBoxMoveLayer}`);
  lines.push(`- livePhotoshopAdapterContractMapsNestedGroups: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractMapsNestedGroups}`);
  lines.push(`- livePhotoshopAdapterContractNoQualityClaim: ${cockpit.mainImageAgentDraft.livePhotoshopAdapterContractNoQualityClaim}`);
  lines.push(`- liveAdapterHandoffNoWrite: ${cockpit.mainImageAgentDraft.liveAdapterHandoffNoWrite}`);
  lines.push(`- liveAdapterHandoffNoQualityClaim: ${cockpit.mainImageAgentDraft.liveAdapterHandoffNoQualityClaim}`);
  lines.push(`- liveAdapterHandoffBlocksProduction: ${cockpit.mainImageAgentDraft.liveAdapterHandoffBlocksProduction}`);
  lines.push(`- livePhotoshopToolAdapterRequiresApproval: ${cockpit.mainImageAgentDraft.livePhotoshopToolAdapterRequiresApproval}`);
  lines.push(`- livePhotoshopToolAdapterBlocksNonDisposable: ${cockpit.mainImageAgentDraft.livePhotoshopToolAdapterBlocksNonDisposable}`);
  lines.push(`- livePhotoshopToolAdapterNoProduction: ${cockpit.mainImageAgentDraft.livePhotoshopToolAdapterNoProduction}`);
  lines.push(`- livePhotoshopToolAdapterNoQualityClaim: ${cockpit.mainImageAgentDraft.livePhotoshopToolAdapterNoQualityClaim}`);
  lines.push(`- liveToolAdapterDisposableDefaultSkipped: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableDefaultSkipped}`);
  lines.push(`- liveToolAdapterDisposableRequiresLiveFlag: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableRequiresLiveFlag}`);
  lines.push(`- liveToolAdapterDisposableRequiresDisposableFlag: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableRequiresDisposableFlag}`);
  lines.push(`- liveToolAdapterDisposablePreprocessesPlaceImageFilePath: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposablePreprocessesPlaceImageFilePath}`);
  lines.push(`- liveToolAdapterDisposableHasMcpTimeoutBoundary: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableHasMcpTimeoutBoundary}`);
  lines.push(`- liveToolAdapterDisposableHasCleanupTimeoutBoundary: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableHasCleanupTimeoutBoundary}`);
  lines.push(`- liveToolAdapterDisposableHasHealthStatus: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableHasHealthStatus}`);
  lines.push(`- liveToolAdapterDisposableHasRecoveryActions: ${cockpit.mainImageAgentDraft.liveToolAdapterDisposableHasRecoveryActions}`);
  lines.push(`- photoshopToolCapabilityMatrixNoWrite: ${cockpit.mainImageAgentDraft.photoshopToolCapabilityMatrixNoWrite}`);
  lines.push(`- photoshopToolCapabilityMatrixSupportsNestedGroup: ${cockpit.mainImageAgentDraft.photoshopToolCapabilityMatrixSupportsNestedGroup}`);
  lines.push(`- photoshopToolCapabilityMatrixUsesMoveLayerToGroup: ${cockpit.mainImageAgentDraft.photoshopToolCapabilityMatrixUsesMoveLayerToGroup}`);
  lines.push(`- photoshopToolCapabilityMatrixUsesExportGroup: ${cockpit.mainImageAgentDraft.photoshopToolCapabilityMatrixUsesExportGroup}`);
  lines.push(`- uxpMoveLayerToGroupToolAvailable: ${cockpit.mainImageAgentDraft.uxpMoveLayerToGroupToolAvailable}`);
  lines.push(`- uxpMoveLayerToGroupRegistered: ${cockpit.mainImageAgentDraft.uxpMoveLayerToGroupRegistered}`);
  lines.push(`- uxpExportGroupToolAvailable: ${cockpit.mainImageAgentDraft.uxpExportGroupToolAvailable}`);
  lines.push(`- uxpExportGroupRegistered: ${cockpit.mainImageAgentDraft.uxpExportGroupRegistered}`);
  lines.push(`- groupHierarchyContractNoWrite: ${cockpit.mainImageAgentDraft.groupHierarchyContractNoWrite}`);
  lines.push(`- groupHierarchyContractCoversMissingParentSemantics: ${cockpit.mainImageAgentDraft.groupHierarchyContractCoversMissingParentSemantics}`);
  lines.push(`- groupHierarchyContractCoversMissingMoveToGroup: ${cockpit.mainImageAgentDraft.groupHierarchyContractCoversMissingMoveToGroup}`);
  lines.push(`- groupHierarchyContractCoversMissingGroupExport: ${cockpit.mainImageAgentDraft.groupHierarchyContractCoversMissingGroupExport}`);
  lines.push(`- variantPlacementStrategyNoExecution: ${cockpit.mainImageAgentDraft.variantPlacementStrategyNoExecution}`);
  lines.push(`- productionStructureNoExecution: ${cockpit.mainImageAgentDraft.productionStructureNoExecution}`);
  lines.push(`- productionExecutionPlanNoExecution: ${cockpit.mainImageAgentDraft.productionExecutionPlanNoExecution}`);
  lines.push(`- productionExecutorHandoffNoExecution: ${cockpit.mainImageAgentDraft.productionExecutorHandoffNoExecution}`);
  lines.push(`- productionExecutorBridgeNoExecution: ${cockpit.mainImageAgentDraft.productionExecutorBridgeNoExecution}`);
  lines.push(`- productionExecutorDryRunNoExecution: ${cockpit.mainImageAgentDraft.productionExecutorDryRunNoExecution}`);
  lines.push(`- strategyInputBuilderUsesAssetHeroStrategy: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesAssetHeroStrategy}`);
  lines.push(`- strategyInputBuilderUsesProjectStyleStrategy: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesProjectStyleStrategy}`);
  lines.push(`- strategyInputBuilderUsesDesignStandards: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesDesignStandards}`);
  lines.push(`- strategyInputBuilderUsesDesignReadinessReport: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesDesignReadinessReport}`);
  lines.push(`- strategyInputBuilderUsesVariantPlacementStrategy: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesVariantPlacementStrategy}`);
  lines.push(`- strategyInputBuilderUsesProductionStructure: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesProductionStructure}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutionPlan: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutionPlan}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutorHandoff: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutorHandoff}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutorBridge: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutorBridge}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutorDryRun: ${cockpit.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutorDryRun}`);
  lines.push(`- draftExposesStrategyContract: ${cockpit.mainImageAgentDraft.draftExposesStrategyContract}`);
  lines.push(`- draftExposesStrategyInputEvidence: ${cockpit.mainImageAgentDraft.draftExposesStrategyInputEvidence}`);
  lines.push(`- draftUsesStrategyInputBuilder: ${cockpit.mainImageAgentDraft.draftUsesStrategyInputBuilder}`);
  lines.push(`- draftPlanUsesAssetSelection: ${cockpit.mainImageAgentDraft.draftPlanUsesAssetSelection}`);
  lines.push(`- draftPlanUsesVisualLoop: ${cockpit.mainImageAgentDraft.draftPlanUsesVisualLoop}`);
  lines.push(`- executorCanRunVisionPreflight: ${cockpit.mainImageAgentDraft.executorCanRunVisionPreflight}`);
  lines.push(`- executorExposesCandidatePreflight: ${cockpit.mainImageAgentDraft.executorExposesCandidatePreflight}`);
  lines.push(`- executorExposesExecutionAlignment: ${cockpit.mainImageAgentDraft.executorExposesExecutionAlignment}`);
  lines.push(`- executorExposesScreenshotQa: ${cockpit.mainImageAgentDraft.executorExposesScreenshotQa}`);
  lines.push(`- executorExposesScreenshotProbeReadiness: ${cockpit.mainImageAgentDraft.executorExposesScreenshotProbeReadiness}`);
  lines.push(`- executorRunsPixelProbeAdapter: ${cockpit.mainImageAgentDraft.executorRunsPixelProbeAdapter}`);
  lines.push(`- executorExposesQaReport: ${cockpit.mainImageAgentDraft.executorExposesQaReport}`);
  lines.push(`- resourceProbeImageFileAvailable: ${cockpit.mainImageAgentDraft.resourceProbeImageFileAvailable}`);
  lines.push(`- resourceCompareImageFilesAvailable: ${cockpit.mainImageAgentDraft.resourceCompareImageFilesAvailable}`);
  lines.push(`- plannerAcceptsVisionSignal: ${cockpit.mainImageAgentDraft.plannerAcceptsVisionSignal}`);
  lines.push(`- executorExposesDraft: ${cockpit.mainImageAgentDraft.executorExposesDraft}`);
  lines.push(`- executorExposesAssetSelection: ${cockpit.mainImageAgentDraft.executorExposesAssetSelection}`);
  lines.push(`- executorExposesVisualLoop: ${cockpit.mainImageAgentDraft.executorExposesVisualLoop}`);
  lines.push(`- noOverclaimSmoke: ${cockpit.mainImageAgentDraft.noOverclaimSmoke}`);
  lines.push(`- qaReportNoOverclaimSmoke: ${cockpit.mainImageAgentDraft.qaReportNoOverclaimSmoke}`);
  lines.push(`- policy: ${cockpit.mainImageAgentDraft.policy}`);
  lines.push('');
  lines.push('projectAssetIndex:');
  lines.push(`- helperAvailable: ${cockpit.projectAssetIndex.helperAvailable}`);
  lines.push(`- visualSamplingHelperAvailable: ${cockpit.projectAssetIndex.visualSamplingHelperAvailable}`);
  lines.push(`- visualInsightCacheHelperAvailable: ${cockpit.projectAssetIndex.visualInsightCacheHelperAvailable}`);
  lines.push(`- visualInsightCacheFillHelperAvailable: ${cockpit.projectAssetIndex.visualInsightCacheFillHelperAvailable}`);
  lines.push(`- visualInsightCacheFillRendererAvailable: ${cockpit.projectAssetIndex.visualInsightCacheFillRendererAvailable}`);
  lines.push(`- businessVisualContextHelperAvailable: ${cockpit.projectAssetIndex.businessVisualContextHelperAvailable}`);
  lines.push(`- businessVisualObservationFeedbackHelperAvailable: ${cockpit.projectAssetIndex.businessVisualObservationFeedbackHelperAvailable}`);
  lines.push(`- businessVisualContextRendererAvailable: ${cockpit.projectAssetIndex.businessVisualContextRendererAvailable}`);
  lines.push(`- businessVisualObservationFeedbackRendererAvailable: ${cockpit.projectAssetIndex.businessVisualObservationFeedbackRendererAvailable}`);
  lines.push(`- businessVisualObservationFeedbackUiAvailable: ${cockpit.projectAssetIndex.businessVisualObservationFeedbackUiAvailable}`);
  lines.push(`- businessVisualContextEntrypointWired: ${cockpit.projectAssetIndex.businessVisualContextEntrypointWired}`);
  lines.push(`- projectAssetIndexSmokeAvailable: ${cockpit.projectAssetIndex.projectAssetIndexSmokeAvailable}`);
  lines.push(`- visualSamplingSmokeAvailable: ${cockpit.projectAssetIndex.visualSamplingSmokeAvailable}`);
  lines.push(`- visualInsightCacheSmokeAvailable: ${cockpit.projectAssetIndex.visualInsightCacheSmokeAvailable}`);
  lines.push(`- visualInsightCacheFillSmokeAvailable: ${cockpit.projectAssetIndex.visualInsightCacheFillSmokeAvailable}`);
  lines.push(`- businessVisualContextSmokeAvailable: ${cockpit.projectAssetIndex.businessVisualContextSmokeAvailable}`);
  lines.push(`- businessVisualObservationFeedbackSmokeAvailable: ${cockpit.projectAssetIndex.businessVisualObservationFeedbackSmokeAvailable}`);
  lines.push(`- businessVisualObservationFeedbackDesktopSmokeAvailable: ${cockpit.projectAssetIndex.businessVisualObservationFeedbackDesktopSmokeAvailable}`);
  lines.push(`- detailPageSkillReadinessHelperAvailable: ${cockpit.projectAssetIndex.detailPageSkillReadinessHelperAvailable}`);
  lines.push(`- detailPageSkillReadinessSmokeAvailable: ${cockpit.projectAssetIndex.detailPageSkillReadinessSmokeAvailable}`);
  lines.push(`- detailPageSkillReadinessExecutorWired: ${cockpit.projectAssetIndex.detailPageSkillReadinessExecutorWired}`);
  lines.push(`- detailPageSkillReadinessWiringSmokeAvailable: ${cockpit.projectAssetIndex.detailPageSkillReadinessWiringSmokeAvailable}`);
  lines.push(`- agentDiagnosticRecordHelperAvailable: ${cockpit.projectAssetIndex.agentDiagnosticRecordHelperAvailable}`);
  lines.push(`- agentDiagnosticRecordSmokeAvailable: ${cockpit.projectAssetIndex.agentDiagnosticRecordSmokeAvailable}`);
  lines.push(`- agentAcceptanceDebugCarriesDiagnosticRecord: ${cockpit.projectAssetIndex.agentAcceptanceDebugCarriesDiagnosticRecord}`);
  lines.push(`- agentAcceptanceControlPlaneHelperAvailable: ${cockpit.projectAssetIndex.agentAcceptanceControlPlaneHelperAvailable}`);
  lines.push(`- agentAcceptanceControlPlaneSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceControlPlaneSmokeAvailable}`);
  lines.push(`- agentAcceptanceControlPlaneModesCovered: ${cockpit.projectAssetIndex.agentAcceptanceControlPlaneModesCovered}`);
  lines.push(`- agentAcceptanceControlPlaneLiveGuarded: ${cockpit.projectAssetIndex.agentAcceptanceControlPlaneLiveGuarded}`);
  lines.push(`- agentAcceptanceVerificationMatrixHelperAvailable: ${cockpit.projectAssetIndex.agentAcceptanceVerificationMatrixHelperAvailable}`);
  lines.push(`- agentAcceptanceVerificationMatrixSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceVerificationMatrixSmokeAvailable}`);
  lines.push(`- agentAcceptanceVerificationMatrixCommandAvailable: ${cockpit.projectAssetIndex.agentAcceptanceVerificationMatrixCommandAvailable}`);
  lines.push(`- agentAcceptanceVerificationMatrixNoQualityClaim: ${cockpit.projectAssetIndex.agentAcceptanceVerificationMatrixNoQualityClaim}`);
  lines.push(`- agentAcceptanceExecutionSuiteHelperAvailable: ${cockpit.projectAssetIndex.agentAcceptanceExecutionSuiteHelperAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceExecutionSuiteSmokeAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteCommandAvailable: ${cockpit.projectAssetIndex.agentAcceptanceExecutionSuiteCommandAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteRunSafeCommandAvailable: ${cockpit.projectAssetIndex.agentAcceptanceExecutionSuiteRunSafeCommandAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteDefaultSafeOnly: ${cockpit.projectAssetIndex.agentAcceptanceExecutionSuiteDefaultSafeOnly}`);
  lines.push(`- agentAcceptanceDiagnosticExportHelperAvailable: ${cockpit.projectAssetIndex.agentAcceptanceDiagnosticExportHelperAvailable}`);
  lines.push(`- agentAcceptanceDiagnosticExportSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceDiagnosticExportSmokeAvailable}`);
  lines.push(`- agentAcceptanceDiagnosticExportWiredToChatBridge: ${cockpit.projectAssetIndex.agentAcceptanceDiagnosticExportWiredToChatBridge}`);
  lines.push(`- agentAcceptanceBusinessSkillVerificationSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceBusinessSkillVerificationSmokeAvailable}`);
  lines.push(`- agentAcceptanceBusinessSkillVerificationReportAvailable: ${cockpit.projectAssetIndex.agentAcceptanceBusinessSkillVerificationReportAvailable}`);
  lines.push(`- agentAcceptanceBusinessSkillVerificationExportAvailable: ${cockpit.projectAssetIndex.agentAcceptanceBusinessSkillVerificationExportAvailable}`);
  lines.push(`- agentIntentDecisionIntakeHelperAvailable: ${cockpit.projectAssetIndex.agentIntentDecisionIntakeHelperAvailable}`);
  lines.push(`- agentIntentDecisionIntakeSmokeAvailable: ${cockpit.projectAssetIndex.agentIntentDecisionIntakeSmokeAvailable}`);
  lines.push(`- agentIntentDecisionIntakeSmokeInPreflight: ${cockpit.projectAssetIndex.agentIntentDecisionIntakeSmokeInPreflight}`);
  lines.push(`- agentIntentDecisionIntakeReportAvailable: ${cockpit.projectAssetIndex.agentIntentDecisionIntakeReportAvailable}`);
  lines.push(`- agentIntentDecisionIntakeExportAvailable: ${cockpit.projectAssetIndex.agentIntentDecisionIntakeExportAvailable}`);
  lines.push(`- agentIntentDecisionIntakeNoExecutionBoundary: ${cockpit.projectAssetIndex.agentIntentDecisionIntakeNoExecutionBoundary}`);
  lines.push(`- agentVisibleActivitySmokeAvailable: ${cockpit.projectAssetIndex.agentVisibleActivitySmokeAvailable}`);
  lines.push(`- agentVisibleActivitySmokeInPreflight: ${cockpit.projectAssetIndex.agentVisibleActivitySmokeInPreflight}`);
  lines.push(`- agentWorkerIdentitySmokeAvailable: ${cockpit.projectAssetIndex.agentWorkerIdentitySmokeAvailable}`);
  lines.push(`- agentWorkerIdentitySmokeInPreflight: ${cockpit.projectAssetIndex.agentWorkerIdentitySmokeInPreflight}`);
  lines.push(`- agentVisibleActivityHelperAvailable: ${cockpit.projectAssetIndex.agentVisibleActivityHelperAvailable}`);
  lines.push(`- agentWorkerIdentityTeammateBoundary: ${cockpit.projectAssetIndex.agentWorkerIdentityTeammateBoundary}`);
  lines.push(`- agentAcceptanceRuntimeModeContractAvailable: ${cockpit.projectAssetIndex.agentAcceptanceRuntimeModeContractAvailable}`);
  lines.push(`- agentAcceptanceRuntimeModeSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceRuntimeModeSmokeAvailable}`);
  lines.push(`- agentAcceptanceRuntimeModeSmokeInPreflight: ${cockpit.projectAssetIndex.agentAcceptanceRuntimeModeSmokeInPreflight}`);
  lines.push(`- agentAcceptanceRuntimeModeProductionBoundary: ${cockpit.projectAssetIndex.agentAcceptanceRuntimeModeProductionBoundary}`);
  lines.push(`- agentAcceptanceRuntimeModeDeveloperBoundary: ${cockpit.projectAssetIndex.agentAcceptanceRuntimeModeDeveloperBoundary}`);
  lines.push(`- ecommerceSocksDesignEntrySmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksDesignEntrySmokeAvailable}`);
  lines.push(`- ecommerceSocksDesignEntrySmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksDesignEntrySmokeInPreflight}`);
  lines.push(`- ecommerceSocksStrategyCheckpointSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksStrategyCheckpointSmokeAvailable}`);
  lines.push(`- ecommerceSocksStrategyCheckpointSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksStrategyCheckpointSmokeInPreflight}`);
  lines.push(`- ecommerceSocksStrategyCheckpointNoQualityClaim: ${cockpit.projectAssetIndex.ecommerceSocksStrategyCheckpointNoQualityClaim}`);
  lines.push(`- ecommerceSocksChildStrategyPacketsSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksChildStrategyPacketsSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildStrategyPacketsSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksChildStrategyPacketsSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildStrategyPacketsNoImplementation: ${cockpit.projectAssetIndex.ecommerceSocksChildStrategyPacketsNoImplementation}`);
  lines.push(`- ecommerceSocksChildStrategyReviewGateSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksChildStrategyReviewGateSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildStrategyReviewGateSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksChildStrategyReviewGateSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildStrategyReviewGateNoExecution: ${cockpit.projectAssetIndex.ecommerceSocksChildStrategyReviewGateNoExecution}`);
  lines.push(`- ecommerceSocksDispatchCheckpointSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksDispatchCheckpointSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchCheckpointSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksDispatchCheckpointSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDispatchLifecycleSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksDispatchLifecycleSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchLifecycleSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksDispatchLifecycleSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDispatchOrchestrationSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksDispatchOrchestrationSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchOrchestrationSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksDispatchOrchestrationSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDispatchAuthorizationSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksDispatchAuthorizationSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchAuthorizationSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksDispatchAuthorizationSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildDispatchRunnerSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksChildDispatchRunnerSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildDispatchRunnerSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksChildDispatchRunnerSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildReportAggregationSmokeAvailable: ${cockpit.projectAssetIndex.ecommerceSocksChildReportAggregationSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildReportAggregationSmokeInPreflight: ${cockpit.projectAssetIndex.ecommerceSocksChildReportAggregationSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDesignSkillDeclared: ${cockpit.projectAssetIndex.ecommerceSocksDesignSkillDeclared}`);
  lines.push(`- ecommerceSocksDesignExecutorRegistered: ${cockpit.projectAssetIndex.ecommerceSocksDesignExecutorRegistered}`);
  lines.push(`- ecommerceSocksDesignNoPhotoshopToolsBoundary: ${cockpit.projectAssetIndex.ecommerceSocksDesignNoPhotoshopToolsBoundary}`);
  lines.push(`- ecommerceSocksDispatchNoChildExecutionBoundary: ${cockpit.projectAssetIndex.ecommerceSocksDispatchNoChildExecutionBoundary}`);
  lines.push(`- ecommerceSocksDispatchLifecycleBoundary: ${cockpit.projectAssetIndex.ecommerceSocksDispatchLifecycleBoundary}`);
  lines.push(`- ecommerceSocksDispatchOrchestrationBoundary: ${cockpit.projectAssetIndex.ecommerceSocksDispatchOrchestrationBoundary}`);
  lines.push(`- ecommerceSocksDispatchAuthorizationBoundary: ${cockpit.projectAssetIndex.ecommerceSocksDispatchAuthorizationBoundary}`);
  lines.push(`- ecommerceSocksChildDispatchRunnerBoundary: ${cockpit.projectAssetIndex.ecommerceSocksChildDispatchRunnerBoundary}`);
  lines.push(`- ecommerceSocksChildReportAggregationBoundary: ${cockpit.projectAssetIndex.ecommerceSocksChildReportAggregationBoundary}`);
  lines.push(`- agentVisibleActivityNoFakeThinkingBoundary: ${cockpit.projectAssetIndex.agentVisibleActivityNoFakeThinkingBoundary}`);
  lines.push(`- agentObservationChannelPolicyAvailable: ${cockpit.projectAssetIndex.agentObservationChannelPolicyAvailable}`);
  lines.push(`- agentObservationChannelPolicySmokeAvailable: ${cockpit.projectAssetIndex.agentObservationChannelPolicySmokeAvailable}`);
  lines.push(`- agentObservationChannelPolicySmokeInPreflight: ${cockpit.projectAssetIndex.agentObservationChannelPolicySmokeInPreflight}`);
  lines.push(`- agentObservationChannelPolicyWiredToChatPanel: ${cockpit.projectAssetIndex.agentObservationChannelPolicyWiredToChatPanel}`);
  lines.push(`- agentObservationChannelPolicyWiredToRuntime: ${cockpit.projectAssetIndex.agentObservationChannelPolicyWiredToRuntime}`);
  lines.push(`- agentProviderObservationCapabilitiesAvailable: ${cockpit.projectAssetIndex.agentProviderObservationCapabilitiesAvailable}`);
  lines.push(`- agentProviderObservationCapabilitiesSmokeAvailable: ${cockpit.projectAssetIndex.agentProviderObservationCapabilitiesSmokeAvailable}`);
  lines.push(`- agentProviderObservationCapabilitiesSmokeInPreflight: ${cockpit.projectAssetIndex.agentProviderObservationCapabilitiesSmokeInPreflight}`);
  lines.push(`- agentProviderObservationCapabilitiesNoFakeThinkingBoundary: ${cockpit.projectAssetIndex.agentProviderObservationCapabilitiesNoFakeThinkingBoundary}`);
  lines.push(`- providerNativeToolsContractAvailable: ${cockpit.projectAssetIndex.providerNativeToolsContractAvailable}`);
  lines.push(`- providerNativeToolsSmokeAvailable: ${cockpit.projectAssetIndex.providerNativeToolsSmokeAvailable}`);
  lines.push(`- providerNativeToolsSmokeInPreflight: ${cockpit.projectAssetIndex.providerNativeToolsSmokeInPreflight}`);
  lines.push(`- providerNativeToolsAdapterTypesAvailable: ${cockpit.projectAssetIndex.providerNativeToolsAdapterTypesAvailable}`);
  lines.push(`- providerNativeToolsNoFunctionToolBoundary: ${cockpit.projectAssetIndex.providerNativeToolsNoFunctionToolBoundary}`);
  lines.push(`- searxngDesignKnowledgeConnectorAvailable: ${cockpit.projectAssetIndex.searxngDesignKnowledgeConnectorAvailable}`);
  lines.push(`- searxngDesignKnowledgeSmokeAvailable: ${cockpit.projectAssetIndex.searxngDesignKnowledgeSmokeAvailable}`);
  lines.push(`- searxngDesignKnowledgeSmokeInPreflight: ${cockpit.projectAssetIndex.searxngDesignKnowledgeSmokeInPreflight}`);
  lines.push(`- searxngDesignKnowledgeServiceWired: ${cockpit.projectAssetIndex.searxngDesignKnowledgeServiceWired}`);
  lines.push(`- searxngDesignKnowledgeNoDockerBoundary: ${cockpit.projectAssetIndex.searxngDesignKnowledgeNoDockerBoundary}`);
  lines.push(`- agentExecutionLifecycleHelperAvailable: ${cockpit.projectAssetIndex.agentExecutionLifecycleHelperAvailable}`);
  lines.push(`- agentExecutionLifecycleSmokeAvailable: ${cockpit.projectAssetIndex.agentExecutionLifecycleSmokeAvailable}`);
  lines.push(`- agentExecutionLifecycleSmokeInPreflight: ${cockpit.projectAssetIndex.agentExecutionLifecycleSmokeInPreflight}`);
  lines.push(`- agentExecutionLifecycleAcceptanceSmokeAvailable: ${cockpit.projectAssetIndex.agentExecutionLifecycleAcceptanceSmokeAvailable}`);
  lines.push(`- agentExecutionLifecycleAcceptanceSmokeInPreflight: ${cockpit.projectAssetIndex.agentExecutionLifecycleAcceptanceSmokeInPreflight}`);
  lines.push(`- agentExecutionLifecycleAcceptanceReportAvailable: ${cockpit.projectAssetIndex.agentExecutionLifecycleAcceptanceReportAvailable}`);
  lines.push(`- agentExecutionLifecycleAcceptanceExportAvailable: ${cockpit.projectAssetIndex.agentExecutionLifecycleAcceptanceExportAvailable}`);
  lines.push(`- agentExecutionLifecycleNoFakeThinkingBoundary: ${cockpit.projectAssetIndex.agentExecutionLifecycleNoFakeThinkingBoundary}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeHelperAvailable: ${cockpit.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeHelperAvailable}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable: ${cockpit.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeSmokeInPreflight: ${cockpit.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeSmokeInPreflight}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeNoQualityClaim: ${cockpit.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeNoQualityClaim}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeNoRunBoundary: ${cockpit.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeNoRunBoundary}`);
  lines.push(`- agentAcceptanceTriageHelperAvailable: ${cockpit.projectAssetIndex.agentAcceptanceTriageHelperAvailable}`);
  lines.push(`- agentAcceptanceTriageSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceTriageSmokeAvailable}`);
  lines.push(`- agentAcceptanceTriageWiredToDebugExport: ${cockpit.projectAssetIndex.agentAcceptanceTriageWiredToDebugExport}`);
  lines.push(`- agentAcceptanceTriageReportHelperAvailable: ${cockpit.projectAssetIndex.agentAcceptanceTriageReportHelperAvailable}`);
  lines.push(`- agentAcceptanceTriageReportCommandAvailable: ${cockpit.projectAssetIndex.agentAcceptanceTriageReportCommandAvailable}`);
  lines.push(`- agentAcceptanceTriageReportSmokeAvailable: ${cockpit.projectAssetIndex.agentAcceptanceTriageReportSmokeAvailable}`);
  lines.push(`- agentAcceptanceTriageReportWiredToDesktopReport: ${cockpit.projectAssetIndex.agentAcceptanceTriageReportWiredToDesktopReport}`);
  lines.push(`- chatPanelExportsDiagnosticRecord: ${cockpit.projectAssetIndex.chatPanelExportsDiagnosticRecord}`);
  lines.push(`- businessSkillDesignGovernanceDocAvailable: ${cockpit.projectAssetIndex.businessSkillDesignGovernanceDocAvailable}`);
  lines.push(`- businessSkillDesignGovernanceSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillDesignGovernanceSmokeAvailable}`);
  lines.push(`- businessSkillImplementationCheckpointHelperAvailable: ${cockpit.projectAssetIndex.businessSkillImplementationCheckpointHelperAvailable}`);
  lines.push(`- businessSkillImplementationCheckpointSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillImplementationCheckpointSmokeAvailable}`);
  lines.push(`- businessSkillImplementationCheckpointRequiresUserCheckpoint: ${cockpit.projectAssetIndex.businessSkillImplementationCheckpointRequiresUserCheckpoint}`);
  lines.push(`- businessSkillImplementationCheckpointMentionsThreeSkills: ${cockpit.projectAssetIndex.businessSkillImplementationCheckpointMentionsThreeSkills}`);
  lines.push(`- businessSkillReadinessContractHelperAvailable: ${cockpit.projectAssetIndex.businessSkillReadinessContractHelperAvailable}`);
  lines.push(`- businessSkillReadinessContractSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillReadinessContractSmokeAvailable}`);
  lines.push(`- businessSkillReadinessContractUsesImplementationCheckpoint: ${cockpit.projectAssetIndex.businessSkillReadinessContractUsesImplementationCheckpoint}`);
  lines.push(`- businessSkillReadinessContractRequiresStrategyInputs: ${cockpit.projectAssetIndex.businessSkillReadinessContractRequiresStrategyInputs}`);
  lines.push(`- businessSkillReadinessContractNoQualityClaim: ${cockpit.projectAssetIndex.businessSkillReadinessContractNoQualityClaim}`);
  lines.push(`- businessSkillExecutionPreflightGateHelperAvailable: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightGateHelperAvailable}`);
  lines.push(`- businessSkillExecutionPreflightGateSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightGateSmokeAvailable}`);
  lines.push(`- businessSkillExecutionPreflightGateUsesImplementationCheckpoint: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightGateUsesImplementationCheckpoint}`);
  lines.push(`- businessSkillExecutionPreflightGateUsesAcceptanceControlPlane: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightGateUsesAcceptanceControlPlane}`);
  lines.push(`- businessSkillExecutionPreflightGateMentionsThreeSkills: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightGateMentionsThreeSkills}`);
  lines.push(`- businessSkillExecutionPreflightGateNoExecutorChange: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightGateNoExecutorChange}`);
  lines.push(`- businessSkillExecutionPreflightWiringSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightWiringSmokeAvailable}`);
  lines.push(`- businessSkillExecutionPreflightEntrypointWired: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightEntrypointWired}`);
  lines.push(`- businessSkillExecutionPreflightControlContextOnly: ${cockpit.projectAssetIndex.businessSkillExecutionPreflightControlContextOnly}`);
  lines.push(`- businessSkillPreflightPlannerContextHelperAvailable: ${cockpit.projectAssetIndex.businessSkillPreflightPlannerContextHelperAvailable}`);
  lines.push(`- businessSkillPreflightPlannerContextSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillPreflightPlannerContextSmokeAvailable}`);
  lines.push(`- businessSkillPreflightPlannerContextWired: ${cockpit.projectAssetIndex.businessSkillPreflightPlannerContextWired}`);
  lines.push(`- businessSkillPreflightPlannerContextNoQualityClaim: ${cockpit.projectAssetIndex.businessSkillPreflightPlannerContextNoQualityClaim}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanHelperAvailable: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshPlanHelperAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshPlanSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanWired: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshPlanWired}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanDefaultDisabled: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshPlanDefaultDisabled}`);
  lines.push(`- businessSkillVisualObservationRefreshRunnerSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshRunnerSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshRunnerWired: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshRunnerWired}`);
  lines.push(`- businessSkillVisualObservationRefreshRunnerPostExecutor: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshRunnerPostExecutor}`);
  lines.push(`- businessSkillVisualObservationRefreshRuntimeSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshRuntimeSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshRuntimeAutoDetects: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshRuntimeAutoDetects}`);
  lines.push(`- businessSkillVisualContextPreparationHelperAvailable: ${cockpit.projectAssetIndex.businessSkillVisualContextPreparationHelperAvailable}`);
  lines.push(`- businessSkillVisualContextPreparationSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillVisualContextPreparationSmokeAvailable}`);
  lines.push(`- businessSkillVisualContextPreparationWired: ${cockpit.projectAssetIndex.businessSkillVisualContextPreparationWired}`);
  lines.push(`- businessSkillVisualContextPreparationRunnerWired: ${cockpit.projectAssetIndex.businessSkillVisualContextPreparationRunnerWired}`);
  lines.push(`- businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint: ${cockpit.projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint}`);
  lines.push(`- projectAssetUnderstandingIntakeHelperAvailable: ${cockpit.projectAssetIndex.projectAssetUnderstandingIntakeHelperAvailable}`);
  lines.push(`- projectAssetUnderstandingIntakeSmokeAvailable: ${cockpit.projectAssetIndex.projectAssetUnderstandingIntakeSmokeAvailable}`);
  lines.push(`- projectAssetUnderstandingIntakeWired: ${cockpit.projectAssetIndex.projectAssetUnderstandingIntakeWired}`);
  lines.push(`- projectAssetUnderstandingIntakeNoQualityClaim: ${cockpit.projectAssetIndex.projectAssetUnderstandingIntakeNoQualityClaim}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeHelperAvailable: ${cockpit.projectAssetIndex.businessSkillImagePlacementVerificationIntakeHelperAvailable}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillImagePlacementVerificationIntakeSmokeAvailable}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeWired: ${cockpit.projectAssetIndex.businessSkillImagePlacementVerificationIntakeWired}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeNoQualityClaim: ${cockpit.projectAssetIndex.businessSkillImagePlacementVerificationIntakeNoQualityClaim}`);
  lines.push(`- businessSkillExecutionPlanIntakeHelperAvailable: ${cockpit.projectAssetIndex.businessSkillExecutionPlanIntakeHelperAvailable}`);
  lines.push(`- businessSkillExecutionPlanIntakeSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillExecutionPlanIntakeSmokeAvailable}`);
  lines.push(`- businessSkillExecutionPlanIntakeWired: ${cockpit.projectAssetIndex.businessSkillExecutionPlanIntakeWired}`);
  lines.push(`- businessSkillExecutionPlanIntakeNoQualityClaim: ${cockpit.projectAssetIndex.businessSkillExecutionPlanIntakeNoQualityClaim}`);
  lines.push(`- businessSkillVisualObservationDiagnosticSmokeAvailable: ${cockpit.projectAssetIndex.businessSkillVisualObservationDiagnosticSmokeAvailable}`);
  lines.push(`- businessSkillDesignGovernanceRequiresUserCheckpoint: ${cockpit.projectAssetIndex.businessSkillDesignGovernanceRequiresUserCheckpoint}`);
  lines.push(`- businessSkillDesignGovernanceMentionsThreeSkills: ${cockpit.projectAssetIndex.businessSkillDesignGovernanceMentionsThreeSkills}`);
  lines.push(`- contextSnapshotCarriesVisualInsightCache: ${cockpit.projectAssetIndex.contextSnapshotCarriesVisualInsightCache}`);
  lines.push(`- runtimeReadsVisualInsightCache: ${cockpit.projectAssetIndex.runtimeReadsVisualInsightCache}`);
  lines.push(`- runtimeWritesVisualInsightCache: ${cockpit.projectAssetIndex.runtimeWritesVisualInsightCache}`);
  lines.push(`- rendererContextCarriesVisualInsightCache: ${cockpit.projectAssetIndex.rendererContextCarriesVisualInsightCache}`);
  lines.push(`- plannerConsumesVisualInsightCache: ${cockpit.projectAssetIndex.plannerConsumesVisualInsightCache}`);
  lines.push(`- ipcWriteVisualInsightCacheAvailable: ${cockpit.projectAssetIndex.ipcWriteVisualInsightCacheAvailable}`);
  lines.push(`- preloadWriteVisualInsightCacheAvailable: ${cockpit.projectAssetIndex.preloadWriteVisualInsightCacheAvailable}`);
  lines.push(`- policy: ${cockpit.projectAssetIndex.policy}`);
  lines.push('');
  lines.push('imagePlacementCore:');
  lines.push(`- helperAvailable: ${cockpit.imagePlacementCore.helperAvailable}`);
  lines.push(`- docAvailable: ${cockpit.imagePlacementCore.docAvailable}`);
  lines.push(`- readinessReportAvailable: ${cockpit.imagePlacementCore.readinessReportAvailable}`);
  lines.push(`- smokeAvailable: ${cockpit.imagePlacementCore.smokeAvailable}`);
  lines.push(`- readinessSmokeAvailable: ${cockpit.imagePlacementCore.readinessSmokeAvailable}`);
  lines.push(`- smokeInPreflight: ${cockpit.imagePlacementCore.smokeInPreflight}`);
  lines.push(`- readinessSmokeInPreflight: ${cockpit.imagePlacementCore.readinessSmokeInPreflight}`);
  lines.push(`- wrapsSmartScalingPolicy: ${cockpit.imagePlacementCore.wrapsSmartScalingPolicy}`);
  lines.push(`- requiresActualBoundsReadback: ${cockpit.imagePlacementCore.requiresActualBoundsReadback}`);
  lines.push(`- screenshotFailureOverridesBounds: ${cockpit.imagePlacementCore.screenshotFailureOverridesBounds}`);
  lines.push(`- businessSkillsNotDirectlyWired: ${cockpit.imagePlacementCore.businessSkillsNotDirectlyWired}`);
  lines.push(`- policy: ${cockpit.imagePlacementCore.policy}`);
  lines.push('');
  lines.push('agentPerformancePolicy:');
  lines.push(`- helperAvailable: ${cockpit.agentPerformancePolicy.helperAvailable}`);
  lines.push(`- smokeAvailable: ${cockpit.agentPerformancePolicy.smokeAvailable}`);
  lines.push(`- smokeInPreflight: ${cockpit.agentPerformancePolicy.smokeInPreflight}`);
  lines.push(`- plannerBuildsPolicy: ${cockpit.agentPerformancePolicy.plannerBuildsPolicy}`);
  lines.push(`- selectedContextCarriesPolicy: ${cockpit.agentPerformancePolicy.selectedContextCarriesPolicy}`);
  lines.push(`- runtimeBudgetHelperAvailable: ${cockpit.agentPerformancePolicy.runtimeBudgetHelperAvailable}`);
  lines.push(`- autonomousAgentUsesRuntimeBudget: ${cockpit.agentPerformancePolicy.autonomousAgentUsesRuntimeBudget}`);
  lines.push(`- designTeamRuntimeBudgetHelperAvailable: ${cockpit.agentPerformancePolicy.designTeamRuntimeBudgetHelperAvailable}`);
  lines.push(`- designTeamRegistryUsesRuntimeBudget: ${cockpit.agentPerformancePolicy.designTeamRegistryUsesRuntimeBudget}`);
  lines.push(`- designTeamCoordinatorUsesRuntimeBudget: ${cockpit.agentPerformancePolicy.designTeamCoordinatorUsesRuntimeBudget}`);
  lines.push(`- smokeCoversDesignTeamBudget: ${cockpit.agentPerformancePolicy.smokeCoversDesignTeamBudget}`);
  lines.push(`- contextWindowBudgetHelperAvailable: ${cockpit.agentPerformancePolicy.contextWindowBudgetHelperAvailable}`);
  lines.push(`- contextManagerUsesWindowBudget: ${cockpit.agentPerformancePolicy.contextManagerUsesWindowBudget}`);
  lines.push(`- agentRuntimeUsesContextDefault: ${cockpit.agentPerformancePolicy.agentRuntimeUsesContextDefault}`);
  lines.push(`- smokeCoversContextWindowBudget: ${cockpit.agentPerformancePolicy.smokeCoversContextWindowBudget}`);
  lines.push(`- resourceCacheBudgetHelperAvailable: ${cockpit.agentPerformancePolicy.resourceCacheBudgetHelperAvailable}`);
  lines.push(`- resourceManagerUsesCacheBudget: ${cockpit.agentPerformancePolicy.resourceManagerUsesCacheBudget}`);
  lines.push(`- smokeCoversResourceCacheBudget: ${cockpit.agentPerformancePolicy.smokeCoversResourceCacheBudget}`);
  lines.push(`- providerTokenBudgetHelperAvailable: ${cockpit.agentPerformancePolicy.providerTokenBudgetHelperAvailable}`);
  lines.push(`- providerAdaptersUseTokenBudget: ${cockpit.agentPerformancePolicy.providerAdaptersUseTokenBudget}`);
  lines.push(`- modelServiceUsesTokenBudget: ${cockpit.agentPerformancePolicy.modelServiceUsesTokenBudget}`);
  lines.push(`- streamAdapterUsesTokenBudget: ${cockpit.agentPerformancePolicy.streamAdapterUsesTokenBudget}`);
  lines.push(`- smokeCoversProviderTokenBudget: ${cockpit.agentPerformancePolicy.smokeCoversProviderTokenBudget}`);
  lines.push(`- acceptanceCaptureBudgetHelperAvailable: ${cockpit.agentPerformancePolicy.acceptanceCaptureBudgetHelperAvailable}`);
  lines.push(`- toolAcceptanceUsesCaptureBudget: ${cockpit.agentPerformancePolicy.toolAcceptanceUsesCaptureBudget}`);
  lines.push(`- smokeCoversAcceptanceBudget: ${cockpit.agentPerformancePolicy.smokeCoversAcceptanceBudget}`);
  lines.push(`- visualSamplingBudgetHelperAvailable: ${cockpit.agentPerformancePolicy.visualSamplingBudgetHelperAvailable}`);
  lines.push(`- projectVisualSamplingUsesBudget: ${cockpit.agentPerformancePolicy.projectVisualSamplingUsesBudget}`);
  lines.push(`- smokeCoversVisualSamplingBudget: ${cockpit.agentPerformancePolicy.smokeCoversVisualSamplingBudget}`);
  lines.push(`- policyForbidsBulkScan: ${cockpit.agentPerformancePolicy.policyForbidsBulkScan}`);
  lines.push(`- policyForbidsFullResolutionRead: ${cockpit.agentPerformancePolicy.policyForbidsFullResolutionRead}`);
  lines.push(`- policy: ${cockpit.agentPerformancePolicy.policy}`);
  lines.push('');
  lines.push('capabilityMap:');
  lines.push(`- available: ${cockpit.capabilityMap.available}`);
  lines.push(`- success: ${cockpit.capabilityMap.success}`);
  lines.push(`- role: ${cockpit.capabilityMap.role || 'unknown'}`);
  lines.push(`- layerCount: ${cockpit.capabilityMap.layerCount ?? 'unknown'}`);
  lines.push(`- missingScripts: ${cockpit.capabilityMap.missingScripts && cockpit.capabilityMap.missingScripts.length > 0 ? cockpit.capabilityMap.missingScripts.join(', ') : 'none'}`);
  lines.push(`- missingBoundaryPhrases: ${cockpit.capabilityMap.missingBoundaryPhrases && cockpit.capabilityMap.missingBoundaryPhrases.length > 0 ? cockpit.capabilityMap.missingBoundaryPhrases.join(', ') : 'none'}`);
  lines.push('');
  lines.push('activeBoundaries:');
  lines.push(...formatList(cockpit.activeBoundaries, (group) => `${group.id}: ${group.count} (staged ${group.staged}, unstaged ${group.unstaged}, untracked ${group.untracked})`));
  lines.push('');
  lines.push('topRisks:');
  lines.push(...formatList(cockpit.topRisks, (risk) => risk));
  lines.push('');
  lines.push('nextActions:');
  lines.push(...formatList(cockpit.nextActions, (action) => action));
  lines.push('');
  lines.push('recommendedCommands:');
  lines.push(`- daily resume: ${cockpit.commands.dailyResume}`);
  lines.push(`- quick validation: ${cockpit.commands.quickValidation}`);
  lines.push(`- full validation: ${cockpit.commands.fullValidation}`);
  lines.push(`- local preflight: ${cockpit.commands.localPreflight}`);
  lines.push(`- boundary check: ${cockpit.commands.boundaryCheck}`);
  lines.push(`- boundary summary: ${cockpit.commands.boundarySummary}`);
  lines.push(`- agent architecture: ${cockpit.commands.agentArchitecture}`);
  lines.push(`- capability map: ${cockpit.commands.capabilityMap}`);
  lines.push(`- reference readiness: ${cockpit.commands.referenceReadiness}`);
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const limit = normalizeLimit(getArgValue(args, '--limit'));
  const cockpit = buildCockpit(limit);

  if (args.includes('--json')) {
    console.log(JSON.stringify(cockpit, null, 2));
    return;
  }

  console.log(formatCockpit(cockpit));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
