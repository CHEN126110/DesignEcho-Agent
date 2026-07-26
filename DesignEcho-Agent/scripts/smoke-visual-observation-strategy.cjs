// 守护：主循环视觉观察策略——「强模型主导 + 视觉专家协同」。
// 主模型支持视觉则自己看；不支持但有可用视觉槽模型则委派视觉专家；都没有则如实告知无法核对（不假装看过）。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  resolveVisualObservationStrategy,
  VISUAL_EXPERT_OBSERVATION_PROMPT
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'visual-observation-strategy.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 主模型支持视觉 → 自己看（即使配了视觉专家也优先自己看）
assert(
  resolveVisualObservationStrategy({ primaryModelSupportsVision: true }) === 'primary-self',
  '主模型支持视觉应自己看图'
);
assert(
  resolveVisualObservationStrategy({ primaryModelSupportsVision: true, visualExpertModelId: 'x', visualExpertSupportsVision: true }) === 'primary-self',
  '主模型支持视觉时应优先自己看，不绕道专家'
);

// 主模型不支持视觉 + 有可用视觉专家 → 委派视觉专家（真协同）
assert(
  resolveVisualObservationStrategy({ primaryModelSupportsVision: false, visualExpertModelId: 'gemini', visualExpertSupportsVision: true }) === 'visual-expert',
  '主模型无视觉 + 有可用视觉专家应委派视觉专家'
);

// 主模型不支持视觉 + 无可用视觉专家 → 如实告知无法核对
assert(
  resolveVisualObservationStrategy({ primaryModelSupportsVision: false }) === 'no-visual-capability',
  '无视觉能力应如实告知'
);
assert(
  resolveVisualObservationStrategy({ primaryModelSupportsVision: false, visualExpertModelId: '', visualExpertSupportsVision: true }) === 'no-visual-capability',
  '视觉专家 id 为空应判无视觉能力'
);
assert(
  resolveVisualObservationStrategy({ primaryModelSupportsVision: false, visualExpertModelId: 'x', visualExpertSupportsVision: false }) === 'no-visual-capability',
  '视觉专家不支持视觉应判无视觉能力'
);

// 视觉专家指令覆盖设计质量维度 + 排版红线 + 不许编造
for (const keyword of ['主体', '构图', '层次', '遮挡', '可读', '排版', '设计感']) {
  assert(VISUAL_EXPERT_OBSERVATION_PROMPT.includes(keyword), `视觉专家指令应包含「${keyword}」`);
}
assert(
  VISUAL_EXPERT_OBSERVATION_PROMPT.includes('不要编造') || VISUAL_EXPERT_OBSERVATION_PROMPT.includes('绝不编造'),
  '视觉专家指令应要求不编造画面上看不到的内容'
);

console.log('[smoke-visual-observation-strategy] passed');
