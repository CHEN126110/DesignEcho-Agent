#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skillIds = ['main-image-design', 'detail-page-design', 'sku-batch'];

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relativePath} is missing`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include ${needle}`);
}

function assertNotIncludes(text, needle, label) {
  assert(!text.includes(needle), `${label} must not define the top-level Agent as ${needle}`);
}

function assertAllIncludes(text, needles, label) {
  for (const needle of needles) {
    assertIncludes(text, needle, label);
  }
}

const doc = read('docs/business-skill-design-governance.md');
const plan = read('project-memory/Plan.md');
const intake = read('project-memory/Intake.md');
const currentTask = read('project-memory/CurrentTask.md');
const status = read('project-memory/Status.md');
const skillDeclarations = read('src/shared/skills/skill-declarations.ts');
const agentPrompt = read('src/shared/prompts/agent-prompt.ts');
const enhancedAgentPrompt = read('src/shared/prompts/enhanced-agent-prompt.ts');
const referenceAnalysisPrompt = read('src/shared/prompts/reference-analysis.ts');
const visualUnderstandingPrompt = read('src/shared/prompts/visual-understanding.ts');
const chatPanel = read('src/renderer/components/ChatPanel.tsx');
const socksKnowledge = read('src/shared/knowledge/socks-categories.ts');
const projectImageAnalysisExecutor = read('src/renderer/services/skill-executors/project-image-analysis.executor.ts');
const packageJson = JSON.parse(read('package.json'));
const forbiddenTopLevelIdentityPhrases = [
  '专业' + '电商设计智能体',
  '资深' + '电商视觉设计专家',
  '资深' + '电商设计分析专家',
  '电商设计' + ' Agent',
  'e-commerce design' + ' agent'
];

assertAllIncludes(doc, skillIds, 'business skill governance doc');
assertAllIncludes(doc, [
  'User Checkpoint Rule',
  'design standards',
  'Knowledge And Recipe',
  'Design DSL',
  'Photoshop Execution',
  'Verification And QA',
  'Unified Pre-Change Checkpoint',
  'src/shared/business-skill-implementation-checkpoint.ts',
  'Do not change these three skills without the user checkpoint',
  'Passing this gate does not mean the three design skills are complete'
], 'business skill governance doc');

assertAllIncludes(plan, [
  'AGENT-REACT-REFLEXION-GOVERNANCE-001',
  'Skill / Tool 边界',
  'docs/business-skill-design-governance.md',
  'main-image-design',
  'detail-page-design',
  'sku-batch',
  '业务 skill 具体设计策略前必须先用户 checkpoint'
], 'Plan.md');

assertAllIncludes(intake, [
  'INTAKE-031',
  '主图、详情页、SKU 三个业务 skill 拆分治理',
  '设计规范',
  '知识库',
  '改动前必须先告知用户'
], 'Intake.md');

assertAllIncludes(currentTask, [
  '详情页、主图、SKU',
  'Skill 是任务能力 manifest',
  'Tool 是命名空间化',
  'ReAct / Reflexion'
], 'CurrentTask.md');

assertAllIncludes(status, [
  'AGENT-REACT-REFLEXION-GOVERNANCE-001',
  'business-skill-design-governance'
], 'Status.md');

for (const skillId of skillIds) {
  assertIncludes(skillDeclarations, `id: '${skillId}'`, 'skill-declarations.ts');
}

assertAllIncludes(agentPrompt, [
  '通用 Photoshop 设计 Agent',
  '资深视觉设计师、设计策略伙伴和 Photoshop 操控专家',
  '电商、品牌、平面、社媒与商业视觉场景'
], 'agent-prompt.ts');

assertAllIncludes(enhancedAgentPrompt, [
  '资深视觉设计师和 Photoshop 设计 Agent',
  '创意伙伴'
], 'enhanced-agent-prompt.ts');
assertNotIncludes(
  enhancedAgentPrompt,
  '我可以帮你优化设计布局、撰写电商文案、生成主图/SKU 等',
  'enhanced-agent-prompt.ts'
);

assertAllIncludes(chatPanel, [
  '<h2>DesignEcho</h2>',
  '我是 DesignEcho，已加载当前项目的工作流，可以直接告诉我你的设计需求。'
], 'ChatPanel.tsx');
assertNotIncludes(
  chatPanel,
  '通用 Photoshop 设计 Agent',
  'ChatPanel.tsx'
);

for (const [label, text] of [
  ['agent-prompt.ts', agentPrompt],
  ['enhanced-agent-prompt.ts', enhancedAgentPrompt],
  ['reference-analysis.ts', referenceAnalysisPrompt],
  ['visual-understanding.ts', visualUnderstandingPrompt],
  ['ChatPanel.tsx', chatPanel],
  ['socks-categories.ts', socksKnowledge],
  ['project-image-analysis.executor.ts', projectImageAnalysisExecutor]
]) {
  for (const phrase of forbiddenTopLevelIdentityPhrases) {
    assertNotIncludes(text, phrase, label);
  }
}

assert(
  packageJson.scripts?.['smoke:business-skill:design-governance'] === 'node scripts/smoke-business-skill-design-governance.cjs',
  'package.json must register smoke:business-skill:design-governance'
);

const result = {
  status: 'ok',
  checkedSkills: skillIds,
  governanceDoc: 'docs/business-skill-design-governance.md',
  topLevelAgentIdentity: 'general-photoshop-design-agent',
  userCheckpointRequired: true,
  changesBusinessExecutors: false,
  qualityClaim: false
};

console.log(JSON.stringify(result, null, 2));
