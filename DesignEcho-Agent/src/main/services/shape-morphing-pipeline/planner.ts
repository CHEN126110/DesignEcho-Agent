import { LayoutRulesService } from '../layout-rules-service';
import { OptimizedMorphingService } from '../morphing/optimized-morphing-service';
import { RegionAwareMatcher } from '../morphing/region-aware-matcher';
import {
    alignSkeletons,
    calculateSkeletonSimilarity,
    extractSkeleton
} from '../sock-morphing/skeleton-alignment';
import type {
    AlignmentExecutionPlan,
    ContentRiskSummary,
    Point2D,
    ScaleDecision,
    SockAnalysisResult,
    DisplacementComputation,
    LayerBounds,
    MorphParamsNormalized,
    MorphRegionKey,
    ShapeMorphQualityMetrics
} from './types';
import type { ControlPointPair } from '../morphing/types';

export class ShapeMorphingPlannerService {
    private static readonly REGION_ORDER = ['cuff', 'leg', 'heel', 'body', 'toe'] as const;
    private static readonly MIN_SKELETON_POINTS = 8;
    private static readonly MIN_SKELETON_SIMILARITY = 0.3;

    constructor(private readonly layoutRulesService?: LayoutRulesService) {}

    buildMorphParams(params: {
        edgeStrength?: number;
        contentProtection?: number;
        smoothness?: number;
        selectedRegions?: string[];
        cuffProtected?: boolean;
        quality?: 'fast' | 'balanced' | 'high';
    }): MorphParamsNormalized {
        const selectedRegions = this.normalizeSelectedRegions(params.selectedRegions ?? []);
        const edgeStrength = this.normalizePercent(params.edgeStrength ?? 70);
        const contentProtection = this.normalizePercent(params.contentProtection ?? 80);
        const smoothness = this.normalizePercent(params.smoothness ?? 50);
        const qualityPreset = this.normalizeQualityPreset(params.quality)
            ?? this.deriveQualityPreset({
                edgeStrength,
                contentProtection,
                smoothness,
                selectedRegions,
                cuffProtected: params.cuffProtected === true,
                qualityPreset: undefined,
                edgeBandWidth: 0,
                transitionWidth: 0,
                gridSize: 0,
                morphPasses: 0,
                patternProtection: 0,
                regionControl: {
                    cuff: 1,
                    leg: 1,
                    heel: 1,
                    body: 1,
                    toe: 1
                },
                preserveSourceLayer: true,
                resultLayerSuffix: '形态统一'
            });

        return {
            edgeStrength,
            contentProtection,
            smoothness,
            selectedRegions,
            cuffProtected: params.cuffProtected === true,
            qualityPreset,
            edgeBandWidth: Math.round(24 + edgeStrength * 56),
            transitionWidth: Math.round(12 + smoothness * 28),
            gridSize: this.deriveGridSize(qualityPreset, smoothness),
            morphPasses: this.deriveMorphPasses(qualityPreset),
            patternProtection: Math.max(contentProtection, params.cuffProtected ? 0.82 : 0.45),
            regionControl: this.buildRegionControlMap(
                selectedRegions,
                params.cuffProtected === true,
                contentProtection
            ),
            preserveSourceLayer: true,
            resultLayerSuffix: '形态统一'
        };
    }

    calculateScalePercent(
        referenceBounds: LayerBounds,
        subjectSize: { width: number; height: number }
    ): ScaleDecision {
        const uniformScale = referenceBounds.height / subjectSize.height;
        const scalePercent = uniformScale * 100;

        return {
            scalePercent,
            source: this.layoutRulesService ? 'reference+rules' : 'reference',
            explanation: `匹配参考形状高度 (${referenceBounds.height.toFixed(0)}px)`
        };
    }

    calculateAlignmentDecision(input: {
        referenceBounds: LayerBounds;
        referenceCenter: Point2D;
        referenceContour?: Point2D[];
        subjectSize: { width: number; height: number };
        subjectCenter: Point2D;
        sourceContour?: Point2D[];
    }): ScaleDecision {
        const fallback = this.calculateScalePercent(input.referenceBounds, input.subjectSize);

        if (!input.referenceContour || !input.sourceContour) {
            return {
                ...fallback,
                targetCenter: input.referenceCenter,
                subjectCenter: input.subjectCenter,
                alignmentMethod: 'yolo-world'
            };
        }

        const skeletonAnchors = this.buildSkeletonAnchors(input.sourceContour, input.referenceContour);
        if (!skeletonAnchors.controlPairs?.length || !skeletonAnchors.similarity) {
            return {
                ...fallback,
                targetCenter: input.referenceCenter,
                subjectCenter: input.subjectCenter,
                alignmentMethod: 'yolo-world'
            };
        }

        const sourceSkeleton = extractSkeleton(input.sourceContour, 18);
        const targetSkeleton = extractSkeleton(input.referenceContour, 18);
        const scalePercent = (targetSkeleton.length / Math.max(sourceSkeleton.length, 1)) * 100;

        const midpoint = skeletonAnchors.controlPairs[Math.floor(skeletonAnchors.controlPairs.length / 2)];
        if (!midpoint) {
            return {
                ...fallback,
                targetCenter: input.referenceCenter,
                subjectCenter: input.subjectCenter,
                alignmentMethod: 'yolo-world'
            };
        }

        return {
            scalePercent,
            source: 'skeleton-axis',
            explanation: `按中轴线长度对齐 (${sourceSkeleton.length.toFixed(0)}px -> ${targetSkeleton.length.toFixed(0)}px, 相似度 ${(skeletonAnchors.similarity * 100).toFixed(0)}%)`,
            targetCenter: midpoint.target,
            subjectCenter: midpoint.source,
            alignmentMethod: 'skeleton-axis'
        };
    }

    buildAlignmentExecutionPlan(input: {
        layerId: number;
        scalePercent: number;
        targetCenter: Point2D;
        subjectCenter: Point2D;
        layerCenter: Point2D;
    }): AlignmentExecutionPlan {
        return { ...input };
    }

    async computeDisplacement(
        morphingService: OptimizedMorphingService,
        input: {
            sourceContour: Point2D[];
            targetContour: Point2D[];
            width: number;
            height: number;
            morphParams: MorphParamsNormalized;
            sourceRegionAnalysis?: SockAnalysisResult;
            targetRegionAnalysis?: SockAnalysisResult;
            sourceImageBase64?: string;
            sourceContentSummary?: ContentRiskSummary;
        }
    ): Promise<DisplacementComputation | null> {
        const fullSourceContour = input.sourceContour;
        const fullTargetContour = input.targetContour;
        const selectedRegions = this.normalizeSelectedRegions(input.morphParams.selectedRegions);
        const qualityPreset = input.morphParams.qualityPreset
            ?? this.deriveQualityPreset(input.morphParams);
        const sourceContour = this.pickRegionalContour(
            fullSourceContour,
            input.sourceRegionAnalysis,
            selectedRegions
        );
        const targetContour = this.pickRegionalContour(
            fullTargetContour,
            input.targetRegionAnalysis,
            selectedRegions
        );
        const matching = this.buildControlPairs(
            fullSourceContour,
            fullTargetContour,
            input.sourceRegionAnalysis,
            input.targetRegionAnalysis,
            selectedRegions
        );
        const weightedControlPairs = this.applyRegionControlWeights(
            matching.controlPairs,
            input.sourceRegionAnalysis,
            input.morphParams.regionControl
        );

        const result = await morphingService.computeDisplacement({
            sourceContour,
            targetContour,
            width: input.width,
            height: input.height,
            sourceImageBase64: input.sourceImageBase64,
            controlPairs: weightedControlPairs,
            config: {
                qualityPreset,
                edgeBandWidth: input.morphParams.edgeBandWidth,
                transitionWidth: input.morphParams.transitionWidth,
                gridSize: input.morphParams.gridSize,
                morphPasses: input.morphParams.morphPasses,
                detectPatterns: input.morphParams.contentProtection > 0.08,
                detectLace: input.morphParams.cuffProtected,
                patternProtection: input.morphParams.patternProtection
            }
        });

        if (!result.success || !result.sparseDisplacement) {
            return null;
        }

        return {
            sparseDisplacement: result.sparseDisplacement,
            processingTime: result.processingTime,
            qualityPreset,
            selectedRegionsApplied: selectedRegions,
            matchingStrategy: matching.strategy,
            controlPairCount: matching.controlPairs?.length,
            matchingQuality: matching.qualityScore,
            matchingWarnings: matching.warnings,
            skeletonAnchorCount: matching.skeletonAnchorCount,
            skeletonSimilarity: matching.skeletonSimilarity,
            skeletonWarnings: matching.skeletonWarnings,
            qualityMetrics: this.buildQualityMetrics({
                width: input.width,
                height: input.height,
                selectedRegions,
                morphParams: input.morphParams,
                matchingQuality: matching.qualityScore,
                skeletonSimilarity: matching.skeletonSimilarity,
                sourceContentSummary: input.sourceContentSummary,
                avgDisplacementPx: result.stats?.avgDisplacementPx,
                maxDisplacementPx: result.stats?.maxDisplacementPx
            })
        };
    }

    private deriveQualityPreset(
        morphParams: MorphParamsNormalized
    ): 'fast' | 'balanced' | 'quality' {
        const avgStrength = (morphParams.edgeStrength + morphParams.smoothness) / 2;
        if (avgStrength < 0.3) {
            return 'fast';
        }
        if (avgStrength > 0.7) {
            return 'quality';
        }
        return 'balanced';
    }

    private normalizeQualityPreset(
        quality?: 'fast' | 'balanced' | 'high'
    ): 'fast' | 'balanced' | 'quality' | undefined {
        if (quality === 'high') {
            return 'quality';
        }
        if (quality === 'fast' || quality === 'balanced') {
            return quality;
        }
        return undefined;
    }

    private normalizeSelectedRegions(regions: string[]): MorphRegionKey[] {
        const normalized = regions
            .map((region) => region === 'foot' ? 'body' : region)
            .filter(
                (region): region is MorphRegionKey =>
                    ShapeMorphingPlannerService.REGION_ORDER.includes(
                        region as MorphRegionKey
                    )
            );
        return Array.from(new Set(normalized));
    }

    private pickRegionalContour(
        fallbackContour: Point2D[],
        regionAnalysis: SockAnalysisResult | undefined,
        selectedRegions: MorphRegionKey[]
    ): Point2D[] {
        if (
            !regionAnalysis?.success ||
            !regionAnalysis.regions ||
            selectedRegions.length === 0 ||
            selectedRegions.length === ShapeMorphingPlannerService.REGION_ORDER.length
        ) {
            return fallbackContour;
        }

        const pickedPoints: Point2D[] = [];
        for (const regionKey of ShapeMorphingPlannerService.REGION_ORDER) {
            if (!selectedRegions.includes(regionKey)) {
                continue;
            }
            pickedPoints.push(...regionAnalysis.regions[regionKey].contourPoints);
        }

        return pickedPoints.length >= 20 ? pickedPoints : fallbackContour;
    }

    private buildControlPairs(
        sourceContour: Point2D[],
        targetContour: Point2D[],
        sourceRegionAnalysis: SockAnalysisResult | undefined,
        targetRegionAnalysis: SockAnalysisResult | undefined,
        selectedRegions: MorphRegionKey[]
    ): {
        strategy: 'region-aware' | 'region-aware+skeleton' | 'contour';
        controlPairs?: ControlPointPair[];
        qualityScore?: number;
        warnings?: string[];
        skeletonAnchorCount?: number;
        skeletonSimilarity?: number;
        skeletonWarnings?: string[];
    } {
        const skeletonAnchors = this.buildSkeletonAnchors(sourceContour, targetContour);

        if (
            !sourceRegionAnalysis?.success ||
            !targetRegionAnalysis?.success ||
            !sourceRegionAnalysis.regions ||
            !targetRegionAnalysis.regions
        ) {
            return {
                strategy: 'contour',
                skeletonAnchorCount: skeletonAnchors.controlPairs?.length,
                skeletonSimilarity: skeletonAnchors.similarity,
                skeletonWarnings: skeletonAnchors.warnings
            };
        }

        const matcher = new RegionAwareMatcher();
        const matching = matcher.match(
            sourceRegionAnalysis.regions,
            targetRegionAnalysis.regions,
            sourceRegionAnalysis.cuffAnalysis,
            targetRegionAnalysis.cuffAnalysis
        );

        const allRegionsSelected =
            selectedRegions.length === 0 ||
            selectedRegions.length === ShapeMorphingPlannerService.REGION_ORDER.length;

        const regionFilteredPairs = allRegionsSelected
            ? matching.controlPairs
            : selectedRegions.flatMap((regionKey) => matching.regionMapping.get(regionKey as keyof typeof sourceRegionAnalysis.regions) ?? []);

        const controlPairs = regionFilteredPairs.length >= 8 ? regionFilteredPairs : matching.controlPairs;
        if (controlPairs.length < 8 || matching.qualityScore < 0.35) {
            return {
                strategy: 'contour',
                qualityScore: matching.qualityScore,
                warnings: [...matching.warnings, '区域感知匹配质量不足，回退到轮廓匹配'],
                skeletonAnchorCount: skeletonAnchors.controlPairs?.length,
                skeletonSimilarity: skeletonAnchors.similarity,
                skeletonWarnings: skeletonAnchors.warnings
            };
        }

        const mergedControlPairs = skeletonAnchors.controlPairs?.length
            ? [...controlPairs, ...skeletonAnchors.controlPairs]
            : controlPairs;

        return {
            strategy: skeletonAnchors.controlPairs?.length ? 'region-aware+skeleton' : 'region-aware',
            controlPairs: mergedControlPairs,
            qualityScore: matching.qualityScore,
            warnings: matching.warnings,
            skeletonAnchorCount: skeletonAnchors.controlPairs?.length,
            skeletonSimilarity: skeletonAnchors.similarity,
            skeletonWarnings: skeletonAnchors.warnings
        };
    }

    private normalizePercent(value: number): number {
        return Math.max(0, Math.min(1, value / 100));
    }

    private deriveGridSize(
        qualityPreset: 'fast' | 'balanced' | 'quality',
        smoothness: number
    ): number {
        if (qualityPreset === 'quality') {
            return smoothness > 0.7 ? 20 : 24;
        }
        if (qualityPreset === 'fast') {
            return smoothness < 0.35 ? 72 : 64;
        }
        return smoothness > 0.7 ? 36 : 44;
    }

    private deriveMorphPasses(qualityPreset: 'fast' | 'balanced' | 'quality'): number {
        if (qualityPreset === 'quality') {
            return 3;
        }
        if (qualityPreset === 'fast') {
            return 1;
        }
        return 2;
    }

    private buildRegionControlMap(
        selectedRegions: MorphRegionKey[],
        cuffProtected: boolean,
        contentProtection: number
    ): Record<MorphRegionKey, number> {
        const allSelected = selectedRegions.length === 0
            || selectedRegions.length === ShapeMorphingPlannerService.REGION_ORDER.length;

        const regionControl = ShapeMorphingPlannerService.REGION_ORDER.reduce((acc, region) => {
            acc[region] = allSelected || selectedRegions.includes(region) ? 1 : 0.22;
            return acc;
        }, {} as Record<MorphRegionKey, number>);

        if (cuffProtected) {
            regionControl.cuff = Math.min(regionControl.cuff, Math.max(0.05, 0.25 - contentProtection * 0.15));
        }

        if (contentProtection > 0.7) {
            regionControl.heel = Math.min(regionControl.heel, 0.72);
            regionControl.toe = Math.min(regionControl.toe, 0.76);
        }

        return regionControl;
    }

    private applyRegionControlWeights(
        controlPairs: ControlPointPair[] | undefined,
        sourceRegionAnalysis: SockAnalysisResult | undefined,
        regionControl: Record<MorphRegionKey, number>
    ): ControlPointPair[] | undefined {
        if (!controlPairs?.length || !sourceRegionAnalysis?.success || !sourceRegionAnalysis.regions) {
            return controlPairs;
        }

        return controlPairs.map((pair) => {
            const regionKey = this.locateRegionForPoint(pair.source, sourceRegionAnalysis);
            const multiplier = regionKey ? regionControl[regionKey] : 1;
            return {
                ...pair,
                weight: Math.max(0.05, Math.min(1, pair.weight * multiplier))
            };
        });
    }

    private locateRegionForPoint(
        point: Point2D,
        analysis: SockAnalysisResult
    ): MorphRegionKey | null {
        if (!analysis.regions) {
            return null;
        }

        for (const regionKey of ShapeMorphingPlannerService.REGION_ORDER) {
            const region = analysis.regions[regionKey];
            if (
                point.x >= region.bounds.x &&
                point.x <= region.bounds.x + region.bounds.width &&
                point.y >= region.bounds.y &&
                point.y <= region.bounds.y + region.bounds.height
            ) {
                return regionKey;
            }
        }

        return null;
    }

    private buildQualityMetrics(input: {
        width: number;
        height: number;
        selectedRegions: MorphRegionKey[];
        morphParams: MorphParamsNormalized;
        matchingQuality?: number;
        skeletonSimilarity?: number;
        sourceContentSummary?: ContentRiskSummary;
        avgDisplacementPx?: number;
        maxDisplacementPx?: number;
    }): ShapeMorphQualityMetrics {
        const diagonal = Math.max(Math.hypot(input.width, input.height), 1);
        const avgDisplacementPx = input.avgDisplacementPx ?? 0;
        const maxDisplacementPx = input.maxDisplacementPx ?? 0;
        const matchingQuality = input.matchingQuality ?? 0.55;
        const skeletonSimilarity = input.skeletonSimilarity ?? 0.45;
        const selectedRegionCoverage = input.selectedRegions.length === 0
            ? 1
            : input.selectedRegions.length / ShapeMorphingPlannerService.REGION_ORDER.length;
        const contourCoverage = Math.min(1, 0.45 + selectedRegionCoverage * 0.55);
        const estimatedStrain = Math.max(
            0,
            Math.min(1, (maxDisplacementPx / diagonal) * (1.18 - input.morphParams.smoothness * 0.35))
        );
        const patternRisk = Math.max(
            0,
            Math.min(
                1,
                (input.sourceContentSummary?.patternComplexity ?? 0) * (0.55 + input.morphParams.contentProtection * 0.45)
            )
        );
        const cuffRiskBase = input.sourceContentSummary?.cuffProtectionLevel ?? 0;
        const cuffRisk = Math.max(
            0,
            Math.min(1, input.morphParams.cuffProtected ? cuffRiskBase * 0.45 : cuffRiskBase)
        );
        const textureRisk = Math.max(0, Math.min(1, input.sourceContentSummary?.textureRichness ?? 0));

        const overallScore = Math.max(
            0,
            Math.min(
                1,
                matchingQuality * 0.28
                + skeletonSimilarity * 0.12
                + contourCoverage * 0.15
                + (1 - estimatedStrain) * 0.25
                + (1 - patternRisk) * 0.1
                + (1 - cuffRisk) * 0.06
                + (1 - textureRisk * 0.4) * 0.04
            )
        );

        return {
            contourCoverage,
            matchingQuality,
            skeletonSimilarity,
            selectedRegionCoverage,
            estimatedStrain,
            patternRisk,
            cuffRisk,
            textureRisk,
            avgDisplacementPx,
            maxDisplacementPx,
            overallScore
        };
    }

    private buildSkeletonAnchors(
        sourceContour: Point2D[],
        targetContour: Point2D[]
    ): {
        controlPairs?: ControlPointPair[];
        similarity?: number;
        warnings: string[];
    } {
        const warnings: string[] = [];
        if (sourceContour.length < 20 || targetContour.length < 20) {
            warnings.push('轮廓点数不足，跳过骨架锚点');
            return { warnings };
        }

        try {
            const sourceSkeleton = extractSkeleton(sourceContour, 18);
            const targetSkeleton = extractSkeleton(targetContour, 18);

            if (
                sourceSkeleton.points.length < ShapeMorphingPlannerService.MIN_SKELETON_POINTS ||
                targetSkeleton.points.length < ShapeMorphingPlannerService.MIN_SKELETON_POINTS ||
                sourceSkeleton.length <= 0 ||
                targetSkeleton.length <= 0
            ) {
                warnings.push('骨架点数不足，跳过骨架锚点');
                return { warnings };
            }

            const similarity = calculateSkeletonSimilarity(sourceSkeleton, targetSkeleton);
            if (similarity < ShapeMorphingPlannerService.MIN_SKELETON_SIMILARITY) {
                warnings.push(`骨架相似度过低 (${similarity.toFixed(2)})，跳过骨架锚点`);
                return { similarity, warnings };
            }

            const alignment = alignSkeletons(sourceSkeleton, targetSkeleton, 10);
            const controlPairs: ControlPointPair[] = alignment.correspondences.map((corr) => ({
                source: corr.sourcePoint,
                target: corr.targetPoint,
                weight: corr.t <= 0.15 || corr.t >= 0.85 ? 0.82 : 0.68
            }));

            return {
                controlPairs,
                similarity,
                warnings
            };
        } catch (error: any) {
            warnings.push(`骨架锚点构建失败: ${error.message || 'unknown error'}`);
            return { warnings };
        }
    }
}
