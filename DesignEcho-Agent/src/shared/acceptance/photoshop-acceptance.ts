import {
    readPhotoshopHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../photoshop-history-state-ref';

export interface AcceptanceBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface AcceptanceTextStyle {
    fontName?: string;
    fontStyle?: string;
    fontSize?: number;
    tracking?: number;
    leading?: number;
    horizontalScale?: number;
    verticalScale?: number;
}

export interface AcceptanceLayer {
    id: number;
    name: string;
    kind: string;
    visible: boolean;
    locked: boolean;
    opacity?: number;
    blendMode?: string;
    depth: number;
    index: number;
    parentId: number | null;
    parentName: string | null;
    path: string;
    selected: boolean;
    bounds?: AcceptanceBounds;
    boundsNoEffects?: AcceptanceBounds;
    text?: {
        content: string;
        length: number;
        style?: AcceptanceTextStyle;
    };
}

export interface AcceptanceSnapshot {
    success: boolean;
    hasDocument: boolean;
    documentState?: 'present' | 'absent';
    generatedAt?: string;
    historyStateRef?: PhotoshopHistoryStateRef;
    document?: {
        id?: number;
        name?: string;
        width?: number;
        height?: number;
        resolution?: number;
        mode?: string;
    };
    selectedLayerIds?: number[];
    summary?: {
        totalLayers: number;
        selectedLayers: number;
        hiddenLayers: number;
        lockedLayers: number;
        textLayers: number;
        groupLayers: number;
        smartObjectLayers: number;
        shapeLayers: number;
        pixelLayers: number;
        truncated: boolean;
    };
    layers?: AcceptanceLayer[];
    warnings?: string[];
    error?: string;
}

export interface AcceptanceLayerChange {
    id: number;
    before?: string;
    after?: string;
    changes: string[];
}

export interface AcceptanceSnapshotDiff {
    comparable: boolean;
    issues: string[];
    addedLayerIds: number[];
    removedLayerIds: number[];
    changedLayers: AcceptanceLayerChange[];
    summary: {
        beforeLayerCount: number;
        afterLayerCount: number;
        added: number;
        removed: number;
        changed: number;
        textChanged: number;
        geometryChanged: number;
        styleChanged: number;
    };
}

export function diffAcceptanceSnapshots(
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot,
    options: { geometryTolerance?: number; allowDocumentChange?: boolean } = {}
): AcceptanceSnapshotDiff {
    const tolerance = options.geometryTolerance ?? 0.5;
    const issues: string[] = [];

    if (before.success !== true) issues.push(`before snapshot failed: ${before.error || 'unknown error'}`);
    if (after.success !== true) issues.push(`after snapshot failed: ${after.error || 'unknown error'}`);
    if (!before.hasDocument) issues.push('before snapshot has no active document');
    if (!after.hasDocument) issues.push('after snapshot has no active document');
    const beforeHistoryStateRef = validateSnapshotHostState(before, 'before', issues);
    const afterHistoryStateRef = validateSnapshotHostState(after, 'after', issues);
    if (beforeHistoryStateRef
        && afterHistoryStateRef
        && beforeHistoryStateRef.documentId !== afterHistoryStateRef.documentId
        && options.allowDocumentChange !== true) {
        issues.push(
            `snapshot document changed: before=${beforeHistoryStateRef.documentId}, after=${afterHistoryStateRef.documentId}`
        );
    }

    const beforeLayers = Array.isArray(before.layers) ? before.layers : [];
    const afterLayers = Array.isArray(after.layers) ? after.layers : [];
    const beforeMap = new Map(beforeLayers.map((layer) => [layer.id, layer]));
    const afterMap = new Map(afterLayers.map((layer) => [layer.id, layer]));

    const addedLayerIds = afterLayers
        .filter((layer) => !beforeMap.has(layer.id))
        .map((layer) => layer.id);
    const removedLayerIds = beforeLayers
        .filter((layer) => !afterMap.has(layer.id))
        .map((layer) => layer.id);

    const changedLayers: AcceptanceLayerChange[] = [];
    for (const beforeLayer of beforeLayers) {
        const afterLayer = afterMap.get(beforeLayer.id);
        if (!afterLayer) continue;

        const changes = collectLayerChanges(beforeLayer, afterLayer, tolerance);
        if (changes.length > 0) {
            changedLayers.push({
                id: beforeLayer.id,
                before: beforeLayer.path || beforeLayer.name,
                after: afterLayer.path || afterLayer.name,
                changes
            });
        }
    }

    const textChanged = changedLayers.filter((layer) => layer.changes.includes('text')).length;
    const geometryChanged = changedLayers.filter((layer) => layer.changes.includes('geometry')).length;
    const styleChanged = changedLayers.filter((layer) => layer.changes.includes('style')).length;
    const changedTotal = addedLayerIds.length + removedLayerIds.length + changedLayers.length;
    if (changedTotal > 0
        && samePhotoshopHistoryStateRef(beforeHistoryStateRef, afterHistoryStateRef)) {
        issues.push('snapshot state contradiction: structure changed while historyStateRef stayed identical');
    }

    return {
        comparable: issues.length === 0,
        issues,
        addedLayerIds,
        removedLayerIds,
        changedLayers,
        summary: {
            beforeLayerCount: beforeLayers.length,
            afterLayerCount: afterLayers.length,
            added: addedLayerIds.length,
            removed: removedLayerIds.length,
            changed: changedLayers.length,
            textChanged,
            geometryChanged,
            styleChanged
        }
    };
}

function validateSnapshotHostState(
    snapshot: AcceptanceSnapshot,
    label: 'before' | 'after',
    issues: string[]
): PhotoshopHistoryStateRef | undefined {
    if (snapshot.hasDocument !== true) return undefined;
    const historyStateRef = readPhotoshopHistoryStateRef(snapshot);
    if (!historyStateRef) {
        issues.push(`${label} snapshot is missing Photoshop historyStateRef`);
        return undefined;
    }
    const documentId = Number(snapshot.document?.id);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) {
        issues.push(`${label} snapshot is missing a valid document.id`);
    } else if (documentId !== historyStateRef.documentId) {
        issues.push(
            `${label} snapshot document.id=${documentId} does not match historyStateRef.documentId=${historyStateRef.documentId}`
        );
    }
    if (snapshot.summary?.truncated === true) {
        issues.push(`${label} snapshot layer coverage is truncated`);
    }
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    if (warnings.some((warning) => /截断|跳过失效图层/.test(String(warning)))) {
        issues.push(`${label} snapshot layer coverage is incomplete`);
    }
    return historyStateRef;
}

function collectLayerChanges(before: AcceptanceLayer, after: AcceptanceLayer, tolerance: number): string[] {
    const changes = new Set<string>();

    if (before.name !== after.name || before.path !== after.path || before.parentId !== after.parentId || before.index !== after.index) {
        changes.add('structure');
    }
    if (before.visible !== after.visible || before.locked !== after.locked || before.opacity !== after.opacity || before.blendMode !== after.blendMode) {
        changes.add('style');
    }
    if (!boundsEqual(before.boundsNoEffects || before.bounds, after.boundsNoEffects || after.bounds, tolerance)) {
        changes.add('geometry');
    }
    if ((before.text?.content || '') !== (after.text?.content || '')) {
        changes.add('text');
    }
    if (!styleEqual(before.text?.style, after.text?.style, tolerance)) {
        changes.add('style');
    }

    return Array.from(changes);
}

function boundsEqual(before?: AcceptanceBounds, after?: AcceptanceBounds, tolerance = 0.5): boolean {
    if (!before && !after) return true;
    if (!before || !after) return false;
    return ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) => {
        return Math.abs((before as any)[key] - (after as any)[key]) <= tolerance;
    });
}

function styleEqual(before?: AcceptanceTextStyle, after?: AcceptanceTextStyle, tolerance = 0.5): boolean {
    if (!before && !after) return true;
    if (!before || !after) return false;

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
        const beforeValue = (before as any)[key];
        const afterValue = (after as any)[key];
        if (typeof beforeValue === 'number' || typeof afterValue === 'number') {
            if (Math.abs(Number(beforeValue || 0) - Number(afterValue || 0)) > tolerance) {
                return false;
            }
            continue;
        }
        if (String(beforeValue || '') !== String(afterValue || '')) {
            return false;
        }
    }
    return true;
}
