#!/usr/bin/env node

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node'
});
require('ts-node/register/transpile-only');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const {
  buildDetailPageAgentIntake,
  buildDetailPageAgentResultSummary
} = require('../src/shared/detail-page-agent-intake.ts');

const inspectIntake = buildDetailPageAgentIntake({
  params: {},
  context: {
    userInput: '帮我检查一下当前详情页模板结构',
    projectContext: {}
  }
});

assert(inspectIntake.mode === 'inspect', 'inspect wording should resolve inspect mode', inspectIntake);
assert(inspectIntake.params.inspectOnly === true, 'inspect intake should force inspectOnly=true', inspectIntake);
assert(inspectIntake.canStart === true, 'inspect mode can start without project assets', inspectIntake);
assert(inspectIntake.recommendedAction === 'inspect_template', 'inspect mode should recommend template inspection', inspectIntake);

const exportIntake = buildDetailPageAgentIntake({
  params: {},
  context: {
    userInput: '帮我设计详情页并导出切片',
    projectContext: {
      projectPath: 'E:/DesignEchoDemo/C-1186',
      assetIndex: {
        summary: { totalImages: 12 },
        visionCandidates: [{ id: 'p1' }]
      },
      visualSamplingPlan: {
        selectedCandidates: [{ id: 'p1' }],
        cacheSummary: { shouldAnalyze: 0 }
      },
      visualInsightCache: {
        summary: { entriesWithInsight: 1 }
      }
    }
  }
});

assert(exportIntake.mode === 'execute', 'design/export wording should resolve execute mode', exportIntake);
assert(exportIntake.params.inspectOnly === false, 'execute intake should set inspectOnly=false', exportIntake);
assert(exportIntake.params.exportSlices === true, 'export wording should request exportSlices', exportIntake);
assert(exportIntake.params.visualValidation === 'screenshots', 'execute/export should use screenshot validation by default', exportIntake);
assert(exportIntake.canStart === true, 'execute with project visual context can start', exportIntake);
assert(exportIntake.recommendedAction === 'execute_with_review', 'ready execute should recommend reviewed execution', exportIntake);

const blockedExecuteIntake = buildDetailPageAgentIntake({
  params: {},
  context: {
    userInput: '帮我生成详情页',
    projectContext: {}
  }
});

assert(blockedExecuteIntake.mode === 'execute', 'generation wording should resolve execute mode', blockedExecuteIntake);
assert(blockedExecuteIntake.canStart === false, 'execute without project assets should be blocked before Photoshop writes', blockedExecuteIntake);
assert(blockedExecuteIntake.recommendedAction === 'request_context', 'blocked execute should request missing context', blockedExecuteIntake);
assert(blockedExecuteIntake.blockers.some((item) => /项目路径|可用图片素材/.test(item)), 'blocked execute should explain missing project assets', blockedExecuteIntake);

const summary = buildDetailPageAgentResultSummary({
  intake: exportIntake,
  runtime: {
    success: true,
    reviewLevel: 'needs_review',
    screenCount: 6,
    successCount: 5,
    failCount: 1,
    exportFileCount: 6
  }
});

assert(summary.status === 'needs_review', 'summary should preserve review-needed state', summary);
assert(summary.nextStep.includes('复核'), 'summary should give an actionable review next step', summary);
assert(summary.agentReadableText.includes('详情页'), 'summary should be user/Agent readable', summary);

const executorSource = read('src/renderer/services/skill-executors/detail-page.executor.ts');
assert(executorSource.includes('buildDetailPageAgentIntake'), 'detail-page executor should use the Agent intake contract');
assert(executorSource.includes('detailPageAgentIntake'), 'detail-page executor should expose intake in result data');
assert(executorSource.includes('detailPageAgentResultSummary'), 'detail-page executor should expose an Agent-readable result summary');

const declarations = read('src/shared/skills/skill-declarations.ts');
assert(declarations.includes('agentMode'), 'detail-page skill schema should expose bounded agentMode instead of ad hoc low-level control only');
assert(declarations.includes('reviewPolicy'), 'detail-page skill schema should expose reviewPolicy for Agent handoff');

console.log(JSON.stringify({
  success: true,
  checks: [
    'detail-page Agent intake normalizes inspect/execute/export modes',
    'detail-page Agent intake blocks execute when project visual context is missing',
    'detail-page Agent intake emits stable recommendedAction and normalized params',
    'detail-page executor consumes and returns Agent-readable intake/summary data',
    'detail-page skill schema exposes bounded Agent handoff parameters'
  ]
}, null, 2));
