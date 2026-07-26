import type { ParsedScreen } from './detail-page.types';

type LayoutNodeKind = 'copy' | 'image' | 'icon';
type AlignmentMode = 'left' | 'center' | 'right';

export interface DetailLayoutNode {
    layerId: number;
    layerName: string;
    kind: LayoutNodeKind;
    role?: string;
    zone?: string;
    bounds: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
    normalized: {
        left: number;
        top: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
    };
}

export interface DetailAlignmentGroup {
    mode: AlignmentMode;
    value: number;
    layerIds: number[];
}

export interface DetailGapMetric {
    axis: 'horizontal' | 'vertical';
    fromLayerId: number;
    toLayerId: number;
    gap: number;
    normalizedGap: number;
}

export interface DetailScreenLayoutGraph {
    screenId: number;
    screenName: string;
    screenType: string;
    nodeCount: number;
    nodes: DetailLayoutNode[];
    alignmentGroups: DetailAlignmentGroup[];
    gaps: DetailGapMetric[];
    density: number;
    balanceScore: number;
    imageAreaRatio: number;
    copyAreaRatio: number;
}

function normalizeBounds(bounds: any, screenWidth: number, screenHeight: number) {
    const left = Number(bounds?.left || 0);
    const top = Number(bounds?.top || 0);
    const width = Number(bounds?.width || Math.max(0, Number(bounds?.right || 0) - left));
    const height = Number(bounds?.height || Math.max(0, Number(bounds?.bottom || 0) - top));
    const right = Number(bounds?.right || left + width);
    const bottom = Number(bounds?.bottom || top + height);
    const safeWidth = Math.max(1, screenWidth);
    const safeHeight = Math.max(1, screenHeight);
    return {
        bounds: { left, top, right, bottom, width, height },
        normalized: {
            left: left / safeWidth,
            top: top / safeHeight,
            width: width / safeWidth,
            height: height / safeHeight,
            centerX: (left + width / 2) / safeWidth,
            centerY: (top + height / 2) / safeHeight
        }
    };
}

function clusterAlignment(nodes: DetailLayoutNode[], mode: AlignmentMode): DetailAlignmentGroup[] {
    const keyOf = (node: DetailLayoutNode) => {
        if (mode === 'left') return node.normalized.left;
        if (mode === 'right') return node.normalized.left + node.normalized.width;
        return node.normalized.centerX;
    };
    const sorted = [...nodes].sort((a, b) => keyOf(a) - keyOf(b));
    const groups: DetailAlignmentGroup[] = [];
    const threshold = 0.02;

    for (const node of sorted) {
        const value = keyOf(node);
        const existing = groups.find((group) => Math.abs(group.value - value) <= threshold);
        if (existing) {
            existing.layerIds.push(node.layerId);
            existing.value = (existing.value + value) / 2;
        } else {
            groups.push({ mode, value, layerIds: [node.layerId] });
        }
    }

    return groups.filter((group) => group.layerIds.length >= 2);
}

function collectGapMetrics(nodes: DetailLayoutNode[], screenWidth: number, screenHeight: number): DetailGapMetric[] {
    const metrics: DetailGapMetric[] = [];
    const vertical = [...nodes].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
    for (let i = 1; i < vertical.length; i++) {
        const prev = vertical[i - 1];
        const next = vertical[i];
        const gap = Math.max(0, next.bounds.top - prev.bounds.bottom);
        metrics.push({
            axis: 'vertical',
            fromLayerId: prev.layerId,
            toLayerId: next.layerId,
            gap,
            normalizedGap: gap / Math.max(1, screenHeight)
        });
    }

    const horizontal = [...nodes].sort((a, b) => a.bounds.left - b.bounds.left || a.bounds.top - b.bounds.top);
    for (let i = 1; i < horizontal.length; i++) {
        const prev = horizontal[i - 1];
        const next = horizontal[i];
        const gap = Math.max(0, next.bounds.left - prev.bounds.right);
        metrics.push({
            axis: 'horizontal',
            fromLayerId: prev.layerId,
            toLayerId: next.layerId,
            gap,
            normalizedGap: gap / Math.max(1, screenWidth)
        });
    }
    return metrics;
}

function computeBalanceScore(nodes: DetailLayoutNode[]): number {
    if (nodes.length === 0) return 0;
    const visualWeight = nodes.map((node) => {
        const area = node.normalized.width * node.normalized.height;
        return { x: node.normalized.centerX, y: node.normalized.centerY, weight: area };
    });
    const totalWeight = visualWeight.reduce((sum, item) => sum + item.weight, 0) || 1;
    const centerX = visualWeight.reduce((sum, item) => sum + item.x * item.weight, 0) / totalWeight;
    const centerY = visualWeight.reduce((sum, item) => sum + item.y * item.weight, 0) / totalWeight;
    const dx = Math.abs(centerX - 0.5);
    const dy = Math.abs(centerY - 0.5);
    return Math.max(0, 1 - (dx * 1.4 + dy * 1.1));
}

export function buildDetailPageLayoutGraphs(screens: ParsedScreen[]): DetailScreenLayoutGraph[] {
    return (screens || []).map((screen) => {
        const screenWidth = Number(screen.bounds?.width || 1);
        const screenHeight = Number(screen.bounds?.height || 1);
        const nodes: DetailLayoutNode[] = [];

        for (const copy of screen.copyPlaceholders || []) {
            const normalized = normalizeBounds(copy.bounds, screenWidth, screenHeight);
            nodes.push({
                layerId: copy.layerId,
                layerName: copy.layerName,
                kind: 'copy',
                role: copy.role,
                zone: copy.zone,
                ...normalized
            });
        }

        for (const image of screen.imagePlaceholders || []) {
            const normalized = normalizeBounds(image.bounds, screenWidth, screenHeight);
            nodes.push({
                layerId: image.layerId,
                layerName: image.layerName,
                kind: 'image',
                zone: image.zone,
                ...normalized
            });
        }

        const iconPlaceholders = (screen as any).iconPlaceholders || [];
        for (const icon of iconPlaceholders) {
            const normalized = normalizeBounds(icon.bounds, screenWidth, screenHeight);
            nodes.push({
                layerId: icon.layerId,
                layerName: icon.layerName,
                kind: 'icon',
                zone: icon.zone,
                ...normalized
            });
        }

        const alignmentGroups = [
            ...clusterAlignment(nodes, 'left'),
            ...clusterAlignment(nodes, 'center'),
            ...clusterAlignment(nodes, 'right')
        ];

        const gaps = collectGapMetrics(nodes, screenWidth, screenHeight);
        const totalArea = nodes.reduce((sum, node) => sum + node.bounds.width * node.bounds.height, 0);
        const imageArea = nodes.filter((node) => node.kind === 'image').reduce((sum, node) => sum + node.bounds.width * node.bounds.height, 0);
        const copyArea = nodes.filter((node) => node.kind === 'copy').reduce((sum, node) => sum + node.bounds.width * node.bounds.height, 0);
        const screenArea = Math.max(1, screenWidth * screenHeight);

        return {
            screenId: screen.id,
            screenName: screen.name,
            screenType: screen.type,
            nodeCount: nodes.length,
            nodes,
            alignmentGroups,
            gaps,
            density: Math.max(0, Math.min(1, totalArea / screenArea)),
            balanceScore: computeBalanceScore(nodes),
            imageAreaRatio: Math.max(0, Math.min(1, imageArea / screenArea)),
            copyAreaRatio: Math.max(0, Math.min(1, copyArea / screenArea))
        };
    });
}
