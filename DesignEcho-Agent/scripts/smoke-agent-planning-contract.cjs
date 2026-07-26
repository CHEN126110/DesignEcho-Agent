const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentTaskPlanningContract,
  requiresAgentTaskProgress
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-planning-contract.ts'));
const {
  buildAgentTaskPublicPlanExecutionRequest,
  extractRuntimeOperationRequestsFromPublicPlanExecutionRequest,
  stripRuntimeParamsFromPublicPlanExecutionRequest
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-execution-request.ts'));
const {
  buildAgentTaskPublicPlanApprovalRecord
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-approval-record.ts'));
const {
  collectAgentTaskPublicPlanOperationParamBlockers,
  runAgentTaskPublicPlanControlledRunner,
  runAgentTaskPublicPlanControlledRunnerAsync
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-controlled-runner.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-planning-contract-smoke.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  return { json: jsonPath };
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function createContext(userInput, overrides = {}) {
  const base = {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      activeLayerName: '图层 1',
      layerCount: 12
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 8,
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

function lifecycleFor(input, routeOptions = {}) {
  return buildAgentRequestLifecycle({
    userInput: input,
    context: createContext(input),
    ...routeOptions
  });
}

function planFor(input, routeOptions = {}) {
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: input,
    hasDocument: true,
    photoshopConnected: true
  });
  const lifecycle = lifecycleFor(input, routeOptions);
  return buildAgentTaskPlanningContract({
    userInput: input,
    intentControlPlane,
    lifecycle,
    context: createContext(input),
    skillId: routeOptions.skillId,
    taskType: routeOptions.taskType,
    workMode: routeOptions.workMode,
    mode: routeOptions.mode,
    skillParams: routeOptions.skillParams,
    forcePublicPlanGeneration: routeOptions.forcePublicPlanGeneration === true
  });
}

function containsForbiddenField(value, pathParts = []) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (/confidence|置信/i.test(key)) return childPath.join('.');
    if (key !== 'rawPayloadRedacted'
      && /(localPath|projectPath|filePath|thumbnailPath|sampleImagePaths|selectedProjectImagePath|rawSnapshot|rawPayload|imageData|base64|score)/i.test(key)) {
      return childPath.join('.');
    }
    if (typeof child === 'string' && /(data:image|base64,|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/i.test(child)) return childPath.join('.');
    const nested = containsForbiddenField(child, childPath);
    if (nested) return nested;
  }
  return null;
}

function containsPrivateRuntimeField(value, pathParts = []) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (key === 'params'
      || /adapter|allowPhotoshopWrites|approvedLiveExecution|approvedLiveAdapterRun|executionTarget|liveExecutionScope|explicitProjectWriteApproval/i.test(key)) {
      return childPath.join('.');
    }
    const nested = containsPrivateRuntimeField(child, childPath);
    if (nested) return nested;
  }
  return null;
}

async function run() {
  const cases = [];

  function record(name, fn) {
    try {
      const details = fn();
      cases.push({ name, status: 'pass', details: JSON.stringify(details || {}) });
    } catch (error) {
      cases.push({
        name,
        status: 'fail',
        details: JSON.stringify({
          message: error.message,
          details: error.details || null
        })
      });
    }
  }

  record('task-progress-obligation-is-derived-from-the-existing-agent-task-plan', () => {
    const basePlan = planFor('帮我根据当前画面做一个更高级的设计', {
      routeSource: 'router_model',
      route: 'autonomous_agent',
      reason: '通用设计任务由 Agent 自主执行'
    });
    const requiresProgress = ['read_only', 'tool_execution', 'controlled_skill'].map((mode) => ({
      mode,
      required: requiresAgentTaskProgress({
        ...basePlan,
        executionPlan: {
          ...basePlan.executionPlan,
          mode,
          canExecuteTools: true
        }
      })
    }));
    const noProgressRequired = ['none', 'model_planning_required'].map((mode) => ({
      mode,
      required: requiresAgentTaskProgress({
        ...basePlan,
        executionPlan: {
          ...basePlan.executionPlan,
          mode,
          canExecuteTools: mode === 'model_planning_required'
        }
      })
    }));
    assert(requiresProgress.every((item) => item.required === true), 'execution plans must require real progress', requiresProgress);
    assert(noProgressRequired.every((item) => item.required === false), 'direct response or planning-only modes must allow zero-tool completion', noProgressRequired);
    return { requiresProgress, noProgressRequired };
  });

  record('capability-question-produces-direct-response-plan-without-tools', () => {
    const plan = planFor('你都能帮我做什么', {
      routeSource: 'intent_control_plane',
      route: 'direct_response',
      reason: '能力询问'
    });
    assert(plan.version === 'agent-task-planning-contract/v0', 'wrong version', plan);
    assert(plan.status === 'ready_direct_response', 'capability question should be direct response', plan);
    assert(plan.allowedToolScope === 'none', 'capability question must not allow tools', plan);
    assert(plan.executionPlan.canExecuteTools === false, 'direct response must not execute tools', plan);
    assert(plan.executionPlan.steps.length === 1, 'direct response plan should have one answer step', plan);
    assert(plan.qualityClaim.canClaimDesignComplete === false, 'must not claim design complete', plan);
    assert(!containsForbiddenField(plan), 'plan contains forbidden confidence/raw field', containsForbiddenField(plan));
    return plan;
  });

  record('standalone-copywriting-delivers-candidates-without-task-progress-obligation', () => {
    const request = [
      '帮我撰写文案 下面是原文',
      '选用更优质长绒棉，柔韧',
      '舒适，摩擦频繁也不起球',
      '帮我改成突出透气的'
    ].join('\n');
    const plan = planFor(request, {
      routeSource: 'intent_control_plane',
      route: 'direct_response',
      reason: '独立文案内容交付'
    });
    assert(plan.status === 'ready_direct_response', 'standalone copywriting should be delivered directly', plan);
    assert(plan.designBrief.scenario === 'copywriting', 'standalone copywriting should retain copywriting identity', plan);
    assert(plan.designBrief.deliverables.length === 1 && plan.designBrief.deliverables[0] === 'copy_candidates', 'standalone copywriting should deliver copy candidates', plan);
    assert(plan.allowedToolScope === 'none', 'standalone copywriting must not authorize Photoshop writes', plan);
    assert(plan.executionPlan.mode === 'none', 'standalone copywriting should not enter a tool execution mode', plan);
    assert(plan.executionPlan.canExecuteTools === false, 'standalone copywriting must not execute tools', plan);
    assert(plan.executionPlan.verificationTargets.includes('copy_candidates_match_requested_emphasis'), 'copy candidates should be verified against the requested emphasis', plan);
    assert(requiresAgentTaskProgress(plan) === false, 'delivered copy candidates must not require tool progress', plan);
    return plan;
  });

  record('explicit-screen-copy-edit-requires-write-readback-and-task-progress', () => {
    const plan = planFor('把第三屏文案改成突出透气', {
      routeSource: 'intent_control_plane',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      reason: '显式 Photoshop 文案修改'
    });
    assert(plan.status === 'ready_for_tool_execution', 'explicit screen copy edit should enter tool execution', plan);
    assert(plan.designBrief.scenario === 'copywriting', 'explicit screen copy edit should retain copywriting identity', plan);
    assert(plan.designBrief.deliverables.includes('updated_text_layer'), 'explicit copy edit should deliver an updated text layer', plan);
    assert(plan.designBrief.deliverables.includes('change_verification_report'), 'explicit copy edit should deliver a verification report', plan);
    assert(plan.allowedToolScope === 'write_photoshop', 'explicit screen copy edit should authorize Photoshop writes', plan);
    assert(plan.executionPlan.mode === 'tool_execution', 'explicit screen copy edit should use tool execution mode', plan);
    assert(plan.executionPlan.canExecuteTools === true, 'explicit screen copy edit should be executable', plan);
    assert(plan.requiredInputs.includes('target_text_layer'), 'explicit copy edit should require the target text layer input', plan);
    assert(plan.requiredInputs.includes('requested_copy_change'), 'explicit copy edit should preserve the requested change as an input', plan);
    assert(plan.requiredInputs.includes('verification_targets'), 'explicit copy edit should require verification targets', plan);
    assert(plan.executionPlan.verificationTargets.includes('execution_trace_exists'), 'explicit copy edit should require a write execution result', plan);
    assert(plan.executionPlan.verificationTargets.includes('readback_or_export_result_exists'), 'explicit copy edit should require a readback result', plan);
    assert(plan.executionPlan.verificationTargets.includes('requested_change_applied'), 'explicit copy edit should verify that the requested change was applied', plan);
    assert(plan.executionPlan.verificationTargets.includes('target_text_readback_exists'), 'explicit copy edit should verify the target text by readback', plan);
    assert(requiresAgentTaskProgress(plan) === true, 'explicit Photoshop copy edit must require task progress', plan);
    return plan;
  });

  record('ambiguous-request-enters-model-planning-gate-without-running-tools', () => {
    const plan = planFor('帮我处理一下', {
      routeSource: 'intent_control_plane',
      route: 'autonomous_agent',
      reason: '交给模型先理解目标并形成公开计划'
    });
    assert(plan.status === 'ready_for_model_planning', 'ambiguous request should enter model planning gate', plan);
    assert(plan.executionPlan.mode === 'model_planning_required', 'ambiguous request should require model planning', plan);
    assert(plan.executionPlan.canExecuteTools === false, 'ambiguous request must not execute tools before planning', plan);
    assert(plan.executionPlan.requiresUserApproval === false, 'same-run model planning must not invent a user approval gate', plan);
    assert(plan.requiredInputs.includes('design_brief'), 'should require a design brief from model planning', plan);
    assert(plan.requiredInputs.includes('verification_targets'), 'should require verification targets', plan);
    assert(plan.blockers.length === 0, 'ambiguous autonomous planning should not be represented as fixed clarification blockers', plan);
    return plan;
  });

  record('reference-guided-poster-plan-keeps-poster-deliverable-identity', () => {
    const plan = planFor('参考这张图做个海报');
    assert(plan.designBrief.scenario === 'general-design', 'poster deliverable must outrank the reference method', plan);
    assert(plan.designBrief.deliverables.includes('editable_design_document'), 'poster plan should require an editable Photoshop document', plan);
    assert(plan.designBrief.deliverables.includes('preview'), 'poster plan should include a preview artifact', plan);
    assert(plan.designBrief.deliverables.includes('delivery_record'), 'poster plan should include a delivery record', plan);
    assert(!plan.designBrief.deliverables.includes('controlled_skill_result'), 'poster plan must not collapse to a generic controlled skill result', plan);
    assert(plan.designBrief.needsVisualObservation === true, 'reference-guided poster must require visual observation', plan);
    assert(plan.requiredInputs.includes('visual_observation'), 'poster plan should carry visual observation into execution planning', plan);
    assert(plan.requiredInputs.includes('editable_output_target'), 'poster plan should require an editable output target', plan);
    assert(
      plan.designBrief.constraints.some((item) => item.includes('不得把海报、横幅或主图改写成详情页模板')),
      'poster plan should preserve artifact identity across the reference method',
      plan
    );
    return plan;
  });

  record('planning-artifact-identity-outranks-reference-method', () => {
    const posterPlan = planFor('参考这个详情页做海报');
    const detailPlan = planFor('参考这张海报做详情页', {
      routeSource: 'deterministic_route',
      route: 'skill_execution',
      skillId: 'layout-replication',
      reason: '使用参考复刻能力生成详情页'
    });
    const strictReplicationPlan = planFor('严格复刻参考图版式', {
      routeSource: 'deterministic_route',
      route: 'skill_execution',
      skillId: 'layout-replication',
      reason: '严格参考版式复刻'
    });
    const kvPlan = planFor('做个KV');

    assert(posterPlan.designBrief.scenario === 'general-design', 'poster target should outrank detail-page source', posterPlan);
    assert(detailPlan.designBrief.scenario === 'detail-page', 'detail-page target should outrank poster source', detailPlan);
    assert(detailPlan.requiredInputs.includes('project_context'), 'detail-page plan should retain project context', detailPlan);
    assert(detailPlan.requiredInputs.includes('detail_template_context'), 'detail-page plan should retain detail template context', detailPlan);
    assert(detailPlan.requiredInputs.includes('reference_visual_observation'), 'reference method should supplement detail inputs', detailPlan);
    assert(strictReplicationPlan.designBrief.scenario === 'reference-replication', 'pure replication without an artifact target should remain reference-replication', strictReplicationPlan);
    assert(strictReplicationPlan.requiredInputs.includes('reference_visual_observation'), 'strict replication should require reference visual observation', strictReplicationPlan);
    assert(kvPlan.designBrief.scenario === 'general-design', 'KV creation should be a general design artifact', kvPlan);
    assert(kvPlan.designBrief.needsVisualObservation === true, 'KV creation should require visual observation', kvPlan);

    return { posterPlan, detailPlan, strictReplicationPlan, kvPlan };
  });

  record('artifact-and-method-manifests-compose-without-overwriting-deliverable-identity', () => {
    const plan = planFor('参考这张图制作详情页', {
      routeSource: 'model_router',
      route: 'skill_execution',
      skillId: 'layout-replication',
      taskType: 'ecommerce.detail_page.v1',
      reason: '详情页产物叠加参考复刻方法'
    });
    assert(plan.status === 'ready_for_controlled_execution_plan', 'artifact + method should be a valid controlled plan', plan);
    assert(plan.designBrief.scenario === 'detail-page', 'artifact manifest must own the scenario', plan);
    assert(plan.designBrief.skillManifestRef?.startsWith('ecommerce.detail_page@'), 'detail-page artifact manifest should own the plan', plan);
    assert(plan.designBrief.methodManifestRefs?.some((ref) => ref.startsWith('design.reference_replication@')), 'reference method manifest should be preserved as an overlay', plan);
    assert(plan.designBrief.deliverables.includes('detail_page_psd'), 'artifact delivery must remain detail-page PSD', plan);
    assert(plan.designBrief.deliverables.includes('replication_report'), 'method output should be added', plan);
    assert(plan.requiredInputs.includes('skill_input:reference_image'), 'method required input must be retained', plan);
    assert(plan.executionPlan.steps.some((step) => step.phase === 'execute' && step.taskType === 'ecommerce.detail_page.v1'), 'execution handoff must carry artifact taskType', plan);
    return plan;
  });

  record('detail-page-work-mode-contract-prevents-local-edit-from-inheriting-create-new-gates', () => {
    const baseRoute = {
      routeSource: 'model_router',
      route: 'skill_execution',
      skillId: 'detail-page-design',
      taskType: 'ecommerce.detail_page.v1',
      reason: '详情页局部修改'
    };
    const neutralPlan = planFor('帮我修改第三屏文案', baseRoute);
    const editPlan = planFor('帮我修改第三屏文案', {
      ...baseRoute,
      workMode: 'edit_existing'
    });
    const createPlan = planFor('从零制作一套详情页', {
      ...baseRoute,
      workMode: 'create_new'
    });
    assert(!neutralPlan.requiredInputs.includes('skill_input:product'), 'unknown work mode must not default to create-new product input', neutralPlan);
    assert(!neutralPlan.requiredInputs.includes('skill_input:asset_source'), 'unknown work mode must not default to create-new asset input', neutralPlan);
    assert(!neutralPlan.designBrief.constraints.some((item) => item.includes('storyboard 已生成')), 'neutral detail contract must not mint create-new storyboard gate', neutralPlan);
    assert(editPlan.designBrief.workMode === 'edit_existing', 'edit work mode should be preserved', editPlan);
    assert(editPlan.requiredInputs.includes('skill_input:existing_document'), 'edit should require the existing document', editPlan);
    assert(editPlan.requiredInputs.includes('skill_input:target_scope'), 'edit should require the target scope', editPlan);
    assert(editPlan.requiredInputs.includes('skill_input:requested_change'), 'edit should require the requested change', editPlan);
    assert(!editPlan.requiredInputs.includes('skill_input:product'), 'edit must not require create-new product input', editPlan);
    assert(!editPlan.designBrief.constraints.some((item) => item.includes('storyboard 已生成')), 'edit must not inherit storyboard checkpoint', editPlan);
    assert(editPlan.designBrief.deliverables.includes('change_verification_report'), 'edit should deliver scoped change verification', editPlan);
    assert(editPlan.executionPlan.requiresUserApproval === false, 'local edit should not require a newly invented public-plan approval', editPlan);
    assert(createPlan.requiredInputs.includes('skill_input:product'), 'create-new should retain product input', createPlan);
    assert(createPlan.requiredInputs.includes('skill_input:asset_source'), 'create-new should retain asset input', createPlan);
    assert(createPlan.designBrief.constraints.some((item) => item.includes('storyboard 已生成') && item.includes('Agent 对照 Brief')), 'create-new should retain its Skill-owned storyboard checkpoint', createPlan);
    return { neutralPlan, editPlan, createPlan };
  });

  record('conflicting-or-unknown-structured-manifest-identity-fails-closed', () => {
    const conflictPlan = planFor('执行当前设计任务', {
      routeSource: 'model_router',
      route: 'skill_execution',
      skillId: 'main-image-design',
      taskType: 'ecommerce.detail_page.v1',
      reason: '冲突身份探针'
    });
    const unknownPlan = planFor('执行当前设计任务', {
      routeSource: 'model_router',
      route: 'skill_execution',
      skillId: 'main-image-design',
      taskType: 'design.unknown.v1',
      reason: '未知 taskType 探针'
    });
    assert(conflictPlan.executionPlan.canExecuteTools === false, 'conflicting artifact manifests must block tools', conflictPlan);
    assert(conflictPlan.blockers.includes('skill_manifest_identity_conflict'), 'conflict blocker should be explicit', conflictPlan);
    assert(conflictPlan.designBrief.deliverables.length === 1 && conflictPlan.designBrief.deliverables[0] === 'manifest_identity_resolution', 'conflict must not mix business deliverables', conflictPlan);
    assert(unknownPlan.executionPlan.canExecuteTools === false, 'unknown structured task type must block tools', unknownPlan);
    assert(unknownPlan.blockers.includes('skill_manifest_task_type_unresolved'), 'unknown task type blocker should be explicit', unknownPlan);
    return { conflictPlan, unknownPlan };
  });

  record('project-overview-produces-readonly-plan-only', () => {
    const plan = planFor('当前是什么项目', {
      routeSource: 'deterministic_route',
      route: 'skill_execution',
      skillId: 'project-image-analysis',
      skillParams: { analysisMode: 'content' },
      reason: '只读项目概览'
    });
    assert(plan.status === 'ready_read_only_plan', 'project overview should be read-only', plan);
    assert(plan.allowedToolScope === 'read_only', 'project overview must only allow read-only scope', plan);
    assert(plan.executionPlan.canExecuteTools === true, 'read-only inspection can execute read-only tool', plan);
    assert(plan.executionPlan.steps.every((step) => step.allowedToolScope !== 'write_photoshop'), 'read-only plan must not include write steps', plan);
    assert(plan.executionPlan.steps.some((step) => step.allowedToolScope === 'read_only'), 'read-only plan should include at least one read-only inspection step', plan);
    assert(plan.designBrief.deliverables.includes('project_overview'), 'should deliver project overview', plan);
    return plan;
  });

  record('document-export-operation-produces-direct-tool-execution-plan', () => {
    const plan = planFor('请把当前 Photoshop 文档导出为 PNG，并读回导出结果。', {
      routeSource: 'deterministic_route',
      route: 'skill_execution',
      skillId: 'document-management',
      skillParams: { action: 'save', format: 'png', saveAs: true },
      mode: 'save',
      reason: '确定性文档导出操作'
    });
    assert(plan.status === 'ready_for_tool_execution', 'document export should be a direct tool execution task', plan);
    assert(plan.executionPlan.mode === 'tool_execution', 'document export must not require controlled design planning', plan);
    assert(plan.executionPlan.canExecuteTools === true, 'document export should execute tools', plan);
    assert(plan.executionPlan.requiresUserApproval === false, 'document export should not require public design-plan approval', plan);
    assert(plan.userVisibleState.category === 'tool_execution', 'document export visible state should be tool execution', plan);
    assert(plan.userVisibleState.toolUse === 'direct_tools', 'document export visible state should use direct_tools', plan);
    assert(
      plan.executionPlan.steps.some((step) => step.action === 'executeDirectOperationSkill' && step.skillId === 'document-management'),
      'document export should execute the deterministic operation skill',
      plan.executionPlan.steps
    );
    assert(!/整理设计方向|设计方案|公开计划/.test(JSON.stringify(plan.userVisibleState)), 'document export must not expose design-planning copy', plan.userVisibleState);
    assert(!containsForbiddenField(plan), 'plan contains forbidden confidence/raw field', containsForbiddenField(plan));
    return plan;
  });

  record('sku-plans-consume-the-selected-skill-manifest-without-cross-skill-deliverables', () => {
    const plan = planFor('帮我做SKU', {
      routeSource: 'model_router',
      route: 'skill_execution',
      skillId: 'sku-batch',
      skillParams: {},
      reason: 'SKU 执行'
    });
    const colorCardPlan = planFor('根据这些颜色图片制作 SKU 色卡', {
      routeSource: 'model_router',
      route: 'skill_execution',
      skillId: 'sku-color-card',
      skillParams: {},
      reason: 'SKU 色卡设计'
    });
    assert(plan.status === 'ready_for_controlled_execution_plan', 'sku should be controlled execution plan', plan);
    assert(plan.designBrief.scenario === 'sku', 'sku scenario expected', plan);
    assert(plan.designBrief.skillManifestRef?.startsWith('ecommerce.sku_batch@'), 'SKU batch manifest should own the plan', plan);
    assert(plan.designBrief.deliverables.includes('sku_images'), 'SKU batch should use its declared image deliverable', plan);
    assert(plan.designBrief.deliverables.includes('sku_manifest'), 'SKU batch should use its declared manifest deliverable', plan);
    assert(!plan.designBrief.deliverables.includes('sku_color_combinations'), 'generic planning must not invent SKU combination deliverables', plan);
    assert(!plan.designBrief.deliverables.includes('sku_self_select_notes'), 'generic planning must not invent SKU note deliverables', plan);
    assert(plan.requiredInputs.includes('skill_input:goal'), 'SKU batch should start from the user goal', plan);
    assert(
      !plan.requiredInputs.includes('skill_input:sku_source'),
      'SKU source is discovered by the selected Skill and must not deadlock R1 before the Skill runs',
      plan
    );
    assert(
      !plan.requiredInputs.includes('skill_input:combination_rules'),
      'SKU combination rules are established by the Skill confirmation card and must not be required before that card exists',
      plan
    );
    assert(plan.executionPlan.steps.some((step) => step.phase === 'inspect' && step.allowedToolScope === 'read_only'), 'SKU needs inspect step', plan);
    assert(plan.executionPlan.steps.some((step) => step.phase === 'execute' && step.skillId === 'sku-batch'), 'SKU needs controlled execute step', plan);
    assert(plan.executionPlan.steps.some((step) => step.phase === 'execute' && step.taskType === 'ecommerce.sku_batch.v1'), 'controlled execution must carry the manifest task type', plan);
    assert(plan.executionPlan.steps.some((step) => step.phase === 'verify'), 'SKU needs verify step', plan);
    assert(colorCardPlan.designBrief.skillManifestRef?.startsWith('ecommerce.sku_color_card@'), 'SKU color-card manifest should own the plan', colorCardPlan);
    assert(colorCardPlan.designBrief.deliverables.includes('sku_color_card_document'), 'color-card plan should deliver a color-card document', colorCardPlan);
    assert(!colorCardPlan.designBrief.deliverables.includes('sku_images'), 'color-card plan must not inherit batch-image delivery', colorCardPlan);
    assert(!colorCardPlan.designBrief.deliverables.includes('sku_self_select_notes'), 'color-card plan must not inherit self-select notes', colorCardPlan);
    assert(colorCardPlan.requiredInputs.includes('skill_input:color_card_sources'), 'color-card plan should require its declared sources', colorCardPlan);
    return { plan, colorCardPlan };
  });

  record('detail-page-document-name-overrides-sku-material-wording', () => {
    const input = '请基于当前项目中的 SKU 色卡素材，创建一个详情页文档。按照文档名称区分：详情页文档就是详情页，SKU 就是 SKU。';
    const plan = planFor(input, {
      routeSource: 'model_router',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      reason: '详情页文档创建设计'
    });
    assert(plan.status === 'ready_for_tool_execution', 'confirmed detail-page document creation should enter the autonomous Agent loop', plan);
    assert(plan.designBrief.scenario === 'detail-page', 'SKU material wording must not turn a 详情页文档 task into SKU scenario', plan);
    assert(plan.designBrief.deliverables.includes('detail_page_design_plan'), 'detail-page document task should include detail-page deliverable', plan);
    assert(!plan.designBrief.deliverables.includes('sku_color_combinations'), 'detail-page document task must not include SKU combo deliverables', plan);
    assert(plan.executionPlan.mode === 'tool_execution', 'confirmed detail-page work should let the Agent choose its tool path', plan);
    assert(plan.executionPlan.requiresUserApproval === false, 'confirmed detail-page work should not require a category planning gate', plan);
    return plan;
  });

  record('main-image-white-background-using-sku-material-stays-main-image-task', () => {
    const inputs = [
      '帮我使用SKU素材做白底图导出到主图目录下',
      '帮我使用SKU素材做白底图导出到到主图目录下'
    ];
    const plans = inputs.map((input) => planFor(input, {
      routeSource: 'deterministic_route',
      route: 'skill_execution',
      skillId: 'main-image-design',
      skillParams: {
        imageType: 'white-bg',
        sourceAssetKind: 'project-sku-material'
      },
      reason: '白底图主图导出'
    }));
    for (const plan of plans) {
      assert(plan.status === 'ready_for_controlled_execution_plan', 'white background main image should be controlled execution plan', plan);
      assert(plan.designBrief.scenario === 'main-image', 'SKU material should not turn main-image request into sku scenario', plan);
      assert(plan.designBrief.skillManifestRef?.startsWith('ecommerce.main_image@'), 'main-image manifest should own the plan', plan);
      assert(plan.designBrief.deliverables.includes('main_image_psd'), 'main image should use its declared editable document deliverable', plan);
      assert(plan.designBrief.deliverables.includes('main_image_preview'), 'main image should use its declared preview deliverable', plan);
      assert(plan.designBrief.deliverables.includes('delivery_manifest'), 'main image should use its declared delivery manifest', plan);
      assert(!plan.designBrief.deliverables.includes('sku_color_combinations'), 'SKU material source must not imply SKU color combinations', plan);
      assert(!plan.designBrief.deliverables.includes('sku_self_select_notes'), 'SKU material source must not imply SKU self-select notes', plan);
      assert(plan.requiredInputs.includes('skill_input:product'), 'main image should consume its declared product input', plan);
      assert(plan.requiredInputs.includes('skill_input:asset_source'), 'main image should consume its declared asset source', plan);
      assert(plan.requiredInputs.includes('visual_observation'), 'main-image manifest requires bounded visual observation', plan);
      assert(plan.designBrief.needsVisualObservation === true, 'main-image visual requirement should come from its manifest profile', plan);
    }
    return plans;
  });

  record('confirmed-open-design-request-enters-autonomous-tools', () => {
    const plan = planFor('帮我根据当前画面做一个更高级的设计', {
      routeSource: 'model_router',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      reason: '开放式设计'
    });
    assert(plan.status === 'ready_for_tool_execution', 'confirmed open design should enter the autonomous Agent loop', plan);
    assert(plan.allowedToolScope === 'write_photoshop', 'confirmed open design may use Photoshop tools', plan);
    assert(plan.executionPlan.canExecuteTools === true, 'the Agent loop should be allowed to choose and execute its own tool path', plan);
    assert(plan.executionPlan.requiresUserApproval === false, 'confirmed open design should not be stopped by a category planning gate', plan);
    assert(plan.requiredInputs.includes('design_brief'), 'open design needs design brief', plan);
    assert(plan.requiredInputs.includes('verification_targets'), 'open design needs verification targets', plan);
    return plan;
  });

  function openDesignTaskPlan() {
    const plan = planFor('帮我根据当前画面做一个更高级的设计', {
      routeSource: 'model_router',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      reason: '用户显式选择生成公开计划',
      forcePublicPlanGeneration: true
    });
    assert(plan.status === 'ready_for_model_planning', 'explicit public-plan mode should stay reviewable before execution', plan);
    assert(plan.executionPlan.requiresUserApproval === true, 'only explicit public-plan mode should require approval', plan);
    return plan;
  }

  record('generic-controlled-runner-does-not-infer-detail-skill-policy-from-document-name', () => {
    const blockers = collectAgentTaskPublicPlanOperationParamBlockers([{
      operationId: 'create-user-named-document',
      toolName: 'createDocument',
      params: { width: 790, height: 1200, name: '详情页长图' },
      readbackTargets: ['document_info']
    }, {
      operationId: 'render-user-selected-layout',
      toolName: 'renderLayout',
      params: {
        canvas: { width: 790, height: 1200 },
        blocks: [
          { id: 'background', role: 'background', content: '#FFFFFF', heightRatio: 1 },
          { id: 'headline', role: 'title', content: '轻盈透气', heightRatio: 0.12 }
        ]
      },
      readbackTargets: ['acceptance_snapshot']
    }]);
    assert(
      !blockers.some((blocker) => /stagePlan|详情页阶段计划/.test(String(blocker))),
      'generic controlled runner must not infer a detail-page Skill policy from a document name or preset',
      blockers
    );
    return blockers;
  });

  function publicPlan(overrides = {}) {
    return {
      status: 'ready',
      canExecuteTools: false,
      message: '公开设计计划：确认 C:/DesignEcho/C-1163/open-design.psd 后，再创建标题文字并移动图层。',
      proposedWriteTools: ['createTextLayer', 'moveLayer'],
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
      executionPlanSummary: '根据 C:/DesignEcho/C-1163/open-design.psd 创建标题文字并移动图层，执行后读回验收快照。',
      ...overrides
    };
  }

  function publicPlanRuntimeOperations() {
    return [{
      operationId: 'public-plan-op-title',
      toolName: 'createTextLayer',
      params: { content: '轻盈透气', x: 160, y: 180, fontSize: 48 },
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
    }, {
      operationId: 'public-plan-op-title-offset',
      toolName: 'moveLayer',
      params: { layerId: 501, x: 20, y: 0, relative: true },
      readbackTargets: ['acceptance_snapshot']
    }];
  }

  record('same-run-model-plan-cannot-be-promoted-to-public-plan-approval', () => {
    const sameRunPlan = planFor('帮我处理一下', {
      routeSource: 'intent_control_plane',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      reason: '模型在同一循环内补齐目标与路径'
    });
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: sameRunPlan,
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(sameRunPlan.executionPlan.requiresUserApproval === false, 'same-run planning must not carry approval semantics', sameRunPlan);
    assert(request.status === 'blocked_public_plan_not_ready', 'same-run planning cannot be converted into an approval request', request);
    return request;
  });

  record('public-plan-confirmed-request-still-blocks-until-controlled-runner-enabled', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true
    });
    assert(request.status === 'blocked_execution_request_disabled', 'confirmed public plan must still block by default', request);
    assert(request.userConfirmed === true, 'request should record user confirmation', request);
    assert(request.canStartControlledRunner === false, 'request must not start runner without explicit enable', request);
    assert(request.shouldRunPhotoshop === false, 'request must not write Photoshop', request);
    assert(request.mustNotRunWriteTools === true, 'request must not run write tools', request);
    assert(request.approvedWriteTools.includes('createTextLayer'), 'request should keep approved write tool list', request);
    assert(!containsForbiddenField(request), 'request contains forbidden confidence/raw field', containsForbiddenField(request));
    return request;
  });

  record('public-plan-request-ready-only-after-confirmation-and-explicit-runner-enable', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'ready_for_controlled_execution_request', 'request should only become ready after explicit enable', request);
    assert(request.canStartControlledRunner === true, 'request should allow controlled runner handoff', request);
    assert(request.shouldRunPhotoshop === false, 'request itself must not write Photoshop', request);
    assert(request.operationRequests.length === 2, 'request should create one operation request per proposed write tool', request);
    assert(request.operationRequests.every((item) => item.readbackTargets.includes('acceptance_snapshot')), 'operation request should require readback', request);
    assert(!containsForbiddenField(request), 'request contains forbidden confidence/raw field', containsForbiddenField(request));
    return request;
  });

  record('public-plan-runtime-operation-requests-drop-unsafe-or-unapproved-params', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      runtimeOperationRequests: [
        {
          operationId: 'safe-title',
          toolName: 'createTextLayer',
          params: { content: '轻盈透气', x: 160, y: 180, fontSize: 48 },
          readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
        },
        {
          operationId: 'unsafe-path',
          toolName: 'placeImage',
          params: { imagePath: 'C:/DesignEcho/C-1163/private-source.png' },
          readbackTargets: ['acceptance_snapshot']
        },
        {
          operationId: 'unsafe-base64',
          toolName: 'createTextLayer',
          params: { content: 'data:image/png;base64,AAAA' },
          readbackTargets: ['layer_hierarchy']
        },
        {
          operationId: 'unapproved-tool',
          toolName: 'executeScript',
          params: { script: 'app.activeDocument.close()' },
          readbackTargets: ['acceptance_snapshot']
        },
        {
          operationId: 'missing-params',
          toolName: 'moveLayer',
          readbackTargets: ['acceptance_snapshot']
        }
      ],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'ready_for_controlled_execution_request', 'safe subset should keep request ready', request);
    assert(request.operationRequests.length === 1, 'only safe approved operation params should remain', request);
    assert(request.operationRequests[0].operationId === 'safe-title', 'safe operation should be preserved', request);
    assert(request.operationRequests[0].params, 'safe operation params should be preserved privately', request);
    const publicRequest = stripRuntimeParamsFromPublicPlanExecutionRequest(request);
    assert(!containsPrivateRuntimeField(publicRequest), 'public request must not expose private params', containsPrivateRuntimeField(publicRequest));
    assert(!containsForbiddenField(publicRequest), 'public request contains forbidden confidence/raw field', containsForbiddenField(publicRequest));
    return request;
  });

  record('public-plan-request-blocks-unapproved-write-tools', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createTextLayer', 'executeScript']
      }),
      runtimeAllowedWriteTools: ['createTextLayer'],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'blocked_write_tool_not_allowed', 'unapproved write tool should block', request);
    assert(request.blockedWriteTools.includes('executeScript'), 'blocked tool should be surfaced', request);
    assert(request.canStartControlledRunner === false, 'blocked request must not start runner', request);
    assert(request.mustNotRunWriteTools === true, 'blocked request must not run write tools', request);
    return request;
  });

  record('public-plan-request-blocks-missing-write-tool-plan', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: [],
        writeToolAllowlist: []
      }),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'blocked_missing_write_tool_allowlist', 'missing proposed write tools should block', request);
    assert(request.canStartControlledRunner === false, 'missing tool plan must not start runner', request);
    assert(request.operationRequests.length === 0, 'missing write tools must not create operations', request);
    return request;
  });

  record('public-plan-request-blocks-missing-readback-targets', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        readbackTargets: []
      }),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'blocked_missing_readback_targets', 'missing readback targets should block', request);
    assert(request.canStartControlledRunner === false, 'missing readback targets must not start runner', request);
    assert(request.operationRequests.length === 0, 'missing readback targets must not create operations', request);
    return request;
  });

  record('public-plan-approval-record-uses-selected-pending-request-without-tools', () => {
    const agentTaskPlan = openDesignTaskPlan();
    const selectedPlan = publicPlan({
      message: '公开设计计划：用户选择的计划。',
      executionPlanSummary: '用户选择的计划执行摘要。'
    });
    const newerPlan = publicPlan({
      message: '公开设计计划：较新的待确认计划。',
      executionPlanSummary: '较新的待确认计划执行摘要。'
    });
    const selectedPendingRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan,
      publicPlan: selectedPlan
    });
    const newerPendingRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan,
      publicPlan: newerPlan
    });
    const record = buildAgentTaskPublicPlanApprovalRecord({
      userInput: '确认执行公开计划',
      sourceMessageId: 'selected-public-plan',
      conversationHistory: [{
        id: 'selected-public-plan',
        role: 'assistant',
        content: selectedPlan.message,
        agentTaskPlan,
        agentTaskPublicPlan: selectedPlan,
        agentTaskPublicPlanExecutionRequest: selectedPendingRequest
      }, {
        id: 'newer-public-plan',
        role: 'assistant',
        content: newerPlan.message,
        agentTaskPlan,
        agentTaskPublicPlan: newerPlan,
        agentTaskPublicPlanExecutionRequest: newerPendingRequest
      }]
    });
    assert(selectedPendingRequest.status === 'blocked_pending_user_confirmation', 'fixture pending request should stay pending', selectedPendingRequest);
    assert(record.status === 'approved_controlled_execution_request', 'approval record should approve selected pending request', record);
    assert(record.userConfirmed === true, 'approval should record explicit confirmation', record);
    assert(record.enableControlledExecutionRequest === true, 'approval should enable controlled request handoff', record);
    assert(record.mustNotRunWriteTools === true, 'approval record must not execute write tools', record);
    assert(record.allowedWriteTools.includes('createTextLayer'), 'approval should preserve allowed write tools', record);
    assert(record.sourceMessageId === 'selected-public-plan', 'approval should preserve selected source message id', record);
    assert(record.agentTaskPublicPlan?.message === '公开设计计划：用户选择的计划。', 'approval should not switch to a newer pending plan', record);
    assert(!containsForbiddenField(record), 'approval record contains forbidden confidence/raw field', containsForbiddenField(record));
    return record;
  });

  record('public-plan-controlled-runner-defaults-to-dry-run-without-tools', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const run = runAgentTaskPublicPlanControlledRunner({ request });
    assert(run.version === 'agent-task-public-plan-controlled-runner/v0', 'controlled runner should expose stable version', run);
    assert(run.status === 'completed_dry_run', 'controlled runner should default to dry-run', run);
    assert(run.executionTarget === 'dry-run', 'default target should be dry-run', run);
    assert(run.shouldRunPhotoshop === false, 'dry-run must not write Photoshop', run);
    assert(run.mustNotRunWriteTools === true, 'dry-run must not run write tools', run);
    assert(run.executedWriteTools.length === 0, 'dry-run must not record executed write tools', run);
    assert(run.operationRequests.length === request.operationRequests.length, 'dry-run should preserve operation requests', run);
    assert(run.readbackTargets.includes('acceptance_snapshot'), 'dry-run should preserve readback targets', run);
    assert(!containsForbiddenField(run), 'controlled runner contains forbidden confidence/raw field', containsForbiddenField(run));
    return run;
  });

  record('public-plan-controlled-runner-fake-adapter-requires-readback-and-stops-on-failure', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const missingAdapterRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter'
    });
    assert(missingAdapterRun.status === 'blocked_adapter_required', 'fake runner should require adapter', missingAdapterRun);

    const missingReadbackRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: () => ({ success: true })
      }
    });
    assert(missingReadbackRun.status === 'blocked_readback_adapter_required', 'fake runner should require readback adapter', missingReadbackRun);

    const verifiedRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: (operation) => ({ success: true, data: { operationId: operation.operationId } }),
        readbackAfterOperation: (_operation, target) => ({ success: true, data: { target } })
      }
    });
    assert(verifiedRun.status === 'completed_fake_adapter_verified', 'fake runner should execute and read back', verifiedRun);
    assert(verifiedRun.operationResults.length === request.operationRequests.length, 'fake runner should execute all operations', verifiedRun);
    assert(verifiedRun.readbackResults.length === request.operationRequests.length * request.readbackTargets.length, 'fake runner should read back after each operation', verifiedRun);
    assert(verifiedRun.mustNotRunWriteTools === true, 'fake runner must still avoid real write tools', verifiedRun);
    assert(verifiedRun.writesPerformed === false, 'fake runner must not report real Photoshop writes', verifiedRun);
    assert(verifiedRun.executionState === 'completed', 'fake runner should report completed simulated execution', verifiedRun);
    assert(verifiedRun.verificationStatus === 'passed', 'fake runner should report passed readback verification', verifiedRun);

    const failedWriteRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: () => ({ success: false, error: 'fake write failed' }),
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(failedWriteRun.status === 'failed_write_operation', 'fake runner should stop on write failure', failedWriteRun);
    assert(failedWriteRun.readbackResults.length === 0, 'fake runner should not read back after failed write', failedWriteRun);

    const failedReadbackRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: () => ({ success: true }),
        readbackAfterOperation: (_operation, target) => (
          target === 'acceptance_snapshot'
            ? { success: false, error: 'acceptance readback failed' }
            : { success: true }
        )
      }
    });
    assert(failedReadbackRun.status === 'failed_readback', 'fake runner should stop on readback failure', failedReadbackRun);
    assert(failedReadbackRun.verificationStatus === 'failed', 'failed fake readback should report failed verification', failedReadbackRun);
    assert(String(failedReadbackRun.readbackResults.at(-1)?.error || '').includes('acceptance readback failed'), 'readback failure should preserve reason', failedReadbackRun);
    return {
      missingAdapterRun,
      missingReadbackRun,
      verifiedRun,
      failedWriteRun,
      failedReadbackRun
    };
  });

  record('public-plan-controlled-live-runner-requires-permission-adapter-and-replayable-params', () => {
    const summaryOnlyRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const withoutPermissionRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      executionTarget: 'live-photoshop'
    });
    assert(withoutPermissionRun.status === 'blocked_live_write_permission_missing', 'live public-plan runner should require explicit write permission', withoutPermissionRun);
    assert(withoutPermissionRun.writesPerformed === false, 'blocked live public-plan runner must not perform writes', withoutPermissionRun);
    assert(withoutPermissionRun.executionState === 'not_started', 'blocked live public-plan runner must stay not started', withoutPermissionRun);
    assert(withoutPermissionRun.verificationStatus === 'not_run', 'blocked live public-plan runner must not report verification', withoutPermissionRun);
    assert(withoutPermissionRun.shouldRunPhotoshop === false, 'blocked live public-plan runner must not run Photoshop', withoutPermissionRun);
    assert(withoutPermissionRun.executedWriteTools.length === 0, 'blocked live public-plan runner must not record writes', withoutPermissionRun);

    const permissionWithoutTargetRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      allowPhotoshopWrites: true,
      adapter: {
        runWriteOperation: () => ({ success: true }),
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(permissionWithoutTargetRun.status === 'completed_dry_run', 'write permission alone should not switch public-plan runner into live Photoshop target', permissionWithoutTargetRun);
    assert(permissionWithoutTargetRun.executedWriteTools.length === 0, 'write permission without live target must not execute writes', permissionWithoutTargetRun);

    const missingAdapterRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document'
    });
    assert(missingAdapterRun.status === 'blocked_live_adapter_required', 'live public-plan runner should require injected adapter', missingAdapterRun);
    assert(missingAdapterRun.executedWriteTools.length === 0, 'missing live adapter must block before writes', missingAdapterRun);

    let missingParamsCalls = 0;
    const missingParamsRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        runWriteOperation: () => {
          missingParamsCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(missingParamsRun.status === 'blocked_live_operation_params_required', 'live public-plan runner should not infer write params from summaries', missingParamsRun);
    assert(missingParamsCalls === 0, 'missing params should block before adapter calls', missingParamsRun);

    const incompleteRenderLayoutRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument', 'renderLayout'],
        readbackTargets: ['document_info', 'acceptance_snapshot'],
        executionPlanSummary: '创建详情页画布并渲染版面。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-detail-page-document',
        toolName: 'createDocument',
        params: { width: 790, height: 1200, name: '详情页长图' },
        readbackTargets: ['document_info']
      }, {
        operationId: 'render-detail-page-layout',
        toolName: 'renderLayout',
        params: { canvas: { width: 790, height: 1200 } },
        readbackTargets: ['acceptance_snapshot']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    let incompleteRenderLayoutCalls = 0;
    const incompleteRenderLayoutRun = runAgentTaskPublicPlanControlledRunner({
      request: incompleteRenderLayoutRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        runWriteOperation: () => {
          incompleteRenderLayoutCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(incompleteRenderLayoutRun.status === 'blocked_live_operation_params_required', 'live public-plan runner should require executable renderLayout blocks before any live write', incompleteRenderLayoutRun);
    assert(incompleteRenderLayoutCalls === 0, 'incomplete renderLayout params should block before adapter calls', incompleteRenderLayoutRun);
    assert(
      incompleteRenderLayoutRun.blockers.some((blocker) => String(blocker).includes('renderLayout') && String(blocker).includes('blocks')),
      'incomplete renderLayout blocker should name the missing blocks contract',
      incompleteRenderLayoutRun
    );

    const badVisualCopyAndPlacementRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument', 'placeImage', 'renderLayout'],
        readbackTargets: ['document_info', 'acceptance_snapshot'],
        executionPlanSummary: '创建详情页画布、置入项目素材并渲染版面。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-detail-page-document',
        toolName: 'createDocument',
        params: { width: 790, height: 1600, name: '详情页长图' },
        readbackTargets: ['document_info']
      }, {
        operationId: 'place-hero-product-photo',
        toolName: 'placeImage',
        params: { autoSelect: true, selectionMode: 'auto', requirement: '首屏袜子图片', center: true },
        readbackTargets: ['layer_hierarchy']
      }, {
        operationId: 'place-material-detail-photo',
        toolName: 'placeImage',
        params: { autoSelect: true, selectionMode: 'auto', requirement: '材质细节图片', center: true },
        readbackTargets: ['layer_hierarchy']
      }, {
        operationId: 'render-detail-page-layout',
        toolName: 'renderLayout',
        params: {
          canvas: { width: 790, height: 1600 },
          blocks: [
            { id: 'bg', role: 'background', content: '#FFFFFF', heightRatio: 1 },
            { id: 'material', role: 'selling-point', content: '材质/透气：使用项目素材中的材质细节图，说明袜子的透气科技', heightRatio: 0.12 }
          ]
        },
        readbackTargets: ['acceptance_snapshot']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    let badVisualCopyAndPlacementCalls = 0;
    const badVisualCopyAndPlacementRun = runAgentTaskPublicPlanControlledRunner({
      request: badVisualCopyAndPlacementRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        runWriteOperation: () => {
          badVisualCopyAndPlacementCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(
      badVisualCopyAndPlacementRun.status === 'blocked_live_operation_params_required',
      'live public-plan runner should block internal visible copy and overlapping multi-image placement before writes',
      badVisualCopyAndPlacementRun
    );
    assert(badVisualCopyAndPlacementCalls === 0, 'bad visual copy and placement should block before adapter calls', badVisualCopyAndPlacementRun);
    assert(
      badVisualCopyAndPlacementRun.blockers.some((blocker) => /内部素材说明|可见文案/.test(String(blocker)))
        && badVisualCopyAndPlacementRun.blockers.some((blocker) => /targetBounds|重叠/.test(String(blocker))),
      'bad visual plan blockers should name visible copy and image-placement contracts',
      badVisualCopyAndPlacementRun
    );

    const badImageBoundsAndStackingRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument', 'placeImage', 'renderLayout'],
        readbackTargets: ['document_info', 'acceptance_snapshot'],
        executionPlanSummary: '创建详情页画布、置入项目素材并渲染版面。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-detail-page-document',
        toolName: 'createDocument',
        params: { width: 790, height: 1600, name: '详情页长图' },
        readbackTargets: ['document_info']
      }, {
        operationId: 'place-lower-product-photo',
        toolName: 'placeImage',
        params: {
          autoSelect: true,
          selectionMode: 'auto',
          requirement: '底部袜子图片',
          targetBounds: { x: 80, y: 1450, width: 630, height: 320 },
          targetFit: 'cover'
        },
        readbackTargets: ['layer_hierarchy']
      }, {
        operationId: 'render-detail-page-layout',
        toolName: 'renderLayout',
        params: {
          canvas: { width: 790, height: 1600 },
          blocks: [
            { id: 'bg', role: 'background', content: '#0F172A', heightRatio: 1 },
            { id: 'title', role: 'title', content: '舒适透气运动袜', heightRatio: 0.12 },
            { id: 'material', role: 'selling-point', content: '吸汗速干', heightRatio: 0.12 }
          ]
        },
        readbackTargets: ['acceptance_snapshot']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    let badImageBoundsAndStackingCalls = 0;
    const badImageBoundsAndStackingRun = runAgentTaskPublicPlanControlledRunner({
      request: badImageBoundsAndStackingRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        runWriteOperation: () => {
          badImageBoundsAndStackingCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(
      badImageBoundsAndStackingRun.status === 'blocked_live_operation_params_required',
      'live public-plan runner should block image target bounds outside the canvas and missing below-text stacking',
      badImageBoundsAndStackingRun
    );
    assert(badImageBoundsAndStackingCalls === 0, 'bad image bounds and stacking should block before adapter calls', badImageBoundsAndStackingRun);
    assert(
      badImageBoundsAndStackingRun.blockers.some((blocker) => /画布|canvas|越界|超出/.test(String(blocker)))
        && badImageBoundsAndStackingRun.blockers.some((blocker) => /layerOrder|文字|文案|遮挡/.test(String(blocker))),
      'bad image bounds blockers should name canvas bounds and stacking contracts',
      badImageBoundsAndStackingRun
    );

    const badImageTextOverlapRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument', 'placeImage', 'renderLayout'],
        readbackTargets: ['document_info', 'acceptance_snapshot'],
        executionPlanSummary: '创建详情页画布、置入项目素材并渲染版面。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-detail-page-document',
        toolName: 'createDocument',
        params: { width: 790, height: 2400, name: '详情页长图' },
        readbackTargets: ['document_info']
      }, {
        operationId: 'place-hero-product-photo',
        toolName: 'placeImage',
        params: {
          autoSelect: true,
          selectionMode: 'auto',
          requirement: '首屏袜子图片',
          targetBounds: { x: 195, y: 0, width: 400, height: 400 },
          targetFit: 'cover',
          layerOrder: 'belowText'
        },
        readbackTargets: ['layer_hierarchy']
      }, {
        operationId: 'render-detail-page-layout',
        toolName: 'renderLayout',
        params: {
          canvas: { width: 790, height: 2400 },
          blocks: [
            { id: 'bg', role: 'background', content: '#FFFFFF', heightRatio: 1 },
            { id: 'title', role: 'title', content: 'C-1194 专业运动袜', heightRatio: 0.04, widthRatio: 0.9, hAlign: 'left' },
            { id: 'dry', role: 'subtitle', content: '吸湿排汗，持久干爽', heightRatio: 0.04, widthRatio: 0.9, hAlign: 'left' },
            { id: 'material', role: 'subtitle', content: '精梳棉混纺，网眼透气结构', heightRatio: 0.04, widthRatio: 0.9, hAlign: 'left' }
          ]
        },
        readbackTargets: ['acceptance_snapshot']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    let badImageTextOverlapCalls = 0;
    const badImageTextOverlapRun = runAgentTaskPublicPlanControlledRunner({
      request: badImageTextOverlapRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        runWriteOperation: () => {
          badImageTextOverlapCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(
      badImageTextOverlapRun.status === 'blocked_live_operation_params_required',
      'live public-plan runner should block image target bounds that collide with renderLayout visible copy regions',
      badImageTextOverlapRun
    );
    assert(badImageTextOverlapCalls === 0, 'image/text overlap should block before adapter calls', badImageTextOverlapRun);
    assert(
      badImageTextOverlapRun.blockers.some((blocker) => /重叠|压住|文案|文字|targetBounds/.test(String(blocker))),
      'image/text overlap blocker should explain that planned image bounds collide with visible copy',
      badImageTextOverlapRun
    );

    const missingRenderLayoutCanvasRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument', 'renderLayout', 'placeImage'],
        readbackTargets: ['document_info', 'acceptance_snapshot'],
        executionPlanSummary: '创建详情页画布、渲染可编辑文字并置入项目素材。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-detail-page-document',
        toolName: 'createDocument',
        params: { width: 790, height: 3000, name: '详情页长图' },
        readbackTargets: ['document_info']
      }, {
        operationId: 'render-detail-page-layout',
        toolName: 'renderLayout',
        params: {
          blocks: [
            { id: 'bg', role: 'background', content: '#1A1A1A', heightRatio: 1 },
            { id: 'title', role: 'title', content: 'WERKE 专业运动袜', heightRatio: 0.08 },
            { id: 'dry', role: 'selling-point', content: '核心卖点：吸湿排汗，持久干爽', heightRatio: 0.08 },
            { id: 'material', role: 'selling-point', content: '材质透气：高密度网眼结构', heightRatio: 0.08 }
          ]
        },
        readbackTargets: ['acceptance_snapshot']
      }, {
        operationId: 'place-hero-product-photo',
        toolName: 'placeImage',
        params: {
          autoSelect: true,
          selectionMode: 'auto',
          requirement: '首屏袜子图片',
          targetBounds: { x: 0, y: 0, width: 790, height: 600 },
          targetFit: 'cover',
          layerOrder: 'belowText'
        },
        readbackTargets: ['layer_hierarchy']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    let missingRenderLayoutCanvasCalls = 0;
    const missingRenderLayoutCanvasRun = runAgentTaskPublicPlanControlledRunner({
      request: missingRenderLayoutCanvasRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        runWriteOperation: () => {
          missingRenderLayoutCanvasCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(
      missingRenderLayoutCanvasRun.status === 'blocked_live_operation_params_required',
      'live public-plan runner should block renderLayout without explicit canvas before writes',
      missingRenderLayoutCanvasRun
    );
    assert(missingRenderLayoutCanvasCalls === 0, 'missing renderLayout canvas should block before adapter calls', missingRenderLayoutCanvasRun);
    assert(
      missingRenderLayoutCanvasRun.blockers.some((blocker) => /canvas|画布尺寸/.test(String(blocker))),
      'missing renderLayout canvas blocker should explain that layout coordinates cannot be verified',
      missingRenderLayoutCanvasRun
    );

    const unsupportedRenderLayoutRoleRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument', 'renderLayout', 'placeImage'],
        readbackTargets: ['document_info', 'acceptance_snapshot'],
        executionPlanSummary: '创建详情页画布、渲染可编辑文字并置入项目素材。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-detail-page-document',
        toolName: 'createDocument',
        params: { width: 790, height: 2400, name: '详情页长图' },
        readbackTargets: ['document_info']
      }, {
        operationId: 'render-detail-page-layout',
        toolName: 'renderLayout',
        params: {
          canvas: { width: 790, height: 2400 },
          blocks: [
            { id: 'bg', role: 'background', content: '#1A1A1A', heightRatio: 1 },
            { id: 'title', role: 'text', content: 'WERKE 专业运动袜', heightRatio: 0.1 },
            { id: 'fit', role: 'text', content: '弹力贴合：高弹罗纹袜口', heightRatio: 0.1 }
          ]
        },
        readbackTargets: ['acceptance_snapshot']
      }, {
        operationId: 'place-hero-product-photo',
        toolName: 'placeImage',
        params: {
          autoSelect: true,
          selectionMode: 'auto',
          requirement: '首屏袜子图片',
          targetBounds: { x: 0, y: 0, width: 790, height: 600 },
          targetFit: 'cover',
          layerOrder: 'belowText'
        },
        readbackTargets: ['layer_hierarchy']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    let unsupportedRenderLayoutRoleCalls = 0;
    const unsupportedRenderLayoutRoleRun = runAgentTaskPublicPlanControlledRunner({
      request: unsupportedRenderLayoutRoleRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        runWriteOperation: () => {
          unsupportedRenderLayoutRoleCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(
      unsupportedRenderLayoutRoleRun.status === 'blocked_live_operation_params_required',
      'live public-plan runner should block unsupported renderLayout roles before writes',
      unsupportedRenderLayoutRoleRun
    );
    assert(unsupportedRenderLayoutRoleCalls === 0, 'unsupported renderLayout role should block before adapter calls', unsupportedRenderLayoutRoleRun);
    assert(
      unsupportedRenderLayoutRoleRun.blockers.some((blocker) => /role|不支持|未知/.test(String(blocker))),
      'unsupported renderLayout role blocker should explain the role contract',
      unsupportedRenderLayoutRoleRun
    );

    const replayableRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      runtimeOperationRequests: publicPlanRuntimeOperations(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const liveAdapter = {
      calls: [],
      readbacks: [],
      runWriteOperation: (operation) => {
        liveAdapter.calls.push(operation);
        return { success: true, data: { operationId: operation.operationId, toolName: operation.toolName } };
      },
      readbackAfterOperation: (operation, target) => {
        liveAdapter.readbacks.push({ operation, target });
        return { success: true, data: { target, operationId: operation.operationId } };
      }
    };
    const missingScopeRun = runAgentTaskPublicPlanControlledRunner({
      request: replayableRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      adapter: liveAdapter
    });
    assert(missingScopeRun.status === 'blocked_live_execution_scope_required', 'live public-plan runner should require disposable or explicitly approved project scope', missingScopeRun);
    assert(missingScopeRun.shouldRunPhotoshop === false, 'missing live scope must not run Photoshop', missingScopeRun);
    assert(liveAdapter.calls.length === 0, 'missing live scope must block before adapter calls', liveAdapter.calls);

    const projectWithoutApprovalRun = runAgentTaskPublicPlanControlledRunner({
      request: replayableRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'explicit-project-document',
      adapter: liveAdapter
    });
    assert(projectWithoutApprovalRun.status === 'blocked_live_project_write_approval_required', 'project live scope should require explicit project write approval', projectWithoutApprovalRun);
    assert(projectWithoutApprovalRun.shouldRunPhotoshop === false, 'missing project write approval must not run Photoshop', projectWithoutApprovalRun);
    assert(liveAdapter.calls.length === 0, 'missing project approval must block before adapter calls', liveAdapter.calls);

    const verifiedRun = runAgentTaskPublicPlanControlledRunner({
      request: replayableRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: liveAdapter
    });
    assert(replayableRequest.operationRequests.every((operation) => operation.params), 'replayable public-plan request should preserve runtime operation params', replayableRequest);
    assert(verifiedRun.status === 'completed_live_adapter_verified', 'live public-plan runner should execute through injected adapter after all gates', verifiedRun);
    assert(verifiedRun.writesPerformed === true, 'successful live public-plan runner should report completed writes', verifiedRun);
    assert(verifiedRun.executionState === 'completed', 'successful live public-plan runner should report completed execution', verifiedRun);
    assert(verifiedRun.verificationStatus === 'passed', 'successful live public-plan runner should report passed verification', verifiedRun);
    assert(verifiedRun.shouldRunPhotoshop === true, 'successful live public-plan runner should expose Photoshop execution', verifiedRun);
    assert(verifiedRun.mustNotRunWriteTools === false, 'successful live public-plan runner should allow writes only through adapter', verifiedRun);
    assert(liveAdapter.calls.length === replayableRequest.operationRequests.length, 'live adapter should execute every replayable operation', liveAdapter.calls);
    assert(liveAdapter.readbacks.length === replayableRequest.operationRequests.reduce((count, operation) => count + operation.readbackTargets.length, 0), 'live adapter should read back after every write', liveAdapter.readbacks);
    assert(verifiedRun.executedWriteTools.join(',') === 'createTextLayer,moveLayer', 'live run should record adapter-executed write tools', verifiedRun);
    assert(!containsForbiddenField(verifiedRun), 'verified live public-plan run contains forbidden confidence/raw field', containsForbiddenField(verifiedRun));
    return {
      withoutPermissionRun,
      permissionWithoutTargetRun,
      missingAdapterRun,
      missingParamsRun,
      missingScopeRun,
      projectWithoutApprovalRun,
      verifiedRun
    };
  });

  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const engine = new DesignAgentEngine();
  let executed = [];
  skillExecutors.getSkillExecutor = (skillId) => ({ id: skillId, execute: async () => ({ success: true }) });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || null });
    return { success: true, message: `executed:${skillId}` };
  };

  try {
    const result = await engine.run(createContext('当前是什么项目'), {
      callModel: async () => ({
        text: JSON.stringify({
          route: 'autonomous_agent',
          thinking: '错误地想进入自主工具循环。'
        })
      })
    });
    cases.push({
      name: 'engine-attaches-agent-task-plan-to-results',
      status:
        result?.data?.agentTaskPlan?.version === 'agent-task-planning-contract/v0'
        && result?.data?.agentTaskPlan?.status === 'ready_read_only_plan'
        && result?.data?.agentTaskPlan?.executionPlan?.canExecuteTools === true
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ result, executed })
    });

    executed = [];
    const structuredDetailEditResult = await engine.run(createContext('帮我修改第三屏文案'), {
      callModel: async (_messages, requestOptions) => {
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'detail-page-design',
              skillParams: {
                taskType: 'ecommerce.detail_page.v1',
                workMode: 'edit_existing',
                targetScope: '3-产品信息/icon',
                requestedChange: '提供三版氛围场景文案'
              },
              intentSummary: '修改现有详情页第三屏文案，并在写入后读回复核。'
            })
          };
        }
        return { text: '' };
      }
    });
    const structuredDetailLifecycle = structuredDetailEditResult?.data?.agentRequestLifecycle;
    const structuredDetailPlan = structuredDetailEditResult?.data?.agentTaskPlan;
    cases.push({
      name: 'engine-production-lifecycle-preserves-selected-skill-task-type-and-work-mode',
      status:
        executed.length === 1
        && executed[0].skillId === 'autonomous-agent'
        && executed[0].params?.declaredSkillId === 'detail-page-design'
        && executed[0].params?.declaredTaskType === 'ecommerce.detail_page.v1'
        && executed[0].params?.declaredWorkMode === 'edit_existing'
        && structuredDetailLifecycle?.decision?.skillId === 'autonomous-agent'
        && structuredDetailLifecycle?.decision?.selectedSkillId === 'detail-page-design'
        && structuredDetailLifecycle?.decision?.taskType === 'ecommerce.detail_page.v1'
        && structuredDetailLifecycle?.decision?.workMode === 'edit_existing'
        && structuredDetailPlan?.skillId === 'detail-page-design'
        && structuredDetailPlan?.designBrief?.skillManifestRef?.startsWith('ecommerce.detail_page@')
        && structuredDetailPlan?.designBrief?.workMode === 'edit_existing'
        && structuredDetailPlan?.requiredInputs?.includes('skill_input:existing_document')
        && structuredDetailPlan?.requiredInputs?.includes('skill_input:target_scope')
        && structuredDetailPlan?.requiredInputs?.includes('skill_input:requested_change')
        && !structuredDetailPlan?.requiredInputs?.includes('skill_input:product')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: structuredDetailEditResult,
        executed
      })
    });

    executed = [];
    const sameRunPlanningPurposes = [];
    const autonomousResult = await engine.run(createContext('帮我处理一下'), {
      callModel: async (_messages, requestOptions) => {
        sameRunPlanningPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户给出了弱授权的含糊任务。'
            })
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-runs-candidate-only-model-planning-in-the-same-autonomous-loop',
      status:
        autonomousResult?.success === true
        && autonomousResult?.data?.agentTaskPlan?.status === 'ready_for_model_planning'
        && autonomousResult?.data?.agentTaskPlan?.executionPlan?.requiresUserApproval === false
        && autonomousResult?.data?.agentTaskPlan?.executionPlan?.canExecuteTools === false
        && sameRunPlanningPurposes.join(',') === 'router'
        && executed.length === 1
        && executed[0]?.skillId === 'autonomous-agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ result: autonomousResult, executed, sameRunPlanningPurposes })
    });

    executed = [];
    const plannedAutonomousResult = await engine.run(createContext('帮我处理一下', {
      agentTaskPublicPlanApproval: { approveGeneratedPublicPlan: true }
    }), {
      callModel: async (_messages, requestOptions) => {
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户给出了弱授权的含糊任务。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          return {
            text: '公开设计计划：先读取当前画面和项目上下文，确认主视觉、信息层级、可修改范围和验收目标；再给出工具白名单，等待用户确认后才进入 Photoshop 执行。'
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-returns-public-model-plan-for-candidate-only-task-before-tools',
      status:
        plannedAutonomousResult?.success === true
        && /公开设计计划/.test(plannedAutonomousResult?.message || '')
        && plannedAutonomousResult?.data?.agentTaskPlan?.status === 'ready_for_model_planning'
        && plannedAutonomousResult?.data?.agentTaskPlan?.executionPlan?.requiresUserApproval === true
        && plannedAutonomousResult?.data?.agentTaskPublicPlan?.source === 'model'
        && plannedAutonomousResult?.data?.agentTaskPublicPlan?.canExecuteTools === false
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ result: plannedAutonomousResult, executed })
    });

    executed = [];
    const recoveredPublicPlanOffsets = [];
    const recoveredPublicPlanSecret = 'PRIMARY_PROVIDER_PRIVATE_FAILURE';
    const recoveredPublicPlanResult = await engine.run(createContext('帮我处理一下', {
      agentTaskPublicPlanApproval: { approveGeneratedPublicPlan: true }
    }), {
      callModel: async (_messages, requestOptions) => {
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户给出了弱授权的含糊任务。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          recoveredPublicPlanOffsets.push(requestOptions?.modelCandidateOffset);
          if (recoveredPublicPlanOffsets.length === 1) {
            throw new Error(recoveredPublicPlanSecret);
          }
          return {
            text: '公开设计计划：先读取当前画面和项目上下文，确认主视觉、信息层级和验收目标；本轮不修改 Photoshop，等待用户确认后再执行。'
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-recovers-public-plan-when-first-provider-candidate-throws',
      status:
        recoveredPublicPlanResult?.success === true
        && recoveredPublicPlanResult?.data?.agentTaskPublicPlan?.source === 'model'
        && recoveredPublicPlanOffsets.join(',') === '0,1'
        && !JSON.stringify(recoveredPublicPlanResult).includes(recoveredPublicPlanSecret)
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: recoveredPublicPlanResult,
        modelCandidateOffsets: recoveredPublicPlanOffsets,
        executed
      })
    });

    executed = [];
    const unavailablePublicPlanOffsets = [];
    const unavailableProviderSecrets = [
      'PRIMARY_PROVIDER_PRIVATE_FAILURE',
      'FALLBACK_PROVIDER_PRIVATE_FAILURE',
      'WORKER_PROVIDER_PRIVATE_FAILURE'
    ];
    const unavailablePublicPlanResult = await engine.run(createContext('帮我处理一下', {
      agentTaskPublicPlanApproval: { approveGeneratedPublicPlan: true }
    }), {
      callModel: async (_messages, requestOptions) => {
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户给出了弱授权的含糊任务。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          const offset = Number(requestOptions?.modelCandidateOffset || 0);
          unavailablePublicPlanOffsets.push(offset);
          throw new Error(unavailableProviderSecrets[offset] || 'UNKNOWN_PROVIDER_PRIVATE_FAILURE');
        }
        return { text: '' };
      }
    });
    const unavailablePublicPlanSerialized = JSON.stringify(unavailablePublicPlanResult);
    cases.push({
      name: 'engine-reports-ui-status-when-all-public-plan-provider-candidates-throw',
      status:
        unavailablePublicPlanResult?.success === false
        && unavailablePublicPlanResult?.error === 'agent_task_public_plan_model_unavailable'
        && unavailablePublicPlanResult?.assistantReplyOrigin?.origin === 'ui_status'
        && unavailablePublicPlanResult?.assistantReplyOrigin?.source === 'agent-task-public-plan:model-call-failed'
        && unavailablePublicPlanResult?.assistantReplyOrigin?.origin !== 'deterministic_blocker'
        && unavailablePublicPlanResult?.data?.agentTaskPublicPlanFailure?.kind === 'model_call_failed'
        && unavailablePublicPlanResult?.data?.agentTaskPublicPlanFailure?.photoshopModified === false
        && unavailablePublicPlanOffsets.join(',') === '0,1,2'
        && unavailableProviderSecrets.every((secret) => !unavailablePublicPlanSerialized.includes(secret))
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: unavailablePublicPlanResult,
        modelCandidateOffsets: unavailablePublicPlanOffsets,
        executed
      })
    });

    executed = [];
    let publicPlanPrompt = '';
    const readonlyCalls = [];
    const modelPurposes = [];
    const readonlyContextResult = await engine.run(createContext('帮我处理一下', {
      agentTaskPublicPlanApproval: { approveGeneratedPublicPlan: true },
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/DesignEcho/C-1163',
        projectImageCount: 8
      },
      resumeReadonlyToolHandlers: {
        getDocumentInfo: async () => {
          readonlyCalls.push('getDocumentInfo');
          return {
            name: 'open-design.psd',
            width: 1440,
            height: 1440,
            localPath: 'C:/DesignEcho/C-1163/PSD/open-design.psd'
          };
        },
        getLayerHierarchy: async () => {
          readonlyCalls.push('getLayerHierarchy');
          return {
            layerCount: 5,
            groups: ['主视觉', '文案'],
            rawSnapshot: 'data:image/png;base64,SHOULD_NOT_LEAK'
          };
        },
        getProjectContextSnapshot: async () => {
          readonlyCalls.push('getProjectContextSnapshot');
          return {
            projectName: 'C-1163',
            projectPath: 'C:/DesignEcho/C-1163',
            imageCount: 8
          };
        },
        getAcceptanceSnapshot: async () => {
          readonlyCalls.push('getAcceptanceSnapshot');
          return {
            document: {
              name: 'open-design.psd',
              width: 1440,
              height: 1440
            },
            summary: {
              totalLayers: 5
            },
            layers: [{
              name: '氛围场景文案',
              parentPath: ['3-产品信息', 'icon'],
              text: {
                content: '从窗边坐一会，到出门走走，都想先穿这一双。'
              }
            }]
          };
        }
      }
    }), {
      callModel: async (messages, requestOptions) => {
        modelPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户要求基于当前画面做开放式设计。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          publicPlanPrompt = messages.map((message) => String(message.content || '')).join('\n');
          return {
            text: '公开设计计划：先依据 open-design.psd、主视觉和 C-1163 的素材摘要确认设计方向，再说明排版、修图和验收目标；本轮不执行 Photoshop。'
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-refreshes-readonly-context-before-public-plan',
      status:
        readonlyContextResult?.success === true
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.status === 'completed_readonly_refresh'
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.completedTools?.includes('getDocumentInfo')
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.completedTools?.includes('getLayerHierarchy')
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.completedTools?.includes('getProjectContextSnapshot')
        && readonlyContextResult?.data?.agentTaskPlan?.executionPlan?.canExecuteTools === false
        && readonlyContextResult?.data?.agentTaskPublicPlan?.canExecuteTools === false
        && !readonlyContextResult?.data?.toolResults
        && readonlyCalls.length === 4
        && readonlyCalls.every((toolName) => [
          'getDocumentInfo',
          'getLayerHierarchy',
          'getProjectContextSnapshot',
          'getAcceptanceSnapshot',
          'getDocumentSnapshot'
        ].includes(toolName))
        && modelPurposes.length === 2
        && modelPurposes.every((purpose) => ['router', 'agent_task_public_plan'].includes(purpose))
        && /open-design\.psd/.test(publicPlanPrompt)
        && /主视觉/.test(publicPlanPrompt)
        && /C-1163/.test(publicPlanPrompt)
        && /3-产品信息\/icon\/氛围场景文案/.test(publicPlanPrompt)
        && /从窗边坐一会，到出门走走，都想先穿这一双/.test(publicPlanPrompt)
        && /不得把工具可读取的现有内容、风格、长度或结构列成用户必须补充/.test(publicPlanPrompt)
        && !/C:\/UXP\/2\.0/.test(publicPlanPrompt)
        && !/data:image|base64/i.test(publicPlanPrompt)
        && !containsForbiddenField(readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext)
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: readonlyContextResult,
        executed,
        publicPlanPrompt,
        readonlyCalls,
        modelPurposes
      })
    });

    executed = [];
    const publicPlanAuthorizationPurposes = [];
    const publicPlanAuthorizationResult = await engine.run(createContext('帮我处理一下', {
      agentTaskPublicPlanApproval: { approveGeneratedPublicPlan: true },
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/DesignEcho/C-1163',
        projectImageCount: 8
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        publicPlanAuthorizationPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户要求基于当前画面做开放式设计。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          return {
            text: JSON.stringify({
              message: '公开设计计划：先确认 open-design.psd 的主视觉层级，再规划文案、图片置入和验收读回；等待用户确认后才允许受控执行。',
              writeToolAllowlist: ['createTextLayer', 'moveLayer'],
              readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
              requiresUserConfirmation: true,
              executionPlanSummary: '创建标题文字并移动到安全区域，执行后读回图层层级和验收快照。'
            })
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-builds-public-plan-confirmation-request-without-running-tools',
      status:
        publicPlanAuthorizationResult?.success === true
        && /公开设计计划/.test(publicPlanAuthorizationResult?.message || '')
        && publicPlanAuthorizationResult?.data?.agentTaskPlan?.executionPlan?.requiresUserApproval === true
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlan?.proposedWriteTools?.includes('createTextLayer')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlan?.proposedWriteTools?.includes('moveLayer')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlan?.readbackTargets?.includes('layer_hierarchy')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.version === 'agent-task-public-plan-execution-request/v0'
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.status === 'blocked_pending_user_confirmation'
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.requiresExplicitUserConfirmation === true
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.canStartControlledRunner === false
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.mustNotRunWriteTools === true
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.proposedWriteTools?.includes('createTextLayer')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.readbackTargets?.includes('acceptance_snapshot')
        && !containsForbiddenField(publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest)
        && publicPlanAuthorizationPurposes.every((purpose) => ['router', 'agent_task_public_plan'].includes(purpose))
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: publicPlanAuthorizationResult,
        executed,
        publicPlanAuthorizationPurposes
      })
    });

    executed = [];
    const operationDraftPurposes = [];
    const operationDraftResult = await engine.run(createContext('帮我处理一下', {
      agentTaskPublicPlanApproval: { approveGeneratedPublicPlan: true },
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/DesignEcho/C-1163',
        projectImageCount: 8
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        operationDraftPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户要求基于当前画面做开放式设计。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          return {
            text: JSON.stringify({
              message: '公开设计计划：先确认 open-design.psd 的主视觉层级，再创建标题文字并移动到安全区；本轮不执行 Photoshop，等待用户确认后才允许受控执行。',
              writeToolAllowlist: ['createTextLayer', 'moveLayer'],
              readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
              requiresUserConfirmation: true,
              executionPlanSummary: '创建标题文字并移动到安全区，执行后读回图层层级和验收快照。',
              operationRequests: publicPlanRuntimeOperations()
            })
          };
        }
        return { text: '' };
      }
    });
    const operationDraftPrivateRequest = operationDraftResult?.data?.agentTaskPublicPlanExecutionRequest;
    const operationDraftPrivateRuntimeOperations = extractRuntimeOperationRequestsFromPublicPlanExecutionRequest(operationDraftPrivateRequest);
    const operationDraftPublicRequest = stripRuntimeParamsFromPublicPlanExecutionRequest(operationDraftPrivateRequest);
    const operationDraftConfirmationResult = await engine.run(createContext('确认执行公开计划', {
      conversationHistory: [
        {
          id: 'model-operation-draft-source',
          role: 'assistant',
          content: operationDraftResult?.message || '',
          agentTaskPlan: operationDraftResult?.data?.agentTaskPlan,
          agentTaskPublicPlan: operationDraftResult?.data?.agentTaskPublicPlan,
          agentTaskPublicPlanExecutionRequest: operationDraftPublicRequest,
          metadata: {
            agentTaskPlan: operationDraftResult?.data?.agentTaskPlan,
            agentTaskPublicPlan: operationDraftResult?.data?.agentTaskPublicPlan,
            agentTaskPublicPlanExecutionRequest: operationDraftPublicRequest
          }
        }
      ],
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        allowedWriteTools: ['createTextLayer', 'moveLayer'],
        enableControlledExecutionRequest: true,
        requestId: operationDraftPublicRequest?.requestId,
        sourceMessageId: 'model-operation-draft-source',
        runtimeOperationRequests: operationDraftPrivateRuntimeOperations
      },
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/DesignEcho/C-1163',
        projectImageCount: 8
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        throw new Error(`operation draft confirmation flow must not call model: ${requestOptions?.purpose || 'unknown'}`);
      }
    });
    cases.push({
      name: 'engine-keeps-model-public-plan-operation-params-private-for-confirmation',
      status:
        operationDraftResult?.success === true
        && operationDraftPrivateRequest?.status === 'blocked_pending_user_confirmation'
        && operationDraftPrivateRuntimeOperations.length === 2
        && operationDraftPrivateRuntimeOperations.every((operation) => operation.params)
        && operationDraftPublicRequest?.operationRequests?.length === operationDraftPrivateRequest?.operationRequests?.length
        && !containsPrivateRuntimeField(operationDraftPublicRequest)
        && !containsForbiddenField(operationDraftPublicRequest)
        && operationDraftConfirmationResult?.success === true
        && operationDraftConfirmationResult?.data?.agentTaskPublicPlanExecutionRequest?.status === 'ready_for_controlled_execution_request'
        && operationDraftConfirmationResult?.data?.agentTaskPublicPlanExecutionRequest?.operationRequests?.every((operation) => operation.params)
        && operationDraftConfirmationResult?.data?.agentTaskPublicPlanControlledRun?.status === 'completed_dry_run'
        && operationDraftPurposes.every((purpose) => ['router', 'agent_task_public_plan'].includes(purpose))
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        operationDraftResult,
        operationDraftPrivateRuntimeOperations,
        operationDraftPublicRequest,
        operationDraftConfirmationResult,
        publicRequestPrivateField: containsPrivateRuntimeField(operationDraftPublicRequest),
        publicRequestForbiddenField: containsForbiddenField(operationDraftPublicRequest),
        operationDraftPurposes,
        executed
      })
    });

    executed = [];
    const approvedPublicPlanPurposes = [];
    const approvedPublicPlanResult = await engine.run(createContext('确认执行公开计划', {
      conversationHistory: [
        {
          role: 'user',
          content: '帮我根据当前画面做一个更高级的设计'
        },
        {
          role: 'assistant',
          content: publicPlanAuthorizationResult?.message || '',
          agentTaskPlan: publicPlanAuthorizationResult?.data?.agentTaskPlan,
          agentTaskPublicPlan: publicPlanAuthorizationResult?.data?.agentTaskPublicPlan,
          agentTaskPublicPlanExecutionRequest: publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest,
          metadata: {
            agentTaskPlan: publicPlanAuthorizationResult?.data?.agentTaskPlan,
            agentTaskPublicPlan: publicPlanAuthorizationResult?.data?.agentTaskPublicPlan,
            agentTaskPublicPlanExecutionRequest: publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest
          }
        }
      ],
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/DesignEcho/C-1163',
        projectImageCount: 8
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        approvedPublicPlanPurposes.push(requestOptions?.purpose || 'unknown');
        throw new Error(`confirmation flow must not call model: ${requestOptions?.purpose || 'unknown'}`);
      }
    });
    const approvedPublicPlanCaseChecks = {
      success: approvedPublicPlanResult?.success === true,
      userVisibleDesignPlanMessage: /设计方案/.test(approvedPublicPlanResult?.message || ''),
      approvalStatus: approvedPublicPlanResult?.data?.agentTaskPublicPlanApprovalRecord?.status === 'approved_controlled_execution_request',
      requestReady: approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.status === 'ready_for_controlled_execution_request',
      requestCanStart: approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.canStartControlledRunner === true,
      requestDoesNotRunPhotoshop: approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.shouldRunPhotoshop === false,
      requestDoesNotRunWriteTools: approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.mustNotRunWriteTools === true,
      runnerVersion: approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.version === 'agent-task-public-plan-controlled-runner/v0',
      runnerDryRun: approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.status === 'completed_dry_run',
      runnerTarget: approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.executionTarget === 'dry-run',
      runnerDoesNotRunPhotoshop: approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.shouldRunPhotoshop === false,
      runnerDoesNotRunWriteTools: approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.mustNotRunWriteTools === true,
      noExecutedWrites: Array.isArray(approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.executedWriteTools)
        && approvedPublicPlanResult.data.agentTaskPublicPlanControlledRun.executedWriteTools.length === 0,
      approvalHasNoForbiddenField: !containsForbiddenField(approvedPublicPlanResult?.data?.agentTaskPublicPlanApprovalRecord),
      requestHasNoForbiddenField: !containsForbiddenField(approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest),
      runnerHasNoForbiddenField: !containsForbiddenField(approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun),
      noModelCalls: approvedPublicPlanPurposes.length === 0,
      noSkillExecutorCalls: executed.length === 0
    };
    const approvedPublicPlanCasePass = Object.values(approvedPublicPlanCaseChecks).every(Boolean);
    cases.push({
      name: 'engine-turns-public-plan-confirmation-into-controlled-request-without-tools',
      status:
        approvedPublicPlanCasePass
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        checks: approvedPublicPlanCaseChecks,
        result: approvedPublicPlanResult,
        executed,
        approvedPublicPlanPurposes
      })
    });

    executed = [];
    const replayablePendingRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      runtimeOperationRequests: publicPlanRuntimeOperations(),
      userConfirmed: false
    });
    const privateRuntimeOperationRequests = extractRuntimeOperationRequestsFromPublicPlanExecutionRequest(replayablePendingRequest);
    const publicPendingRequest = stripRuntimeParamsFromPublicPlanExecutionRequest(replayablePendingRequest);
    assert(privateRuntimeOperationRequests.every((operation) => operation.params), 'private runtime operation cache should keep replayable params before public stripping', privateRuntimeOperationRequests);
    assert(!containsPrivateRuntimeField(publicPendingRequest), 'public pending request must not expose runtime params or live approval fields', containsPrivateRuntimeField(publicPendingRequest));

    const replayableSourceMessageId = 'public-plan-private-params-source';
    const replayableConfirmationResult = await engine.run(createContext('确认执行公开计划', {
      conversationHistory: [
        {
          id: replayableSourceMessageId,
          role: 'assistant',
          content: '公开设计计划：等待确认。',
          agentTaskPlan: openDesignTaskPlan(),
          agentTaskPublicPlan: publicPlan(),
          agentTaskPublicPlanExecutionRequest: publicPendingRequest,
          metadata: {
            agentTaskPlan: openDesignTaskPlan(),
            agentTaskPublicPlan: publicPlan(),
            agentTaskPublicPlanExecutionRequest: publicPendingRequest
          }
        }
      ],
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        allowedWriteTools: ['createTextLayer', 'moveLayer'],
        enableControlledExecutionRequest: true,
        requestId: publicPendingRequest.requestId,
        sourceMessageId: replayableSourceMessageId,
        runtimeOperationRequests: privateRuntimeOperationRequests
      },
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/DesignEcho/C-1163',
        projectImageCount: 8
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        throw new Error(`confirmation private-params flow must not call model: ${requestOptions?.purpose || 'unknown'}`);
      }
    });
    const replayableReadyRequest = replayableConfirmationResult?.data?.agentTaskPublicPlanExecutionRequest;
    const replayableControlledRun = replayableConfirmationResult?.data?.agentTaskPublicPlanControlledRun;
    cases.push({
      name: 'engine-preserves-private-runtime-operation-params-through-public-plan-confirmation',
      status:
        replayableConfirmationResult?.success === true
        && replayableReadyRequest?.status === 'ready_for_controlled_execution_request'
        && replayableReadyRequest?.operationRequests?.every((operation) => operation.params)
        && replayableControlledRun?.status === 'completed_dry_run'
        && replayableControlledRun?.operationRequests?.every((operation) => operation.params)
        && !containsPrivateRuntimeField(replayableConfirmationResult?.data?.agentTaskPublicPlanApprovalRecord)
        && !containsPrivateRuntimeField(publicPendingRequest)
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: replayableConfirmationResult,
        publicPendingRequest,
        privateRuntimeOperationCount: privateRuntimeOperationRequests.length,
        approvalRecordPrivateField: containsPrivateRuntimeField(replayableConfirmationResult?.data?.agentTaskPublicPlanApprovalRecord),
        publicRequestPrivateField: containsPrivateRuntimeField(publicPendingRequest),
        executed
      })
    });

    const liveSourceMessageId = 'public-plan-private-params-live-source';
    const makeLiveConversationHistory = () => [
      {
        id: liveSourceMessageId,
        role: 'assistant',
        content: '公开设计计划：等待受控 live handoff。',
        agentTaskPlan: openDesignTaskPlan(),
        agentTaskPublicPlan: publicPlan(),
        agentTaskPublicPlanExecutionRequest: publicPendingRequest,
        metadata: {
          agentTaskPlan: openDesignTaskPlan(),
          agentTaskPublicPlan: publicPlan(),
          agentTaskPublicPlanExecutionRequest: publicPendingRequest
        }
      }
    ];
    const blockedProjectAdapter = {
      calls: [],
      readbacks: [],
      runWriteOperation: (operation) => {
        blockedProjectAdapter.calls.push(operation);
        return { success: true };
      },
      readbackAfterOperation: (operation, target) => {
        blockedProjectAdapter.readbacks.push({ operation, target });
        return { success: true };
      }
    };
    const blockedProjectResult = await engine.run(createContext('确认执行公开计划', {
      conversationHistory: makeLiveConversationHistory(),
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        allowedWriteTools: ['createTextLayer', 'moveLayer'],
        enableControlledExecutionRequest: true,
        requestId: publicPendingRequest.requestId,
        sourceMessageId: liveSourceMessageId,
        runtimeOperationRequests: privateRuntimeOperationRequests,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'explicit-project-document',
        adapter: blockedProjectAdapter
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        throw new Error(`confirmation blocked-live flow must not call model: ${requestOptions?.purpose || 'unknown'}`);
      }
    });
    const blockedProjectRun = blockedProjectResult?.data?.agentTaskPublicPlanControlledRun;

    const liveAdapter = {
      calls: [],
      readbacks: [],
      runWriteOperation: (operation) => {
        liveAdapter.calls.push(operation);
        return { success: true, data: { operationId: operation.operationId, toolName: operation.toolName } };
      },
      readbackAfterOperation: (operation, target) => {
        liveAdapter.readbacks.push({ operation, target });
        return {
          success: true,
          data: {
            operationId: operation.operationId,
            target,
            hierarchy: [{
              id: 501,
              name: 'public-plan-title',
              kind: 'text',
              visible: true,
              contents: '轻盈透气',
              bounds: { left: 160, top: 180, right: 380, bottom: 240, width: 220, height: 60 }
            }]
          }
        };
      }
    };
    const liveConfirmationResult = await engine.run(createContext('确认执行公开计划', {
      conversationHistory: makeLiveConversationHistory(),
      agentTaskPublicPlanApproval: {
        userConfirmed: true,
        allowedWriteTools: ['createTextLayer', 'moveLayer'],
        enableControlledExecutionRequest: true,
        requestId: publicPendingRequest.requestId,
        sourceMessageId: liveSourceMessageId,
        runtimeOperationRequests: privateRuntimeOperationRequests,
        executionTarget: 'live-photoshop',
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document',
        adapter: liveAdapter
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        throw new Error(`confirmation live handoff flow must not call model: ${requestOptions?.purpose || 'unknown'}`);
      }
    });
    const liveReadyRequest = liveConfirmationResult?.data?.agentTaskPublicPlanExecutionRequest;
    const liveControlledRun = liveConfirmationResult?.data?.agentTaskPublicPlanControlledRun;
    const liveHandoffCaseChecks = {
      blockedProjectResultBlocked: blockedProjectResult?.success === false
        && blockedProjectResult?.error === 'blocked_live_project_write_approval_required',
      blockedProjectScopeRejected: blockedProjectRun?.status === 'blocked_live_project_write_approval_required',
      blockedProjectDoesNotRunPhotoshop: blockedProjectRun?.shouldRunPhotoshop === false,
      blockedProjectNoCalls: blockedProjectAdapter.calls.length === 0,
      liveResultSuccess: liveConfirmationResult?.success === true,
      liveRequestReady: liveReadyRequest?.status === 'ready_for_controlled_execution_request',
      liveRequestKeepsPublicPlanSummary: liveReadyRequest?.publicPlanSummary === publicPendingRequest?.publicPlanSummary
        && Boolean(liveReadyRequest?.publicPlanSummary),
      liveRequestKeepsExecutionPlanSummary: liveReadyRequest?.executionPlanSummary === publicPendingRequest?.executionPlanSummary
        && Boolean(liveReadyRequest?.executionPlanSummary),
      liveRunnerHasPrivateParams: liveControlledRun?.operationRequests?.every((operation) => operation.params),
      liveRunnerCompleted: liveControlledRun?.status === 'completed_live_adapter_verified',
      liveRunnerTarget: liveControlledRun?.executionTarget === 'live-photoshop',
      liveRunnerDisposableScope: liveControlledRun?.liveExecutionScope === 'disposable-document',
      liveRunnerRunsPhotoshop: liveControlledRun?.shouldRunPhotoshop === true,
      liveRunnerAllowsWriteTools: liveControlledRun?.mustNotRunWriteTools === false,
      liveRunnerDoesNotClaimTaskComplete: liveControlledRun?.mustNotClaimTaskCompletion === true,
      liveRunnerKeepsPublicPlanSummary: liveControlledRun?.publicPlanSummary === liveReadyRequest?.publicPlanSummary
        && Boolean(liveControlledRun?.publicPlanSummary),
      liveRunnerKeepsExecutionPlanSummary: liveControlledRun?.executionPlanSummary === liveReadyRequest?.executionPlanSummary
        && Boolean(liveControlledRun?.executionPlanSummary),
      liveWriteCallCount: liveAdapter.calls.length === privateRuntimeOperationRequests.length,
      liveReadbackCount: liveAdapter.readbacks.length === privateRuntimeOperationRequests.reduce((count, operation) => count + operation.readbackTargets.length, 0),
      liveExecutedWriteTools: liveControlledRun?.executedWriteTools?.join(',') === 'createTextLayer,moveLayer',
      approvalRecordHasNoPrivateRuntimeField: !containsPrivateRuntimeField(liveConfirmationResult?.data?.agentTaskPublicPlanApprovalRecord),
      publicRequestHasNoPrivateRuntimeField: !containsPrivateRuntimeField(publicPendingRequest),
      noSkillExecutorCalls: executed.length === 0
    };
    const liveHandoffCasePass = Object.values(liveHandoffCaseChecks).every(Boolean);
    cases.push({
      name: 'engine-public-plan-confirmation-can-use-runtime-injected-live-adapter-only-with-disposable-scope',
      status:
        liveHandoffCasePass
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        checks: liveHandoffCaseChecks,
        blockedProjectRun,
        blockedProjectCalls: blockedProjectAdapter.calls.length,
        liveRun: liveControlledRun,
        liveCalls: liveAdapter.calls.length,
        liveReadbacks: liveAdapter.readbacks.length,
        publicRequestPrivateField: containsPrivateRuntimeField(publicPendingRequest),
        approvalRecordPrivateField: containsPrivateRuntimeField(liveConfirmationResult?.data?.agentTaskPublicPlanApprovalRecord),
        executed
      })
    });

    const asyncAdapter = {
      calls: [],
      readbacks: [],
      async runWriteOperation(operation) {
        asyncAdapter.calls.push(operation.operationId);
        await Promise.resolve();
        return { success: true, data: { operationId: operation.operationId, asyncWrite: true } };
      },
      async readbackAfterOperation(operation, target) {
        asyncAdapter.readbacks.push(`${operation.operationId}:${target}`);
        await Promise.resolve();
        return {
          success: true,
          data: {
            operationId: operation.operationId,
            target,
            asyncReadback: true,
            hierarchy: [{
              id: 501,
              name: 'public-plan-title',
              kind: 'text',
              visible: true,
              contents: '轻盈透气',
              bounds: { left: 160, top: 180, right: 380, bottom: 240, width: 220, height: 60 }
            }]
          }
        };
      }
    };
    const asyncLiveRun = await runAgentTaskPublicPlanControlledRunnerAsync({
      request: liveReadyRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: asyncAdapter
    });
    cases.push({
      name: 'public-plan-controlled-runner-awaits-async-disposable-live-adapter',
      status:
        asyncLiveRun?.status === 'completed_live_adapter_verified'
        && asyncLiveRun?.executionTarget === 'live-photoshop'
        && asyncLiveRun?.liveExecutionScope === 'disposable-document'
        && asyncLiveRun?.shouldRunPhotoshop === true
        && asyncLiveRun?.mustNotRunWriteTools === false
        && asyncLiveRun?.publicPlanSummary === liveReadyRequest?.publicPlanSummary
        && asyncLiveRun?.executionPlanSummary === liveReadyRequest?.executionPlanSummary
        && asyncAdapter.calls.join(',') === 'public-plan-op-title,public-plan-op-title-offset'
        && asyncAdapter.readbacks.join(',') === 'public-plan-op-title:layer_hierarchy,public-plan-op-title:acceptance_snapshot,public-plan-op-title-offset:acceptance_snapshot'
        && asyncLiveRun.operationResults.every((result) => result.success === true)
        && asyncLiveRun.readbackResults.every((result) => result.success === true)
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        asyncLiveRun,
        calls: asyncAdapter.calls,
        readbacks: asyncAdapter.readbacks
      })
    });

    const collisionRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument'],
        readbackTargets: ['acceptance_snapshot'],
        executionPlanSummary: '创建画面并读回验收快照。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-collision-probe-document',
        toolName: 'createDocument',
        params: { width: 790, height: 1200, name: '碰撞验收探针' },
        readbackTargets: ['acceptance_snapshot']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const collisionRun = await runAgentTaskPublicPlanControlledRunnerAsync({
      request: collisionRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        async runWriteOperation(operation) {
          return { success: true, data: { operationId: operation.operationId } };
        },
        async readbackAfterOperation(operation, target) {
          return {
            success: true,
            data: {
              operationId: operation.operationId,
              target,
              hierarchy: [
                {
                  id: 2,
                  name: '核心卖点',
                  kind: 'text',
                  visible: true,
                  bounds: { left: 40, top: 150, right: 420, bottom: 240, width: 380, height: 90 }
                },
                {
                  id: 3,
                  name: '首屏产品图',
                  kind: 'smartObject',
                  visible: true,
                  bounds: { left: 190, top: 120, right: 600, bottom: 520, width: 410, height: 400 }
                }
              ]
            }
          };
        }
      }
    });
    cases.push({
      name: 'public-plan-controlled-runner-fails-readback-when-text-and-image-layers-collide',
      status:
        collisionRun?.status === 'failed_readback'
        && collisionRun?.blockers?.some((blocker) => /文字|文案|图片|重叠/.test(String(blocker)))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ collisionRun })
    });

    const missingVisibleCopyRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createDocument', 'renderLayout'],
        readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
        executionPlanSummary: '创建详情页草稿，并在最终观察里确认标题和三个卖点仍然存在。'
      }),
      runtimeOperationRequests: [{
        operationId: 'create-visible-copy-document',
        toolName: 'createDocument',
        params: { width: 790, height: 1201, name: '最终观察门禁探针' },
        readbackTargets: ['document_info']
      }, {
        operationId: 'render-visible-copy-layout',
        toolName: 'renderLayout',
        params: {
          canvas: { width: 790, height: 1201 },
          blocks: [
            { id: 'background', role: 'background', content: '#101827', heightRatio: 1 },
            { id: 'draft-title', role: 'title', content: '舒适透气运动袜', heightRatio: 0.14 },
            { id: 'selling-point-1', role: 'selling-point', content: '吸汗速干', heightRatio: 0.1 },
            { id: 'selling-point-2', role: 'selling-point', content: '弹力贴合', heightRatio: 0.1 },
            { id: 'selling-point-3', role: 'selling-point', content: '耐磨不易滑', heightRatio: 0.1 }
          ]
        },
        readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
      }],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const missingVisibleCopyRun = await runAgentTaskPublicPlanControlledRunnerAsync({
      request: missingVisibleCopyRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      liveExecutionScope: 'disposable-document',
      adapter: {
        async runWriteOperation(operation) {
          return { success: true, data: { operationId: operation.operationId } };
        },
        async readbackAfterOperation(operation, target) {
          return {
            success: true,
            data: {
              operationId: operation.operationId,
              target,
              hierarchy: [
                {
                  id: 4,
                  name: 'draft-title',
                  kind: 'text',
                  visible: true,
                  contents: '舒适透气运动袜',
                  bounds: { left: 80, top: 40, right: 520, bottom: 110, width: 440, height: 70 }
                },
                {
                  id: 6,
                  name: 'selling-point-1-文字',
                  kind: 'text',
                  visible: true,
                  contents: '吸汗速干',
                  bounds: { left: 120, top: 230, right: 300, bottom: 280, width: 180, height: 50 }
                },
                {
                  id: 7,
                  name: 'selling-point-2-底块',
                  kind: 'solidColor',
                  visible: true,
                  bounds: { left: 90, top: 330, right: 700, bottom: 430, width: 610, height: 100 }
                },
                {
                  id: 9,
                  name: 'selling-point-3-底块',
                  kind: 'solidColor',
                  visible: true,
                  bounds: { left: 90, top: 450, right: 700, bottom: 550, width: 610, height: 100 }
                }
              ],
              textLayerReadback: {
                success: true,
                layers: [
                  { id: 4, name: 'draft-title', contents: '舒适透气运动袜' },
                  { id: 6, name: 'selling-point-1-文字', contents: '吸汗速干' }
                ]
              }
            }
          };
        }
      }
    });
    cases.push({
      name: 'public-plan-controlled-runner-fails-final-observation-when-expected-visible-copy-is-missing',
      status:
        missingVisibleCopyRun?.status === 'failed_readback'
        && missingVisibleCopyRun?.observationDiff?.status === 'mismatch'
        && missingVisibleCopyRun?.observationDiff?.nextAction === 'repair_missing_visible_copy'
        && missingVisibleCopyRun?.observationDiff?.missingVisibleCopy?.includes('弹力贴合')
        && missingVisibleCopyRun?.observationDiff?.missingVisibleCopy?.includes('耐磨不易滑')
        && missingVisibleCopyRun?.blockers?.some((blocker) => /弹力贴合/.test(String(blocker)))
        && missingVisibleCopyRun?.blockers?.some((blocker) => /耐磨不易滑/.test(String(blocker)))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ missingVisibleCopyRun })
    });
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  const success = cases.every((item) => item.status === 'pass');
  const report = writeReport({ success, cases });
  console.log(JSON.stringify({ success, cases, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
