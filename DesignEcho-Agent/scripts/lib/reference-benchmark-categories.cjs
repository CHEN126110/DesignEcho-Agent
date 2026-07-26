const CATEGORY_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

const DEFAULT_REFERENCE_BENCHMARK_CATEGORY = 'poster-layout';

const REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES = [
  'certificate-text-layout',
  'poster-layout',
  'ecommerce-detail',
  'main-image'
];

function isReferenceBenchmarkCategorySlug(value) {
  return CATEGORY_SLUG_PATTERN.test(String(value || '').trim());
}

module.exports = {
  CATEGORY_SLUG_PATTERN,
  DEFAULT_REFERENCE_BENCHMARK_CATEGORY,
  REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES,
  isReferenceBenchmarkCategorySlug
};
