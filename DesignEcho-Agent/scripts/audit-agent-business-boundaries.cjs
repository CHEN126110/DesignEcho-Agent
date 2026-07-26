#!/usr/bin/env node
'use strict';

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

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const performancePolicyPath = path.join(root, 'src', 'shared', 'agent-performance-policy.ts');
const visualSamplingPath = path.join(root, 'src', 'shared', 'project-visual-sampling.ts');
const defaultsPath = path.join(root, 'src', 'shared', 'skill-param-defaults.ts');
const promptPath = path.join(root, 'src', 'shared', 'designer-agent-autonomy-principles.ts');
const planningContractPath = path.join(root, 'src', 'shared', 'agent-task-planning-contract.ts');
const manifestSchemaPath = path.join(root, 'schemas', 'skill-runtime-manifest.schema.json');
const runtimeBundlePath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-contract-bundle.ts');
const runtimeStagePlanPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts');
const runtimeDesignBriefPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts');
const runtimeScopedChangeRecordsPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-scoped-change-records.ts');
const executorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts');
const agentRuntimePath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts');
const skuConfigExecutorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-config.executor.ts');
const toolSchemasPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts');
const enginePath = path.join(root, 'src', 'renderer', 'services', 'design-agent', 'engine.ts');
const routingPath = path.join(root, 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts');
const retiredPreflightPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'document-structure-preflight.ts'
);

const protectedBusinessPattern = /main[-_ ]?image|detail[-_ ]?page|sku[-_ ]?(?:batch|color)|reference[-_ ]?replication|ecommerce\.(?:main_image|detail_page|sku_)/i;
const sensitiveAuthorizationFields = new Set([
  'approvedLiveExecution',
  'approvedLiveAdapterRun',
  'userCheckpointApproved',
  'explicitProjectWriteApproval',
  'allowPhotoshopWrites'
]);
const TRANSITIONAL_BUSINESS_REFERENCE_BASELINES = Object.freeze([
  { file: 'src/shared/agent-intent-control-plane.ts', baseline: 22 },
  { file: 'src/shared/agent-task-planning-contract.ts', baseline: 53 },
  { file: 'src/shared/agent-design-execution-preflight.ts', baseline: 40 },
  { file: 'src/renderer/services/agent-orchestration/conversational.ts', baseline: 14 }
]);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parse(filePath) {
  return ts.createSourceFile(
    filePath,
    read(filePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function collectNodes(node, predicate) {
  const matches = [];
  function visit(current) {
    if (predicate(current)) matches.push(current);
    ts.forEachChild(current, visit);
  }
  if (node) visit(node);
  return matches;
}

function findFunction(sourceFile, name) {
  return collectNodes(sourceFile, (node) => (
    ts.isFunctionDeclaration(node) && node.name?.text === name
  ))[0];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function literalText(node, sourceFile) {
  return collectNodes(node, (current) => (
    ts.isStringLiteralLike(current)
    || current.kind === ts.SyntaxKind.RegularExpressionLiteral
  )).map((current) => current.getText(sourceFile));
}

function propertyName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return '';
}

function authorizationMintingViolations(sourceFile) {
  const violations = [];
  collectNodes(sourceFile, (node) => (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && node.right.kind === ts.SyntaxKind.TrueKeyword
  )).forEach((node) => {
    const name = propertyName(node.left);
    if (sensitiveAuthorizationFields.has(name)) {
      violations.push(`${name}: ${compact(node.getText(sourceFile))}`);
    }
  });
  collectNodes(sourceFile, (node) => (
    ts.isPropertyAssignment(node)
    && node.initializer.kind === ts.SyntaxKind.TrueKeyword
  )).forEach((node) => {
    const name = propertyName(node.name);
    if (sensitiveAuthorizationFields.has(name)) {
      violations.push(`${name}: ${compact(node.getText(sourceFile))}`);
    }
  });
  return [...new Set(violations)];
}

function countBusinessReferences(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return (read(filePath).match(new RegExp(protectedBusinessPattern.source, 'gi')) || []).length;
}

function run() {
  const performanceText = read(performancePolicyPath);
  const performanceSource = parse(performancePolicyPath);
  const decisionFunctionNames = [
    'inferTaskClass',
    'budgetForTaskClass',
    'verificationTierForTaskClass',
    'costProfileForTaskClass',
    'requiresContextSnapshotForTask',
    'shouldAllowVisionModel'
  ];
  const businessDecisionLiterals = decisionFunctionNames.flatMap((name) => {
    const declaration = findFunction(performanceSource, name);
    if (!declaration) return [`missing-function:${name}`];
    return literalText(declaration, performanceSource)
      .filter((value) => protectedBusinessPattern.test(value))
      .map((value) => `${name}:${compact(value)}`);
  });

  const defaultsSource = parse(defaultsPath);
  const authorizationViolations = authorizationMintingViolations(defaultsSource);
  const promptText = read(promptPath);
  const planningContractText = read(planningContractPath);
  const manifestSchema = JSON.parse(read(manifestSchemaPath));
  const executorText = read(executorPath);
  const executorSource = parse(executorPath);
  const performanceResolverText = findFunction(executorSource, 'resolveAutonomousPerformancePolicy')?.getText(executorSource) || '';
  const agentRuntimeText = read(agentRuntimePath);
  const runtimeBundleText = read(runtimeBundlePath);
  const runtimeStagePlanText = read(runtimeStagePlanPath);
  const runtimeDesignBriefText = read(runtimeDesignBriefPath);
  const runtimeScopedChangeRecordsText = read(runtimeScopedChangeRecordsPath);
  const skuConfigExecutorText = read(skuConfigExecutorPath);
  const toolSchemasText = read(toolSchemasPath);
  const engineText = read(enginePath);
  const routingText = read(routingPath);
  const visualSamplingText = read(visualSamplingPath);
  const {
    listSkillManifests,
    resolveSkillRuntimeManifestSelection
  } = require(path.join(
    root,
    'src',
    'shared',
    'agent-runtime-v5',
    'skill-runtime.ts'
  ));
  const { AGENT_GLOBAL_SKILL_BUDGET_LIMITS } = require(performancePolicyPath);
  const manifests = listSkillManifests();
  const detailManifest = manifests.find((manifest) => manifest.skill_id === 'ecommerce.detail_page');
  const detailEditContract = detailManifest?.work_mode_contracts?.edit_existing;
  const detailCreateContract = detailManifest?.work_mode_contracts?.create_new;
  const missingPerformanceProfiles = manifests
    .filter((manifest) => !manifest.performance_profile)
    .map((manifest) => manifest.skill_id);
  const budgetLimitByKey = {
    max_model_calls: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls,
    max_tool_calls: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxToolCalls,
    max_iterations: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxIterations,
    max_vision_candidates: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisionCandidates,
    max_visual_analyses: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisualAnalyses,
    max_full_resolution_image_reads: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxFullResolutionImageReads,
    soft_time_budget_ms: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.softTimeBudgetMs
  };
  function validatePerformanceProfile(manifest, profile, scope) {
    if (!profile) return [];
    const problems = [];
    if (profile.version !== 'skill-runtime-performance-profile/v0') {
      problems.push('version');
    }
    if (profile.budget.max_full_resolution_image_reads !== 0) {
      problems.push('full-resolution-read-grant');
    }
    for (const [key, value] of Object.entries(profile.budget)) {
      if (!Number.isFinite(value) || value < 0) problems.push(`invalid-budget:${key}`);
    }
    for (const [key, limit] of Object.entries(budgetLimitByKey)) {
      if (profile.budget[key] > limit) problems.push(`exceeds-agent-global-cap:${key}`);
    }
    if (profile.vision_policy === 'disabled' && (
      profile.budget.max_vision_candidates !== 0
      || profile.budget.max_visual_analyses !== 0
      || [...(manifest.required_model_profiles || []), ...(manifest.optional_model_profiles || [])]
        .some((modelProfile) => modelProfile.startsWith('vision.'))
    )) {
      problems.push('disabled-vision-profile-is-inconsistent');
    }
    if (profile.vision_policy === 'disabled'
      && (manifest.available_tools || []).includes('photoshop.read.getVisualSnapshot')) {
      problems.push('disabled-vision-profile-exposes-visual-capability');
    }
    return problems.map((problem) => `${manifest.skill_id}${scope}:${problem}`);
  }
  const invalidPerformanceProfiles = manifests.flatMap((manifest) => (
    validatePerformanceProfile(manifest, manifest.performance_profile, '')
  ));
  const invalidWorkModePerformanceProfiles = manifests.flatMap((manifest) => {
    return Object.entries(manifest.work_mode_contracts || {}).flatMap(([workMode, contract]) => (
      validatePerformanceProfile(manifest, contract?.performance_profile, `#${workMode}`)
    ));
  });
  const sameIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'detail-page-design',
    taskType: 'ecommerce.detail_page.v1'
  });
  const composedIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'layout-replication',
    taskType: 'ecommerce.detail_page.v1'
  });
  const conflictingIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'main-image-design',
    taskType: 'ecommerce.detail_page.v1'
  });
  const unknownIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'main-image-design',
    taskType: 'design.unknown.v1'
  });
  const transitionalDebt = TRANSITIONAL_BUSINESS_REFERENCE_BASELINES.map(({ file, baseline }) => {
    const businessReferenceCount = countBusinessReferences(path.join(root, file));
    return {
      file,
      baseline,
      businessReferenceCount,
      status: businessReferenceCount <= baseline ? 'not_grown' : 'grown',
      policy: 'compatibility-debt; do-not-expand; migrate to manifest/provider'
    };
  });

  const checks = [
    {
      id: 'skill-manifest-owns-performance-profile',
      description: '每个已注册 Runtime Manifest 必须拥有自己的成本、视觉和最低验收画像。',
      violations: [
        ...missingPerformanceProfiles,
        ...invalidPerformanceProfiles,
        ...invalidWorkModePerformanceProfiles
      ]
    },
    {
      id: 'manifest-schema-recognizes-boundary-fields',
      description: 'TypeScript Manifest 与 JSON Schema 必须同时声明性能所有权和规划角色，避免运行时与机器校验漂移。',
      violations: [
        ...(manifestSchema.properties?.performance_profile ? [] : ['schema:performance_profile']),
        ...(manifestSchema.properties?.planning_role ? [] : ['schema:planning_role']),
        ...(manifestSchema.properties?.work_mode_contracts ? [] : ['schema:work_mode_contracts']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.review_rubric_ref
          ? []
          : ['schema:work-mode-review-rubric']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.performance_profile
          ? []
          : ['schema:work-mode-performance-profile'])
      ]
    },
    {
      id: 'generic-performance-policy-consumes-manifest',
      description: '通用性能策略只解析 Manifest profile，并把截断后的模型、工具与时间预算交给真实 Agent Runtime 强制执行。',
      violations: [
        ...(performanceText.includes('resolveSkillRuntimeManifestSelection') ? [] : ['missing:resolveSkillRuntimeManifestSelection']),
        ...(performanceText.includes('manifest.performance_profile') ? [] : ['missing:manifest.performance_profile']),
        ...(performanceText.includes('work_mode_contracts?.[workMode') ? [] : ['missing:work-mode.performance_profile']),
        ...(performanceText.includes('normalizeRuntimeDesignWorkMode') ? [] : ['missing:work-mode-normalization']),
        ...(performanceText.includes('AGENT_GLOBAL_SKILL_BUDGET_LIMITS') ? [] : ['missing:AGENT_GLOBAL_SKILL_BUDGET_LIMITS']),
        ...(executorText.includes('performanceBudget:') ? [] : ['executor:performance-budget-handoff']),
        ...(executorText.includes('maxVisionCandidates: autonomousPerformancePolicy.budget.maxVisionCandidates')
          ? []
          : ['executor:vision-candidate-budget-not-handed-off']),
        ...(executorText.includes('maxVisualAnalyses: autonomousPerformancePolicy.budget.maxVisualAnalyses')
          ? []
          : ['executor:visual-analysis-budget-not-handed-off']),
        ...(executorText.includes('maxFullResolutionImageReads: autonomousPerformancePolicy.budget.maxFullResolutionImageReads')
          ? []
          : ['executor:full-resolution-read-budget-not-handed-off']),
        ...(agentRuntimeText.includes('beginPerformanceModelCall') ? [] : ['runtime:max-model-calls-not-enforced']),
        ...(agentRuntimeText.includes('consumePerformanceToolCallBudget') ? [] : ['runtime:max-tool-calls-not-enforced']),
        ...(agentRuntimeText.includes('consumePerformanceVisionCandidate')
          ? []
          : ['runtime:max-vision-candidates-not-enforced']),
        ...(agentRuntimeText.includes('agent_visual_analysis_budget_exhausted')
          ? []
          : ['runtime:max-visual-analyses-not-enforced']),
        ...(agentRuntimeText.includes('softTimeBudgetMs') ? [] : ['runtime:soft-time-budget-not-enforced']),
        ...businessDecisionLiterals
      ]
    },
    {
      id: 'manifest-identity-resolves-once-and-fails-closed',
      description: 'skillId 与 taskType 通过同一 Resolver 形成 artifact/method 角色；冲突或未知结构化身份不得自行选边。',
      violations: [
        ...(sameIdentity.status === 'resolved' && sameIdentity.manifests.length === 1 ? [] : ['same-identity-not-deduplicated']),
        ...(composedIdentity.status === 'resolved'
          && composedIdentity.artifactManifest?.skill_id === 'ecommerce.detail_page'
          && composedIdentity.methodManifests.some((manifest) => manifest.skill_id === 'design.reference_replication')
          ? []
          : ['artifact-method-composition-invalid']),
        ...(conflictingIdentity.status === 'conflict' ? [] : ['artifact-conflict-not-blocked']),
        ...(unknownIdentity.status === 'unresolved_task_type' ? [] : ['unknown-task-type-fell-back'])
      ]
    },
    {
      id: 'project-sampling-not-agent-business-routing',
      description: '项目素材抽样策略归项目视觉能力所有，不能在 Agent 性能核心按品类选路线。',
      violations: [
        ...(performanceText.includes('buildAgentVisualSamplingBudget') ? ['legacy:buildAgentVisualSamplingBudget'] : []),
        ...(visualSamplingText.includes('buildProjectVisualSamplingBudget') ? [] : ['missing:buildProjectVisualSamplingBudget'])
      ]
    },
    {
      id: 'generic-prompt-has-no-detail-page-method',
      description: '通用设计提示只保留跨品类纪律，详情页套版和结构方法由详情页 Skill/Knowledge 提供。',
      violations: [
        ...(['【详情页项目级策略】', 'DESIGN_DISCIPLINE_TASK_PRINCIPLES', 'designDisciplineTask']
          .filter((value) => promptText.includes(value))),
        ...(executorText.includes('designDisciplineTask:') ? ['executor:designDisciplineTask'] : [])
      ]
    },
    {
      id: 'business-parser-runs-after-skill-selection',
      description: '通用 Engine/Router 不得在 R0 选 Skill 前调用详情页解析器或依据屏数猜业务身份。',
      violations: [
        ...(fs.existsSync(retiredPreflightPath) ? ['file:document-structure-preflight.ts'] : []),
        ...(engineText.includes('buildCurrentDocumentStructureRouteOptions') ? ['engine:structure-preflight'] : []),
        ...(engineText.includes('parseDetailPageTemplate') ? ['engine:parseDetailPageTemplate'] : []),
        ...(routingText.includes('detailPageTemplateDetected') ? ['routing:detailPageTemplateDetected'] : []),
        ...(routingText.includes('detailPageTemplateScreenCount') ? ['routing:detailPageTemplateScreenCount'] : [])
      ]
    },
    {
      id: 'defaults-cannot-mint-authorization',
      description: '业务参数默认器可以补规格，但不得把执行、适配器或用户检查点批准设为 true。',
      violations: authorizationViolations
    },
    {
      id: 'task-type-reaches-profile-resolver',
      description: '生产 Executor 从已解析 Runtime Bundle 传递 artifact/method/taskType/workMode 性能身份，不用 autonomous-agent 覆盖业务组合。',
      violations: [
        ...(performanceText.includes('taskType?: string') ? [] : ['performance-input:taskType']),
        ...(performanceResolverText.includes('runtimeContractBundle?.methodManifests[0]?.skill_id')
          ? []
          : ['executor:method-skill-identity-not-from-runtime-bundle']),
        ...(performanceResolverText.includes('runtimeContractBundle?.artifactManifest?.task_type')
          ? []
          : ['executor:artifact-task-identity-not-from-runtime-bundle']),
        ...(performanceResolverText.includes('taskType: performanceTaskType') ? [] : ['executor:taskType-handoff']),
        ...(performanceResolverText.includes('workMode: runtimeContractBundle?.stagePlan.expectedWorkMode')
          ? []
          : ['executor:expected-work-mode-not-handed-off']),
        ...(/resolveAutonomousPerformancePolicy\([\s\S]{0,240}runtimeContractBundle\s*\)/.test(executorText)
          ? []
          : ['executor:runtime-bundle-not-passed-to-performance-resolver'])
      ]
    },
    {
      id: 'work-mode-identity-is-upstream-locked',
      description: '上游结构化 workMode 是 Runtime 身份的一部分：R1 只能确认，不能把 edit_existing 改成 create_new。',
      violations: [
        ...(runtimeBundleText.includes('buildRuntimeStagePlan(manifest, expectedWorkMode)')
          ? []
          : ['runtime-bundle:expected-work-mode-not-bound-to-stage-plan']),
        ...(runtimeStagePlanText.includes('plan.expectedWorkMode || normalizeRuntimeDesignWorkMode(workMode)')
          ? []
          : ['runtime-stage-plan:declared-mode-can-override-expected-mode']),
        ...(runtimeDesignBriefText.includes("addIssue(issues, 'work_mode_identity_mismatch', 'workMode')")
          ? []
          : ['runtime-design-brief:work-mode-mismatch-not-rejected']),
        ...(runtimeDesignBriefText.includes('enum: input.expectedWorkMode ? [input.expectedWorkMode]')
          ? []
          : ['runtime-design-brief:schema-does-not-lock-expected-mode'])
      ]
    },
    {
      id: 'task-planning-consumes-selected-manifest',
      description: '请求级计划从已选 Manifest 读取交付物、必要输入、来源引用、必要观察与 taskType，不在 Agent 核心复制业务清单。',
      violations: [
        ...(planningContractText.includes('resolvePlanningManifest') ? [] : ['planning:resolvePlanningManifest']),
        ...(planningContractText.includes('manifest.delivery_outputs') ? [] : ['planning:manifest.delivery_outputs']),
        ...(planningContractText.includes('buildManifestRequiredInputs') ? [] : ['planning:manifest-required-inputs']),
        ...(planningContractText.includes('manifest.required_inputs') ? [] : ['planning:manifest-required-input-source']),
        ...(planningContractText.includes('manifest.knowledge_refs') ? [] : ['planning:manifest-source-refs']),
        ...(planningContractText.includes("needsVisualObservation ? 'visual_observation'") ? [] : ['planning:manifest-required-observations']),
        ...(planningContractText.includes('taskType: manifest?.task_type') ? [] : ['planning:manifest-task-type-handoff'])
      ]
    },
    {
      id: 'detail-work-mode-contract-does-not-promote-edit-to-create',
      description: '详情页局部编辑使用完整替换契约；从零创作保留 storyboard 专业步骤，但不得默认制造人工确认点。',
      violations: [
        ...(detailEditContract ? [] : ['detail:missing-edit-existing-contract']),
        ...(detailCreateContract ? [] : ['detail:missing-create-new-contract']),
        ...(detailEditContract?.required_inputs.includes('product') ? ['detail:edit-requires-product'] : []),
        ...(detailEditContract?.required_inputs.includes('asset_source') ? ['detail:edit-requires-asset-source'] : []),
        ...(detailEditContract?.review_rubric_ref === 'rubrics/detail-page-scoped-edit.v1'
          ? []
          : ['detail:edit-missing-scoped-evaluation-profile']),
        ...(detailEditContract?.performance_profile?.budget?.max_tool_calls < detailManifest?.performance_profile?.budget?.max_tool_calls
          ? []
          : ['detail:edit-performance-profile-not-scoped']),
        ...(detailManifest?.reference_policy?.work_mode_requirements?.edit_existing === 'not_required'
          ? []
          : ['detail:edit-reference-policy-not-scoped']),
        ...(detailEditContract?.exit_criteria.some((item) => item.includes('storyboard 已生成且经用户确认'))
          ? ['detail:edit-inherits-storyboard-approval']
          : []),
        ...(detailCreateContract?.required_inputs.includes('product') ? [] : ['detail:create-missing-product']),
        ...(detailCreateContract?.exit_criteria.some((item) => item.includes('storyboard 已生成并由 Agent'))
          ? []
          : ['detail:create-missing-storyboard-self-review']),
        ...(detailCreateContract?.exit_criteria.some((item) => item.includes('storyboard 已生成且经用户确认'))
          ? ['detail:create-defaults-to-manual-storyboard-approval']
          : []),
        ...(planningContractText.includes('resolveSkillRuntimeEffectiveContract')
          ? []
          : ['planning:missing-work-mode-contract-resolver'])
      ]
    },
    {
      id: 'delivery-and-scoped-edit-verification-cannot-be-shortcut',
      description: '有声明交付物时原始 save 不能绕过 E2 receipt；receipt 后再写入必须使其失效；局部修改必须验证目标达成且范围外未受影响。',
      violations: [
        ...(agentRuntimeText.includes('if (requiredOutputs.length === 0)')
          ? []
          : ['delivery:raw-save-can-bypass-declared-outputs']),
        ...(agentRuntimeText.includes('const laterMutationExists = this.toolCallLog.slice(receiptIndex + 1)')
          && agentRuntimeText.includes('if (laterMutationExists) continue;')
          ? []
          : ['delivery:post-receipt-write-does-not-invalidate-receipt']),
        ...(runtimeScopedChangeRecordsText.includes("key: 'requested_change_applied' | 'outside_scope_preserved'")
          ? []
          : ['scoped-edit:acceptance-verification-keys-missing']),
        ...(agentRuntimeText.includes('buildRuntimeScopedChangeVerificationRecords(this.toolCallLog)')
          ? []
          : ['scoped-edit:verification-not-built-from-live-tool-log'])
      ]
    },
    {
      id: 'skill-dependencies-go-through-runtime',
      description: '一个业务 Skill 不得直接调用另一个 Executor；返回选择建议后由主 Agent/Runtime 重新选择。',
      violations: [
        ...(skuConfigExecutorText.includes("from './sku-batch.executor'") ? ['sku-config:direct-executor-import'] : []),
        ...(skuConfigExecutorText.includes('skuBatchExecutor.execute(') ? ['sku-config:direct-executor-call'] : []),
        ...(/const payload\s*=\s*\{[\s\S]{0,180}count:\s*Number\(params\?\.placeholderCount/.test(skuConfigExecutorText)
          ? []
          : ['sku-config:createSkuPlaceholders-count-contract'])
      ]
    },
    {
      id: 'design-intent-schema-follows-task-registry',
      description: 'declareDesignIntent 的合法 taskType 必须动态来自任务类型注册表，不能手写三个品类。',
      violations: [
        ...(toolSchemasText.includes("import { listDesignTaskTypeIds } from '../../../shared/design-task-types'")
          ? []
          : ['tool-schema:missing-listDesignTaskTypeIds']),
        ...(toolSchemasText.includes('enum: DECLARABLE_DESIGN_TASK_TYPE_IDS')
          ? []
          : ['tool-schema:missing-dynamic-enum'])
      ]
    },
    {
      id: 'transitional-business-coupling-ratchet',
      description: '尚未迁出的 Agent 核心业务字面量只许减少不得增长，逐步迁往 Manifest/Provider。',
      violations: transitionalDebt
        .filter((item) => item.status === 'grown')
        .map((item) => `${item.file}:${item.businessReferenceCount}>${item.baseline}`)
    }
  ];

  const violationCount = checks.reduce((sum, check) => sum + check.violations.length, 0);
  const payload = {
    success: violationCount === 0,
    boundary: {
      agent: '理解目标、选择 Skill、编排、执行、观察、恢复与应用全局安全上限。',
      skill: '业务方法、阶段、输入输出、预算画像、最低验收与专业评价。',
      tool: 'Photoshop 原子读写动作；不决定业务工作流。',
      authorization: '只来自控制面或显式批准记录；参数默认器不得生成。'
    },
    registeredManifestCount: manifests.length,
    violationCount,
    checks,
    transitionalDebt
  };
  const outputDirectory = path.join(root, 'tmp');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, 'agent-business-boundaries-audit.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.success ? 0 : 1);
}

run();
