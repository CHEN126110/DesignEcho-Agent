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
  getPhotoshopToolSemanticById,
  getPhotoshopToolSemanticsByTool
} = require('../src/shared/photoshop-tool-semantics.ts');

const benchmarkPath = path.resolve(
  __dirname,
  '..',
  'benchmarks',
  'photoshop-tool-semantics',
  'text-tool-cases.json'
);

const REQUIRED_TAGS = [
  'multiline-chinese',
  'punctuation',
  'two-column',
  'price-promotion',
  'font-fallback',
  'font-missing',
  'tracking-leading',
  'baseline-bounds'
];

const REQUIRED_TOOLS = [
  'createTextLayer',
  'setTextContent',
  'setTextStyle',
  'resolveFontName',
  'getLayerBounds',
  'moveLayer',
  'getAcceptanceSnapshot'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNonEmptyString(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string.`);
}

function assertNonEmptyArray(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array.`);
}

function walkStrings(value, visitor) {
  if (typeof value === 'string') {
    visitor(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visitor);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walkStrings(item, visitor);
  }
}

function assertNoAbsoluteLocalPaths(value, label) {
  const matches = [];
  walkStrings(value, (item) => {
    if (/^[A-Za-z]:[\\/]/.test(item) || /^file:\/\//i.test(item)) {
      matches.push(item);
    }
  });
  assert(matches.length === 0, `${label} must not contain absolute local paths: ${matches.join(', ')}`);
}

function containsNeedle(value, needle) {
  let found = false;
  walkStrings(value, (item) => {
    if (item.includes(needle)) found = true;
  });
  return found;
}

function assertBox(box, label) {
  assert(box && typeof box === 'object', `${label} must be an object.`);
  for (const key of ['left', 'top', 'width', 'height']) {
    assert(Number.isFinite(box[key]), `${label}.${key} must be finite.`);
  }
  assert(box.width > 0 && box.height > 0, `${label} width/height must be positive.`);
}

function collectBoxes(input) {
  const boxes = [];
  if (!input || typeof input !== 'object') return boxes;
  if (input.plannedBox) boxes.push({ label: 'input.plannedBox', box: input.plannedBox });
  if (Array.isArray(input.contentBlocks)) {
    for (const [index, block] of input.contentBlocks.entries()) {
      if (block?.plannedBox) boxes.push({ label: `input.contentBlocks[${index}].plannedBox`, box: block.plannedBox });
    }
  }
  return boxes;
}

function validateCase(item, index, seenIds, coveredTags, coveredTools, coveredSemantics) {
  assertNonEmptyString(item.id, `cases[${index}].id`);
  assert(!seenIds.has(item.id), `Duplicate case id: ${item.id}`);
  seenIds.add(item.id);

  assertNonEmptyString(item.name, `${item.id}.name`);
  assertNonEmptyArray(item.coverageTags, `${item.id}.coverageTags`);
  assertNonEmptyArray(item.semanticIds, `${item.id}.semanticIds`);
  assertNonEmptyArray(item.tools, `${item.id}.tools`);
  assertNonEmptyArray(item.mustPreserve, `${item.id}.mustPreserve`);
  assertNonEmptyArray(item.expectedEvidence, `${item.id}.expectedEvidence`);
  assertNonEmptyArray(item.passCriteria, `${item.id}.passCriteria`);
  assertNonEmptyArray(item.needsReviewCriteria, `${item.id}.needsReviewCriteria`);
  assertNonEmptyArray(item.failCriteria, `${item.id}.failCriteria`);
  assert(item.scenario && typeof item.scenario === 'object', `${item.id}.scenario must be an object.`);
  assertNonEmptyString(item.scenario.userIntent, `${item.id}.scenario.userIntent`);
  assertNonEmptyString(item.scenario.designRisk, `${item.id}.scenario.designRisk`);
  assert(item.input && typeof item.input === 'object', `${item.id}.input must be an object.`);
  assert(item.liveValidation && typeof item.liveValidation === 'object', `${item.id}.liveValidation must be an object.`);
  assert(item.liveValidation.required === true, `${item.id}.liveValidation.required must be true.`);
  assert(item.liveValidation.status === 'pending', `${item.id}.liveValidation.status must stay pending until a real live run is recorded.`);

  assertNoAbsoluteLocalPaths(item, item.id);

  for (const tag of item.coverageTags) coveredTags.add(tag);

  for (const semanticId of item.semanticIds) {
    assert(getPhotoshopToolSemanticById(semanticId), `${item.id} references unknown semantic id ${semanticId}.`);
    coveredSemantics.add(semanticId);
  }

  for (const tool of item.tools) {
    assert(getPhotoshopToolSemanticsByTool(tool).length > 0, `${item.id} references tool without semantics: ${tool}.`);
    coveredTools.add(tool);
  }

  for (const { label, box } of collectBoxes(item.input)) {
    assertBox(box, `${item.id}.${label}`);
  }

  if (item.semanticIds.includes('text-layout-bounds')) {
    assert(collectBoxes(item.input).length > 0, `${item.id} uses text-layout-bounds but has no plannedBox.`);
    assert(
      item.expectedEvidence.some((evidence) => /bounds|actual|planned/i.test(evidence)),
      `${item.id} must require bounds evidence.`
    );
  }

  if (item.semanticIds.includes('text-content-edit')) {
    assert(
      item.input.content || Array.isArray(item.input.updates) || Array.isArray(item.input.contentBlocks),
      `${item.id} uses text-content-edit but has no content/update payload.`
    );
  }
}

function main() {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
  assert(benchmark.suite === 'photoshop-tool-semantics', 'Unexpected benchmark suite.');
  assert(benchmark.domain === 'text-tools', 'Unexpected benchmark domain.');
  assert(benchmark.version === 1, 'Unexpected benchmark version.');
  assertNonEmptyArray(benchmark.boundaries, 'boundaries');
  assertNonEmptyArray(benchmark.cases, 'cases');
  assert(benchmark.cases.length >= 8, 'Expected at least eight text tool benchmark cases.');

  const seenIds = new Set();
  const coveredTags = new Set();
  const coveredTools = new Set();
  const coveredSemantics = new Set();

  benchmark.cases.forEach((item, index) => {
    validateCase(item, index, seenIds, coveredTags, coveredTools, coveredSemantics);
  });

  for (const tag of REQUIRED_TAGS) {
    assert(coveredTags.has(tag), `Missing required coverage tag: ${tag}.`);
  }

  for (const tool of REQUIRED_TOOLS) {
    assert(coveredTools.has(tool), `Missing required tool coverage: ${tool}.`);
  }

  for (const semanticId of ['text-layer-create', 'text-content-edit', 'text-style-edit', 'text-layout-bounds']) {
    assert(coveredSemantics.has(semanticId), `Missing semantic coverage: ${semanticId}.`);
  }

  assert(containsNeedle(benchmark, '\n'), 'Benchmark must include a manual line-break case.');
  assert(containsNeedle(benchmark, 'FZ/T73001-2016'), 'Benchmark must include slash and hyphen parameter text.');
  assert(containsNeedle(benchmark, '棉100%'), 'Benchmark must include percent parameter text.');
  assert(containsNeedle(benchmark, '¥39.9'), 'Benchmark must include price/currency text.');
  assert(containsNeedle(benchmark, 'fallback'), 'Benchmark must include font fallback risk.');

  console.log(JSON.stringify({
    success: true,
    suite: benchmark.suite,
    domain: benchmark.domain,
    caseCount: benchmark.cases.length,
    coveredTags: Array.from(coveredTags).sort(),
    coveredTools: Array.from(coveredTools).sort(),
    coveredSemantics: Array.from(coveredSemantics).sort(),
    boundary: [
      'This smoke validates text tool benchmark contracts only.',
      'It does not call Photoshop or prove live text rendering quality.'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
