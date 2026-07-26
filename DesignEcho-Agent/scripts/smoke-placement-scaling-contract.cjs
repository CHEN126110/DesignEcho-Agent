#!/usr/bin/env node

/**
 * 置入/缩放链路契约 smoke：
 * 1. 归一化器 alignLayers alignment→alignType 双名兼容 + transformLayer scaleX/scaleY→scale 映射
 *    （严格解析：''/false/[80] 等垃圾输入不得被 Number() 强转成缩放值）+ targetBounds 嵌套 null 剥离。
 * 2. Agent 可见 schema 与 UXP 执行器能力同步（transformLayer/alignLayers/placeImage；
 *    alignLayers.alignTo 不得承诺执行端不支持的 selection）。
 * 3. targetBounds 尺寸确定性验收断言（placeImage/transformLayer，容差 max(2px,1%)）；
 *    含 null 字段安全（null 绝不当 0，评审实测失败输入钉桩）与无法解析时按工具区分的执行端事实文案。
 * 4. UXP 端静态钉桩：transform-layer.ts targetBounds 能力 + originalSize 读数基准（boundsNoEffects 优先）、
 *    place-image.ts 递归回读 + allowUpscale，以及两处 fitLayerToTargetBounds 算法互相指路的一致性标记。
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

const { normalizePhotoshopToolArguments } = require('../src/shared/photoshop-tool-parameter-normalizer.ts');
const { generateToolSchemas } = require('../src/renderer/services/agent-runtime/tool-schemas.ts');
const { buildToolAcceptanceVerification: buildToolAcceptanceEvidence } = require('../src/shared/acceptance/tool-acceptance.ts');

const UXP_ROOT = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getToolSchema(name) {
  const tool = generateToolSchemas().find((item) => item.name === name);
  assert(tool, `Missing Agent-visible tool schema for ${name}.`);
  return tool.inputSchema || {};
}

function layer(id, bounds, name = `图层 ${id}`) {
  return {
    id,
    name,
    kind: 'smartObject',
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    depth: 0,
    index: id - 1,
    parentId: null,
    parentName: null,
    path: name,
    selected: false,
    bounds
  };
}

function snapshot(layers, selectedLayerIds = []) {
  return {
    success: true,
    hasDocument: true,
    document: { id: 1, name: '置入缩放.psd', width: 800, height: 1200, mode: 'RGB' },
    selectedLayerIds,
    layers,
    summary: {
      totalLayers: layers.length,
      selectedLayers: selectedLayerIds.length,
      hiddenLayers: 0,
      lockedLayers: 0,
      textLayers: 0,
      groupLayers: 0,
      smartObjectLayers: layers.length,
      shapeLayers: 0,
      pixelLayers: 0,
      truncated: false
    },
    warnings: []
  };
}

function bounds(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function findAssertion(evidence, id) {
  return (evidence.assertions || []).find((item) => item.id === id);
}

// ---------------------------------------------------------------------------
// 1. 归一化器契约
// ---------------------------------------------------------------------------
function runNormalizerChecks() {
  const mapped = normalizePhotoshopToolArguments('alignLayers', { alignment: 'center' });
  assert(mapped.alignType === 'center', `alignment=center 应映射为 alignType=center，实际: ${JSON.stringify(mapped)}`);
  assert(mapped.alignment === 'center', `alignment 应保留（双名兼容），实际: ${JSON.stringify(mapped)}`);

  const trimmed = normalizePhotoshopToolArguments('alignLayers', { alignment: ' middle ' });
  assert(trimmed.alignType === 'middle', `带空白的合法 alignment 应 trim 后映射，实际: ${JSON.stringify(trimmed)}`);

  const invalid = normalizePhotoshopToolArguments('alignLayers', { alignment: 'centerHorizontal' });
  assert(invalid.alignType === undefined, `非法枚举 alignment 不得被猜测映射，实际: ${JSON.stringify(invalid)}`);
  assert(invalid.alignment === 'centerHorizontal', `非法枚举 alignment 应原样保留供执行端报错，实际: ${JSON.stringify(invalid)}`);

  const explicit = normalizePhotoshopToolArguments('alignLayers', { alignType: 'left', alignment: 'center' });
  assert(explicit.alignType === 'left', `已显式给出的 alignType 不得被 alignment 覆盖，实际: ${JSON.stringify(explicit)}`);

  const flatScale = normalizePhotoshopToolArguments('transformLayer', { scaleX: 50, scaleY: 80 });
  assert(flatScale.scale && flatScale.scale.x === 50 && flatScale.scale.y === 80,
    `scaleX/scaleY 应映射为 scale:{x,y}，实际: ${JSON.stringify(flatScale)}`);
  assert(!('scaleX' in flatScale) && !('scaleY' in flatScale), `平铺 scaleX/scaleY 应在映射后移除，实际: ${JSON.stringify(flatScale)}`);

  const xOnly = normalizePhotoshopToolArguments('transformLayer', { scaleX: 120 });
  assert(xOnly.scale && xOnly.scale.x === 120 && !('y' in xOnly.scale),
    `只给 scaleX 时不得伪造 y 值，实际: ${JSON.stringify(xOnly)}`);

  const nestedWins = normalizePhotoshopToolArguments('transformLayer', { scale: { x: 70, y: 70 }, scaleX: 50 });
  assert(nestedWins.scale.x === 70 && nestedWins.scale.y === 70,
    `已有 scale 对象时不得被平铺参数覆盖，实际: ${JSON.stringify(nestedWins)}`);
  assert(!('scaleX' in nestedWins), `冗余平铺参数应移除，实际: ${JSON.stringify(nestedWins)}`);

  const invalidScale = normalizePhotoshopToolArguments('transformLayer', { scaleX: 'abc' });
  assert(invalidScale.scale === undefined, `非数值 scaleX 应被丢弃而非猜测，实际: ${JSON.stringify(invalidScale)}`);
  assert(!('scaleX' in invalidScale), `非数值 scaleX 不应残留，实际: ${JSON.stringify(invalidScale)}`);

  // F6 钉桩（评审失败输入）：Number('')=0、Number(false)=0、Number([80])=80 都不得被当成有效缩放。
  // 空串曾实测产出 scale:{x:0} → UXP resize(0,...)。
  const emptyStringScale = normalizePhotoshopToolArguments('transformLayer', { scaleX: '' });
  assert(emptyStringScale.scale === undefined, `空串 scaleX 不得产出 scale:{x:0}，实际: ${JSON.stringify(emptyStringScale)}`);
  assert(!('scaleX' in emptyStringScale), `空串 scaleX 不应残留，实际: ${JSON.stringify(emptyStringScale)}`);

  const booleanScale = normalizePhotoshopToolArguments('transformLayer', { scaleX: false, scaleY: false });
  assert(booleanScale.scale === undefined, `布尔 scaleX/scaleY 不得被强转为 0，实际: ${JSON.stringify(booleanScale)}`);

  const arrayScale = normalizePhotoshopToolArguments('transformLayer', { scaleX: [80] });
  assert(arrayScale.scale === undefined, `数组 scaleX（[80]）不得被隐式强转为 80，实际: ${JSON.stringify(arrayScale)}`);

  const numericStringScale = normalizePhotoshopToolArguments('transformLayer', { scaleX: '80' });
  assert(numericStringScale.scale && numericStringScale.scale.x === 80,
    `非空可解析数字字符串 '80' 仍应接受，实际: ${JSON.stringify(numericStringScale)}`);

  // F5 钉桩：targetBounds 嵌套 null 剥离（顶层归一化只剥第一层 null，嵌套对象需显式处理）。
  const nullBounds = normalizePhotoshopToolArguments('placeImage', {
    targetBounds: { x: 100, y: 200, width: 400, height: 300, left: null, top: null }
  });
  assert(nullBounds.targetBounds && !('left' in nullBounds.targetBounds) && !('top' in nullBounds.targetBounds),
    `placeImage targetBounds 内的 null 字段应被剥离，实际: ${JSON.stringify(nullBounds)}`);
  assert(nullBounds.targetBounds.x === 100 && nullBounds.targetBounds.y === 200,
    `placeImage targetBounds 有效字段应保留，实际: ${JSON.stringify(nullBounds)}`);

  const nullBoundsTransform = normalizePhotoshopToolArguments('transformLayer', {
    targetBounds: { width: null, height: null, left: 100, right: 500, top: 200, bottom: 500 }
  });
  assert(nullBoundsTransform.targetBounds
    && !('width' in nullBoundsTransform.targetBounds)
    && !('height' in nullBoundsTransform.targetBounds)
    && nullBoundsTransform.targetBounds.left === 100
    && nullBoundsTransform.targetBounds.right === 500,
    `transformLayer targetBounds 内的 null 字段应被剥离且有效字段保留，实际: ${JSON.stringify(nullBoundsTransform)}`);
}

// ---------------------------------------------------------------------------
// 2. Agent 可见 schema 契约
// ---------------------------------------------------------------------------
function runSchemaChecks() {
  const transform = getToolSchema('transformLayer');
  const transformProps = transform.properties || {};
  for (const prop of ['layerId', 'scaleUniform', 'scaleX', 'scaleY', 'rotate', 'flipHorizontal', 'flipVertical', 'fitToCanvas', 'fitPercentage', 'targetBounds', 'targetFit']) {
    assert(Object.prototype.hasOwnProperty.call(transformProps, prop), `transformLayer schema 缺少 ${prop}`);
  }
  assert(Array.isArray(transformProps.targetFit.enum)
    && ['contain', 'cover', 'fill'].every((v) => transformProps.targetFit.enum.includes(v)),
    'transformLayer targetFit 枚举应为 contain/cover/fill');
  assert(String(transformProps.layerId.description || '').includes('选中'),
    'transformLayer layerId 描述必须警示缺省时作用于当前选中图层');
  assert(String(transformProps.targetBounds.description || '').includes('互斥'),
    'transformLayer targetBounds 描述必须说明与相对缩放参数互斥');

  const align = getToolSchema('alignLayers');
  const alignProps = align.properties || {};
  assert(Object.prototype.hasOwnProperty.call(alignProps, 'alignment'), 'alignLayers schema 缺少 alignment（历史名保留）');
  assert(Array.isArray(alignProps.alignment.enum) && alignProps.alignment.enum.length === 6, 'alignLayers alignment 枚举应为 6 个合法值');
  assert(Object.prototype.hasOwnProperty.call(alignProps, 'layerIds'), 'alignLayers schema 缺少 layerIds');
  assert(Object.prototype.hasOwnProperty.call(alignProps, 'alignTo'), 'alignLayers schema 缺少 alignTo');
  // F7 钉桩：UXP 执行器的 align 描述符只区分 alignToCanvas，'selection' 实际等同对齐首图层且无报错，
  // Agent 可见 schema 不得对模型承诺该能力。
  assert(Array.isArray(alignProps.alignTo.enum) && !alignProps.alignTo.enum.includes('selection'),
    `alignLayers alignTo 枚举不得包含执行端不支持的 selection，实际: ${JSON.stringify(alignProps.alignTo.enum)}`);
  assert(['canvas', 'firstLayer'].every((v) => alignProps.alignTo.enum.includes(v)),
    `alignLayers alignTo 枚举应保留 canvas/firstLayer，实际: ${JSON.stringify(alignProps.alignTo.enum)}`);

  const place = getToolSchema('placeImage');
  const placeProps = place.properties || {};
  assert(Object.prototype.hasOwnProperty.call(placeProps, 'allowUpscale'), 'placeImage schema 缺少 allowUpscale');
  assert(String(placeProps.scale.description || '').includes('大于 100'),
    'placeImage scale 描述必须说明可大于 100 表示放大');
  assert(!String(placeProps.scale.description || '').includes('(1-100)'),
    'placeImage scale 描述不得再声称只支持 1-100');
  assert(String(placeProps.fitToCanvas.description || '').includes('allowUpscale'),
    'placeImage fitToCanvas 描述必须指路 allowUpscale');
}

// ---------------------------------------------------------------------------
// 3. targetBounds 尺寸确定性验收断言
// ---------------------------------------------------------------------------
function placeImageEvidence(params, afterLayerBounds) {
  const before = snapshot([layer(1, bounds(0, 0, 800, 1200), '背景')]);
  const after = snapshot([
    layer(1, bounds(0, 0, 800, 1200), '背景'),
    layer(9, afterLayerBounds, '置入的图片')
  ]);
  return buildToolAcceptanceEvidence({
    toolName: 'placeImage',
    params,
    result: { success: true, data: { layerId: 9 } },
    before: { snapshot: before },
    after: { snapshot: after }
  });
}

function runPlaceImageAcceptanceChecks() {
  // fill：位置、尺寸都必须与目标框一致
  const fillPass = placeImageEvidence(
    { targetBounds: { x: 100, y: 200, width: 400, height: 300 }, targetFit: 'fill' },
    bounds(100, 200, 400, 300)
  );
  assert(fillPass.assertionStatus === 'passed', `fill 精确落位应通过: ${JSON.stringify(fillPass.assertions)}`);
  assert(findAssertion(fillPass, 'placeImage.targetBounds'), 'fill 通过时应输出 placeImage.targetBounds 断言');

  const fillFail = placeImageEvidence(
    { targetBounds: { x: 100, y: 200, width: 400, height: 300 }, targetFit: 'fill' },
    bounds(100, 200, 360, 300)
  );
  assert(fillFail.assertionStatus === 'failed', `fill 宽度差 40px 应失败: ${JSON.stringify(fillFail.assertions)}`);
  assert(String(findAssertion(fillFail, 'placeImage.targetBounds').summary).includes('width'),
    'fill 失败信息应指出 width 偏差');

  // contain：完整位于框内、至少一边贴齐、居中
  const containPass = placeImageEvidence(
    { targetBounds: { left: 100, top: 100, right: 500, bottom: 500 }, targetFit: 'contain' },
    bounds(200, 100, 200, 400)
  );
  assert(containPass.assertionStatus === 'passed', `contain 等比适配应通过: ${JSON.stringify(containPass.assertions)}`);

  const containFail = placeImageEvidence(
    { targetBounds: { left: 100, top: 100, width: 400, height: 400 }, targetFit: 'contain' },
    bounds(150, 150, 300, 300)
  );
  assert(containFail.assertionStatus === 'failed', `contain 无一边贴齐目标框应失败: ${JSON.stringify(containFail.assertions)}`);

  // 容差验证：1% 内的偏差应通过（400px 的 1% = 4px）
  const tolerancePass = placeImageEvidence(
    { targetBounds: { x: 100, y: 100, width: 400, height: 400 }, targetFit: 'fill' },
    bounds(100, 100, 397, 400)
  );
  assert(tolerancePass.assertionStatus === 'passed', `1% 容差内的偏差应通过: ${JSON.stringify(tolerancePass.assertions)}`);

  // cover：铺满目标框、至少一边贴齐、居中
  const coverPass = placeImageEvidence(
    { targetBounds: { x: 100, y: 100, width: 400, height: 400 }, targetFit: 'cover' },
    bounds(50, 100, 500, 400)
  );
  assert(coverPass.assertionStatus === 'passed', `cover 铺满应通过: ${JSON.stringify(coverPass.assertions)}`);

  const coverFail = placeImageEvidence(
    { targetBounds: { x: 100, y: 100, width: 400, height: 400 }, targetFit: 'cover' },
    bounds(100, 150, 400, 300)
  );
  assert(coverFail.assertionStatus === 'failed', `cover 高度未铺满应失败: ${JSON.stringify(coverFail.assertions)}`);

  // 无法解析的 targetBounds：需复核而非猜测
  const malformed = placeImageEvidence(
    { targetBounds: { width: 400, height: 300 } },
    bounds(100, 200, 400, 300)
  );
  assert(malformed.assertionStatus === 'needs_review', `缺 x/y 的 targetBounds 应判需复核: ${JSON.stringify(malformed.assertions)}`);
  // F8 钉桩：无法解析时的执行端事实文案按工具区分——placeImage 是忽略参数退回默认落位。
  const malformedAssertion = findAssertion(malformed, 'placeImage.targetBounds');
  assert(String(malformedAssertion.summary).includes('退回默认落位')
    && !String(malformedAssertion.summary).includes('显式报错'),
    `placeImage 无法解析文案应说明"退回默认落位"而非报错拒绝: ${malformedAssertion.summary}`);

  // F5 钉桩（评审实测失败输入 1）：left:null/top:null 曾被 Number(null)=0 解析成 left=0/top=0，
  // 抢在 ??x/??y 之前生效 → 图层错落 (0,0) 且断言同 bug 判 passed，错误端到端静默。
  // 修复后 null 必须按缺失处理，目标区域应解析为 (100,200,400,300)。
  const nullAsZeroParams = {
    targetBounds: { x: 100, y: 200, width: 400, height: 300, left: null, top: null },
    targetFit: 'fill'
  };
  const nullAsZeroBugged = placeImageEvidence(nullAsZeroParams, bounds(0, 0, 400, 300));
  assert(nullAsZeroBugged.assertionStatus === 'failed',
    `left:null/top:null 时图层落在 (0,0) 必须判失败（null 不得当 0）: ${JSON.stringify(nullAsZeroBugged.assertions)}`);
  const nullAsZeroCorrect = placeImageEvidence(nullAsZeroParams, bounds(100, 200, 400, 300));
  assert(nullAsZeroCorrect.assertionStatus === 'passed',
    `left:null/top:null 时图层落在 (100,200) 应通过（null 按缺失回退到 x/y）: ${JSON.stringify(nullAsZeroCorrect.assertions)}`);

  // F5 钉桩（评审实测失败输入 2）：width:null/height:null + 有效 left/right/top/bottom
  // 曾被判"无效区域"静默退回默认落位；修复后应由差值推导出 400x300 并正常断言。
  const nullSizeParams = {
    targetBounds: { width: null, height: null, left: 100, right: 500, top: 200, bottom: 500 },
    targetFit: 'fill'
  };
  const nullSizePass = placeImageEvidence(nullSizeParams, bounds(100, 200, 400, 300));
  assert(nullSizePass.assertionStatus === 'passed',
    `width/height 为 null 时应由 left/right、top/bottom 差值推导目标区域: ${JSON.stringify(nullSizePass.assertions)}`);
  const nullSizeFail = placeImageEvidence(nullSizeParams, bounds(0, 0, 400, 300));
  assert(nullSizeFail.assertionStatus === 'failed',
    `差值推导出的目标区域必须真正参与断言（错误落位应失败）: ${JSON.stringify(nullSizeFail.assertions)}`);
}

function transformEvidence(params, result, afterLayers) {
  const before = snapshot([layer(4, bounds(0, 0, 100, 100), '产品图')]);
  const after = snapshot(afterLayers);
  return buildToolAcceptanceEvidence({
    toolName: 'transformLayer',
    params,
    result,
    before: { snapshot: before },
    after: { snapshot: after }
  });
}

function runTransformLayerAcceptanceChecks() {
  // 带 layerId + targetBounds：contain 命中
  const pass = transformEvidence(
    { layerId: 4, targetBounds: { x: 100, y: 100, width: 400, height: 400 }, targetFit: 'contain' },
    { success: true, layerId: 4 },
    [layer(4, bounds(100, 100, 400, 400), '产品图')]
  );
  assert(pass.assertionStatus === 'passed', `transformLayer targetBounds 命中应通过: ${JSON.stringify(pass.assertions)}`);
  assert(findAssertion(pass, 'transformLayer.targetBounds'), '应输出 transformLayer.targetBounds 断言');

  // 尺寸偏差超容差：失败
  const fail = transformEvidence(
    { layerId: 4, targetBounds: { x: 100, y: 100, width: 400, height: 400 }, targetFit: 'fill' },
    { success: true, layerId: 4 },
    [layer(4, bounds(100, 100, 300, 400), '产品图')]
  );
  assert(fail.assertionStatus === 'failed', `transformLayer 尺寸偏差应失败: ${JSON.stringify(fail.assertions)}`);

  // params 没给 layerId 时用工具结果的 layerId
  const viaResult = transformEvidence(
    { targetBounds: { x: 100, y: 100, width: 400, height: 400 }, targetFit: 'fill' },
    { success: true, layerId: 4 },
    [layer(4, bounds(100, 100, 400, 400), '产品图')]
  );
  assert(viaResult.assertionStatus === 'passed', `应回退到工具结果 layerId: ${JSON.stringify(viaResult.assertions)}`);

  // layerId 完全缺失：需复核，不猜测
  const noId = transformEvidence(
    { targetBounds: { x: 100, y: 100, width: 400, height: 400 } },
    { success: true },
    [layer(4, bounds(100, 100, 400, 400), '产品图')]
  );
  assert(noId.assertionStatus === 'needs_review', `无法定位目标图层应判需复核: ${JSON.stringify(noId.assertions)}`);

  // 图层在 after 快照缺失（未截断）：失败
  const missing = transformEvidence(
    { layerId: 4, targetBounds: { x: 100, y: 100, width: 400, height: 400 } },
    { success: true, layerId: 4 },
    [layer(2, bounds(0, 0, 800, 1200), '背景')]
  );
  assert(missing.assertionStatus === 'failed', `after 快照缺目标图层应失败: ${JSON.stringify(missing.assertions)}`);

  // 不带 targetBounds：维持原状，无断言
  const noTarget = transformEvidence(
    { layerId: 4, scaleUniform: 80 },
    { success: true, layerId: 4 },
    [layer(4, bounds(0, 0, 80, 80), '产品图')]
  );
  assert(!noTarget.assertions || noTarget.assertions.length === 0,
    `不带 targetBounds 的 transformLayer 不应新增断言: ${JSON.stringify(noTarget.assertions)}`);

  // F5 钉桩：transformLayer 侧同样不得把 null 当 0（三处解析同构，验收端单独验证一次）。
  const nullAsZero = transformEvidence(
    { layerId: 4, targetBounds: { x: 100, y: 100, width: 400, height: 400, left: null, top: null }, targetFit: 'fill' },
    { success: true, layerId: 4 },
    [layer(4, bounds(0, 0, 400, 400), '产品图')]
  );
  assert(nullAsZero.assertionStatus === 'failed',
    `transformLayer left:null/top:null 时图层落在 (0,0) 必须判失败: ${JSON.stringify(nullAsZero.assertions)}`);

  // F8 钉桩：transformLayer 无法解析 targetBounds 时，执行端事实是显式报错拒绝
  //（DesignEcho-UXP transform-layer.ts execute 入口校验），文案不得写成"退回默认落位"。
  const malformed = transformEvidence(
    { layerId: 4, targetBounds: { width: 400, height: 300 } },
    { success: false, layerId: 4 },
    [layer(4, bounds(0, 0, 100, 100), '产品图')]
  );
  const malformedAssertion = findAssertion(malformed, 'transformLayer.targetBounds');
  assert(malformedAssertion && malformedAssertion.status === 'needs_review',
    `transformLayer 无法解析的 targetBounds 应判需复核: ${JSON.stringify(malformed.assertions)}`);
  assert(String(malformedAssertion.summary).includes('显式报错')
    && !String(malformedAssertion.summary).includes('退回默认落位'),
    `transformLayer 无法解析文案应说明执行端显式报错拒绝，而非退回默认落位: ${malformedAssertion.summary}`);
}

// ---------------------------------------------------------------------------
// 4. UXP 端静态钉桩（跨仓一致性）
// ---------------------------------------------------------------------------
function runUxpStaticChecks() {
  const transformSource = fs.readFileSync(path.join(UXP_ROOT, 'src', 'tools', 'layer', 'transform-layer.ts'), 'utf8');
  assert(transformSource.includes('targetBounds'), 'UXP transformLayer 必须支持 targetBounds');
  assert(transformSource.includes('async function fitLayerToTargetBounds'), 'UXP transformLayer 必须实现 fitLayerToTargetBounds');
  assert(transformSource.includes('function normalizeTargetBounds'), 'UXP transformLayer 必须校验 targetBounds 输入');
  assert(transformSource.includes('互斥'), 'UXP transformLayer 必须对 targetBounds 与相对缩放参数冲突给出明确错误');
  assert(transformSource.includes('place-image.ts'), 'UXP transformLayer 的适配算法必须注释指路 place-image.ts 保持同步');
  assert(transformSource.includes('layerId: layer.id'), 'UXP transformLayer 结果必须回传 layerId 供验收断言定位图层');
  assert(transformSource.includes('|| needsRotate'), 'UXP transformLayer 必须保证只旋转不缩放时也执行变换（旧实现旋转被塞在缩放分支）');
  // F9 钉桩：originalSize 必须与 newBounds/newSize、targetBounds 适配算法同一读数基准
  //（boundsNoEffects 优先的 getLayerPixelSize），否则带投影等效果的图层会报虚假尺寸变化。
  assert(transformSource.includes('const originalPixelSize = getLayerPixelSize(layer);'),
    'UXP transformLayer originalSize 必须走 boundsNoEffects 优先的 getLayerPixelSize');
  assert(!transformSource.includes('const bounds = layer.bounds;'),
    'UXP transformLayer 不得再用 layer.bounds（含效果外扩）作为 originalSize 读数基准');

  const placeSource = fs.readFileSync(path.join(UXP_ROOT, 'src', 'tools', 'image', 'place-image.ts'), 'utf8');
  assert(placeSource.includes('findLayerLocation(doc, placedLayerId)'), 'UXP placeImage 最终回读必须递归查找图层（组内也能找到）');
  assert(placeSource.includes('allowUpscale'), 'UXP placeImage 必须支持 allowUpscale');
  assert(placeSource.includes('allowUpscale ? fitScale : Math.min(fitScale, 100)'), 'UXP placeImage fitToCanvas 封顶必须受 allowUpscale 控制');
  assert(!placeSource.includes('缩放比例 (1-100)'), 'UXP placeImage scale 文档不得再声称只支持 1-100');
  assert(placeSource.includes('transform-layer.ts'), 'UXP placeImage 的适配算法必须注释指路 transform-layer.ts 保持同步');

  // fitLayerToTargetBounds 核心算法一致性标记（两处实现必须同步）
  const algorithmMarkers = [
    "const normalizedFit = fit === 'cover' || fit === 'fill' ? fit : 'contain';",
    '? Math.max(scaleX, scaleY)',
    ': Math.min(scaleX, scaleY);',
    'if (Math.abs(widthPercent - 100) > 0.05 || Math.abs(heightPercent - 100) > 0.05) {',
    // F5 钉桩：toFiniteNumber 的 null 安全护栏（null/undefined 绝不映射为 0）必须在两处执行端同时存在，
    // 不许只依赖 Agent 侧归一化器的单层防御。
    'if (value === null || value === undefined) return undefined;',
    "if (trimmed === '') return undefined;"
  ];
  for (const marker of algorithmMarkers) {
    assert(transformSource.includes(marker), `UXP transform-layer.ts 缺少适配算法标记: ${marker}`);
    assert(placeSource.includes(marker), `UXP place-image.ts 缺少适配算法标记: ${marker}`);
  }
}

function main() {
  runNormalizerChecks();
  runSchemaChecks();
  runPlaceImageAcceptanceChecks();
  runTransformLayerAcceptanceChecks();
  runUxpStaticChecks();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'alignLayers alignment→alignType 双名兼容（非法枚举不猜测）',
      "transformLayer scaleX/scaleY→scale 映射（严格解析：''/false/[80] 丢弃，非法数值不当 0）",
      'targetBounds 嵌套 null 剥离（transformLayer/placeImage 归一化入口）',
      'transformLayer/alignLayers/placeImage Agent 可见 schema 与 UXP 能力同步（alignTo 不承诺 selection）',
      'placeImage targetBounds 尺寸断言（fill/contain/cover，容差 max(2px,1%)；null 字段绝不当 0）',
      'transformLayer targetBounds 尺寸断言（layerId 定位、缺失即需复核/失败；null 字段绝不当 0）',
      'targetBounds 无法解析时按工具区分执行端事实文案（placeImage 退回默认落位 / transformLayer 显式报错）',
      'UXP 端 targetBounds 能力、递归回读、allowUpscale、null 安全护栏、originalSize 读数基准与算法一致性钉桩'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error)
  }, null, 2));
  process.exit(1);
}
