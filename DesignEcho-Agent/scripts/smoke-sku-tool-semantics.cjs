#!/usr/bin/env node

/**
 * SKU 工具语义与占位不匹配错误结构化钉桩
 *
 * 钉住四件事：
 * 1. photoshop-tool-semantics 存在 skuLayout / createSkuPlaceholders / sockLayoutConfig / openTemplate
 *    四条目，且 skuLayout 条目携带四种占位模式词汇表、先 inspectTemplateLayout 纪律与显式区域容量计划。
 * 2. UXP sku-layout-tool 的两处占位不匹配错误已结构化：错误对象携带
 *    mode/slotCount/requiredCount/combo/templateDocName + resolutions 三条具名出路，
 *    且两个 catch 出口把结构化数据回传到 ToolResult.data。
 * 3. tool-schemas 的 skuLayout / createSkuPlaceholders 描述写明两套占位方法。
 * 4. 结构化字段能透传到模型可见结果：中间层（UXP MCP 协议 → 渲染进程 MCP 客户端 →
 *    executeToolCall 失败规整 → Agent 循环 sanitizeToolOutputForModel → provider 适配器）
 *    不得剥掉 data.placeholderMismatch(es)。其中 sanitizeToolOutputForModel 用真实实现做
 *    可执行回归（单组合/批量两种失败形状逐字段核对），其余序列化位点做源码钉桩。
 *
 * 建议在 package.json 登记（本脚本不改 package.json）：
 *   "smoke:sku-tool-semantics": "node scripts/smoke-sku-tool-semantics.cjs"
 */

const path = require('path');
const fs = require('fs');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  getPhotoshopToolSemanticById,
  getPhotoshopToolSemanticsByTool
} = require('../src/shared/photoshop-tool-semantics.ts');

const {
  generateToolSchemas
} = require('../src/renderer/services/agent-runtime/tool-schemas.ts');

const {
  sanitizeToolOutputForModel
} = require('../src/renderer/services/agent-runtime/tool-result-sanitizer.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function flattenSemanticText(entry) {
  return [
    ...entry.designSemantics,
    ...entry.commonFailureModes,
    ...entry.parameters.flatMap((p) => [p.meaning, ...p.failureModes]),
    ...entry.acceptance.checks,
    ...entry.acceptance.pass,
    ...entry.acceptance.needsReview,
    ...entry.acceptance.fail
  ].join('\n');
}

function assertEntryCompleteness(entry) {
  assert(entry.parameters.length > 0, `${entry.id} should define parameters.`);
  assert(entry.commonFailureModes.length > 0, `${entry.id} should define failure modes.`);
  assert(entry.acceptance.checks.length > 0, `${entry.id} should define acceptance checks.`);
  assert(entry.acceptance.pass.length > 0, `${entry.id} should define pass criteria.`);
  assert(entry.acceptance.needsReview.length > 0, `${entry.id} should define needs_review criteria.`);
  assert(entry.acceptance.fail.length > 0, `${entry.id} should define fail criteria.`);
  assert(entry.benchmarkNeeds.length > 0, `${entry.id} should define benchmark needs.`);
  assert(entry.notSolvedByThis.length > 0, `${entry.id} should define boundaries.`);
}

function checkSemantics() {
  const toolToId = {
    skuLayout: 'sku-template-layout',
    createSkuPlaceholders: 'sku-placeholder-authoring',
    sockLayoutConfig: 'sku-combo-config-parse',
    openTemplate: 'template-document-open'
  };

  for (const [tool, id] of Object.entries(toolToId)) {
    const byTool = getPhotoshopToolSemanticsByTool(tool);
    assert(byTool.length > 0, `Tool lookup returned no semantic entries for ${tool}.`);
    assert(byTool.some((item) => item.id === id), `${tool} semantics should resolve to entry ${id}.`);
    const entry = getPhotoshopToolSemanticById(id);
    assert(entry, `Missing semantic entry ${id}.`);
    assertEntryCompleteness(entry);
  }

  const skuLayoutEntry = getPhotoshopToolSemanticById('sku-template-layout');
  const skuLayoutText = flattenSemanticText(skuLayoutEntry);
  for (const mode of ['ordered_slots', 'legacy_single_region', 'legacy_multi_regions', 'none']) {
    assert(skuLayoutText.includes(mode), `skuLayout semantics must include placement mode vocabulary: ${mode}.`);
  }
  assert(skuLayoutText.includes('inspectTemplateLayout'), 'skuLayout semantics must require inspectTemplateLayout before writes.');
  assert(skuLayoutText.includes('createSkuPlaceholders'), 'skuLayout mismatch resolutions must name createSkuPlaceholders (补槽).');
  assert(skuLayoutText.includes('openTemplate'), 'skuLayout mismatch resolutions must name openTemplate (换模板).');
  assert(/单区域|单参考区域/.test(skuLayoutText), 'skuLayout mismatch resolutions must mention single-region mode.');
  assert(skuLayoutText.includes('requiredCount'), 'skuLayout semantics must describe structured mismatch data fields.');
  assert(skuLayoutText.includes('regionCapacities'), 'skuLayout semantics must require explicit region capacities for 6.0 templates.');
  assert(skuLayoutText.includes('4 双装上 3 下 1'), 'skuLayout semantics must include the 4-pair [3,1] benchmark case.');

  const placeholderEntry = getPhotoshopToolSemanticById('sku-placeholder-authoring');
  const placeholderText = flattenSemanticText(placeholderEntry);
  assert(placeholderText.includes('ordered_slots'), 'createSkuPlaceholders semantics must describe ordered slots.');
  assert(placeholderText.includes('region_composition'), 'createSkuPlaceholders semantics must describe region composition.');
  assert(placeholderText.includes('transformLayer'), 'placeholder adjustment must reuse transformLayer instead of creating parallel placeholders.');

  const comboEntry = getPhotoshopToolSemanticById('sku-combo-config-parse');
  const comboText = flattenSemanticText(comboEntry);
  assert(comboText.includes('每行一组'), 'sockLayoutConfig semantics must pin the one-combo-per-line contract.');
  assert(/整段.*一个(超长)?组合|一个组合/.test(comboText), 'sockLayoutConfig semantics must warn against parsing a whole paragraph as one combo.');

  const openEntry = getPhotoshopToolSemanticById('template-document-open');
  const openText = flattenSemanticText(openEntry);
  assert(openText.includes('documentName'), 'openTemplate semantics must require reading result documentName.');
  assert(openText.includes('templateDocName'), 'openTemplate semantics must link documentName to later templateDocName usage.');

  return Object.values(toolToId);
}

function checkToolSchemaDescriptions() {
  const schemas = generateToolSchemas();
  const byName = new Map(schemas.map((item) => [item.name, item]));

  const skuLayout = byName.get('skuLayout');
  assert(skuLayout, 'Missing Agent-visible tool schema for skuLayout.');
  assert(skuLayout.description.includes('inspectTemplateLayout'), 'skuLayout description must direct to inspectTemplateLayout first.');
  assert(skuLayout.description.includes('ordered_slots'), 'skuLayout description must mention the ordered slots placement method.');
  assert(skuLayout.description.includes('legacy_single_region'), 'skuLayout description must mention the single reference region placement method.');
  assert(skuLayout.description.includes('regionCapacities'), 'skuLayout description must mention explicit region capacities.');

  const createPlaceholders = byName.get('createSkuPlaceholders');
  assert(createPlaceholders, 'Missing Agent-visible tool schema for createSkuPlaceholders.');
  assert(createPlaceholders.description.includes('ordered_slots'), 'createSkuPlaceholders description must mention ordered_slots.');
  assert(createPlaceholders.description.includes('region_composition'), 'createSkuPlaceholders description must mention region_composition.');
  assert(createPlaceholders.description.includes('transformLayer'), 'createSkuPlaceholders description must direct adjustments to transformLayer.');
}

function checkUxpStructuredMismatchError() {
  const sourcePath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'sku-layout-tool.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  // 1. 不允许回退成纯文案 throw。
  assert(!/throw new Error\(\s*`占位槽数量/.test(source), 'Placeholder mismatch must not be thrown as a plain text-only Error.');

  // 2. 结构化字段齐全。
  assert(source.includes("schema: 'sku-placeholder-mismatch/v1'"), 'Structured mismatch data must carry a schema id.');
  assert(source.includes("reason: 'placeholder_slot_count_mismatch'"), 'Structured mismatch data must carry a machine-readable reason.');
  for (const field of ['mode:', 'slotCount:', 'requiredCount:', 'combo:', 'templateDocName:', 'resolutions']) {
    assert(source.includes(field), `Structured mismatch data must include field ${field.replace(':', '')}.`);
  }
  assert(source.includes('resolveSkuTemplateLayoutInspectionMode'), 'Mismatch mode must reuse the single-source inspection mode resolver.');
  const modeResolverUses = source.split('resolveSkuTemplateLayoutInspectionMode').length - 1;
  assert(modeResolverUses >= 3, 'Mode resolver must be shared by inspectTemplateLayout and the mismatch error builder.');

  // 3. 两处 throw 都走结构化构造器。
  const builderUses = source.split('createSkuPlaceholderMismatchError').length - 1;
  assert(builderUses >= 3, 'Both mismatch throw sites must use createSkuPlaceholderMismatchError.');
  assert(source.includes('少于自选备注配色数量'), 'Note-path mismatch headline must be preserved.');
  assert(source.includes('与配色顺序数量'), 'Combo-path mismatch headline must be preserved.');

  // 4. 结构修复必须覆盖显式容量、调整现有区域、换模板/转换方法。
  assert(/出路①[^\n]*inspectTemplateLayout[^\n]*regionCapacities/.test(source), 'Legacy resolution ① must build explicit region capacities from inspection evidence.');
  assert(/出路②[^\n]*layerId[^\n]*transformLayer/.test(source), 'Legacy resolution ② must adjust existing regions by layerId.');
  assert(/出路③[^\n]*openTemplate[^\n]*createSkuPlaceholders/.test(source), 'Legacy resolution ③ must cover switching templates or explicitly converting methods.');

  // 5. 两个 catch 出口都把结构化数据带回 ToolResult.data。
  assert(source.includes('extractSkuPlaceholderMismatchData(error)'), 'Note-path catch must extract structured mismatch data.');
  assert(source.includes('extractSkuPlaceholderMismatchData(err)'), 'Combo-path catch must extract structured mismatch data.');
  assert(source.includes('placeholderMismatch ? { placeholderMismatch } : null'), 'Note-path failure result must surface placeholderMismatch in data.');
  assert(source.includes('placeholderMismatches.length > 0 ? placeholderMismatches : undefined'), 'Combo-path batch result must surface placeholderMismatches in data.');

  // 6. 中文编码回读：关键中文钉桩必须原样存在（防 GBK 误写坏）。
  for (const chinese of ['占位槽数量', '区域容量计划', '双装', '矩形区域模板必须提供']) {
    assert(source.includes(chinese), `UXP source Chinese pin missing or mojibake: ${chinese}`);
  }
}

/**
 * 与 UXP createSkuPlaceholderMismatchError 产出的结构逐字段一致的失败数据样例。
 * UXP 侧改字段形状时，这里的字段核对会失败，提醒同步更新语义条目与消费方。
 */
function buildMismatchDataFixture() {
  return {
    schema: 'sku-placeholder-mismatch/v1',
    reason: 'placeholder_slot_count_mismatch',
    mode: 'ordered_slots',
    slotCount: 2,
    requiredCount: 3,
    combo: ['白色', '奶白', '蓝色'],
    templateDocName: '3双装模板.psd',
    resolutions: [
      '出路① 补槽：调用 createSkuPlaceholders 把模板“占位”槽补到 3 个（slots 数量 = 本组颜色数量）后重试。',
      '出路② 单区域模式：若模板本意是用一个参考区域承载整组多色（水平分布），先用 skuLayout action=inspectTemplateLayout 确认 mode=legacy_single_region，再按单区域模式执行。',
      '出路③ 换模板：用 openTemplate 打开与颜色数量匹配的规格模板（如「3双装」），读取返回的 documentName 作为 templateDocName 后重试。'
    ]
  };
}

/**
 * 模拟 UXP mcp-protocol.handleToolsCall 的 MCP 文本封包 + 渲染进程
 * mcp-host.client.parseToolCallPayload 的解包（二者的真实行为由下面的源码钉桩守护）。
 */
function roundTripThroughMcpTextEnvelope(toolResult) {
  const envelope = {
    content: [
      {
        type: 'text',
        text: JSON.stringify(toolResult, null, 2)
      }
    ],
    isError: toolResult?.success === false
  };
  const first = Array.isArray(envelope.content) ? envelope.content[0] : null;
  const text = first && typeof first.text === 'string' ? first.text : '';
  assert(text, 'MCP envelope must carry the serialized tool result text.');
  return JSON.parse(text);
}

function assertMismatchFieldsIntact(label, actual, expected) {
  assert(actual && typeof actual === 'object', `${label}: mismatch payload must survive as an object.`);
  for (const key of ['schema', 'reason', 'mode', 'slotCount', 'requiredCount', 'combo', 'templateDocName', 'resolutions']) {
    assert(
      JSON.stringify(actual[key]) === JSON.stringify(expected[key]),
      `${label}: field ${key} must survive to the model-visible result unchanged. actual=${JSON.stringify(actual[key])}`
    );
  }
  for (const resolution of actual.resolutions) {
    assert(!resolution.includes('已截断'), `${label}: resolutions must not be truncated by sanitizeToolOutputForModel.`);
  }
}

/**
 * 可执行透传回归：用真实 sanitizeToolOutputForModel（Agent 循环回填模型前的最后一道
 * 变换）跑 UXP 两种失败形状，逐字段核对 data.placeholderMismatch(es) 原样可见。
 */
function checkStructuredMismatchPassthroughToModel() {
  const mismatch = buildMismatchDataFixture();

  // 形状 1：arrangeDynamic 单失败出口 { success:false, error, data:{ placeholderMismatch } }
  const singleFailure = {
    success: false,
    error: `占位槽数量-2 少于自选备注配色数量-3：白色+奶白+蓝色。 ${mismatch.resolutions.join(' ')}`,
    data: { placeholderMismatch: mismatch }
  };
  const singleVisible = sanitizeToolOutputForModel(roundTripThroughMcpTextEnvelope(singleFailure));
  assert(singleVisible.success === false, 'Single-failure shape must keep success=false.');
  assert(typeof singleVisible.error === 'string' && singleVisible.error.includes('出路①'), 'Single-failure error text must keep the named resolutions.');
  assertMismatchFieldsIntact('single-failure data.placeholderMismatch', singleVisible?.data?.placeholderMismatch, mismatch);

  // 形状 2：executeComboLayout 批量出口 { success:false, data:{ errors, placeholderMismatches:[...] } }
  const batchFailure = {
    success: false,
    error: '未导出任何文件',
    data: {
      exportedCount: 0,
      exportedFiles: [],
      errors: [`组合 1: 占位槽数量-2 与配色顺序数量-3 不匹配：白色+奶白+蓝色。 ${mismatch.resolutions.join(' ')}`],
      placeholderMismatches: [mismatch],
      outputDir: 'C:/demo/SKU',
      format: 'jpg',
      quality: 90
    }
  };
  const batchVisible = sanitizeToolOutputForModel(roundTripThroughMcpTextEnvelope(batchFailure));
  const batchList = batchVisible?.data?.placeholderMismatches;
  assert(Array.isArray(batchList) && batchList.length === 1, 'Batch shape must keep the placeholderMismatches array.');
  assertMismatchFieldsIntact('batch data.placeholderMismatches[0]', batchList[0], mismatch);
  assert(
    Array.isArray(batchVisible?.data?.errors) && batchVisible.data.errors[0].includes('出路③'),
    'Batch errors text must keep the named resolutions.'
  );
}

/**
 * 中间层源码钉桩：任何一层开始剥 data 字段（改成只透传 error 文案），这里失败。
 * 位点与形状核对基于 2026-07 实链路排查：
 * UXP message-handler 原样返回 → UXP mcp-protocol 整份 JSON.stringify 进 content[0].text
 * → 主进程 websocket/mcp-host 原样解析 → 渲染进程 parseToolCallPayload 解包
 * → executeToolCall 失败规整仅改写 error/message 文案 → agent.ts sanitizeToolOutputForModel
 * → provider 适配器 JSON.stringify(r.output) 给模型。
 */
function checkMiddleLayersDoNotStripStructuredData() {
  const readSource = (relativePath) => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

  const mcpProtocolSource = readSource(path.join('..', 'DesignEcho-UXP', 'src', 'core', 'mcp-protocol.ts'));
  assert(
    mcpProtocolSource.includes('JSON.stringify(result, null, 2)'),
    'UXP mcp-protocol tools/call must serialize the FULL tool result (including data) into content[0].text.'
  );

  const mcpClientSource = readSource(path.join('src', 'renderer', 'services', 'mcp-host.client.ts'));
  assert(
    mcpClientSource.includes('function parseToolCallPayload'),
    'Renderer mcp-host.client must keep parseToolCallPayload that restores the full result from content[0].text.'
  );
  assert(
    /const text = first && typeof first\.text === 'string' \? first\.text : '';/.test(mcpClientSource),
    'parseToolCallPayload must read content[0].text as the full-result carrier.'
  );

  const toolExecutorSource = readSource(path.join('src', 'renderer', 'services', 'tool-executor.service.ts'));
  const failureNormalizerStart = toolExecutorSource.indexOf('function normalizeFailedToolResultForPublicUse');
  assert(failureNormalizerStart >= 0, 'tool-executor must keep normalizeFailedToolResultForPublicUse.');
  const failureNormalizerBody = toolExecutorSource.slice(failureNormalizerStart, failureNormalizerStart + 700);
  assert(
    failureNormalizerBody.includes('{ ...result }'),
    'normalizeFailedToolResultForPublicUse must spread-preserve the failed result (keep data), only rewriting error/message text.'
  );
  assert(
    !/delete\s+normalized\.data/.test(failureNormalizerBody),
    'normalizeFailedToolResultForPublicUse must not strip the data field from failed results.'
  );

  const agentSource = readSource(path.join('src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
  assert(
    agentSource.includes('output: this.buildModelToolObservationOutput(') &&
      agentSource.includes('const sanitized = sanitizeToolOutputForModel(output);'),
    'agent.ts must feed the WHOLE tool output through the observation envelope and sanitizeToolOutputForModel into tool_result messages.'
  );

  const openaiAdapterSource = readSource(path.join('src', 'main', 'services', 'provider-adapters', 'openai-adapter.ts'));
  assert(
    openaiAdapterSource.includes('JSON.stringify(r.output)'),
    'openai-adapter must serialize the whole tool output object for the model.'
  );
}

function run() {
  const semanticIds = checkSemantics();
  checkToolSchemaDescriptions();
  checkUxpStructuredMismatchError();
  checkStructuredMismatchPassthroughToModel();
  checkMiddleLayersDoNotStripStructuredData();

  return {
    success: true,
    semanticIds,
    checkedTools: ['skuLayout', 'createSkuPlaceholders', 'sockLayoutConfig', 'openTemplate'],
    passthroughChecked: {
      executable: 'sanitizeToolOutputForModel × 单组合/批量两种失败形状逐字段核对',
      sourcePins: [
        'DesignEcho-UXP/src/core/mcp-protocol.ts (full JSON.stringify into content[0].text)',
        'src/renderer/services/mcp-host.client.ts (parseToolCallPayload)',
        'src/renderer/services/tool-executor.service.ts (failure normalizer keeps data)',
        'src/renderer/services/agent-runtime/agent.ts (sanitizeToolOutputForModel on tool_result)',
        'src/main/services/provider-adapters/openai-adapter.ts (JSON.stringify(r.output))'
      ]
    },
    packageJsonRegistrationSuggestion: {
      'smoke:sku-tool-semantics': 'node scripts/smoke-sku-tool-semantics.cjs'
    }
  };
}

try {
  const report = run();
  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'smoke-sku-tool-semantics.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
