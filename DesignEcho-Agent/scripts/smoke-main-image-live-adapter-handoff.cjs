#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageLiveAdapterHandoff
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-live-adapter-handoff.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must redact raw image-like payloads: ${found.join(', ')}`, value);
}

const readyAdapterContract = {
  version: 'main-image-live-photoshop-adapter-contract/v0',
  skillId: 'main-image-design',
  scene: 'design-skill-main-image',
  status: 'ready_for_disposable_photoshop_adapter',
  operationCount: 4,
  requiredToolNames: ['createDocument', 'createGroup', 'placeImage', 'transformLayer', 'exportGroup'],
  missingToolNames: [],
  readbackTools: ['getDocumentInfo', 'getLayerHierarchy', 'getLayerProperties', 'getAcceptanceSnapshot'],
  mappings: [
    {
      requestId: '001-create-doc',
      tool: 'createDocument',
      operationPhase: 'document',
      adapterMethod: 'uxp.createDocument',
      requiredReadbackTools: ['getDocumentInfo'],
      status: 'mapped',
      warnings: []
    },
    {
      requestId: '002-place',
      tool: 'placeImage',
      operationPhase: 'asset',
      adapterMethod: 'uxp.placeImage',
      requiredReadbackTools: ['getLayerHierarchy'],
      status: 'mapped',
      warnings: []
    }
  ],
  canCreateAdapter: true,
  canWritePhotoshop: false,
  requiresDisposableDocument: true,
  requiresExplicitLiveApproval: true,
  blockers: [],
  warnings: [],
  limitations: [
    'adapter contract is a mapping contract only',
    'raw-image-payload must not leak'
  ],
  sourceNotes: [{
    source: 'adapter-contract-smoke',
    summary: 'adapter mapping ready',
    status: 'ready'
  }]
};

const validToolchainCheck = {
  source: 'AGENT-141-live-disposable-smoke',
  mode: 'live-disposable-toolchain',
  success: true,
  preflightReady: true,
  assertionCount: 22,
  failedAssertions: [],
  exportedPath: 'C:/Exports/DesignEchoMainImageUxPToolchainLive-click-1x1.png',
  exportFileExists: true,
  cleanup: {
    closed: true,
    restoredOriginal: true,
    disposableStillOpen: false,
    errors: []
  },
  requiredToolNames: ['createDocument', 'createGroup', 'placeImage', 'transformLayer', 'exportGroup'],
  missingToolNames: []
};

function run() {
  const missingContract = buildMainImageLiveAdapterHandoff({});
  assert(missingContract.status === 'blocked_missing_adapter_contract', 'missing adapter contract should block handoff', missingContract);
  assert(missingContract.canWireAdapter === false, 'missing contract must not allow adapter wiring', missingContract);
  assert(missingContract.canWritePhotoshop === false, 'handoff record must be read-only', missingContract);
  assert(missingContract.canClaimOutputQuality === false, 'handoff record must not claim output quality', missingContract);

  const notReadyContract = buildMainImageLiveAdapterHandoff({
    adapterContract: {
      ...readyAdapterContract,
      status: 'blocked_missing_required_tool',
      missingToolNames: ['exportGroup'],
      canCreateAdapter: false
    },
    toolchainCheck: validToolchainCheck
  });
  assert(notReadyContract.status === 'blocked_adapter_contract_not_ready', 'not-ready adapter contract should block handoff', notReadyContract);
  assert(notReadyContract.blockers.some((blocker) => blocker.includes('blocked_missing_required_tool')), 'adapter status should be named in blockers', notReadyContract);

  const missingToolchain = buildMainImageLiveAdapterHandoff({
    adapterContract: readyAdapterContract
  });
  assert(missingToolchain.status === 'blocked_missing_toolchain_check', 'ready contract without a toolchain check should block handoff', missingToolchain);

  const failedToolchain = buildMainImageLiveAdapterHandoff({
    adapterContract: readyAdapterContract,
    toolchainCheck: {
      ...validToolchainCheck,
      success: false,
      failedAssertions: ['export file missing']
    }
  });
  assert(failedToolchain.status === 'blocked_toolchain_not_validated', 'failed toolchain record should block handoff', failedToolchain);
  assert(failedToolchain.blockers.some((blocker) => blocker.includes('export file missing')), 'failed assertions should be visible blockers', failedToolchain);

  const unsafeCleanup = buildMainImageLiveAdapterHandoff({
    adapterContract: readyAdapterContract,
    toolchainCheck: {
      ...validToolchainCheck,
      cleanup: {
        closed: false,
        restoredOriginal: false,
        disposableStillOpen: true,
        errors: ['disposable document still open']
      }
    }
  });
  assert(unsafeCleanup.status === 'blocked_toolchain_cleanup_not_safe', 'unsafe live cleanup should block adapter handoff', unsafeCleanup);

  const ready = buildMainImageLiveAdapterHandoff({
    adapterContract: readyAdapterContract,
    toolchainCheck: validToolchainCheck
  });
  assert(ready.status === 'ready_for_guarded_adapter_handoff', 'ready contract and validated toolchain should allow guarded handoff', ready);
  assert(ready.canWireAdapter === true, 'ready handoff should allow wiring a guarded adapter', ready);
  assert(ready.canRunProduction === false, 'ready handoff must not enable production writes', ready);
  assert(ready.canWritePhotoshop === false, 'handoff helper itself must stay read-only', ready);
  assert(ready.requiresDisposableDocument === true, 'guarded handoff must require disposable document scope', ready);
  assert(ready.requiresExplicitLiveApproval === true, 'guarded handoff must require explicit live approval', ready);
  assert(ready.canClaimOutputQuality === false, 'adapter handoff cannot claim visual output quality', ready);
  assert(ready.operationSummary.operationCount === readyAdapterContract.operationCount, 'operation count should be carried from adapter contract', ready);
  assert(ready.toolchainSummary.assertionCount === validToolchainCheck.assertionCount, 'toolchain assertion count should be preserved', ready);
  assertNoRawPayload(ready, 'main image live adapter handoff');

  console.log(JSON.stringify({
    ok: true,
    checked: [
      missingContract.status,
      notReadyContract.status,
      missingToolchain.status,
      failedToolchain.status,
      unsafeCleanup.status,
      ready.status
    ],
    readyCanWireAdapter: ready.canWireAdapter,
    canRunProduction: ready.canRunProduction
  }, null, 2));
}

run();
