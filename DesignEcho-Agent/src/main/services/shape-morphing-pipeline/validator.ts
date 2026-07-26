import type {
    DisplacementComputation,
    ProductLayerAnalysis,
    ReferenceShapeAnalysis,
    ShapeMorphValidationIssue
} from './types';
import type { ShapeMorphingParams } from '../shape-morphing-orchestrator';

export class ShapeMorphingValidatorService {
    private static readonly PROTOTYPE_SUPPORTED_CUFF_TYPES = ['plain', 'ribbed', 'double', 'folded'];
    private static readonly PROTOTYPE_SUPPORTED_SOCK_STYLES = ['crew', 'ankle', 'no-show'];
    private static readonly ALLOWED_REGIONS = ['cuff', 'leg', 'heel', 'body', 'toe'];

    validateParams(
        params: ShapeMorphingParams,
        allowedSteps: Array<NonNullable<ShapeMorphingParams['step']>>
    ): ShapeMorphValidationIssue[] {
        const issues: ShapeMorphValidationIssue[] = [];

        if (!Number.isFinite(params.referenceShapeId) || params.referenceShapeId <= 0) {
            issues.push({
                severity: 'error',
                code: 'invalid-reference-shape',
                message: 'referenceShapeId 无效'
            });
        }

        if (!Array.isArray(params.productLayerIds) || params.productLayerIds.length === 0) {
            issues.push({
                severity: 'error',
                code: 'missing-product-layers',
                message: 'productLayerIds 为空'
            });
        }

        if (params.step && !allowedSteps.includes(params.step)) {
            issues.push({
                severity: 'error',
                code: 'unsupported-step',
                message: `当前仅支持 ${allowedSteps.join(' / ')}，收到: ${String(params.step)}`
            });
        }

        const numericChecks: Array<[keyof ShapeMorphingParams, string]> = [
            ['edgeStrength', 'edgeStrength'],
            ['contentProtection', 'contentProtection'],
            ['smoothness', 'smoothness'],
            ['intensity', 'intensity']
        ];
        for (const [field, label] of numericChecks) {
            const value = params[field];
            if (value == null) {
                continue;
            }
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                issues.push({
                    severity: 'error',
                    code: `invalid-${String(field)}`,
                    message: `${label} 必须是 0-100 之间的数值`
                });
            }
        }

        return issues;
    }

    getPrototypeScope() {
        return {
            supportedCuffTypes: [...ShapeMorphingValidatorService.PROTOTYPE_SUPPORTED_CUFF_TYPES],
            supportedSockStyles: [...ShapeMorphingValidatorService.PROTOTYPE_SUPPORTED_SOCK_STYLES]
        };
    }

    validateReferenceForAlignment(reference: ReferenceShapeAnalysis | null): ShapeMorphValidationIssue[] {
        if (!reference) {
            return [{
                severity: 'error',
                code: 'reference-bounds-missing',
                message: '无法获取参考形状边界'
            }];
        }
        return [];
    }

    validateReferenceForMorph(reference: ReferenceShapeAnalysis | null): ShapeMorphValidationIssue[] {
        const issues = this.validateReferenceForAlignment(reference);
        if (!reference?.contour || reference.contour.points.length === 0) {
            issues.push({
                severity: 'error',
                code: 'reference-contour-missing',
                message: '无法提取参考形状轮廓'
            });
        } else {
            if (reference.contour.points.length < 20) {
                issues.push({
                    severity: 'error',
                    code: 'reference-contour-too-sparse',
                    message: '参考形状轮廓点数过少，当前 prototype 无法稳定处理'
                });
            } else if (reference.contour.points.length < 40) {
                issues.push({
                    severity: 'warning',
                    code: 'reference-contour-low-detail',
                    message: '参考形状轮廓细节较少，结果可能偏硬'
                });
            }
        }
        if (reference?.regionAnalysis?.success && reference.regionAnalysis.orientation !== 'vertical') {
            issues.push({
                severity: 'error',
                code: 'reference-orientation-unsupported',
                message: `当前 prototype 仅支持纵向参考形状，收到 ${reference.regionAnalysis.orientation}`
            });
        }
        return issues;
    }

    validateProductForAlignment(product: ProductLayerAnalysis | null): ShapeMorphValidationIssue[] {
        const issues: ShapeMorphValidationIssue[] = [];

        if (!product) {
            return [{
                severity: 'error',
                code: 'layer-bounds-missing',
                message: '无法获取图层边界'
            }];
        }

        if (!product.exportedImage) {
            issues.push({
                severity: 'error',
                code: 'layer-export-failed',
                message: '图层导出失败',
                layerId: product.layerId
            });
        }

        if (!product.subjectInfo) {
            issues.push({
                severity: 'error',
                code: 'subject-detection-failed',
                message: '主体检测失败：未能从图层中识别出袜子主体（掩膜分析未产出有效轮廓）。请确认图层中有清晰完整的袜子主体；若主体与背景对比过低，可先用智能抠图确认能正常识别后再试。',
                layerId: product.layerId
            });
        }

        return issues;
    }

    validateProductForMorph(product: ProductLayerAnalysis | null): ShapeMorphValidationIssue[] {
        const issues: ShapeMorphValidationIssue[] = [];

        if (!product) {
            return [{
                severity: 'error',
                code: 'layer-bounds-missing',
                message: '无法获取图层边界'
            }];
        }

        if (!product.contour || product.contour.points.length === 0) {
            issues.push({
                severity: 'error',
                code: 'layer-contour-missing',
                message: '提取轮廓失败',
                layerId: product.layerId
            });
        } else {
            if (product.contour.points.length < 20) {
                issues.push({
                    severity: 'error',
                    code: 'layer-contour-too-sparse',
                    message: '产品轮廓点数过少，当前 prototype 无法稳定处理',
                    layerId: product.layerId
                });
            } else if (product.contour.points.length < 40) {
                issues.push({
                    severity: 'warning',
                    code: 'layer-contour-low-detail',
                    message: '产品轮廓细节较少，结果可能偏硬',
                    layerId: product.layerId
                });
            }
        }
        if (product.regionAnalysis?.success && product.regionAnalysis.orientation !== 'vertical') {
            issues.push({
                severity: 'error',
                code: 'product-orientation-unsupported',
                message: `当前 prototype 仅支持纵向袜子图层，图层 ${product.layerId} 为 ${product.regionAnalysis.orientation}`,
                layerId: product.layerId
            });
        }

        return issues;
    }

    validatePrototypeScopeForMorph(
        params: ShapeMorphingParams,
        reference: ReferenceShapeAnalysis | null,
        product: ProductLayerAnalysis | null
    ): ShapeMorphValidationIssue[] {
        const issues: ShapeMorphValidationIssue[] = [];
        if (!reference || !product || !product.contour || !reference.contour) {
            return issues;
        }

        if (
            typeof params.cuffType === 'string' &&
            !ShapeMorphingValidatorService.PROTOTYPE_SUPPORTED_CUFF_TYPES.includes(params.cuffType)
        ) {
            issues.push({
                severity: 'error',
                code: 'unsupported-cuff-type',
                message: `当前 prototype 仅支持 ${ShapeMorphingValidatorService.PROTOTYPE_SUPPORTED_CUFF_TYPES.join('/')} 袜口，收到 ${params.cuffType}`,
                layerId: product.layerId
            });
        }

        if (
            typeof params.sockStyle === 'string' &&
            !ShapeMorphingValidatorService.PROTOTYPE_SUPPORTED_SOCK_STYLES.includes(params.sockStyle)
        ) {
            issues.push({
                severity: 'error',
                code: 'unsupported-sock-style',
                message: `当前 prototype 仅支持 ${ShapeMorphingValidatorService.PROTOTYPE_SUPPORTED_SOCK_STYLES.join('/')} 款式，收到 ${params.sockStyle}`,
                layerId: product.layerId
            });
        }

        const invalidRegions = (params.selectedRegions ?? []).filter(
            (region) => !ShapeMorphingValidatorService.ALLOWED_REGIONS.includes(region)
        );
        if (invalidRegions.length > 0) {
            issues.push({
                severity: 'warning',
                code: 'unknown-selected-regions',
                message: `忽略未知分区: ${invalidRegions.join(', ')}`,
                layerId: product.layerId
            });
        }

        if (product.bounds.width < 80 || product.bounds.height < 120) {
            issues.push({
                severity: 'error',
                code: 'layer-too-small',
                message: '图层尺寸过小，当前 prototype 不建议自动变形',
                layerId: product.layerId
            });
        }

        if (product.regionAnalysis?.success) {
            const detectedCuffType = product.regionAnalysis.cuffAnalysis.type;
            const detectedConfidence = product.regionAnalysis.cuffAnalysis.confidence;
            if (
                typeof params.cuffType === 'string' &&
                detectedConfidence >= 0.6 &&
                detectedCuffType !== 'unknown' &&
                detectedCuffType !== params.cuffType
            ) {
                issues.push({
                    severity: 'warning',
                    code: 'cuff-type-mismatch',
                    message: `UI 选择的袜口 ${params.cuffType} 与检测结果 ${detectedCuffType} 不一致，结果可能需要人工复核`,
                    layerId: product.layerId
                });
            }
        }

        const sourceAspect = product.contour.height / Math.max(product.contour.width, 1);
        const targetAspect = reference.contour.height / Math.max(reference.contour.width, 1);
        const aspectRatioDelta = Math.max(sourceAspect, targetAspect) / Math.max(Math.min(sourceAspect, targetAspect), 0.001);
        if (aspectRatioDelta > 1.45) {
            issues.push({
                severity: 'error',
                code: 'shape-gap-too-large',
                message: '参考形状与产品形状差异过大，当前 prototype 拒绝自动变形',
                layerId: product.layerId
            });
        } else if (aspectRatioDelta > 1.25) {
            issues.push({
                severity: 'warning',
                code: 'shape-gap-watch',
                message: '参考形状与产品形状差异较大，结果可能需要人工修正',
                layerId: product.layerId
            });
        }

        const scaleRatio = reference.bounds.height / Math.max(product.bounds.height, 1);
        if (scaleRatio > 1.75 || scaleRatio < 0.57) {
            issues.push({
                severity: 'error',
                code: 'scale-ratio-out-of-scope',
                message: '目标尺寸变化过大，超出当前 prototype 安全范围',
                layerId: product.layerId
            });
        } else if (scaleRatio > 1.4 || scaleRatio < 0.72) {
            issues.push({
                severity: 'warning',
                code: 'scale-ratio-watch',
                message: '目标尺寸变化较大，结果可能需要人工复核',
                layerId: product.layerId
            });
        }

        return issues;
    }

    validateDisplacement(
        displacement: DisplacementComputation | null,
        layerId: number
    ): ShapeMorphValidationIssue[] {
        if (!displacement) {
            return [{
                severity: 'error',
                code: 'displacement-computation-failed',
                message: '位移场计算失败',
                layerId
            }];
        }

        const issues: ShapeMorphValidationIssue[] = [];
        const metrics = displacement.qualityMetrics;
        if (!metrics) {
            return issues;
        }

        if (metrics.overallScore < 0.42) {
            issues.push({
                severity: 'error',
                code: 'morph-quality-too-low',
                message: '形态统一质量评分过低，已拒绝自动写回',
                layerId
            });
        } else if (metrics.overallScore < 0.58) {
            issues.push({
                severity: 'warning',
                code: 'morph-quality-watch',
                message: '形态统一质量一般，建议人工复核',
                layerId
            });
        }

        if (metrics.estimatedStrain > 0.3) {
            issues.push({
                severity: 'error',
                code: 'morph-strain-too-high',
                message: '局部拉伸风险过高，已拒绝自动变形',
                layerId
            });
        } else if (metrics.estimatedStrain > 0.22) {
            issues.push({
                severity: 'warning',
                code: 'morph-strain-watch',
                message: '局部拉伸较明显，结果可能需要人工修正',
                layerId
            });
        }

        if (metrics.patternRisk > 0.72) {
            issues.push({
                severity: 'error',
                code: 'pattern-risk-too-high',
                message: '图案/纹理保护风险过高，已拒绝自动变形',
                layerId
            });
        } else if (metrics.patternRisk > 0.58) {
            issues.push({
                severity: 'warning',
                code: 'pattern-risk-watch',
                message: '图案区域较复杂，建议人工复核',
                layerId
            });
        }

        if (metrics.cuffRisk > 0.78) {
            issues.push({
                severity: 'error',
                code: 'cuff-risk-too-high',
                message: '袜口保护风险过高，已拒绝自动变形',
                layerId
            });
        } else if (metrics.cuffRisk > 0.58) {
            issues.push({
                severity: 'warning',
                code: 'cuff-risk-watch',
                message: '袜口结构较敏感，建议人工复核',
                layerId
            });
        }

        if (metrics.maxDisplacementPx > 220) {
            issues.push({
                severity: 'error',
                code: 'max-displacement-too-large',
                message: '单点位移过大，超出当前安全范围',
                layerId
            });
        } else if (metrics.maxDisplacementPx > 160) {
            issues.push({
                severity: 'warning',
                code: 'max-displacement-watch',
                message: '位移幅度较大，建议人工复核',
                layerId
            });
        }

        return issues;
    }

    hasBlockingIssue(issues: ShapeMorphValidationIssue[]): boolean {
        return issues.some((issue) => issue.severity === 'error');
    }

    toMessage(issues: ShapeMorphValidationIssue[]): string {
        return issues.map((issue) => issue.message).join('; ');
    }

    toWarnings(issues: ShapeMorphValidationIssue[]): string[] {
        return issues
            .filter((issue) => issue.severity === 'warning')
            .map((issue) => issue.message);
    }
}
