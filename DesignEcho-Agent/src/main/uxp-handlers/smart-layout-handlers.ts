/**
 * 智能布局 UXP Handlers
 * 
 * 提供 AI Agent 可调用的智能布局工具
 * 通过 WebSocket 暴露给 UXP 插件调用
 */

import { UXPContext } from './types';
import { 
    SmartLayoutService, 
    getSmartLayoutService,
    BoundingBox,
    ImageSize,
    LayerContext,
    SmartScaleConfig,
    SmartScaleResult
} from '../services/smart-layout-service';

// 单例服务
let smartLayoutService: SmartLayoutService | null = null;

function getService(): SmartLayoutService {
    if (!smartLayoutService) {
        smartLayoutService = getSmartLayoutService();
    }
    return smartLayoutService;
}

/**
 * 智能布局工具定义（供 AI Agent 使用）
 */
export const smartLayoutTools = [
    {
        name: 'smartLayout',
        description: `智能布局工具：自动识别图片主体并计算最优缩放和定位。

使用场景：
- 将产品图放入模板占位符
- 调整图片让主体居中/填充
- 批量处理多张产品图的布局

模式选择（自动判断）：
- CANVAS: 图片有背景，需要识别主体（抠图检测）
- CLIPPING_BASE: 图层有剪切蒙版，基于蒙版基底边界

参数说明：
- imageData: 图片 Base64 数据
- imageSize: 图片尺寸 {width, height}
- targetArea: 目标区域 {x, y, width, height}
- layerContext: 图层上下文（用于剪切蒙版模式）
- config.fillRatio: 主体填充目标区域的比例（默认 0.85）
- config.alignment: 对齐方式（center/bottom-center/top-center）

返回值：
- scale: 缩放比例
- position: 定位位置 {x, y}
- subjectBounds: 检测到的主体边界
- mode: 使用的检测模式`,
        parameters: {
            type: 'object',
            properties: {
                imageData: {
                    type: 'string',
                    description: '图片 Base64 数据'
                },
                imageSize: {
                    type: 'object',
                    description: '图片尺寸',
                    properties: {
                        width: { type: 'number' },
                        height: { type: 'number' }
                    },
                    required: ['width', 'height']
                },
                targetArea: {
                    type: 'object',
                    description: '目标区域',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        width: { type: 'number' },
                        height: { type: 'number' }
                    },
                    required: ['x', 'y', 'width', 'height']
                },
                layerContext: {
                    type: 'object',
                    description: '图层上下文（可选，用于剪切蒙版模式）',
                    properties: {
                        layerId: { type: 'number' },
                        isClipped: { type: 'boolean' },
                        clippingBaseLayerId: { type: 'number' },
                        clippingBaseBounds: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                width: { type: 'number' },
                                height: { type: 'number' }
                            }
                        }
                    }
                },
                config: {
                    type: 'object',
                    description: '布局配置',
                    properties: {
                        fillRatio: { 
                            type: 'number', 
                            description: '主体填充比例 (0-1)，默认 0.85' 
                        },
                        alignment: { 
                            type: 'string', 
                            enum: ['center', 'top-center', 'bottom-center', 'left-center', 'right-center'],
                            description: '对齐方式，默认 center' 
                        }
                    }
                }
            },
            required: ['imageData', 'imageSize', 'targetArea']
        }
    },
    {
        name: 'detectSubject',
        description: `检测图像主体边界。

用于预先获取主体位置信息，不执行缩放计算。

返回值：
- bounds: 主体边界框 {x, y, width, height}
- mode: 检测模式 (CANVAS/CLIPPING_BASE)
- foregroundRatio: 前景占比（仅 CANVAS 模式）`,
        parameters: {
            type: 'object',
            properties: {
                imageData: {
                    type: 'string',
                    description: '图片 Base64 数据'
                },
                imageSize: {
                    type: 'object',
                    properties: {
                        width: { type: 'number' },
                        height: { type: 'number' }
                    },
                    required: ['width', 'height']
                },
                layerContext: {
                    type: 'object',
                    description: '图层上下文（可选）'
                }
            },
            required: ['imageData', 'imageSize']
        }
    },
    {
        name: 'calculateSmartScale',
        description: `计算智能缩放参数。

基于已知的主体边界计算缩放比例和定位，不执行主体检测。

适用场景：
- 已经手动确定主体边界
- 需要批量计算多个目标区域`,
        parameters: {
            type: 'object',
            properties: {
                subjectBounds: {
                    type: 'object',
                    description: '主体边界框',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        width: { type: 'number' },
                        height: { type: 'number' }
                    },
                    required: ['x', 'y', 'width', 'height']
                },
                sourceImageSize: {
                    type: 'object',
                    properties: {
                        width: { type: 'number' },
                        height: { type: 'number' }
                    },
                    required: ['width', 'height']
                },
                targetArea: {
                    type: 'object',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        width: { type: 'number' },
                        height: { type: 'number' }
                    },
                    required: ['x', 'y', 'width', 'height']
                },
                config: {
                    type: 'object',
                    properties: {
                        fillRatio: { type: 'number' },
                        alignment: { type: 'string' }
                    }
                }
            },
            required: ['subjectBounds', 'sourceImageSize', 'targetArea']
        }
    }
];

/**
 * 注册智能布局 UXP handlers
 */
export function registerSmartLayoutUXPHandlers(context: UXPContext): void {
    const { wsServer } = context;
    
    if (!wsServer) {
        console.log('[SmartLayout UXP] WebSocket 未连接，跳过注册');
        return;
    }
    
    console.log('[SmartLayout UXP] 注册智能布局 handlers...');
    
    // 注册工具处理器
    wsServer.registerHandler('smartLayout', async (params: any) => {
        return handleSmartLayout(params);
    });
    
    wsServer.registerHandler('detectSubject', async (params: any) => {
        return handleDetectSubject(params);
    });
    
    wsServer.registerHandler('calculateSmartScale', async (params: any) => {
        return handleCalculateSmartScale(params);
    });
    
    console.log('[SmartLayout UXP] ✅ 智能布局 handlers 注册完成');
}

/**
 * 处理智能布局请求
 */
async function handleSmartLayout(params: {
    imageData: string;
    imageSize: ImageSize;
    targetArea: BoundingBox;
    layerContext?: LayerContext;
    config?: SmartScaleConfig;
}): Promise<SmartScaleResult> {
    try {
        const service = getService();
        const result = await service.smartLayout(
            params.imageData,
            params.imageSize,
            params.targetArea,
            {
                layerContext: params.layerContext,
                config: params.config
            }
        );
        return result;
    } catch (error: any) {
        console.error('[SmartLayout] 错误:', error.message);
        return {
            success: false,
            scale: 1,
            position: { x: 0, y: 0 },
            subjectBounds: { x: 0, y: 0, width: params.imageSize.width, height: params.imageSize.height },
            mode: 'canvas' as any,
            usedFallback: true,
            error: error.message
        };
    }
}

/**
 * 处理主体检测请求
 */
async function handleDetectSubject(params: {
    imageData: string;
    imageSize: ImageSize;
    layerContext?: LayerContext;
}): Promise<any> {
    try {
        const service = getService();
        const result = await service.detectSubject(
            params.imageData,
            params.imageSize,
            params.layerContext
        );
        return result;
    } catch (error: any) {
        console.error('[DetectSubject] 错误:', error.message);
        return {
            success: false,
            bounds: { x: 0, y: 0, width: params.imageSize.width, height: params.imageSize.height },
            error: error.message
        };
    }
}

/**
 * 处理缩放计算请求
 */
async function handleCalculateSmartScale(params: {
    subjectBounds: BoundingBox;
    sourceImageSize: ImageSize;
    targetArea: BoundingBox;
    config?: SmartScaleConfig;
}): Promise<any> {
    try {
        const service = getService();
        const result = service.calculateSmartScale(
            params.subjectBounds,
            params.sourceImageSize,
            params.targetArea,
            params.config
        );
        return {
            success: true,
            ...result
        };
    } catch (error: any) {
        console.error('[CalculateSmartScale] 错误:', error.message);
        return {
            success: false,
            scale: 1,
            position: { x: 0, y: 0 },
            error: error.message
        };
    }
}

/**
 * 获取智能布局工具 Schema（供 AI Agent 工具列表使用）
 */
export function getSmartLayoutToolSchemas(): any[] {
    return smartLayoutTools;
}
