const fs = require('fs');
const path = require('path');
const assert = require('assert');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildDesignerAgentTeamConsultationContract,
  buildDesignerAgentTeamConsultationProgress
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'designer-agent-team-consultation-contract.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));

const cases = [];

function record(name, fn) {
  try {
    const details = fn();
    cases.push({ name, status: 'pass', details });
  } catch (error) {
    cases.push({
      name,
      status: 'fail',
      details: {
        message: error && error.message ? error.message : String(error)
      }
    });
  }
}

function roleNames(contract) {
  return contract.rolePlan.map((item) => item.role);
}

record('casual-greeting-does-not-enter-design-team-consultation', () => {
  const decision = buildAgentIntentControlPlaneDecision({
    userInput: '你好',
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(decision.requestKind, 'chat_only');
  assert.strictEqual(decision.toolScope, 'none');
  assert(decision.matchedSignals.includes('casual_conversation'));

  const contract = buildDesignerAgentTeamConsultationContract({
    userTask: '你好',
    scenario: 'unknown',
    decisionStatus: 'ready',
    hasProjectVisualObservation: false,
    hasCurrentDocument: true
  });
  assert.strictEqual(contract.status, 'not_required');
  assert.strictEqual(contract.mode, 'none');
  assert.deepStrictEqual(contract.rolePlan, []);

  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  assert(source.includes('const designerAgentDecisionContract = shouldUseDesignerAgentDecisionLayer(runtimeParams, context)'));
  assert(source.includes('const designerAgentTeamConsultationInput = designerAgentDecisionContract'));
  return {
    requestKind: decision.requestKind,
    toolScope: decision.toolScope,
    teamStatus: contract.status
  };
});

record('recommends-advisory-team-for-ecommerce-design-task-without-forcing-all-roles', () => {
  const contract = buildDesignerAgentTeamConsultationContract({
    userTask: '帮我用项目素材做一张袜子主图，突出透气和弹力',
    scenario: 'main-image',
    decisionStatus: 'needs_design_decision',
    hasProjectVisualObservation: true,
    hasCurrentDocument: false
  });
  const roles = roleNames(contract);
  assert.strictEqual(contract.status, 'recommended');
  assert.strictEqual(contract.mode, 'advisory');
  assert.deepStrictEqual(roles, ['design-strategist']);
  assert(contract.rolePlan.every((item) => Array.isArray(item.requiredDeliverables) && item.requiredDeliverables.length > 0));
  assert(contract.promptSection.includes('专业设计团队协作协议'));
  assert(contract.promptSection.includes('角色交付标准'));
  assert(contract.toolGuidance.some((item) => item.includes('delegateToAgent')));
  return { status: contract.status, mode: contract.mode, roles };
});

record('team-progress-requires-all-before-write-roles-before-photoshop-write', () => {
  const contract = buildDesignerAgentTeamConsultationContract({
    userTask: '帮我用项目素材做一张袜子主图，突出透气和弹力',
    scenario: 'main-image',
    decisionStatus: 'needs_design_decision',
    hasProjectVisualObservation: true,
    hasCurrentDocument: false,
    explicitTeamRequest: true
  });
  const partial = buildDesignerAgentTeamConsultationProgress({
    contract,
    completedRoles: ['scene-analyst']
  });
  assert.strictEqual(partial.readyForWrite, false);
  assert(partial.missingRoles.includes('market-researcher'));
  assert(partial.missingRoles.includes('copywriter'));
  assert(partial.missingRoles.includes('design-strategist'));
  assert.strictEqual(partial.nextRequiredRole, 'market-researcher');

  const complete = buildDesignerAgentTeamConsultationProgress({
    contract,
    completedRoles: ['scene-analyst', 'market-researcher', 'copywriter', 'design-strategist']
  });
  assert.strictEqual(complete.readyForWrite, true);
  assert.deepStrictEqual(complete.missingRoles, []);

  const beforeExport = buildDesignerAgentTeamConsultationProgress({
    contract,
    completedRoles: ['scene-analyst', 'market-researcher', 'copywriter', 'design-strategist'],
    phase: 'after_draft'
  });
  assert.strictEqual(beforeExport.readyForWrite, false);
  assert.deepStrictEqual(beforeExport.missingRoles, ['critic']);
  assert.strictEqual(beforeExport.nextRequiredRole, 'critic');
  assert(beforeExport.publicMessage.includes('交付前'));

  const exportReady = buildDesignerAgentTeamConsultationProgress({
    contract,
    completedRoles: ['scene-analyst', 'market-researcher', 'copywriter', 'design-strategist', 'critic'],
    phase: 'after_draft'
  });
  assert.strictEqual(exportReady.readyForWrite, true);

  const pipelineComplete = buildDesignerAgentTeamConsultationProgress({
    contract,
    completedRoles: [],
    pipelineCompleted: true
  });
  assert.strictEqual(pipelineComplete.readyForWrite, true);
  return {
    partial,
    complete,
    beforeExport,
    exportReady,
    pipelineComplete
  };
});

record('fresh-detail-page-without-explicit-team-does-not-block-first-write', () => {
  const contract = buildDesignerAgentTeamConsultationContract({
    userTask: '请基于当前项目素材从零创建一个电商袜子详情页文档',
    scenario: 'detail-page',
    decisionStatus: 'needs_design_decision',
    hasProjectVisualObservation: true,
    hasCurrentDocument: true,
    explicitTeamRequest: false
  });
  assert.strictEqual(contract.status, 'recommended');
  assert.strictEqual(contract.mode, 'advisory');
  const progress = buildDesignerAgentTeamConsultationProgress({
    contract,
    completedRoles: []
  });
  assert.strictEqual(progress.readyForWrite, true);
  assert.deepStrictEqual(progress.missingRoles, []);
  return { status: contract.status, mode: contract.mode, progress };
});

record('full-fresh-detail-page-wording-does-not-become-current-document-pipeline', () => {
  const contract = buildDesignerAgentTeamConsultationContract({
    userTask: '完整推进详情页文档。按照文档名称区分：详情页文档就是详情页，SKU 就是 SKU；如果当前打开的是 SKU 文档，不要把 SKU 当详情页模板。',
    scenario: 'detail-page',
    decisionStatus: 'needs_design_decision',
    hasProjectVisualObservation: true,
    hasCurrentDocument: true,
    explicitTeamRequest: false
  });
  assert.strictEqual(contract.status, 'recommended');
  assert.strictEqual(contract.mode, 'advisory');
  const progress = buildDesignerAgentTeamConsultationProgress({
    contract,
    completedRoles: []
  });
  assert.strictEqual(progress.readyForWrite, true);
  assert.deepStrictEqual(progress.missingRoles, []);
  return { status: contract.status, mode: contract.mode, progress };
});

record('uses-pipeline-mode-for-whole-current-document-improvement', () => {
  const contract = buildDesignerAgentTeamConsultationContract({
    userTask: '整体优化当前主图，让画面更有商业感',
    scenario: 'main-image',
    decisionStatus: 'ready',
    hasProjectVisualObservation: true,
    hasCurrentDocument: true
  });
  assert.strictEqual(contract.status, 'required');
  assert.strictEqual(contract.mode, 'pipeline');
  assert(contract.toolGuidance.some((item) => item.includes('runDesignTeamPipeline')));
  return { status: contract.status, mode: contract.mode, roles: roleNames(contract) };
});

record('keeps-small-local-edits-lightweight', () => {
  const contract = buildDesignerAgentTeamConsultationContract({
    userTask: '把标题往上移动一点',
    scenario: 'general-design',
    decisionStatus: 'ready',
    hasProjectVisualObservation: true,
    hasCurrentDocument: true
  });
  assert.strictEqual(contract.status, 'not_required');
  assert.strictEqual(contract.mode, 'none');
  assert.deepStrictEqual(roleNames(contract), []);
  assert(contract.toolGuidance.some((item) => item.includes('不需要启动设计团队')));
  return { status: contract.status, mode: contract.mode, roles: roleNames(contract) };
});

record('autonomous-agent-is-wired-to-team-consultation-contract', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  assert(source.includes('buildDesignerAgentTeamConsultationContract'));
  assert(source.includes('buildDesignerAgentTeamConsultationProgress'));
  assert(source.includes('designerAgentTeamConsultationContract.promptSection'));
  assert(source.includes('专业团队准备'));
  // 团队工具进入统一 capability 候选集，再由结构化 manifest/session 决定是否开放；
  // 不再由自然语言正则或详情页专属分支临时 push 工具。
  assert(source.includes('const candidateTools = ['));
  assert(source.includes('DELEGATE_TOOL,'));
  assert(source.includes('TEAM_PIPELINE_TOOL,'));
  assert(source.includes('createAgentCapabilitySession({'));
  assert(source.includes('completedDesignTeamRoles'));
  assert(source.includes("phase: executionKind === 'save_export' ? 'after_draft' : 'before_write'"));
  assert(!source.includes('designTeamConsultationCompleted = true;'));
  assert(source.includes("const executionKind = classifyAgentToolExecution(toolName, toolParams);"));
  assert(source.includes("['photoshop_write', 'save_export'].includes(executionKind)"));
  assert(source.includes('这次需要先完成专业角色判断，再开始改动画面。'));
  assert(!source.includes('不要调用 delegateToAgent 或 runDesignTeamPipeline'));
  return { checked: 'autonomous-agent.executor.ts' };
});

const failed = cases.filter((item) => item.status !== 'pass');
const report = {
  success: failed.length === 0,
  cases
};

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(
  path.join(tmpDir, 'designer-agent-team-consultation-smoke.json'),
  JSON.stringify(report, null, 2),
  'utf8'
);

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status }) => ({ name, status }))
}, null, 2));

process.exit(report.success ? 0 : 1);
