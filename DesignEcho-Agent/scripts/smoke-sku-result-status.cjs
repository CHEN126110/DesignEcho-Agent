const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts'),
  'utf8'
);

// 2026-07-03 更新过期钉桩：completed/partial/failed 三态分类现落在 deliveryStatus
// （表达式与旧 resultStatus 逐字节一致），resultStatus 在其上叠加缺模板 blocked 态
// （7b5fc984 引入，能力增强非回归）。两条都钉住，防分类逻辑被抹掉。
assert(source.includes("const deliveryStatus = !hasProcessedSizes ? 'failed' : hasWarnings ? 'partial' : 'completed';"), 'SKU executor must classify completed/partial/failed status (deliveryStatus)');
assert(source.includes("const resultStatus = blockedByInvalidSkuTemplateLayout") && source.includes(": deliveryStatus;"), 'SKU executor must layer blocked-template status over deliveryStatus');
assert(source.includes("partial: resultStatus === 'partial'"), 'SKU executor must expose partial flag');
assert(source.includes('warnings: allCopyErrors'), 'SKU executor must expose warning details');
assert(source.includes('success: processedSizes.length > 0'), 'SKU executor must preserve existing success criterion for UI compatibility');

console.log('[smoke-sku-result-status] pass');
