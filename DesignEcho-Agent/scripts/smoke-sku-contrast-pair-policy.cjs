#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
  'utf8'
);

assert(
  source.includes('const SKU_CONTRAST_PAIR_SCORING_ENABLED = false;'),
  'SKU contrast pair scoring must stay disabled by default.'
);
assert(
  source.includes('const buildContrastPairs = () => {'),
  'SKU contrast pair logic must stay in source for later re-enable review.'
);
assert(
  source.includes('SKU_CONTRAST_PAIR_SCORING_ENABLED') && source.includes('? buildContrastPairs()'),
  'SKU contrast pair scoring must be controlled by the explicit feature flag.'
);
assert(
  !source.includes('const contrastPairs = buildContrastPairs();'),
  'SKU contrast pairs must not be used unconditionally.'
);

console.log(JSON.stringify({
  success: true,
  policy: {
    contrastPairScoringDefault: 'disabled',
    contrastPairLogicPreserved: true
  },
  boundary: [
    '本检查只禁用对比组合评分，不删除候选生成逻辑。',
    'SKU 组合基础生成、缺失颜色补偿和模式评分仍保持原逻辑。'
  ]
}, null, 2));
