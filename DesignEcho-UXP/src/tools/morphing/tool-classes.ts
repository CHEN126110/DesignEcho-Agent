/**
 * 形态变形工具类
 * 
 * 适配 ToolRegistry 的类结构
 */

import { Tool, ToolSchema } from '../types';
import { extractShapePath, ExtractShapePathParams } from './shape-extractor';
import { getLayerContour, GetLayerContourParams } from './contour-detector';
import { morphToShape, batchMorphToShape, MorphToShapeParams } from './morph-executor';
import { applyDisplacement, ApplyDisplacementParams } from './apply-displacement';
import { MorphingConfig } from './types';

/**
 * 提取形状路径工具
 */
export class ExtractShapePathTool implements Tool {
    name = 'extractShapePath';
    
    schema: ToolSchema = {
        name: 'extractShapePath',
        description: '从形状图层提取路径数据（贝塞尔曲线控制点），用于形态统一变形',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '形状图层 ID，不指定则使用当前选中图层'
                },
                samplePoints: {
                    type: 'number',
                    description: '轮廓采样点数（默认 100）'
                }
            }
        }
    };
    
    async execute(params: ExtractShapePathParams): Promise<any> {
        const result = await extractShapePath(params);
        return result.data || { success: false, error: result.error };
    }
}

/**
 * 获取图层轮廓工具
 */
export class GetLayerContourTool implements Tool {
    name = 'getLayerContour';
    
    schema: ToolSchema = {
        name: 'getLayerContour',
        description: '从图像图层检测产品轮廓（用于形态变形）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层 ID，不指定则使用当前选中图层'
                },
                method: {
                    type: 'string',
                    enum: ['mask', 'edge'],
                    description: '检测方法: mask=从蒙版/透明度提取, edge=边缘检测'
                },
                threshold: {
                    type: 'number',
                    description: '边缘阈值 (0-255)，默认 128'
                },
                samplePoints: {
                    type: 'number',
                    description: '采样点数（默认 100）'
                }
            }
        }
    };
    
    async execute(params: GetLayerContourParams): Promise<any> {
        const result = await getLayerContour(params);
        return result.data || { success: false, error: result.error };
    }
}

/**
 * 形态变形工具
 */
export class MorphToShapeTool implements Tool {
    name = 'morphToShape';
    
    schema: ToolSchema = {
        name: 'morphToShape',
        description: '对图层做形状对齐预览（提取目标形状与源轮廓后只应用对齐变换，不执行真实变形；真实变形需 applyDisplacement / applyMorphedImage）',
        parameters: {
            type: 'object',
            properties: {
                targetShapeLayerId: {
                    type: 'number',
                    description: '目标形状图层 ID（用户绘制的标准形状）'
                },
                sourceLayerId: {
                    type: 'number',
                    description: '源图层 ID，不指定则使用当前选中图层'
                },
                edgeBandWidth: {
                    type: 'number',
                    description: '边缘变形带宽度（像素），默认 50'
                },
                transitionWidth: {
                    type: 'number',
                    description: '过渡区宽度（像素），默认 30'
                },
                detectPatterns: {
                    type: 'boolean',
                    description: '是否自动检测图案区域（默认 true）'
                },
                detectLace: {
                    type: 'boolean',
                    description: '是否自动检测花边区域（默认 true）'
                },
                patternProtection: {
                    type: 'number',
                    description: '图案保护强度 0-1（默认 0.8）'
                },
                alignmentMethod: {
                    type: 'string',
                    enum: ['centroid', 'boundingBox', 'auto'],
                    description: '对齐方式: centroid=质心, boundingBox=边界框, auto=自动'
                },
                qualityPreset: {
                    type: 'string',
                    enum: ['fast', 'balanced', 'quality'],
                    description: '质量预设: fast=快速, balanced=平衡, quality=高质量'
                }
            },
            required: ['targetShapeLayerId']
        }
    };
    
    async execute(params: any): Promise<any> {
        // 构建配置
        const config: Partial<MorphingConfig> = {};
        
        if (params.edgeBandWidth !== undefined) config.edgeBandWidth = params.edgeBandWidth;
        if (params.transitionWidth !== undefined) config.transitionWidth = params.transitionWidth;
        if (params.detectPatterns !== undefined) config.detectPatterns = params.detectPatterns;
        if (params.detectLace !== undefined) config.detectLace = params.detectLace;
        if (params.patternProtection !== undefined) config.patternProtection = params.patternProtection;
        if (params.alignmentMethod !== undefined) config.alignmentMethod = params.alignmentMethod;
        if (params.qualityPreset !== undefined) config.qualityPreset = params.qualityPreset;
        
        const morphParams: MorphToShapeParams = {
            targetShapeLayerId: params.targetShapeLayerId,
            sourceLayerId: params.sourceLayerId,
            config
        };
        
        const result = await morphToShape(morphParams);
        return result.data || { success: false, error: result.error };
    }
}

/**
 * 批量形态变形工具
 */
export class BatchMorphToShapeTool implements Tool {
    name = 'batchMorphToShape';
    
    schema: ToolSchema = {
        name: 'batchMorphToShape',
        description: '批量对多个图层做形状对齐预览（只应用对齐变换，不执行真实变形；真实变形需 applyDisplacement / applyMorphedImage）',
        parameters: {
            type: 'object',
            properties: {
                targetShapeLayerId: {
                    type: 'number',
                    description: '目标形状图层 ID'
                },
                sourceLayerIds: {
                    type: 'array',
                    description: '源图层 ID 数组',
                    items: { type: 'number' }
                },
                edgeBandWidth: {
                    type: 'number',
                    description: '边缘变形带宽度（像素）'
                },
                patternProtection: {
                    type: 'number',
                    description: '图案保护强度 0-1'
                },
                qualityPreset: {
                    type: 'string',
                    enum: ['fast', 'balanced', 'quality'],
                    description: '质量预设'
                }
            },
            required: ['targetShapeLayerId', 'sourceLayerIds']
        }
    };
    
    async execute(params: any): Promise<any> {
        const config: Partial<MorphingConfig> = {};
        
        if (params.edgeBandWidth !== undefined) config.edgeBandWidth = params.edgeBandWidth;
        if (params.patternProtection !== undefined) config.patternProtection = params.patternProtection;
        if (params.qualityPreset !== undefined) config.qualityPreset = params.qualityPreset;
        
        const result = await batchMorphToShape(
            params.targetShapeLayerId,
            params.sourceLayerIds,
            config
        );
        
        return result.data || { success: false, error: result.error };
    }
}

/**
 * 应用稀疏位移场工具
 * 接收 Agent 端计算的 JFA + MLS 位移场，在 UXP 端应用变形
 */
export class ApplyDisplacementTool implements Tool {
    name = 'applyDisplacement';
    
    schema: ToolSchema = {
        name: 'applyDisplacement',
        description: '应用稀疏位移场到图层（优化版形态变形）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '目标图层 ID'
                },
                sparseDisplacement: {
                    type: 'string',
                    description: '稀疏位移场数据（SPARSE:xxx 格式）'
                },
                preserveOriginal: {
                    type: 'boolean',
                    description: '是否保留原图层并在副本上写回，默认 true'
                },
                resultLayerName: {
                    type: 'string',
                    description: '输出图层名称（可选）'
                }
            },
            required: ['layerId', 'sparseDisplacement']
        }
    };
    
    async execute(params: ApplyDisplacementParams): Promise<any> {
        const result = await applyDisplacement(params);
        return result.data || { success: false, error: result.error };
    }
}
