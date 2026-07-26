import type {
    BusinessSkillMemoryContext,
    BusinessSkillMemoryPreferenceSummary,
    BusinessSkillMemoryScenario
} from './business-skill-memory-context';

export type BusinessSkillMemoryStrategyStatus = 'not_available' | 'ready_for_strategy_review';
export type BusinessSkillMemoryStrategyDirectiveCategory =
    | 'style'
    | 'typography'
    | 'color'
    | 'workflow'
    | 'copywriting';

export interface BusinessSkillMemoryStrategyDirective {
    category: BusinessSkillMemoryStrategyDirectiveCategory;
    values: string[];
    instruction: string;
    sourceIds: string[];
    reviewRequired: boolean;
}

export interface BusinessSkillMemoryStrategy {
    version: 'business-skill-memory-strategy/v0';
    scenario: BusinessSkillMemoryScenario;
    status: BusinessSkillMemoryStrategyStatus;
    memoryContextStatus: BusinessSkillMemoryContext['status'];
    strategyDirectives: BusinessSkillMemoryStrategyDirective[];
    strategyInputPatch: {
        designMemoryStrategy?: {
            scenario: BusinessSkillMemoryScenario;
            sourceResultCount: number;
            sourceIds: string[];
            directiveCount: number;
            directives: BusinessSkillMemoryStrategyDirective[];
            boundary: string;
            reviewRequirements: string[];
        };
    };
    reviewRequirements: string[];
    skuBoundaries: {
        mustPreserveSelfSelectNotes: boolean;
        mustPreserveConfiguredCombinations: boolean;
        mustPreserveProjectAssets: boolean;
    };
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    mustNotChangeExecutionParams: true;
    warnings: string[];
    limitations: string[];
}

export interface BuildBusinessSkillMemoryStrategyInput {
    scenario: BusinessSkillMemoryScenario;
    memoryContext: BusinessSkillMemoryContext;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function buildDirective(
    summary: BusinessSkillMemoryPreferenceSummary,
    category: BusinessSkillMemoryStrategyDirectiveCategory,
    values: string[],
    instruction: string
): BusinessSkillMemoryStrategyDirective | null {
    const cleanedValues = uniqueClean(values);
    if (cleanedValues.length === 0) return null;
    return {
        category,
        values: cleanedValues,
        instruction: cleanString(instruction),
        sourceIds: summary.sourceIds,
        reviewRequired: summary.reviewRequiredReasons.length > 0
    };
}

function buildStrategyDirectives(
    scenario: BusinessSkillMemoryScenario,
    summary: BusinessSkillMemoryPreferenceSummary
): BusinessSkillMemoryStrategyDirective[] {
    const scenarioLabel = scenario === 'sku'
        ? 'SKU'
        : scenario === 'detail-page'
            ? '详情页'
            : '主图';
    return [
        buildDirective(
            summary,
            'style',
            summary.stylePreferences,
            `${scenarioLabel}策略可优先参考用户风格偏好，但必须与当前商品素材、平台规范和结果 QA 一起复核。`
        ),
        buildDirective(
            summary,
            'typography',
            summary.typographyPreferences,
            `${scenarioLabel}文案排版可参考用户字体偏好，但不能覆盖模板结构、文字可读性和实际字体可用性检查。`
        ),
        buildDirective(
            summary,
            'color',
            summary.colorPreferences,
            `${scenarioLabel}配色可参考用户色彩偏好，但不能改变商品真实颜色、SKU 颜色事实或项目素材。`
        ),
        buildDirective(
            summary,
            'workflow',
            summary.workflowPreferences,
            `${scenarioLabel}执行顺序可参考用户工作流偏好，但不能跳过项目上下文、视觉观察、写后读回和人工复核。`
        ),
        buildDirective(
            summary,
            'copywriting',
            summary.copywritingPreferences,
            `${scenarioLabel}文案策略可参考用户表达偏好，但不能编造材质、功能、场景或平台承诺。`
        )
    ].filter(Boolean) as BusinessSkillMemoryStrategyDirective[];
}

function buildReviewRequirements(
    scenario: BusinessSkillMemoryScenario,
    status: BusinessSkillMemoryStrategyStatus
): string[] {
    const requirements = status === 'ready_for_strategy_review'
        ? [
            'memory_strategy_review_required',
            'current_user_instruction_priority_required',
            'project_visual_observation_required',
            'screenshot_or_manual_review_required'
        ]
        : [
            'current_task_context_required',
            'project_visual_observation_required'
        ];

    if (scenario === 'detail-page') {
        requirements.push(
            'detail_template_structure_must_be_preserved',
            'detail_screen_plan_must_be_reviewed'
        );
    }
    if (scenario === 'sku') {
        requirements.push(
            'sku_self_select_note_policy_must_be_preserved',
            'sku_configured_combinations_must_be_preserved',
            'sku_project_source_must_be_preserved'
        );
    }
    return requirements;
}

function buildLimitations(
    scenario: BusinessSkillMemoryScenario,
    memoryContext: BusinessSkillMemoryContext
): string[] {
    const limitations = [
        ...memoryContext.limitations,
        '偏好策略只能进入业务设计策略说明和候选复核，不能进入 Photoshop 写入参数。',
        '偏好策略不能替代项目素材、视觉理解、导出读回、截图 QA 或人工验收。',
        '偏好策略不能声明输出质量通过或完整设计完成。'
    ];
    if (scenario === 'detail-page') {
        limitations.push('详情页偏好策略不能改变模板屏幕结构、占位符归属、填充顺序或 fillDetailPage 参数。');
    }
    if (scenario === 'sku') {
        limitations.push('SKU 偏好策略不能改变自选备注开关、CSV 配置组合、规格数量、模板选择或 skuLayout 参数。');
    }
    return uniqueClean(limitations);
}

function buildWarnings(memoryContext: BusinessSkillMemoryContext): string[] {
    return uniqueClean([
        ...memoryContext.warnings,
        ...memoryContext.preferenceSummary.reviewRequiredReasons
    ]);
}

function buildBoundary(scenario: BusinessSkillMemoryScenario, memoryContext: BusinessSkillMemoryContext): string {
    return cleanString(
        memoryContext.strategyInputPatch.designMemory?.boundary
            || (scenario === 'sku'
                ? '本地偏好策略只能影响 SKU 策略说明和候选复核，不能改变自选备注、组合规格、项目素材、模板选择或 Photoshop 执行参数。'
                : scenario === 'detail-page'
                    ? '本地偏好策略只能影响详情页风格、文案和素材匹配候选，不能替代模板结构、项目素材、视觉观察或 Photoshop 执行结果。'
                    : '本地偏好策略只能影响主图风格、文案和排版候选排序，不能替代视觉观察、平台规范或 Photoshop 执行结果。')
    );
}

export function buildBusinessSkillMemoryStrategy(
    input: BuildBusinessSkillMemoryStrategyInput
): BusinessSkillMemoryStrategy {
    const memoryContext = input.memoryContext;
    const summary = memoryContext.preferenceSummary;
    const status: BusinessSkillMemoryStrategyStatus = memoryContext.status === 'available'
        ? 'ready_for_strategy_review'
        : 'not_available';
    const strategyDirectives = status === 'ready_for_strategy_review'
        ? buildStrategyDirectives(input.scenario, summary)
        : [];
    const reviewRequirements = buildReviewRequirements(input.scenario, status);
    const boundary = buildBoundary(input.scenario, memoryContext);
    const strategyInputPatch = status === 'ready_for_strategy_review'
        ? {
            designMemoryStrategy: {
                scenario: input.scenario,
                sourceResultCount: summary.sourceResultCount,
                sourceIds: summary.sourceIds,
                directiveCount: strategyDirectives.length,
                directives: strategyDirectives,
                boundary,
                reviewRequirements
            }
        }
        : {};

    return {
        version: 'business-skill-memory-strategy/v0',
        scenario: input.scenario,
        status,
        memoryContextStatus: memoryContext.status,
        strategyDirectives,
        strategyInputPatch,
        reviewRequirements,
        skuBoundaries: {
            mustPreserveSelfSelectNotes: input.scenario === 'sku',
            mustPreserveConfiguredCombinations: input.scenario === 'sku',
            mustPreserveProjectAssets: input.scenario === 'sku'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        mustNotChangeExecutionParams: true,
        warnings: buildWarnings(memoryContext),
        limitations: buildLimitations(input.scenario, memoryContext)
    };
}
