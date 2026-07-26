#!/usr/bin/env node

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
  buildPhotoshopToolSemanticsSummary,
  getPhotoshopToolSemanticById,
  getPhotoshopToolSemantics,
  getPhotoshopToolSemanticsByCategory,
  getPhotoshopToolSemanticsByTool
} = require('../src/shared/photoshop-tool-semantics.ts');

const {
  generateToolSchemas
} = require('../src/renderer/services/agent-runtime/tool-schemas.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesText(list, text) {
  return list.some((item) => String(item).includes(text));
}

function getToolSchema(name) {
  const tool = generateToolSchemas().find((item) => item.name === name);
  assert(tool, `Missing Agent-visible tool schema for ${name}.`);
  return tool.inputSchema || {};
}

function getProperties(name) {
  const schema = getToolSchema(name);
  return schema.properties || {};
}

function assertHasProperties(toolName, expected) {
  const properties = getProperties(toolName);
  for (const property of expected) {
    assert(Object.prototype.hasOwnProperty.call(properties, property), `${toolName} schema is missing ${property}.`);
  }
  return properties;
}

function assertFontResolverGuard() {
  const resolverPath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'text', 'font-resolver.ts');
  const source = fs.readFileSync(resolverPath, 'utf8');
  assert(source.includes('let matched = false'), 'Font resolver suggestions must track whether the query matched a font name.');
  assert(source.includes('if (matched) score += rankFontStyle'), 'Font resolver must not score Regular/Normal fonts unless the query matched first.');
  assert(!source.includes('\n            score += rankFontStyle'), 'Font resolver must not add style score unconditionally.');
  assert(!source.includes("matchType: 'fuzzy'"), 'Font resolver must not treat fuzzy suggestions as resolved writable fonts.');
  assert(!source.includes('const allFonts = getInstalledFonts()'), 'Font resolver query path must not rebuild a full installed-font cache after scanning.');
  assert(source.includes('return { resolved: null, suggestions, fontCount };'), 'Font resolver must return suggestions without resolvedFont when exact matching fails.');
}

function assertCreateTextLayerNewlineGuard() {
  const sourcePath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'text', 'create-text-layer.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert(source.includes('function normalizeTextContent'), 'createTextLayer must normalize text content before writing to Photoshop.');
  assert(source.includes('function toPhotoshopTextKey'), 'createTextLayer must convert editable text into a Photoshop textKey payload.');
  assert(source.includes("replace(/\\n/g, '\\r')"), 'createTextLayer must convert LF line breaks to Photoshop paragraph separators.');
  assert(source.includes('textKey,'), 'createTextLayer must write the normalized Photoshop textKey, not raw content.');
  assert(source.includes('to: textKey.length'), 'createTextLayer style ranges must use the Photoshop textKey length.');
  assert(!source.includes('textKey: content,'), 'createTextLayer must not write raw content directly to textKey.');
}

function assertFocusLayerToolGuard() {
  const sourcePath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'focus-layer.ts');
  const registryPath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'registry.ts');
  const executorPath = path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const registry = fs.readFileSync(registryPath, 'utf8');
  const executor = fs.readFileSync(executorPath, 'utf8');
  assert(source.includes("name = 'focusLayer'"), 'focusLayer tool must expose the expected tool name.');
  assert(source.includes('app.bringToFront'), 'focusLayer must bring Photoshop to front as part of observable feedback.');
  assert(source.includes('app.updateUI'), 'focusLayer must refresh Photoshop UI when available.');
  assert(source.includes('makeVisible: true'), 'focusLayer selection must request makeVisible=true.');
  assert(source.includes('exactPanZoomSupported: false'), 'focusLayer must explicitly avoid claiming exact viewport pan/zoom support.');
  assert(source.includes('pannedOrZoomed: false'), 'focusLayer must not pretend it panned or zoomed the canvas.');
  assert(!source.includes('fitOnScreen'), 'focusLayer must not include unverified fitOnScreen behavior.');
  assert(registry.includes("import { FocusLayerTool }"), 'Tool registry must import FocusLayerTool.');
  assert(registry.includes('new FocusLayerTool()'), 'Tool registry must register FocusLayerTool.');
  assert(executor.includes("name: 'focusLayer'"), 'Agent tool executor catalog must expose focusLayer.');
  assert(executor.includes('AUTO_FOCUS_AFTER_TOOLS'), 'Agent tool executor must define an explicit auto-focus allowlist.');
  assert(executor.includes("if (toolName === 'focusLayer') return false;"), 'Auto-focus must not recursively focus focusLayer.');
  assert(executor.includes('AUTO_FOCUS_MIN_INTERVAL_MS'), 'Auto-focus must be throttled to avoid UI disruption.');
  assert(executor.includes('focusResult'), 'Auto-focus results must be attached explicitly.');
  // 2026-07-03 更新过期钉桩：auto-focus 现走 sendToPluginWithCancellation（带取消+超时），
  // 能力未变（仍调真实 focusLayer 工具，非本地假状态），仅符号/格式演进。
  assert(
    executor.includes("sendToPluginWithCancellation(\n            'focusLayer'"),
    'Auto-focus must call the real focusLayer tool (via sendToPluginWithCancellation) rather than fake local state.'
  );
}

function run() {
  const all = getPhotoshopToolSemantics();
  const text = getPhotoshopToolSemanticsByCategory('text');
  const ids = new Set(all.map((item) => item.id));

  assert(all.length >= 8, 'Expected text plus non-text Photoshop tool semantic entries.');
  assert(text.length >= 4, 'Expected at least four text tool semantic entries.');
  assert(ids.has('text-layer-create'), 'Missing text-layer-create semantics.');
  assert(ids.has('text-content-edit'), 'Missing text-content-edit semantics.');
  assert(ids.has('text-style-edit'), 'Missing text-style-edit semantics.');
  assert(ids.has('text-layout-bounds'), 'Missing text-layout-bounds semantics.');
  assert(ids.has('layer-position-edit'), 'Missing layer-position-edit semantics.');
  assert(ids.has('layer-focus-feedback'), 'Missing layer-focus-feedback semantics.');
  assert(ids.has('image-layer-place'), 'Missing image-layer-place semantics.');
  assert(ids.has('shape-layer-create'), 'Missing shape-layer-create semantics.');
  assert(ids.has('basic-layer-style'), 'Missing basic-layer-style semantics.');
  assert(getPhotoshopToolSemanticsByCategory('transform').length >= 1, 'Missing transform semantics.');
  assert(getPhotoshopToolSemanticsByCategory('image-placement').length >= 1, 'Missing image placement semantics.');
  assert(getPhotoshopToolSemanticsByCategory('shape').length >= 1, 'Missing shape semantics.');
  assert(getPhotoshopToolSemanticsByCategory('layer-style').length >= 1, 'Missing layer style semantics.');

  const requiredTools = [
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'resolveFontName',
    'moveLayer',
    'alignLayers',
    'transformLayer',
    'quickScale',
    'placeImage',
    'replaceLayerContent',
    'replaceImagePlaceholder',
    'createRectangle',
    'addStroke',
    'addDropShadow',
    'getLayerBounds',
    'focusLayer',
    'getAcceptanceSnapshot'
  ];
  const coveredTools = new Set();
  for (const item of all) {
    for (const tool of item.photoshopTools) coveredTools.add(tool);
    for (const tool of item.dependsOnTools) coveredTools.add(tool);
  }
  for (const tool of requiredTools) {
    assert(coveredTools.has(tool), `Missing tool coverage for ${tool}.`);
    assert(getPhotoshopToolSemanticsByTool(tool).length > 0, `Tool lookup returned no semantic entries for ${tool}.`);
  }

  const create = getPhotoshopToolSemanticById('text-layer-create');
  const style = getPhotoshopToolSemanticById('text-style-edit');
  const content = getPhotoshopToolSemanticById('text-content-edit');
  const bounds = getPhotoshopToolSemanticById('text-layout-bounds');
  const movement = getPhotoshopToolSemanticById('layer-position-edit');
  const focus = getPhotoshopToolSemanticById('layer-focus-feedback');
  const imagePlacement = getPhotoshopToolSemanticById('image-layer-place');
  const shape = getPhotoshopToolSemanticById('shape-layer-create');
  const layerStyle = getPhotoshopToolSemanticById('basic-layer-style');
  assert(create, 'Expected text-layer-create lookup to work.');
  assert(style, 'Expected text-style-edit lookup to work.');
  assert(content, 'Expected text-content-edit lookup to work.');
  assert(bounds, 'Expected text-layout-bounds lookup to work.');
  assert(movement, 'Expected layer-position-edit lookup to work.');
  assert(focus, 'Expected layer-focus-feedback lookup to work.');
  assert(imagePlacement, 'Expected image-layer-place lookup to work.');
  assert(shape, 'Expected shape-layer-create lookup to work.');
  assert(layerStyle, 'Expected basic-layer-style lookup to work.');

  assert(includesText(style.designSemantics, 'PostScript'), 'Font semantics must mention PostScript names.');
  assert(includesText(style.commonFailureModes, 'fallback'), 'Font semantics must mention fallback risk.');
  assert(includesText(create.designSemantics, '视觉外接框'), 'Text creation semantics must mention visual bounds.');
  assert(includesText(content.punctuationAndLineBreakRules || [], '冒号'), 'Text content semantics must cover punctuation.');
  assert(includesText(content.punctuationAndLineBreakRules || [], '换行'), 'Text content semantics must cover line breaks.');
  assert(includesText(bounds.acceptance.checks, 'plannedBox'), 'Bounds semantics must check plannedBox.');
  assert(includesText(bounds.acceptance.checks, 'actualBounds'), 'Bounds semantics must check actualBounds.');
  assert(includesText(movement.designSemantics, '绝对坐标'), 'Movement semantics must distinguish absolute coordinates.');
  assert(includesText(movement.notSolvedByThis, 'Grid DSL'), 'Movement semantics must not claim to replace Grid DSL.');
  assert(includesText(focus.designSemantics, '不是真实视口聚焦') || includesText(focus.designSemantics, '精确平移/缩放'), 'Focus semantics must state viewport control boundary.');
  assert(includesText(focus.notSolvedByThis, '精确 Photoshop 画布平移'), 'Focus semantics must not claim exact canvas panning.');
  assert(includesText(imagePlacement.designSemantics, '主体边界'), 'Image placement semantics must mention subject bounds.');
  assert(includesText(imagePlacement.acceptance.checks, 'placementAudit'), 'Image placement semantics must include placement audit checks.');
  assert(includesText(shape.designSemantics, '容器'), 'Shape semantics must describe container usage.');
  assert(layerStyle.maturity === 'planned', 'Layer style semantics should stay planned until style recipes are verified.');
  assert(includesText(layerStyle.designSemantics, 'recipe'), 'Layer style semantics must be framed as recipe work.');

  for (const item of all) {
    assert(item.parameters.length > 0, `${item.id} should define parameters.`);
    assert(item.commonFailureModes.length > 0, `${item.id} should define failure modes.`);
    assert(item.acceptance.checks.length > 0, `${item.id} should define acceptance checks.`);
    assert(item.acceptance.pass.length > 0, `${item.id} should define pass criteria.`);
    assert(item.acceptance.needsReview.length > 0, `${item.id} should define needs_review criteria.`);
    assert(item.acceptance.fail.length > 0, `${item.id} should define fail criteria.`);
    assert(item.benchmarkNeeds.length > 0, `${item.id} should define benchmark needs.`);
    assert(item.notSolvedByThis.length > 0, `${item.id} should define boundaries.`);
  }

  const summary = buildPhotoshopToolSemanticsSummary('text');
  assert(summary.includes('创建可编辑文本图层'), 'Summary should include text creation entry.');
  assert(summary.includes('验收检查'), 'Summary should include acceptance checks.');

  assertHasProperties('getLayerBounds', ['layerId', 'includeEffects']);
  assertHasProperties('focusLayer', ['layerId', 'layerName', 'includeBounds']);
  assertHasProperties('getAcceptanceSnapshot', ['includeHidden', 'includeText', 'includeBounds', 'maxLayers']);
  assertHasProperties('moveLayer', ['layerId', 'x', 'y', 'relative']);
  assertHasProperties('alignLayers', ['alignment']);
  assertHasProperties('transformLayer', ['scaleUniform', 'rotate', 'flipHorizontal']);
  assertHasProperties('quickScale', ['percent', 'fitCanvas']);
  assertHasProperties('placeImage', ['filePath', 'fileToken', 'imageData', 'requirement', 'query', 'category', 'x', 'y', 'center', 'scale', 'fitToCanvas']);
  assertHasProperties('replaceLayerContent', ['filePath', 'layerId']);
  assertHasProperties('createRectangle', ['x', 'y', 'width', 'height', 'fillColorHex', 'cornerRadius']);
  assertHasProperties('addStroke', ['color', 'size']);
  assertHasProperties('addDropShadow', ['color', 'opacity', 'distance', 'size']);
  const setTextContentProps = assertHasProperties('setTextContent', ['layerId', 'content', 'baselineContent', 'updates']);
  assert(setTextContentProps.updates.items?.properties?.baselineContent, 'setTextContent updates items should expose baselineContent.');
  const setTextStyleProps = assertHasProperties('setTextStyle', ['layerId', 'fontSize', 'fontName', 'tracking', 'leading']);
  assert(!Object.prototype.hasOwnProperty.call(setTextStyleProps, 'color'), 'setTextStyle must not expose unsupported color parameter.');
  const createTextProps = assertHasProperties('createTextLayer', [
    'content',
    'text',
    'name',
    'x',
    'y',
    'fontSize',
    'fontName',
    'colorHex',
    'color',
    'alignment'
  ]);
  assert(createTextProps.alignment.enum?.includes('center'), 'createTextLayer alignment enum should include center.');
  assertFontResolverGuard();
  assertCreateTextLayerNewlineGuard();
  assertFocusLayerToolGuard();

  return {
    success: true,
    count: all.length,
    requiredTools,
    ids: Array.from(ids),
    summaryPreview: summary.split('\n').slice(0, 8)
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
