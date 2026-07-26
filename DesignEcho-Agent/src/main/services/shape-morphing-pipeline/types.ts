import type { Point2D } from '../morphing/types';
import type { SockAnalysisResult } from '../morphing/sock-region-analyzer';

export type { Point2D } from '../morphing/types';
export type { SockAnalysisResult } from '../morphing/sock-region-analyzer';

export interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface SubjectInfo {
    center: Point2D;
    size: {
        width: number;
        height: number;
    };
}

export interface ExportedLayerImage {
    base64: string;
    width: number;
    height: number;
}

export interface ContourData {
    points: Point2D[];
    width: number;
    height: number;
}

export type MorphRegionKey = 'cuff' | 'leg' | 'heel' | 'body' | 'toe';

export interface ContentRiskSummary {
    hasPattern: boolean;
    patternComplexity: number;
    textureRichness: number;
    cuffType: string;
    cuffConfidence: number;
    cuffProtectionLevel: number;
}

export interface ReferenceShapeAnalysis {
    layerId: number;
    bounds: LayerBounds;
    center: Point2D;
    contour?: ContourData;
    regionAnalysis?: SockAnalysisResult;
    contentSummary?: ContentRiskSummary;
}

export interface ProductLayerAnalysis {
    layerId: number;
    bounds: LayerBounds;
    layerCenter: Point2D;
    exportedImage?: ExportedLayerImage;
    subjectInfo?: SubjectInfo;
    contour?: ContourData;
    regionAnalysis?: SockAnalysisResult;
    contentSummary?: ContentRiskSummary;
}

export interface ScaleDecision {
    scalePercent: number;
    source: string;
    explanation: string;
    targetCenter?: Point2D;
    subjectCenter?: Point2D;
    alignmentMethod?: 'yolo-world' | 'skeleton-axis';
}

export interface AlignmentExecutionPlan {
    layerId: number;
    scalePercent: number;
    targetCenter: Point2D;
    subjectCenter: Point2D;
    layerCenter: Point2D;
}

export interface MorphParamsNormalized {
    edgeStrength: number;
    contentProtection: number;
    smoothness: number;
    selectedRegions: MorphRegionKey[];
    cuffProtected: boolean;
    qualityPreset?: 'fast' | 'balanced' | 'quality';
    edgeBandWidth: number;
    transitionWidth: number;
    gridSize: number;
    morphPasses: number;
    patternProtection: number;
    regionControl: Record<MorphRegionKey, number>;
    preserveSourceLayer: boolean;
    resultLayerSuffix: string;
}

export interface ShapeMorphQualityMetrics {
    contourCoverage: number;
    matchingQuality: number;
    skeletonSimilarity: number;
    selectedRegionCoverage: number;
    estimatedStrain: number;
    patternRisk: number;
    cuffRisk: number;
    textureRisk: number;
    avgDisplacementPx: number;
    maxDisplacementPx: number;
    overallScore: number;
}

export interface DisplacementComputation {
    sparseDisplacement: string;
    processingTime: number;
    qualityPreset: 'fast' | 'balanced' | 'quality';
    selectedRegionsApplied?: MorphRegionKey[];
    matchingStrategy?: 'region-aware' | 'region-aware+skeleton' | 'contour';
    controlPairCount?: number;
    matchingQuality?: number;
    matchingWarnings?: string[];
    skeletonAnchorCount?: number;
    skeletonSimilarity?: number;
    skeletonWarnings?: string[];
    qualityMetrics?: ShapeMorphQualityMetrics;
}

export interface ShapeMorphValidationIssue {
    severity: 'error' | 'warning';
    code: string;
    message: string;
    layerId?: number;
}

export interface ShapeMorphDiagnostics {
    mode: 'prototype-v1';
    acceptedLayerIds: number[];
    rejectedLayerIds: number[];
    supportedSockStyles: string[];
    supportedCuffTypes: string[];
    requestedSelectedRegions?: string[];
    requestedQuality?: string;
}
