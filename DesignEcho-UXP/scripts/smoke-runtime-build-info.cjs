#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeInfoPath = path.join(root, 'src', 'core', 'runtime-build-info.ts');
const diagnoseStatePath = path.join(root, 'src', 'tools', 'canvas', 'diagnose-state.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const runtimeInfo = fs.readFileSync(runtimeInfoPath, 'utf8');
  const diagnoseState = fs.readFileSync(diagnoseStatePath, 'utf8');

  assert(
    runtimeInfo.includes("PHOTOSHOP_RUNTIME_BUILD_ID = 'photoshop-tool-stability/v1'"),
    'runtime-build-info should expose the current Photoshop stability build id'
  );
  assert(
    runtimeInfo.includes('getSubjectBounds.smartLayerKindGuard'),
    'runtime-build-info should expose the smart subject layer-kind guard feature'
  );
  assert(
    runtimeInfo.includes('selectionRead.noDialogSynchronousBatchPlay'),
    'runtime-build-info should expose the no-dialog selection read feature'
  );
  assert(
    runtimeInfo.includes('createDocument.readbackCandidateValidation'),
    'runtime-build-info should expose createDocument readback candidate validation'
  );
  assert(
    runtimeInfo.includes('toolErrorNormalizer.fontUnavailableCategory'),
    'runtime-build-info should expose font unavailable error categorization'
  );
  assert(
    runtimeInfo.includes('saveDocument.rasterExportUsesJsx'),
    'runtime-build-info should expose raster export via JSX saveDocument feature'
  );
  assert(
    runtimeInfo.includes('getPhotoshopRuntimeBuildInfo'),
    'runtime-build-info should expose a runtime info accessor'
  );
  assert(
    diagnoseState.includes("from '../../core/runtime-build-info'"),
    'diagnoseState should import runtime build info'
  );
  assert(
    diagnoseState.includes('runtime: getPhotoshopRuntimeBuildInfo()'),
    'diagnoseState should return runtime build info in state.runtime'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'runtime build id is defined',
      'runtime features include smart subject guard, no-dialog selection reads, createDocument readback validation, font unavailable categorization, and JSX raster export',
      'diagnoseState exposes runtime build info for live stale-runtime verification'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exit(1);
}
