#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES
} = require('./lib/reference-benchmark-categories.cjs');

const agentRoot = path.resolve(__dirname, '..');
const benchmarkRoot = path.join(agentRoot, 'benchmarks', 'reference-replication');
const manifestPath = path.join(benchmarkRoot, 'cases.manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveBenchmarkPath(relativePath) {
  const filePath = path.resolve(benchmarkRoot, relativePath);
  const rel = path.relative(benchmarkRoot, filePath);
  assert(!rel.startsWith('..') && !path.isAbsolute(rel), `benchmark path escapes root: ${relativePath}`);
  return filePath;
}

const manifest = readJson(manifestPath);
assert(Array.isArray(manifest.cases), 'manifest.cases must be an array');

const cases = manifest.cases.map((item) => {
  const casePath = resolveBenchmarkPath(item.file || `cases/${item.id}.json`);
  assert(fs.existsSync(casePath), `missing case file: ${item.file}`);
  return readJson(casePath);
});

const categories = new Set(cases.map((item) => String(item?.scenario?.category || '').trim()).filter(Boolean));
const missingCategories = REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES
  .filter((category) => !categories.has(category));

assert(missingCategories.length === 0, `missing representative benchmark categories: ${missingCategories.join(', ')}`);
assert(cases.length >= REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES.length, 'representative coverage requires multiple registered cases');
assert(cases.some((item) => item.id === 'rr-002-neutral-quality-card-text-layout'), 'missing neutral text-layout replacement seed');
assert(!cases.some((item) => item.id === 'rr-001-fex-certificate-text-layout'), 'private FEX case must not be published');

const syntheticCases = cases.filter((item) => item?.scenario?.source?.providedBy === 'synthetic-fixture');
assert(syntheticCases.length >= 3, 'non-text representative seed cases should be marked as synthetic fixtures');

for (const item of syntheticCases) {
  const boundary = String(item?.scenario?.source?.boundary || item?.scenario?.notes || '').toLowerCase();
  assert(boundary.includes('synthetic') || boundary.includes('合成'), `synthetic case ${item.id} must declare synthetic boundary`);
  assert(item?.verification?.buildVerified === false, `synthetic case ${item.id} must not be buildVerified before execution`);
  assert(item?.verification?.manualVerified === false, `synthetic case ${item.id} must not be manualVerified before review`);
  assert(!String(item?.outputs?.resultScreenshot || '').trim(), `synthetic case ${item.id} must not declare resultScreenshot before execution`);
}

const result = {
  success: true,
  caseCount: cases.length,
  categories: Array.from(categories).sort(),
  syntheticCaseIds: syntheticCases.map((item) => item.id).sort(),
  boundary: [
    'Benchmark coverage is representative input coverage only.',
    'Synthetic fixtures do not prove high-fidelity design execution or aesthetic quality.',
    'Private FEX fixtures are excluded from the public benchmark.'
  ]
};

console.log(JSON.stringify(result, null, 2));
