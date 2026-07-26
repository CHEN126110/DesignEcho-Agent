import { MattingService } from '../matting-service';
import { WebSocketServer } from '../../websocket/server';
import { getSockRegionAnalyzer } from '../morphing/sock-region-analyzer';
import { ContourService } from '../contour-service';
import sharp from 'sharp';
import type {
    ContourData,
    ContentRiskSummary,
    ExportedLayerImage,
    LayerBounds,
    Point2D,
    ProductLayerAnalysis,
    ReferenceShapeAnalysis,
    SubjectInfo
} from './types';

export class ShapeMorphingAnalyzerService {
    private readonly sockRegionAnalyzer = getSockRegionAnalyzer();
    private readonly contourService = ContourService.getInstance();

    constructor(
        private readonly wsServer: WebSocketServer,
        private readonly mattingService: MattingService
    ) {}

    async analyzeReferenceShape(
        referenceShapeId: number,
        options: { includeContour?: boolean } = {}
    ): Promise<ReferenceShapeAnalysis | null> {
        const bounds = await this.getLayerBounds(referenceShapeId);
        if (!bounds) {
            return null;
        }

        const center: Point2D = {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2
        };

        const contour = options.includeContour
            ? await this.extractReferenceContour(referenceShapeId)
            : undefined;
        const regionAnalysis = contour
            ? await this.analyzeSockRegions(contour.points)
            : undefined;
        const contentSummary = await this.buildContentSummary(undefined, regionAnalysis);

        return {
            layerId: referenceShapeId,
            bounds,
            center,
            contour: contour ?? undefined,
            regionAnalysis,
            contentSummary
        };
    }

    async analyzeProductLayer(
        layerId: number,
        options: { includeSubject?: boolean; includeContour?: boolean; includeExportedImage?: boolean } = {}
    ): Promise<ProductLayerAnalysis | null> {
        const bounds = await this.getLayerBounds(layerId);
        if (!bounds) {
            return null;
        }

        const layerCenter: Point2D = {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2
        };

        let exportedImage: ExportedLayerImage | undefined;
        let subjectInfo: SubjectInfo | undefined;
        let contour: ContourData | undefined;

        if (options.includeSubject || options.includeExportedImage) {
            exportedImage = await this.exportLayerAsImage(layerId) ?? undefined;
        }

        if (options.includeSubject && exportedImage) {
            subjectInfo = await this.detectSubjectBounds(
                exportedImage.base64,
                bounds,
                exportedImage.width,
                exportedImage.height
            ) ?? undefined;
        }

        if (options.includeContour) {
            contour = await this.extractLayerContour(layerId) ?? undefined;

            // 带摄影背景的不透明图层：alpha 轮廓会退化为满铺矩形。
            // 此时用 BiRefNet 掩膜做"仅分析用"的主体轮廓提取（不修改图层像素），
            // 变形作用于整张照片，背景随 MLS 位移场平滑跟动——即自动化液化。
            if (this.isDegenerateRectangleContour(contour)) {
                if (!exportedImage) {
                    exportedImage = await this.exportLayerAsImage(layerId) ?? undefined;
                }
                if (exportedImage) {
                    const mattingContour = await this.extractContourViaMatting(layerId, exportedImage, bounds);
                    if (mattingContour) {
                        contour = mattingContour;
                        console.log(`[ShapeMorphing] 图层 ${layerId} 使用掩膜轮廓（带背景素材，仅分析不改图）`);
                    }
                }
            }
        }

        // YOLO 主体检测不可用或未命中时，回退为轮廓包围盒。
        // （当前安装的 YOLO 为固定词表模型，无 sock 类别，语义检测必然为空）
        if (options.includeSubject && !subjectInfo) {
            if (!contour) {
                contour = await this.extractLayerContour(layerId) ?? undefined;
            }
            subjectInfo = this.deriveSubjectFromContour(contour) ?? undefined;
            if (subjectInfo) {
                console.log(`[ShapeMorphing] 图层 ${layerId} 主体检测回退：使用轮廓包围盒（中心 ${Math.round(subjectInfo.center.x)},${Math.round(subjectInfo.center.y)}，尺寸 ${Math.round(subjectInfo.size.width)}×${Math.round(subjectInfo.size.height)}）`);
            }
        }

        const regionAnalysis = contour
            ? await this.analyzeSockRegions(
                contour.points,
                exportedImage?.base64
            )
            : undefined;
        const contentSummary = await this.buildContentSummary(exportedImage?.base64, regionAnalysis);

        return {
            layerId,
            bounds,
            layerCenter,
            exportedImage,
            subjectInfo,
            contour,
            regionAnalysis,
            contentSummary
        };
    }

    private async analyzeSockRegions(
        contour: Point2D[],
        imageBase64?: string
    ) {
        const imageBuffer = imageBase64 ? Buffer.from(imageBase64, 'base64') : null;
        const result = await this.sockRegionAnalyzer.analyze(imageBuffer, contour);
        return result.success ? result : undefined;
    }

    private async buildContentSummary(
        imageBase64: string | undefined,
        regionAnalysis: ProductLayerAnalysis['regionAnalysis'] | ReferenceShapeAnalysis['regionAnalysis']
    ): Promise<ContentRiskSummary | undefined> {
        if (!regionAnalysis?.success) {
            return undefined;
        }

        const textureRichness = imageBase64
            ? await this.estimateTextureRichness(imageBase64)
            : 0;

        return {
            hasPattern: textureRichness >= 0.32,
            patternComplexity: textureRichness,
            textureRichness,
            cuffType: regionAnalysis.cuffAnalysis.type,
            cuffConfidence: regionAnalysis.cuffAnalysis.confidence,
            cuffProtectionLevel: regionAnalysis.cuffAnalysis.protectionLevel
        };
    }

    private async estimateTextureRichness(imageBase64: string): Promise<number> {
        try {
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            const { data, info } = await sharp(imageBuffer)
                .resize(128, 128, { fit: 'inside' })
                .removeAlpha()
                .greyscale()
                .raw()
                .toBuffer({ resolveWithObject: true });

            if (!info.width || !info.height || data.length === 0) {
                return 0;
            }

            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                sum += data[i];
            }
            const mean = sum / data.length;

            let variance = 0;
            for (let i = 0; i < data.length; i++) {
                const diff = data[i] - mean;
                variance += diff * diff;
            }

            const stdDev = Math.sqrt(variance / data.length);
            return Math.max(0, Math.min(1, stdDev / 64));
        } catch {
            return 0;
        }
    }

    private async getLayerBounds(layerId: number): Promise<LayerBounds | null> {
        const result = await this.wsServer.sendRequest('getLayerBounds', {
            layerId,
            includeEffects: true
        });

        if (!result?.success) {
            return null;
        }

        return result.boundsNoEffects || result.bounds;
    }

    private async exportLayerAsImage(layerId: number, maxSize: number = 1024): Promise<ExportedLayerImage | null> {
        const result = await this.wsServer.sendRequest('exportLayerAsBase64', {
            layerId,
            format: 'png',
            maxSize
        });

        if (!result?.success || !result?.data?.base64) {
            return null;
        }

        let imageBase64 = result.data.base64;
        if (imageBase64.includes('|||ALPHA:')) {
            imageBase64 = imageBase64.split('|||')[0];
        }

        return {
            base64: imageBase64,
            width: result.data.width,
            height: result.data.height
        };
    }

    /** 计算轮廓的包围盒填充率（鞋带公式面积 / 包围盒面积）；满铺矩形 ≈ 1 */
    private contourFillRatio(contour: ContourData | undefined): number | null {
        const points = contour?.points;
        if (!Array.isArray(points) || points.length < 3) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            if (!Number.isFinite(a?.x) || !Number.isFinite(a?.y)) return null;
            area += a.x * b.y - b.x * a.y;
            if (a.x < minX) minX = a.x;
            if (a.y < minY) minY = a.y;
            if (a.x > maxX) maxX = a.x;
            if (a.y > maxY) maxY = a.y;
        }
        const width = maxX - minX;
        const height = maxY - minY;
        if (width <= 1 || height <= 1) return null;
        return Math.abs(area / 2) / (width * height);
    }

    /** alpha 轮廓是否退化为满铺矩形（带摄影背景的不透明图层特征） */
    private isDegenerateRectangleContour(contour: ContourData | undefined): boolean {
        const ratio = this.contourFillRatio(contour);
        return ratio === null || ratio > 0.92;
    }

    /** 按弧长均匀重采样轮廓点（与 UXP 侧 100 点采样约定一致） */
    private uniformSampleContour(points: Point2D[], sampleCount: number = 100): Point2D[] {
        if (points.length <= sampleCount) return points;

        const segmentLengths: number[] = [];
        let totalLength = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            segmentLengths.push(len);
            totalLength += len;
        }
        if (totalLength <= 0) return points.slice(0, sampleCount);

        const step = totalLength / sampleCount;
        const sampled: Point2D[] = [];
        let accumulated = 0;
        let target = 0;
        for (let i = 0; i < points.length && sampled.length < sampleCount; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const len = segmentLengths[i];
            while (target <= accumulated + len && sampled.length < sampleCount) {
                const t = len > 0 ? (target - accumulated) / len : 0;
                sampled.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
                target += step;
            }
            accumulated += len;
        }
        return sampled.length >= 3 ? sampled : points;
    }

    /**
     * 带摄影背景图层的主体轮廓提取：BiRefNet 掩膜（仅分析用，不修改图层像素）。
     * 掩膜像素坐标按图层边界映射回文档坐标。
     */
    private async extractContourViaMatting(
        layerId: number,
        exportedImage: ExportedLayerImage,
        bounds: LayerBounds
    ): Promise<ContourData | null> {
        try {
            const matting = await this.mattingService.removeBackground(exportedImage.base64, {
                returnMask: true,
                binaryMaskOutput: true,
                quality: 'balanced'
            });

            if (!matting?.success || !matting.maskBuffer || !matting.maskWidth || !matting.maskHeight) {
                console.warn(`[ShapeMorphing] 图层 ${layerId} 掩膜分析失败：${matting?.error || '无掩膜输出'}`);
                return null;
            }

            const extraction = this.contourService.extractContourFromMask(
                matting.maskBuffer,
                matting.maskWidth,
                matting.maskHeight,
                { threshold: 128, simplify: 3, smooth: true }
            );

            const rawPoints = extraction.contour?.points;
            if (!extraction.success || !rawPoints || rawPoints.length < 8) {
                console.warn(`[ShapeMorphing] 图层 ${layerId} 掩膜轮廓提取失败：${extraction.error || '轮廓点不足'}`);
                return null;
            }

            // 掩膜像素坐标 → 文档坐标
            const scaleX = bounds.width / matting.maskWidth;
            const scaleY = bounds.height / matting.maskHeight;
            const documentPoints = rawPoints.map((p) => ({
                x: bounds.left + p.x * scaleX,
                y: bounds.top + p.y * scaleY
            }));
            const sampled = this.uniformSampleContour(documentPoints, 100);

            const result: ContourData = {
                points: sampled,
                width: (extraction.contour?.boundingBox?.width ?? matting.maskWidth) * scaleX,
                height: (extraction.contour?.boundingBox?.height ?? matting.maskHeight) * scaleY
            };

            // 掩膜也可能整张全白（极端情况），仍按矩形守卫拦截
            if (this.isDegenerateRectangleContour(result)) {
                console.warn(`[ShapeMorphing] 图层 ${layerId} 掩膜轮廓仍接近满铺矩形，放弃该轮廓`);
                return null;
            }

            return result;
        } catch (error: any) {
            console.warn(`[ShapeMorphing] 图层 ${layerId} 掩膜轮廓提取异常：${error?.message || error}`);
            return null;
        }
    }

    /**
     * 从轮廓点（文档坐标）推导主体中心与尺寸，作为 YOLO 检测的回退。
     * 轮廓接近满铺矩形时返回 null——掩膜分析也失败时的最后守卫，
     * 防止把整张矩形照片压成袜子形状。
     */
    private deriveSubjectFromContour(contour: ContourData | undefined): SubjectInfo | null {
        const points = contour?.points;
        if (!Array.isArray(points) || points.length < 3) {
            return null;
        }

        // 满铺矩形守卫：掩膜分析也失败时拒绝按矩形变形
        if (this.isDegenerateRectangleContour(contour)) {
            console.warn('[ShapeMorphing] 轮廓接近满铺矩形（主体识别失败），拒绝按矩形轮廓变形');
            return null;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of points) {
            if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
            if (point.x < minX) minX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.x > maxX) maxX = point.x;
            if (point.y > maxY) maxY = point.y;
        }

        const width = maxX - minX;
        const height = maxY - minY;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
            return null;
        }

        return {
            center: { x: minX + width / 2, y: minY + height / 2 },
            size: { width, height }
        };
    }

    private async detectSubjectBounds(
        imageBase64: string,
        layerBounds: LayerBounds,
        exportedWidth: number,
        exportedHeight: number
    ): Promise<SubjectInfo | null> {
        const detections = await this.mattingService.detectWithYoloWorld(
            imageBase64,
            '袜子 socks clothing'
        );

        if (!detections || detections.length === 0) {
            return null;
        }

        const bestDetection = detections.sort((a, b) => b.confidence - a.confidence)[0];
        const detectionWidth = bestDetection.x2 - bestDetection.x1;
        const detectionHeight = bestDetection.y2 - bestDetection.y1;
        const detectionCenterX = bestDetection.x1 + detectionWidth / 2;
        const detectionCenterY = bestDetection.y1 + detectionHeight / 2;

        const scaleX = layerBounds.width / exportedWidth;
        const scaleY = layerBounds.height / exportedHeight;

        return {
            center: {
                x: layerBounds.left + detectionCenterX * scaleX,
                y: layerBounds.top + detectionCenterY * scaleY
            },
            size: {
                width: detectionWidth * scaleX,
                height: detectionHeight * scaleY
            }
        };
    }

    private async extractReferenceContour(referenceShapeId: number): Promise<ContourData | null> {
        // 优先按矢量形状图层取路径采样
        const result = await this.wsServer.sendRequest('extractShapePath', {
            layerId: referenceShapeId,
            samplePoints: 100
        });

        const points = result?.sampledPoints || result?.points;
        if (result?.success && points && points.length > 0) {
            const boundingBox = result?.contour?.boundingBox;
            return {
                points,
                width: boundingBox?.width ?? 800,
                height: boundingBox?.height ?? 800
            };
        }

        // 回退：参考是像素/智能对象图层时，按 alpha 轮廓提取——
        // 支持「选一张标准袜子图层作为目标形态」的批量统一工作流
        console.log(`[ShapeMorphing] 参考图层 ${referenceShapeId} 非矢量形状（${result?.error || '无路径'}），回退为像素轮廓提取`);
        const alphaContour = await this.extractLayerContour(referenceShapeId);
        if (alphaContour && !this.isDegenerateRectangleContour(alphaContour)) {
            return alphaContour;
        }

        // 参考也是带摄影背景的照片时，同样走掩膜分析路径
        const bounds = await this.getLayerBounds(referenceShapeId);
        const exported = bounds ? await this.exportLayerAsImage(referenceShapeId) : null;
        if (bounds && exported) {
            const mattingContour = await this.extractContourViaMatting(referenceShapeId, exported, bounds);
            if (mattingContour) {
                console.log(`[ShapeMorphing] 参考图层 ${referenceShapeId} 使用掩膜轮廓（带背景素材）`);
                return mattingContour;
            }
        }
        return alphaContour;
    }

    private async extractLayerContour(layerId: number): Promise<ContourData | null> {
        const result = await this.wsServer.sendRequest('getLayerContour', {
            layerId,
            method: 'mask',
            threshold: 128,
            samplePoints: 100
        });

        const points = result?.sampledPoints || result?.points;
        if (!result?.success || !points || points.length === 0) {
            return null;
        }

        const boundingBox = result?.contour?.boundingBox;
        return {
            points,
            width: boundingBox?.width ?? 800,
            height: boundingBox?.height ?? 800
        };
    }
}
