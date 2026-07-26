#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUBSYSTEMS = [
  'Intent Control Plane',
  'Context Memory',
  'Visual Perception',
  'Knowledge And Recipe',
  'Design DSL',
  'Photoshop Execution',
  'Verification And QA',
  'User Feedback UX'
];

const char = (codePoint) => String.fromCodePoint(codePoint);

const MOJIBAKE_PATTERNS = [
  0x9359,
  0x7487,
  0x9429,
  0xFFFD
].map(char);

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, expected, label) {
  assert(text.includes(expected), `${label} must include ${expected}`);
}

function assertNoMojibake(text, label) {
  for (const pattern of MOJIBAKE_PATTERNS) {
    assert(!text.includes(pattern), `${label} contains mojibake pattern ${pattern}`);
  }
}

function assertSubsystemsInDocument(text, label) {
  for (const subsystem of SUBSYSTEMS) {
    assertIncludes(text, subsystem, label);
  }
}

function main() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const topDocPath = path.join(agentRoot, 'docs/design-agent-operating-system.md');
  const treeDocPath = path.join(agentRoot, 'docs/design-agent-os-implementation-tree.md');
  const packageJson = readJson(path.join(agentRoot, 'package.json'));
  const topDoc = readText(topDocPath);
  const treeDoc = readText(treeDocPath);

  assertSubsystemsInDocument(topDoc, 'design-agent-operating-system.md');
  assertSubsystemsInDocument(treeDoc, 'design-agent-os-implementation-tree.md');
  assertIncludes(treeDoc, 'M0h：Design Agent OS 子系统实施树与架构 gate', 'implementation tree');
  assertIncludes(treeDoc, 'ProjectAssetIndex', 'implementation tree project asset index');
  assertIncludes(treeDoc, 'Planner 还没有真正控制 Photoshop 执行顺序', 'implementation tree boundary');
  assertIncludes(treeDoc, '不能说自动主图、详情页、SKU、参考图复刻已经通用完成', 'implementation tree no-overclaim boundary');
  assertNoMojibake(topDoc, 'design-agent-operating-system.md');
  assertNoMojibake(treeDoc, 'design-agent-os-implementation-tree.md');

  assert(
    packageJson.scripts?.['smoke:design-agent-os:architecture-tree'] === 'node scripts/smoke-design-agent-os-architecture-tree.cjs',
    'package.json must expose smoke:design-agent-os:architecture-tree'
  );

  const report = JSON.parse(run('node', ['scripts/report-agent-architecture.cjs', '--json'], agentRoot));
  assert(Array.isArray(report.designAgentOsSubsystems), 'architecture report must expose designAgentOsSubsystems');
  assert(report.designAgentOsSubsystems.length === SUBSYSTEMS.length, 'architecture report must expose all OS subsystems');
  for (const subsystem of SUBSYSTEMS) {
    const found = report.designAgentOsSubsystems.find((item) => item.title === subsystem);
    assert(found, `architecture report missing subsystem ${subsystem}`);
    assert(found.status === 'mvp', `subsystem ${subsystem} should be mvp after architecture-tree wiring`);
    assert(Array.isArray(found.gaps) && found.gaps.length > 0, `subsystem ${subsystem} must keep next runtime gap visible`);
  }
  assert(report.matureArchitectureComplete === false, 'architecture report must not claim mature architecture complete');
  assert(report.architectureStatus === 'mvp_ready_not_complete', 'architecture report must stay mvp_ready_not_complete');
  const reportText = JSON.stringify(report);
  assertIncludes(reportText, '主图和详情页当前只是业务 skill 场景', 'architecture report business skill boundary');
  assertIncludes(reportText, '具体主图设计策略后续再单独设计', 'architecture report main-image design strategy boundary');
  assertIncludes(reportText, 'ProjectAssetIndex', 'architecture report project asset index');
  assert(report.projectAssetIndex?.helperAvailable === true, 'architecture report must expose projectAssetIndex helper');
  assert(report.projectAssetIndex?.smokeAvailable === true, 'architecture report must expose projectAssetIndex smoke');

  console.log(JSON.stringify({
    ok: true,
    subsystemCount: report.designAgentOsSubsystems.length,
    projectAssetIndexSmoke: report.projectAssetIndex.smokeAvailable,
    architectureStatus: report.architectureStatus,
    matureArchitectureComplete: report.matureArchitectureComplete
  }, null, 2));
}

main();
