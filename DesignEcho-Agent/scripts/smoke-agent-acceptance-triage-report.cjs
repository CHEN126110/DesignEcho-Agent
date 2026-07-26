#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentRunDebugBundle,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));
const {
  buildAgentAcceptanceDebugExport
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-export.ts'));
const { buildAgentRequestLifecycle } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  formatAgentAcceptanceTriageCasesMarkdown,
  formatAgentAcceptanceTriageMarkdown,
  summarizeAgentAcceptanceTriageExport
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-triage-report.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function buildRoutingFailureExport() {
  const acceptanceCase = {
    id: 'triage-report-routing-failure',
    title: 'Acceptance triage report smoke',
    userInput: '帮我把详情页文档保存到项目的PSD中',
    mode: 'offline',
    tags: ['acceptance', 'triage-report'],
    expectation: {
      route: 'skill_execution',
      routeSource: 'deterministic_route',
      skillId: 'document-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true,
      expectedExecutionStatus: 'completed',
      maxToolCalls: 2
    }
  };
  const bundle = buildAgentRunDebugBundle({
    acceptanceCase,
    lifecycle: buildAgentRequestLifecycle({
      userInput: acceptanceCase.userInput,
      routeSource: 'lightweight_intent',
      route: 'direct_response',
      reason: 'Misrouted as ordinary chat.',
      context: {
        isPluginConnected: true,
        photoshopContext: {
          hasDocument: true,
          documentName: 'triage-report.psd',
          layerCount: 1
        }
      }
    }),
    executionSummary: {
      status: 'completed',
      iterations: 0,
      toolCallCount: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      warnings: []
    },
    visibleMessages: ['我理解你的需求。']
  });
  const report = evaluateAgentAcceptance(acceptanceCase, bundle);
  return buildAgentAcceptanceDebugExport({ bundle, report });
}

const debugExport = buildRoutingFailureExport();
const summary = summarizeAgentAcceptanceTriageExport(debugExport);
const markdown = formatAgentAcceptanceTriageMarkdown(debugExport);
const casesMarkdown = formatAgentAcceptanceTriageCasesMarkdown([
  {
    id: 'triage-report-routing-failure',
    status: debugExport.report.status,
    summary: debugExport.report.summary,
    acceptanceTriage: debugExport.acceptanceTriage
  }
]);

const fixturePath = path.resolve(__dirname, '..', 'tmp', 'acceptance', 'triage-report-smoke-fixture.json');
fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
fs.writeFileSync(fixturePath, JSON.stringify({
  success: false,
  cases: [
    {
      id: 'triage-report-routing-failure',
      status: debugExport.report.status,
      summary: debugExport.report.summary,
      acceptanceTriage: debugExport.acceptanceTriage
    }
  ]
}, null, 2), 'utf8');
const commandOutput = execFileSync('node', [
  path.resolve(__dirname, 'report-agent-acceptance-triage.cjs'),
  fixturePath
], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8'
});

assert(summary.status === 'blocked', 'summary should expose blocked triage status', summary);
assert(summary.primaryIssueLayer === 'routing', 'summary should expose the primary issue layer', summary);
assert(summary.owner === 'agent_control_plane', 'summary should expose the owner layer', summary);
assert(summary.verificationBoundary === 'missing_diagnostic_observation', 'summary should expose the verification boundary', summary);
assert(summary.designQualityClaimAllowed === false, 'summary must not allow design quality claims', summary);

assert(markdown.includes('## Acceptance Triage'), 'markdown should include the triage heading', markdown);
assert(markdown.includes('- status: blocked'), 'markdown should include triage status', markdown);
assert(markdown.includes('- primaryIssueLayer: routing'), 'markdown should include primary issue layer', markdown);
assert(markdown.includes('- owner: agent_control_plane'), 'markdown should include owner', markdown);
assert(markdown.includes('- verificationBoundary: missing_diagnostic_observation'), 'markdown should include verification boundary', markdown);
assert(markdown.includes('inspect routing lifecycle'), 'markdown should include next actions', markdown);
assert(!markdown.includes('design quality passed'), 'markdown must not fabricate design quality pass claims', markdown);

assert(casesMarkdown.includes('## Acceptance Triage'), 'cases markdown should include the triage heading', casesMarkdown);
assert(casesMarkdown.includes('triage-report-routing-failure'), 'cases markdown should include case id', casesMarkdown);
assert(casesMarkdown.includes('blocked / routing / agent_control_plane'), 'cases markdown should include compact case triage', casesMarkdown);

assert(commandOutput.includes('## Acceptance Triage'), 'report command should print triage markdown', commandOutput);
assert(commandOutput.includes('triage-report-routing-failure'), 'report command should include case id', commandOutput);
assert(commandOutput.includes('blocked / routing / agent_control_plane'), 'report command should include compact triage', commandOutput);

console.log(JSON.stringify({
  success: true,
  checks: [
    'acceptance triage export can be summarized',
    'acceptance triage markdown exposes status, issue layer, owner, verification boundary and next actions',
    'acceptance triage markdown does not fabricate design quality pass claims',
    'case-list markdown can be embedded into desktop acceptance reports',
    'report command can read an acceptance JSON artifact and print triage markdown'
  ]
}, null, 2));
