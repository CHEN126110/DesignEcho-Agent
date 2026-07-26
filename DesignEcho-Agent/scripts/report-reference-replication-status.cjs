#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');
const {
  buildReferenceQualityGateConsistency
} = require('./lib/reference-quality-gate-consistency.cjs');

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

function commandText(parts) {
  return parts.join(' ');
}

function buildRealCaseEvidenceChain() {
  return {
    intakePlannerEmitsCommands: true,
    cannotClaimFromIntakeOnly: true,
    requiredOrder: [
      'maintenance:reference-real-case-intake',
      'benchmark:reference-replication:create-case',
      'maintenance:reference-capture-plan',
      'capture or attach a real result screenshot',
      'benchmark:reference-replication:evaluate-result',
      'benchmark:reference-replication:validate-evidence',
      'benchmark:reference-replication:record-result with manual scores',
      'maintenance:reference-quality-gate'
    ],
    boundary: 'A real-case intake plan is not design-quality evidence. A valid result evidence report, build verification, manual review and complete scores are required before quality claims.'
  };
}

function buildNextActions({ readiness, pipeline, qualityGate }) {
  const actions = [];
  const gate = qualityGate.gate || {};
  const stageCounts = pipeline.stageCounts || {};
  const cases = pipeline.cases || [];

  if (!gate.allowedToClaim) {
    actions.push({
      priority: 'P0',
      kind: 'quality-boundary',
      title: '不要声明参考图复刻设计质量达标',
      reason: (gate.blockers || []).join('; ') || 'quality gate is not ready',
      command: 'npm run maintenance:reference-quality-gate'
    });
  }

  const awaitingResult = cases.filter((item) => item.stage === 'awaiting_result_screenshot');
  if (awaitingResult.length > 0) {
    const preferred = awaitingResult.find((item) => item.caseId === 'rr-002-neutral-quality-card-text-layout') || awaitingResult[0];
    actions.push({
      priority: 'P1',
      kind: 'capture-mechanism-evidence',
      title: `采集 ${preferred.caseId} 的一次性真实输出截图`,
      reason: '当前所有 case 缺少 result screenshot；该动作需要显式 live/takeover，且 synthetic/FEX 截图仍不能成为商业设计质量证据。',
      command: preferred.commands?.captureLive || `npm run benchmark:reference-replication:capture-live -- --id "${preferred.caseId}"`
    });
  }

  const awaitingEvidence = cases.find((item) => item.stage === 'awaiting_result_evidence');
  if (awaitingEvidence) {
    actions.push({
      priority: 'P1',
      kind: 'evaluate-result',
      title: `评估 ${awaitingEvidence.caseId} 的结果截图`,
      reason: '已有截图但缺少独立 evidence report。',
      command: awaitingEvidence.commands?.evaluateResult || ''
    });
  }

  const awaitingReview = cases.find((item) => item.stage === 'awaiting_manual_review' || item.stage === 'awaiting_build_verification');
  if (awaitingReview) {
    actions.push({
      priority: 'P1',
      kind: 'manual-review',
      title: `人工复核并录入 ${awaitingReview.caseId} 的构建验证和评分`,
      reason: '质量声明必须有人工复核、完整 0..1 评分和构建验证。',
      command: awaitingReview.commands?.recordResult || ''
    });
  }

  if (!gate.allowedToClaim && Number(readiness.counts?.designQualityEligible || 0) === 0) {
    actions.push({
      priority: 'P1',
      kind: 'add-real-commercial-case',
      title: '新增一个非 FEX / 非 synthetic 的真实商业参考图 case',
      reason: '当前 suite 只有 FEX 和 synthetic fixture，不能支持真实商业设计质量声明。',
      command: 'npm run maintenance:reference-real-case-intake -- --id <case-id> --name <name> --category <poster-layout|ecommerce-detail|main-image> --reference-image <path> --source-kind real-commercial-reference',
      evidenceChain: buildRealCaseEvidenceChain()
    });
  }

  actions.push({
    priority: 'P2',
    kind: 'resume-report',
    title: '随时刷新 reference 复刻状态',
    reason: '该命令只读，不调用模型或 Photoshop，可作为中断恢复入口。',
    command: 'npm run maintenance:reference-status'
  });

  return actions;
}

function buildReport(options) {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const benchmarkDir = options['benchmark-dir'] ? path.resolve(process.cwd(), String(options['benchmark-dir'])) : '';
  const benchmarkArgs = benchmarkDir ? ['--benchmark-dir', benchmarkDir] : [];
  const readiness = JSON.parse(run('node', ['scripts/report-reference-replication-readiness.cjs', '--json', ...benchmarkArgs], agentRoot));
  const pipeline = JSON.parse(run('node', ['scripts/report-reference-evidence-pipeline.cjs', '--json', ...benchmarkArgs], agentRoot));
  const qualityGate = JSON.parse(run('node', ['scripts/check-reference-quality-claim-gate.cjs', '--json', ...benchmarkArgs], agentRoot));
  const nextActions = buildNextActions({ readiness, pipeline, qualityGate });
  const qualityGateBlockers = qualityGate.gate?.blockers || [];

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    benchmarkDir: benchmarkDir || 'benchmarks/reference-replication',
    conclusion: {
      designQualityClaimAllowed: Boolean(qualityGate.gate?.allowedToClaim),
      currentStageSummary: pipeline.stageCounts || {},
      qualityClaimCandidates: pipeline.qualityClaimCandidates || 0,
      sourceEligibleForQualityClaimCases: (pipeline.cases || []).filter((item) => item.sourceEligibleForQualityClaim).length,
      explicitRealSourceCases: qualityGate.gate?.evidenceSummary?.explicitRealSourceCases || 0,
      sourceCounts: qualityGate.gate?.evidenceSummary?.sourceCounts || readiness.sourceCounts || {},
      designQualityEligible: readiness.counts?.designQualityEligible || 0,
      resultScreenshots: readiness.counts?.withResultScreenshot || 0,
      validResultEvidenceReports: readiness.counts?.validResultEvidenceReport || 0,
      manualVerified: readiness.counts?.manualVerified || 0,
      boundary: qualityGate.gate?.allowedToClaim
        ? 'Reference replication has at least one eligible real quality candidate, but claims still must cite case-level evidence.'
        : 'Reference replication mechanism may be in progress, but design-quality claims are blocked by the quality gate.'
    },
    qualityClaimGate: {
      available: Boolean(qualityGate.success),
      allowedToClaim: Boolean(qualityGate.gate?.allowedToClaim),
      blockerCount: qualityGateBlockers.length,
      hasExplicitRealSourceBlocker: qualityGateBlockers.some((item) => item.includes('explicit real-source cases')),
      hasResultScreenshotBlocker: qualityGateBlockers.includes('no real result screenshot evidence recorded'),
      hasValidEvidenceReportBlocker: qualityGateBlockers.includes('no valid result evidence report recorded'),
      hasBuildVerificationBlocker: qualityGateBlockers.includes('no build/execution verification recorded'),
      hasManualReviewBlocker: qualityGateBlockers.includes('no manual review recorded'),
      hasCompleteScoreBlocker: qualityGateBlockers.includes('no complete 0..1 score set recorded')
    },
    qualityGateConsistency: buildReferenceQualityGateConsistency(agentRoot),
    blockers: qualityGate.gate?.blockers || [],
    warnings: [
      ...(qualityGate.gate?.warnings || []),
      'FEX remains benchmark-only.',
      'Synthetic fixtures validate mechanism/input coverage only.'
    ],
    nextActions,
    evidence: {
      readiness: {
        counts: readiness.counts || {},
        readinessCounts: readiness.readinessCounts || {}
      },
      pipeline: {
        stageCounts: pipeline.stageCounts || {},
        cases: (pipeline.cases || []).map((item) => ({
          caseId: item.caseId,
          stage: item.stage,
          nextAction: item.nextAction,
          sourceEligibleForQualityClaim: Boolean(item.sourceEligibleForQualityClaim),
          qualityClaimCandidate: item.qualityClaimCandidate,
          blockers: item.blockers || [],
          warnings: item.warnings || []
        }))
      },
      qualityGate: qualityGate.gate || {}
    },
    policy: {
      readOnly: true,
      doesNotRunPhotoshop: true,
      doesNotCallModel: true,
      doesNotMutateCases: true,
      doesNotWriteScreenshots: true
    }
  };
}

function printText(report) {
  console.log('Reference Replication Status');
  console.log(`designQualityClaimAllowed: ${report.conclusion.designQualityClaimAllowed}`);
  console.log(`qualityClaimCandidates: ${report.conclusion.qualityClaimCandidates}`);
  console.log(`sourceEligibleForQualityClaimCases: ${report.conclusion.sourceEligibleForQualityClaimCases}`);
  console.log(`explicitRealSourceCases: ${report.conclusion.explicitRealSourceCases}`);
  console.log(`resultScreenshots: ${report.conclusion.resultScreenshots}`);
  console.log(`validResultEvidenceReports: ${report.conclusion.validResultEvidenceReports}`);
  console.log(`manualVerified: ${report.conclusion.manualVerified}`);
  console.log(`sourceCounts: ${Object.keys(report.conclusion.sourceCounts || {}).length > 0 ? Object.entries(report.conclusion.sourceCounts).map(([key, value]) => `${key}=${value}`).join(', ') : 'none'}`);
  console.log(`qualityGateBlockers: ${report.qualityClaimGate.blockerCount}`);
  console.log(`missingResultScreenshot: ${report.qualityClaimGate.hasResultScreenshotBlocker}`);
  console.log(`missingManualReview: ${report.qualityClaimGate.hasManualReviewBlocker}`);
  console.log(`qualityGateConsistencySmoke: ${report.qualityGateConsistency.smokeAvailable}`);
  console.log(`boundary: ${report.conclusion.boundary}`);
  console.log('');
  if (report.blockers.length > 0) {
    console.log('blockers:');
    report.blockers.forEach((item) => console.log(`- ${item}`));
    console.log('');
  }
  console.log('next actions:');
  report.nextActions.forEach((item) => {
    console.log(`- [${item.priority}] ${item.title}`);
    console.log(`  reason: ${item.reason}`);
    console.log(`  command: ${item.command}`);
    if (item.evidenceChain) {
      console.log(`  evidenceChain: ${item.evidenceChain.requiredOrder.join(' -> ')}`);
      console.log(`  boundary: ${item.evidenceChain.boundary}`);
    }
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/report-reference-replication-status.cjs [--json] [--benchmark-dir <path>]');
    return;
  }
  const report = buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
}

main();
