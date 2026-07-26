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

const {
  buildReferenceLayoutStructure,
  buildCompactReferenceLayoutStructure
} = require(path.resolve(__dirname, '..', 'src/shared/reference-replication-layout-structure.ts'));

const {
  buildDetailTemplateBlueprint
} = require(path.resolve(__dirname, '..', 'src/shared/reference-replication-blueprint.ts'));

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
  const isHeadline = element.role === 'headline';
  const box = normalizeBox(element.expectedBox, canvas);
  return {
    type: isHeadline ? 'main-title' : 'body-text',
    role: isHeadline ? 'headline' : 'supporting-copy',
    name: element.id,
    content: element.content,
    style: {
      textColor: '#111111',
      fontWeight: element.fontWeight || (isHeadline ? 'bold' : 'regular'),
      fontSizeRatio: isHeadline ? 40 / canvas.height : 24 / canvas.height,
      effects: []
    },
    position: { x: box.x, y: box.y },
    size: { width: box.width, height: box.height },
    relationship: { group: element.alignment || 'text' },
    visualWeight: isHeadline ? 'primary' : 'secondary',
    zIndex: isHeadline ? 1 : 2
  };
}

function run() {
  const casePath = path.resolve(
    __dirname,
    '..',
    'benchmarks',
    'reference-replication',
    'cases',
    'rr-001-fex-certificate-text-layout.json'
  );
  const caseJson = readJson(casePath);
  const canvas = caseJson.scenario.canvas;
  const parseResult = normalizeReferenceParseResult({
    layoutType: 'certificate-label',
    designIntent: '复刻白底黑字合格证标签的可编辑文本排版。',
    canvasSize: canvas,
    composition: {
      focalPoint: 'title',
      readingOrder: caseJson.scenario.expectedLayout.readingOrder,
      density: 'medium',
      symmetry: 'mixed'
    },
    elements: caseJson.expectedElements.map((element) => toParseElement(element, canvas)),
    alignmentGroups: [
      { type: 'horizontal-center', elementIndices: [0] },
      { type: 'left-align', elementIndices: [1, 3, 5, 6, 7, 8, 9, 10] },
      { type: 'left-align', elementIndices: [2, 4] }
    ]
  });

  assert(parseResult, 'parse result should normalize.');
  const representation = buildMinimalDesignRepresentation(parseResult);
  assert(representation, 'minimal representation should build.');

  const structure = buildReferenceLayoutStructure(representation);
  const compact = buildCompactReferenceLayoutStructure(representation);
  const blueprint = buildDetailTemplateBlueprint(representation);
  const leftColumn = structure.columnGroups.find((column) => column.elementIds.includes('body-text_2'));
  const rightColumn = structure.columnGroups.find((column) => column.elementIds.includes('body-text_3'));
  const titleRow = structure.rowGroups.find((row) => row.elementIds.includes('main-title_1'));
  const brandRow = structure.rowGroups.find((row) => row.elementIds.includes('body-text_2'));
  const titleElement = blueprint.screens.flatMap((screen) => screen.elements).find((element) => element.sourceElementId === 'main-title_1');
  const rightColumnElement = blueprint.screens.flatMap((screen) => screen.elements).find((element) => element.sourceElementId === 'body-text_3');

  assert(structure.textNodes.length === 11, `expected 11 text nodes, got ${structure.textNodes.length}`);
  assert(structure.rowGroups.length === 9, `expected 9 text rows, got ${structure.rowGroups.length}`);
  assert(structure.columnGroups.length >= 3, `expected title/left/right column groups, got ${structure.columnGroups.length}`);
  assert(titleRow && titleRow.elementIds.length === 1, `title row should contain only title: ${JSON.stringify(titleRow)}`);
  assert(brandRow && brandRow.elementIds.length === 2, `brand row should contain left and right fields: ${JSON.stringify(brandRow)}`);
  assert(leftColumn && Math.abs(leftColumn.left - 36) <= 3, `left column should start around x=36: ${JSON.stringify(leftColumn)}`);
  assert(rightColumn && Math.abs(rightColumn.left - 300) <= 4, `right column should start around x=300: ${JSON.stringify(rightColumn)}`);
  assert(rightColumn.zone === 'right', `right column should be in right zone: ${JSON.stringify(rightColumn)}`);
  assert(rightColumn.textAlign === 'left', `right column text should remain left aligned: ${JSON.stringify(rightColumn)}`);
  assert(structure.rhythm.medianRowStep === 38, `expected median row step 38, got ${structure.rhythm.medianRowStep}`);
  assert(Array.isArray(compact.rows) && compact.rows.length === 9, 'compact structure should keep row groups.');
  assert(JSON.stringify(compact).length < 2400, 'compact layout structure should remain prompt-budget friendly.');
  assert(titleElement?.textLayout?.textAlign === 'center', `title blueprint should carry center textAlign: ${JSON.stringify(titleElement)}`);
  assert(rightColumnElement?.textLayout?.columnZone === 'right', `right field blueprint should carry right column zone: ${JSON.stringify(rightColumnElement)}`);
  assert(rightColumnElement?.textLayout?.textAlign === 'left', `right field blueprint should keep left textAlign: ${JSON.stringify(rightColumnElement)}`);

  return {
    success: true,
    textNodeCount: structure.textNodes.length,
    rowCount: structure.rowGroups.length,
    columnCount: structure.columnGroups.length,
    rhythm: structure.rhythm,
    leftColumn,
    rightColumn,
    blueprintTextLayout: {
      title: titleElement && titleElement.textLayout,
      rightColumnField: rightColumnElement && rightColumnElement.textLayout
    },
    compactChars: JSON.stringify(compact).length,
    warnings: structure.warnings
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
