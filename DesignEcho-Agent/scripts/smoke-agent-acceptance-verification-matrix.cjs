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
  buildAgentAcceptanceVerificationMatrix,
  formatAgentAcceptanceVerificationMatrixMarkdown,
  getAgentAcceptanceModeArtifactPath
} = require('../src/shared/agent-acceptance-verification-matrix.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function artifact(relativePath, payload) {
  return {
    relativePath,
    exists: true,
    payload
  };
}

function buildFixtureArtifacts() {
  return {
    'offline-static': artifact('tmp/acceptance/agent-acceptance-smoke.json', {
      success: true,
      reports: [
        { caseId: 'chat', status: 'passed' },
        { caseId: 'save', status: 'passed' }
      ]
    }),
    'desktop-fake-photoshop': artifact('tmp/acceptance/agent-desktop-acceptance-smoke.json', {
      success: true,
      skipped: false,
      mode: 'desktop-bridge-fake-provider-fake-photoshop',
      cases: [
        { id: 'desktop-save-psd-document-management', status: 'passed' },
        { id: 'desktop-close-document-no-save', status: 'passed' }
      ]
    }),
    'real-provider-fake-photoshop': artifact('tmp/acceptance/agent-real-provider-acceptance.json', {
      success: true,
      skipped: true,
      mode: 'guarded-real-provider-fake-photoshop',
      reason: 'not armed'
    }),
    'live-photoshop-preflight': artifact('tmp/acceptance/agent-live-photoshop-acceptance.json', {
      success: false,
      skipped: false,
      mode: 'live-photoshop-preflight',
      preflight: {
        blockers: ['Photoshop UXP plugin is not connected.'],
        takeoverBlockers: []
      },
      cases: [{ id: 'live-photoshop-preflight', status: 'blocked' }]
    }),
    'live-photoshop-disposable': artifact('tmp/acceptance/agent-live-photoshop-acceptance.json', {
      success: true,
      skipped: false,
      mode: 'live-photoshop-preflight',
      cases: [{ id: 'live-photoshop-preflight', status: 'ready' }]
    })
  };
}

function run() {
  const report = buildAgentAcceptanceVerificationMatrix({
    artifacts: buildFixtureArtifacts(),
    optInFlags: {
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE: true,
      DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API: true,
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
  const byMode = new Map(report.modes.map((item) => [item.mode, item]));

  assert(report.version === 'agent-acceptance-verification-matrix/v0', 'wrong matrix version');
  assert(report.totals.modeCount === 6, 'matrix should include all six acceptance modes');
  assert(report.boundaries.some((item) => item.includes('does not run providers or Photoshop')), 'missing no-run boundary');

  assert(
    getAgentAcceptanceModeArtifactPath('desktop-fake-photoshop') === 'tmp/acceptance/agent-desktop-acceptance-smoke.json',
    'desktop fake mode artifact path mismatch'
  );

  const offline = byMode.get('offline-static');
  assert(offline.artifact.status === 'passed', 'offline artifact should pass');
  assert(offline.qualityClaimAllowed === false, 'offline matrix must not allow quality claims');

  const desktop = byMode.get('desktop-fake-photoshop');
  assert(desktop.artifact.status === 'passed', 'desktop fake artifact should pass');
  assert(desktop.verificationReady === true, 'desktop fake verification should be ready');

  const realProvider = byMode.get('real-provider-fake-photoshop');
  assert(realProvider.controlPlane.status === 'available', 'armed real-provider fake mode should be available');
  assert(realProvider.artifact.status === 'skipped', 'guarded real-provider artifact should be summarized as skipped');

  const livePreflight = byMode.get('live-photoshop-preflight');
  assert(livePreflight.artifact.status === 'blocked', 'live preflight blocker should be reported');
  assert(livePreflight.nextAction.includes('triage'), 'blocked live preflight should ask for triage');
  assert(livePreflight.livePhotoshopIntake.status === 'failed_or_blocked', 'live preflight should expose the blocked live check intake');
  assert(livePreflight.livePhotoshopIntake.canClaimDesignQuality === false, 'live check intake must not claim design quality');

  const liveDisposable = byMode.get('live-photoshop-disposable');
  assert(liveDisposable.artifact.status === 'stale_for_mode', 'preflight artifact should be stale for disposable mode');
  assert(liveDisposable.nextAction.includes('Re-run'), 'stale artifact should ask for rerun');
  assert(liveDisposable.livePhotoshopIntake.status === 'needs_live_run', 'stale live artifact should still require live snapshot and focus checks');

  const future = byMode.get('live-provider-live-photoshop');
  assert(future.controlPlane.status === 'future_not_supported', 'full live mode should stay future-only');
  assert(future.nextAction.includes('Do not run'), 'future mode should not be runnable');

  const markdown = formatAgentAcceptanceVerificationMatrixMarkdown(report);
  assert(markdown.includes('# Agent Acceptance Verification Matrix'), 'markdown title missing');
  assert(markdown.includes('qualityClaimAllowed: false'), 'markdown must show quality boundary');
  assert(!markdown.includes('undefined'), 'markdown should not contain undefined');

  return {
    success: true,
    modes: report.modes.map((item) => ({
      mode: item.mode,
      controlStatus: item.controlPlane.status,
      artifactStatus: item.artifact.status
    }))
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
