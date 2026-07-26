#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'tmp', 'tool-error-normalizer-smoke');
const tscScript = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function runTsc() {
  fs.rmSync(outDir, { recursive: true, force: true });
  execFileSync(process.execPath, [
    tscScript,
    'src/core/tool-error-normalizer.ts',
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--outDir', outDir,
    '--skipLibCheck'
  ], {
    cwd: root,
    stdio: 'pipe'
  });
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  runTsc();
  const {
    normalizePhotoshopToolError,
    createToolFailureResult
  } = require(path.join(outDir, 'tool-error-normalizer.js'));

  const moveUnavailable = normalizePhotoshopToolError({
    toolName: 'moveLayer',
    error: new Error('The command "Move" is not currently available')
  });
  const idatError = normalizePhotoshopToolError({
    toolName: 'placeImage',
    error: new Error('IDAT: invalid distances set')
  });
  const badHeaderError = normalizePhotoshopToolError({
    toolName: 'placeImage',
    error: new Error('END[AE]: bad header (invalid type)')
  });
  const chineseModalState = normalizePhotoshopToolError({
    toolName: 'transformLayer',
    error: new Error('Photoshop 当前处于模态状态或正在处理其他命令')
  });
  const missingFont = normalizePhotoshopToolError({
    toolName: 'setTextStyle',
    error: new Error('未找到可用字体：__DesignEcho_Missing_Font_不存在_000000__')
  });
  const failureResult = createToolFailureResult({
    toolName: 'placeImage',
    error: new Error('IDAT: invalid distances set'),
    params: { filePath: 'C:/tmp/broken.png' }
  });

  assert(moveUnavailable.category === 'photoshop_command_unavailable', 'Move unavailable should be classified', moveUnavailable);
  assert(moveUnavailable.retryable === false, 'Move unavailable should not be blindly retried', moveUnavailable);
  assert(/reorderLayer|moveLayer/.test(moveUnavailable.suggestedAction), 'Move unavailable should include tool-specific guidance', moveUnavailable);
  assert(idatError.category === 'image_decode_error', 'IDAT error should be classified as image decode error', idatError);
  assert(idatError.popupRisk === true, 'Image decode errors should be marked as popup risk', idatError);
  assert(badHeaderError.category === 'image_decode_error', 'END[AE] bad header should be classified as image decode error', badHeaderError);
  assert(badHeaderError.popupRisk === true, 'Bad PNG header errors should be marked as popup risk', badHeaderError);
  assert(chineseModalState.category === 'modal_state', 'Chinese modal-state errors should be classified as retryable modal state', chineseModalState);
  assert(chineseModalState.retryable === true, 'Modal-state errors should be marked retryable', chineseModalState);
  assert(missingFont.category === 'font_unavailable', 'Missing Photoshop font should not be classified as missing target', missingFont);
  assert(missingFont.retryable === false, 'Missing font should not be blindly retried', missingFont);
  assert(/resolveFontName/.test(missingFont.suggestedAction), 'Missing font should guide callers to resolveFontName', missingFont);
  assert(failureResult.success === false, 'Failure result should be a tool failure', failureResult);
  assert(failureResult.errorDetails?.handledBy === 'tool-error-normalizer/v1', 'Failure result should expose normalizer evidence', failureResult);
  assert(!JSON.stringify(failureResult).includes('C:/tmp/broken.png'), 'Failure result should not leak full local file path', failureResult);

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(JSON.stringify({
    success: true,
    checks: [
      'Photoshop command unavailable errors are classified',
      'IDAT and END[AE] image decode errors are classified before generic failures',
      'Chinese modal-state errors are classified as retryable modal state',
      'Missing Photoshop fonts are classified separately from missing targets',
      'Tool failure envelopes expose normalizer evidence and redact local paths'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  fs.rmSync(outDir, { recursive: true, force: true });
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
