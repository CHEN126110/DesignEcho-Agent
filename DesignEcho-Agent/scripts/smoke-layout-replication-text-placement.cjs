#!/usr/bin/env node

const fs = require('fs');
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
  buildReferenceTextLineLayoutPlan,
  buildReferenceTextLayerCreateRequest,
  estimateReferenceTextTrackingFit,
  estimateReferenceTextWidthUnits,
  resolveReferenceTextFontSize,
  resolveReferenceTextLeading,
  resolveReferenceTextPlacementRole,
  resolveReferenceTextTracking,
  resolveReferenceTextWidthFitFontSize,
  resolveTextBoundsCorrection
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'skill-executors',
  'layout-replication-text-placement.ts'
));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPixelBox(expectedBox) {
  return {
    left: Number(expectedBox.x),
    top: Number(expectedBox.y),
    width: Number(expectedBox.width),
    height: Number(expectedBox.height)
  };
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'layout-replication-text-placement-smoke.json');
  const mdPath = path.join(outDir, 'layout-replication-text-placement-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Layout Replication Text Placement Smoke',
    '',
    `- success: ${payload.success}`,
    '',
    ...payload.cases.flatMap((item) => [
      `## ${item.name}`,
      `- status: ${item.status}`,
      item.details ? `- details: ${item.details}` : '',
      ''
    ])
  ].filter(Boolean).join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

function runCase(name, fn) {
  try {
    const details = fn();
    return { name, status: 'pass', details: JSON.stringify(details) };
  } catch (error) {
    return {
      name,
      status: 'fail',
      details: error && error.stack ? error.stack : String(error)
    };
  }
}

const casePath = path.resolve(
  __dirname,
  '..',
  'benchmarks',
  'reference-replication',
  'cases',
  'rr-001-fex-certificate-text-layout.json'
);
const benchmark = readJson(casePath);
const canvas = benchmark.scenario.canvas;
const elementsById = new Map(benchmark.expectedElements.map((element) => [element.id, element]));

function element(id) {
  const item = elementsById.get(id);
  assert(item, `Missing benchmark element ${id}`);
  return item;
}

const title = element('title');
const brand = element('brand');
const styleNo = element('style-no');

const cases = [
  runCase('role-detection-does-not-treat-field-labels-as-title', () => {
    const titleRole = resolveReferenceTextPlacementRole({
      content: title.content,
      name: 'main-title',
      style: { fontWeight: 'bold', fontSizeRatio: 40 / canvas.height, effects: [] }
    });
    const brandRole = resolveReferenceTextPlacementRole({
      content: brand.content,
      name: 'brand-field',
      style: { fontSizeRatio: 24 / canvas.height, effects: [] }
    });
    const styleNoRole = resolveReferenceTextPlacementRole({
      content: styleNo.content,
      name: 'style-number-field'
    });

    assert(titleRole === 'title', `expected title role, got ${titleRole}`);
    assert(brandRole === 'label', `expected label role for colon field, got ${brandRole}`);
    assert(styleNoRole === 'label', `expected label role for style number field, got ${styleNoRole}`);
    return { titleRole, brandRole, styleNoRole };
  }),
  runCase('font-size-ratio-outranks-black-pixel-box-height', () => {
    const titleFontSize = resolveReferenceTextFontSize({
      style: { fontWeight: 'bold', fontSizeRatio: 40 / canvas.height, effects: [] },
      box: toPixelBox(title.expectedBox),
      canvasHeight: canvas.height,
      role: 'title'
    });
    const bodyFontSize = resolveReferenceTextFontSize({
      style: { fontWeight: 'regular', fontSizeRatio: 24 / canvas.height, effects: [] },
      box: toPixelBox(brand.expectedBox),
      canvasHeight: canvas.height,
      role: 'label'
    });

    assert(titleFontSize === 48, `expected title font size 48, got ${titleFontSize}`);
    assert(bodyFontSize === 24, `expected body font size 24, got ${bodyFontSize}`);
    return { titleFontSize, bodyFontSize };
  }),
  runCase('fallback-font-size-uses-visual-box-height-with-role-ratio', () => {
    const titleFontSize = resolveReferenceTextFontSize({
      box: toPixelBox(title.expectedBox),
      canvasHeight: canvas.height,
      role: 'title'
    });
    const fieldFontSize = resolveReferenceTextFontSize({
      box: toPixelBox(brand.expectedBox),
      canvasHeight: canvas.height,
      role: 'label'
    });

    assert(titleFontSize === 48, `expected fallback title font size 48, got ${titleFontSize}`);
    assert(fieldFontSize === 24, `expected fallback label font size 24, got ${fieldFontSize}`);
    return { titleFontSize, fieldFontSize };
  }),
  runCase('width-fit-font-size-prevents-obvious-overflow', () => {
    const units = estimateReferenceTextWidthUnits('执行标准:FZ/T73001-2016');
    const widthFit = resolveReferenceTextWidthFitFontSize({
      content: '执行标准:FZ/T73001-2016',
      boxWidth: 260
    });
    const fontSize = resolveReferenceTextFontSize({
      content: '执行标准:FZ/T73001-2016',
      box: { left: 0, top: 0, width: 120, height: 24 },
      canvasHeight: 460,
      role: 'label'
    });

    assert(units > 8, `expected mixed text units > 8, got ${units}`);
    assert(widthFit > 20 && widthFit < 32, `expected reasonable width-fit font size, got ${widthFit}`);
    assert(fontSize < 27, `narrow box should cap font size below height-derived 26/27, got ${fontSize}`);
    return { units, widthFit, fontSize };
  }),
  runCase('create-request-uses-visual-left-and-text-baseline-start', () => {
    const titleRequest = buildReferenceTextLayerCreateRequest({
      content: title.content,
      box: toPixelBox(title.expectedBox),
      fontSize: 48,
      colorHex: '#111111'
    });
    const brandRequest = buildReferenceTextLayerCreateRequest({
      content: brand.content,
      box: toPixelBox(brand.expectedBox),
      fontSize: 24,
      colorHex: '#111111'
    });

    assert(titleRequest.x === 160, `expected title x=160, got ${titleRequest.x}`);
    assert(titleRequest.y === 89, `expected title y=89, got ${titleRequest.y}`);
    assert(brandRequest.x === 38, `expected brand x=38, got ${brandRequest.x}`);
    assert(brandRequest.y === 145, `expected brand y=145, got ${brandRequest.y}`);
    return { titleRequest, brandRequest };
  }),
  runCase('create-request-preserves-explicit-paragraph-alignment', () => {
    const titleRequest = buildReferenceTextLayerCreateRequest({
      content: title.content,
      box: toPixelBox(title.expectedBox),
      fontSize: 48,
      colorHex: '#111111',
      alignment: 'center'
    });

    assert(titleRequest.alignment === 'center', `expected center alignment, got ${titleRequest.alignment}`);
    assert(titleRequest.x === 160, `alignment must not rewrite visual x before bounds correction, got ${titleRequest.x}`);
    return titleRequest;
  }),
  runCase('create-request-preserves-typography-spacing', () => {
    const tracking = resolveReferenceTextTracking({ tracking: 35, effects: [] });
    const leading = resolveReferenceTextLeading({
      style: { lineHeightRatio: 1.4, effects: [] },
      fontSize: 24
    });
    const request = buildReferenceTextLayerCreateRequest({
      content: brand.content,
      box: toPixelBox(brand.expectedBox),
      fontSize: 24,
      colorHex: '#111111',
      tracking,
      leading
    });

    assert(request.tracking === 35, `expected tracking=35, got ${request.tracking}`);
    assert(request.leading === 34, `expected leading=34, got ${request.leading}`);
    return request;
  }),
  runCase('long-body-copy-builds-balanced-line-plan-instead-of-shrinking-to-single-line', () => {
    const content = '轻薄堆堆，春夏穿也清爽。自然堆叠的条纹轮廓，让每一步都多一点随性好看。';
    const box = { left: 55, top: 330, width: 700, height: 175 };
    const singleLineWidthFit = resolveReferenceTextWidthFitFontSize({
      content,
      boxWidth: box.width
    });
    const plan = buildReferenceTextLineLayoutPlan({
      content,
      box,
      canvasHeight: 900,
      role: 'body',
      style: { effects: [] }
    });

    assert(plan.insertedLineBreaks === true, 'expected long body copy to insert line breaks');
    assert(plan.lineCount >= 2 && plan.lineCount <= 4, `expected balanced 2-4 lines, got ${plan.lineCount}`);
    assert(plan.fontSize > singleLineWidthFit * 1.4, `expected multi-line font size to be materially larger than single-line shrink, got plan=${plan.fontSize}, single=${singleLineWidthFit}`);
    assert(plan.leading && plan.leading >= plan.fontSize, `expected explicit leading for multi-line copy, got ${plan.leading}`);
    assert(plan.content.includes('\n'), 'expected planned content to contain real line breaks');
    return { singleLineWidthFit, plan };
  }),
  runCase('field-label-copy-does-not-wrap-ordinary-parameter-line', () => {
    const content = '执行标准:FZ/T73001-2016';
    const box = { left: 36, top: 320, width: 330, height: 28 };
    const plan = buildReferenceTextLineLayoutPlan({
      content,
      box,
      canvasHeight: 460,
      role: 'label',
      style: { effects: [] }
    });

    assert(plan.insertedLineBreaks === false, 'ordinary field labels should not insert line breaks');
    assert(plan.lineCount === 1, `expected one line, got ${plan.lineCount}`);
    assert(plan.content === content, `expected content unchanged, got ${plan.content}`);
    return plan;
  }),
  runCase('bounds-correction-aligns-created-layer-back-to-target-visual-box', () => {
    const targetBox = toPixelBox(brand.expectedBox);
    const correction = resolveTextBoundsCorrection({
      targetBox,
      actualBox: {
        left: targetBox.left + 5,
        top: targetBox.top - 3,
        width: targetBox.width,
        height: targetBox.height
      },
      tolerancePx: 1
    });

    assert(correction.shouldMove === true, 'expected correction to move layer');
    assert(correction.dx === -5, `expected dx=-5, got ${correction.dx}`);
    assert(correction.dy === 3, `expected dy=3, got ${correction.dy}`);
    return correction;
  }),
  runCase('tracking-fit-uses-small-width-drift-without-hiding-large-layout-errors', () => {
    const targetBox = toPixelBox(element('execute-standard').expectedBox);
    const smallDrift = estimateReferenceTextTrackingFit({
      content: '执行标准:FZ/T73001-2016',
      fontSize: 24,
      targetBox,
      actualBox: {
        left: targetBox.left,
        top: targetBox.top,
        width: targetBox.width - 10,
        height: targetBox.height + 1
      },
      currentTracking: 0
    });
    const largeDrift = estimateReferenceTextTrackingFit({
      content: '执行标准:FZ/T73001-2016',
      fontSize: 24,
      targetBox,
      actualBox: {
        left: targetBox.left,
        top: targetBox.top,
        width: targetBox.width - 120,
        height: targetBox.height
      },
      currentTracking: 0
    });

    assert(smallDrift, 'expected small width drift to produce a tracking adjustment');
    assert(smallDrift.tracking > 0 && smallDrift.tracking < 80, `expected modest positive tracking, got ${smallDrift.tracking}`);
    assert(!largeDrift, 'large drift must not be hidden by tracking adjustment');
    return { smallDrift, largeDrift };
  }),
  runCase('template-apply-success-does-not-ignore-failed-ops', () => {
    const source = fs.readFileSync(path.resolve(
      __dirname,
      '..',
      'src',
      'renderer',
      'services',
      'skill-executors',
      'layout-replication-apply.ts'
    ), 'utf8');
    assert(!source.includes('failedOps === 0 || createdLayers > 0'), 'apply success must not ignore failedOps.');
    assert(source.includes('success: failedOps === 0 && createdLayers > 0'), 'apply success should require zero failures and at least one created layer.');
    return { successExpression: 'failedOps === 0 && createdLayers > 0' };
  }),
  runCase('live-smoke-skip-is-not-treated-as-success', () => {
    const source = fs.readFileSync(path.resolve(
      __dirname,
      '..',
      'scripts',
      'smoke-reference-fex-text-placement-live.cjs'
    ), 'utf8');
    assert(source.includes("report.outcome === 'fail' || report.outcome === 'skipped'"), 'live smoke skipped outcome must exit non-zero.');
    return { skippedExitIsFailure: true };
  })
];

const success = cases.every((item) => item.status === 'pass');
const payload = {
  success,
  caseId: benchmark.id,
  boundary: [
    'This smoke validates deterministic text placement helpers only.',
    'It does not call Photoshop, prove font rendering parity, or claim live FEX visual quality.'
  ],
  cases
};
const report = writeReport(payload);
console.log(JSON.stringify({ ...payload, report }, null, 2));
process.exit(success ? 0 : 1);
