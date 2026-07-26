#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const runtimePath = 'src/renderer/services/agent-runtime/agent.ts';
const policyPath = 'src/renderer/services/agent-policies/design-task-policy.ts';
const runtimeSource = read(runtimePath);
const policyExists = fs.existsSync(path.join(ROOT, policyPath));

const forbiddenRuntimeTokens = [
  'fresh-detail-page-design',
  'projectSubdir',
  '详情页',
  '商品详情',
  'SKU 文档',
  '主图文档',
  'renderLayout',
  'placeImage',
  'saveDocument',
  'createTextLayer'
];

const leakedTokens = forbiddenRuntimeTokens.filter((token) => runtimeSource.includes(token));

assert(
  policyExists,
  'ReAct runtime should delegate business remediation and design draft summaries to a task policy layer.',
  { expected: policyPath }
);

assert(
  leakedTokens.length === 0,
  'ReAct runtime must not embed SKU/detail-page/main-image or Photoshop layout policy details.',
  { leakedTokens }
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'ReAct runtime delegates design task policy decisions',
    'ReAct runtime does not contain business domain labels',
    'ReAct runtime does not contain concrete Photoshop layout remediation tool names'
  ],
  files: {
    runtime: runtimePath,
    policy: policyPath
  }
}, null, 2));
