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
  resolveLayoutReplicationAutoCanvasSize
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'skill-executors',
  'layout-replication-canvas.ts'
));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'layout-replication-canvas-policy-smoke.json');
  const mdPath = path.join(outDir, 'layout-replication-canvas-policy-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Layout Replication Canvas Policy Smoke',
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

const referenceCanvas = { width: 460, height: 460 };
const fallback = { width: 1242, height: 1600 };

const cases = [
  runCase('reference-replication-preserves-small-reference-canvas', () => {
    const result = resolveLayoutReplicationAutoCanvasSize({
      params: {},
      referenceCanvas,
      fallback,
      profile: 'reference-replication'
    });
    assert(result.width === 460 && result.height === 460, `expected 460x460, got ${JSON.stringify(result)}`);
    assert(result.source === 'reference', `expected reference source, got ${result.source}`);
    return result;
  }),
  runCase('detail-template-keeps-production-minimum-by-default', () => {
    const result = resolveLayoutReplicationAutoCanvasSize({
      params: {},
      referenceCanvas,
      fallback: { width: 1242, height: 3600 },
      profile: 'detail-template'
    });
    assert(result.width === 800 && result.height === 1200, `expected 800x1200, got ${JSON.stringify(result)}`);
    assert(result.source === 'default', `expected default source, got ${result.source}`);
    return result;
  }),
  runCase('detail-template-can-explicitly-preserve-reference-canvas', () => {
    const result = resolveLayoutReplicationAutoCanvasSize({
      params: { preserveReferenceCanvasSize: true },
      referenceCanvas,
      fallback: { width: 1242, height: 3600 },
      profile: 'detail-template'
    });
    assert(result.width === 460 && result.height === 460, `expected 460x460, got ${JSON.stringify(result)}`);
    assert(result.source === 'reference', `expected reference source, got ${result.source}`);
    return result;
  }),
  runCase('explicit-output-size-outranks-reference-size', () => {
    const result = resolveLayoutReplicationAutoCanvasSize({
      params: { outputWidth: 800, outputHeight: 800 },
      referenceCanvas,
      fallback,
      profile: 'reference-replication'
    });
    assert(result.width === 800 && result.height === 800, `expected 800x800, got ${JSON.stringify(result)}`);
    assert(result.source === 'explicit', `expected explicit source, got ${result.source}`);
    return result;
  }),
  runCase('partial-explicit-size-keeps-reference-other-axis', () => {
    const result = resolveLayoutReplicationAutoCanvasSize({
      params: { outputWidth: 512 },
      referenceCanvas,
      fallback,
      profile: 'reference-replication'
    });
    assert(result.width === 512 && result.height === 460, `expected 512x460, got ${JSON.stringify(result)}`);
    assert(result.source === 'explicit', `expected explicit source, got ${result.source}`);
    return result;
  })
];

const success = cases.every((item) => item.status === 'pass');
const payload = { success, cases };
const report = writeReport(payload);
console.log(JSON.stringify({ ...payload, report }, null, 2));
process.exit(success ? 0 : 1);
