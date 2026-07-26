/**
 * 审批签发策略（GPT 硬门禁，纯函数；Step 1 的 ApprovalService 将复用）。
 *
 * - canIssueApproval：质检未通过（qualityPassed=false 或 gateStatus≠passed_for_user_review）
 *   → ApprovalService 拒绝签发审批。
 * - isApprovalApplicableForScope：不同动作必须独立审批；某 scope 的审批不能复用于其它 scope
 *   （如 sandbox 审批不能用于 current_document_apply）。
 *
 * 注意：ApprovalRecord 只能由 ApprovalService 生成，本模块只提供判定，不生成凭证。
 */

import type { ApprovalRecord } from './contracts/approval-record';

export interface ApprovalIssueDecision {
    allowed: boolean;
    reason?: string;
}

export function canIssueApproval(review: { qualityPassed: boolean; gateStatus: string }): ApprovalIssueDecision {
    if (!review.qualityPassed) {
        return { allowed: false, reason: '质检未通过（qualityPassed=false），不允许进入审批。' };
    }
    if (review.gateStatus !== 'passed_for_user_review') {
        return { allowed: false, reason: `gateStatus=${review.gateStatus}，未达 passed_for_user_review，不允许审批。` };
    }
    return { allowed: true };
}

export function isApprovalApplicableForScope(
    approval: ApprovalRecord,
    requiredScope: ApprovalRecord['payload']['scope']
): boolean {
    const p = approval.payload;
    return p.decision === 'approved' && !p.invalidation && p.scope === requiredScope;
}
