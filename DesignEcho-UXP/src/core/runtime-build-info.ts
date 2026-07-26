export const PHOTOSHOP_RUNTIME_BUILD_ID = 'photoshop-tool-stability/v1';

export const PHOTOSHOP_RUNTIME_FEATURES = [
    'diagnoseState.runtimeInfo',
    'getSubjectBounds.smartLayerKindGuard',
    'getSubjectBounds.avoidsEmptySelectionDeselect',
    'selectionRead.noDialogSynchronousBatchPlay',
    'adjustmentLayers.noDialogSynchronousMake',
    'toolFailures.normalized',
    'createDocument.readbackCandidateValidation',
    'toolErrorNormalizer.fontUnavailableCategory',
    'saveDocument.rasterExportUsesJsx'
] as const;

const loadedAt = new Date().toISOString();

export function getPhotoshopRuntimeBuildInfo(): {
    buildId: string;
    loadedAt: string;
    features: string[];
} {
    return {
        buildId: PHOTOSHOP_RUNTIME_BUILD_ID,
        loadedAt,
        features: [...PHOTOSHOP_RUNTIME_FEATURES]
    };
}
