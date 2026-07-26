/**
 * 技能执行器类型定义
 */

import type { AgentTaskPlanningContract } from '../../../shared/agent-task-planning-contract';
import type { AgentResult, AgentContext, ExecutionCallbacks } from '../unified-agent.service';
import type {
    RuntimeDesignBriefDeclaration,
    RuntimeDesignBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import type {
    RuntimeReferenceBriefDeclaration,
    RuntimeReferenceBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import type {
    RuntimeDesignStrategyDeclaration,
    RuntimeDesignStrategyDigest
} from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanDigest
} from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';

/**
 * 技能执行参数
 */
export interface SkillExecuteParams {
    /** 技能参数 */
    params: Record<string, any>;
    /** 回调函数 */
    callbacks?: ExecutionCallbacks;
    /** 中止信号 */
    signal?: AbortSignal;
    /** Agent 上下文 */
    context?: AgentContext;
    /** Engine 已形成的请求级规划契约；子 Skill 继承，不能自行重判执行义务。 */
    agentTaskPlan?: AgentTaskPlanningContract;
    /** 当前 v5 R1 Brief，仅在自主 Agent 已通过 manifest 校验后由 Harness 注入。 */
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    /** Harness owner 生成的 R1 digest；业务 Skill 只消费，不重复实现治理算法。 */
    runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
    /** 生成跨层 digest 所需的当前 manifest required inputs。 */
    runtimeDesignBriefRequiredInputKeys?: string[];
    /** 同一 Runtime 已验证的 R2 参考决策；只读上下文，不授予 Skill 执行权。 */
    runtimeReferenceBriefDeclaration?: RuntimeReferenceBriefDeclaration;
    /** Harness owner 生成的 R2 digest。 */
    runtimeReferenceBriefDigest?: RuntimeReferenceBriefDigest;
    /** 同一 Runtime 已验证的模型 R3 Strategy；只读上下文，不授予 Skill 执行权。 */
    runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
    /** Harness owner 生成的 R3 digest。 */
    runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
    /** 同一 Runtime 已验证的模型 R4 shadow Plan；不具有 scheduler authority。 */
    runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
    /** Harness owner 生成的 R4 digest；不代表节点已执行。 */
    runtimeActionPlanDigest?: RuntimeActionPlanDigest;
    /** 由统一执行入口注入，用于父 skill 调度子 skill，避免直接调用子 executor */
    runSkill?: (skillId: string, params: SkillExecuteParams) => Promise<AgentResult>;
}

/**
 * 技能执行器接口
 */
export interface SkillExecutor {
    /** 技能 ID */
    skillId: string;
    /** Skill-owned 澄清/阶段移交；纯判定，不执行 Tool、授权或推进 Runtime。 */
    resolvePreExecutionResult?(params: SkillExecuteParams): AgentResult | null;
    /** 执行技能 */
    execute(params: SkillExecuteParams): Promise<AgentResult>;
}

/**
 * 技能执行器注册表类型
 */
export type SkillExecutorRegistry = Map<string, SkillExecutor>;
