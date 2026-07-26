#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const agentRoot = path.resolve(__dirname, '..');
const executorPath = path.join(agentRoot, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const sharedPath = path.join(agentRoot, 'src', 'shared', 'sku-configured-execution-plan.ts');
const packagePath = path.join(agentRoot, 'package.json');

const {
  buildSkuConfiguredExecutionPlan,
  buildSkuConfiguredExecutionBlockerMessage,
  parseSkuColorSlots
} = require(sharedPath);
const {
  buildSkuLayoutExecutionBatches
} = require(path.join(agentRoot, 'src', 'shared', 'sku-layout-execution-batches.ts'));

const colors = ['白色', '浅肤', '浅灰', '深灰', '奶白', '黑色'];

assert.deepStrictEqual(parseSkuColorSlots('123456'), [1, 2, 3, 4, 5, 6], 'compact SKU color slot sequence should map one digit to one placeholder');
assert.deepStrictEqual(parseSkuColorSlots('1+2|2+3'), [1, 2, 2, 3], 'pipe-separated SKU color slots should remain one ordered placeholder sequence');
assert.deepStrictEqual(parseSkuColorSlots('1，2、3 4'), [1, 2, 3, 4], 'Chinese separators and spaces should parse as ordered SKU color slots');

const fixtureCsv = [
  '模板,配色',
  '2双装.tif,1+1',
  '2双装.tif,1+2',
  '2双装.tif,1+3',
  '2双装.tif,1+4',
  '2双装.tif,1+5',
  '2双装.tif,1+6',
  '2双自选备注.tif,1+2+3+4+5+6',
  '3双装.tif,1+1+2',
  '3双装.tif,1+1+3',
  '3双装.tif,1+1+4',
  '3双装.tif,1+1+5',
  '3双装.tif,1+1+6',
  '3双自选备注.tif,1+2+3+4+5+6',
  '4双装.tif,1+1+2+3',
  '4双装.tif,1+1+2+4',
  '4双装.tif,1+1+2+5',
  '4双装.tif,1+1+2+6',
  '4双装.tif,1+1+3+4',
  '4双自选备注.tif,1+2+3+4+5+6'
].join('\n');

const plan = buildSkuConfiguredExecutionPlan({
  csvConfigs: [{
    fileName: '6色 2-3-4.csv',
    text: fixtureCsv
  }],
  comboTemplates: [
    { fileName: '2双装.tif', filePath: 'C:\\project\\模板文件\\2双装.tif' },
    { fileName: '3双装.tif', filePath: 'C:\\project\\模板文件\\3双装.tif' },
    { fileName: '4双装.tif', filePath: 'C:\\project\\模板文件\\4双装.tif' }
  ],
  noteTemplates: [
    { fileName: '2双自选备注.tif', filePath: 'C:\\project\\模板文件\\2双自选备注.tif' },
    { fileName: '3双自选备注.tif', filePath: 'C:\\project\\模板文件\\3双自选备注.tif' },
    { fileName: '4双自选备注.tif', filePath: 'C:\\project\\模板文件\\4双自选备注.tif' }
  ],
  availableColorNames: colors
});

assert.strictEqual(plan.schema, 'sku-configured-execution-plan/v0');
assert.strictEqual(plan.status, 'ready_configured_execution_plan');
assert.strictEqual(plan.configFileName, '6色 2-3-4.csv');
assert.strictEqual(plan.colorSlotCount, 6);
assert.strictEqual(plan.comboExecutionCount, 16);
assert.strictEqual(plan.noteExecutionCount, 3);
assert.deepStrictEqual(plan.sizes.map((item) => item.size), [2, 3, 4]);
assert.deepStrictEqual(plan.sizes[0].comboRows[0].colorNames, ['白色', '白色']);
assert.deepStrictEqual(plan.sizes[2].comboRows[4].colorNames, ['白色', '白色', '浅灰', '深灰']);
assert.deepStrictEqual(plan.sizes[0].noteRows[0].colorNames, colors);
assert.deepStrictEqual(plan.blockers, []);
assert.strictEqual(plan.boundaries.claimsSkuCompletion, false);
assert.strictEqual(plan.boundaries.claimsDesignQuality, false);

const twoPairBatches = buildSkuLayoutExecutionBatches({
  action: 'execute',
  size: 2,
  rows: plan.sizes[0].comboRows,
  maxRowsPerToolCall: 1
});
assert.strictEqual(
  twoPairBatches.length,
  plan.sizes[0].comboRows.length,
  'configured SKU combo execution must be split into one-row tool calls to avoid long MCP requests'
);
assert(
  twoPairBatches.every((batch) => batch.rows.length === 1 && batch.combos.length === 1),
  'no configured SKU combo batch should carry the full size row set'
);
assert.deepStrictEqual(
  twoPairBatches[0].combos[0],
  ['白色', '白色'],
  'batch builder should preserve configured color order'
);

const noteBatches = buildSkuLayoutExecutionBatches({
  action: 'arrangeDynamic',
  size: 2,
  rows: plan.sizes[0].noteRows,
  maxRowsPerToolCall: 1
});
assert.strictEqual(noteBatches.length, 1, 'self-select note rows should still use the same chunk contract.');
assert.deepStrictEqual(noteBatches[0].combos[0], colors, 'note batch should preserve configured self-select colors.');

const backupFirstPlan = buildSkuConfiguredExecutionPlan({
  csvConfigs: [
    {
      fileName: '1旧表备份.csv',
      text: [
        '模板,配色',
        '2双装.tif,1+1'
      ].join('\n')
    },
    {
      fileName: '6色 2-3-4.csv',
      text: fixtureCsv
    }
  ],
  comboTemplates: [
    { fileName: '2双装.tif', filePath: 'C:\\project\\模板文件\\2双装.tif' },
    { fileName: '3双装.tif', filePath: 'C:\\project\\模板文件\\3双装.tif' },
    { fileName: '4双装.tif', filePath: 'C:\\project\\模板文件\\4双装.tif' }
  ],
  noteTemplates: [
    { fileName: '2双自选备注.tif', filePath: 'C:\\project\\模板文件\\2双自选备注.tif' },
    { fileName: '3双自选备注.tif', filePath: 'C:\\project\\模板文件\\3双自选备注.tif' },
    { fileName: '4双自选备注.tif', filePath: 'C:\\project\\模板文件\\4双自选备注.tif' }
  ],
  availableColorNames: colors
});
assert.strictEqual(backupFirstPlan.status, 'ready_configured_execution_plan');
assert.strictEqual(backupFirstPlan.configFileName, '6色 2-3-4.csv');
assert(
  backupFirstPlan.warnings.some((item) => item.includes('已选择 SKU CSV 配置 6色 2-3-4.csv')),
  'multiple CSV candidates should produce a selection warning'
);

const ambiguousPlan = buildSkuConfiguredExecutionPlan({
  csvConfigs: [
    { fileName: '6色 2-3-4 A.csv', text: fixtureCsv },
    { fileName: '6色 2-3-4 B.csv', text: fixtureCsv }
  ],
  comboTemplates: [
    { fileName: '2双装.tif', filePath: 'C:\\project\\模板文件\\2双装.tif' },
    { fileName: '3双装.tif', filePath: 'C:\\project\\模板文件\\3双装.tif' },
    { fileName: '4双装.tif', filePath: 'C:\\project\\模板文件\\4双装.tif' }
  ],
  noteTemplates: [
    { fileName: '2双自选备注.tif', filePath: 'C:\\project\\模板文件\\2双自选备注.tif' },
    { fileName: '3双自选备注.tif', filePath: 'C:\\project\\模板文件\\3双自选备注.tif' },
    { fileName: '4双自选备注.tif', filePath: 'C:\\project\\模板文件\\4双自选备注.tif' }
  ],
  availableColorNames: colors
});
assert.strictEqual(ambiguousPlan.status, 'blocked_configured_execution_plan');
assert(
  ambiguousPlan.blockers.some((item) => item.includes('多个 SKU CSV 配置')),
  'ambiguous high-quality SKU CSV configs should block instead of silently picking one'
);

const missingColorPlan = buildSkuConfiguredExecutionPlan({
  csvConfigs: [{
    fileName: '6色 2-3-4.csv',
    text: fixtureCsv
  }],
  comboTemplates: [
    { fileName: '2双装.tif', filePath: 'C:\\project\\模板文件\\2双装.tif' },
    { fileName: '3双装.tif', filePath: 'C:\\project\\模板文件\\3双装.tif' },
    { fileName: '4双装.tif', filePath: 'C:\\project\\模板文件\\4双装.tif' }
  ],
  noteTemplates: [
    { fileName: '2双自选备注.tif', filePath: 'C:\\project\\模板文件\\2双自选备注.tif' },
    { fileName: '3双自选备注.tif', filePath: 'C:\\project\\模板文件\\3双自选备注.tif' },
    { fileName: '4双自选备注.tif', filePath: 'C:\\project\\模板文件\\4双自选备注.tif' }
  ],
  availableColorNames: colors.slice(0, 5)
});
assert.strictEqual(missingColorPlan.status, 'blocked_configured_execution_plan');
assert(
  missingColorPlan.blockers.some((item) => item.includes('SKU 素材只有 5 个可用颜色组，配置文件需要 6 个颜色槽')),
  'missing color group blocker should be business-readable Chinese'
);
assert(
  missingColorPlan.blockers.some((item) => item.includes('CSV 第 7 行引用了不存在的第 6 个颜色槽')),
  'missing color slot row blocker should be business-readable Chinese'
);
const blockerMessage = buildSkuConfiguredExecutionBlockerMessage({
  plan: missingColorPlan,
  skuDocName: 'SKU.psb',
  userRequestedExplicitCombos: false
});
assert(blockerMessage.includes('SKU 暂时没有开始生成'), 'configured blocker message should clearly say execution did not start');
assert(blockerMessage.includes('SKU.psb'), 'configured blocker message should name the SKU source document');
assert(blockerMessage.includes('SKU 素材只有 5 个可用颜色组，配置文件需要 6 个颜色槽'), 'configured blocker message should preserve the primary business blocker');
assert(blockerMessage.includes('补齐第 6 个颜色组') || blockerMessage.includes('5 色'), 'configured blocker message should give a recovery path');
assert(!/blocked_configured_execution_plan|confidence|置信/i.test(blockerMessage), 'configured blocker message must not expose internal status or confidence text');

const serialized = JSON.stringify(plan);
assert(!/confidence|置信/i.test(serialized), 'configured SKU plan must not expose confidence fields');
assert(!/data:image|base64|rawImage/i.test(serialized), 'configured SKU plan must not expose raw image payloads');

const executorSource = fs.readFileSync(executorPath, 'utf8');
assert(
  executorSource.includes('buildSkuConfiguredExecutionPlan'),
  'sku-batch executor must import and use the shared configured execution plan builder'
);
assert(
  executorSource.includes('scanProjectSkuConfigFiles'),
  'sku-batch executor must scan the project 配置文件 folder for SKU CSV configs'
);
assert(
  executorSource.includes('skuConfiguredExecutionPlan'),
  'sku-batch executor result data must expose skuConfiguredExecutionPlan'
);
assert(
  executorSource.includes('buildSkuConfiguredExecutionBlockerMessage'),
  'sku-batch executor should use a shared business-readable blocker message for blocked project SKU configs'
);
assert(
  executorSource.includes('blockedByConfiguredExecutionPlan'),
  'sku-batch executor should stop before fallback generation when project SKU config exists but is not executable'
);
assert(
  executorSource.includes('configuredNoteCombosBySize'),
  'sku-batch executor must drive self-select note generation from configured note rows when present'
);
assert(
  executorSource.includes('buildSkuLayoutComboBatches'),
  'sku-batch executor must split SKU layout writes through the shared batch helper'
);
assert(
  !executorSource.includes('combos: combos,'),
  'sku-batch executor must not send a whole size worth of combos in one skuLayout call'
);
assert(
  executorSource.includes('sku-layout-${size}-batch-${batch.batchIndex}'),
  'sku-batch executor should label per-batch skuLayout calls for diagnosable progress'
);

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
assert(
  packageJson.scripts['smoke:sku:configured-execution-plan'],
  'package.json should expose smoke:sku:configured-execution-plan'
);
assert(
  String(packageJson.scripts['maintenance:preflight'] || '').includes('smoke:sku:configured-execution-plan'),
  'maintenance:preflight should include smoke:sku:configured-execution-plan'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'SKU CSV config parses into a reusable 2/3/4 configured execution plan',
    'configured plan selects the strongest SKU CSV candidate instead of the first filename',
    'ambiguous high-quality SKU CSV candidates block instead of silently picking one',
    'configured plan explains missing color-slot blockers in business-readable Chinese',
    'configured plan blocker message gives a user-visible recovery path without internal status codes',
    'configured plan maps CSV color slots to real SKU color layer names',
    'configured plan includes self-select note rows without claiming design quality',
    'real sku-batch executor is wired to scan project config files and expose the configured plan'
  ]
}, null, 2));
