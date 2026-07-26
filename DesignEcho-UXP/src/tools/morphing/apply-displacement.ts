/**
 * 应用稀疏位移场到图层
 * 
 * 接收 Agent 端计算的稀疏位移场，在 UXP 端应用
 * 通过 getPixels + 位移计算 + putPixels 实现
 */

import { action, app, core, imaging } from 'photoshop';
import { ToolResult } from '../types';
import { 
    startTask, endTask, startStep, endStep, 
    logInfo, logWarn, logError, logPerf 
} from './execution-logger';

/**
 * 稀疏位移场接口 (与 Agent 端一致)
 */
interface SparseDisplacementField {
    width: number;
    height: number;
    pixelCount: number;
    indices: Uint32Array;
    dx: Int16Array;
    dy: Int16Array;
    checksum: number;
}

/**
 * 应用位移参数
 */
export interface ApplyDisplacementParams {
    layerId: number;
    sparseDisplacement: string;  // SPARSE:xxx 格式
    preserveOriginal?: boolean;
    resultLayerName?: string;
}

/**
 * 应用位移结果
 */
export interface ApplyDisplacementResult {
    success: boolean;
    layerId: number;
    layerName: string;
    processingTime: number;
    outputLayerId?: number;
    outputLayerName?: string;
    preservedOriginal?: boolean;
    error?: string;
}

/**
 * 量化精度 (与 Agent 端一致)
 */
const QUANTIZATION_SCALE = 100;

/**
 * 反序列化稀疏位移场
 */
function deserializeSparseDisplacement(data: string): SparseDisplacementField {
    if (!data.startsWith('SPARSE:')) {
        throw new Error('Invalid sparse displacement format');
    }
    
    const base64 = data.substring(7);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    
    const buffer = bytes.buffer;
    const view = new DataView(buffer);
    
    // 读取头部
    const width = view.getUint32(0, true);
    const height = view.getUint32(4, true);
    const pixelCount = view.getUint32(8, true);
    const checksum = view.getUint32(12, true);
    
    // 读取数据
    const headerSize = 24;
    let offset = headerSize;
    
    const indices = new Uint32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        indices[i] = view.getUint32(offset, true);
        offset += 4;
    }
    
    const dx = new Int16Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        dx[i] = view.getInt16(offset, true);
        offset += 2;
    }
    
    const dy = new Int16Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        dy[i] = view.getInt16(offset, true);
        offset += 2;
    }
    
    console.log(`[ApplyDisp] 解析位移场: ${width}×${height}, ${pixelCount} 像素`);
    
    return {
        width,
        height,
        pixelCount,
        indices,
        dx,
        dy,
        checksum
    };
}

/**
 * 解压稀疏位移场为完整格式
 */
function decompressToFullField(sparse: SparseDisplacementField): {
    dx: Float32Array;
    dy: Float32Array;
} {
    const size = sparse.width * sparse.height;
    const dx = new Float32Array(size);
    const dy = new Float32Array(size);
    
    for (let i = 0; i < sparse.pixelCount; i++) {
        const idx = sparse.indices[i];
        dx[idx] = sparse.dx[i] / QUANTIZATION_SCALE;
        dy[idx] = sparse.dy[i] / QUANTIZATION_SCALE;
    }
    
    return { dx, dy };
}

/**
 * 应用稀疏位移场到图层
 */
export async function applyDisplacement(
    params: ApplyDisplacementParams
): Promise<ToolResult<ApplyDisplacementResult>> {
    const taskId = startTask('应用位移场', { layerId: params.layerId });
    const startTime = performance.now();
    
    try {
        const doc = app.activeDocument;
        if (!doc) {
            throw new Error('没有打开的文档');
        }
        
        // 步骤 1: 解析稀疏位移场
        const step1 = startStep('解析位移场');
        
        const sparse = deserializeSparseDisplacement(params.sparseDisplacement);
        
        logInfo(`位移场: ${sparse.width}×${sparse.height}, ${sparse.pixelCount} 边缘像素`);
        endStep(step1, true);
        
        // 步骤 1.5: 检查图层类型，非像素图层需要栅格化
        const step1b = startStep('检查图层类型');
        
        let actualLayerId = params.layerId;
        let layerName = '';
        let outputLayerName = '';
        const preserveOriginal = params.preserveOriginal !== false;
        
        await core.executeAsModal(async () => {
            const layer = findLayerById(doc, params.layerId);
            if (!layer) {
                throw new Error(`未找到图层 ID: ${params.layerId}`);
            }
            layerName = layer.name;
            outputLayerName = layer.name;

            if (preserveOriginal) {
                const duplicatedLayer = await layer.duplicate();
                if (params.resultLayerName) {
                    duplicatedLayer.name = params.resultLayerName;
                }
                actualLayerId = Number(duplicatedLayer.id);
                outputLayerName = duplicatedLayer.name;
                logInfo(`已创建安全副本: ${layer.name} -> ${outputLayerName}`);
            }

            const workingLayer = findLayerById(doc, actualLayerId);
            if (!workingLayer) {
                throw new Error(`未找到工作图层 ID: ${actualLayerId}`);
            }
            const layerKind = workingLayer.kind?.toString() || 'unknown';
            
            logInfo(`图层类型: ${layerKind} (${workingLayer.name})`);
            
            // 检查是否需要栅格化
            const needsRasterize = ['solidColorLayer', 'gradientLayer', 'patternLayer', 
                                    'textLayer', 'vectorLayer', 'shapeLayer',
                                    'smartObjectLayer', 'generatedContentLayer'].some(
                k => layerKind.toLowerCase().includes(k.toLowerCase())
            );
            
            if (needsRasterize || layerKind === 'unknown') {
                logInfo(`图层 "${workingLayer.name}" 不是像素图层，尝试栅格化...`);
                
                // 先选中图层
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: actualLayerId }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                
                // 栅格化图层
                await action.batchPlay([{
                    _obj: 'rasterizeLayer',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                
                logInfo(`✓ 图层已栅格化`);
                
                // 注意：栅格化后图层 ID 可能改变，需要重新获取
                // 但通常 ID 不变，只是类型变了
            }
        }, { commandName: 'DesignEcho: 检查图层类型' });
        
        endStep(step1b, true);
        
        // 步骤 2: 获取图层像素
        const step2 = startStep('获取图层像素');
        
        let sourcePixels: any;
        
        await core.executeAsModal(async () => {
            const layer = findLayerById(doc, actualLayerId);
            if (!layer) {
                throw new Error(`未找到图层 ID: ${actualLayerId}`);
            }
            layerName = layer.name;
            
            sourcePixels = await imaging.getPixels({
                documentID: doc.id,
                layerID: actualLayerId
            });
        }, { commandName: 'DesignEcho: 获取图层像素' });
        
        if (!sourcePixels?.imageData) {
            throw new Error('无法获取图层像素');
        }
        
        const imageData = sourcePixels.imageData;
        const srcWidth = imageData.width;
        const srcHeight = imageData.height;
        const channels = imageData.components;
        
        logInfo(`图层 "${layerName}": ${srcWidth}×${srcHeight}, ${channels} 通道`);
        endStep(step2, true);
        
        // 步骤 3: 检查尺寸匹配
        if (srcWidth !== sparse.width || srcHeight !== sparse.height) {
            logWarn(`尺寸不匹配: 图层 ${srcWidth}×${srcHeight}, 位移场 ${sparse.width}×${sparse.height}`);
            // 可以考虑缩放位移场，暂时报错
            throw new Error(`图层尺寸 (${srcWidth}×${srcHeight}) 与位移场 (${sparse.width}×${sparse.height}) 不匹配`);
        }
        
        // 步骤 4: 解压位移场
        const step3 = startStep('解压位移场');
        
        const { dx, dy } = decompressToFullField(sparse);
        
        endStep(step3, true);
        
        // 步骤 5: 应用位移 (双线性插值)
        const step4 = startStep('应用位移变形');
        
        const srcData = await imageData.getData();
        const dstData = new Uint8Array(srcData.length);
        
        // 逐像素处理
        for (let y = 0; y < srcHeight; y++) {
            for (let x = 0; x < srcWidth; x++) {
                const idx = y * srcWidth + x;
                
                // 源坐标 (反向映射)
                const srcX = x - dx[idx];
                const srcY = y - dy[idx];
                
                // 双线性插值
                sampleBilinear(srcData, dstData, srcX, srcY, x, y, srcWidth, srcHeight, channels);
            }
        }
        
        endStep(step4, true);
        
        // 步骤 6: 写回像素
        const step5 = startStep('写回图层像素');
        
        await core.executeAsModal(async () => {
            // 创建新的 ImageData
            const newImageData = await imaging.createImageDataFromBuffer(
                dstData,
                {
                    width: srcWidth,
                    height: srcHeight,
                    components: channels,
                    colorSpace: imageData.colorSpace as 'RGB' | 'Grayscale' | 'Lab'
                }
            );
            
            // 写入图层
            await imaging.putPixels({
                documentID: doc.id,
                layerID: actualLayerId,
                imageData: newImageData
            });
            
            newImageData.dispose();
        }, { commandName: 'DesignEcho: 写回图层像素' });
        
        // 清理
        imageData.dispose();
        
        endStep(step5, true);
        
        // 完成
        const processingTime = performance.now() - startTime;
        logPerf('位移场应用', processingTime);
        endTask(taskId, true);
        
        return {
            success: true,
            data: {
                success: true,
                layerId: actualLayerId,
                layerName,
                processingTime,
                outputLayerId: actualLayerId,
                outputLayerName,
                preservedOriginal: preserveOriginal
            }
        };
        
    } catch (error: any) {
        const processingTime = performance.now() - startTime;
        logError(error, { params });
        endTask(taskId, false);
        
        return {
            success: false,
            error: `应用位移场失败: ${error.message}`,
            data: {
                success: false,
                layerId: params.layerId,
                layerName: '',
                processingTime,
                outputLayerId: params.layerId,
                outputLayerName: '',
                preservedOriginal: params.preserveOriginal !== false,
                error: error.message
            }
        };
    }
}

/**
 * 双线性插值采样
 */
function sampleBilinear(
    src: Uint8Array,
    dst: Uint8Array,
    srcX: number,
    srcY: number,
    dstX: number,
    dstY: number,
    width: number,
    height: number,
    channels: number
): void {
    const x0 = Math.floor(srcX);
    const y0 = Math.floor(srcY);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    
    const fx = srcX - x0;
    const fy = srcY - y0;
    
    const dstIdx = (dstY * width + dstX) * channels;
    
    // 边界检查
    if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) {
        // 超出边界，使用透明
        for (let c = 0; c < channels; c++) {
            dst[dstIdx + c] = 0;
        }
        return;
    }
    
    const idx00 = (y0 * width + Math.max(0, x0)) * channels;
    const idx10 = (y0 * width + x1) * channels;
    const idx01 = (Math.min(y1, height - 1) * width + Math.max(0, x0)) * channels;
    const idx11 = (Math.min(y1, height - 1) * width + x1) * channels;
    
    for (let c = 0; c < channels; c++) {
        const v00 = src[idx00 + c];
        const v10 = src[idx10 + c];
        const v01 = src[idx01 + c];
        const v11 = src[idx11 + c];
        
        const value = (1 - fx) * (1 - fy) * v00 +
                      fx * (1 - fy) * v10 +
                      (1 - fx) * fy * v01 +
                      fx * fy * v11;
        
        dst[dstIdx + c] = Math.round(value);
    }
}

/**
 * 递归查找图层
 */
function findLayerById(container: any, id: number): any {
    const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
    
    for (const layer of container.layers) {
        if (layer.id === numericId) {
            return layer;
        }
        if (layer.layers) {
            const found = findLayerById(layer, numericId);
            if (found) return found;
        }
    }
    return null;
}

// 注册工具
export const applyDisplacementTool = {
    name: 'applyDisplacement',
    description: '应用稀疏位移场到图层',
    handler: applyDisplacement
};
