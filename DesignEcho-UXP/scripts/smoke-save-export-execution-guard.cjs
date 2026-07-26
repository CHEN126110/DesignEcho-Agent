#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'canvas', 'save-document.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function getClassBody(source, className) {
  const start = source.indexOf(`export class ${className}`);
  assert(start >= 0, `${className} should exist`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(bodyStart, index + 1);
    }
  }
  throw new Error(`Unable to parse ${className} body`);
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const quickExport = getClassBody(source, 'QuickExportTool');
  const batchExport = getClassBody(source, 'BatchExportTool');
  const smartSave = getClassBody(source, 'SmartSaveTool');

  assert(
    source.includes('createToolFailureResult'),
    'save-document tools should use the shared structured tool failure envelope'
  );
  assert(
    /async function createSaveToken[\s\S]*getEntryFromPath\(uxpFs, normalizedPath\)[\s\S]*directoryEntry\.createFile\(fileName, \{ overwrite: true \}\)/.test(source),
    'createSaveToken should reuse an existing target file entry before falling back to createFile(overwrite), so saveDocument can overwrite prior PSB/PSD outputs without Photoshop folder-name errors'
  );
  assert(
    quickExport.includes('outputPath'),
    'QuickExportTool schema should expose outputPath for deterministic silent export'
  );
  assert(
    quickExport.includes('requires outputPath'),
    'QuickExportTool should refuse no-path export instead of opening Photoshop export UI'
  );
  assert(
      quickExport.includes('normalizeRasterExportFormat') &&
      quickExport.includes('getRasterExportExtension') &&
      quickExport.includes('appendSuffixBeforeExtension') &&
      quickExport.includes('filePath: exported.filePath'),
    'QuickExportTool should accept a complete PNG/JPEG outputPath and return the actual exported file path instead of treating it as a directory'
  );
  assert(
    quickExport.includes('scale is not supported by the silent export path'),
    'QuickExportTool should not silently ignore scale in the silent export path'
  );
  assert(
    !quickExport.includes('this.exportDocument('),
    'QuickExportTool execute should not call exportDocument dialog path'
  );
  assert(
    !quickExport.includes('this.exportLayer('),
    'QuickExportTool execute should not call exportLayer dialog path'
  );
  assert(
    /requestedPath && \(format === 'png' \|\| format === 'jpg' \|\| format === 'jpeg'\)[\s\S]*saveDocumentViaJsx\(requestedPath, jsxFormat, doc\.name/.test(source),
    'SaveDocumentTool should route explicit PNG/JPG paths through JSX silent export instead of batchPlay save'
  );
  assert(
    !source.includes("modalBehavior: 'fail'"),
    'save-document tools must not pass modalBehavior fail inside executeAsModal scopes'
  );
  assert(
    (source.match(/action\.batchPlay\(/g) || []).length === (source.match(/synchronousExecution: true/g) || []).length,
    'Every save-document batchPlay write should run synchronously inside executeAsModal'
  );
  assert(
    !source.includes("dialog: 'display'") && !source.includes("dialogOptions: 'display'"),
    'save-document tools should not open Photoshop native save/export dialogs in Agent execution'
  );
  assert(
    batchExport.includes('createToolFailureResult') && batchExport.includes('toolName: this.name'),
    'BatchExportTool catch should return normalized structured failure evidence'
  );
  assert(
    smartSave.includes('createToolFailureResult') && smartSave.includes('toolName: this.name'),
    'SmartSaveTool catch should return normalized structured failure evidence'
  );
  assert(
    !smartSave.includes("dialog: 'display'") && !smartSave.includes("dialogOptions: 'display'"),
    'SmartSaveTool should not open Photoshop save/export dialogs in Agent execution'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'save-document tools use shared structured failure envelope',
      'createSaveToken reuses existing file entries before createFile overwrite fallback',
      'quickExport requires outputPath for silent Agent export',
      'quickExport accepts complete PNG/JPEG file paths without creating a same-named directory',
      'quickExport refuses unsupported scale instead of silently ignoring it',
      'quickExport execute avoids Photoshop export dialog paths',
      'saveDocument routes explicit PNG/JPG paths through JSX silent export',
      'save-document batchPlay writes avoid modalBehavior fail inside executeAsModal',
      'save-document batchPlay writes use synchronous execution',
      'save-document tools avoid native Photoshop dialog display paths',
      'batchExport and smartSave return normalized failure evidence',
      'smartSave avoids Photoshop dialog display paths'
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
