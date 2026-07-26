const REAL_REFERENCE_SOURCE_KINDS = new Set([
  'real-commercial-reference',
  'user-provided-commercial-reference',
  'user-supplied-real-reference',
  'brand-reference',
  'public-example-reference'
]);

const BLOCKED_REFERENCE_SOURCE_KINDS = new Set([
  'synthetic-fixture',
  'fixture',
  'fex',
  'temporary-fex',
  'unknown',
  'user'
]);

const BENCHMARK_ONLY_REFERENCE_SOURCE_KINDS = new Set([
  'synthetic-fixture',
  'temporary-fex'
]);

const VALID_REFERENCE_SOURCE_KINDS = new Set([
  ...REAL_REFERENCE_SOURCE_KINDS,
  ...BENCHMARK_ONLY_REFERENCE_SOURCE_KINDS
]);

function normalizeReferenceSourceKind(value) {
  return String(value || '').trim() || 'unknown';
}

function isRealReferenceSourceKind(value) {
  return REAL_REFERENCE_SOURCE_KINDS.has(normalizeReferenceSourceKind(value));
}

function isBlockedReferenceSourceKind(value) {
  return BLOCKED_REFERENCE_SOURCE_KINDS.has(normalizeReferenceSourceKind(value));
}

function isValidReferenceSourceKind(value) {
  return VALID_REFERENCE_SOURCE_KINDS.has(normalizeReferenceSourceKind(value));
}

function isBenchmarkOnlyReferenceSourceKind(value) {
  return BENCHMARK_ONLY_REFERENCE_SOURCE_KINDS.has(normalizeReferenceSourceKind(value));
}

function isSyntheticFixtureReferenceSourceKind(value) {
  return normalizeReferenceSourceKind(value) === 'synthetic-fixture';
}

function isTemporaryFexReferenceSourceKind(value) {
  return normalizeReferenceSourceKind(value) === 'temporary-fex';
}

module.exports = {
  REAL_REFERENCE_SOURCE_KINDS,
  BLOCKED_REFERENCE_SOURCE_KINDS,
  BENCHMARK_ONLY_REFERENCE_SOURCE_KINDS,
  VALID_REFERENCE_SOURCE_KINDS,
  normalizeReferenceSourceKind,
  isRealReferenceSourceKind,
  isBlockedReferenceSourceKind,
  isValidReferenceSourceKind,
  isBenchmarkOnlyReferenceSourceKind,
  isSyntheticFixtureReferenceSourceKind,
  isTemporaryFexReferenceSourceKind
};
