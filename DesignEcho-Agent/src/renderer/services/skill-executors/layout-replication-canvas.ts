export type LayoutReplicationAutoCanvasProfile = 'detail-template' | 'reference-replication';

export type LayoutReplicationAutoCanvasInput = {
    params?: Record<string, any>;
    referenceCanvas?: {
        width?: unknown;
        height?: unknown;
    } | null;
    fallback: {
        width: number;
        height: number;
    };
    minSize?: {
        width: number;
        height: number;
    };
    profile?: LayoutReplicationAutoCanvasProfile;
};

export type LayoutReplicationAutoCanvasSize = {
    width: number;
    height: number;
    source: 'explicit' | 'reference' | 'default';
};

function toPositiveInt(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return Math.max(1, Math.round(numeric));
}

function shouldPreserveReferenceCanvas(params: Record<string, any>): boolean {
    if (params.preserveReferenceCanvasSize === true) return true;
    if (params.matchReferenceCanvasSize === true) return true;
    const outputMode = String(params.outputMode || '').trim().toLowerCase();
    return outputMode === 'reference_canvas' || outputMode === 'match_reference';
}

export function resolveLayoutReplicationAutoCanvasSize(
    input: LayoutReplicationAutoCanvasInput
): LayoutReplicationAutoCanvasSize {
    const params = input.params || {};
    const fallbackWidth = toPositiveInt(input.fallback.width) || 1242;
    const fallbackHeight = toPositiveInt(input.fallback.height) || 3600;
    const referenceWidth = toPositiveInt(input.referenceCanvas?.width);
    const referenceHeight = toPositiveInt(input.referenceCanvas?.height);
    const explicitWidth = toPositiveInt(params.outputWidth ?? params.width);
    const explicitHeight = toPositiveInt(params.outputHeight ?? params.height);

    if (explicitWidth || explicitHeight) {
        return {
            width: explicitWidth || referenceWidth || fallbackWidth,
            height: explicitHeight || referenceHeight || fallbackHeight,
            source: 'explicit'
        };
    }

    if ((shouldPreserveReferenceCanvas(params) || input.profile === 'reference-replication')
        && referenceWidth
        && referenceHeight) {
        return {
            width: referenceWidth,
            height: referenceHeight,
            source: 'reference'
        };
    }

    const defaultMin = input.profile === 'reference-replication'
        ? { width: 1, height: 1 }
        : { width: 800, height: 1200 };
    const minSize = input.minSize || defaultMin;

    return {
        width: Math.max(minSize.width, referenceWidth || fallbackWidth),
        height: Math.max(minSize.height, referenceHeight || fallbackHeight),
        source: 'default'
    };
}
