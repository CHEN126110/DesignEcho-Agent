import { executeToolCall } from '../tool-executor.service';
import type { SkillExecuteParams } from './types';

interface GeneratedTemplateScreen {
    id: number;
    name: string;
    type: string;
    copyPlaceholders: Array<unknown>;
    imagePlaceholders: Array<unknown>;
}

function clamp01(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function calculatePlanScore(plan: any): {
    confidence: number;
    imageCoverage: number;
    score: number;
} {
    const images = Array.isArray(plan?.images) ? plan.images : [];
    const copies = Array.isArray(plan?.copies) ? plan.copies : [];
    const imageTotal = images.length;
    const imageMatched = images.filter((img: any) => !!img?.imagePath).length;
    const imageCoverage = imageTotal > 0 ? imageMatched / imageTotal : 1;
    const copyTotal = copies.length;
    const copyNonEmpty = copies.filter((c: any) => String(c?.content || '').trim().length > 0).length;
    const copyCoverage = copyTotal > 0 ? copyNonEmpty / copyTotal : 1;
    const confidence = clamp01(Number(plan?.confidence), imageCoverage);
    const score = imageCoverage * 0.65 + copyCoverage * 0.2 + confidence * 0.15;
    return { confidence, imageCoverage, score };
}

export async function autoFillAppliedTemplate(
    screens: GeneratedTemplateScreen[],
    projectPath: string,
    callbacks: SkillExecuteParams['callbacks'],
    signal?: AbortSignal,
    options?: {
        minPlanScore?: number;
        minImageCoverage?: number;
        allowLowConfidenceFill?: boolean;
    }
): Promise<{
    success: boolean;
    filledScreens: number;
    failedScreens: number;
    skippedScreens: number;
    guardedScreens: number;
    filledImages: number;
    plansCount: number;
}> {
    const minPlanScore = clamp01(Number(options?.minPlanScore), 0.62);
    const minImageCoverage = clamp01(Number(options?.minImageCoverage), 0.6);
    const allowLowConfidenceFill = options?.allowLowConfidenceFill === true;

    const matchResult = await executeToolCall('matchDetailPageContent', {
        screens,
        projectPath
    });
    if (!matchResult?.success || !Array.isArray(matchResult?.plans)) {
        return {
            success: false,
            filledScreens: 0,
            failedScreens: 0,
            skippedScreens: screens.length,
            guardedScreens: 0,
            filledImages: 0,
            plansCount: 0
        };
    }

    const plans: any[] = matchResult.plans;
    const planByScreenId = new Map<number, any>();
    plans.forEach((plan) => {
        if (!planByScreenId.has(plan.screenId)) {
            planByScreenId.set(plan.screenId, plan);
        }
    });

    let filledScreens = 0;
    let failedScreens = 0;
    let skippedScreens = 0;
    let guardedScreens = 0;
    let filledImages = 0;

    for (let i = 0; i < screens.length; i++) {
        if (signal?.aborted) break;

        const screen = screens[i];
        const plan = planByScreenId.get(screen.id) || plans[i];
        if (!plan) {
            skippedScreens++;
            continue;
        }

        const quality = calculatePlanScore(plan);
        const shouldGuard = !allowLowConfidenceFill
            && (
                !!plan.needsReview
                || quality.score < minPlanScore
                || quality.imageCoverage < minImageCoverage
            );
        const planToApply = shouldGuard ? { ...plan, images: [] } : plan;
        if (shouldGuard) {
            guardedScreens++;
            callbacks?.onMessage?.(
                `自动填充保护: ${screen.name} 评分 ${quality.score.toFixed(2)}，仅填文案`
            );
        }

        const hasCopies = Array.isArray(planToApply.copies) && planToApply.copies.length > 0;
        const hasImages = Array.isArray(planToApply.images) && planToApply.images.some((img: any) => !!img?.imagePath);
        if (!hasCopies && !hasImages) {
            skippedScreens++;
            continue;
        }

        callbacks?.onMessage?.(`自动填充: ${screen.name}`);
        const fillResult = await executeToolCall('fillDetailPage', { plan: planToApply });
        if (fillResult?.success) {
            filledScreens++;
            filledImages += (planToApply.images || []).filter((img: any) => !!img?.imagePath).length;
        } else {
            failedScreens++;
        }
    }

    return {
        success: failedScreens === 0,
        filledScreens,
        failedScreens,
        skippedScreens,
        guardedScreens,
        filledImages,
        plansCount: plans.length
    };
}
