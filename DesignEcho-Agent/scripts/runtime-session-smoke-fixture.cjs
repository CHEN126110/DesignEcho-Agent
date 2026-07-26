'use strict';

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { createRuntimeSessionIdentity } = require(path.join(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-runtime-v5',
  'runtime-session.ts'
));

let sequence = 0;

function createRuntimeSessionIdentityForPlan(plan, label = 'runtime-session-smoke') {
  sequence += 1;
  return createRuntimeSessionIdentity({
    now: `2026-07-13T05:00:${String(sequence).padStart(2, '0')}.000Z`,
    nonce: `${label}-${sequence}`.replace(/[^A-Za-z0-9_.:-]/g, '-'),
    skillId: plan.skillId,
    taskType: plan.taskType
  });
}

module.exports = { createRuntimeSessionIdentityForPlan };
