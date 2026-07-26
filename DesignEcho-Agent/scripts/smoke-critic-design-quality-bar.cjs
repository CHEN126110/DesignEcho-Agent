// 守护：critic 的评审标尺是「设计质量」，而不是只查位置/对齐/连贯。
// 验证 critic 运行时真的注入了设计质量自检维度，并钉住「产品图+居中字=排版=needs_fix」红线，
// 且保留 verdict JSON 格式（design-team-verdict.ts 的解析依赖它）。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

const { getDesignTeammateDefinition } = require(
  path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'registry.ts')
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const critic = getDesignTeammateDefinition('critic');
const prompt = String(critic.systemPrompt || '');

assert(prompt.includes('设计质量'), 'critic 应明确评审「设计质量」');
assert(
  !prompt.includes('Focus on placement, hierarchy, copy fit, and visual coherence'),
  'critic 不应退回「只查位置/层级/文案/连贯」的旧排版标尺'
);

// 运行时真的注入了设计质量自检维度（来自 design-principles 底座）
for (const dim of ['视觉冲击', '卖点视觉化', '构图', '色彩', '视觉层次', '字体', '品质']) {
  assert(prompt.includes(dim), `critic 评分基准应包含设计维度「${dim}」`);
}

// 排版及格线红线：产品图+居中字一律 needs_fix
assert(
  prompt.includes('产品图') && prompt.includes('居中') && prompt.includes('needs_fix'),
  'critic 应把「产品图+居中文字」这类排版及格线产物判为 needs_fix'
);

// verdict 机读格式必须保留（否则 design-team-verdict 解析失败）
assert(
  prompt.includes('"verdict":"pass"') && prompt.includes('"verdict":"needs_fix"'),
  'critic 必须保留 verdict 的 pass/needs_fix JSON 格式'
);

console.log('[smoke-critic-design-quality-bar] passed');
