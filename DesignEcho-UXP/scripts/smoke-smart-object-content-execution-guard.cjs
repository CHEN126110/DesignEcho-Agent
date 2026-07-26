#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function assertStructuredFailure(relativePath, source) {
  assert(
    source.includes('createToolFailureResult'),
    `${relativePath} should use the shared tool failure envelope`
  );
  assert(
    !/return\s*\{\s*success\s*:\s*false/.test(source),
    `${relativePath} should not return ad-hoc success=false failures`
  );
  assert(
    !/error\.message\s*\|\|\s*String\(error\)/.test(source),
    `${relativePath} should not collapse caught errors to raw message strings`
  );
}

function assertNoDialogBatchPlay(relativePath, source) {
  const batchPlayCount = countMatches(source, /action\.batchPlay\s*\(/g);
  const synchronousCount = countMatches(source, /synchronousExecution\s*:\s*true/g);
  const noDialogCount = countMatches(source, /_options\s*:\s*\{\s*dialogOptions\s*:\s*['"]dontDisplay['"]\s*\}/g);
  assert(batchPlayCount > 0, `${relativePath} should contain audited batchPlay calls`);
  assert(
    synchronousCount >= batchPlayCount,
    `${relativePath} batchPlay calls should be synchronous`,
    { batchPlayCount, synchronousCount }
  );
  assert(
    noDialogCount >= batchPlayCount,
    `${relativePath} batchPlay descriptors should suppress Photoshop native dialogs`,
    { batchPlayCount, noDialogCount }
  );
  assert(
    !/modalBehavior\s*:\s*['"](?:execute|fail)['"]/.test(source),
    `${relativePath} must not use nested modalBehavior execute/fail`
  );
}

function main() {
  const smartObject = readSource('src/tools/layer/smart-object-tools.ts');
  const replaceContent = readSource('src/tools/layer/replace-content.ts');

  assertStructuredFailure('src/tools/layer/smart-object-tools.ts', smartObject);
  assertStructuredFailure('src/tools/layer/replace-content.ts', replaceContent);
  assertNoDialogBatchPlay('src/tools/layer/smart-object-tools.ts', smartObject);
  assertNoDialogBatchPlay('src/tools/layer/replace-content.ts', replaceContent);
  assert(
    replaceContent.includes('assertImageBytesSafeForPhotoshop') && replaceContent.includes('bytesFromBase64ImagePayload'),
    'replace-content should preflight base64 image bytes before Photoshop placeEvent'
  );
  assert(
    !/_obj:\s*['"]move['"]/.test(replaceContent),
    'replace-content should not call Photoshop move after placeEvent because it can trigger a native "move unavailable" dialog'
  );
  assert(
    !/_obj:\s*['"]rasterizeLayer['"]/.test(replaceContent),
    'replace-content should not speculatively call Photoshop rasterizeLayer because it can trigger a native "rasterize unavailable" dialog'
  );
  assert(
    smartObject.includes('function failure(toolName: string') && smartObject.includes('failure(this.name, error, params)'),
    'smart-object tools should route caught failures through the shared failure helper'
  );
  assert(
    smartObject.includes('function canAttemptRasterizeSmartObject') && smartObject.includes('destructiveRasterizeConfirmed'),
    'rasterizeSmartObject should require an explicit destructive confirmation and availability preflight'
  );
  assert(
    smartObject.includes('getNativeRasterizeBlockedReason') && !/_obj:\s*['"]rasterizeLayer['"]/.test(smartObject),
    'rasterizeSmartObject should block native rasterizeLayer until a no-popup path is verified'
  );
  assert(
    smartObject.includes('createSessionToken(file)') && smartObject.includes('_path: fileToken'),
    'smart-object replace/relink tools should pass UXP session tokens to Photoshop, not raw native paths'
  );
  assert(
    smartObject.includes('readFileEntryBytes(file, storage)') && smartObject.includes('assertImageBytesSafeForPhotoshop(replacementBytes'),
    'smart-object replacement files should be preflighted before placedLayerReplaceContents reaches Photoshop'
  );
  assert(
    !/placedLayer(?:ReplaceContents|RelinkToFile)[\s\S]{0,240}_path:\s*file\.nativePath/.test(smartObject),
    'smart-object replace/relink batchPlay descriptors must not use file.nativePath as the Photoshop path token'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'smart object tools use structured failure envelopes',
      'replace content uses structured failure envelopes',
      'smart object and replace content batchPlay calls are synchronous no-dialog',
      'smart object and replace content tools do not use nested modalBehavior',
      'replace content preflights base64 image bytes before Photoshop placeEvent',
      'replace content avoids risky post-place Photoshop move command',
      'replace content avoids speculative rasterizeLayer command',
      'smart object replacement files are byte-preflighted before Photoshop replace contents',
      'rasterizeSmartObject blocks native rasterizeLayer until no-popup execution is verified',
      'smart object replace/relink tools use UXP session tokens instead of native paths'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
