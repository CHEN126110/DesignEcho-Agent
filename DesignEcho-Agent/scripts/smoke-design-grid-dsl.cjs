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
  createTaskGridPreset,
  evaluateGridPlacement,
  getDesignGridTaskKinds,
  getGridColumnBox,
  inferNearestGridColumnSpan
} = require('../src/shared/design-grid-dsl.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const taskKinds = getDesignGridTaskKinds();
  assert(taskKinds.includes('text-certificate'), 'Missing text-certificate grid preset.');
  assert(taskKinds.includes('sku'), 'Missing sku grid preset.');
  assert(taskKinds.includes('detail-page'), 'Missing detail-page grid preset.');
  assert(taskKinds.includes('main-image'), 'Missing main-image grid preset.');
  assert(taskKinds.includes('reference-replication'), 'Missing reference-replication grid preset.');

  const canvas = { width: 800, height: 800 };
  const certificate = createTaskGridPreset('text-certificate', canvas);
  const sku = createTaskGridPreset('sku', canvas);
  const detail = createTaskGridPreset('detail-page', { width: 750, height: 1200 });
  const mainImage = createTaskGridPreset('main-image', canvas);
  const reference = createTaskGridPreset('reference-replication', canvas);

  assert(certificate.version === 'design-grid-dsl.v1', 'Grid DSL version mismatch.');
  assert(certificate.columns.count === 2, 'Text certificate should use two-column preset.');
  assert(sku.columns.count === 4, 'SKU should use four-column preset.');
  assert(detail.columns.count === 4, 'Detail page should use four-column module preset.');
  assert(mainImage.columns.count === 8, 'Main image should use eight-column preset.');
  assert(reference.columns.count === 12, 'Reference replication should start from a low-confidence 12-column candidate.');
  assert(reference.confidence < certificate.confidence, 'Reference replication preset should not overclaim inferred grid confidence.');
  assert(certificate.spacingScale.length >= 5, 'Grid spacing scale should be present.');
  assert(certificate.notes.some((item) => item.includes('列组')), 'Certificate preset should explain its layout intent.');
  const notesText = [certificate, sku, detail, mainImage, reference]
    .flatMap((preset) => preset.notes)
    .join('\n');
  assert(notesText.includes('合格证') && notesText.includes('详情页') && notesText.includes('参考图复刻'), 'Grid preset notes should keep readable Chinese semantics.');
  const commonMojibakeFragments = [
    0xfffd,
    0x95ab,
    0x9359,
    0x6d93,
    0x9428,
    0x7ecb,
    0x93b6,
    0x9352,
    0x9365,
    0x20ac
  ].map((codePoint) => String.fromCodePoint(codePoint));
  assert(!commonMojibakeFragments.some((fragment) => notesText.includes(fragment)), 'Grid preset notes must not contain common mojibake fragments.');

  const leftColumn = getGridColumnBox(certificate, 1, 1);
  const rightColumn = getGridColumnBox(certificate, 2, 1);
  assert(leftColumn.x < rightColumn.x, 'Column boxes should be ordered left to right.');
  assert(leftColumn.width > 0 && rightColumn.width > 0, 'Column boxes should have positive width.');

  const pass = evaluateGridPlacement(certificate, {
    elementId: 'brand',
    role: 'field',
    targetBox: {
      x: leftColumn.x,
      y: certificate.liveArea.y + certificate.rows.baseline * 3,
      width: leftColumn.width,
      height: 32
    },
    columnStart: 1,
    columnSpan: 1,
    baselineIndex: 3
  });
  assert(pass.status === 'pass', `Aligned field should pass grid evaluation: ${JSON.stringify(pass)}`);
  assert(pass.gridFitScore === 1, 'Aligned field should have full gridFitScore.');

  const offGrid = evaluateGridPlacement(certificate, {
    elementId: 'bad-field',
    role: 'field',
    targetBox: {
      x: leftColumn.x + certificate.columns.gutter * 3,
      y: certificate.liveArea.y + certificate.rows.baseline * 3,
      width: leftColumn.width * 0.5,
      height: 32
    },
    columnStart: 1,
    columnSpan: 1,
    baselineIndex: 3
  });
  assert(offGrid.status !== 'pass', 'Off-grid field should not pass.');
  assert(offGrid.gridFitScore < 1, 'Off-grid field should reduce gridFitScore.');
  assert(offGrid.offGridReasons.length > 0, 'Off-grid field should explain why it failed.');

  const breakout = evaluateGridPlacement(mainImage, {
    elementId: 'hero',
    role: 'product-hero',
    targetBox: {
      x: 0,
      y: 0,
      width: 800,
      height: 800
    },
    allowBreakout: true
  });
  assert(breakout.status === 'pass', 'Explicit breakout hero should pass live-area overflow check.');

  const nearest = inferNearestGridColumnSpan(certificate, leftColumn);
  assert(nearest.columnStart === 1 && nearest.columnSpan === 1, 'Nearest column span should recover the left column.');
  assert(nearest.score === 1, 'Exact column box should have nearest score 1.');

  const applySource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'layout-replication-apply.ts'),
    'utf8'
  );
  assert(!applySource.includes('design-grid-dsl'), 'Grid DSL must not be wired into layout-replication executor before executor smoke is designed.');

  return {
    success: true,
    taskKinds,
    presets: {
      certificateColumns: certificate.columns.count,
      skuColumns: sku.columns.count,
      detailColumns: detail.columns.count,
      mainImageColumns: mainImage.columns.count,
      referenceColumns: reference.columns.count
    },
    pass,
    offGrid
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
