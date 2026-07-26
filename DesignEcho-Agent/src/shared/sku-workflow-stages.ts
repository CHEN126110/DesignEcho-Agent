import { SKU_WORKFLOW_STAGES_CAPABILITY_ID } from './agent-runtime-v5/capability-provider-identities';
import {
    extractSkuComboSizesFromText,
    isSkuCardSourceOnlyText,
    isSkuExecutionRequestText,
    isSkuTemplateDesignRequestText
} from './sku-intent-params';

export type SkuWorkflowStageId =
    | 'inspect_existing_resources'
    | 'design_template'
    | 'confirm_combos'
    | 'batch_production';

export type SkuWorkflowStagePlanVersion = typeof SKU_WORKFLOW_STAGES_CAPABILITY_ID;

export interface SkuWorkflowStage {
    id: SkuWorkflowStageId;
    label: string;
    agentOwnsDecision: boolean;
    userVisiblePurpose: string;
}

export interface BuildSkuWorkflowStagePlanInput {
    userInput: unknown;
    hasExistingSkuSource?: boolean;
    hasTemplateReady?: boolean;
    hasConfirmedCombos?: boolean;
}

export interface SkuWorkflowStagePlan {
    version: SkuWorkflowStagePlanVersion;
    stages: SkuWorkflowStage[];
    nextStageId: SkuWorkflowStageId;
    shouldReuseExistingSkuSource: boolean;
    requiresAgentDecisionBeforeNextStage: boolean;
    canEnterControlledBatchSkill: boolean;
    requireComboConfirmation: boolean;
    reason: string;
    matchedSignals: string[];
    userVisibleSummary: string;
}

const STAGE_DEFINITIONS: Record<SkuWorkflowStageId, SkuWorkflowStage> = {
    inspect_existing_resources: {
        id: 'inspect_existing_resources',
        label: '识别已有资源',
        agentOwnsDecision: true,
        userVisiblePurpose: '先确认项目里真实存在的 SKU 源文档、模板和已导出结果。'
    },
    design_template: {
        id: 'design_template',
        label: '设计模板',
        agentOwnsDecision: true,
        userVisiblePurpose: '模板排版由 Agent 基于素材、参考和画面观察判断，不交给批处理脚本决定。'
    },
    confirm_combos: {
        id: 'confirm_combos',
        label: '确认组合',
        agentOwnsDecision: true,
        userVisiblePurpose: '组合影响真实上架，需要用可编辑确认卡片让用户确认或修改。'
    },
    batch_production: {
        id: 'batch_production',
        label: '批量生产',
        agentOwnsDecision: false,
        userVisiblePurpose: '源文档、模板和组合明确后，交给受控批处理生成组合图和自选备注。'
    }
};

const EXISTING_SKU_SOURCE_PATTERN =
    /(?:已有|现有|现成|已经准备好|已准备好|项目已有|项目中已有|项目中存在|项目里已有|已经有|已存在|基于已有|基于现有|基于(?:我们)?项目中(?:的)?|基于当前项目(?:中|里)?(?:的)?|使用(?:我们)?项目中(?:的)?|复用(?:我们)?项目中(?:的)?|沿用(?:我们)?项目中(?:的)?).{0,48}(?:SKU|sku).{0,48}(?:色卡素材|色卡源|源文档|源文件|卡片源|SKU\.psb|PSD\/SKU|PSD\\SKU)|(?:PSD[\\/]+SKU\.psb|SKU\.psb)/i;
const CONFIRMED_COMBOS_PATTERN =
    /(?:我已确认|已确认|确认使用|确认后的组合|基于确认后的组合).{0,64}(?:SKU|sku)?.{0,32}(?:组合|配方)|(?:SKU|sku)\s*组合\s*[:：]/i;
const COMBO_OR_NOTE_PATTERN =
    /(?:组合图|颜色组合|规格组合|自选备注|备注图|\d{1,2}\s*双|2\s*[-/、，,]\s*3\s*[-/、，,]\s*4)/i;

function uniqueStages(stageIds: SkuWorkflowStageId[]): SkuWorkflowStage[] {
    const seen = new Set<SkuWorkflowStageId>();
    const result: SkuWorkflowStage[] = [];
    for (const id of stageIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(STAGE_DEFINITIONS[id]);
    }
    return result;
}

export function buildSkuWorkflowStagePlan(input: BuildSkuWorkflowStagePlanInput): SkuWorkflowStagePlan {
    const text = String(input.userInput || '').trim();
    const lower = text.toLowerCase();
    const sourceOnly = isSkuCardSourceOnlyText(text);
    const templateDesign = isSkuTemplateDesignRequestText(text);
    const execution = isSkuExecutionRequestText(text);
    const confirmedCombos = input.hasConfirmedCombos === true || CONFIRMED_COMBOS_PATTERN.test(text);
    const shouldReuseExistingSkuSource = input.hasExistingSkuSource === true || EXISTING_SKU_SOURCE_PATTERN.test(text);
    const comboSizes = extractSkuComboSizesFromText(text);
    const asksComboOrNote = comboSizes.length > 0 || COMBO_OR_NOTE_PATTERN.test(text);
    const stageSignals: string[] = [];
    const stageIds: SkuWorkflowStageId[] = ['inspect_existing_resources'];

    if (shouldReuseExistingSkuSource) stageSignals.push('existing_sku_source');
    if (sourceOnly) stageSignals.push('source_only');
    if (templateDesign) stageSignals.push('template_design');
    if (execution) stageSignals.push('sku_execution');
    if (confirmedCombos) stageSignals.push('confirmed_combos');
    if (asksComboOrNote) stageSignals.push('combo_or_note_requested');

    if (templateDesign) {
        stageIds.push('design_template');
        if (asksComboOrNote) {
            stageIds.push('confirm_combos');
        }
    } else if (execution && confirmedCombos) {
        stageIds.push('batch_production');
    } else if (execution && !sourceOnly) {
        stageIds.push('confirm_combos');
    }

    const stages = uniqueStages(stageIds);
    const canEnterControlledBatchSkill =
        stages.some((stage) => stage.id === 'batch_production')
        && confirmedCombos
        && !templateDesign
        && !sourceOnly;
    const requireComboConfirmation =
        stages.some((stage) => stage.id === 'confirm_combos')
        && !confirmedCombos
        && !sourceOnly;
    const requiresAgentDecisionBeforeNextStage = !canEnterControlledBatchSkill;
    const nextStageId = stages[0]?.id || 'inspect_existing_resources';
    const matchedSignals = [
        ...stageSignals,
        ...stages.map((stage) => `stage:${stage.id}`)
    ];

    const reason = templateDesign
        ? 'SKU 模板仍需要设计判断，批处理只能在模板和组合确认后进入。'
        : canEnterControlledBatchSkill
            ? 'SKU 组合已确认，可以在读回资源后进入受控批量生产。'
            : execution
                ? 'SKU 生产请求需要先确认组合，避免脚本自行猜测上架组合。'
                : 'SKU 请求需要先识别已有资源，再由 Agent 决定下一步。';

    const userVisibleSummary = lower
        ? stages.map((stage) => stage.label).join(' → ')
        : '识别已有资源';

    return {
        version: SKU_WORKFLOW_STAGES_CAPABILITY_ID,
        stages,
        nextStageId,
        shouldReuseExistingSkuSource,
        requiresAgentDecisionBeforeNextStage,
        canEnterControlledBatchSkill,
        requireComboConfirmation,
        reason,
        matchedSignals,
        userVisibleSummary
    };
}

export function shouldHoldSkuBatchForAgentDesignDecision(input: {
    userInput: unknown;
    params?: Record<string, any> | null;
    hasExistingSkuSource?: boolean;
}): boolean {
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const text = String(input.userInput || '').trim();
    if (!text) return false;
    if (params.sourceOnly === true) return false;
    if (params.allowControlledBatchProduction === true) return false;
    if (params.skuCardTemplateDesignApproved === true) return false;

    const plan = buildSkuWorkflowStagePlan({
        userInput: text,
        hasExistingSkuSource: input.hasExistingSkuSource
            || params.preferExistingSkuSourceForCardPreparation === true
    });
    const includesTemplateDesign = plan.stages.some((stage) => stage.id === 'design_template');
    return includesTemplateDesign && !plan.canEnterControlledBatchSkill;
}
