#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: Agent Run Record（Harness v1 · H1，2026-07-06）
 *
 * 目标不变量：一次自主运行 = 一条可持久化、可回放的运行记录。
 *  1. 摘要化红线：记录里绝不出现原始 arguments/result、base64/data URL；边界字段钉死。
 *  2. 截断语义：>400 调用保头 200 + 尾 200，droppedToolCalls 如实计数。
 *  3. checkpoint 只记确定性事实（createDocument/renderLayout 成功旗标），不推测。
 *  4. 风险分类复用 isAgentToolExecutionGuarded 单一口径（写类=write）。
 *  5. 持久化校验：validateAgentRunRecordForPersist 拒绝超大/带图/缺边界的记录。
 *  6. 接线钉桩：执行器三个出口（reflexion 轮间/取消/最终）都留档，最终结果带 runRecordRef；
 *     preload/handler/index 三处登记齐全。
 *  7. Artifact refs 只接受与 Runtime identity 一致的 Repository 严格投影；Renderer 不能自报。
 */

const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const ROOT = path.resolve(__dirname, '..');
const rr = require(path.join(ROOT, 'src', 'shared', 'agent-run-record.ts'));
const {
    artifactRepositoryService
} = require(path.join(ROOT, 'src', 'main', 'services', 'artifact-repository-service.ts'));
const {
    buildRuntimeArtifactId
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-artifact-finalization.ts'));
const { buildRuntimeStagePlan } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { buildRuntimeStageStateFromEvaluation } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-state.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

const NOW = '2026-07-06T10:00:00.000Z';
const BIG_BASE64 = 'A'.repeat(500);
const QUALITY_VERDICT = {
    version: 'design-quality-verdict/v0',
    status: 'passed',
    source: 'contract+scorecard',
    contractStatus: 'completed',
    contractFailedRequirementIds: [],
    scorecardGate: 'passed',
    overallScore: 92,
    blockers: [],
    warnings: [],
    summary: '产物齐全，设计质量达标。'
};
const RUNTIME_STAGE_STATE = buildRuntimeStageStateFromEvaluation({
    plan: buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST),
    executionSummary: {
        status: 'completed',
        stopReason: 'final_response',
        designVerdict: QUALITY_VERDICT
    }
});
const RUNTIME_STAGE_TRACE_DIGEST = {
    version: 'runtime-stage-trace-digest/v0',
    status: 'incomplete',
    eventCount: 3,
    droppedEventCount: 0,
    observedStages: ['R0', 'R1', 'R4', 'E1', 'R5'],
    missingStages: ['R2', 'R3', 'E2'],
    outOfOrderCount: 2,
    traceBackedTransitionCount: 3,
    derivedTransitionCount: 2,
    unbackedTransitionCount: 0,
    traceEventWithoutTransitionCount: 0,
    issueCount: 2,
    boundaries: {
        digestOnly: true,
        shadowOnly: true,
        changesTaskResult: false
    }
};
const RUNTIME_DESIGN_BRIEF_DIGEST = {
    version: 'runtime-design-brief-digest/v0',
    readiness: 'ready',
    taskGoal: '完成当前 SKU 设计并保留可编辑结果。',
    deliverables: ['SKU 图片', '交付清单'],
    requiredInputCount: 2,
    providedRequiredInputCount: 2,
    missingRequiredInputKeys: [],
    assumedRequiredInputKeys: [],
    contextRefs: ['context:user_goal', 'context:skill_manifest'],
    constraintCount: 2,
    boundaries: {
        digestOnly: true,
        modelAuthored: true,
        changesTaskResult: false,
        grantsPermission: false
    }
};
const RUNTIME_DESIGN_STRATEGY_DIGEST = {
    version: 'runtime-design-strategy-digest/v0',
    readiness: 'ready',
    stageGoal: '建立清晰的单一视觉焦点。',
    primaryGoal: '让用户快速理解核心价值。',
    targetAudienceSummary: '偏好清晰表达的目标用户。',
    primaryMessage: '先看到核心内容，再理解辅助信息。',
    moodKeywords: ['简洁', '可信'],
    compositionIntent: ['主体承担主要视觉重量'],
    contextRefs: ['context:user_goal', 'context:readback'],
    constraintCount: 1,
    assumptionCount: 0,
    missingInputCount: 0,
    boundaries: {
        digestOnly: true,
        modelAuthored: true,
        artifactPublished: false,
        changesTaskResult: false
    }
};
const RUNTIME_ACTION_PLAN_DIGEST = {
    version: 'runtime-action-plan-digest/v0',
    readiness: 'ready',
    planGoal: '先形成语义版面，再实施最小改动并读回复核。',
    strategyStageGoal: '建立清晰的单一视觉焦点。',
    stepCount: 3,
    stepKinds: ['compose_dsl', 'mutate', 'verify'],
    rootStepIds: ['compose-layout'],
    terminalStepIds: ['verify-change'],
    parallelGroupCount: 0,
    capabilityRefs: ['design.general', 'photoshop.write.setLayerOpacity', 'photoshop.read.inspectLayers'],
    missingCapabilityRefs: [],
    contextRefs: ['context:user_goal', 'context:design_strategy', 'context:readback'],
    designDsl: {
        compositionIntent: '主视觉承担主要重量，标题建立第一阅读入口。',
        regionCount: 2,
        elementCount: 1,
        readingOrder: ['headline', 'primary-visual']
    },
    missingInputCount: 0,
    boundaries: {
        digestOnly: true,
        modelAuthored: true,
        shadowOnly: true,
        executable: false,
        changesTaskResult: false
    }
};
const RUNTIME_ACTION_PLAN_RECONCILIATION_DIGEST = {
    version: 'runtime-action-plan-reconciliation-digest/v0',
    status: 'needs_recovery',
    planReadiness: 'ready',
    stepCount: 3,
    completedStepIds: ['compose-layout'],
    completedStepDescriptors: [{
        stepId: 'compose-layout',
        kind: 'compose_dsl',
        capabilityRefs: ['design.general'],
        observedOutcomes: ['design_dsl']
    }],
    failedStepIds: ['apply-change'],
    recoveredStepIds: [],
    resumeStepIds: ['apply-change'],
    observationCount: 1,
    droppedObservationCount: 0,
    ambiguousObservationCount: 0,
    dependencyBlockedObservationCount: 0,
    unmatchedObservationCount: 0,
    repeatAfterCompletionCount: 0,
    issueCount: 0,
    boundaries: {
        digestOnly: true,
        shadowOnly: true,
        resumeAdvisoryOnly: true,
        executesTools: false,
        changesTaskResult: false,
        countsAsQualityPass: false
    }
};

// ── 1. 基本组装 + 摘要化红线 ──
const record = rr.buildAgentRunRecord({
    now: NOW,
    goal: '帮我做SKU',
    projectPath: 'E:\\DesignEchoDemo\\C-1213',
    controlPlane: { requestKind: 'autonomous_execution', route: 'autonomous_agent', skillId: 'sku-batch' },
    result: {
        success: true,
        iterations: 3,
        stopReason: 'final_response',
        toolCallLog: [
            { name: 'getDocumentInfo', arguments: { includeBounds: true }, result: { success: true, message: '文档 800x800' } },
            { name: 'createDocument', arguments: { width: 800, height: 800, snapshot: `data:image/png;base64,${BIG_BASE64}` }, result: { success: true } },
            {
                name: 'renderLayout',
                arguments: { blocks: [{ role: 'main-image' }] },
                result: {
                    success: true,
                    message: '草稿完成',
                    photoshopMutationCommit: {
                        version: 'photoshop-mutation-commit/v1',
                        basis: 'same_execute_as_modal',
                        bindingStrength: 'document_revision',
                        before: { documentId: 41, historyStateId: 1000, activeLayerId: 7 },
                        after: { documentId: 41, historyStateId: 1001, activeLayerId: 8 },
                        toolActionCompleted: true,
                        mutationObserved: false,
                        documentChanged: true
                    },
                    photoshopHistoryTransition: {
                        version: 'photoshop-history-transition/v1',
                        basis: 'acceptance_snapshot_pair',
                        before: { documentId: 41, historyStateId: 1000 },
                        after: { documentId: 41, historyStateId: 1001 },
                        mutationObserved: false,
                        documentChanged: true
                    }
                }
            },
            { name: 'placeImage', arguments: { filePath: 'a.jpg' }, result: { success: false, error: '占位槽数量-2 少于配色数量-8', code: 'placeholder_mismatch' } }
        ],
        executionSummary: {
            status: 'completed',
            blockers: [],
            warnings: ['有 1 项结果检查需要复核。'],
            designQualityHardBlocked: false,
            designVerdict: QUALITY_VERDICT,
            runtimeStageState: RUNTIME_STAGE_STATE,
            runtimeStageTraceDigest: RUNTIME_STAGE_TRACE_DIGEST,
            runtimeDesignBriefDigest: RUNTIME_DESIGN_BRIEF_DIGEST,
            runtimeDesignStrategyDigest: RUNTIME_DESIGN_STRATEGY_DIGEST,
            runtimeActionPlanDigest: RUNTIME_ACTION_PLAN_DIGEST,
            runtimeActionPlanReconciliationDigest: RUNTIME_ACTION_PLAN_RECONCILIATION_DIGEST
        }
    }
});

check('版本与 runId 形态', record.version === 'agent-run-record/v0' && /^run-\d{14}-[0-9a-f]{8}-[0-9a-f]{4}$/.test(record.runId), record.runId);
check('决策三元组入档', record.decision && record.decision.route === 'autonomous_agent' && record.decision.skillId === 'sku-batch');
check('工具调用逐条摘要化（4条）', record.toolCalls.length === 4 && record.droppedToolCalls === 0);
check('失败调用带 code 与错误摘要', record.toolCalls[3].success === false && record.toolCalls[3].code === 'placeholder_mismatch' && record.toolCalls[3].summary.includes('占位槽'));
check('argsKeys 只存键名不存值', JSON.stringify(record.toolCalls[1].argsKeys) === JSON.stringify(['width', 'height', 'snapshot']));
check('Host 版本转移按引用重新推导并摘要入档', record.toolCalls[2].photoshopHistoryTransition
    && record.toolCalls[2].photoshopHistoryTransition.mutationObserved === true
    && record.toolCalls[2].photoshopHistoryTransition.documentChanged === false
    && record.toolCalls[2].photoshopHistoryTransition.before.historyStateId === 1000
    && record.toolCalls[2].photoshopHistoryTransition.after.historyStateId === 1001,
    JSON.stringify(record.toolCalls[2]));
check('same-modal commit 按 Host 引用重算并摘要入档', record.toolCalls[2].photoshopMutationCommit
    && record.toolCalls[2].photoshopMutationCommit.mutationObserved === true
    && record.toolCalls[2].photoshopMutationCommit.documentChanged === false
    && record.toolCalls[2].photoshopMutationCommit.after.activeLayerId === 8,
    JSON.stringify(record.toolCalls[2]));
const serialized = JSON.stringify(record);
check('红线：无 data URL / 无原始 base64', !/data:image/.test(serialized) && !serialized.includes(BIG_BASE64));
check('红线：边界声明钉死', record.boundaries.argsDigestedOnly === true
    && record.boundaries.containsRawImages === false
    && record.boundaries.neverBlocksTaskResult === true
    && record.boundaries.stageStateDigestOnly === true
    && record.boundaries.stageTraceDigestOnly === true
    && record.boundaries.designBriefDigestOnly === true
    && record.boundaries.designStrategyDigestOnly === true
    && record.boundaries.actionPlanDigestOnly === true
    && record.boundaries.actionPlanReconciliationDigestOnly === true
    && record.boundaries.contextAnchorDigestOnly === true
    && record.boundaries.resumeFreshnessDigestOnly === true);
check('Context Anchor 不用写前观察伪造最终状态', record.contextAnchor
    && record.contextAnchor.document === undefined
    && record.contextAnchor.boundaries.containsRawLayers === false);
check('quality 摘要入档', record.quality && record.quality.executionStatus === 'completed' && !record.quality.hardBlocked);
check('DesignVerdict 摘要入档', record.quality && record.quality.verdictStatus === 'passed'
    && record.quality.verdictSource === 'contract+scorecard' && record.quality.overallScore === 92);
check('Stage State 摘要入档', record.stageState && record.stageState.status === 'active'
    && record.stageState.currentStage === 'E2' && record.stageState.lastDecision === 'advance'
    && record.stageState.transitionCount === 2);
check('Stage State 只存摘要，不复制完整 ledger', !serialized.includes('stage_plan_created') && !serialized.includes('运行时已由结构化'));
check('Stage Trace 对账摘要入档', record.stageTrace && record.stageTrace.status === 'incomplete'
    && record.stageTrace.eventCount === 3 && record.stageTrace.missingStages.includes('R3')
    && record.stageTrace.unbackedTransitionCount === 0);
check('Stage Trace 只存摘要，不复制完整 events', !serialized.includes('model_tool_plan') && !serialized.includes('tool_action_result'));
check('R1 Design Brief 摘要入档', record.designBrief
    && record.designBrief.readiness === 'ready'
    && record.designBrief.taskGoal === '完成当前 SKU 设计并保留可编辑结果。'
    && record.designBrief.providedRequiredInputCount === 2);
check('R1 Design Brief 不复制完整 declaration/inputCoverage', !serialized.includes('runtime-design-brief-declaration/v0')
    && !serialized.includes('inputCoverage'));
check('R3 Design Strategy 摘要入档', record.designStrategy
    && record.designStrategy.readiness === 'ready'
    && record.designStrategy.stageGoal === '建立清晰的单一视觉焦点。'
    && record.designStrategy.contextRefs.includes('context:readback'));
check('R3 Design Strategy 不复制完整 declaration/artifact', !serialized.includes('runtime-design-strategy-declaration/v0')
    && !serialized.includes('artifactPublished'));
check('R4 Action Plan 摘要入档', record.actionPlan
    && record.actionPlan.readiness === 'ready'
    && record.actionPlan.stepCount === 3
    && record.actionPlan.rootStepIds[0] === 'compose-layout'
    && record.actionPlan.designDsl.regionCount === 2);
check('R4 Action Plan 不复制完整 steps/graph/declaration', !serialized.includes('runtime-action-plan-declaration/v0')
    && !Object.prototype.hasOwnProperty.call(record.actionPlan, 'steps')
    && !Object.prototype.hasOwnProperty.call(record.actionPlan, 'graph'));
check('R4 执行影子对账摘要入档', record.actionPlanReconciliation
    && record.actionPlanReconciliation.status === 'needs_recovery'
    && record.actionPlanReconciliation.failedStepIds[0] === 'apply-change'
    && record.actionPlanReconciliation.resumeStepIds[0] === 'apply-change');
check('R4 执行影子对账不复制完整 ledger', !Object.prototype.hasOwnProperty.call(record.actionPlanReconciliation, 'steps')
    && !Object.prototype.hasOwnProperty.call(record.actionPlanReconciliation, 'observations')
    && !Object.prototype.hasOwnProperty.call(record.actionPlanReconciliation, 'attributions'));
const pathStrategyRecord = rr.buildAgentRunRecord({
    now: NOW,
    goal: 'strategy-path-defense',
    result: {
        success: false,
        iterations: 1,
        toolCallLog: [],
        executionSummary: {
            runtimeDesignStrategyDigest: {
                ...RUNTIME_DESIGN_STRATEGY_DIGEST,
                stageGoal: '读取 C:\\private\\secret.psd 后设计',
                contextRefs: ['context:user_goal', 'C:\\private\\secret.psd']
            }
        }
    }
});
check('R3 Design Strategy 摘要纵深防御本地路径', JSON.stringify(pathStrategyRecord).includes('[local-path-omitted]')
    && !JSON.stringify(pathStrategyRecord).includes('secret.psd')
    && JSON.stringify(pathStrategyRecord.designStrategy.contextRefs) === JSON.stringify(['context:user_goal']));
const pathActionPlanRecord = rr.buildAgentRunRecord({
    now: NOW,
    goal: 'action-plan-path-defense',
    result: {
        success: false,
        iterations: 1,
        toolCallLog: [],
        executionSummary: {
            runtimeActionPlanDigest: {
                ...RUNTIME_ACTION_PLAN_DIGEST,
                planGoal: '读取 C:\\private\\plan.json 后继续',
                capabilityRefs: ['design.general', 'C:\\private\\plan.json'],
                contextRefs: ['context:user_goal', 'C:\\private\\plan.json']
            }
        }
    }
});
check('R4 Action Plan 摘要纵深防御本地路径', JSON.stringify(pathActionPlanRecord).includes('[local-path-omitted]')
    && !JSON.stringify(pathActionPlanRecord).includes('plan.json')
    && JSON.stringify(pathActionPlanRecord.actionPlan.capabilityRefs) === JSON.stringify(['design.general'])
    && JSON.stringify(pathActionPlanRecord.actionPlan.contextRefs) === JSON.stringify(['context:user_goal']));
check('warnings 入档', record.warnings.length === 1 && record.warnings[0].includes('复核'));

// ── 2. checkpoint 确定性旗标 ──
check('checkpoint: documentCreated/layoutRendered 由成功调用推导',
    record.checkpoint.documentCreated === true && record.checkpoint.layoutRendered === true);
check('checkpoint: successfulToolCount=3, lastToolName=placeImage',
    record.checkpoint.successfulToolCount === 3 && record.checkpoint.lastToolName === 'placeImage');
const noDocRecord = rr.buildAgentRunRecord({
    now: NOW, goal: 'x',
    result: { success: false, iterations: 1, toolCallLog: [{ name: 'createDocument', arguments: {}, result: { success: false, error: '失败' } }] }
});
check('checkpoint: 失败的 createDocument 不置旗标（不推测）', noDocRecord.checkpoint.documentCreated === false);
const openingObservationRecord = rr.buildAgentRunRecord({
    now: NOW, goal: '查看当前画布',
    result: {
        success: true,
        iterations: 1,
        toolCallLog: [{
            name: 'getAnnotatedSnapshot',
            arguments: {},
            result: { success: true, elements: [{ id: 7, name: '文案' }] },
            origin: 'harness_opening_observation'
        }]
    }
});
check('开工观察来源入档且不伪增模型成功工具计数',
    openingObservationRecord.toolCalls[0].origin === 'harness_opening_observation'
    && openingObservationRecord.checkpoint.successfulToolCount === 0,
    JSON.stringify(openingObservationRecord));

const qualityVerificationRecord = rr.buildAgentRunRecord({
    now: NOW,
    goal: '设计后验证画面版本',
    result: {
        success: true,
        iterations: 1,
        toolCallLog: [
            { name: 'renderLayout', arguments: {}, result: { success: true }, origin: 'model_tool_call' },
            {
                name: 'getDocumentInfo', arguments: {},
                result: { success: true, historyStateRef: { documentId: 41, historyStateId: 1001 } },
                origin: 'harness_quality_verification',
                qualityVerificationPhase: 'pre_judge'
            },
            {
                name: 'getDocumentInfo', arguments: {},
                result: { success: true, historyStateRef: { documentId: 41, historyStateId: 1001 } },
                origin: 'harness_quality_verification',
                qualityVerificationPhase: 'post_judge'
            }
        ]
    }
});
check('质量版本复核来源入档但不伪增成功工具数或覆盖最后业务 Tool',
    qualityVerificationRecord.toolCalls[1].origin === 'harness_quality_verification'
    && qualityVerificationRecord.toolCalls[1].qualityVerificationPhase === 'pre_judge'
    && qualityVerificationRecord.toolCalls[2].qualityVerificationPhase === 'post_judge'
    && qualityVerificationRecord.checkpoint.successfulToolCount === 1
    && qualityVerificationRecord.checkpoint.lastToolName === 'renderLayout',
    JSON.stringify(qualityVerificationRecord));

// ── 2.5 checkpoint 实体锚（真机病例 2026-07-07：续跑轮把上一轮置入的图当原有内容又置入新图） ──
const placedRecord = rr.buildAgentRunRecord({
    now: NOW, goal: '置入并剪切',
    result: {
        success: false, iterations: 24, stopReason: 'max_iterations',
        toolCallLog: [
            { name: 'placeImage', arguments: { filePath: 'a.jpg' }, result: { success: true, layerId: 4294, layerName: '产品信息图' } },
            { name: 'placeImage', arguments: { filePath: 'b.jpg' }, result: { success: false, error: '失败' } },
            { name: 'placeImage', arguments: { filePath: 'c.jpg' }, result: { success: true, message: '成功但没有 layerId 字段' } }
        ]
    }
});
check('checkpoint: 成功 placeImage 的实体锚入档（id+名）', Array.isArray(placedRecord.checkpoint.placedLayers)
    && placedRecord.checkpoint.placedLayers.length === 1
    && placedRecord.checkpoint.placedLayers[0].layerId === 4294
    && placedRecord.checkpoint.placedLayers[0].name === '产品信息图', JSON.stringify(placedRecord.checkpoint.placedLayers));
check('checkpoint: 失败或提不到 layerId 的置入不记（不臆造）', placedRecord.checkpoint.placedLayers.every((l) => l.layerId === 4294));

// ── 3. 风险分类单一口径 ──
check('写类工具 riskClass=write（createDocument/renderLayout/placeImage）',
    record.toolCalls[1].riskClass === 'write' && record.toolCalls[2].riskClass === 'write' && record.toolCalls[3].riskClass === 'write');
check('读类工具 riskClass=read（getDocumentInfo）', record.toolCalls[0].riskClass === 'read');

// ── 4. 截断语义 ──
const manyCalls = Array.from({ length: 450 }, (_, i) => ({ name: `tool${i}`, arguments: {}, result: { success: true } }));
const bigRecord = rr.buildAgentRunRecord({ now: NOW, goal: 'big', result: { success: true, iterations: 1, toolCallLog: manyCalls } });
check('>400 调用 → 保 400 条 + dropped=50', bigRecord.toolCalls.length === 400 && bigRecord.droppedToolCalls === 50);
check('截断保头保尾（首条 tool0，末条 tool449）',
    bigRecord.toolCalls[0].name === 'tool0' && bigRecord.toolCalls[399].name === 'tool449');
check('checkpoint 用全量推导（successfulToolCount=450 不受截断影响）', bigRecord.checkpoint.successfulToolCount === 450);

// ── 5. parentRunId 链 + 确定性 runId ──
const child = rr.buildAgentRunRecord({ now: NOW, goal: '帮我做SKU', parentRunId: record.runId, result: { success: true, iterations: 1, toolCallLog: [] } });
check('parentRunId 链接', child.parentRunId === record.runId);
const again = rr.buildAgentRunRecord({ now: NOW, goal: '帮我做SKU', projectPath: 'E:\\DesignEchoDemo\\C-1213', controlPlane: { requestKind: 'autonomous_execution', route: 'autonomous_agent', skillId: 'sku-batch' }, result: record ? { success: true, iterations: 3, stopReason: 'final_response', toolCallLog: [
    { name: 'getDocumentInfo', arguments: { includeBounds: true }, result: { success: true, message: '文档 800x800' } },
    { name: 'createDocument', arguments: { width: 800, height: 800 }, result: { success: true } },
    { name: 'renderLayout', arguments: {}, result: { success: true } },
    { name: 'placeImage', arguments: {}, result: { success: false, error: 'x' } }
], executionSummary: null } : {} });
check('相同输入 → 确定性 runId（可回放/防重复）', again.runId === record.runId, `${again.runId} vs ${record.runId}`);

// ── 6. 持久化校验 ──
check('合法记录通过校验', rr.validateAgentRunRecordForPersist(record).ok === true);
check('拒绝：版本不符', rr.validateAgentRunRecordForPersist({ ...record, version: 'v9' }).ok === false);
check('拒绝：缺边界声明', rr.validateAgentRunRecordForPersist({ ...record, boundaries: { argsDigestedOnly: false } }).ok === false);
const unknownTopLevelVerdict = rr.validateAgentRunRecordForPersist({
    ...record,
    artifactPayload: { secret: '不得进入运行档案' },
    artifactPath: 'C:\\private\\runtime-plan.json',
    artifactRepositoryReadProjection: { refs: [] }
});
check('拒绝：运行档案顶层未知字段不能夹带 Artifact 正文/路径/投影',
    unknownTopLevelVerdict.ok === false
    && /未知顶层字段/.test(unknownTopLevelVerdict.reason || ''),
    unknownTopLevelVerdict.reason);
const unknownBoundaryVerdict = rr.validateAgentRunRecordForPersist({
    ...record,
    boundaries: {
        ...record.boundaries,
        artifactPayloadExcludedButUnverified: true
    }
});
check('拒绝：运行档案 boundaries 采用 exact-key allowlist',
    unknownBoundaryVerdict.ok === false
    && /boundaries 含未知字段/.test(unknownBoundaryVerdict.reason || ''),
    unknownBoundaryVerdict.reason);
check('拒绝：Stage State 摘要缺 digest 边界', rr.validateAgentRunRecordForPersist({
    ...record,
    boundaries: { ...record.boundaries, stageStateDigestOnly: undefined }
}).ok === false);
check('拒绝：运行档案复制完整 Stage ledger', rr.validateAgentRunRecordForPersist({
    ...record,
    stageState: { ...record.stageState, transitions: RUNTIME_STAGE_STATE.transitions }
}).ok === false);
check('拒绝：Stage Trace 摘要缺 digest 边界', rr.validateAgentRunRecordForPersist({
    ...record,
    boundaries: { ...record.boundaries, stageTraceDigestOnly: undefined }
}).ok === false);
check('拒绝：运行档案复制完整 Stage Trace events', rr.validateAgentRunRecordForPersist({
    ...record,
    stageTrace: { ...record.stageTrace, events: [{ stage: 'R1' }] }
}).ok === false);
check('拒绝：Design Brief 摘要缺 digest 边界', rr.validateAgentRunRecordForPersist({
    ...record,
    boundaries: { ...record.boundaries, designBriefDigestOnly: undefined }
}).ok === false);
check('拒绝：运行档案复制完整 Design Brief inputCoverage', rr.validateAgentRunRecordForPersist({
    ...record,
    designBrief: { ...record.designBrief, inputCoverage: [{ inputKey: 'goal' }] }
}).ok === false);
check('拒绝：Design Strategy 摘要缺 digest 边界', rr.validateAgentRunRecordForPersist({
    ...record,
    boundaries: { ...record.boundaries, designStrategyDigestOnly: undefined }
}).ok === false);
check('拒绝：运行档案复制完整 Design Strategy declaration', rr.validateAgentRunRecordForPersist({
    ...record,
    designStrategy: { ...record.designStrategy, payload: { stageGoal: 'x' } }
}).ok === false);
check('拒绝：Action Plan 摘要缺 digest 边界', rr.validateAgentRunRecordForPersist({
    ...record,
    boundaries: { ...record.boundaries, actionPlanDigestOnly: undefined }
}).ok === false);
check('拒绝：运行档案复制完整 Action Plan steps', rr.validateAgentRunRecordForPersist({
    ...record,
    actionPlan: { ...record.actionPlan, steps: [{ stepId: 'x' }] }
}).ok === false);
check('拒绝：执行影子对账摘要缺 digest 边界', rr.validateAgentRunRecordForPersist({
    ...record,
    boundaries: { ...record.boundaries, actionPlanReconciliationDigestOnly: undefined }
}).ok === false);
check('拒绝：运行档案复制完整执行影子 ledger', rr.validateAgentRunRecordForPersist({
    ...record,
    actionPlanReconciliation: {
        ...record.actionPlanReconciliation,
        observations: [{ sequence: 1 }]
    }
}).ok === false);

const runtimeBoundBase = {
    ...record,
    runtimeSession: {
        version: 'runtime-session-digest/v0',
        sessionId: 'session-run-record-artifacts',
        runId: record.runId,
        generation: 2,
        accounting: {
            version: 'runtime-accounting-digest/v0',
            costEstimate: { status: 'not_configured' },
            boundaries: {
                reportedUsageOnly: true,
                missingUsageNotEstimated: true,
                enforcesBudget: false
            }
        }
    },
    boundaries: {
        ...record.boundaries,
        runtimeSessionDigestOnly: true
    }
};
const repositoryProjection = {
    version: 'artifact-repository-read-projection/v0',
    source: 'artifact_repository',
    scope: {
        sessionId: 'session-run-record-artifacts',
        runId: record.runId,
        generation: 2
    },
    refs: [{
        artifactId: 'preview-scene-v1',
        artifactType: 'preview_scene',
        contentHash: `sha256-jcs-v1:${'a'.repeat(64)}`
    }],
    droppedRefCount: 3,
    issues: [],
    boundaries: {
        repositoryOwned: true,
        artifactRefsOnly: true,
        payloadsExcluded: true,
        pathsExcluded: true,
        grantsPermission: false
    }
};
const baseBeforeArtifactAttach = JSON.stringify(runtimeBoundBase);
const attachedRecord = rr.attachRepositoryArtifactRefsToRunRecord(runtimeBoundBase, repositoryProjection);
check('Repository projection 按完整 Runtime identity 附加 refs',
    attachedRecord.artifactRefs.length === 1
    && attachedRecord.droppedArtifactRefCount === 3
    && attachedRecord.boundaries.artifactRefsFromRepositoryOnly === true
    && rr.validateAgentRunRecordForPersist(attachedRecord).ok === true,
    JSON.stringify(attachedRecord.artifactRefs));
check('ArtifactRef 精确三字段且不含 payload/path',
    JSON.stringify(Object.keys(attachedRecord.artifactRefs[0]).sort())
        === JSON.stringify(['artifactId', 'artifactType', 'contentHash'])
    && !JSON.stringify(attachedRecord.artifactRefs).includes('payload')
    && !JSON.stringify(attachedRecord.artifactRefs).includes('path'));
check('Repository attach 为纯函数，不修改基础 Run Record', JSON.stringify(runtimeBoundBase) === baseBeforeArtifactAttach);
check('读取时 Repository 投影严格比对通过',
    rr.matchesAgentRunRecordRepositoryProjection(attachedRecord, repositoryProjection) === true);
check('读取时 Repository ref/hash 失配 fail closed',
    rr.matchesAgentRunRecordRepositoryProjection(attachedRecord, {
        ...repositoryProjection,
        refs: [{
            ...repositoryProjection.refs[0],
            contentHash: `sha256-jcs-v1:${'d'.repeat(64)}`
        }]
    }) === false);
check('读取时 Repository droppedRefCount 失配 fail closed',
    rr.matchesAgentRunRecordRepositoryProjection(attachedRecord, {
        ...repositoryProjection,
        droppedRefCount: repositoryProjection.droppedRefCount + 1
    }) === false);

let identityMismatchRejected = false;
try {
    rr.attachRepositoryArtifactRefsToRunRecord(runtimeBoundBase, {
        ...repositoryProjection,
        scope: { ...repositoryProjection.scope, generation: 3 }
    });
} catch (error) {
    identityMismatchRejected = String(error && error.message || error).includes('identity_mismatch');
}
check('拒绝：Repository projection generation 与 Run Record 不一致', identityMismatchRejected);

let poisonedProjectionRejected = false;
try {
    rr.attachRepositoryArtifactRefsToRunRecord(runtimeBoundBase, {
        ...repositoryProjection,
        refs: [{ ...repositoryProjection.refs[0], payload: 'forbidden' }]
    });
} catch (error) {
    poisonedProjectionRejected = String(error && error.message || error).includes('projection_invalid');
}
check('拒绝：Repository projection ref 携带 payload', poisonedProjectionRejected);
check('拒绝：持久化 ref 携带本地 path', rr.validateAgentRunRecordForPersist({
    ...attachedRecord,
    artifactRefs: [{ ...attachedRecord.artifactRefs[0], path: 'C:\\private\\preview.psd' }]
}).ok === false);
check('拒绝：Artifact refs 缺 Repository-only 边界', rr.validateAgentRunRecordForPersist({
    ...attachedRecord,
    boundaries: { ...attachedRecord.boundaries, artifactRefsFromRepositoryOnly: undefined }
}).ok === false);
check('拒绝：Artifact refs 没有 Runtime Session identity', rr.validateAgentRunRecordForPersist({
    ...attachedRecord,
    runtimeSession: undefined,
    boundaries: { ...attachedRecord.boundaries, runtimeSessionDigestOnly: undefined }
}).ok === false);

const poisoned = JSON.parse(JSON.stringify(record));
poisoned.goal = 'data:image/png;base64,AAAA';
const poisonVerdict = rr.validateAgentRunRecordForPersist(poisoned);
check('拒绝：含图像 data URL', poisonVerdict.ok === false && /data URL|图像/.test(poisonVerdict.reason || ''), poisonVerdict.reason);

// ── 7. 接线钉桩 ──
const executorSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts'), 'utf8');
check('执行器：reflexion 轮间留档（重跑前 persist 上一轮）',
    /lastRunRecordId = persistAgentRunRecordSafely\(/.test(executorSrc) && executorSrc.indexOf('lastRunRecordId = persistAgentRunRecordSafely') < executorSrc.indexOf('createAutonomousAgent().run(reentryTask'));
check('执行器：取消出口留档', /result\.cancelled[\s\S]{0,400}persistAgentRunRecordSafely/.test(executorSrc));
check('执行器：最终结果带 runRecordRef', executorSrc.includes('runRecordRef: {')
    && executorSrc.includes('runId: finalRunRecordId'));
check('执行器：留档绝不阻塞结果（fire-and-forget + catch）', /Promise\.resolve\(bridge\(record, input\.projectPath\)\)[\s\S]{0,300}\.catch\(/.test(executorSrc));
const preloadSrc = fs.readFileSync(path.join(ROOT, 'src/main/preload.ts'), 'utf8');
check('preload：writeAgentRunRecord/listAgentRunRecords 桥', preloadSrc.includes("invoke('agentRun:writeRecord'") && preloadSrc.includes("invoke('agentRun:listRecords'"));
const handlerSrc = fs.readFileSync(path.join(ROOT, 'src/main/ipc-handlers/run-record-handlers.ts'), 'utf8');
check('handler：原子写（tmp+rename）+ 修剪', handlerSrc.includes('renameSync(tmp, file)') && handlerSrc.includes('pruneOldRunFiles'));
check('handler：拒绝 Renderer 自报 Artifact authority', handlerSrc.includes('hasRendererArtifactAuthority(record)')
    && handlerSrc.includes("hasOwn(record, 'artifactRefs')")
    && handlerSrc.includes("hasOwn(record, 'droppedArtifactRefCount')")
    && handlerSrc.includes("hasOwn(boundaries, 'artifactRefsFromRepositoryOnly')"));
check('handler：先绑定 projectPath，再按 Runtime identity 读取 Repository projection',
    handlerSrc.includes('sameProjectPath(canonicalTargetProject, canonicalRecordProject)')
    && handlerSrc.includes('artifactRepositoryService.readProjection(canonicalTargetProject')
    && handlerSrc.includes('sessionId: baseRecord.runtimeSession.sessionId')
    && handlerSrc.includes('runId: baseRecord.runtimeSession.runId')
    && handlerSrc.includes('generation: baseRecord.runtimeSession.generation'));
check('handler：Repository 失败保留无 refs 基础记录，附加后二次校验',
    handlerSrc.includes('let recordToPersist = baseRecord')
    && handlerSrc.includes('attachRepositoryArtifactRefsToRunRecord(baseRecord, projection)')
    && handlerSrc.includes('const finalValidation = validateAgentRunRecordForPersist(recordToPersist)'));
check('handler：list 绑定规范项目路径并重新核对 Repository 投影',
    handlerSrc.includes('canonicalExistingDirectory(record.projectPath)')
    && handlerSrc.includes('matchesAgentRunRecordRepositoryProjection(record, projection)')
    && handlerSrc.includes("hasOwn(record, 'artifactRefs')"));
const indexSrc = fs.readFileSync(path.join(ROOT, 'src/main/ipc-handlers/index.ts'), 'utf8');
check('index：registerRunRecordHandlers 已注册', indexSrc.includes('registerRunRecordHandlers()'));

async function runHandlerReadBoundaryChecks() {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-run-record-boundary-'));
    const projectPath = path.join(temporaryRoot, 'project');
    const otherProjectPath = path.join(temporaryRoot, 'other-project');
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(otherProjectPath, { recursive: true });

    const handlers = new Map();
    const fakeIpcMain = {
        handle(channel, handler) {
            handlers.set(channel, handler);
        }
    };
    const originalLoad = Module._load;
    Module._load = function loadWithFakeElectron(request, parent, isMain) {
        if (request === 'electron') return { ipcMain: fakeIpcMain };
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const handlerModulePath = path.join(ROOT, 'src', 'main', 'ipc-handlers', 'run-record-handlers.ts');
        delete require.cache[require.resolve(handlerModulePath)];
        const { registerRunRecordHandlers } = require(handlerModulePath);
        registerRunRecordHandlers();
        const writeRecord = handlers.get('agentRun:writeRecord');
        const listRecords = handlers.get('agentRun:listRecords');
        check('handler smoke：write/list handlers 可注册', Boolean(writeRecord && listRecords));
        if (!writeRecord || !listRecords) return;

        const runRecordRuntimeBinding = {
            sessionId: runtimeBoundBase.runtimeSession.sessionId,
            runId: runtimeBoundBase.runtimeSession.runId,
            generation: runtimeBoundBase.runtimeSession.generation
        };
        const runRecordArtifactType = 'runtime_design_brief';
        await artifactRepositoryService.publishRuntimeArtifact(projectPath, {
            artifactId: buildRuntimeArtifactId(runRecordArtifactType, runRecordRuntimeBinding),
            artifactType: runRecordArtifactType,
            projectId: 'run-record-boundary-project',
            skillId: 'design.generic.v1',
            sourceRevision: runRecordRuntimeBinding.generation,
            sourceRefs: [],
            capabilityStatus: 'manual_verification_pending',
            runtimeBinding: runRecordRuntimeBinding,
            payload: {
                kind: 'json',
                value: {
                    version: 'runtime-design-brief-declaration/v0',
                    source: 'model_tool_call',
                    readiness: 'ready',
                    payload: {
                        workMode: 'analyze_only',
                        taskGoal: '验证 Run Record 仅持久化 Repository refs',
                        deliverables: ['run record refs'],
                        outputRequirements: [],
                        constraints: [],
                        inputCoverage: [],
                        contextRefs: ['context:user_goal']
                    },
                    boundaries: {
                        modelAuthored: true,
                        harnessValidatedOnly: true,
                        manifestInputsAreSourceOfTruth: true,
                        categoryNeutral: true,
                        executesTools: false,
                        grantsPermission: false,
                        autoActivatesCapabilities: false,
                        countsAsTaskProgress: false,
                        countsAsQualityPass: false
                    }
                }
            }
        });

        const writeResult = await writeRecord(
            {},
            { ...runtimeBoundBase, projectPath },
            path.join(projectPath, '.')
        );
        check('handler smoke：写入时附加 Repository refs', writeResult.success === true, writeResult.error);
        if (!writeResult.success) return;

        const goodList = await listRecords({}, path.join(projectPath, '.'), 10);
        check('handler smoke：规范项目路径下返回 Repository 已复核档案',
            goodList.success === true
            && goodList.records.length === 1
            && goodList.records[0].artifactRefs.length === 1,
            goodList.error);

        const persisted = JSON.parse(fs.readFileSync(writeResult.filePath, 'utf8'));
        const refMismatch = {
            ...persisted,
            artifactRefs: persisted.artifactRefs.map((ref, index) => index === 0
                ? { ...ref, contentHash: `sha256-jcs-v1:${'e'.repeat(64)}` }
                : ref)
        };
        fs.writeFileSync(writeResult.filePath, JSON.stringify(refMismatch, null, 2), 'utf8');
        const refMismatchList = await listRecords({}, projectPath, 10);
        check('handler smoke：磁盘 ref/hash 与 Repository 失配时不返回',
            refMismatchList.success === true && refMismatchList.records.length === 0,
            refMismatchList.error);

        fs.writeFileSync(writeResult.filePath, JSON.stringify({
            ...persisted,
            projectPath: otherProjectPath
        }, null, 2), 'utf8');
        const projectMismatchList = await listRecords({}, projectPath, 10);
        check('handler smoke：档案 projectPath 与查询项目失配时不返回',
            projectMismatchList.success === true && projectMismatchList.records.length === 0,
            projectMismatchList.error);

        fs.writeFileSync(writeResult.filePath, JSON.stringify({
            ...persisted,
            artifactPayload: { secret: 'disk-injection' }
        }, null, 2), 'utf8');
        const unknownKeyList = await listRecords({}, projectPath, 10);
        check('handler smoke：磁盘未知顶层字段校验失败时不返回',
            unknownKeyList.success === true && unknownKeyList.records.length === 0,
            unknownKeyList.error);

        const missingProjectList = await listRecords({}, path.join(temporaryRoot, 'missing'), 10);
        check('handler smoke：查询项目路径不存在时明确失败',
            missingProjectList.success === false && missingProjectList.records.length === 0,
            missingProjectList.error);
    } catch (error) {
        check('handler smoke：读取边界执行无异常', false, String(error && error.stack || error));
    } finally {
        Module._load = originalLoad;
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

async function main() {
    await runHandlerReadBoundaryChecks();
    if (failures > 0) {
        console.error(`[smoke-agent-run-record] FAILED (${failures})`);
        process.exit(1);
    }
    console.log('[smoke-agent-run-record] passed');
}

void main();
