#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'src/shared/design-observation-intents.ts');
const schemasPath = path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts');
const executorPath = path.join(root, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const contract = fs.existsSync(contractPath) ? read(contractPath) : '';
const schemas = read(schemasPath);
const executor = read(executorPath);

for (const intent of [
  'layout_balance',
  'image_fit',
  'text_readability',
  'container_overflow',
  'visual_hierarchy',
  'stage_readiness',
  'export_readiness'
]) {
  assert(contract.includes(intent), `missing observation intent ${intent}`);
}

assert(contract.includes('getAnnotatedSnapshot'), 'observation contract must prefer annotated visual evidence');
assert(contract.includes('getAcceptanceSnapshot'), 'observation contract must include structured layer evidence');
assert(contract.includes('getClippingMaskInfo'), 'image_fit intent must be able to inspect clipping relationships');
assert(contract.includes('maxRepairAttempts'), 'observation contract must define a bounded repair loop');
assert(contract.includes('evidenceOrder'), 'observation contract should define low-cost evidence ordering');
assert(!contract.includes('createClippingMask'), 'phase 1 observation contract must stay read-only');

assert(!schemas.includes('一次出整版、又快又齐'), 'renderLayout schema must not encourage one-shot full-page output');
assert(schemas.includes('当前阶段草稿'), 'renderLayout schema should describe staged drafting');
assert(schemas.includes('getClippingMaskInfo'), 'Agent tool schema should expose read-only clipping inspection');
assert(schemas.includes('getAllClippingMasks'), 'Agent tool schema should expose document-level clipping inspection');

assert(executor.includes('designObservationIntent'), 'executor should track targeted observation intent');
assert(executor.includes('needsTargetedObservationAfterMutation'), 'executor should guard post-mutation save/export');
assert(executor.includes('maxRepairAttempts'), 'executor should cap repeated observation/repair loops');
assert(executor.includes('先读结构证据'), 'executor should prefer cheap evidence before heavy screenshots');
assert(executor.includes('当前阶段'), 'executor prompt should describe stage-level observation');

console.log(JSON.stringify({
  success: true,
  checks: [
    'observation intents exist',
    'evidence requirements are read-only in phase 1',
    'low-cost evidence ordering is defined',
    'renderLayout is stage draft oriented',
    'executor has post-mutation targeted observation guards'
  ]
}, null, 2));
