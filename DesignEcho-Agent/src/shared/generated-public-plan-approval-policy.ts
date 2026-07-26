export interface ExplicitGeneratedPublicPlanApprovalRecord {
    sourceMessageId?: string;
    sourceRequestStatus?: string;
}

/**
 * generated public-plan 的批准只能来自一条可追溯的待确认计划和显式 UI 事件。
 * 普通文本、意图分类、Photoshop 连接状态或交付措辞都不属于批准记录。
 */
export function hasExplicitGeneratedPublicPlanApproval(
    approval: ExplicitGeneratedPublicPlanApprovalRecord
): boolean {
    return Boolean(String(approval.sourceMessageId || '').trim())
        && approval.sourceRequestStatus === 'blocked_pending_user_confirmation';
}
