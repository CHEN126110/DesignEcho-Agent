#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const contractPath = path.join(ROOT, 'src', 'shared', 'agent-orchestration-layers.ts');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

assert(fs.existsSync(contractPath), 'missing Agent orchestration layer contract', {
  expected: 'src/shared/agent-orchestration-layers.ts'
});

const contract = require(contractPath);
const layers = contract.AGENT_ORCHESTRATION_LAYER_BOUNDARIES;
const expectedIds = [
  'react_orchestrator',
  'task_policy',
  'tool_adapter',
  'observation_contract'
];

assert(Array.isArray(layers), 'layer boundaries must be exported as an array');
assert(
  expectedIds.every((id) => layers.some((layer) => layer.id === id)),
  'layer contract must define the four governance layers',
  { expectedIds, actualIds: layers.map((layer) => layer.id) }
);

const reactLayer = contract.getAgentOrchestrationLayer('react_orchestrator');
assert(reactLayer, 'react_orchestrator layer must be resolvable');
assert(
  reactLayer.allowedResponsibilities.includes('drive_react_loop')
    && reactLayer.forbiddenResponsibilities.includes('domain_business_rules')
    && reactLayer.forbiddenResponsibilities.includes('photoshop_runtime_details'),
  'react_orchestrator layer must stay pure orchestration',
  reactLayer
);

const taskPolicyLayer = contract.getAgentOrchestrationLayer('task_policy');
assert(
  taskPolicyLayer.allowedResponsibilities.includes('domain_business_rules')
    && taskPolicyLayer.forbiddenResponsibilities.includes('execute_photoshop_tools'),
  'task_policy layer may decide business policy but must not execute tools',
  taskPolicyLayer
);

const toolAdapterLayer = contract.getAgentOrchestrationLayer('tool_adapter');
assert(
  toolAdapterLayer.allowedResponsibilities.includes('execute_photoshop_tools')
    && toolAdapterLayer.forbiddenResponsibilities.includes('domain_business_rules'),
  'tool_adapter layer executes tools without owning business decisions',
  toolAdapterLayer
);

const observationLayer = contract.getAgentOrchestrationLayer('observation_contract');
assert(
  observationLayer.allowedResponsibilities.includes('convert_tool_result_to_agent_observation')
    && observationLayer.forbiddenResponsibilities.includes('claim_design_quality'),
  'observation_contract layer converts evidence without claiming final quality',
  observationLayer
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'four orchestration layers are explicitly defined',
    'ReAct orchestration is separated from business and Photoshop details',
    'task policy can own domain rules without executing tools',
    'tool adapter executes tools without business decisions',
    'observation contract converts evidence without quality claims'
  ]
}, null, 2));
