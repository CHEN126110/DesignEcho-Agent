#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'canvas', 'create-document.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert(source.includes("name = 'createDocument'"), 'CreateDocumentTool should exist');
  // make 文档必须用 new:{_obj:'document'} 标准形式（创建新对象语义）。
  assert(/new:\s*\{[\s\S]*?_obj:\s*['"]document['"]/.test(source), 'createDocument make should use the standard new:{ _obj: "document" } descriptor');
  // 禁止图层式 _target:[{_ref:'document'}] make 形式——该形式对 document 类不可靠，不会稳定创建文档。
  assert(!/_target:\s*\[\s*\{\s*_ref:\s*['"]document['"]\s*\}\s*\]/.test(source), 'createDocument must not use the layer-style _target:[{ _ref: "document" }] make descriptor');
  assert(source.includes("dialogOptions: 'dontDisplay'"), 'createDocument should suppress native dialogs');
  assert(source.includes('synchronousExecution: true'), 'createDocument should run batchPlay synchronously inside the modal');
  assert(source.includes('readCreatedDocumentId'), 'createDocument should resolve the authoritative documentID from the make result');
  assert(source.includes('readOpenDocumentIds') && source.includes('findCreatedDocument'), 'createDocument should identify the newly created document by readback');
  assert(source.includes('documentMatchesExpected'), 'createDocument should validate any candidate document against the requested name and size');
  assert(!/if\s*\(byId\)\s*return\s+byId/.test(source), 'createDocument must not trust a returned documentID unless that document matches the requested readback');
  assert(source.includes('waitForCreatedDocument'), 'createDocument should poll briefly for Photoshop document collection refresh after make');
  assert(source.includes('readback mismatch'), 'createDocument should fail when the created document readback does not match requested name and size');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'createDocument uses the standard new:{_obj:"document"} make descriptor',
      'createDocument avoids the unreliable layer-style _target document descriptor',
      'createDocument suppresses native dialogs and runs synchronously',
      'createDocument resolves the authoritative documentID and verifies the new document by readback',
      'createDocument validates documentID candidates and waits for readback refresh',
      'createDocument rejects readback mismatch instead of returning the active document as success'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exit(1);
}
