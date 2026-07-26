#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CAPABILITY_PROBE_MODE = process.argv.includes('--capability-probe');
const NO_REDO_PROBE_MODE = process.argv.includes('--no-redo-probe');
const NO_REDO_PROBE_SELF_TEST = process.argv.includes('--no-redo-probe-self-test');
const DIRECT_PROVIDER_PROBE_MODE = CAPABILITY_PROBE_MODE || NO_REDO_PROBE_MODE;
const REPORT_STEM = CAPABILITY_PROBE_MODE
  ? 'agent-capability-provider-probe'
  : NO_REDO_PROBE_MODE
    ? 'agent-no-redo-provider-probe'
    : 'agent-real-provider-acceptance';
const REPORT_JSON = path.join(ROOT, 'tmp', 'acceptance', REPORT_STEM + '.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'acceptance', REPORT_STEM + '.md');
const WS_PORT = 8765;
const TEST_PORT_START = 23900;
const TEST_PORT_END = 24900;
const GREETING_PROMPT = '\u4f60\u597d\u554a';
const SKU_EXECUTION_PROMPT = '\u5e2e\u6211\u505aSKU\u4ee5\u53ca\u5bf9\u5e94\u7684\u81ea\u9009\u5907\u6ce8';
const PROJECT_ASSET_CAPABILITY_PROMPT = '这是开发者只读 Capability 选择验收。只调用一次 requestAgentCapabilities，装载“分析单个项目素材可见内容”所需的最小能力，然后立即停止；不要调用装载后的能力，不要调用 Photoshop、生成、保存或导出工具。';
const SUBJECT_FIT_CAPABILITY_PROMPT = '这是开发者只读 Capability 选择验收。只调用一次 requestAgentCapabilities，装载“把图层主体适配到目标区域”所需的最小能力，然后立即停止；不要调用装载后的能力，不要修改、保存或导出 Photoshop 文档。';

let evaluateAgentCapabilityProviderProbe;
let evaluateAgentNoRedoProviderProbe;
let createAgentCapabilitySession;
let REQUEST_AGENT_CAPABILITIES_TOOL_NAME;
let DELEGATE_TOOL;
let TEAM_PIPELINE_TOOL;
let getDefaultAgentTools;
let buildSkillToolSchemas;
let getManifestByTaskType;
let buildDeclareRuntimeActionPlanToolSchema;
let validateRuntimeActionPlanDeclaration;
let validateRuntimeDesignStrategyDeclaration;
let buildRuntimeDesignStrategyDigest;
let buildRuntimeResumeContextAnchor;
let evaluateRuntimeActionPlanResumeFreshness;
let CURRENT_R3_STRATEGY_REF;
let DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME;

function loadCapabilityProbeRuntime() {
  if (!DIRECT_PROVIDER_PROBE_MODE || evaluateAgentCapabilityProviderProbe || evaluateAgentNoRedoProviderProbe) return;
  require('ts-node').register({
    transpileOnly: true,
    project: path.join(ROOT, 'tsconfig.main.json')
  });
  ({ evaluateAgentCapabilityProviderProbe } = require(
    path.join(ROOT, 'src', 'shared', 'agent-capability-provider-probe.ts')
  ));
  ({ evaluateAgentNoRedoProviderProbe } = require(
    path.join(ROOT, 'src', 'shared', 'agent-no-redo-provider-probe.ts')
  ));
  ({
    createAgentCapabilitySession,
    REQUEST_AGENT_CAPABILITIES_TOOL_NAME
  } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'capability-session.ts')));
  ({
    DELEGATE_TOOL,
    TEAM_PIPELINE_TOOL,
    getDefaultAgentTools
  } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts')));
  ({ buildSkillToolSchemas } = require(
    path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts')
  ));
  ({ getManifestByTaskType } = require(
    path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'skill-runtime.ts')
  ));
  ({
    buildDeclareRuntimeActionPlanToolSchema,
    validateRuntimeActionPlanDeclaration,
    CURRENT_R3_STRATEGY_REF,
    DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME
  } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts')));
  ({
    validateRuntimeDesignStrategyDeclaration,
    buildRuntimeDesignStrategyDigest
  } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts')));
  ({
    buildRuntimeResumeContextAnchor,
    evaluateRuntimeActionPlanResumeFreshness
  } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-resume-freshness.ts')));
}

const debugState = {
  stage: 'not-started',
  lastReport: null,
  lastSnapshot: null,
  lastCapabilityProbe: null
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isArmed() {
  return process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE === '1'
    && process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API === '1';
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function findFreePortBlock(start = TEST_PORT_START, end = TEST_PORT_END, count = 4) {
  for (let base = start; base <= end - count; base += count + 1) {
    const checks = [];
    for (let offset = 0; offset < count; offset += 1) {
      checks.push(isPortOpen(base + offset));
    }
    const open = await Promise.all(checks);
    if (open.every((value) => !value)) return base;
  }
  throw new Error('No free ' + count + '-port block found between ' + start + ' and ' + end + '.');
}

function resetDir(name) {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const dir = path.resolve(tmpRoot, name);
  if (!dir.startsWith(tmpRoot + path.sep)) {
    throw new Error('Refusing to remove unsafe test directory: ' + dir);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resetTestProjectDir() {
  const projectDir = resetDir('agent-real-provider-acceptance-project');
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'output'), { recursive: true });
  return projectDir;
}

function readEnvValue(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function collectProviderAcceptanceConfig() {
  const apiKeys = {
    google: readEnvValue(['DESIGNECHO_TEST_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']),
    xiaomi: readEnvValue(['DESIGNECHO_TEST_XIAOMI_API_KEY', 'XIAOMI_API_KEY', 'MIMO_API_KEY']),
    openrouter: readEnvValue(['DESIGNECHO_TEST_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY']),
    gptsapi: readEnvValue(['DESIGNECHO_TEST_GPTSAPI_API_KEY', 'GPTSAPI_API_KEY']),
    deepseek: readEnvValue(['DESIGNECHO_TEST_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'])
  };
  const explicitModelId = readEnvValue(['DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_MODEL_ID']);
  const selectedModelId = explicitModelId
    || (apiKeys.xiaomi ? 'xiaomi-mimo-v2.5-pro' : '')
    || (apiKeys.openrouter ? 'openrouter-mimo-v2.5-pro' : '')
    || (apiKeys.gptsapi ? 'gptsapi-gpt-5.4-pro' : '')
    || (apiKeys.deepseek ? 'deepseek-v4-pro' : '')
    || (apiKeys.google ? 'google-gemini-3-flash' : '');
  const hasAnyApiKey = Object.values(apiKeys).some(Boolean);
  return {
    apiKeys,
    selectedModelId,
    hasAnyApiKey,
    summary: {
      selectedModelId,
      apiKeyProviders: Object.entries(apiKeys)
        .filter(([, value]) => Boolean(value))
        .map(([provider]) => provider)
    }
  };
}

function buildTestModelPreferences(modelId) {
  return {
    mode: 'cloud',
    autoFallback: true,
    preferredCloudModels: {
      layoutAnalysis: modelId,
      textOptimize: modelId,
      visualAnalyze: modelId
    },
    orchestrator: {
      primaryModel: modelId,
      fallbackModel: modelId,
      workers: {
        vision: { modelId, enabled: true },
        design: { modelId, enabled: true },
        executor: { modelId, enabled: true }
      }
    }
  };
}

function buildPublicReportPaths() {
  if (!DIRECT_PROVIDER_PROBE_MODE) {
    return { json: REPORT_JSON, md: REPORT_MD };
  }
  return {
    json: path.relative(ROOT, REPORT_JSON).replace(/\\/g, '/'),
    md: path.relative(ROOT, REPORT_MD).replace(/\\/g, '/')
  };
}

function sanitizeCapabilityProbeDiagnostic(value) {
  const text = String(value || '');
  if (!DIRECT_PROVIDER_PROBE_MODE) return text;
  return text
    .split(ROOT).join('[PROJECT_ROOT]')
    .replace(/[A-Za-z]:[\\/][^\r\n"']+/g, '[LOCAL_PATH]');
}

function seedIsolatedProviderState(userDataDir, providerConfig) {
  const entries = {};
  const apiKeys = providerConfig.apiKeys;
  const modelPreferences = buildTestModelPreferences(providerConfig.selectedModelId);
  const rendererState = {
    apiKeys,
    modelPreferences,
    customModels: []
  };
  const persistedStore = {
    state: rendererState,
    version: 33
  };

  entries.rendererState = JSON.stringify(rendererState);
  entries['designecho-storage'] = JSON.stringify(persistedStore);

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'app-state-store.json'),
    JSON.stringify({ entries }, null, 2),
    'utf8'
  );
}

function writeReports(result) {
  const publicReportPaths = buildPublicReportPaths();
  const lines = [
    CAPABILITY_PROBE_MODE
      ? '# Agent Capability Provider Probe'
      : NO_REDO_PROBE_MODE
        ? '# Agent No-Redo Provider Probe'
        : '# Agent Real Provider Acceptance',
    '',
    '- success: ' + result.success,
    '- skipped: ' + Boolean(result.skipped),
    result.error ? '- error: ' + result.error : '',
    '- report: ' + publicReportPaths.json,
    '',
    '## Cases'
  ];

  for (const item of result.cases || []) {
    lines.push('- ' + item.id + ': ' + item.status + ' | ' + item.summary);
  }

  lines.push('', '## Checks');
  for (const check of result.checks || []) {
    lines.push('- ' + check);
  }

  lines.push('', '## Boundaries');
  for (const item of result.boundaries || []) {
    lines.push('- ' + item);
  }

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, lines.filter(Boolean).join('\n'), 'utf8');
}

function writeSkippedReport(reason) {
  const mode = CAPABILITY_PROBE_MODE
    ? 'guarded-real-provider-capability-probe-fake-photoshop'
    : NO_REDO_PROBE_MODE
      ? 'guarded-real-provider-no-redo-probe-fake-photoshop'
      : 'guarded-real-provider-fake-photoshop';
  const boundaries = CAPABILITY_PROBE_MODE
    ? [
        'This skipped run did not call a live model provider or consume API quota.',
        'When explicitly armed, the production generic initial schema set is exposed, but returned Tool calls are not executed; only Capability selections can be applied in memory.',
        'A guarded skip proves the opt-in boundary only; it is not a real-provider selection result.'
      ]
    : NO_REDO_PROBE_MODE
      ? [
          'This skipped run did not call a live model provider or consume API quota.',
          'When explicitly armed, the provider receives only the production R4 declaration schema; returned Tool calls are never executed.',
          'A guarded skip proves the opt-in and no-execution boundary only; it is not a real-provider resumeMapping result.'
        ]
      : [
        'Default execution must not call a live model provider.',
        'This runner uses fake Photoshop even when real provider mode is armed.',
        'Passing this runner proves real-provider desktop routing and result export only, not design quality.'
      ];
  const result = {
    success: true,
    skipped: true,
    mode,
    reason,
    requiredEnv: [
      'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE=1',
      'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API=1'
    ],
    boundaries,
    report: buildPublicReportPaths()
  };
  writeReports(result);
  console.log(JSON.stringify(result, null, 2));
}

function buildAcceptanceCases() {
  if (NO_REDO_PROBE_MODE) {
    return [
      {
        id: 'real-provider-no-redo-exact-reuse',
        title: 'Real provider should reuse a freshness-verified equivalent completed step',
        userInput: '当前目标仍是不透明度 80%，文档与项目状态未变化，旧节点已经完成并由最新读取结果确认。当前计划应复用该完成记录，不要把同一调整再做一次。',
        mode: 'direct_provider_probe',
        tags: ['real-provider', 'no-redo-probe', 'no-tool-execution'],
        noRedoProbe: {
          id: 'exact-reuse',
          expectedPolicy: 'reuse_completed_step',
          expectedPriorStepId: 'prior-opacity',
          currentCapabilityRef: 'photoshop.write.setLayerOpacity',
          currentStepGoal: '保持已经核实的不透明度 80% 结果。',
          maxDeclarations: 1
        }
      },
      {
        id: 'real-provider-no-redo-explicit-redo',
        title: 'Real provider should mark redo when the user explicitly changes the target',
        userInput: '用户把目标从不透明度 80% 改为 60%。旧节点仍真实存在，但当前目标已经变化，因此需要明确重做而不是复用为已完成。',
        mode: 'direct_provider_probe',
        tags: ['real-provider', 'no-redo-probe', 'no-tool-execution'],
        noRedoProbe: {
          id: 'explicit-redo',
          expectedPolicy: 'redo_required',
          expectedPriorStepId: 'prior-opacity',
          currentCapabilityRef: 'photoshop.write.setLayerOpacity',
          currentStepGoal: '把不透明度调整到新的 60% 目标。',
          maxDeclarations: 1
        }
      },
      {
        id: 'real-provider-no-redo-correct-no-map',
        title: 'Real provider should not map an unrelated new action to the old completed step',
        userInput: '当前新增任务是创建一条标题文字。旧完成节点只调整过图层不透明度，两者不是同一动作，不应建立 resumeMapping。',
        mode: 'direct_provider_probe',
        tags: ['real-provider', 'no-redo-probe', 'no-tool-execution'],
        noRedoProbe: {
          id: 'correct-no-map',
          expectedPolicy: 'none',
          currentCapabilityRef: 'photoshop.write.createTextLayer',
          currentStepGoal: '创建新的标题文字层。',
          maxDeclarations: 1
        }
      }
    ];
  }
  if (CAPABILITY_PROBE_MODE) {
    return [
      {
        id: 'real-provider-capability-project-asset-read',
        title: 'Real provider should load the smallest project-asset analysis capability and stop',
        userInput: PROJECT_ASSET_CAPABILITY_PROMPT,
        mode: 'desktop_bridge',
        tags: ['desktop', 'real-provider', 'capability-probe', 'no-write'],
        expectation: {
          shouldUseTools: true,
          shouldChangeDocument: false,
          maxIterations: 3,
          maxToolCalls: 1
        },
        capabilityProbe: {
          id: 'project-asset-read',
          expectedCapabilityIds: ['project.read.analyzeAssetContent'],
          acceptableAlternativeSets: [['skill.project-image-analysis']],
          forbiddenCapabilityPrefixes: [
            'photoshop.write.',
            'delivery.export.',
            'external.generate.',
            'context.state.'
          ],
          maxControlRequests: 1
        },
        notes: [
          'This developer acceptance prompt requests schema loading only.',
          'The loaded Tool or Skill must not execute in this case.'
        ]
      },
      {
        id: 'real-provider-capability-subject-fit',
        title: 'Real provider should identify the subject-fit capability without executing it',
        userInput: SUBJECT_FIT_CAPABILITY_PROMPT,
        mode: 'desktop_bridge',
        tags: ['desktop', 'real-provider', 'capability-probe', 'no-write'],
        expectation: {
          shouldUseTools: true,
          shouldChangeDocument: false,
          maxIterations: 3,
          maxToolCalls: 1
        },
        capabilityProbe: {
          id: 'subject-fit',
          expectedCapabilityIds: ['photoshop.write.fitLayerSubjectToRegion'],
          forbiddenCapabilityPrefixes: [
            'delivery.export.',
            'external.generate.',
            'context.state.'
          ],
          maxControlRequests: 1
        },
        notes: [
          'Loading a write-capable schema is not write authorization or execution.',
          'Any Tool other than requestAgentCapabilities fails the probe.'
        ]
      }
    ];
  }
  return [
    {
      id: 'real-provider-chat-no-photoshop',
      title: 'Real provider greeting should stay conversational and avoid Photoshop tools',
      userInput: GREETING_PROMPT,
      mode: 'desktop_bridge',
      tags: ['desktop', 'real-provider', 'chat', 'routing'],
      expectation: {
        route: 'direct_response',
        executionKind: 'none',
        shouldUseTools: false,
        shouldChangeDocument: false,
        maxIterations: 0,
        maxToolCalls: 0
      },
      notes: [
        'This case intentionally avoids Photoshop execution.',
        'The provider response text is not judged for quality; only route, lifecycle and no-tool boundaries are checked.'
      ]
    },
    {
      id: 'real-provider-sku-visible-reasoning',
      title: 'Real provider SKU request should expose public reasoning before fake Photoshop tool results',
      userInput: SKU_EXECUTION_PROMPT,
      mode: 'desktop_bridge',
      tags: ['desktop', 'real-provider', 'sku', 'visible-reasoning', 'execution-style'],
      expectation: {
        route: 'skill_execution',
        skillId: 'sku-batch',
        executionKind: 'deterministic_skill',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 80
      },
      expectedPublicReasoning: true,
      notes: [
        'This case uses real provider output only for the public visible_reasoning preview.',
        'Photoshop stays fake, so this cannot prove SKU design quality or real document writes.'
      ]
    }
  ];
}

function createCapabilityProbeSession() {
  loadCapabilityProbeRuntime();
  const workflowBridgeTools = buildSkillToolSchemas();
  return createAgentCapabilitySession({
    candidateTools: [
      ...getDefaultAgentTools(),
      DELEGATE_TOOL,
      TEAM_PIPELINE_TOOL,
      ...workflowBridgeTools
    ],
    workflowBridgeNames: workflowBridgeTools.map((tool) => tool.name),
    manifest: getManifestByTaskType('design.generic.v1')
  });
}

function buildNoRedoProbeRuntime() {
  loadCapabilityProbeRuntime();
  const allowedContextRefs = [
    'context:user_goal',
    'context:readback',
    'context:design_strategy'
  ];
  const strategyValidation = validateRuntimeDesignStrategyDeclaration({
    value: {
      stageGoal: '基于当前上下文判断旧完成节点应复用、重做还是保持无映射。',
      objective: {
        primaryGoal: '避免无依据重复，同时尊重用户当前目标。',
        secondaryGoals: ['保持结构化计划可审计'],
        targetAudienceSummary: '开发者行为探针。'
      },
      messageArchitecture: {
        primaryMessage: '当前目标优先，旧记录只在明确等价时复用。',
        supportingMessages: [],
        supportingFacts: ['旧节点已经通过新鲜度核验。'],
        objectionsToResolve: ['是否错误复用或遗漏重做']
      },
      copyDirection: {
        toneKeywords: ['明确'],
        headlineOptions: [],
        subtitleOptions: [],
        tagOptions: [],
        prohibitedClaims: ['未经核实的完成声明']
      },
      visualDirection: {
        moodKeywords: ['克制'],
        paletteIntent: ['本探针不评价色彩。'],
        typographyIntent: ['本探针不评价排版。'],
        compositionIntent: ['本探针只评价计划映射。'],
        imageTreatment: ['不执行图像处理。'],
        density: 'low'
      },
      constraints: ['不执行任何 Tool。'],
      contextRefs: ['context:user_goal', 'context:readback'],
      assumptions: [],
      missingInputs: []
    },
    allowedContextRefs
  });
  assert(strategyValidation.ok && strategyValidation.declaration, 'No-redo probe strategy fixture is invalid.');
  const hierarchyResult = {
    success: true,
    totalLayers: 1,
    flatList: [{
      id: 7,
      kind: 'pixel',
      visible: true,
      locked: false,
      opacity: 80,
      blendMode: 'normal',
      parentId: 0,
      index: 0,
      depth: 0
    }]
  };
  const anchor = buildRuntimeResumeContextAnchor({
    toolCallLog: [{
      name: 'getLayerHierarchy',
      arguments: { includeHidden: true, flatList: true },
      result: hierarchyResult
    }]
  });
  const freshness = evaluateRuntimeActionPlanResumeFreshness({
    sourceRunId: 'run-provider-probe-prior',
    previousAnchor: anchor,
    currentAnchor: anchor,
    completedStepIds: ['prior-opacity'],
    completedStepDescriptors: [{
      stepId: 'prior-opacity',
      kind: 'mutate',
      capabilityRefs: ['photoshop.write.setLayerOpacity'],
      observedOutcomes: ['document_change']
    }],
    resumeStepIds: ['prior-verify'],
    probeSucceeded: true
  });
  assert(freshness.status === 'verified', 'No-redo probe freshness fixture is not verified.');
  const capabilityContext = {
    discoveredCapabilityRefs: [
      'photoshop.write.setLayerOpacity',
      'photoshop.write.createTextLayer'
    ],
    activeActionCapabilityRefs: [
      'photoshop.write.setLayerOpacity',
      'photoshop.write.createTextLayer'
    ],
    onDemandActionCapabilityRefs: []
  };
  const strategyDigest = buildRuntimeDesignStrategyDigest(strategyValidation.declaration);
  const actionContextRefs = ['context:user_goal', 'context:readback', 'context:design_strategy'];
  const tool = buildDeclareRuntimeActionPlanToolSchema({
    allowedContextRefs: actionContextRefs,
    discoveredCapabilityRefs: capabilityContext.discoveredCapabilityRefs,
    verifiedCompletedStepIds: freshness.verifiedCompletedStepIds
  });
  return { allowedContextRefs, actionContextRefs, capabilityContext, strategyDigest, freshness, tool };
}

function buildNoRedoProbeSystemPrompt(acceptanceCase) {
  const probe = acceptanceCase.noRedoProbe;
  return [
    'You are a developer acceptance probe for model-authored R4 resumeMapping behavior.',
    'Call declareRuntimeActionPlan exactly once and do not answer with plain text.',
    'Create one step with stepId current-action, kind mutate, no dependencies, the exact current Capability id, input context context:design_strategy and context:readback, expected outcome document_change, one concise completion criterion, and failure policy replan.',
    'Use planGoal for the current task, strategyRef current:r3_design_strategy, contextRefs context:user_goal/context:readback/context:design_strategy, and missingInputs [].',
    'Freshness-verified completed prior step: prior-opacity; kind=mutate; Capability=photoshop.write.setLayerOpacity; Result=document_change.',
    'Pending prior step prior-verify is not completed and must never be mapped.',
    'Add resumeMapping only when current-action is explicitly equivalent to prior-opacity.',
    'If the prior result can be reused unchanged, use policy reuse_completed_step. If the user changed the target and the action must run again, use redo_required. If unrelated, omit resumeMapping.',
    'Current Capability id: ' + probe.currentCapabilityRef + '.',
    'Current step goal: ' + probe.currentStepGoal,
    'Do not call or describe any other Tool. The declaration is validation data only and executes nothing.'
  ].join(' ');
}

function buildNoRedoProbeExpectedPlan(acceptanceCase) {
  const probe = acceptanceCase.noRedoProbe;
  return {
    planGoal: '完成当前聚焦动作并保持跨轮结果可复核。',
    strategyRef: CURRENT_R3_STRATEGY_REF,
    contextRefs: ['context:user_goal', 'context:readback', 'context:design_strategy'],
    steps: [{
      stepId: 'current-action',
      kind: 'mutate',
      goal: probe.currentStepGoal,
      dependsOn: [],
      capabilityRefs: [probe.currentCapabilityRef],
      inputContextRefs: ['context:design_strategy', 'context:readback'],
      expectedOutcomes: ['document_change'],
      completionCriteria: ['当前动作产生预期文档变化。'],
      failurePolicy: 'replan',
      ...(probe.expectedPolicy === 'none' ? {} : {
        resumeMapping: {
          priorStepId: probe.expectedPriorStepId,
          policy: probe.expectedPolicy
        }
      })
    }],
    missingInputs: []
  };
}

function buildNoRedoProbePlanEvent(name, value, runtime) {
  if (name !== DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME) {
    return { name, success: false };
  }
  const validation = validateRuntimeActionPlanDeclaration({
    value,
    strategyDigest: runtime.strategyDigest,
    allowedContextRefs: runtime.actionContextRefs,
    capabilityContext: runtime.capabilityContext,
    resumeFreshness: runtime.freshness
  });
  const mappings = validation.declaration
    ? validation.declaration.payload.steps
        .filter((step) => Boolean(step.resumeMapping))
        .map((step) => ({
          currentStepId: step.stepId,
          priorStepId: step.resumeMapping.priorStepId,
          policy: step.resumeMapping.policy
        }))
    : [];
  return {
    name,
    success: validation.ok === true,
    planControl: {
      status: validation.ok ? 'validated' : 'invalid',
      mappings,
      issueCodes: Array.from(new Set(validation.issues.map((issue) => issue.code))).slice(0, 20),
      modelAuthored: validation.declaration?.boundaries.modelAuthored === true,
      harnessValidatedOnly: validation.declaration?.boundaries.harnessValidatedOnly === true,
      executesTools: false,
      blocksTools: false,
      skipsTools: false,
      schedulerAuthority: false
    }
  };
}

function runNoRedoProbeRuntimeSelfTest() {
  const acceptanceCases = buildAcceptanceCases();
  const results = acceptanceCases.map((acceptanceCase) => {
    const runtime = buildNoRedoProbeRuntime();
    const priorStepEnum = runtime.tool.inputSchema.properties.steps.items.properties
      .resumeMapping.properties.priorStepId.enum;
    assert(
      JSON.stringify(priorStepEnum) === JSON.stringify(['prior-opacity']),
      acceptanceCase.id + ' production schema exposed the wrong completed-step ids.'
    );
    const event = buildNoRedoProbePlanEvent(
      DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
      buildNoRedoProbeExpectedPlan(acceptanceCase),
      runtime
    );
    const result = evaluateAgentNoRedoProviderProbe({
      spec: acceptanceCase.noRedoProbe,
      events: [event]
    });
    assert(result.status === 'passed', acceptanceCase.id + ' self-test failed: ' + JSON.stringify(result));
    return { id: acceptanceCase.id, verdict: result.verdict };
  });
  console.log(JSON.stringify({
    success: true,
    mode: 'offline-no-redo-provider-runtime-self-test',
    providerCalled: false,
    toolExecuted: false,
    results
  }, null, 2));
}

async function runNoRedoProviderCase(page, acceptanceCase, modelId) {
  debugState.stage = 'no-redo-probe:' + acceptanceCase.id;
  const runtime = buildNoRedoProbeRuntime();
  const response = await page.evaluate(async (input) => {
    return window.designEcho.chatWithTools(
      input.modelId,
      input.messages,
      input.tools,
      input.options
    );
  }, {
    modelId,
    messages: [
      { role: 'system', content: buildNoRedoProbeSystemPrompt(acceptanceCase) },
      { role: 'user', content: acceptanceCase.userInput }
    ],
    tools: [runtime.tool],
    options: {
      maxTokens: 900,
      temperature: 0,
      purpose: 'agent_no_redo_provider_probe',
      silent: true,
      stream: false
    }
  });
  const toolCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
  const events = toolCalls.map((toolCall) => buildNoRedoProbePlanEvent(
    String(toolCall?.name || '').trim() || 'unknown-tool',
    toolCall?.arguments,
    runtime
  ));
  const noRedoProbe = evaluateAgentNoRedoProviderProbe({
    spec: acceptanceCase.noRedoProbe,
    events
  });
  debugState.lastCapabilityProbe = noRedoProbe;
  return {
    id: acceptanceCase.id,
    status: noRedoProbe.status,
    summary: `No-redo provider probe verdict: ${noRedoProbe.verdict}.`,
    issueLayers: noRedoProbe.status === 'passed' ? [] : ['model', 'planning'],
    metrics: {
      providerToolCallCount: toolCalls.length,
      exposedToolSchemaCount: 1,
      validatedDeclarationCount: events.filter((event) => event.planControl?.status === 'validated').length
    },
    checkCount: 1,
    noRedoProbe
  };
}

async function runCapabilityProviderCase(page, acceptanceCase, modelId) {
  debugState.stage = 'capability-probe:' + acceptanceCase.id;
  const capabilitySession = createCapabilityProbeSession();
  const requestTool = capabilitySession.activeTools.find((tool) => (
    tool.name === REQUEST_AGENT_CAPABILITIES_TOOL_NAME
  ));
  assert(requestTool, 'Capability probe could not find requestAgentCapabilities schema.');

  const response = await page.evaluate(async (input) => {
    return window.designEcho.chatWithTools(
      input.modelId,
      input.messages,
      input.tools,
      input.options
    );
  }, {
    modelId,
    messages: [
      {
        role: 'system',
        content: [
          'You are a developer acceptance probe for Agent Capability selection.',
          'Call requestAgentCapabilities exactly once with the smallest sufficient capability id set.',
          'Do not answer with plain text and do not request unrelated capabilities.'
        ].join(' ')
      },
      { role: 'user', content: acceptanceCase.userInput }
    ],
    tools: capabilitySession.activeTools,
    options: {
      maxTokens: 256,
      temperature: 0,
      purpose: 'agent_capability_provider_probe',
      silent: true,
      stream: false
    }
  });

  const toolCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
  const toolEvents = [];
  for (const toolCall of toolCalls) {
    const toolName = String(toolCall?.name || '').trim() || 'unknown-tool';
    if (toolName !== REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
      toolEvents.push({ name: toolName, success: false });
      continue;
    }
    const requestedCapabilityIds = Array.isArray(toolCall?.arguments?.capabilityIds)
      ? toolCall.arguments.capabilityIds.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const activation = capabilitySession.requestCapabilities(requestedCapabilityIds);
    toolEvents.push({
      name: toolName,
      success: activation.status !== 'rejected',
      capabilityControl: {
        status: activation.status,
        requestedCapabilityIds: activation.requestedCapabilityIds,
        activatedCapabilityIds: activation.activatedCapabilityIds,
        changesModelVisibleSchemasOnly: true,
        executesPhotoshop: false,
        grantsPermission: false,
        countsAsObservation: false,
        countsAsTaskProgress: false
      }
    });
  }

  const capabilityProbe = evaluateAgentCapabilityProviderProbe({
    spec: acceptanceCase.capabilityProbe,
    toolEvents
  });
  debugState.lastCapabilityProbe = capabilityProbe;
  const status = capabilityProbe.status === 'passed' ? 'passed' : 'failed';
  return {
    id: acceptanceCase.id,
    status,
    summary: `Capability probe verdict: ${capabilityProbe.verdict}.`,
    issueLayers: status === 'passed' ? [] : ['model', 'tool'],
    metrics: {
      toolCount: toolEvents.length,
      providerToolCallCount: toolCalls.length,
      exposedToolSchemaCount: capabilitySession.activeTools.length,
      modelContentChars: String(response?.content || '').length,
      modelThinkingChars: String(response?.thinking || '').length
    },
    checkCount: 1,
    capabilityProbe
  };
}

function summarizeSnapshot(snapshot) {
  return {
    isLoading: snapshot && snapshot.isLoading,
    messageCount: snapshot && snapshot.messageCount,
    messages: ((snapshot && snapshot.messages) || []).map((message) => ({
      role: message.role,
      contentPreview: message.contentPreview,
      thinkingStepCount: message.thinkingStepCount,
      thinkingBlockTitles: message.thinkingBlockTitles,
      toolResultCount: message.toolResultCount,
      executionStatus: message.executionStatus,
      executionSummaryPreview: message.executionSummaryPreview
    }))
  };
}

async function submitAndExport(page, acceptanceCase) {
  debugState.stage = 'submit:' + acceptanceCase.id;
  const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
  const after = await page.evaluate((input) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(input, { timeoutMs: 45000 })
  ), acceptanceCase.userInput);
  debugState.lastSnapshot = summarizeSnapshot(after);

  const debug = await page.evaluate((casePayload) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getLatestAcceptanceDebug(casePayload)
  ), acceptanceCase);
  debugState.lastReport = debug.report;

  const newMessages = after.messages.slice(before.messageCount);
  const text = newMessages.map((message) => message.contentPreview || '').join('\n');
  const thinking = newMessages.map((message) => message.thinkingPreview || '').join('\n');

  assert(
    newMessages.some((message) => message.role === 'user' && message.contentPreview.includes(acceptanceCase.userInput)),
    acceptanceCase.id + ' did not append the user message.'
  );
  assert(newMessages.some((message) => message.role === 'assistant'), acceptanceCase.id + ' did not append an assistant message.');
  assert(debug.bundle && debug.bundle.caseId === acceptanceCase.id, acceptanceCase.id + ' debug bundle has the wrong caseId.');
  assert(debug.report && debug.report.caseId === acceptanceCase.id, acceptanceCase.id + ' report has the wrong caseId.');
  assert(debug.report && debug.report.status === 'passed', acceptanceCase.id + ' acceptance report did not pass: ' + JSON.stringify(debug.report, null, 2));
  assert(!text.includes('Agent \u9762\u677f\u6865\u63a5\u6d88\u606f\u5df2\u751f\u6210'), acceptanceCase.id + ' leaked debug bridge copy.');
  assert(!text.includes('"intent": "debug_or_implement"'), acceptanceCase.id + ' leaked debug JSON.');
  if (acceptanceCase.expectation?.shouldUseTools !== true) {
    assert(!thinking.includes('getDocumentInfo'), acceptanceCase.id + ' should not expose Photoshop tool calls for a non-execution request.');
  }
  if (acceptanceCase.expectedPublicReasoning) {
    assertPublicReasoningBoundary(acceptanceCase, debug.bundle);
  }
  return {
    id: acceptanceCase.id,
    status: debug.report.status,
    summary: debug.report.summary,
    issueLayers: debug.report.issueLayers,
    runRecords: debug.report.runRecords,
    checkCount: debug.report.checks.length,
    bundle: debug.bundle,
    report: debug.report
  };
}

function assertPublicReasoningBoundary(acceptanceCase, bundle) {
  const visibleThinking = Array.isArray(bundle && bundle.visibleThinking)
    ? bundle.visibleThinking.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const combined = visibleThinking.join('\n');
  assert(
    visibleThinking.length > 0 && combined.length >= 8,
    acceptanceCase.id + ' did not expose a non-empty real-provider public visible reasoning preview.'
  );
  for (const banned of [
    '\u7b49\u5f85\u54cd\u5e94',
    '\u6b63\u5728\u51c6\u5907',
    '\u8bf7\u6c42\u5df2\u53d1\u9001',
    'Agent Router',
    'agentRequestLifecycle',
    'routeSource',
    'executionKind',
    'getDocumentInfo',
    'getLayerHierarchy',
    'skuLayout',
    '\u5de5\u5177\u5b8c\u6210'
  ]) {
    assert(!combined.includes(banned), acceptanceCase.id + ' leaked non-model or tool text into public reasoning: ' + banned);
  }
}

async function main() {
  if (NO_REDO_PROBE_SELF_TEST) {
    assert(NO_REDO_PROBE_MODE, '--no-redo-probe-self-test requires --no-redo-probe.');
    runNoRedoProbeRuntimeSelfTest();
    return;
  }
  if (!isArmed()) {
    writeSkippedReport('Real provider Agent acceptance is not armed.');
    return;
  }

  const providerConfig = collectProviderAcceptanceConfig();
  if (!providerConfig.hasAnyApiKey || !providerConfig.selectedModelId) {
    writeSkippedReport(
      'Real provider Agent acceptance is armed, but no test provider API key/model was provided. '
        + 'Set DESIGNECHO_TEST_XIAOMI_API_KEY, DESIGNECHO_TEST_OPENROUTER_API_KEY, '
        + 'DESIGNECHO_TEST_GPTSAPI_API_KEY, DESIGNECHO_TEST_DEEPSEEK_API_KEY or DESIGNECHO_TEST_GOOGLE_API_KEY.'
    );
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist', 'renderer', 'index.html');
  assert(fs.existsSync(mainEntry), 'Missing built Electron main entry: ' + mainEntry + '. Run npm run build first.');
  assert(fs.existsSync(rendererEntry), 'Missing built renderer entry: ' + rendererEntry + '. Run npm run build first.');

  const testPortBase = await findFreePortBlock();
  const userDataDir = resetDir('agent-real-provider-acceptance-user-data');
  seedIsolatedProviderState(userDataDir, providerConfig);
  const projectDir = resetTestProjectDir();
  const acceptanceCases = buildAcceptanceCases();
  let app;

  try {
    debugState.stage = 'launch';
    app = await electron.launch({
      args: [ROOT, '--user-data-dir=' + userDataDir],
      cwd: ROOT,
      env: {
        ...process.env,
        DESIGNECHO_CHAT_TEST_BRIDGE: '1',
        DESIGNECHO_TEST_USER_DATA_DIR: userDataDir,
        DESIGNECHO_CHAT_TEST_PROJECT_PATH: projectDir,
        DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP: '1',
        DESIGNECHO_PORT_OFFSET: String(testPortBase - WS_PORT),
        DESIGNECHO_SKIP_PORT_CLEANUP: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    debugState.stage = 'renderer-load';
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    const bridgeInfo = await page.evaluate(() => ({
      hasBridge: !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__,
      hasAcceptanceDebug: typeof window.__DESIGNECHO_CHAT_TEST_BRIDGE__?.getLatestAcceptanceDebug === 'function',
      query: window.location.search
    }));
    assert(bridgeInfo.hasBridge, 'ChatPanel test bridge is not available.');
    assert(bridgeInfo.hasAcceptanceDebug, 'ChatPanel test bridge did not expose getLatestAcceptanceDebug.');
    assert(String(bridgeInfo.query).includes('designechoChatTestBridge=1'), 'Renderer query did not enable the test bridge.');
    assert(String(bridgeInfo.query).includes('designechoChatTestFakePhotoshop=1'), 'Renderer query did not enable fake Photoshop.');

    const cases = [];
    for (const acceptanceCase of acceptanceCases) {
      if (CAPABILITY_PROBE_MODE) {
        cases.push(await runCapabilityProviderCase(page, acceptanceCase, providerConfig.selectedModelId));
      } else if (NO_REDO_PROBE_MODE) {
        cases.push(await runNoRedoProviderCase(page, acceptanceCase, providerConfig.selectedModelId));
      } else {
        cases.push(await submitAndExport(page, acceptanceCase));
      }
    }
    const mode = CAPABILITY_PROBE_MODE
      ? 'desktop-bridge-real-provider-capability-probe-fake-photoshop'
      : NO_REDO_PROBE_MODE
        ? 'desktop-bridge-real-provider-no-redo-probe-fake-photoshop'
        : 'desktop-bridge-real-provider-fake-photoshop';
    const checks = CAPABILITY_PROBE_MODE
      ? [
          'Electron desktop app launched with isolated userData and isolated ports.',
          'The real provider received the production generic initial schema set from a real Capability Session.',
          'Real provider mode did not set DESIGNECHO_CHAT_TEST_FAKE_MODEL.',
          'Fake Photoshop stayed enabled so the probe cannot modify a real document.',
          'The Harness activated selected Capability ids in memory without executing any loaded Tool.',
          'Each case required exactly one requestAgentCapabilities call; any competing initial Tool selection failed the probe.',
          'Requested and activated Capability ids satisfied the pure minimal-selection evaluator.'
        ]
      : NO_REDO_PROBE_MODE
        ? [
            'Electron desktop app launched with isolated userData and isolated ports.',
            'The real provider received only the production declareRuntimeActionPlan schema.',
            'Real provider mode did not set DESIGNECHO_CHAT_TEST_FAKE_MODEL.',
            'Fake Photoshop stayed enabled as defense in depth.',
            'Returned Tool calls were converted to allowlisted validation events and never executed.',
            'Production R4 validation checked strategy, context references, Capability and freshness-verified prior ids.',
            'Reuse, explicit redo and unrelated no-mapping cases were evaluated deterministically.'
          ]
        : [
          'Electron desktop app launched with isolated userData and isolated ports.',
          'ChatPanel test bridge exposed getLatestAcceptanceDebug.',
          'Real provider mode did not set DESIGNECHO_CHAT_TEST_FAKE_MODEL.',
          'Isolated userData was seeded with redacted test provider config before launch.',
          'Fake Photoshop stayed enabled so this case cannot modify a real document.',
          'Greeting request produced a direct_response lifecycle and no tool results.',
          'Execution-style SKU request exposed non-empty public visible reasoning from the real provider.',
          'Execution-style SKU request kept local placeholders, router internals and tool names out of public reasoning.'
        ];
    const boundaries = CAPABILITY_PROBE_MODE
      ? [
          'This probe can call the configured live model provider only when explicitly armed.',
          'It records only allowlisted Capability control fields and never arbitrary Tool arguments.',
          'The provider sees the production generic initial schema set; no returned Tool call is executed.',
          'Only requestAgentCapabilities selections are applied to the in-memory Capability Session.',
          'It uses fake Photoshop as defense in depth and cannot modify a real document.',
          'It measures constrained Capability selection, not normal conversation or design quality.'
        ]
      : NO_REDO_PROBE_MODE
        ? [
            'This probe can call the configured live model provider only when explicitly armed.',
            'The provider sees one production R4 declaration schema; no returned Tool call is executed.',
            'Reports retain only allowlisted mapping ids, policies, validator issue codes and counts.',
            'Fake Photoshop is defense in depth; the probe does not enter the Agent executor.',
            'It measures focused resumeMapping behavior, not full Agent planning, Photoshop or design quality.'
          ]
        : [
          'This runner can call the configured live model provider only when explicitly armed.',
          'This runner uses fake Photoshop and cannot prove real Photoshop behavior.',
          'This runner does not score model answer quality or design quality.'
        ];
    const result = {
      success: cases.every((item) => item.status === 'passed'),
      skipped: false,
      mode,
      providerConfig: providerConfig.summary,
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      ...(DIRECT_PROVIDER_PROBE_MODE ? {} : { testUserDataDir: userDataDir, testProjectDir: projectDir }),
      cases,
      checks,
      boundaries,
      report: buildPublicReportPaths()
    };
    writeReports(result);
    console.log(JSON.stringify({
      success: result.success,
      skipped: result.skipped,
      mode: result.mode,
      report: result.report,
      cases: result.cases.map((caseResult) => ({
        id: caseResult.id,
        status: caseResult.status,
        summary: caseResult.summary,
        ...(caseResult.capabilityProbe ? { capabilityProbe: caseResult.capabilityProbe } : {}),
        ...(caseResult.noRedoProbe ? { noRedoProbe: caseResult.noRedoProbe } : {})
      }))
    }, null, 2));
    if (!result.success) process.exit(1);
  } finally {
    if (app) {
      await app.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const result = {
    success: false,
    skipped: false,
    error: sanitizeCapabilityProbeDiagnostic(
      error && error.stack ? error.stack : (error && error.message ? error.message : String(error))
    ),
    debug: debugState,
    report: buildPublicReportPaths(),
    boundaries: [
      'A failed real-provider acceptance run should be treated as a provider, routing, UI bridge or configuration signal.',
      'Do not interpret this failure as Photoshop or design-quality verification because fake Photoshop is used.'
    ]
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
