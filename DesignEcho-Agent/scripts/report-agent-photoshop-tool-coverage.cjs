#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'agent-photoshop-tool-coverage.json');
const MD_OUT = path.join(TMP_DIR, 'agent-photoshop-tool-coverage.md');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(ROOT, 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { getDefaultAgentTools } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
const { getPhotoshopToolSkillSemantics } = require(path.join(ROOT, 'src', 'shared', 'photoshop-tool-skill.ts'));

const AGENT_LIVE_RUNNERS = [
  {
    id: 'agent-live-basic-tools',
    script: 'smoke:agent:live-photoshop-tool-task',
    contractScript: 'smoke:agent:live-photoshop-tool-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-tool-task.cjs')
  },
  {
    id: 'agent-live-layer-effects',
    script: 'smoke:agent:live-photoshop-layer-effects-task',
    contractScript: 'smoke:agent:live-photoshop-layer-effects-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-layer-effects-task.cjs')
  },
  {
    id: 'agent-live-layer-management',
    script: 'smoke:agent:live-photoshop-layer-management-task',
    contractScript: 'smoke:agent:live-photoshop-layer-management-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-layer-management-task.cjs')
  },
  {
    id: 'agent-live-adjustment-clipping',
    script: 'smoke:agent:live-photoshop-adjustment-clipping-task',
    contractScript: 'smoke:agent:live-photoshop-adjustment-clipping-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-adjustment-clipping-task.cjs')
  },
  {
    id: 'agent-live-readonly-evidence',
    script: 'smoke:agent:live-photoshop-readonly-evidence-task',
    contractScript: 'smoke:agent:live-photoshop-readonly-evidence-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-readonly-evidence-task.cjs')
  },
  {
    id: 'agent-live-layout-history',
    script: 'smoke:agent:live-photoshop-layout-history-task',
    contractScript: 'smoke:agent:live-photoshop-layout-history-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-layout-history-task.cjs')
  },
  {
    id: 'agent-live-detail-page-workflow',
    script: 'smoke:agent:live-photoshop-detail-page-workflow-task',
    contractScript: 'smoke:agent:live-photoshop-detail-page-workflow-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-detail-page-workflow-task.cjs')
  },
  {
    id: 'agent-live-serial-suite',
    script: 'smoke:agent:live-photoshop-serial-suite-task',
    contractScript: 'smoke:agent:live-photoshop-serial-suite-task:contract',
    file: path.join(ROOT, 'scripts', 'run-agent-live-photoshop-serial-suite-task.cjs')
  }
];

const SCRIPTED_LIVE_SMOKE_HINTS = [
  {
    id: 'serial-photoshop-live-tools',
    script: 'smoke:photoshop-live-tools:serial',
    covers: [
      'createDocument',
      'createRectangle',
      'createEllipse',
      'createTextLayer',
      'createGroup',
      'groupLayers',
      'ungroupLayers',
      'setTextContent',
      'setTextStyle',
      'getTextContent',
      'getTextStyle',
      'getAllTextLayers',
      'setLayerOpacity',
      'setBlendMode',
      'addDropShadow',
      'addStroke',
      'clearLayerEffects',
      'addGlow',
      'addGradientOverlay',
      'setLayerFill',
      'moveLayer',
      'reorderLayer',
      'alignLayers',
      'distributeLayers',
      'transformLayer',
      'quickScale',
      'placeImage',
      'replaceLayerContent',
      'convertToSmartObject',
      'duplicateSmartObject',
      'getSmartObjectInfo',
      'getSmartObjectLayers',
      'saveDocument',
      'quickExport',
      'exportGroup',
      'smartSave',
      'getAcceptanceSnapshot',
      'getCanvasSnapshot',
      'getLayerHierarchy',
      'getLayerBounds',
      'getLayerProperties'
    ]
  }
];

const REQUIRED_AGENT_LIVE_SIGNALS = [
  'createDocument',
  'listDocuments',
  'closeDocument',
  'getDocumentInfo',
  'getLayerHierarchy',
  'createGroup',
  'createRectangle',
  'createTextLayer',
  'setLayerOpacity',
  'addStroke',
  'addDropShadow',
  'getLayerProperties',
  'switchDocument',
  'focusLayer',
  'renameLayer',
  'duplicateLayer',
  'deleteLayer',
  'moveLayerToGroup',
  'addBrightnessContrastAdjustment',
  'addHueSaturationAdjustment',
  'addLevelsAdjustment',
  'addColorBalanceAdjustment',
  'addVibranceAdjustment',
  'addPhotoFilterAdjustment',
  'createClippingMask',
  'releaseClippingMask',
  'getClippingMaskInfo',
  'getAllClippingMasks',
  'getDocumentSnapshot',
  'diagnoseState',
  'getAnnotatedSnapshot',
  'getElementMapping',
  'analyzeLayout',
  'detectLayerIssues',
  'getScreenSnapshots',
  'getScreenSnapshotsWithOverlay',
  'resolveFontName',
  'renderLayout',
  'alignToReference',
  'batchRenameLayers',
  'undo',
  'redo',
  'openProjectFile',
  'parseDetailPageTemplate',
  'fillDetailPage',
  'auditDetailPagePlacement',
  'fixLayerIssues',
  'exportDetailPageSlices',
  'quickExport'
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function extractToolNamesFromRunner(filePath) {
  const source = readText(filePath);
  const match = source.match(/const\s+TOOL_NAMES\s*=\s*\[([\s\S]*?)\];/);
  if (!match) return [];
  const names = [];
  const pattern = /'([^']+)'|"([^"]+)"/g;
  let item;
  while ((item = pattern.exec(match[1]))) {
    names.push(item[1] || item[2]);
  }
  return Array.from(new Set(names));
}

function buildAgentLiveCoverageMap() {
  const map = new Map();
  for (const runner of AGENT_LIVE_RUNNERS) {
    const toolNames = extractToolNamesFromRunner(runner.file);
    runner.toolNames = toolNames;
    for (const toolName of toolNames) {
      if (!map.has(toolName)) map.set(toolName, []);
      map.get(toolName).push({
        id: runner.id,
        script: runner.script,
        contractScript: runner.contractScript
      });
    }
  }
  return map;
}

function buildScriptedCoverageMap() {
  const map = new Map();
  for (const smoke of SCRIPTED_LIVE_SMOKE_HINTS) {
    for (const toolName of smoke.covers) {
      if (!map.has(toolName)) map.set(toolName, []);
      map.get(toolName).push({ id: smoke.id, script: smoke.script });
    }
  }
  return map;
}

function collectDefaultPhotoshopTools() {
  return getDefaultAgentTools()
    .map((tool) => {
      const semantics = getPhotoshopToolSkillSemantics(tool.name);
      return { tool, semantics };
    })
    .filter((item) => item.semantics?.requiresPhotoshopConnection === true)
    .map((item) => ({
      name: item.tool.name,
      capabilityKind: item.semantics.capabilityKind,
      sideEffect: item.semantics.sideEffect,
      requiresOpenDocument: item.semantics.requiresOpenDocument,
      requiresPriorDocumentRead: item.semantics.requiresPriorDocumentRead,
      verifyWith: item.semantics.verifyWith
    }));
}

function coverageStatus(agentLive, scriptedLive) {
  if (agentLive.length > 0) return 'agent-live';
  if (scriptedLive.length > 0) return 'scripted-live-only';
  return 'needs-agent-live';
}

function summarizeBy(items, key) {
  return items.reduce((acc, item) => {
    const value = String(item[key] || 'unknown');
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function renderMarkdown(report) {
  const lines = [
    '# Agent Photoshop Tool Coverage',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- defaultPhotoshopToolCount: ${report.summary.defaultPhotoshopToolCount}`,
    `- agentLiveCovered: ${report.summary.agentLiveCovered}`,
    `- scriptedLiveOnly: ${report.summary.scriptedLiveOnly}`,
    `- needsAgentLive: ${report.summary.needsAgentLive}`,
    `- requiredAgentLiveSignalsPassed: ${report.summary.requiredAgentLiveSignalsPassed}`,
    '',
    '## Agent Live Runners',
    ''
  ];

  for (const runner of report.agentLiveRunners) {
    lines.push(`- ${runner.id}: \`${runner.script}\` (${runner.toolNames.length} tools)`);
  }

  if (report.requiredAgentLiveSignalGaps.length > 0) {
    lines.push('', '## Required Signal Gaps', '');
    for (const gap of report.requiredAgentLiveSignalGaps) lines.push(`- ${gap}`);
  }

  if (report.needsAgentLiveTools.length > 0) {
    lines.push('', '## Needs Agent Live Coverage', '');
    for (const row of report.needsAgentLiveTools) {
      lines.push(`- ${row.name} (${row.capabilityKind}, ${row.sideEffect})`);
    }
  }

  lines.push('', '## Matrix', '');
  lines.push('| Tool | Kind | Side Effect | Open Doc | Prior Read | Coverage | Agent Live Runner | Scripted Live | Verify With |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.matrix) {
    lines.push([
      row.name,
      row.capabilityKind,
      row.sideEffect,
      row.requiresOpenDocument ? 'yes' : 'no',
      row.requiresPriorDocumentRead ? 'yes' : 'no',
      row.coverageStatus,
      row.agentLiveRunners.map((item) => item.id).join(', '),
      row.scriptedLiveSmokes.map((item) => item.id).join(', '),
      row.verifyWith.join(', ')
    ].map((cell) => String(cell).replace(/\|/g, '\\|')).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('', '## Boundaries', '');
  for (const boundary of report.boundaries) lines.push(`- ${boundary}`);
  lines.push('');
  return lines.join('\n');
}

function buildReport() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const defaultTools = collectDefaultPhotoshopTools();
  const defaultToolNames = new Set(defaultTools.map((item) => item.name));
  const agentLiveCoverage = buildAgentLiveCoverageMap();
  const scriptedCoverage = buildScriptedCoverageMap();

  const runnerToolNames = Array.from(agentLiveCoverage.keys()).filter((name) => defaultToolNames.has(name));
  const runnerToolNamesOutsideDefault = Array.from(agentLiveCoverage.keys()).filter((name) => !defaultToolNames.has(name)).sort();
  const matrix = defaultTools
    .map((tool) => {
      const agentLiveRunners = agentLiveCoverage.get(tool.name) || [];
      const scriptedLiveSmokes = scriptedCoverage.get(tool.name) || [];
      return {
        ...tool,
        coverageStatus: coverageStatus(agentLiveRunners, scriptedLiveSmokes),
        agentLiveRunners,
        scriptedLiveSmokes
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const needsAgentLiveTools = matrix.filter((row) => row.coverageStatus === 'needs-agent-live');
  const requiredAgentLiveSignalGaps = REQUIRED_AGENT_LIVE_SIGNALS
    .filter((toolName) => !agentLiveCoverage.has(toolName));
  const missingPackageScripts = AGENT_LIVE_RUNNERS
    .flatMap((runner) => [runner.script, runner.contractScript])
    .filter((scriptName) => !pkg.scripts?.[scriptName]);

  const summary = {
    defaultPhotoshopToolCount: matrix.length,
    agentLiveCovered: matrix.filter((row) => row.coverageStatus === 'agent-live').length,
    scriptedLiveOnly: matrix.filter((row) => row.coverageStatus === 'scripted-live-only').length,
    needsAgentLive: needsAgentLiveTools.length,
    byCapabilityKind: summarizeBy(matrix, 'capabilityKind'),
    bySideEffect: summarizeBy(matrix, 'sideEffect'),
    agentLiveRunnerToolCount: runnerToolNames.length,
    runnerToolNamesOutsideDefault,
    requiredAgentLiveSignalsPassed: requiredAgentLiveSignalGaps.length === 0,
    missingPackageScripts
  };

  return {
    success: missingPackageScripts.length === 0 && requiredAgentLiveSignalGaps.length === 0,
    generatedAt: new Date().toISOString(),
    summary,
    agentLiveRunners: AGENT_LIVE_RUNNERS.map((runner) => ({
      id: runner.id,
      script: runner.script,
      contractScript: runner.contractScript,
      file: path.relative(ROOT, runner.file).replace(/\\/g, '/'),
      toolNames: runner.toolNames || []
    })),
    requiredAgentLiveSignals: REQUIRED_AGENT_LIVE_SIGNALS,
    requiredAgentLiveSignalGaps,
    needsAgentLiveTools,
    matrix,
    report: {
      json: JSON_OUT,
      md: MD_OUT
    },
    boundaries: [
      'agent-live means a real Agent runner can expose this tool to a real model; it does not mean the current environment has successfully run the live path today.',
      'scripted-live-only means existing Photoshop live smokes may exercise the tool without proving model-selected Agent behavior.',
      'needs-agent-live is an explicit backlog for the user objective; it is not a passing claim of full coverage.',
      'This report excludes non-Photoshop project, Eagle, knowledge-search, and image-generation tools.'
    ]
  };
}

function main() {
  ensureDir(TMP_DIR);
  const report = buildReport();
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(MD_OUT, renderMarkdown(report), 'utf8');
  console.log(JSON.stringify({
    success: report.success,
    summary: report.summary,
    requiredAgentLiveSignalGaps: report.requiredAgentLiveSignalGaps,
    needsAgentLiveCount: report.needsAgentLiveTools.length,
    report: report.report
  }, null, 2));
  process.exit(report.success ? 0 : 1);
}

main();
