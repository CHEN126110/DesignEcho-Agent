#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES
} = require('./lib/reference-benchmark-categories.cjs');
const {
  buildReferenceQualityGateConsistency
} = require('./lib/reference-quality-gate-consistency.cjs');

const DESIGN_AGENT_OS_SUBSYSTEMS = [
  {
    id: 'intent-control-plane',
    title: 'Intent Control Plane',
    requiredDocNeedle: '### 3.1 Intent Control Plane',
    requiredImplementationNeedle: '### 3.1 Intent Control Plane',
    nextGate: 'UserIntent 进入所有执行任务入口证据，真实 UI 回归 C-1141 类简单操作不绕远路。'
  },
  {
    id: 'context-memory',
    title: 'Context Memory',
    requiredDocNeedle: '### 3.2 Context Memory',
    requiredImplementationNeedle: '### 3.2 Context Memory',
    nextGate: '定义 ContextSnapshot，并让开放式设计任务先读取项目、文档、素材和历史任务。'
  },
  {
    id: 'visual-perception',
    title: 'Visual Perception',
    requiredDocNeedle: '### 3.3 Visual Perception',
    requiredImplementationNeedle: '### 3.3 Visual Perception',
    nextGate: '统一 VisualUnderstanding 的来源证据，缺少图片或画布证据时降级或请求补充。'
  },
  {
    id: 'knowledge-and-recipe',
    title: 'Knowledge And Recipe',
    requiredDocNeedle: '### 3.4 Knowledge And Recipe',
    requiredImplementationNeedle: '### 3.4 Knowledge And Recipe',
    nextGate: '统一 DesignKnowledgeResult，把知识输出限制为约束或 recipe 候选。'
  },
  {
    id: 'design-dsl',
    title: 'Design DSL',
    requiredDocNeedle: '### 3.5 Design DSL',
    requiredImplementationNeedle: '### 3.5 Design DSL',
    nextGate: '统一 canvas、grid、regions、textBlocks、imageSlots、styleRecipes 和 verificationTargets。'
  },
  {
    id: 'photoshop-execution',
    title: 'Photoshop Execution',
    requiredDocNeedle: '### 3.6 Photoshop Execution',
    requiredImplementationNeedle: '### 3.6 Photoshop Execution',
    nextGate: '工具调用引用 ExecutionPlan step id，并产出可验收 ExecutionTrace。'
  },
  {
    id: 'verification-and-qa',
    title: 'Verification And QA',
    requiredDocNeedle: '### 3.7 Verification And QA',
    requiredImplementationNeedle: '### 3.7 Verification And QA',
    nextGate: '所有设计任务输出 VerificationReport，并拆分结构、视觉、人工和模型复核证据。'
  },
  {
    id: 'user-feedback-ux',
    title: 'User Feedback UX',
    requiredDocNeedle: '### 3.8 User Feedback UX',
    requiredImplementationNeedle: '### 3.8 User Feedback UX',
    nextGate: '只显示真实 provider thinking/reasoning 和工具事件，不用本地固定话术伪装思考。'
  }
];

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
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

function hasScript(packageJson, scriptName) {
  return Boolean(packageJson.scripts && packageJson.scripts[scriptName]);
}

function readJsonIfExists(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function readCapabilityMapReport(agentRoot) {
  try {
    const output = run('node', ['scripts/report-agent-capability-map.cjs', '--json'], agentRoot);
    return JSON.parse(output);
  } catch (error) {
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

function readReferenceReadinessReport(agentRoot) {
  try {
    const output = run('node', ['scripts/report-reference-replication-readiness.cjs', '--json'], agentRoot);
    return JSON.parse(output);
  } catch (error) {
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

function readReferenceQualityGateReport(agentRoot) {
  try {
    const output = run('node', ['scripts/check-reference-quality-claim-gate.cjs', '--json'], agentRoot);
    return JSON.parse(output);
  } catch (error) {
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

function readReferenceStatusReport(agentRoot) {
  try {
    const output = run('node', ['scripts/report-reference-replication-status.cjs', '--json'], agentRoot);
    return JSON.parse(output);
  } catch (error) {
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

function readReferenceBenchmarkCoverage(agentRoot) {
  const manifest = readJsonIfExists(agentRoot, 'benchmarks/reference-replication/cases.manifest.json');
  if (!manifest || !Array.isArray(manifest.cases)) {
    return {
      caseCount: 0,
      categories: [],
      missingCategories: REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES,
      hasRepresentativeSeedCoverage: false,
      syntheticCaseCount: 0
    };
  }

  const categories = new Set();
  let syntheticCaseCount = 0;
  for (const item of manifest.cases) {
    const caseFile = String(item?.file || '').trim();
    if (!caseFile) continue;
    const caseJson = readJsonIfExists(agentRoot, `benchmarks/reference-replication/${caseFile}`);
    const category = String(caseJson?.scenario?.category || '').trim();
    if (category) categories.add(category);
    if (caseJson?.scenario?.source?.providedBy === 'synthetic-fixture') {
      syntheticCaseCount += 1;
    }
  }

  const categoryList = Array.from(categories).sort();
  const missingCategories = REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES
    .filter((category) => !categories.has(category));

  return {
    caseCount: manifest.cases.length,
    categories: categoryList,
    missingCategories,
    hasRepresentativeSeedCoverage: missingCategories.length === 0,
    syntheticCaseCount
  };
}

function evidenceIncludes(projectState, needle) {
  const haystack = [
    ...(projectState.verified?.code || []),
    ...(projectState.verified?.build || []),
    ...(projectState.verified?.manual || [])
  ].join('\n');
  return haystack.includes(needle);
}

function countReady(gates) {
  return gates.filter((gate) => gate.status === 'ready').length;
}

function countMvp(gates) {
  return gates.filter((gate) => gate.status === 'ready' || gate.status === 'mvp').length;
}

function buildGate({ id, title, goal, status, evidence, gaps, validations }) {
  return {
    id,
    title,
    goal,
    status,
    evidence: evidence.filter(Boolean),
    gaps: gaps.filter(Boolean),
    validations: validations.filter(Boolean)
  };
}

function inferStatus(requiredEvidence, matureGaps) {
  const readyEvidence = requiredEvidence.every(Boolean);
  if (!readyEvidence) return 'missing';
  return matureGaps.length > 0 ? 'mvp' : 'ready';
}

function buildDesignAgentOsSubsystems(agentRoot, packageJson) {
  return DESIGN_AGENT_OS_SUBSYSTEMS.map((subsystem) => {
    const hasTopLevelDoc = fileIncludes(
      agentRoot,
      'docs/design-agent-operating-system.md',
      subsystem.requiredDocNeedle
    );
    const hasImplementationTree = fileIncludes(
      agentRoot,
      'docs/design-agent-os-implementation-tree.md',
      subsystem.requiredImplementationNeedle
    );
    const hasSmoke = hasScript(packageJson, 'smoke:design-agent-os:architecture-tree');
    const status = hasTopLevelDoc && hasImplementationTree && hasSmoke ? 'mvp' : 'missing';

    return {
      id: subsystem.id,
      title: subsystem.title,
      status,
      evidence: [
        hasTopLevelDoc ? 'top-level-os-doc' : '',
        hasImplementationTree ? 'implementation-tree-doc' : '',
        hasSmoke ? 'architecture-tree-smoke' : ''
      ].filter(Boolean),
      gaps: status === 'mvp'
        ? ['implementation tree exists; next gate must move from documentation to runtime control evidence']
        : ['missing top-level doc, implementation tree, or smoke script wiring'],
      nextGate: subsystem.nextGate
    };
  });
}


function buildPhotoshopBridgeHealthStatus(agentRoot, packageJson) {
  return {
    scriptAvailable: exists(agentRoot, 'scripts/check-photoshop-bridge-health.cjs'),
    smokeAvailable: hasScript(packageJson, 'smoke:photoshop-bridge-health'),
    maintenanceCommandAvailable: hasScript(packageJson, 'maintenance:photoshop-bridge-health'),
    selfTestInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:photoshop-bridge-health')
    ),
    readOnlyBoundary: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'writesPhotoshop: false'),
    noDocumentCreationBoundary: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'createsDocument: false'),
    noDesignQualityClaimBoundary: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'claimsDesignQuality: false'),
    classifiesBridgeTimeout: fileIncludes(agentRoot, 'scripts/check-photoshop-bridge-health.cjs', 'photoshop_bridge_unresponsive')
  };
}

function buildReport() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const projectState = readJson(path.join(agentRoot, 'project-memory/project-state.json'));
  const packageJson = readJson(path.join(agentRoot, 'package.json'));
  const designAgentOsSubsystems = buildDesignAgentOsSubsystems(agentRoot, packageJson);
  const photoshopBridgeHealth = buildPhotoshopBridgeHealthStatus(agentRoot, packageJson);
  const simpleTextLayoutLiveReport = readJsonIfExists(agentRoot, 'tmp/reference-fex-text-placement-live-smoke.json');
  const simpleTextLayoutLivePixelProbeOk = simpleTextLayoutLiveReport?.outcome === 'pass'
    && simpleTextLayoutLiveReport?.screenshotQa?.status === 'ok'
    && simpleTextLayoutLiveReport?.visualQa?.status === 'ok';
  const referenceBenchmarkCoverage = readReferenceBenchmarkCoverage(agentRoot);
  const capabilityMapInventory = readCapabilityMapReport(agentRoot);
  const referenceReadiness = readReferenceReadinessReport(agentRoot);
  const referenceQualityGate = readReferenceQualityGateReport(agentRoot);
  const referenceStatus = readReferenceStatusReport(agentRoot);
  const referenceQualityGateBlockers = referenceQualityGate?.gate?.blockers || [];
  const realCaseResumeAction = (referenceStatus?.nextActions || []).find((item) => item.kind === 'add-real-commercial-case') || null;
  const realCaseEvidenceOrder = Array.isArray(realCaseResumeAction?.evidenceChain?.requiredOrder)
    ? realCaseResumeAction.evidenceChain.requiredOrder
    : [];
  const mainImageAgentDraft = {
    helperAvailable: exists(agentRoot, 'src/shared/main-image-agent-draft-plan.ts'),
    assetSelectionHelperAvailable: exists(agentRoot, 'src/shared/main-image-asset-selection.ts'),
    visualLoopHelperAvailable: exists(agentRoot, 'src/shared/main-image-visual-loop.ts'),
    visionPreflightHelperAvailable: exists(agentRoot, 'src/shared/main-image-vision-preflight.ts'),
    executionAlignmentHelperAvailable: exists(agentRoot, 'src/shared/main-image-execution-alignment.ts'),
    screenshotQaHelperAvailable: exists(agentRoot, 'src/shared/main-image-screenshot-qa.ts'),
    screenshotProbeReadinessHelperAvailable: exists(agentRoot, 'src/shared/main-image-screenshot-probe-readiness.ts'),
    qaReportHelperAvailable: exists(agentRoot, 'src/shared/main-image-qa-report.ts'),
    strategyContractHelperAvailable: exists(agentRoot, 'src/shared/main-image-strategy-contract.ts'),
    strategyInputBuilderHelperAvailable: exists(agentRoot, 'src/shared/main-image-strategy-input-builder.ts'),
    assetHeroStrategyHelperAvailable: exists(agentRoot, 'src/shared/main-image-asset-hero-strategy.ts'),
    projectStyleStrategyHelperAvailable: exists(agentRoot, 'src/shared/main-image-project-style-strategy.ts'),
    designStandardsHelperAvailable: exists(agentRoot, 'src/shared/main-image-design-standards.ts'),
    designReadinessReportHelperAvailable: exists(agentRoot, 'src/shared/main-image-design-readiness-report.ts'),
    liveExecutorRequestHelperAvailable: exists(agentRoot, 'src/shared/main-image-live-executor-request.ts'),
    liveExecutorCheckpointHelperAvailable: exists(agentRoot, 'src/shared/main-image-live-executor-checkpoint.ts'),
    liveExecutorRunnerHelperAvailable: exists(agentRoot, 'src/shared/main-image-live-executor-runner.ts'),
    livePhotoshopAdapterContractHelperAvailable: exists(
      agentRoot,
      'src/shared/main-image-live-photoshop-adapter-contract.ts'
    ),
    liveAdapterHandoffHelperAvailable: exists(agentRoot, 'src/shared/main-image-live-adapter-handoff.ts'),
    livePhotoshopToolAdapterHelperAvailable: exists(agentRoot, 'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts'),
    photoshopToolCapabilityMatrixHelperAvailable: exists(
      agentRoot,
      'src/shared/main-image-photoshop-tool-capability-matrix.ts'
    ),
    groupHierarchyContractHelperAvailable: exists(
      agentRoot,
      'src/shared/main-image-group-hierarchy-contract.ts'
    ),
    variantPlacementStrategyHelperAvailable: exists(agentRoot, 'src/shared/main-image-variant-placement-strategy.ts'),
    productionStructureHelperAvailable: exists(agentRoot, 'src/shared/main-image-production-document-structure.ts'),
    productionExecutionPlanHelperAvailable: exists(agentRoot, 'src/shared/main-image-production-execution-plan.ts'),
    productionExecutorHandoffHelperAvailable: exists(agentRoot, 'src/shared/main-image-production-executor-handoff.ts'),
    productionExecutorBridgeHelperAvailable: exists(agentRoot, 'src/shared/main-image-production-executor-bridge.ts'),
    productionExecutorDryRunHelperAvailable: exists(agentRoot, 'src/shared/main-image-production-executor-dry-run.ts'),
    smokeAvailable: hasScript(packageJson, 'smoke:main-image:agent-draft-plan'),
    strategyContractSmokeAvailable: hasScript(packageJson, 'smoke:main-image:strategy-contract'),
    strategyInputBuilderSmokeAvailable: hasScript(packageJson, 'smoke:main-image:strategy-input-builder'),
    assetHeroStrategySmokeAvailable: hasScript(packageJson, 'smoke:main-image:asset-hero-strategy'),
    projectStyleStrategySmokeAvailable: hasScript(packageJson, 'smoke:main-image:project-style-strategy'),
    designStandardsSmokeAvailable: hasScript(packageJson, 'smoke:main-image:design-standards'),
    designReadinessReportSmokeAvailable: hasScript(packageJson, 'smoke:main-image:design-readiness'),
    liveExecutorRequestSmokeAvailable: hasScript(packageJson, 'smoke:main-image:live-executor-request'),
    liveExecutorCheckpointSmokeAvailable: hasScript(packageJson, 'smoke:main-image:live-executor-checkpoint'),
    liveExecutorRunnerSmokeAvailable: hasScript(packageJson, 'smoke:main-image:live-executor-runner'),
    livePhotoshopAdapterContractSmokeAvailable: hasScript(
      packageJson,
      'smoke:main-image:live-photoshop-adapter-contract'
    ),
    liveAdapterHandoffSmokeAvailable: hasScript(packageJson, 'smoke:main-image:live-adapter-handoff'),
    livePhotoshopToolAdapterSmokeAvailable: hasScript(packageJson, 'smoke:main-image:live-photoshop-tool-adapter'),
    liveToolAdapterDisposableSmokeAvailable: hasScript(packageJson, 'smoke:main-image:live-tool-adapter-disposable'),
    liveToolAdapterDisposableClassificationSmokeAvailable: hasScript(
      packageJson,
      'smoke:main-image:live-tool-adapter-disposable:classification'
    ),
    photoshopToolCapabilityMatrixSmokeAvailable: hasScript(
      packageJson,
      'smoke:main-image:photoshop-tool-capability-matrix'
    ),
    groupHierarchyContractSmokeAvailable: hasScript(
      packageJson,
      'smoke:main-image:group-hierarchy-contract'
    ),
    variantPlacementStrategySmokeAvailable: hasScript(packageJson, 'smoke:main-image:variant-placement-strategy'),
    productionStructureSmokeAvailable: hasScript(packageJson, 'smoke:main-image:production-structure'),
    productionExecutionPlanSmokeAvailable: hasScript(packageJson, 'smoke:main-image:production-execution-plan'),
    productionExecutorHandoffSmokeAvailable: hasScript(packageJson, 'smoke:main-image:production-executor-handoff'),
    productionExecutorBridgeSmokeAvailable: hasScript(packageJson, 'smoke:main-image:production-executor-bridge'),
    productionExecutorDryRunSmokeAvailable: hasScript(packageJson, 'smoke:main-image:production-executor-dry-run'),
    assetSelectionSmokeAvailable: hasScript(packageJson, 'smoke:main-image:asset-selection'),
    visualLoopSmokeAvailable: hasScript(packageJson, 'smoke:main-image:visual-loop'),
    visionPreflightSmokeAvailable: hasScript(packageJson, 'smoke:main-image:vision-preflight'),
    candidatePreflightSmokeAvailable: hasScript(packageJson, 'smoke:main-image:candidate-preflight'),
    executionAlignmentSmokeAvailable: hasScript(packageJson, 'smoke:main-image:execution-alignment'),
    screenshotQaSmokeAvailable: hasScript(packageJson, 'smoke:main-image:screenshot-qa'),
    screenshotProbeReadinessSmokeAvailable: hasScript(packageJson, 'smoke:main-image:screenshot-probe-readiness'),
    pixelProbeAdapterSmokeAvailable: hasScript(packageJson, 'smoke:main-image:pixel-probe-adapter'),
    qaReportSmokeAvailable: hasScript(packageJson, 'smoke:main-image:qa-report'),
    smokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:agent-draft-plan')
    ),
    strategyContractSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:strategy-contract')
    ),
    strategyInputBuilderSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:strategy-input-builder')
    ),
    assetHeroStrategySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:asset-hero-strategy')
    ),
    projectStyleStrategySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:project-style-strategy')
    ),
    designStandardsSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:design-standards')
    ),
    designReadinessReportSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:design-readiness')
    ),
    liveExecutorRequestSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-executor-request')
    ),
    liveExecutorCheckpointSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-executor-checkpoint')
    ),
    liveExecutorRunnerSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-executor-runner')
    ),
    livePhotoshopAdapterContractSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-photoshop-adapter-contract')
    ),
    liveAdapterHandoffSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-adapter-handoff')
    ),
    livePhotoshopToolAdapterSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-photoshop-tool-adapter')
    ),
    liveToolAdapterDisposableSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-tool-adapter-disposable')
    ),
    liveToolAdapterDisposableClassificationSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:live-tool-adapter-disposable:classification')
    ),
    photoshopToolCapabilityMatrixSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:photoshop-tool-capability-matrix')
    ),
    groupHierarchyContractSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:group-hierarchy-contract')
    ),
    variantPlacementStrategySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:variant-placement-strategy')
    ),
    productionStructureSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:production-structure')
    ),
    productionExecutionPlanSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:production-execution-plan')
    ),
    productionExecutorHandoffSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:production-executor-handoff')
    ),
    productionExecutorBridgeSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:production-executor-bridge')
    ),
    productionExecutorDryRunSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:production-executor-dry-run')
    ),
    assetSelectionSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:asset-selection')
    ),
    visualLoopSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:visual-loop')
    ),
    visionPreflightSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:vision-preflight')
    ),
    candidatePreflightSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:candidate-preflight')
    ),
    executionAlignmentSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:execution-alignment')
    ),
    screenshotQaSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:screenshot-qa')
    ),
    screenshotProbeReadinessSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:screenshot-probe-readiness')
    ),
    pixelProbeAdapterSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:pixel-probe-adapter')
    ),
    qaReportSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:main-image:qa-report')
    ),
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
      root,
      'DesignEcho-UXP/src/tools/layout/move-layer-to-group.ts',
      "name = 'moveLayerToGroup'"
    ),
    uxpMoveLayerToGroupRegistered: fileIncludes(
      root,
      'DesignEcho-UXP/src/tools/registry.ts',
      'new MoveLayerToGroupTool()'
    ),
    uxpExportGroupToolAvailable: fileIncludes(
      root,
      'DesignEcho-UXP/src/tools/image/export-group.ts',
      "name = 'exportGroup'"
    ),
    uxpExportGroupRegistered: fileIncludes(
      root,
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
    )
  };
  const projectAssetIndex = {
    helperAvailable: exists(agentRoot, 'src/shared/project-asset-index.ts'),
    smokeAvailable: hasScript(packageJson, 'smoke:project-asset-index'),
    liveSmokeAvailable: hasScript(packageJson, 'smoke:project-asset-index:live-c1140'),
    visualSamplingHelperAvailable: exists(agentRoot, 'src/shared/project-visual-sampling.ts'),
    visualSamplingSmokeAvailable: hasScript(packageJson, 'smoke:project-visual-sampling'),
    visualInsightCacheHelperAvailable: exists(agentRoot, 'src/shared/project-visual-insight-cache.ts'),
    visualInsightCacheSmokeAvailable: hasScript(packageJson, 'smoke:project-visual-insight-cache'),
    visualInsightCacheFillHelperAvailable: exists(agentRoot, 'src/shared/project-visual-insight-cache-fill.ts'),
    visualInsightCacheFillRendererAvailable: fileIncludes(agentRoot, 'src/renderer/services/project-visual-insight-cache-fill.ts', 'runProjectVisualInsightCacheFill'),
    visualInsightCacheFillSmokeAvailable: hasScript(packageJson, 'smoke:project-visual-insight-cache-fill'),
    businessVisualContextHelperAvailable: exists(agentRoot, 'src/shared/business-skill-visual-context.ts'),
    businessVisualObservationFeedbackHelperAvailable: exists(agentRoot, 'src/shared/business-skill-visual-observation-feedback.ts'),
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
    businessVisualContextSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-gate'),
    businessVisualObservationFeedbackSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-feedback'),
    businessVisualObservationFeedbackDesktopSmokeAvailable: hasScript(packageJson, 'smoke:chat-ui:business-visual-feedback'),
    detailPageSkillReadinessHelperAvailable: exists(agentRoot, 'src/shared/detail-page-skill-readiness.ts'),
    detailPageSkillReadinessSmokeAvailable: hasScript(packageJson, 'smoke:detail-page:skill-readiness'),
    detailPageSkillReadinessExecutorWired: fileIncludes(
      agentRoot,
      'src/renderer/services/skill-executors/detail-page.executor.ts',
      'detailPageSkillReadiness'
    ),
    detailPageSkillReadinessWiringSmokeAvailable: hasScript(packageJson, 'smoke:detail-page:readiness-wiring'),
    agentDiagnosticRecordHelperAvailable: exists(agentRoot, 'src/shared/agent-diagnostic-record.ts'),
    agentDiagnosticRecordSmokeAvailable: hasScript(packageJson, 'smoke:agent:diagnostic-record'),
    agentAcceptanceDebugCarriesDiagnosticRecord: fileIncludes(
      agentRoot,
      'src/shared/agent-acceptance-contracts.ts',
      'diagnosticRecord'
    ),
    agentAcceptanceDiagnosticExportHelperAvailable: exists(agentRoot, 'src/shared/agent-acceptance-export.ts'),
    agentAcceptanceDiagnosticExportSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-diagnostic-export'),
    agentAcceptanceDiagnosticExportWiredToChatBridge: fileIncludes(
      agentRoot,
      'src/renderer/components/ChatPanel.tsx',
      'buildAgentAcceptanceDebugExport'
    ),
    agentAcceptanceBusinessSkillVerificationSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-business-skill-evidence'),
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
    agentIntentDecisionIntakeHelperAvailable: exists(agentRoot, 'src/shared/agent-intent-decision-intake.ts'),
    agentIntentDecisionIntakeSmokeAvailable: hasScript(packageJson, 'smoke:agent:intent-decision-intake'),
    agentIntentDecisionIntakeSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:intent-decision-intake')
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
    agentVisibleActivitySmokeAvailable: hasScript(packageJson, 'smoke:agent:visible-activity'),
    agentVisibleActivitySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:visible-activity')
    ),
    agentWorkerIdentitySmokeAvailable: hasScript(packageJson, 'smoke:agent:worker-identity'),
    agentWorkerIdentitySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:worker-identity')
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
    agentAcceptanceRuntimeModeContractAvailable: exists(agentRoot, 'src/shared/agent-acceptance-runtime-mode.ts'),
    agentAcceptanceRuntimeModeSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-runtime-mode'),
    agentAcceptanceRuntimeModeSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:acceptance-runtime-mode')
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
    ecommerceSocksDesignEntrySmokeAvailable: hasScript(packageJson, 'smoke:ecommerce-socks-design:entry'),
    ecommerceSocksDesignEntrySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:entry')
    ),
    ecommerceSocksStrategyCheckpointSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:strategy-checkpoint'
    ),
    ecommerceSocksStrategyCheckpointSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:strategy-checkpoint')
    ),
    ecommerceSocksStrategyCheckpointNoQualityClaim: fileIncludes(
      agentRoot,
      'src/shared/ecommerce-socks-strategy-checkpoint.ts',
      'canClaimDesignComplete: false'
    ),
    ecommerceSocksChildStrategyPacketsSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:child-strategy-packets'
    ),
    ecommerceSocksChildStrategyPacketsSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:child-strategy-packets')
    ),
    ecommerceSocksChildStrategyPacketsNoImplementation: fileIncludes(
      agentRoot,
      'src/shared/ecommerce-socks-child-strategy-packets.ts',
      'canImplementChildStrategyChanges: false'
    ),
    ecommerceSocksChildStrategyReviewGateSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:child-strategy-review-gate'
    ),
    ecommerceSocksChildStrategyReviewGateSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:child-strategy-review-gate')
    ),
    ecommerceSocksChildStrategyReviewGateNoExecution: fileIncludes(
      agentRoot,
      'src/shared/ecommerce-socks-child-strategy-review-gate.ts',
      'mustNotExecuteChildSkills: true'
    ),
    ecommerceSocksChildStrategyHandoffSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:child-strategy-handoff'
    ),
    ecommerceSocksChildStrategyHandoffSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:child-strategy-handoff')
    ),
    ecommerceSocksChildStrategyHandoffNoExecution: fileIncludes(
      agentRoot,
      'src/shared/ecommerce-socks-child-strategy-handoff.ts',
      'mustNotExecuteChildSkills: true'
    ),
    ecommerceSocksChildStrategyConsumptionSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:child-strategy-consumption'
    ),
    ecommerceSocksChildStrategyConsumptionSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:child-strategy-consumption')
    ),
    ecommerceSocksChildStrategyConsumptionNoExecution: fileIncludes(
      agentRoot,
      'src/shared/ecommerce-socks-child-strategy-consumer.ts',
      'canExecuteChildSkill: false'
    ),
    ecommerceSocksDispatchCheckpointSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:dispatch-checkpoint'
    ),
    ecommerceSocksDispatchCheckpointSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:dispatch-checkpoint')
    ),
    ecommerceSocksDispatchLifecycleSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:dispatch-lifecycle'
    ),
    ecommerceSocksDispatchLifecycleSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:dispatch-lifecycle')
    ),
    ecommerceSocksDispatchOrchestrationSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:dispatch-orchestration'
    ),
    ecommerceSocksDispatchOrchestrationSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:dispatch-orchestration')
    ),
    ecommerceSocksDispatchAuthorizationSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:dispatch-authorization'
    ),
    ecommerceSocksDispatchAuthorizationSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:dispatch-authorization')
    ),
    ecommerceSocksChildDispatchRunnerSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:child-dispatch-runner'
    ),
    ecommerceSocksChildDispatchRunnerSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:child-dispatch-runner')
    ),
    ecommerceSocksChildReportAggregationSmokeAvailable: hasScript(
      packageJson,
      'smoke:ecommerce-socks-design:child-report-aggregation'
    ),
    ecommerceSocksChildReportAggregationSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:ecommerce-socks-design:child-report-aggregation')
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
    agentObservationChannelPolicyAvailable: exists(agentRoot, 'src/shared/agent-observation-channels.ts'),
    agentObservationChannelPolicySmokeAvailable: hasScript(packageJson, 'smoke:agent:observation-channels'),
    agentObservationChannelPolicySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:observation-channels')
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
    agentProviderObservationCapabilitiesAvailable: exists(agentRoot, 'src/shared/agent-provider-observation-capabilities.ts'),
    agentProviderObservationCapabilitiesSmokeAvailable: hasScript(packageJson, 'smoke:agent:provider-observation-capabilities'),
    agentProviderObservationCapabilitiesSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:provider-observation-capabilities')
    ),
    agentProviderObservationCapabilitiesNoFakeThinkingBoundary: fileIncludes(
      agentRoot,
      'src/shared/agent-provider-observation-capabilities.ts',
      'doesNotFabricateThinking: true'
    ),
    providerNativeToolsContractAvailable: exists(agentRoot, 'src/shared/provider-native-tools.ts'),
    providerNativeToolsSmokeAvailable: hasScript(packageJson, 'smoke:provider-native:tools'),
    providerNativeToolsSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:provider-native:tools')
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
    searxngDesignKnowledgeConnectorAvailable: exists(agentRoot, 'src/shared/searxng-design-knowledge.ts'),
    searxngDesignKnowledgeSmokeAvailable: hasScript(packageJson, 'smoke:design-knowledge:searxng'),
    searxngDesignKnowledgeSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:design-knowledge:searxng')
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
    designKnowledgeSettingsEntryAvailable: exists(agentRoot, 'src/shared/design-knowledge-settings.ts')
      && fileIncludes(agentRoot, 'src/renderer/components/SettingsModal.tsx', "'knowledge'")
      && fileIncludes(agentRoot, 'src/main/ipc-handlers/design-knowledge-handlers.ts', 'designKnowledge:probeSearxngHealth'),
    designKnowledgeSettingsEntrySmokeAvailable: hasScript(packageJson, 'smoke:design-knowledge:settings-entry'),
    designKnowledgeSettingsEntrySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:design-knowledge:settings-entry')
    ),
    designKnowledgeRuntimeCapabilityAvailable: exists(agentRoot, 'src/shared/design-knowledge-runtime-capability.ts')
      && fileIncludes(agentRoot, 'src/renderer/components/SettingsModal.tsx', 'buildDesignKnowledgeRuntimeCapabilitySummary'),
    designKnowledgeRuntimeCapabilitySmokeAvailable: hasScript(packageJson, 'smoke:design-knowledge:runtime-capability'),
    designKnowledgeRuntimeCapabilitySmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:design-knowledge:runtime-capability')
    ),
    xiaomiWebSearchRuntimeSmokeAvailable: hasScript(packageJson, 'smoke:design-knowledge:xiaomi-web-search-runtime'),
    xiaomiWebSearchRuntimeSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:design-knowledge:xiaomi-web-search-runtime')
    ),
    xiaomiWebSearchRuntimeWiringAvailable: fileIncludes(
      agentRoot,
      'src/renderer/services/skill-executors/autonomous-agent.executor.ts',
      'withDesignKnowledgeNativeTools'
    )
      && fileIncludes(agentRoot, 'src/main/services/model-service.ts', 'nativeTools: options?.nativeTools')
      && fileIncludes(agentRoot, 'src/main/services/provider-adapters/openai-adapter.ts', 'normalizeProviderNativeToolCitations'),
    agentExecutionLifecycleHelperAvailable: exists(agentRoot, 'src/shared/agent-execution-lifecycle.ts'),
    agentExecutionLifecycleSmokeAvailable: hasScript(packageJson, 'smoke:agent:execution-lifecycle'),
    agentExecutionLifecycleSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:execution-lifecycle')
    ),
    agentExecutionLifecycleAcceptanceSmokeAvailable: hasScript(packageJson, 'smoke:agent:execution-lifecycle-acceptance'),
    agentExecutionLifecycleAcceptanceSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:execution-lifecycle-acceptance')
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
    livePhotoshopAcceptanceEvidenceIntakeHelperAvailable: exists(agentRoot, 'src/shared/live-photoshop-acceptance-intake.ts'),
    livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable: hasScript(packageJson, 'smoke:live-photoshop:acceptance-evidence-intake'),
    livePhotoshopAcceptanceEvidenceIntakeSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:live-photoshop:acceptance-evidence-intake')
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
    agentAcceptanceTriageHelperAvailable: exists(agentRoot, 'src/shared/agent-acceptance-triage.ts'),
    agentAcceptanceTriageSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-triage'),
    agentAcceptanceTriageWiredToDebugExport: fileIncludes(
      agentRoot,
      'src/shared/agent-acceptance-export.ts',
      'acceptanceTriage'
    ),
    agentAcceptanceTriageReportHelperAvailable: exists(agentRoot, 'src/shared/agent-acceptance-triage-report.ts'),
    agentAcceptanceTriageReportCommandAvailable: hasScript(packageJson, 'maintenance:acceptance-triage-report'),
    agentAcceptanceTriageReportSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-triage-report'),
    agentAcceptanceTriageReportWiredToDesktopReport: fileIncludes(
      agentRoot,
      'scripts/acceptance-run-agent-desktop-case.cjs',
      'formatAgentAcceptanceTriageCasesMarkdown'
    ),
    agentAcceptanceControlPlaneHelperAvailable: exists(agentRoot, 'src/shared/agent-acceptance-control-plane.ts'),
    agentAcceptanceControlPlaneSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-control-plane'),
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
    agentAcceptanceVerificationMatrixHelperAvailable: exists(agentRoot, 'src/shared/agent-acceptance-verification-matrix.ts'),
    agentAcceptanceVerificationMatrixSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-verification-matrix'),
    agentAcceptanceVerificationMatrixCommandAvailable: hasScript(packageJson, 'maintenance:acceptance-verification-matrix'),
    agentAcceptanceVerificationMatrixNoQualityClaim: fileIncludes(
      agentRoot,
      'src/shared/agent-acceptance-verification-matrix.ts',
      'qualityClaimAllowed: false'
    ),
    agentAcceptanceExecutionSuiteHelperAvailable: exists(agentRoot, 'src/shared/agent-acceptance-execution-suite.ts'),
    agentAcceptanceExecutionSuiteSmokeAvailable: hasScript(packageJson, 'smoke:agent:acceptance-execution-suite'),
    agentAcceptanceExecutionSuiteCommandAvailable: hasScript(packageJson, 'maintenance:acceptance-suite'),
    agentAcceptanceExecutionSuiteRunSafeCommandAvailable: hasScript(packageJson, 'maintenance:acceptance-suite:run-safe'),
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
    businessSkillDesignGovernanceDocAvailable: exists(agentRoot, 'docs/business-skill-design-governance.md'),
    businessSkillDesignGovernanceSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:design-governance'),
    businessSkillImplementationCheckpointHelperAvailable: exists(agentRoot, 'src/shared/business-skill-implementation-checkpoint.ts'),
    businessSkillImplementationCheckpointSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:implementation-checkpoint'),
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
    businessSkillReadinessContractHelperAvailable: exists(agentRoot, 'src/shared/business-skill-readiness-contract.ts'),
    businessSkillReadinessContractSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:readiness-contract'),
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
    businessSkillExecutionPreflightGateHelperAvailable: exists(agentRoot, 'src/shared/business-skill-execution-preflight-gate.ts'),
    businessSkillExecutionPreflightGateSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:execution-preflight-gate'),
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
    businessSkillExecutionPreflightWiringSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:execution-preflight-wiring'),
    businessSkillExecutionPreflightEntrypointWired: unifiedSkillExecutorEntrypointIncludes(
      agentRoot,
      'attachBusinessSkillExecutionPreflightGateToResult'
    ),
    businessSkillExecutionPreflightControlContextOnly: fileIncludes(
      agentRoot,
      'src/shared/business-skill-preflight-planner-context.ts',
      'controlContextOnly: true'
    ),
    businessSkillPreflightPlannerContextHelperAvailable: exists(agentRoot, 'src/shared/business-skill-preflight-planner-context.ts'),
    businessSkillPreflightPlannerContextSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:preflight-planner-context'),
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
    businessSkillVisualObservationRefreshPlanHelperAvailable: exists(agentRoot, 'src/shared/business-skill-visual-observation-refresh-plan.ts'),
    businessSkillVisualObservationRefreshPlanSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-refresh-plan'),
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
    businessSkillVisualObservationRefreshRunnerSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-refresh-runner'),
    businessSkillVisualObservationRefreshRunnerWired: unifiedSkillExecutorEntrypointIncludes(
      agentRoot,
      'await runBusinessSkillVisualObservationRefreshAfterExecution'
    ),
    businessSkillVisualObservationRefreshRunnerPostExecutor: fileIncludes(
      agentRoot,
      'src/renderer/services/skill-executors/business-skill-visual-context.ts',
      '该 runner 只在业务 executor 完成后运行'
    ),
    businessSkillVisualObservationRefreshRuntimeSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-refresh-runtime'),
    businessSkillVisualObservationRefreshRuntimeAutoDetects: fileIncludes(
      agentRoot,
      'src/renderer/services/skill-executors/business-skill-visual-context.ts',
      'detectBusinessSkillVisualObservationRefreshRuntime'
    ),
    businessSkillVisualContextPreparationHelperAvailable: exists(agentRoot, 'src/shared/business-skill-visual-context-preparation.ts'),
    businessSkillVisualContextPreparationSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-pre-execution-gate'),
    businessSkillVisualContextPreparationWired: fileIncludes(
      agentRoot,
      'src/renderer/services/skill-executors/business-skill-visual-context.ts',
      'buildBusinessSkillVisualContextPreparation'
    ),
    businessSkillVisualContextPreparationRunnerWired: unifiedSkillExecutorEntrypointIncludes(
      agentRoot,
      'runBusinessSkillVisualObservationRefreshBeforeExecution'
    ),
    businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-refresh-executor-wiring'),
    businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint: fileIncludes(
      agentRoot,
      'scripts/smoke-business-skill-visual-evidence-refresh-executor-wiring.cjs',
      "executeSkillWithExecutor('sku-batch'"
    ),
    businessSkillExecutionIntakeHelperAvailable: exists(agentRoot, 'src/shared/business-skill-execution-intake.ts'),
    businessSkillExecutionIntakeSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:execution-intake'),
    businessSkillExecutionIntakeWired: unifiedSkillExecutorEntrypointIncludes(
      agentRoot,
      'buildBusinessSkillExecutionIntakeForSkill'
    ),
    businessSkillExecutionIntakeNoQualityClaim: fileIncludes(
      agentRoot,
      'src/shared/business-skill-execution-intake.ts',
      'canClaimDesignQuality: false'
    ),
    projectAssetUnderstandingIntakeHelperAvailable: exists(agentRoot, 'src/shared/project-asset-understanding-intake.ts'),
    projectAssetUnderstandingIntakeSmokeAvailable: hasScript(packageJson, 'smoke:project-asset-understanding:intake'),
    projectAssetUnderstandingIntakeWired: unifiedSkillExecutorEntrypointIncludes(
      agentRoot,
      'attachBusinessSkillProjectAssetUnderstandingIntakeToResult'
    ),
    projectAssetUnderstandingIntakeNoQualityClaim: fileIncludes(
      agentRoot,
      'src/shared/project-asset-understanding-intake.ts',
      'canClaimDesignQuality: false'
    ),
    businessSkillImagePlacementVerificationIntakeHelperAvailable: exists(
      agentRoot,
      'src/shared/business-skill-image-placement-verification-intake.ts'
    ),
    businessSkillImagePlacementVerificationIntakeSmokeAvailable: hasScript(
      packageJson,
      'smoke:business-skill:image-placement-verification-intake'
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
    businessSkillExecutionPlanIntakeHelperAvailable: exists(
      agentRoot,
      'src/shared/business-skill-execution-plan-intake.ts'
    ),
    businessSkillExecutionPlanIntakeSmokeAvailable: hasScript(
      packageJson,
      'smoke:business-skill:execution-plan-intake'
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
    businessSkillVisualObservationDiagnosticSmokeAvailable: hasScript(packageJson, 'smoke:business-skill:visual-evidence-diagnostic'),
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
    contextSnapshotCarriesVisualSampling: fileIncludes(agentRoot, 'src/shared/project-asset-index.ts', 'visualSamplingPlan?: ProjectVisualSamplingPlan'),
    contextSnapshotCarriesVisualInsightCache: fileIncludes(agentRoot, 'src/shared/project-asset-index.ts', 'visualInsightCache?: ProjectVisualInsightCacheReadResult'),
    runtimeBuildsVisualSampling: fileIncludes(agentRoot, 'src/main/services/project-context-snapshot-service.ts', 'buildProjectVisualSamplingPlan'),
    runtimeReadsVisualInsightCache: fileIncludes(agentRoot, 'src/main/services/project-context-snapshot-service.ts', 'readVisualInsightCache'),
    runtimeWritesVisualInsightCache: fileIncludes(agentRoot, 'src/main/services/project-context-snapshot-service.ts', 'writeVisualInsightCache'),
    rendererContextCarriesVisualSampling: fileIncludes(agentRoot, 'src/renderer/services/agent-orchestration/context.ts', 'visualSamplingPlan: snapshot?.visualSamplingPlan'),
    rendererContextCarriesVisualInsightCache: fileIncludes(agentRoot, 'src/renderer/services/agent-orchestration/context.ts', 'visualInsightCache: snapshot?.visualInsightCache'),
    plannerConsumesVisualSampling: fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'visualSamplingPlan?: ProjectVisualSamplingPlan'),
    plannerConsumesVisualInsightCache: fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'visualInsightCache?: ProjectVisualInsightCacheReadResult'),
    ipcWriteVisualInsightCacheAvailable: fileIncludes(agentRoot, 'src/main/ipc-handlers/ecommerce-project-handlers.ts', 'ecommerce:writeVisualInsightCache'),
    preloadWriteVisualInsightCacheAvailable: fileIncludes(agentRoot, 'src/main/preload.ts', 'writeProjectVisualInsightCache'),
    maintenanceValidateRunsSmoke: Boolean(
      packageJson.scripts?.['maintenance:validate']?.includes('smoke:project-asset-index')
      || fileIncludes(agentRoot, 'scripts/validate-maintenance-hygiene.cjs', 'scripts/smoke-project-asset-index.cjs')
    || fileIncludes(agentRoot, 'scripts/validate-maintenance-hygiene.cjs', 'scripts/smoke-project-visual-insight-cache.cjs')
    || fileIncludes(agentRoot, 'scripts/validate-maintenance-hygiene.cjs', 'scripts/smoke-project-visual-insight-cache-fill.cjs')
    || fileIncludes(agentRoot, 'scripts/validate-maintenance-hygiene.cjs', 'scripts/smoke-business-skill-visual-evidence-gate.cjs')
    ),
    plannerAcceptsAssetIndex: fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'assetIndex?: ProjectAssetIndex'),
    plannerReadsAssetIndex: fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'ProjectAssetIndex candidate evidence'),
    snapshotBuilderAvailable: fileIncludes(agentRoot, 'src/shared/project-asset-index.ts', 'buildContextSnapshot'),
    runtimeServiceAvailable: exists(agentRoot, 'src/main/services/project-context-snapshot-service.ts'),
    runtimeSmokeAvailable: hasScript(packageJson, 'smoke:project-context-runtime'),
    ipcHandlerAvailable: fileIncludes(agentRoot, 'src/main/ipc-handlers/ecommerce-project-handlers.ts', 'ecommerce:buildContextSnapshot'),
    preloadApiAvailable: fileIncludes(agentRoot, 'src/main/preload.ts', 'buildProjectContextSnapshot'),
    rendererContextConsumesSnapshot: fileIncludes(agentRoot, 'src/renderer/services/agent-orchestration/context.ts', 'contextSnapshotSource'),
    plannerEvidenceConsumesAssetIndex: fileIncludes(agentRoot, 'src/renderer/services/skill-executors/design-planner-context.ts', 'assetIndex: projectContext?.assetIndex'),
    parsesSkuConfigCsv: fileIncludes(agentRoot, 'src/shared/project-asset-index.ts', 'parseSkuConfigCsv'),
    limitationNoAestheticClaim: fileIncludes(agentRoot, 'src/shared/project-asset-index.ts', '不做审美判断'),
    implementationTreeMentions: fileIncludes(agentRoot, 'docs/design-agent-os-implementation-tree.md', 'ProjectAssetIndex'),
    implementationTreeMentionsM0j: fileIncludes(agentRoot, 'docs/design-agent-os-implementation-tree.md', 'M0j')
  };
  const imagePlacementCore = {
    helperAvailable: exists(agentRoot, 'src/shared/design-image-placement-core.ts'),
    docAvailable: exists(agentRoot, 'docs/image-placement-core-mvp.md'),
    readinessReportAvailable: exists(agentRoot, 'scripts/report-image-placement-core-readiness.cjs'),
    smokeAvailable: hasScript(packageJson, 'smoke:image-placement:core'),
    readinessSmokeAvailable: hasScript(packageJson, 'smoke:image-placement:readiness'),
    smokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:image-placement:core')
    ),
    readinessSmokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:image-placement:readiness')
    ),
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
    policy: 'shared-contract-not-business-executor'
  };
  const agentPerformancePolicy = {
    helperAvailable: exists(agentRoot, 'src/shared/agent-performance-policy.ts'),
    smokeAvailable: hasScript(packageJson, 'smoke:agent:performance-policy'),
    smokeInPreflight: Boolean(
      packageJson.scripts?.['maintenance:preflight']
      && packageJson.scripts['maintenance:preflight'].includes('smoke:agent:performance-policy')
    ),
    plannerBuildsPolicy: fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'buildAgentPerformancePolicyFromIntent'),
    plannerExposesPolicy: fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'performancePolicy: AgentPerformancePolicy'),
    selectedContextCarriesPolicy: fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'performancePolicy: performancePolicy'),
    runtimeBudgetHelperAvailable: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'buildAutonomousAgentRuntimeBudget'),
    autonomousAgentUsesRuntimeBudget: fileIncludes(agentRoot, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts', 'buildAutonomousAgentRuntimeBudget'),
    designTeamRuntimeBudgetHelperAvailable: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'buildDesignTeamRuntimeBudget'),
    designTeamRegistryUsesRuntimeBudget: fileIncludes(agentRoot, 'src/renderer/services/design-teams/registry.ts', 'buildDesignTeamRuntimeBudget'),
    designTeamCoordinatorUsesRuntimeBudget: fileIncludes(agentRoot, 'src/renderer/services/design-teams/coordinator.ts', 'buildDesignTeamRuntimeBudget'),
    smokeCoversDesignTeamBudget: fileIncludes(agentRoot, 'scripts/smoke-agent-performance-policy.cjs', 'design-team role runtime budgets are centralized'),
    contextWindowBudgetHelperAvailable: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'buildAgentContextWindowBudget'),
    contextManagerUsesWindowBudget: fileIncludes(agentRoot, 'src/renderer/services/agent-runtime/context-manager.ts', 'buildAgentContextWindowBudget'),
    agentRuntimeUsesContextDefault: !fileIncludes(agentRoot, 'src/renderer/services/agent-runtime/agent.ts', 'maxTokens: 100000'),
    smokeCoversContextWindowBudget: fileIncludes(agentRoot, 'scripts/smoke-agent-performance-policy.cjs', 'context window budgets are centralized'),
    resourceCacheBudgetHelperAvailable: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'buildAgentResourceCacheBudget'),
    resourceManagerUsesCacheBudget: fileIncludes(agentRoot, 'src/main/services/resource-manager-service.ts', 'buildAgentResourceCacheBudget'),
    smokeCoversResourceCacheBudget: fileIncludes(agentRoot, 'scripts/smoke-agent-performance-policy.cjs', 'resource cache budgets are centralized'),
    providerTokenBudgetHelperAvailable: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'buildAgentProviderTokenBudget'),
    providerAdaptersUseTokenBudget: fileIncludes(agentRoot, 'src/main/services/provider-adapters/openai-adapter.ts', 'buildAgentProviderTokenBudget')
      && fileIncludes(agentRoot, 'src/main/services/provider-adapters/anthropic-adapter.ts', 'buildAgentProviderTokenBudget')
      && fileIncludes(agentRoot, 'src/main/services/provider-adapters/gemini-adapter.ts', 'buildAgentProviderTokenBudget')
      && fileIncludes(agentRoot, 'src/main/services/provider-adapters/ollama-adapter.ts', 'buildAgentProviderTokenBudget'),
    modelServiceUsesTokenBudget: fileIncludes(agentRoot, 'src/main/services/model-service.ts', 'buildAgentProviderTokenBudget')
      && !fileIncludes(agentRoot, 'src/main/services/model-service.ts', 'options?.maxTokens || 4096'),
    streamAdapterUsesTokenBudget: fileIncludes(agentRoot, 'src/main/services/stream-adapter.ts', 'buildAgentProviderTokenBudget')
      && !fileIncludes(agentRoot, 'src/main/services/stream-adapter.ts', 'options?.maxTokens || 4096'),
    smokeCoversProviderTokenBudget: fileIncludes(agentRoot, 'scripts/smoke-agent-performance-policy.cjs', 'provider adapter max token defaults are centralized'),
    acceptanceCaptureBudgetHelperAvailable: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'buildAgentAcceptanceCaptureBudget'),
    toolAcceptanceUsesCaptureBudget: fileIncludes(agentRoot, 'src/shared/acceptance/tool-acceptance.ts', 'buildAgentAcceptanceCaptureBudget'),
    smokeCoversAcceptanceBudget: fileIncludes(agentRoot, 'scripts/smoke-agent-performance-policy.cjs', 'acceptance capture budgets are centralized'),
    visualSamplingBudgetHelperAvailable: fileIncludes(agentRoot, 'src/shared/project-visual-sampling.ts', 'buildProjectVisualSamplingBudget'),
    projectVisualSamplingUsesBudget: fileIncludes(agentRoot, 'src/shared/project-visual-sampling.ts', 'buildProjectVisualSamplingBudget'),
    smokeCoversVisualSamplingBudget: fileIncludes(agentRoot, 'scripts/smoke-agent-performance-policy.cjs', 'visual sampling candidate budgets are centralized'),
    policyForbidsBulkScan: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'allowBulkProjectScan: false'),
    policyForbidsFullResolutionRead: fileIncludes(agentRoot, 'src/shared/agent-performance-policy.ts', 'allowFullResolutionImageRead: false'),
    implementationTreeMentionsPerformance: fileIncludes(agentRoot, 'docs/design-agent-os-implementation-tree.md', 'M0k')
  };

  const gates = [];

  gates.push(buildGate({
    id: 'intent-routing',
    title: '意图与路由真相源',
    goal: '区分聊天、解释、调试、用户可执行技能和自主 Agent，避免硬编码抢路由。',
    status: inferStatus([
      exists(agentRoot, 'src/renderer/services/agent-orchestration/task-classifier.ts'),
      exists(agentRoot, 'src/renderer/services/agent-orchestration/routing.ts'),
      exists(agentRoot, 'src/renderer/services/design-agent/engine.ts'),
      hasScript(packageJson, 'smoke:agent:intent-engine'),
      evidenceIncludes(projectState, 'router intentSummary is forwarded to UI only as model_visible_reasoning public summary')
    ], [
      '仍需要更多真实用户请求样本和真实 Electron UI 回归。'
    ]),
    evidence: [
      'task-classifier / routing / DesignAgentEngine 已存在',
      'router intentSummary 仅作为 model_visible_reasoning 公开摘要进入正在思考',
      'smoke:agent:intent-engine 已纳入脚本'
    ],
    gaps: [
      '不是完整语义系统；仍需要真实请求样本持续扩展。'
    ],
    validations: ['npm run smoke:agent:intent-engine', 'npm run build:typecheck:renderer']
  }));

  gates.push(buildGate({
    id: 'skill-runtime',
    title: 'Skill 执行器体系',
    goal: '让用户能力进入明确 skill/executor 边界，而不是散落在硬编码流程中。',
    status: inferStatus([
      exists(agentRoot, 'src/shared/skills/skill-declarations.ts'),
      exists(agentRoot, 'src/renderer/services/skill-executors/index.ts'),
      exists(agentRoot, 'src/renderer/services/skill-executors/types.ts'),
      hasScript(packageJson, 'smoke:skill-boundaries'),
      fileIncludes(agentRoot, 'src/shared/skills/skill-declarations.ts', "id: 'layout-replication'"),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/index.ts', 'layoutReplicationExecutor'),
      fileIncludes(agentRoot, 'scripts/smoke-skill-boundaries.cjs', 'shape-morphing-has-no-agent-executor')
    ], [
      '部分薄 skill 仍需要下沉为工具或更清晰的业务 skill。'
    ]),
    evidence: [
      'skill declarations / executor registry / executor types 已存在',
      '参考图、详情页、主图、字体替换、文档管理等已有 skill/executor 边界；其中主图和详情页当前只是业务 skill 场景，不代表最终设计策略已完成'
    ],
    gaps: [
      'skill 与 MCP/tool 的边界仍需要继续梳理，避免薄 wrapper 长期残留。',
      '主图、详情页、SKU 应作为 Agent 可选择的业务 skill 使用；具体设计方法、审美策略和执行闭环需要在架构底座稳定后继续设计。'
    ],
    validations: ['npm run smoke:skill-boundaries', 'npm run build:typecheck:renderer']
  }));

  gates.push(buildGate({
    id: 'runtime-honesty',
    title: 'Runtime 防假成功',
    goal: '模型文本不能覆盖工具失败、验收失败、最大迭代或空转事实。',
    status: inferStatus([
      exists(agentRoot, 'src/renderer/services/agent-runtime/agent.ts'),
      exists(agentRoot, 'src/renderer/services/agent-runtime/types.ts'),
      hasScript(packageJson, 'smoke:agent:runtime-guard'),
      fileIncludes(agentRoot, 'src/renderer/services/agent-runtime/types.ts', 'executionSummary?: AgentExecutionSummary'),
      fileIncludes(agentRoot, 'src/renderer/services/agent-runtime/agent.ts', 'buildExecutionSummary'),
      fileIncludes(agentRoot, 'scripts/smoke-agent-runtime-guard.cjs', 'final-response-after-failed-tool-is-not-completed'),
      fileIncludes(agentRoot, 'scripts/smoke-agent-runtime-guard.cjs', 'acceptance-failed-final-response-is-not-completed')
    ], []),
    evidence: [
      'Agent runtime 已有 executionSummary',
      '最大迭代、重复工具链、空最终响应、失败验收都有 smoke 覆盖'
    ],
    gaps: [],
    validations: ['npm run smoke:agent:runtime-guard']
  }));

  gates.push(buildGate({
    id: 'photoshop-acceptance',
    title: 'Photoshop 操作验收证据',
    goal: '让写操作尽量产生前后证据，不只相信工具返回 success。',
    status: inferStatus([
      exists(agentRoot, 'src/shared/acceptance'),
      hasScript(packageJson, 'smoke:acceptance:snapshot-diff'),
      hasScript(packageJson, 'smoke:acceptance:tool-evidence'),
      hasScript(packageJson, 'smoke:photoshop-acceptance:live'),
      exists(agentRoot, 'src/shared/acceptance/tool-acceptance.ts'),
      exists(agentRoot, 'src/shared/acceptance/photoshop-acceptance.ts'),
      fileIncludes(agentRoot, 'src/renderer/services/tool-executor.service.ts', 'attachAcceptanceEvidence'),
      fileIncludes(agentRoot, 'src/renderer/services/tool-executor.service.ts', 'getAcceptanceSnapshot'),
      fileIncludes(agentRoot, 'scripts/smoke-acceptance-tool-evidence.cjs', 'shouldCollectAcceptanceEvidence')
    ], [
      '截图级 QA、项目级验收报告和大文档性能验证仍未完成。'
    ]),
    evidence: [
      'acceptance snapshot/diff helper 已存在',
      '普通 Photoshop 写操作已接入 before/after 验收摘要',
      '只读与写入型 live smoke 已存在'
    ],
    gaps: [
      '当前主要验证结构和 bounds，不验证视觉美感、像素相似度或复杂合成质量。',
      '真实 Photoshop 大文档性能和 UI 报告仍需验证。'
    ],
    validations: [
      'npm run smoke:acceptance:snapshot-diff',
      'npm run smoke:acceptance:tool-evidence',
      'npm run smoke:photoshop-acceptance:live',
      'npm run smoke:photoshop-acceptance:write-live'
    ]
  }));

  gates.push(buildGate({
    id: 'debug-evidence',
    title: 'Debug 与证据脱敏链路',
    goal: '保存执行证据，同时避免普通用户页面暴露内部 JSON、trace 和完整错误。',
    status: inferStatus([
      exists(agentRoot, 'src/main/services/debug-bridge-service.ts'),
      exists(agentRoot, 'src/main/services/mcp-host-service.ts'),
      hasScript(packageJson, 'smoke:debug-bridge:redaction'),
      hasScript(packageJson, 'smoke:tool-result:redaction'),
      fileIncludes(agentRoot, 'src/main/services/debug-bridge-service.ts', 'executionSummary: normalizeExecutionSummary'),
      fileIncludes(agentRoot, 'src/main/services/debug-bridge-service.ts', 'summarizeExecutionSummary'),
      fileIncludes(agentRoot, 'src/main/services/mcp-host-service.ts', 'executionSummary'),
      fileIncludes(agentRoot, 'scripts/smoke-debug-bridge-redaction.cjs', 'recent task trace should expose redacted execution summary'),
      fileIncludes(agentRoot, 'scripts/smoke-tool-result-redaction.cjs', 'normal tool result UI hides raw structured data')
    ], [
      '真实开发工具中的 token 门禁使用体验仍需手测。'
    ]),
    evidence: [
      'Debug Bridge / MCP debug session 默认脱敏',
      '完整 session 读取需要 DESIGNECHO_DEBUG_TOKEN',
      'tool-result redaction smoke 已存在'
    ],
    gaps: [
      'token-gated 完整调试读取仍需要真实开发流程验证。'
    ],
    validations: ['npm run smoke:debug-bridge:redaction', 'npm run smoke:tool-result:redaction']
  }));

  gates.push(buildGate({
    id: 'user-feedback-ui',
    title: '用户可见任务报告',
    goal: '用户能看到明确任务结果、失败和需复核状态，而不是调试 JSON 或伪思考。',
    status: inferStatus([
      exists(agentRoot, 'src/renderer/components/ChatPanel.tsx'),
      exists(agentRoot, 'src/renderer/components/message/parser.ts'),
      hasScript(packageJson, 'smoke:chat-ui:execution-chain'),
      hasScript(packageJson, 'smoke:chat-ui:electron-bridge'),
      fileIncludes(agentRoot, 'src/renderer/components/ChatPanel.tsx', 'thinkingSteps.some(isVisiblePonderingStep)'),
      fileIncludes(agentRoot, 'src/renderer/components/message/parser.ts', 'buildExecutionSummaryCard'),
      fileIncludes(agentRoot, 'scripts/smoke-chat-ui-execution-chain.cjs', 'message parser filters empty thinking placeholders'),
      fileIncludes(agentRoot, 'scripts/smoke-chat-ui-electron-bridge.cjs', 'ordinary chat should not render fake thinking steps'),
      fileIncludes(agentRoot, 'scripts/smoke-chat-ui-electron-bridge.cjs', 'document operation telemetry rendered as 执行记录 instead of 正在思考')
    ], [
      'live API 与真实 Photoshop 写操作下的 UI 体验验收未完成。'
    ]),
    evidence: [
      'ChatPanel 已保存 executionSummary',
      'Message parser 已渲染任务报告卡片',
      '空 thinking 占位会被过滤',
      '隔离 Electron ChatPanel smoke 已覆盖普通聊天、文档操作和失败任务报告样本'
    ],
    gaps: [
      '隔离 Electron smoke 仍使用受控 fake model / fake Photoshop；不等于 live API 或真实 Photoshop 写操作验收。'
    ],
    validations: ['npm run smoke:chat-ui:execution-chain', 'npm run smoke:chat-ui:electron-bridge']
  }));

  gates.push(buildGate({
    id: 'long-horizon-memory',
    title: '长任务项目记忆与边界治理',
    goal: '中断后可恢复事实，不靠聊天记忆推进项目。',
    status: inferStatus([
      exists(agentRoot, 'project-memory/project-state.json'),
      exists(agentRoot, 'docs/project-master-plan.md'),
      exists(agentRoot, 'scripts/report-project-cockpit.cjs'),
      hasScript(packageJson, 'maintenance:project-cockpit'),
      hasScript(packageJson, 'maintenance:validate')
    ], []),
    evidence: [
      'project-memory / master plan / cockpit / boundary check 已存在',
      'maintenance:validate 会检查项目状态结构、脚本目标、乱码和边界'
    ],
    gaps: [],
    validations: ['npm run maintenance:project-cockpit', 'npm run maintenance:validate']
  }));

  gates.push(buildGate({
    id: 'context-snapshot-project-asset-index',
    title: 'M0j ContextSnapshot 与 ProjectAssetIndex',
    goal: '在主图、详情页、SKU 等业务 skill 选择前，先建立项目级素材索引、候选视觉抽样和上下文快照，避免 Agent 只凭单次用户提示乱选能力或乱用图片。',
    status: inferStatus([
      projectAssetIndex.helperAvailable,
      projectAssetIndex.smokeAvailable,
      projectAssetIndex.plannerAcceptsAssetIndex,
      projectAssetIndex.plannerReadsAssetIndex,
      projectAssetIndex.snapshotBuilderAvailable,
      projectAssetIndex.visualSamplingHelperAvailable,
      projectAssetIndex.visualSamplingSmokeAvailable,
      projectAssetIndex.visualInsightCacheHelperAvailable,
      projectAssetIndex.visualInsightCacheSmokeAvailable,
      projectAssetIndex.contextSnapshotCarriesVisualSampling,
      projectAssetIndex.contextSnapshotCarriesVisualInsightCache,
      projectAssetIndex.runtimeServiceAvailable,
      projectAssetIndex.runtimeBuildsVisualSampling,
      projectAssetIndex.runtimeReadsVisualInsightCache,
      projectAssetIndex.runtimeWritesVisualInsightCache,
      projectAssetIndex.runtimeSmokeAvailable,
      projectAssetIndex.visualInsightCacheFillHelperAvailable,
      projectAssetIndex.visualInsightCacheFillRendererAvailable,
      projectAssetIndex.visualInsightCacheFillSmokeAvailable,
      projectAssetIndex.businessVisualObservationFeedbackHelperAvailable,
      projectAssetIndex.businessVisualObservationFeedbackRendererAvailable,
      projectAssetIndex.businessVisualObservationFeedbackUiAvailable,
      projectAssetIndex.businessVisualObservationFeedbackSmokeAvailable,
      projectAssetIndex.businessVisualObservationFeedbackDesktopSmokeAvailable,
      projectAssetIndex.detailPageSkillReadinessHelperAvailable,
      projectAssetIndex.detailPageSkillReadinessSmokeAvailable,
      projectAssetIndex.detailPageSkillReadinessExecutorWired,
      projectAssetIndex.detailPageSkillReadinessWiringSmokeAvailable,
      projectAssetIndex.agentDiagnosticRecordHelperAvailable,
      projectAssetIndex.agentDiagnosticRecordSmokeAvailable,
      projectAssetIndex.agentAcceptanceDebugCarriesDiagnosticRecord,
      projectAssetIndex.agentAcceptanceDiagnosticExportHelperAvailable,
      projectAssetIndex.agentAcceptanceDiagnosticExportSmokeAvailable,
      projectAssetIndex.agentAcceptanceDiagnosticExportWiredToChatBridge,
      projectAssetIndex.agentAcceptanceBusinessSkillVerificationSmokeAvailable,
      projectAssetIndex.agentAcceptanceBusinessSkillVerificationReportAvailable,
      projectAssetIndex.agentAcceptanceBusinessSkillVerificationExportAvailable,
      projectAssetIndex.agentIntentDecisionIntakeHelperAvailable,
      projectAssetIndex.agentIntentDecisionIntakeSmokeAvailable,
      projectAssetIndex.agentIntentDecisionIntakeSmokeInPreflight,
      projectAssetIndex.agentIntentDecisionIntakeReportAvailable,
      projectAssetIndex.agentIntentDecisionIntakeExportAvailable,
      projectAssetIndex.agentIntentDecisionIntakeNoExecutionBoundary,
      projectAssetIndex.agentAcceptanceTriageHelperAvailable,
      projectAssetIndex.agentAcceptanceTriageSmokeAvailable,
      projectAssetIndex.agentAcceptanceTriageWiredToDebugExport,
      projectAssetIndex.agentAcceptanceTriageReportHelperAvailable,
      projectAssetIndex.agentAcceptanceTriageReportCommandAvailable,
      projectAssetIndex.agentAcceptanceTriageReportSmokeAvailable,
      projectAssetIndex.agentAcceptanceTriageReportWiredToDesktopReport,
      projectAssetIndex.agentAcceptanceControlPlaneHelperAvailable,
      projectAssetIndex.agentAcceptanceControlPlaneSmokeAvailable,
      projectAssetIndex.agentAcceptanceControlPlaneModesCovered,
      projectAssetIndex.agentAcceptanceControlPlaneLiveGuarded,
      projectAssetIndex.agentAcceptanceVerificationMatrixHelperAvailable,
      projectAssetIndex.agentAcceptanceVerificationMatrixSmokeAvailable,
      projectAssetIndex.agentAcceptanceVerificationMatrixCommandAvailable,
      projectAssetIndex.agentAcceptanceVerificationMatrixNoQualityClaim,
      projectAssetIndex.agentAcceptanceExecutionSuiteHelperAvailable,
      projectAssetIndex.agentAcceptanceExecutionSuiteSmokeAvailable,
      projectAssetIndex.agentAcceptanceExecutionSuiteCommandAvailable,
      projectAssetIndex.agentAcceptanceExecutionSuiteRunSafeCommandAvailable,
      projectAssetIndex.agentAcceptanceExecutionSuiteDefaultSafeOnly,
      projectAssetIndex.chatPanelExportsDiagnosticRecord,
      projectAssetIndex.businessSkillDesignGovernanceDocAvailable,
      projectAssetIndex.businessSkillDesignGovernanceSmokeAvailable,
      projectAssetIndex.businessSkillImplementationCheckpointHelperAvailable,
      projectAssetIndex.businessSkillImplementationCheckpointSmokeAvailable,
      projectAssetIndex.businessSkillImplementationCheckpointRequiresUserCheckpoint,
      projectAssetIndex.businessSkillImplementationCheckpointMentionsThreeSkills,
      projectAssetIndex.businessSkillReadinessContractHelperAvailable,
      projectAssetIndex.businessSkillReadinessContractSmokeAvailable,
      projectAssetIndex.businessSkillReadinessContractUsesImplementationCheckpoint,
      projectAssetIndex.businessSkillReadinessContractRequiresStrategyInputs,
      projectAssetIndex.businessSkillReadinessContractNoQualityClaim,
      projectAssetIndex.ecommerceSocksStrategyCheckpointSmokeAvailable,
      projectAssetIndex.ecommerceSocksStrategyCheckpointSmokeInPreflight,
      projectAssetIndex.ecommerceSocksStrategyCheckpointNoQualityClaim,
      projectAssetIndex.ecommerceSocksChildStrategyPacketsSmokeAvailable,
      projectAssetIndex.ecommerceSocksChildStrategyPacketsSmokeInPreflight,
      projectAssetIndex.ecommerceSocksChildStrategyPacketsNoImplementation,
      projectAssetIndex.ecommerceSocksChildStrategyReviewGateSmokeAvailable,
      projectAssetIndex.ecommerceSocksChildStrategyReviewGateSmokeInPreflight,
      projectAssetIndex.ecommerceSocksChildStrategyReviewGateNoExecution,
      projectAssetIndex.businessSkillExecutionPreflightGateHelperAvailable,
      projectAssetIndex.businessSkillExecutionPreflightGateSmokeAvailable,
      projectAssetIndex.businessSkillExecutionPreflightGateUsesImplementationCheckpoint,
      projectAssetIndex.businessSkillExecutionPreflightGateUsesAcceptanceControlPlane,
      projectAssetIndex.businessSkillExecutionPreflightGateMentionsThreeSkills,
      projectAssetIndex.businessSkillExecutionPreflightGateNoExecutorChange,
      projectAssetIndex.businessSkillExecutionPreflightWiringSmokeAvailable,
      projectAssetIndex.businessSkillExecutionPreflightEntrypointWired,
      projectAssetIndex.businessSkillExecutionPreflightControlContextOnly,
      projectAssetIndex.businessSkillPreflightPlannerContextHelperAvailable,
      projectAssetIndex.businessSkillPreflightPlannerContextSmokeAvailable,
      projectAssetIndex.businessSkillPreflightPlannerContextWired,
      projectAssetIndex.businessSkillPreflightPlannerContextNoQualityClaim,
      projectAssetIndex.businessSkillVisualObservationRefreshPlanHelperAvailable,
      projectAssetIndex.businessSkillVisualObservationRefreshPlanSmokeAvailable,
      projectAssetIndex.businessSkillVisualObservationRefreshPlanWired,
      projectAssetIndex.businessSkillVisualObservationRefreshPlanDefaultDisabled,
      projectAssetIndex.businessSkillVisualObservationRefreshRunnerSmokeAvailable,
      projectAssetIndex.businessSkillVisualObservationRefreshRunnerWired,
      projectAssetIndex.businessSkillVisualObservationRefreshRunnerPostExecutor,
      projectAssetIndex.businessSkillVisualObservationRefreshRuntimeSmokeAvailable,
      projectAssetIndex.businessSkillVisualObservationRefreshRuntimeAutoDetects,
      projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable,
      projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint,
      projectAssetIndex.businessSkillVisualObservationDiagnosticSmokeAvailable,
      projectAssetIndex.businessSkillDesignGovernanceRequiresUserCheckpoint,
      projectAssetIndex.businessSkillDesignGovernanceMentionsThreeSkills,
      projectAssetIndex.ipcHandlerAvailable,
      projectAssetIndex.preloadApiAvailable,
      projectAssetIndex.ipcWriteVisualInsightCacheAvailable,
      projectAssetIndex.preloadWriteVisualInsightCacheAvailable,
      projectAssetIndex.rendererContextConsumesSnapshot,
      projectAssetIndex.rendererContextCarriesVisualSampling,
      projectAssetIndex.rendererContextCarriesVisualInsightCache,
      projectAssetIndex.plannerEvidenceConsumesAssetIndex,
      projectAssetIndex.plannerConsumesVisualSampling,
      projectAssetIndex.plannerConsumesVisualInsightCache,
      projectAssetIndex.parsesSkuConfigCsv,
      projectAssetIndex.limitationNoAestheticClaim,
      projectAssetIndex.implementationTreeMentions,
      projectAssetIndex.implementationTreeMentionsM0j
    ], [
      '当前是只读索引 MVP，不调用视觉模型，不做审美判断。',
      '运行时已能生成 ContextSnapshot、有界视觉抽样计划和视觉理解缓存读写，但仍需要后续接入真实视觉模型调用和端到端业务验收。'
    ]),
    evidence: [
      projectAssetIndex.helperAvailable ? 'src/shared/project-asset-index.ts 已提供 ProjectAssetIndex / ContextSnapshot helper' : '',
      projectAssetIndex.smokeAvailable ? 'smoke:project-asset-index 已覆盖 synthetic fixture 和可选 C-1140 live scan' : '',
      projectAssetIndex.plannerAcceptsAssetIndex ? 'Design Planner 已接受 projectContext.assetIndex' : '',
      projectAssetIndex.plannerReadsAssetIndex ? 'Planner 计划证据已要求 ProjectAssetIndex candidate evidence' : '',
      projectAssetIndex.visualSamplingHelperAvailable ? 'src/shared/project-visual-sampling.ts 已提供有界视觉抽样和 cache hit/miss/stale 契约' : '',
      projectAssetIndex.visualSamplingSmokeAvailable ? 'smoke:project-visual-sampling 已覆盖候选上限、缓存命中、过期和不编造边界' : '',
      projectAssetIndex.visualInsightCacheHelperAvailable ? 'src/shared/project-visual-insight-cache.ts 已提供视觉理解缓存 manifest/read result 契约' : '',
      projectAssetIndex.visualInsightCacheSmokeAvailable ? 'smoke:project-visual-insight-cache 已覆盖缺失、写入、命中、禁用和 raw payload 移除边界' : '',
      projectAssetIndex.visualInsightCacheFillHelperAvailable ? 'src/shared/project-visual-insight-cache-fill.ts 已提供显式 opt-in 缓存填充计划和映射契约' : '',
      projectAssetIndex.visualInsightCacheFillRendererAvailable ? 'renderer project-visual-insight-cache-fill runner 已复用 analyzeAssetContent 与 writeProjectVisualInsightCache' : '',
      projectAssetIndex.visualInsightCacheFillSmokeAvailable ? 'smoke:project-visual-insight-cache-fill 已覆盖禁用、缺 analyzer、有限候选、失败候选和不保存原始图像边界' : '',
      projectAssetIndex.businessVisualObservationFeedbackHelperAvailable ? 'src/shared/business-skill-visual-observation-feedback.ts 已提供业务视觉证据反馈契约' : '',
      projectAssetIndex.businessVisualObservationFeedbackRendererAvailable ? 'skill executor wrapper 已附加 businessVisualObservationFeedback' : '',
      projectAssetIndex.businessVisualObservationFeedbackUiAvailable ? 'Chat message parser 已把 businessVisualObservationFeedback 渲染为业务预检卡片而不是思考块' : '',
      projectAssetIndex.businessVisualObservationFeedbackSmokeAvailable ? 'smoke:business-skill:visual-evidence-feedback 已覆盖反馈边界' : '',
      projectAssetIndex.businessVisualObservationFeedbackDesktopSmokeAvailable ? 'smoke:chat-ui:business-visual-feedback 已覆盖真实 ChatPanel 卡片渲染位置' : '',
      projectAssetIndex.detailPageSkillReadinessHelperAvailable ? 'src/shared/detail-page-skill-readiness.ts 已提供详情页 skill 执行前只读准备度契约' : '',
      projectAssetIndex.detailPageSkillReadinessSmokeAvailable ? 'smoke:detail-page:skill-readiness 已覆盖 inspect/execute/缺模板/缺视觉证据边界' : '',
      projectAssetIndex.detailPageSkillReadinessExecutorWired ? 'detail-page executor 已把 detailPageSkillReadiness 作为只读 data evidence 暴露' : '',
      projectAssetIndex.detailPageSkillReadinessWiringSmokeAvailable ? 'smoke:detail-page:readiness-wiring 已覆盖非侵入式接入边界' : '',
      projectAssetIndex.agentDiagnosticRecordHelperAvailable ? 'src/shared/agent-diagnostic-record.ts 已提供隐藏诊断记录白名单与脱敏 helper' : '',
      projectAssetIndex.agentDiagnosticRecordSmokeAvailable ? 'smoke:agent:diagnostic-record 已覆盖诊断记录脱敏与 Debug Bundle 出口' : '',
      projectAssetIndex.agentAcceptanceDiagnosticExportHelperAvailable ? 'src/shared/agent-acceptance-export.ts 已提供桌面验收导出的诊断摘要契约' : '',
      projectAssetIndex.agentAcceptanceDiagnosticExportSmokeAvailable ? 'smoke:agent:acceptance-diagnostic-export 已覆盖桌面验收导出诊断摘要边界' : '',
      projectAssetIndex.agentAcceptanceDiagnosticExportWiredToChatBridge ? 'ChatPanel test bridge 已返回 AgentRunDebugBundle、AgentAcceptanceReport 和 acceptanceDiagnostics' : '',
      projectAssetIndex.agentAcceptanceBusinessSkillVerificationSmokeAvailable ? '业务 skill 验收 smoke 已覆盖执行计划和置入检查进入开发诊断出口' : '',
      projectAssetIndex.agentAcceptanceBusinessSkillVerificationReportAvailable ? 'acceptance report 已暴露 businessSkillExecutionPlanIntake / businessSkillImagePlacementVerificationIntake 并检查隐藏/no-quality 边界' : '',
      projectAssetIndex.agentAcceptanceBusinessSkillVerificationExportAvailable ? 'acceptanceDiagnostics 已暴露业务 skill verification intake 边界状态' : '',
      projectAssetIndex.agentIntentDecisionIntakeHelperAvailable ? 'src/shared/agent-intent-decision-intake.ts 已提供用户意图决策只读 intake' : '',
      projectAssetIndex.agentIntentDecisionIntakeSmokeAvailable ? 'smoke:agent:intent-decision-intake 已覆盖 lifecycle 缺失、聊天、确定性 skill、自主路由和 mismatch 边界' : '',
      projectAssetIndex.agentIntentDecisionIntakeReportAvailable ? 'acceptance report 已暴露 agentIntentDecisionIntake，避免路由证据散落' : '',
      projectAssetIndex.agentIntentDecisionIntakeNoExecutionBoundary ? 'agent intent decision intake 保持不调用模型/不执行 Photoshop 边界' : '',
      projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeHelperAvailable ? 'src/shared/live-photoshop-acceptance-intake.ts 已提供 live Photoshop artifact 聚焦与截图只读检查入口' : '',
      projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable ? 'smoke:live-photoshop:acceptance-evidence-intake 已覆盖无 artifact、非 live、snapshot-only、focus+snapshot、blocked 和 viewport claim 边界' : '',
      projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeNoQualityClaim ? 'live Photoshop evidence intake 保持 no-quality-claim 边界' : '',
      projectAssetIndex.agentAcceptanceTriageHelperAvailable ? 'src/shared/agent-acceptance-triage.ts 已提供验收问题定位摘要契约' : '',
      projectAssetIndex.agentAcceptanceTriageSmokeAvailable ? 'smoke:agent:acceptance-triage 已覆盖 routing、diagnostic boundary 和 passed 三类定位结果' : '',
      projectAssetIndex.agentAcceptanceTriageWiredToDebugExport ? 'acceptance debug export 已附加 acceptanceTriage，便于后续自动定位失败层级' : '',
      projectAssetIndex.agentAcceptanceTriageReportHelperAvailable ? 'src/shared/agent-acceptance-triage-report.ts 已提供验收定位报告格式化 helper' : '',
      projectAssetIndex.agentAcceptanceTriageReportCommandAvailable ? 'maintenance:acceptance-triage-report 可读取 acceptance JSON artifact 并输出 triage 摘要' : '',
      projectAssetIndex.agentAcceptanceTriageReportSmokeAvailable ? 'smoke:agent:acceptance-triage-report 已覆盖 triage 摘要与 Markdown 报告消费' : '',
      projectAssetIndex.agentAcceptanceTriageReportWiredToDesktopReport ? 'desktop acceptance Markdown 报告已嵌入 acceptance triage 摘要' : '',
      projectAssetIndex.agentAcceptanceDebugCarriesDiagnosticRecord ? 'Agent acceptance debug bundle 已携带隐藏 diagnosticRecord' : '',
      projectAssetIndex.agentAcceptanceControlPlaneHelperAvailable ? 'src/shared/agent-acceptance-control-plane.ts 已统一 offline、fake、real provider 和 live Photoshop 验收模式边界' : '',
      projectAssetIndex.agentAcceptanceControlPlaneSmokeAvailable ? 'smoke:agent:acceptance-control-plane 已覆盖默认可跑、显式 opt-in、live disposable 和未来模式边界' : '',
      projectAssetIndex.agentAcceptanceControlPlaneLiveGuarded ? 'live Photoshop 写入验收保持 takeover + disposable document 显式开关保护' : '',
      projectAssetIndex.chatPanelExportsDiagnosticRecord ? 'ChatPanel test bridge 已能从 assistant message 导出隐藏 diagnosticRecord' : '',
      projectAssetIndex.businessSkillDesignGovernanceDocAvailable ? 'docs/business-skill-design-governance.md 已记录主图、详情页、SKU 三个业务 skill 的拆分治理边界' : '',
      projectAssetIndex.businessSkillDesignGovernanceSmokeAvailable ? 'smoke:business-skill:design-governance 已覆盖业务 skill 拆分和用户确认检查点' : '',
      projectAssetIndex.businessSkillImplementationCheckpointHelperAvailable ? 'src/shared/business-skill-implementation-checkpoint.ts 已提供三大业务 skill 改造前检查点契约' : '',
      projectAssetIndex.businessSkillImplementationCheckpointSmokeAvailable ? 'smoke:business-skill:implementation-checkpoint 已覆盖用户检查点、证据齐备、FEX 边界和 UXP 工具边界' : '',
      projectAssetIndex.businessSkillReadinessContractHelperAvailable ? 'src/shared/business-skill-readiness-contract.ts 已提供业务 skill 策略改造前 readiness contract' : '',
      projectAssetIndex.businessSkillReadinessContractSmokeAvailable ? 'smoke:business-skill:readiness-contract 已覆盖策略输入、用户检查点、no-quality 和 raw payload 边界' : '',
      projectAssetIndex.businessSkillReadinessContractUsesImplementationCheckpoint ? '业务 skill readiness contract 复用 implementation checkpoint，不创建竞争门禁' : '',
      projectAssetIndex.businessSkillReadinessContractNoQualityClaim ? '业务 skill readiness contract 明确不能声明设计质量通过' : '',
      projectAssetIndex.ecommerceSocksStrategyCheckpointSmokeAvailable ? 'smoke:ecommerce-socks-design:strategy-checkpoint 已覆盖父 skill 到三子 skill 策略检查点' : '',
      projectAssetIndex.ecommerceSocksStrategyCheckpointNoQualityClaim ? '电商袜子父 skill 策略检查点明确不能声明整套设计完成' : '',
      projectAssetIndex.ecommerceSocksChildStrategyPacketsSmokeAvailable ? 'smoke:ecommerce-socks-design:child-strategy-packets 已覆盖三子 skill 策略输入包' : '',
      projectAssetIndex.ecommerceSocksChildStrategyPacketsNoImplementation ? '子 skill 策略输入包明确不能直接实施业务策略变更' : '',
      projectAssetIndex.ecommerceSocksChildStrategyReviewGateSmokeAvailable ? 'smoke:ecommerce-socks-design:child-strategy-review-gate 已覆盖三子 skill 策略评审门禁' : '',
      projectAssetIndex.ecommerceSocksChildStrategyReviewGateNoExecution ? '子 skill 策略评审门禁明确不能执行子 skill 或写 Photoshop' : '',
      projectAssetIndex.ecommerceSocksChildStrategyHandoffSmokeAvailable ? 'smoke:ecommerce-socks-design:child-strategy-handoff 已覆盖父级策略到三子 skill 输入补丁的交接 manifest' : '',
      projectAssetIndex.ecommerceSocksChildStrategyHandoffNoExecution ? '子 skill 策略交接 manifest 明确不能执行子 skill 或写 Photoshop' : '',
      projectAssetIndex.ecommerceSocksChildStrategyConsumptionSmokeAvailable ? 'smoke:ecommerce-socks-design:child-strategy-consumption 已覆盖三子 skill 消费父级策略输入' : '',
      projectAssetIndex.ecommerceSocksChildStrategyConsumptionNoExecution ? '子 skill 策略消费层仍是只读 planner evidence，不执行子 skill 或写 Photoshop' : '',
      projectAssetIndex.businessSkillExecutionPreflightGateHelperAvailable ? 'src/shared/business-skill-execution-preflight-gate.ts 已组合业务检查点、上下文证据和验收控制面' : '',
      projectAssetIndex.businessSkillExecutionPreflightGateSmokeAvailable ? 'smoke:business-skill:execution-preflight-gate 已覆盖三大业务 skill 执行前门禁边界' : '',
      projectAssetIndex.businessSkillExecutionPreflightGateNoExecutorChange ? '业务 skill 执行前门禁声明不改变现有业务 executor 行为' : '',
      projectAssetIndex.businessSkillExecutionPreflightEntrypointWired ? '统一 skill executor 入口已把 businessSkillExecutionPreflightGate 作为只读 result evidence 附加' : '',
      projectAssetIndex.businessSkillExecutionPreflightWiringSmokeAvailable ? 'smoke:business-skill:execution-preflight-wiring 已覆盖只读挂载、不阻断执行和非业务 skill 不挂载' : '',
      projectAssetIndex.businessSkillPreflightPlannerContextHelperAvailable ? 'src/shared/business-skill-preflight-planner-context.ts 已把业务执行预检转换成 planner/control 只读上下文' : '',
      projectAssetIndex.businessSkillPreflightPlannerContextWired ? '统一 skill executor 结果已附加 businessSkillPreflightPlannerContext，不阻断原业务执行' : '',
      projectAssetIndex.businessSkillPreflightPlannerContextNoQualityClaim ? '业务 skill planner/control context 明确不能声明设计质量通过' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshPlanHelperAvailable ? 'src/shared/business-skill-visual-observation-refresh-plan.ts 已提供缺视觉理解时的只读刷新计划' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshPlanSmokeAvailable ? 'smoke:business-skill:visual-evidence-refresh-plan 已覆盖默认禁用、显式启用、runtime 缺口和不改 executor 结果' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshPlanWired ? '统一 skill executor 结果已按需附加 businessSkillVisualObservationRefreshPlan，不自动调用模型' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshPlanDefaultDisabled ? '业务视觉证据刷新计划默认禁用，只能由显式 opt-in 后续 runner 执行' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshRunnerSmokeAvailable ? 'smoke:business-skill:visual-evidence-refresh-runner 已覆盖双开关、后置执行、红acted summary 和失败不翻转业务结果' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshRunnerWired ? '统一 skill executor 已在业务 executor 完成后调用视觉证据刷新 runner' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshRunnerPostExecutor ? '业务视觉证据刷新 runner 声明只能在业务 executor 后运行，不能改变当前 Photoshop 输出' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshRuntimeSmokeAvailable ? 'smoke:business-skill:visual-evidence-refresh-runtime 已覆盖 renderer runtime 能力自动探测' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshRuntimeAutoDetects ? '视觉证据刷新计划可从 window.designEcho 自动识别分析和缓存写入能力' : '',
      projectAssetIndex.businessSkillVisualContextPreparationHelperAvailable ? 'src/shared/business-skill-visual-context-preparation.ts 已提供业务 Skill 执行前视觉上下文准备结果' : '',
      projectAssetIndex.businessSkillVisualContextPreparationSmokeAvailable ? 'smoke:business-skill:visual-evidence-pre-execution-gate 已覆盖上下文缺失、显式前置刷新及不干预 executor' : '',
      projectAssetIndex.businessSkillVisualContextPreparationRunnerWired ? '统一 Skill executor 已支持显式 opt-in 的执行前视觉上下文刷新' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable ? 'smoke:business-skill:visual-evidence-refresh-executor-wiring 已覆盖统一 skill executor 入口' : '',
      projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint ? '统一入口 smoke 验证 executeSkillWithExecutor 后置刷新不改变业务 executor 结果' : '',
      projectAssetIndex.businessSkillVisualObservationDiagnosticSmokeAvailable ? 'smoke:business-skill:visual-evidence-diagnostic 已覆盖 control decision 进入 Debug Bundle/acceptance 报告' : '',
      projectAssetIndex.contextSnapshotCarriesVisualSampling ? 'ContextSnapshot 已携带 VisualSamplingPlan' : '',
      projectAssetIndex.contextSnapshotCarriesVisualInsightCache ? 'ContextSnapshot 已携带 VisualInsightCache 只读证据' : '',
      projectAssetIndex.runtimeServiceAvailable ? '主进程 runtime project service 已能只读构建 ContextSnapshot' : '',
      projectAssetIndex.runtimeBuildsVisualSampling ? 'runtime project service 已生成有界 VisualSamplingPlan' : '',
      projectAssetIndex.runtimeReadsVisualInsightCache ? 'runtime project service 已读取持久视觉理解缓存' : '',
      projectAssetIndex.runtimeWritesVisualInsightCache ? 'runtime project service 已支持写入持久视觉理解缓存' : '',
      projectAssetIndex.ipcHandlerAvailable && projectAssetIndex.preloadApiAvailable ? 'IPC/preload 已暴露 buildProjectContextSnapshot' : '',
      projectAssetIndex.ipcWriteVisualInsightCacheAvailable && projectAssetIndex.preloadWriteVisualInsightCacheAvailable ? 'IPC/preload 已暴露 writeProjectVisualInsightCache' : '',
      projectAssetIndex.rendererContextConsumesSnapshot ? 'Agent getProjectContext 已携带 assetIndex/contextSnapshot' : '',
      projectAssetIndex.rendererContextCarriesVisualSampling ? 'Agent getProjectContext 已携带 visualSamplingPlan' : '',
      projectAssetIndex.rendererContextCarriesVisualInsightCache ? 'Agent getProjectContext 已携带 visualInsightCache' : '',
      projectAssetIndex.plannerConsumesVisualSampling ? 'Design Planner 已消费 projectContext.visualSamplingPlan' : '',
      projectAssetIndex.plannerConsumesVisualInsightCache ? 'Design Planner 已消费 projectContext.visualInsightCache' : '',
      projectAssetIndex.plannerEvidenceConsumesAssetIndex ? '主图、详情页、SKU、参考图复刻 planner evidence 已消费 assetIndex' : '',
      projectAssetIndex.parsesSkuConfigCsv ? 'SKU CSV 配置解析已进入索引 evidence' : ''
    ],
    gaps: [
      '索引只基于路径、文件名、尺寸、扩展名和配置，不能声明款式、场景、材质、卖点或最佳图片。',
      'opt-in 缓存填充 runner 只是受限视觉证据采集基础设施；尚未完成真实 provider / C-1140 项目 / 业务 skill 门禁联调。',
      '运行时接入不等于业务设计质量已完成；主图、详情页、SKU 仍需独立端到端验收。'
    ],
    validations: [
      'npm run smoke:project-asset-index',
      'npm run smoke:project-visual-sampling',
      'npm run smoke:project-visual-insight-cache',
      'npm run smoke:project-visual-insight-cache-fill',
      'npm run smoke:project-context-runtime',
      'npm run smoke:project-asset-index:live-c1140',
      'npm run smoke:design-planner:mvp',
      'npm run build:typecheck:renderer'
    ]
  }));

  gates.push(buildGate({
    id: 'image-placement-core',
    title: 'M2 Image Placement Core',
    goal: '建立跨主图、详情页、SKU、参考图复刻可复用的图片置入规划和执行后验证契约，同时保持业务 skill 未经用户确认不被改写。',
    status: inferStatus([
      imagePlacementCore.helperAvailable,
      imagePlacementCore.docAvailable,
      imagePlacementCore.readinessReportAvailable,
      imagePlacementCore.smokeAvailable,
      imagePlacementCore.readinessSmokeAvailable,
      imagePlacementCore.wrapsSmartScalingPolicy,
      imagePlacementCore.requiresActualBoundsReadback
    ], [
      imagePlacementCore.businessSkillsNotDirectlyWired ? '当前刻意不接入业务 skill 执行路径，等待用户确认具体设计规则。' : '',
      imagePlacementCore.smokeInPreflight ? '' : 'smoke:image-placement:core 尚未进入 maintenance:preflight。',
      imagePlacementCore.readinessSmokeInPreflight ? '' : 'smoke:image-placement:readiness 尚未进入 maintenance:preflight。',
      '尚未做真实 Photoshop disposable 置入 live case，不能声明视觉质量或执行稳定性完成。'
    ]),
    evidence: [
      imagePlacementCore.helperAvailable ? 'src/shared/design-image-placement-core.ts 已提供 buildImagePlacementPlan / verifyImagePlacement' : '',
      imagePlacementCore.docAvailable ? 'docs/image-placement-core-mvp.md 已记录速度、质量、稳定性和非目标边界' : '',
      imagePlacementCore.readinessReportAvailable ? 'report-image-placement-core-readiness 已提供业务接入前只读就绪度报告' : '',
      imagePlacementCore.smokeAvailable ? 'smoke:image-placement:core 已覆盖 metadata downgrade、subject bounds、actualBounds 和 screenshot failure' : '',
      imagePlacementCore.readinessSmokeAvailable ? 'smoke:image-placement:readiness 已覆盖 UXP 证据、业务未接入和质量声明边界' : '',
      imagePlacementCore.wrapsSmartScalingPolicy ? 'Image Placement Core 复用 design-smart-scaling-policy，不新增第二套缩放算法' : '',
      imagePlacementCore.requiresActualBoundsReadback ? '契约明确 planned destinationBox 不是 Photoshop actualBounds' : '',
      imagePlacementCore.businessSkillsNotDirectlyWired ? 'MVP 未直接改写 main-image/detail-page/SKU executor' : ''
    ],
    gaps: [
      '当前是共享契约和 smoke，不执行 Photoshop、不调用模型、不选择最佳图片。',
      '业务接入必须先经过用户确认，因为会影响 main-image-design、detail-page-design 或 sku-batch 的真实输出。',
      '仍缺真实 Photoshop 置入、读回、截图失败和局部微调的 live case。'
    ],
    validations: [
      'npm run smoke:image-placement:core',
      'npm run smoke:image-placement:readiness',
      'npm run build:main',
      'npm run build:typecheck:renderer'
    ]
  }));

  gates.push(buildGate({
    id: 'agent-performance-policy',
    title: 'M0k Agent 性能预算与资源控制面',
    goal: '把模型调用、Photoshop 工具调用、视觉分析、图片读取和验收等级纳入统一预算，避免复杂设计任务失控或简单操作绕远路。',
    status: inferStatus([
      agentPerformancePolicy.helperAvailable,
      agentPerformancePolicy.smokeAvailable,
      agentPerformancePolicy.plannerBuildsPolicy,
      agentPerformancePolicy.plannerExposesPolicy,
      agentPerformancePolicy.selectedContextCarriesPolicy,
      agentPerformancePolicy.runtimeBudgetHelperAvailable,
      agentPerformancePolicy.autonomousAgentUsesRuntimeBudget,
      agentPerformancePolicy.designTeamRuntimeBudgetHelperAvailable,
      agentPerformancePolicy.designTeamRegistryUsesRuntimeBudget,
      agentPerformancePolicy.designTeamCoordinatorUsesRuntimeBudget,
      agentPerformancePolicy.smokeCoversDesignTeamBudget,
      agentPerformancePolicy.contextWindowBudgetHelperAvailable,
      agentPerformancePolicy.contextManagerUsesWindowBudget,
      agentPerformancePolicy.agentRuntimeUsesContextDefault,
      agentPerformancePolicy.smokeCoversContextWindowBudget,
      agentPerformancePolicy.resourceCacheBudgetHelperAvailable,
      agentPerformancePolicy.resourceManagerUsesCacheBudget,
      agentPerformancePolicy.smokeCoversResourceCacheBudget,
      agentPerformancePolicy.providerTokenBudgetHelperAvailable,
      agentPerformancePolicy.providerAdaptersUseTokenBudget,
      agentPerformancePolicy.modelServiceUsesTokenBudget,
      agentPerformancePolicy.streamAdapterUsesTokenBudget,
      agentPerformancePolicy.smokeCoversProviderTokenBudget,
      agentPerformancePolicy.acceptanceCaptureBudgetHelperAvailable,
      agentPerformancePolicy.toolAcceptanceUsesCaptureBudget,
      agentPerformancePolicy.smokeCoversAcceptanceBudget,
      agentPerformancePolicy.visualSamplingBudgetHelperAvailable,
      agentPerformancePolicy.projectVisualSamplingUsesBudget,
      agentPerformancePolicy.smokeCoversVisualSamplingBudget,
      agentPerformancePolicy.policyForbidsBulkScan,
      agentPerformancePolicy.policyForbidsFullResolutionRead,
      agentPerformancePolicy.implementationTreeMentionsPerformance
    ], [
      '当前是只读预算 evidence，不改变已有执行器参数、工具顺序或模型调用策略。',
      '后续需要把 policy 从观察证据推进到硬执行预算、超限停止、缓存写入和 UI 资源提示。'
    ]),
    evidence: [
      agentPerformancePolicy.helperAvailable ? 'src/shared/agent-performance-policy.ts 已定义不可变性能预算和资源边界' : '',
      agentPerformancePolicy.smokeAvailable ? 'smoke:agent:performance-policy 已覆盖聊天、简单图层、详情页和 planner 只读接入' : '',
      agentPerformancePolicy.plannerBuildsPolicy ? 'Design Planner 已为计划输出构造 performancePolicy' : '',
      agentPerformancePolicy.selectedContextCarriesPolicy ? 'selectedContext 已携带性能预算摘要' : '',
      agentPerformancePolicy.runtimeBudgetHelperAvailable ? 'autonomous-agent legacy runtime 迭代预算已迁入 AgentPerformancePolicy helper' : '',
      agentPerformancePolicy.autonomousAgentUsesRuntimeBudget ? 'autonomous-agent executor 已从 policy helper 读取默认 maxIterations' : '',
      agentPerformancePolicy.designTeamRuntimeBudgetHelperAvailable ? 'design-team teammate 角色迭代预算 helper 已进入 AgentPerformancePolicy' : '',
      agentPerformancePolicy.designTeamCoordinatorUsesRuntimeBudget ? 'design-team coordinator 已从 policy helper 读取默认 maxIterations' : '',
      agentPerformancePolicy.contextManagerUsesWindowBudget ? 'ContextManager 默认上下文窗口预算已从 policy helper 读取' : '',
      agentPerformancePolicy.resourceManagerUsesCacheBudget ? 'ResourceManager 扫描/PSD 预览缓存预算已从 policy helper 读取' : '',
      agentPerformancePolicy.providerTokenBudgetHelperAvailable ? 'provider adapter 默认输出 token 预算 helper 已进入 AgentPerformancePolicy' : '',
      agentPerformancePolicy.providerAdaptersUseTokenBudget ? 'OpenAI/Anthropic/Gemini/Ollama adapters 已从 policy helper 读取默认 maxTokens' : '',
      agentPerformancePolicy.modelServiceUsesTokenBudget ? 'ModelService 文本调用默认 maxTokens 已从 policy helper 读取' : '',
      agentPerformancePolicy.streamAdapterUsesTokenBudget ? 'stream-adapter 流式调用默认 maxTokens 已从 policy helper 读取' : '',
      agentPerformancePolicy.acceptanceCaptureBudgetHelperAvailable ? 'tool acceptance capture 预算 helper 已进入 AgentPerformancePolicy' : '',
      agentPerformancePolicy.toolAcceptanceUsesCaptureBudget ? 'tool acceptance 已从 policy helper 读取 maxLayers、timeoutMs 和 changed layer 默认值' : '',
      agentPerformancePolicy.visualSamplingBudgetHelperAvailable ? 'visual sampling 候选预算 helper 已进入 AgentPerformancePolicy' : '',
      agentPerformancePolicy.projectVisualSamplingUsesBudget ? 'ProjectVisualSamplingPlan 已从 policy helper 读取候选默认值和硬上限' : '',
      agentPerformancePolicy.policyForbidsBulkScan ? '默认禁止全项目视觉批量扫描' : '',
      agentPerformancePolicy.policyForbidsFullResolutionRead ? '默认禁止全分辨率图片读取' : ''
    ],
    gaps: [
      '性能策略已接管 autonomous-agent legacy maxIterations、design-team teammate maxIterations、ContextManager 上下文窗口、ResourceManager 缓存 TTL、provider adapter/model-service/stream-adapter maxTokens、tool acceptance capture 预算和 ProjectVisualSamplingPlan 候选默认值，但尚未按 taskClass 动态调整所有 runtime 和 provider timeout。',
      '视觉分析缓存写入和真实耗时指标还未接入。'
    ],
    validations: [
      'npm run smoke:agent:performance-policy',
      'npm run smoke:design-planner:mvp',
      'npm run smoke:project-visual-sampling',
      'npm run build:typecheck:renderer'
    ]
  }));

  gates.push(buildGate({
    id: 'reference-replication-loop',
    title: '参考图复刻最小闭环',
    goal: '从参考图解析到可编辑骨架、匹配、基础 QA 和完成判定。',
    status: inferStatus([
      exists(agentRoot, 'src/shared/reference-replication.ts'),
      exists(agentRoot, 'src/shared/reference-replication-blueprint.ts'),
      exists(agentRoot, 'src/renderer/services/skill-executors/layout-replication.executor.ts'),
      exists(agentRoot, 'src/renderer/services/skill-executors/layout-replication-completion.ts'),
      hasScript(packageJson, 'smoke:layout-replication:completion'),
      hasScript(packageJson, 'smoke:reference:visual-qa'),
      hasScript(packageJson, 'smoke:reference:screenshot-pixel-probe'),
      hasScript(packageJson, 'benchmark:reference-replication:validate'),
      hasScript(packageJson, 'smoke:reference:benchmark-coverage'),
      hasScript(packageJson, 'maintenance:reference-live-readiness'),
      hasScript(packageJson, 'smoke:reference:live-readiness'),
      referenceBenchmarkCoverage.hasRepresentativeSeedCoverage,
      fileIncludes(agentRoot, 'scripts/smoke-layout-replication-completion.cjs', 'no-executable-match-is-not-success'),
      fileIncludes(agentRoot, 'scripts/smoke-reference-visual-qa.cjs', 'rawImagesRedacted'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/layout-replication-completion.ts', 'completionContract'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/layout-replication-completion.ts', 'formatLayoutReplicationUserReport'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/layout-replication.executor.ts', 'referenceReplicationReport'),
      fileIncludes(agentRoot, 'scripts/smoke-layout-replication-completion.cjs', 'template-pixel-probe-user-report-is-readable-and-not-overclaimed'),
      fileIncludes(agentRoot, 'src/shared/reference-replication-visual-qa.ts', 'isContainedTextEnvelope'),
      fileIncludes(agentRoot, 'scripts/smoke-reference-visual-qa.cjs', 'text-envelope-watch'),
      hasScript(packageJson, 'smoke:reference:neutral-text-pixel-bounds'),
      fileIncludes(agentRoot, 'scripts/smoke-reference-neutral-text-pixel-bounds.cjs', 'expectedBox may be a layout envelope'),
      hasScript(packageJson, 'smoke:chat-ui:reference-replication:neutral'),
      fileIncludes(agentRoot, 'scripts/smoke-chat-ui-reference-replication.cjs', 'neutral text envelope drift stayed review-grade instead of hard-blocked')
    ], [
      '代表性 benchmark 当前是 seed coverage，仍缺真实商业样本、真实 Photoshop 结果截图和人工评分。',
      '高级 Photoshop recipe 还没完成。'
    ]),
    evidence: [
      '参考图解析、最小表示、blueprint、match、apply、QA、completion 已拆出',
      '无匹配、部分失败、零成功调整不再报告完成',
      exists(agentRoot, 'benchmarks/reference-replication/cases/rr-001-fex-certificate-text-layout.json')
        ? '临时简单文字排版 benchmark case 已录入；仅用于验证基础文本排版'
        : '',
      fileIncludes(agentRoot, 'benchmarks/reference-replication/cases/rr-001-fex-certificate-text-layout.json', '"screenshot-pixel-probe"')
        ? 'reference benchmark 已声明 screenshot-pixel-probe 验收契约'
        : '',
      referenceBenchmarkCoverage.hasRepresentativeSeedCoverage
        ? `reference benchmark 已覆盖代表性 seed 类别：${referenceBenchmarkCoverage.categories.join(', ')}`
        : '',
      referenceBenchmarkCoverage.syntheticCaseCount > 0
        ? `其中 ${referenceBenchmarkCoverage.syntheticCaseCount} 个 case 是 synthetic fixture，仅代表输入覆盖`
        : '',
      hasScript(packageJson, 'maintenance:reference-live-readiness')
        ? '真实 capture 前置体检已存在，可只读检查 build、case、参考图、状态文件、结果路径和默认端口占用'
        : '',
      fileIncludes(agentRoot, 'src/shared/reference-replication-visual-qa.ts', 'isContainedTextEnvelope')
        ? '文本 plannedBox 与真实字形 bounds 已区分：包络内文本偏差为 watch，不作为图片/形状硬 bounds 放宽'
        : '',
      fileIncludes(agentRoot, 'scripts/smoke-reference-neutral-text-pixel-bounds.cjs', 'expectedBox may be a layout envelope')
        ? '中性文字排版参考图已有像素级 fixture 检查，证明 expectedBox 是文本包络假设而非 Photoshop 输出验收'
        : '',
      fileIncludes(agentRoot, 'scripts/smoke-chat-ui-reference-replication.cjs', 'neutral text envelope drift stayed review-grade instead of hard-blocked')
        ? '中性文字排版 UI smoke 已锁定 review-grade 边界，不宣称高保真复刻'
        : '',
      simpleTextLayoutLivePixelProbeOk
        ? '简单文字排版工具级 live smoke 已生成真实 Photoshop 截图并通过 screenshot pixel probe'
        : ''
    ],
    gaps: [
      simpleTextLayoutLivePixelProbeOk
        ? '不能宣称通用高保真复刻；真实 Agent UI + 真实模型解析 + 真实 Photoshop 的端到端截图验收仍未完成。'
        : '不能宣称高保真复刻；真实 Photoshop 结果截图和像素相似度评分仍未完成。'
    ],
    validations: [
      'npm run smoke:reference:blueprint-groups',
      'npm run smoke:layout-replication:completion',
      'npm run smoke:reference:match-validation',
      'npm run smoke:reference:style-recipes',
      'npm run benchmark:reference-replication:validate',
      'npm run smoke:reference:benchmark-coverage',
      'npm run smoke:reference:screenshot-pixel-probe',
      'npm run smoke:reference:live-readiness',
      'npm run smoke:reference:benchmark-scope',
      'npm run smoke:reference:neutral-text-pixel-bounds',
      'npm run smoke:chat-ui:reference-replication:neutral',
      'npm run smoke:reference:fex-text-placement-live'
    ]
  }));

  const hasDesignPlannerMvp = exists(agentRoot, 'src/shared/design-planner.ts')
    && exists(agentRoot, 'docs/design-planner-mvp-plan.md')
    && hasScript(packageJson, 'smoke:design-planner:mvp');
  gates.push(buildGate({
    id: 'design-planner',
    title: 'Design Planner 控制层',
    goal: '把用户需求、上下文、知识、DSL、执行计划和验收目标组织成 plan-only 输出。',
    status: inferStatus([
      exists(agentRoot, 'docs/design-planner-mvp-plan.md'),
      exists(agentRoot, 'src/shared/design-planner.ts'),
      hasScript(packageJson, 'smoke:design-planner:mvp'),
      hasScript(packageJson, 'smoke:design-planner:preflight-control'),
      fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'planDesignTask'),
      fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'buildPlannerExecutionPreflightGate'),
      fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'mapPlannerOutputToDesignAgentOsRecord'),
      hasScript(packageJson, 'smoke:design-planner:executor-evidence'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/design-planner-context.ts', 'buildPlannerExecutionPreflightGate'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/layout-replication.executor.ts', 'designPlanner'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/layout-replication.executor.ts', 'designPlannerPreflightGate'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/main-image.executor.ts', 'designPlanner'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/main-image.executor.ts', 'designPlannerPreflightGate'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/detail-page.executor.ts', 'designPlanner'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/sku-batch.executor.ts', 'designPlanner'),
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/layout-replication.executor.ts', 'designPlannerExecutionAlignment')
    ], [
      '当前 Planner 是 plan-only MVP，不执行 Photoshop，也不证明设计质量成熟。',
      'Planner 已进入代表链路的执行前 gate，但尚未覆盖全部开放式设计任务，也尚未控制完整 Photoshop 执行生命周期。'
    ]),
    evidence: [
      hasDesignPlannerMvp ? 'Design Planner MVP 规划、共享模块和 smoke 已存在' : '',
      fileIncludes(agentRoot, 'src/shared/design-planner.ts', 'readiness') ? 'Planner 输出 readiness / blockers / warnings' : '',
      fileIncludes(agentRoot, 'scripts/smoke-design-planner-mvp.cjs', 'save request keeps save action') ? 'smoke 覆盖保存/聊天/设计任务边界' : '',
      fileIncludes(agentRoot, 'scripts/smoke-design-planner-preflight-control.cjs', 'needs_context stops open-ended design execution before Photoshop writes') ? 'smoke:design-planner:preflight-control 已覆盖 needs_context 停止、blocked 阻断、ready 放行和 no-success-claim 边界' : '',
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/layout-replication.executor.ts', 'buildReferenceReplicationPlannerContext') ? '参考图复刻结果已附加只读 planner evidence 并消费 preflight readiness' : '',
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/main-image.executor.ts', 'main-image-before-subject-detection') ? '主图执行器已在主体检测和 Photoshop 写操作前消费 planner preflight gate' : '',
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/design-planner-context.ts', 'comparePlannerExecutionPlanToExecutor') ? '参考图复刻已比较 planner executionPlan 与 executor evidence 类别' : '',
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/main-image.executor.ts', 'buildMainImagePlannerContext') ? '主图结果已附加只读 planner evidence' : '',
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/detail-page.executor.ts', 'buildDetailPagePlannerContext') ? '详情页结果已附加只读 planner evidence' : '',
      fileIncludes(agentRoot, 'src/renderer/services/skill-executors/sku-batch.executor.ts', 'buildSkuBatchPlannerContext') ? 'SKU 结果已附加只读 planner evidence' : ''
    ],
    gaps: [
      hasDesignPlannerMvp ? '当前 Planner 是 plan-only MVP，尚未驱动真实 Photoshop 执行。' : 'Design Planner MVP 尚未实现。',
      'Planner preflight gate 已接入 reference-replication/main-image 代表链路；detail-page/SKU/copywriting 仍主要是只读 evidence。'
    ],
    validations: [
      'npm run smoke:design-planner:mvp',
      'npm run smoke:design-planner:preflight-control',
      'npm run smoke:design-planner:executor-evidence',
      'npm run build:typecheck:renderer'
    ]
  }));

  gates.push(buildGate({
    id: 'main-image-agent-draft-loop',
    title: 'M5-P1 主图 skill 控制层草案',
    goal: '把“用户需要做主图”收口为 Agent 可选择的业务 skill 场景，先输出统一控制层计划、DSL、执行步骤和验收边界；具体主图设计策略后续再单独设计。仍不改变既有 Photoshop 执行参数。',
    status: inferStatus([
      mainImageAgentDraft.helperAvailable,
      mainImageAgentDraft.assetSelectionHelperAvailable,
      mainImageAgentDraft.visualLoopHelperAvailable,
      mainImageAgentDraft.visionPreflightHelperAvailable,
      mainImageAgentDraft.executionAlignmentHelperAvailable,
      mainImageAgentDraft.screenshotQaHelperAvailable,
      mainImageAgentDraft.screenshotProbeReadinessHelperAvailable,
      mainImageAgentDraft.qaReportHelperAvailable,
      mainImageAgentDraft.strategyContractHelperAvailable,
      mainImageAgentDraft.strategyInputBuilderHelperAvailable,
      mainImageAgentDraft.assetHeroStrategyHelperAvailable,
      mainImageAgentDraft.projectStyleStrategyHelperAvailable,
      mainImageAgentDraft.designStandardsHelperAvailable,
      mainImageAgentDraft.designReadinessReportHelperAvailable,
      mainImageAgentDraft.liveExecutorRequestHelperAvailable,
      mainImageAgentDraft.liveExecutorCheckpointHelperAvailable,
      mainImageAgentDraft.liveExecutorRunnerHelperAvailable,
      mainImageAgentDraft.livePhotoshopAdapterContractHelperAvailable,
      mainImageAgentDraft.liveAdapterHandoffHelperAvailable,
      mainImageAgentDraft.livePhotoshopToolAdapterHelperAvailable,
      mainImageAgentDraft.variantPlacementStrategyHelperAvailable,
      mainImageAgentDraft.productionStructureHelperAvailable,
      mainImageAgentDraft.smokeAvailable,
      mainImageAgentDraft.strategyContractSmokeAvailable,
      mainImageAgentDraft.strategyInputBuilderSmokeAvailable,
      mainImageAgentDraft.assetHeroStrategySmokeAvailable,
      mainImageAgentDraft.projectStyleStrategySmokeAvailable,
      mainImageAgentDraft.designStandardsSmokeAvailable,
      mainImageAgentDraft.designReadinessReportSmokeAvailable,
      mainImageAgentDraft.liveExecutorRequestSmokeAvailable,
      mainImageAgentDraft.liveExecutorCheckpointSmokeAvailable,
      mainImageAgentDraft.liveExecutorRunnerSmokeAvailable,
      mainImageAgentDraft.livePhotoshopAdapterContractSmokeAvailable,
      mainImageAgentDraft.liveAdapterHandoffSmokeAvailable,
      mainImageAgentDraft.livePhotoshopToolAdapterSmokeAvailable,
      mainImageAgentDraft.liveToolAdapterDisposableSmokeAvailable,
      mainImageAgentDraft.liveToolAdapterDisposableClassificationSmokeAvailable,
      mainImageAgentDraft.variantPlacementStrategySmokeAvailable,
      mainImageAgentDraft.productionStructureSmokeAvailable,
      mainImageAgentDraft.assetSelectionSmokeAvailable,
      mainImageAgentDraft.visualLoopSmokeAvailable,
      mainImageAgentDraft.visionPreflightSmokeAvailable,
      mainImageAgentDraft.candidatePreflightSmokeAvailable,
      mainImageAgentDraft.executionAlignmentSmokeAvailable,
      mainImageAgentDraft.screenshotQaSmokeAvailable,
      mainImageAgentDraft.screenshotProbeReadinessSmokeAvailable,
      mainImageAgentDraft.pixelProbeAdapterSmokeAvailable,
      mainImageAgentDraft.qaReportSmokeAvailable,
      mainImageAgentDraft.smokeInPreflight,
      mainImageAgentDraft.strategyContractSmokeInPreflight,
      mainImageAgentDraft.strategyInputBuilderSmokeInPreflight,
      mainImageAgentDraft.assetHeroStrategySmokeInPreflight,
      mainImageAgentDraft.projectStyleStrategySmokeInPreflight,
      mainImageAgentDraft.designStandardsSmokeInPreflight,
      mainImageAgentDraft.designReadinessReportSmokeInPreflight,
      mainImageAgentDraft.liveExecutorRequestSmokeInPreflight,
      mainImageAgentDraft.liveExecutorCheckpointSmokeInPreflight,
      mainImageAgentDraft.liveExecutorRunnerSmokeInPreflight,
      mainImageAgentDraft.livePhotoshopAdapterContractSmokeInPreflight,
      mainImageAgentDraft.liveAdapterHandoffSmokeInPreflight,
      mainImageAgentDraft.livePhotoshopToolAdapterSmokeInPreflight,
      mainImageAgentDraft.liveToolAdapterDisposableSmokeInPreflight,
      mainImageAgentDraft.liveToolAdapterDisposableClassificationSmokeInPreflight,
      mainImageAgentDraft.variantPlacementStrategySmokeInPreflight,
      mainImageAgentDraft.productionStructureSmokeInPreflight,
      mainImageAgentDraft.assetSelectionSmokeInPreflight,
      mainImageAgentDraft.visualLoopSmokeInPreflight,
      mainImageAgentDraft.visionPreflightSmokeInPreflight,
      mainImageAgentDraft.candidatePreflightSmokeInPreflight,
      mainImageAgentDraft.executionAlignmentSmokeInPreflight,
      mainImageAgentDraft.screenshotQaSmokeInPreflight,
      mainImageAgentDraft.screenshotProbeReadinessSmokeInPreflight,
      mainImageAgentDraft.pixelProbeAdapterSmokeInPreflight,
      mainImageAgentDraft.qaReportSmokeInPreflight,
      mainImageAgentDraft.plannerEvidenceAttached,
      mainImageAgentDraft.plannerPassesStrategyContract,
      mainImageAgentDraft.strategyContractNoExecution,
      mainImageAgentDraft.strategyInputBuilderNoExecution,
      mainImageAgentDraft.assetHeroStrategyNoExecution,
      mainImageAgentDraft.projectStyleStrategyNoExecution,
      mainImageAgentDraft.designStandardsNoExecution,
      mainImageAgentDraft.designReadinessReportNoExecution,
      mainImageAgentDraft.liveExecutorRequestNoExecution,
      mainImageAgentDraft.liveExecutorCheckpointNoExecution,
      mainImageAgentDraft.liveExecutorRunnerRequiresAdapter,
      mainImageAgentDraft.liveExecutorRunnerBlocksNonDisposable,
      mainImageAgentDraft.liveExecutorRunnerNoQualityClaim,
      mainImageAgentDraft.livePhotoshopAdapterContractNoWrite,
      mainImageAgentDraft.livePhotoshopAdapterContractMapsExportGroup,
      mainImageAgentDraft.livePhotoshopAdapterContractMapsDestinationBoxMoveLayer,
      mainImageAgentDraft.livePhotoshopAdapterContractMapsNestedGroups,
      mainImageAgentDraft.livePhotoshopAdapterContractNoQualityClaim,
      mainImageAgentDraft.liveAdapterHandoffNoWrite,
      mainImageAgentDraft.liveAdapterHandoffNoQualityClaim,
      mainImageAgentDraft.liveAdapterHandoffBlocksProduction,
      mainImageAgentDraft.livePhotoshopToolAdapterRequiresApproval,
      mainImageAgentDraft.livePhotoshopToolAdapterBlocksNonDisposable,
      mainImageAgentDraft.livePhotoshopToolAdapterNoProduction,
      mainImageAgentDraft.livePhotoshopToolAdapterNoQualityClaim,
      mainImageAgentDraft.liveToolAdapterDisposableDefaultSkipped,
      mainImageAgentDraft.liveToolAdapterDisposableRequiresLiveFlag,
      mainImageAgentDraft.liveToolAdapterDisposableRequiresDisposableFlag,
      mainImageAgentDraft.liveToolAdapterDisposablePreprocessesPlaceImageFilePath,
      mainImageAgentDraft.liveToolAdapterDisposableHasMcpTimeoutBoundary,
      mainImageAgentDraft.liveToolAdapterDisposableHasCleanupTimeoutBoundary,
      mainImageAgentDraft.liveToolAdapterDisposableHasHealthStatus,
      mainImageAgentDraft.liveToolAdapterDisposableHasRecoveryActions,
      mainImageAgentDraft.variantPlacementStrategyNoExecution,
      mainImageAgentDraft.strategyInputBuilderUsesAssetHeroStrategy,
      mainImageAgentDraft.strategyInputBuilderUsesProjectStyleStrategy,
      mainImageAgentDraft.strategyInputBuilderUsesDesignStandards,
      mainImageAgentDraft.strategyInputBuilderUsesDesignReadinessReport,
      mainImageAgentDraft.strategyInputBuilderUsesLiveExecutorRequest,
      mainImageAgentDraft.strategyInputBuilderUsesVariantPlacementStrategy,
      mainImageAgentDraft.draftExposesStrategyContract,
      mainImageAgentDraft.draftExposesStrategyInputEvidence,
      mainImageAgentDraft.draftUsesStrategyInputBuilder,
      mainImageAgentDraft.draftPlanUsesAssetSelection,
      mainImageAgentDraft.draftPlanUsesVisualLoop,
      mainImageAgentDraft.executorCanRunVisionPreflight,
      mainImageAgentDraft.executorExposesCandidatePreflight,
      mainImageAgentDraft.executorExposesExecutionAlignment,
      mainImageAgentDraft.executorExposesScreenshotQa,
      mainImageAgentDraft.executorExposesScreenshotProbeReadiness,
      mainImageAgentDraft.executorRunsPixelProbeAdapter,
      mainImageAgentDraft.executorExposesQaReport,
      mainImageAgentDraft.resourceProbeImageFileAvailable,
      mainImageAgentDraft.resourceCompareImageFilesAvailable,
      mainImageAgentDraft.plannerAcceptsVisionSignal,
      mainImageAgentDraft.executorExposesDraft,
      mainImageAgentDraft.executorExposesAssetSelection,
      mainImageAgentDraft.executorExposesVisualLoop,
      fileIncludes(agentRoot, 'src/shared/main-image-agent-draft-plan.ts', 'selectedAssetStrategy'),
      fileIncludes(agentRoot, 'src/shared/main-image-asset-selection.ts', 'buildMainImageCandidatePreflightPlan'),
      fileIncludes(agentRoot, 'src/shared/main-image-asset-selection.ts', '不做真实视觉审美判断'),
      fileIncludes(agentRoot, 'src/shared/main-image-visual-loop.ts', '缺少视觉模型或人工标注'),
      fileIncludes(agentRoot, 'src/shared/main-image-visual-loop.ts', '缺少结果截图或导出图证据'),
      fileIncludes(agentRoot, 'src/shared/main-image-screenshot-qa.ts', 'rawImagesRedacted=true'),
      fileIncludes(agentRoot, 'src/shared/main-image-screenshot-probe-readiness.ts', '结果文件可解码只能证明导出存在'),
      fileIncludes(agentRoot, 'src/shared/main-image-qa-report.ts', 'qualityClaim'),
      fileIncludes(agentRoot, 'src/shared/main-image-qa-report.ts', '不是模型自动审美评分'),
      fileIncludes(agentRoot, 'src/shared/main-image-agent-draft-plan.ts', 'verify-main-image-draft'),
      fileIncludes(agentRoot, 'scripts/smoke-main-image-agent-draft-plan.cjs', 'no-overclaim-without-screenshot-or-manual-review'),
      fileIncludes(agentRoot, 'scripts/smoke-main-image-qa-report.cjs', 'pixelProbe ok without manual review must not allow quality claim')
    ], [
      'M5-P1 当前只是主图业务 skill 的控制层与只读 evidence，不是完整主图设计策略，也不是主图自动设计质量完成。',
      '仍缺真实项目素材自动选择、真实截图验收、人工评分和端到端 UI 手测。'
    ]),
    evidence: [
      mainImageAgentDraft.helperAvailable ? 'src/shared/main-image-agent-draft-plan.ts 已存在，输出主图 intent/brief/DSL/executionPlan/verificationReport' : '',
      mainImageAgentDraft.assetSelectionHelperAvailable ? 'src/shared/main-image-asset-selection.ts 已存在，输出素材候选、门禁、阻断项和 metadata-only 边界' : '',
      mainImageAgentDraft.visualLoopHelperAvailable ? 'src/shared/main-image-visual-loop.ts 已存在，输出素材视觉理解缺口和截图/人工复核门禁' : '',
      mainImageAgentDraft.visionPreflightHelperAvailable ? 'src/shared/main-image-vision-preflight.ts 已存在，提供显式启用的主图素材视觉预检映射' : '',
      mainImageAgentDraft.executionAlignmentHelperAvailable ? 'src/shared/main-image-execution-alignment.ts 已存在，对齐主图 DSL、执行计划和真实工具证据' : '',
      mainImageAgentDraft.screenshotQaHelperAvailable ? 'src/shared/main-image-screenshot-qa.ts 已存在，输出结果图、pixel probe、人工复核和质量声明边界' : '',
      mainImageAgentDraft.screenshotProbeReadinessHelperAvailable ? 'src/shared/main-image-screenshot-probe-readiness.ts 已存在，输出结果图文件探针、probe target 和 no-overclaim readiness' : '',
      mainImageAgentDraft.qaReportHelperAvailable ? 'src/shared/main-image-qa-report.ts 已存在，聚合主图上下文、执行、截图、探针和人工复核证据' : '',
      mainImageAgentDraft.strategyContractHelperAvailable ? 'src/shared/main-image-strategy-contract.ts 已存在，先收口主图策略设计输入、父级 review gate 和不执行 Photoshop 的边界' : '',
      mainImageAgentDraft.strategyInputBuilderHelperAvailable ? 'src/shared/main-image-strategy-input-builder.ts 已存在，从真实上下文生成主图策略输入 evidence，不调用模型或 Photoshop' : '',
      mainImageAgentDraft.assetHeroStrategyHelperAvailable ? 'src/shared/main-image-asset-hero-strategy.ts 已存在，分离主图素材理解和主体选择策略 evidence' : '',
      mainImageAgentDraft.projectStyleStrategyHelperAvailable ? 'src/shared/main-image-project-style-strategy.ts 已存在，要求先基于视觉/人工信号理解袜子款式，再规划点击图和转化图方向' : '',
      mainImageAgentDraft.designStandardsHelperAvailable ? 'src/shared/main-image-design-standards.ts 已存在，要求先完成主图设计规范和知识检查，再进入点击图和转化图策略' : '',
      mainImageAgentDraft.designReadinessReportHelperAvailable ? 'src/shared/main-image-design-readiness-report.ts 已存在，区分真实 executor checkpoint、结果 QA 和质量声明边界' : '',
      mainImageAgentDraft.liveExecutorRequestHelperAvailable ? 'src/shared/main-image-live-executor-request.ts 已存在，将 readiness 与 dry-run 转成未来 live executor 请求包，仍不执行 Photoshop' : '',
      mainImageAgentDraft.liveExecutorCheckpointHelperAvailable ? 'src/shared/main-image-live-executor-checkpoint.ts 已存在，在真实 live runner 前检查授权、Photoshop 连接、操作队列和读回策略，仍不执行 Photoshop' : '',
      mainImageAgentDraft.liveExecutorRunnerHelperAvailable ? 'src/shared/main-image-live-executor-runner.ts 已存在，用 adapter 执行工具队列、逐步读回并输出仍需人工复核的 runner 结果' : '',
      mainImageAgentDraft.livePhotoshopAdapterContractHelperAvailable ? 'src/shared/main-image-live-photoshop-adapter-contract.ts 已存在，将 live runner operationRequests 映射为真实 Photoshop 工具参数预览，并在写入前暴露工具语义缺口' : '',
      mainImageAgentDraft.liveAdapterHandoffHelperAvailable ? 'src/shared/main-image-live-adapter-handoff.ts 已存在，用 AGENT-141 disposable toolchain 证据和 adapter contract 判断是否允许后续接入 guarded adapter' : '',
      mainImageAgentDraft.livePhotoshopToolAdapterHelperAvailable ? 'src/renderer/services/skill-executors/main-image-live-photoshop-tool-adapter.ts 已存在，把 ready adapter contract 接到 executeToolCall 风格的真实 Photoshop 工具 adapter；默认仍需显式授权和 disposable document' : '',
      mainImageAgentDraft.liveToolAdapterDisposableSmokeAvailable ? 'smoke:main-image:live-tool-adapter-disposable 已存在，默认 skipped，显式 live/disposable 后才通过 guarded adapter 跑一次性文档验收' : '',
      mainImageAgentDraft.variantPlacementStrategyHelperAvailable ? 'src/shared/main-image-variant-placement-strategy.ts 已存在，基于款式 evidence、主体 bounds 和尺寸计划生成点击图/转化图置入缩放策略' : '',
      mainImageAgentDraft.productionStructureHelperAvailable ? 'src/shared/main-image-production-document-structure.ts 已存在，规划每个尺寸一个文档、点击图/转化图父组和子组导出规格' : '',
      mainImageAgentDraft.productionExecutionPlanHelperAvailable ? 'src/shared/main-image-production-execution-plan.ts 已存在，将生产结构和置入策略转换为只读 Photoshop 操作计划 evidence' : '',
      mainImageAgentDraft.productionExecutorHandoffHelperAvailable ? 'src/shared/main-image-production-executor-handoff.ts 已存在，将只读执行计划转换为 dry-run/tool handoff manifest，仍不执行 Photoshop' : '',
      mainImageAgentDraft.productionExecutorBridgeHelperAvailable ? 'src/shared/main-image-production-executor-bridge.ts 已存在，在真实 executor 前检查工具能力、读回能力、用户授权和 Photoshop 连接状态' : '',
      mainImageAgentDraft.productionExecutorDryRunHelperAvailable ? 'src/shared/main-image-production-executor-dry-run.ts 已存在，将 executor queue 转成 dry-run 操作结果和读回计划，仍不执行 Photoshop' : '',
      mainImageAgentDraft.executorCanRunVisionPreflight ? 'main-image executor 可在显式 enableVisionPreflight 时调用 analyzeAssetContent 并映射 visionSignal' : '',
      mainImageAgentDraft.executorExposesCandidatePreflight ? 'main-image executor 结果已暴露 mainImageCandidatePreflight，只读呈现候选排序和模型调用边界' : '',
      mainImageAgentDraft.executorExposesExecutionAlignment ? 'main-image executor 结果已暴露 mainImageExecutionAlignment，只读呈现计划与工具证据对齐状态' : '',
      mainImageAgentDraft.executorExposesScreenshotQa ? 'main-image executor 结果已暴露 mainImageScreenshotQa，只读呈现结果图 QA 状态' : '',
      mainImageAgentDraft.executorExposesScreenshotProbeReadiness ? 'main-image executor 结果已暴露 mainImageScreenshotProbeReadiness，只读呈现结果文件探针准备状态' : '',
      mainImageAgentDraft.executorRunsPixelProbeAdapter ? 'main-image executor 可在明确 referenceImagePath 且结果文件可探测时生成只读 pixelProbe evidence' : '',
      mainImageAgentDraft.executorExposesQaReport ? 'main-image executor 结果已暴露 mainImageQaReport，只读汇总主图任务级 QA 证据' : '',
      mainImageAgentDraft.resourceProbeImageFileAvailable ? 'resource:probeImageFile 已提供只读图片文件探针，不返回 base64 或原始图片内容' : '',
      mainImageAgentDraft.resourceCompareImageFilesAvailable ? 'resource:compareImageFiles 已提供只读文件对文件像素探针，不返回 base64 或原始图片内容' : '',
      mainImageAgentDraft.executorExposesDraft ? 'main-image executor 结果已暴露 mainImageAgentDraft 只读证据' : '',
      mainImageAgentDraft.executorExposesAssetSelection ? 'main-image executor 结果已暴露 mainImageAssetSelection 只读证据' : '',
      mainImageAgentDraft.executorExposesVisualLoop ? 'main-image executor 结果已暴露 mainImageVisualUnderstanding 与 mainImageVisualVerification 只读证据' : '',
      mainImageAgentDraft.strategyContractSmokeAvailable ? 'smoke:main-image:strategy-contract 已覆盖父级 review gate、策略输入、raw 图泄漏阻断和 no-execution 边界' : '',
      mainImageAgentDraft.strategyInputBuilderSmokeAvailable ? 'smoke:main-image:strategy-input-builder 已覆盖策略输入生成、缺主体阻断、raw 图泄漏阻断和草案接入' : '',
      mainImageAgentDraft.assetHeroStrategySmokeAvailable ? 'smoke:main-image:asset-hero-strategy 已覆盖素材理解、主体 bounds、metadata-only、视觉/人工 grounding 和 no-execution 边界' : '',
      mainImageAgentDraft.projectStyleStrategySmokeAvailable ? 'smoke:main-image:project-style-strategy 已覆盖款式理解、参考计划、点击图/转化图多方案和 no-execution 边界' : '',
      mainImageAgentDraft.designStandardsSmokeAvailable ? 'smoke:main-image:design-standards 已覆盖 metadata-only 阻断、视觉 grounding 放行、recipe/知识缺口和 no-execution 边界' : '',
      mainImageAgentDraft.variantPlacementStrategySmokeAvailable ? 'smoke:main-image:variant-placement-strategy 已覆盖款式 grounding、主体 bounds、尺寸计划、置入缩放计划和 no-execution 边界' : '',
      mainImageAgentDraft.productionStructureSmokeAvailable ? 'smoke:main-image:production-structure 已覆盖平台尺寸 profile、点击图/转化图分组、子组导出规格和第三比例待确认边界' : '',
      mainImageAgentDraft.productionExecutionPlanSmokeAvailable ? 'smoke:main-image:production-execution-plan 已覆盖 createDocument/createGroup/placeImage/transformLayer/exportGroup 计划和 readback 边界' : '',
      mainImageAgentDraft.productionExecutorHandoffSmokeAvailable ? 'smoke:main-image:production-executor-handoff 已覆盖 pending confirmation、缺工具能力、dry-run manifest 和 no-execution 边界' : '',
      mainImageAgentDraft.productionExecutorBridgeSmokeAvailable ? 'smoke:main-image:production-executor-bridge 已覆盖读回工具、用户授权、Photoshop 连接状态和 no-execution bridge 边界' : '',
      mainImageAgentDraft.productionExecutorDryRunSmokeAvailable ? 'smoke:main-image:production-executor-dry-run 已覆盖 dry-run 记录、读回计划、live bridge 拒绝和 no-execution 边界' : '',
      mainImageAgentDraft.designReadinessReportSmokeAvailable ? 'smoke:main-image:design-readiness 已覆盖 strategy 阻断、executor checkpoint、QA 质量声明和 no-execution 边界' : '',
      mainImageAgentDraft.liveExecutorRequestSmokeAvailable ? 'smoke:main-image:live-executor-request 已覆盖 live executor 请求包、post-run QA、人工复核和 no-execution 边界' : '',
      mainImageAgentDraft.liveExecutorCheckpointSmokeAvailable ? 'smoke:main-image:live-executor-checkpoint 已覆盖显式授权、Photoshop 连接、操作队列、逐步读回、最终快照和 no-execution 边界' : '',
      mainImageAgentDraft.liveExecutorRunnerSmokeAvailable ? 'smoke:main-image:live-executor-runner 已覆盖缺 adapter、默认阻断 active document、fake 工具执行、逐步读回、最终快照、失败停止和 no-quality-claim 边界' : '',
      mainImageAgentDraft.livePhotoshopAdapterContractSmokeAvailable ? 'smoke:main-image:live-photoshop-adapter-contract 已覆盖缺 checkpoint、缺工具、一次性文档作用域、raw 图脱敏、destinationBox 到 transformLayer+moveLayer 的映射、当前真实主图计划的 export/nested group 缺口和 no-write 边界' : '',
      mainImageAgentDraft.livePhotoshopToolAdapterSmokeAvailable ? 'smoke:main-image:live-photoshop-tool-adapter 已覆盖显式授权、disposable scope、工具映射、运行时 layer/group id 解析、读回、最终快照和 no-quality-claim 边界' : '',
      mainImageAgentDraft.liveToolAdapterDisposableSmokeAvailable ? 'smoke:main-image:live-tool-adapter-disposable 已覆盖默认不触碰 Photoshop；live 模式要求独立显式环境变量、一次性文档、导出文件、cleanup 和 no-quality-claim' : '',
      mainImageAgentDraft.assetSelectionSmokeAvailable ? 'smoke:main-image:asset-selection 已覆盖已选素材、项目候选、当前文档 fallback、缺上下文和非图片阻断' : '',
      mainImageAgentDraft.visualLoopSmokeAvailable ? 'smoke:main-image:visual-loop 已覆盖 needs_vision、needs_screenshot、manual review 和 no-overclaim 边界' : '',
      mainImageAgentDraft.visionPreflightSmokeAvailable ? 'smoke:main-image:vision-preflight 已覆盖默认不调用模型、显式启用、失败不编造和 executor 接线' : '',
      mainImageAgentDraft.candidatePreflightSmokeAvailable ? 'smoke:main-image:candidate-preflight 已覆盖项目候选排序、显式单张视觉预检、候选上限和不批量模型调用' : '',
      mainImageAgentDraft.executionAlignmentSmokeAvailable ? 'smoke:main-image:execution-alignment 已覆盖计划/DSL/工具证据对齐、阻断、观察项和 no-overclaim 边界' : '',
      mainImageAgentDraft.screenshotQaSmokeAvailable ? 'smoke:main-image:screenshot-qa 已覆盖结果图、pixel probe、人工复核、raw 图泄漏阻断和 no-overclaim 边界' : '',
      mainImageAgentDraft.screenshotProbeReadinessSmokeAvailable ? 'smoke:main-image:screenshot-probe-readiness 已覆盖结果图文件探针、参考目标、尺寸偏差、raw 图泄漏阻断和 no-overclaim 边界' : '',
      mainImageAgentDraft.pixelProbeAdapterSmokeAvailable ? 'smoke:main-image:pixel-probe-adapter 已覆盖文件对文件像素探针、缺文件降级、raw 图泄漏阻断和人工复核边界' : '',
      mainImageAgentDraft.qaReportSmokeAvailable ? 'smoke:main-image:qa-report 已覆盖任务级 QA 聚合、脱敏、人工复核门禁和 no-overclaim 边界' : '',
      mainImageAgentDraft.smokeAvailable ? 'smoke:main-image:agent-draft-plan 已覆盖 ready、missing context、no-overclaim 和乱码边界' : ''
    ],
    gaps: [
      '当前不会替代 main-image executor 的 Photoshop 写入顺序和参数。',
      '当前不会定义最终主图设计方法；主图只是 Agent 可路由的业务 skill 场景。',
      '当前能整理项目素材候选和显式单张视觉预检入口，但不会自动从项目素材中完成视觉审美选图；没有 visionSignal 时只输出 needs_vision。',
      '点击图/转化图多方案必须基于视觉或人工款式理解；metadata-only 不允许猜测袜子款式和设计方向。',
      '点击图/转化图置入缩放策略仍是执行前计划；真正的大小和位置必须等待 Photoshop transform 后 actualBounds 与截图验收。',
      '主图生产执行计划仍是只读 evidence；真正创建文档、分组、置入图片和导出必须在后续 executor 中执行并读回。',
      '主图生产执行交接仍是只读 manifest；它只证明下一步请求清单和门禁，不代表已运行真实 executor。',
      '主图生产 executor bridge 仍是只读 readiness gate；真实写入必须由后续独立 executor 执行并产生读回 evidence。',
      '主图 live executor request package 仍是只读请求包；它不运行 Photoshop、不产生 actualBounds、不导出结果。',
      '主图 live executor checkpoint 只是进入真实 runner 前的安全门禁；ready_for_live_executor_run 仍不代表已执行或已验收。',
      '主图 guarded Photoshop tool adapter 已能把 contract 映射交给 executeTool 风格工具函数；但尚未默认接入生产主图 executor，也尚未执行本轮真实 Photoshop live 写入。',
      '主图 live Photoshop adapter contract 已把 destinationBox 收口为 transformLayer + moveLayer，把嵌套分组收口为 createGroup + moveLayerToGroup，并接入 exportGroup 映射；真实写入仍必须由独立 runner 执行并读回验收。',
      '主图视觉预检默认关闭，只有显式 enableVisionPreflight 才调用视觉模型，避免隐藏成本和等待。',
      '当前不声明主图设计质量通过；仍需真实 Photoshop 输出、截图和人工复核。'
    ],
    validations: [
      'npm run smoke:main-image:agent-draft-plan',
      'npm run smoke:main-image:strategy-contract',
      'npm run smoke:main-image:strategy-input-builder',
        'npm run smoke:main-image:asset-hero-strategy',
        'npm run smoke:main-image:project-style-strategy',
        'npm run smoke:main-image:design-standards',
        'npm run smoke:main-image:design-readiness',
        'npm run smoke:main-image:live-executor-request',
        'npm run smoke:main-image:live-executor-checkpoint',
        'npm run smoke:main-image:live-executor-runner',
        'npm run smoke:main-image:live-photoshop-adapter-contract',
        'npm run smoke:main-image:live-photoshop-tool-adapter',
        'npm run smoke:main-image:variant-placement-strategy',
      'npm run smoke:main-image:production-structure',
      'npm run smoke:main-image:production-execution-plan',
      'npm run smoke:main-image:production-executor-handoff',
      'npm run smoke:main-image:production-executor-bridge',
      'npm run smoke:main-image:production-executor-dry-run',
      'npm run smoke:main-image:asset-selection',
      'npm run smoke:main-image:visual-loop',
      'npm run smoke:main-image:vision-preflight',
      'npm run smoke:main-image:candidate-preflight',
      'npm run smoke:main-image:execution-alignment',
      'npm run smoke:main-image:screenshot-qa',
      'npm run smoke:main-image:screenshot-probe-readiness',
      'npm run smoke:main-image:qa-report',
      'npm run smoke:main-image:design-skill',
      'npm run build:typecheck:renderer'
    ]
  }));

  gates.push(buildGate({
    id: 'multi-agent-team',
    title: '多 Agent 任务系统',
    goal: 'Planner / Executor / Critic / Researcher 等角色协作，并有统一结果协议。',
    status: inferStatus([
      exists(agentRoot, 'src/renderer/services/design-teams/coordinator.ts'),
      exists(agentRoot, 'src/renderer/services/design-teams/registry.ts'),
      exists(agentRoot, 'src/renderer/services/design-teams/task.ts'),
      exists(agentRoot, 'src/shared/types/design-team.types.ts'),
      hasScript(packageJson, 'smoke:design-team:coordinator')
    ], [
      '尚未实现完整设计任务生命周期、持久化和 Critic 验收闭环。'
    ]),
    evidence: [
      'design-teams coordinator / registry / task / shared types 已存在',
      'autonomous-agent 可通过 delegateToAgent 调用 teammate',
      'smoke:design-team:coordinator 覆盖角色、工具边界和任务状态流转'
    ],
    gaps: [
      '当前是最小 teammate task，不是完整多 Agent 项目生命周期。',
      '子 Agent 结果尚未持久化到可恢复任务队列。',
      'Critic 还缺 Photoshop 验收证据。'
    ],
    validations: ['npm run smoke:design-team:coordinator', 'npm run smoke:agent:runtime-guard']
  }));

  const hasDesignKnowledgeSearch = exists(agentRoot, 'src/shared/design-knowledge-search.ts')
    && exists(agentRoot, 'src/main/services/design-knowledge-search-service.ts')
    && hasScript(packageJson, 'smoke:design-knowledge:search');
  const hasDesignReferenceKnowledgeResults = fileIncludes(
    agentRoot,
    'src/renderer/services/skill-executors/design-reference-search.executor.ts',
    'normalizeExternalDesignKnowledgeResults'
  ) && fileIncludes(
    agentRoot,
    'scripts/smoke-analysis-reference-observability.cjs',
    'design-reference-fetch-url-knowledge-results'
  );
  gates.push(buildGate({
    id: 'knowledge-layer',
    title: '设计知识与网页搜索层',
    goal: '用结构化知识、recipe、案例和带来源搜索补充模型认知。',
    status: hasDesignKnowledgeSearch ? 'mvp' : 'planned',
    evidence: [
      exists(agentRoot, 'docs/design-knowledge-web-search-plan.md') ? '设计知识网页搜索规划已存在' : '',
      hasDesignKnowledgeSearch ? 'DesignKnowledgeSearchService MVP 已存在' : '',
      hasDesignKnowledgeSearch ? '本地 recipe 已可输出统一 DesignKnowledgeResult' : '',
      hasDesignReferenceKnowledgeResults ? '设计参考搜索和网页抓取结果已归一化为只读 DesignKnowledgeResult' : ''
    ],
    gaps: [
      hasDesignKnowledgeSearch ? '' : 'DesignKnowledgeSearchService 尚未实现。',
      '小米 Web Search provider-native tool 尚未接入。',
      hasDesignReferenceKnowledgeResults ? '' : '外部网页搜索、设计案例库和 benchmark 还没有统一接入 DesignKnowledgeResult。',
      hasDesignReferenceKnowledgeResults ? '设计案例库、benchmark 和带 citation 的 provider-native 搜索仍未接入 DesignKnowledgeResult。' : ''
    ],
    validations: [
      hasDesignKnowledgeSearch ? 'npm run smoke:design-knowledge:search' : '',
      hasDesignReferenceKnowledgeResults ? 'npm run smoke:analysis-reference:observability' : '',
      '后续需要 provider-native tool smoke 和来源证据 smoke'
    ]
  }));

  const mvpReady = countMvp(gates);
  const fullyReady = countReady(gates);
  const status = gates.some((gate) => gate.status === 'missing')
    ? 'blocked'
    : mvpReady >= 8
      ? 'mvp_ready_not_complete'
      : 'in_progress';
  let projectContextRecommendedNext = '先继续 M0j ContextSnapshot：让 Agent 在选择主图、详情页、SKU 等业务 skill 前有稳定的项目、文档、素材、历史和约束上下文。';
  if (
    projectAssetIndex.visualInsightCacheFillHelperAvailable
    && projectAssetIndex.visualInsightCacheFillRendererAvailable
    && projectAssetIndex.visualInsightCacheFillSmokeAvailable
  ) {
    projectContextRecommendedNext = '继续把真实视觉模型 opt-in 缓存填充 runner 接入业务 skill 执行前门禁，并用真实项目和真实 provider 做受控验证。';
  } else if (projectAssetIndex.runtimeWritesVisualInsightCache && projectAssetIndex.rendererContextCarriesVisualInsightCache) {
    projectContextRecommendedNext = '继续在 M0j 之上接入真实视觉模型的 opt-in 缓存填充流程，并把 ContextSnapshot 提升为所有业务 skill 的执行前证据门禁。';
  } else if (projectAssetIndex.runtimeBuildsVisualSampling && projectAssetIndex.rendererContextCarriesVisualSampling) {
    projectContextRecommendedNext = '继续在 M0j 之上接入视觉理解缓存读写，并把 ContextSnapshot 提升为所有业务 skill 的执行前证据门禁。';
  }

  return {
    repoRoot: root,
    generatedAt: new Date().toISOString(),
    currentMilestone: projectState.currentMilestone,
    architectureStatus: status,
    matureArchitectureComplete: false,
    mvpReadyGates: mvpReady,
    fullyReadyGates: fullyReady,
    totalGates: gates.length,
    capabilityMapInventory: {
      available: Boolean(capabilityMapInventory && !capabilityMapInventory.error),
      success: Boolean(capabilityMapInventory?.success),
      role: capabilityMapInventory?.role || null,
      layerCount: capabilityMapInventory?.layerCount ?? null,
      missingScripts: capabilityMapInventory?.missingScripts || [],
      missingBoundaryPhrases: capabilityMapInventory?.boundaryPhrases?.missing || [],
      error: capabilityMapInventory?.error || null
    },
    referenceReplicationReadiness: {
      available: Boolean(referenceReadiness && !referenceReadiness.error),
      suiteReadyForQualityClaim: Boolean(referenceReadiness?.suiteReadyForQualityClaim),
      counts: referenceReadiness?.counts || {},
      readinessCounts: referenceReadiness?.readinessCounts || {},
      error: referenceReadiness?.error || null
    },
    referenceQualityClaimGate: {
      available: Boolean(referenceQualityGate && !referenceQualityGate.error),
      allowedToClaim: Boolean(referenceQualityGate?.gate?.allowedToClaim),
      blockerCount: referenceQualityGateBlockers.length,
      hasExplicitRealSourceBlocker: referenceQualityGateBlockers.some((item) => item.includes('explicit real-source cases')),
      hasResultScreenshotBlocker: referenceQualityGateBlockers.includes('no real result screenshot evidence recorded'),
      hasValidEvidenceReportBlocker: referenceQualityGateBlockers.includes('no valid result evidence report recorded'),
      hasBuildVerificationBlocker: referenceQualityGateBlockers.includes('no build/execution verification recorded'),
      hasManualReviewBlocker: referenceQualityGateBlockers.includes('no manual review recorded'),
      hasCompleteScoreBlocker: referenceQualityGateBlockers.includes('no complete 0..1 score set recorded'),
      blockers: referenceQualityGateBlockers,
      warnings: referenceQualityGate?.gate?.warnings || [],
      error: referenceQualityGate?.error || null
    },
    referenceQualityGateConsistency: buildReferenceQualityGateConsistency(agentRoot, packageJson),
    designAgentOsSubsystems,
    photoshopBridgeHealth,
    mainImageAgentDraft,
    projectAssetIndex,
    imagePlacementCore,
    agentPerformancePolicy,
    referenceStatusResume: {
      available: Boolean(referenceStatus && !referenceStatus.error),
      designQualityClaimAllowed: Boolean(referenceStatus?.conclusion?.designQualityClaimAllowed),
      nextActionCount: Array.isArray(referenceStatus?.nextActions) ? referenceStatus.nextActions.length : 0,
      realCaseEvidenceChainVisible: realCaseEvidenceOrder.length > 0,
      validateEvidenceInResume: realCaseEvidenceOrder.includes('benchmark:reference-replication:validate-evidence'),
      cannotClaimFromIntakeOnly: Boolean(realCaseResumeAction?.evidenceChain?.cannotClaimFromIntakeOnly),
      error: referenceStatus?.error || null
    },
    gates,
    conclusion: status === 'mvp_ready_not_complete'
      ? 'Agent 架构基础设施 MVP 已成型，但完整多 Agent 工作流、知识层、截图级 QA、live API/真实 Photoshop UI 体验和设计质量闭环未完成。'
      : 'Agent 架构基础设施仍在建设中，不能标记为完成。',
    recommendedNext: [
      projectContextRecommendedNext,
      simpleTextLayoutLivePixelProbeOk
        ? '继续用真实商业参考图替换 synthetic seed；临时简单文字排版 case 不能成为主线目标。'
        : '保持主图、详情页、SKU 作为业务 skill 场景，不把当前 evidence/gate 误报为具体设计策略完成。',
      '等上下文、Planner、DSL、执行和验收底座稳定后，再单独设计主图和详情页的真实设计策略。'
    ]
  };
}

function formatReport(report) {
  const lines = [];
  lines.push('DesignEcho Agent architecture report');
  lines.push(`repoRoot: ${report.repoRoot}`);
  lines.push(`currentMilestone: ${report.currentMilestone}`);
  lines.push(`architectureStatus: ${report.architectureStatus}`);
  lines.push(`matureArchitectureComplete: ${report.matureArchitectureComplete}`);
  lines.push(`mvpReadyGates: ${report.mvpReadyGates}/${report.totalGates}`);
  lines.push(`fullyReadyGates: ${report.fullyReadyGates}/${report.totalGates}`);
  lines.push('');
  lines.push('capabilityMapInventory:');
  lines.push(`- available: ${report.capabilityMapInventory.available}`);
  lines.push(`- success: ${report.capabilityMapInventory.success}`);
  lines.push(`- role: ${report.capabilityMapInventory.role || 'unknown'}`);
  lines.push(`- layerCount: ${report.capabilityMapInventory.layerCount ?? 'unknown'}`);
  lines.push(`- missingScripts: ${report.capabilityMapInventory.missingScripts.length > 0 ? report.capabilityMapInventory.missingScripts.join(', ') : 'none'}`);
  lines.push(`- missingBoundaryPhrases: ${report.capabilityMapInventory.missingBoundaryPhrases.length > 0 ? report.capabilityMapInventory.missingBoundaryPhrases.join(', ') : 'none'}`);
  lines.push('');
  lines.push('referenceReplicationReadiness:');
  lines.push(`- available: ${report.referenceReplicationReadiness.available}`);
  lines.push(`- suiteReadyForQualityClaim: ${report.referenceReplicationReadiness.suiteReadyForQualityClaim}`);
  const readinessCounts = report.referenceReplicationReadiness.readinessCounts || {};
  lines.push(`- readinessCounts: ${Object.keys(readinessCounts).length > 0 ? Object.entries(readinessCounts).map(([key, value]) => `${key}=${value}`).join(', ') : 'none'}`);
  const readinessSummary = report.referenceReplicationReadiness.counts || {};
  lines.push(`- resultScreenshots: ${readinessSummary.withResultScreenshot ?? 'unknown'}/${readinessSummary.total ?? 'unknown'}`);
  lines.push(`- manualVerified: ${readinessSummary.manualVerified ?? 'unknown'}/${readinessSummary.total ?? 'unknown'}`);
  lines.push(`- designQualityEligible: ${readinessSummary.designQualityEligible ?? 'unknown'}/${readinessSummary.total ?? 'unknown'}`);
  lines.push('');
  lines.push('referenceQualityClaimGate:');
  lines.push(`- available: ${report.referenceQualityClaimGate.available}`);
  lines.push(`- allowedToClaim: ${report.referenceQualityClaimGate.allowedToClaim}`);
  lines.push(`- blockers: ${report.referenceQualityClaimGate.blockers.length > 0 ? report.referenceQualityClaimGate.blockers.join(' / ') : 'none'}`);
  lines.push(`- warnings: ${report.referenceQualityClaimGate.warnings.length > 0 ? report.referenceQualityClaimGate.warnings.join(' / ') : 'none'}`);
  lines.push('');
  lines.push('referenceQualityGateConsistency:');
  lines.push(`- smokeAvailable: ${report.referenceQualityGateConsistency.smokeAvailable}`);
  lines.push(`- smokeInPreflight: ${report.referenceQualityGateConsistency.smokeInPreflight}`);
  lines.push(`- checksReadiness: ${report.referenceQualityGateConsistency.checksReadiness}`);
  lines.push(`- checksPipeline: ${report.referenceQualityGateConsistency.checksPipeline}`);
  lines.push(`- checksStatus: ${report.referenceQualityGateConsistency.checksStatus}`);
  lines.push(`- checksCockpit: ${report.referenceQualityGateConsistency.checksCockpit}`);
  lines.push(`- checksArchitecture: ${report.referenceQualityGateConsistency.checksArchitecture}`);
  lines.push(`- policy: ${report.referenceQualityGateConsistency.policy}`);
  lines.push('');
  lines.push('designAgentOsSubsystems:');
  for (const subsystem of report.designAgentOsSubsystems) {
    lines.push(`- ${subsystem.id}: ${subsystem.status} - ${subsystem.title}`);
    lines.push(`  nextGate: ${subsystem.nextGate}`);
  }
  lines.push('');
  lines.push('photoshopBridgeHealth:');
  lines.push(`- scriptAvailable: ${report.photoshopBridgeHealth.scriptAvailable}`);
  lines.push(`- smokeAvailable: ${report.photoshopBridgeHealth.smokeAvailable}`);
  lines.push(`- maintenanceCommandAvailable: ${report.photoshopBridgeHealth.maintenanceCommandAvailable}`);
  lines.push(`- selfTestInPreflight: ${report.photoshopBridgeHealth.selfTestInPreflight}`);
  lines.push(`- readOnlyBoundary: ${report.photoshopBridgeHealth.readOnlyBoundary}`);
  lines.push(`- noDocumentCreationBoundary: ${report.photoshopBridgeHealth.noDocumentCreationBoundary}`);
  lines.push(`- noDesignQualityClaimBoundary: ${report.photoshopBridgeHealth.noDesignQualityClaimBoundary}`);
  lines.push(`- classifiesBridgeTimeout: ${report.photoshopBridgeHealth.classifiesBridgeTimeout}`);
  lines.push('');
  lines.push('mainImageAgentDraft:');
  lines.push(`- helperAvailable: ${report.mainImageAgentDraft.helperAvailable}`);
  lines.push(`- assetSelectionHelperAvailable: ${report.mainImageAgentDraft.assetSelectionHelperAvailable}`);
  lines.push(`- visualLoopHelperAvailable: ${report.mainImageAgentDraft.visualLoopHelperAvailable}`);
  lines.push(`- visionPreflightHelperAvailable: ${report.mainImageAgentDraft.visionPreflightHelperAvailable}`);
  lines.push(`- executionAlignmentHelperAvailable: ${report.mainImageAgentDraft.executionAlignmentHelperAvailable}`);
  lines.push(`- screenshotQaHelperAvailable: ${report.mainImageAgentDraft.screenshotQaHelperAvailable}`);
  lines.push(`- screenshotProbeReadinessHelperAvailable: ${report.mainImageAgentDraft.screenshotProbeReadinessHelperAvailable}`);
  lines.push(`- qaReportHelperAvailable: ${report.mainImageAgentDraft.qaReportHelperAvailable}`);
  lines.push(`- strategyContractHelperAvailable: ${report.mainImageAgentDraft.strategyContractHelperAvailable}`);
  lines.push(`- strategyInputBuilderHelperAvailable: ${report.mainImageAgentDraft.strategyInputBuilderHelperAvailable}`);
  lines.push(`- assetHeroStrategyHelperAvailable: ${report.mainImageAgentDraft.assetHeroStrategyHelperAvailable}`);
  lines.push(`- projectStyleStrategyHelperAvailable: ${report.mainImageAgentDraft.projectStyleStrategyHelperAvailable}`);
  lines.push(`- designStandardsHelperAvailable: ${report.mainImageAgentDraft.designStandardsHelperAvailable}`);
  lines.push(`- designReadinessReportHelperAvailable: ${report.mainImageAgentDraft.designReadinessReportHelperAvailable}`);
  lines.push(`- liveExecutorRequestHelperAvailable: ${report.mainImageAgentDraft.liveExecutorRequestHelperAvailable}`);
  lines.push(`- liveExecutorCheckpointHelperAvailable: ${report.mainImageAgentDraft.liveExecutorCheckpointHelperAvailable}`);
  lines.push(`- liveExecutorRunnerHelperAvailable: ${report.mainImageAgentDraft.liveExecutorRunnerHelperAvailable}`);
  lines.push(`- livePhotoshopAdapterContractHelperAvailable: ${report.mainImageAgentDraft.livePhotoshopAdapterContractHelperAvailable}`);
  lines.push(`- liveAdapterHandoffHelperAvailable: ${report.mainImageAgentDraft.liveAdapterHandoffHelperAvailable}`);
  lines.push(`- livePhotoshopToolAdapterHelperAvailable: ${report.mainImageAgentDraft.livePhotoshopToolAdapterHelperAvailable}`);
  lines.push(`- photoshopToolCapabilityMatrixHelperAvailable: ${report.mainImageAgentDraft.photoshopToolCapabilityMatrixHelperAvailable}`);
  lines.push(`- groupHierarchyContractHelperAvailable: ${report.mainImageAgentDraft.groupHierarchyContractHelperAvailable}`);
  lines.push(`- variantPlacementStrategyHelperAvailable: ${report.mainImageAgentDraft.variantPlacementStrategyHelperAvailable}`);
  lines.push(`- productionStructureHelperAvailable: ${report.mainImageAgentDraft.productionStructureHelperAvailable}`);
  lines.push(`- productionExecutionPlanHelperAvailable: ${report.mainImageAgentDraft.productionExecutionPlanHelperAvailable}`);
  lines.push(`- productionExecutorHandoffHelperAvailable: ${report.mainImageAgentDraft.productionExecutorHandoffHelperAvailable}`);
  lines.push(`- productionExecutorBridgeHelperAvailable: ${report.mainImageAgentDraft.productionExecutorBridgeHelperAvailable}`);
  lines.push(`- productionExecutorDryRunHelperAvailable: ${report.mainImageAgentDraft.productionExecutorDryRunHelperAvailable}`);
  lines.push(`- smokeAvailable: ${report.mainImageAgentDraft.smokeAvailable}`);
  lines.push(`- strategyContractSmokeAvailable: ${report.mainImageAgentDraft.strategyContractSmokeAvailable}`);
  lines.push(`- strategyInputBuilderSmokeAvailable: ${report.mainImageAgentDraft.strategyInputBuilderSmokeAvailable}`);
  lines.push(`- assetHeroStrategySmokeAvailable: ${report.mainImageAgentDraft.assetHeroStrategySmokeAvailable}`);
  lines.push(`- projectStyleStrategySmokeAvailable: ${report.mainImageAgentDraft.projectStyleStrategySmokeAvailable}`);
  lines.push(`- designStandardsSmokeAvailable: ${report.mainImageAgentDraft.designStandardsSmokeAvailable}`);
  lines.push(`- designReadinessReportSmokeAvailable: ${report.mainImageAgentDraft.designReadinessReportSmokeAvailable}`);
  lines.push(`- liveExecutorRequestSmokeAvailable: ${report.mainImageAgentDraft.liveExecutorRequestSmokeAvailable}`);
  lines.push(`- liveExecutorCheckpointSmokeAvailable: ${report.mainImageAgentDraft.liveExecutorCheckpointSmokeAvailable}`);
  lines.push(`- liveExecutorRunnerSmokeAvailable: ${report.mainImageAgentDraft.liveExecutorRunnerSmokeAvailable}`);
  lines.push(`- livePhotoshopAdapterContractSmokeAvailable: ${report.mainImageAgentDraft.livePhotoshopAdapterContractSmokeAvailable}`);
  lines.push(`- liveAdapterHandoffSmokeAvailable: ${report.mainImageAgentDraft.liveAdapterHandoffSmokeAvailable}`);
  lines.push(`- livePhotoshopToolAdapterSmokeAvailable: ${report.mainImageAgentDraft.livePhotoshopToolAdapterSmokeAvailable}`);
  lines.push(`- liveToolAdapterDisposableSmokeAvailable: ${report.mainImageAgentDraft.liveToolAdapterDisposableSmokeAvailable}`);
  lines.push(`- liveToolAdapterDisposableClassificationSmokeAvailable: ${report.mainImageAgentDraft.liveToolAdapterDisposableClassificationSmokeAvailable}`);
  lines.push(`- photoshopToolCapabilityMatrixSmokeAvailable: ${report.mainImageAgentDraft.photoshopToolCapabilityMatrixSmokeAvailable}`);
  lines.push(`- groupHierarchyContractSmokeAvailable: ${report.mainImageAgentDraft.groupHierarchyContractSmokeAvailable}`);
  lines.push(`- variantPlacementStrategySmokeAvailable: ${report.mainImageAgentDraft.variantPlacementStrategySmokeAvailable}`);
  lines.push(`- productionStructureSmokeAvailable: ${report.mainImageAgentDraft.productionStructureSmokeAvailable}`);
  lines.push(`- productionExecutionPlanSmokeAvailable: ${report.mainImageAgentDraft.productionExecutionPlanSmokeAvailable}`);
  lines.push(`- productionExecutorHandoffSmokeAvailable: ${report.mainImageAgentDraft.productionExecutorHandoffSmokeAvailable}`);
  lines.push(`- productionExecutorBridgeSmokeAvailable: ${report.mainImageAgentDraft.productionExecutorBridgeSmokeAvailable}`);
  lines.push(`- productionExecutorDryRunSmokeAvailable: ${report.mainImageAgentDraft.productionExecutorDryRunSmokeAvailable}`);
  lines.push(`- assetSelectionSmokeAvailable: ${report.mainImageAgentDraft.assetSelectionSmokeAvailable}`);
  lines.push(`- visualLoopSmokeAvailable: ${report.mainImageAgentDraft.visualLoopSmokeAvailable}`);
  lines.push(`- visionPreflightSmokeAvailable: ${report.mainImageAgentDraft.visionPreflightSmokeAvailable}`);
  lines.push(`- candidatePreflightSmokeAvailable: ${report.mainImageAgentDraft.candidatePreflightSmokeAvailable}`);
  lines.push(`- executionAlignmentSmokeAvailable: ${report.mainImageAgentDraft.executionAlignmentSmokeAvailable}`);
  lines.push(`- screenshotQaSmokeAvailable: ${report.mainImageAgentDraft.screenshotQaSmokeAvailable}`);
  lines.push(`- screenshotProbeReadinessSmokeAvailable: ${report.mainImageAgentDraft.screenshotProbeReadinessSmokeAvailable}`);
  lines.push(`- pixelProbeAdapterSmokeAvailable: ${report.mainImageAgentDraft.pixelProbeAdapterSmokeAvailable}`);
  lines.push(`- qaReportSmokeAvailable: ${report.mainImageAgentDraft.qaReportSmokeAvailable}`);
  lines.push(`- smokeInPreflight: ${report.mainImageAgentDraft.smokeInPreflight}`);
  lines.push(`- strategyContractSmokeInPreflight: ${report.mainImageAgentDraft.strategyContractSmokeInPreflight}`);
  lines.push(`- strategyInputBuilderSmokeInPreflight: ${report.mainImageAgentDraft.strategyInputBuilderSmokeInPreflight}`);
  lines.push(`- assetHeroStrategySmokeInPreflight: ${report.mainImageAgentDraft.assetHeroStrategySmokeInPreflight}`);
  lines.push(`- projectStyleStrategySmokeInPreflight: ${report.mainImageAgentDraft.projectStyleStrategySmokeInPreflight}`);
  lines.push(`- designStandardsSmokeInPreflight: ${report.mainImageAgentDraft.designStandardsSmokeInPreflight}`);
  lines.push(`- designReadinessReportSmokeInPreflight: ${report.mainImageAgentDraft.designReadinessReportSmokeInPreflight}`);
  lines.push(`- liveExecutorRequestSmokeInPreflight: ${report.mainImageAgentDraft.liveExecutorRequestSmokeInPreflight}`);
  lines.push(`- liveExecutorCheckpointSmokeInPreflight: ${report.mainImageAgentDraft.liveExecutorCheckpointSmokeInPreflight}`);
  lines.push(`- liveExecutorRunnerSmokeInPreflight: ${report.mainImageAgentDraft.liveExecutorRunnerSmokeInPreflight}`);
  lines.push(`- livePhotoshopAdapterContractSmokeInPreflight: ${report.mainImageAgentDraft.livePhotoshopAdapterContractSmokeInPreflight}`);
  lines.push(`- liveAdapterHandoffSmokeInPreflight: ${report.mainImageAgentDraft.liveAdapterHandoffSmokeInPreflight}`);
  lines.push(`- livePhotoshopToolAdapterSmokeInPreflight: ${report.mainImageAgentDraft.livePhotoshopToolAdapterSmokeInPreflight}`);
  lines.push(`- liveToolAdapterDisposableSmokeInPreflight: ${report.mainImageAgentDraft.liveToolAdapterDisposableSmokeInPreflight}`);
  lines.push(`- liveToolAdapterDisposableClassificationSmokeInPreflight: ${report.mainImageAgentDraft.liveToolAdapterDisposableClassificationSmokeInPreflight}`);
  lines.push(`- photoshopToolCapabilityMatrixSmokeInPreflight: ${report.mainImageAgentDraft.photoshopToolCapabilityMatrixSmokeInPreflight}`);
  lines.push(`- groupHierarchyContractSmokeInPreflight: ${report.mainImageAgentDraft.groupHierarchyContractSmokeInPreflight}`);
  lines.push(`- variantPlacementStrategySmokeInPreflight: ${report.mainImageAgentDraft.variantPlacementStrategySmokeInPreflight}`);
  lines.push(`- productionStructureSmokeInPreflight: ${report.mainImageAgentDraft.productionStructureSmokeInPreflight}`);
  lines.push(`- productionExecutionPlanSmokeInPreflight: ${report.mainImageAgentDraft.productionExecutionPlanSmokeInPreflight}`);
  lines.push(`- productionExecutorHandoffSmokeInPreflight: ${report.mainImageAgentDraft.productionExecutorHandoffSmokeInPreflight}`);
  lines.push(`- productionExecutorBridgeSmokeInPreflight: ${report.mainImageAgentDraft.productionExecutorBridgeSmokeInPreflight}`);
  lines.push(`- productionExecutorDryRunSmokeInPreflight: ${report.mainImageAgentDraft.productionExecutorDryRunSmokeInPreflight}`);
  lines.push(`- assetSelectionSmokeInPreflight: ${report.mainImageAgentDraft.assetSelectionSmokeInPreflight}`);
  lines.push(`- visualLoopSmokeInPreflight: ${report.mainImageAgentDraft.visualLoopSmokeInPreflight}`);
  lines.push(`- visionPreflightSmokeInPreflight: ${report.mainImageAgentDraft.visionPreflightSmokeInPreflight}`);
  lines.push(`- candidatePreflightSmokeInPreflight: ${report.mainImageAgentDraft.candidatePreflightSmokeInPreflight}`);
  lines.push(`- executionAlignmentSmokeInPreflight: ${report.mainImageAgentDraft.executionAlignmentSmokeInPreflight}`);
  lines.push(`- screenshotQaSmokeInPreflight: ${report.mainImageAgentDraft.screenshotQaSmokeInPreflight}`);
  lines.push(`- screenshotProbeReadinessSmokeInPreflight: ${report.mainImageAgentDraft.screenshotProbeReadinessSmokeInPreflight}`);
  lines.push(`- pixelProbeAdapterSmokeInPreflight: ${report.mainImageAgentDraft.pixelProbeAdapterSmokeInPreflight}`);
  lines.push(`- qaReportSmokeInPreflight: ${report.mainImageAgentDraft.qaReportSmokeInPreflight}`);
  lines.push(`- plannerEvidenceAttached: ${report.mainImageAgentDraft.plannerEvidenceAttached}`);
  lines.push(`- plannerPassesStrategyContract: ${report.mainImageAgentDraft.plannerPassesStrategyContract}`);
  lines.push(`- strategyContractNoExecution: ${report.mainImageAgentDraft.strategyContractNoExecution}`);
  lines.push(`- strategyInputBuilderNoExecution: ${report.mainImageAgentDraft.strategyInputBuilderNoExecution}`);
  lines.push(`- assetHeroStrategyNoExecution: ${report.mainImageAgentDraft.assetHeroStrategyNoExecution}`);
  lines.push(`- projectStyleStrategyNoExecution: ${report.mainImageAgentDraft.projectStyleStrategyNoExecution}`);
  lines.push(`- designStandardsNoExecution: ${report.mainImageAgentDraft.designStandardsNoExecution}`);
  lines.push(`- designReadinessReportNoExecution: ${report.mainImageAgentDraft.designReadinessReportNoExecution}`);
  lines.push(`- liveExecutorRequestNoExecution: ${report.mainImageAgentDraft.liveExecutorRequestNoExecution}`);
  lines.push(`- liveExecutorCheckpointNoExecution: ${report.mainImageAgentDraft.liveExecutorCheckpointNoExecution}`);
  lines.push(`- liveExecutorRunnerRequiresAdapter: ${report.mainImageAgentDraft.liveExecutorRunnerRequiresAdapter}`);
  lines.push(`- liveExecutorRunnerBlocksNonDisposable: ${report.mainImageAgentDraft.liveExecutorRunnerBlocksNonDisposable}`);
  lines.push(`- liveExecutorRunnerNoQualityClaim: ${report.mainImageAgentDraft.liveExecutorRunnerNoQualityClaim}`);
  lines.push(`- livePhotoshopAdapterContractNoWrite: ${report.mainImageAgentDraft.livePhotoshopAdapterContractNoWrite}`);
  lines.push(`- livePhotoshopAdapterContractMapsExportGroup: ${report.mainImageAgentDraft.livePhotoshopAdapterContractMapsExportGroup}`);
  lines.push(`- livePhotoshopAdapterContractMapsDestinationBoxMoveLayer: ${report.mainImageAgentDraft.livePhotoshopAdapterContractMapsDestinationBoxMoveLayer}`);
  lines.push(`- livePhotoshopAdapterContractMapsNestedGroups: ${report.mainImageAgentDraft.livePhotoshopAdapterContractMapsNestedGroups}`);
  lines.push(`- livePhotoshopAdapterContractNoQualityClaim: ${report.mainImageAgentDraft.livePhotoshopAdapterContractNoQualityClaim}`);
  lines.push(`- liveAdapterHandoffNoWrite: ${report.mainImageAgentDraft.liveAdapterHandoffNoWrite}`);
  lines.push(`- liveAdapterHandoffNoQualityClaim: ${report.mainImageAgentDraft.liveAdapterHandoffNoQualityClaim}`);
  lines.push(`- liveAdapterHandoffBlocksProduction: ${report.mainImageAgentDraft.liveAdapterHandoffBlocksProduction}`);
  lines.push(`- livePhotoshopToolAdapterRequiresApproval: ${report.mainImageAgentDraft.livePhotoshopToolAdapterRequiresApproval}`);
  lines.push(`- livePhotoshopToolAdapterBlocksNonDisposable: ${report.mainImageAgentDraft.livePhotoshopToolAdapterBlocksNonDisposable}`);
  lines.push(`- livePhotoshopToolAdapterNoProduction: ${report.mainImageAgentDraft.livePhotoshopToolAdapterNoProduction}`);
  lines.push(`- livePhotoshopToolAdapterNoQualityClaim: ${report.mainImageAgentDraft.livePhotoshopToolAdapterNoQualityClaim}`);
  lines.push(`- liveToolAdapterDisposableDefaultSkipped: ${report.mainImageAgentDraft.liveToolAdapterDisposableDefaultSkipped}`);
  lines.push(`- liveToolAdapterDisposableRequiresLiveFlag: ${report.mainImageAgentDraft.liveToolAdapterDisposableRequiresLiveFlag}`);
  lines.push(`- liveToolAdapterDisposableRequiresDisposableFlag: ${report.mainImageAgentDraft.liveToolAdapterDisposableRequiresDisposableFlag}`);
  lines.push(`- liveToolAdapterDisposablePreprocessesPlaceImageFilePath: ${report.mainImageAgentDraft.liveToolAdapterDisposablePreprocessesPlaceImageFilePath}`);
  lines.push(`- liveToolAdapterDisposableHasMcpTimeoutBoundary: ${report.mainImageAgentDraft.liveToolAdapterDisposableHasMcpTimeoutBoundary}`);
  lines.push(`- liveToolAdapterDisposableHasCleanupTimeoutBoundary: ${report.mainImageAgentDraft.liveToolAdapterDisposableHasCleanupTimeoutBoundary}`);
  lines.push(`- liveToolAdapterDisposableHasHealthStatus: ${report.mainImageAgentDraft.liveToolAdapterDisposableHasHealthStatus}`);
  lines.push(`- liveToolAdapterDisposableHasRecoveryActions: ${report.mainImageAgentDraft.liveToolAdapterDisposableHasRecoveryActions}`);
  lines.push(`- photoshopToolCapabilityMatrixNoWrite: ${report.mainImageAgentDraft.photoshopToolCapabilityMatrixNoWrite}`);
  lines.push(`- photoshopToolCapabilityMatrixSupportsNestedGroup: ${report.mainImageAgentDraft.photoshopToolCapabilityMatrixSupportsNestedGroup}`);
  lines.push(`- photoshopToolCapabilityMatrixUsesMoveLayerToGroup: ${report.mainImageAgentDraft.photoshopToolCapabilityMatrixUsesMoveLayerToGroup}`);
  lines.push(`- photoshopToolCapabilityMatrixUsesExportGroup: ${report.mainImageAgentDraft.photoshopToolCapabilityMatrixUsesExportGroup}`);
  lines.push(`- uxpMoveLayerToGroupToolAvailable: ${report.mainImageAgentDraft.uxpMoveLayerToGroupToolAvailable}`);
  lines.push(`- uxpMoveLayerToGroupRegistered: ${report.mainImageAgentDraft.uxpMoveLayerToGroupRegistered}`);
  lines.push(`- uxpExportGroupToolAvailable: ${report.mainImageAgentDraft.uxpExportGroupToolAvailable}`);
  lines.push(`- uxpExportGroupRegistered: ${report.mainImageAgentDraft.uxpExportGroupRegistered}`);
  lines.push(`- groupHierarchyContractNoWrite: ${report.mainImageAgentDraft.groupHierarchyContractNoWrite}`);
  lines.push(`- groupHierarchyContractCoversMissingParentSemantics: ${report.mainImageAgentDraft.groupHierarchyContractCoversMissingParentSemantics}`);
  lines.push(`- groupHierarchyContractCoversMissingMoveToGroup: ${report.mainImageAgentDraft.groupHierarchyContractCoversMissingMoveToGroup}`);
  lines.push(`- groupHierarchyContractCoversMissingGroupExport: ${report.mainImageAgentDraft.groupHierarchyContractCoversMissingGroupExport}`);
  lines.push(`- variantPlacementStrategyNoExecution: ${report.mainImageAgentDraft.variantPlacementStrategyNoExecution}`);
  lines.push(`- productionStructureNoExecution: ${report.mainImageAgentDraft.productionStructureNoExecution}`);
  lines.push(`- productionExecutionPlanNoExecution: ${report.mainImageAgentDraft.productionExecutionPlanNoExecution}`);
  lines.push(`- productionExecutorHandoffNoExecution: ${report.mainImageAgentDraft.productionExecutorHandoffNoExecution}`);
  lines.push(`- productionExecutorBridgeNoExecution: ${report.mainImageAgentDraft.productionExecutorBridgeNoExecution}`);
  lines.push(`- productionExecutorDryRunNoExecution: ${report.mainImageAgentDraft.productionExecutorDryRunNoExecution}`);
  lines.push(`- strategyInputBuilderUsesAssetHeroStrategy: ${report.mainImageAgentDraft.strategyInputBuilderUsesAssetHeroStrategy}`);
  lines.push(`- strategyInputBuilderUsesProjectStyleStrategy: ${report.mainImageAgentDraft.strategyInputBuilderUsesProjectStyleStrategy}`);
  lines.push(`- strategyInputBuilderUsesDesignStandards: ${report.mainImageAgentDraft.strategyInputBuilderUsesDesignStandards}`);
  lines.push(`- strategyInputBuilderUsesDesignReadinessReport: ${report.mainImageAgentDraft.strategyInputBuilderUsesDesignReadinessReport}`);
  lines.push(`- strategyInputBuilderUsesLiveExecutorRequest: ${report.mainImageAgentDraft.strategyInputBuilderUsesLiveExecutorRequest}`);
  lines.push(`- strategyInputBuilderUsesVariantPlacementStrategy: ${report.mainImageAgentDraft.strategyInputBuilderUsesVariantPlacementStrategy}`);
  lines.push(`- strategyInputBuilderUsesProductionStructure: ${report.mainImageAgentDraft.strategyInputBuilderUsesProductionStructure}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutionPlan: ${report.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutionPlan}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutorHandoff: ${report.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutorHandoff}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutorBridge: ${report.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutorBridge}`);
  lines.push(`- strategyInputBuilderUsesProductionExecutorDryRun: ${report.mainImageAgentDraft.strategyInputBuilderUsesProductionExecutorDryRun}`);
  lines.push(`- draftExposesStrategyContract: ${report.mainImageAgentDraft.draftExposesStrategyContract}`);
  lines.push(`- draftExposesStrategyInputEvidence: ${report.mainImageAgentDraft.draftExposesStrategyInputEvidence}`);
  lines.push(`- draftUsesStrategyInputBuilder: ${report.mainImageAgentDraft.draftUsesStrategyInputBuilder}`);
  lines.push(`- draftPlanUsesAssetSelection: ${report.mainImageAgentDraft.draftPlanUsesAssetSelection}`);
  lines.push(`- draftPlanUsesVisualLoop: ${report.mainImageAgentDraft.draftPlanUsesVisualLoop}`);
  lines.push(`- executorCanRunVisionPreflight: ${report.mainImageAgentDraft.executorCanRunVisionPreflight}`);
  lines.push(`- executorExposesCandidatePreflight: ${report.mainImageAgentDraft.executorExposesCandidatePreflight}`);
  lines.push(`- executorExposesExecutionAlignment: ${report.mainImageAgentDraft.executorExposesExecutionAlignment}`);
  lines.push(`- executorExposesScreenshotQa: ${report.mainImageAgentDraft.executorExposesScreenshotQa}`);
  lines.push(`- executorExposesScreenshotProbeReadiness: ${report.mainImageAgentDraft.executorExposesScreenshotProbeReadiness}`);
  lines.push(`- executorRunsPixelProbeAdapter: ${report.mainImageAgentDraft.executorRunsPixelProbeAdapter}`);
  lines.push(`- executorExposesQaReport: ${report.mainImageAgentDraft.executorExposesQaReport}`);
  lines.push(`- resourceProbeImageFileAvailable: ${report.mainImageAgentDraft.resourceProbeImageFileAvailable}`);
  lines.push(`- resourceCompareImageFilesAvailable: ${report.mainImageAgentDraft.resourceCompareImageFilesAvailable}`);
  lines.push(`- plannerAcceptsVisionSignal: ${report.mainImageAgentDraft.plannerAcceptsVisionSignal}`);
  lines.push(`- executorExposesDraft: ${report.mainImageAgentDraft.executorExposesDraft}`);
  lines.push(`- executorExposesAssetSelection: ${report.mainImageAgentDraft.executorExposesAssetSelection}`);
  lines.push(`- executorExposesVisualLoop: ${report.mainImageAgentDraft.executorExposesVisualLoop}`);
  lines.push('');
  lines.push('projectAssetIndex:');
  lines.push(`- helperAvailable: ${report.projectAssetIndex.helperAvailable}`);
  lines.push(`- smokeAvailable: ${report.projectAssetIndex.smokeAvailable}`);
  lines.push(`- liveSmokeAvailable: ${report.projectAssetIndex.liveSmokeAvailable}`);
  lines.push(`- visualSamplingHelperAvailable: ${report.projectAssetIndex.visualSamplingHelperAvailable}`);
  lines.push(`- visualSamplingSmokeAvailable: ${report.projectAssetIndex.visualSamplingSmokeAvailable}`);
  lines.push(`- visualInsightCacheHelperAvailable: ${report.projectAssetIndex.visualInsightCacheHelperAvailable}`);
  lines.push(`- visualInsightCacheSmokeAvailable: ${report.projectAssetIndex.visualInsightCacheSmokeAvailable}`);
  lines.push(`- visualInsightCacheFillHelperAvailable: ${report.projectAssetIndex.visualInsightCacheFillHelperAvailable}`);
  lines.push(`- visualInsightCacheFillRendererAvailable: ${report.projectAssetIndex.visualInsightCacheFillRendererAvailable}`);
  lines.push(`- visualInsightCacheFillSmokeAvailable: ${report.projectAssetIndex.visualInsightCacheFillSmokeAvailable}`);
  lines.push(`- businessVisualContextHelperAvailable: ${report.projectAssetIndex.businessVisualContextHelperAvailable}`);
  lines.push(`- businessVisualObservationFeedbackHelperAvailable: ${report.projectAssetIndex.businessVisualObservationFeedbackHelperAvailable}`);
  lines.push(`- businessVisualContextRendererAvailable: ${report.projectAssetIndex.businessVisualContextRendererAvailable}`);
  lines.push(`- businessVisualObservationFeedbackRendererAvailable: ${report.projectAssetIndex.businessVisualObservationFeedbackRendererAvailable}`);
  lines.push(`- businessVisualObservationFeedbackUiAvailable: ${report.projectAssetIndex.businessVisualObservationFeedbackUiAvailable}`);
  lines.push(`- businessVisualContextEntrypointWired: ${report.projectAssetIndex.businessVisualContextEntrypointWired}`);
  lines.push(`- businessVisualContextSmokeAvailable: ${report.projectAssetIndex.businessVisualContextSmokeAvailable}`);
  lines.push(`- businessVisualObservationFeedbackSmokeAvailable: ${report.projectAssetIndex.businessVisualObservationFeedbackSmokeAvailable}`);
  lines.push(`- businessVisualObservationFeedbackDesktopSmokeAvailable: ${report.projectAssetIndex.businessVisualObservationFeedbackDesktopSmokeAvailable}`);
  lines.push(`- agentAcceptanceControlPlaneHelperAvailable: ${report.projectAssetIndex.agentAcceptanceControlPlaneHelperAvailable}`);
  lines.push(`- agentAcceptanceControlPlaneSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceControlPlaneSmokeAvailable}`);
  lines.push(`- agentAcceptanceControlPlaneModesCovered: ${report.projectAssetIndex.agentAcceptanceControlPlaneModesCovered}`);
  lines.push(`- agentAcceptanceControlPlaneLiveGuarded: ${report.projectAssetIndex.agentAcceptanceControlPlaneLiveGuarded}`);
  lines.push(`- agentAcceptanceVerificationMatrixHelperAvailable: ${report.projectAssetIndex.agentAcceptanceVerificationMatrixHelperAvailable}`);
  lines.push(`- agentAcceptanceVerificationMatrixSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceVerificationMatrixSmokeAvailable}`);
  lines.push(`- agentAcceptanceVerificationMatrixCommandAvailable: ${report.projectAssetIndex.agentAcceptanceVerificationMatrixCommandAvailable}`);
  lines.push(`- agentAcceptanceVerificationMatrixNoQualityClaim: ${report.projectAssetIndex.agentAcceptanceVerificationMatrixNoQualityClaim}`);
  lines.push(`- agentAcceptanceExecutionSuiteHelperAvailable: ${report.projectAssetIndex.agentAcceptanceExecutionSuiteHelperAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceExecutionSuiteSmokeAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteCommandAvailable: ${report.projectAssetIndex.agentAcceptanceExecutionSuiteCommandAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteRunSafeCommandAvailable: ${report.projectAssetIndex.agentAcceptanceExecutionSuiteRunSafeCommandAvailable}`);
  lines.push(`- agentAcceptanceExecutionSuiteDefaultSafeOnly: ${report.projectAssetIndex.agentAcceptanceExecutionSuiteDefaultSafeOnly}`);
  lines.push(`- agentAcceptanceDiagnosticExportHelperAvailable: ${report.projectAssetIndex.agentAcceptanceDiagnosticExportHelperAvailable}`);
  lines.push(`- agentAcceptanceDiagnosticExportSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceDiagnosticExportSmokeAvailable}`);
  lines.push(`- agentAcceptanceDiagnosticExportWiredToChatBridge: ${report.projectAssetIndex.agentAcceptanceDiagnosticExportWiredToChatBridge}`);
  lines.push(`- agentAcceptanceBusinessSkillVerificationSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceBusinessSkillVerificationSmokeAvailable}`);
  lines.push(`- agentAcceptanceBusinessSkillVerificationReportAvailable: ${report.projectAssetIndex.agentAcceptanceBusinessSkillVerificationReportAvailable}`);
  lines.push(`- agentAcceptanceBusinessSkillVerificationExportAvailable: ${report.projectAssetIndex.agentAcceptanceBusinessSkillVerificationExportAvailable}`);
  lines.push(`- agentIntentDecisionIntakeHelperAvailable: ${report.projectAssetIndex.agentIntentDecisionIntakeHelperAvailable}`);
  lines.push(`- agentIntentDecisionIntakeSmokeAvailable: ${report.projectAssetIndex.agentIntentDecisionIntakeSmokeAvailable}`);
  lines.push(`- agentIntentDecisionIntakeSmokeInPreflight: ${report.projectAssetIndex.agentIntentDecisionIntakeSmokeInPreflight}`);
  lines.push(`- agentIntentDecisionIntakeReportAvailable: ${report.projectAssetIndex.agentIntentDecisionIntakeReportAvailable}`);
  lines.push(`- agentIntentDecisionIntakeExportAvailable: ${report.projectAssetIndex.agentIntentDecisionIntakeExportAvailable}`);
  lines.push(`- agentIntentDecisionIntakeNoExecutionBoundary: ${report.projectAssetIndex.agentIntentDecisionIntakeNoExecutionBoundary}`);
  lines.push(`- agentVisibleActivitySmokeAvailable: ${report.projectAssetIndex.agentVisibleActivitySmokeAvailable}`);
  lines.push(`- agentVisibleActivitySmokeInPreflight: ${report.projectAssetIndex.agentVisibleActivitySmokeInPreflight}`);
  lines.push(`- agentWorkerIdentitySmokeAvailable: ${report.projectAssetIndex.agentWorkerIdentitySmokeAvailable}`);
  lines.push(`- agentWorkerIdentitySmokeInPreflight: ${report.projectAssetIndex.agentWorkerIdentitySmokeInPreflight}`);
  lines.push(`- agentVisibleActivityHelperAvailable: ${report.projectAssetIndex.agentVisibleActivityHelperAvailable}`);
  lines.push(`- agentWorkerIdentityTeammateBoundary: ${report.projectAssetIndex.agentWorkerIdentityTeammateBoundary}`);
  lines.push(`- agentAcceptanceRuntimeModeContractAvailable: ${report.projectAssetIndex.agentAcceptanceRuntimeModeContractAvailable}`);
  lines.push(`- agentAcceptanceRuntimeModeSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceRuntimeModeSmokeAvailable}`);
  lines.push(`- agentAcceptanceRuntimeModeSmokeInPreflight: ${report.projectAssetIndex.agentAcceptanceRuntimeModeSmokeInPreflight}`);
  lines.push(`- agentAcceptanceRuntimeModeProductionBoundary: ${report.projectAssetIndex.agentAcceptanceRuntimeModeProductionBoundary}`);
  lines.push(`- agentAcceptanceRuntimeModeDeveloperBoundary: ${report.projectAssetIndex.agentAcceptanceRuntimeModeDeveloperBoundary}`);
  lines.push(`- ecommerceSocksDesignEntrySmokeAvailable: ${report.projectAssetIndex.ecommerceSocksDesignEntrySmokeAvailable}`);
  lines.push(`- ecommerceSocksDesignEntrySmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksDesignEntrySmokeInPreflight}`);
  lines.push(`- ecommerceSocksStrategyCheckpointSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksStrategyCheckpointSmokeAvailable}`);
  lines.push(`- ecommerceSocksStrategyCheckpointSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksStrategyCheckpointSmokeInPreflight}`);
  lines.push(`- ecommerceSocksStrategyCheckpointNoQualityClaim: ${report.projectAssetIndex.ecommerceSocksStrategyCheckpointNoQualityClaim}`);
  lines.push(`- ecommerceSocksChildStrategyPacketsSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksChildStrategyPacketsSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildStrategyPacketsSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksChildStrategyPacketsSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildStrategyPacketsNoImplementation: ${report.projectAssetIndex.ecommerceSocksChildStrategyPacketsNoImplementation}`);
  lines.push(`- ecommerceSocksChildStrategyReviewGateSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksChildStrategyReviewGateSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildStrategyReviewGateSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksChildStrategyReviewGateSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildStrategyReviewGateNoExecution: ${report.projectAssetIndex.ecommerceSocksChildStrategyReviewGateNoExecution}`);
  lines.push(`- ecommerceSocksDispatchCheckpointSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksDispatchCheckpointSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchCheckpointSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksDispatchCheckpointSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDispatchLifecycleSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksDispatchLifecycleSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchLifecycleSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksDispatchLifecycleSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDispatchOrchestrationSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksDispatchOrchestrationSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchOrchestrationSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksDispatchOrchestrationSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDispatchAuthorizationSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksDispatchAuthorizationSmokeAvailable}`);
  lines.push(`- ecommerceSocksDispatchAuthorizationSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksDispatchAuthorizationSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildDispatchRunnerSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksChildDispatchRunnerSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildDispatchRunnerSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksChildDispatchRunnerSmokeInPreflight}`);
  lines.push(`- ecommerceSocksChildReportAggregationSmokeAvailable: ${report.projectAssetIndex.ecommerceSocksChildReportAggregationSmokeAvailable}`);
  lines.push(`- ecommerceSocksChildReportAggregationSmokeInPreflight: ${report.projectAssetIndex.ecommerceSocksChildReportAggregationSmokeInPreflight}`);
  lines.push(`- ecommerceSocksDesignSkillDeclared: ${report.projectAssetIndex.ecommerceSocksDesignSkillDeclared}`);
  lines.push(`- ecommerceSocksDesignExecutorRegistered: ${report.projectAssetIndex.ecommerceSocksDesignExecutorRegistered}`);
  lines.push(`- ecommerceSocksDesignNoPhotoshopToolsBoundary: ${report.projectAssetIndex.ecommerceSocksDesignNoPhotoshopToolsBoundary}`);
  lines.push(`- ecommerceSocksDispatchNoChildExecutionBoundary: ${report.projectAssetIndex.ecommerceSocksDispatchNoChildExecutionBoundary}`);
  lines.push(`- ecommerceSocksDispatchLifecycleBoundary: ${report.projectAssetIndex.ecommerceSocksDispatchLifecycleBoundary}`);
  lines.push(`- ecommerceSocksDispatchOrchestrationBoundary: ${report.projectAssetIndex.ecommerceSocksDispatchOrchestrationBoundary}`);
  lines.push(`- ecommerceSocksDispatchAuthorizationBoundary: ${report.projectAssetIndex.ecommerceSocksDispatchAuthorizationBoundary}`);
  lines.push(`- ecommerceSocksChildDispatchRunnerBoundary: ${report.projectAssetIndex.ecommerceSocksChildDispatchRunnerBoundary}`);
  lines.push(`- ecommerceSocksChildReportAggregationBoundary: ${report.projectAssetIndex.ecommerceSocksChildReportAggregationBoundary}`);
  lines.push(`- agentVisibleActivityNoFakeThinkingBoundary: ${report.projectAssetIndex.agentVisibleActivityNoFakeThinkingBoundary}`);
  lines.push(`- agentObservationChannelPolicyAvailable: ${report.projectAssetIndex.agentObservationChannelPolicyAvailable}`);
  lines.push(`- agentObservationChannelPolicySmokeAvailable: ${report.projectAssetIndex.agentObservationChannelPolicySmokeAvailable}`);
  lines.push(`- agentObservationChannelPolicySmokeInPreflight: ${report.projectAssetIndex.agentObservationChannelPolicySmokeInPreflight}`);
  lines.push(`- agentObservationChannelPolicyWiredToChatPanel: ${report.projectAssetIndex.agentObservationChannelPolicyWiredToChatPanel}`);
  lines.push(`- agentObservationChannelPolicyWiredToRuntime: ${report.projectAssetIndex.agentObservationChannelPolicyWiredToRuntime}`);
  lines.push(`- agentProviderObservationCapabilitiesAvailable: ${report.projectAssetIndex.agentProviderObservationCapabilitiesAvailable}`);
  lines.push(`- agentProviderObservationCapabilitiesSmokeAvailable: ${report.projectAssetIndex.agentProviderObservationCapabilitiesSmokeAvailable}`);
  lines.push(`- agentProviderObservationCapabilitiesSmokeInPreflight: ${report.projectAssetIndex.agentProviderObservationCapabilitiesSmokeInPreflight}`);
  lines.push(`- agentProviderObservationCapabilitiesNoFakeThinkingBoundary: ${report.projectAssetIndex.agentProviderObservationCapabilitiesNoFakeThinkingBoundary}`);
  lines.push(`- providerNativeToolsContractAvailable: ${report.projectAssetIndex.providerNativeToolsContractAvailable}`);
  lines.push(`- providerNativeToolsSmokeAvailable: ${report.projectAssetIndex.providerNativeToolsSmokeAvailable}`);
  lines.push(`- providerNativeToolsSmokeInPreflight: ${report.projectAssetIndex.providerNativeToolsSmokeInPreflight}`);
  lines.push(`- providerNativeToolsAdapterTypesAvailable: ${report.projectAssetIndex.providerNativeToolsAdapterTypesAvailable}`);
  lines.push(`- providerNativeToolsNoFunctionToolBoundary: ${report.projectAssetIndex.providerNativeToolsNoFunctionToolBoundary}`);
  lines.push(`- searxngDesignKnowledgeConnectorAvailable: ${report.projectAssetIndex.searxngDesignKnowledgeConnectorAvailable}`);
  lines.push(`- searxngDesignKnowledgeSmokeAvailable: ${report.projectAssetIndex.searxngDesignKnowledgeSmokeAvailable}`);
  lines.push(`- searxngDesignKnowledgeSmokeInPreflight: ${report.projectAssetIndex.searxngDesignKnowledgeSmokeInPreflight}`);
  lines.push(`- searxngDesignKnowledgeServiceWired: ${report.projectAssetIndex.searxngDesignKnowledgeServiceWired}`);
  lines.push(`- searxngDesignKnowledgeNoDockerBoundary: ${report.projectAssetIndex.searxngDesignKnowledgeNoDockerBoundary}`);
  lines.push(`- agentExecutionLifecycleHelperAvailable: ${report.projectAssetIndex.agentExecutionLifecycleHelperAvailable}`);
  lines.push(`- agentExecutionLifecycleSmokeAvailable: ${report.projectAssetIndex.agentExecutionLifecycleSmokeAvailable}`);
  lines.push(`- agentExecutionLifecycleSmokeInPreflight: ${report.projectAssetIndex.agentExecutionLifecycleSmokeInPreflight}`);
  lines.push(`- agentExecutionLifecycleAcceptanceSmokeAvailable: ${report.projectAssetIndex.agentExecutionLifecycleAcceptanceSmokeAvailable}`);
  lines.push(`- agentExecutionLifecycleAcceptanceSmokeInPreflight: ${report.projectAssetIndex.agentExecutionLifecycleAcceptanceSmokeInPreflight}`);
  lines.push(`- agentExecutionLifecycleAcceptanceReportAvailable: ${report.projectAssetIndex.agentExecutionLifecycleAcceptanceReportAvailable}`);
  lines.push(`- agentExecutionLifecycleAcceptanceExportAvailable: ${report.projectAssetIndex.agentExecutionLifecycleAcceptanceExportAvailable}`);
  lines.push(`- agentExecutionLifecycleNoFakeThinkingBoundary: ${report.projectAssetIndex.agentExecutionLifecycleNoFakeThinkingBoundary}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeHelperAvailable: ${report.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeHelperAvailable}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable: ${report.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeSmokeInPreflight: ${report.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeSmokeInPreflight}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeNoQualityClaim: ${report.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeNoQualityClaim}`);
  lines.push(`- livePhotoshopAcceptanceEvidenceIntakeNoRunBoundary: ${report.projectAssetIndex.livePhotoshopAcceptanceEvidenceIntakeNoRunBoundary}`);
  lines.push(`- agentAcceptanceTriageHelperAvailable: ${report.projectAssetIndex.agentAcceptanceTriageHelperAvailable}`);
  lines.push(`- agentAcceptanceTriageSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceTriageSmokeAvailable}`);
  lines.push(`- agentAcceptanceTriageWiredToDebugExport: ${report.projectAssetIndex.agentAcceptanceTriageWiredToDebugExport}`);
  lines.push(`- agentAcceptanceTriageReportHelperAvailable: ${report.projectAssetIndex.agentAcceptanceTriageReportHelperAvailable}`);
  lines.push(`- agentAcceptanceTriageReportCommandAvailable: ${report.projectAssetIndex.agentAcceptanceTriageReportCommandAvailable}`);
  lines.push(`- agentAcceptanceTriageReportSmokeAvailable: ${report.projectAssetIndex.agentAcceptanceTriageReportSmokeAvailable}`);
  lines.push(`- agentAcceptanceTriageReportWiredToDesktopReport: ${report.projectAssetIndex.agentAcceptanceTriageReportWiredToDesktopReport}`);
  lines.push(`- businessSkillDesignGovernanceDocAvailable: ${report.projectAssetIndex.businessSkillDesignGovernanceDocAvailable}`);
  lines.push(`- businessSkillDesignGovernanceSmokeAvailable: ${report.projectAssetIndex.businessSkillDesignGovernanceSmokeAvailable}`);
  lines.push(`- businessSkillImplementationCheckpointHelperAvailable: ${report.projectAssetIndex.businessSkillImplementationCheckpointHelperAvailable}`);
  lines.push(`- businessSkillImplementationCheckpointSmokeAvailable: ${report.projectAssetIndex.businessSkillImplementationCheckpointSmokeAvailable}`);
  lines.push(`- businessSkillImplementationCheckpointRequiresUserCheckpoint: ${report.projectAssetIndex.businessSkillImplementationCheckpointRequiresUserCheckpoint}`);
  lines.push(`- businessSkillImplementationCheckpointMentionsThreeSkills: ${report.projectAssetIndex.businessSkillImplementationCheckpointMentionsThreeSkills}`);
  lines.push(`- businessSkillReadinessContractHelperAvailable: ${report.projectAssetIndex.businessSkillReadinessContractHelperAvailable}`);
  lines.push(`- businessSkillReadinessContractSmokeAvailable: ${report.projectAssetIndex.businessSkillReadinessContractSmokeAvailable}`);
  lines.push(`- businessSkillReadinessContractUsesImplementationCheckpoint: ${report.projectAssetIndex.businessSkillReadinessContractUsesImplementationCheckpoint}`);
  lines.push(`- businessSkillReadinessContractRequiresStrategyInputs: ${report.projectAssetIndex.businessSkillReadinessContractRequiresStrategyInputs}`);
  lines.push(`- businessSkillReadinessContractNoQualityClaim: ${report.projectAssetIndex.businessSkillReadinessContractNoQualityClaim}`);
  lines.push(`- businessSkillExecutionPreflightGateHelperAvailable: ${report.projectAssetIndex.businessSkillExecutionPreflightGateHelperAvailable}`);
  lines.push(`- businessSkillExecutionPreflightGateSmokeAvailable: ${report.projectAssetIndex.businessSkillExecutionPreflightGateSmokeAvailable}`);
  lines.push(`- businessSkillExecutionPreflightGateUsesImplementationCheckpoint: ${report.projectAssetIndex.businessSkillExecutionPreflightGateUsesImplementationCheckpoint}`);
  lines.push(`- businessSkillExecutionPreflightGateUsesAcceptanceControlPlane: ${report.projectAssetIndex.businessSkillExecutionPreflightGateUsesAcceptanceControlPlane}`);
  lines.push(`- businessSkillExecutionPreflightGateMentionsThreeSkills: ${report.projectAssetIndex.businessSkillExecutionPreflightGateMentionsThreeSkills}`);
  lines.push(`- businessSkillExecutionPreflightGateNoExecutorChange: ${report.projectAssetIndex.businessSkillExecutionPreflightGateNoExecutorChange}`);
  lines.push(`- businessSkillExecutionPreflightWiringSmokeAvailable: ${report.projectAssetIndex.businessSkillExecutionPreflightWiringSmokeAvailable}`);
  lines.push(`- businessSkillExecutionPreflightEntrypointWired: ${report.projectAssetIndex.businessSkillExecutionPreflightEntrypointWired}`);
  lines.push(`- businessSkillExecutionPreflightControlContextOnly: ${report.projectAssetIndex.businessSkillExecutionPreflightControlContextOnly}`);
  lines.push(`- businessSkillPreflightPlannerContextHelperAvailable: ${report.projectAssetIndex.businessSkillPreflightPlannerContextHelperAvailable}`);
  lines.push(`- businessSkillPreflightPlannerContextSmokeAvailable: ${report.projectAssetIndex.businessSkillPreflightPlannerContextSmokeAvailable}`);
  lines.push(`- businessSkillPreflightPlannerContextWired: ${report.projectAssetIndex.businessSkillPreflightPlannerContextWired}`);
  lines.push(`- businessSkillPreflightPlannerContextNoQualityClaim: ${report.projectAssetIndex.businessSkillPreflightPlannerContextNoQualityClaim}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanHelperAvailable: ${report.projectAssetIndex.businessSkillVisualObservationRefreshPlanHelperAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanSmokeAvailable: ${report.projectAssetIndex.businessSkillVisualObservationRefreshPlanSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanWired: ${report.projectAssetIndex.businessSkillVisualObservationRefreshPlanWired}`);
  lines.push(`- businessSkillVisualObservationRefreshPlanDefaultDisabled: ${report.projectAssetIndex.businessSkillVisualObservationRefreshPlanDefaultDisabled}`);
  lines.push(`- businessSkillVisualObservationRefreshRunnerSmokeAvailable: ${report.projectAssetIndex.businessSkillVisualObservationRefreshRunnerSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshRunnerWired: ${report.projectAssetIndex.businessSkillVisualObservationRefreshRunnerWired}`);
  lines.push(`- businessSkillVisualObservationRefreshRunnerPostExecutor: ${report.projectAssetIndex.businessSkillVisualObservationRefreshRunnerPostExecutor}`);
  lines.push(`- businessSkillVisualObservationRefreshRuntimeSmokeAvailable: ${report.projectAssetIndex.businessSkillVisualObservationRefreshRuntimeSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshRuntimeAutoDetects: ${report.projectAssetIndex.businessSkillVisualObservationRefreshRuntimeAutoDetects}`);
  lines.push(`- businessSkillVisualContextPreparationHelperAvailable: ${report.projectAssetIndex.businessSkillVisualContextPreparationHelperAvailable}`);
  lines.push(`- businessSkillVisualContextPreparationSmokeAvailable: ${report.projectAssetIndex.businessSkillVisualContextPreparationSmokeAvailable}`);
  lines.push(`- businessSkillVisualContextPreparationWired: ${report.projectAssetIndex.businessSkillVisualContextPreparationWired}`);
  lines.push(`- businessSkillVisualContextPreparationRunnerWired: ${report.projectAssetIndex.businessSkillVisualContextPreparationRunnerWired}`);
  lines.push(`- businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable: ${report.projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable}`);
  lines.push(`- businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint: ${report.projectAssetIndex.businessSkillVisualObservationRefreshExecutorWiringCoversUnifiedEntrypoint}`);
  lines.push(`- projectAssetUnderstandingIntakeHelperAvailable: ${report.projectAssetIndex.projectAssetUnderstandingIntakeHelperAvailable}`);
  lines.push(`- projectAssetUnderstandingIntakeSmokeAvailable: ${report.projectAssetIndex.projectAssetUnderstandingIntakeSmokeAvailable}`);
  lines.push(`- projectAssetUnderstandingIntakeWired: ${report.projectAssetIndex.projectAssetUnderstandingIntakeWired}`);
  lines.push(`- projectAssetUnderstandingIntakeNoQualityClaim: ${report.projectAssetIndex.projectAssetUnderstandingIntakeNoQualityClaim}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeHelperAvailable: ${report.projectAssetIndex.businessSkillImagePlacementVerificationIntakeHelperAvailable}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeSmokeAvailable: ${report.projectAssetIndex.businessSkillImagePlacementVerificationIntakeSmokeAvailable}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeWired: ${report.projectAssetIndex.businessSkillImagePlacementVerificationIntakeWired}`);
  lines.push(`- businessSkillImagePlacementVerificationIntakeNoQualityClaim: ${report.projectAssetIndex.businessSkillImagePlacementVerificationIntakeNoQualityClaim}`);
  lines.push(`- businessSkillExecutionPlanIntakeHelperAvailable: ${report.projectAssetIndex.businessSkillExecutionPlanIntakeHelperAvailable}`);
  lines.push(`- businessSkillExecutionPlanIntakeSmokeAvailable: ${report.projectAssetIndex.businessSkillExecutionPlanIntakeSmokeAvailable}`);
  lines.push(`- businessSkillExecutionPlanIntakeWired: ${report.projectAssetIndex.businessSkillExecutionPlanIntakeWired}`);
  lines.push(`- businessSkillExecutionPlanIntakeNoQualityClaim: ${report.projectAssetIndex.businessSkillExecutionPlanIntakeNoQualityClaim}`);
  lines.push(`- businessSkillVisualObservationDiagnosticSmokeAvailable: ${report.projectAssetIndex.businessSkillVisualObservationDiagnosticSmokeAvailable}`);
  lines.push(`- businessSkillDesignGovernanceRequiresUserCheckpoint: ${report.projectAssetIndex.businessSkillDesignGovernanceRequiresUserCheckpoint}`);
  lines.push(`- businessSkillDesignGovernanceMentionsThreeSkills: ${report.projectAssetIndex.businessSkillDesignGovernanceMentionsThreeSkills}`);
  lines.push(`- contextSnapshotCarriesVisualSampling: ${report.projectAssetIndex.contextSnapshotCarriesVisualSampling}`);
  lines.push(`- contextSnapshotCarriesVisualInsightCache: ${report.projectAssetIndex.contextSnapshotCarriesVisualInsightCache}`);
  lines.push(`- runtimeBuildsVisualSampling: ${report.projectAssetIndex.runtimeBuildsVisualSampling}`);
  lines.push(`- runtimeReadsVisualInsightCache: ${report.projectAssetIndex.runtimeReadsVisualInsightCache}`);
  lines.push(`- runtimeWritesVisualInsightCache: ${report.projectAssetIndex.runtimeWritesVisualInsightCache}`);
  lines.push(`- rendererContextCarriesVisualSampling: ${report.projectAssetIndex.rendererContextCarriesVisualSampling}`);
  lines.push(`- rendererContextCarriesVisualInsightCache: ${report.projectAssetIndex.rendererContextCarriesVisualInsightCache}`);
  lines.push(`- plannerConsumesVisualSampling: ${report.projectAssetIndex.plannerConsumesVisualSampling}`);
  lines.push(`- plannerConsumesVisualInsightCache: ${report.projectAssetIndex.plannerConsumesVisualInsightCache}`);
  lines.push(`- ipcWriteVisualInsightCacheAvailable: ${report.projectAssetIndex.ipcWriteVisualInsightCacheAvailable}`);
  lines.push(`- preloadWriteVisualInsightCacheAvailable: ${report.projectAssetIndex.preloadWriteVisualInsightCacheAvailable}`);
  lines.push(`- maintenanceValidateRunsSmoke: ${report.projectAssetIndex.maintenanceValidateRunsSmoke}`);
  lines.push(`- plannerAcceptsAssetIndex: ${report.projectAssetIndex.plannerAcceptsAssetIndex}`);
  lines.push(`- plannerReadsAssetIndex: ${report.projectAssetIndex.plannerReadsAssetIndex}`);
  lines.push(`- snapshotBuilderAvailable: ${report.projectAssetIndex.snapshotBuilderAvailable}`);
  lines.push(`- runtimeServiceAvailable: ${report.projectAssetIndex.runtimeServiceAvailable}`);
  lines.push(`- runtimeSmokeAvailable: ${report.projectAssetIndex.runtimeSmokeAvailable}`);
  lines.push(`- ipcHandlerAvailable: ${report.projectAssetIndex.ipcHandlerAvailable}`);
  lines.push(`- preloadApiAvailable: ${report.projectAssetIndex.preloadApiAvailable}`);
  lines.push(`- rendererContextConsumesSnapshot: ${report.projectAssetIndex.rendererContextConsumesSnapshot}`);
  lines.push(`- plannerEvidenceConsumesAssetIndex: ${report.projectAssetIndex.plannerEvidenceConsumesAssetIndex}`);
  lines.push(`- parsesSkuConfigCsv: ${report.projectAssetIndex.parsesSkuConfigCsv}`);
  lines.push(`- limitationNoAestheticClaim: ${report.projectAssetIndex.limitationNoAestheticClaim}`);
  lines.push('');
  lines.push('imagePlacementCore:');
  lines.push(`- helperAvailable: ${report.imagePlacementCore.helperAvailable}`);
  lines.push(`- docAvailable: ${report.imagePlacementCore.docAvailable}`);
  lines.push(`- readinessReportAvailable: ${report.imagePlacementCore.readinessReportAvailable}`);
  lines.push(`- smokeAvailable: ${report.imagePlacementCore.smokeAvailable}`);
  lines.push(`- readinessSmokeAvailable: ${report.imagePlacementCore.readinessSmokeAvailable}`);
  lines.push(`- smokeInPreflight: ${report.imagePlacementCore.smokeInPreflight}`);
  lines.push(`- readinessSmokeInPreflight: ${report.imagePlacementCore.readinessSmokeInPreflight}`);
  lines.push(`- wrapsSmartScalingPolicy: ${report.imagePlacementCore.wrapsSmartScalingPolicy}`);
  lines.push(`- requiresActualBoundsReadback: ${report.imagePlacementCore.requiresActualBoundsReadback}`);
  lines.push(`- screenshotFailureOverridesBounds: ${report.imagePlacementCore.screenshotFailureOverridesBounds}`);
  lines.push(`- businessSkillsNotDirectlyWired: ${report.imagePlacementCore.businessSkillsNotDirectlyWired}`);
  lines.push(`- policy: ${report.imagePlacementCore.policy}`);
  lines.push('');
  lines.push('agentPerformancePolicy:');
  lines.push(`- helperAvailable: ${report.agentPerformancePolicy.helperAvailable}`);
  lines.push(`- smokeAvailable: ${report.agentPerformancePolicy.smokeAvailable}`);
  lines.push(`- smokeInPreflight: ${report.agentPerformancePolicy.smokeInPreflight}`);
  lines.push(`- plannerBuildsPolicy: ${report.agentPerformancePolicy.plannerBuildsPolicy}`);
  lines.push(`- plannerExposesPolicy: ${report.agentPerformancePolicy.plannerExposesPolicy}`);
  lines.push(`- selectedContextCarriesPolicy: ${report.agentPerformancePolicy.selectedContextCarriesPolicy}`);
  lines.push(`- runtimeBudgetHelperAvailable: ${report.agentPerformancePolicy.runtimeBudgetHelperAvailable}`);
  lines.push(`- autonomousAgentUsesRuntimeBudget: ${report.agentPerformancePolicy.autonomousAgentUsesRuntimeBudget}`);
  lines.push(`- designTeamRuntimeBudgetHelperAvailable: ${report.agentPerformancePolicy.designTeamRuntimeBudgetHelperAvailable}`);
  lines.push(`- designTeamRegistryUsesRuntimeBudget: ${report.agentPerformancePolicy.designTeamRegistryUsesRuntimeBudget}`);
  lines.push(`- designTeamCoordinatorUsesRuntimeBudget: ${report.agentPerformancePolicy.designTeamCoordinatorUsesRuntimeBudget}`);
  lines.push(`- smokeCoversDesignTeamBudget: ${report.agentPerformancePolicy.smokeCoversDesignTeamBudget}`);
  lines.push(`- contextWindowBudgetHelperAvailable: ${report.agentPerformancePolicy.contextWindowBudgetHelperAvailable}`);
  lines.push(`- contextManagerUsesWindowBudget: ${report.agentPerformancePolicy.contextManagerUsesWindowBudget}`);
  lines.push(`- agentRuntimeUsesContextDefault: ${report.agentPerformancePolicy.agentRuntimeUsesContextDefault}`);
  lines.push(`- smokeCoversContextWindowBudget: ${report.agentPerformancePolicy.smokeCoversContextWindowBudget}`);
  lines.push(`- resourceCacheBudgetHelperAvailable: ${report.agentPerformancePolicy.resourceCacheBudgetHelperAvailable}`);
  lines.push(`- resourceManagerUsesCacheBudget: ${report.agentPerformancePolicy.resourceManagerUsesCacheBudget}`);
  lines.push(`- smokeCoversResourceCacheBudget: ${report.agentPerformancePolicy.smokeCoversResourceCacheBudget}`);
  lines.push(`- providerTokenBudgetHelperAvailable: ${report.agentPerformancePolicy.providerTokenBudgetHelperAvailable}`);
  lines.push(`- providerAdaptersUseTokenBudget: ${report.agentPerformancePolicy.providerAdaptersUseTokenBudget}`);
  lines.push(`- modelServiceUsesTokenBudget: ${report.agentPerformancePolicy.modelServiceUsesTokenBudget}`);
  lines.push(`- streamAdapterUsesTokenBudget: ${report.agentPerformancePolicy.streamAdapterUsesTokenBudget}`);
  lines.push(`- smokeCoversProviderTokenBudget: ${report.agentPerformancePolicy.smokeCoversProviderTokenBudget}`);
  lines.push(`- acceptanceCaptureBudgetHelperAvailable: ${report.agentPerformancePolicy.acceptanceCaptureBudgetHelperAvailable}`);
  lines.push(`- toolAcceptanceUsesCaptureBudget: ${report.agentPerformancePolicy.toolAcceptanceUsesCaptureBudget}`);
  lines.push(`- smokeCoversAcceptanceBudget: ${report.agentPerformancePolicy.smokeCoversAcceptanceBudget}`);
  lines.push(`- visualSamplingBudgetHelperAvailable: ${report.agentPerformancePolicy.visualSamplingBudgetHelperAvailable}`);
  lines.push(`- projectVisualSamplingUsesBudget: ${report.agentPerformancePolicy.projectVisualSamplingUsesBudget}`);
  lines.push(`- smokeCoversVisualSamplingBudget: ${report.agentPerformancePolicy.smokeCoversVisualSamplingBudget}`);
  lines.push(`- policyForbidsBulkScan: ${report.agentPerformancePolicy.policyForbidsBulkScan}`);
  lines.push(`- policyForbidsFullResolutionRead: ${report.agentPerformancePolicy.policyForbidsFullResolutionRead}`);
  lines.push(`- implementationTreeMentionsPerformance: ${report.agentPerformancePolicy.implementationTreeMentionsPerformance}`);
  lines.push('');
  lines.push('referenceStatusResume:');
  lines.push(`- available: ${report.referenceStatusResume.available}`);
  lines.push(`- designQualityClaimAllowed: ${report.referenceStatusResume.designQualityClaimAllowed}`);
  lines.push(`- nextActionCount: ${report.referenceStatusResume.nextActionCount}`);
  lines.push(`- realCaseEvidenceChainVisible: ${report.referenceStatusResume.realCaseEvidenceChainVisible}`);
  lines.push(`- validateEvidenceInResume: ${report.referenceStatusResume.validateEvidenceInResume}`);
  lines.push(`- cannotClaimFromIntakeOnly: ${report.referenceStatusResume.cannotClaimFromIntakeOnly}`);
  lines.push('');
  lines.push(`conclusion: ${report.conclusion}`);
  lines.push('');
  lines.push('gates:');
  for (const gate of report.gates) {
    lines.push(`- ${gate.id}: ${gate.status} - ${gate.title}`);
    if (gate.gaps.length > 0) {
      lines.push(`  gaps: ${gate.gaps.join(' / ')}`);
    }
  }
  lines.push('');
  lines.push('recommendedNext:');
  for (const item of report.recommendedNext) {
    lines.push(`- ${item}`);
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const report = buildReport();
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatReport(report));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
