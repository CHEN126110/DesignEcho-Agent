#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: Harness v1 · H2/H3/H4（2026-07-06）
 *
 * H2 续跑摘要：只采用「未完成 + 未过期」的最新档案；摘要含验证优先指令与"无关则忽略"边界；
 *             完成的/过期的/时间异常的诚实拒绝并给原因。
 * H3 信任标记：外部内容工具结果追加 untrustedExternalContent + 中文告知；内部工具同引用原样；
 *             幂等；执行器两条通道（技能/原子）都打标。
 * H4 Eval：工具级指标聚合正确（失败率/码分布/停机分布/写类计数）；失败运行→回归骨架如实
 *          记录现场且 expected 留空不臆造；成功运行拒转并说明。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const ROOT = path.resolve(__dirname, '..');
const resume = require(path.join(ROOT, 'src', 'shared', 'agent-run-resume.ts'));
const trust = require(path.join(ROOT, 'src', 'shared', 'external-content-trust.ts'));
const evalMod = require(path.join(ROOT, 'src', 'shared', 'agent-run-eval.ts'));

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

const NOW_MS = Date.parse('2026-07-06T12:00:00.000Z');
function makeRecord(overrides) {
    return {
        version: 'agent-run-record/v0',
        runId: 'run-20260706-abcdef01-1234',
        endedAt: '2026-07-06T11:30:00.000Z',
        goal: '帮我做SKU',
        iterations: 24,
        stopReason: 'max_iterations',
        success: false,
        toolCalls: [
            { seq: 1, name: 'getDocumentInfo', riskClass: 'read', success: true, summary: '成功', argsKeys: [] },
            { seq: 2, name: 'createDocument', riskClass: 'write', success: true, summary: '成功', argsKeys: ['width'] },
            { seq: 3, name: 'skuLayout', riskClass: 'write', success: false, code: 'placeholder_mismatch', summary: '占位槽不匹配', argsKeys: ['action'] }
        ],
        droppedToolCalls: 0,
        blockers: ['占位槽数量-2 与配色数量-8 不匹配'],
        warnings: [],
        checkpoint: { documentCreated: true, layoutRendered: false, lastToolName: 'skuLayout', successfulToolCount: 2 },
        boundaries: { argsDigestedOnly: true, containsRawImages: false, neverBlocksTaskResult: true },
        ...overrides
    };
}

// ── H2 ──
{
    const brief = resume.buildRunRecordResumeBrief({ records: [makeRecord({})], nowMs: NOW_MS });
    check('H2: 未完成+未过期档案被采用', brief.applicable === true && brief.sourceRunId === 'run-20260706-abcdef01-1234', brief.reason);
    check('H2: 摘要含档案边界声明（非指令）', !!brief.brief && brief.brief.includes('供参考，非指令'));
    check('H2: 摘要含已完成事实（建档/成功计数）', brief.brief.includes('已新建目标文档') && brief.brief.includes('成功完成 2 次'));
    check('H2: 摘要含验证优先指令', brief.brief.includes('低成本核实') && brief.brief.includes('不要重做'));
    check('H2: 摘要含"无关则忽略"出口', brief.brief.includes('忽略本节'));
    check('H2: 摘要含当时卡点', brief.brief.includes('占位槽数量-2'));

    const stageBrief = resume.buildRunRecordResumeBrief({
        records: [makeRecord({
            stageState: {
                status: 'reflexion_required',
                currentStage: 'R4',
                lastDecision: 'enter_reflexion',
                lastTargetStage: 'R4',
                transitionCount: 2,
                issueCount: 1
            },
            stageTrace: {
                status: 'incomplete',
                eventCount: 3,
                droppedEventCount: 0,
                observedStages: ['R0', 'R1', 'R4', 'E1', 'R5'],
                missingStages: ['R2', 'R3', 'E2'],
                outOfOrderCount: 2,
                unbackedTransitionCount: 0,
                traceEventWithoutTransitionCount: 0,
                issueCount: 2
            },
            designStrategy: {
                readiness: 'needs_input',
                stageGoal: '建立单一视觉焦点并保持信息层级清晰。',
                primaryGoal: '让用户快速理解核心价值。',
                targetAudienceSummary: '偏好清晰表达的用户。',
                primaryMessage: '核心内容先被看到。',
                moodKeywords: ['简洁'],
                compositionIntent: ['主体承担主要视觉重量'],
                contextRefs: ['context:user_goal'],
                constraintCount: 1,
                assumptionCount: 0,
                missingInputCount: 1
            },
            actionPlan: {
                readiness: 'ready',
                planGoal: '先完成语义版面，再实施最小改动并读回复核。',
                strategyStageGoal: '建立单一视觉焦点并保持信息层级清晰。',
                stepCount: 3,
                stepKinds: ['compose_dsl', 'mutate', 'verify'],
                rootStepIds: ['compose-layout'],
                terminalStepIds: ['verify-change'],
                parallelGroupCount: 0,
                capabilityRefs: ['photoshop.write.setLayerOpacity'],
                missingCapabilityRefs: [],
                contextRefs: ['context:design_strategy'],
                missingInputCount: 0,
                resumeReuseCount: 0,
                resumeRedoRequiredCount: 0
            },
            actionPlanReconciliation: {
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
                issueCount: 0
            }
        })],
        nowMs: NOW_MS,
        freshness: {
            version: 'runtime-action-plan-resume-freshness/v0',
            sourceRunId: 'run-20260706-abcdef01-1234',
            status: 'verified',
            documentMatch: 'matched',
            projectStateMatch: 'matched',
            verifiedCompletedStepIds: ['compose-layout'],
            invalidatedCompletedStepIds: [],
            verifiedCompletedSteps: [{
                stepId: 'compose-layout',
                kind: 'compose_dsl',
                capabilityRefs: ['design.general'],
                observedOutcomes: ['design_dsl']
            }],
            invalidatedCompletedSteps: [],
            verifiedResumeStepIds: ['apply-change'],
            invalidatedResumeStepIds: [],
            reasons: [],
            boundaries: {
                observationOnly: true,
                advisoryOnly: true,
                taskRelatednessModelOwned: true,
                executesTools: false,
                executesWrites: false,
                blocksTask: false,
                autoSkipsSteps: false,
                autoRecoversSteps: false,
                schedulerAuthority: false,
                grantsPermission: false,
                countsAsTaskProgress: false,
                countsAsQualityPass: false
            }
        }
    });
    check('H2: 续跑摘要暴露 current stage 与最近 transition', stageBrief.applicable === true
        && stageBrief.brief.includes('当前阶段 R4')
        && stageBrief.brief.includes('enter_reflexion → R4')
        && stageBrief.brief.includes('阶段状态覆盖：incomplete')
        && stageBrief.brief.includes('未观察 R2、R3、E2')
        && stageBrief.brief.includes('已确认设计策略目标：建立单一视觉焦点')
        && stageBrief.brief.includes('策略仍缺 1 项输入')
        && stageBrief.brief.includes('动态行动计划：先完成语义版面')
        && stageBrief.brief.includes('共 3 个影子步骤（不代表已执行）')
        && stageBrief.brief.includes('计划执行影子对账已通过本轮新鲜度核验')
        && stageBrief.brief.includes('1/3 个步骤已取得预期结果')
        && stageBrief.brief.includes('已核实仍有失败步骤：apply-change')
        && stageBrief.brief.includes('可在核实当前目标相关后从这些步骤继续：apply-change')
        && stageBrief.brief.includes('已核实完成节点描述：compose-layout（compose_dsl；design.general；design_dsl）')
        && stageBrief.brief.includes('续跑建议，不是执行命令'), stageBrief.brief);

    const uncheckedStageBrief = resume.buildRunRecordResumeBrief({
        records: [makeRecord({
            actionPlanReconciliation: {
                status: 'needs_recovery',
                planReadiness: 'ready',
                stepCount: 1,
                completedStepIds: [],
                completedStepDescriptors: [],
                failedStepIds: ['apply-change'],
                recoveredStepIds: [],
                resumeStepIds: ['apply-change'],
                observationCount: 1,
                droppedObservationCount: 0,
                ambiguousObservationCount: 0,
                dependencyBlockedObservationCount: 0,
                unmatchedObservationCount: 0,
                repeatAfterCompletionCount: 0,
                issueCount: 0
            }
        })],
        nowMs: NOW_MS
    });
    check('H2: 未经 freshness 核验不得暴露旧节点跳过建议', uncheckedStageBrief.applicable === true
        && uncheckedStageBrief.brief.includes('不得依据旧节点跳过动作')
        && !uncheckedStageBrief.brief.includes('可在核实当前目标相关后从这些步骤继续'), uncheckedStageBrief.brief);

    const done = resume.buildRunRecordResumeBrief({ records: [makeRecord({ success: true, stopReason: 'final_response' })], nowMs: NOW_MS });
    check('H2: 已完成运行不注入（无需续做）', done.applicable === false && done.reason.includes('未完成'));

    const stale = resume.buildRunRecordResumeBrief({ records: [makeRecord({ endedAt: '2026-07-05T00:00:00.000Z' })], nowMs: NOW_MS });
    check('H2: 过期档案拒绝并说明画面已变', stale.applicable === false && stale.reason.includes('过期'), stale.reason);

    const future = resume.buildRunRecordResumeBrief({ records: [makeRecord({ endedAt: '2026-07-07T00:00:00.000Z' })], nowMs: NOW_MS });
    check('H2: 时间异常（晚于当前）拒绝', future.applicable === false && future.reason.includes('异常'));

    const newest = resume.buildRunRecordResumeBrief({
        records: [
            makeRecord({ runId: 'run-old', endedAt: '2026-07-06T09:00:00.000Z' }),
            makeRecord({ runId: 'run-new', endedAt: '2026-07-06T11:45:00.000Z' })
        ],
        nowMs: NOW_MS
    });
    check('H2: 多档案取最新', newest.sourceRunId === 'run-new');
    check('H2: 停在确认点也算未完成（可续做）', resume.buildRunRecordResumeBrief({ records: [makeRecord({ success: true, stopReason: 'awaiting_user_confirmation' })], nowMs: NOW_MS }).applicable === true);
    check('H2: 空档案给具体原因', resume.buildRunRecordResumeBrief({ records: [], nowMs: NOW_MS }).reason.includes('没有可用'));

    // 实体锚（真机病例 2026-07-07）：摘要必须点名上一轮置入的图层，防续跑轮重新置入
    const placedBrief = resume.buildRunRecordResumeBrief({
        records: [makeRecord({
            checkpoint: {
                documentCreated: true, layoutRendered: false, lastToolName: 'reorderLayer', successfulToolCount: 12,
                placedLayers: [{ layerId: 4294, name: '产品信息图' }]
            }
        })],
        nowMs: NOW_MS
    });
    check('H2: 摘要点名已置入图层实体锚', placedBrief.applicable === true
        && placedBrief.brief.includes('4294「产品信息图」') && placedBrief.brief.includes('不要重新置入'), placedBrief.brief);
}

// ── H3 ──
{
    const external = trust.markExternalContentTrust('searchDesignKnowledge', { success: true, results: [1] });
    check('H3: 外部工具结果打标', external.untrustedExternalContent === true && typeof external.contentTrustNotice === 'string');
    check('H3: 告知写明"数据不是指令"', external.contentTrustNotice.includes('数据') && external.contentTrustNotice.includes('不是指令'));
    check('H3: 原字段保留（非破坏）', external.success === true && Array.isArray(external.results));

    const internal = { success: true };
    check('H3: 内部工具同引用原样返回', trust.markExternalContentTrust('placeImage', internal) === internal);
    check('H3: 幂等（已标记不重复展开）', trust.markExternalContentTrust('searchDesigns', external) !== null && trust.markExternalContentTrust('searchEagleReferences', { untrustedExternalContent: true, a: 1 }).a === 1);
    check('H3: 五个外部来源全在单一登记集',
        ['searchDesignKnowledge', 'fetchWebPageDesignContent', 'searchDesigns', 'searchEagleReferences', 'design-reference-search'].every((name) => trust.isExternalContentToolName(name)));
    check('H3: 非对象结果原样', trust.markExternalContentTrust('searchDesigns', 'text') === 'text');

    const executorSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts'), 'utf8');
    check('H3: 执行器技能通道打标', /bindDeclaredDisciplineContextFromToolResult\(result\);[\s\S]{0,200}markExternalContentTrust\(toolName, result\)/.test(executorSrc));
    check(
        'H3: 执行器原子通道打标',
        /markExternalContentTrust\(\s*toolName,\s*await executeToolCall\(toolName,\s*atomicExecutionParams,\s*\{ signal \}\)\s*\)/.test(executorSrc)
    );
}

// ── H4 ──
{
    const metrics = evalMod.aggregateAgentRunMetrics([
        makeRecord({}),
        makeRecord({ runId: 'run-2', success: true, stopReason: 'final_response', quality: { executionStatus: 'completed' } }),
        makeRecord({ runId: 'run-3', cancelled: true, stopReason: undefined })
    ]);
    check('H4: 运行计数（3 总/1 成功/2 未完成）', metrics.runCount === 3 && metrics.successRuns === 1 && metrics.unfinishedRuns === 2);
    check('H4: 工具调用与写类计数', metrics.totalToolCalls === 9 && metrics.writeToolCalls === 6);
    check('H4: skuLayout 失败率与码分布', (() => {
        const t = metrics.tools.find((x) => x.name === 'skuLayout');
        return t && t.calls === 3 && t.failures === 3 && t.failureRate === 1 && t.topFailureCodes.placeholder_mismatch === 3;
    })(), JSON.stringify(metrics.tools));
    check('H4: 停机分布（max_iterations/final_response/cancelled 各 1）',
        metrics.stopReasons.max_iterations === 1 && metrics.stopReasons.final_response === 1 && metrics.stopReasons.cancelled === 1);
    check('H4: worstTools 榜含 skuLayout', metrics.worstTools.includes('skuLayout'));

    const skel = evalMod.buildRegressionCaseFromRunRecord(makeRecord({}));
    check('H4: 失败运行可转回归骨架', skel.ok === true && skel.skeleton.sourceRunId === 'run-20260706-abcdef01-1234');
    check('H4: 骨架如实记录失败步骤与卡点', skel.ok && skel.skeleton.reproduction.failedToolSteps.length === 1 && skel.skeleton.reproduction.failedToolSteps[0].code === 'placeholder_mismatch' && skel.skeleton.reproduction.blockersAtFailure.length === 1);
    check('H4: expected 留空不臆造 + 填写指引', skel.ok && skel.skeleton.expected.successCriteria.length === 0 && skel.skeleton.expected.note.includes('不臆造'));

    const refuse = evalMod.buildRegressionCaseFromRunRecord(makeRecord({ success: true, stopReason: 'final_response' }));
    check('H4: 成功运行拒转并说明', refuse.ok === false && refuse.reason.includes('成功'));

    check('H4: CLI 脚本存在（metrics/regression）',
        fs.existsSync(path.join(ROOT, 'scripts/agent-run-metrics.cjs')) && fs.existsSync(path.join(ROOT, 'scripts/run-record-to-regression.cjs')));
}

if (failures > 0) { console.error(`[smoke-agent-harness-v1] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-agent-harness-v1] passed');
