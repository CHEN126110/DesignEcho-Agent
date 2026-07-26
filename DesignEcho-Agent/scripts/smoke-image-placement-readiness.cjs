#!/usr/bin/env node

const { execFileSync } = require('child_process');

function run(command, args) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x7487,
    0x951B,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens ${found.join(', ')}: ${text}`);
}

function main() {
  const output = run('node', ['scripts/report-image-placement-core-readiness.cjs', '--json']);
  const report = JSON.parse(output);

  assert(report.success === true, 'readiness report should succeed');
  assert(report.version === 'image-placement-readiness/v0', `unexpected version: ${report.version}`);
  assert(report.adapterReadiness === 'ready_for_read_only_adapter', `unexpected readiness: ${report.adapterReadiness}`);
  assert(report.qualityClaimAllowed === false, 'readiness report must not allow quality claim');
  assert(report.core.helperAvailable === true, 'core helper should be available');
  assert(report.core.wrapsSmartScalingPolicy === true, 'core should wrap smart scaling policy');
  assert(report.core.separatesPlanFromActualBounds === true, 'core should separate plan from actual bounds');
  assert(report.uxpEvidence.subjectBoundsToolAvailable === true, 'UXP subject bounds tool should be available');
  assert(report.uxpEvidence.placeImagePrimitiveAvailable === true, 'UXP placeImage primitive should be available');
  assert(report.uxpEvidence.transformLayerPrimitiveAvailable === true, 'UXP transformLayer primitive should be available');
  assert(report.businessBoundaries.mainImageNotDirectlyWired === true, 'main-image executor should not be directly wired in MVP');
  assert(report.businessBoundaries.detailPageNotDirectlyWired === true, 'detail-page executor should not be directly wired in MVP');
  assert(report.businessBoundaries.skuNotDirectlyWired === true, 'sku executor should not be directly wired in MVP');
  assert(report.warnings.some((item) => item.includes('No live disposable Photoshop placement case')), 'live Photoshop warning expected');
  assert(report.nextGates.some((item) => item.includes('Ask the user before wiring')), 'user checkpoint next gate expected');
  assertNoMojibake(report, 'readiness report');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'image placement readiness report is available',
      'core wraps smart scaling and separates plan from actual bounds',
      'UXP evidence providers and primitives are detected',
      'business skill executors remain unwired in MVP',
      'quality claim stays blocked until live placement evidence exists',
      'report text avoids mojibake'
    ]
  }, null, 2));
}

main();
