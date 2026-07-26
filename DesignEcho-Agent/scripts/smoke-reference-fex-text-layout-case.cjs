#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  normalizeReferenceParseResult,
  buildMinimalDesignRepresentation
} = require(path.resolve(__dirname, '..', 'src/shared/reference-replication.ts'));

const {
  compareReferenceVisualQaItem,
  buildReferenceReplicationVisualQaReport
} = require(path.resolve(__dirname, '..', 'src/shared/reference-replication-visual-qa.ts'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    position: {
      x: normalizeBox(element.expectedBox, canvas).x,
      y: normalizeBox(element.expectedBox, canvas).y
    },
    size: {
      width: normalizeBox(element.expectedBox, canvas).width,
      height: normalizeBox(element.expectedBox, canvas).height
    },
    relationship: {
      group: element.alignment || 'text'
    },
    visualWeight: isHeadline ? 'primary' : 'secondary',
    zIndex: isHeadline ? 1 : 2
  };
}

async function detectTextClusters(imagePath) {
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const threshold = 150;
  const rowCounts = new Array(info.height).fill(0);
  const colCountsByRow = [];

  for (let y = 0; y < info.height; y++) {
    const cols = new Array(info.width).fill(0);
    for (let x = 0; x < info.width; x++) {
      const index = (y * info.width + x) * info.channels;
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3;
      if (luminance < threshold) {
        rowCounts[y] += 1;
        cols[x] += 1;
      }
    }
    colCountsByRow[y] = cols;
  }

  const rowGroups = [];
  let current = null;
  for (let y = 0; y < info.height; y++) {
    if (rowCounts[y] > 3) {
      if (!current) current = { top: y, bottom: y };
      current.bottom = y;
    } else if (current) {
      if (current.bottom - current.top >= 5) rowGroups.push(current);
      current = null;
    }
  }
  if (current && current.bottom - current.top >= 5) rowGroups.push(current);

  const lines = rowGroups.map((row) => {
    const colCounts = new Array(info.width).fill(0);
    for (let y = row.top; y <= row.bottom; y++) {
      for (let x = 0; x < info.width; x++) {
        colCounts[x] += colCountsByRow[y][x];
      }
    }

    const rawClusters = [];
    let cluster = null;
    for (let x = 0; x < info.width; x++) {
      if (colCounts[x] > 0) {
        if (!cluster) cluster = { left: x, right: x };
        cluster.right = x;
      } else if (cluster) {
        rawClusters.push(cluster);
        cluster = null;
      }
    }
    if (cluster) rawClusters.push(cluster);

    const merged = [];
    for (const item of rawClusters) {
      const last = merged[merged.length - 1];
      if (last && item.left - last.right <= 18) {
        last.right = item.right;
      } else {
        merged.push({ ...item });
      }
    }

    return {
      y: row.top,
      height: row.bottom - row.top + 1,
      clusters: merged.map((item) => ({
        x: item.left,
        width: item.right - item.left + 1
      }))
    };
  });

  return {
    width: info.width,
    height: info.height,
    lines
  };
}

function flattenDetectedBoxes(detected) {
  const boxes = [];
  for (const line of detected.lines) {
    for (const cluster of line.clusters) {
      boxes.push({
        x: cluster.x,
        y: line.y,
        width: cluster.width,
        height: line.height
      });
    }
  }
  return boxes;
}

function assertCloseBox(actual, expected, id, tolerance = 3) {
  for (const key of ['x', 'y', 'width', 'height']) {
    const delta = Math.abs(Number(actual[key]) - Number(expected[key]));
    assert(delta <= tolerance, `Detected box mismatch for ${id}.${key}: expected ${expected[key]}, got ${actual[key]}.`);
  }
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const benchmarkRoot = path.join(root, 'benchmarks/reference-replication');
  const casePath = path.join(benchmarkRoot, 'cases/rr-001-fex-certificate-text-layout.json');
  const caseJson = readJson(casePath);
  const referenceImagePath = path.join(benchmarkRoot, caseJson.referenceImage.path);
  const canvas = caseJson.scenario.canvas;

  assert(caseJson.id === 'rr-001-fex-certificate-text-layout', 'Unexpected FEX case id.');
  assert(fs.existsSync(referenceImagePath), `Missing FEX reference image asset: ${referenceImagePath}`);
  assert(canvas.width === 460 && canvas.height === 460, 'FEX case canvas must stay 460x460.');
  assert(Array.isArray(caseJson.expectedElements) && caseJson.expectedElements.length === 11, 'Expected 11 text elements.');
  assert(caseJson.expectedElements.every((element) => element.kind === 'text'), 'FEX case must be text-only.');

  const detected = await detectTextClusters(referenceImagePath);
  const detectedBoxes = flattenDetectedBoxes(detected);
  assert(detected.width === 460 && detected.height === 460, 'Detected reference image size mismatch.');
  assert(detectedBoxes.length === caseJson.expectedElements.length, `Expected ${caseJson.expectedElements.length} detected text boxes, got ${detectedBoxes.length}.`);
  for (const [index, element] of caseJson.expectedElements.entries()) {
    assertCloseBox(detectedBoxes[index], element.expectedBox, element.id);
  }

  const contents = caseJson.expectedElements.map((element) => element.content);
  for (const requiredText of [
    '合格证',
    '品牌:FEX',
    '品名:袜子',
    '货号:N-W210520',
    '等级:一等品',
    '安全技术类别:B类可直接接触皮肤'
  ]) {
    assert(contents.includes(requiredText), `Missing required text content: ${requiredText}`);
  }

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

  assert(parseResult, 'FEX parse result should normalize.');
  assert(parseResult.canvasSize.width === 460 && parseResult.canvasSize.height === 460, 'Normalized canvas size mismatch.');
  assert(parseResult.elements.length === 11, 'Normalized parse result should keep all text elements.');

  const validElement = toParseElement(caseJson.expectedElements[0], canvas);
  assert(normalizeReferenceParseResult({
    layoutType: 'certificate-label',
    elements: [validElement]
  }) === null, 'Missing canvasSize must not fall back to a default canvas.');

  const missingPosition = { ...validElement };
  delete missingPosition.position;
  assert(normalizeReferenceParseResult({
    layoutType: 'certificate-label',
    canvasSize: canvas,
    elements: [missingPosition]
  }) === null, 'Missing element position must not fall back to default center.');

  const missingSize = { ...validElement };
  delete missingSize.size;
  assert(normalizeReferenceParseResult({
    layoutType: 'certificate-label',
    canvasSize: canvas,
    elements: [missingSize]
  }) === null, 'Missing element size must not fall back to default dimensions.');

  const minimal = buildMinimalDesignRepresentation(parseResult);
  assert(minimal, 'Minimal representation should be generated.');
  assert(minimal.canvas.width === 460 && minimal.canvas.height === 460, 'Minimal representation canvas mismatch.');
  assert(minimal.elements.length === 11, 'Minimal representation should keep all text elements.');
  assert(minimal.elements.every((element) => element.nodeKind === 'text'), 'All minimal nodes should be text nodes.');
  assert(minimal.elements[0].role === 'headline' && minimal.elements[0].content === '合格证', 'Title should stay headline.');

  const comparisons = caseJson.expectedElements.map((element) => compareReferenceVisualQaItem({
    id: element.id,
    plannedBox: element.expectedBox,
    actualBox: element.expectedBox
  }));
  const visualQa = buildReferenceReplicationVisualQaReport({
    comparisons,
    snapshotObservation: {
      source: 'benchmark-expected-bounds',
      snapshotCount: 0,
      overlayCount: 0
    }
  });

  assert(visualQa.status === 'ok', `Expected benchmark self-check visual QA ok, got ${visualQa.status}.`);
  assert(visualQa.counts.ok === 11, `Expected 11 ok geometry checks, got ${visualQa.counts.ok}.`);
  assert(caseJson.score.overall === null, 'Benchmark score must remain null before real execution review.');
  assert(caseJson.verification.manualVerified === false, 'Manual verification must remain false before Photoshop result review.');

  return {
    success: true,
    caseId: caseJson.id,
    referenceImage: caseJson.referenceImage.path,
    textElementCount: caseJson.expectedElements.length,
    requiredTexts: contents,
    minimalSummary: {
      canvas: minimal.canvas,
      layoutType: minimal.layout.layoutType,
      nodeKinds: [...new Set(minimal.elements.map((element) => element.nodeKind))],
      headline: minimal.elements[0].content
    },
    detectedImageTextBoxes: {
      lineCount: detected.lines.length,
      boxCount: detectedBoxes.length,
      firstBox: detectedBoxes[0],
      lastBox: detectedBoxes[detectedBoxes.length - 1]
    },
    visualQa: {
      status: visualQa.status,
      score: visualQa.score,
      counts: visualQa.counts
    },
    boundary: [
      'This smoke validates the benchmark case contract only.',
      'It does not call a model, write Photoshop layers, or prove visual replication quality.'
    ]
  };
}

try {
  run().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
