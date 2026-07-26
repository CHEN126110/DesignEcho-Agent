import type {
    DesignIntelligenceAgentDecision,
    DesignIntelligenceWorkflowPhase
} from './design-intelligence-plan';
import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import {
    DESIGN_OBSERVATION_REQUIREMENTS,
    type DesignObservationIntent
} from './design-observation-intents';
import { hasConcreteProjectVisualInsight } from './project-visual-sampling';

export type DesignerAgentDecisionStatus =
    | 'ready'
    | 'needs_design_decision'
    | 'needs_visual_observation';

export interface DesignerAgentObservationGoal {
    intent: DesignObservationIntent;
    purpose: string;
    reviewSignals: string[];
}

export interface DesignerAgentDecisionOption {
    id: string;
    label: string;
    whenUseful: string;
    possibleActions: string[];
    userFacingReason: string;
}

export interface DesignerAgentDecisionContractInput {
    userTask?: string;
    scenario?: DesignAgentOsScenario;
    visualInsightCache?: unknown;
    agentDecision?: DesignIntelligenceAgentDecision | null;
}

export function resolveDesignerAgentProjectVisualObservation(input: {
    visualInsightCache?: unknown;
}): boolean {
    const visualCache = input.visualInsightCache as Record<string, any> | undefined;
    if (!visualCache || ['missing', 'invalid'].includes(String(visualCache.source || ''))) return false;
    return Array.isArray(visualCache.entries) && visualCache.entries.some((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return false;
        const insight = (entry as Record<string, any>).insight;
        return hasConcreteProjectVisualInsight(insight);
    });
}

export interface DesignerAgentDecisionContract {
    version: 'designer-agent-decision-contract/v0';
    status: DesignerAgentDecisionStatus;
    scenario: DesignAgentOsScenario;
    publicDesignIntent: string;
    publicObservationGoals: DesignerAgentObservationGoal[];
    decisionOptions: DesignerAgentDecisionOption[];
    toolUseGuidance: string[];
    blockers: string[];
    boundaries: string[];
    promptSection: string;
}

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown, limit = 6): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, limit);
}

function hasUsefulDecision(decision?: DesignIntelligenceAgentDecision | null): boolean {
    if (!decision || typeof decision !== 'object') return false;
    return Boolean(
        cleanString(decision.designGoal)
        || cleanStrings(decision.productUnderstanding).length
        || cleanString(decision.hierarchy?.primarySubject)
        || cleanStrings(decision.hierarchy?.informationPriority).length
        || cleanString(decision.color?.paletteIntent)
        || cleanString(decision.typography?.tone)
        || cleanStrings(decision.assetSelection?.selectionPrinciples).length
        || cleanStrings(decision.acceptanceCriteria).length
    );
}

function hasWorkflowAndAcceptance(decision?: DesignIntelligenceAgentDecision | null): boolean {
    return Boolean(
        Array.isArray(decision?.toolWorkflow)
        && decision.toolWorkflow.length > 0
        && Array.isArray(decision.acceptanceCriteria)
        && decision.acceptanceCriteria.length > 0
    );
}

function resolveStatus(input: DesignerAgentDecisionContractInput): DesignerAgentDecisionStatus {
    if (!hasUsefulDecision(input.agentDecision) || !hasWorkflowAndAcceptance(input.agentDecision)) {
        return 'needs_design_decision';
    }
    if (!resolveDesignerAgentProjectVisualObservation({ visualInsightCache: input.visualInsightCache })) {
        return 'needs_visual_observation';
    }
    return 'ready';
}

function mapWorkflowPhaseToObservationIntent(phase: DesignIntelligenceWorkflowPhase | undefined): DesignObservationIntent | undefined {
    if (phase === 'inspect' || phase === 'analyze') return 'image_fit';
    if (phase === 'compose') return 'layout_balance';
    if (phase === 'retouch') return 'visual_hierarchy';
    if (phase === 'verify') return 'stage_readiness';
    if (phase === 'export') return 'export_readiness';
    return undefined;
}

function inferObservationIntents(decision?: DesignIntelligenceAgentDecision | null): DesignObservationIntent[] {
    const intents = new Set<DesignObservationIntent>();
    const workflow = Array.isArray(decision?.toolWorkflow) ? decision.toolWorkflow : [];
    for (const step of workflow) {
        const intent = mapWorkflowPhaseToObservationIntent(step.phase);
        if (intent) intents.add(intent);
    }
    if (cleanStrings(decision?.assetSelection?.selectionPrinciples).length || cleanString(decision?.hierarchy?.primarySubject)) {
        intents.add('image_fit');
    }
    if (cleanStrings(decision?.hierarchy?.informationPriority).length || cleanString(decision?.typography?.tone)) {
        intents.add('text_readability');
    }
    if (cleanString(decision?.color?.paletteIntent)) {
        intents.add('visual_hierarchy');
    }
    if (cleanStrings(decision?.acceptanceCriteria).some((item) => /导出|保存|交付/.test(item))) {
        intents.add('export_readiness');
    }
    if (intents.size === 0) {
        intents.add('stage_readiness');
    }
    return Array.from(intents).slice(0, 5);
}

function buildObservationGoals(decision?: DesignIntelligenceAgentDecision | null): DesignerAgentObservationGoal[] {
    return inferObservationIntents(decision)
        .map((intent) => DESIGN_OBSERVATION_REQUIREMENTS[intent])
        .filter(Boolean)
        .map((requirement) => ({
            intent: requirement.intent,
            purpose: requirement.purpose,
            reviewSignals: requirement.reviewSignals.slice(0, 4)
        }));
}

function buildPublicDesignIntent(input: DesignerAgentDecisionContractInput): string {
    const decision = input.agentDecision;
    const pieces: string[] = [];
    const goal = cleanString(decision?.designGoal) || cleanString(input.userTask);
    if (goal) pieces.push(`目标：${goal}`);
    const productUnderstanding = cleanStrings(decision?.productUnderstanding, 4);
    if (productUnderstanding.length) pieces.push(`产品理解：${productUnderstanding.join('、')}`);
    const primarySubject = cleanString(decision?.hierarchy?.primarySubject);
    if (primarySubject) pieces.push(`第一视觉：${primarySubject}`);
    const priorities = cleanStrings(decision?.hierarchy?.informationPriority, 4);
    if (priorities.length) pieces.push(`信息层级：${priorities.join(' > ')}`);
    const palette = cleanString(decision?.color?.paletteIntent);
    if (palette) pieces.push(`配色意图：${palette}`);
    const tone = cleanString(decision?.typography?.tone);
    if (tone) pieces.push(`文字气质：${tone}`);
    return pieces.join('；') || '需要先形成清楚的设计判断，再决定是否动手。';
}

function buildScenarioToolUseGuidance(input: DesignerAgentDecisionContractInput): string[] {
    if (input.scenario !== 'sku') return [];
    return [
        '通用 SKU 模板默认推进方式：用户只说“通用 SKU 模板”或“SKU 设计模板”时，先按电商通用方形 SKU 卡片模板推进；默认包含商品图或色卡图区域、规格组合区、颜色/款式名称、编号、自选备注和导出占位。平台、模块数量、风格偏好不是开工前必问项。',
        'SKU 模板素材默认来源：先检查当前 Photoshop 文档、项目目录和 PSD/SKU.psb 或 SKU 目录里的已有色卡素材；能读到可用色卡时先基于真实素材做模板，不要重复生成色卡。',
        'SKU 模板询问边界：只有缺少项目路径、没有可用 SKU 素材、用户要求互相冲突、继续会覆盖或删除现有文件、组合规则无法从素材或需求推断时，才向用户提问；普通偏好由主 Agent 给出推荐并继续。'
    ];
}

function buildToolUseGuidance(input: DesignerAgentDecisionContractInput, status: DesignerAgentDecisionStatus): string[] {
    const common = [
        '这些是设计边界，不是固定脚本；主 Agent 可以自己选择观察、执行、给建议、请求确认或暂停。',
        '先判断设计目标、素材适配和观察重点，再选择工具。',
        '每次写入画面后都要看真实结果，再决定继续、调整、重做或交付。',
        'renderLayout 只能代表当前阶段草稿，不代表最终稿。'
    ];
    const scenarioGuidance = buildScenarioToolUseGuidance(input);
    if (status === 'ready') {
        return [
            ...scenarioGuidance,
            ...common
        ];
    }
    if (status === 'needs_visual_observation') {
        return [
            '先读取项目素材或观察当前画面，不要直接生成最终稿。',
            ...scenarioGuidance,
            ...common
        ];
    }
    return [
        '先补齐设计判断，不要直接生成最终稿。',
        ...scenarioGuidance,
        ...common
    ];
}

function buildBlockers(status: DesignerAgentDecisionStatus): string[] {
    if (status === 'ready') return [];
    if (status === 'needs_visual_observation') {
        return ['还没有观察项目素材或当前画面，不能把设计判断直接变成写入动作。'];
    }
    return ['缺少可执行的设计判断：需要先明确目标、视觉层级、选图原则、工具阶段和验收标准。'];
}

function buildCommonDecisionOptions(status: DesignerAgentDecisionStatus): DesignerAgentDecisionOption[] {
    const options: DesignerAgentDecisionOption[] = [
        {
            id: 'inspect_context',
            label: '先观察真实上下文',
            whenUseful: '当前项目、画布、素材或用户目标还没有看清。',
            possibleActions: [
                '读取项目资源、当前文档、图层或截图。',
                '只总结真实看到的内容，不把猜测当事实。'
            ],
            userFacingReason: '先看清材料和画面，避免在错误素材或错误文档上开稿。'
        },
        {
            id: 'make_stage_draft',
            label: '做当前阶段草稿',
            whenUseful: '设计目标、素材和当前阶段已经足够明确。',
            possibleActions: [
                '创建或调整当前阶段版面。',
                '写入后立即观察画面，再决定下一步。'
            ],
            userFacingReason: '先做一小段可观察草稿，再根据真实效果调整。'
        },
        {
            id: 'ask_or_advise_user',
            label: '给用户建议或请求确认',
            whenUseful: '存在多个合理方向且会改变业务交付、覆盖数据或用户取舍；普通设计偏好应先给推荐并推进。',
            possibleActions: [
                '说明可选方案、推荐选择和原因。',
                '使用交互卡片让用户确认可编辑内容。',
                '如果不是阻塞问题，给出默认建议后继续执行。'
            ],
            userFacingReason: '把需要业务取舍的地方交给用户确认，而不是假装系统已经知道。'
        }
    ];

    if (status !== 'ready') {
        options.unshift({
            id: 'form_design_decision',
            label: '先形成设计判断',
            whenUseful: '还缺少设计目标、素材原则、视觉层级或验收标准。',
            possibleActions: [
                '阅读项目上下文、设计知识或专业角色建议。',
                '把目标、层级、配色、选图和复核点整理成公开判断。'
            ],
            userFacingReason: '先想清楚为什么这样做，再决定是否动手。'
        });
    }

    return options;
}

function buildSkuDecisionOptions(): DesignerAgentDecisionOption[] {
    return [
        {
            id: 'inspect_sku_resources',
            label: '检查已有 SKU 资源',
            whenUseful: '用户说项目里已有 SKU 色卡、模板或组合，但当前状态还没有被读回确认。',
            possibleActions: [
                '查找项目里的 SKU 源文档、模板文件和已导出结果。',
                '读取当前 Photoshop 文档或图层结构，确认哪些内容真实存在。',
                '先用已有资源判断模板规格和素材可用性，不把平台、模块数量或风格偏好当成开工前必问项。'
            ],
            userFacingReason: '先确认已有资源，避免重复做色卡或误把成品当素材。'
        },
        {
            id: 'design_sku_template',
            label: '自主设计 SKU 排版模板',
            whenUseful: '缺少模板、模板不好看，或用户要求做卡片式 SKU 模板。',
            possibleActions: [
                '基于已有色卡素材设计 2/3/4 双装和自选备注模板。',
                '做完一阶段后看截图或图层结果，再调整比例、留白和文字位置。',
                '用户只说通用模板时，先按电商通用方形 SKU 卡片模板给出推荐方案并动手做当前阶段。'
            ],
            userFacingReason: '模板排版属于设计判断，不能交给固定批处理脚本决定。'
        },
        {
            id: 'confirm_sku_combos',
            label: '创建组合确认卡片',
            whenUseful: '颜色数量、2/3/4 双组合或自选备注需要用户确认。',
            possibleActions: [
                '根据已有颜色生成候选组合。',
                '用可编辑交互卡片让用户修改并确认组合。'
            ],
            userFacingReason: '组合规则影响真实上架，不应该只由脚本猜。'
        },
        {
            id: 'run_sku_batch_production',
            label: '进入 SKU 批量生产',
            whenUseful: '色卡源、模板和组合已经明确或已确认。',
            possibleActions: [
                '调用 SKU 批处理生成组合图和自选备注。',
                '导出后读回文件或画面状态，说明哪些结果可验收。'
            ],
            userFacingReason: '确定性生产适合交给批处理，设计判断仍由 Agent 负责。'
        }
    ];
}

function buildScenarioDecisionOptions(
    scenario: DesignAgentOsScenario,
    status: DesignerAgentDecisionStatus
): DesignerAgentDecisionOption[] {
    const options = buildCommonDecisionOptions(status);
    if (scenario === 'sku') {
        return uniqueDecisionOptions([
            ...buildSkuDecisionOptions(),
            ...options
        ]);
    }
    if (scenario === 'detail-page' || scenario === 'main-image' || scenario === 'reference-replication') {
        return uniqueDecisionOptions([
            {
                id: 'seek_reference_or_knowledge',
                label: '先找参考或方法论',
                whenUseful: '版式方向、风格或行业表达不清楚。',
                possibleActions: [
                    '读取对应设计方法论或检索参考。',
                    '把参考转成自己的版式、层级和复核标准。'
                ],
                userFacingReason: '用知识和参考辅助判断，但不照搬成品。'
            },
            ...options
        ]);
    }
    return options;
}

function uniqueDecisionOptions(options: DesignerAgentDecisionOption[]): DesignerAgentDecisionOption[] {
    const seen = new Set<string>();
    const result: DesignerAgentDecisionOption[] = [];
    for (const option of options) {
        const id = cleanString(option.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(option);
    }
    return result.slice(0, 8);
}

function buildPromptSection(contract: Omit<DesignerAgentDecisionContract, 'promptSection'>): string {
    const lines = [
        '【设计师 Agent 决策协议】',
        `状态：${contract.status}`,
        `公开设计意图：${contract.publicDesignIntent}`,
        '可选决策路径（不是固定流程，由主 Agent 自己选择）：',
        ...contract.decisionOptions.map((option, index) => {
            const actions = option.possibleActions.length
                ? `；可做：${option.possibleActions.slice(0, 2).join(' / ')}`
                : '';
            return `${index + 1}. ${option.label}：${option.whenUseful}${actions}`;
        }),
        '观察目标：',
        ...contract.publicObservationGoals.map((goal, index) => `${index + 1}. ${goal.purpose}`),
        '执行边界：',
        ...contract.toolUseGuidance.map((item, index) => `${index + 1}. ${item}`),
        ...contract.blockers.length ? ['当前阻塞：', ...contract.blockers.map((item) => `- ${item}`)] : []
    ];
    return lines.join('\n');
}

export function buildDesignerAgentDecisionContract(
    input: DesignerAgentDecisionContractInput
): DesignerAgentDecisionContract {
    const scenario = input.scenario || 'general-design';
    const status = resolveStatus(input);
    const base = {
        version: 'designer-agent-decision-contract/v0' as const,
        status,
        scenario,
        publicDesignIntent: buildPublicDesignIntent(input),
        publicObservationGoals: buildObservationGoals(input.agentDecision),
        decisionOptions: buildScenarioDecisionOptions(scenario, status),
        toolUseGuidance: buildToolUseGuidance(input, status),
        blockers: buildBlockers(status),
        boundaries: [
            '设计判断层只决定目标、观察重点和工具使用边界，不直接调用工具。',
            '工具层只执行明确动作，不负责判断画面好不好看。',
            '知识、记忆和参考图只能辅助设计判断，不能替代截图复核或人工验收。',
            '系统规则只提供边界和能力选项，不替主 Agent 决定设计路线。'
        ]
    };
    return {
        ...base,
        promptSection: buildPromptSection(base)
    };
}

export function buildDesignerAgentPromptSection(
    input: DesignerAgentDecisionContractInput
): string {
    return buildDesignerAgentDecisionContract(input).promptSection;
}
