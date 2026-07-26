const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skuExecutor = fs.readFileSync(path.join(root, 'src/renderer/services/skill-executors/sku-batch.executor.ts'), 'utf8');
const sourcePlan = fs.readFileSync(path.join(root, 'src/shared/sku-card-source-preparation-plan.ts'), 'utf8');

function assertContains(content, text, label) {
  if (!content.includes(text)) {
    throw new Error(`${label}: missing ${text}`);
  }
}

assertContains(skuExecutor, 'SKU 色卡素材候选', 'SKU runtime reports source-material candidate count instead of only template count');
assertContains(skuExecutor, '已视觉确认', 'SKU runtime reports visual confirmation count');
assertContains(skuExecutor, '待观察', 'SKU runtime reports unobserved candidate count');
assertContains(skuExecutor, 'executeToolCall(toolName, toolParams, { signal })', 'SKU safe tool calls pass abort signal');
assertContains(skuExecutor, "executeToolCall('listDocuments', { includeDetails: true }, { signal })", 'SKU document reads pass abort signal');
assertContains(skuExecutor, 'cancelled: true', 'SKU executor can return cancelled result');
assertContains(sourcePlan, 'blocked_candidates_not_ready', 'SKU source plan blocks unconfirmed candidates');
assertContains(sourcePlan, 'needsVisualConfirmation === false', 'SKU source plan only selects visually confirmed candidates');
assertContains(sourcePlan, 'createClippingMask', 'SKU card source plan requires clipping mask creation');
assertContains(sourcePlan, 'getAcceptanceSnapshot', 'SKU card source plan reads back the created source document');

console.log('smoke-sku-observation-cancel-wiring passed');
