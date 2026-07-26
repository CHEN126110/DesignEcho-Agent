#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  normalizeReferenceParseResult,
  buildMinimalDesignRepresentation
} = require(path.resolve(__dirname, '..', 'src/shared/reference-replication.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeBox(box, canvas) {
  return {
    x: Number(box.x) / canvas.width,
    y: Number(box.y) / canvas.height,
    width: Number(box.width) / canvas.width,
    height: Number(box.height) / canvas.height
  };
}

function toParseElement(element, canvas) {
  const normalizedBox = normalizeBox(element.expectedBox, canvas);
  const isHeadline = element.role === 'headline';
  return {
    type: isHeadline ? 'main-title' : 'body-text',
    role: element.role || (isHeadline ? 'headline' : 'supporting-copy'),
    name: element.id,
    content: element.content,
    style: {
      textColor: '#111111',
      fontWeight: element.fontWeight || (isHeadline ? 'bold' : 'regular'),
      fontSizeRatio: isHeadline ? 40 / canvas.height : 25 / canvas.height,
      effects: []
    },
    position: {
      x: normalizedBox.x,
      y: normalizedBox.y
    },
    size: {
      width: normalizedBox.width,
      height: normalizedBox.height
    },
    relationship: {
      group: element.alignment || 'text'
    },
    visualWeight: isHeadline ? 'primary' : 'secondary',
    zIndex: isHeadline ? 1 : 2
  };
}

const root = path.resolve(__dirname, '..');
const benchmarkRoot = path.join(root, 'benchmarks/reference-replication');
const casePath = path.join(benchmarkRoot, 'cases/rr-002-neutral-quality-card-text-layout.json');
const caseJson = readJson(casePath);
const referenceImagePath = path.join(benchmarkRoot, caseJson.referenceImage.path);
const canvas = caseJson.scenario.canvas;

assert(caseJson.id === 'rr-002-neutral-quality-card-text-layout', 'Unexpected neutral text-layout case id.');
assert(caseJson.scenario.category === 'certificate-text-layout', 'Neutral text-layout case must stay in certificate-text-layout category.');
assert(caseJson.scenario.source.providedBy === 'synthetic-fixture', 'Neutral text-layout case must declare synthetic source.');
assert(fs.existsSync(referenceImagePath), `Missing neutral reference image asset: ${referenceImagePath}`);
assert(canvas.width === 600 && canvas.height === 420, 'Neutral text-layout canvas must stay 600x420.');
assert(Array.isArray(caseJson.expectedElements) && caseJson.expectedElements.length >= 8, 'Neutral text-layout case needs enough text elements.');
assert(caseJson.expectedElements.every((element) => element.kind === 'text'), 'Neutral text-layout case must be text-only.');
assert(!JSON.stringify(caseJson).includes('FEX'), 'Neutral text-layout replacement seed must not contain FEX fixture content.');

const contents = caseJson.expectedElements.map((element) => element.content);
for (const requiredText of [
  '品质检验卡',
  '品类:针织袜',
  '货号:Q-2026-0512',
  '安全类别:B类可直接接触皮肤'
]) {
  assert(contents.includes(requiredText), `Missing required neutral text content: ${requiredText}`);
}

const parseResult = normalizeReferenceParseResult({
  layoutType: 'neutral-quality-card-text-layout',
  designIntent: '复刻中性品质检验卡的可编辑文本排版，作为替代品牌样例的基础文本排版验证。',
  canvasSize: canvas,
  composition: {
    focalPoint: 'title',
    readingOrder: caseJson.expectedElements.map((element) => element.id),
    density: 'medium',
    symmetry: 'mixed'
  },
  elements: caseJson.expectedElements.map((element) => toParseElement(element, canvas)),
  alignmentGroups: [
    { type: 'horizontal-center', elementIndices: [0] },
    { type: 'left-align', elementIndices: [1, 3, 5, 6, 7, 8] },
    { type: 'left-align', elementIndices: [2, 4] }
  ]
});

assert(parseResult, 'Neutral parse result should normalize.');
assert(parseResult.canvasSize.width === 600 && parseResult.canvasSize.height === 420, 'Normalized neutral canvas size mismatch.');
assert(parseResult.elements.length === caseJson.expectedElements.length, 'Normalized neutral parse result should keep all text elements.');

const minimal = buildMinimalDesignRepresentation(parseResult);
assert(minimal, 'Neutral minimal representation should be generated.');
assert(minimal.canvas.width === 600 && minimal.canvas.height === 420, 'Neutral minimal representation canvas mismatch.');
assert(minimal.elements.length === caseJson.expectedElements.length, 'Neutral minimal representation should keep all text elements.');
assert(minimal.elements.every((element) => element.nodeKind === 'text'), 'Neutral minimal nodes should be text nodes.');
assert(minimal.elements[0].role === 'headline' && minimal.elements[0].content === '品质检验卡', 'Neutral title should stay headline.');

console.log(JSON.stringify({
  success: true,
  caseId: caseJson.id,
  referenceImage: caseJson.referenceImage.path,
  canvas,
  textElementCount: caseJson.expectedElements.length,
  minimalSummary: {
    layoutType: minimal.layoutType,
    nodeKinds: Array.from(new Set(minimal.elements.map((element) => element.nodeKind))),
    headline: minimal.elements[0].content
  },
  boundary: [
    'This smoke validates the neutral text-layout benchmark case contract only.',
    'It does not call a model, write Photoshop layers, or prove visual replication quality.',
    'It exists so the temporary FEX fixture can later be removed without losing text-layout coverage.'
  ]
}, null, 2));
