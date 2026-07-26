import {
    selectMainImageAssetCandidate,
    type MainImageAssetSelectionAsset,
    type MainImageAssetSelectionDocument,
    type MainImageAssetSelectionMode,
    type MainImageAssetSelectionResult
} from './main-image-asset-selection';
import type { MainImageStrategyInputKey } from './main-image-strategy-contract';
import {
    evaluateMainImageVisualContext,
    type MainImageVisualContextStatus,
    type MainImageVisionSignal
} from './main-image-visual-loop';

export type MainImageAssetHeroStrategyStatus =
    | 'blocked_missing_asset'
    | 'blocked_missing_subject_bounds'
    | 'ready_metadata_only'
    | 'ready_visual_context';

export interface MainImageAssetHeroStrategySubjectBounds {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
}

export interface MainImageAssetHeroStrategyInput {
    userText?: string;
    currentDocument?: MainImageAssetSelectionDocument | null;
    projectAssets?: MainImageAssetSelectionAsset[];
    selectedAsset?: MainImageAssetSelectionAsset | null;
    subjectBounds?: MainImageAssetHeroStrategySubjectBounds | null;
    visionSignal?: MainImageVisionSignal | null;
}

export interface MainImageAssetHeroStrategy {
    version: 'main-image-asset-hero-strategy/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageAssetHeroStrategyStatus;
    assetUnderstanding: {
        selectionMode: MainImageAssetSelectionMode;
        candidateCount: number;
        selectedAssetName?: string;
        selectedAssetPath?: string;
        selectedAssetRole?: string;
        selectedAssetSource?: string;
        visualContext: MainImageVisualContextStatus;
        semanticStatus: 'metadata_only' | 'visual_context_ready' | 'missing';
        warnings: string[];
    };
    heroSubjectSelection: {
        status: 'missing_bounds' | 'bounds_ready';
        bounds?: Required<MainImageAssetHeroStrategySubjectBounds>;
        productType: string;
        subjectSummary: string;
        source: 'none' | 'subject-bounds' | 'subject-bounds-plus-vision';
    };
    strategyInputPatch: Partial<Record<MainImageStrategyInputKey, unknown>>;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

interface NormalizedSubjectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown[]): string[] {
    return values.map(cleanString).filter(Boolean);
}

function normalizeSubjectBounds(
    bounds: MainImageAssetHeroStrategySubjectBounds | null | undefined
): NormalizedSubjectBounds | undefined {
    if (!bounds) return undefined;
    const left = Number(bounds.left ?? 0);
    const top = Number(bounds.top ?? 0);
    const right = Number(bounds.right ?? (left + Number(bounds.width || 0)));
    const bottom = Number(bounds.bottom ?? (top + Number(bounds.height || 0)));
    const width = Number(bounds.width ?? (right - left));
    const height = Number(bounds.height ?? (bottom - top));
    if (![left, top, right, bottom, width, height].every(Number.isFinite)) return undefined;
    if (width <= 0 || height <= 0) return undefined;
    return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(right),
        bottom: Math.round(bottom),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function buildStatus(input: {
    assetSelection: MainImageAssetSelectionResult;
    subjectBounds?: NormalizedSubjectBounds;
    visualContextReady: boolean;
}): MainImageAssetHeroStrategyStatus {
    if (!input.assetSelection.selectedAsset) return 'blocked_missing_asset';
    if (!input.subjectBounds) return 'blocked_missing_subject_bounds';
    if (input.visualContextReady) return 'ready_visual_context';
    return 'ready_metadata_only';
}

function buildAssetSelectionPolicy(
    assetSelection: MainImageAssetSelectionResult,
    visualContext: MainImageVisualContextStatus
): Record<string, unknown> | undefined {
    const selected = assetSelection.selectedAsset;
    if (!selected) return undefined;
    return {
        mode: assetSelection.selectionMode,
        selectedAssetName: cleanString(selected.name) || undefined,
        selectedAssetPath: cleanString(selected.path) || undefined,
        selectedAssetRole: cleanString(selected.role) || undefined,
        selectedAssetSource: cleanString(selected.source) || undefined,
        selectedAssetScore: Math.round(Number(selected.score || 0)),
        candidateCount: assetSelection.candidateCount,
        visualContext,
        boundary: 'asset policy is selected from metadata and optional asset-bound visual context; it is not Photoshop placement'
    };
}

function buildHeroSubjectPolicy(
    subjectBounds: NormalizedSubjectBounds | undefined,
    visionSignal: MainImageVisionSignal | null | undefined,
    visualContextReady: boolean
): Record<string, unknown> | undefined {
    if (!subjectBounds) return undefined;
    return {
        source: visualContextReady ? 'subject-bounds-plus-vision' : 'subject-bounds',
        bounds: subjectBounds,
        productType: visualContextReady ? cleanString(visionSignal?.productType) || 'unknown' : 'unknown',
        subjectSummary: visualContextReady
            ? cleanString(visionSignal?.subjectSummary) || 'visual context ready; subject summary missing'
            : 'bounds only; visual semantics not confirmed',
        boundary: 'hero subject policy is a planning input and still needs post-transform QA'
    };
}

function buildBlockers(
    status: MainImageAssetHeroStrategyStatus,
    assetSelection: MainImageAssetSelectionResult
): string[] {
    const blockers = [...assetSelection.blockers];
    if (status === 'blocked_missing_asset') {
        blockers.push('main_image_asset_missing');
    }
    if (status === 'blocked_missing_subject_bounds') {
        blockers.push('main_image_subject_bounds_missing');
    }
    return blockers;
}

function buildWarnings(input: {
    assetSelection: MainImageAssetSelectionResult;
    status: MainImageAssetHeroStrategyStatus;
    visualContext: MainImageVisualContextStatus;
}): string[] {
    const warnings = [...input.assetSelection.warnings];
    if (input.visualContext.readiness !== 'ready') {
        warnings.push(`${input.visualContext.reason} 不能判断款式、材质、风格或最佳构图。`);
    }
    if (input.status === 'blocked_missing_subject_bounds') {
        warnings.push('已有素材上下文，但缺少主体 bounds，不能计算主视觉大小和位置。');
    }
    return cleanStrings(warnings);
}

function buildSemanticStatus(input: {
    selected: boolean;
    visualContextReady: boolean;
}): MainImageAssetHeroStrategy['assetUnderstanding']['semanticStatus'] {
    if (!input.selected) return 'missing';
    if (input.visualContextReady) return 'visual_context_ready';
    return 'metadata_only';
}

function buildHeroSubjectSource(input: {
    subjectBounds?: NormalizedSubjectBounds;
    visualContextReady: boolean;
}): MainImageAssetHeroStrategy['heroSubjectSelection']['source'] {
    if (!input.subjectBounds) return 'none';
    if (input.visualContextReady) return 'subject-bounds-plus-vision';
    return 'subject-bounds';
}

export function buildMainImageAssetHeroStrategy(
    input: MainImageAssetHeroStrategyInput
): MainImageAssetHeroStrategy {
    const assetSelection = selectMainImageAssetCandidate({
        userText: cleanString(input.userText),
        currentDocument: input.currentDocument,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset
    });
    const selected = assetSelection.selectedAsset;
    const subjectBounds = normalizeSubjectBounds(input.subjectBounds);
    const visualContext = evaluateMainImageVisualContext(input.visionSignal, selected);
    const visualContextReady = visualContext.readiness === 'ready';
    const status = buildStatus({ assetSelection, subjectBounds, visualContextReady });
    const strategyInputPatch: Partial<Record<MainImageStrategyInputKey, unknown>> = {};
    const assetSelectionPolicy = buildAssetSelectionPolicy(assetSelection, visualContext);
    if (assetSelectionPolicy) strategyInputPatch.assetSelectionPolicy = assetSelectionPolicy;
    const heroSubjectPolicy = buildHeroSubjectPolicy(subjectBounds, input.visionSignal, visualContextReady);
    if (heroSubjectPolicy) strategyInputPatch.heroSubjectPolicy = heroSubjectPolicy;

    return {
        version: 'main-image-asset-hero-strategy/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        assetUnderstanding: {
            selectionMode: assetSelection.selectionMode,
            candidateCount: assetSelection.candidateCount,
            selectedAssetName: cleanString(selected?.name) || undefined,
            selectedAssetPath: cleanString(selected?.path) || undefined,
            selectedAssetRole: cleanString(selected?.role) || undefined,
            selectedAssetSource: cleanString(selected?.source) || undefined,
            visualContext,
            semanticStatus: buildSemanticStatus({ selected: Boolean(selected), visualContextReady }),
            warnings: cleanStrings(selected?.warnings || [])
        },
        heroSubjectSelection: {
            status: subjectBounds ? 'bounds_ready' : 'missing_bounds',
            bounds: subjectBounds,
            productType: visualContextReady ? cleanString(input.visionSignal?.productType) || 'unknown' : 'unknown',
            subjectSummary: visualContextReady
                ? cleanString(input.visionSignal?.subjectSummary) || 'visual context ready; subject summary missing'
                : 'bounds only; visual semantics not confirmed',
            source: buildHeroSubjectSource({ subjectBounds, visualContextReady })
        },
        strategyInputPatch,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: buildBlockers(status, assetSelection),
        warnings: buildWarnings({ assetSelection, status, visualContext }),
        limitations: [
            '素材与主体策略只整理上下文，不调用 provider、不读取图片像素、不执行 Photoshop。',
            'metadata-only 只能说明候选来源和 bounds 存在，不能确认图片内容、审美或商业适配。',
            '没有真实视觉信号时，productType 必须保持 unknown，不能凭文件名猜款式。'
        ]
    };
}
