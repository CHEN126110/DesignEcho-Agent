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

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const {
  EAGLE_WRITEBACK_GATE_VERSION,
  buildEagleWritebackGate,
  buildEagleWritebackGateBoundary,
  isEagleWritebackGatePayloadSafe
} = require('../src/shared/eagle-writeback-gate.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} should include ${needle}`);
}

function assertNoRawImagePayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    'data:image',
    ';base64,',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose raw image payloads: ${found.join(', ')}`, value);
}

function assertNoForbiddenTerms(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['confidence', '置信', 'direct_photoshop_action'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose forbidden decision terms: ${found.join(', ')}`, value);
}

function sampleCase(overrides = {}) {
  return {
    caseId: 'eagle-case:eagle-item-1',
    source: {
      provider: 'eagle',
      itemId: 'eagle-item-1',
      knowledgeResultId: 'eagle:eagle-item-1',
      filePath: 'D:/Eagle/library/socks-reference.jpg',
      thumbnailPath: 'D:/Eagle/library/.thumb/socks-reference.jpg'
    },
    asset: {
      name: 'socks-reference.jpg',
      tags: ['socks', 'sku-card'],
      folders: ['References'],
      annotation: 'Clean socks SKU card reference.',
      width: 1440,
      height: 1440
    },
    ...overrides
  };
}

function run() {
  const boundary = buildEagleWritebackGateBoundary();
  assert(boundary.readonly === true, 'writeback gate boundary should be readonly', boundary);
  assert(boundary.doesNotExecuteEagleWrites === true, 'writeback gate must not execute Eagle writes', boundary);
  assert(boundary.requiresUserConfirmation === true, 'writeback gate should require user confirmation', boundary);
  assert(boundary.doesNotRunPhotoshop === true, 'writeback gate must not run Photoshop', boundary);

  const defaultBlocked = buildEagleWritebackGate({
    requestedBy: 'smoke-test',
    source: 'eagle_visual_case_index',
    cases: [sampleCase()],
    proposedActions: [
      {
        action: 'add_tags',
        itemId: 'eagle-item-1',
        tags: ['accepted-reference'],
        reason: '用户采用该案例作为袜子 SKU 色卡参考。'
      }
    ]
  });

  assert(defaultBlocked.version === EAGLE_WRITEBACK_GATE_VERSION, 'gate should expose stable version', defaultBlocked);
  assert(defaultBlocked.status === 'blocked_pending_user_confirmation', 'default gate should block without explicit user confirmation', defaultBlocked);
  assert(defaultBlocked.canExecute === false, 'default gate must not be executable', defaultBlocked);
  assert(defaultBlocked.writebackPlan.length === 0, 'default gate should not emit writeback plan without confirmation', defaultBlocked.writebackPlan);
  assert(defaultBlocked.blockers.includes('missing_user_confirmation'), 'default gate should name missing user confirmation blocker', defaultBlocked.blockers);
  assert(defaultBlocked.boundaries.doesNotExecuteEagleWrites === true, 'default gate must not execute writes', defaultBlocked.boundaries);

  const confirmedPlan = buildEagleWritebackGate({
    requestedBy: 'smoke-test',
    source: 'manual_review',
    userConfirmed: true,
    cases: [sampleCase()],
    proposedActions: [
      {
        action: 'add_tags',
        itemId: 'eagle-item-1',
        tags: ['accepted-reference', 'sku-color-card'],
        reason: '用户确认该案例可作为 SKU 色卡参考。'
      },
      {
        action: 'update_annotation',
        itemId: 'eagle-item-1',
        annotation: '已确认：适合作为袜子 SKU 色卡参考，光影自然，排布整齐。',
        reason: '记录人工确认后的用途说明。'
      },
      {
        action: 'set_rating',
        itemId: 'eagle-item-1',
        rating: 5,
        reason: '用户确认该参考质量较高。'
      }
    ]
  });

  assert(confirmedPlan.status === 'ready_for_manual_writeback', 'confirmed safe actions should produce a manual writeback plan', confirmedPlan);
  assert(confirmedPlan.canExecute === false, 'confirmed gate should still not execute writes by itself', confirmedPlan);
  assert(confirmedPlan.writebackPlan.length === 3, 'confirmed gate should emit three planned operations', confirmedPlan.writebackPlan);
  assert(confirmedPlan.writebackPlan.every((item) => item.execution === 'manual_or_confirmed_external_write_only'), 'planned operations should remain non-executed', confirmedPlan.writebackPlan);
  assert(confirmedPlan.writebackPlan.every((item) => item.eagleTool && item.eagleTool.startsWith('item_')), 'planned operations should map to bounded Eagle item tools', confirmedPlan.writebackPlan);
  assert(confirmedPlan.auditTrail.some((line) => line.includes('manual_review')), 'confirmed plan should preserve source in audit trail', confirmedPlan.auditTrail);

  const dangerous = buildEagleWritebackGate({
    requestedBy: 'smoke-test',
    source: 'model_suggestion',
    userConfirmed: true,
    cases: [sampleCase()],
    proposedActions: [
      {
        action: 'delete_item',
        itemId: 'eagle-item-1',
        reason: 'delete low quality reference'
      }
    ]
  });

  assert(dangerous.status === 'blocked_dangerous_action', 'dangerous actions should be blocked even when confirmed', dangerous);
  assert(dangerous.canExecute === false, 'dangerous action gate must not execute', dangerous);
  assert(dangerous.writebackPlan.length === 0, 'dangerous actions should not produce a writeback plan', dangerous.writebackPlan);
  assert(dangerous.blockers.includes('dangerous_writeback_action'), 'dangerous gate should include dangerous action blocker', dangerous.blockers);

  const bulk = buildEagleWritebackGate({
    requestedBy: 'smoke-test',
    source: 'manual_review',
    userConfirmed: true,
    cases: Array.from({ length: 51 }, (_, index) => sampleCase({
      caseId: `eagle-case:eagle-item-${index + 1}`,
      source: {
        provider: 'eagle',
        itemId: `eagle-item-${index + 1}`,
        knowledgeResultId: `eagle:eagle-item-${index + 1}`
      }
    })),
    proposedActions: Array.from({ length: 51 }, (_, index) => ({
      action: 'add_tags',
      itemId: `eagle-item-${index + 1}`,
      tags: ['bulk-tag'],
      reason: 'bulk tagging test'
    }))
  });

  assert(bulk.status === 'blocked_bulk_writeback_requires_separate_review', 'bulk writeback should require separate review', bulk);
  assert(bulk.blockers.includes('bulk_writeback_limit_exceeded'), 'bulk gate should expose bulk blocker', bulk.blockers);

  const unsafePayload = buildEagleWritebackGate({
    requestedBy: 'smoke-test',
    source: 'manual_review',
    userConfirmed: true,
    cases: [sampleCase()],
    proposedActions: [
      {
        action: 'update_annotation',
        itemId: 'eagle-item-1',
        annotation: 'bad data:image/png;base64,abc',
        reason: 'bad raw payload'
      }
    ]
  });

  assert(unsafePayload.status === 'blocked_unsafe_payload', 'raw image payload should block writeback plan', unsafePayload);
  assert(unsafePayload.blockers.includes('unsafe_raw_image_payload'), 'raw payload blocker should be explicit', unsafePayload.blockers);

  for (const gate of [defaultBlocked, confirmedPlan, dangerous, bulk, unsafePayload]) {
    assert(isEagleWritebackGatePayloadSafe(gate), 'gate payload should pass raw image safety check', gate);
    assertNoRawImagePayload(gate, 'Eagle writeback gate');
    assertNoForbiddenTerms(gate, 'Eagle writeback gate');
  }

  const helper = read('src/shared/eagle-writeback-gate.ts');
  assert(!helper.includes('fetch('), 'writeback gate helper must not call network fetch directly');
  assert(!helper.includes('executeToolCall'), 'writeback gate helper must not execute tools');
  assert(!helper.includes('photoshop'), 'writeback gate helper should not depend on Photoshop semantics');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:knowledge:eagle-writeback-gate'], 'package should expose smoke:knowledge:eagle-writeback-gate');
  assert(packageJson.scripts['smoke:design-knowledge:eagle-writeback-gate'], 'package should expose design-knowledge alias for Eagle writeback gate');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assertIncludes(boundaries, 'smoke:knowledge:eagle-writeback-gate', 'change boundary validation');
  assertIncludes(boundaries, 'eagle-writeback-gate', 'change boundary matcher');

  const maintenance = read('scripts/validate-maintenance-hygiene.cjs');
  assertIncludes(maintenance, 'smoke-eagle-writeback-gate.cjs', 'maintenance hygiene script checks');

  return {
    success: true,
    checks: [
      'default Eagle writeback is blocked without user confirmation',
      'confirmed safe actions produce a bounded manual writeback plan without executing Eagle writes',
      'dangerous actions are blocked even after confirmation',
      'bulk writeback requires a separate review',
      'raw/base64 payloads block writeback planning',
      'gate payload exposes no confidence/direct Photoshop action/raw image fields',
      'package scripts, change boundary and maintenance hygiene are wired'
    ]
  };
}

try {
  const result = run();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
