export type ImageToImageSelectionPayload = {
    documentName: string;
    width: number;
    height: number;
    selectionState: 'none' | 'multiple' | 'single';
    hasSelectedLayer: boolean;
    selectedLayerId: number | null;
    selectedLayerName: string;
    selectedLayerWidth: number;
    selectedLayerHeight: number;
};

export function buildImageToImageSelectionPayload(doc: any): ImageToImageSelectionPayload {
    const activeLayers = Array.isArray(doc?.activeLayers) ? doc.activeLayers : [];

    const basePayload: ImageToImageSelectionPayload = {
        documentName: doc?.title || doc?.name || '当前文档',
        width: Number(doc?.width) || 0,
        height: Number(doc?.height) || 0,
        selectionState: 'none',
        hasSelectedLayer: false,
        selectedLayerId: null,
        selectedLayerName: '',
        selectedLayerWidth: 0,
        selectedLayerHeight: 0
    };

    if (!doc) {
        return basePayload;
    }

    if (activeLayers.length !== 1) {
        return {
            ...basePayload,
            selectionState: activeLayers.length > 1 ? 'multiple' : 'none'
        };
    }

    const selectedLayer = activeLayers[0];
    const selectedLayerBounds = selectedLayer?.boundsNoEffects || selectedLayer?.bounds || null;
    const selectedLayerWidth = selectedLayerBounds
        ? Math.max(0, Number(selectedLayerBounds.right) - Number(selectedLayerBounds.left))
        : 0;
    const selectedLayerHeight = selectedLayerBounds
        ? Math.max(0, Number(selectedLayerBounds.bottom) - Number(selectedLayerBounds.top))
        : 0;

    return {
        ...basePayload,
        selectionState: 'single',
        hasSelectedLayer: true,
        selectedLayerId: selectedLayer?.id ?? null,
        selectedLayerName: selectedLayer?.name || '',
        selectedLayerWidth,
        selectedLayerHeight
    };
}

export function buildImageToImageSelectionSignature(payload: ImageToImageSelectionPayload): string {
    return [
        payload.selectionState,
        payload.selectedLayerId ?? 'none',
        payload.selectedLayerName,
        payload.selectedLayerWidth,
        payload.selectedLayerHeight
    ].join('|');
}
