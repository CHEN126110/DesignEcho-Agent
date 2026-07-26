#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  DesignTeamCoordinator
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'coordinator.ts'));
const {
  listDesignTeammateDefinitions,
  getDesignTeammateDefinition
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'registry.ts'));
const {
  buildDesignTeamRuntimeBudget
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-performance-policy.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const definitions = listDesignTeammateDefinitions();
  const roles = definitions.map((item) => item.role).sort();
  record(
    'teammate-definitions',
    JSON.stringify(roles) === JSON.stringify(['copywriter', 'critic', 'design-strategist', 'executor', 'market-researcher', 'scene-analyst']),
    { roles }
  );

  const iterationDefaults = Object.fromEntries(definitions.map((item) => [item.role, item.maxIterations]));
  record(
    'teammate-runtime-budgets-from-policy',
    iterationDefaults['scene-analyst'] === buildDesignTeamRuntimeBudget({ role: 'scene-analyst' }).maxIterations
      && iterationDefaults['market-researcher'] === buildDesignTeamRuntimeBudget({ role: 'market-researcher' }).maxIterations
      && iterationDefaults.copywriter === buildDesignTeamRuntimeBudget({ role: 'copywriter' }).maxIterations
      && iterationDefaults['design-strategist'] === buildDesignTeamRuntimeBudget({ role: 'design-strategist' }).maxIterations
      && iterationDefaults.executor === buildDesignTeamRuntimeBudget({ role: 'executor' }).maxIterations
      && iterationDefaults.critic === buildDesignTeamRuntimeBudget({ role: 'critic' }).maxIterations
      && iterationDefaults.executor === 12
      && iterationDefaults.copywriter === 8
      && iterationDefaults['market-researcher'] === 8
      && iterationDefaults.critic === 8,
    { iterationDefaults }
  );

  const critic = getDesignTeammateDefinition('critic');
  const executor = getDesignTeammateDefinition('executor');
  const copywriter = getDesignTeammateDefinition('copywriter');
  const marketResearcher = getDesignTeammateDefinition('market-researcher');
  record(
    'tool-boundaries',
    critic.canWriteToPhotoshop === false
      && !critic.allowedTools.includes('setTextStyle')
      && copywriter.canWriteToPhotoshop === false
      && !copywriter.allowedTools.includes('setTextContent')
      && copywriter.allowedTools.includes('getMainImageDesignFramework')
      && marketResearcher.canWriteToPhotoshop === false
      && !marketResearcher.allowedTools.includes('setTextContent')
      && marketResearcher.allowedTools.includes('searchProjectResources')
      && executor.canWriteToPhotoshop === true
      && executor.allowedTools.includes('setTextStyle'),
    {
      criticCanWrite: critic.canWriteToPhotoshop,
      criticWriteTool: critic.allowedTools.includes('setTextStyle'),
      copywriterCanWrite: copywriter.canWriteToPhotoshop,
      copywriterWriteTool: copywriter.allowedTools.includes('setTextContent'),
      marketResearcherCanWrite: marketResearcher.canWriteToPhotoshop,
      marketResearcherWriteTool: marketResearcher.allowedTools.includes('setTextContent'),
      executorCanWrite: executor.canWriteToPhotoshop,
      executorWriteTool: executor.allowedTools.includes('setTextStyle')
    }
  );

  let modelCalls = 0;
  const toolCalls = [];
  const modelToolNames = [];
  const coordinator = new DesignTeamCoordinator({
    resolveDefaultModelId: () => 'test-model',
    executeTool: async (toolName, params) => {
      toolCalls.push({ toolName, params });
      return { success: true, documentName: '测试文档', params };
    },
    callModel: async (_modelId, _messages, tools) => {
      modelCalls += 1;
      modelToolNames.push(tools.map((tool) => tool.name));
      if (modelCalls === 1) {
        return {
          content: '',
          toolCalls: [{
            id: 'inspect-1',
            name: 'getDocumentInfo',
            arguments: {}
          }]
        };
      }
      return {
        content: '场景结构已检查，当前文档可继续设计。',
        toolCalls: []
      };
    }
  });

  const result = await coordinator.runTeammateTask({
    role: 'scene-analyst',
    task: '检查当前 Photoshop 场景结构',
    context: '只读检查，不允许修改 Photoshop。',
    maxIterations: 4
  });

  record(
    'coordinator-task-lifecycle',
    result.success === true
      && result.status === 'completed'
      && result.role === 'scene-analyst'
      && result.outputType === 'scene_summary'
      && result.messages.some((message) => message.type === 'task_status' && message.payload?.status === 'pending')
      && result.messages.some((message) => message.type === 'task_status' && message.payload?.status === 'running')
      && result.messages.some((message) => message.type === 'task_status' && message.payload?.status === 'completed'),
    {
      status: result.status,
      role: result.role,
      outputType: result.outputType,
      messageTypes: result.messages.map((message) => message.type)
    }
  );

  record(
    'coordinator-tool-scope',
    modelToolNames[0].includes('getDocumentInfo')
      && !modelToolNames[0].includes('setTextStyle'),
    {
      toolCalls,
      firstModelTools: modelToolNames[0]
    }
  );

  const pipelineMessages = [
    '场景分析：当前文档有产品区和标题区。',
    '市场洞察：用户最在意袜口勒脚和冬季脚冷。\n{"painPoints":["袜口勒脚"],"competitorNotes":["竞品强调厚度"]}',
    '文案策略：主标题要把不勒脚说清楚。\n{"sellingPoints":["软糯不勒脚"],"copywriting":[{"slot":"主标题","text":"软糯包脚，不勒不掉"}]}',
    '设计计划：主标题使用不勒脚卖点，产品主体保持居中。',
    '执行报告：已按计划完成初版。',
    '评审：主标题仍然泛泛，需要文案队友重出。\n{"verdict":"needs_fix","issues":[{"owner":"copy","target":"主标题","problem":"卖点不够具体","suggestion":"重写为不勒脚场景钩子"}]}',
    '修订文案：改成更具体的不勒脚表达。\n{"sellingPoints":["袜口不勒脚"],"copywriting":[{"slot":"主标题","text":"袜口不勒脚，久穿也舒服"}]}',
    '执行报告：已应用修订文案。',
    '评审：问题已解决。\n{"verdict":"pass"}'
  ];
  let pipelineCallIndex = 0;
  const statePatches = [];
  const previousWindow = global.window;
  global.window = {
    designEcho: {
      updateDesignState: async (projectPath, patch) => {
        statePatches.push({ projectPath, patch });
        return { success: true };
      }
    }
  };
  const pipelineCoordinator = new DesignTeamCoordinator({
    resolveDefaultModelId: () => 'test-model',
    executeTool: async () => ({ success: true }),
    callModel: async () => {
      const content = pipelineMessages[pipelineCallIndex++] || '补充完成。';
      return { content, toolCalls: [] };
    }
  });

  let pipelineResult;
  try {
    pipelineResult = await pipelineCoordinator.runPipeline({
      goal: '优化当前主图，突出袜口不勒脚',
      maxRevisions: 1,
      projectPath: 'D:\\fake-design-project'
    });
  } finally {
    global.window = previousWindow;
  }
  const pipelineRoles = pipelineResult.stages.map((stage) => stage.role);
  const pipelineStages = pipelineResult.stages.map((stage) => stage.stage);
  record(
    'pipeline-includes-market-and-copywriter-before-planning',
    pipelineRoles.slice(0, 5).join('>') === 'scene-analyst>market-researcher>copywriter>design-strategist>executor',
    { pipelineRoles, pipelineStages }
  );

  record(
    'pipeline-reroutes-copy-issue-to-copywriter-before-executor-apply',
    pipelineResult.success === true
      && pipelineResult.revisionRounds === 1
      && pipelineResult.verdict?.status === 'pass'
      && pipelineStages.includes('revise-1-copywriter')
      && pipelineStages.includes('revise-1-apply')
      && pipelineRoles[pipelineStages.indexOf('revise-1-copywriter')] === 'copywriter'
      && pipelineRoles[pipelineStages.indexOf('revise-1-apply')] === 'executor',
    {
      success: pipelineResult.success,
      revisionRounds: pipelineResult.revisionRounds,
      verdict: pipelineResult.verdict,
      pipelineRoles,
      pipelineStages
    }
  );

  const appendVersionPatches = statePatches.filter((item) => item.patch?.appendVersion);
  const appendLearningPatches = statePatches.filter((item) => item.patch?.appendLearning);
  record(
    'pipeline-writes-version-history-from-executor-stages',
    appendVersionPatches.length >= 2
      && appendVersionPatches.every((item) => item.projectPath === 'D:\\fake-design-project')
      && appendVersionPatches.some((item) => String(item.patch.appendVersion.reason).includes('初版'))
      && appendVersionPatches.some((item) => String(item.patch.appendVersion.reason).includes('修订文案')),
    { statePatches }
  );

  record(
    'pipeline-writes-a9-retrospective-learning',
    appendLearningPatches.length === 1
      && appendLearningPatches[0].projectPath === 'D:\\fake-design-project'
      && /主标题|copy|文案/.test(String(appendLearningPatches[0].patch.appendLearning || ''))
      && String(appendLearningPatches[0].patch.updatedBy || '').includes('pipeline-retrospective'),
    { appendLearningPatches }
  );

  assert(cases.every((item) => item.status === 'pass'), 'one or more design-team smoke cases failed');
}

main().catch((error) => {
  record('unexpected-exception', false, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  });
}).finally(() => {
  const failed = cases.filter((item) => item.status !== 'pass');
  const report = {
    generatedAt: new Date().toISOString(),
    success: failed.length === 0,
    cases
  };
  const jsonPath = path.join(tmpDir, 'design-team-coordinator-smoke.json');
  const mdPath = path.join(tmpDir, 'design-team-coordinator-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Design Team Coordinator Smoke',
      '',
      `success: ${report.success}`,
      '',
      ...cases.map((item) => `- ${item.name}: ${item.status}`)
    ].join('\n'),
    'utf8'
  );
  console.log(JSON.stringify({
    success: report.success,
    cases: cases.map(({ name, status }) => ({ name, status })),
    report: { json: jsonPath, md: mdPath }
  }, null, 2));
  process.exit(report.success ? 0 : 1);
});
