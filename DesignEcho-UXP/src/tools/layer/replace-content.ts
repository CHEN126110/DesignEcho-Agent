/**
 * 替换图层内容工具
 * 
 * 将 base64 图像数据应用到指定图层
 */

import { app, action, core } from 'photoshop';
import { Tool, ToolResult } from '../types';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload
} from '../../core/image-safety';
import { createToolFailureResult, ToolFailureResult } from '../../core/tool-error-normalizer';

type ReplaceLayerContentResult = ToolResult | ToolFailureResult;

interface ReplaceLayerContentParams {
    layerId: number;
    imageBase64: string;
    bounds?: {
        left: number;
        top: number;
        width: number;
        height: number;
    };
}

function failure(toolName: string, error: unknown, params?: unknown): ToolFailureResult {
    return createToolFailureResult({ toolName, error, params });
}

/**
 * 替换图层内容
 * 将 base64 图像数据替换指定图层的内容
 */
export async function replaceLayerContent(params: ReplaceLayerContentParams): Promise<ReplaceLayerContentResult> {
    const { layerId, imageBase64, bounds } = params;
    
    console.log('[replaceLayerContent] 开始替换图层内容');
    console.log(`  图层 ID: ${layerId}`);
    console.log(`  bounds: ${bounds ? `(${bounds.left}, ${bounds.top}) ${bounds.width}x${bounds.height}` : '无'}`);
    
    // 用于存储 executeAsModal 内部的结果
    let modalResult: ReplaceLayerContentResult = failure('replaceLayerContent', '未执行', params);
    
    try {
        // 使用 executeAsModal 包装所有会修改 Photoshop 状态的操作
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) {
                modalResult = failure('replaceLayerContent', '没有打开的文档', params);
                return;
            }
            
            // 查找目标图层
            const targetLayer = findLayerById(doc.layers, layerId);
            if (!targetLayer) {
                modalResult = failure('replaceLayerContent', `未找到图层 ID: ${layerId}`, params);
                return;
            }
            
            console.log(`  目标图层: "${targetLayer.name}"`);
            
            const { bytes, mimeType } = bytesFromBase64ImagePayload(imageBase64);
            const safety = assertImageBytesSafeForPhotoshop(bytes, {
                formatHint: mimeType,
                sourceLabel: 'replaceLayerContent 图像'
            });
            if (safety.format !== 'png') {
                modalResult = failure('replaceLayerContent', 'replaceLayerContent 当前只支持安全 PNG 图像数据', {
                    layerId,
                    bounds,
                    mimeType,
                    detectedFormat: safety.format
                });
                return;
            }
            
            // 使用 batchPlay 放置图像
            await action.batchPlay([
                {
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layerId }],
                    makeVisible: true,
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });
        
        // 创建临时文件来存储图像数据
        // 由于 UXP 限制，我们使用剪贴板或直接操作像素
        
        // 方法：使用 imaging API 替换像素
        // 1. 创建新图层
        // 2. 将图像像素写入
        // 3. 合并到原图层
        
        // 首先获取图像尺寸（从 PNG 头部解析）
        const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        const isPNG = pngSignature.every((b, i) => bytes[i] === b);
        
        if (!isPNG) {
            modalResult = failure('replaceLayerContent', '图像格式不是 PNG', params);
            return;
        }
        
        // 解析 PNG IHDR 获取尺寸
        const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
        
        console.log(`  图像尺寸: ${width}x${height}`);
        
        // 使用 imaging API 解码 PNG 并获取像素数据
        // 注意：UXP 的 imaging API 可能不直接支持 PNG 解码
        // 我们需要使用其他方法
        
        // 方法 2：通过临时文件和 placeEmbedded
        const uxpStorage = require('uxp').storage;
        const fs = uxpStorage.localFileSystem;
        const tempFolder = await fs.getTemporaryFolder();
        const tempFile = await tempFolder.createFile('temp_warp_result.png', { overwrite: true });
        
        await tempFile.write(arrayBufferFromBytes(bytes));
        
        console.log(`  临时文件已创建: ${tempFile.nativePath}`);
        
        // 创建 session token（UXP 要求通过 token 访问文件）
        const fileToken = await uxpStorage.localFileSystem.createSessionToken(tempFile);
        console.log(`  Session token 已创建`);
        
        // 获取原图层位置
        const targetBounds = bounds || {
            left: targetLayer.bounds?.left || 0,
            top: targetLayer.bounds?.top || 0,
            width: targetLayer.bounds?.right - targetLayer.bounds?.left || width,
            height: targetLayer.bounds?.bottom - targetLayer.bounds?.top || height
        };
        
        // 在原图层上方放置新图像
        // 使用 session token 而不是 nativePath
        await action.batchPlay([
            {
                _obj: 'placeEvent',
                null: {
                    _path: fileToken,
                    _kind: 'local'
                },
                linked: false,  // 不链接，嵌入
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], { synchronousExecution: true });
        
        console.log('  图像已放置');
        
        // 获取新创建的图层
        const newLayer = doc.activeLayers[0];
        
        if (!newLayer) {
            console.warn('  ⚠ 未能获取新图层');
            modalResult = failure('replaceLayerContent', '放置图像后未能获取新图层', params);
            return;
        }
        
        // 不再猜测性调用 rasterizeLayer。Photoshop 在命令不可用时会弹原生阻塞窗口，
        // 这里保持置入层原状态，后续需要栅格化时必须走显式、可验证的安全工具。

        // 获取新图层的当前边界
        const newLayerBounds = newLayer.bounds;
        const currentLeft = newLayerBounds?.left || 0;
        const currentTop = newLayerBounds?.top || 0;
        const currentWidth = (newLayerBounds?.right || 0) - currentLeft;
        const currentHeight = (newLayerBounds?.bottom || 0) - currentTop;
        
        console.log(`  新图层当前位置: (${currentLeft}, ${currentTop}) ${currentWidth}x${currentHeight}`);
        console.log(`  目标位置: (${targetBounds.left}, ${targetBounds.top}) ${targetBounds.width}x${targetBounds.height}`);
        
        // 计算需要移动的偏移量和缩放比例
        const scaleX = targetBounds.width / currentWidth;
        const scaleY = targetBounds.height / currentHeight;
        const offsetX = targetBounds.left - currentLeft;
        const offsetY = targetBounds.top - currentTop;
        
        // 使用 transform 命令定位和缩放
        if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01 || Math.abs(offsetX) > 1 || Math.abs(offsetY) > 1) {
            await action.batchPlay([
                {
                    _obj: 'transform',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSCorner0' },  // 左上角锚点
                    offset: {
                        _obj: 'offset',
                        horizontal: { _unit: 'pixelsUnit', _value: offsetX },
                        vertical: { _unit: 'pixelsUnit', _value: offsetY }
                    },
                    width: { _unit: 'percentUnit', _value: scaleX * 100 },
                    height: { _unit: 'percentUnit', _value: scaleY * 100 },
                    interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });
            console.log('  图层已变换到目标位置');
        }
        
        // 重命名新图层（添加后缀表示已变形）
        if (newLayer && newLayer.name) {
            const newName = targetLayer.name.includes('_warped') 
                ? targetLayer.name 
                : `${targetLayer.name}_warped`;
            newLayer.name = newName;
        }
        
        const newLayerId = (newLayer as any)?._id || (newLayer as any)?.id;
        
        // 隐藏原图层（不删除，方便对比）
        await action.batchPlay([
            {
                _obj: 'hide',
                null: [{ _ref: 'layer', _id: layerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], { synchronousExecution: true });
        
            // 清理临时文件
            try {
                await tempFile.delete();
            } catch (e) {
                console.warn('  临时文件删除失败（可忽略）');
            }
            
            console.log('  ✓ 图层内容替换完成');
            
            modalResult = {
                success: true,
                data: {
                    originalLayerId: layerId,
                    newLayerId: newLayerId,
                    width,
                    height
                }
            };
        }, { commandName: '替换图层内容' });
        
        return modalResult;
        
    } catch (error: any) {
        console.error('[replaceLayerContent] 错误:', error);
        return failure('replaceLayerContent', error, params);
    }
}

/**
 * 递归查找图层
 */
function findLayerById(layers: any, id: number): any {
    for (const layer of layers) {
        if (layer._id === id || layer.id === id) {
            return layer;
        }
        if (layer.layers && layer.layers.length > 0) {
            const found = findLayerById(layer.layers, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * 替换图层内容工具类
 */
export class ReplaceLayerContentTool implements Tool {
    name = 'replaceLayerContent';
    description = '替换图层内容（将 base64 图像数据应用到指定图层）';
    
    schema = {
        name: this.name,
        description: this.description,
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: {
                    type: 'number',
                    description: '要替换内容的图层 ID'
                },
                imageBase64: {
                    type: 'string',
                    description: '图像的 base64 数据'
                },
                bounds: {
                    type: 'object',
                    description: '可选的目标边界',
                    properties: {
                        left: { type: 'number', description: '左边界' },
                        top: { type: 'number', description: '上边界' },
                        width: { type: 'number', description: '宽度' },
                        height: { type: 'number', description: '高度' }
                    }
                }
            },
            required: ['layerId', 'imageBase64'] as string[]
        }
    };
    
    async execute(params: ReplaceLayerContentParams): Promise<ReplaceLayerContentResult> {
        return replaceLayerContent(params);
    }
}
