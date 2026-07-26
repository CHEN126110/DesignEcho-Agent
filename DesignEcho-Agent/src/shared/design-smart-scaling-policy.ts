export type SmartScalingDesignType =
    | 'main-image'
    | 'detail-page'
    | 'sku'
    | 'reference-replication'
    | 'poster'
    | 'banner'
    | 'generic';

export type SmartScalingAssetRole =
    | 'product'
    | 'model'
    | 'detail'
    | 'scene'
    | 'icon'
    | 'background'
    | 'group'
    | 'unknown';

export type SmartScalingIntent =
    | 'hero'
    | 'supporting'
    | 'thumbnail'
    | 'full-bleed'
    | 'fit-slot'
    | 'compare-grid';

export type SmartScalingAnchor =
    | 'center'
    | 'top-center'
    | 'bottom-center'
    | 'left-center'
    | 'right-center';

export type SmartScalingCropPolicy = 'avoid-crop' | 'protect-subject' | 'allow-crop';
export type SmartScalingMode = 'contain' | 'cover';
export type SmartScalingRisk = 'none' | 'low' | 'medium' | 'high';

export interface SmartScalingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SmartScalingSize {
    width: number;
    height: number;
}

export interface SmartScalingPreset {
    scaleMode: SmartScalingMode;
    targetFill: number;
    minFill: number;
    maxFill: number;
    anchor: SmartScalingAnchor;
    cropPolicy: SmartScalingCropPolicy;
    visualBiasY: number;
    preserveSubject: boolean;
    minScale: number;
    maxScale: number;
}

export interface SmartScalingInput {
    canvas: SmartScalingSize;
    source: SmartScalingSize;
    subjectBox?: SmartScalingBox;
    targetBox?: SmartScalingBox;
    safeBox?: SmartScalingBox;
    designType?: SmartScalingDesignType;
    assetRole?: SmartScalingAssetRole;
    intent?: SmartScalingIntent;
    presetOverride?: Partial<SmartScalingPreset>;
}

export interface SmartScalingDecision {
    scale: number;
    scalePercent: number;
    destinationBox: SmartScalingBox;
    subjectDestinationBox: SmartScalingBox;
    targetBox: SmartScalingBox;
    sourceBox: SmartScalingBox;
    subjectBox: SmartScalingBox;
    fillRatio: number;
    subjectVisibleRatio: number;
    cropRisk: SmartScalingRisk;
    confidence: number;
    fallbackUsed: boolean;
    reasons: string[];
    warnings: string[];
    preset: SmartScalingPreset;
}

export const DEFAULT_SMART_SCALING_PRESET: SmartScalingPreset = {
    scaleMode: 'contain',
    targetFill: 0.7,
    minFill: 0.55,
    maxFill: 0.9,
    anchor: 'center',
    cropPolicy: 'protect-subject',
    visualBiasY: 0,
    preserveSubject: true,
    minScale: 0.05,
    maxScale: 8
};

const DESIGN_PRESETS: Record<SmartScalingDesignType, Partial<SmartScalingPreset>> = {
    'main-image': {
        targetFill: 0.68,
        minFill: 0.55,
        maxFill: 0.82,
        anchor: 'center',
        cropPolicy: 'protect-subject',
        visualBiasY: 0.02
    },
    'detail-page': {
        targetFill: 0.62,
        minFill: 0.45,
        maxFill: 0.85,
        cropPolicy: 'protect-subject'
    },
    sku: {
        targetFill: 0.78,
        minFill: 0.65,
        maxFill: 0.9,
        cropPolicy: 'avoid-crop'
    },
    'reference-replication': {
        targetFill: 0.72,
        minFill: 0.5,
        maxFill: 0.9,
        cropPolicy: 'protect-subject'
    },
    poster: {
        targetFill: 0.66,
        minFill: 0.42,
        maxFill: 0.95,
        cropPolicy: 'protect-subject'
    },
    banner: {
        targetFill: 0.58,
        minFill: 0.38,
        maxFill: 0.86,
        cropPolicy: 'protect-subject'
    },
    generic: {}
};

const ROLE_PRESETS: Record<SmartScalingAssetRole, Partial<SmartScalingPreset>> = {
    product: {
        targetFill: 0.7,
        cropPolicy: 'protect-subject',
        preserveSubject: true
    },
    model: {
        targetFill: 0.74,
        cropPolicy: 'protect-subject',
        visualBiasY: 0.03
    },
    detail: {
        targetFill: 0.8,
        cropPolicy: 'avoid-crop'
    },
    scene: {
        scaleMode: 'cover',
        targetFill: 1,
        minFill: 1,
        maxFill: 1.2,
        cropPolicy: 'allow-crop',
        preserveSubject: false
    },
    icon: {
        targetFill: 0.54,
        minFill: 0.35,
        maxFill: 0.7,
        cropPolicy: 'avoid-crop'
    },
    background: {
        scaleMode: 'cover',
        targetFill: 1,
        minFill: 1,
        maxFill: 1.35,
        cropPolicy: 'allow-crop',
        preserveSubject: false
    },
    group: {
        targetFill: 0.72,
        cropPolicy: 'protect-subject'
    },
    unknown: {}
};

const INTENT_PRESETS: Record<SmartScalingIntent, Partial<SmartScalingPreset>> = {
    hero: {
        targetFill: 0.72,
        visualBiasY: 0.02,
        cropPolicy: 'protect-subject'
    },
    supporting: {
        targetFill: 0.52,
        minFill: 0.32,
        maxFill: 0.72
    },
    thumbnail: {
        targetFill: 0.78,
        minFill: 0.6,
        maxFill: 0.88,
        cropPolicy: 'avoid-crop'
    },
    'full-bleed': {
        scaleMode: 'cover',
        targetFill: 1,
        minFill: 1,
        maxFill: 1.25,
        cropPolicy: 'allow-crop'
    },
    'fit-slot': {
        targetFill: 0.86,
        minFill: 0.65,
        maxFill: 0.96,
        cropPolicy: 'protect-subject'
    },
    'compare-grid': {
        targetFill: 0.76,
        minFill: 0.62,
        maxFill: 0.88,
        cropPolicy: 'avoid-crop'
    }
};

function isFinitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function normalizeBox(box: SmartScalingBox | undefined, fallback: SmartScalingBox): SmartScalingBox {
    if (!box) return { ...fallback };
    const x = Number.isFinite(box.x) ? box.x : fallback.x;
    const y = Number.isFinite(box.y) ? box.y : fallback.y;
    const width = isFinitePositive(box.width) ? box.width : fallback.width;
    const height = isFinitePositive(box.height) ? box.height : fallback.height;
    return { x, y, width, height };
}

function intersectBox(a: SmartScalingBox, b: SmartScalingBox): SmartScalingBox | null {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function area(box: SmartScalingBox | null): number {
    return box ? Math.max(0, box.width) * Math.max(0, box.height) : 0;
}

function clampBoxToSource(box: SmartScalingBox, sourceBox: SmartScalingBox): SmartScalingBox {
    const intersection = intersectBox(box, sourceBox);
    return intersection || { ...sourceBox };
}

function resolveAnchorPoint(box: SmartScalingBox, anchor: SmartScalingAnchor, visualBiasY = 0): { x: number; y: number } {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2 + box.height * visualBiasY;
    switch (anchor) {
        case 'top-center':
            return { x: centerX, y: box.y + box.height * 0.08 + box.height * visualBiasY };
        case 'bottom-center':
            return { x: centerX, y: box.y + box.height * 0.92 + box.height * visualBiasY };
        case 'left-center':
            return { x: box.x + box.width * 0.08, y: centerY };
        case 'right-center':
            return { x: box.x + box.width * 0.92, y: centerY };
        case 'center':
        default:
            return { x: centerX, y: centerY };
    }
}

function transformBox(box: SmartScalingBox, scale: number, destinationBox: SmartScalingBox): SmartScalingBox {
    return {
        x: destinationBox.x + box.x * scale,
        y: destinationBox.y + box.y * scale,
        width: box.width * scale,
        height: box.height * scale
    };
}

function normalizePreset(preset: SmartScalingPreset): SmartScalingPreset {
    const minFill = clamp(preset.minFill, 0.05, 1.5);
    const maxFill = clamp(Math.max(preset.maxFill, minFill), minFill, 1.5);
    const targetFill = clamp(preset.targetFill, minFill, maxFill);
    const minScale = clamp(preset.minScale, 0.01, 100);
    const maxScale = Math.max(minScale, clamp(preset.maxScale, minScale, 100));
    return {
        ...preset,
        minFill,
        maxFill,
        targetFill,
        minScale,
        maxScale,
        visualBiasY: clamp(preset.visualBiasY, -0.35, 0.35)
    };
}

export function getSmartScalingPreset(input: Pick<SmartScalingInput, 'designType' | 'assetRole' | 'intent' | 'presetOverride'>): SmartScalingPreset {
    const designType = input.designType || 'generic';
    const assetRole = input.assetRole || 'unknown';
    const intent = input.intent;

    return normalizePreset({
        ...DEFAULT_SMART_SCALING_PRESET,
        ...(DESIGN_PRESETS[designType] || {}),
        ...(ROLE_PRESETS[assetRole] || {}),
        ...(intent ? INTENT_PRESETS[intent] || {} : {}),
        ...(input.presetOverride || {})
    });
}

export function computeSmartScalingDecision(input: SmartScalingInput): SmartScalingDecision {
    const warnings: string[] = [];
    const reasons: string[] = [];

    if (!isFinitePositive(input.canvas.width) || !isFinitePositive(input.canvas.height)) {
        throw new Error('Invalid canvas size for smart scaling.');
    }
    if (!isFinitePositive(input.source.width) || !isFinitePositive(input.source.height)) {
        throw new Error('Invalid source size for smart scaling.');
    }

    const sourceBox: SmartScalingBox = { x: 0, y: 0, width: input.source.width, height: input.source.height };
    const canvasBox: SmartScalingBox = { x: 0, y: 0, width: input.canvas.width, height: input.canvas.height };
    const safeBox = normalizeBox(input.safeBox, canvasBox);
    const targetBox = normalizeBox(input.targetBox, safeBox);
    const preset = getSmartScalingPreset(input);
    const rawSubjectBox = normalizeBox(input.subjectBox, sourceBox);
    const subjectBox = clampBoxToSource(rawSubjectBox, sourceBox);
    const fallbackUsed = !input.subjectBox || !input.targetBox;

    if (!input.subjectBox) {
        warnings.push('Subject bounds are missing; the full source bounds are used.');
    }
    if (!input.targetBox) {
        warnings.push('Target box is missing; the canvas safe box is used.');
    }
    if (subjectBox.width !== rawSubjectBox.width || subjectBox.height !== rawSubjectBox.height || subjectBox.x !== rawSubjectBox.x || subjectBox.y !== rawSubjectBox.y) {
        warnings.push('Subject bounds were clipped to the source image bounds.');
    }

    const widthScale = targetBox.width * preset.targetFill / subjectBox.width;
    const heightScale = targetBox.height * preset.targetFill / subjectBox.height;
    const unclampedScale = preset.scaleMode === 'cover'
        ? Math.max(widthScale, heightScale)
        : Math.min(widthScale, heightScale);
    const scale = clamp(unclampedScale, preset.minScale, preset.maxScale);

    if (Math.abs(scale - unclampedScale) > 0.0001) {
        warnings.push('Scale was clamped by preset minScale/maxScale.');
    }

    const targetAnchor = resolveAnchorPoint(targetBox, preset.anchor, preset.visualBiasY);
    const subjectAnchor = resolveAnchorPoint(subjectBox, preset.anchor, 0);
    const destinationBox: SmartScalingBox = {
        x: targetAnchor.x - subjectAnchor.x * scale,
        y: targetAnchor.y - subjectAnchor.y * scale,
        width: input.source.width * scale,
        height: input.source.height * scale
    };

    const subjectDestinationBox = transformBox(subjectBox, scale, destinationBox);
    const subjectVisibleArea = area(intersectBox(subjectDestinationBox, targetBox));
    const subjectTotalArea = area(subjectDestinationBox);
    const subjectVisibleRatio = subjectTotalArea > 0 ? clamp(subjectVisibleArea / subjectTotalArea, 0, 1) : 0;
    const fillRatio = Math.max(
        subjectDestinationBox.width / targetBox.width,
        subjectDestinationBox.height / targetBox.height
    );

    const sourceOverflow = area(intersectBox(destinationBox, targetBox)) < area(destinationBox) - 0.5;
    let cropRisk: SmartScalingRisk = 'none';
    if (subjectVisibleRatio < 0.92) {
        cropRisk = 'high';
    } else if (subjectVisibleRatio < 0.99) {
        cropRisk = 'medium';
    } else if (sourceOverflow && preset.cropPolicy === 'avoid-crop') {
        cropRisk = 'medium';
    } else if (sourceOverflow && preset.cropPolicy !== 'allow-crop') {
        cropRisk = 'low';
    }

    if (cropRisk !== 'none') {
        warnings.push(`Crop risk is ${cropRisk}; verify clipping or target bounds before execution.`);
    }

    reasons.push(`designType=${input.designType || 'generic'}`);
    reasons.push(`assetRole=${input.assetRole || 'unknown'}`);
    if (input.intent) reasons.push(`intent=${input.intent}`);
    reasons.push(`scaleMode=${preset.scaleMode}`);
    reasons.push(`targetFill=${preset.targetFill.toFixed(2)}`);
    reasons.push(`anchor=${preset.anchor}`);

    let confidence = 0.86;
    if (!input.subjectBox) confidence -= 0.22;
    if (!input.targetBox) confidence -= 0.12;
    if (Math.abs(scale - unclampedScale) > 0.0001) confidence -= 0.1;
    if (cropRisk === 'low') confidence -= 0.05;
    if (cropRisk === 'medium') confidence -= 0.16;
    if (cropRisk === 'high') confidence -= 0.3;
    confidence = clamp(confidence, 0.05, 0.95);

    return {
        scale,
        scalePercent: scale * 100,
        destinationBox,
        subjectDestinationBox,
        targetBox,
        sourceBox,
        subjectBox,
        fillRatio,
        subjectVisibleRatio,
        cropRisk,
        confidence,
        fallbackUsed,
        reasons,
        warnings,
        preset
    };
}

export function formatSmartScalingPolicyForPlanner(): string[] {
    return [
        'Smart scaling is not a raw resize percent. It needs source size, subject bounds, target box, design type, asset role, and intent.',
        'Use subject bounds when available. Full-layer bounds are a fallback and must lower confidence.',
        'Prefer preserve-subject placement for products, models, details, SKU, and reference replication. Allow cover-style crop only for scene/background/full-bleed intent.',
        'A Photoshop execution step must verify the resulting layer bounds after transform; a planned destinationBox is not proof of execution.',
        'Current policy computes a deterministic scaling decision. It does not replace visual QA or guarantee aesthetic quality without real benchmark cases.'
    ];
}
