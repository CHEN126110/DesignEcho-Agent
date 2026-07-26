/**
 * ContextSnapshot — 所有者：R2 Context Intelligence
 * 只描述「我们目前知道什么」；禁止文案策略 / 风格决策 / 布局 / 坐标 / Photoshop 操作。
 */

import type {
    ArtifactMeta,
    ArtifactRef,
    ContextFact,
    AssetContext,
    MissingInput,
    Assumption
} from './common';

export interface ContextSnapshot {
    meta: ArtifactMeta;
    payload: {
        briefRef: ArtifactRef;
        product: {
            category?: string;
            name?: string;
            facts: ContextFact[];
            visibleFeatures: ContextFact[];
        };
        assets: AssetContext[];
        audience: {
            segments: string[];
            needs: ContextFact[];
            painPoints: ContextFact[];
            purchaseObjections: ContextFact[];
        };
        market: {
            expressionPatterns: ContextFact[];
            opportunitySignals: ContextFact[];
        };
        constraints: {
            requiredElements: string[];
            forbiddenElements: string[];
            platformRules: string[];
            brandRules: string[];
        };
        missingInputs: MissingInput[];
        assumptions: Assumption[];
    };
}
