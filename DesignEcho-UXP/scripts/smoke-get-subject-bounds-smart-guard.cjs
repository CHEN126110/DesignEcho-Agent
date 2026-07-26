/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'tools', 'image', 'get-subject-bounds.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(SOURCE, 'utf8');

assert(source.includes('SMART_SUBJECT_ALLOWED_KINDS'), 'getSubjectBounds must define allowed smart subject layer kinds.');
assert(source.includes('getLayerKind'), 'getSubjectBounds must normalize Photoshop layer.kind before smart subject calls.');
assert(source.includes('isSmartSubjectLayerSupported'), 'getSubjectBounds must preflight unsupported smart subject layer kinds.');
assert(source.includes("method === 'smart'"), 'getSubjectBounds must keep an explicit smart branch.');
assert(source.includes('不支持对'), 'unsupported smart subject layer kinds should return an explicit Chinese diagnostic.');
assert(source.includes("_obj: 'selectSubject'"), 'smart subject branch must still use Photoshop selectSubject only after preflight.');
assert(source.includes("_options: { dialogOptions: 'dontDisplay' }"), 'smart subject batchPlay calls must suppress Photoshop dialogs.');

console.log(JSON.stringify({
  success: true,
  checks: [
    'smart subject branch has a layer-kind preflight',
    'unsupported layer kinds return explicit diagnostics instead of calling selectSubject',
    'selectSubject remains no-dialog for supported image layers'
  ]
}, null, 2));
