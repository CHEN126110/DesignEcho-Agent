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

const {
  buildAgentAcceptanceExecutionSuitePlan,
  formatAgentAcceptanceExecutionSuiteMarkdown
} = require('../src/shared/agent-acceptance-execution-suite.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function byMode(plan, mode) {
  return plan.modes.find((item) => item.mode === mode);
}

function selectedModes(plan) {
  return plan.modes.filter((item) => item.selected).map((item) => item.mode);
}

function run() {
  const defaultPlan = buildAgentAcceptanceExecutionSuitePlan();
  assert(defaultPlan.version === 'agent-acceptance-execution-suite/v0', 'wrong suite version');
  assert(defaultPlan.selection === 'default_safe', 'default selection should be default_safe');
  assert(defaultPlan.selectedCommands.length === 2, 'default suite should select exactly two commands');
  assert(
    selectedModes(defaultPlan).join(',') === 'offline-static,desktop-fake-photoshop',
    'default suite must select only offline and desktop fake modes'
  );
  assert(!byMode(defaultPlan, 'real-provider-fake-photoshop').selected, 'real provider must not run by default');
  assert(!byMode(defaultPlan, 'live-photoshop-preflight').selected, 'live preflight must not run by default');
  assert(!byMode(defaultPlan, 'live-photoshop-disposable').selected, 'live disposable must not run by default');
  assert(!byMode(defaultPlan, 'live-provider-live-photoshop').selected, 'future full-live must never run');
  assert(
    defaultPlan.boundaries.some((item) => item.includes('does not prove design quality')),
    'missing no quality claim boundary'
  );

  const realProviderBlocked = buildAgentAcceptanceExecutionSuitePlan({
    selection: 'real_provider_opt_in'
  });
  assert(
    !byMode(realProviderBlocked, 'real-provider-fake-photoshop').selected,
    'real provider should remain blocked without opt-in flags'
  );
  assert(
    byMode(realProviderBlocked, 'real-provider-fake-photoshop').skipReason.includes('DESIGNECHO_REAL_PROVIDER'),
    'real provider skip reason should mention missing flags'
  );

  const realProviderReady = buildAgentAcceptanceExecutionSuitePlan({
    selection: 'real_provider_opt_in',
    optInFlags: {
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE: '1',
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API: true
    }
  });
  assert(
    byMode(realProviderReady, 'real-provider-fake-photoshop').selected,
    'real provider should be selected only after explicit opt-in'
  );
  assert(
    realProviderReady.selectedCommands.some((item) => item.npmScript === 'smoke:agent:acceptance:real-provider'),
    'real provider npm command missing after opt-in'
  );

  const livePreflightReady = buildAgentAcceptanceExecutionSuitePlan({
    selection: 'live_photoshop_preflight',
    runtime: {
      agentDesktopBuilt: true,
      uxpPluginConnected: true,
      photoshopBridgeReady: true
    }
  });
  assert(
    byMode(livePreflightReady, 'live-photoshop-preflight').selected,
    'live preflight should be selectable with runtime readiness'
  );
  assert(
    !byMode(livePreflightReady, 'live-photoshop-disposable').selected,
    'live preflight selection must not imply disposable writes'
  );

  const liveDisposableReady = buildAgentAcceptanceExecutionSuitePlan({
    selection: 'live_photoshop_disposable',
    optInFlags: {
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE: '1',
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER: '1',
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT: '1'
    },
    runtime: {
      agentDesktopBuilt: true,
      uxpPluginConnected: true,
      photoshopBridgeReady: true,
      disposableDocumentAllowed: true
    }
  });
  assert(
    byMode(liveDisposableReady, 'live-photoshop-disposable').selected,
    'live disposable should be selectable only when fully guarded'
  );

  const allAvailable = buildAgentAcceptanceExecutionSuitePlan({
    selection: 'all_available',
    optInFlags: {
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE: '1',
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API: '1',
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE: '1',
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER: '1',
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT: '1'
    },
    runtime: {
      agentDesktopBuilt: true,
      uxpPluginConnected: true,
      photoshopBridgeReady: true,
      disposableDocumentAllowed: true
    }
  });
  assert(
    !byMode(allAvailable, 'live-provider-live-photoshop').selected,
    'future full-live must not be selected even in all_available'
  );
  assert(
    allAvailable.selectedCommands.length === 5,
    'all_available should include five supported modes when fully armed'
  );

  const markdown = formatAgentAcceptanceExecutionSuiteMarkdown(defaultPlan);
  assert(markdown.includes('# Agent Acceptance Execution Suite'), 'markdown title missing');
  assert(markdown.includes('qualityClaimAllowed: false'), 'markdown should show no quality claim boundary');
  assert(!markdown.includes('undefined'), 'markdown should not contain undefined');

  return {
    success: true,
    defaultSelectedModes: selectedModes(defaultPlan),
    allAvailableSelectedModes: selectedModes(allAvailable)
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
