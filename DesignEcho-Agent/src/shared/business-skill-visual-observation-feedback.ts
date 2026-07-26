import type {
    BusinessSkillVisualContext,
    BusinessSkillVisualContextStatus
} from './business-skill-visual-context';

export type BusinessSkillVisualObservationFeedbackVersion = 'business-skill-visual-observation-feedback/v0';
export type BusinessSkillVisualObservationFeedbackSeverity = 'none' | 'info' | 'warning';
export type BusinessSkillVisualObservationAction =
    | 'continue_with_current_context'
    | 'refresh_project_context'
    | 'ask_user_to_select_images'
    | 'offer_visual_analysis'
    | 'avoid_unsupported_semantic_claims';

export interface BusinessSkillVisualObservationFeedback {
    feedbackVersion: BusinessSkillVisualObservationFeedbackVersion;
    userVisible: boolean;
    severity: BusinessSkillVisualObservationFeedbackSeverity;
    title: string;
    summary: string;
    actionHint: string;
    recommendedActions: BusinessSkillVisualObservationAction[];
    missingInputs: string[];
    warningItems: string[];
    limitations: string[];
}

function resolveSeverity(status: BusinessSkillVisualContextStatus): BusinessSkillVisualObservationFeedbackSeverity {
    if (status === 'not_required') return 'none';
    if (status === 'ready') return 'info';
    return 'warning';
}

function resolveTitle(status: BusinessSkillVisualContextStatus): string {
    switch (status) {
        case 'ready':
            return '素材内容已有理解';
        case 'partial':
            return '部分素材还需查看';
        case 'needs_context_snapshot':
            return '项目素材上下文不完整';
        case 'needs_visual_insight':
            return '素材内容尚未查看';
        case 'no_visual_candidates':
            return '暂未找到图片候选';
        case 'not_required':
            return '这一步不依赖图片理解';
        default:
            return '素材上下文待补充';
    }
}

function resolveActionHint(status: BusinessSkillVisualContextStatus): string {
    switch (status) {
        case 'ready':
            return '可把现有素材理解作为上下文；最终效果仍需结合真实画面复核。';
        case 'partial':
            return '可以继续处理已明确的内容，并可选择补看尚未理解的素材。';
        case 'needs_context_snapshot':
            return '可以刷新项目素材上下文，或直接指定这次要使用的图片。';
        case 'needs_visual_insight':
            return '可以选择先看图；未看清的款式、材质和卖点不应被写成事实。';
        case 'no_visual_candidates':
            return '可以选择图片或刷新素材索引；实际 Skill 仍会自行校验它需要的输入。';
        case 'not_required':
            return '按当前目标继续处理即可。';
        default:
            return '根据当前任务选择补充素材上下文或继续处理明确输入。';
    }
}

function resolveRecommendedActions(status: BusinessSkillVisualContextStatus): BusinessSkillVisualObservationAction[] {
    switch (status) {
        case 'ready':
        case 'not_required':
            return ['continue_with_current_context'];
        case 'partial':
            return ['continue_with_current_context', 'offer_visual_analysis', 'avoid_unsupported_semantic_claims'];
        case 'needs_context_snapshot':
            return ['refresh_project_context', 'ask_user_to_select_images', 'continue_with_current_context'];
        case 'needs_visual_insight':
            return ['offer_visual_analysis', 'continue_with_current_context', 'avoid_unsupported_semantic_claims'];
        case 'no_visual_candidates':
            return ['ask_user_to_select_images', 'refresh_project_context', 'continue_with_current_context'];
        default:
            return ['continue_with_current_context'];
    }
}

function buildSummary(visualContext: BusinessSkillVisualContext): string {
    const selected = Math.max(0, visualContext.candidateSummary.selectedCandidateCount);
    const contextualSources = Math.max(0, visualContext.candidateSummary.contextualSourceCandidateCount);
    const needsLook = Math.max(0, visualContext.candidateSummary.shouldAnalyzeCount);
    const understood = Math.max(0, visualContext.cacheSummary.entriesWithInsight || visualContext.cacheSummary.hit || 0);

    switch (visualContext.status) {
        case 'needs_context_snapshot':
            return '当前没有完整的项目素材上下文。';
        case 'no_visual_candidates':
            return '当前素材索引中没有适合这一步的图片候选。';
        case 'needs_visual_insight':
            return selected > 0 || contextualSources > 0
                ? `已有 ${selected || contextualSources} 个素材线索，但还没有对应的图片内容摘要。`
                : '已有素材线索，但还没有对应的图片内容摘要。';
        case 'partial':
            return needsLook > 0
                ? `已有部分素材理解，还有 ${needsLook} 个候选尚未查看。`
                : '已有部分素材理解，关键画面仍可进一步查看。';
        case 'ready':
            return understood > 0
                ? `已有 ${understood} 个素材内容摘要可供任务参考。`
                : '已有素材内容摘要可供任务参考。';
        case 'not_required':
            return '当前步骤不依赖图片内容判断。';
        default:
            return visualContext.reason || '素材上下文还可进一步补充。';
    }
}

function shouldShowToUser(status: BusinessSkillVisualContextStatus): boolean {
    return status === 'needs_context_snapshot' || status === 'no_visual_candidates';
}

export function buildBusinessSkillVisualObservationFeedback(
    visualContext: BusinessSkillVisualContext
): BusinessSkillVisualObservationFeedback {
    return {
        feedbackVersion: 'business-skill-visual-observation-feedback/v0',
        userVisible: shouldShowToUser(visualContext.status),
        severity: resolveSeverity(visualContext.status),
        title: resolveTitle(visualContext.status),
        summary: buildSummary(visualContext),
        actionHint: resolveActionHint(visualContext.status),
        recommendedActions: resolveRecommendedActions(visualContext.status),
        missingInputs: visualContext.requiredInputs,
        warningItems: visualContext.warnings,
        limitations: [
            '这是素材上下文提示，不是执行许可或最终设计结论。',
            '不会根据文件名或标签编造款式、材质、场景或卖点。',
            '实际 Skill 负责校验自己的业务输入；Photoshop 写入权限由 Tool preflight 与 Policy 管理。'
        ]
    };
}
