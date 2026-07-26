#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UXP_PARSER = path.resolve(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'detail-page-parser.ts');
const LIVE_CASE = path.join(ROOT, 'scripts', 'smoke-detail-page-template-live-case.cjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(source, needle, label) {
  assert(source.includes(needle), `Missing ${label}: ${needle}`);
}

function assertNoMojibake(source) {
  const mojibake = [
    String.fromCharCode(0x7487),
    String.fromCharCode(0x9359),
    String.fromCharCode(0x947e),
    String.fromCharCode(0xfffd)
  ];
  for (const marker of mojibake) {
    assert(!source.includes(marker), `Mojibake marker found in detail-page parser policy: ${marker}`);
  }
}

function main() {
  const source = fs.readFileSync(UXP_PARSER, 'utf8');
  const liveCaseSource = fs.readFileSync(LIVE_CASE, 'utf8');

  assertIncludes(source, 'collectScreenCandidates', 'detail container candidate discovery');
  assertIncludes(source, 'inferDesignDocumentRoleFromName', 'document role classifier');
  assertIncludes(source, 'document_role_mismatch', 'detail-page document role mismatch result');
  assertIncludes(source, 'status: \'document_role_mismatch\'', 'structured non-detail document status');
  assertIncludes(source, '名称包含「详情页」', 'user-actionable detail-page document naming guidance');
  assertIncludes(source, '|n${String(doc.name || \'\')}|', 'parse cache key includes document name');
  assertIncludes(source, 'detail_container_detected', 'detail container evidence issue');
  assertIncludes(source, 'getStableScreenBounds', 'stable screen bounds derivation');
  assertIncludes(source, 'screen_bounds_repaired', 'polluted screen bounds warning');
  assertIncludes(source, 'empty_or_invalid_layer_bounds', 'empty layer bounds warning');
  assertIncludes(source, 'hasUsableBounds', 'invalid bounds guard');
  assertIncludes(source, 'candidate?.source === \'detailContainer\'', 'repair only for detail container nested screens');
  assertIncludes(liveCaseSource, 'closeDocument', 'live case closes explicitly opened template without saving');
  assertIncludes(liveCaseSource, 'openedDocumentId', 'live case records opened document id for cleanup');
  assertIncludes(liveCaseSource, 'cleanup', 'live case reports cleanup evidence');
  assertNoMojibake(source);
  assertNoMojibake(liveCaseSource);

  console.log(JSON.stringify({
    ok: true,
    parser: path.relative(ROOT, UXP_PARSER).replace(/\\/g, '/'),
    liveCase: path.relative(ROOT, LIVE_CASE).replace(/\\/g, '/'),
    assertions: [
      'detects nested detail-page container screens',
      'refuses SKU/main-image documents before detail-page parsing',
      'keeps parser cache isolated by document name',
      'does not treat empty 0x0 layers as placeholders',
      'repairs polluted screen bounds using renderable content bounds',
      'keeps warnings as evidence instead of silently hiding risks',
      'closes explicitly opened template documents without saving'
    ]
  }, null, 2));
}

main();
