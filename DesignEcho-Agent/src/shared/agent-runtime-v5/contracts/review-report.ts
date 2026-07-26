/**
 * ReviewReport — 所有者：R5 Quality Gate
 * 只评价和决定流转，不修改任何上游产物。
 * 硬门禁：qualityPassed=false → 不允许创建 ApprovalRecord；gateStatus=failed → 必须有 rollbackTarget。
 */

import type { ArtifactMeta, ArtifactRef } from './common';

export interface ReviewDimension {
    dimension:
        | 'brief_alignment'
        | 'message_clarity'
        | 'visual_hierarchy'
        | 'asset_integrity'
        | 'brand_consistency'
        | 'commercial_effectiveness'
        | 'implementation_feasibility';
    /** 0..100 */
    score: number;
    weight: number;
    rationale: string;
}

export interface ReviewIssue {
    issueId: string;
    severity: 'blocker' | 'major' | 'minor';
    owner: 'R1' | 'R2' | 'R3' | 'R4' | 'E1';
    targetArtifactId: string;
    /** JSON Pointer */
    targetPath?: string;
    description: string;
    expectedFix: string;
    checkRefs: string[];
}

export interface ReviewReport {
    meta: ArtifactMeta;
    payload: {
        subjectRef: ArtifactRef;
        planRef: ArtifactRef;
        strategyRef: ArtifactRef;
        rubricVersion: string;
        dimensions: ReviewDimension[];
        issues: ReviewIssue[];
        overallScore: number;
        gateStatus: 'failed' | 'passed_for_user_review';
        requiredFixes: string[];
        suggestedFixes: string[];
        rollbackTarget?: {
            runtimeUnit: 'R1' | 'R2' | 'R3' | 'R4' | 'E1';
            reason: string;
        };
        qualityPassed: boolean;
    };
}
