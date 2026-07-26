#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  buildEcommerceSocksChildDispatchRun,
  buildEcommerceSocksDesignState,
  buildEcommerceSocksDispatchAuthorization,
  buildEcommerceSocksDispatchDecision,
  buildEcommerceSocksDispatchLifecycle,
  buildEcommerceSocksDispatchOrchestrationPlan
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-design.ts'));
const {
  executeSkillWithExecutor,
  getSkillExecutor,
  registerSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  fastDeterministicRoute
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function installChildExecutorOverrides(overrides) {
  const originals = new Map();

  for (const [skillId, execute] of Object.entries(overrides)) {
    originals.set(skillId, getSkillExecutor(skillId));
    registerSkillExecutor({
      skillId,
      execute
    });
  }

  return () => {
    for (const [skillId, executor] of originals.entries()) {
      if (executor) {
        registerSkillExecutor(executor);
      }
    }
  };
}

function buildVisualSamplingPlan(scenario) {
  return {
    planVersion: 'project-visual-sampling/v0',
    mode: 'bounded-metadata-plan',
    scenario,
    maxCandidates: 2,
    selectedCandidates: [],
    skippedCandidateCount: 0,
    cacheSummary: { hit: 0, miss: 0, stale: 0, shouldAnalyze: 0 },
    warnings: [],
    limitations: [],
    details: []
  };
}

function buildProjectAssetIndex(projectPath = 'D:/demo/socks-project') {
  return {
    indexVersion: 'project-asset-index/v0',
    projectPath,
    projectName: 'socks-project',
    assets: [],
    visionCandidates: [],
    summary: {
      totalFiles: 3,
      totalImages: 3,
      totalDesignDocuments: 1,
      roleCounts: {}
    },
    warnings: [],
    limitations: []
  };
}

function buildProjectContext(scenario = 'main-image') {
  const projectPath = 'D:/demo/socks-project';
  const assetIndex = buildProjectAssetIndex(projectPath);
  const visualSamplingPlan = buildVisualSamplingPlan(scenario);
  const visualInsightCache = {
    summary: {
      totalEntries: 0,
      entriesWithInsight: 0,
      entriesWithRawPayloadRemoved: 0
    }
  };
  return {
    projectPath,
    projectImageCount: 18,
    assetIndex,
    visualSamplingPlan,
    visualInsightCache
  };
}

function installProjectContextSnapshotRuntime() {
  global.window = {
    designEcho: {
      buildProjectContextSnapshot: async (options) => {
        const projectPath = options?.projectPath || 'D:/demo/socks-project';
        const scenario = options?.visualSamplingScenario || 'main-image';
        const assetIndex = buildProjectAssetIndex(projectPath);
        const visualSamplingPlan = buildVisualSamplingPlan(scenario);
        const visualInsightCache = {
          summary: {
            totalEntries: 0,
            entriesWithInsight: 0,
            entriesWithRawPayloadRemoved: 0
          }
        };
        return {
          success: true,
          source: 'smoke-runtime-project-context',
          projectPath,
          projectName: 'socks-project',
          assetIndex,
          visualSamplingPlan,
          visualInsightCache,
          contextSnapshot: {
            snapshotVersion: 'context-snapshot/v0',
            project: { path: projectPath, name: 'socks-project' },
            selectedAssetPaths: [],
            userConstraints: [],
            taskHistory: [],
            unverifiedItems: [],
            visualSamplingPlan,
            visualInsightCache,
            readiness: { status: 'needs_review' },
            warnings: [],
            limitations: [],
            details: []
          },
          warnings: [],
          limitations: []
        };
      }
    }
  };

  return () => {
    delete global.window;
  };
}

function buildFixture(params = {}) {
  const evidence = buildEcommerceSocksDesignState({
    userIntent: '帮我完成整套袜子电商设计',
    deliverables: ['main-image', 'detail-page', 'sku']
  });
  const dispatchDecision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: params.executeChildren,
    confirmChildDispatch: params.confirmChildDispatch,
    childDispatchImplementationReady: params.childDispatchImplementationReady
  });
  const dispatchLifecycle = buildEcommerceSocksDispatchLifecycle({
    userIntent: evidence.userIntent,
    childSkills: evidence.childSkills,
    dispatchDecision
  });
  const dispatchOrchestration = buildEcommerceSocksDispatchOrchestrationPlan({
    childSkills: evidence.childSkills,
    dispatchDecision,
    dispatchLifecycle
  });
  const dispatchAuthorization = buildEcommerceSocksDispatchAuthorization({
    dispatchDecision,
    dispatchOrchestration,
    userDeniedChildDispatch: params.userDeniedChildDispatch
  });

  return {
    evidence,
    dispatchDecision,
    dispatchLifecycle,
    dispatchOrchestration,
    dispatchAuthorization
  };
}

async function run() {
  assert(
    typeof buildEcommerceSocksChildDispatchRun === 'function',
    'child dispatch runner helper should be exported'
  );

  const defaultFixture = buildFixture();
  const blocked = buildEcommerceSocksChildDispatchRun({
    dispatchAuthorization: defaultFixture.dispatchAuthorization,
    dispatchOrchestration: defaultFixture.dispatchOrchestration
  });
  assert(blocked.version === 'ecommerce-socks-child-dispatch-run/v0', 'run should expose version', blocked);
  assert(blocked.status === 'blocked', 'default child dispatch run should be blocked', blocked);
  assert(blocked.canCallChildExecutors === false, 'run must not call child executors by default', blocked);
  assert(blocked.childExecutionPath === 'none', 'blocked run should expose no child execution path', blocked);
  assert(blocked.childRuns.length === 0, 'blocked run should not fabricate child run records', blocked);
  assert(blocked.noPhotoshopWrites === true, 'run must not write Photoshop', blocked);
  assert(blocked.canClaimDesignComplete === false, 'run must not claim design completion', blocked);

  const approvedFixture = buildFixture({
    executeChildren: true,
    confirmChildDispatch: true
  });
  const dryRun = buildEcommerceSocksChildDispatchRun({
    dispatchAuthorization: approvedFixture.dispatchAuthorization,
    dispatchOrchestration: approvedFixture.dispatchOrchestration,
    dryRunChildDispatch: true
  });
  assert(dryRun.status === 'dry_run_reported', 'explicit dry run should produce dispatch report skeleton', dryRun);
  assert(dryRun.canCallChildExecutors === false, 'dry run must not call child executors', dryRun);
  assert(dryRun.childExecutionPath === 'dry_run', 'dry run should expose dry_run child execution path', dryRun);
  assert(
    JSON.stringify(dryRun.childRuns.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'dry run should preserve child skill order',
    dryRun.childRuns
  );
  assert(
    dryRun.childRuns.every((item) => item.state === 'dry_run_skipped'),
    'dry run child records should be marked skipped',
    dryRun.childRuns
  );
  assert(
    dryRun.childRuns.every((item) => item.expectedReportKey.endsWith('Report')),
    'dry run should retain expected child report keys',
    dryRun.childRuns
  );
  assert(
    dryRun.parentSummary.requiredChildReports.length === 3,
    'dry run should expose parent aggregation requirements',
    dryRun.parentSummary
  );
  assert(
    dryRun.parentSummary.canAggregateQuality === false,
    'dry run must not aggregate quality without real child reports',
    dryRun.parentSummary
  );
  const executableDryRunFixture = buildFixture({
    executeChildren: true,
    confirmChildDispatch: true,
    childDispatchImplementationReady: true
  });
  const executableDryRun = buildEcommerceSocksChildDispatchRun({
    dispatchAuthorization: executableDryRunFixture.dispatchAuthorization,
    dispatchOrchestration: executableDryRunFixture.dispatchOrchestration,
    dryRunChildDispatch: true
  });
  assert(executableDryRun.status === 'dry_run_reported', 'dry run should override executable dispatch mode', executableDryRun);
  assert(executableDryRun.canCallChildExecutors === false, 'dry run must not call child executors even when dispatch is executable', executableDryRun);
  assert(executableDryRun.noPhotoshopWrites === true, 'dry run must keep noPhotoshopWrites=true', executableDryRun);

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const steps = [];
  const result = await executor.execute({
    params: {
      userIntent: '帮我完成整套袜子电商设计',
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true,
      dryRunChildDispatch: true
    },
    callbacks: {
      onStep: (event) => steps.push(event),
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: '帮我完成整套袜子电商设计',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: {
        projectPath: 'D:/demo/socks-project',
        projectImageCount: 18
      },
      photoshopContext: {
        hasDocument: true,
        documentName: '详情页.psb'
      }
    }
  });

  assert(
    result.data?.ecommerceSocksChildDispatchRun?.version === 'ecommerce-socks-child-dispatch-run/v0',
    'executor should expose child dispatch run evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksChildDispatchRun.status === 'dry_run_reported',
    'executor should expose dry-run child dispatch evidence even when real dispatch switch is enabled',
    result.data.ecommerceSocksChildDispatchRun
  );
  assert(
    result.data.ecommerceSocksChildDispatchRun.noPhotoshopWrites === true
      && result.data.ecommerceSocksChildDispatchRun.canCallChildExecutors === false,
    'executor dry-run mode must stay no-write and no-child-call',
    result.data.ecommerceSocksChildDispatchRun
  );
  assert(
    result.data.ecommerceSocksDesign.childDispatchRun === result.data.ecommerceSocksChildDispatchRun,
    'entry evidence should reference the same child dispatch run evidence',
    result.data
  );
  assert(
    !steps.some((item) => ['main-image-design', 'detail-page-design', 'sku-batch'].includes(item.toolName)),
    'child dispatch dry run must not emit real child skill execution events',
    steps
  );
  assertNoPseudoThinking(result, 'child dispatch runner result');
  assertNoPseudoThinking(steps, 'child dispatch runner steps');

  const realSteps = [];
  const childCalls = [];
  const restoreRealDispatchChildren = installChildExecutorOverrides({
    'main-image-design': async () => {
      childCalls.push('main-image-design');
      return {
        success: true,
        message: 'main image child done',
        data: {
          status: 'completed',
          outputCount: 1,
          canClaimOutputQuality: false
        }
      };
    },
    'detail-page-design': async () => {
      childCalls.push('detail-page-design');
      return {
        success: false,
        message: 'detail page blocked',
        error: 'missing visual evidence',
        data: {
          status: 'failed',
          blockers: ['missing_visual_evidence']
        }
      };
    },
    'sku-batch': async () => {
      childCalls.push('sku-batch');
      return {
        success: true,
        message: 'sku child still runs independently',
        data: {
          status: 'completed',
          outputCount: 5,
          canClaimOutputQuality: true
        }
      };
    }
  });
  let realDispatchResult;
  try {
    const restoreProjectContextRuntime = installProjectContextSnapshotRuntime();
    realDispatchResult = await executeSkillWithExecutor('ecommerce-socks-design', {
      params: {
        userIntent: '帮我完成整套袜子电商设计',
        deliverables: ['main-image', 'detail-page', 'sku'],
        executeChildren: true,
        confirmChildDispatch: true,
        enableChildDispatch: true
      },
      callbacks: {
        onStep: (event) => realSteps.push(event),
        onMessage: () => undefined,
        onProgress: () => undefined
      },
      context: {
        userInput: '帮我完成整套袜子电商设计',
        isPluginConnected: true,
        conversationHistory: [],
        projectContext: buildProjectContext('main-image'),
        photoshopContext: {
          hasDocument: true,
          documentName: '详情页.psb'
        }
      }
    });
    restoreProjectContextRuntime();
  } finally {
    restoreRealDispatchChildren();
    if (global.window?.designEcho?.buildProjectContextSnapshot) {
      delete global.window;
    }
  }

  assert(
    JSON.stringify(childCalls) === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'real child dispatch should run independent child skills even when one child fails',
    childCalls
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDispatchDecision?.canDispatchChildren === true,
    'explicit triple opt-in should enable child dispatch decision',
    realDispatchResult.data?.ecommerceSocksDispatchDecision
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDispatchAuthorization?.status === 'approved',
    'explicit triple opt-in should be approved before child execution',
    realDispatchResult.data?.ecommerceSocksDispatchAuthorization
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.status === 'failed',
    'failed child should make parent child dispatch run failed',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.childExecutionPath === 'unified_executor',
    'real child dispatch should route through the unified executeSkillWithExecutor wrapper',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    !realDispatchResult.data?.ecommerceSocksChildDispatchRun?.warnings?.some((item) => String(item).includes('direct_executor')),
    'real child dispatch should not keep the old direct_executor limitation warning',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.success === false,
    'failed real child dispatch should make the parent AgentResult unsuccessful',
    realDispatchResult
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDesign?.executionMode === 'dispatch',
    'real child dispatch should mark parent evidence executionMode=dispatch',
    realDispatchResult.data?.ecommerceSocksDesign
  );
  assert(
    !String(realDispatchResult.message || '').includes('不执行 Photoshop 写入'),
    'real child dispatch message must not claim that no Photoshop write can occur',
    realDispatchResult.message
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildReportAggregation?.status === 'blocked_child_failed',
    'parent aggregation should report the failed child while preserving later child reports',
    realDispatchResult.data?.ecommerceSocksChildReportAggregation
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDesign?.canClaimDesignComplete === false,
    'parent skill must not claim full design completion even after child dispatch attempt',
    realDispatchResult.data?.ecommerceSocksDesign
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.noPhotoshopWrites === false,
    'real child dispatch must expose that child executors may write Photoshop',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.parentNoPhotoshopWrites === true,
    'parent skill itself must remain a coordinator with no direct Photoshop writes',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.childRuns?.find((item) => item.skillId === 'sku-batch')?.state === 'completed',
    'child dispatch run should preserve independent later child execution after an earlier child fails',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.childRuns
  );
  assert(
    realSteps.some((item) => item.toolName === 'main-image-design')
      && realSteps.some((item) => item.toolName === 'detail-page-design')
      && realSteps.some((item) => item.toolName === 'sku-batch'),
    'step events should expose every independent child worker',
    realSteps
  );
  assertNoPseudoThinking(realDispatchResult, 'real child dispatch result');
  assertNoPseudoThinking(realSteps, 'real child dispatch steps');

  const fullExamBrief = '请使用当前项目 E:\\DesignEchoDemo\\C-1194 的素材，帮我完整完成电商袜子设计任务：主图、SKU、详情页都要做。SKU 基于当前 Photoshop 中名为 SKU 的文档，不要重新做 SKU 色卡源素材；规格为 2双装、3双装、4双装并包含对应自选备注。详情页文档按名称识别，详情页就是详情页，SKU 就是 SKU。遇到问题先自己读取项目和当前文档判断，不要直接问我。';
  const fullExamRoute = fastDeterministicRoute(fullExamBrief);
  assert(fullExamRoute?.skillId === 'ecommerce-socks-design', 'full exam brief should route through parent before child param propagation test', fullExamRoute);

  const autonomousFirstCalls = [];
  const autonomousFirstResult = await executor.execute({
    params: {
      userIntent: fullExamBrief,
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    runSkill: async (skillId, childParams) => {
      autonomousFirstCalls.push({
        skillId,
        userTask: childParams.params?.userTask,
        parentDeliverable: childParams.params?.parentDeliverable,
        targetDocumentRole: childParams.params?.targetDocumentRole,
        targetDocumentName: childParams.params?.targetDocumentName,
        agentIntentControlPlane: childParams.params?.agentIntentControlPlane
      });
      if (skillId === 'detail-page-design') {
        return { success: false, message: 'template path should not run', error: 'unexpected_detail_template_path' };
      }
      if (skillId === 'autonomous-agent') {
        return {
          success: true,
          message: 'fresh detail page autonomous first',
          data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
        };
      }
      return {
        success: true,
        message: `${skillId} done`,
        data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
      };
    },
    context: {
      userInput: fullExamBrief,
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image'),
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });
  assert(
    JSON.stringify(autonomousFirstCalls.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'autonomous-agent', 'sku-batch']),
    'fresh full-suite detail page should enter autonomous design loop before the template detail-page skill',
    autonomousFirstCalls
  );
  assert(
    autonomousFirstCalls.find((item) => item.skillId === 'autonomous-agent')?.parentDeliverable === 'detail-page'
      && autonomousFirstCalls.find((item) => item.skillId === 'autonomous-agent')?.targetDocumentRole === 'detailPage'
      && autonomousFirstCalls.find((item) => item.skillId === 'autonomous-agent')?.targetDocumentName === '详情页',
    'fresh full-suite detail page autonomous child should keep detail-page document identity instead of inheriting active SKU document',
    autonomousFirstCalls
  );
  assert(
    /详情页/.test(String(autonomousFirstCalls.find((item) => item.skillId === 'autonomous-agent')?.userTask || ''))
      && /不要走模板解析或模板填充/.test(String(autonomousFirstCalls.find((item) => item.skillId === 'autonomous-agent')?.userTask || '')),
    'fresh full-suite detail page task should explicitly target a new detail-page document and avoid template parsing/filling',
    autonomousFirstCalls
  );
  const autonomousFirstIntent = autonomousFirstCalls.find((item) => item.skillId === 'autonomous-agent')?.agentIntentControlPlane;
  assert(
    autonomousFirstIntent?.toolScope === 'write_photoshop'
      && autonomousFirstIntent?.requestKind === 'autonomous_execution'
      && autonomousFirstIntent?.executionAuthorization === 'confirmed_tool_required',
    'fresh full-suite detail page autonomous child should carry a complete write intent for the Agent runtime',
    autonomousFirstIntent
  );
  assert(
    autonomousFirstResult.data?.ecommerceSocksChildDispatchRun?.status === 'executed',
    'fresh detail autonomous-first success should allow parent dispatch to finish all independent deliverables',
    autonomousFirstResult.data?.ecommerceSocksChildDispatchRun
  );

  const terseFullExamBrief = '好的我们现在回到考场进行全盘复测 实现目标Agent 可以帮助用户自主跑完全部的设计 通过使用详情页、SKU、主图、三个skill进行设计';
  const terseFullExamRoute = fastDeterministicRoute(terseFullExamBrief);
  assert(
    terseFullExamRoute?.skillId === 'ecommerce-socks-design',
    'terse full-suite exam wording should route to parent skill even without explicit socks/ecommerce wording',
    terseFullExamRoute
  );
  const terseFullExamCalls = [];
  const terseFullExamResult = await executor.execute({
    params: {
      ...terseFullExamRoute.skillParams,
      userIntent: terseFullExamBrief
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    runSkill: async (skillId, childParams) => {
      terseFullExamCalls.push({
        skillId,
        userTask: childParams.params?.userTask,
        parentDeliverable: childParams.params?.parentDeliverable,
        targetDocumentRole: childParams.params?.targetDocumentRole,
        targetDocumentName: childParams.params?.targetDocumentName,
        agentIntentControlPlane: childParams.params?.agentIntentControlPlane
      });
      if (skillId === 'detail-page-design') {
        return { success: false, message: 'terse exam should not start with detail template path', error: 'unexpected_detail_template_path' };
      }
      return {
        success: true,
        message: `${skillId} done`,
        data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
      };
    },
    context: {
      userInput: terseFullExamBrief,
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image'),
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });
  assert(
    JSON.stringify(terseFullExamCalls.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'autonomous-agent', 'sku-batch']),
    'terse full-suite exam wording should route fresh detail-page work through autonomous-agent instead of detail-page template skill',
    terseFullExamCalls
  );
  assert(
    terseFullExamCalls.find((item) => item.skillId === 'autonomous-agent')?.parentDeliverable === 'detail-page'
      && terseFullExamCalls.find((item) => item.skillId === 'autonomous-agent')?.targetDocumentRole === 'detailPage'
      && terseFullExamCalls.find((item) => item.skillId === 'autonomous-agent')?.targetDocumentName === '详情页',
    'terse full-suite detail-page autonomous child should preserve detail-page document identity',
    terseFullExamCalls
  );
  assert(
    /不要走模板解析或模板填充/.test(String(terseFullExamCalls.find((item) => item.skillId === 'autonomous-agent')?.userTask || '')),
    'terse full-suite detail-page autonomous task should explicitly avoid the template parse/fill path',
    terseFullExamCalls
  );
  assert(
    terseFullExamResult.data?.ecommerceSocksChildDispatchRun?.status === 'executed',
    'terse full-suite autonomous detail-page path should let parent dispatch finish when children succeed',
    terseFullExamResult.data?.ecommerceSocksChildDispatchRun
  );

  const explicitTemplateBrief = '请使用当前已有详情页模板填充详情页，同时完成主图和 SKU；SKU 使用当前名为 SKU 的文档。';
  const explicitTemplateCalls = [];
  const explicitTemplateResult = await executor.execute({
    params: {
      userIntent: explicitTemplateBrief,
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    runSkill: async (skillId) => {
      explicitTemplateCalls.push(skillId);
      return {
        success: true,
        message: `${skillId} done`,
        data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
      };
    },
    context: {
      userInput: explicitTemplateBrief,
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image'),
      photoshopContext: {
        hasDocument: true,
        documentName: '详情页'
      }
    }
  });
  assert(
    JSON.stringify(explicitTemplateCalls) === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'explicit existing detail-page template requests should keep the template detail-page skill path',
    explicitTemplateCalls
  );
  assert(
    explicitTemplateResult.data?.ecommerceSocksChildDispatchRun?.status === 'executed',
    'explicit existing template path should still aggregate successfully when children succeed',
    explicitTemplateResult.data?.ecommerceSocksChildDispatchRun
  );

  const propagatedChildParams = {};
  const restorePropagationChildren = installChildExecutorOverrides({
    'main-image-design': async (params) => {
      propagatedChildParams['main-image-design'] = params.params;
      return {
        success: true,
        message: 'main image child done',
        data: {
          status: 'completed',
          outputCount: 1,
          canClaimOutputQuality: true
        }
      };
    },
    'detail-page-design': async (params) => {
      propagatedChildParams['detail-page-design'] = params.params;
      return {
        success: true,
        message: 'detail page child done',
        data: {
          status: 'completed',
          outputCount: 1,
          canClaimOutputQuality: true
        }
      };
    },
    'sku-batch': async (params) => {
      propagatedChildParams['sku-batch'] = params.params;
      return {
        success: true,
        message: 'sku child done',
        data: {
          status: 'completed',
          outputCount: 15,
          canClaimOutputQuality: true
        }
      };
    }
  });
  let propagationResult;
  try {
    const restoreProjectContextRuntime = installProjectContextSnapshotRuntime();
    propagationResult = await executeSkillWithExecutor('ecommerce-socks-design', {
      params: {
        ...fullExamRoute.skillParams,
        childSkillParams: {
          ...(fullExamRoute.skillParams.childSkillParams || {}),
          'detail-page-design': {
            freshDetailPageExecutionMode: 'template-first'
          }
        }
      },
      callbacks: {
        onStep: () => undefined,
        onMessage: () => undefined,
        onProgress: () => undefined
      },
      context: {
        userInput: fullExamBrief,
        isPluginConnected: true,
        conversationHistory: [],
        projectContext: buildProjectContext('main-image'),
        photoshopContext: {
          hasDocument: true,
          documentName: 'SKU'
        }
      }
    });
    restoreProjectContextRuntime();
  } finally {
    restorePropagationChildren();
    if (global.window?.designEcho?.buildProjectContextSnapshot) {
      delete global.window;
    }
  }

  assert(propagationResult.success === true, 'all-success child override should make parent dispatch succeed', propagationResult);
  assert(
    propagationResult.data?.ecommerceSocksChildDispatchRun?.status === 'executed',
    'full exam route should execute all child skills when every child succeeds',
    propagationResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    JSON.stringify(propagatedChildParams['sku-batch']?.comboSizes) === JSON.stringify([2, 3, 4]),
    'parent child dispatch should pass SKU combo sizes inferred from the original full brief',
    propagatedChildParams['sku-batch']
  );
  assert(
    propagatedChildParams['sku-batch']?.preferExistingSkuSourceForCardPreparation === true
      && propagatedChildParams['sku-batch']?.allowSkuCardSourcePreparation === false
      && propagatedChildParams['sku-batch']?.allowSkuCardTemplatePreparation === true
      && propagatedChildParams['sku-batch']?.requireSkuComboConfirmation === true
      && propagatedChildParams['sku-batch']?.requireSkuCardTemplateDesignConfirmation === true,
    'parent child dispatch should preserve existing SKU source and template confirmation policy for the SKU child',
    propagatedChildParams['sku-batch']
  );
  assert(
    propagatedChildParams['main-image-design']?.mainImageExecutionMode === 'product-disposable-live'
      && propagatedChildParams['main-image-design']?.approvedLiveExecution === true
      && propagatedChildParams['main-image-design']?.approvedLiveAdapterRun === true
      && propagatedChildParams['main-image-design']?.outputDirPolicy === 'project-main-image-dir',
    'parent child dispatch should authorize real project-context main-image execution for full-suite delivery',
    propagatedChildParams['main-image-design']
  );
  assert(
    propagatedChildParams['detail-page-design']?.parentDeliverable === 'detail-page'
      && propagatedChildParams['sku-batch']?.parentDeliverable === 'sku',
    'child params should retain parent deliverable identity for document-name disambiguation',
    propagatedChildParams
  );
  assert(
    propagatedChildParams['detail-page-design']?.targetDocumentRole === 'detailPage'
      && propagatedChildParams['detail-page-design']?.targetDocumentName === '详情页'
      && propagatedChildParams['sku-batch']?.targetDocumentRole === 'sku'
      && propagatedChildParams['sku-batch']?.targetDocumentName === 'SKU',
    'child params should carry document-name targets so detail-page and SKU do not depend on the active document',
    propagatedChildParams
  );

  const fallbackCalls = [];
  const fallbackResult = await executor.execute({
    params: {
      userIntent: fullExamBrief,
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true,
      childSkillParams: {
        'detail-page-design': {
          freshDetailPageExecutionMode: 'template-first'
        }
      }
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    runSkill: async (skillId, childParams) => {
      fallbackCalls.push({
        skillId,
        userTask: childParams.params?.userTask,
        userIntent: childParams.params?.userIntent,
        parentDeliverable: childParams.params?.parentDeliverable,
        agentIntentControlPlane: childParams.params?.agentIntentControlPlane
      });
      if (skillId === 'main-image-design') {
        return {
          success: true,
          message: 'main image done',
          data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
        };
      }
      if (skillId === 'detail-page-design') {
        return {
          success: false,
          message: 'missing detail doc',
          error: 'detail_page_document_role_mismatch',
          data: { status: 'failed', blockers: ['detail_page_document_role_mismatch'] }
        };
      }
      if (skillId === 'autonomous-agent') {
        return {
          success: true,
          message: 'fresh detail page created',
          data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
        };
      }
      if (skillId === 'sku-batch') {
        return {
          success: true,
          message: 'sku done',
          data: { status: 'completed', canClaimOutputQuality: true, outputCount: 5 }
        };
      }
      return { success: false, message: `unexpected skill ${skillId}`, error: 'unexpected_skill' };
    },
    context: {
      userInput: fullExamBrief,
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image'),
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });
  assert(
    JSON.stringify(fallbackCalls.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'autonomous-agent', 'sku-batch']),
    'parent should recover missing detail-page document by delegating that deliverable to the autonomous fresh-design loop, then continue SKU',
    fallbackCalls
  );
  assert(
    /详情页/.test(String(fallbackCalls.find((item) => item.skillId === 'autonomous-agent')?.userTask || ''))
      && /不要走模板解析或模板填充/.test(String(fallbackCalls.find((item) => item.skillId === 'autonomous-agent')?.userTask || '')),
    'fresh detail fallback task should target a detail-page document and explicitly avoid template parsing/filling',
    fallbackCalls
  );
  const freshDetailIntent = fallbackCalls.find((item) => item.skillId === 'autonomous-agent')?.agentIntentControlPlane;
  assert(
    freshDetailIntent?.toolScope === 'write_photoshop'
      && freshDetailIntent?.requestKind === 'autonomous_execution'
      && freshDetailIntent?.executionAuthorization === 'confirmed_tool_required',
    'fresh detail fallback must pass a complete autonomous write intent so the runtime does not classify tools as unknown scope',
    freshDetailIntent
  );
  assert(
    fallbackResult.data?.ecommerceSocksChildDispatchRun?.status === 'executed',
    'fresh detail fallback success should allow the parent dispatch run to finish all independent deliverables',
    fallbackResult.data?.ecommerceSocksChildDispatchRun
  );

  const noParsedScreenFallbackCalls = [];
  const noParsedScreenFallbackResult = await executor.execute({
    params: {
      userIntent: fullExamBrief,
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true,
      childSkillParams: {
        'detail-page-design': {
          freshDetailPageExecutionMode: 'template-first'
        }
      }
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    runSkill: async (skillId, childParams) => {
      noParsedScreenFallbackCalls.push({
        skillId,
        userTask: childParams.params?.userTask,
        agentIntentControlPlane: childParams.params?.agentIntentControlPlane
      });
      if (skillId === 'detail-page-design') {
        return {
          success: false,
          message: '当前文档没有识别到可用的详情页屏结构。',
          error: 'No parsed screens',
          data: { status: 'failed', blockers: ['当前文档没有识别到可用的详情页屏结构。'] }
        };
      }
      if (skillId === 'autonomous-agent') {
        return {
          success: true,
          message: 'fresh detail page created after empty template parse',
          data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
        };
      }
      return {
        success: true,
        message: `${skillId} done`,
        data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
      };
    },
    context: {
      userInput: fullExamBrief,
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image'),
      photoshopContext: {
        hasDocument: true,
        documentName: '详情页'
      }
    }
  });
  assert(
    JSON.stringify(noParsedScreenFallbackCalls.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'autonomous-agent', 'sku-batch']),
    'parent should recover empty detail template parse by delegating to fresh detail design, then continue SKU',
    noParsedScreenFallbackCalls
  );
  assert(
    /详情页/.test(String(noParsedScreenFallbackCalls.find((item) => item.skillId === 'autonomous-agent')?.userTask || ''))
      && /不要走模板解析或模板填充/.test(String(noParsedScreenFallbackCalls.find((item) => item.skillId === 'autonomous-agent')?.userTask || '')),
    'No parsed screens fallback task should be a fresh detail-page design task, not another template parse',
    noParsedScreenFallbackCalls
  );
  const noParsedFreshDetailIntent = noParsedScreenFallbackCalls.find((item) => item.skillId === 'autonomous-agent')?.agentIntentControlPlane;
  assert(
    noParsedFreshDetailIntent?.toolScope === 'write_photoshop'
      && noParsedFreshDetailIntent?.requestKind === 'autonomous_execution'
      && noParsedFreshDetailIntent?.executionAuthorization === 'confirmed_tool_required',
    'No parsed screens fallback must pass a complete autonomous write intent so the runtime can replan with Photoshop tools',
    noParsedFreshDetailIntent
  );
  assert(
    noParsedScreenFallbackResult.data?.ecommerceSocksChildDispatchRun?.status === 'executed',
    'No parsed screens fallback success should allow parent dispatch to finish independent deliverables',
    noParsedScreenFallbackResult.data?.ecommerceSocksChildDispatchRun
  );

  const fallbackContextCalls = [];
  const fallbackContextResult = await executor.execute({
    params: {
      userIntent: fullExamBrief,
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true,
      childSkillParams: {
        'detail-page-design': {
          freshDetailPageExecutionMode: 'template-first'
        }
      }
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    runSkill: async (skillId, childParams) => {
      fallbackContextCalls.push({
        skillId,
        isPluginConnected: childParams.context?.isPluginConnected,
        userTask: childParams.params?.userTask
      });
      if (skillId === 'detail-page-design') {
        return {
          success: false,
          message: 'missing detail doc',
          error: 'detail_page_document_role_mismatch',
          data: { status: 'failed', blockers: ['detail_page_document_role_mismatch'] }
        };
      }
      if (skillId === 'autonomous-agent') {
        return {
          success: true,
          message: 'fresh detail page created with inherited bridge context',
          data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
        };
      }
      return {
        success: true,
        message: `${skillId} done`,
        data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
      };
    },
    context: {
      userInput: fullExamBrief,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image'),
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });
  assert(
    fallbackContextCalls.find((item) => item.skillId === 'autonomous-agent')?.isPluginConnected === true,
    'fresh detail fallback must not convert an unknown parent bridge state into an explicit disconnected child context',
    fallbackContextCalls
  );
  assert(
    fallbackContextResult.success === true,
    'fresh detail fallback with unknown parent bridge context should continue through the autonomous child instead of failing as disconnected',
    fallbackContextResult
  );

  const partialReviewChildExecutorOverrides = {
    'main-image-design': {
      execute: async () => ({
        success: true,
        message: 'main image exported for review',
        data: { status: 'needs_review', canClaimOutputQuality: false, outputCount: 2 }
      })
    },
    'detail-page-design': {
      execute: async () => ({
        success: true,
        message: 'detail page draft created for review',
        data: { status: 'needs_review', canClaimOutputQuality: false, outputCount: 1 }
      })
    },
    'sku-batch': {
      execute: async () => ({
        success: true,
        message: 'SKU needs editable combo confirmation',
        data: {
          status: 'needs_review',
          canClaimOutputQuality: false,
          outputCount: 0,
          interactiveCards: [{
            version: 'interactive-card/v0',
            id: 'sku-card-template-design-confirmation',
            title: '确认 SKU 色卡模板方向',
            status: 'draft'
          }]
        }
      })
    }
  };
  const partialReviewResult = await executor.execute({
    params: {
      userIntent: '完整推进主图、详情页、SKU；SKU 如需确认先给确认卡片',
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true,
      childExecutorOverrides: partialReviewChildExecutorOverrides
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: '完整推进主图、详情页、SKU；SKU 如需确认先给确认卡片',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image')
    }
  });
  assert(
    partialReviewResult.success === true
      && partialReviewResult.error === undefined
      && partialReviewResult.data?.ecommerceSocksChildDispatchRun?.status === 'partial',
    'child results that are produced but need review/confirmation should keep parent successful with partial status, not fail the whole orchestration',
    partialReviewResult
  );
  assert(
    partialReviewResult.message.includes('主图：需要复核')
      && partialReviewResult.message.includes('详情页：需要复核')
      && partialReviewResult.message.includes('SKU：需要复核'),
    'parent summary should present review-required child states separately instead of collapsing them into failure',
    partialReviewResult.message
  );
  assert(
    partialReviewResult.data?.interactiveCards?.[0]?.id === 'sku-card-template-design-confirmation',
    'editable confirmation card from SKU child should bubble up to the parent result',
    partialReviewResult.data?.interactiveCards
  );

  const runtimeNeedsReviewChildExecutorOverrides = {
    'main-image-design': {
      execute: async () => ({
        success: true,
        message: 'main image exported',
        data: { status: 'completed', canClaimOutputQuality: true, outputCount: 1 }
      })
    },
    'detail-page-design': {
      execute: async () => ({
        success: false,
        message: '已经生成当前版本，但最终画面还需要人工复核。',
        data: {
          iterations: 3,
          stopReason: 'final_response',
          executionSummary: {
            status: 'needs_review',
            stopReason: 'final_response',
            toolCallCount: 3,
            successfulToolCalls: 3,
            failedToolCalls: 0,
            acceptanceVerified: 0,
            acceptanceFailed: 0,
            acceptanceNeedsReview: 1,
            noDocumentChangeRisks: 0,
            blockers: [],
            warnings: ['画面需要人工复核'],
            summaryText: '处理状态：需复核。'
          },
          toolCallLog: [
            { name: 'createDocument', arguments: { name: '详情页' }, result: { success: true } },
            { name: 'renderLayout', arguments: {}, result: { success: true } },
            { name: 'getCanvasSnapshot', arguments: {}, result: { success: true } }
          ]
        }
      })
    },
    'sku-batch': {
      execute: async () => ({
        success: true,
        message: 'sku done',
        data: { status: 'completed', canClaimOutputQuality: true, outputCount: 5 }
      })
    }
  };
  const runtimeNeedsReviewResult = await executor.execute({
    params: {
      userIntent: fullExamBrief,
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true,
      childExecutorOverrides: runtimeNeedsReviewChildExecutorOverrides
    },
    callbacks: {
      onStep: () => undefined,
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: fullExamBrief,
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: buildProjectContext('main-image'),
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });
  assert(
    runtimeNeedsReviewResult.success === true
      && runtimeNeedsReviewResult.data?.ecommerceSocksChildDispatchRun?.status === 'partial',
    'Agent runtime success=false with executionSummary.needs_review should be treated as a reviewable child result, not a failed child',
    runtimeNeedsReviewResult
  );
  assert(
    runtimeNeedsReviewResult.message.includes('详情页：需要复核')
      && !runtimeNeedsReviewResult.message.includes('详情页：未完成'),
    'parent summary should preserve the detail-page review state from Agent runtime executionSummary',
    runtimeNeedsReviewResult.message
  );

  const failedStatusCalls = [];
  const failedStatusChildExecutorOverrides = {
    'main-image-design': {
      execute: async () => {
      failedStatusCalls.push('main-image-design');
      return {
        success: true,
        message: 'declared failed in data',
        data: {
          status: 'failed',
          blockers: ['declared_failed_status']
        }
      };
      }
    },
    'detail-page-design': {
      execute: async () => {
      failedStatusCalls.push('detail-page-design');
      return { success: true, message: 'detail still runs independently', data: { status: 'completed', canClaimOutputQuality: true } };
      }
    },
    'sku-batch': {
      execute: async () => {
      failedStatusCalls.push('sku-batch');
      return { success: true, message: 'sku still runs independently', data: { status: 'completed', canClaimOutputQuality: true } };
      }
    }
  };
  let failedStatusResult;
  failedStatusResult = await executor.execute({
      params: {
        userIntent: '帮我完成整套袜子电商设计',
        deliverables: ['main-image', 'detail-page', 'sku'],
        executeChildren: true,
        confirmChildDispatch: true,
        enableChildDispatch: true,
        childExecutorOverrides: failedStatusChildExecutorOverrides
      },
      callbacks: {
        onStep: () => undefined,
        onMessage: () => undefined,
        onProgress: () => undefined
      },
      context: {
        userInput: '帮我完成整套袜子电商设计',
        isPluginConnected: true,
        conversationHistory: [],
        projectContext: buildProjectContext('main-image')
      }
    });

  assert(
    JSON.stringify(failedStatusCalls) === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'child dispatch should continue independent children when one child returns success=true but data.status=failed',
    failedStatusCalls
  );
  assert(
    failedStatusResult.data?.ecommerceSocksChildDispatchRun?.status === 'failed',
    'data.status=failed should normalize to failed child dispatch run',
    failedStatusResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    failedStatusResult.message.includes('主图：未完成（declared failed in data）')
      && !failedStatusResult.message.includes('declared_failed_status'),
    'parent child summary should prefer the child user-facing message over internal blocker/error codes',
    failedStatusResult.message
  );

  const throwingCalls = [];
  const throwingChildExecutorOverrides = {
    'main-image-design': {
      execute: async () => {
      throwingCalls.push('main-image-design');
      throw new Error('child exploded');
      }
    },
    'detail-page-design': {
      execute: async () => {
      throwingCalls.push('detail-page-design');
      return { success: true, message: 'detail still runs independently', data: { status: 'completed', canClaimOutputQuality: true } };
      }
    },
    'sku-batch': {
      execute: async () => {
      throwingCalls.push('sku-batch');
      return { success: true, message: 'sku still runs independently', data: { status: 'completed', canClaimOutputQuality: true } };
      }
    }
  };
  let throwingResult;
  throwingResult = await executor.execute({
      params: {
        userIntent: '帮我完成整套袜子电商设计',
        deliverables: ['main-image', 'detail-page', 'sku'],
        executeChildren: true,
        confirmChildDispatch: true,
        enableChildDispatch: true,
        childExecutorOverrides: throwingChildExecutorOverrides
      },
      callbacks: {
        onStep: () => undefined,
        onMessage: () => undefined,
        onProgress: () => undefined
      },
      context: {
        userInput: '帮我完成整套袜子电商设计',
        isPluginConnected: true,
        conversationHistory: [],
        projectContext: buildProjectContext('main-image')
      }
    });
  assert(
    JSON.stringify(throwingCalls) === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'child dispatch should convert a child exception to a failed report and continue independent children',
    throwingCalls
  );
  assert(
    throwingResult.data?.ecommerceSocksChildDispatchRun?.childRuns?.[0]?.error === 'child exploded',
    'child exception should be preserved as structured child run error',
    throwingResult.data?.ecommerceSocksChildDispatchRun?.childRuns
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'child dispatch runner helper exports stable run evidence',
      'default run stays blocked and does not fabricate child results',
      'explicit dry run reports child order and expected report keys without running child skills',
      'executor exposes child dispatch run evidence without executing child skills',
      'dry-run dispatch evidence does not write Photoshop or claim design completion',
      'explicit triple opt-in can run child executors in order while keeping independent deliverables decoupled',
      'real child dispatch routes through the unified executeSkillWithExecutor wrapper',
      'fresh full-suite detail-page delivery enters the autonomous design loop before template parsing',
      'terse full-suite exam wording also routes fresh detail-page delivery through the autonomous design loop',
      'explicit existing detail-page template requests keep the template child skill path',
      'failed child dispatch makes parent AgentResult unsuccessful and executionMode=dispatch',
      'fresh detail fallback preserves inherited Photoshop bridge context for child Agent execution',
      'review-required child outputs keep parent dispatch successful but partial',
      'child data.status=failed and child exceptions are recorded without blocking independent later children',
      'later child records preserve their own execution result instead of being hidden behind an earlier failure',
      'parent remains coordinator-only and cannot claim design completion after child dispatch'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
