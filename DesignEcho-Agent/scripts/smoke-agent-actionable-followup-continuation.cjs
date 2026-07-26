const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  DesignAgentEngine
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function createContext(userInput, overrides = {}) {
  const base = {
    userInput,
    conversationHistory: [],
    isPluginConnected: false,
    photoshopContext: {
      hasDocument: false,
      documentName: '',
      activeLayerName: '',
      layerCount: 0
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 0,
      projectImageFolders: [],
      sampleImagePaths: []
    }
  };

  return {
    ...base,
    ...overrides,
    photoshopContext: {
      ...base.photoshopContext,
      ...(overrides.photoshopContext || {})
    },
    projectContext: {
      ...base.projectContext,
      ...(overrides.projectContext || {})
    }
  };
}

async function run() {
  const explicitSearchRoute = fastDeterministicRoute('搜索一下桑蚕丝男袜相关参考');
  assert(
    explicitSearchRoute?.skillId === 'design-reference-search',
    'Explicit design reference search should route to design-reference-search.',
    explicitSearchRoute
  );
  assert(
    /桑蚕丝|男袜/.test(String(explicitSearchRoute.skillParams?.query || '')),
    'Design reference search route should preserve the user search target in query params.',
    explicitSearchRoute
  );

  const competitiveSearchRoute = fastDeterministicRoute('你帮我搜索项目中的竞品同款');
  assert(
    competitiveSearchRoute?.skillId === 'design-reference-search',
    'Competitive same-style search should route to design-reference-search instead of asking for clarification.',
    competitiveSearchRoute
  );
  assert(
    /竞品|同款/.test(String(competitiveSearchRoute.skillParams?.query || '')),
    'Competitive search route should preserve competitive/same-style intent in query params.',
    competitiveSearchRoute
  );

  const similarStyleSearchRoute = fastDeterministicRoute('找相似风格的设计方案');
  assert(
    similarStyleSearchRoute?.skillId === 'design-reference-search',
    'Similar-style design plan search should route to design-reference-search instead of asking follow-up questions.',
    similarStyleSearchRoute
  );
  assert(
    /相似风格|设计方案/.test(String(similarStyleSearchRoute.skillParams?.query || '')),
    'Similar-style search route should preserve style and design-plan intent in query params.',
    similarStyleSearchRoute
  );

  const searchLifecycle = buildAgentRequestLifecycle({
    userInput: '搜索一下桑蚕丝男袜相关参考',
    context: createContext('搜索一下桑蚕丝男袜相关参考'),
    routeSource: 'deterministic_route',
    route: 'skill_execution',
    skillId: 'design-reference-search',
    executionKind: 'deterministic_skill',
    intentSummary: '搜索桑蚕丝男袜相关视觉参考。',
    reason: '用户明确请求只读外部参考检索。'
  });
  assert(
    searchLifecycle.execution.requiresPhotoshop === false,
    'Design reference search is not a Photoshop write/read task and must not require Photoshop connection.',
    searchLifecycle.execution
  );
  assert(
    searchLifecycle.execution.canStart === true,
    'Design reference search should be startable without an open Photoshop document.',
    searchLifecycle.execution
  );

  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];

  skillExecutors.getSkillExecutor = (skillId) => {
    if (skillId === 'design-reference-search') {
      return { skillId, execute: async () => ({ success: true, message: 'stub' }) };
    }
    return originalGetSkillExecutor(skillId);
  };
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || {} });
    return {
      success: true,
      message: '已完成设计参考检索。',
      data: {
        executionSummary: {
          status: 'completed',
          summaryText: '设计参考检索已完成。'
        }
      }
    };
  };

  try {
    const engine = new DesignAgentEngine();
    const result = await engine.run(createContext('开始', {
      conversationHistory: [
        { role: 'user', content: '那你搜索一下桑蚕丝男袜相关参考' },
        {
          role: 'assistant',
          content: '我会先搜索桑蚕丝男袜的视觉参考，并整理材质、色彩和排版方向。'
        }
      ]
    }), {
      callModel: async (_messages, options) => {
        if (options?.purpose === 'visible_reasoning') {
          return { text: '承接上一轮目标，直接开始检索参考。' };
        }
        return { text: '我能看到上一轮的检索目标，但这条“开始”没有绑定可恢复操作；不会从聊天文字自动重放任务。' };
      }
    });

    assert(
      executed.length === 0,
      'A bare “开始” without structured lifecycle must not resurrect a task from assistant prose.',
      { executed, result }
    );
    assert(
      result?.data?.agentRequestLifecycle?.execution?.kind === 'none'
        && result?.data?.agentRequestLifecycle?.decision?.route === 'direct_response',
      'Bare “开始” must remain a no-tools direct response when no structured continuation exists.',
      result?.data?.agentRequestLifecycle
    );

    executed.length = 0;
    let publicPlanCalls = 0;
    const focusedCopyRequest = [
      '帮我修改第三屏文案',
      '图层组是 3-产品信息/icon 下有文案内容，是带有氛围场景的文案，我需要你提供三版不同的文案'
    ].join('\n');
    const focusedCopyContinuation = await engine.run(createContext('可以', {
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: 'detail-page.psd',
        activeLayerName: '3-产品信息/icon',
        layerCount: 48
      },
      conversationHistory: [
        { role: 'user', content: focusedCopyRequest },
        {
          role: 'assistant',
          content: '我会先读取「3-产品信息/icon」图层组中的文本内容，找到现有氛围场景文案，稍后提供三版候选。'
        }
      ]
    }), {
      callModel: async (_messages, options) => {
        if (options?.purpose === 'visible_reasoning') {
          return { text: '承接上一轮局部文案修改，先读取目标组和现有文本，再生成三版候选。' };
        }
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              directResponse: '好的，稍后为你处理。',
              intentSummary: '错误地把已确认的局部修改降级成口头承诺。'
            })
          };
        }
        if (options?.purpose === 'agent_task_public_plan') {
          publicPlanCalls += 1;
        }
        return { text: '我能看到上一轮的文案目标，但这条确认没有绑定到可恢复卡片操作；不会据此自动写入 Photoshop。' };
      }
    });

    assert(
      executed.length === 0,
      '“可以”紧跟无 owner 的通用卡片或助手承诺时，不得重建 autonomous Photoshop 任务。',
      { executed, focusedCopyContinuation }
    );
    assert(
      focusedCopyContinuation?.data?.agentRequestLifecycle?.execution?.kind === 'none'
        && focusedCopyContinuation?.data?.agentRequestLifecycle?.decision?.route === 'direct_response',
      '无结构化 lifecycle 的“可以”只能做无工具回复，不能获得 Photoshop 写权限。',
      focusedCopyContinuation?.data?.agentRequestLifecycle
    );
    assert(
      publicPlanCalls === 0,
      '已明确且已确认的局部修改续跑不得再次生成公开计划。',
      { publicPlanCalls, focusedCopyContinuation }
    );
    assert(focusedCopyContinuation?.data?.agentRequestLifecycle?.execution?.requiresPhotoshop === false);

    executed.length = 0;
    const conversionImageRequest = [
      '我想你帮我继续完成转化图的第五张图，主要突出产品的穿搭表现。',
      '你需要先理解产品、找一些参考，再推理哪个参考更适合以及怎么设计。'
    ].join('');
    const conversionImageContinuation = await engine.run(createContext('继续', {
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: '800.psb',
        activeLayerName: '转化图/5',
        layerCount: 48
      },
      conversationHistory: [
        { role: 'user', content: conversionImageRequest },
        {
          role: 'assistant',
          content: '下一步我会先确认现有素材和第五张图，再整理穿搭参考并开始设计。'
        }
      ]
    }), {
      callModel: async (_messages, options) => {
        if (options?.purpose === 'visible_reasoning') {
          return { text: '承接上一轮第五张转化图目标，继续观察素材并推进设计。' };
        }
        if (options?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              directResponse: '我会继续帮你分析。',
              intentSummary: '错误地把已委托的设计任务降级成口头说明。'
            })
          };
        }
        return { text: '上一轮任务没有结构化续跑记录；我不会仅凭“继续”重新执行整项设计。' };
      }
    });

    assert(
      executed.length === 0,
      '即使历史里有明确设计交付描述，裸“继续”也不得绕过结构化续跑边界。',
      { executed, conversionImageContinuation }
    );
    assert(
      conversionImageContinuation?.data?.agentResumeExecutionPolicy?.shouldRunPhotoshop === false,
      '文本历史只能作为上下文，不能成为 Photoshop 执行授权。',
      conversionImageContinuation?.data
    );

    executed.length = 0;
    const purePlanContinuation = await engine.run(createContext('继续', {
      conversationHistory: [
        { role: 'user', content: '这个主图怎么做比较好' },
        { role: 'assistant', content: '我可以继续说明主图的构图和卖点层级。' }
      ]
    }), {
      callModel: async () => ({ text: '建议先明确主体、卖点和画面层级。' })
    });
    assert(
      executed.length === 0,
      '纯方案问题后的“继续”不能被升级成 Photoshop 执行授权。',
      { executed, purePlanContinuation }
    );
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  console.log(JSON.stringify({
    success: true,
    checks: [
      'explicit design reference search routes to design-reference-search',
      'design-reference-search lifecycle does not require Photoshop',
      'bare continuation never resurrects work from assistant prose',
      'ownerless confirmation stays context-only and performs zero Photoshop writes',
      'mixed execution-and-reasoning history still requires a structured continuation owner'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
