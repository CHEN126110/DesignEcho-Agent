export type DesignObservationIntent =
    | 'layout_balance'
    | 'image_fit'
    | 'text_readability'
    | 'container_overflow'
    | 'visual_hierarchy'
    | 'stage_readiness'
    | 'export_readiness';

export type DesignStageDecision =
    | 'continue'
    | 'adjust_current_stage'
    | 'restart_current_stage'
    | 'ready_to_export';

export type DesignObservationInputKind =
    | 'structure'
    | 'annotated_snapshot'
    | 'canvas_snapshot'
    | 'vision_model';

export interface DesignObservationRequirement {
    intent: DesignObservationIntent;
    purpose: string;
    observationTools: string[];
    observationOrder: DesignObservationInputKind[];
    reviewSignals: string[];
    repairActions: string[];
    maxRepairAttempts: number;
}

export const DESIGN_OBSERVATION_REQUIREMENTS: Record<DesignObservationIntent, DesignObservationRequirement> = {
    layout_balance: {
        intent: 'layout_balance',
        purpose: '检查当前阶段整体重心、留白、对齐和节奏是否成立。',
        observationTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot'],
        observationOrder: ['structure', 'annotated_snapshot'],
        reviewSignals: ['主体是否清楚', '留白是否失衡', '元素是否拥挤', '视觉路径是否明确'],
        repairActions: ['重新分配当前阶段模块比例', '减少低价值装饰', '调整标题和主体距离'],
        maxRepairAttempts: 3
    },
    image_fit: {
        intent: 'image_fit',
        purpose: '检查图片是否正确进入目标区域，主体是否过大、过小、偏移或溢出。',
        observationTools: ['getAnnotatedSnapshot', 'getLayerBounds', 'getClippingMaskInfo', 'getAllClippingMasks'],
        observationOrder: ['structure', 'annotated_snapshot'],
        reviewSignals: ['图片是否超出容器', '主体是否居中', '图片是否遮挡文字', '容器约束是否明确'],
        repairActions: ['调整图片缩放', '调整图片位置', '重新选择目标区域', '进入受控容器修正流程'],
        maxRepairAttempts: 3
    },
    text_readability: {
        intent: 'text_readability',
        purpose: '检查标题、卖点和说明文字是否可读、不过框、不互相挤压。',
        observationTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot', 'getAllTextLayers'],
        observationOrder: ['structure', 'annotated_snapshot'],
        reviewSignals: ['文字是否清晰', '文字是否超框', '层级是否分明', '对比度是否足够'],
        repairActions: ['缩短文案', '调整字号层级', '提升文字对比', '重新分组卖点'],
        maxRepairAttempts: 3
    },
    container_overflow: {
        intent: 'container_overflow',
        purpose: '检查卡片、模块、图片和文字是否溢出画布或容器。',
        observationTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot', 'getLayerBounds'],
        observationOrder: ['structure', 'annotated_snapshot'],
        reviewSignals: ['元素是否出画布', '卡片内容是否溢出', '元素间是否重叠'],
        repairActions: ['缩小当前元素', '扩大容器', '减少当前阶段内容', '重新排布当前阶段'],
        maxRepairAttempts: 3
    },
    visual_hierarchy: {
        intent: 'visual_hierarchy',
        purpose: '检查第一眼先看到什么，标题、商品、卖点是否有主次。',
        observationTools: ['getCanvasSnapshot', 'getAnnotatedSnapshot', 'getDetailPageDesignFramework'],
        observationOrder: ['canvas_snapshot', 'annotated_snapshot'],
        reviewSignals: ['第一视觉焦点是否正确', '卖点是否抢主体', '背景是否压主体'],
        repairActions: ['放大主视觉', '降低次要元素权重', '强化核心标题', '减少同权重卡片'],
        maxRepairAttempts: 3
    },
    stage_readiness: {
        intent: 'stage_readiness',
        purpose: '判断当前阶段是否可以进入下一阶段。',
        observationTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot'],
        observationOrder: ['structure', 'annotated_snapshot'],
        reviewSignals: ['当前阶段目标是否达成', '是否存在明显遮挡', '是否存在未复核图片或文字'],
        repairActions: ['调整当前阶段', '重做当前阶段草稿', '减少当前阶段内容'],
        maxRepairAttempts: 3
    },
    export_readiness: {
        intent: 'export_readiness',
        purpose: '保存或导出前检查画面和结构是否具备验收条件。',
        observationTools: ['getCanvasSnapshot', 'getAcceptanceSnapshot'],
        observationOrder: ['structure', 'canvas_snapshot'],
        reviewSignals: ['画面是否可读', '导出尺寸是否正确', '关键图层是否存在', '是否还有明显错位'],
        repairActions: ['回到问题阶段修正', '重新截图复核', '停止导出并说明阻塞原因'],
        maxRepairAttempts: 1
    }
};

export function getDesignObservationRequirement(
    intent: DesignObservationIntent | undefined
): DesignObservationRequirement | undefined {
    if (!intent) return undefined;
    return DESIGN_OBSERVATION_REQUIREMENTS[intent];
}
