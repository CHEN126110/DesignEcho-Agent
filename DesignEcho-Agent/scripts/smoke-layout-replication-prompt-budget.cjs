#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  buildCompactLayoutMatchContext,
  buildLayoutMatchPrompt,
  estimatePromptTokens
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'skill-executors',
  'layout-replication-match.ts'
));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeText(seed, count) {
  return Array.from({ length: count }, (_, index) => `${seed}${index}`).join(' ');
}

function makeDesignRepresentation(elementCount) {
  return {
    canvas: { width: 460, height: 460 },
    layout: {
      layoutType: 'certificate-label',
      designIntent: makeText('复刻白底黑字合格证文本排版，包含标题、左右两列字段和底部说明。', 4),
      focalPoint: 'title',
      readingOrder: ['title', 'brand', 'product-name', 'style-no', 'grade', 'standards'],
      density: 'medium',
      symmetry: 'mixed'
    },
    elements: Array.from({ length: elementCount }, (_, index) => ({
      id: `body-text_${index + 1}`,
      sourceType: 'body-text',
      name: `字段_${index + 1}_${makeText('长名称', 8)}`,
      role: index === 0 ? 'headline' : 'supporting-copy',
      nodeKind: 'text',
      content: makeText(`字段${index + 1}:`, 24),
      style: {
        textColor: '#111111',
        fontWeight: index === 0 ? 'bold' : 'regular',
        fontSizeRatio: index === 0 ? 40 / 460 : 24 / 460,
        effects: []
      },
      box: {
        x: 0.08 + (index % 2) * 0.58,
        y: 0.08 + Math.floor(index / 2) * 0.08,
        width: index === 0 ? 0.32 : 0.4,
        height: index === 0 ? 0.1 : 0.05
      },
      relation: { group: index % 2 === 0 ? 'left-column' : 'right-column' },
      visualWeight: index === 0 ? 'primary' : 'secondary',
      zIndex: index + 1
    })),
    alignmentGroups: [
      { type: 'horizontal-center', elementIndices: [0] },
      { type: 'left-align', elementIndices: [1, 3, 5, 7, 9, 11] },
      { type: 'left-align', elementIndices: [2, 4, 6, 8, 10] }
    ]
  };
}

function makeCurrentElements(layerCount) {
  return Array.from({ length: layerCount }, (_, index) => ({
    id: 1000 + index,
    name: `当前图层_${index + 1}_${makeText('冗长图层名', 6)}`,
    type: index % 3 === 0 ? 'text' : 'pixel',
    bounds: {
      left: 12 + index,
      top: 24 + index * 3,
      width: 120 + (index % 5) * 10,
      height: 30 + (index % 7) * 6,
      right: 140 + index,
      bottom: 60 + index * 3
    },
    textContent: makeText(`图层${index + 1}文本`, 30),
    visible: true,
    locked: false,
    unusedNestedPayload: {
      history: makeText('这段内容不应该进入匹配 prompt。', 50)
    }
  }));
}

function run() {
  const designRepresentation = makeDesignRepresentation(28);
  const targetDoc = { width: 800, height: 800 };
  const currentElements = makeCurrentElements(210);

  const prompt = buildLayoutMatchPrompt(designRepresentation, targetDoc, currentElements);
  const compactContext = buildCompactLayoutMatchContext(designRepresentation, targetDoc, currentElements);
  const previousStylePrompt = [
    `参考表示: ${JSON.stringify(designRepresentation, null, 2)}`,
    `目标画布尺寸: ${targetDoc.width}x${targetDoc.height}`,
    `当前图层: ${JSON.stringify(currentElements.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      bounds: e.bounds,
      textContent: e.textContent
    })), null, 2)}`
  ].join('\n');

  const promptTokens = estimatePromptTokens(prompt);
  const previousTokens = estimatePromptTokens(previousStylePrompt);
  const ratio = prompt.length / previousStylePrompt.length;

  assert(prompt.includes('context='), 'prompt should use compact context payload.');
  assert(prompt.includes('body-text_1'), 'prompt should preserve reference element ids.');
  assert(!prompt.includes('unusedNestedPayload'), 'prompt must not leak unused nested layer payload.');
  assert(compactContext.omittedLayerCount === 50, `expected 50 omitted layers, got ${compactContext.omittedLayerCount}`);
  assert(prompt.length < previousStylePrompt.length * 0.45, `compact prompt should be less than 45% of previous-style payload. ratio=${ratio}`);
  assert(promptTokens < previousTokens, 'estimated token count should be lower than previous-style payload.');

  return {
    success: true,
    promptChars: prompt.length,
    previousStyleChars: previousStylePrompt.length,
    promptTokens,
    previousTokens,
    reductionRatio: Number(ratio.toFixed(4)),
    compactLayerCount: compactContext.layers.length,
    omittedLayerCount: compactContext.omittedLayerCount
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
