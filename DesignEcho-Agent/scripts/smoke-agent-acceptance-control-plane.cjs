#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

const ROOT = path.resolve(__dirname, '..');

const {
  AGENT_ACCEPTANCE_MODE_IDS,
  buildAgentAcceptanceControlPlane
} = require('../src/shared/agent-acceptance-control-plane.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

function assertScriptExists(scriptPath) {
  assert(fs.existsSync(path.join(ROOT, scriptPath)), `Missing acceptance runner: ${scriptPath}`);
}

function assertMode(modeId) {
  assert(
    AGENT_ACCEPTANCE_MODE_IDS.includes(modeId),
    `Acceptance mode ${modeId} is not exported by the control plane.`
  );
}

function build(mode, overrides = {}) {
  return buildAgentAcceptanceControlPlane({
    mode,
    ...overrides
  });
}

function assertOfflineMode() {
  const report = build('offline-static');
  assert(report.status === 'available', 'offline-static should be available without live dependencies.');
  assert(report.canRunByDefault === true, 'offline-static should be safe for default maintenance.');
  assert(report.touchesPhotoshop === false, 'offline-static must not touch Photoshop.');
  assert(report.usesRealProvider === false, 'offline-static must not use a real provider.');
  assert(report.proves.includes('acceptance_contract_mapping'), 'offline-static should prove contract mapping.');
  assert(report.doesNotProve.includes('real_photoshop_write'), 'offline-static must not claim real Photoshop writes.');
  assert(report.doesNotProve.includes('open_ended_design_quality'), 'offline-static must not claim design quality.');
}

function assertDesktopFakeMode() {
  const report = build('desktop-fake-photoshop');
  assert(report.status === 'available', 'desktop-fake-photoshop should be available as a fake runtime smoke.');
  assert(report.canRunByDefault === true, 'desktop-fake-photoshop should be allowed in default smoke suites.');
  assert(report.usesFakePhotoshop === true, 'desktop-fake-photoshop must explicitly use fake Photoshop.');
  assert(report.usesFakeProvider === true, 'desktop-fake-photoshop must explicitly use a fake provider.');
  assert(report.proves.includes('chatpanel_runtime_bridge'), 'desktop-fake-photoshop should prove ChatPanel bridge export.');
  assert(report.doesNotProve.includes('real_provider_quality'), 'desktop-fake-photoshop must not prove provider quality.');
  assert(report.doesNotProve.includes('real_photoshop_write'), 'desktop-fake-photoshop must not prove real Photoshop writes.');
}

function assertRealProviderFakePhotoshopMode() {
  const blocked = build('real-provider-fake-photoshop');
  assert(blocked.status === 'blocked_requires_opt_in', 'real provider mode should be blocked without API opt-in.');
  assert(blocked.canRun === false, 'real provider mode must not run until explicitly armed.');
  assert(blocked.requiredOptInFlags.includes('DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE=1'), 'real provider mode should list its first opt-in flag.');
  assert(blocked.requiredOptInFlags.includes('DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API=1'), 'real provider mode should list its API opt-in flag.');

  const armed = build('real-provider-fake-photoshop', {
    optInFlags: {
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE: true,
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API: true
    }
  });
  assert(armed.status === 'available', 'real provider mode should become available when armed.');
  assert(armed.usesRealProvider === true, 'armed real provider mode should record real provider use.');
  assert(armed.usesFakePhotoshop === true, 'real provider mode should still use fake Photoshop.');
  assert(armed.doesNotProve.includes('real_photoshop_write'), 'real provider fake Photoshop must not prove Photoshop writes.');
}

function assertLivePreflightMode() {
  const blocked = build('live-photoshop-preflight');
  assert(blocked.status === 'blocked_missing_runtime', 'live preflight should require a live bridge runtime.');
  assert(blocked.canRunByDefault === false, 'live preflight should not be in default maintenance.');
  assert(blocked.touchesPhotoshop === true, 'live preflight touches Photoshop in read-only mode.');
  assert(blocked.writesPhotoshop === false, 'live preflight must be read-only.');
  assert(blocked.requiredRuntime.includes('uxp_plugin_connected'), 'live preflight should require UXP connection evidence.');

  const ready = build('live-photoshop-preflight', {
    runtime: {
      agentDesktopBuilt: true,
      uxpPluginConnected: true,
      photoshopBridgeReady: true
    }
  });
  assert(ready.status === 'available', 'live preflight should become available when live bridge runtime is ready.');
  assert(ready.proves.includes('photoshop_bridge_readiness'), 'live preflight should prove bridge readiness only.');
  assert(ready.doesNotProve.includes('agent_task_completion'), 'live preflight must not prove task completion.');
}

function assertLiveDisposableMode() {
  const blocked = build('live-photoshop-disposable');
  assert(blocked.status === 'blocked_requires_opt_in', 'live disposable should require explicit takeover flags.');
  assert(blocked.requiredOptInFlags.includes('DESIGNECHO_LIVE_AGENT_ACCEPTANCE=1'), 'live disposable should list live opt-in.');
  assert(blocked.requiredOptInFlags.includes('DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER=1'), 'live disposable should list takeover opt-in.');
  assert(blocked.requiredOptInFlags.includes('DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT=1'), 'live disposable should list disposable-document opt-in.');

  const armed = build('live-photoshop-disposable', {
    optInFlags: {
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE: true,
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER: true,
      DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT: true
    },
    runtime: {
      agentDesktopBuilt: true,
      uxpPluginConnected: true,
      photoshopBridgeReady: true,
      disposableDocumentAllowed: true
    }
  });
  assert(armed.status === 'available', 'live disposable should be available only after flags and runtime evidence.');
  assert(armed.canRunByDefault === false, 'live disposable should remain excluded from default maintenance.');
  assert(armed.writesPhotoshop === true, 'live disposable should declare real Photoshop writes.');
  assert(armed.proves.includes('guarded_disposable_photoshop_write'), 'live disposable should prove guarded disposable writes.');
  assert(armed.doesNotProve.includes('open_ended_design_quality'), 'live disposable must not prove open-ended design quality.');
}

function assertFutureMode() {
  const report = build('live-provider-live-photoshop');
  assert(report.status === 'future_not_supported', 'live provider + live Photoshop should remain a future unsupported mode.');
  assert(report.canRun === false, 'future mode must never run from the control plane.');
  assert(report.doesNotProve.includes('production_design_reliability'), 'future mode must not imply production reliability.');
}

function assertPackageRegistration() {
  const packageJson = readPackageJson();
  const scripts = packageJson.scripts || {};
  assert(
    scripts['smoke:agent:acceptance-control-plane'] === 'node scripts/smoke-agent-acceptance-control-plane.cjs',
    'package.json should expose smoke:agent:acceptance-control-plane.'
  );
  assert(
    scripts['maintenance:preflight'].includes('smoke:agent:acceptance-control-plane'),
    'maintenance:preflight should include the acceptance control plane smoke.'
  );
}

function run() {
  [
    'scripts/acceptance-run-agent-case.cjs',
    'scripts/acceptance-run-agent-desktop-case.cjs',
    'scripts/acceptance-run-agent-real-provider-case.cjs',
    'scripts/acceptance-run-agent-live-photoshop-case.cjs'
  ].forEach(assertScriptExists);

  [
    'offline-static',
    'desktop-fake-photoshop',
    'real-provider-fake-photoshop',
    'live-photoshop-preflight',
    'live-photoshop-disposable',
    'live-provider-live-photoshop'
  ].forEach(assertMode);

  assertOfflineMode();
  assertDesktopFakeMode();
  assertRealProviderFakePhotoshopMode();
  assertLivePreflightMode();
  assertLiveDisposableMode();
  assertFutureMode();
  assertPackageRegistration();

  return {
    success: true,
    modes: AGENT_ACCEPTANCE_MODE_IDS
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
