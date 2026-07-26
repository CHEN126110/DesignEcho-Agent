/**
 * 变形执行器
 * 
 * 将图层变形为目标形状
 * 主要逻辑在 Agent 端执行，这里负责调用和结果应用
 */

import { action, app, core } from 'photoshop';
import { ToolResult } from '../types';
import { Point2D, MorphingConfig, MorphResult, BatchMorphResult, ShapeContour, AlignmentTransform } from './types';
import { 
    startTask, endTask, startStep, endStep, 
    logInfo, logDebug, logWarn, logError, logPerf 
} from './execution-logger';
import { extractShapePath } from './shape-extractor';
import { getLayerContour } from './contour-detector';

export interface MorphToShapeParams {
    targetShapeLayerId: number;    // 目标形状图层 ID
    sourceLayerId?: number;        // 源图层 ID（不指定则使用当前选中）
    config?: Partial<MorphingConfig>;
}

export interface MorphToShapeResult extends MorphResult {
    // 继承自 MorphResult
}

// 默认配置
const DEFAULT_CONFIG: MorphingConfig = {
    edgeBandWidth: 50,
    transitionWidth: 30,
    detectPatterns: true,
    detectLace: true,
    patternProtection: 0.8,
    alignmentMethod: 'auto',
    qualityPreset: 'balanced'
};

/**
 * 将图层变形为目标形状
 */
export async function morphToShape(params: MorphToShapeParams): Promise<ToolResult<MorphToShapeResult>> {
    const taskId = startTask('形态变形', { params });
    const startTime = performance.now();
    const config = { ...DEFAULT_CONFIG, ...params.config };
    
    try {
        // 步骤 1: 提取目标形状
        const step1 = startStep('提取目标形状');
        
        const targetResult = await extractShapePath({ layerId: params.targetShapeLayerId });
        
        if (!targetResult.success || !targetResult.data?.contour) {
            endStep(step1, false);
            logError('无法提取目标形状', { targetShapeLayerId: params.targetShapeLayerId });
            endTask(taskId, false);
            return {
                success: false,
                error: `无法提取目标形状: ${targetResult.error}`,
                data: null
            };
        }
        
        const targetContour = targetResult.data.contour;
        const targetPoints = targetResult.data.sampledPoints;
        
        logInfo(`目标形状: ${targetContour.layerName}`, {
            pointCount: targetPoints.length,
            boundingBox: targetContour.boundingBox
        });
        endStep(step1, true);
        
        // 步骤 2: 获取源图层轮廓
        const step2 = startStep('获取源图层轮廓');
        
        const sourceResult = await getLayerContour({ layerId: params.sourceLayerId });
        
        if (!sourceResult.success || !sourceResult.data?.contour) {
            endStep(step2, false);
            logError('无法获取源图层轮廓');
            endTask(taskId, false);
            return {
                success: false,
                error: `无法获取源图层轮廓: ${sourceResult.error}`,
                data: null
            };
        }
        
        const sourceContour = sourceResult.data.contour;
        const sourcePoints = sourceResult.data.sampledPoints;
        
        logInfo(`源图层: ${sourceContour.layerName}`, {
            pointCount: sourcePoints.length,
            boundingBox: sourceContour.boundingBox
        });
        endStep(step2, true);
        
        // 步骤 3: 计算对齐变换
        const step3 = startStep('计算对齐变换');
        
        const alignment = computeAlignment(sourceContour, targetContour, config.alignmentMethod);
        
        logInfo('对齐变换', alignment);
        endStep(step3, true, { alignment });
        
        // 步骤 4: 计算形状差异
        const step4 = startStep('计算形状差异');
        
        const shapeDifference = computeShapeDifference(sourcePoints, targetPoints);
        
        logInfo(`形状差异: ${(shapeDifference * 100).toFixed(1)}%`);
        endStep(step4, true, { shapeDifference });
        
        // 步骤 5: 发送变形请求到 Agent
        const step5 = startStep('准备变形请求');
        
        // 构建发送到 Agent 的数据
        const morphRequest = {
            action: 'morphing.execute',
            data: {
                sourceLayerId: sourceContour.layerId,
                targetLayerId: targetContour.layerId,
                sourceContour: sourcePoints,
                targetContour: targetPoints,
                alignment,
                config,
                shapeDifference
            }
        };
        
        logInfo('变形请求已准备', {
            sourceLayer: sourceContour.layerName,
            targetLayer: targetContour.layerName,
            config: config.qualityPreset
        });
        
        // 注意：实际变形需要通过 WebSocket 发送到 Agent
        // 这里先返回准备好的数据，等待 Agent 集成
        logWarn('变形执行需要 Agent 端支持，当前返回准备数据');
        
        endStep(step5, true, { request: morphRequest });
        
        // 步骤 6: 应用对齐变换（预览）
        const step6 = startStep('应用对齐变换预览');
        
        try {
            await applyAlignmentTransform(sourceContour.layerId, alignment);
            logInfo('对齐变换已应用');
            endStep(step6, true);
        } catch (alignError: any) {
            logWarn(`应用对齐变换失败: ${alignError.message}`);
            endStep(step6, false, { error: alignError.message });
        }
        
        // 完成
        const processingTime = performance.now() - startTime;
        logPerf('形态变形准备', processingTime);
        endTask(taskId, true);
        
        return {
            success: true,
            data: {
                success: true,
                layerId: sourceContour.layerId,
                layerName: sourceContour.layerName,
                processingTime,
                details: {
                    alignmentApplied: alignment,
                    // 诚实结果：本工具当前只提取轮廓并应用对齐变换，不执行真实形状变形。
                    // 真实变形走 Agent 变形管线（applyDisplacement 位移场 / applyMorphedImage 回写）。
                    morphApplied: false,
                    note: '已提取目标形状与源轮廓并应用对齐预览；未执行真实形状变形（需 Agent 变形管线 applyDisplacement / applyMorphedImage 完成）。',
                    shapeDifference
                }
            }
        };
        
    } catch (error: any) {
        const processingTime = performance.now() - startTime;
        logError(error, { params });
        endTask(taskId, false);
        
        return {
            success: false,
            error: `变形失败: ${error.message}`,
            data: {
                success: false,
                layerId: params.sourceLayerId || -1,
                layerName: '',
                processingTime,
                error: error.message
            }
        };
    }
}

/**
 * 计算对齐变换
 */
function computeAlignment(
    source: ShapeContour,
    target: ShapeContour,
    method: 'centroid' | 'boundingBox' | 'auto'
): AlignmentTransform {
    // 默认使用边界框对齐
    const actualMethod = method === 'auto' ? 'boundingBox' : method;
    
    let translation: Point2D;
    let scale: Point2D;
    
    if (actualMethod === 'centroid') {
        // 质心对齐
        translation = {
            x: target.centroid.x - source.centroid.x,
            y: target.centroid.y - source.centroid.y
        };
        
        // 基于面积计算缩放
        const areaRatio = Math.sqrt(target.area / source.area);
        scale = { x: areaRatio, y: areaRatio };
    } else {
        // 边界框对齐
        translation = {
            x: target.boundingBox.x - source.boundingBox.x,
            y: target.boundingBox.y - source.boundingBox.y
        };
        
        scale = {
            x: target.boundingBox.width / source.boundingBox.width,
            y: target.boundingBox.height / source.boundingBox.height
        };
    }
    
    // 旋转暂时不计算（需要 PCA 分析）
    const rotation = 0;
    
    return { translation, scale, rotation };
}

/**
 * 计算形状差异 (0-1)
 * 使用 Hausdorff 距离的简化版本
 */
function computeShapeDifference(source: Point2D[], target: Point2D[]): number {
    if (source.length === 0 || target.length === 0) return 1;
    
    // 归一化点坐标
    const normalizePoints = (points: Point2D[]) => {
        const minX = Math.min(...points.map(p => p.x));
        const maxX = Math.max(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y));
        const maxY = Math.max(...points.map(p => p.y));
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        
        return points.map(p => ({
            x: (p.x - minX) / rangeX,
            y: (p.y - minY) / rangeY
        }));
    };
    
    const normSource = normalizePoints(source);
    const normTarget = normalizePoints(target);
    
    // 计算平均最近距离
    let totalDist = 0;
    
    for (const sp of normSource) {
        let minDist = Infinity;
        for (const tp of normTarget) {
            const dx = sp.x - tp.x;
            const dy = sp.y - tp.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            minDist = Math.min(minDist, dist);
        }
        totalDist += minDist;
    }
    
    // 归一化差异值 (0-1)
    const avgDist = totalDist / normSource.length;
    return Math.min(1, avgDist * 2);  // 乘以 2 放大差异
}

/**
 * 应用对齐变换
 */
async function applyAlignmentTransform(layerId: number, alignment: AlignmentTransform): Promise<void> {
    const { translation, scale } = alignment;
    
    // 写操作必须包 executeAsModal：与其他写工具一致，避免与 PS 主线程状态竞争。
    await core.executeAsModal(async () => {
        // 使用 batchPlay 应用变换
        await action.batchPlay([
            // 先选择图层
            {
                _obj: 'select',
                _target: [{ _ref: 'layer', _id: layerId }],
                makeVisible: false,
                _options: { dialogOptions: 'dontDisplay' }
            },
            // 应用自由变换
            {
                _obj: 'transform',
                freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                offset: {
                    _obj: 'offset',
                    horizontal: { _unit: 'pixelsUnit', _value: translation.x },
                    vertical: { _unit: 'pixelsUnit', _value: translation.y }
                },
                width: { _unit: 'percentUnit', _value: scale.x * 100 },
                height: { _unit: 'percentUnit', _value: scale.y * 100 },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], { synchronousExecution: true });
    }, { commandName: '形态变形对齐预览' });
}

/**
 * 批量变形
 */
export async function batchMorphToShape(
    targetShapeLayerId: number,
    sourceLayerIds: number[],
    config?: Partial<MorphingConfig>
): Promise<ToolResult<BatchMorphResult>> {
    const taskId = startTask('批量形态变形', {
        targetShapeLayerId,
        sourceCount: sourceLayerIds.length
    });
    const startTime = performance.now();
    
    const results: MorphResult[] = [];
    let successCount = 0;
    let failedCount = 0;
    
    for (let i = 0; i < sourceLayerIds.length; i++) {
        const sourceLayerId = sourceLayerIds[i];
        logInfo(`处理第 ${i + 1}/${sourceLayerIds.length} 个图层 (ID: ${sourceLayerId})`);
        
        const result = await morphToShape({
            targetShapeLayerId,
            sourceLayerId,
            config
        });
        
        if (result.success && result.data) {
            results.push(result.data);
            successCount++;
        } else {
            results.push({
                success: false,
                layerId: sourceLayerId,
                layerName: '',
                processingTime: 0,
                error: result.error
            });
            failedCount++;
        }
    }
    
    const totalTime = performance.now() - startTime;
    logPerf('批量变形完成', totalTime, { successCount, failedCount });
    endTask(taskId, failedCount === 0);
    
    return {
        success: failedCount === 0,
        data: {
            success: failedCount === 0,
            totalLayers: sourceLayerIds.length,
            successCount,
            failedCount,
            results,
            totalTime
        }
    };
}

// 注册工具
export const morphToShapeTool = {
    name: 'morphToShape',
    description: '提取目标形状与源轮廓并应用对齐预览（不执行真实变形；真实变形需 applyDisplacement / applyMorphedImage）',
    handler: morphToShape
};

export const batchMorphToShapeTool = {
    name: 'batchMorphToShape',
    description: '批量对多个图层执行形状对齐预览（不执行真实变形；真实变形需 applyDisplacement / applyMorphedImage）',
    handler: batchMorphToShape
};
