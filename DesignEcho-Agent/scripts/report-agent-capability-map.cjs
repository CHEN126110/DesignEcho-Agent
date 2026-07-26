#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REQUIRED_LAYERS = [
  { id: 'L0', title: 'Agent 基础设施' },
  { id: 'L1', title: 'Photoshop 操作能力' },
  { id: 'L2', title: '设计理解能力' },
  { id: 'L3', title: '设计执行能力' },
  { id: 'L4', title: '业务场景能力' },
  { id: 'L5', title: 'Benchmark 与验收样本' }
];

const REQUIRED_LAYER_CONTENT_HEADINGS = {
  L0: '当前可定位实现',
  L1: '现有工具与验收',
  L2: '现有理解模块',
  L3: '现有执行与质量检查',
  L4: '当前业务场景',
  L5: '当前样本'
};

const REQUIRED_BOUNDARY_PHRASES = [
  '不是工具、skill 或产品功能',
  '不等于设计能力完成',
  '不等于视觉质量通过',
  '不等于高保真设计',
  '不把模型输出的计划当作 Photoshop 已执行结果',
  '不把 bounds-only QA 写成视觉审美质量通过'
];

const REQUIRED_SCRIPTS = [
  'maintenance:agent-architecture',
  'maintenance:project-cockpit',
  'maintenance:planning-check',
  'smoke:design-agent-os:contracts',
  'smoke:design-planner:mvp',
  'smoke:layout-replication:completion',
  'smoke:chat-ui:reference-replication:neutral',
  'smoke:reference:neutral-text-layout-case',
  'smoke:reference:neutral-text-pixel-bounds'
];

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
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function extractLayerSections(markdown) {
  const pattern = /^###\s+(L\d)：(.+)$/gm;
  const matches = [...markdown.matchAll(pattern)];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || markdown.length : markdown.length;
    return {
      id: match[1],
      title: match[2].trim(),
      body: markdown.slice(start, end)
    };
  });
}

function includesAll(text, phrases) {
  return phrases.filter((phrase) => !text.includes(phrase));
}

function layerHasOperationalFields(layerId, body) {
  const contentHeading = REQUIRED_LAYER_CONTENT_HEADINGS[layerId];
  return {
    currentStatus: body.includes('当前状态'),
    implementationOrScope: Boolean(contentHeading && body.includes(contentHeading)),
    boundary: body.includes('边界'),
    nextStep: body.includes('下一步')
  };
}

function buildReport() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const mapPath = path.join(agentRoot, 'docs/agent-capability-map.md');
  const packagePath = path.join(agentRoot, 'package.json');
  const statePath = path.join(agentRoot, 'project-memory/project-state.json');
  const planPath = path.join(agentRoot, 'project-memory/Plan.md');
  const osPath = path.join(agentRoot, 'docs/design-agent-operating-system.md');

  const markdown = readText(mapPath);
  const packageJson = readJson(packagePath);
  const projectState = readJson(statePath);
  const plan = readText(planPath);

  const layers = extractLayerSections(markdown);
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const layerReports = REQUIRED_LAYERS.map((required) => {
    const layer = layerById.get(required.id);
    const fields = layer ? layerHasOperationalFields(required.id, layer.body) : {};
    const missingFields = Object.entries(fields)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    return {
      id: required.id,
      title: required.title,
      present: Boolean(layer),
      titleMatches: Boolean(layer && layer.title === required.title),
      fields,
      missingFields
    };
  });

  const scripts = packageJson.scripts || {};
  const missingScripts = REQUIRED_SCRIPTS.filter((scriptName) => !scripts[scriptName]);
  const missingBoundaryPhrases = includesAll(markdown, REQUIRED_BOUNDARY_PHRASES);
  const mapHasFexBoundary = markdown.includes('FEX') && markdown.includes('临时简单文字排版 benchmark');
  const mapHasOsEntry = markdown.includes('docs/design-agent-operating-system.md') && fs.existsSync(osPath);
  const mapHasMethodology = markdown.includes('能力 inventory');
  const planReferencesCapabilityMap = plan.includes('agent-capability-map');
  const stateActivePlanPresent = Boolean(projectState.activePlan?.id && projectState.activePlan?.source);
  const stateActiveRequestPresent = Boolean(projectState.activeRequest?.id && projectState.activeRequest?.summary);

  const errors = [];
  for (const layer of layerReports) {
    if (!layer.present) errors.push(`Missing capability layer: ${layer.id}`);
    if (layer.present && !layer.titleMatches) errors.push(`Capability layer title mismatch: ${layer.id}`);
    for (const field of layer.missingFields) {
      errors.push(`Capability layer ${layer.id} missing field: ${field}`);
    }
  }
  for (const scriptName of missingScripts) {
    errors.push(`Missing required validation script: ${scriptName}`);
  }
  for (const phrase of missingBoundaryPhrases) {
    errors.push(`Capability map missing boundary phrase: ${phrase}`);
  }
  if (!mapHasFexBoundary) errors.push('Capability map must keep FEX scoped as temporary benchmark only.');
  if (!mapHasOsEntry) errors.push('Capability map must point to the Design Agent OS entry document.');
  if (!mapHasMethodology) errors.push('Capability map must identify itself as inventory, not architecture control plane.');
  if (!planReferencesCapabilityMap) errors.push('Plan.md must reference docs/agent-capability-map.md.');
  if (!stateActivePlanPresent) errors.push('project-state.activePlan is required.');
  if (!stateActiveRequestPresent) errors.push('project-state.activeRequest is required.');

  return {
    success: errors.length === 0,
    generatedAt: new Date().toISOString(),
    capabilityMap: 'docs/agent-capability-map.md',
    role: 'inventory-not-control-plane',
    layerCount: layers.length,
    layers: layerReports,
    requiredScripts: REQUIRED_SCRIPTS,
    missingScripts,
    boundaryPhrases: {
      required: REQUIRED_BOUNDARY_PHRASES,
      missing: missingBoundaryPhrases
    },
    crossChecks: {
      mapHasFexBoundary,
      mapHasOsEntry,
      mapHasMethodology,
      planReferencesCapabilityMap,
      stateActivePlanPresent,
      stateActiveRequestPresent
    },
    errors
  };
}

function printText(report) {
  console.log('DesignEcho Agent 能力地图校验');
  console.log(`状态: ${report.success ? '通过' : '失败'}`);
  console.log(`能力层: ${report.layerCount}`);
  for (const layer of report.layers) {
    const missing = layer.missingFields.length > 0 ? ` 缺失字段=${layer.missingFields.join(',')}` : '';
    console.log(`- ${layer.id} ${layer.title}: ${layer.present && layer.titleMatches ? 'ok' : 'missing'}${missing}`);
  }
  if (report.errors.length > 0) {
    console.log('');
    console.log('问题:');
    for (const error of report.errors) {
      console.log(`- ${error}`);
    }
  }
}

function main() {
  const json = process.argv.includes('--json');
  const report = buildReport();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
  if (!report.success) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
