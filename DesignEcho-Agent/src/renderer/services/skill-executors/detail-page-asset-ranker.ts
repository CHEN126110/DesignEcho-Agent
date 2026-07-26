import type { DetailScreenPlan, DetailScreenRole } from '../../../shared/detail-page-screen-plan';
import type { FillPlan, ParsedScreen } from './detail-page.types';
import type { DesignScene } from '../../../shared/types/design-context.types';
import type { SelectedElementContext } from '../../../shared/types/design-scene.types';
import type { SelectedModuleContext } from '../../../shared/types/design-graph.types';
import type { SelectedDesignContext } from '../../../shared/types/design-context.types';
import {
    applyDetailFillPlanCopiesToScreens,
    auditDetailCopyLayoutForScreens
} from '../../../shared/detail-page-copy-layout-audit';
import {
    computePlacementTransform,
    type PlacementPlan,
    type PlacementTransform
} from '../../../shared/reference-replication-placement';
import {
    computeSmartScalingDecision,
    type SmartScalingDecision,
    type SmartScalingIntent
} from '../../../shared/design-smart-scaling-policy';

type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon' | 'unknown';
type FillMode = 'cover' | 'contain' | 'smart';

/**
 * 视觉理解构图信号（可选）。治理审计(2026-07-01)阶段1新增：当调用方能提供该字段时参与打分，
 * 缺省时评分逻辑与此前完全一致（scoreVisionFit 的 neutral 默认值 0.5，与 scoreVisualSummaryFit 同规格）。
 * 数据供给已接线：tool-executor.service.ts 的 executeDetailPageContentMatch 会读取项目视觉理解缓存
 * （.designecho/visual-insights-cache.json，经 ecommerce:readVisualInsightCache 轻量只读通道），按素材路径
 * 匹配出 visionSignal 后传入本模块；缓存缺失或读取失败时该字段保持 undefined，评分回到中性 0.5。
 */
export type DetailAssetVisionSignal = {
    mainImageSuitability?: 'suitable' | 'marginal' | 'unsuitable';
    subjectCoverageRatio?: 'dominant' | 'moderate' | 'small';
    productType?: string;
};

export type DetailProjectAsset = {
    name?: string;
    path: string;
    width?: number;
    height?: number;
    type?: string;
    visionSignal?: DetailAssetVisionSignal;
};

type MatchCandidate = {
    asset: DetailProjectAsset;
    score: number;
    reasons: string[];
};

type PlacementMetadata = {
    placementPlan?: PlacementPlan;
    placementTransform?: PlacementTransform;
    smartScalingDecision?: SmartScalingDecision;
};

type MatchParams = {
    screens: ParsedScreen[];
    projectAssets: { images: DetailProjectAsset[] };
    screenPlans?: DetailScreenPlan[];
    selectedScene?: DesignScene | null;
    selectedDesignContext?: SelectedDesignContext | null;
    selectedElementContext?: SelectedElementContext | null;
    selectedModuleContext?: SelectedModuleContext | null;
};

type GeneratedCopyItem = {
    layerId: number;
    content: string;
};

type CopyTargetInput = {
    layerId: number;
    layerName?: string;
    originalText?: string;
    role?: string;
    bounds?: unknown;
    fontSize?: number;
    currentText?: string;
    warnings?: string[];
};

type ScreenCopyRequest = {
    screen: ParsedScreen;
    screenPlan: DetailScreenPlan;
    copyTargets: CopyTargetInput[];
    selectedScene?: DesignScene | null;
    selectedElementContext?: SelectedElementContext | null;
    selectedModuleContext?: SelectedModuleContext | null;
    isFocusedScreen?: boolean;
};

const COPY_REQUEST_BATCH_SIZE = 4;

const SCREEN_COPY_BATCH_SIZE = 4;

const SCREEN_TYPE_ASSET_MAP: Record<string, AssetType[]> = {
    'A_MARKETING_INFO': ['scene'],
    'B_TRUST_BADGE': ['icon'],
    'C_HERO': ['product', 'scene'],
    'C_SELLING_POINT': ['product', 'scene'],
    'D_ICON': ['icon'],
    'D_ICON_SELLING_POINT': ['icon'],
    'E_KV_ATMOSPHERE': ['scene', 'product'],
    'E_KV': ['scene', 'product'],
    'F_COLOR_VARIANT': ['product'],
    'F_COLOR': ['product'],
    'G_MATERIAL': ['detail', 'product'],
    'G_MATERIAL_INFO': ['detail', 'product'],
    'H_PAIN_POINT': ['detail', 'product'],
    'I_STYLING': ['model', 'scene'],
    'J_DETAIL': ['detail', 'product'],
    'K_PARAMETER': ['product', 'detail'],
    'K_PRODUCT_INFO': ['product', 'detail'],
    'L_MODEL': ['model'],
    'M_SERVICE': ['icon'],
    CUSTOM: ['product']
};

const SCREEN_ROLE_ASSET_MAP: Record<DetailScreenRole, AssetType[]> = {
    hero: ['scene', 'product'],
    'selling-point': ['product', 'scene', 'detail'],
    material_detail: ['detail', 'product'],
    process_detail: ['detail', 'product'],
    feature_detail: ['detail', 'product'],
    scene: ['model', 'scene', 'product'],
    parameter: ['product', 'detail'],
    closing: ['scene', 'product'],
    unknown: ['product']
};

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function chunkItems<T>(items: T[], size: number): T[][] {
    if (!Array.isArray(items) || items.length === 0) return [];
    const chunkSize = Math.max(1, Math.floor(size || 1));
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
}

function sortScreensByFocus<T extends { id?: number; screenId?: number }>(items: T[], focusedScreenId: number | null): T[] {
    if (!focusedScreenId) return [...items];
    return [...items].sort((a, b) => {
        const aId = Number(a.id || a.screenId || 0);
        const bId = Number(b.id || b.screenId || 0);
        return Number(bId === focusedScreenId) - Number(aId === focusedScreenId);
    });
}

function normalizeAssetType(value: string | undefined): AssetType {
    const raw = String(value || 'unknown').toLowerCase();
    if (raw.includes('product')) return 'product';
    if (raw.includes('model')) return 'model';
    if (raw.includes('detail')) return 'detail';
    if (raw.includes('scene')) return 'scene';
    if (raw.includes('icon')) return 'icon';
    return 'unknown';
}

function getScreenPreferredTypes(screenType: string): AssetType[] {
    return SCREEN_TYPE_ASSET_MAP[screenType] || SCREEN_TYPE_ASSET_MAP.CUSTOM;
}

function getRolePreferredTypes(screenPlan?: DetailScreenPlan): AssetType[] {
    if (!screenPlan) return [];
    if (screenPlan.requiresModelDecision) return [];
    return SCREEN_ROLE_ASSET_MAP[screenPlan.screenRole] || [];
}

function getPreferredTypes(screen: ParsedScreen, screenPlan?: DetailScreenPlan): AssetType[] {
    const merged = [...getRolePreferredTypes(screenPlan), ...getScreenPreferredTypes(screen.type || 'CUSTOM')];
    return merged.filter((item, index) => merged.indexOf(item) === index);
}

function getPlaceholderAspectRatio(placeholder: any): number {
    const ratio = Number(placeholder?.aspectRatio || 0);
    if (ratio > 0) return ratio;
    const width = Math.max(1, Number(placeholder?.bounds?.width || 1));
    const height = Math.max(1, Number(placeholder?.bounds?.height || 1));
    return width / height;
}

function getAssetAspectRatio(asset: DetailProjectAsset): number {
    const width = Math.max(1, Number(asset?.width || 1));
    const height = Math.max(1, Number(asset?.height || 1));
    return width / height;
}

function getAssetPixelArea(asset: DetailProjectAsset): number {
    return Math.max(1, Number(asset?.width || 1) * Number(asset?.height || 1));
}

function scoreAspectFit(asset: DetailProjectAsset, placeholder: any): number {
    const target = getPlaceholderAspectRatio(placeholder);
    const ratio = getAssetAspectRatio(asset);
    const diff = Math.abs(Math.log(ratio / Math.max(0.01, target)));
    return clamp01(1 - (diff / 1.2));
}

function scoreTypeFit(assetType: AssetType, preferredTypes: AssetType[], recommendedType?: string): number {
    const normalizedRecommended = normalizeAssetType(recommendedType);
    if (assetType === normalizedRecommended && assetType !== 'unknown') return 1;
    if (preferredTypes.includes(assetType)) return 0.84;
    if (assetType === 'unknown') return 0.35;
    if ((assetType === 'detail' && preferredTypes.includes('product')) || (assetType === 'product' && preferredTypes.includes('detail'))) {
        return 0.62;
    }
    if ((assetType === 'scene' && preferredTypes.includes('model')) || (assetType === 'model' && preferredTypes.includes('scene'))) {
        return 0.58;
    }
    return 0.22;
}

function scoreRoleFit(assetType: AssetType, screenType: string, placeholder: any, screenPlan?: DetailScreenPlan): number {
    const zone = String(placeholder?.zone || '').toLowerCase();
    if (zone === 'icon') return assetType === 'icon' ? 1 : 0;

    if (screenPlan) {
        if (screenPlan.requiresModelDecision) {
            return assetType === 'unknown' ? 0.35 : 0.5;
        }
        switch (screenPlan.screenRole) {
            case 'hero':
                return assetType === 'scene' ? 1 : assetType === 'product' ? 0.78 : 0.2;
            case 'selling-point':
                return assetType === 'product' ? 1 : assetType === 'scene' ? 0.74 : assetType === 'detail' ? 0.7 : 0.2;
            case 'material_detail':
                return assetType === 'detail' ? 1 : assetType === 'product' ? 0.72 : 0.2;
            case 'process_detail':
            case 'feature_detail':
                return assetType === 'detail' ? 1 : assetType === 'product' ? 0.68 : 0.2;
            case 'scene':
                return assetType === 'model' ? 1 : assetType === 'scene' ? 0.78 : assetType === 'product' ? 0.52 : 0.18;
            case 'parameter':
                return assetType === 'product' ? 0.92 : assetType === 'detail' ? 0.6 : 0.2;
            case 'closing':
                return assetType === 'scene' ? 0.86 : assetType === 'product' ? 0.8 : 0.18;
            default:
                break;
        }
    }

    const lower = String(screenType || '').toLowerCase();
    if (/hero|kv|banner|首屏|核心|营销/.test(lower)) {
        return assetType === 'scene' ? 1 : assetType === 'product' ? 0.7 : 0.3;
    }
    if (/模特|穿搭|推荐|model/.test(lower)) {
        return assetType === 'model' ? 1 : assetType === 'scene' ? 0.65 : 0.2;
    }
    if (/细节|面料|工艺|detail|material/.test(lower)) {
        return assetType === 'detail' ? 1 : assetType === 'product' ? 0.68 : 0.25;
    }
    if (/参数|信息|规格|尺码|parameter/.test(lower)) {
        return assetType === 'product' ? 0.9 : assetType === 'detail' ? 0.55 : 0.2;
    }
    return assetType === 'product' ? 0.72 : 0.45;
}

function scoreResolutionSuitability(asset: DetailProjectAsset, placeholder: any): number {
    const placeholderArea = Math.max(1, Number(placeholder?.bounds?.width || 1) * Number(placeholder?.bounds?.height || 1));
    const assetArea = getAssetPixelArea(asset);
    if (assetArea >= placeholderArea * 8) return 1;
    if (assetArea >= placeholderArea * 4) return 0.86;
    if (assetArea >= placeholderArea * 2) return 0.74;
    if (assetArea >= placeholderArea) return 0.58;
    return 0.28;
}

function scoreNameHint(asset: DetailProjectAsset, screenType: string, screenPlan?: DetailScreenPlan): number {
    const name = String(asset?.name || '').toLowerCase();
    if (!name) return 0.4;

    if (screenPlan?.requiresModelDecision) {
        return 0.45;
    }

    if (screenPlan) {
        switch (screenPlan.screenRole) {
            case 'scene':
                if (/模特|上脚|穿搭|model|look/.test(name)) return 1;
                break;
            case 'material_detail':
                if (/面料|材质|纹理|fabric|material/.test(name)) return 1;
                break;
            case 'process_detail':
                if (/工艺|做工|车线|缝合|stitch|craft/.test(name)) return 1;
                break;
            case 'feature_detail':
                if (/细节|面料|纹理|close|detail|fabric/.test(name)) return 1;
                break;
            case 'hero':
            case 'closing':
                if (/场景|氛围|banner|kv|scene|hero/.test(name)) return 1;
                break;
            case 'parameter':
                if (/参数|规格|尺码|flat|pack/.test(name)) return 0.92;
                break;
            default:
                break;
        }
    }

    const lower = String(screenType || '').toLowerCase();
    if (/模特|model/.test(lower) && /模特|上脚|穿搭|model/.test(name)) return 1;
    if (/细节|面料|工艺|detail|material/.test(lower) && /细节|面料|纹理|close|detail|fabric/.test(name)) return 1;
    if (/kv|hero|首屏|营销/.test(lower) && /场景|氛围|banner|kv|scene/.test(name)) return 1;
    if (/颜色|款式|variant|color/.test(lower) && /颜色|色卡|款式|variant|color/.test(name)) return 0.9;
    return 0.45;
}

function scoreVisualSummaryFit(assetType: AssetType, screenPlan?: DetailScreenPlan): number {
    const visual = screenPlan?.visualSummary;
    if (!visual) return 0.5;
    if (screenPlan?.requiresModelDecision) return 0.5;

    let score = 0.5;
    const visualRole = visual.roleHint || screenPlan?.screenRole || 'unknown';

    switch (visualRole) {
        case 'hero':
            if (assetType === 'scene') score += 0.14;
            else if (assetType === 'product') score += 0.1;
            else if (assetType === 'detail') score -= 0.1;
            break;
        case 'scene':
            if (assetType === 'model') score += 0.12;
            else if (assetType === 'scene') score += 0.1;
            else if (assetType === 'detail') score -= 0.08;
            break;
        case 'parameter':
            if (assetType === 'product') score += 0.12;
            else if (assetType === 'detail') score += 0.08;
            else if (assetType === 'scene' || assetType === 'model') score -= 0.08;
            break;
        case 'material_detail':
        case 'process_detail':
        case 'feature_detail':
            if (assetType === 'detail') score += 0.14;
            else if (assetType === 'product') score += 0.06;
            else if (assetType === 'scene' || assetType === 'model') score -= 0.08;
            break;
        case 'selling-point':
            if (assetType === 'product') score += 0.08;
            else if (assetType === 'detail') score += 0.04;
            break;
        default:
            break;
    }

    if (visual.dominantModuleType === 'image' && (assetType === 'scene' || assetType === 'product' || assetType === 'model')) {
        score += 0.04;
    }
    if (visual.imageModuleCount >= 2 && (assetType === 'detail' || assetType === 'product')) {
        score += 0.04;
    }
    if (visual.boundaryRisk === 'risky') {
        score -= 0.06;
    } else if (visual.boundaryRisk === 'ok') {
        score += 0.03;
    }

    return clamp01(score);
}

/**
 * 视觉理解构图信号参与打分（叠加，不替换其余启发式打分）。没有信号时返回 0.5 中性值，
 * 与 scoreVisualSummaryFit 无信号时的默认行为一致，保证旧行为不受影响。
 */
function scoreVisionFit(asset: DetailProjectAsset, screenPlan?: DetailScreenPlan): number {
    const signal = asset.visionSignal;
    if (!signal) return 0.5;

    let score = 0.5;
    const screenRole = screenPlan?.screenRole;
    const productForwardRole = screenRole === 'hero' || screenRole === 'selling-point' || screenRole === 'parameter';
    const sceneForwardRole = screenRole === 'scene';

    if (signal.mainImageSuitability === 'suitable' && productForwardRole) score += 0.14;
    if (signal.mainImageSuitability === 'unsuitable' && productForwardRole) score -= 0.14;
    if (signal.subjectCoverageRatio === 'dominant' && productForwardRole) score += 0.06;
    if (signal.subjectCoverageRatio === 'small' && sceneForwardRole) score += 0.04;
    if (signal.subjectCoverageRatio === 'small' && productForwardRole) score -= 0.06;

    return clamp01(score);
}

function rankAssetsForPlaceholder(
    screen: ParsedScreen,
    placeholder: any,
    availableAssets: DetailProjectAsset[],
    usedPaths: Set<string>,
    screenPlan?: DetailScreenPlan
): MatchCandidate[] {
    const preferredTypes = getPreferredTypes(screen, screenPlan);

    return (availableAssets || [])
        .map((asset) => {
            const assetType = normalizeAssetType(asset.type);
            const typeFit = scoreTypeFit(assetType, preferredTypes, placeholder?.recommendedAssetType);
            const roleFit = scoreRoleFit(assetType, screen.type || 'CUSTOM', placeholder, screenPlan);
            const aspectFit = scoreAspectFit(asset, placeholder);
            const resolutionFit = scoreResolutionSuitability(asset, placeholder);
            const nameHint = scoreNameHint(asset, screen.type || 'CUSTOM', screenPlan);
            const visualFit = scoreVisualSummaryFit(assetType, screenPlan);
            const visionFit = scoreVisionFit(asset, screenPlan);
            const reusePenalty = usedPaths.has(String(asset.path || '')) ? 0.12 : 0;
            const score = clamp01(
                (typeFit * 0.27)
                + (roleFit * 0.22)
                + (aspectFit * 0.17)
                + (resolutionFit * 0.11)
                + (nameHint * 0.09)
                + (visualFit * 0.07)
                + (visionFit * 0.07)
                - reusePenalty
            );

            const reasons = [
                `type:${typeFit.toFixed(2)}`,
                `role:${roleFit.toFixed(2)}`,
                `aspect:${aspectFit.toFixed(2)}`,
                `resolution:${resolutionFit.toFixed(2)}`,
                `name:${nameHint.toFixed(2)}`,
                `visual:${visualFit.toFixed(2)}`,
                `vision:${visionFit.toFixed(2)}`
            ];
            if (reusePenalty > 0) reasons.push(`reuse:-${reusePenalty.toFixed(2)}`);

            return {
                asset,
                score,
                reasons
            };
        })
        .sort((a, b) => b.score - a.score);
}
function normalizeText(text: unknown): string {
    return String(text || '').replace(/\r\n/g, '\n').trim();
}

function countContentChars(text: unknown): number {
    return normalizeText(text).replace(/[\r\n]/g, '').length;
}

function getPreferredCharDiff(charCount: number): number {
    if (charCount <= 8) return 0;
    if (charCount <= 20) return 1;
    if (charCount <= 40) return 2;
    return 3;
}

type CopyShapeSpec = {
    lineCount: number;
    charCount: number;
    lineLengths: number[];
    hasOriginalText: boolean;
};

function estimateCharsPerLine(copyStrategy: DetailScreenPlan['copyStrategy'] | undefined, role: string | undefined): number {
    const normalizedRole = String(role || '').toLowerCase();
    if (normalizedRole === 'title' || copyStrategy === 'headline') return 10;
    if (copyStrategy === 'parameter') return 9;
    if (copyStrategy === 'supporting_copy') return 12;
    if (copyStrategy === 'emotional') return 11;
    return 10;
}

function estimateLineCount(copyStrategy: DetailScreenPlan['copyStrategy'] | undefined, role: string | undefined): number {
    const normalizedRole = String(role || '').toLowerCase();
    if (normalizedRole === 'title' || copyStrategy === 'headline') return 2;
    if (copyStrategy === 'parameter') return 2;
    return 2;
}

function buildCopyShapeSpec(
    originalText: string,
    placeholder: { role?: string; bounds?: unknown; fontSize?: number },
    screenPlan: DetailScreenPlan | undefined
): CopyShapeSpec {
    const original = normalizeText(originalText);
    if (original) {
        const originalLines = original.split('\n');
        return {
            lineCount: Math.max(1, originalLines.length),
            charCount: countContentChars(original),
            lineLengths: originalLines.map((line) => line.length),
            hasOriginalText: true
        };
    }

    const bounds = placeholder?.bounds as Record<string, unknown> | undefined;
    const width = Math.max(0, Number(bounds?.width || 0));
    const fontSize = Math.max(0, Number(placeholder?.fontSize || 0));
    const fallbackLineCount = estimateLineCount(screenPlan?.copyStrategy, placeholder?.role);
    const estimatedCharsPerLine = estimateCharsPerLine(screenPlan?.copyStrategy, placeholder?.role);
    const capacityFromBounds = width > 0 && fontSize > 0
        ? Math.max(4, Math.floor(width / Math.max(fontSize * 0.95, 1)))
        : estimatedCharsPerLine;
    const targetCharsPerLine = Math.max(4, Math.min(capacityFromBounds, estimatedCharsPerLine + 4));
    const lineCount = Math.max(1, fallbackLineCount);

    return {
        lineCount,
        charCount: targetCharsPerLine * lineCount,
        lineLengths: Array.from({ length: lineCount }, () => targetCharsPerLine),
        hasOriginalText: false
    };
}

function applyLineBreakSkeleton(shape: CopyShapeSpec, candidateText: string): string {
    const normalizedCandidate = normalizeText(candidateText).replace(/\n+/g, '');
    if (shape.lineCount <= 1) return normalizedCandidate;

    const lineLengths = shape.lineLengths.length > 0 ? shape.lineLengths : [normalizedCandidate.length];
    const totalLength = Math.max(1, lineLengths.reduce((sum, length) => sum + length, 0));
    const chars = normalizedCandidate.split('');
    const rebuilt: string[] = [];
    let cursor = 0;

    for (let index = 0; index < lineLengths.length; index++) {
        const isLastLine = index === lineLengths.length - 1;
        if (isLastLine) {
            rebuilt.push(chars.slice(cursor).join(''));
            break;
        }

        const ratio = lineLengths[index] / totalLength;
        const take = Math.max(1, Math.min(chars.length - cursor, Math.round(chars.length * ratio)));
        rebuilt.push(chars.slice(cursor, cursor + take).join(''));
        cursor += take;
    }

    return rebuilt.join('\n');
}

function normalizeGeneratedCopy(
    rawText: string,
    originalText: string,
    placeholder: { role?: string; bounds?: unknown; fontSize?: number },
    screenPlan: DetailScreenPlan | undefined
): string | null {
    const generated = normalizeText(rawText);
    if (!generated) return null;

    const shape = buildCopyShapeSpec(originalText, placeholder, screenPlan);
    const reflowed = applyLineBreakSkeleton(shape, generated);
    const targetCount = shape.charCount;
    const generatedCount = countContentChars(reflowed);
    const allowedDiff = getPreferredCharDiff(targetCount);
    if (Math.abs(generatedCount - targetCount) > allowedDiff) {
        return null;
    }
    return reflowed;
}

function parseGeneratedCopies(raw: unknown): GeneratedCopyItem[] {
    if (!raw) return [];

    if (Array.isArray(raw)) {
        return raw.flatMap((item) => parseGeneratedCopies(item));
    }

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];

        const jsonBlock = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
        if (jsonBlock) {
            try {
                return parseGeneratedCopies(JSON.parse(jsonBlock[1]));
            } catch {
                return [];
            }
        }

        try {
            return parseGeneratedCopies(JSON.parse(trimmed));
        } catch {
            return [];
        }
    }

    if (typeof raw === 'object') {
        const record = raw as Record<string, unknown>;
        if (Array.isArray(record.copies)) {
            return record.copies
                .map((item) => {
                    const copy = item as Record<string, unknown>;
                    return {
                        layerId: Number(copy.layerId),
                        content: normalizeText(copy.content)
                    };
                })
                .filter((item) => Number.isFinite(item.layerId) && !!item.content);
        }

        for (const key of ['data', 'result', 'text', 'content']) {
            if (key in record) {
                const nested = parseGeneratedCopies(record[key]);
                if (nested.length > 0) return nested;
            }
        }
    }

    return [];
}

function buildScreenCopyPrompt(
    screen: ParsedScreen,
    screenPlan: DetailScreenPlan,
    copyTargets: CopyTargetInput[],
    mode: 'initial' | 'repair'
): string {
    const header = mode === 'repair'
        ? 'Repair only the problematic copy placeholders. Keep the original layout skeleton.'
        : 'Generate detail-page copy for the current screen. Change meaning, keep the layout skeleton.';

    const rules = [
        'Rules:',
        '1. Return only replacement copy for each placeholder.',
        '2. Keep character count close to the original text.',
        '3. Keep line count and approximate line lengths close to the original text.',
        '4. Follow the screen role and avoid ad-like wording.',
        '5. Output JSON only: {"copies":[{"layerId":123,"content":"..."}]}'
    ];

    const targets = copyTargets.map((copy) => {
        const shape = buildCopyShapeSpec(copy.originalText || '', copy, screenPlan);
        return JSON.stringify({
            layerId: copy.layerId,
            layerName: copy.layerName,
            role: copy.role || 'copy',
            originalText: normalizeText(copy.originalText),
            currentText: normalizeText(copy.currentText),
            lineCount: shape.lineCount,
            charCount: shape.charCount,
            warnings: copy.warnings || []
        });
    });

    const visual = screenPlan.visualSummary;
    const visualLines = visual
        ? [
            `Visual boundary risk: ${visual.boundaryRisk}`,
            `Visual module count: ${visual.visualModuleCount}`,
            `Visual dominant type: ${visual.dominantModuleType}`,
            `Visual role hint: ${visual.roleHint || 'none'}`
        ]
        : [];

    return [
        header,
        `Screen name: ${screen.name}`,
        `Screen type: ${screen.type}`,
        `Screen role: ${screenPlan.screenRole}`,
        `Copy strategy: ${screenPlan.copyStrategy}`,
        `Main message: ${screenPlan.mainMessage}`,
        `Supporting points: ${screenPlan.supportingPoints.join(' / ')}`,
        ...buildScreenPlanDecisionLines(screenPlan),
        ...visualLines,
        '',
        ...rules,
        '',
        'Copy placeholders:',
        ...targets
    ].join('\n');
}

function buildFocusedContextPromptLines(
    selectedScene: DesignScene | null | undefined,
    selectedElementContext: SelectedElementContext | null | undefined,
    selectedModuleContext: SelectedModuleContext | null | undefined,
    screenId: number,
    isFocusedScreen: boolean
): string[] {
    if (!selectedScene && !selectedElementContext && !selectedModuleContext) return [];

    const sceneScreenId = Number(selectedScene?.selectedScreen?.sourceScreenId || 0) || null;
    const sceneModule = selectedScene?.selectedModule || null;
    const detail = selectedElementContext?.detail;
    const element = selectedElementContext?.selectedElement;
    const lines: string[] = [];

    if ((sceneScreenId !== null && sceneScreenId === screenId) || (detail?.screenId && Number(detail.screenId) === screenId)) {
        lines.push(`Focused screen: yes`);
    } else if (isFocusedScreen) {
        lines.push(`Focused screen: yes`);
    }

    if (sceneScreenId !== null && sceneScreenId !== Number(screenId || 0) && !isFocusedScreen) {
        return lines;
    }

    if (sceneScreenId === null && (!detail || (detail.screenId !== null && Number(detail.screenId) !== screenId && !isFocusedScreen))) {
        return lines;
    }

    if (element) {
        lines.push(`Selected element kind: ${element.kind}`);
        lines.push(`Selected element name: ${element.name}`);
    }
    if (selectedElementContext?.text?.content) {
        lines.push(`Selected text: ${normalizeText(selectedElementContext.text.content)}`);
    }
    if (detail?.screenRole) {
        lines.push(`Selected element screen role: ${detail.screenRole}`);
    }
    if (detail?.visualModuleId) {
        lines.push(`Selected visual module: ${detail.visualModuleId}`);
    }
    if (selectedElementContext?.relations.nearestImageLayers.length) {
        lines.push(`Nearest image layer: ${selectedElementContext.relations.nearestImageLayers[0].name}`);
    }
    if (selectedElementContext?.relations.nearestTextLayers.length) {
        lines.push(`Nearest text layer: ${selectedElementContext.relations.nearestTextLayers[0].name}`);
    }
    if (sceneModule) {
        lines.push(`Focused module id: ${sceneModule.id}`);
        lines.push(`Focused module layer count: ${sceneModule.layerIds.length}`);
    }
    if (selectedModuleContext?.module) {
        lines.push(`Focused module inference: ${selectedModuleContext.diagnostics.inferenceMode}`);
        const memberNames = selectedModuleContext.memberLayers
            .map((item) => normalizeText(item.name))
            .filter(Boolean)
            .slice(0, 4);
        if (memberNames.length > 0) {
            lines.push(`Focused module members: ${memberNames.join(' | ')}`);
        }
    }

    return lines;
}

function getFocusedModuleLayerIds(
    selectedScene: DesignScene | null | undefined,
    selectedElementContext: SelectedElementContext | null | undefined,
    selectedModuleContext: SelectedModuleContext | null | undefined,
    screenId: number
): Set<number> {
    const focusedScreenId = Number(selectedScene?.selectedScreen?.sourceScreenId || 0) || null;
    if (focusedScreenId !== null && focusedScreenId !== Number(screenId || 0)) {
        return new Set<number>();
    }
    const layerIds = selectedScene?.selectedModule?.layerIds?.length
        ? selectedScene.selectedModule.layerIds
        : selectedModuleContext?.module?.layerIds?.length
            ? selectedModuleContext.module.layerIds
            : (selectedElementContext?.detail?.visualModuleLayerIds || []);
    return new Set(
        (Array.isArray(layerIds) ? layerIds : [])
            .map((item) => Number(item))
            .filter((item) => item > 0)
    );
}

function sortPlaceholdersByFocusedModule<T extends { layerId?: number }>(items: T[], focusedModuleLayerIds: Set<number>): T[] {
    if (!focusedModuleLayerIds.size) return items;
    return [...items].sort((a, b) => {
        const aFocused = focusedModuleLayerIds.has(Number(a.layerId || 0)) ? 1 : 0;
        const bFocused = focusedModuleLayerIds.has(Number(b.layerId || 0)) ? 1 : 0;
        return bFocused - aFocused;
    });
}

function buildBatchScreenCopyPrompt(
    requests: ScreenCopyRequest[],
    mode: 'initial' | 'repair'
): string {
    const header = mode === 'repair'
        ? 'Repair only the problematic detail-page copy placeholders. Keep the original layout skeleton.'
        : 'Generate detail-page copy for multiple screens. Change meaning, keep the layout skeleton.';

    const rules = [
        'Rules:',
        '1. Return only replacement copy for each placeholder.',
        '2. Keep character count close to the original text.',
        '3. Keep line count and approximate line lengths close to the original text.',
        '4. Follow each screen role and avoid ad-like wording.',
        '5. Return one JSON object only: {"copies":[{"layerId":123,"content":"..."}]}',
        '6. Do not return markdown.'
    ];

    const requestBlocks = requests.map(({ screen, screenPlan, copyTargets, selectedScene, selectedElementContext, selectedModuleContext, isFocusedScreen }) => {
        const visual = screenPlan.visualSummary;
        const visualLines = visual
            ? [
                `Visual boundary risk: ${visual.boundaryRisk}`,
                `Visual module count: ${visual.visualModuleCount}`,
                `Visual dominant type: ${visual.dominantModuleType}`,
                `Visual role hint: ${visual.roleHint || 'none'}`
            ]
            : [];
        const focusLines = buildFocusedContextPromptLines(
            selectedScene,
            selectedElementContext,
            selectedModuleContext,
            Number(screen.id || 0),
            Boolean(isFocusedScreen)
        );
        const focusedModuleLayerIds = getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0));
        const orderedCopyTargets = sortPlaceholdersByFocusedModule(copyTargets, focusedModuleLayerIds);
        const targets = orderedCopyTargets.map((copy) => {
            const shape = buildCopyShapeSpec(copy.originalText || '', copy, screenPlan);
            return JSON.stringify({
                layerId: copy.layerId,
                layerName: copy.layerName,
                role: copy.role || 'copy',
                originalText: normalizeText(copy.originalText),
                currentText: normalizeText(copy.currentText),
                lineCount: shape.lineCount,
                charCount: shape.charCount,
                warnings: copy.warnings || []
            });
        });

        return [
            `Screen name: ${screen.name}`,
            `Screen type: ${screen.type}`,
            `Screen role: ${screenPlan.screenRole}`,
            `Copy strategy: ${screenPlan.copyStrategy}`,
            `Main message: ${screenPlan.mainMessage}`,
            `Supporting points: ${screenPlan.supportingPoints.join(' / ')}`,
            ...buildScreenPlanDecisionLines(screenPlan),
            ...visualLines,
            ...focusLines,
            'Copy placeholders:',
            ...targets
        ].join('\n');
    });

    return [
        header,
        ...rules,
        '',
        ...requestBlocks.map((block, index) => `=== Screen ${index + 1} ===\n${block}`)
    ].join('\n');
}

async function requestGeneratedCopies(
    screen: ParsedScreen,
    screenPlan: DetailScreenPlan,
    copyTargets: CopyTargetInput[],
    mode: 'initial' | 'repair'
): Promise<Map<number, string>> {
    return requestBatchGeneratedCopies([{ screen, screenPlan, copyTargets }], mode);
}

async function requestBatchGeneratedCopies(
    requests: ScreenCopyRequest[],
    mode: 'initial' | 'repair'
): Promise<Map<number, string>> {
    const replacements = new Map<number, string>();
    const validRequests = requests
        .filter((request) => request.copyTargets.length > 0)
        .sort((a, b) => Number(Boolean(b.isFocusedScreen)) - Number(Boolean(a.isFocusedScreen)));
    if (validRequests.length === 0 || typeof window === 'undefined') {
        return replacements;
    }

    try {
        for (const requestChunk of chunkItems(validRequests, COPY_REQUEST_BATCH_SIZE)) {
            const prompt = buildBatchScreenCopyPrompt(requestChunk, mode);
            const raw = await (window as any).designEcho?.invoke?.('task:execute', 'text-optimize', {
                text: prompt,
                context: {
                    source: mode === 'repair' ? 'detail-page-copy-repair-batch' : 'detail-page-copy-plan-batch',
                    screenCount: requestChunk.length,
                    placeholderCount: requestChunk.reduce((sum, request) => sum + request.copyTargets.length, 0),
                    screenRoles: requestChunk.map((request) => request.screenPlan.screenRole)
                }
            });

            const generatedItems = parseGeneratedCopies(raw);
            if (generatedItems.length === 0) continue;

            const targetByLayerId = new Map<number, { target: CopyTargetInput; screenPlan: DetailScreenPlan }>();
            for (const request of requestChunk) {
                for (const target of request.copyTargets) {
                    targetByLayerId.set(Number(target.layerId), { target, screenPlan: request.screenPlan });
                }
            }

            for (const item of generatedItems) {
                const meta = targetByLayerId.get(item.layerId);
                if (!meta) continue;
                const normalized = normalizeGeneratedCopy(
                    item.content,
                    meta.target.originalText || '',
                    meta.target,
                    meta.screenPlan
                );
                if (normalized) {
                    replacements.set(item.layerId, normalized);
                }
            }
        }
    } catch (error) {
        console.warn(`[DetailPageAssetRanker] ${mode} batch copy generation failed`, error);
    }

    return replacements;
}

async function generateScreenCopies(
    screen: ParsedScreen,
    screenPlan: DetailScreenPlan | undefined,
    preGeneratedCopies?: Map<number, string>
): Promise<Map<number, string>> {
    const copyPlaceholders = screen.copyPlaceholders || [];
    if (!screenPlan || copyPlaceholders.length === 0) {
        return new Map<number, string>();
    }

    if (preGeneratedCopies && preGeneratedCopies.size > 0) {
        const replacements = new Map<number, string>();
        for (const placeholder of copyPlaceholders) {
            const generated = preGeneratedCopies.get(Number(placeholder.layerId || 0));
            if (generated) {
                replacements.set(Number(placeholder.layerId || 0), generated);
            }
        }
        if (replacements.size > 0) {
            return replacements;
        }
    }

    return requestGeneratedCopies(screen, screenPlan, copyPlaceholders, 'initial');
}

function buildCopyAuditScore(copyAudit?: FillPlan['copyAudit']): number {
    if (!copyAudit) return 0;
    return ((copyAudit.riskyPlaceholderCount || 0) * 100) + (copyAudit.watchPlaceholderCount || 0);
}

function buildRepairTargets(screen: ParsedScreen, plan: FillPlan): CopyTargetInput[] {
    const placeholderByLayerId = new Map<number, any>((screen.copyPlaceholders || []).map((copy) => [Number(copy.layerId), copy]));
    const auditByLayerId = new Map<number, NonNullable<NonNullable<FillPlan['copyAudit']>['placeholderAudits']>[number]>(
        (plan.copyAudit?.placeholderAudits || []).map((item) => [Number(item.placeholderLayerId), item])
    );

    return (plan.copies || [])
        .map((copy) => {
            const layerId = Number(copy.layerId || 0);
            const placeholder = placeholderByLayerId.get(layerId);
            const audit = auditByLayerId.get(layerId);
            const content = normalizeText(copy.content);
            const needsRepair = !content
                || copy.generationStatus === 'failed'
                || Boolean(audit && audit.status === 'risky');
            if (!placeholder || !needsRepair) return null;
            return {
                layerId,
                layerName: copy.layerName || placeholder.layerName,
                originalText: String(copy.originalText || placeholder.currentText || ''),
                currentText: content,
                role: placeholder.role,
                bounds: placeholder.bounds,
                fontSize: placeholder.fontSize,
                warnings: audit?.warnings || []
            };
        })
        .filter(Boolean) as CopyTargetInput[];
}

function applyBatchCopyRepairs(
    plans: FillPlan[],
    screens: ParsedScreen[],
    screenPlanById: Map<number, DetailScreenPlan>,
    repairReplacements: Map<number, string>
): FillPlan[] {
    if (repairReplacements.size === 0) {
        return plans;
    }

    const screenById = new Map<number, ParsedScreen>((screens || []).map((screen) => [Number(screen.id || 0), screen]));

    return plans.map((plan) => {
        const screen = screenById.get(Number(plan.screenId || 0));
        const screenPlan = screenPlanById.get(Number(plan.screenId || 0));
        if (!screen || !screenPlan) {
            return plan;
        }

        const repairTargets = buildRepairTargets(screen, plan);
        if (repairTargets.length === 0) {
            return plan;
        }

        let changed = false;
        const repairedCopies = (plan.copies || []).map((copy) => {
            const replacement = repairReplacements.get(Number(copy.layerId || 0));
            if (!replacement) return copy;
            changed = true;
            return {
                ...copy,
                content: replacement,
                source: 'ai_generated' as const,
                generationStatus: 'generated' as const,
                generationReason: 'screen-plan-copy-repair'
            };
        });

        if (!changed) {
            return plan;
        }

        const repairedPlan: FillPlan = {
            ...plan,
            copies: repairedCopies
        };
        const repairedScreens = applyDetailFillPlanCopiesToScreens([screen], [repairedPlan]);
        const repairedAuditResult = auditDetailCopyLayoutForScreens({
            screens: repairedScreens,
            screenPlans: [screenPlan]
        });
        const repairedScreenAudits = repairedAuditResult.audits.filter((item) => Number(item.screenId || 0) === Number(screen.id || 0));
        const repairedRiskyCount = repairedScreenAudits.filter((item) => item.status === 'risky').length;
        const repairedWatchCount = repairedScreenAudits.filter((item) => item.status === 'watch').length;
        const repairedCopyAudit: NonNullable<FillPlan['copyAudit']> = {
            status: repairedRiskyCount > 0 ? 'risky' : repairedWatchCount > 0 ? 'watch' : 'ok',
            warningCount: repairedScreenAudits.reduce((sum, item) => sum + (item.warnings?.length || 0), 0),
            riskyPlaceholderCount: repairedRiskyCount,
            watchPlaceholderCount: repairedWatchCount,
            warnings: repairedScreenAudits.flatMap((item) => item.warnings || []),
            placeholderAudits: repairedScreenAudits.map((item) => ({
                placeholderLayerId: Number(item.placeholderLayerId || 0),
                status: item.status,
                warnings: item.warnings || []
            }))
        };

        if (buildCopyAuditScore(repairedCopyAudit) > buildCopyAuditScore(plan.copyAudit)) {
            return plan;
        }

        return {
            ...repairedPlan,
            needsReview: Boolean(plan.needsReview) || repairedCopyAudit.status === 'risky',
            copyAudit: repairedCopyAudit
        };
    });
}

function resolveInitialFillMode(assetType: AssetType, screenType: string, placeholder: any, screenPlan?: DetailScreenPlan): FillMode {
    const zone = String(placeholder?.zone || '').toLowerCase();
    const lower = String(screenType || '').toLowerCase();
    const iconLike = zone === 'icon' || /icon|图标|徽章|badge/.test(String(placeholder?.layerName || '').toLowerCase());
    if (iconLike || assetType === 'icon') return 'contain';

    if (screenPlan && !screenPlan.requiresModelDecision) {
        switch (screenPlan.imageStrategy) {
            case 'hero':
                return assetType === 'scene' ? 'cover' : 'contain';
            case 'context':
                return assetType === 'scene' || assetType === 'model' ? 'cover' : 'smart';
            case 'detail':
            case 'material':
                return 'smart';
            case 'comparison':
                return 'contain';
            default:
                break;
        }
    }

    if (assetType === 'scene') {
        return /hero|kv|banner|首屏|核心/.test(lower) ? 'cover' : 'smart';
    }
    if (assetType === 'detail') return 'smart';
    return 'contain';
}

function summarizeCandidate(candidate?: MatchCandidate): string | undefined {
    if (!candidate) return undefined;
    return candidate.reasons.length > 0 ? candidate.reasons.join(' / ') : undefined;
}

function buildScreenPlanDecisionLines(screenPlan: DetailScreenPlan): string[] {
    const lines = [
        `Decision source: ${screenPlan.decisionSource}`,
        `Model decision required: ${screenPlan.requiresModelDecision ? 'yes' : 'no'}`
    ];
    if (screenPlan.agentDecision?.rationale?.length) {
        lines.push(`Agent rationale: ${screenPlan.agentDecision.rationale.join(' / ')}`);
    }
    const structuralReasons = screenPlan.structuralSignals?.reasons || [];
    if (structuralReasons.length > 0) {
        lines.push(`Structural candidates: ${structuralReasons.join(' / ')}`);
    }
    if (screenPlan.requiresModelDecision) {
        lines.push('Decision boundary: template and filename rules are candidate signals only; decide the actual content from confirmed product facts, asset observations and user intent.');
    }
    return lines;
}

function resolveSmartScalingIntent(assetType: AssetType, fillMode: FillMode, screenPlan?: DetailScreenPlan): SmartScalingIntent {
    if (assetType === 'icon') return 'thumbnail';
    if (screenPlan?.requiresModelDecision) return fillMode === 'cover' ? 'full-bleed' : 'supporting';
    if (screenPlan?.imageStrategy === 'comparison') return 'compare-grid';
    if (screenPlan?.screenRole === 'hero' || screenPlan?.imageStrategy === 'hero') return 'hero';
    if (fillMode === 'cover' && (assetType === 'scene' || assetType === 'model')) return 'full-bleed';
    if (screenPlan?.imageStrategy === 'detail' || screenPlan?.imageStrategy === 'material') return 'fit-slot';
    return 'supporting';
}

function buildSmartScalingCanvas(screen: ParsedScreen, targetBox: { x: number; y: number; width: number; height: number }) {
    const screenBounds = screen.bounds || {};
    return {
        width: Math.max(1, Number(screenBounds.width || 0), targetBox.x + targetBox.width),
        height: Math.max(1, Number(screenBounds.height || 0), targetBox.y + targetBox.height)
    };
}

function buildPlacementMetadata(
    screen: ParsedScreen,
    placeholder: ParsedScreen['imagePlaceholders'][number],
    assetType: AssetType,
    fillMode: FillMode,
    screenPlan?: DetailScreenPlan,
    asset?: DetailProjectAsset
): PlacementMetadata {
    const placementPlan = placeholder.placementPlan;
    if (!placementPlan) {
        return {};
    }

    const width = Number(asset?.width || 0);
    const height = Number(asset?.height || 0);
    if (!asset?.path || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { placementPlan };
    }

    const placementTransform = computePlacementTransform(placementPlan, { width, height });
    const targetBox = placementPlan.safeBox || placementPlan.targetBox;
    const smartScalingDecision = computeSmartScalingDecision({
        canvas: buildSmartScalingCanvas(screen, targetBox),
        source: { width, height },
        targetBox,
        designType: 'detail-page',
        assetRole: assetType,
        intent: resolveSmartScalingIntent(assetType, fillMode, screenPlan)
    });

    return {
        placementPlan: {
            ...placementPlan,
            transform: placementTransform
        },
        placementTransform,
        smartScalingDecision
    };
}

async function generateScreenPlan(
    screen: ParsedScreen,
    projectAssets: { images: DetailProjectAsset[] },
    usedPaths: Set<string>,
    screenPlan?: DetailScreenPlan,
    preGeneratedCopies?: Map<number, string>,
    selectedScene?: DesignScene | null,
    selectedElementContext?: SelectedElementContext | null,
    selectedModuleContext?: SelectedModuleContext | null
) {
    const copies: any[] = [];
    const images: any[] = [];
    const screenType = screen.type || 'CUSTOM';
    const focusedModuleLayerIds = getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0));
    const generatedCopies = await generateScreenCopies(screen, screenPlan, preGeneratedCopies);

    for (const copy of sortPlaceholdersByFocusedModule(screen.copyPlaceholders || [], focusedModuleLayerIds)) {
        const generatedContent = generatedCopies.get(copy.layerId);
        const originalText = String(copy.currentText || '');
        const usedTemplateText = !generatedContent && normalizeText(originalText).length > 0;
        copies.push({
            layerId: copy.layerId,
            layerName: copy.layerName,
            content: generatedContent || originalText || '',
            source: generatedContent ? 'ai_generated' : usedTemplateText ? 'template' : 'ai_generated',
            originalText,
            copyStrategy: screenPlan?.copyStrategy,
            mainMessage: screenPlan?.mainMessage,
            supportingPoints: screenPlan?.supportingPoints,
            generationStatus: generatedContent ? 'generated' : usedTemplateText ? 'template' : 'failed',
            generationReason: generatedContent ? 'screen-plan-copy-strategy' : usedTemplateText ? 'copy-generation-missing' : 'copy-generation-empty'
        });
    }

    const availableAssets = projectAssets.images || [];
    const imageScores: number[] = [];

    for (const placeholder of sortPlaceholdersByFocusedModule(screen.imagePlaceholders || [], focusedModuleLayerIds)) {
        const ranked = rankAssetsForPlaceholder(screen, placeholder, availableAssets, usedPaths, screenPlan);
        const best = ranked[0];

        if (best?.asset?.path) {
            const assetType = normalizeAssetType(best.asset.type);
            const fillMode = resolveInitialFillMode(assetType, screenType, placeholder, screenPlan);
            const placementMetadata = buildPlacementMetadata(screen, placeholder, assetType, fillMode, screenPlan, best.asset);
            usedPaths.add(best.asset.path);
            imageScores.push(best.score);
            images.push({
                layerId: placeholder.layerId,
                layerName: placeholder.layerName,
                imagePath: best.asset.path,
                fillMode,
                assetType,
                needsMatting: assetType === 'product',
                subjectAlign: 'center',
                selectionReason: summarizeCandidate(best),
                ...placementMetadata
            });
        } else {
            const fillMode = resolveInitialFillMode('product', screenType, placeholder, screenPlan);
            const placementMetadata = buildPlacementMetadata(screen, placeholder, 'product', fillMode, screenPlan);
            images.push({
                layerId: placeholder.layerId,
                layerName: placeholder.layerName,
                imagePath: '',
                fillMode,
                assetType: 'product',
                ...placementMetadata
            });
        }
    }

    const imageCoverage = images.length > 0 ? images.filter((item) => !!item.imagePath).length / images.length : 1;
    const averageImageScore = imageScores.length > 0
        ? imageScores.reduce((sum, score) => sum + score, 0) / imageScores.length
        : imageCoverage;
    const baseConfidence = clamp01((imageCoverage * 0.55) + (averageImageScore * 0.45));
    const planPenalty = screenPlan?.requiresModelDecision ? 0.12 : 0;
    const confidence = clamp01(baseConfidence - planPenalty);
    const requiresModelDecision = Boolean(screenPlan?.requiresModelDecision);

    const draftPlan = {
        screenId: screen.id,
        screenName: screen.name,
        screenType,
        screenRole: screenPlan?.screenRole,
        imageStrategy: screenPlan?.imageStrategy,
        copyStrategy: screenPlan?.copyStrategy,
        mainMessage: screenPlan?.mainMessage,
        supportingPoints: screenPlan?.supportingPoints,
        supportRefs: screenPlan?.supportRefs || [],
        copies,
        images,
        confidence,
        needsReview: confidence < 0.68 || requiresModelDecision,
        decisionBoundary: {
            screenDecisionSource: screenPlan?.decisionSource || 'missing',
            requiresModelDecision,
            assetSelectionSource: requiresModelDecision ? 'heuristic-candidate-ranking' : 'agent-guided-ranking',
            note: requiresModelDecision
                ? '素材排序只代表结构和文件候选信号，仍需模型 Agent 决定最终视觉叙事。'
                : '素材排序已使用模型 Agent 的屏幕决策作为约束。'
        },
        ranking: {
            matchedImages: imageScores.length,
            averageImageScore
        }
    };

    const auditedScreens = applyDetailFillPlanCopiesToScreens([screen], [draftPlan]);
    const copyAuditResult = auditDetailCopyLayoutForScreens({
        screens: auditedScreens,
        screenPlans: screenPlan ? [screenPlan] : []
    });
    const screenCopyAudits = copyAuditResult.audits.filter((item) => item.screenId === screen.id);
    const riskyPlaceholderCount = screenCopyAudits.filter((item) => item.status === 'risky').length;
    const watchPlaceholderCount = screenCopyAudits.filter((item) => item.status === 'watch').length;
    const copyAuditStatus: 'ok' | 'watch' | 'risky' =
        riskyPlaceholderCount > 0
            ? 'risky'
            : watchPlaceholderCount > 0
                ? 'watch'
                : 'ok';
    const copyAuditWarnings = screenCopyAudits.flatMap((item) => item.warnings);

    return {
        ...draftPlan,
        needsReview: draftPlan.needsReview || copyAuditStatus === 'risky',
        copyAudit: {
            status: copyAuditStatus,
            warningCount: copyAuditWarnings.length,
            riskyPlaceholderCount,
            watchPlaceholderCount,
            warnings: copyAuditWarnings,
            placeholderAudits: screenCopyAudits.map((item) => ({
                placeholderLayerId: Number(item.placeholderLayerId || 0),
                status: item.status,
                warnings: item.warnings || []
            }))
        }
    };
}

export async function matchDetailPageContentPlans(params: MatchParams): Promise<{ success: true; plans: any[] }> {
    const plans: any[] = [];
    const usedPaths = new Set<string>();
    const screenPlanById = new Map<number, DetailScreenPlan>((params.screenPlans || []).map((plan) => [plan.screenId, plan]));
    const selectedElementContext =
        params.selectedDesignContext?.selectedElementContext ?? params.selectedElementContext ?? null;
    const selectedModuleContext =
        params.selectedDesignContext?.selectedModuleContext ?? params.selectedModuleContext ?? null;
    const selectedScene = params.selectedScene ?? params.selectedDesignContext?.scene ?? null;
    const focusedScreenId = Number(selectedScene?.selectedScreen?.sourceScreenId || 0) || null;
    const orderedScreens = sortScreensByFocus(params.screens || [], focusedScreenId);
    const initialCopyRequests: ScreenCopyRequest[] = orderedScreens
        .map((screen) => {
            const screenPlan = screenPlanById.get(screen.id);
            const copyTargets = (screen.copyPlaceholders || []).map((copy) => ({
                layerId: copy.layerId,
                layerName: copy.layerName,
                originalText: String(copy.currentText || ''),
                currentText: String(copy.currentText || ''),
                role: copy.role,
                bounds: copy.bounds,
                fontSize: copy.fontSize
            }));
            if (!screenPlan || copyTargets.length === 0) {
                return null;
            }
                return {
                    screen,
                    screenPlan,
                    copyTargets: sortPlaceholdersByFocusedModule(copyTargets, getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0))),
                    selectedScene,
                    selectedElementContext,
                    selectedModuleContext,
                    isFocusedScreen: focusedScreenId !== null && Number(screen.id || 0) === focusedScreenId
                };
        })
        .filter(Boolean) as ScreenCopyRequest[];
    const initialCopyReplacements = await requestBatchGeneratedCopies(initialCopyRequests, 'initial');

    for (const screen of orderedScreens) {
        plans.push(await generateScreenPlan(
            screen,
            params.projectAssets,
            usedPaths,
            screenPlanById.get(screen.id),
            initialCopyReplacements,
            selectedScene,
            selectedElementContext,
            selectedModuleContext
        ));
    }

    const repairRequests: ScreenCopyRequest[] = plans
        .map((plan) => {
            const screen = orderedScreens.find((item) => Number(item.id || 0) === Number(plan.screenId || 0));
            const screenPlan = screenPlanById.get(Number(plan.screenId || 0));
            if (!screen || !screenPlan) {
                return null;
            }
            const copyTargets = buildRepairTargets(screen, plan);
            if (copyTargets.length === 0) {
                return null;
            }
                return {
                    screen,
                    screenPlan,
                    copyTargets: sortPlaceholdersByFocusedModule(copyTargets, getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0))),
                    selectedScene,
                    selectedElementContext,
                    selectedModuleContext,
                    isFocusedScreen: focusedScreenId !== null && Number(screen.id || 0) === focusedScreenId
                };
        })
        .filter(Boolean) as ScreenCopyRequest[];

    const repairReplacements = await requestBatchGeneratedCopies(repairRequests, 'repair');
    const repairedPlans = applyBatchCopyRepairs(plans, orderedScreens, screenPlanById, repairReplacements);
    const planByScreenId = new Map<number, any>(repairedPlans.map((plan) => [Number(plan.screenId || 0), plan]));
    const finalPlans = (params.screens || [])
        .map((screen) => planByScreenId.get(Number(screen.id || 0)))
        .filter(Boolean);

    return {
        success: true,
        plans: finalPlans
    };
}

