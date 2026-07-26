import type { FillPlan, ImagePlaceholder, ParsedScreen } from './detail-page.types';
import type { DetailLayoutAssessment, DetailScreenLayoutAssessment } from './detail-page-layout-analyzer';

type FitMode = 'cover' | 'contain' | 'smart' | 'aesthetic';
type SubjectAlign = 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface DetailImageFitDecision {
    layerId: number;
    fillMode: FitMode;
    subjectAlign: SubjectAlign;
    score: number;
    reason: string;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function inferSideAlign(bounds: any, screenBounds: any): SubjectAlign {
    const centerX = (Number(bounds?.left || 0) + Number(bounds?.right || 0)) / 2;
    const width = Math.max(1, Number(screenBounds?.width || 1));
    const normalizedCenterX = centerX / width;
    if (normalizedCenterX <= 0.34) return 'left';
    if (normalizedCenterX >= 0.66) return 'right';
    return 'center';
}

function inferVerticalAlign(bounds: any, screenBounds: any): SubjectAlign {
    const centerY = (Number(bounds?.top || 0) + Number(bounds?.bottom || 0)) / 2;
    const height = Math.max(1, Number(screenBounds?.height || 1));
    const normalizedCenterY = centerY / height;
    if (normalizedCenterY <= 0.34) return 'top';
    if (normalizedCenterY >= 0.66) return 'bottom';
    return 'center';
}

function getPlaceholderAreaRatio(screen: ParsedScreen, placeholder: ImagePlaceholder): number {
    const screenArea = Math.max(1, Number(screen.bounds?.width || 1) * Number(screen.bounds?.height || 1));
    const width = Math.max(1, Number(placeholder?.bounds?.width || 0));
    const height = Math.max(1, Number(placeholder?.bounds?.height || 0));
    return clamp01((width * height) / screenArea);
}

function isHeroLikeScreen(screenType: string): boolean {
    return /hero|kv|banner|首屏|核心|营销/.test(screenType);
}

function buildDecision(
    placeholder: ImagePlaceholder,
    fillMode: FitMode,
    subjectAlign: SubjectAlign,
    score: number,
    reason: string
): DetailImageFitDecision {
    return {
        layerId: placeholder.layerId,
        fillMode,
        subjectAlign,
        score: clamp01(score),
        reason
    };
}

export function decideDetailImageFit(
    screen: ParsedScreen,
    placeholder: ImagePlaceholder,
    imagePlan: any,
    screenAssessment?: DetailScreenLayoutAssessment
): DetailImageFitDecision {
    const assetType = String(imagePlan?.assetType || placeholder?.recommendedAssetType || 'product');
    const screenType = String(screen.type || '').toLowerCase();
    const zone = String(placeholder?.zone || imagePlan?.zone || '').toLowerCase();
    const aspectRatio = Number(placeholder?.aspectRatio || 1);
    const clipped = !!placeholder?.isClippingMask || !!placeholder?.clippingInfo?.isClipped;
    const clipBaseBounds = placeholder?.clippingInfo?.baseBounds;
    const layerName = String(placeholder?.layerName || '').toLowerCase();
    const iconLike = zone === 'icon' || /icon|图标|标签|装饰/.test(layerName);
    const placeholderAreaRatio = getPlaceholderAreaRatio(screen, placeholder);
    const layoutMode = screenAssessment?.mode || 'stable';
    const riskDownshift = layoutMode === 'risky';
    const watchMode = layoutMode === 'watch';
    const sideAlign = inferSideAlign(placeholder.bounds, screen.bounds);
    const verticalAlign = inferVerticalAlign(placeholder.bounds, screen.bounds);
    const heroLike = isHeroLikeScreen(screenType);
    const wideContainer = aspectRatio > 1.45;
    const tallContainer = aspectRatio < 0.95;
    const largeContainer = placeholderAreaRatio >= 0.28;
    const clippedWidth = clipBaseBounds?.width || Math.max(0, Number(clipBaseBounds?.right || 0) - Number(clipBaseBounds?.left || 0));
    const clippedHeight = clipBaseBounds?.height || Math.max(0, Number(clipBaseBounds?.bottom || 0) - Number(clipBaseBounds?.top || 0));
    const clipAspectRatio = clippedWidth > 0 && clippedHeight > 0 ? clippedWidth / clippedHeight : aspectRatio;

    if (iconLike || assetType === 'icon') {
        return buildDecision(placeholder, 'contain', 'center', 0.95, 'Icon slot keeps the full asset visible.');
    }

    if (assetType === 'scene') {
        if (riskDownshift) {
            return buildDecision(placeholder, 'smart', 'center', 0.78, 'Layout risk is high, use conservative scene placement.');
        }
        if (heroLike || largeContainer) {
            return buildDecision(
                placeholder,
                clipped ? 'smart' : 'cover',
                sideAlign,
                heroLike ? 0.9 : 0.84,
                heroLike ? 'Hero screen prefers immersive coverage.' : 'Large scene slot prefers visual extension.'
            );
        }
        return buildDecision(placeholder, 'smart', sideAlign, 0.8, 'Scene image keeps context while following slot direction.');
    }

    if (assetType === 'model') {
        if (riskDownshift) {
            return buildDecision(placeholder, 'contain', 'center', 0.76, 'Layout risk is high, keep the model fully visible first.');
        }
        if (tallContainer) {
            return buildDecision(
                placeholder,
                clipped ? 'smart' : 'cover',
                verticalAlign === 'bottom' ? 'bottom' : 'top',
                0.84,
                'Tall model slot prioritizes body framing and headroom.'
            );
        }
        return buildDecision(placeholder, watchMode ? 'smart' : 'contain', 'center', 0.8, 'Model image keeps the subject readable before aggressive cropping.');
    }

    if (assetType === 'detail') {
        if (riskDownshift) {
            return buildDecision(placeholder, 'contain', 'center', 0.74, 'Layout risk is high, keep detail imagery conservative.');
        }
        return buildDecision(
            placeholder,
            clipped || clipAspectRatio > 1.25 ? 'smart' : 'contain',
            'center',
            clipped ? 0.84 : 0.78,
            clipped ? 'Detail image balances density and clipping container bounds.' : 'Detail image stays readable with low crop pressure.'
        );
    }

    if (riskDownshift) {
        return buildDecision(placeholder, 'contain', 'center', 0.72, 'Layout risk is high, keep the product fully visible.');
    }

    if (clipped) {
        return buildDecision(
            placeholder,
            watchMode ? 'contain' : 'smart',
            wideContainer ? sideAlign : 'center',
            0.79,
            'Product image inside clipping container should preserve subject while reducing hard edge cuts.'
        );
    }

    if (wideContainer) {
        return buildDecision(placeholder, 'contain', sideAlign, 0.78, 'Wide product slot keeps the subject complete and follows layout direction.');
    }

    if (largeContainer && !watchMode) {
        return buildDecision(placeholder, 'smart', 'center', 0.77, 'Large product slot allows mild smart enlargement.');
    }

    return buildDecision(placeholder, 'contain', 'center', 0.75, 'Product image defaults to full-subject placement.');
}

export function applyDetailImageFitDecisions(
    plans: Array<FillPlan | undefined>,
    screens: ParsedScreen[],
    layoutAssessment?: DetailLayoutAssessment
): { plans: Array<FillPlan | undefined>; decisionCount: number; decisions: DetailImageFitDecision[] } {
    const screenMap = new Map<number, ParsedScreen>(screens.map((screen) => [screen.id, screen]));
    const assessmentMap = new Map<number, DetailScreenLayoutAssessment>(
        (layoutAssessment?.screenAssessments || []).map((assessment) => [assessment.screenId, assessment])
    );
    const decisions: DetailImageFitDecision[] = [];

    const nextPlans = (plans || []).map((plan) => {
        if (!plan) return plan;
        const screen = screenMap.get(plan.screenId);
        if (!screen) return plan;
        const screenAssessment = assessmentMap.get(plan.screenId);

        const placeholderMap = new Map<number, ImagePlaceholder>(
            (screen.imagePlaceholders || []).map((placeholder) => [placeholder.layerId, placeholder])
        );

        const images = (plan.images || []).map((imagePlan) => {
            const placeholder = placeholderMap.get(imagePlan.layerId);
            if (!placeholder) return imagePlan;

            const decision = decideDetailImageFit(screen, placeholder, imagePlan, screenAssessment);
            decisions.push(decision);

            return {
                ...imagePlan,
                fillMode: decision.fillMode,
                subjectAlign: decision.subjectAlign,
                fitReason: decision.reason
            };
        });

        return { ...plan, images };
    });

    return { plans: nextPlans, decisionCount: decisions.length, decisions };
}
