import type { AgentRequestRoute, AgentRequestRouteSource } from './agent-request-lifecycle';
import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import {
    buildDesignIntelligencePlan,
    type DesignIntelligenceAgentDecision,
    type DesignIntelligencePlan,
    type DesignIntelligenceProjectContext
} from './design-intelligence-plan';
import type { DesignKnowledgeResult } from './design-knowledge-search';
import { isMainImageWhiteBackgroundFromSkuMaterialRequest } from './main-image-white-background-export-contract';
import { isProjectContextMainImageDeliveryIntent } from './project-image-analysis-intent';

export type AgentDesignExecutionPreflightStatus =
    | 'not_applicable'
    | 'context_ready'
    | 'needs_model_design_decision'
    | 'needs_visual_observation'
    | 'needs_planner_context';

export interface AgentDesignExecutionPreflightContext extends DesignIntelligenceProjectContext {
    projectPath?: string;
}

export interface BuildAgentDesignExecutionPreflightInput {
    userText?: string;
    route: AgentRequestRoute;
    routeSource: AgentRequestRouteSource;
    skillId?: string;
    mode?: string;
    params?: Record<string, unknown>;
    projectContext?: AgentDesignExecutionPreflightContext | null;
    knowledgeResults?: DesignKnowledgeResult[];
    agentDecision?: DesignIntelligenceAgentDecision | null;
}

export interface AgentDesignExecutionPreflight {
    version: 'agent-design-execution-preflight/v0';
    status: AgentDesignExecutionPreflightStatus;
    route: AgentRequestRoute;
    routeSource: AgentRequestRouteSource;
    skillId?: string;
    scenario?: DesignAgentOsScenario;
    appliesToSkill: boolean;
    readOnlyExempt: boolean;
    requiredInputs: string[];
    recommendedActions: string[];
    warnings: string[];
    designIntelligencePlan?: DesignIntelligencePlan;
    boundaries: string[];
    limitations: string[];
}

const SKILL_SCENARIO_MAP: Record<string, DesignAgentOsScenario> = {
    'main-image-design': 'main-image',
    'detail-page-design': 'detail-page',
    'sku-batch': 'sku'
};

const CONTROLLED_PRODUCTION_SKILLS_WITH_OWN_PLANNER = new Set([
    'sku-batch'
]);

type ControlledProductionPlannerKind =
    | 'sku'
    | 'main-image-white-background'
    | 'project-context-main-image';

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function numberOrZero(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function extractAgentDecision(params: Record<string, unknown> = {}): DesignIntelligenceAgentDecision | null {
    const candidates = [
        params.designIntelligenceDecision,
        params.designAgentDecision,
        params.agentDesignDecision
    ];
    const decision = candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item));
    return decision ? decision as DesignIntelligenceAgentDecision : null;
}

function isReadOnlyExempt(input: BuildAgentDesignExecutionPreflightInput): boolean {
    const params = input.params || {};
    const mode = cleanString(input.mode || params.mode || params.detailMode).toLowerCase();
    return mode === 'inspect'
        || params.inspectOnly === true
        || params.dryRun === true
        || params.strategyOnly === true
        || cleanString(params.mainImageExecutionMode).toLowerCase() === 'strategy-only';
}

function requiresGenericDesignDecision(input: BuildAgentDesignExecutionPreflightInput): boolean {
    const params = input.params || {};
    const mode = cleanString(input.mode || params.mode || params.detailMode || params.executionMode).toLowerCase();
    return params.requiresDesignIntelligenceDecision === true
        || params.requiresGenericDesignDecision === true
        || mode === 'creative-design'
        || mode === 'open-design'
        || mode === 'redesign';
}

function isControlledProjectContextMainImageRequest(
    input: BuildAgentDesignExecutionPreflightInput,
    scenario?: DesignAgentOsScenario
): boolean {
    const skillId = cleanString(input.skillId);
    const params = input.params || {};
    const executionMode = cleanString(params.mainImageExecutionMode).toLowerCase();
    const executionScope = cleanString(params.executionScope).toLowerCase();
    const sourceAssetKind = cleanString(params.sourceAssetKind).toLowerCase();
    const outputDirPolicy = cleanString(params.outputDirPolicy).toLowerCase();

    return input.route === 'skill_execution'
        && scenario === 'main-image'
        && skillId === 'main-image-design'
        && isProjectContextMainImageDeliveryIntent(input.userText)
        && executionMode === 'product-disposable-live'
        && executionScope === 'disposable-document'
        && sourceAssetKind === 'selected-project-image'
        && outputDirPolicy === 'project-main-image-dir'
        && params.approvedLiveExecution === true
        && params.approvedLiveAdapterRun === true
        && params.enableVisionPreflight === true
        && params.userCheckpointApproved === true
        && !requiresGenericDesignDecision(input);
}

function resolveControlledProductionPlannerKind(
    input: BuildAgentDesignExecutionPreflightInput,
    scenario?: DesignAgentOsScenario
): ControlledProductionPlannerKind | undefined {
    const skillId = cleanString(input.skillId);
    const params = input.params || {};
    if (
        input.route === 'skill_execution'
        && scenario === 'main-image'
        && skillId === 'main-image-design'
        && isMainImageWhiteBackgroundFromSkuMaterialRequest({
            userIntent: input.userText,
            imageType: params.imageType,
            sourceAssetKind: params.sourceAssetKind,
            mainImageCapability: params.mainImageCapability
        })
        && !requiresGenericDesignDecision(input)
    ) {
        return 'main-image-white-background';
    }

    if (isControlledProjectContextMainImageRequest(input, scenario)) {
        return 'project-context-main-image';
    }

    if (input.route === 'skill_execution'
        && scenario === 'sku'
        && CONTROLLED_PRODUCTION_SKILLS_WITH_OWN_PLANNER.has(skillId)
        && !requiresGenericDesignDecision(input)) {
        return 'sku';
    }

    return undefined;
}

function normalizeProjectContext(
    projectContext?: AgentDesignExecutionPreflightContext | null
): AgentDesignExecutionPreflightContext {
    return {
        ...projectContext,
        projectImageCount: numberOrZero(projectContext?.projectImageCount),
        attachmentImageCount: numberOrZero(projectContext?.attachmentImageCount),
        sampleImagePaths: Array.isArray(projectContext?.sampleImagePaths)
            ? projectContext.sampleImagePaths.filter((path) => cleanString(path))
            : [],
        assetIndex: {
            ...projectContext?.assetIndex,
            summary: {
                ...projectContext?.assetIndex?.summary,
                totalImages: numberOrZero(projectContext?.assetIndex?.summary?.totalImages)
            }
        }
    };
}

function mapPlanStatus(status?: DesignIntelligencePlan['status']): AgentDesignExecutionPreflightStatus {
    if (status === 'ready_for_tool_planning') return 'context_ready';
    if (status === 'needs_model_design_decision') return 'needs_model_design_decision';
    if (status === 'needs_visual_observation') return 'needs_visual_observation';
    if (status === 'needs_planner_context') return 'needs_planner_context';
    return 'needs_planner_context';
}

export function getAgentDesignExecutionScenario(skillId?: string): DesignAgentOsScenario | undefined {
    return SKILL_SCENARIO_MAP[cleanString(skillId)];
}

export function shouldApplyAgentDesignExecutionPreflight(skillId?: string): boolean {
    return Boolean(getAgentDesignExecutionScenario(skillId));
}

export function buildAgentDesignExecutionPreflight(
    input: BuildAgentDesignExecutionPreflightInput
): AgentDesignExecutionPreflight {
    const skillId = cleanString(input.skillId) || undefined;
    const scenario = getAgentDesignExecutionScenario(skillId);
    const appliesToSkill = Boolean(scenario);
    const readOnlyExempt = isReadOnlyExempt(input);
    const commonBoundaries = [
        '任务级设计 preflight 只整理设计上下文与待补输入，不授权或阻止业务 Skill。',
        '素材可用性和视觉理解是两个独立状态；附件、路径和图片数量不表示已经理解图片内容。',
        'Photoshop 写入由工具执行点的 preflight 与 Policy 检查，当前模块不拥有写入权限。'
    ];
    const commonLimitations = [
        '当前检查只描述上下文状态，不评价最终视觉质量。',
        '工具执行成功后仍需要读回、截图、像素或人工验收。',
        '任务类型、Photoshop 连接、文档状态和具体工具安全继续由各自执行前检查负责。'
    ];

    if (!appliesToSkill || !scenario) {
        return {
            version: 'agent-design-execution-preflight/v0',
            status: 'not_applicable',
            route: input.route,
            routeSource: input.routeSource,
            skillId,
            appliesToSkill: false,
            readOnlyExempt: false,
            requiredInputs: [],
            recommendedActions: [],
            warnings: [],
            boundaries: commonBoundaries,
            limitations: commonLimitations
        };
    }

    if (readOnlyExempt) {
        return {
            version: 'agent-design-execution-preflight/v0',
            status: 'not_applicable',
            route: input.route,
            routeSource: input.routeSource,
            skillId,
            scenario,
            appliesToSkill: true,
            readOnlyExempt: true,
            requiredInputs: [],
            recommendedActions: [],
            warnings: ['当前是只读检查或策略草案请求，不需要补充通用设计上下文。'],
            boundaries: commonBoundaries,
            limitations: commonLimitations
        };
    }

    const controlledPlannerKind = resolveControlledProductionPlannerKind(input, scenario);
    if (controlledPlannerKind) {
        const requiredInputs = controlledPlannerKind === 'main-image-white-background'
            ? [
                'project-first-sku-source-resolution',
                'white-background-export-contract',
                'uxp-white-background-export-tool',
                'export-result-readback'
            ]
            : controlledPlannerKind === 'project-context-main-image'
                ? [
                    'project-main-image-source-resolution',
                    'project-visual-preflight',
                    'controlled-main-image-production-plan',
                    'main-image-result-readback'
                ]
                : [
                    'project-first-sku-source-resolution',
                    'sku-template-and-config-context',
                    'sku-controlled-execution-plan',
                    'sku-result-readback'
                ];
        const warnings = controlledPlannerKind === 'main-image-white-background'
            ? [
                '白底图从项目 SKU 源文件导出，属于确定性素材生产，不要求通用创意设计决策。'
            ]
            : controlledPlannerKind === 'project-context-main-image'
                ? [
                    '项目素材主图生产使用主图专用选图、视觉预检、一次性文档和导出读回，不要求通用创意设计确认。'
                ]
                : [
                    'SKU 批量生产使用 SKU 专用项目上下文和执行计划，不要求通用视觉设计决策。'
                ];
        const extraBoundary = controlledPlannerKind === 'main-image-white-background'
            ? '白底图专用执行计划必须使用项目 PSD/SKU.psb 和主图/白底.jpg 导出目标。'
            : controlledPlannerKind === 'project-context-main-image'
                ? '项目素材主图专用执行计划必须限定 selected-project-image、disposable-document 和 project-main-image-dir。'
                : 'SKU 专用执行计划必须优先使用当前项目中的 SKU 文档、模板文件和配置文件。';
        const extraLimitation = controlledPlannerKind === 'main-image-white-background'
            ? '白底图专用 executor 仍需检查实际文件、图层选择和导出读回。'
            : controlledPlannerKind === 'project-context-main-image'
                ? '项目素材主图 executor 仍需完成实际选图、视觉理解、排版、导出和读回。'
                : 'SKU executor 仍需检查实际文件、模板匹配、组合数量和导出结果。';

        return {
            version: 'agent-design-execution-preflight/v0',
            status: 'context_ready',
            route: input.route,
            routeSource: input.routeSource,
            skillId,
            scenario,
            appliesToSkill: true,
            readOnlyExempt: false,
            requiredInputs,
            recommendedActions: [],
            warnings,
            boundaries: [
                ...commonBoundaries,
                extraBoundary
            ],
            limitations: [
                ...commonLimitations,
                extraLimitation
            ]
        };
    }

    const params = input.params || {};
    const agentDecision = input.agentDecision || extractAgentDecision(params);
    const designIntelligencePlan = buildDesignIntelligencePlan({
        userText: input.userText,
        scenario,
        plannerReadiness: agentDecision ? 'ready' : 'needs_context',
        knowledgeResults: input.knowledgeResults,
        projectContext: normalizeProjectContext(input.projectContext),
        agentDecision
    });
    const status = mapPlanStatus(designIntelligencePlan.status);
    let recommendedActions: string[] = [];
    if (status === 'needs_model_design_decision') {
        recommendedActions = ['由当前 Skill 或模型 Agent 补充设计方向、画面重点和结果检查方式。'];
    } else if (status === 'needs_visual_observation') {
        recommendedActions = ['由当前 Skill 读取或观察相关图片，再基于真实画面继续设计。'];
    } else if (status === 'needs_planner_context') {
        recommendedActions = ['刷新项目上下文或由当前 Skill 重新形成任务计划。'];
    }

    return {
        version: 'agent-design-execution-preflight/v0',
        status,
        route: input.route,
        routeSource: input.routeSource,
        skillId,
        scenario,
        appliesToSkill: true,
        readOnlyExempt: false,
        requiredInputs: designIntelligencePlan.toolUsePlan.requiredInputs,
        recommendedActions,
        warnings: designIntelligencePlan.warnings,
        designIntelligencePlan,
        boundaries: commonBoundaries,
        limitations: commonLimitations
    };
}
