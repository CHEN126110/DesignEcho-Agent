/**
 * DetailPagePlan — 所有者：R4 Layout Planning
 * 坐标规则：DetailPagePlan 用归一化坐标 0..1；PreviewScene 才转像素；PhotoshopTaskPlan 用 slot 映射，不复用 UI 节点坐标。
 */

import type {
    ArtifactMeta,
    ArtifactRef,
    MissingInput,
    DetailPageModuleType,
    ModulePriority,
    ImageSlotPlan,
    ElementPlan,
    LayoutRegion
} from './common';

export interface DetailPageScreen {
    screenId: string;
    order: number;
    moduleType: DetailPageModuleType;
    intent: string;
    priority: ModulePriority;
    copy: {
        title: string;
        subtitle?: string;
        body?: string;
        tags?: string[];
    };
    images: ImageSlotPlan[];
    elements: ElementPlan[];
    layout: {
        compositionType: string;
        /** 归一化区域 0..1 */
        normalizedRegions: LayoutRegion[];
        readingOrder: string[];
    };
    sourceRefs: string[];
    constraints: string[];
    missingInputs: string[];
}

export interface DetailPagePlan {
    meta: ArtifactMeta;
    payload: {
        contextSnapshotRef: ArtifactRef;
        creativeStrategyRef: ArtifactRef;
        variantId: string;
        selectedTemplateFamily: string;
        canvas: {
            width: number;
            unit: 'px';
            targetScreenWidth: number;
            defaultScreenHeight: number;
        };
        globalRules: {
            gridColumns: number;
            safeMarginRatio: number;
            spacingScale: number[];
            readingDirection: 'top_to_bottom';
        };
        screens: DetailPageScreen[];
        missingInputs: MissingInput[];
        planStatus: 'draft' | 'ready_for_preview' | 'blocked_missing_input';
    };
}
