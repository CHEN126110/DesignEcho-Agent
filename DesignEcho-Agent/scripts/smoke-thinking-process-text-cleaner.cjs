// 验证过程区文本清理：剥离 markdown 强调/标题/代码标记与状态/装饰 emoji，
// 让 ThinkingProcess 的思考/执行行不再出现裸 ** 标记和彩色 ✅ 噪音；正常文本不受影响。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { cleanInlineProcessText } = require(
  path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'message', 'thinkingStepPresentation.ts')
);

function assert(condition, message, detail) {
  if (!condition) {
    throw new Error(`${message}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`);
  }
}

const cases = [
  ['✅ **convertToSmartObject 成功**', 'convertToSmartObject 成功'],
  ['**执行计划：** 创建文档', '执行计划： 创建文档'],
  ['使用 `batchPlay` 调用', '使用 batchPlay 调用'],
  ['*强调* 文本', '强调 文本'],
  ['创建文档', '创建文档'],
  ['720×420 透明画布', '720×420 透明画布']
];

for (const [input, expected] of cases) {
  const out = cleanInlineProcessText(input);
  assert(out === expected, '清理结果不符合预期', { input, out, expected });
}

// 标题标记按行剥离
assert(
  cleanInlineProcessText('## 复核目标\n验证四个工具') === '复核目标\n验证四个工具',
  '行首标题标记应被剥离'
);

// 状态/装饰 emoji 全部剥离
const emojiSample = '⚠️ 注意 ✅ 完成 ❌ 失败 🎉 🔥';
const emojiCleaned = cleanInlineProcessText(emojiSample);
assert(
  !/[✅✔✓☑❌✗✖✘⚠✨⭐🎉🔥🚨👍👌🎯🟢🔴🟡🟠🔵💡]/u.test(emojiCleaned),
  '状态/装饰 emoji 应被剥离',
  emojiCleaned
);

// 不应吞掉正常中文标点与内容
assert(cleanInlineProcessText('文档已创建。接下来创建矩形图层：') === '文档已创建。接下来创建矩形图层：', '正常中文应保持原样');

console.log('[smoke-thinking-process-text-cleaner] passed');
