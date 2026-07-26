import { selectTools } from '../agent-runtime/tool-schemas';
import type {
    AgentCallbacks,
    CallModelFn,
    ExecuteToolFn
} from '../agent-runtime/types';
import { getDesignTeammateDefinition } from './registry';
import { DesignTeammateTask } from './task';
import { DesignTeamWorkspace } from './workspace';
import {
    syncPipelineRetrospectiveToDesignState,
    syncTeammateOutputToDesignState
} from './state-sync';
import type {
    DesignCriticIssueOwner,
    DesignCriticVerdict,
    DesignTeammateRole,
    DesignTeammateTaskRequest,
    DesignTeammateTaskResult,
    DesignTeamPipelineResult,
    DesignTeamPipelineStageRecord
} from '../../../shared/types/design-team.types';
import {
    evaluateDeterministicAssertions,
    scoreDesignAssertions,
    type DesignScorecard
} from '../../../shared/design-quality-assertion';
import { extractDesignQualityMeasurements } from '../../../shared/design-quality-measurement';
import { extractFreshDesignSurfaceSnapshotFromToolResults } from '../../../shared/design-surface-snapshot-normalizer';
import { buildDesignTeamRuntimeBudget } from '../../../shared/agent-performance-policy';
import {
    buildMultimodalModelDispatchPlan,
    formatModelDispatchTrace,
    type MultimodalModelDispatchPlan
} from '../../../shared/multimodal-model-dispatch';
import { useAppStore } from '../../stores/app.store';

export interface DesignTeamCoordinatorOptions {
    callModel: CallModelFn;
    executeTool: ExecuteToolFn;
    resolveDefaultModelId: () => string;
}

export interface RunTeammateTaskOptions {
    /** 共享工作区：注入前序成果摘要，并把本次产出沉淀回去 */
    workspace?: DesignTeamWorkspace;
    /** 工作区沉淀时的阶段标签（默认用角色名） */
    stage?: string;
    /** 项目路径：提供时队友产出按映射写穿到 Design Project State */
    projectPath?: string;
    /**
     * 流水线级工具结果收集器：追加本次队友运行 agent.run 已产出的 toolCallLog（{name,result}），
     * 供 critic 阶段复用现成的 extractFreshDesignSurfaceSnapshotFromToolResults → 测量 → 确定性断言
     * 管道做评分（复用既有采集，不新建平行采集管道；顺序即时间序，测量新鲜度门禁依赖此约定）。
     */
    toolResultsSink?: Array<{ name: string; result: any }>;
}

export interface RunPipelineRequest {
    goal: string;
    context?: string;
    /** 评审不通过时允许的修订轮数，默认 1 */
    maxRevisions?: number;
    /** 项目路径：提供时各阶段产出写穿到 Design Project State */
    projectPath?: string;
}

// 裁决解析/评分卡并轨迁移至 shared/design-team-verdict.ts（纯逻辑，可被 smoke 直接测试），此处 re-export 兼容
import {
    mergeDeterministicScorecardIntoCriticVerdict,
    parseCriticVerdict
} from '../../../shared/design-team-verdict';
export { parseCriticVerdict };

function formatCriticIssues(verdict: DesignCriticVerdict): string {
    const issueList = verdict.issues
        .map((issue, idx) => {
            const owner = issue.owner ? `归属：${issue.owner}；` : '';
            return `${idx + 1}. ${owner}[${issue.target}] 问题：${issue.problem}${issue.suggestion ? `；建议：${issue.suggestion}` : ''}`;
        })
        .join('\n');
    return issueList || verdict.reviewText;
}

function pickPrimaryIssueOwner(verdict: DesignCriticVerdict): DesignCriticIssueOwner | undefined {
    return verdict.issues.find((issue) => Boolean(issue.owner))?.owner;
}

function buildRevisionRoute(owner: DesignCriticIssueOwner | undefined): DesignTeammateRole[] {
    switch (owner) {
        case 'copy':
            return ['copywriter', 'executor'];
        case 'insight':
            return ['market-researcher', 'design-strategist', 'executor'];
        case 'asset':
            return ['scene-analyst', 'design-strategist', 'executor'];
        case 'requirement':
            return ['design-strategist', 'executor'];
        case 'visual':
        case 'layout':
        case 'execution':
        default:
            return ['executor'];
    }
}

function buildRevisionTask(role: DesignTeammateRole, goal: string, issueText: string): string {
    switch (role) {
        case 'market-researcher':
            return `评审认为市场/用户洞察不足。围绕目标「${goal}」补充痛点、竞品表达和可用于设计的洞察，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'copywriter':
            return `评审认为文案或卖点表达需要返工。围绕目标「${goal}」重出可上图文案和卖点层级，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'scene-analyst':
            return `评审认为素材、画面或图层理解不足。重新检查当前 Photoshop 画面，补充可执行的场景/素材判断，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'design-strategist':
            return `基于最新团队成果和评审问题，修订目标「${goal}」的设计计划，明确 executor 下一步该改什么，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'executor':
        default:
            return `按最新团队成果和评审问题执行 Photoshop 修订，逐项落实并报告结果。\n待处理问题：\n${issueText}`;
    }
}

export class DesignTeamCoordinator {
    private readonly callModel: CallModelFn;
    private readonly executeTool: ExecuteToolFn;
    private readonly resolveDefaultModelId: () => string;

    constructor(options: DesignTeamCoordinatorOptions) {
        this.callModel = options.callModel;
        this.executeTool = options.executeTool;
        this.resolveDefaultModelId = options.resolveDefaultModelId;
    }

    /** 按角色构建模型调度计划；调度计划只决定专家模型，不改变主 Agent 的裁决权。 */
    private buildDispatchPlanForRole(role: DesignTeammateRole, explicitModelId?: string): MultimodalModelDispatchPlan {
        try {
            const prefs = (useAppStore.getState() as any).modelPreferences;
            return buildMultimodalModelDispatchPlan({
                consumer: 'teammate',
                role,
                prefs,
                mode: prefs?.mode,
                includeFallback: prefs?.autoFallback,
                includeCrossTaskBackups: true,
                requireToolUse: true,
                explicitModelId
            });
        } catch {
            const fallbackModelId = explicitModelId || this.resolveDefaultModelId();
            return buildMultimodalModelDispatchPlan({
                consumer: 'teammate',
                role,
                explicitModelId: fallbackModelId,
                availableModels: fallbackModelId ? [fallbackModelId] : [],
                requireToolUse: true
            });
        }
    }

    private resolveModelForRole(role: DesignTeammateRole): string {
        const plan = this.buildDispatchPlanForRole(role);
        return plan.selectedModelId || this.resolveDefaultModelId();
    }

    async runTeammateTask(
        request: DesignTeammateTaskRequest,
        callbacks?: AgentCallbacks,
        signal?: AbortSignal,
        options?: RunTeammateTaskOptions
    ): Promise<DesignTeammateTaskResult> {
        const definition = getDesignTeammateDefinition(request.role);
        const tools = selectTools(definition.allowedTools);
        const dispatchPlan = this.buildDispatchPlanForRole(request.role, request.modelId);
        const modelId = dispatchPlan.selectedModelId || this.resolveModelForRole(request.role);
        const taskId = this.createTaskId(request.role);
        const task = new DesignTeammateTask(taskId, request);
        const runtimeBudget = buildDesignTeamRuntimeBudget({
            role: request.role,
            requestedMaxIterations: request.maxIterations
        });

        options?.workspace?.record({
            role: request.role,
            outputType: 'model_dispatch_trace',
            stage: options?.stage || request.role,
            success: true,
            content: formatModelDispatchTrace(dispatchPlan),
            toolsUsed: []
        });

        const promptSections = [
            definition.systemPrompt,
            `Model dispatch context:\n${formatModelDispatchTrace(dispatchPlan)}`
        ];
        const workspaceDigest = options?.workspace?.buildContextDigest({ excludeRole: request.role }) || '';
        if (workspaceDigest) promptSections.push(workspaceDigest);
        if (request.context) promptSections.push(`Coordinator context:\n${request.context}`);
        const systemPrompt = promptSections.join('\n\n');

        const { Agent } = await import('../agent-runtime/agent');
        const agent = new Agent(
            {
                systemPrompt,
                tools,
                modelId,
                maxIterations: runtimeBudget.maxIterations,
                requireInitialToolCall: false,
                callbacks: callbacks || {},
                signal
            },
            this.callModel,
            this.executeTool
        );

        task.markRunning();
        const result = await agent.run(request.task);

        // 把本次运行的工具结果沉进流水线级收集器（若调用方提供）：复用 agent.run 已产出的
        // toolCallLog，供确定性测量取"最近一次成功结果"，不是新采集管道。
        if (options?.toolResultsSink) {
            for (const entry of result.toolCallLog) {
                options.toolResultsSink.push({ name: entry.name, result: entry.result });
            }
        }

        const finalized = task.finalize({
            success: result.success,
            message: result.message,
            iterations: result.iterations,
            toolsUsed: result.toolCallLog.map((item) => item.name),
            error: result.error,
            cancelled: result.cancelled
        });

        options?.workspace?.record({
            role: request.role,
            outputType: definition.outputType,
            stage: options?.stage || request.role,
            success: finalized.success,
            content: finalized.message,
            toolsUsed: finalized.toolsUsed
        });

        // 写穿到共享项目状态（失败不阻断）
        await syncTeammateOutputToDesignState(options?.projectPath, {
            role: request.role,
            outputType: definition.outputType,
            stage: options?.stage || request.role,
            success: finalized.success,
            content: finalized.message
        });

        return finalized;
    }

    /**
     * 标准设计团队流水线：场景分析 → 设计策略 → 执行 → 评审 →（不通过则修订并复审）。
     * 各阶段通过共享工作区传递成果；评审裁决驱动修订循环。
     */
    async runPipeline(
        request: RunPipelineRequest,
        callbacks?: AgentCallbacks,
        signal?: AbortSignal
    ): Promise<DesignTeamPipelineResult> {
        const goal = String(request.goal || '').trim();
        if (!goal) {
            return {
                success: false,
                message: '流水线缺少目标描述（goal）。',
                goal: '',
                stages: [],
                revisionRounds: 0,
                error: 'Missing pipeline goal'
            };
        }

        const maxRevisions = Math.max(0, Math.min(2, Number(request.maxRevisions ?? 1)));
        const workspace = new DesignTeamWorkspace();
        const stages: DesignTeamPipelineStageRecord[] = [];
        const revisionNotes: string[] = [];
        // 各阶段队友 agent.run 的工具结果累计（{name,result}），供 critic 阶段做确定性评分卡测量。
        const pipelineToolResults: Array<{ name: string; result: any }> = [];
        let revisionRounds = 0;

        const emitStage = (stage: string, role: DesignTeammateRole, phase: 'start' | 'done', detail?: string) => {
            callbacks?.onStep?.({
                kind: phase === 'start' ? 'tool_started' : 'tool_completed',
                title: phase === 'start' ? `团队阶段：${stage}` : `团队阶段完成：${stage}`,
                detail: detail || `角色：${role}`,
                status: phase === 'start' ? 'running' : 'success',
                toolName: `designTeamPipeline:${stage}`,
                toolCallId: `pipeline-${stage}`
            });
        };

        const runStage = async (
            stage: string,
            role: DesignTeammateRole,
            taskText: string,
            context?: string
        ): Promise<DesignTeammateTaskResult | null> => {
            if (signal?.aborted) return null;
            emitStage(stage, role, 'start');
            const result = await this.runTeammateTask(
                { role, task: taskText, context },
                callbacks,
                signal,
                { workspace, stage, projectPath: request.projectPath, toolResultsSink: pipelineToolResults }
            );
            stages.push({
                stage,
                role,
                success: result.success,
                message: result.message,
                iterations: result.iterations,
                toolsUsed: result.toolsUsed,
                ...(result.error ? { error: result.error } : {})
            });
            emitStage(stage, role, 'done', result.success ? `角色：${role}` : `角色：${role}（失败：${result.error || '未知原因'}）`);
            return result;
        };

        const cancelledResult = (): DesignTeamPipelineResult => ({
            success: false,
            cancelled: true,
            message: '团队流水线已取消。',
            goal,
            stages,
            revisionRounds
        });

        // 阶段 1：场景分析
        const analysis = await runStage('analyze', 'scene-analyst',
            `分析当前 Photoshop 画面，目标是：${goal}。总结文档结构、视觉层级、关键模块与风险点，为设计策略提供依据。`,
            request.context);
        if (!analysis) return cancelledResult();
        if (!analysis.success) {
            return {
                success: false,
                message: `场景分析阶段失败：${analysis.error || analysis.message}`,
                goal, stages, revisionRounds, error: analysis.error || 'analyze stage failed'
            };
        }

        // 阶段 2：市场/用户洞察
        const market = await runStage('market', 'market-researcher',
            `围绕目标「${goal}」和当前项目画面，提炼目标用户、核心痛点、竞品常见表达和可用于设计的市场洞察。不要改 Photoshop。`);
        if (!market) return cancelledResult();
        if (!market.success) {
            return {
                success: false,
                message: `市场洞察阶段失败：${market.error || market.message}`,
                goal, stages, revisionRounds, error: market.error || 'market stage failed'
            };
        }

        // 阶段 3：文案策略
        const copy = await runStage('copy', 'copywriter',
            `基于团队已有的场景分析和市场洞察，为目标「${goal}」产出卖点层级、主标题/副标题/短标签等可上图文案。不要改 Photoshop。`);
        if (!copy) return cancelledResult();
        if (!copy.success) {
            return {
                success: false,
                message: `文案策略阶段失败：${copy.error || copy.message}`,
                goal, stages, revisionRounds, error: copy.error || 'copy stage failed'
            };
        }

        // 阶段 4：设计策略
        const plan = await runStage('plan', 'design-strategist',
            `基于团队已有的场景分析，为目标「${goal}」制定具体可执行的设计计划：明确要改哪些图层/模块、文案与图片策略、执行顺序与验收要点。`);
        if (!plan) return cancelledResult();
        if (!plan.success) {
            return {
                success: false,
                message: `设计策略阶段失败：${plan.error || plan.message}`,
                goal, stages, revisionRounds, error: plan.error || 'plan stage failed'
            };
        }

        // 阶段 5：执行
        const execution = await runStage('execute', 'executor',
            `按团队已有的设计计划执行 Photoshop 修改。先检查现状再动手，逐项落实计划，完成后报告每项的实际结果。`);
        if (!execution) return cancelledResult();
        if (!execution.success) {
            return {
                success: false,
                message: `执行阶段失败：${execution.error || execution.message}`,
                goal, stages, revisionRounds, error: execution.error || 'execute stage failed'
            };
        }

        // 阶段 6：评审（+ 修订循环）
        let verdict: DesignCriticVerdict | undefined;
        for (let round = 0; round <= maxRevisions; round++) {
            const reviewStage = round === 0 ? 'review' : `review-${round}`;
            const review = await runStage(reviewStage, 'critic',
                `评审当前执行结果是否达成目标「${goal}」。对照团队的设计计划与执行报告，检查布局、层级、文案适配与视觉一致性。`);
            if (!review) return cancelledResult();

            verdict = parseCriticVerdict(review.message);
            // 确定性评分卡并轨：从本次流水线各阶段累计的真实工具结果做确定性测量，带新鲜度门禁——
            // 结构读（getDocumentInfo/getLayerHierarchy/getAllTextLayers）必须晚于最后一次成功写操作
            // 才可用（见 buildDeterministicScorecard），绝不用执行前旧画面测量并行使否决权。
            // 失败/待复核断言带 owner 并进裁决 issues；仅 blocker 级失败强制 needs_fix（红线不被
            // 模型散文抵消），major/minor 梯度缺陷判软不翻转模型 pass。无新鲜可测快照时诚实跳过。
            const deterministicScorecard = this.buildDeterministicScorecard(pipelineToolResults);
            if (deterministicScorecard) {
                verdict = mergeDeterministicScorecardIntoCriticVerdict(verdict, deterministicScorecard);
            }
            if (verdict.status === 'pass') break;
            if (verdict.status === 'unparseable') {
                // 已评审但无法机读（且确定性测量也没发现失败）：不强行修订，按已完成处理并保留评审原文
                break;
            }
            const issueText = formatCriticIssues(verdict);
            if (round >= maxRevisions) {
                revisionNotes.push(issueText);
                break;
            }

            revisionRounds++;
            revisionNotes.push(issueText);
            const owner = pickPrimaryIssueOwner(verdict);
            const route = buildRevisionRoute(owner);
            for (let routeIndex = 0; routeIndex < route.length; routeIndex++) {
                const role = route[routeIndex];
                const stageSuffix = route.length === 1
                    ? ''
                    : role === 'executor'
                        ? '-apply'
                        : `-${role}`;
                const revision = await runStage(
                    `revise-${revisionRounds}${stageSuffix}`,
                    role,
                    buildRevisionTask(role, goal, issueText)
                );
                if (!revision) return cancelledResult();
                if (!revision.success) {
                    return {
                        success: false,
                        message: `修订阶段失败：${revision.error || revision.message}`,
                        goal, stages, revisionRounds, verdict,
                        error: revision.error || 'revise stage failed'
                    };
                }
            }
        }

        const verdictLine = verdict?.status === 'pass'
            ? '评审通过。'
            : verdict?.status === 'needs_fix'
                ? `评审仍有 ${verdict.issues.length} 个待改进项（已达修订轮数上限，详见评审报告）。`
                : '评审已完成（未提供机读裁决，详见评审报告）。';

        await syncPipelineRetrospectiveToDesignState(request.projectPath, {
            goal,
            stages,
            verdict,
            revisionRounds,
            revisionNotes
        });

        return {
            success: true,
            message: [
                `团队流水线完成（${stages.length} 个阶段，${revisionRounds} 轮修订）。${verdictLine}`,
                ...(verdict?.deterministicScorecard
                    ? [`确定性评分卡：${verdict.deterministicScorecard.summary}`]
                    : []),
                '',
                `执行报告：${workspace.latestOfType('execution_report')?.content || '（无）'}`,
                '',
                `评审报告：${verdict?.reviewText || '（无）'}`
            ].join('\n'),
            goal,
            stages,
            verdict,
            revisionRounds
        };
    }

    /**
     * 从流水线累计的工具结果构建确定性评分卡（仅 deterministic 断言，0 token，纯逻辑）。
     * 测量新鲜度门禁：结构读结果必须晚于最后一次成功写操作（写类分类复用
     * isAgentToolExecutionGuarded 单一口径，门禁实现在
     * extractFreshDesignSurfaceSnapshotFromToolResults），否则等于拿执行前旧画面测量、
     * 且按并轨语义拥有否决权，修订轮无法自愈。renderLayout 的 subjectLayerIds 是身份声明，
     * 不受新鲜度限制。写后无新鲜结构读或无可测画面快照时返回 null——诚实不评，绝不用默认值
     * 伪造测量；critic 白名单已含 getDocumentInfo/getLayerHierarchy/getAllTextLayers，
     * 评审轮有机制自取最新结构读取结果（是否调用由模型决定）。
     */
    private buildDeterministicScorecard(
        toolResults: Array<{ name: string; result: any }>
    ): DesignScorecard | null {
        const snapshot = extractFreshDesignSurfaceSnapshotFromToolResults(toolResults);
        if (!snapshot) return null;
        const measurements = extractDesignQualityMeasurements(snapshot);
        const results = evaluateDeterministicAssertions(measurements);
        return scoreDesignAssertions(results);
    }

    private createTaskId(role: DesignTeammateTaskRequest['role']): string {
        const stamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        return `design-task-${role}-${stamp}-${random}`;
    }
}
