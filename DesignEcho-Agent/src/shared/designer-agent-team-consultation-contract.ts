import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import type { DesignerAgentDecisionStatus } from './designer-agent-decision-contract';
import type { DesignTeammateRole } from './types/design-team.types';

export type DesignerAgentTeamConsultationStatus =
    | 'not_required'
    | 'recommended'
    | 'required';

export type DesignerAgentTeamConsultationMode =
    | 'none'
    | 'advisory'
    | 'pipeline';

export interface DesignerAgentTeamConsultationContractInput {
    userTask?: string;
    scenario?: DesignAgentOsScenario;
    decisionStatus?: DesignerAgentDecisionStatus;
    hasCurrentDocument?: boolean;
    explicitTeamRequest?: boolean;
}

export interface DesignerAgentTeamRolePlan {
    role: DesignTeammateRole;
    purpose: string;
    phase: 'before_write' | 'after_draft' | 'after_write';
    requiredDeliverables: string[];
}

export interface DesignerAgentTeamConsultationContract {
    version: 'designer-agent-team-consultation-contract/v0';
    status: DesignerAgentTeamConsultationStatus;
    mode: DesignerAgentTeamConsultationMode;
    scenario: DesignAgentOsScenario;
    publicTeamIntent: string;
    rolePlan: DesignerAgentTeamRolePlan[];
    toolGuidance: string[];
    boundaries: string[];
    promptSection: string;
}

export interface DesignerAgentTeamConsultationProgressInput {
    contract?: DesignerAgentTeamConsultationContract | null;
    completedRoles?: DesignTeammateRole[];
    pipelineCompleted?: boolean;
    phase?: DesignerAgentTeamRolePlan['phase'];
}

export interface DesignerAgentTeamConsultationProgress {
    readyForWrite: boolean;
    requiredRoles: DesignTeammateRole[];
    completedRoles: DesignTeammateRole[];
    missingRoles: DesignTeammateRole[];
    nextRequiredRole?: DesignTeammateRole;
    publicMessage: string;
}

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveScenario(input: DesignerAgentTeamConsultationContractInput): DesignAgentOsScenario {
    return input.scenario || 'general-design';
}

function isDesignScenario(scenario: DesignAgentOsScenario): boolean {
    return ['main-image', 'detail-page', 'sku', 'reference-replication', 'general-design'].includes(scenario);
}

function looksLikeSmallLocalEdit(task: string): boolean {
    if (!task) return false;
    return /去掉|删除|隐藏|移除|改一下|换字|改文案|调整.{0,8}(位置|大小|颜色|透明度)|移动|对齐|改名/.test(task)
        && !/从零|创建|新建|完整|整套|详情页|主图|海报|SKU|色卡|复刻|参考|交付|导出/.test(task);
}

function looksLikeWholeDesignTask(task: string, scenario: DesignAgentOsScenario): boolean {
    if (!task) return false;
    if (['main-image', 'detail-page', 'sku', 'reference-replication'].includes(scenario)) return true;
    return /从零|创建|新建|完整|整套|设计|制作|做一个|生成|交付|导出|主图|详情页|海报|SKU|色卡|复刻|参考/.test(task);
}

function looksLikePipelineTask(input: DesignerAgentTeamConsultationContractInput): boolean {
    const scenario = resolveScenario(input);
    const task = cleanText(input.userTask);
    if (!input.hasCurrentDocument || scenario === 'sku') return false;
    if (/从零|新建|创建|生成|制作.{0,8}(文档|画布|详情页|主图)|做一个|出一个|交付|导出/.test(task)) {
        return false;
    }
    return /当前|已有|现有|打开的|这张|这个文档|当前画面/.test(task)
        && /整体|优化|改得更|重做|升级|全局|完整重做/.test(task);
}

function resolveStatus(input: DesignerAgentTeamConsultationContractInput): DesignerAgentTeamConsultationStatus {
    const scenario = resolveScenario(input);
    const task = cleanText(input.userTask);
    if (!isDesignScenario(scenario)) return 'not_required';
    if (input.explicitTeamRequest) return 'required';
    if (looksLikePipelineTask(input)) return 'required';
    if (looksLikeSmallLocalEdit(task)) return 'not_required';
    if (looksLikeWholeDesignTask(task, scenario)) return 'recommended';
    if (input.decisionStatus === 'needs_design_decision') return 'recommended';
    return 'not_required';
}

function resolveMode(
    status: DesignerAgentTeamConsultationStatus,
    input: DesignerAgentTeamConsultationContractInput
): DesignerAgentTeamConsultationMode {
    if (status === 'not_required') return 'none';
    if (status === 'required' && (input.explicitTeamRequest || looksLikePipelineTask(input))) {
        return 'pipeline';
    }
    return 'advisory';
}

function buildAdvisoryRolePlan(): DesignerAgentTeamRolePlan[] {
    return [{
        role: 'design-strategist',
        purpose: '只在主 Agent 对视觉方向、信息层级或版式取舍存在明确不确定性时，提供一次聚焦建议。',
        phase: 'before_write',
        requiredDeliverables: [
            '针对当前不确定点给出一个可执行建议。',
            '说明建议依据和需要主 Agent 继续观察的画面位置。'
        ]
    }];
}

function buildPipelineRolePlan(input: DesignerAgentTeamConsultationContractInput): DesignerAgentTeamRolePlan[] {
    const scenario = resolveScenario(input);
    const task = cleanText(input.userTask);
    const roles: DesignerAgentTeamRolePlan[] = [];

    roles.push({
        role: 'scene-analyst',
        purpose: '先看清当前画面、项目素材和明显风险，避免在没理解素材时开稿。',
        phase: 'before_write',
        requiredDeliverables: [
            '说明当前画面或项目素材里真实存在什么。',
            '指出可用素材、明显风险和下一步需要重点观察的地方。'
        ]
    });

    if (scenario === 'main-image' || scenario === 'detail-page' || scenario === 'general-design') {
        roles.push({
            role: 'market-researcher',
            purpose: '把产品特点转成用户会在意的痛点、购买理由和竞品表达。',
            phase: 'before_write',
            requiredDeliverables: [
                '明确目标用户、使用场景和核心购买疑问。',
                '把产品特征翻译成用户能理解的利益点。'
            ]
        });
        roles.push({
            role: 'copywriter',
            purpose: '把卖点整理成能放进画面的短标题、标签和说明文字。',
            phase: 'before_write',
            requiredDeliverables: [
                '给出主标题、短标签和卖点排序。',
                '说明每句文案适合放在画面的哪个位置或模块。'
            ]
        });
    }

    if (scenario === 'sku') {
        roles.push({
            role: 'market-researcher',
            purpose: '确认 SKU 组合和颜色命名是否符合用户选择习惯。',
            phase: 'before_write',
            requiredDeliverables: [
                '确认 SKU 颜色命名、组合逻辑和用户选择习惯是否一致。',
                '指出需要用户确认或适合沉淀为记忆的组合规则。'
            ]
        });
    }

    roles.push({
        role: 'design-strategist',
        purpose: '汇总前面判断，给出版式、选图、层级和复核重点。',
        phase: 'before_write',
        requiredDeliverables: [
            '把素材、卖点和文案汇总成可执行的设计策略。',
            '明确本阶段要做什么、预期画面是什么、做完后看什么。'
        ]
    });

    roles.push({
        role: 'critic',
        purpose: /导出|交付|完成/.test(task)
            ? '在保存或导出前复核画面是否能交付。'
            : '在阶段草稿后复核画面是否需要调整。',
        phase: 'after_draft',
        requiredDeliverables: [
            '基于真实截图或图层状态指出是否通过。',
            '如果不通过，要给出问题归属和可执行修改建议。'
        ]
    });

    return roles;
}

function buildRolePlan(
    input: DesignerAgentTeamConsultationContractInput,
    mode: DesignerAgentTeamConsultationMode
): DesignerAgentTeamRolePlan[] {
    if (mode === 'advisory') return buildAdvisoryRolePlan();
    if (mode === 'pipeline') return buildPipelineRolePlan(input);
    return [];
}

function buildPublicTeamIntent(
    status: DesignerAgentTeamConsultationStatus,
    mode: DesignerAgentTeamConsultationMode,
    input: DesignerAgentTeamConsultationContractInput
): string {
    if (status === 'not_required') return '这次不需要专业团队协作。';
    const task = cleanText(input.userTask) || '当前设计任务';
    if (mode === 'pipeline') {
        return `这是完整设计任务：${task}。先让专业团队按场景、洞察、文案、策略、执行和评审协作，再由主 Agent 汇总结论。`;
    }
    return `这是需要设计取舍的任务：${task}。主 Agent 可以在遇到明确不确定性时征询一个最相关角色，最终设计决策仍由主 Agent 完成。`;
}

function buildToolGuidance(
    status: DesignerAgentTeamConsultationStatus,
    mode: DesignerAgentTeamConsultationMode
): string[] {
    if (status === 'not_required') return ['按普通任务执行，不需要启动设计团队。'];
    if (mode === 'pipeline') {
        return [
            '可以使用 runDesignTeamPipeline 处理完整画面改造，但必须先观察当前画面。',
            '团队流水线的结果是专业协作产出，主 Agent 仍要判断是否符合用户目标。',
            '评审未通过时先按问题归属修订，不要直接保存或导出。'
        ];
    }
    return [
        '仅在存在明确设计不确定性时，用 delegateToAgent 获取一个最相关角色的聚焦建议。',
        '如果主 Agent 已掌握足够素材上下文和清晰方案，可以直接推进，不要为了使用团队而委派。',
        '子 Agent 只提供建议，不能代替主 Agent 的最终设计判断和真实画面复核。'
    ];
}

function buildPromptSection(contract: Omit<DesignerAgentTeamConsultationContract, 'promptSection'>): string {
    const lines = [
        '【专业设计团队协作协议】',
        `状态：${contract.status}`,
        `协作方式：${contract.mode}`,
        `团队意图：${contract.publicTeamIntent}`,
        '角色计划：',
        ...contract.rolePlan.map((item, index) => `${index + 1}. ${item.role}（${item.phase}）：${item.purpose}`),
        '角色交付标准：',
        ...contract.rolePlan.flatMap((item, index) => [
            `${index + 1}. ${item.role}`,
            ...item.requiredDeliverables.map((deliverable) => `   - ${deliverable}`)
        ]),
        '工具使用：',
        ...contract.toolGuidance.map((item, index) => `${index + 1}. ${item}`),
        '边界：',
        ...contract.boundaries.map((item, index) => `${index + 1}. ${item}`)
    ];
    return lines.join('\n');
}

export function buildDesignerAgentTeamConsultationContract(
    input: DesignerAgentTeamConsultationContractInput
): DesignerAgentTeamConsultationContract {
    const scenario = resolveScenario(input);
    const status = resolveStatus(input);
    const mode = resolveMode(status, input);
    const rolePlan = buildRolePlan(input, mode);
    const base = {
        version: 'designer-agent-team-consultation-contract/v0' as const,
        status,
        mode,
        scenario,
        publicTeamIntent: buildPublicTeamIntent(status, mode, input),
        rolePlan,
        toolGuidance: buildToolGuidance(status, mode),
        boundaries: [
            'Agent 架构负责组织专业角色，skill 负责具体领域流程，工具只执行明确动作。',
            '子 Agent 的输出是专业建议，不是最终命令；主 Agent 必须汇总后再决定下一步。',
            '团队协作不能替代真实画面复核，保存或导出前仍要看结果。'
        ]
    };
    return {
        ...base,
        promptSection: buildPromptSection(base)
    };
}

export function buildDesignerAgentTeamPromptSection(
    input: DesignerAgentTeamConsultationContractInput
): string {
    return buildDesignerAgentTeamConsultationContract(input).promptSection;
}

function uniqueRoles(roles: DesignTeammateRole[]): DesignTeammateRole[] {
    return Array.from(new Set(roles));
}

export function buildDesignerAgentTeamConsultationProgress(
    input: DesignerAgentTeamConsultationProgressInput
): DesignerAgentTeamConsultationProgress {
    const contract = input.contract;
    const phase = input.phase || 'before_write';
    const completedRoles = uniqueRoles(Array.isArray(input.completedRoles) ? input.completedRoles : []);

    if (!contract || contract.status !== 'required') {
        return {
            readyForWrite: true,
            requiredRoles: [],
            completedRoles,
            missingRoles: [],
            publicMessage: '这次不需要强制专业团队门禁。'
        };
    }

    const requiredRoles = uniqueRoles(
        contract.rolePlan
            .filter((item) => item.phase === phase)
            .map((item) => item.role)
    );

    if (input.pipelineCompleted) {
        return {
            readyForWrite: true,
            requiredRoles,
            completedRoles: uniqueRoles([...completedRoles, ...requiredRoles]),
            missingRoles: [],
            publicMessage: '专业团队流水线已经完成，可以进入写入或交付判断。'
        };
    }

    const completedSet = new Set(completedRoles);
    const missingRoles = requiredRoles.filter((role) => !completedSet.has(role));
    const nextRequiredRole = missingRoles[0];
    const completeLabel = phase === 'after_draft'
        ? '交付前专业评审已经完成。'
        : '写入前专业角色判断已经完成。';
    const missingLabel = phase === 'after_draft'
        ? `交付前还缺少专业评审：${missingRoles.join('、')}。`
        : `写入前还缺少专业角色判断：${missingRoles.join('、')}。`;

    return {
        readyForWrite: missingRoles.length === 0,
        requiredRoles,
        completedRoles,
        missingRoles,
        nextRequiredRole,
        publicMessage: missingRoles.length === 0
            ? completeLabel
            : missingLabel
    };
}
