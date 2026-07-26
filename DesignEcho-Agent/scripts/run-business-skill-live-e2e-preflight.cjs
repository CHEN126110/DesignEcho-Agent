#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'business-skill-live-e2e-preflight');
const REPORT_JSON = path.join(TMP_DIR, 'report.json');
const REPORT_MD = path.join(TMP_DIR, 'report.md');
const SYSTEM_PATH_SMOKE = 'scripts/smoke-business-skill-system-path.cjs';

require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.main.json')
});

const {
  buildBusinessSkillValidationMatrix,
  evaluateBusinessSkillLiveE2EAggregate
} = require(path.join(ROOT, 'src', 'shared', 'business-skill-live-e2e-readiness.ts'));

const RUNNERS = [
  {
    skillId: 'main-image-design',
    runnerPath: 'scripts/smoke-main-image-disposable-product-e2e.cjs',
    reportPath: 'tmp/main-image-disposable-product-e2e/report.json',
    liveModes: ['live-disposable-product-e2e']
  },
  {
    skillId: 'detail-page-design',
    runnerPath: 'scripts/run-agent-live-photoshop-detail-page-workflow-task.cjs',
    reportPath: 'tmp/agent-live-photoshop-detail-page-workflow-task.json',
    liveModes: ['live-agent-real-model-real-photoshop-detail-page-workflow']
  },
  {
    skillId: 'sku-batch',
    runnerPath: 'scripts/smoke-sku-c1163-live-acceptance.cjs',
    reportPath: 'tmp/sku-c1163-live-acceptance/report.json',
    liveModes: ['live-minimal-execution', 'live-configured-execution']
  }
];

function hasArg(name) {
  return process.argv.includes(name);
}

function includesAll(source, markers) {
  return markers.every((marker) => source.includes(marker));
}

function buildSourceEvidence(config) {
  const absolutePath = path.join(ROOT, config.runnerPath);
  const runnerPresent = fs.existsSync(absolutePath);
  const source = runnerPresent ? fs.readFileSync(absolutePath, 'utf8') : '';
  const isMainImage = config.skillId === 'main-image-design';
  const isDetailPage = config.skillId === 'detail-page-design';
  const isSku = config.skillId === 'sku-batch';

  return {
    skillId: config.skillId,
    runnerPath: config.runnerPath,
    checks: {
      runnerPresent,
      usesRealAgentRuntime: source.includes('new Agent('),
      usesRealModelProvider: source.includes('new ModelService(') && source.includes('.chatWithTools('),
      usesManifestRuntimeStagePlan: includesAll(source, ['runtimeStagePlan', 'runtimeManifest']),
      invokesSelectedSkillBridge: source.includes('executeSkillTool(') && source.includes(config.skillId),
      usesLivePhotoshopTools: (
        (isDetailPage && source.includes('executeToolCall('))
        || (isMainImage && includesAll(source, ['MCP_ENDPOINT', 'createMainImageLivePhotoshopToolAdapter']))
        || (isSku && includesAll(source, ['MCP_ENDPOINT', 'getAcceptanceSnapshot']))
      ),
      usesDisposableDocumentOrOutput: (
        source.includes('DISPOSABLE_DOCUMENT')
        || source.includes('DISPOSABLE_FLAG')
        || source.includes('DISPOSABLE_OUTPUT_FLAG')
      ),
      requiresExplicitLiveOptIn: source.includes('LIVE_FLAG') || source.includes('--live'),
      requiresExplicitWriteOptIn: (
        (isDetailPage && includesAll(source, ['LIVE_FLAG', 'DISPOSABLE_DOCUMENT_FLAG', 'getMissingLiveAuthorization']))
        || (isMainImage && includesAll(source, ['LIVE_FLAG', 'DISPOSABLE_FLAG', 'shouldRunLive']))
        || (isSku && includesAll(source, ['LIVE_FLAG', 'TAKEOVER_FLAG', 'DISPOSABLE_OUTPUT_FLAG']))
      ),
      capturesPostWriteReadback: (
        source.includes('getAcceptanceSnapshot')
        || source.includes('buildSkuExportReadback')
        || (isDetailPage && includesAll(source, ['getLayerHierarchy', 'requiredSignals']))
      ),
      capturesEvaluationChecks: (
        source.includes('buildMainImageQaReport')
        || source.includes('requiredSignals')
        || source.includes('buildSkuExportReadback')
      ),
      capturesDeliveryChecks: includesAll(source, ['runtimeStagePlan', 'R4', 'deliveryEvidence'])
    }
  };
}

function buildSourceReadiness() {
  return evaluateBusinessSkillLiveE2EAggregate(RUNNERS.map(buildSourceEvidence));
}

function readPersistedReport(config) {
  const absolutePath = path.join(ROOT, config.reportPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      reportPath: config.reportPath,
      exists: false,
      payload: null,
      parseError: null
    };
  }

  try {
    return {
      reportPath: config.reportPath,
      exists: true,
      payload: JSON.parse(fs.readFileSync(absolutePath, 'utf8')),
      parseError: null
    };
  } catch (error) {
    return {
      reportPath: config.reportPath,
      exists: true,
      payload: null,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

function isSimulatedReport(payload) {
  const mode = String(payload?.mode || '').toLowerCase();
  return mode.includes('self-test') || mode.includes('fake');
}

function isLiveReport(config, payload) {
  return config.liveModes.includes(String(payload?.mode || ''));
}

function hasSufficientLiveEvidence(config, payload) {
  if (payload?.success !== true || payload?.skipped === true || payload?.skippedLiveWrite === true) {
    return false;
  }

  switch (config.skillId) {
    case 'main-image-design':
      return payload.liveWriteArmed === true
        && Array.isArray(payload.executedTools)
        && payload.executedTools.length > 0
        && payload.statuses?.runner === 'completed_requires_review'
        && payload.cleanup?.attempted === true
        && payload.cleanup?.closed === true;
    case 'detail-page-design':
      return Number(payload.agent?.toolCount || 0) > 0
        && Number(payload.agent?.failedToolCount || 0) === 0
        && Array.isArray(payload.requiredSignals)
        && payload.requiredSignals.length > 0
        && payload.requiredSignals.every((signal) => signal?.passed === true)
        && payload.document?.openAfter === false;
    case 'sku-batch': {
      const execution = payload.mode === 'live-configured-execution'
        ? payload.configuredExecution
        : payload.minimalExecution;
      return execution?.executed === true
        && execution?.status === 'ready_for_manual_review'
        && payload.boundaries?.writesPhotoshop === true
        && payload.boundaries?.usesDisposableOutputDir === true;
    }
    default:
      return false;
  }
}

function buildPersistedRunEvidence(config, artifact = readPersistedReport(config)) {
  const common = {
    source: config.runnerPath,
    reportPath: artifact.reportPath || config.reportPath
  };

  if (!artifact.exists) {
    return {
      simulated: {
        level: 'simulated',
        state: 'not_executed',
        passed: false,
        ...common,
        reason: 'No persisted runner report exists.'
      },
      live: {
        level: 'live',
        state: 'not_executed',
        passed: false,
        ...common,
        reason: 'No persisted live runner report exists.'
      }
    };
  }

  if (artifact.parseError || !artifact.payload) {
    const reason = `Persisted runner report is unreadable: ${artifact.parseError || 'invalid payload'}`;
    return {
      simulated: {
        level: 'simulated',
        state: 'failed',
        passed: false,
        ...common,
        reason
      },
      live: {
        level: 'live',
        state: 'failed',
        passed: false,
        ...common,
        reason
      }
    };
  }

  const payload = artifact.payload;
  if (isLiveReport(config, payload)) {
    const sufficient = hasSufficientLiveEvidence(config, payload);
    return {
      simulated: {
        level: 'simulated',
        state: 'not_executed',
        passed: false,
        ...common,
        reason: 'The latest report is a live run; it is not reused as simulated evidence.'
      },
      live: {
        level: 'live',
        state: payload.skipped === true ? 'skipped' : (sufficient ? 'executed' : 'failed'),
        passed: sufficient,
        ...common,
        reason: sufficient
          ? 'The live runner executed and recorded its required readback evidence.'
          : 'The live report is failed, skipped, or missing required execution/readback evidence.'
      }
    };
  }

  const executionSkipped = payload.skipped === true;
  const liveSkipped = executionSkipped || payload.skippedLiveWrite === true;
  const simulated = isSimulatedReport(payload);
  return {
    simulated: {
      level: 'simulated',
      state: executionSkipped ? 'skipped' : (simulated && payload.success === true ? 'executed' : 'not_executed'),
      passed: !executionSkipped && simulated && payload.success === true,
      ...common,
      reason: executionSkipped
        ? 'The runner guard skipped execution.'
        : (simulated ? 'The persisted report contains simulated execution only.' : 'The persisted report is readiness-only, not a simulation run.')
    },
    live: {
      level: 'live',
      state: liveSkipped ? 'skipped' : 'not_executed',
      passed: false,
      ...common,
      reason: liveSkipped
        ? 'Live execution was explicitly skipped by the runner guard.'
        : 'The persisted report is not a recognized live execution mode.'
    }
  };
}

function buildSystemPathContractEvidence() {
  const absolutePath = path.join(ROOT, SYSTEM_PATH_SMOKE);
  const source = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
  const skillIds = ['main-image-design', 'detail-page-design', 'sku-batch'];
  const checks = {
    runnerPresent: Boolean(source),
    coversAllThreeSkills: skillIds.every((skillId) => source.includes(skillId)),
    usesProductionAgentRuntime: source.includes('new Agent('),
    usesProductionManifestResolver: source.includes('resolveAutonomousCapabilityRuntime'),
    usesProductionCapabilitySession: source.includes('runtime.capabilitySession'),
    usesProductionSkillBridge: source.includes('executeSkillTool('),
    requiresR1R3R4: includesAll(source, [
      'DECLARE_DESIGN_BRIEF_TOOL_NAME',
      'DECLARE_DESIGN_STRATEGY_TOOL_NAME',
      'DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME'
    ]),
    preservesFixtureBoundary: includesAll(source, [
      'modelIsFixture: !realProvider',
      'skillExecutorsAreFixtures: true',
      'executesPhotoshop: false',
      'claimsLiveE2E: false',
      'claimsDesignQuality: false'
    ])
  };
  return {
    version: 'business-skill-system-path-contract-evidence/v0',
    source: SYSTEM_PATH_SMOKE,
    verifiedByCommand: 'npm run smoke:agent:business-skill-system-path',
    ready: Object.values(checks).every(Boolean),
    checks
  };
}

function buildSkillValidationEvidence(
  architecture,
  offlineSystemPath,
  persistedReports = new Map()
) {
  return architecture.skills.map((skill) => {
    const config = RUNNERS.find((item) => item.skillId === skill.skillId);
    const artifact = persistedReports.has(skill.skillId)
      ? persistedReports.get(skill.skillId)
      : readPersistedReport(config);
    const persisted = buildPersistedRunEvidence(config, artifact);
    const matrix = buildBusinessSkillValidationMatrix([
      {
        level: 'static',
        state: skill.ready ? 'executed' : 'failed',
        passed: skill.ready,
        source: config.runnerPath,
        reason: skill.ready
          ? 'The runner source contains every required live-path marker.'
          : `Runner source checks are incomplete: ${skill.missingChecks.join(', ') || 'unknown'}.`
      },
      {
        level: 'contract',
        state: offlineSystemPath.ready ? 'executed' : 'failed',
        passed: offlineSystemPath.ready,
        source: offlineSystemPath.source,
        reason: offlineSystemPath.ready
          ? 'The shared production Agent/Manifest/Capability/Skill contract source checks passed.'
          : 'The shared production system-path contract source checks failed.'
      },
      persisted.simulated,
      persisted.live
    ]);

    return {
      skillId: skill.skillId,
      runnerPath: config.runnerPath,
      reportPath: config.reportPath,
      evidence: matrix,
      liveRequirementPassed: matrix.livePassed
    };
  });
}

function evaluatePreflightAcceptance({
  requireLive,
  architecture,
  offlineSystemPath,
  infrastructure,
  skillValidation
}) {
  const infrastructureReady = infrastructure.photoshopBridgeReachable === true
    && infrastructure.modelProviderReachable === true;
  const readyToRun = architecture.ready && offlineSystemPath.ready && infrastructureReady;
  const liveEvidencePassed = skillValidation.length > 0
    && skillValidation.every((skill) => skill.evidence.levels.live.state === 'executed'
      && skill.evidence.levels.live.passed === true);
  const sourceAndContractPassed = architecture.ready && offlineSystemPath.ready;
  const passed = requireLive
    ? readyToRun && liveEvidencePassed
    : sourceAndContractPassed;
  const blockers = [];

  if (!architecture.ready) blockers.push(`architecture:${architecture.status}`);
  if (!offlineSystemPath.ready) blockers.push('contract:offline_system_path_failed');
  if (requireLive && !infrastructure.photoshopBridgeReachable) blockers.push('infrastructure:photoshop_bridge_unreachable');
  if (requireLive && !infrastructure.modelProviderReachable) blockers.push('infrastructure:model_provider_unreachable');
  if (requireLive) {
    for (const skill of skillValidation) {
      const live = skill.evidence.levels.live;
      if (!live.passed) blockers.push(`${skill.skillId}:live_${live.state}`);
    }
  }

  return {
    requiredLevel: requireLive ? 'live' : 'contract',
    executionState: passed ? 'executed' : 'failed',
    passed,
    readyToRun,
    liveEvidencePassed,
    blockers
  };
}

function probeTcpPort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    function finish(reachable, reason) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, reachable, reason });
    }
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error.code || error.message));
  });
}

async function probeOllama(timeoutMs = 1200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
    if (!response.ok) return { reachable: false, reason: `HTTP ${response.status}`, models: [] };
    const payload = await response.json();
    const models = Array.isArray(payload.models)
      ? payload.models.map((item) => String(item.name || '')).filter(Boolean)
      : [];
    return { reachable: true, reason: 'ok', models };
  } catch (error) {
    return { reachable: false, reason: error?.cause?.code || error?.name || error?.message || String(error), models: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function renderMarkdown(report) {
  const lines = [
    '# 三类设计 Skill 实机 E2E 只读预检',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- mode: ${report.mode}`,
    `- commandCompleted: ${report.commandCompleted}`,
    `- passed: ${report.passed}`,
    `- requiredLevel: ${report.acceptance.requiredLevel}`,
    `- executionState: ${report.acceptance.executionState}`,
    `- readyToRun: ${report.acceptance.readyToRun}`,
    `- liveEvidencePassed: ${report.acceptance.liveEvidencePassed}`,
    `- architectureStatus: ${report.architecture.status}`,
    `- offlineSystemPathReady: ${report.offlineSystemPath.ready}`,
    `- photoshopBridgeReachable: ${report.infrastructure.photoshopBridgeReachable}`,
    `- modelProviderReachable: ${report.infrastructure.modelProviderReachable}`,
    '',
    '## Skill 覆盖度',
    ''
  ];

  for (const skill of report.architecture.skills) {
    const validation = report.skillValidation.find((item) => item.skillId === skill.skillId);
    lines.push(`### ${skill.skillId}`, '');
    lines.push(`- status: ${skill.status}`);
    lines.push(`- runner: ${skill.runnerPath}`);
    lines.push(`- missingChecks: ${skill.missingChecks.join(', ') || 'none'}`);
    lines.push(`- static: ${validation.evidence.levels.static.state}`);
    lines.push(`- contract: ${validation.evidence.levels.contract.state}`);
    lines.push(`- simulated: ${validation.evidence.levels.simulated.state}`);
    lines.push(`- live: ${validation.evidence.levels.live.state}`);
    lines.push(`- livePassed: ${validation.evidence.levels.live.passed}`, '');
  }

  lines.push('## 基础设施', '', '```json', JSON.stringify(report.infrastructure, null, 2), '```', '');
  lines.push('## 离线生产拓扑', '', '```json', JSON.stringify(report.offlineSystemPath, null, 2), '```', '');
  lines.push('## 边界', '');
  for (const boundary of report.boundaries) lines.push(`- ${boundary}`);
  return `${lines.join('\n')}\n`;
}

function writeReport(report) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');
}

async function runPreflight() {
  const requireLive = hasArg('--require-live');
  const architecture = buildSourceReadiness();
  const offlineSystemPath = buildSystemPathContractEvidence();
  const ports = await Promise.all([8765, 8766, 8767, 8768].map((port) => probeTcpPort(port)));
  const ollama = await probeOllama();
  const photoshopBridgeReachable = ports.some((item) => item.port === 8768 && item.reachable);
  const infrastructure = {
    photoshopBridgeReachable,
    modelProviderReachable: ollama.reachable,
    ports,
    ollama
  };
  const skillValidation = buildSkillValidationEvidence(architecture, offlineSystemPath);
  const acceptance = evaluatePreflightAcceptance({
    requireLive,
    architecture,
    offlineSystemPath,
    infrastructure,
    skillValidation
  });
  const report = {
    success: acceptance.passed,
    commandCompleted: true,
    passed: acceptance.passed,
    ready: acceptance.readyToRun,
    generatedAt: new Date().toISOString(),
    mode: 'read-only-business-skill-live-e2e-preflight',
    requireLive,
    acceptance,
    architecture,
    offlineSystemPath,
    skillValidation,
    infrastructure,
    report: {
      json: REPORT_JSON,
      markdown: REPORT_MD
    },
    boundaries: [
      '本预检只读取源代码并探测本机端口，不调用 Photoshop 写工具。',
      'partial_runner 仅表示存在部分实机链路，不代表 Agent + Manifest + Skill + Photoshop 已贯通。',
      '离线系统路径通过只证明生产 Agent / Manifest / Capability Session / Skill bridge 拓扑，不证明真实模型或 Photoshop。',
      'skipped 与 not_executed 始终 passed=false，普通预检只报告现状，不把未执行当作通过。',
      '--require-live 只有在三类 Skill 都具备 executed 实机报告、完整架构证据且模型与 Photoshop 就绪时才通过。',
      '预检不声明设计质量、交付完成或人工复核通过。'
    ]
  };
  writeReport(report);
  return report;
}

function resolvePreflightExitCode(report) {
  return report.requireLive === true && report.passed !== true ? 1 : 0;
}

async function main() {
  const report = await runPreflight();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = resolvePreflightExitCode(report);
}

module.exports = {
  RUNNERS,
  buildPersistedRunEvidence,
  buildSkillValidationEvidence,
  buildSourceEvidence,
  buildSourceReadiness,
  buildSystemPathContractEvidence,
  evaluatePreflightAcceptance,
  hasSufficientLiveEvidence,
  resolvePreflightExitCode,
  runPreflight
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
