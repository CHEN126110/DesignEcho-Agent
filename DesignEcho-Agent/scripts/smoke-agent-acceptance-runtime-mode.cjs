#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  buildAgentAcceptanceRuntimeMode,
  summarizeAgentAcceptanceRuntimeMode
} = require(path.join(ROOT, 'src', 'shared', 'agent-acceptance-runtime-mode.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function run() {
  assert(
    typeof buildAgentAcceptanceRuntimeMode === 'function',
    'acceptance runtime mode helper should be exported'
  );
  assert(
    typeof summarizeAgentAcceptanceRuntimeMode === 'function',
    'acceptance runtime mode summary helper should be exported'
  );

  const production = buildAgentAcceptanceRuntimeMode({});
  assert(production.mode === 'production', 'default mode should be production', production);
  assert(production.audience === 'end_user', 'production audience should be end_user', production);
  assert(production.canRunCodexDrivenAgentAcceptance === false, 'production must not run Codex-driven Agent acceptance', production);
  assert(production.canSpendExtraValidationTokens === false, 'production must not spend extra validation tokens', production);
  assert(production.canExposeTechnicalDiagnosticsToUser === false, 'production must not expose technical diagnostics to user', production);
  assert(production.userFacingTelemetryLevel === 'clean', 'production telemetry should stay clean', production);
  assert(production.mustNotDisplayAsProviderThinking === true, 'runtime mode evidence must not display as provider thinking', production);

  const developerNoOptIn = buildAgentAcceptanceRuntimeMode({
    requestedMode: 'developer_acceptance'
  });
  assert(
    developerNoOptIn.mode === 'production',
    'developer acceptance should fall back to production without explicit opt-in',
    developerNoOptIn
  );
  assert(
    developerNoOptIn.blockers.includes('explicit_acceptance_opt_in_required'),
    'missing developer opt-in should be explicit',
    developerNoOptIn
  );

  const developer = buildAgentAcceptanceRuntimeMode({
    requestedMode: 'developer_acceptance',
    explicitAcceptanceOptIn: true,
    allowRealProvider: true
  });
  assert(developer.mode === 'developer_acceptance', 'explicit developer acceptance mode should be enabled', developer);
  assert(developer.audience === 'developer', 'developer acceptance audience should be developer', developer);
  assert(developer.canRunCodexDrivenAgentAcceptance === true, 'developer acceptance can run Codex-driven Agent acceptance', developer);
  assert(developer.canSpendExtraValidationTokens === true, 'developer acceptance can spend extra validation tokens', developer);
  assert(developer.canExposeTechnicalDiagnosticsToDeveloper === true, 'developer acceptance can expose developer diagnostics', developer);
  assert(developer.canExposeTechnicalDiagnosticsToUser === false, 'developer diagnostics must not leak to end user', developer);
  assert(developer.canUseRealProvider === true, 'real provider requires explicit allowance', developer);
  assert(developer.canUseLivePhotoshop === false, 'live Photoshop requires separate explicit allowance', developer);
  assert(developer.userFacingTelemetryLevel === 'diagnostic', 'developer telemetry should be diagnostic', developer);

  const developerLive = buildAgentAcceptanceRuntimeMode({
    requestedMode: 'developer_acceptance',
    explicitAcceptanceOptIn: true,
    allowRealProvider: true,
    allowLivePhotoshop: true
  });
  assert(developerLive.canUseLivePhotoshop === true, 'live Photoshop acceptance requires explicit allowance', developerLive);
  assert(
    developerLive.requiredLabels.includes('developer-mode'),
    'developer acceptance evidence should carry developer-mode label',
    developerLive
  );

  const automated = buildAgentAcceptanceRuntimeMode({
    requestedMode: 'automated_smoke',
    explicitAcceptanceOptIn: true
  });
  assert(automated.mode === 'automated_smoke', 'automated smoke mode should be available after opt-in', automated);
  assert(automated.canRunCodexDrivenAgentAcceptance === false, 'automated smoke should not run provider conversations', automated);
  assert(automated.canUseRealProvider === false, 'automated smoke should stay fake/offline by default', automated);
  assert(automated.canUseLivePhotoshop === false, 'automated smoke should not use live Photoshop by default', automated);
  assert(automated.canExposeTechnicalDiagnosticsToDeveloper === true, 'automated smoke can expose developer diagnostics', automated);

  const summary = summarizeAgentAcceptanceRuntimeMode(developer);
  assert(summary.includes('developer_acceptance'), 'summary should mention developer acceptance mode', summary);
  assert(summary.includes('not user-facing'), 'summary should preserve user-facing boundary', summary);
  assertNoPseudoThinking([production, developer, developerLive, automated, summary], 'acceptance runtime mode');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'production mode keeps user-facing experience clean',
      'developer acceptance requires explicit opt-in before Codex-driven Agent validation',
      'extra validation tokens and real providers are developer-only evidence',
      'live Photoshop acceptance requires a separate explicit allowance',
      'runtime mode evidence never becomes provider thinking'
    ]
  }, null, 2));
}

run();
