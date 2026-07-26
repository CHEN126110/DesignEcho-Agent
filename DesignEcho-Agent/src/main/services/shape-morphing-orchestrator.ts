/**
 * 形态统一编排服务
 *
 * 当前职责只保留为：
 * - 校验输入
 * - 调度 analyzer / planner / validator / executor
 * - 组织结果摘要
 *
 * 这样后续做 prototype 时，问题能明确落到：
 * - 分析
 * - 规划
 * - 验证
 * - 写回
 * 而不是继续堆在一个大文件里。
 */

import { LayoutRulesService } from './layout-rules-service';
import { MattingService } from './matting-service';
import { OptimizedMorphingService } from './morphing/optimized-morphing-service';
import { WebSocketServer } from '../websocket/server';
import { ShapeMorphingAnalyzerService } from './shape-morphing-pipeline/analyzer';
import { ShapeMorphingExecutorService } from './shape-morphing-pipeline/executor';
import { ShapeMorphingPlannerService } from './shape-morphing-pipeline/planner';
import type {
    LayerBounds,
    Point2D,
    ShapeMorphDiagnostics,
    ShapeMorphValidationIssue
} from './shape-morphing-pipeline/types';
import { ShapeMorphingValidatorService } from './shape-morphing-pipeline/validator';

export type { LayerBounds, Point2D, ShapeMorphDiagnostics, ShapeMorphValidationIssue } from './shape-morphing-pipeline/types';

export interface ShapeMorphingParams {
    referenceShapeId: number;
    productLayerIds: number[];
    step?: 'align' | 'contour' | 'analyze' | 'morph' | 'all';

    preAlign?: boolean;
    shapeMatch?: boolean;

    edgeStrength?: number;
    contentProtection?: number;
    smoothness?: number;

    selectedRegions?: string[];
    regionControl?: { cuff?: number; leg?: number; heel?: number; body?: number; toe?: number };

    sockStyle?: string;
    cuffType?: string;
    cuffProtected?: boolean;

    quality?: 'fast' | 'balanced' | 'high';
    useAdvancedDetection?: boolean;
    useOptimizedMorphing?: boolean;
    forceRedetect?: boolean;
    preferredExecution?: 'optimized-displacement' | 'native-puppet' | 'auto';
    nativeFallback?: 'apply-morphed-image' | 'optimized-displacement' | 'none';

    intensity?: number;
}

export interface AlignmentResult {
    layerId: number;
    success: boolean;
    error?: string;
    method?: string;
    scale?: { x: number; y: number };
}

export interface ShapeMorphingResult {
    success: boolean;
    results: AlignmentResult[];
    message?: string;
    error?: string;
    warnings?: string[];
    issues?: ShapeMorphValidationIssue[];
    diagnostics?: ShapeMorphDiagnostics;
}

export class ShapeMorphingOrchestrator {
    private readonly analyzer: ShapeMorphingAnalyzerService;
    private readonly planner: ShapeMorphingPlannerService;
    private readonly validator: ShapeMorphingValidatorService;
    private readonly executor: ShapeMorphingExecutorService;
    private readonly morphingService: OptimizedMorphingService;

    constructor(
        private readonly wsServer: WebSocketServer,
        mattingService: MattingService,
        layoutRulesService?: LayoutRulesService
    ) {
        this.analyzer = new ShapeMorphingAnalyzerService(wsServer, mattingService);
        this.planner = new ShapeMorphingPlannerService(layoutRulesService);
        this.validator = new ShapeMorphingValidatorService();
        this.executor = new ShapeMorphingExecutorService(wsServer);
        this.morphingService = new OptimizedMorphingService();
    }

    async executeAlignment(params: ShapeMorphingParams): Promise<ShapeMorphingResult> {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║     形态统一 - 对齐步骤                  ║');
        console.log('╚════════════════════════════════════════╝');

        const validationIssues = this.validator.validateParams(params, ['align', 'morph', 'all']);
        if (this.validator.hasBlockingIssue(validationIssues)) {
            return {
                success: false,
                results: [],
                error: this.validator.toMessage(validationIssues)
            };
        }

        const { referenceShapeId, productLayerIds, preAlign = true } = params;
        const results: AlignmentResult[] = [];
        const warnings: string[] = [];
        const allIssues: ShapeMorphValidationIssue[] = [];

        if (!preAlign) {
            for (const layerId of productLayerIds) {
                results.push({ layerId, success: true, method: 'skipped' });
            }
            return {
                success: true,
                results,
                message: '对齐步骤已跳过',
                warnings,
                issues: allIssues,
                diagnostics: this.buildDiagnostics(results, params)
            };
        }

        const reference = await this.analyzer.analyzeReferenceShape(referenceShapeId, {
            includeContour: true
        });
        const referenceIssues = this.validator.validateReferenceForAlignment(reference);
        allIssues.push(...referenceIssues);
        warnings.push(...this.validator.toWarnings(referenceIssues));
        if (this.validator.hasBlockingIssue(referenceIssues)) {
            return {
                success: false,
                results,
                error: this.validator.toMessage(referenceIssues),
                warnings,
                issues: allIssues,
                diagnostics: this.buildDiagnostics(results, params)
            };
        }

        for (const layerId of productLayerIds) {
            try {
                const product = await this.analyzer.analyzeProductLayer(layerId, {
                    includeSubject: true,
                    includeContour: true
                });
                const issues = this.validator.validateProductForAlignment(product);
                allIssues.push(...issues);
                warnings.push(...this.validator.toWarnings(issues));
                if (this.validator.hasBlockingIssue(issues) || !product || !product.subjectInfo || !reference) {
                    results.push({
                        layerId,
                        success: false,
                        error: this.validator.toMessage(issues)
                    });
                    continue;
                }

                const scaleInfo = this.planner.calculateAlignmentDecision({
                    referenceBounds: reference.bounds,
                    referenceCenter: reference.center,
                    referenceContour: reference.contour?.points,
                    subjectSize: product.subjectInfo.size,
                    subjectCenter: product.subjectInfo.center,
                    sourceContour: product.contour?.points
                });

                const plan = this.planner.buildAlignmentExecutionPlan({
                    layerId,
                    scalePercent: scaleInfo.scalePercent,
                    targetCenter: scaleInfo.targetCenter ?? reference.center,
                    subjectCenter: scaleInfo.subjectCenter ?? product.subjectInfo.center,
                    layerCenter: product.layerCenter
                });

                const success = await this.executor.alignLayer(plan);
                results.push(success
                    ? {
                        layerId,
                        success: true,
                        method: scaleInfo.alignmentMethod ?? 'yolo-world',
                        scale: { x: scaleInfo.scalePercent, y: scaleInfo.scalePercent }
                    }
                    : {
                        layerId,
                        success: false,
                        error: '对齐执行失败'
                    });
            } catch (error: any) {
                results.push({
                    layerId,
                    success: false,
                    error: error.message || '对齐异常'
                });
            }
        }

        const successCount = results.filter((item) => item.success).length;
        return {
            success: successCount > 0,
            results,
            message: `完成: ${successCount}/${productLayerIds.length} 个图层对齐成功`,
            warnings: Array.from(new Set(warnings)),
            issues: allIssues,
            diagnostics: this.buildDiagnostics(results)
        };
    }

    async executeFullMorphing(params: ShapeMorphingParams): Promise<ShapeMorphingResult> {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║     形态统一 - 完整流程                  ║');
        console.log('╚════════════════════════════════════════╝');

        const validationIssues = this.validator.validateParams(params, ['align', 'morph', 'all']);
        if (this.validator.hasBlockingIssue(validationIssues)) {
            return {
                success: false,
                results: [],
                error: this.validator.toMessage(validationIssues)
            };
        }

        const {
            referenceShapeId,
            productLayerIds,
            preAlign = true,
            shapeMatch = true
        } = params;

        const alignResult = await this.executeAlignment(params);
        if (!alignResult.success && preAlign) {
            return alignResult;
        }

        if (!shapeMatch) {
            return {
                success: alignResult.success,
                results: alignResult.results,
                message: '仅完成对齐，形态吻合已跳过',
                warnings: alignResult.warnings,
                issues: alignResult.issues,
                diagnostics: alignResult.diagnostics
            };
        }

        const reference = await this.analyzer.analyzeReferenceShape(referenceShapeId, {
            includeContour: true
        });
        const referenceIssues = this.validator.validateReferenceForMorph(reference);
        const allIssues: ShapeMorphValidationIssue[] = [...(alignResult.issues ?? []), ...referenceIssues];
        const warnings = [...(alignResult.warnings ?? []), ...this.validator.toWarnings(referenceIssues)];
        if (this.validator.hasBlockingIssue(referenceIssues) || !reference?.contour) {
            return {
                success: false,
                results: alignResult.results,
                error: this.validator.toMessage(referenceIssues),
                warnings: Array.from(new Set(warnings)),
                issues: allIssues,
                diagnostics: alignResult.diagnostics ?? this.buildDiagnostics(alignResult.results, params)
            };
        }

        const morphParams = this.planner.buildMorphParams({
            edgeStrength: params.edgeStrength,
            contentProtection: params.contentProtection,
            smoothness: params.smoothness,
            selectedRegions: params.selectedRegions,
            cuffProtected: params.cuffProtected,
            quality: params.quality
        });

        const results: AlignmentResult[] = [];
        for (const layerId of productLayerIds) {
            try {
                const product = await this.analyzer.analyzeProductLayer(layerId, {
                    includeContour: true,
                    includeExportedImage: (params.contentProtection ?? 0) > 0
                });
                const issues = [
                    ...this.validator.validateProductForMorph(product),
                    ...this.validator.validatePrototypeScopeForMorph(params, reference, product)
                ];
                allIssues.push(...issues);
                warnings.push(...this.validator.toWarnings(issues));
                if (this.validator.hasBlockingIssue(issues) || !product?.contour) {
                    results.push({
                        layerId,
                        success: false,
                        error: this.validator.toMessage(issues)
                    });
                    continue;
                }

                const displacement = await this.planner.computeDisplacement(this.morphingService, {
                    sourceContour: product.contour.points,
                    targetContour: reference.contour.points,
                    width: product.contour.width,
                    height: product.contour.height,
                    morphParams,
                    sourceRegionAnalysis: product.regionAnalysis,
                    targetRegionAnalysis: reference.regionAnalysis,
                    sourceImageBase64: product.exportedImage?.base64,
                    sourceContentSummary: product.contentSummary
                });
                const displacementIssues = this.validator.validateDisplacement(displacement, layerId);
                allIssues.push(...displacementIssues);
                warnings.push(...this.validator.toWarnings(displacementIssues));
                if (this.validator.hasBlockingIssue(displacementIssues) || !displacement) {
                    results.push({
                        layerId,
                        success: false,
                        error: this.validator.toMessage(displacementIssues)
                    });
                    continue;
                }

                const applyResult = await this.executor.applyDisplacement(
                    layerId,
                    displacement.sparseDisplacement,
                    {
                        preserveOriginal: morphParams.preserveSourceLayer,
                        resultLayerName: `形态统一-${layerId}`
                    }
                );

                results.push(applyResult.success
                    ? {
                        layerId: applyResult.outputLayerId ?? layerId,
                        success: true,
                        method: `optimized-morphing:${displacement.qualityPreset}:${displacement.matchingStrategy ?? 'contour'}`
                    }
                    : {
                        layerId,
                        success: false,
                        error: applyResult.error || '应用位移场失败'
                    });
            } catch (error: any) {
                results.push({
                    layerId,
                    success: false,
                    error: error.message || '形态变形异常'
                });
            }
        }

        const successCount = results.filter((item) => item.success).length;
        return {
            success: successCount > 0,
            results,
            message: `完成: ${successCount}/${productLayerIds.length} 个图层变形成功`,
            warnings: Array.from(new Set(warnings)),
            issues: allIssues,
            diagnostics: this.buildDiagnostics(results, params)
        };
    }

    private buildDiagnostics(
        results: AlignmentResult[],
        params?: Pick<ShapeMorphingParams, 'selectedRegions' | 'quality'>
    ): ShapeMorphDiagnostics {
        const acceptedLayerIds = results.filter((item) => item.success).map((item) => item.layerId);
        const rejectedLayerIds = results.filter((item) => !item.success).map((item) => item.layerId);
        const scope = this.validator.getPrototypeScope();

        return {
            mode: 'prototype-v1',
            acceptedLayerIds,
            rejectedLayerIds,
            supportedSockStyles: scope.supportedSockStyles,
            supportedCuffTypes: scope.supportedCuffTypes,
            requestedSelectedRegions: params?.selectedRegions ?? [],
            requestedQuality: params?.quality ?? 'balanced'
        };
    }
}
