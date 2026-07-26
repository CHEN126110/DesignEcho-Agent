/**
 * ApprovalRecord — 所有者：ApprovalService（不是模型 Agent）
 * 这是安全凭证，绝不能由 R0–R5 或模型生成。
 * V1：任何 Project State revision 变化 → 现有审批立即失效（最安全策略）。
 * 写当前 PSD 必须是独立审批：preview_selection ≠ photoshop_sandbox_execution ≠ current_document_apply。
 */

import type { ArtifactMeta, ArtifactRef } from './common';

export interface ApprovalRecord {
    meta: ArtifactMeta;
    payload: {
        approvalId: string;
        scope: 'preview_selection' | 'photoshop_sandbox_execution' | 'current_document_apply';
        subject: {
            projectId: string;
            versionId: string;
            stateRevision: number;
            previewSceneRef: ArtifactRef;
            previewArtifactHash: string;
            reviewReportRef: ArtifactRef;
            reviewReportHash: string;
            currentDocumentFingerprint?: string;
        };
        decision: 'approved' | 'rejected' | 'revoked' | 'expired';
        actor: {
            actorType: 'user';
            actorId: string;
        };
        approvedAt?: string;
        rejectedAt?: string;
        invalidation?: {
            invalidatedAt: string;
            reason:
                | 'state_revision_changed'
                | 'preview_hash_changed'
                | 'review_changed'
                | 'document_changed'
                | 'user_revoked';
        };
    };
}

/**
 * V1 审批有效性判定：approved + 未失效 + revision/previewHash/reviewHash 全部一致。
 * 任一不一致即视为失效，必须重新确认。
 */
export function isApprovalValid(
    approval: ApprovalRecord,
    currentStateRevision: number,
    currentPreviewHash: string,
    currentReviewHash: string
): boolean {
    const p = approval.payload;
    return (
        p.decision === 'approved'
        && !p.invalidation
        && p.subject.stateRevision === currentStateRevision
        && p.subject.previewArtifactHash === currentPreviewHash
        && p.subject.reviewReportHash === currentReviewHash
    );
}
