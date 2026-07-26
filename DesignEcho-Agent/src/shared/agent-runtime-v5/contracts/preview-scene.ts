/**
 * PreviewScene — 所有者：E1 Production Executor
 * 桌面预览的中间表示（像素坐标）；不是 React 组件树、不是 Photoshop Task。
 * 边界：不出现 React 组件名 / Photoshop 图层名 / Adobe API / tool_id。
 */

import type { ArtifactMeta, ArtifactRef } from './common';

export interface PreviewNode {
    nodeId: string;
    nodeType: 'text' | 'image' | 'shape' | 'icon' | 'group';
    role: string;
    boundsPx: { x: number; y: number; width: number; height: number };
    zIndex: number;
    visible: boolean;
    content?: string;
    assetId?: string;
    styleTokenRefs: string[];
}

export interface PreviewScreen {
    screenId: string;
    order: number;
    boundsPx: { x: number; y: number; width: number; height: number };
    groups: {
        copy: PreviewNode[];
        elements: PreviewNode[];
        images: PreviewNode[];
    };
}

export interface PreviewArtifact {
    artifactType: 'storyboard_png' | 'screen_png' | 'main_preview_png';
    path: string;
    sha256: string;
    width: number;
    height: number;
}

export interface PreviewScene {
    meta: ArtifactMeta;
    payload: {
        planRef: ArtifactRef;
        versionId: string;
        sceneType: 'detail_page_storyboard' | 'main_image_variant' | 'sku_card';
        renderTarget: {
            width: number;
            height: number;
            pixelRatio: number;
            background: string;
        };
        screens: PreviewScreen[];
        assetRefs: string[];
        artifacts: PreviewArtifact[];
        renderStatus: 'rendered' | 'failed';
        warnings: string[];
    };
}
