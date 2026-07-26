/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const INPUT = path.join(TMP_DIR, 'photoshop-mcp-inventory.json');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-test-matrix.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-test-matrix.md');

const SAFE_SMOKE = new Set([
  'listDocuments',
  'diagnoseState'
]);

const BLOCKED_BULK = new Map([
  ['getHistoryInfo', 'Historically timed out or destabilized bulk audits. Do not include in unattended batches.'],
  ['getDocumentSnapshot', 'Pixel-heavy snapshot path. Keep out of default smoke until runtime proves stable.'],
  ['getCanvasSnapshot', 'Visual snapshot path is heavier than standard getters. Manual or opt-in smoke only.'],
  ['getScreenSnapshots', 'Requires parsed screen context and renders image data. Manual or guided smoke only.'],
  ['getScreenSnapshotsWithOverlay', 'Requires parsed screen context and image overlay rendering. Manual or guided smoke only.'],
  ['getSelectionMask', 'Selection-dependent imaging call. Avoid unattended bulk smoke.'],
  ['getSelectionBounds', 'Selection-dependent call. Avoid unattended bulk smoke.']
]);

const TEXT_DOC_ONLY_TOOLS = new Set([
  'createTextLayer',
  'getAllTextLayers'
]);

const TEXT_LAYER_TOOLS = new Set([
  'auditTextReplacement',
  'getTextContent',
  'getTextStyle',
  'setTextContent',
  'setTextStyle'
]);

const LAYER_TARGET_OPTIONAL_TOOLS = new Set([
  'addDropShadow',
  'addGlow',
  'addGradientOverlay',
  'addStroke',
  'clearLayerEffects',
  'deleteLayer',
  'duplicateLayer',
  'getClippingMaskInfo',
  'getLayerBounds',
  'getLayerProperties',
  'lockLayer',
  'moveLayer',
  'renameLayer',
  'reorderLayer',
  'replaceLayerContent',
  'selectLayer',
  'setBlendMode',
  'setLayerFill',
  'setLayerOpacity'
]);

const DOCUMENT_SCOPE_LAYOUT_TOOLS = new Set([
  'analyzeLayout',
  'detectLayerIssues',
  'getAllClippingMasks',
  'getElementMapping',
  'getLayerHierarchy',
  'getTemplateStructure',
  'parseDetailPageTemplate'
]);

const HEAVY_IMAGE_READ_TOOLS = new Set([
  'getMattingImage',
  'getOptimizedImage',
  'getSubjectBounds'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function startsWithAny(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function inferKind(name) {
  if (startsWithAny(name, ['get', 'list', 'analyze', 'diagnose', 'audit', 'parse', 'detect'])) {
    return 'read';
  }
  if (startsWithAny(name, ['export'])) {
    return 'export';
  }
  return 'write';
}

function inferPreconditions(name, category) {
  if (name === 'listDocuments') {
    return 'None';
  }
  if (name === 'createDocument') {
    return 'Photoshop connected and valid width/height/resolution or a known preset';
  }
  if (name === 'createRectangle') {
    return 'Open document plus valid x/y/width/height and optional fill color';
  }
  if (name === 'createEllipse') {
    return 'Open document plus valid x/y/width/height and optional fill color';
  }
  if (name === 'createTextLayer') {
    return 'Open document plus non-empty text content and valid x/y coordinates';
  }
  if (name === 'createGroup') {
    return 'Open document plus non-empty groupName and either layerIds, selected layers, or empty-group mode';
  }
  if (name === 'replaceImagePlaceholder') {
    return 'Open document plus layerPath or placeholderLayerId/targetLayerId, and imagePath or image payload';
  }
  if (name === 'batchExport') {
    return 'Open document plus outputDirectory and at least one preset with width or height greater than 0';
  }
  if (name === 'getSubjectBounds') {
    return 'Open document plus explicit layerId greater than 0; method must be alpha or smart; alpha scans alpha pixels and smart fails explicitly if subject selection cannot be created';
  }
  if (name === 'getMattingImage') {
    return 'Open document plus explicit layerId or active layer; maxSize must be greater than 0 and outputFormat must be jpeg or raw';
  }
  if (name === 'getOptimizedImage') {
    return 'Open document plus either explicit layerId, active layer, or document-wide/boundary mode; returns requestedBounds and actualBounds; validate maxSize, quality, includeAlpha, and boundary values';
  }
  if (name.includes('Selection')) {
    return 'Open document and active selection';
  }
  if (TEXT_DOC_ONLY_TOOLS.has(name)) {
    return 'Open document';
  }
  if (TEXT_LAYER_TOOLS.has(name)) {
    return 'Open document and active text layer or explicit text layer ID';
  }
  if (name.includes('Screen') || ['fillDetailPage', 'auditDetailPagePlacement', 'exportDetailPageSlices'].includes(name)) {
    return 'Open detail-page document and parsed screens from parseDetailPageTemplate';
  }
  if (name === 'getSmartObjectLayers') {
    return 'Open document and active Smart Object layer or explicit layer ID; use autoOpen=false for disposable smoke';
  }
  if (name.includes('SmartObject') || name.includes('SmartObject')) {
    return 'Open document and active Smart Object layer or explicit layer ID';
  }
  if (LAYER_TARGET_OPTIONAL_TOOLS.has(name)) {
    return 'Open document and active layer or explicit target layer ID';
  }
  if (DOCUMENT_SCOPE_LAYOUT_TOOLS.has(name)) {
    return 'Open document';
  }
  if (category === 'sku' || name === 'skuLayout') {
    return 'Open SKU/source document with expected placeholder or color-group structure';
  }
  if (category === 'layout') {
    return 'Open document and valid target layer IDs or active layers';
  }
  if (category === 'image') {
    return 'Open document and valid image/layer context';
  }
  if (category === 'canvas') {
    return 'Open document';
  }
  if (category === 'layer') {
    return 'Open document and valid target layer IDs or active layer';
  }
  if (category === 'morphing') {
    return 'Open document and valid source/target shape or image layers';
  }
  return 'Open document';
}

function inferAutoSmoke(name, kind, popupRisk) {
  if (BLOCKED_BULK.has(name)) {
    return 'blocked';
  }
  if (SAFE_SMOKE.has(name)) {
    return 'safe';
  }
  if (HEAVY_IMAGE_READ_TOOLS.has(name)) {
    return 'manual-risky';
  }
  if (kind !== 'read') {
    return popupRisk === 'possible-dialog' ? 'manual-risky' : 'manual';
  }
  return popupRisk === 'low' ? 'conditional' : 'manual-risky';
}

function inferExecutionLane(autoSmoke) {
  switch (autoSmoke) {
    case 'safe':
      return { lane: 'safe-read-batch', recommendedBatchSize: 3, recommendedDelayMs: 50 };
    case 'conditional':
      return { lane: 'conditional-read-batch', recommendedBatchSize: 2, recommendedDelayMs: 150 };
    case 'manual':
      return { lane: 'isolated-write', recommendedBatchSize: 1, recommendedDelayMs: 250 };
    case 'manual-risky':
      return { lane: 'isolated-risky', recommendedBatchSize: 1, recommendedDelayMs: 400 };
    case 'blocked':
    default:
      return { lane: 'blocked', recommendedBatchSize: 1, recommendedDelayMs: 500 };
  }
}

function inferManualValidationMode(name, autoSmoke) {
  if (autoSmoke === 'manual-risky') {
    if (['getSmartObjectInfo', 'getSmartObjectLayers'].includes(name)) {
      return 'disposable-smoke';
    }
    if (HEAVY_IMAGE_READ_TOOLS.has(name)) {
      return 'disposable-smoke';
    }
    if (['createDocument', 'createRectangle', 'createEllipse', 'createTextLayer', 'createGroup'].includes(name)) {
      return 'disposable-smoke';
    }
    if (['addDropShadow', 'addGlow', 'addGradientOverlay', 'addStroke', 'clearLayerEffects', 'setLayerFill'].includes(name)) {
      return 'disposable-smoke';
    }
    if (['replaceImagePlaceholder', 'batchExport'].includes(name)) {
      return 'disposable-smoke';
    }
    return 'interactive-only';
  }
  if (autoSmoke === 'manual') {
    return 'interactive-or-scripted';
  }
  return 'not-required';
}

function inferNotes(name, entry) {
  const notes = [];
  if (BLOCKED_BULK.has(name)) {
    notes.push(BLOCKED_BULK.get(name));
  }
  if (entry.popupRisk === 'possible-dialog') {
    notes.push('May trigger Photoshop availability or modal-state alerts if preconditions are missing.');
  }
  if (entry.category === 'sku') {
    notes.push('Depends on strict document naming and layer/group conventions.');
  }
  if (HEAVY_IMAGE_READ_TOOLS.has(name)) {
    notes.push('Heavy image-read tool; keep isolated from standard read batches and validate bounds/size inputs before execution.');
  }
  if (name === 'getOptimizedImage') {
    notes.push('Returns both requestedBounds and actualBounds; callers should not assume the returned region matches the requested rectangle after scaling.');
  }
  if (name === 'getSubjectBounds') {
    notes.push('Smart mode is strict: it should fail explicitly if subject selection cannot be produced, rather than silently falling back to layer bounds.');
  }
  if (name === 'getMattingImage') {
    notes.push('Output format is jpeg or raw only in the current runtime contract.');
  }
  if (name === 'auditTextReplacement') {
    notes.push('Useful for text replacement bug triage; prefer this before trying repeated live replacements.');
  }
  if (name === 'parseDetailPageTemplate') {
    notes.push('Acts as a prerequisite for screen-based detail-page tools.');
  }
  return notes.join(' ');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Test Matrix');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Runtime tools: ${report.summary.runtimeTools}`);
  lines.push(`- Safe smoke: ${report.summary.safe}`);
  lines.push(`- Conditional smoke: ${report.summary.conditional}`);
  lines.push(`- Manual: ${report.summary.manual}`);
  lines.push(`- Manual risky: ${report.summary.manualRisky}`);
  lines.push(`- Blocked from bulk: ${report.summary.blocked}`);
  lines.push(`- Agent Photoshop runtime candidates: ${report.summary.agentRuntimeCandidates}`);
  lines.push(`- Agent runtime covered: ${report.summary.agentRuntimeCovered}`);
  lines.push(`- Default-agent runtime candidates: ${report.summary.defaultAgentRuntimeCandidates}`);
  lines.push(`- Default-agent runtime covered: ${report.summary.defaultAgentRuntimeCovered}`);
  lines.push(`- Model-schema runtime candidates: ${report.summary.modelSchemaRuntimeCandidates}`);
  lines.push(`- Model-schema runtime covered: ${report.summary.modelSchemaRuntimeCovered}`);
  lines.push(`- Agent runtime missing: ${report.agentRuntimeMissing.length}`);
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  lines.push('- `safe`: allowed in unattended smoke.');
  lines.push('- `conditional`: read-only but needs explicit setup; do not run blindly.');
  lines.push('- `manual`: requires document changes or file output; test only on disposable docs.');
  lines.push('- `manual-risky`: may trigger Photoshop modal or availability alerts; test interactively only.');
  lines.push('- `blocked`: do not include in bulk audit.');
  lines.push('');
  lines.push('| Tool | Agent | Default Agent | Model Schema | Executor | Skill | Category | Kind | Auto Smoke | Execution Lane | Validation Mode | Popup Risk | Preconditions | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const item of report.matrix) {
    const agentCell = item.usedByAgent ? item.agentToolNames.join(', ') : '';
    const defaultAgentCell = item.usedByDefaultAgent ? item.defaultAgentToolNames.join(', ') : '';
    const modelSchemaCell = item.usedByModelSchema ? item.modelSchemaToolNames.join(', ') : '';
    const executorCell = item.usedByToolExecutor ? item.toolExecutorToolNames.join(', ') : '';
    const skillCell = item.requiredBySkill ? item.skillRequiredToolNames.join(', ') : '';
    lines.push(
      `| ${item.toolName} | ${agentCell} | ${defaultAgentCell} | ${modelSchemaCell} | ${executorCell} | ${skillCell} | ${item.category} | ${item.kind} | ${item.autoSmoke} | ${item.executionLane.lane} (${item.executionLane.recommendedBatchSize}/${item.executionLane.recommendedDelayMs}ms) | ${item.manualValidationMode} | ${item.popupRisk} | ${item.preconditions.replace(/\|/g, '\\|')} | ${item.notes.replace(/\|/g, '\\|')} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  ensureDir(TMP_DIR);
  const inventory = readJson(INPUT);
  const agentRuntimeCandidates = Array.isArray(inventory.agentToolCoverage?.runtimeCandidates)
    ? inventory.agentToolCoverage.runtimeCandidates
    : [];
  const sourceRuntimeCandidates = inventory.agentToolCoverage?.sourceRuntimeCandidates || {};
  const defaultAgentRuntimeCandidates = Array.isArray(sourceRuntimeCandidates.defaultAgent)
    ? sourceRuntimeCandidates.defaultAgent
    : agentRuntimeCandidates.filter((item) => Array.isArray(item.sources) && item.sources.includes('default-agent'));
  const modelSchemaRuntimeCandidates = Array.isArray(sourceRuntimeCandidates.modelSchema)
    ? sourceRuntimeCandidates.modelSchema
    : agentRuntimeCandidates.filter((item) => Array.isArray(item.sources) && item.sources.includes('model-schema'));
  const toolExecutorRuntimeCandidates = Array.isArray(sourceRuntimeCandidates.toolExecutor)
    ? sourceRuntimeCandidates.toolExecutor
    : agentRuntimeCandidates.filter((item) => Array.isArray(item.sources) && item.sources.includes('tool-executor'));
  const skillRequiredRuntimeCandidates = Array.isArray(sourceRuntimeCandidates.skillRequired)
    ? sourceRuntimeCandidates.skillRequired
    : agentRuntimeCandidates.filter((item) => Array.isArray(item.sources) && item.sources.includes('skill-required'));
  const agentRuntimeByRuntimeName = new Map();
  for (const candidate of agentRuntimeCandidates) {
    const runtimeName = String(candidate?.runtimeName || '').trim();
    if (!runtimeName) continue;
    if (!agentRuntimeByRuntimeName.has(runtimeName)) {
      agentRuntimeByRuntimeName.set(runtimeName, []);
    }
    agentRuntimeByRuntimeName.get(runtimeName).push(candidate);
  }
  const sourceMaps = {
    defaultAgent: new Map(),
    modelSchema: new Map(),
    toolExecutor: new Map(),
    skillRequired: new Map()
  };
  for (const [source, candidates] of [
    ['defaultAgent', defaultAgentRuntimeCandidates],
    ['modelSchema', modelSchemaRuntimeCandidates],
    ['toolExecutor', toolExecutorRuntimeCandidates],
    ['skillRequired', skillRequiredRuntimeCandidates]
  ]) {
    for (const candidate of candidates) {
      const runtimeName = String(candidate?.runtimeName || '').trim();
      if (!runtimeName) continue;
      if (!sourceMaps[source].has(runtimeName)) {
        sourceMaps[source].set(runtimeName, []);
      }
      sourceMaps[source].get(runtimeName).push(candidate);
    }
  }

  const matrix = inventory.inventory.entries
    .map((entry) => {
      const toolName = entry.toolName;
      const kind = inferKind(toolName);
      const autoSmoke = inferAutoSmoke(toolName, kind, entry.popupRisk);
      const agentMatches = agentRuntimeByRuntimeName.get(toolName) || [];
      const defaultAgentMatches = sourceMaps.defaultAgent.get(toolName) || [];
      const modelSchemaMatches = sourceMaps.modelSchema.get(toolName) || [];
      const toolExecutorMatches = sourceMaps.toolExecutor.get(toolName) || [];
      const skillRequiredMatches = sourceMaps.skillRequired.get(toolName) || [];
      return {
        toolName,
        category: entry.category,
        kind,
        usedByAgent: agentMatches.length > 0,
        agentToolNames: uniqueSorted(agentMatches.map((item) => item.toolName)),
        agentSources: uniqueSorted(agentMatches.flatMap((item) => Array.isArray(item.sources) ? item.sources : [])),
        usedByDefaultAgent: defaultAgentMatches.length > 0,
        defaultAgentToolNames: uniqueSorted(defaultAgentMatches.map((item) => item.toolName)),
        usedByModelSchema: modelSchemaMatches.length > 0,
        modelSchemaToolNames: uniqueSorted(modelSchemaMatches.map((item) => item.toolName)),
        usedByToolExecutor: toolExecutorMatches.length > 0,
        toolExecutorToolNames: uniqueSorted(toolExecutorMatches.map((item) => item.toolName)),
        requiredBySkill: skillRequiredMatches.length > 0,
        skillRequiredToolNames: uniqueSorted(skillRequiredMatches.map((item) => item.toolName)),
        popupRisk: entry.popupRisk,
        preconditions: inferPreconditions(toolName, entry.category),
        autoSmoke,
        executionLane: inferExecutionLane(autoSmoke),
        notes: inferNotes(toolName, entry),
        manualValidationMode: inferManualValidationMode(toolName, autoSmoke),
        sourceFile: entry.sourceFile
      };
    })
    .sort((a, b) => a.toolName.localeCompare(b.toolName));

  const summary = matrix.reduce((acc, item) => {
    acc.runtimeTools += 1;
    if (item.autoSmoke === 'safe') acc.safe += 1;
    if (item.autoSmoke === 'conditional') acc.conditional += 1;
    if (item.autoSmoke === 'manual') acc.manual += 1;
    if (item.autoSmoke === 'manual-risky') acc.manualRisky += 1;
    if (item.autoSmoke === 'blocked') acc.blocked += 1;
    if (item.usedByAgent) acc.agentRuntimeCovered += 1;
    if (item.usedByDefaultAgent) acc.defaultAgentRuntimeCovered += 1;
    if (item.usedByModelSchema) acc.modelSchemaRuntimeCovered += 1;
    if (item.usedByToolExecutor) acc.toolExecutorRuntimeCovered += 1;
    if (item.requiredBySkill) acc.skillRequiredRuntimeCovered += 1;
    return acc;
  }, {
    runtimeTools: 0,
    safe: 0,
    conditional: 0,
    manual: 0,
    manualRisky: 0,
    blocked: 0,
    agentRuntimeCandidates: agentRuntimeCandidates.length,
    agentRuntimeCovered: 0,
    defaultAgentRuntimeCandidates: defaultAgentRuntimeCandidates.length,
    defaultAgentRuntimeCovered: 0,
    modelSchemaRuntimeCandidates: modelSchemaRuntimeCandidates.length,
    modelSchemaRuntimeCovered: 0,
    toolExecutorRuntimeCandidates: toolExecutorRuntimeCandidates.length,
    toolExecutorRuntimeCovered: 0,
    skillRequiredRuntimeCandidates: skillRequiredRuntimeCandidates.length,
    skillRequiredRuntimeCovered: 0
  });

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    agentRuntimeMissing: Array.isArray(inventory.agentToolCoverage?.missingRuntimeTools)
      ? inventory.agentToolCoverage.missingRuntimeTools
      : [],
    agentRuntimeMissingBySource: inventory.agentToolCoverage?.missingRuntimeToolsBySource || {},
    matrix
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
