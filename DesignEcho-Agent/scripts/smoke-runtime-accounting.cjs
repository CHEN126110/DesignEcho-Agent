'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const {
  buildRuntimeAccountingDigest,
  createRuntimeAccountingLedger,
  recordRuntimeModelCall,
  recordRuntimeRecoveryAttempt,
  recordRuntimeReflexion,
  recordRuntimeToolCall
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-accounting.ts'));
const {
  buildRuntimeSessionDigest,
  createRuntimeSession,
  createRuntimeSessionIdentity,
  recordRuntimeSessionModelCall,
  recordRuntimeSessionToolCall
} = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts'));
const {
  buildAgentRunRecord,
  validateAgentRunRecordForPersist
} = require(path.join(root, 'src', 'shared', 'agent-run-record.ts'));
const { buildRuntimeStagePlan } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));

let ledger = createRuntimeAccountingLedger('2026-07-13T10:00:00.000Z');
ledger = recordRuntimeModelCall({
  ledger,
  stage: 'R1',
  durationMs: 120,
  succeeded: true,
  usage: { inputTokens: 1000, outputTokens: 200 },
  now: '2026-07-13T10:00:00.120Z'
});
ledger = recordRuntimeModelCall({
  ledger,
  stage: 'R1',
  durationMs: 80,
  succeeded: false,
  now: '2026-07-13T10:00:00.200Z'
});
ledger = recordRuntimeToolCall({
  ledger,
  stage: 'E1',
  durationMs: 45,
  succeeded: true,
  now: '2026-07-13T10:00:00.245Z'
});
ledger = recordRuntimeRecoveryAttempt(ledger, '2026-07-13T10:00:00.250Z');
ledger = recordRuntimeReflexion(ledger, '2026-07-13T10:00:00.300Z');
const digest = buildRuntimeAccountingDigest({
  ledger,
  now: '2026-07-13T10:00:01.000Z'
});

assert.strictEqual(digest.modelCallCount, 2);
assert.strictEqual(digest.modelFailureCount, 1);
assert.strictEqual(digest.inputTokens, 1000);
assert.strictEqual(digest.outputTokens, 200);
assert.strictEqual(digest.unreportedUsageCallCount, 1);
assert.strictEqual(digest.toolCallCount, 1);
assert.strictEqual(digest.recoveryAttemptCount, 1);
assert.strictEqual(digest.reflexionCount, 1);
assert.strictEqual(digest.wallTimeMs, 1000);
assert.deepStrictEqual(digest.costEstimate, { status: 'not_configured' });
assert.strictEqual(digest.boundaries.missingUsageNotEstimated, true);
assert.strictEqual(digest.boundaries.enforcesBudget, false);

const plan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);
const identity = createRuntimeSessionIdentity({
  now: '2026-07-13T10:00:00.000Z',
  nonce: 'runtime-accounting-smoke',
  skillId: plan.skillId,
  taskType: plan.taskType
});
let session = createRuntimeSession({ identity, plan });
session = recordRuntimeSessionModelCall({
  session,
  durationMs: 30,
  succeeded: true,
  usage: { inputTokens: 320, outputTokens: 64 },
  now: '2026-07-13T10:00:00.030Z'
});
session = recordRuntimeSessionToolCall({
  session,
  durationMs: 12,
  succeeded: false,
  now: '2026-07-13T10:00:00.042Z'
});
const sessionDigest = buildRuntimeSessionDigest({ session, plan });
assert.strictEqual(sessionDigest.accounting.inputTokens, 320);
assert.strictEqual(sessionDigest.accounting.outputTokens, 64);
assert.strictEqual(sessionDigest.accounting.toolFailureCount, 1);
assert.strictEqual(sessionDigest.accounting.stageBuckets[0].stage, 'R1');

const record = buildAgentRunRecord({
  now: '2026-07-13T10:00:01.000Z',
  goal: '验证运行成本账本进入 Run Record。',
  runtimeSessionIdentity: identity,
  result: {
    success: false,
    iterations: 1,
    stopReason: 'error',
    toolCallLog: [],
    executionSummary: {
      status: 'failed',
      blockers: ['fixture'],
      warnings: [],
      runtimeSessionDigest: sessionDigest
    }
  }
});
assert.strictEqual(record.runtimeSession.accounting.inputTokens, 320);
assert.strictEqual(record.runtimeSession.accounting.costEstimate.status, 'not_configured');
assert.deepStrictEqual(validateAgentRunRecordForPersist(record), { ok: true });

const legacyRecord = JSON.parse(JSON.stringify(record));
delete legacyRecord.runtimeSession.accounting;
assert.deepStrictEqual(validateAgentRunRecordForPersist(legacyRecord), { ok: true });

const tamperedRecord = JSON.parse(JSON.stringify(record));
tamperedRecord.runtimeSession.accounting.costEstimate = { status: 'estimated', amount: 99 };
assert.strictEqual(validateAgentRunRecordForPersist(tamperedRecord).ok, false);

const agentSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
  'utf8'
);
const rawModelCalls = agentSource.match(/this\.callModel\(/g) || [];
assert.strictEqual(rawModelCalls.length, 1, 'all model calls except the accounting wrapper must use callModelWithAccounting');
assert(agentSource.includes('recordRuntimeSessionToolCall({'));
assert(agentSource.includes('recordRuntimeSessionRecoveryAttempt({'));

console.log(JSON.stringify({
  success: true,
  ledger: digest,
  sessionAccounting: sessionDigest.accounting,
  runRecordPersistable: true,
  legacyCompatible: true
}, null, 2));
