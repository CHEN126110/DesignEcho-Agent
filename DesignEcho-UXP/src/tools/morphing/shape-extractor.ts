/**
 * 形状路径提取工具
 * 
 * 从 Photoshop 形状图层提取路径数据（贝塞尔曲线控制点）
 */

import { action, app } from 'photoshop';
import { ToolResult } from '../types';
import { Point2D, BezierPoint, PathData, ShapeContour, BoundingBox } from './types';
import {
    buildBoundingBoxFromBounds,
    createRectanglePathData,
    readPathAxisValue
} from './geometry-helpers';
import { 
    startTask, endTask, startStep, endStep, 
    logInfo, logDebug, logWarn, logError, logPerf 
} from './execution-logger';

export interface ExtractShapePathParams {
    layerId?: number;      // 指定图层 ID，不指定则使用当前选中图层
    samplePoints?: number; // 轮廓采样点数，默认 100
}

export interface ExtractShapePathResult {
    success: boolean;
    layerId: number;
    layerName: string;
    contour: ShapeContour | null;
    sampledPoints: Point2D[];  // 采样后的轮廓点（用于变形计算）
    error?: string;
    processingTime: number;
}

/**
 * 提取形状图层路径
 */
export async function extractShapePath(params: ExtractShapePathParams = {}): Promise<ToolResult<ExtractShapePathResult>> {
    const taskId = startTask('提取形状路径', { params });
    const startTime = performance.now();
    
    try {
        // 步骤 1: 获取目标图层
        const step1 = startStep('获取目标图层');
        
        const doc = app.activeDocument;
        if (!doc) {
            endStep(step1, false);
            logError('没有打开的文档');
            endTask(taskId, false);
            return {
                success: false,
                error: '没有打开的文档',
                data: null
            };
        }
        
        let layerId = params.layerId;
        let layerName = '';
        
        if (!layerId) {
            // 使用当前选中的图层
            const activeLayers = doc.activeLayers;
            if (!activeLayers || activeLayers.length === 0) {
                endStep(step1, false);
                logError('没有选中的图层');
                endTask(taskId, false);
                return {
                    success: false,
                    error: '请先选择一个形状图层',
                    data: null
                };
            }
            layerId = activeLayers[0].id;
            layerName = activeLayers[0].name;
        } else {
            // 查找指定图层
            const layer = doc.layers.find((l: any) => l.id === layerId);
            if (layer) {
                layerName = layer.name;
            }
        }
        
        logInfo(`目标图层: ${layerName} (ID: ${layerId})`);
        endStep(step1, true, { layerId, layerName });
        
        // 步骤 2: 检查图层类型
        const step2 = startStep('检查图层类型');
        
        const layerInfo = await action.batchPlay([{
            _obj: 'get',
            _target: [
                { _ref: 'layer', _id: layerId }
            ],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
        
        logDebug('图层信息', layerInfo[0]);
        
        // 检查是否是形状图层
        const layerKind = layerInfo[0]?.layerKind;
        const hasVectorMask = layerInfo[0]?.hasVectorMask;
        
        logInfo(`图层类型: ${layerKind}, 有矢量蒙版: ${hasVectorMask}`);
        
        // 形状图层通常是 solidColorLayer (4) 且有 vectorMask
        // 或者直接是路径图层
        if (!hasVectorMask && layerKind !== 4) {
            logWarn('图层可能不是形状图层，尝试继续提取...');
        }
        
        endStep(step2, true, { layerKind, hasVectorMask });
        
        // 步骤 3: 获取路径数据
        const step3 = startStep('获取路径数据');
        
        let pathData: PathData[] = [];
        
        try {
            // 尝试获取矢量蒙版路径
            const pathResult = await action.batchPlay([{
                _obj: 'get',
                _target: [
                    { _ref: 'path', _enum: 'path', _value: 'vectorMask' },
                    { _ref: 'layer', _id: layerId }
                ],
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });
            
            logDebug('路径数据原始结果', pathResult[0]);
            
            if (pathResult[0]?.pathContents) {
                pathData = parsePathContents(pathResult[0].pathContents);
                logInfo(`解析到 ${pathData.length} 个路径`);
            } else {
                logWarn('未找到 pathContents，尝试其他方式...');
                
                // 尝试获取图层边界作为替代
                const boundsResult = await getLayerBounds(layerId);
                if (boundsResult) {
                    pathData = [createRectanglePathData(boundsResult)];
                    logWarn('使用图层边界作为路径替代');
                }
            }
        } catch (pathError: any) {
            logError(pathError, { layerId, step: 'getPath' });
            
            // 尝试备用方案：获取图层边界
            logInfo('尝试备用方案：获取图层边界');
            const boundsResult = await getLayerBounds(layerId);
            if (boundsResult) {
                pathData = [createRectanglePathData(boundsResult)];
            }
        }
        
        if (pathData.length === 0) {
            endStep(step3, false);
            logError('无法提取路径数据');
            endTask(taskId, false);
            return {
                success: false,
                error: '无法提取形状路径，请确保选择的是形状图层',
                data: null
            };
        }
        
        endStep(step3, true, { pathCount: pathData.length });
        
        // 步骤 4: 计算轮廓属性
        const step4 = startStep('计算轮廓属性');
        
        const allPoints = pathData.flatMap(p => p.points.map(pt => pt.anchor));
        const boundingBox = computeBoundingBox(allPoints);
        const centroid = computeCentroid(allPoints);
        const area = computeArea(allPoints);
        
        const contour: ShapeContour = {
            layerId,
            layerName,
            paths: pathData,
            boundingBox,
            centroid,
            area
        };
        
        logInfo('轮廓属性', {
            boundingBox,
            centroid,
            area,
            totalPoints: allPoints.length
        });
        
        endStep(step4, true);
        
        // 步骤 5: 采样轮廓点
        const step5 = startStep('采样轮廓点');
        
        const sampleCount = params.samplePoints || 100;
        const sampledPoints = sampleContourPoints(pathData, sampleCount);
        
        logInfo(`采样 ${sampledPoints.length} 个点`);
        endStep(step5, true, { sampledCount: sampledPoints.length });
        
        // 完成
        const processingTime = performance.now() - startTime;
        logPerf('形状路径提取', processingTime);
        endTask(taskId, true);
        
        return {
            success: true,
            data: {
                success: true,
                layerId,
                layerName,
                contour,
                sampledPoints,
                processingTime
            }
        };
        
    } catch (error: any) {
        const processingTime = performance.now() - startTime;
        logError(error, { params });
        endTask(taskId, false);
        
        return {
            success: false,
            error: `提取形状路径失败: ${error.message}`,
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
 * 解析路径内容
 */
function parsePathContents(pathContents: any): PathData[] {
    const paths: PathData[] = [];
    
    logDebug('解析路径内容', pathContents);
    
    // pathContents 通常包含 pathComponents 数组
    const components = pathContents.pathComponents || [pathContents];
    
    for (const component of components) {
        const subpathListKey = component.subpathListKey || [];
        
        for (const subpath of subpathListKey) {
            const points: BezierPoint[] = [];
            const closed = subpath.closedSubpath || false;
            const pathPoints = subpath.points || [];
            
            for (const pt of pathPoints) {
                const anchor = pt.anchor || {};
                const leftDir = pt.leftDirection || anchor;
                const rightDir = pt.rightDirection || anchor;
                
                // Photoshop 路径点坐标是归一化的 (0-1)，需要转换
                // 如果是 horizontal/vertical 格式
                points.push({
                    anchor: {
                        x: readPathAxisValue(anchor, 'horizontal', 'x'),
                        y: readPathAxisValue(anchor, 'vertical', 'y')
                    },
                    leftDirection: {
                        x: readPathAxisValue(leftDir, 'horizontal', 'x'),
                        y: readPathAxisValue(leftDir, 'vertical', 'y')
                    },
                    rightDirection: {
                        x: readPathAxisValue(rightDir, 'horizontal', 'x'),
                        y: readPathAxisValue(rightDir, 'vertical', 'y')
                    }
                });
            }
            
            if (points.length > 0) {
                paths.push({ points, closed });
            }
        }
    }
    
    return paths;
}

/**
 * 获取图层边界
 */
async function getLayerBounds(layerId: number): Promise<BoundingBox | null> {
    try {
        const result = await action.batchPlay([{
            _obj: 'get',
            _target: [{ _ref: 'layer', _id: layerId }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
        
        const bounds = result[0]?.bounds;
        return buildBoundingBoxFromBounds(bounds);
    } catch {
        return null;
    }
}

/**
 * 计算边界框
 */
function computeBoundingBox(points: Point2D[]): BoundingBox {
    if (points.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

/**
 * 计算质心
 */
function computeCentroid(points: Point2D[]): Point2D {
    if (points.length === 0) {
        return { x: 0, y: 0 };
    }
    
    let sumX = 0, sumY = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
    }
    
    return {
        x: sumX / points.length,
        y: sumY / points.length
    };
}

/**
 * 计算多边形面积 (Shoelace formula)
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
 * 采样轮廓点
 * 将贝塞尔曲线采样为均匀分布的点
 */
function sampleContourPoints(paths: PathData[], targetCount: number): Point2D[] {
    const points: Point2D[] = [];
    
    for (const path of paths) {
        if (path.points.length < 2) continue;
        
        const pathPoints = path.points;
        const n = pathPoints.length;
        
        // 计算每段曲线需要的采样点数
        const segmentCount = path.closed ? n : n - 1;
        const samplesPerSegment = Math.ceil(targetCount / segmentCount);
        
        for (let i = 0; i < segmentCount; i++) {
            const p0 = pathPoints[i];
            const p1 = pathPoints[(i + 1) % n];
            
            // 采样贝塞尔曲线
            for (let t = 0; t < samplesPerSegment; t++) {
                const ratio = t / samplesPerSegment;
                const point = sampleBezierCurve(
                    p0.anchor,
                    p0.rightDirection || p0.anchor,
                    p1.leftDirection || p1.anchor,
                    p1.anchor,
                    ratio
                );
                points.push(point);
            }
        }
    }
    
    return points;
}

/**
 * 采样三次贝塞尔曲线上的点
 */
function sampleBezierCurve(
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    t: number
): Point2D {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    
    return {
        x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
        y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
    };
}

// 注册工具
export const extractShapePathTool = {
    name: 'extractShapePath',
    description: '从形状图层提取路径数据',
    handler: extractShapePath
};
