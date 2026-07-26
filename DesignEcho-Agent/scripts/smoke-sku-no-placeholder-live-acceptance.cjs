#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildSkuExportReadback
} = require(path.join(__dirname, '..', 'src', 'shared', 'sku-export-readback.ts'));
const {
  ResourceManagerService
} = require(path.join(__dirname, '..', 'src', 'main', 'services', 'resource-manager-service.ts'));

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'sku-no-placeholder-live-acceptance');
const OUTPUT_DIR = path.join(TMP_DIR, 'disposable-output');
const REPORT_JSON = path.join(TMP_DIR, 'report.json');
const REPORT_MD = path.join(TMP_DIR, 'report.md');
const ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const LIVE_FLAG = 'DESIGNECHO_LIVE_SKU_NO_PLACEHOLDER_ACCEPTANCE';
const TAKEOVER_FLAG = 'DESIGNECHO_LIVE_SKU_NO_PLACEHOLDER_TAKEOVER';
const REQUIRED_NO_PLACEHOLDER_REVISION = 'sku-no-placeholder-auto-layout/v2';
const REQUIRED_RECURSIVE_SKU_COLOR_GROUPS_REVISION = 'sku-recursive-color-layer-groups/v1';
const PREFIX = `DesignEchoSkuNoPlaceholderLive-${Date.now()}`;
const ARGS = new Set(process.argv.slice(2));
const REQUIRED_TOOLS = [
  'listDocuments',
  'switchDocument',
  'createDocument',
  'createRectangle',
  'createTextLayer',
  'createGroup',
  'skuLayout',
  'closeDocument',
  'getAcceptanceSnapshot'
];
const LIVE_SKU_COLOR_SPECS = [
  ['白色', '#F4F4F0'],
  ['浅灰', '#B8B8B8'],
  ['深灰', '#565656'],
  ['黑色', '#111111'],
  ['奶白', '#EFE8D2'],
  ['米白', '#F3E9D4'],
  ['驼色', '#B89468'],
  ['棕色', '#6F4C32'],
  ['蓝色', '#6F8FB8'],
  ['粉色', '#E5A8B7'],
  ['绿色', '#7AA578'],
  ['紫色', '#8B78B7'],
  ['红色', '#C95F5F'],
  ['黄色', '#D8BE5A'],
  ['橙色', '#D99555'],
  ['青色', '#6BAEAF'],
  ['藏蓝', '#2E4566'],
  ['咖色', '#8A6148'],
  ['杏色', '#E8CDAA'],
  ['玫红', '#C86B8E'],
  ['湖蓝', '#5E95C6'],
  ['浅绿', '#A9C98E'],
  ['银灰', '#C9C9C9'],
  ['可可', '#5A4638']
];
const COMBO_MATRIX_COUNTS = [1, 2, 4, 5, 8, 10, 15];
const NOTE_MATRIX_COUNTS = [18];

function buildColorNames(count) {
  return LIVE_SKU_COLOR_SPECS.slice(0, count).map(([name]) => name);
}

function buildComboMatrix() {
  return COMBO_MATRIX_COUNTS.map((count) => buildColorNames(count));
}

function buildNoteMatrix() {
  return NOTE_MATRIX_COUNTS.map((count) => buildColorNames(count));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function asJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isAbsolutePath(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('\\\\') || /^\/(users|home|var|tmp|mnt)\//i.test(text);
}

function redactPath(value) {
  const text = String(value || '').trim();
  if (!text) return text;
  if (!isAbsolutePath(text)) return text.replace(/\\/g, '/');
  return `[local-path-redacted]/${path.basename(text)}`;
}

function isPathLikeKey(key) {
  return /(^|_)(path|paths|dir|directory|outputDir|reportJson|reportMd|exportedPaths)$/i.test(String(key || ''));
}

function sanitizeForReport(value, key) {
  if (typeof value === 'string') {
    if (/data:image\/|raw-image|base64/i.test(value)) return '[raw-image-redacted]';
    if (isPathLikeKey(key) || isAbsolutePath(value)) return redactPath(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeForReport(item, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeForReport(entryValue, entryKey)
    ])
  );
}

function toReportPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return text;
  }
}

async function rpc(method, params = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now() + Math.random(),
        method,
        params
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${ENDPOINT}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`${method} failed: ${asJson(payload.error)}`);
    return payload.result;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${method} timed out after ${timeoutMs}ms at ${ENDPOINT}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callTool(name, args = {}, timeoutMs = 20_000) {
  return parseToolResult(await rpc('tools/call', {
    name,
    arguments: args
  }, timeoutMs));
}

function isHostModalState(value) {
  const text = typeof value === 'string' ? value : value?.error || value?.message || '';
  return /host is in a modal state|modal|模态状态|正在处理其他命令/i.test(String(text));
}

async function callPhotoshopToolStable(name, args = {}, options = {}) {
  const attempts = options.attempts || 6;
  const delayMs = options.delayMs || 350;
  const timeoutMs = options.timeoutMs || 20_000;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callTool('photoshop.tools.call', { name, arguments: args }, timeoutMs);
      if (!isHostModalState(result) || attempt >= attempts) {
        if (result && typeof result === 'object') result.__smokeAttempts = attempt;
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!isHostModalState(error) || attempt >= attempts) throw error;
    }
    await sleep(delayMs * attempt);
  }

  if (lastError) throw lastError;
  return callTool('photoshop.tools.call', { name, arguments: args }, timeoutMs);
}

function assertToolSuccess(label, result) {
  if (!result?.success) {
    throw new Error(`${label} failed: ${asJson(result)}`);
  }
}

function normalizeToolNames(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map((tool) => String(tool?.name || '').trim()).filter(Boolean).sort();
}

function normalizePhotoshopTools(result) {
  return Array.isArray(result?.tools) ? result.tools : [];
}

function getToolSchemaProperties(tools, toolName) {
  const tool = tools.find((item) => item?.name === toolName);
  return tool?.inputSchema?.properties || {};
}

function buildRuntimeSchemaBlockers(tools) {
  const blockers = [];
  const skuLayoutProperties = getToolSchemaProperties(tools, 'skuLayout');
  if (!Object.prototype.hasOwnProperty.call(skuLayoutProperties, 'autoLayoutWithoutPlaceholders')) {
    blockers.push('运行中的 UXP skuLayout schema 缺少 autoLayoutWithoutPlaceholders；请重新加载 DesignEcho UXP 插件或重启 Photoshop 后再运行 no-placeholder live 验证。');
  }
  return blockers;
}

function normalizeCapabilityActions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function buildRuntimeCapabilityBlockers(capabilityResult) {
  const blockers = [];
  if (!capabilityResult || capabilityResult.success === false) {
    blockers.push(`运行中的 UXP skuLayout 不支持 getCapabilities 能力查询；请重新加载 DesignEcho UXP 插件或重启 Photoshop 后再运行 no-placeholder live 验证。${capabilityResult?.error ? ` 原因：${capabilityResult.error}` : ''}`);
    return blockers;
  }

  const data = capabilityResult?.data && typeof capabilityResult.data === 'object'
    ? capabilityResult.data
    : {};
  const actions = normalizeCapabilityActions(data.actions);
  const noPlaceholderActions = normalizeCapabilityActions(data.noPlaceholderAutoLayout?.actions);
  const skuSourceColorGroupActions = normalizeCapabilityActions(data.skuSourceColorGroups?.actions);

  if (data.schema !== 'sku-layout-capabilities/v0') {
    blockers.push('运行中的 UXP skuLayout getCapabilities 返回了未知能力 schema；请重新加载 DesignEcho UXP 插件后再验证。');
  }
  if (data.supportsNoPlaceholderAutoLayout !== true) {
    blockers.push('运行中的 UXP skuLayout 未声明 supportsNoPlaceholderAutoLayout=true。');
  }
  if (!actions.includes('execute') || !actions.includes('arrangeDynamic')) {
    blockers.push('运行中的 UXP skuLayout 能力列表缺少 execute 或 arrangeDynamic。');
  }
  if (!noPlaceholderActions.includes('execute') || !noPlaceholderActions.includes('arrangeDynamic')) {
    blockers.push('运行中的 UXP skuLayout 无占位符能力未覆盖组合图 execute 和自选备注 arrangeDynamic。');
  }
  if (data.noPlaceholderAutoLayout?.revision !== REQUIRED_NO_PLACEHOLDER_REVISION) {
    blockers.push(`运行中的 UXP skuLayout 无占位符能力 revision 不是 ${REQUIRED_NO_PLACEHOLDER_REVISION}；请重新加载当前插件后再验证。`);
  }
  if (data.noPlaceholderAutoLayout?.returnsActualSubjectBoundsQa !== true) {
    blockers.push('运行中的 UXP skuLayout 未声明 returnsActualSubjectBoundsQa=true，无法确认执行后 QA 使用真实商品主体边界。');
  }
  if (data.supportsRecursiveSkuLayerSets !== true) {
    blockers.push('运行中的 UXP skuLayout 未声明 supportsRecursiveSkuLayerSets=true，无法发现 SKU.psb 内嵌套颜色组。');
  }
  if (data.skuSourceColorGroups?.revision !== REQUIRED_RECURSIVE_SKU_COLOR_GROUPS_REVISION) {
    blockers.push(`运行中的 UXP skuLayout SKU 颜色组能力 revision 不是 ${REQUIRED_RECURSIVE_SKU_COLOR_GROUPS_REVISION}；请重新加载当前插件后再验证。`);
  }
  if (data.skuSourceColorGroups?.recursiveLayerSets !== true) {
    blockers.push('运行中的 UXP skuLayout SKU 颜色组能力未声明 recursiveLayerSets=true。');
  }
  if (data.skuSourceColorGroups?.canResolveNestedColorGroups !== true) {
    blockers.push('运行中的 UXP skuLayout SKU 颜色组能力未声明 canResolveNestedColorGroups=true。');
  }
  if (data.skuSourceColorGroups?.returnsLayerSetPaths !== true) {
    blockers.push('运行中的 UXP skuLayout SKU 颜色组能力未声明 returnsLayerSetPaths=true。');
  }
  for (const requiredAction of ['listLayerSets', 'copyLayerSetToTemplate', 'execute', 'arrangeDynamic']) {
    if (!skuSourceColorGroupActions.includes(requiredAction)) {
      blockers.push(`运行中的 UXP skuLayout SKU 颜色组能力缺少 ${requiredAction}。`);
    }
  }

  return blockers;
}

async function getPhotoshopTools() {
  const result = await rpc('tools/list', {}, 15_000);
  const toolNames = normalizeToolNames(result);
  if (!toolNames.includes('photoshop.tools.call')) return [];
  const photoshopTools = await callTool('photoshop.tools.list', {}, 15_000);
  return normalizePhotoshopTools(photoshopTools);
}

async function getSkuLayoutCapabilities() {
  return callPhotoshopToolStable('skuLayout', { action: 'getCapabilities' }, {
    attempts: 3,
    delayMs: 350,
    timeoutMs: 15_000
  });
}

function extractExportedPaths(result) {
  const exportedFiles = Array.isArray(result?.data?.exportedFiles) ? result.data.exportedFiles : [];
  return exportedFiles
    .map((item) => {
      if (typeof item === 'string') {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      }
      return item;
    })
    .map((item) => String(item?.path || '').trim())
    .filter(Boolean);
}

function normalizeComparePath(value) {
  return path.resolve(String(value || '')).replace(/\//g, '\\').toLowerCase();
}

function assertExactExportedPaths(label, actualPaths, expectedPaths) {
  const actual = (actualPaths || []).map(normalizeComparePath).sort();
  const expected = (expectedPaths || []).map(normalizeComparePath).sort();
  assert.deepStrictEqual(
    actual,
    expected,
    `${label} exported paths should match the independently computed expected files. actual=${asJson(actualPaths)} expected=${asJson(expectedPaths)}`
  );
}

function summarizeExportedPaths(paths) {
  return (paths || []).map((item) => ({
    fileName: path.basename(String(item || '')),
    path: redactPath(item)
  }));
}

function assertAutoLayoutPlansReady(label, plans, minPlacements) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error(`${label} did not return no-placeholder auto layout plans.`);
  }
  const blocked = plans.filter((plan) => {
    const placements = Number(plan?.placements || 0);
    const qa = plan?.autoLayoutQa;
    const qaBlockers = Array.isArray(qa?.blockers) ? qa.blockers : [];
    return plan?.status !== 'ready'
      || placements < minPlacements
      || (Array.isArray(plan?.blockers) && plan.blockers.length > 0)
      || !qa
      || qa.status !== 'ready'
      || qaBlockers.length > 0;
  });
  if (blocked.length > 0) {
    throw new Error(`${label} auto layout plan or post-execution QA not ready: ${asJson(blocked)}`);
  }
}

function hasUsableRect(value) {
  if (!value || typeof value !== 'object') return false;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!(width > 0) || !(height > 0)) return false;
  const hasXy = Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y));
  const hasEdges = Number.isFinite(Number(value.left))
    && Number.isFinite(Number(value.top))
    && Number.isFinite(Number(value.right))
    && Number.isFinite(Number(value.bottom));
  return hasXy || hasEdges;
}

function assertAutoLayoutQaActualSubjectBounds(label, plans) {
  const missing = [];
  for (const [planIndex, plan] of (Array.isArray(plans) ? plans : []).entries()) {
    const placements = Array.isArray(plan?.autoLayoutQa?.actualPlacements)
      ? plan.autoLayoutQa.actualPlacements
      : [];
    placements.forEach((placement, placementIndex) => {
      if (!hasUsableRect(placement?.actualSubjectBounds)) {
        missing.push({
          planIndex,
          placementIndex,
          itemId: placement?.itemId || '',
          name: placement?.name || '',
          actualSubjectBounds: placement?.actualSubjectBounds || null
        });
      }
    });
  }
  if (missing.length > 0) {
    throw new Error(`${label} post-execution QA is missing usable actualSubjectBounds: ${asJson(missing)}`);
  }
}

function assertAutoLayoutPlansReadyForScenarios(label, plans, scenarios) {
  if (!Array.isArray(plans) || plans.length < scenarios.length) {
    throw new Error(`${label} did not return enough no-placeholder auto layout plans. expected=${scenarios.length} actual=${Array.isArray(plans) ? plans.length : 0}`);
  }
  const blocked = scenarios.map((colors, index) => {
    const plan = plans[index];
    const expectedPlacements = Array.isArray(colors) ? colors.length : 0;
    const placements = Number(plan?.placements || 0);
    const qa = plan?.autoLayoutQa;
    const qaBlockers = Array.isArray(qa?.blockers) ? qa.blockers : [];
    const reasons = [];
    if (!plan) reasons.push('missing plan');
    if (plan?.status !== 'ready') reasons.push(`status=${plan?.status || 'missing'}`);
    if (placements < expectedPlacements) reasons.push(`placements=${placements} expected>=${expectedPlacements}`);
    if (Array.isArray(plan?.blockers) && plan.blockers.length > 0) reasons.push(`plan blockers=${plan.blockers.join('; ')}`);
    if (!qa) reasons.push('missing post-execution QA');
    if (qa && qa.status !== 'ready') reasons.push(`qa.status=${qa.status || 'missing'}`);
    if (qaBlockers.length > 0) reasons.push(`qa blockers=${qaBlockers.join('; ')}`);
    return reasons.length > 0 ? {
      index,
      expectedPlacements,
      colors,
      reasons,
      plan
    } : null;
  }).filter(Boolean);
  if (blocked.length > 0) {
    throw new Error(`${label} auto layout scenario matrix not ready: ${asJson(blocked)}`);
  }
  assertAutoLayoutQaActualSubjectBounds(label, plans);
}

function assertNoTemplateObstacleWarnings(label, plans) {
  const obstacleWarnings = (Array.isArray(plans) ? plans : [])
    .map((plan, index) => ({
      index,
      warnings: Array.isArray(plan?.warnings) ? plan.warnings : []
    }))
    .filter((entry) => entry.warnings.some((warning) => /模板中可见元素避让|template/i.test(String(warning || ''))));
  if (obstacleWarnings.length > 0) {
    throw new Error(`${label} should not treat legacy placeholder rectangles as template obstacles: ${asJson(obstacleWarnings)}`);
  }
}

async function createSkuSourceDocument(documentName) {
  const doc = await callPhotoshopToolStable('createDocument', {
    name: documentName,
    width: 2800,
    height: 900,
    resolution: 72,
    backgroundColor: 'transparent'
  });
  assertToolSuccess('create SKU document', doc);

  for (const [index, [name, color]] of LIVE_SKU_COLOR_SPECS.entries()) {
    const x = 80 + (index * 110);
    await callPhotoshopToolStable('switchDocument', { documentName });
    const body = await callPhotoshopToolStable('createRectangle', {
      name: `${name}-袜身`,
      x,
      y: 130,
      width: 92,
      height: 470,
      fillColorHex: color,
      cornerRadius: 22
    });
    assertToolSuccess(`create ${name} body`, body);
    const toe = await callPhotoshopToolStable('createRectangle', {
      name: `${name}-袜头`,
      x: x - 45,
      y: 520,
      width: 170,
      height: 92,
      fillColorHex: color,
      cornerRadius: 46
    });
    assertToolSuccess(`create ${name} toe`, toe);
    const group = await callPhotoshopToolStable('createGroup', {
      groupName: name,
      layerIds: [body.layerId, toe.layerId]
    });
    assertToolSuccess(`group ${name}`, group);
  }

  const listSets = await callPhotoshopToolStable('skuLayout', { action: 'listLayerSets' });
  assertToolSuccess('list SKU layer sets', listSets);
  if (Number(listSets?.data?.layerSetCount || 0) < LIVE_SKU_COLOR_SPECS.length) {
    throw new Error(`SKU source has too few color groups: ${asJson(listSets)}`);
  }

  return doc;
}

async function createLegacyRectangleTemplateDocument(documentName) {
  const doc = await callPhotoshopToolStable('createDocument', {
    name: documentName,
    width: 1600,
    height: 1100,
    resolution: 72,
    backgroundColor: 'white'
  });
  assertToolSuccess(`create legacy rectangle template ${documentName}`, doc);

  const firstRegion = await callPhotoshopToolStable('createRectangle', {
    name: '矩形 1',
    x: 90,
    y: 120,
    width: 650,
    height: 860,
    fillColorHex: '#F1F1F1',
    cornerRadius: 24
  });
  assertToolSuccess(`create legacy rectangle one ${documentName}`, firstRegion);
  const secondRegion = await callPhotoshopToolStable('createRectangle', {
    name: '矩形 2',
    x: 860,
    y: 120,
    width: 650,
    height: 860,
    fillColorHex: '#F1F1F1',
    cornerRadius: 24
  });
  assertToolSuccess(`create legacy rectangle two ${documentName}`, secondRegion);
  return doc;
}

async function createTemplateDocument(documentName, noteMode = false) {
  const doc = await callPhotoshopToolStable('createDocument', {
    name: documentName,
    width: noteMode ? 1200 : 1600,
    height: noteMode ? 900 : 1100,
    resolution: 72,
    backgroundColor: 'white'
  });
  assertToolSuccess(`create template ${documentName}`, doc);

  const title = await callPhotoshopToolStable('createTextLayer', {
    name: noteMode ? '自选备注标题障碍' : 'SKU标题障碍',
    content: noteMode ? '自选备注' : 'NO PLACEHOLDER SKU',
    x: 90,
    y: 80,
    fontSize: 52,
    colorHex: '#222222'
  });
  assertToolSuccess(`create title ${documentName}`, title);
  const logo = await callPhotoshopToolStable('createRectangle', {
    name: noteMode ? '备注LOGO障碍' : 'LOGO障碍',
    x: noteMode ? 860 : 1180,
    y: 70,
    width: 230,
    height: 96,
    fillColorHex: '#EDEDED',
    cornerRadius: 22
  });
  assertToolSuccess(`create logo obstacle ${documentName}`, logo);
  const footer = await callPhotoshopToolStable('createTextLayer', {
    name: noteMode ? '备注底部文案障碍' : '底部文案障碍',
    content: '自然光影 / 自动避让',
    x: 90,
    y: noteMode ? 805 : 990,
    fontSize: 34,
    colorHex: '#555555'
  });
  assertToolSuccess(`create footer ${documentName}`, footer);
  return doc;
}

async function closeDisposableDocuments() {
  const docs = await callPhotoshopToolStable('listDocuments', { includeDetails: false }).catch(() => null);
  const documents = Array.isArray(docs?.documents) ? docs.documents : [];
  const closed = [];
  const errors = [];
  for (const doc of documents) {
    if (!String(doc?.name || '').startsWith(PREFIX)) continue;
    const result = await callPhotoshopToolStable('closeDocument', {
      documentId: doc.id,
      save: false
    }).catch((error) => ({ success: false, error: error.message || String(error) }));
    if (result?.success) closed.push(doc.name);
    else errors.push({ name: doc.name, error: result?.error || 'close failed' });
  }
  return { closed, errors };
}

async function probeExports(paths) {
  const resourceManager = new ResourceManagerService();
  const probes = [];
  for (const exportedPath of paths) {
    probes.push(await resourceManager.probeImageFile(exportedPath));
  }
  return probes;
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  const safeReport = sanitizeForReport(report);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(safeReport, null, 2), 'utf8');
  const lines = [
    '# SKU No-placeholder Live Acceptance',
    '',
    `status: ${safeReport.status}`,
    `executed: ${safeReport.executed}`,
    `comboExportCount: ${safeReport.combo?.exportedFiles?.length || 0}`,
    `noteExportCount: ${safeReport.note?.exportedFiles?.length || 0}`,
    `legacyRectangleExportCount: ${safeReport.legacyRectangle?.exportedFiles?.length || 0}`,
    `comboScenarioCounts: ${(safeReport.combo?.scenarioCounts || []).join(', ') || 'none'}`,
    `noteScenarioCounts: ${(safeReport.note?.scenarioCounts || []).join(', ') || 'none'}`,
    `legacyRectangleScenarioCounts: ${(safeReport.legacyRectangle?.scenarioCounts || []).join(', ') || 'none'}`,
    '',
    '## Boundaries',
    '',
    `- writesPhotoshop: ${safeReport.boundaries.writesPhotoshop}`,
    `- disposableOnly: ${safeReport.boundaries.disposableOnly}`,
    `- claimsDesignQuality: ${safeReport.boundaries.claimsDesignQuality}`,
    '',
    '## Blockers',
    '',
    ...(safeReport.blockers?.length ? safeReport.blockers.map((item) => `- ${item}`) : ['- none'])
  ];
  fs.writeFileSync(REPORT_MD, `${lines.join('\n')}\n`, 'utf8');
  return safeReport;
}

async function runLive() {
  ensureDir(OUTPUT_DIR);
  const blockers = [];
  const photoshopTools = await getPhotoshopTools();
  const toolNames = photoshopTools.map((tool) => String(tool?.name || '').trim()).filter(Boolean).sort();
  const missingTools = REQUIRED_TOOLS.filter((toolName) => !toolNames.includes(toolName));
  if (missingTools.length > 0) {
    blockers.push(`Missing Photoshop tools: ${missingTools.join(', ')}`);
    return { status: 'blocked_missing_tools', executed: false, blockers, toolNames };
  }
  const runtimeSchemaBlockers = buildRuntimeSchemaBlockers(photoshopTools);
  if (runtimeSchemaBlockers.length > 0) {
    return {
      status: 'blocked_stale_uxp_runtime_schema',
      executed: false,
      blockers: runtimeSchemaBlockers,
      runtimeSchema: {
        skuLayoutProperties: Object.keys(getToolSchemaProperties(photoshopTools, 'skuLayout')).sort(),
        requiredProperties: ['autoLayoutWithoutPlaceholders']
      },
      recoveryActions: [
        '在 UXP Developer Tool 中 Reload DesignEcho 插件，确认 Photoshop 面板重新连接。',
        '如果 Reload 后 schema 仍旧，重启 Photoshop 并重新打开 DesignEcho UXP 插件。',
        '重新运行 npm run maintenance:photoshop-bridge-health:check 和本 no-placeholder live 验证。'
      ]
    };
  }
  const runtimeCapabilities = await getSkuLayoutCapabilities();
  const runtimeCapabilityBlockers = buildRuntimeCapabilityBlockers(runtimeCapabilities);
  if (runtimeCapabilityBlockers.length > 0) {
    return {
      status: 'blocked_stale_uxp_runtime_capability',
      executed: false,
      blockers: runtimeCapabilityBlockers,
      runtimeCapability: {
        success: runtimeCapabilities?.success === true,
        schema: runtimeCapabilities?.data?.schema,
        supportsNoPlaceholderAutoLayout: runtimeCapabilities?.data?.supportsNoPlaceholderAutoLayout === true,
        actions: normalizeCapabilityActions(runtimeCapabilities?.data?.actions),
        noPlaceholderRevision: runtimeCapabilities?.data?.noPlaceholderAutoLayout?.revision,
        returnsActualSubjectBoundsQa: runtimeCapabilities?.data?.noPlaceholderAutoLayout?.returnsActualSubjectBoundsQa === true,
        noPlaceholderActions: normalizeCapabilityActions(runtimeCapabilities?.data?.noPlaceholderAutoLayout?.actions),
        supportsRecursiveSkuLayerSets: runtimeCapabilities?.data?.supportsRecursiveSkuLayerSets === true,
        skuSourceColorGroupsRevision: runtimeCapabilities?.data?.skuSourceColorGroups?.revision,
        recursiveLayerSets: runtimeCapabilities?.data?.skuSourceColorGroups?.recursiveLayerSets === true,
        canResolveNestedColorGroups: runtimeCapabilities?.data?.skuSourceColorGroups?.canResolveNestedColorGroups === true,
        returnsLayerSetPaths: runtimeCapabilities?.data?.skuSourceColorGroups?.returnsLayerSetPaths === true,
        skuSourceColorGroupActions: normalizeCapabilityActions(runtimeCapabilities?.data?.skuSourceColorGroups?.actions)
      },
      recoveryActions: [
        '在 UXP Developer Tool 中 Reload DesignEcho 插件，确认 Photoshop 面板重新连接。',
        '如果 schema 已更新但 getCapabilities 仍失败，重新构建 UXP 后再 Reload 插件。',
        '重新运行本 no-placeholder live 验证，确认 capability 通过后再创建 disposable 文档。'
      ]
    };
  }

  const skuDocName = `${PREFIX}-SKU`;
  const comboTemplateName = `${PREFIX}-ComboTemplate`;
  const noteTemplateName = `${PREFIX}-NoteTemplate`;
  const legacyTemplateName = `${PREFIX}-LegacyRectTemplate`;
  let comboResult = null;
  let noteResult = null;
  let legacyResult = null;
  let finalAcceptanceSnapshot = null;
  let cleanup = null;
  let liveSummary = null;
  const comboScenarios = buildComboMatrix();
  const noteScenarios = buildNoteMatrix();
  const legacyScenarios = [buildColorNames(8)];

  try {
    await createSkuSourceDocument(skuDocName);
    await createTemplateDocument(comboTemplateName, false);
    comboResult = await callPhotoshopToolStable('skuLayout', {
      action: 'execute',
      skuDocName,
      templateDocName: comboTemplateName,
      combos: comboScenarios,
      autoLayoutWithoutPlaceholders: true,
      outputDir: OUTPUT_DIR,
      outputFormat: 'jpg',
      quality: 10
    }, { timeoutMs: 180_000, attempts: 8 });
    assertToolSuccess('no-placeholder combo skuLayout', comboResult);
    assertAutoLayoutPlansReadyForScenarios('combo skuLayout', comboResult?.data?.autoLayoutPlans, comboScenarios);

    await createTemplateDocument(noteTemplateName, true);
    noteResult = await callPhotoshopToolStable('skuLayout', {
      action: 'arrangeDynamic',
      skuDocName,
      templateDocName: noteTemplateName,
      combos: noteScenarios,
      autoLayoutWithoutPlaceholders: true,
      outputDir: OUTPUT_DIR,
      outputFormat: 'jpg',
      quality: 10,
      noteFilePrefix: '自选备注-no-placeholder'
    }, { timeoutMs: 180_000, attempts: 8 });
    assertToolSuccess('no-placeholder note skuLayout', noteResult);
    assertAutoLayoutPlansReadyForScenarios('note skuLayout', noteResult?.data?.noteAutoLayoutPlans, noteScenarios);

    await createLegacyRectangleTemplateDocument(legacyTemplateName);
    legacyResult = await callPhotoshopToolStable('skuLayout', {
      action: 'execute',
      skuDocName,
      templateDocName: legacyTemplateName,
      combos: legacyScenarios,
      autoLayoutWithoutPlaceholders: true,
      outputDir: OUTPUT_DIR,
      outputFormat: 'jpg',
      quality: 10
    }, { timeoutMs: 180_000, attempts: 8 });
    assertToolSuccess('no-placeholder legacy rectangle skuLayout', legacyResult);
    assertAutoLayoutPlansReadyForScenarios('legacy rectangle skuLayout', legacyResult?.data?.autoLayoutPlans, legacyScenarios);
    assertNoTemplateObstacleWarnings('legacy rectangle skuLayout', legacyResult?.data?.autoLayoutPlans);

    const expectedComboPaths = comboScenarios.map((colors, index) => (
      path.join(OUTPUT_DIR, comboTemplateName, `${index + 1}${colors.join('+')}.jpg`)
    ));
    const expectedNotePaths = noteScenarios.map((_colors, index) => (
      path.join(OUTPUT_DIR, noteTemplateName, index === 0 ? '自选备注-no-placeholder.jpg' : `自选备注-no-placeholder-${index + 1}.jpg`)
    ));
    const expectedLegacyPaths = legacyScenarios.map((colors, index) => (
      path.join(OUTPUT_DIR, legacyTemplateName, `${index + 1}${colors.join('+')}.jpg`)
    ));
    const expectedExportPaths = [...expectedComboPaths, ...expectedNotePaths, ...expectedLegacyPaths];
    const comboPaths = extractExportedPaths(comboResult);
    const notePaths = extractExportedPaths(noteResult);
    const legacyPaths = extractExportedPaths(legacyResult);
    assertExactExportedPaths('combo no-placeholder SKU', comboPaths, expectedComboPaths);
    assertExactExportedPaths('note no-placeholder SKU', notePaths, expectedNotePaths);
    assertExactExportedPaths('legacy rectangle no-placeholder SKU', legacyPaths, expectedLegacyPaths);
    const probes = await probeExports(expectedExportPaths);
    const readback = buildSkuExportReadback({
      expectedExportPaths,
      fileProbes: probes
    });
    if (readback.fileProbeCount !== expectedExportPaths.length || readback.okFileProbeCount !== expectedExportPaths.length) {
      blockers.push(`Export readback count mismatch: expected ${expectedExportPaths.length}, got ${readback.okFileProbeCount}/${readback.fileProbeCount}.`);
    }
    if (readback.status !== 'ready_for_review') {
      blockers.push(`Export readback not ready: ${(readback.blockers || []).join('; ')}`);
    }

    finalAcceptanceSnapshot = await callPhotoshopToolStable('getAcceptanceSnapshot', {}, {
      timeoutMs: 25_000,
      attempts: 4
    }).catch((error) => ({ success: false, error: error.message || String(error) }));

    liveSummary = {
      status: blockers.length > 0 ? 'completed_with_blockers' : 'ready_for_manual_review',
      executed: true,
      blockers,
      combo: {
        scenarioCounts: comboScenarios.map((colors) => colors.length),
        exportedFiles: summarizeExportedPaths(comboPaths),
        expectedExportedFiles: summarizeExportedPaths(expectedComboPaths),
        autoLayoutPlans: comboResult?.data?.autoLayoutPlans || []
      },
      note: {
        scenarioCounts: noteScenarios.map((colors) => colors.length),
        exportedFiles: summarizeExportedPaths(notePaths),
        expectedExportedFiles: summarizeExportedPaths(expectedNotePaths),
        noteAutoLayoutPlans: noteResult?.data?.noteAutoLayoutPlans || []
      },
      legacyRectangle: {
        scenarioCounts: legacyScenarios.map((colors) => colors.length),
        exportedFiles: summarizeExportedPaths(legacyPaths),
        expectedExportedFiles: summarizeExportedPaths(expectedLegacyPaths),
        autoLayoutPlans: legacyResult?.data?.autoLayoutPlans || []
      },
      readback,
      finalAcceptanceSnapshot
    };
    return liveSummary;
  } finally {
    cleanup = await closeDisposableDocuments();
    if (liveSummary) {
      liveSummary.cleanup = cleanup;
      if (cleanup?.errors?.length) {
        liveSummary.status = liveSummary.status === 'ready_for_manual_review' ? 'completed_with_blockers' : liveSummary.status;
        liveSummary.blockers.push(`临时 Photoshop 文档清理失败 ${cleanup.errors.length} 个。`);
      }
    }
    if (cleanup?.errors?.length) {
      console.warn('[sku-no-placeholder-live] cleanup errors:', cleanup.errors);
    }
  }
}

function runSelfTest() {
  const scriptSource = fs.readFileSync(__filename, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const validateSource = fs.readFileSync(path.join(ROOT, 'scripts', 'validate-maintenance-hygiene.cjs'), 'utf8');
  const boundarySource = fs.readFileSync(path.join(ROOT, 'scripts', 'report-change-boundaries.cjs'), 'utf8');
  const scriptName = 'smoke-sku-no-placeholder-live-acceptance.cjs';

  assert(REQUIRED_TOOLS.includes('switchDocument'), 'required tool list should include switchDocument used by disposable source creation');
  assert(scriptSource.includes('DESIGNECHO_LIVE_SKU_NO_PLACEHOLDER_ACCEPTANCE'), 'live flag should be explicit');
  assert(scriptSource.includes('DESIGNECHO_LIVE_SKU_NO_PLACEHOLDER_TAKEOVER'), 'takeover flag should be explicit');
  assert(scriptSource.includes('safe_skip'), 'default run should stay safe-skip without live flags');
  assert(scriptSource.includes('autoLayoutWithoutPlaceholders: true'), 'live run must exercise no-placeholder skuLayout mode');
  assert(scriptSource.includes('buildRuntimeSchemaBlockers'), 'live run must preflight runtime skuLayout schema before Photoshop writes');
  assert(scriptSource.includes('buildRuntimeCapabilityBlockers'), 'live run must preflight skuLayout runtime capabilities before disposable Photoshop writes');
  assert(scriptSource.includes(REQUIRED_RECURSIVE_SKU_COLOR_GROUPS_REVISION), 'live run must require recursive SKU color-group runtime capabilities before disposable Photoshop writes');
  assert(scriptSource.includes('blocked_stale_uxp_runtime_schema'), 'stale UXP runtime schema should have a distinct blocked status');
  assert(scriptSource.includes('blocked_stale_uxp_runtime_capability'), 'stale UXP runtime capability should have a distinct blocked status');
  assert(scriptSource.includes('assertAutoLayoutPlansReady'), 'live run must assert no-placeholder planner readiness');
  assert(scriptSource.includes('assertAutoLayoutPlansReadyForScenarios'), 'live run must assert no-placeholder planner readiness per scenario count');
  assert(scriptSource.includes('assertAutoLayoutQaActualSubjectBounds'), 'live run must assert actual subject bounds in post-execution QA');
  assert(scriptSource.includes('COMBO_MATRIX_COUNTS'), 'live run must cover a combination-count matrix instead of a single happy path');
  assert(scriptSource.includes('NOTE_MATRIX_COUNTS'), 'live run must cover at least one high-density self-select note scenario');
  assert(scriptSource.includes('createLegacyRectangleTemplateDocument'), 'live run must include a legacy rectangle placeholder runtime classification scenario');
  assert(scriptSource.includes('assertNoTemplateObstacleWarnings'), 'live run must fail if legacy placeholder rectangles are still treated as template obstacles');
  assert(scriptSource.includes('assertExactExportedPaths'), 'live run must compare actual exports against independently computed expected paths');
  assert(scriptSource.includes('expectedExportPaths'), 'live readback must use expected paths that are independent from skuLayout returned exportedFiles');
  assert(scriptSource.includes('readback.fileProbeCount !== expectedExportPaths.length'), 'live readback must fail count mismatches instead of trusting returned exportedFiles');
  assert(scriptSource.includes("qa.status !== 'ready'"), 'live run must assert nested post-execution autoLayoutQa readiness');
  assert.throws(
    () => assertAutoLayoutPlansReady('missing QA sample', [{ status: 'ready', placements: 2, blockers: [] }], 2),
    /post-execution QA not ready/,
    'live readiness should reject plans that do not include post-execution QA.'
  );
  assert.doesNotThrow(
    () => assertAutoLayoutPlansReady('ready QA sample', [{
      status: 'ready',
      placements: 2,
      blockers: [],
      autoLayoutQa: { status: 'ready', blockers: [] }
    }], 2),
    'live readiness should accept ready plans with ready post-execution QA.'
  );
  assert.doesNotThrow(
    () => assertAutoLayoutPlansReadyForScenarios(
      'ready matrix sample',
      [
        {
          status: 'ready',
          placements: 1,
          blockers: [],
          autoLayoutQa: {
            status: 'ready',
            blockers: [],
            actualPlacements: [{ itemId: '白色', name: '白色', actualSubjectBounds: { x: 10, y: 10, width: 100, height: 200 } }]
          }
        },
        {
          status: 'ready',
          placements: 4,
          blockers: [],
          autoLayoutQa: {
            status: 'ready',
            blockers: [],
            actualPlacements: [
              { itemId: '白色', name: '白色', actualSubjectBounds: { x: 10, y: 10, width: 80, height: 180 } },
              { itemId: '浅灰', name: '浅灰', actualSubjectBounds: { x: 100, y: 10, width: 80, height: 180 } },
              { itemId: '深灰', name: '深灰', actualSubjectBounds: { x: 190, y: 10, width: 80, height: 180 } },
              { itemId: '黑色', name: '黑色', actualSubjectBounds: { x: 280, y: 10, width: 80, height: 180 } }
            ]
          }
        }
      ],
      [['白色'], ['白色', '浅灰', '深灰', '黑色']]
    ),
    'scenario readiness should accept per-scenario placement counts.'
  );
  assert.throws(
    () => assertAutoLayoutPlansReadyForScenarios(
      'missing matrix plan sample',
      [{ status: 'ready', placements: 1, blockers: [], autoLayoutQa: { status: 'ready', blockers: [] } }],
      [['白色'], ['白色', '浅灰']]
    ),
    /not return enough/,
    'scenario readiness should reject missing per-scenario plans.'
  );
  assert.throws(
    () => assertAutoLayoutPlansReadyForScenarios(
      'short placement sample',
      [{ status: 'ready', placements: 1, blockers: [], autoLayoutQa: { status: 'ready', blockers: [] } }],
      [['白色', '浅灰']]
    ),
    /scenario matrix not ready/,
    'scenario readiness should reject a plan that places fewer items than the scenario requires.'
  );
  assert.doesNotThrow(
    () => assertAutoLayoutPlansReadyForScenarios(
      'subject bounds ready sample',
      [{
        status: 'ready',
        placements: 1,
        blockers: [],
        autoLayoutQa: {
          status: 'ready',
          blockers: [],
          actualPlacements: [{
            itemId: '白色',
            name: '白色',
            actualSubjectBounds: { x: 10, y: 10, width: 100, height: 200 }
          }]
        }
      }],
      [['白色']]
    ),
    'scenario readiness should accept QA placements that expose usable actualSubjectBounds.'
  );
  assert.throws(
    () => assertAutoLayoutPlansReadyForScenarios(
      'subject bounds missing sample',
      [{
        status: 'ready',
        placements: 1,
        blockers: [],
        autoLayoutQa: {
          status: 'ready',
          blockers: [],
          actualPlacements: [{ itemId: '白色', name: '白色', actualSubjectBounds: null }]
        }
      }],
      [['白色']]
    ),
    /actualSubjectBounds/,
    'scenario readiness should reject QA placements that do not expose actualSubjectBounds.'
  );
  assert.doesNotThrow(
    () => assertNoTemplateObstacleWarnings('legacy warning clean sample', [{ warnings: [] }]),
    'legacy rectangle warning guard should accept plans without template-obstacle warnings.'
  );
  assert.throws(
    () => assertNoTemplateObstacleWarnings('legacy warning blocked sample', [{ warnings: ['已根据模板中可见元素避让生成排版区域'] }]),
    /legacy placeholder rectangles/,
    'legacy rectangle warning guard should reject stale runtimes that treat old placeholders as obstacles.'
  );
  assert.doesNotThrow(
    () => assertExactExportedPaths(
      'same paths sample',
      [path.join(OUTPUT_DIR, 'A', '1白色+黑色.jpg')],
      [path.join(OUTPUT_DIR, 'A', '1白色+黑色.jpg')]
    ),
    'independent export path matcher should accept identical expected output files.'
  );
  assert.throws(
    () => assertExactExportedPaths(
      'missing path sample',
      [path.join(OUTPUT_DIR, 'A', '1白色+黑色.jpg')],
      [path.join(OUTPUT_DIR, 'A', '1白色+黑色.jpg'), path.join(OUTPUT_DIR, 'B', '自选备注.jpg')]
    ),
    /independently computed expected files/,
    'live acceptance should fail when returned exports are fewer than the independently expected files.'
  );
  assert(
    buildRuntimeSchemaBlockers([{ name: 'skuLayout', inputSchema: { properties: {} } }]).length > 0,
    'runtime schema guard should block skuLayout without autoLayoutWithoutPlaceholders'
  );
  assert.deepStrictEqual(
    buildRuntimeSchemaBlockers([{ name: 'skuLayout', inputSchema: { properties: { autoLayoutWithoutPlaceholders: { type: 'boolean' } } } }]),
    [],
    'runtime schema guard should pass when skuLayout exposes autoLayoutWithoutPlaceholders'
  );
  assert(
    buildRuntimeCapabilityBlockers({ success: false, error: '未知操作: getCapabilities' }).length > 0,
    'runtime capability guard should block old skuLayout runtime without getCapabilities'
  );
  assert(
    buildRuntimeCapabilityBlockers({
      success: true,
      data: {
        schema: 'sku-layout-capabilities/v0',
        supportsNoPlaceholderAutoLayout: true,
        actions: ['getCapabilities', 'execute', 'arrangeDynamic'],
        noPlaceholderAutoLayout: {
          actions: ['execute', 'arrangeDynamic']
        }
      }
    }).length > 0,
    'runtime capability guard should block no-placeholder capability declarations without the current revision and subject-bounds QA flag'
  );
  assert(
    buildRuntimeCapabilityBlockers({
      success: true,
      data: {
        schema: 'sku-layout-capabilities/v0',
        supportsNoPlaceholderAutoLayout: true,
        actions: ['getCapabilities', 'execute', 'arrangeDynamic'],
        noPlaceholderAutoLayout: {
          actions: ['execute', 'arrangeDynamic'],
          revision: REQUIRED_NO_PLACEHOLDER_REVISION,
          returnsActualSubjectBoundsQa: true
        }
      }
    }).some((blocker) => blocker.includes('supportsRecursiveSkuLayerSets')),
    'runtime capability guard should distinguish stale UXP runtimes that lack recursive SKU color-group discovery'
  );
  assert.deepStrictEqual(
    buildRuntimeCapabilityBlockers({
      success: true,
      data: {
        schema: 'sku-layout-capabilities/v0',
        supportsNoPlaceholderAutoLayout: true,
        supportsRecursiveSkuLayerSets: true,
        actions: ['getCapabilities', 'execute', 'arrangeDynamic'],
        noPlaceholderAutoLayout: {
          actions: ['execute', 'arrangeDynamic'],
          revision: REQUIRED_NO_PLACEHOLDER_REVISION,
          returnsActualSubjectBoundsQa: true
        },
        skuSourceColorGroups: {
          revision: REQUIRED_RECURSIVE_SKU_COLOR_GROUPS_REVISION,
          actions: ['listLayerSets', 'copyLayerSetToTemplate', 'execute', 'arrangeDynamic'],
          recursiveLayerSets: true,
          canResolveNestedColorGroups: true,
          returnsLayerSetPaths: true
        }
      }
    }),
    [],
    'runtime capability guard should pass when skuLayout exposes no-placeholder and recursive SKU color-group capabilities'
  );
  assert.deepStrictEqual(buildComboMatrix().map((colors) => colors.length), COMBO_MATRIX_COUNTS, 'combo matrix should preserve requested count coverage');
  assert.deepStrictEqual(buildNoteMatrix().map((colors) => colors.length), NOTE_MATRIX_COUNTS, 'note matrix should preserve requested count coverage');
  assert(Math.max(...COMBO_MATRIX_COUNTS) >= 15, 'combo matrix should include a dense 15-item scenario');
  assert(Math.max(...NOTE_MATRIX_COUNTS) >= 18, 'note matrix should include a high-density self-select scenario');
  const selfTestStart = scriptSource.indexOf('function runSelfTest()');
  const mainStart = scriptSource.lastIndexOf('async function main');
  const runtimeSource = selfTestStart >= 0 && mainStart > selfTestStart
    ? `${scriptSource.slice(0, selfTestStart)}${scriptSource.slice(mainStart)}`
    : scriptSource;
  assert(!/confidence|置信/.test(runtimeSource), 'runtime path must not introduce unsupported score fields');

  assert(
    packageJson.scripts['smoke:sku:no-placeholder-live-acceptance'],
    'package.json should expose smoke:sku:no-placeholder-live-acceptance'
  );
  assert(
    packageJson.scripts['smoke:sku:no-placeholder-live-acceptance:self-test'],
    'package.json should expose smoke:sku:no-placeholder-live-acceptance:self-test'
  );
  assert(
    String(packageJson.scripts['maintenance:preflight'] || '').includes('smoke:sku:no-placeholder-live-acceptance'),
    'maintenance:preflight should include safe-skip no-placeholder live smoke'
  );
  assert(validateSource.includes(scriptName), 'maintenance hygiene should node --check the no-placeholder live smoke');
  assert(boundarySource.includes('no-placeholder-live-acceptance'), 'change-boundary matcher should classify no-placeholder live smoke');

  const unsafeReport = {
    reportJson: REPORT_JSON,
    exportedPaths: [path.join(OUTPUT_DIR, 'demo.jpg')],
    nested: { path: path.join(OUTPUT_DIR, 'nested.jpg'), payload: 'data:image/png;base64,AAAA' }
  };
  const safeReport = sanitizeForReport(unsafeReport);
  assert(!JSON.stringify(safeReport).includes(ROOT), 'report sanitizer must redact local absolute paths');
  assert(!/data:image\/|base64/i.test(JSON.stringify(safeReport)), 'report sanitizer must redact raw/base64 payload markers');

  console.log(JSON.stringify({
    success: true,
    schema: 'sku-no-placeholder-live-acceptance-self-test/v0',
    script: scriptName
  }, null, 2));
}

async function main() {
  if (ARGS.has('--self-test')) {
    runSelfTest();
    return;
  }

  const liveEnabled = process.env[LIVE_FLAG] === '1';
  const takeoverEnabled = process.env[TAKEOVER_FLAG] === '1';
  const report = {
    schema: 'sku-no-placeholder-live-acceptance/v0',
    status: 'safe_skip',
    executed: false,
    blockers: [],
    reportJson: toReportPath(REPORT_JSON),
    reportMd: toReportPath(REPORT_MD),
    boundaries: {
      writesPhotoshop: liveEnabled && takeoverEnabled,
      disposableOnly: true,
      writesProjectDocuments: false,
      claimsDesignQuality: false
    }
  };

  if (!liveEnabled || !takeoverEnabled) {
    report.blockers.push(`Set ${LIVE_FLAG}=1 and ${TAKEOVER_FLAG}=1 to run disposable live Photoshop validation.`);
    console.log(JSON.stringify(writeReport(report), null, 2));
    return;
  }

  try {
    const liveReport = await runLive();
    Object.assign(report, liveReport);
  } catch (error) {
    report.status = 'failed';
    report.executed = true;
    report.blockers.push(error?.message || String(error));
  }

  const safeReport = writeReport(report);
  console.log(JSON.stringify({
    success: report.status === 'ready_for_manual_review',
    status: report.status,
    executed: report.executed,
    reportJson: safeReport.reportJson,
    reportMd: safeReport.reportMd,
    blockers: safeReport.blockers
  }, null, 2));

  if (report.status !== 'ready_for_manual_review') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
