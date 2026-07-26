export type PlacementScaleMode =
    | 'contain'
    | 'cover'
    | 'focus-safe'
    | 'fit-width'
    | 'fit-height';

export type PlacementAnchor =
    | 'center'
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right';

export type PlacementCropPolicy =
    | 'none'
    | 'allow-crop'
    | 'avoid-crop'
    | 'protect-subject';

export type PlacementAssetKind =
    | 'product'
    | 'model'
    | 'detail'
    | 'scene'
    | 'icon'
    | 'unknown';

export interface PlacementBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PlacementAssetSize {
    width: number;
    height: number;
    subjectBox?: PlacementBox;
}

export interface PlacementPolicy {
    assetKind: PlacementAssetKind;
    scaleMode: PlacementScaleMode;
    anchor: PlacementAnchor;
    cropPolicy: PlacementCropPolicy;
    preserveSubject: boolean;
    preserveEdges: boolean;
}

export interface PlacementPlan {
    elementId: string;
    targetBox: PlacementBox;
    safeBox?: PlacementBox;
    policy: PlacementPolicy;
    transform?: PlacementTransform;
    notes?: string[];
}

export interface PlacementTransform {
    sourceSize: {
        width: number;
        height: number;
    };
    destinationBox: PlacementBox;
    visibleBox: PlacementBox;
    scale: number;
    scaleX: number;
    scaleY: number;
    anchor: PlacementAnchor;
    scaleMode: PlacementScaleMode;
    cropRisk: boolean;
    subjectVisible?: boolean;
    notes: string[];
}

function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function normalizeBox(box: PlacementBox): PlacementBox {
    return {
        x: Number.isFinite(Number(box.x)) ? Number(box.x) : 0,
        y: Number.isFinite(Number(box.y)) ? Number(box.y) : 0,
        width: Math.max(1, Number.isFinite(Number(box.width)) ? Number(box.width) : 1),
        height: Math.max(1, Number.isFinite(Number(box.height)) ? Number(box.height) : 1)
    };
}

function intersectBox(a: PlacementBox, b: PlacementBox): PlacementBox {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
}

function containsBox(outer: PlacementBox, inner: PlacementBox): boolean {
    return inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height;
}

function resolveEffectiveScaleMode(policy: PlacementPolicy, hasSubjectBox: boolean): PlacementScaleMode {
    if (policy.scaleMode !== 'focus-safe') {
        return policy.scaleMode;
    }

    const mustAvoidCrop = policy.preserveEdges
        || policy.cropPolicy === 'avoid-crop'
        || (policy.cropPolicy === 'protect-subject' && !hasSubjectBox);

    return mustAvoidCrop ? 'contain' : 'cover';
}

function calculateScale(
    source: { width: number; height: number },
    target: PlacementBox,
    scaleMode: PlacementScaleMode
): number {
    const widthScale = target.width / source.width;
    const heightScale = target.height / source.height;
    if (scaleMode === 'cover') return Math.max(widthScale, heightScale);
    if (scaleMode === 'fit-width') return widthScale;
    if (scaleMode === 'fit-height') return heightScale;
    return Math.min(widthScale, heightScale);
}

function anchorDestinationBox(
    target: PlacementBox,
    size: { width: number; height: number },
    anchor: PlacementAnchor
): PlacementBox {
    let x = target.x + (target.width - size.width) / 2;
    let y = target.y + (target.height - size.height) / 2;

    if (anchor.includes('left')) x = target.x;
    if (anchor.includes('right')) x = target.x + target.width - size.width;
    if (anchor === 'left') x = target.x;
    if (anchor === 'right') x = target.x + target.width - size.width;

    if (anchor.includes('top')) y = target.y;
    if (anchor.includes('bottom')) y = target.y + target.height - size.height;
    if (anchor === 'top') y = target.y;
    if (anchor === 'bottom') y = target.y + target.height - size.height;

    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(size.width),
        height: Math.round(size.height)
    };
}

function transformSubjectBox(destination: PlacementBox, scale: number, subjectBox?: PlacementBox): PlacementBox | undefined {
    if (!subjectBox) return undefined;
    const subject = normalizeBox(subjectBox);
    return {
        x: destination.x + subject.x * scale,
        y: destination.y + subject.y * scale,
        width: subject.width * scale,
        height: subject.height * scale
    };
}

export function buildDefaultPlacementPolicy(assetKind: PlacementAssetKind): PlacementPolicy {
    if (assetKind === 'icon') {
        return {
            assetKind,
            scaleMode: 'contain',
            anchor: 'center',
            cropPolicy: 'avoid-crop',
            preserveSubject: false,
            preserveEdges: true
        };
    }

    if (assetKind === 'scene') {
        return {
            assetKind,
            scaleMode: 'cover',
            anchor: 'center',
            cropPolicy: 'allow-crop',
            preserveSubject: false,
            preserveEdges: false
        };
    }

    if (assetKind === 'detail') {
        return {
            assetKind,
            scaleMode: 'contain',
            anchor: 'center',
            cropPolicy: 'protect-subject',
            preserveSubject: true,
            preserveEdges: true
        };
    }

    return {
        assetKind,
        scaleMode: 'focus-safe',
        anchor: 'center',
        cropPolicy: 'protect-subject',
        preserveSubject: true,
        preserveEdges: true
    };
}

export function buildPlacementPlan(input: {
    elementId: string;
    targetBox: PlacementBox;
    assetKind: PlacementAssetKind;
    safeBox?: PlacementBox;
    sourceSize?: PlacementAssetSize;
    notes?: string[];
}): PlacementPlan {
    const policy = buildDefaultPlacementPolicy(input.assetKind);
    const normalizedTargetBox = normalizeBox(input.targetBox);
    const normalizedSafeBox = input.safeBox ? normalizeBox(input.safeBox) : undefined;
    const transform = input.sourceSize
        ? computePlacementTransform({
            targetBox: normalizedTargetBox,
            safeBox: normalizedSafeBox,
            policy
        }, input.sourceSize)
        : undefined;

    return {
        elementId: input.elementId,
        targetBox: normalizedTargetBox,
        safeBox: normalizedSafeBox,
        policy,
        transform,
        notes: input.notes
    };
}

export function computePlacementTransform(
    plan: Pick<PlacementPlan, 'targetBox' | 'safeBox' | 'policy'>,
    sourceSize: PlacementAssetSize
): PlacementTransform {
    const targetBox = normalizeBox(plan.safeBox || plan.targetBox);
    const source = {
        width: Math.max(1, Number(sourceSize.width) || 1),
        height: Math.max(1, Number(sourceSize.height) || 1)
    };
    const policy = plan.policy || buildDefaultPlacementPolicy('unknown');
    const notes: string[] = [];

    const effectiveScaleMode = resolveEffectiveScaleMode(policy, !!sourceSize.subjectBox);
    if (effectiveScaleMode !== policy.scaleMode) {
        notes.push(`scaleMode ${policy.scaleMode} resolved to ${effectiveScaleMode}`);
    }

    const rawScale = calculateScale(source, targetBox, effectiveScaleMode);
    const scale = clampNumber(rawScale, 0.001, 1000);
    const destinationBox = anchorDestinationBox(
        targetBox,
        {
            width: source.width * scale,
            height: source.height * scale
        },
        policy.anchor
    );
    const visibleBox = intersectBox(destinationBox, targetBox);
    const hasCrop = visibleBox.width < destinationBox.width || visibleBox.height < destinationBox.height;
    const subjectDestinationBox = transformSubjectBox(destinationBox, scale, sourceSize.subjectBox);
    const subjectVisible = subjectDestinationBox ? containsBox(targetBox, subjectDestinationBox) : undefined;

    let cropRisk = hasCrop && policy.cropPolicy !== 'allow-crop';
    if (policy.cropPolicy === 'protect-subject' && subjectDestinationBox && !subjectVisible) {
        cropRisk = true;
        notes.push('subjectBox is not fully visible in target box');
    }
    if (hasCrop && policy.cropPolicy === 'avoid-crop') {
        notes.push('crop detected while cropPolicy is avoid-crop');
    }
    if (policy.cropPolicy === 'protect-subject' && !sourceSize.subjectBox) {
        notes.push('protect-subject requested but no subjectBox was provided');
    }

    return {
        sourceSize: source,
        destinationBox,
        visibleBox,
        scale,
        scaleX: scale,
        scaleY: scale,
        anchor: policy.anchor,
        scaleMode: effectiveScaleMode,
        cropRisk,
        subjectVisible,
        notes
    };
}
