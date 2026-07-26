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
  getSkillById,
  getUserFacingSkills
} = require(path.join(ROOT, 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  fastDeterministicRoute,
  inferSkillHint
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  DesignAgentEngine
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));

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

async function run() {
  const skill = getSkillById('ecommerce-socks-design');
  assert(skill, 'ecommerce-socks-design skill should be declared');
  assert(skill.visibility === 'user-facing', 'parent skill should be user-facing', skill);
  assert(skill.kind === 'workflow', 'parent skill should be workflow kind', skill);
  assert(skill.category === 'ecommerce', 'parent skill should be ecommerce category', skill);
  assert(
    skill.routing?.intentSignals?.includes('电商袜子设计'),
    'parent skill should expose stable routing signal',
    skill.routing
  );
  assert(
    skill.parameters.some((item) => item.name === 'deliverables'),
    'parent skill should accept deliverables parameter',
    skill.parameters
  );
  assert(
    skill.requiredTools.length === 0,
    'parent skill should not directly own Photoshop tools in entry MVP',
    skill.requiredTools
  );

  const visibleSkillIds = new Set(getUserFacingSkills().map((item) => item.id));
  assert(visibleSkillIds.has('ecommerce-socks-design'), 'parent skill should be visible to router model');

  const combinedRoute = fastDeterministicRoute('帮我规划一套电商袜子设计，包含主图、详情页和SKU');
  assert(
    combinedRoute?.skillId === 'ecommerce-socks-design',
    'combined ecommerce socks request should route to parent skill',
    combinedRoute
  );
  assert(
    JSON.stringify(combinedRoute.skillParams?.deliverables) === JSON.stringify(['main-image', 'detail-page', 'sku']),
    'combined route should extract all three child deliverables',
    combinedRoute
  );

  const fullExamBrief = '请使用当前项目 E:\\DesignEchoDemo\\C-1194 的素材，帮我完整完成电商袜子设计任务：主图、SKU、详情页都要做。SKU 基于当前 Photoshop 中名为 SKU 的文档，不要重新做 SKU 色卡源素材；规格为 2双装、3双装、4双装并包含对应自选备注。详情页文档按名称识别，详情页就是详情页，SKU 就是 SKU。遇到问题先自己读取项目和当前文档判断，不要直接问我。';
  const fullExamRoute = fastDeterministicRoute(fullExamBrief);
  assert(
    fullExamRoute?.skillId === 'ecommerce-socks-design',
    'full three-deliverable exam brief should route to parent skill instead of project image analysis',
    fullExamRoute
  );
  assert(
    JSON.stringify(fullExamRoute.skillParams?.deliverables) === JSON.stringify(['main-image', 'detail-page', 'sku']),
    'full exam route should extract main image, detail page and SKU deliverables',
    fullExamRoute
  );
  assert(
    fullExamRoute.skillParams?.executeChildren === true
      && fullExamRoute.skillParams?.confirmChildDispatch === true
      && fullExamRoute.skillParams?.enableChildDispatch === true
      && fullExamRoute.skillParams?.dryRunChildDispatch === false,
    'full exam route should authorize real child dispatch while keeping dry-run disabled',
    fullExamRoute
  );

  assert(
    combinedRoute.skillParams?.executeChildren !== true
      && combinedRoute.skillParams?.enableChildDispatch !== true,
    'planning route must not auto-dispatch child skills',
    combinedRoute
  );

  const directSkuRoute = fastDeterministicRoute('帮我做3双装的SKU');
  assert(
    directSkuRoute?.skillId === 'sku-batch',
    'direct SKU request should keep existing child route before business-strategy checkpoint',
    directSkuRoute
  );
  assert(
    inferSkillHint('帮我做整套袜子电商设计') === 'ecommerce-socks-design',
    'combined design hint should point to parent skill'
  );

  const parentPlanningBrief = '帮我规划一套电商袜子设计，包含主图、详情页和SKU';
  let parentPlanningCallModelCount = 0;
  const parentPlanningEngineSteps = [];
  const parentPlanningEngineThinking = [];
  const parentPlanningEngine = new DesignAgentEngine();
  const parentPlanningEngineResult = await parentPlanningEngine.run({
    userInput: parentPlanningBrief,
    isPluginConnected: true,
    conversationHistory: [],
    projectContext: {
      projectPath: 'E:/DesignEchoDemo/C-1194',
      projectImageCount: 12
    },
    photoshopContext: {
      hasDocument: true,
      documentName: 'SKU.psb'
    }
  }, {
    callModel: async () => {
      parentPlanningCallModelCount += 1;
      throw new Error('parent coordinator planning route must not wait for router model');
    },
    callbacks: {
      onStep: (event) => parentPlanningEngineSteps.push(event),
      onThinking: (thinking) => parentPlanningEngineThinking.push(thinking),
      onMessage: () => undefined,
      onProgress: () => undefined
    }
  });
  assert(
    parentPlanningCallModelCount === 0,
    'parent coordinator planning route should start from deterministic route without waiting for router model',
    { parentPlanningCallModelCount, parentPlanningEngineThinking, parentPlanningEngineSteps, parentPlanningEngineResult }
  );
  assert(
    parentPlanningEngineResult.data?.agentRequestLifecycle?.decision?.skillId === 'ecommerce-socks-design',
    'parent planning engine result should still route through the parent coordinator',
    parentPlanningEngineResult.data?.agentRequestLifecycle
  );

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const steps = [];
  const result = await executor.execute({
    params: {
      userIntent: '帮我规划一套电商袜子设计，包含主图、详情页和SKU',
      deliverables: ['main-image', 'detail-page', 'sku']
    },
    callbacks: {
      onStep: (event) => steps.push(event),
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: '帮我规划一套电商袜子设计，包含主图、详情页和SKU',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: {
        projectPath: 'D:/demo/socks-project',
        projectImageCount: 12
      },
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });

  assert(result.success === true, 'parent entry should return a successful plan-only result', result);
  assert(
    result.data?.ecommerceSocksDesign?.version === 'ecommerce-socks-design/v0',
    'result should expose stable parent evidence version',
    result.data
  );
  assert(
    result.data.ecommerceSocksDesign.executionMode === 'plan-only',
    'entry MVP should be plan-only by default',
    result.data.ecommerceSocksDesign
  );
  assert(
    result.data.ecommerceSocksDesign.canClaimDesignComplete === false,
    'parent evidence must not claim design completion',
    result.data.ecommerceSocksDesign
  );
  assert(
    result.data.ecommerceSocksDesign.mustNotChangeChildBusinessStrategy === true,
    'parent evidence must preserve child skill strategy',
    result.data.ecommerceSocksDesign
  );
  assert(
    JSON.stringify(result.data.ecommerceSocksDesign.childSkills.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'parent plan should map deliverables to current child skill ids',
    result.data.ecommerceSocksDesign.childSkills
  );
  assert(
    steps.some((item) => item.toolName === 'ecommerce-socks-design'),
    'parent executor should emit visible activity event',
    steps
  );
  assertNoPseudoThinking(result, 'ecommerce socks result');
  assertNoPseudoThinking(steps, 'ecommerce socks steps');

  const childDispatchCalls = [];
  const childDispatchResult = await executor.execute({
    params: {
      ...fullExamRoute.skillParams,
      userIntent: fullExamBrief,
      projectPath: 'E:/DesignEchoDemo/C-1194',
      childExecutorOverrides: {
        'main-image-design': async (childParams) => {
          childDispatchCalls.push({ skillId: 'main-image-design', params: childParams.params });
          return { success: true, message: 'main image child captured', data: { status: 'completed' } };
        },
        'detail-page-design': async (childParams) => {
          childDispatchCalls.push({ skillId: 'detail-page-design', params: childParams.params });
          return { success: true, message: 'detail page child captured', data: { status: 'completed' } };
        },
        'sku-batch': async (childParams) => {
          childDispatchCalls.push({ skillId: 'sku-batch', params: childParams.params });
          return {
            success: true,
            message: 'sku child captured',
            data: {
              status: 'completed',
              interactiveCards: [{
                version: 'interactive-card/v0',
                kind: 'editable_confirmation',
                id: 'sku-template-confirmation-test-card',
                title: '确认 SKU 模板方向',
                submitAction: 'submitInteractiveCard',
                payload: {
                  version: 'editable-confirmation/v0',
                  fields: []
                }
              }]
            }
          };
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
      projectContext: {
        projectPath: 'E:/DesignEchoDemo/C-1194',
        projectImageCount: 12
      },
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU'
      }
    }
  });
  const capturedBySkill = Object.fromEntries(childDispatchCalls.map((item) => [item.skillId, item.params]));
  assert(childDispatchResult.success === true, 'full exam child dispatch capture should complete', childDispatchResult);
  assert(
    capturedBySkill['detail-page-design']?.targetDocumentName === '详情页'
      && capturedBySkill['detail-page-design']?.targetDocumentRole === 'detailPage',
    'detail-page child must target the document named 详情页, not the current SKU document',
    capturedBySkill['detail-page-design']
  );
  assert(
    capturedBySkill['sku-batch']?.targetDocumentName === 'SKU'
      && capturedBySkill['sku-batch']?.targetDocumentRole === 'sku'
      && capturedBySkill['sku-batch']?.skuFileKeyword === 'SKU',
    'SKU child must target the document named SKU',
    capturedBySkill['sku-batch']
  );
  assert(
    capturedBySkill['sku-batch']?.preferExistingSkuSourceForCardPreparation === true
      && capturedBySkill['sku-batch']?.skuSourcePreparationMode === 'disabled'
      && capturedBySkill['sku-batch']?.allowSkuCardSourcePreparation === false,
    'full exam SKU child must reuse the existing SKU source and must not regenerate color-card source material',
    capturedBySkill['sku-batch']
  );
  assert(
    childDispatchResult.data?.interactiveCards?.[0]?.id === 'sku-template-confirmation-test-card',
    'parent dispatch result must preserve interactive cards returned by child skills',
    childDispatchResult.data?.interactiveCards
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'parent skill declaration exists and is user-facing',
      'combined ecommerce socks request routes to parent skill',
      'parent coordinator planning route starts without waiting for router model',
      'full exam child dispatch keeps document-name boundaries: 详情页 is detail page and SKU is SKU',
      'full exam parent dispatch preserves child interactive cards',
      'direct SKU route remains child route before checkpoint',
      'parent executor returns plan-only child skill orchestration evidence',
      'parent evidence does not claim design completion or change child strategy'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
