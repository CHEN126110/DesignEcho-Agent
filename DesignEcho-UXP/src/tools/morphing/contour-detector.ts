/**
 * 轮廓检测工具
 * 
 * 从图像图层检测产品轮廓（复用抠图蒙版或边缘检测）
 */

import { action, app, imaging } from 'photoshop';
import { ToolResult } from '../types';
import { Point2D, BoundingBox, ShapeContour, PathData } from './types';
import {
    buildBoundingBoxFromBounds,
    getBoundingBoxCornerPoints
} from './geometry-helpers';
import { 
    startTask, endTask, startStep, endStep, 
    logInfo, logDebug, logWarn, logError, logPerf 
} from './execution-logger';

export interface GetLayerContourParams {
    layerId?: number;          // 图层 ID
    method?: 'mask' | 'edge';  // 检测方法：蒙版 或 边缘检测
    threshold?: number;        // 边缘阈值 (0-255)
    samplePoints?: number;     // 采样点数
}

export interface GetLayerContourResult {
    success: boolean;
    layerId: number;
    layerName: string;
    contour: ShapeContour | null;
    sampledPoints: Point2D[];
    maskData?: string;  // base64 蒙版数据（用于发送到 Agent）
    error?: string;
    processingTime: number;
}

/**
 * 获取图层轮廓
 */
export async function getLayerContour(params: GetLayerContourParams = {}): Promise<ToolResult<GetLayerContourResult>> {
    const taskId = startTask('获取图层轮廓', { params });
    const startTime = performance.now();
    
    try {
        // 步骤 1: 获取目标图层
        const step1 = startStep('获取目标图层');
        
        const doc = app.activeDocument;
        if (!doc) {
            endStep(step1, false);
            logError('没有打开的文档');
            endTask(taskId, false);
            return { success: false, error: '没有打开的文档', data: null };
        }
        
        let layerId = params.layerId;
        let layerName = '';
        
        if (!layerId) {
            const activeLayers = doc.activeLayers;
            if (!activeLayers || activeLayers.length === 0) {
                endStep(step1, false);
                logError('没有选中的图层');
                endTask(taskId, false);
                return { success: false, error: '请先选择一个图层', data: null };
            }
            layerId = activeLayers[0].id;
            layerName = activeLayers[0].name;
        } else {
            const layer = doc.layers.find((l: any) => l.id === layerId);
            if (layer) layerName = layer.name;
        }
        
        logInfo(`目标图层: ${layerName} (ID: ${layerId})`);
        endStep(step1, true, { layerId, layerName });
        
        // 步骤 2: 获取图层边界
        const step2 = startStep('获取图层边界');
        
        const boundsResult = await action.batchPlay([{
            _obj: 'get',
            _target: [{ _ref: 'layer', _id: layerId }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
        
        const bounds = boundsResult[0]?.bounds;
        const boundingBox = buildBoundingBoxFromBounds(bounds);
        if (!boundingBox) {
            endStep(step2, false);
            logError('无法获取图层边界');
            endTask(taskId, false);
            return { success: false, error: '无法获取图层边界', data: null };
        }
        
        logInfo('图层边界', boundingBox);
        endStep(step2, true, { boundingBox });
        
        // 步骤 3: 检测方法选择
        const step3 = startStep('选择检测方法');
        const method = params.method || 'mask';
        logInfo(`使用检测方法: ${method}`);
        endStep(step3, true, { method });
        
        let contourPoints: Point2D[] = [];
        let maskDataBase64: string | undefined;
        
        if (method === 'mask') {
            // 步骤 4a: 从图层蒙版/透明度提取轮廓
            const step4 = startStep('从蒙版提取轮廓');
            
            try {
                // 检查图层是否有蒙版
                const hasMask = boundsResult[0]?.hasUserMask;
                
                if (hasMask) {
                    logInfo('图层有用户蒙版，尝试提取...');
                    // 这里需要通过 Imaging API 获取蒙版数据
                    // 暂时使用边界框作为替代
                }
                
                // 使用 Imaging API 获取图层像素数据（包含透明度）
                const layer = doc.layers.find((l: any) => l.id === layerId);
                if (layer) {
                    try {
                        // 获取图层像素数据
                        const pixelData = await imaging.getPixels({
                            documentID: doc.id,
                            layerID: layerId,
                            targetSize: { width: Math.min(boundingBox.width, 512), height: Math.min(boundingBox.height, 512) },
                            componentSize: 8
                        });
                        
                        if (pixelData && pixelData.imageData) {
                            const imgWidth = pixelData.imageData.width;
                            const imgHeight = pixelData.imageData.height;
                            const imgComponents = pixelData.imageData.components || 4;
                            
                            logInfo(`获取到像素数据: ${imgWidth}x${imgHeight}, ${imgComponents}通道`);
                            
                            // ★★★ 关键修复：使用 getData() 获取实际像素数据 ★★★
                            const rawData = await pixelData.imageData.getData() as Uint8Array;
                            
                            if (rawData && rawData.length > 0) {
                                logInfo(`像素数据大小: ${rawData.length} bytes`);
                                
                                // 从透明度通道提取轮廓
                                contourPoints = extractContourFromAlpha(
                                    rawData,
                                    imgWidth,
                                    imgHeight,
                                    imgComponents,
                                    boundingBox,
                                    params.threshold || 128
                                );
                                
                                logInfo(`提取到 ${contourPoints.length} 个轮廓点`);
                            } else {
                                logWarn('像素数据为空');
                            }
                            
                            // 释放像素数据
                            pixelData.imageData.dispose();
                        }
                    } catch (imagingError: any) {
                        logWarn(`Imaging API 失败: ${imagingError.message}，使用边界框替代`);
                    }
                }
                
                // 如果没有提取到轮廓点，使用边界框
                if (contourPoints.length === 0) {
                    logWarn('未能提取轮廓，使用边界框替代');
                    contourPoints = getBoundingBoxCornerPoints(boundingBox);
                }
                
                endStep(step4, true, { pointCount: contourPoints.length });
                
            } catch (maskError: any) {
                logError(maskError, { step: 'extractMask' });
                endStep(step4, false);
                
                // 回退到边界框
                contourPoints = getBoundingBoxCornerPoints(boundingBox);
            }
        } else {
            // 步骤 4b: 边缘检测（需要发送到 Agent 处理）
            const step4 = startStep('准备边缘检测数据');
            
            logInfo('边缘检测需要在 Agent 端执行');
            
            // 获取图层图像数据发送到 Agent
            try {
                const layer = doc.layers.find((l: any) => l.id === layerId);
                if (layer) {
                    const pixelData = await imaging.getPixels({
                        documentID: doc.id,
                        layerID: layerId,
                        targetSize: { width: Math.min(boundingBox.width, 1024), height: Math.min(boundingBox.height, 1024) }
                    });
                    
                    if (pixelData && pixelData.imageData) {
                        // 转换为 base64 发送到 Agent
                        // 注意：这里需要根据 UXP 的实际 API 调整
                        logInfo('已准备图像数据，待发送到 Agent');
                        pixelData.imageData.dispose();
                    }
                }
            } catch (e: any) {
                logWarn(`准备边缘检测数据失败: ${e.message}`);
            }
            
            // 暂时使用边界框
            contourPoints = getBoundingBoxCornerPoints(boundingBox);
            
            endStep(step4, true);
        }
        
        // 步骤 5: 构建轮廓对象
        const step5 = startStep('构建轮廓对象');
        
        const centroid = computeCentroid(contourPoints);
        const area = computeArea(contourPoints);
        
        const pathData: PathData = {
            points: contourPoints.map(p => ({ anchor: p })),
            closed: true
        };
        
        const contour: ShapeContour = {
            layerId,
            layerName,
            paths: [pathData],
            boundingBox,
            centroid,
            area
        };
        
        logInfo('轮廓对象', { centroid, area, pointCount: contourPoints.length });
        endStep(step5, true);
        
        // 步骤 6: 采样轮廓点
        const step6 = startStep('采样轮廓点');
        
        const sampleCount = params.samplePoints || 100;
        const sampledPoints = uniformSamplePoints(contourPoints, sampleCount);
        
        logInfo(`采样 ${sampledPoints.length} 个点`);
        endStep(step6, true, { sampledCount: sampledPoints.length });
        
        // 完成
        const processingTime = performance.now() - startTime;
        logPerf('轮廓检测', processingTime);
        endTask(taskId, true);
        
        return {
            success: true,
            data: {
                success: true,
                layerId,
                layerName,
                contour,
                sampledPoints,
                maskData: maskDataBase64,
                processingTime
            }
        };
        
    } catch (error: any) {
        const processingTime = performance.now() - startTime;
        logError(error, { params });
        endTask(taskId, false);
        
        return {
            success: false,
            error: `获取图层轮廓失败: ${error.message}`,
            data: {
                success: false,
                layerId: params.layerId || -1,
                layerName: '',
                contour: null,
                sampledPoints: [],
                error: error.message,
                processingTime
            }
        };
    }
}

/**
 * 从透明度通道提取轮廓
 */
function extractContourFromAlpha(
    data: Uint8Array,       // 原始像素数据
    width: number,
    height: number,
    components: number,     // 通道数 (3=RGB, 4=RGBA)
    originalBounds: BoundingBox,
    threshold: number
): Point2D[] {
    const contourPoints: Point2D[] = [];
    
    // 检查是否有 Alpha 通道
    const hasAlpha = components >= 4;
    
    if (!hasAlpha) {
        // 没有透明度通道，使用边界框
        logWarn('图像没有透明度通道，使用边界框');
        return getBoundingBoxCornerPoints(originalBounds);
    }
    
    // 简单的边缘检测：找到透明度变化的像素
    // 优化：只检测部分行以减少计算量
    const stepY = Math.max(1, Math.floor(height / 200));  // 最多200行
    const stepX = Math.max(1, Math.floor(width / 200));   // 最多200列
    
    for (let y = 0; y < height; y += stepY) {
        for (let x = 0; x < width; x += stepX) {
            const idx = (y * width + x) * components;
            const alpha = data[idx + 3];  // Alpha 通道
            
            // 检查是否是边缘像素（透明度高且邻居有透明像素）
            if (alpha >= threshold) {
                const isEdge = isEdgePixelOptimized(data, x, y, width, height, components, threshold);
                if (isEdge) {
                    // 转换回原始坐标
                    const originalX = originalBounds.x + (x / width) * originalBounds.width;
                    const originalY = originalBounds.y + (y / height) * originalBounds.height;
                    contourPoints.push({ x: Math.round(originalX), y: Math.round(originalY) });
                }
            }
        }
    }
    
    // 如果点太少，降低采样间隔重试
    if (contourPoints.length < 20 && (stepX > 1 || stepY > 1)) {
        logInfo(`轮廓点太少 (${contourPoints.length})，使用更细的采样...`);
        contourPoints.length = 0;  // 清空
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * components;
                const alpha = data[idx + 3];
                
                if (alpha >= threshold) {
                    const isEdge = isEdgePixelOptimized(data, x, y, width, height, components, threshold);
                    if (isEdge) {
                        const originalX = originalBounds.x + (x / width) * originalBounds.width;
                        const originalY = originalBounds.y + (y / height) * originalBounds.height;
                        contourPoints.push({ x: Math.round(originalX), y: Math.round(originalY) });
                    }
                }
            }
        }
    }
    
    // 对轮廓点进行排序（按角度顺序）
    if (contourPoints.length > 0) {
        const cx = contourPoints.reduce((s, p) => s + p.x, 0) / contourPoints.length;
        const cy = contourPoints.reduce((s, p) => s + p.y, 0) / contourPoints.length;
        
        contourPoints.sort((a, b) => {
            const angleA = Math.atan2(a.y - cy, a.x - cx);
            const angleB = Math.atan2(b.y - cy, b.x - cx);
            return angleA - angleB;
        });
    }
    
    return contourPoints;
}

/**
 * 检查是否是边缘像素 (优化版)
 */
function isEdgePixelOptimized(
    data: Uint8Array,
    x: number,
    y: number,
    width: number,
    height: number,
    components: number,
    threshold: number
): boolean {
    // 检查 4 邻域
    const neighbors = [
        [x - 1, y], [x + 1, y],
        [x, y - 1], [x, y + 1]
    ];
    
    for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            return true;  // 边界
        }
        
        const nidx = (ny * width + nx) * components;
        const nAlpha = data[nidx + 3];  // Alpha 通道
        
        if (nAlpha < threshold) {
            return true;  // 邻居是透明的
        }
    }
    
    return false;
}

/**
 * 计算质心
 */
function computeCentroid(points: Point2D[]): Point2D {
    if (points.length === 0) return { x: 0, y: 0 };
    
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    
    return { x: sumX / points.length, y: sumY / points.length };
}

/**
 * 计算多边形面积
 */
function computeArea(points: Point2D[]): number {
    if (points.length < 3) return 0;
    
    let area = 0;
    const n = points.length;
    
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    
    return Math.abs(area) / 2;
}

/**
 * 均匀采样点
 */
function uniformSamplePoints(points: Point2D[], targetCount: number): Point2D[] {
    if (points.length <= targetCount) return points;
    
    const step = points.length / targetCount;
    const sampled: Point2D[] = [];
    
    for (let i = 0; i < targetCount; i++) {
        const idx = Math.floor(i * step);
        sampled.push(points[idx]);
    }
    
    return sampled;
}

// 注册工具
export const getLayerContourTool = {
    name: 'getLayerContour',
    description: '获取图层轮廓',
    handler: getLayerContour
};
