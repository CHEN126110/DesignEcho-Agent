/**
 * 详情页模板解析与填充计划的共享类型。
 */

import type { DetailScreenPlan, DetailScreenRole } from '../../../shared/detail-page-screen-plan';
import type { PlacementPlan, PlacementTransform } from '../../../shared/reference-replication-placement';
import type { SmartScalingDecision } from '../../../shared/design-smart-scaling-policy';
export type { DetailScreenPlan, DetailScreenRole } from '../../../shared/detail-page-screen-plan';

export interface ParsedScreen {
    id: number;
    name: string;
    type: string;
    bounds: { top: number; left: number; bottom: number; right: number; width: number; height: number };
    copyPlaceholders: CopyPlaceholder[];
    imagePlaceholders: ImagePlaceholder[];
    order: number;
    structure?: {
        hasCopyGroup: boolean;
        hasIconGroup: boolean;
        hasImageGroup: boolean;
        missingGroups: Array<'文案' | 'icon' | '图片'>;
        recognizedGroups: string[];
    };
}

export interface CopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    role: string;
    fontSize?: number;
    bounds: any;
    zone?: 'copy' | 'icon' | 'image' | 'unknown';
}

export interface ImagePlaceholder {
    layerId: number;
    layerName: string;
    bounds: any;
    baseLayerId?: number;
    baseLayerName?: string;
    isClippingMask: boolean;
    clippingInfo?: {
        isClipped: boolean;
        baseLayerId: number;
        baseBounds?: any;
    };
    recommendedAssetType: string;
    aspectRatio: number;
    zone?: 'copy' | 'icon' | 'image' | 'unknown';
    placementPlan?: PlacementPlan;
}

export interface LayerIssue {
    type: string;
    severity: string;
    layerId: number;
    layerName: string;
    description: string;
    autoFixable: boolean;
}

export interface FillPlan {
    screenId: number;
    screenName: string;
    screenType: string;
    screenRole?: DetailScreenRole;
    imageStrategy?: DetailScreenPlan['imageStrategy'];
    copyStrategy?: DetailScreenPlan['copyStrategy'];
    mainMessage?: string;
    supportingPoints?: string[];
    /** 从 screen plan 传递的稳定事实引用；不能包含事实原文或路径。 */
    supportRefs?: string[];
    confidence?: number;
    needsReview?: boolean;
    decisionBoundary?: {
        screenDecisionSource: string;
        requiresModelDecision: boolean;
        assetSelectionSource: string;
        note: string;
    };
    copyAudit?: {
        status: 'ok' | 'watch' | 'risky';
        warningCount: number;
        riskyPlaceholderCount: number;
        watchPlaceholderCount: number;
        warnings: string[];
        placeholderAudits?: Array<{
            placeholderLayerId: number;
            status: 'ok' | 'watch' | 'risky';
            warnings: string[];
        }>;
    };
    copies: {
        layerId: number;
        layerName?: string;
        content: string;
        source?: 'template' | 'ai_generated' | 'knowledge' | 'user_input' | 'hybrid';
        originalText?: string;
        copyStrategy?: DetailScreenPlan['copyStrategy'];
        mainMessage?: string;
        supportingPoints?: string[];
        generationStatus?: 'template' | 'generated' | 'failed';
        generationReason?: string;
    }[];
    images: {
        layerId: number;
        layerName?: string;
        imagePath: string;
        fillMode: string;
        assetType?: string;
        needsMatting?: boolean;
        subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
        fitReason?: string;
        isClippingMask?: boolean;
        baseLayerId?: number;
        referenceLayerId?: number;
        targetBounds?: {
            left: number;
            top: number;
            right: number;
            bottom: number;
            width?: number;
            height?: number;
        };
        zone?: 'copy' | 'icon' | 'image' | 'unknown';
        placementPlan?: PlacementPlan;
        placementTransform?: PlacementTransform;
        smartScalingDecision?: SmartScalingDecision;
    }[];
}

export interface PlanQuality {
    confidence: number;
    score: number;
    imageTotal: number;
    imageMatched: number;
    imageCoverage: number;
    copyTotal: number;
    copyNonEmpty: number;
    copyCoverage: number;
}

export interface PlanExecutionTrace {
    tool: string;
    status: 'planned' | 'success' | 'failed' | 'skipped' | 'partial' | 'fallback';
    reason?: string;
    details?: string;
}
