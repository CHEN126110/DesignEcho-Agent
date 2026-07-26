// 通用视觉设计原理底座守护：确认构图/色彩/层次/字体/品质五大原理 + 设计质量自检维度齐全，
// 且明确「产品图+居中文字」这条排版及格线红线（critic / 设计验收的评分基准）。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildDesignPrinciplesSummary,
  DESIGN_PRINCIPLE_FOCUS_VALUES,
  DESIGN_QUALITY_DIMENSIONS
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'knowledge', 'design-principles.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const all = buildDesignPrinciplesSummary('all');
for (const title of [
  '构图原理', '色彩原理', '视觉层次原理', '字体排印原理', '品质营造原理',
  '可用性与可访问性（WCAG 基线）', '图像技术质量', '常见设计反模式检查表', '设计决策优先级',
  '设计质量自检清单'
]) {
  assert(all.includes(title), `全量应包含模块「${title}」`);
}

assert(buildDesignPrinciplesSummary('color').includes('60-30-10'), 'color 焦点应含主辅点缀 60-30-10');
assert(buildDesignPrinciplesSummary('composition').includes('视觉焦点'), 'composition 焦点应含视觉焦点');
assert(buildDesignPrinciplesSummary('hierarchy').includes('主次三级'), 'hierarchy 焦点应含主次三级');
assert(buildDesignPrinciplesSummary('typography').includes('字重'), 'typography 焦点应含字重对比');
assert(buildDesignPrinciplesSummary('craft').includes('立体感'), 'craft 焦点应含立体感');

// 后补的「可检测底线」四模块：WCAG 数值门槛、图像技术缺陷、可枚举反模式、优先级规则
const accessibility = buildDesignPrinciplesSummary('accessibility');
assert(accessibility.includes('4.5:1') && accessibility.includes('3:1'), 'accessibility 焦点应含 WCAG 文本/非文本对比度门槛');
assert(accessibility.includes('24'), 'accessibility 焦点应含触控目标最小尺寸');
const imageQuality = buildDesignPrinciplesSummary('image-quality');
assert(imageQuality.includes('光晕') && imageQuality.includes('塑料感'), 'image-quality 焦点应含锐化光晕/降噪塑料感回退规则');
const antiPatterns = buildDesignPrinciplesSummary('anti-patterns');
assert(antiPatterns.includes('风格漂移'), 'anti-patterns 焦点应含品牌/风格漂移反模式');
const decisionPriority = buildDesignPrinciplesSummary('decision-priority');
assert(decisionPriority.includes('识别、点击、阅读'), 'decision-priority 焦点应含任务目标优先于装饰的规则');

// 排版及格线红线必须存在——这是把「设计质量」从「操作正确」里分出来的关键
const selfCheck = buildDesignPrinciplesSummary('self-check');
assert(selfCheck.includes('产品图') && selfCheck.includes('居中'), '自检清单应明确「产品图+居中文字」的排版及格线红线');

assert(Array.isArray(DESIGN_QUALITY_DIMENSIONS) && DESIGN_QUALITY_DIMENSIONS.length === 8, '应有 8 个设计质量维度');
assert(DESIGN_QUALITY_DIMENSIONS.some((d) => d.key === 'selling_point_visual'), '质量维度应包含「卖点视觉化」');
assert(DESIGN_QUALITY_DIMENSIONS.some((d) => d.key === 'impact'), '质量维度应包含「视觉冲击力」');

assert(DESIGN_PRINCIPLE_FOCUS_VALUES.length === 12, 'focus 应为 12 个（all + 11 个模块，含新增的可检测底线四模块）');

console.log('[smoke-design-principles] passed');
